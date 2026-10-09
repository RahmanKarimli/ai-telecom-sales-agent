import { approveDemo, approveDemoPackageChange as approveDemoPackageChangeLocal, endDemoCall, getDemoCall, getDemoCustomer, getDemoDashboard, getDemoRecommendations, sendDemoTurn, startDemoCall } from '../data/mockApi';
import type { CallSession, CustomerDetail, DashboardMetrics, Package, Recommendation, RecommendationRow, StartCallResponse, TurnResponse, UsageData } from '../types';

// Live integration is the default; preview data requires an explicit opt-in.
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
export const TOKEN_KEY = 'orbit-demo-access';
export const getAccessToken = () => sessionStorage.getItem(TOKEN_KEY) || '';
export const setAccessToken = (token: string) => sessionStorage.setItem(TOKEN_KEY, token.trim());
export const clearAccessToken = () => sessionStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function checkedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  for (const [name, value] of Object.entries(authHeaders())) headers.set(name, value);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    try {
      const body = await response.json() as { detail?: string | { code?: string; message?: string } | { msg?: string }[] };
      if (typeof body.detail === 'string') message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map(e => e.msg).filter(Boolean).join('; ');
      else if (body.detail?.message) { message = body.detail.message; code = body.detail.code; }
    } catch { /* Keep the HTTP fallback when no JSON error is available. */ }
    throw new ApiError(message, response.status, code);
  }
  return response;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await checkedFetch(path, options)).json() as Promise<T>;
}

// Adapt the established backend contract to the supplied frontend's view models.
type ApiRecommendation = Omit<Recommendation, 'package_id' | 'score_breakdown'> & {
  customer_name: string; current_package: Package; proposed_package: Package;
  score_breakdown: { savings_component: number; recurrence_component: number; fit_component: number };
};
type ApiCall = Omit<CallSession, 'id' | 'result'> & { call_id: number; result: CallSession['result'] | null };
type ApiCustomer = {
  id: number; name: string; contact_allowed: boolean; do_not_contact: boolean;
  current_package: Package; usage: UsageData[]; recommendation: ApiRecommendation | null;
  previous_call: ApiCall | null; recommendation_diagnostic: CustomerDetail['recommendation_diagnostic'];
};
type ApiDashboard = Pick<DashboardMetrics, 'recommended_customers' | 'potential_monthly_savings_minor' | 'calls_started' | 'calls_completed' | 'accepted_offers'> & {
  accepted_monthly_savings_minor: number; estimated_staff_minutes_saved: number;
  outcome_counts: { rejected: number; follow_up_requested: number; human_requested: number };
};
const mapCall = ({ call_id, result, ...call }: ApiCall): CallSession => ({ ...call, id: call_id, result: result ?? undefined });
const mapRow = (r: ApiRecommendation): RecommendationRow => ({
  id: r.id, customer_id: r.customer_id, customer_name: r.customer_name,
  current_package: r.current_package.name, proposed_package: r.proposed_package.name,
  score: r.score, estimated_savings_minor: r.estimated_savings_minor, status: r.status,
});

