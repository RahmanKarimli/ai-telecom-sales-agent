export type RecommendationStatus = 'pending' | 'approved' | 'contacted';
export type ConversationState = 'awaiting_consent' | 'offer_discussion' | 'awaiting_accept_confirmation' | 'closed';
export type CallStatus = 'active' | 'completed' | 'unresolved';
export type CallOutcome = 'accepted' | 'rejected' | 'follow_up_requested' | 'human_requested' | 'unresolved';
export type Intent = 'consent' | 'package_question' | 'price_objection' | 'need_objection' | 'accept_interest' | 'confirm_accept' | 'reject' | 'follow_up' | 'human_request' | 'unclear';
export type Package = {
  id: number; name: string; monthly_price_minor: number; currency: 'AZN';
  data_gb: number; call_minutes: number; extra_gb_price_minor: number;
  extra_minute_price_minor: number; active: boolean;
  verified_faq?: { taxes: string; contract: string; activation: string; roaming: string; rollover: string };
};
export type UsageData = {
  id?: number; customer_id?: number; month: string; data_gb: number;
  call_minutes: number; extra_charges_minor: number;
};
export type Customer = {
  id: number; name: string; initials?: string; email?: string;
  current_package_id: number; contact_allowed: boolean; do_not_contact: boolean;
  segment?: string;
};
export type Recommendation = {
  id: number; customer_id: number; package_id: number; score: number;
  average_bill_minor: number; estimated_savings_minor: number;
  reason: string; status: RecommendationStatus;
  score_breakdown: { savings: number; recurrence: number; fit: number };
};
export type RecommendationRow = {
  id: number; customer_id: number; customer_name: string; current_package: string;
  proposed_package: string; score: number; estimated_savings_minor: number;
  status: RecommendationStatus; call_outcome?: CallOutcome;
};
export type CustomerDetail = {
  customer: Customer; current_package: Package; proposed_package: Package | null;
  usage: UsageData[]; recommendation: Recommendation | null; latest_call?: CallSession;
  recommendation_diagnostic?: { code: string; message: string } | null;
};
export type CallTurn = {
  id: number; call_id: number; sequence: number; role: 'customer' | 'assistant';
  text: string; intent?: Intent | null; fact_keys: string[]; client_turn_id?: string | null;
  interrupted: boolean; created_at: string;
};
export type CallResult = {
  call_id: number; outcome: CallOutcome; summary: string;
  next_action: string; follow_up_note?: string | null; created_at: string;
  package_approved_at?: string | null; package_approved_by?: string | null;
};
export type CallSession = {
  id: number; customer_id: number; recommendation_id: number;
  status: CallStatus; conversation_state: ConversationState;
  started_at: string; ended_at?: string | null; turns: CallTurn[];
  last_activity_at?: string; error_code?: string | null;
  limits?: { max_customer_turns: number; session_timeout_seconds: number; idle_timeout_seconds: number } | null;
  offer_snapshot?: { proposed_package: Package; evidence: { estimated_savings_minor: number } };
  result?: CallResult;
};
export type StartCallResponse = {
  call_id: number; status: CallStatus; conversation_state: ConversationState;
  introduction_turn: CallTurn;
};
export type TurnResponse = {
  customer_turn: CallTurn; assistant_turn?: CallTurn;
  status: CallStatus; conversation_state: ConversationState; result?: CallResult;
};
export type DashboardMetrics = {
  recommended_customers: number; potential_monthly_savings_minor: number;
  calls_started: number; calls_completed: number; accepted_offers: number;
  rejected_offers: number; follow_up_requests: number; human_requests: number;
  estimated_savings_on_accepted_minor: number;
  estimated_staff_time_saved_minutes: number;
};
