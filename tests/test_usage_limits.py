"""Usage enforcement tests; all OpenAI operations are mocked (no paid requests)."""

import asyncio
import unittest
from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient
from openai import APITimeoutError
from pydantic import ValidationError
from starlette.requests import Request

from backend.config import Settings
from backend.errors import AppError
from backend.main import create_app
from backend.providers import OpenAIProvider
from backend.schemas import ConversationDecision
from backend.usage import USAGE_LIMIT_MESSAGE, OpenAIUsageLimiter, client_ip


def mock_client():
    decision = ConversationDecision(
        intent="package_question",
        requested_fact_keys=["price"],
        objection="none",
        evidence_quote=None,
        follow_up_note=None,
    )
    # Valid MP3 frames long enough for the introduction and templated replies.
    speech = (bytes.fromhex("fffb9000") + bytes(413)) * 500
    return SimpleNamespace(
        responses=SimpleNamespace(
            parse=AsyncMock(
                return_value=SimpleNamespace(
                    status="completed",
                    output_parsed=decision,
                )
            )
        ),
        audio=SimpleNamespace(
            transcriptions=SimpleNamespace(
                create=AsyncMock(return_value=SimpleNamespace(text="What is the price?"))
            ),
            speech=SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(content=speech))),
        ),
        close=AsyncMock(),
    )


class UsageLimiterTests(unittest.TestCase):
    def test_concurrent_reservations_obey_both_default_limits(self):
        limiter = OpenAIUsageLimiter(100, 7)

        def attempt(index):
            try:
                limiter.reserve(f"203.0.113.{index % 20}")
                return True
            except AppError as exc:
                self.assertEqual(exc.status_code, 429)
                return False

        with ThreadPoolExecutor(max_workers=32) as executor:
            admitted = list(executor.map(attempt, range(1000)))
        self.assertEqual(sum(admitted), 100)
        self.assertEqual(limiter.total_calls, 100)
        self.assertEqual(sum(limiter.visitor_calls.values()), 100)
        self.assertLessEqual(max(limiter.visitor_calls.values()), 7)

    def test_visitor_limit_does_not_consume_another_visitors_budget(self):
        limiter = OpenAIUsageLimiter(100, 7)
        for _ in range(7):
            limiter.reserve("visitor-a")
        for _ in range(3):
            with self.assertRaises(AppError) as error:
                limiter.reserve("visitor-a")
            self.assertEqual(error.exception.message, USAGE_LIMIT_MESSAGE)
        limiter.reserve("visitor-b")
        self.assertEqual(limiter.total_calls, 8)
        self.assertEqual(limiter.visitor_calls, {"visitor-a": 7, "visitor-b": 1})

    def test_environment_configuration_and_invalid_values(self):
        with patch.dict(
            "os.environ",
            {
                "OPENAI_MAX_CALLS_TOTAL": "12",
                "OPENAI_MAX_CALLS_PER_VISITOR": "3",
            },
        ):
            settings = Settings(_env_file=None)
        self.assertEqual(settings.openai_max_calls_total, 12)
        self.assertEqual(settings.openai_max_calls_per_visitor, 3)
        for field in ("openai_max_calls_total", "openai_max_calls_per_visitor"):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                Settings(_env_file=None, **{field: -1})

    def test_forwarded_ip_selection_and_normalization(self):
        cases = [
            ({"x-forwarded-for": " 203.0.113.1 , 10.0.0.1"}, "203.0.113.1"),
            (
                {"cf-connecting-ip": "203.0.113.2", "x-forwarded-for": "198.51.100.99"},
                "203.0.113.2",
            ),
            ({"x-forwarded-for": "2001:0db8:0:0::1, 10.0.0.1"}, "2001:db8::1"),
            ({"x-forwarded-for": "::ffff:203.0.113.1"}, "203.0.113.1"),
            ({"cf-connecting-ip": "invalid", "x-forwarded-for": "203.0.113.1"}, "203.0.113.1"),
            ({"x-forwarded-for": "invalid, 203.0.113.1"}, "127.0.0.1"),
            ({}, "127.0.0.1"),
        ]
        for headers, expected in cases:
            with self.subTest(headers=headers):
                request = Request(
                    {
                        "type": "http",
                        "client": ("127.0.0.1", 1234),
                        "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
                    }
                )
                self.assertEqual(client_ip(request), expected)
        self.assertEqual(client_ip(Request({"type": "http", "headers": []})), "unknown")


class ProviderConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_mixed_concurrent_openai_operations_stop_at_100_total(self):
        provider = OpenAIProvider(Settings(_env_file=None, openai_api_key="test-only"))
        sdk = mock_client()
        provider._client = sdk
        operations = []
        for index in range(200):
            ip = f"203.0.113.{index % 20}"
            operations.append(
                provider.transcribe(b"audio", "test.webm", "audio/webm", visitor_ip=ip)
                if index % 2
                else provider.synthesize_verified_text("Hello", visitor_ip=ip)
            )
        results = await asyncio.gather(*operations, return_exceptions=True)
        rejected = [result for result in results if isinstance(result, AppError)]
        self.assertEqual(len(rejected), 100)
        self.assertTrue(all(exc.status_code == 429 for exc in rejected))
        self.assertEqual(
            sdk.audio.transcriptions.create.await_count + sdk.audio.speech.create.await_count, 100
        )
        self.assertEqual(provider.usage.total_calls, 100)
        self.assertLessEqual(max(provider.usage.visitor_calls.values()), 7)
        await provider.close()

    async def test_in_flight_calls_already_consume_the_visitor_budget(self):
        provider = OpenAIProvider(Settings(_env_file=None, openai_api_key="test-only"))
        provider._client = mock_client()
        release = asyncio.Event()
        entered = 0

        async def slow_operation():
            nonlocal entered
            entered += 1
            await release.wait()

        tasks = [
            asyncio.create_task(provider._request(slow_operation, visitor_ip="203.0.113.1"))
            for _ in range(50)
        ]
        await asyncio.sleep(0)
        self.assertEqual(entered, 7)
        self.assertEqual(provider.usage.total_calls, 7)
        release.set()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        rejected = [result for result in results if isinstance(result, AppError)]
        self.assertEqual(len(rejected), 43)
        self.assertTrue(all(exc.status_code == 429 for exc in rejected))
        await provider.close()


