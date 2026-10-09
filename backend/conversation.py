"""Authoritative state transitions and replies rendered exclusively from verified facts."""

import re
from dataclasses import dataclass
from decimal import Decimal

from backend.enums import ConversationState, FactKey, Intent, Objection, Outcome
from backend.errors import AppError
from backend.schemas import ConversationDecision, OfferSnapshot

INTRODUCTION = (
    "Hi, I'm an AI telecom advisor, and this is a simulated call. "
    "Is now a good time to talk about a package that could suit your usage?"
)
UNVERIFIED = (
    "I don't have verified information about that. "
    "Would you like me to note a request for an employee to help?"
)
UNRESOLVED_CLOSING = (
    "We'll stop here for now. Your package is unchanged, and no decision has been confirmed."
)
FOLLOW_UP_QUESTION = "No problem, would you like me to note a request for an employee to follow up?"

# Only these reviewed FAQ sentences are paraphrased; other snapshot wording stays verbatim.
FRIENDLY_FAQ = {
    "The listed monthly price includes fictional taxes.": (
        "Taxes are included in the monthly price for this demo."
    ),
    "There is no minimum contract.": "There's no minimum contract.",
    (
        "Activation requires employee processing. "
        "This demo records interest and never changes a package or bill."
    ): (
        "This demo only records your interest and won't change your package or bill; "
        "an employee would need to handle any package change."
    ),
    "Roaming is excluded.": "Roaming isn't included.",
    "Unused data and minutes do not roll over.": (
        "Unused data and minutes don't carry over to the next month."
    ),
}


@dataclass(frozen=True)
class Reply:
    text: str
    state: ConversationState
    fact_keys: tuple[FactKey, ...] = ()
    outcome: Outcome | None = None
    follow_up_note: str | None = None


def money(minor: int, currency: str = "AZN") -> str:
    amount = Decimal(minor) / 100
    number = f"{amount:.2f}".rstrip("0").rstrip(".")
    unit = ("manat" if amount == 1 else "manats") if currency == "AZN" else currency
    return f"{number} {unit}"


def offer_description(offer: OfferSnapshot) -> str:
    package = offer.proposed_package
    return (
        f"{package.name}, with {package.data_gb:g} gigabytes of data and "
        f"{package.call_minutes} call minutes for "
        f"{money(package.monthly_price_minor, package.currency)} a month"
    )


def confirmation(offer: OfferSnapshot) -> str:
    return (
        f"Just to confirm, the offer is {offer_description(offer)}. "
        "Would you like me to record your interest for an employee to review?"
    )


def fact_text(key: FactKey, offer: OfferSnapshot) -> str:
    package = offer.proposed_package
    evidence = offer.evidence
    match key:
        case FactKey.PRICE:
            return f"{package.name} costs {money(package.monthly_price_minor)} a month."
        case FactKey.DATA_ALLOWANCE:
            return f"You get {package.data_gb:g} gigabytes of data each month."
        case FactKey.CALL_ALLOWANCE:
            return f"You get {package.call_minutes} call minutes a month."
        case FactKey.DATA_OVERAGE:
            return (
                f"If you go over the allowance, extra data costs "
                f"{money(package.extra_gb_price_minor)} per gigabyte."
            )
        case FactKey.CALL_OVERAGE:
            return (
                f"Extra calls cost {money(package.extra_minute_price_minor)} a minute "
                "once you've used your allowance."
            )
        case FactKey.ESTIMATED_SAVINGS:
            return (
                f"Based on your recent bills, you could save about "
                f"{money(evidence.estimated_savings_minor)} a month, depending on future usage."
            )
        case FactKey.OBSERVED_USAGE:
            return (
                f"Over the last three full months, your highest usage was "
                f"{evidence.peak_data_gb:g} gigabytes of data and "
                f"{evidence.peak_call_minutes} call minutes."
            )
        case _:
            # FAQ values come from the snapshot, never the customer's text or AI output.
            verified = getattr(package.verified_faq, key.value)
            return FRIENDLY_FAQ.get(verified, verified)


