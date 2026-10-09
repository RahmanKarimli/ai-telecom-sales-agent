"""Recommendation lists and customer profiles without per-row catalog queries."""

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from backend.database import utc_now
from backend.errors import AppError
from backend.models import Call, Customer, Recommendation, TelecomPackage, UsageData
from backend.recommendations import evaluate_customer
from backend.schemas import CustomerResponse, RecommendationListResponse, UsageResponse
from backend.seed import completed_months
from backend.serialization import call_response, package_response, recommendation_response


def list_recommendations(session: Session, search: str | None = None) -> RecommendationListResponse:
    current = aliased(TelecomPackage)
    proposed = aliased(TelecomPackage)
    rows = session.execute(
        select(Recommendation, Customer, current, proposed, Call)
        .join(Customer, Recommendation.customer_id == Customer.id)
        .join(current, Customer.current_package_id == current.id)
        .join(proposed, Recommendation.package_id == proposed.id)
        .outerjoin(Call, Call.recommendation_id == Recommendation.id)
        .order_by(
            Recommendation.score.desc(),
            Recommendation.estimated_savings_minor.desc(),
            Customer.id,
        )
    ).all()
    # A twenty-customer demo can filter in Python for Unicode-aware, literal substring search.
    query = search.strip().casefold() if search else ""
    items = [
        recommendation_response(recommendation, customer, current_package, proposed_package, call)
        for recommendation, customer, current_package, proposed_package, call in rows
        if query in customer.name.casefold()
    ]
    return RecommendationListResponse(items=items, total=len(items))


def customer_profile(session: Session, customer_id: int) -> CustomerResponse:
    customer = session.get(Customer, customer_id)
    if customer is None:
        raise AppError("customer_not_found", "Customer not found.", 404)
    current = session.get(TelecomPackage, customer.current_package_id)
    if current is None:
        raise AppError("invalid_customer_data", "Customer package is missing.", 409)
    try:
        current_data = package_response(current)
    except ValidationError as exc:
        raise AppError("invalid_customer_data", "Current package facts are invalid.", 409) from exc
    usage = list(
        session.scalars(
            select(UsageData).where(UsageData.customer_id == customer.id).order_by(UsageData.month)
        ).all()
    )
    recommendation = session.scalar(
        select(Recommendation).where(Recommendation.customer_id == customer.id)
    )
    previous = session.scalar(
        select(Call)
        .where(Call.customer_id == customer.id)
        .order_by(Call.started_at.desc(), Call.id.desc())
        .limit(1)
    )
    recommendation_data = None
    diagnostic = None
    if recommendation is not None:
        proposed = session.get(TelecomPackage, recommendation.package_id)
        if proposed is None:
            raise AppError("invalid_recommendation_data", "Proposed package is missing.", 409)
        recommended_call = session.scalar(
            select(Call).where(Call.recommendation_id == recommendation.id)
        )
        recommendation_data = recommendation_response(
            recommendation, customer, current, proposed, recommended_call
        )
    else:
        diagnostic = evaluate_customer(
            customer,
            current,
            usage,
            list(session.scalars(select(TelecomPackage)).all()),
            utc_now().date(),
        ).diagnostic
    months = completed_months(utc_now().date())
    usage_data = []
    for row in usage:
        if row.month not in months:
            continue
        try:
            usage_data.append(UsageResponse.model_validate(row))
        except ValidationError:
            # The exclusion diagnostic identifies malformed history; do not return invalid values.
            continue
    return CustomerResponse(
        id=customer.id,
        name=customer.name,
        current_package=current_data,
        contact_allowed=customer.contact_allowed,
        do_not_contact=customer.do_not_contact,
        created_at=customer.created_at,
        usage=usage_data,
        recommendation=recommendation_data,
        recommendation_diagnostic=diagnostic,
        previous_call=call_response(session, previous) if previous else None,
    )
