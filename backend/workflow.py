"""Approval and voice/text calls for a single-worker, single-instance demo."""

import asyncio
import hashlib
import json
from datetime import timedelta

from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from backend.audio import AudioInput, SpeechCache
from backend.conversation import INTRODUCTION, UNRESOLVED_CLOSING, render_reply, result_summary
from backend.database import utc_now
from backend.enums import (
    CallStatus,
    ConversationState,
    Outcome,
    RecommendationStatus,
    TurnRole,
)
from backend.errors import AppError
from backend.models import (
    Call,
    CallResult,
    CallTurn,
    Customer,
    Recommendation,
    TelecomPackage,
    UsageData,
)
from backend.providers import OpenAIProvider
from backend.recommendations import evaluate_customer
from backend.schemas import (
    ApproveRequest,
    CallResponse,
    EndCallRequest,
    OfferSnapshot,
    RecommendationEvidence,
    RecommendationResponse,
    StartCallRequest,
    StartCallResponse,
    TurnResponse,
)
from backend.serialization import (
    call_response,
    package_response,
    recommendation_response,
    turn_response,
)

MAX_CUSTOMER_TURNS = 10
SESSION_LIMIT = timedelta(minutes=5)
IDLE_LIMIT = timedelta(minutes=2)


def require_call(session: Session, call_id: int) -> Call:
    call = session.get(Call, call_id)
    if call is None:
        raise AppError("call_not_found", "Call not found.", 404)
    return call


def mark_interrupted(session: Session, call: Call, turn_id: int | None) -> None:
    if turn_id is None:
        return
    turn = session.get(CallTurn, turn_id)
    if turn is None or turn.call_id != call.id or turn.role != TurnRole.ASSISTANT:
        raise AppError(
            "invalid_interruption",
            "Interruption must identify an assistant turn in this call.",
            422,
        )
    turn.interrupted = True


def save_result(
    session: Session,
    call: Call,
    outcome: Outcome,
    evidence: CallTurn | None = None,
    follow_up_note: str | None = None,
    reason: str | None = None,
) -> None:
    if call.status != CallStatus.ACTIVE:
        return
    if outcome != Outcome.UNRESOLVED and (
        evidence is None or evidence.call_id != call.id or evidence.role != TurnRole.CUSTOMER
    ):
        raise AppError(
            "invalid_outcome_evidence", "Outcome requires a customer turn in this call.", 409
        )
    intents = set(
        session.scalars(
            select(CallTurn.intent).where(
                CallTurn.call_id == call.id,
                CallTurn.role == TurnRole.CUSTOMER,
                CallTurn.intent.is_not(None),
            )
        ).all()
    )
    offer = OfferSnapshot.model_validate(call.offer_snapshot_json)
    summary, next_action = result_summary(outcome, offer, intents, reason)
    now = utc_now()
    call.status = CallStatus.UNRESOLVED if outcome == Outcome.UNRESOLVED else CallStatus.COMPLETED
    call.conversation_state = ConversationState.CLOSED
    call.ended_at = now
    call.last_activity_at = now
    call.error_code = reason if outcome == Outcome.UNRESOLVED else None
    session.add(
        CallResult(
            call_id=call.id,
            outcome=outcome,
            summary=summary,
            next_action=next_action,
            follow_up_note=follow_up_note,
            evidence_turn_id=evidence.id if evidence else None,
            created_at=now,
        )
    )
    session.flush()


def expire_calls(session: Session) -> None:
    now = utc_now()
    for call in session.scalars(select(Call).where(Call.status == CallStatus.ACTIVE)).all():
        reason = None
        if now - call.started_at >= SESSION_LIMIT:
            reason = "session_timeout"
        elif now - call.last_activity_at >= IDLE_LIMIT:
            reason = "inactivity_timeout"
        if reason:
            # No synthetic customer decision or evidence is created for expiry.
            save_result(session, call, Outcome.UNRESOLVED, reason=reason)