def validate_decision(decision: ConversationDecision, transcript: str) -> None:
    quote = decision.evidence_quote
    if quote is not None and (not quote.strip() or quote not in transcript):
        raise AppError("invalid_ai_evidence", "AI evidence did not match the message. Retry.", 502)
    if (
        decision.intent
        in {
            Intent.CONSENT,
            Intent.ACCEPT_INTEREST,
            Intent.CONFIRM_ACCEPT,
            Intent.REJECT,
            Intent.FOLLOW_UP,
            Intent.HUMAN_REQUEST,
        }
        and quote is None
    ):
        raise AppError("missing_ai_evidence", "AI decision lacked customer evidence. Retry.", 502)
    note = decision.follow_up_note
    if note is not None and (not note.strip() or note not in transcript):
        raise AppError(
            "invalid_ai_evidence", "Follow-up wording did not match the message. Retry.", 502
        )


def render_reply(
    state: ConversationState, offer: OfferSnapshot, decision: ConversationDecision, transcript: str
) -> Reply:
    if state == ConversationState.CLOSED:
        raise AppError("call_closed", "This conversation is already closed.", 409)
    validate_decision(decision, transcript)
    intent = decision.intent
    # Question wording must never confirm interest. Consent only permits an explanation;
    # phrases like "tell me what you recommend" must not override valid consent.
    question = "?" in transcript or re.search(
        r"\b(?:what|how|why|when|where|which)\b|\b(?:does|can|could|will|is)\s+(?:it|this|that|the|you|i)\b",
        transcript,
        re.IGNORECASE,
    )
    if intent in {Intent.ACCEPT_INTEREST, Intent.CONFIRM_ACCEPT} and question:
        intent = Intent.PACKAGE_QUESTION

    if intent == Intent.REJECT:
        return Reply(
            "No problem, I've noted that you'd like to decline. Your package hasn't changed.",
            ConversationState.CLOSED,
            outcome=Outcome.REJECTED,
        )
    if intent == Intent.HUMAN_REQUEST:
        return Reply(
            "Of course, I've noted your request for an employee to contact you. "
            "Your package hasn't changed.",
            ConversationState.CLOSED,
            outcome=Outcome.HUMAN_REQUESTED,
        )
    if intent == Intent.FOLLOW_UP:
        return Reply(
            "No problem, I've noted your request for an employee to follow up. "
            "A time hasn't been booked yet.",
            ConversationState.CLOSED,
            outcome=Outcome.FOLLOW_UP_REQUESTED,
            follow_up_note=decision.follow_up_note,
        )

    if state == ConversationState.AWAITING_CONSENT:
        if intent == Intent.CONSENT:
            evidence = offer.evidence
            return Reply(
                f"Sure, I'd suggest {offer_description(offer)}. "
                f"Based on your recent bills, you could save about "
                f"{money(evidence.estimated_savings_minor)} a month, depending on future usage; "
                "what would you like to know?",
                ConversationState.OFFER_DISCUSSION,
                (
                    FactKey.PRICE,
                    FactKey.DATA_ALLOWANCE,
                    FactKey.CALL_ALLOWANCE,
                    FactKey.OBSERVED_USAGE,
                    FactKey.ESTIMATED_SAVINGS,
                ),
            )
        text = "Is it okay if I briefly explain the offer?"
        if decision.objection == Objection.BUSY:
            text = FOLLOW_UP_QUESTION
        return Reply(text, state)

    # Answering another question interrupts confirmation. New interest must be confirmed again.
    discussion_state = ConversationState.OFFER_DISCUSSION
    if intent == Intent.PACKAGE_QUESTION:
        keys = tuple(dict.fromkeys(decision.requested_fact_keys))
        if not keys:
            return Reply(UNVERIFIED, discussion_state)
        # At most two facts per reply keeps the call concise. Remaining questions can be repeated.
        keys = keys[:2]
        return Reply(" ".join(fact_text(key, offer) for key in keys), discussion_state, keys)
    if intent == Intent.PRICE_OBJECTION:
        return Reply(
            f"I understand. {offer.proposed_package.name} is "
            f"{money(offer.proposed_package.monthly_price_minor)} a month, compared with your "
            f"recent average bill of {money(offer.evidence.average_bill_minor)}; "
            f"the estimated saving is {money(offer.evidence.estimated_savings_minor)} "
            "a month, depending on future usage.",
            discussion_state,
            (FactKey.PRICE, FactKey.ESTIMATED_SAVINGS),
        )
    if intent == Intent.NEED_OBJECTION:
        return Reply(
            "That's fair, you're welcome to keep your current package. "
            "This offer covers the usage that went over your current limits in "
            f"{offer.evidence.months_exceeding_allowance} of the last three months.",
            discussion_state,
            (FactKey.OBSERVED_USAGE, FactKey.DATA_ALLOWANCE, FactKey.CALL_ALLOWANCE),
        )
    if intent == Intent.ACCEPT_INTEREST:
        return Reply(
            confirmation(offer),
            ConversationState.AWAITING_ACCEPT_CONFIRMATION,
            (FactKey.PRICE, FactKey.DATA_ALLOWANCE, FactKey.CALL_ALLOWANCE, FactKey.ACTIVATION),
        )
    if intent == Intent.CONFIRM_ACCEPT and state == ConversationState.AWAITING_ACCEPT_CONFIRMATION:
        return Reply(
            "Thanks, I've noted your interest for an employee to review. "
            "Your package and bill haven't changed.",
            ConversationState.CLOSED,
            (FactKey.ACTIVATION,),
            Outcome.ACCEPTED,
        )
    if decision.objection == Objection.BUSY:
        return Reply(FOLLOW_UP_QUESTION, discussion_state)
    if state == ConversationState.AWAITING_ACCEPT_CONFIRMATION:
        return Reply(
            confirmation(offer),
            state,
            (FactKey.PRICE, FactKey.DATA_ALLOWANCE, FactKey.CALL_ALLOWANCE, FactKey.ACTIVATION),
        )
    if intent == Intent.UNCLEAR and re.fullmatch(
        r"(?:thanks(?: a lot)?|thank you(?: very much)?)[.!]?", transcript.strip(), re.IGNORECASE
    ):
        return Reply(
            "You're welcome. Is there anything else you'd like to know about the offer?", state
        )
    return Reply(
        "What would help you decide: the price, what's included, "
        "or a conversation with an employee?",
        state,
    )


