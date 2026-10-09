"""Regression checks using isolated SQLite and deterministic provider decisions."""

import unittest
from datetime import timedelta
from tempfile import TemporaryDirectory
from unittest.mock import patch

from sqlalchemy import select

from backend.audio import SpeechCache
from backend.config import Settings
from backend.database import Base, build_engine, build_session_factory, utc_now
from backend.enums import CallStatus, FactKey, Intent, RecommendationStatus
from backend.errors import AppError
from backend.models import Call, Recommendation
from backend.recommendations import generate_recommendations
from backend.schemas import ApproveRequest, ConversationDecision, EndCallRequest, StartCallRequest
from backend.seed import seed_demo_data
from backend.workflow import CallWorkflow


class Provider:
    def __init__(self, settings):
        self.settings = settings
        self.during_request = None
        self.decision = None

    async def extract_decision(self, *_args):
        if self.during_request:
            await self.during_request()
        if self.decision:
            return self.decision
        return ConversationDecision(
            intent=Intent.PACKAGE_QUESTION,
            requested_fact_keys=[FactKey.PRICE],
            objection="none",
            evidence_quote=None,
            follow_up_note=None,
        )


class CallIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = TemporaryDirectory()
        self.settings = Settings(
            _env_file=None, database_url=f"sqlite:///{self.directory.name}/test.db"
        )
        self.engine = build_engine(self.settings.database_url)
        Base.metadata.create_all(self.engine)
        self.sessions = build_session_factory(self.engine)
        with self.sessions.begin() as session:
            seed_demo_data(session)
            generate_recommendations(session)
            self.rec_id = session.scalar(select(Recommendation.id))
        self.provider = Provider(self.settings)
        self.cache = SpeechCache(self.provider)
        self.workflow = CallWorkflow(self.sessions, self.provider, self.cache)
        await self.workflow.approve(self.rec_id, ApproveRequest())
        self.call = await self.workflow.start(
            StartCallRequest(recommendation_id=self.rec_id, start_request_id="test_start")
        )

    async def asyncTearDown(self):
        self.cache.close()
        self.engine.dispose()
        self.directory.cleanup()

    async def test_more_than_ten_questions_continue_and_duplicate_does_not_count_twice(self):
        for index in range(12):
            response = await self.workflow.turn(self.call.call_id, f"turn_{index}", "price?", None)
            self.assertEqual(response.status, CallStatus.ACTIVE)
        await self.workflow.turn(self.call.call_id, "turn_11", "price?", None)
        saved = await self.workflow.read(self.call.call_id)
        self.assertEqual(len(saved.turns), 25)
        self.assertEqual(saved.limits.max_customer_turns, 50)

    async def test_configured_turn_cap_still_closes_unresolved(self):
        self.settings.call_max_customer_turns = 2
        await self.workflow.turn(self.call.call_id, "turn_1", "price?", None)
        response = await self.workflow.turn(self.call.call_id, "turn_2", "price?", None)
        self.assertEqual(response.status, CallStatus.UNRESOLVED)
        self.assertEqual((await self.workflow.read(self.call.call_id)).error_code, "turn_limit")

    async def test_confirmed_interest_at_cap_preserves_accepted_outcome(self):
        self.settings.call_max_customer_turns = 3
        for index, (text, intent) in enumerate(
            [
                ("Yes, you can explain", Intent.CONSENT),
                ("I am interested", Intent.ACCEPT_INTEREST),
                ("Yes, I confirm my interest", Intent.CONFIRM_ACCEPT),
            ]
        ):
            self.provider.decision = ConversationDecision(
                intent=intent,
                requested_fact_keys=[],
                objection="none",
                evidence_quote=text,
                follow_up_note=None,
            )
            response = await self.workflow.turn(self.call.call_id, f"confirm_{index}", text, None)
            if index < 2:
                self.assertEqual(response.status, CallStatus.ACTIVE)
                self.assertIsNone(response.result)
        self.assertEqual(response.status, CallStatus.COMPLETED)
        self.assertEqual(response.result.outcome.value, "accepted")
        ended = await self.workflow.end(self.call.call_id, EndCallRequest())
        self.assertEqual(ended.result.outcome.value, "accepted")

    async def test_idle_and_total_timeouts_are_configurable(self):
        for reason in ["inactivity_timeout", "session_timeout"]:
            with self.subTest(reason=reason):
                now = utc_now()
                with self.sessions.begin() as session:
                    call = session.get(Call, self.call.call_id)
                    call.started_at = now - timedelta(seconds=100)
                    call.last_activity_at = now - timedelta(seconds=3)
                self.settings.call_idle_timeout_seconds = (
                    2 if reason == "inactivity_timeout" else 600
                )
                self.settings.call_session_timeout_seconds = (
                    1800 if reason == "inactivity_timeout" else 99
                )
                await self.workflow.expire()
                self.assertEqual((await self.workflow.read(self.call.call_id)).error_code, reason)
                # Restore via the public development reset workflow.
                await self.workflow.delete(self.call.call_id)
                self.call = await self.workflow.start(
                    StartCallRequest(
                        recommendation_id=self.rec_id, start_request_id=f"restart_{reason}"
                    )
                )

    async def test_provider_await_is_not_expired_by_concurrent_reads(self):
        self.settings.call_idle_timeout_seconds = 1
        now = utc_now()

        async def during_request():
            with patch("backend.workflow.utc_now", return_value=now + timedelta(seconds=5)):
                await self.workflow.expire()
                self.assertEqual(
                    (await self.workflow.read(self.call.call_id)).status, CallStatus.ACTIVE
                )

        self.provider.during_request = during_request
        response = await self.workflow.turn(self.call.call_id, "slow_turn", "price?", None)
        self.assertEqual(response.status, CallStatus.ACTIVE)
        self.assertIsNotNone(response.assistant_turn)

    async def test_provider_failure_keeps_message_and_full_retry_window(self):
        later = utc_now() + timedelta(seconds=90)

        async def fail():
            raise AppError("provider_timeout", "timeout", 504)

        self.provider.during_request = fail
        with patch("backend.workflow.utc_now", return_value=later):
            with self.assertRaises(AppError):
                await self.workflow.turn(self.call.call_id, "retry_me", "price?", None)
        saved = await self.workflow.read(self.call.call_id)
        self.assertEqual(saved.last_activity_at, later)
        self.provider.during_request = None
        await self.workflow.turn(self.call.call_id, "retry_me", "price?", None)
        self.assertEqual(len((await self.workflow.read(self.call.call_id)).turns), 3)

    async def test_delete_closed_call_resets_approval_and_allows_new_chat(self):
        with self.assertRaises(AppError) as error:
            await self.workflow.delete(self.call.call_id)
        self.assertEqual(error.exception.code, "call_not_closed")
        await self.workflow.end(self.call.call_id, EndCallRequest())
        await self.workflow.delete(self.call.call_id)
        with self.sessions() as session:
            self.assertEqual(
                session.get(Recommendation, self.rec_id).status, RecommendationStatus.APPROVED
            )
        with self.assertRaises(AppError):
            await self.workflow.read(self.call.call_id)
        new = await self.workflow.start(
            StartCallRequest(recommendation_id=self.rec_id, start_request_id="new_chat")
        )
        self.assertEqual(new.status, CallStatus.ACTIVE)
        self.assertEqual(len((await self.workflow.read(new.call_id)).turns), 1)


if __name__ == "__main__":
    unittest.main()