class CallWorkflow:
    def __init__(
        self, sessions: sessionmaker[Session], provider: OpenAIProvider, speech_cache: SpeechCache
    ):
        self.sessions = sessions
        self.provider = provider
        self.speech_cache = speech_cache
        self.lock = asyncio.Lock()
        self.processing: set[int] = set()

    async def expire(self) -> None:
        async with self.lock:
            with self.sessions.begin() as session:
                expire_calls(session)

    def _offer_records(self, session: Session, recommendation_id: int):
        recommendation = session.get(Recommendation, recommendation_id)
        if recommendation is None:
            raise AppError("recommendation_not_found", "Recommendation not found.", 404)
        customer = session.get(Customer, recommendation.customer_id)
        current = session.get(TelecomPackage, customer.current_package_id) if customer else None
        proposed = session.get(TelecomPackage, recommendation.package_id)
        if customer is None or current is None or proposed is None:
            raise AppError("invalid_recommendation_data", "Offer facts are incomplete.", 409)
        return recommendation, customer, current, proposed

    def _validate_offer(
        self,
        session: Session,
        recommendation: Recommendation,
        customer: Customer,
        current: TelecomPackage,
        proposed: TelecomPackage,
    ) -> OfferSnapshot:
        evaluation = evaluate_customer(
            customer,
            current,
            list(
                session.scalars(select(UsageData).where(UsageData.customer_id == customer.id)).all()
            ),
            list(session.scalars(select(TelecomPackage)).all()),
            utc_now().date(),
        )
        if evaluation.values is None:
            raise AppError("contact_ineligible", evaluation.diagnostic.message, 409)
        values = evaluation.values
        # Approval cannot authorize stale prices, changed usage, or a different current package.
        if any(getattr(recommendation, key) != value for key, value in values.items()):
            raise AppError(
                "stale_recommendation",
                "Offer facts have changed. Refresh recommendations before approval or contact.",
                409,
            )
        try:
            return OfferSnapshot(
                proposed_package=package_response(proposed),
                evidence=RecommendationEvidence.model_validate(
                    recommendation.evidence_snapshot_json
                ),
                reason=recommendation.reason,
                algorithm_version=recommendation.algorithm_version,
            )
        except ValidationError as exc:
            raise AppError("invalid_recommendation_data", "Offer facts are invalid.", 409) from exc

    async def approve(self, recommendation_id: int, body: ApproveRequest) -> RecommendationResponse:
        label = body.approved_by.strip()
        if not label:
            raise AppError("invalid_approval_label", "An employee label is required.", 422)
        async with self.lock:
            with self.sessions.begin() as session:
                recommendation, customer, current, proposed = self._offer_records(
                    session, recommendation_id
                )
                call = session.scalar(
                    select(Call).where(Call.recommendation_id == recommendation.id)
                )
                if recommendation.status == RecommendationStatus.PENDING:
                    self._validate_offer(session, recommendation, customer, current, proposed)
                    recommendation.status = RecommendationStatus.APPROVED
                    recommendation.approved_by = label
                    recommendation.approved_at = utc_now()
                    session.flush()
                return recommendation_response(recommendation, customer, current, proposed, call)

    def _start_response(self, session: Session, call: Call) -> StartCallResponse:
        introduction = session.scalar(
            select(CallTurn).where(CallTurn.call_id == call.id, CallTurn.sequence == 1)
        )
        return StartCallResponse(
            call_id=call.id,
            status=call.status,
            conversation_state=call.conversation_state,
            introduction_turn=turn_response(introduction),
        )

    async def start(self, body: StartCallRequest) -> StartCallResponse:
        async with self.lock:
            with self.sessions.begin() as session:
                existing = session.scalar(
                    select(Call).where(Call.start_request_id == body.start_request_id)
                )
                if existing:
                    if existing.recommendation_id != body.recommendation_id:
                        raise AppError(
                            "request_id_conflict",
                            "This start request ID belongs to another recommendation.",
                            409,
                        )
                    return self._start_response(session, existing)
                recommendation, customer, current, proposed = self._offer_records(
                    session, body.recommendation_id
                )
                if session.scalar(
                    select(Call.id).where(Call.recommendation_id == recommendation.id)
                ):
                    raise AppError(
                        "recommendation_already_called",
                        "This recommendation already has a demo call.",
                        409,
                    )
                if (
                    recommendation.status != RecommendationStatus.APPROVED
                    or recommendation.approved_at is None
                    or not recommendation.approved_by
                ):
                    raise AppError(
                        "approval_required",
                        "Employee approval is required before starting a call.",
                        409,
                    )
                if session.scalar(select(Call.id).where(Call.status == CallStatus.ACTIVE)):
                    raise AppError(
                        "active_call_exists",
                        "End the active demo call before starting another.",
                        409,
                    )
                snapshot = self._validate_offer(
                    session, recommendation, customer, current, proposed
                )
                now = utc_now()
                call = Call(
                    customer_id=customer.id,
                    recommendation_id=recommendation.id,
                    status=CallStatus.ACTIVE,
                    conversation_state=ConversationState.AWAITING_CONSENT,
                    offer_snapshot_json=snapshot.model_dump(mode="json"),
                    started_at=now,
                    last_activity_at=now,
                    start_request_id=body.start_request_id,
                )
                session.add(call)
                session.flush()
                session.add(
                    CallTurn(
                        call_id=call.id,
                        sequence=1,
                        role=TurnRole.ASSISTANT,
                        text=INTRODUCTION,
                        fact_keys_json=[],
                        created_at=now,
                    )
                )
                recommendation.status = RecommendationStatus.CONTACTED
                session.flush()
                return self._start_response(session, call)

    async def read(self, call_id: int) -> CallResponse:
        async with self.lock:
            with self.sessions() as session:
                return call_response(session, require_call(session, call_id))

    async def end(self, call_id: int, body: EndCallRequest) -> CallResponse:
        async with self.lock:
            with self.sessions.begin() as session:
                call = require_call(session, call_id)
                mark_interrupted(session, call, body.interrupted_assistant_turn_id)
                save_result(session, call, Outcome.UNRESOLVED, reason="manual_end")
                return call_response(session, call)

    async def delete(self, call_id: int) -> None:
        async with self.lock:
            with self.sessions.begin() as session:
                call = require_call(session, call_id)
                if call.status == CallStatus.ACTIVE or call_id in self.processing:
                    raise AppError(
                        "call_not_closed",
                        "End the call and wait for any pending turn before deleting it.",
                        409,
                    )
                recommendation = session.get(Recommendation, call.recommendation_id)
                if recommendation is None:
                    raise AppError("invalid_call_data", "Call recommendation is missing.", 409)
                session.execute(delete(CallResult).where(CallResult.call_id == call_id))
                session.execute(delete(CallTurn).where(CallTurn.call_id == call_id))
                session.delete(call)
                recommendation.status = RecommendationStatus.APPROVED
            self.speech_cache.discard_call(call_id)

    def _speech_source(
        self, session: Session, call_id: int, turn_id: int
    ) -> tuple[tuple[int, str], str]:
        call = require_call(session, call_id)
        turn = session.get(CallTurn, turn_id)
        if turn is None or turn.call_id != call_id:
            raise AppError("turn_not_found", "Turn not found in this call.", 404)
        if turn.role != TurnRole.ASSISTANT:
            raise AppError("invalid_speech_turn", "Only saved assistant turns can be spoken.", 422)
        fingerprint = json.dumps(
            [
                call_id,
                turn_id,
                call.started_at.isoformat(),
                turn.created_at.isoformat(),
                turn.text,
                self.provider.settings.openai_tts_model,
                self.provider.settings.openai_tts_voice,
                self.provider.speech_instructions,
            ]
        )
        key = (call_id, hashlib.sha256(fingerprint.encode()).hexdigest())
        return key, turn.text

    async def audio(self, call_id: int, turn_id: int) -> bytes:
        async with self.lock:
            with self.sessions() as session:
                key, verified_text = self._speech_source(session, call_id, turn_id)
        data = await self.speech_cache.get(key, verified_text)
        # A call may be deleted while TTS is running; never serve audio for a reused ID.
        async with self.lock:
            try:
                with self.sessions() as session:
                    current_key, _ = self._speech_source(session, call_id, turn_id)
                    if current_key != key:
                        raise AppError("turn_not_found", "The original turn no longer exists.", 404)
            except AppError:
                self.speech_cache.discard(key)
                raise
        return data

    async def turn(
        self,
        call_id: int,
        client_turn_id: str,
        text: str | None,
        interrupted_turn_id: int | None,
        audio: AudioInput | None = None,
    ) -> TurnResponse:
        transcript = text.strip() if text is not None else None
        if audio is None and not transcript:
            raise AppError("empty_transcript", "Enter a customer message.", 422)
        async with self.lock:
            with self.sessions.begin() as session:
                call = require_call(session, call_id)
                customer_turn = session.scalar(
                    select(CallTurn).where(
                        CallTurn.call_id == call.id, CallTurn.client_turn_id == client_turn_id
                    )
                )
                if customer_turn is not None:
                    matches = (
                        customer_turn.input_audio_sha256 == audio.sha256
                        if audio is not None
                        else customer_turn.text == transcript
                    )
                    if not matches:
                        raise AppError(
                            "request_id_conflict",
                            "This turn ID belongs to a different message.",
                            409,
                        )
                    transcript = customer_turn.text
                if customer_turn is not None and customer_turn.response_json is not None:
                    # Do not reinterpret an already completed decision or mutate the call on retry.
                    return TurnResponse.model_validate(customer_turn.response_json)
                if call.status != CallStatus.ACTIVE:
                    raise AppError(
                        "call_closed",
                        "This conversation is already closed. Fetch the saved result.",
                        409,
                    )
                if call_id in self.processing:
                    raise AppError(
                        "turn_in_progress",
                        "A customer turn is already being processed. "
                        "Retry the same ID when it finishes.",
                        409,
                    )
                turns = list(
                    session.scalars(
                        select(CallTurn)
                        .where(CallTurn.call_id == call.id)
                        .order_by(CallTurn.sequence)
                    ).all()
                )
                pending = next(
                    (
                        turn
                        for turn in turns
                        if turn.role == TurnRole.CUSTOMER and turn.response_json is None
                    ),
                    None,
                )
                if pending is not None and pending.client_turn_id != client_turn_id:
                    raise AppError(
                        "pending_turn",
                        "Retry the saved pending message with its original client_turn_id, "
                        "or end the call.",
                        409,
                    )
                mark_interrupted(session, call, interrupted_turn_id)
                if customer_turn is None and transcript is not None:
                    customer_turn = CallTurn(
                        call_id=call.id,
                        sequence=turns[-1].sequence + 1,
                        role=TurnRole.CUSTOMER,
                        text=transcript,
                        client_turn_id=client_turn_id,
                        fact_keys_json=[],
                    )
                    session.add(customer_turn)
                call.last_activity_at = utc_now()
                call.error_code = None
                session.flush()
                customer_turn_id = customer_turn.id if customer_turn is not None else None
            self.processing.add(call_id)

        try:
            if transcript is None:
                transcript = await self.provider.transcribe(
                    audio.data, audio.filename, audio.content_type
                )
                # Release uploaded bytes before the next provider request.
                audio_digest = audio.sha256
                audio = None
                if len(transcript) > 4000:
                    raise AppError(
                        "transcript_too_long",
                        "Speech exceeded the 4000-character limit. Record a shorter utterance.",
                        422,
                    )
                await self.expire()
                async with self.lock:
                    with self.sessions.begin() as session:
                        call = require_call(session, call_id)
                        if call.status != CallStatus.ACTIVE:
                            raise AppError(
                                "call_closed",
                                "The call ended while transcribing. Fetch its saved result.",
                                409,
                            )
                        sequence = session.scalar(
                            select(CallTurn.sequence)
                            .where(CallTurn.call_id == call_id)
                            .order_by(CallTurn.sequence.desc())
                            .limit(1)
                        )
                        customer_turn = CallTurn(
                            call_id=call_id,
                            sequence=sequence + 1,
                            role=TurnRole.CUSTOMER,
                            text=transcript,
                            client_turn_id=client_turn_id,
                            fact_keys_json=[],
                            input_audio_sha256=audio_digest,
                        )
                        session.add(customer_turn)
                        call.last_activity_at = utc_now()
                        session.flush()
                        customer_turn_id = customer_turn.id
            # Transcription is durable before intent extraction; all provider awaits are outside DB.
            async with self.lock:
                with self.sessions() as session:
                    call = require_call(session, call_id)
                    if call.status != CallStatus.ACTIVE:
                        raise AppError(
                            "call_closed",
                            "The call ended while processing. Fetch its saved result.",
                            409,
                        )
                    state = call.conversation_state
                    offer = OfferSnapshot.model_validate(call.offer_snapshot_json)
                    history = [
                        {"role": turn.role.value, "text": turn.text}
                        for turn in session.scalars(
                            select(CallTurn)
                            .where(CallTurn.call_id == call_id)
                            .order_by(CallTurn.sequence)
                        ).all()
                        if turn.id != customer_turn_id
                    ]
            decision = await self.provider.extract_decision(transcript, state, offer, history)
            reply = render_reply(state, offer, decision, transcript)
            # Commit expiry separately so a subsequent call_closed error cannot roll it back.
            await self.expire()
            async with self.lock:
                with self.sessions.begin() as session:
                    call = require_call(session, call_id)
                    if call.status != CallStatus.ACTIVE:
                        raise AppError(
                            "call_closed",
                            "The call ended while processing. Fetch its saved result.",
                            409,
                        )
                    customer_turn = session.get(CallTurn, customer_turn_id)
                    customer_turn.intent = decision.intent
                    assistant = CallTurn(
                        call_id=call.id,
                        sequence=customer_turn.sequence + 1,
                        role=TurnRole.ASSISTANT,
                        text=reply.text,
                        fact_keys_json=[key.value for key in reply.fact_keys],
                    )
                    session.add(assistant)
                    call.conversation_state = reply.state
                    call.last_activity_at = utc_now()
                    call.error_code = None
                    session.flush()
                    count = len(
                        session.scalars(
                            select(CallTurn.id).where(
                                CallTurn.call_id == call.id, CallTurn.role == TurnRole.CUSTOMER
                            )
                        ).all()
                    )
                    if reply.outcome:
                        save_result(
                            session, call, reply.outcome, customer_turn, reply.follow_up_note
                        )
                    elif count >= MAX_CUSTOMER_TURNS:
                        assistant.text += " " + UNRESOLVED_CLOSING
                        save_result(session, call, Outcome.UNRESOLVED, reason="turn_limit")
                    full_call = call_response(session, call)
                    response = TurnResponse(
                        customer_turn=turn_response(customer_turn),
                        assistant_turn=turn_response(assistant),
                        status=call.status,
                        conversation_state=call.conversation_state,
                        result=full_call.result,
                    )
                    customer_turn.response_json = response.model_dump(mode="json")
                    return response
        except AppError as exc:
            async with self.lock:
                with self.sessions.begin() as session:
                    expire_calls(session)
                    call = require_call(session, call_id)
                    if call.status == CallStatus.ACTIVE:
                        call.error_code = exc.code
            raise
        finally:
            self.processing.discard(call_id)