def result_summary(
    outcome: Outcome, offer: OfferSnapshot, intents: set[Intent], reason: str | None = None
) -> tuple[str, str]:
    package = offer.proposed_package.name
    summaries = {
        Outcome.ACCEPTED: (
            f"Customer explicitly confirmed interest in {package} for employee processing."
        ),
        Outcome.REJECTED: f"Customer declined the {package} offer.",
        Outcome.FOLLOW_UP_REQUESTED: (
            f"Customer requested follow-up about {package}; no appointment was scheduled."
        ),
        Outcome.HUMAN_REQUESTED: (
            f"Customer requested employee assistance about {package}; no live transfer occurred."
        ),
        Outcome.UNRESOLVED: f"Conversation about {package} ended without a confirmed decision.",
    }
    actions = {
        Outcome.ACCEPTED: (
            "Employee should review confirmed interest and process the package request."
        ),
        Outcome.REJECTED: "No package change; respect the customer's decision.",
        Outcome.FOLLOW_UP_REQUESTED: (
            "Employee should review the follow-up note and contact customer."
        ),
        Outcome.HUMAN_REQUESTED: "Employee should contact customer.",
        Outcome.UNRESOLVED: "Employee should review the transcript before further contact.",
    }
    summary = summaries[outcome]
    objections = [
        label
        for intent, label in ((Intent.PRICE_OBJECTION, "price"), (Intent.NEED_OBJECTION, "need"))
        if intent in intents
    ]
    if objections:
        summary += " Objections discussed: " + ", ".join(objections) + "."
    if reason:
        summary += f" End reason: {reason}."
    return summary + " Package and billing remain unchanged.", actions[outcome]
