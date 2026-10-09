"""Deterministic eligibility, offer selection, scoring, and evidence generation."""

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import utc_now
from backend.enums import RecommendationStatus
from backend.models import Call, Customer, Recommendation, TelecomPackage, UsageData
from backend.schemas import (
    RecommendationDiagnostic,
    RecommendationEvidence,
    ScoreBreakdown,
    UsageResponse,
)
from backend.seed import completed_months, overage_minor
from backend.serialization import package_response

ALGORITHM_VERSION = "rules-v1"
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Evaluation:
    diagnostic: RecommendationDiagnostic
    values: dict | None = None


def evaluate_customer(
    customer: Customer,
    current_package: TelecomPackage | None,
    usage: list[UsageData],
    packages: list[TelecomPackage],
    as_of: date,
) -> Evaluation:
    months = completed_months(as_of)

    def decision(code: str, message: str, values: dict | None = None) -> Evaluation:
        return Evaluation(
            RecommendationDiagnostic(code=code, message=message, evaluated_months=months), values
        )

    if customer.do_not_contact:
        return decision("do_not_contact", "Customer is marked do-not-contact.")
    if not customer.contact_allowed:
        return decision("contact_not_allowed", "Customer has not permitted contact.")
    if current_package is None or not current_package.active:
        return decision("invalid_current_package", "Current package is missing or inactive.")
    try:
        current = package_response(current_package)
    except ValidationError:
        return decision(
            "invalid_current_package", "Current package facts are invalid or incomplete."
        )

    recent = sorted(
        (row for row in usage if months[0] <= row.month < as_of.replace(day=1)),
        key=lambda row: row.month,
    )
    if [row.month for row in recent] != months:
        return decision(
            "missing_usage", "Exactly three consecutive completed usage months are required."
        )
    try:
        history = [UsageResponse.model_validate(row) for row in recent]
    except ValidationError:
        return decision("invalid_usage", "Usage contains invalid or nonfinite values.")
    if any(
        row.extra_charges_minor != overage_minor(current_package, row.data_gb, row.call_minutes)
        for row in recent
    ):
        return decision(
            "inconsistent_charges", "Extra charges do not match the verified overage rates."
        )

    data_months = sum(row.data_gb > current.data_gb for row in recent)
    minute_months = sum(row.call_minutes > current.call_minutes for row in recent)
    exceeded = sum(
        row.data_gb > current.data_gb or row.call_minutes > current.call_minutes for row in recent
    )
    if exceeded < 2:
        return decision(
            "no_recurring_overuse", "Current allowances were exceeded in fewer than two months."
        )

    peak_data = max(row.data_gb for row in recent)
    peak_minutes = max(row.call_minutes for row in recent)
    covering = []
    for package in packages:
        if package.id == current.id or not package.active:
            continue
        try:
            candidate = package_response(package)
        except ValidationError:
            continue
        if candidate.data_gb >= peak_data and candidate.call_minutes >= peak_minutes:
            covering.append(candidate)
    if not covering:
        return decision(
            "no_covering_package", "No active alternative covers both observed usage peaks."
        )

    # Compare the exact mean against the 200-minor-unit threshold before rounding display money.
    average_bill = Decimal(current.monthly_price_minor) + sum(
        Decimal(row.extra_charges_minor) for row in recent
    ) / Decimal(3)
    eligible = [item for item in covering if average_bill - item.monthly_price_minor >= 200]
    if not eligible:
        return decision(
            "insufficient_savings", "Covering alternatives save less than 2 AZN per month."
        )
    proposed = min(
        eligible,
        key=lambda item: (item.monthly_price_minor, item.data_gb, item.call_minutes, item.id),
    )
    savings = average_bill - proposed.monthly_price_minor
    savings_component = Decimal(45) * min(Decimal(1), savings / average_bill / Decimal("0.25"))
    recurrence_component = Decimal(30) * Decimal(exceeded) / Decimal(3)
    fit_component = Decimal(25) * max(
        Decimal(str(peak_data)) / Decimal(str(proposed.data_gb)),
        Decimal(peak_minutes) / Decimal(proposed.call_minutes),
    )
    breakdown = ScoreBreakdown(
        savings_component=float(savings_component),
        recurrence_component=float(recurrence_component),
        fit_component=float(fit_component),
    )
    score = int(
        (savings_component + recurrence_component + fit_component).quantize(
            Decimal(1), rounding=ROUND_HALF_UP
        )
    )
    bill_minor = int(average_bill.quantize(Decimal(1), rounding=ROUND_HALF_UP))
    savings_minor = bill_minor - proposed.monthly_price_minor

    observations = []
    for label, allowance, count in (
        ("data usage", f"{current.data_gb:g} GB", data_months),
        ("call usage", f"{current.call_minutes} minute", minute_months),
    ):
        if count:
            frequency = "all three months" if count == 3 else f"{count} of three months"
            observations.append(f"Your {label} exceeded your {allowance} allowance in {frequency}.")
    reason = " ".join(observations) + (
        f" {proposed.name} covers your observed usage up to {peak_data:g} GB and "
        f"{peak_minutes} minutes with {proposed.data_gb:g} GB and {proposed.call_minutes} minutes. "
        f"It could reduce your historical average monthly bill from "
        f"{Decimal(bill_minor) / 100:.2f} to "
        f"{Decimal(proposed.monthly_price_minor) / 100:.2f} AZN. "
        "Future savings depend on usage."
    )
    evidence = RecommendationEvidence(
        usage=history,
        current_package=current,
        peak_data_gb=peak_data,
        peak_call_minutes=peak_minutes,
        months_exceeding_allowance=exceeded,
        average_bill_minor=bill_minor,
        estimated_savings_minor=savings_minor,
    )
    return decision(
        "eligible",
        "An active offer covers all observed usage and saves at least 2 AZN per month.",
        {
            "package_id": proposed.id,
            "score": score,
            "score_breakdown_json": breakdown.model_dump(mode="json"),
            "average_bill_minor": bill_minor,
            "estimated_savings_minor": savings_minor,
            "reason": reason,
            "evidence_snapshot_json": evidence.model_dump(mode="json"),
            "algorithm_version": ALGORITHM_VERSION,
        },
    )


def generate_recommendations(session: Session, as_of: date | None = None) -> None:
    """Refresh pending recommendations at startup; never alter approved or contacted offers."""
    reference_date = as_of or utc_now().date()
    customers = session.scalars(select(Customer).order_by(Customer.id)).all()
    packages = list(session.scalars(select(TelecomPackage)).all())
    catalog = {package.id: package for package in packages}
    usage_by_customer = defaultdict(list)
    for row in session.scalars(select(UsageData)).all():
        usage_by_customer[row.customer_id].append(row)
    existing = {row.customer_id: row for row in session.scalars(select(Recommendation)).all()}
    called_recommendations = set(session.scalars(select(Call.recommendation_id)).all())
    for customer in customers:
        recommendation = existing.get(customer.id)
        if recommendation is not None and (
            recommendation.status != RecommendationStatus.PENDING
            or recommendation.id in called_recommendations
        ):
            continue
        evaluation = evaluate_customer(
            customer,
            catalog.get(customer.current_package_id),
            usage_by_customer[customer.id],
            packages,
            reference_date,
        )
        if evaluation.values is None:
            logger.info("Customer %s: %s", customer.id, evaluation.diagnostic.code)
            if recommendation is not None:
                session.delete(recommendation)
            continue
        if recommendation is None:
            session.add(Recommendation(customer_id=customer.id, **evaluation.values))
        else:
            for key, value in evaluation.values.items():
                setattr(recommendation, key, value)
    session.flush()
