from datetime import date, datetime
from enum import Enum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base, UTCDateTime, utc_now
from backend.enums import (
    CallStatus,
    ConversationState,
    Intent,
    Outcome,
    RecommendationStatus,
    TurnRole,
)


def enum_column(enum: type[Enum]) -> SAEnum:
    return SAEnum(
        enum,
        values_callable=lambda members: [member.value for member in members],
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
    )


class TelecomPackage(Base):
    __tablename__ = "telecom_packages"
    __table_args__ = (
        CheckConstraint("monthly_price_minor >= 0"),
        CheckConstraint("data_gb > 0 AND call_minutes > 0"),
        CheckConstraint("extra_gb_price_minor >= 0 AND extra_minute_price_minor >= 0"),
        CheckConstraint("version >= 1"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    monthly_price_minor: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="AZN")
    data_gb: Mapped[float] = mapped_column(Float)
    call_minutes: Mapped[int] = mapped_column(Integer)
    extra_gb_price_minor: Mapped[int] = mapped_column(Integer)
    extra_minute_price_minor: Mapped[int] = mapped_column(Integer)
    verified_faq_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    current_package_id: Mapped[int] = mapped_column(ForeignKey("telecom_packages.id"))
    contact_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    do_not_contact: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)


class UsageData(Base):
    __tablename__ = "usage_data"
    __table_args__ = (
        UniqueConstraint("customer_id", "month"),
        CheckConstraint("data_gb >= 0 AND call_minutes >= 0 AND extra_charges_minor >= 0"),
        CheckConstraint("strftime('%d', month) = '01'"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    month: Mapped[date] = mapped_column(Date)
    data_gb: Mapped[float] = mapped_column(Float)
    call_minutes: Mapped[int] = mapped_column(Integer)
    extra_charges_minor: Mapped[int] = mapped_column(Integer)


class Recommendation(Base):
    __tablename__ = "recommendations"
    __table_args__ = (
        CheckConstraint("score >= 0 AND score <= 100"),
        CheckConstraint("average_bill_minor >= 0 AND estimated_savings_minor >= 0"),
        CheckConstraint(
            "status = 'pending' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), unique=True)
    package_id: Mapped[int] = mapped_column(ForeignKey("telecom_packages.id"))
    score: Mapped[int] = mapped_column(Integer, index=True)
    score_breakdown_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    average_bill_minor: Mapped[int] = mapped_column(Integer)
    estimated_savings_minor: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[RecommendationStatus] = mapped_column(
        enum_column(RecommendationStatus), default=RecommendationStatus.PENDING
    )
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    approved_by: Mapped[str | None] = mapped_column(String(100))
    evidence_snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    algorithm_version: Mapped[str] = mapped_column(String(50))


class Call(Base):
    __tablename__ = "calls"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    recommendation_id: Mapped[int] = mapped_column(ForeignKey("recommendations.id"), unique=True)
    status: Mapped[CallStatus] = mapped_column(enum_column(CallStatus), default=CallStatus.ACTIVE)
    conversation_state: Mapped[ConversationState] = mapped_column(
        enum_column(ConversationState), default=ConversationState.AWAITING_CONSENT
    )
    offer_snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    last_activity_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    error_code: Mapped[str | None] = mapped_column(String(100))
    start_request_id: Mapped[str] = mapped_column(String(100), unique=True)


class CallTurn(Base):
    __tablename__ = "call_turns"
    __table_args__ = (
        UniqueConstraint("call_id", "sequence"),
        UniqueConstraint("call_id", "client_turn_id"),
        CheckConstraint("sequence >= 1"),
        CheckConstraint("role = 'customer' OR client_turn_id IS NULL"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    call_id: Mapped[int] = mapped_column(ForeignKey("calls.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    role: Mapped[TurnRole] = mapped_column(enum_column(TurnRole))
    text: Mapped[str] = mapped_column(Text)
    intent: Mapped[Intent | None] = mapped_column(enum_column(Intent))
    fact_keys_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    interrupted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    client_turn_id: Mapped[str | None] = mapped_column(String(100))
    # Customer turns retain their completed HTTP response for exact idempotent retries.
    response_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    input_audio_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)


class CallResult(Base):
    __tablename__ = "call_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    call_id: Mapped[int] = mapped_column(ForeignKey("calls.id"), unique=True)
    outcome: Mapped[Outcome] = mapped_column(enum_column(Outcome))
    summary: Mapped[str] = mapped_column(Text)
    next_action: Mapped[str] = mapped_column(Text)
    follow_up_note: Mapped[str | None] = mapped_column(Text)
    evidence_turn_id: Mapped[int | None] = mapped_column(ForeignKey("call_turns.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    package_approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    package_approved_by: Mapped[str | None] = mapped_column(String(100))
