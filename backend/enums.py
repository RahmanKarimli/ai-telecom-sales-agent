from enum import StrEnum


class RecommendationStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    CONTACTED = "contacted"


class CallStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    UNRESOLVED = "unresolved"


class ConversationState(StrEnum):
    AWAITING_CONSENT = "awaiting_consent"
    OFFER_DISCUSSION = "offer_discussion"
    AWAITING_ACCEPT_CONFIRMATION = "awaiting_accept_confirmation"
    CLOSED = "closed"


class Outcome(StrEnum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    FOLLOW_UP_REQUESTED = "follow_up_requested"
    HUMAN_REQUESTED = "human_requested"
    UNRESOLVED = "unresolved"


class TurnRole(StrEnum):
    CUSTOMER = "customer"
    ASSISTANT = "assistant"


class Intent(StrEnum):
    CONSENT = "consent"
    PACKAGE_QUESTION = "package_question"
    PRICE_OBJECTION = "price_objection"
    NEED_OBJECTION = "need_objection"
    ACCEPT_INTEREST = "accept_interest"
    CONFIRM_ACCEPT = "confirm_accept"
    REJECT = "reject"
    FOLLOW_UP = "follow_up"
    HUMAN_REQUEST = "human_request"
    UNCLEAR = "unclear"


class FactKey(StrEnum):
    PRICE = "price"
    DATA_ALLOWANCE = "data_allowance"
    CALL_ALLOWANCE = "call_allowance"
    DATA_OVERAGE = "data_overage"
    CALL_OVERAGE = "call_overage"
    TAXES = "taxes"
    CONTRACT = "contract"
    ACTIVATION = "activation"
    ROAMING = "roaming"
    ROLLOVER = "rollover"
    ESTIMATED_SAVINGS = "estimated_savings"
    OBSERVED_USAGE = "observed_usage"


class Objection(StrEnum):
    NONE = "none"
    PRICE = "price"
    NEED = "need"
    BUSY = "busy"
