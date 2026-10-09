"""Map storage JSON columns to the typed API contract."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.config import Settings
from backend.models import Call, CallResult, CallTurn, Customer, Recommendation, TelecomPackage
from backend.schemas import (
    CallLimits,
    CallResponse,
    CallResultResponse,
    CallTurnResponse,
    OfferSnapshot,
    PackageResponse,
    RecommendationResponse,
    ScoreBreakdown,
    VerifiedFAQ,
)


def package_response(package: TelecomPackage) -> PackageResponse:
    return PackageResponse(
        id=package.id,
        name=package.name,
        monthly_price_minor=package.monthly_price_minor,
        currency=package.currency,
        data_gb=package.data_gb,
        call_minutes=package.call_minutes,
        extra_gb_price_minor=package.extra_gb_price_minor,
        extra_minute_price_minor=package.extra_minute_price_minor,
        verified_faq=VerifiedFAQ.model_validate(package.verified_faq_json),
        active=package.active,
        version=package.version,
    )


def recommendation_response(
    recommendation: Recommendation,
    customer: Customer,
    current_package: TelecomPackage,
    proposed_package: TelecomPackage,
    call: Call | None = None,
) -> RecommendationResponse:
    return RecommendationResponse(
        id=recommendation.id,
        customer_id=customer.id,
        customer_name=customer.name,
        current_package=package_response(current_package),
        proposed_package=package_response(proposed_package),
        score=recommendation.score,
        score_breakdown=ScoreBreakdown.model_validate(recommendation.score_breakdown_json),
        average_bill_minor=recommendation.average_bill_minor,
        estimated_savings_minor=recommendation.estimated_savings_minor,
        reason=recommendation.reason,
        status=recommendation.status,
        approved_at=recommendation.approved_at,
        approved_by=recommendation.approved_by,
        algorithm_version=recommendation.algorithm_version,
        call_id=call.id if call else None,
        call_status=call.status if call else None,
    )


def call_response(session: Session, call: Call, settings: Settings | None = None) -> CallResponse:
    turns = session.scalars(
        select(CallTurn).where(CallTurn.call_id == call.id).order_by(CallTurn.sequence)
    ).all()
    result = session.scalar(select(CallResult).where(CallResult.call_id == call.id))
    return CallResponse(
        call_id=call.id,
        customer_id=call.customer_id,
        recommendation_id=call.recommendation_id,
        status=call.status,
        conversation_state=call.conversation_state,
        offer_snapshot=OfferSnapshot.model_validate(call.offer_snapshot_json),
        started_at=call.started_at,
        ended_at=call.ended_at,
        last_activity_at=call.last_activity_at,
        error_code=call.error_code,
        limits=CallLimits(
            max_customer_turns=settings.call_max_customer_turns,
            session_timeout_seconds=settings.call_session_timeout_seconds,
            idle_timeout_seconds=settings.call_idle_timeout_seconds,
        )
        if settings
        else None,
        turns=[turn_response(turn) for turn in turns],
        result=CallResultResponse.model_validate(result) if result else None,
    )


def turn_response(turn: CallTurn) -> CallTurnResponse:
    return CallTurnResponse(
        id=turn.id,
        call_id=turn.call_id,
        sequence=turn.sequence,
        role=turn.role,
        text=turn.text,
        intent=turn.intent,
        fact_keys=turn.fact_keys_json,
        interrupted=turn.interrupted,
        created_at=turn.created_at,
        client_turn_id=turn.client_turn_id,
    )
