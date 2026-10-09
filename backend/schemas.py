from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.enums import (
    CallStatus,
    ConversationState,
    FactKey,
    Intent,
    Objection,
    Outcome,
    RecommendationStatus,
    TurnRole,
)

PositiveID = Annotated[int, Field(gt=0)]
MinorUnits = Annotated[int, Field(ge=0)]
RequestID = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True, allow_inf_nan=False)


class ErrorDetail(Contract):
    code: str
    message: str


class ErrorResponse(Contract):
    detail: ErrorDetail


class HealthResponse(Contract):
    status: Literal["ok"] = "ok"
    phase: Literal[5] = 5
    version: str = "0.5.0"
    ai_configured: bool
    resettable_demo_data: Literal[True] = True


class VerifiedFAQ(Contract):
    taxes: str
    contract: str
    activation: str
    roaming: str
    rollover: str


class PackageResponse(Contract):
    id: PositiveID
    name: str
    monthly_price_minor: MinorUnits
    currency: Literal["AZN"] = "AZN"
    data_gb: Annotated[float, Field(gt=0)]
    call_minutes: PositiveID
    extra_gb_price_minor: MinorUnits
    extra_minute_price_minor: MinorUnits
    verified_faq: VerifiedFAQ
    active: bool
    version: PositiveID


class UsageResponse(Contract):
    month: date
    data_gb: Annotated[float, Field(ge=0)]
    call_minutes: Annotated[int, Field(ge=0)]
    extra_charges_minor: MinorUnits


class ScoreBreakdown(Contract):
    savings_component: Annotated[float, Field(ge=0, le=45)]
    recurrence_component: Annotated[float, Field(ge=0, le=30)]
    fit_component: Annotated[float, Field(ge=0, le=25)]
    label: Literal["Rule-based match score"] = "Rule-based match score"


class RecommendationEvidence(Contract):
    usage: list[UsageResponse]
    current_package: PackageResponse
    peak_data_gb: Annotated[float, Field(ge=0)]
    peak_call_minutes: Annotated[int, Field(ge=0)]
    months_exceeding_allowance: Annotated[int, Field(ge=0, le=3)]
    average_bill_minor: MinorUnits
    estimated_savings_minor: MinorUnits


class RecommendationResponse(Contract):
    id: PositiveID
    customer_id: PositiveID
    customer_name: str
    current_package: PackageResponse
    proposed_package: PackageResponse
    score: Annotated[int, Field(ge=0, le=100)]
    score_breakdown: ScoreBreakdown
    average_bill_minor: MinorUnits
    estimated_savings_minor: MinorUnits
    reason: str
    status: RecommendationStatus
    approved_at: datetime | None
    approved_by: str | None
    algorithm_version: str
    call_id: PositiveID | None
    call_status: CallStatus | None


class RecommendationListResponse(Contract):
    items: list[RecommendationResponse]
    total: Annotated[int, Field(ge=0)]


class OfferSnapshot(Contract):
    proposed_package: PackageResponse
    evidence: RecommendationEvidence
    reason: str
    algorithm_version: str


class CallTurnResponse(Contract):
    id: PositiveID
    call_id: PositiveID
    sequence: PositiveID
    role: TurnRole
    text: str
    intent: Intent | None
    fact_keys: list[FactKey]
    interrupted: bool
    created_at: datetime
    client_turn_id: RequestID | None


class CallResultResponse(Contract):
    id: PositiveID
    call_id: PositiveID
    outcome: Outcome
    summary: str
    next_action: str
    follow_up_note: str | None
    evidence_turn_id: PositiveID | None
    created_at: datetime


class CallResponse(Contract):
    call_id: PositiveID
    customer_id: PositiveID
    recommendation_id: PositiveID
    status: CallStatus
    conversation_state: ConversationState
    offer_snapshot: OfferSnapshot
    started_at: datetime
    ended_at: datetime | None
    last_activity_at: datetime
    error_code: str | None
    turns: list[CallTurnResponse]
    result: CallResultResponse | None