class UsageAPITests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def app(self, total=100, per_visitor=7):
        return create_app(
            Settings(
                _env_file=None,
                app_env="development",
                demo_access_token="",
                openai_api_key="test-only",
                database_url=f"sqlite:///{self.directory.name}/test.db",
                openai_max_calls_total=total,
                openai_max_calls_per_visitor=per_visitor,
            )
        )

    def start_call(self, client, index=0):
        recommendations = client.get("/api/recommendations").json()["items"]
        rec_id = recommendations[index]["id"]
        response = client.post(f"/api/recommendations/{rec_id}/approve", json={})
        self.assertEqual(response.status_code, 200)
        response = client.post(
            "/api/calls",
            json={
                "recommendation_id": rec_id,
                "start_request_id": f"start_{index}",
            },
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def turn(self, client, call, turn_id, ip="203.0.113.1", audio=False):
        files = {"audio": ("recording.webm", b"\x1a\x45\xdf\xa3test", "audio/webm")}
        return client.post(
            f"/api/calls/{call['call_id']}/turns",
            data={"client_turn_id": turn_id, **({} if audio else {"text": "price?"})},
            files=files if audio else None,
            headers={"x-forwarded-for": f"{ip}, 10.0.0.1"},
        )

    def speech(self, client, call, turn_id=None, ip="203.0.113.1"):
        turn_id = turn_id or call["introduction_turn"]["id"]
        return client.get(
            f"/api/calls/{call['call_id']}/turns/{turn_id}/audio",
            headers={"x-forwarded-for": ip},
        )

    def assert_limited(self, response):
        self.assertEqual(response.status_code, 429, response.text)
        self.assertEqual(
            response.json(),
            {
                "detail": {
                    "code": "demo_usage_limit",
                    "message": USAGE_LIMIT_MESSAGE,
                }
            },
        )

    def test_seventh_call_allowed_eighth_blocked_and_other_visitor_allowed(self):
        app = self.app()
        with TestClient(app) as client:
            sdk = mock_client()
            app.state.provider._client = sdk
            call = self.start_call(client)
            for index in range(7):
                self.assertEqual(self.turn(client, call, f"turn_{index}").status_code, 200)
            self.assert_limited(self.turn(client, call, "turn_7"))
            self.assertEqual(sdk.responses.parse.await_count, 7)
            # The same visitor remains capped on speech; another visitor can
            # complete the pending turn without changing the original IP budget.
            self.assert_limited(self.speech(client, call))
            self.assertEqual(self.turn(client, call, "turn_7", ip="203.0.113.2").status_code, 200)
            self.assertEqual(sdk.responses.parse.await_count, 8)
            self.assertEqual(client.get("/api/dashboard").status_code, 200)
            self.assertEqual(
                client.post(f"/api/calls/{call['call_id']}/end", json={}).status_code, 200
            )
            other_call = self.start_call(client, index=1)
            self.assert_limited(self.turn(client, other_call, "new_call"))

    def test_audio_uses_three_slots_and_cache_and_turn_replay_use_none(self):
        app = self.app(total=3)
        with TestClient(app) as client:
            sdk = mock_client()
            app.state.provider._client = sdk
            call = self.start_call(client)
            response = self.turn(client, call, "audio_turn", audio=True)
            self.assertEqual(response.status_code, 200)
            assistant_id = response.json()["assistant_turn"]["id"]
            self.assertEqual(self.speech(client, call, assistant_id).status_code, 200)
            self.assertEqual(app.state.provider.usage.total_calls, 3)
            self.assertEqual(sdk.audio.transcriptions.create.await_count, 1)
            self.assertEqual(sdk.responses.parse.await_count, 1)
            self.assertEqual(sdk.audio.speech.create.await_count, 1)
            self.assertEqual(self.speech(client, call, assistant_id).status_code, 200)
            self.assertEqual(self.turn(client, call, "audio_turn", audio=True).status_code, 200)
            self.assertEqual(app.state.provider.usage.total_calls, 3)
            # Uncached introductory speech needs a new call and is blocked globally.
            self.assert_limited(self.speech(client, call, ip="203.0.113.2"))
            self.assert_limited(self.turn(client, call, "next_turn", ip="203.0.113.2"))

    def test_limit_between_transcription_and_text_keeps_transcript_and_returns_429(self):
        app = self.app(total=1)
        with TestClient(app) as client:
            sdk = mock_client()
            app.state.provider._client = sdk
            call = self.start_call(client)
            self.assert_limited(self.turn(client, call, "last_slot", audio=True))
            self.assertEqual(sdk.audio.transcriptions.create.await_count, 1)
            sdk.responses.parse.assert_not_awaited()
            saved = client.get(f"/api/calls/{call['call_id']}").json()
            self.assertEqual(saved["turns"][-1]["text"], "What is the price?")
            self.assertEqual(saved["error_code"], "demo_usage_limit")
            self.assert_limited(self.turn(client, call, "last_slot", audio=True))
            self.assertEqual(sdk.audio.transcriptions.create.await_count, 1)

    def test_failed_outbound_call_is_counted_but_invalid_input_is_not(self):
        app = self.app(total=1)
        with TestClient(app) as client:
            sdk = mock_client()
            app.state.provider._client = sdk
            call = self.start_call(client)
            invalid = client.post(
                f"/api/calls/{call['call_id']}/turns",
                data={
                    "client_turn_id": "invalid",
                    "text": " ",
                },
            )
            self.assertEqual(invalid.status_code, 422)
            self.assertEqual(app.state.provider.usage.total_calls, 0)
            sdk.responses.parse.side_effect = APITimeoutError(
                request=httpx.Request("POST", "https://api.openai.com/v1/responses")
            )
            self.assertEqual(self.turn(client, call, "failed").status_code, 504)
            self.assert_limited(self.turn(client, call, "failed"))
            self.assertEqual(sdk.responses.parse.await_count, 1)

    def test_budgets_reset_on_new_application_lifespan_with_same_database(self):
        app = self.app(total=1)
        for _ in range(2):
            with TestClient(app) as client:
                sdk = mock_client()
                app.state.provider._client = sdk
                call = self.start_call(client)
                self.assertEqual(self.speech(client, call).status_code, 200)
                self.assertEqual(app.state.provider.usage.total_calls, 1)
                self.assert_limited(self.turn(client, call, "blocked"))

    def test_zero_either_limit_blocks_every_openai_operation(self):
        for total, visitor in ((0, 7), (100, 0)):
            with self.subTest(total=total, visitor=visitor):
                app = self.app(total=total, per_visitor=visitor)
                with TestClient(app) as client:
                    sdk = mock_client()
                    app.state.provider._client = sdk
                    call = self.start_call(client)
                    self.assert_limited(self.turn(client, call, "blocked"))
                    self.assert_limited(self.speech(client, call))
                    self.assertEqual(app.state.provider.usage.total_calls, 0)
                    sdk.responses.parse.assert_not_awaited()
                    sdk.audio.speech.create.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