export async function getDashboard(): Promise<DashboardMetrics> {
  if (isDemoMode) return getDemoDashboard();
  const d = await request<ApiDashboard>('/dashboard');
  return { ...d, rejected_offers: d.outcome_counts.rejected,
    follow_up_requests: d.outcome_counts.follow_up_requested, human_requests: d.outcome_counts.human_requested,
    estimated_savings_on_accepted_minor: d.accepted_monthly_savings_minor,
    estimated_staff_time_saved_minutes: d.estimated_staff_minutes_saved };
}
export async function getRecommendations(search = ''): Promise<RecommendationRow[]> {
  if (isDemoMode) return getDemoRecommendations(search);
  const result = await request<{ items: ApiRecommendation[]; total: number }>(`/recommendations${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  return result.items.map(mapRow);
}
export async function getCustomer(id: number): Promise<CustomerDetail> {
  if (isDemoMode) return getDemoCustomer(id);
  const c = await request<ApiCustomer>(`/customers/${id}`);
  const r = c.recommendation;
  return {
    customer: { id: c.id, name: c.name, current_package_id: c.current_package.id,
      contact_allowed: c.contact_allowed, do_not_contact: c.do_not_contact },
    current_package: c.current_package, proposed_package: r?.proposed_package ?? null, usage: c.usage,
    recommendation: r ? { ...r, package_id: r.proposed_package.id, score_breakdown: {
      savings: r.score_breakdown.savings_component, recurrence: r.score_breakdown.recurrence_component, fit: r.score_breakdown.fit_component,
    } } : null,
    recommendation_diagnostic: c.recommendation_diagnostic,
    latest_call: c.previous_call ? mapCall(c.previous_call) : undefined,
  };
}
export async function approveRecommendation(id: number): Promise<void> {
  if (isDemoMode) { approveDemo(id); return; }
  await request(`/recommendations/${id}/approve`, { method: 'POST', body: JSON.stringify({ approved_by: 'demo_employee' }) });
}
export async function startCall(recommendationId: number, startRequestId: string): Promise<StartCallResponse> {
  return isDemoMode ? startDemoCall(recommendationId) : request('/calls', { method: 'POST', body: JSON.stringify({ recommendation_id: recommendationId, start_request_id: startRequestId }) });
}
export async function getCall(id: number): Promise<CallSession> {
  return isDemoMode ? getDemoCall(id) : mapCall(await request<ApiCall>(`/calls/${id}`));
}
export type TurnContent = { text?: string; audio?: Blob; interruptedAssistantTurnId?: number };
export async function sendTurn(callId: number, clientTurnId: string, content: TurnContent): Promise<TurnResponse> {
  if (isDemoMode) {
    if (content.audio) throw new Error('Audio transcription requires the real FastAPI backend. Please use the typed-message fallback in preview mode.');
    return sendDemoTurn(callId, content.text || '', clientTurnId);
  }
  const form = new FormData();
  form.set('client_turn_id', clientTurnId);
  if (content.text !== undefined) form.set('text', content.text);
  else if (content.audio) {
    const mime = content.audio.type.split(';')[0];
    const extension = ({ 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' } as Record<string, string>)[mime || ''] || 'webm';
    form.set('audio', content.audio, `customer.${extension}`);
  }
  if (content.interruptedAssistantTurnId !== undefined) form.set('interrupted_assistant_turn_id', String(content.interruptedAssistantTurnId));
  return request(`/calls/${callId}/turns`, { method: 'POST', body: form });
}
export async function endCall(id: number, interruptedAssistantTurnId?: number): Promise<CallSession> {
  return isDemoMode ? endDemoCall(id) : mapCall(await request<ApiCall>(`/calls/${id}/end`, { method: 'POST', body: JSON.stringify({ interrupted_assistant_turn_id: interruptedAssistantTurnId ?? null }) }));
}
export async function approvePackageChange(id: number): Promise<CallSession> {
  if (isDemoMode) return approveDemoPackageChangeLocal(id);
  return mapCall(await request<ApiCall>(`/calls/${id}/approve-package-change`, {
    method: 'POST', body: JSON.stringify({ approved_by: 'demo_employee' }),
  }));
}
export async function getTurnAudio(callId: number, turnId: number): Promise<Blob> {
  if (isDemoMode) throw new Error('Generated speech requires the real backend.');
  return (await checkedFetch(`/calls/${callId}/turns/${turnId}/audio`)).blob();
}
export async function deleteCall(id: number): Promise<void> {
  if (isDemoMode) throw new Error('Deleting chats requires the development backend.');
  // DELETE returns 204 with no JSON body.
  await checkedFetch(`/calls/${id}`, { method: 'DELETE' });
}