class RecommendationDiagnostic(Contract):
    code: Literal[
        "eligible",
        "do_not_contact",
        "contact_not_allowed",
        "invalid_current_package",
        "missing_usage",
        "invalid_usage",
        "inconsistent_charges",
        "no_recurring_overuse",
        "no_covering_package",
        "insufficient_savings",
    ]
    message: str
    evaluated_months: list[date]


class CustomerResponse(Contract):
    id: PositiveID
    name: str
    current_package: PackageResponse
    contact_allowed: bool
    do_not_contact: bool
    created_at: datetime
    usage: list[UsageResponse]
    recommendation: RecommendationResponse | None
    recommendation_diagnostic: RecommendationDiagnostic | None = None
    previous_call: CallResponse | None


class ApproveRequest(Contract):
    approved_by: Annotated[str, Field(min_length=1, max_length=100)] = "demo_employee"


class StartCallRequest(Contract):
    recommendation_id: PositiveID
    start_request_id: RequestID


class StartCallResponse(Contract):
    call_id: PositiveID
    status: CallStatus
    conversation_state: ConversationState
    introduction_turn: CallTurnResponse


class TurnResponse(Contract):
    customer_turn: CallTurnResponse
    assistant_turn: CallTurnResponse
    status: CallStatus
    conversation_state: ConversationState
    result: CallResultResponse | None


class EndCallRequest(Contract):
    interrupted_assistant_turn_id: PositiveID | None = None


class OutcomeCounts(Contract):
    accepted: Annotated[int, Field(ge=0)]
    rejected: Annotated[int, Field(ge=0)]
    follow_up_requested: Annotated[int, Field(ge=0)]
    human_requested: Annotated[int, Field(ge=0)]
    unresolved: Annotated[int, Field(ge=0)]


class DashboardResponse(Contract):
    recommended_customers: Annotated[int, Field(ge=0)]
    potential_monthly_savings_minor: MinorUnits
    currency: Literal["AZN"] = "AZN"
    calls_started: Annotated[int, Field(ge=0)]
    calls_completed: Annotated[int, Field(ge=0)]
    call_completion_rate: Annotated[float, Field(ge=0, le=1)]
    accepted_offers: Annotated[int, Field(ge=0)]
    acceptance_rate: Annotated[float, Field(ge=0, le=1)]
    accepted_monthly_savings_minor: MinorUnits
    estimated_staff_minutes_saved: Annotated[int, Field(ge=0)]
    staff_time_assumption: str = "5 minutes manual handling minus 1 minute employee review"
    outcome_counts: OutcomeCounts
    top_opportunities: list[RecommendationResponse]
    resettable_demo_data: Literal[True] = True


class ConversationDecision(Contract):
    # All fields are required (nullable where appropriate) for Structured Outputs.
    intent: Intent
    requested_fact_keys: list[FactKey]
    objection: Objection
    evidence_quote: Annotated[str, Field(min_length=1, max_length=4000)] | None
    follow_up_note: Annotated[str, Field(min_length=1, max_length=4000)] | None

    @model_validator(mode="after")
    def validate_combinations(self) -> "ConversationDecision":
        if self.intent == Intent.PRICE_OBJECTION and self.objection != Objection.PRICE:
            raise ValueError("A price objection must use objection=price.")
        if self.intent == Intent.NEED_OBJECTION and self.objection != Objection.NEED:
            raise ValueError("A need objection must use objection=need.")
        if self.follow_up_note is not None and self.intent != Intent.FOLLOW_UP:
            raise ValueError("Follow-up notes are only valid for follow-up intent.")
        if self.requested_fact_keys and self.intent != Intent.PACKAGE_QUESTION:
            raise ValueError("Fact selection is only valid for a package question.")
        if self.objection == Objection.BUSY and self.intent != Intent.UNCLEAR:
            raise ValueError(
                "Busy replies use unclear intent unless explicitly requesting follow-up."
            )
        if self.objection == Objection.PRICE and self.intent != Intent.PRICE_OBJECTION:
            raise ValueError("Price objections use price_objection intent.")
        if self.objection == Objection.NEED and self.intent != Intent.NEED_OBJECTION:
            raise ValueError("Need objections use need_objection intent.")
        return self
