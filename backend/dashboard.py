"""Dashboard estimates calculated from recommendations and durable call results."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.enums import CallStatus, Outcome
from backend.models import Call, CallResult
from backend.reads import list_recommendations
from backend.schemas import DashboardResponse, OfferSnapshot, OutcomeCounts


def dashboard_metrics(session: Session) -> DashboardResponse:
    recommendations = list_recommendations(session)
    calls_started = session.scalar(select(func.count()).select_from(Call)) or 0
    counts = dict.fromkeys(Outcome, 0)
    accepted_savings = 0
    rows = session.execute(
        select(Call, CallResult.outcome).join(CallResult, CallResult.call_id == Call.id)
    ).all()
    for call, outcome in rows:
        if (outcome == Outcome.UNRESOLVED and call.status == CallStatus.UNRESOLVED) or (
            outcome != Outcome.UNRESOLVED and call.status == CallStatus.COMPLETED
        ):
            counts[outcome] += 1
            if outcome == Outcome.ACCEPTED:
                # Use the agreed offer at call creation, never a subsequently changed offer.
                accepted_savings += OfferSnapshot.model_validate(
                    call.offer_snapshot_json
                ).evidence.estimated_savings_minor
    completed = sum(counts[outcome] for outcome in Outcome if outcome != Outcome.UNRESOLVED)
    accepted = counts[Outcome.ACCEPTED]
    return DashboardResponse(
        recommended_customers=recommendations.total,
        potential_monthly_savings_minor=sum(
            item.estimated_savings_minor for item in recommendations.items
        ),
        calls_started=calls_started,
        calls_completed=completed,
        call_completion_rate=completed / calls_started if calls_started else 0,
        accepted_offers=accepted,
        acceptance_rate=accepted / completed if completed else 0,
        accepted_monthly_savings_minor=accepted_savings,
        estimated_staff_minutes_saved=4 * (accepted + counts[Outcome.REJECTED]),
        outcome_counts=OutcomeCounts(**{outcome.value: count for outcome, count in counts.items()}),
        top_opportunities=recommendations.items[:5],
    )
