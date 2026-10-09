import { customers, packages, recommendations, usages } from './seed';
import type { CallOutcome, CallResult, CallSession, CallTurn, CustomerDetail, DashboardMetrics, Recommendation, RecommendationRow, StartCallResponse, TurnResponse } from '../types';

interface Store { recs: Recommendation[]; calls: CallSession[]; nextTurn: number; nextCall: number; }
const STORAGE_KEY = 'orbit-offer-demo-v1';
const initialStore = (): Store => ({ recs:structuredClone(recommendations),calls:[],nextTurn:1,nextCall:1 });
let fallbackStore: Store = initialStore();
function load(): Store {
  try { const str = sessionStorage.getItem(STORAGE_KEY); if (str) return JSON.parse(str) as Store; }
  catch { /* storage unavailable: keep in-memory demo */ }
  return fallbackStore;
}
function save(store:Store):void {
  fallbackStore = store;
  try { sessionStorage.setItem(STORAGE_KEY,JSON.stringify(store)); }
  catch { /* in-memory demo still works */ }
}
export function resetDemo(): void { save(initialStore()); }
export function getDemoRecommendations(search = ''): RecommendationRow[] {
  const store=load();
  return store.recs.map(rec => {
    const customer=customers.find(c=>c.id===rec.customer_id)!;
    const offer=packages.find(p=>p.id===rec.package_id)!;
    const current=packages.find(p=>p.id===customer.current_package_id)!;
    return { id:rec.id,customer_id:customer.id,customer_name:customer.name,current_package:current.name,proposed_package:offer.name,score:rec.score,estimated_savings_minor:rec.estimated_savings_minor,status:rec.status,call_outcome:store.calls.find(c=>c.recommendation_id===rec.id)?.result?.outcome };
  }).filter(row=>row.customer_name.toLowerCase().includes(search.toLowerCase()));
}
export function getDemoCustomer(id:number): CustomerDetail {
  const store=load(); const customer=customers.find(c=>c.id===id);
  if(!customer) throw new Error('Customer not found');
  const rec=store.recs.find(r=>r.customer_id===id);
  if(!rec) throw new Error('There is no eligible offer for this customer');
  return { customer,current_package:packages.find(p=>p.id===customer.current_package_id)!, proposed_package:packages.find(p=>p.id===rec.package_id)!, usage:usages.filter(u=>u.customer_id===id), recommendation:rec,latest_call:store.calls.find(c=>c.recommendation_id===rec.id) };
}
export function getDemoDashboard(): DashboardMetrics {
  const store=load();
  const outcomes=store.calls.map(c=>c.result?.outcome);
  const acceptedRecs=store.calls.filter(c=>c.result?.outcome==='accepted').map(c=>store.recs.find(r=>r.id===c.recommendation_id)!).filter(Boolean);
  return {
    recommended_customers:store.recs.length,
    potential_monthly_savings_minor:store.recs.reduce((a,r)=>a+r.estimated_savings_minor,0),
    calls_started:store.calls.length,
    calls_completed:outcomes.filter(v=>v&&v!=='unresolved').length,
    accepted_offers:outcomes.filter(v=>v==='accepted').length,
    rejected_offers:outcomes.filter(v=>v==='rejected').length,
    follow_up_requests:outcomes.filter(v=>v==='follow_up_requested').length,
    human_requests:outcomes.filter(v=>v==='human_requested').length,
    estimated_savings_on_accepted_minor:acceptedRecs.reduce((a,r)=>a+r.estimated_savings_minor,0),
    estimated_staff_time_saved_minutes:outcomes.filter(v=>v==='accepted'||v==='rejected').length*4,
  };
}
export function approveDemo(recommendationId:number):void {
  const store=load();const rec=store.recs.find(r=>r.id===recommendationId);
  if(!rec) throw new Error('Recommendation not found');
  if(rec.status==='contacted')throw new Error('Call already started');
  rec.status='approved';save(store);
}
export function approveDemoPackageChange(callId:number):CallSession {
  const store=load();const call=store.calls.find(c=>c.id===callId);
  if(!call)throw new Error('Call not found');
  if(call.status==='active'||call.result?.outcome!=='accepted')throw new Error('Only confirmed customer interest can be approved');
  call.result.package_approved_at??=new Date().toISOString();
  call.result.package_approved_by??='demo_employee';
  call.result.next_action='Employee approved the customer’s package request for processing. Service activation still requires the telecom billing system.';
  save(store);return structuredClone(call);
}
function newTurn(store:Store,call:CallSession,role:'customer'|'assistant',text:string):CallTurn {
  return {id:store.nextTurn++,call_id:call.id,sequence:call.turns.length+1,role,text,created_at:new Date().toISOString(),fact_keys:[],interrupted:false};
}
export function startDemoCall(recommendationId:number):StartCallResponse {
  const store=load();const rec=store.recs.find(r=>r.id===recommendationId);
  if(!rec)throw new Error('Recommendation not found');
  if(rec.status!=='approved')throw new Error('Contact must be approved before starting the call');
  const existing=store.calls.find(c=>c.recommendation_id===recommendationId);
  if(existing)throw new Error('A call already exists for this recommendation');
  const customer=customers.find(c=>c.id===rec.customer_id)!;
  const call:CallSession={id:store.nextCall++,customer_id:customer.id,recommendation_id:rec.id,conversation_state:'awaiting_consent',status:'active',started_at:new Date().toISOString(),turns:[]};
  const introduction=newTurn(store,call,'assistant',`Hello, ${customer.name.split(' ')[0]}. I'm an AI assistant for a fictional telecom demo. Is now a good time to discuss a package that may better suit your usage?`);
  call.turns.push(introduction);rec.status='contacted';store.calls.push(call);save(store);
  return {call_id:call.id,status:call.status,conversation_state:call.conversation_state,introduction_turn:introduction};
}
export function getDemoCall(id:number):CallSession {
  const call=load().calls.find(c=>c.id===id);
  if(!call)throw new Error('Call not found');
  return structuredClone(call);
}
function finish(call:CallSession,outcome:CallOutcome,summary:string,action:string,note?:string):CallResult {
  call.conversation_state='closed';call.status=outcome==='unresolved'?'unresolved':'completed';call.ended_at=new Date().toISOString();
  const result:CallResult={call_id:call.id,outcome,summary,next_action:action,created_at:call.ended_at,...(note?{follow_up_note:note}:{})};
  call.result=result;return result;
}
function classification(text:string):'question'|'accept'|'reject'|'follow'|'human'|'price'|'need'|'busy'|'yes'|'unclear' {
  const t=text.trim().toLowerCase();
  if(/human|real person|employee|agent|operator|representative|speak to someone/.test(t))return 'human';
  if(/later|tomorrow|next week|call back|follow.up|another time/.test(t))return 'follow';
  if(/no thanks|not interested|i refuse|don't want|do not want|decline|reject/.test(t))return 'reject';
  if(/(\?|how much|what (is|about)|does it|do i get|is there|can i|could i|tell me|price|minutes|roaming|rollover|contract|activation|discount|gb\b)/.test(t))return 'question';
  if(/expensive|costly|too much/.test(t))return 'price';
  if(/don't need|do not need|enough data/.test(t))return 'need';
  if(/busy|no time/.test(t))return 'busy';
  if(/yes|sure|okay|ok\b|go ahead|sounds good|confirm|agree|i accept|interested|sign me up/.test(t))return 'yes';
  if(/no\b|not now|stop/.test(t))return 'reject';
  if(/like it|want it/.test(t))return 'accept';
  return 'unclear';
}
export function sendDemoTurn(callId:number,text:string,clientTurnId:string):TurnResponse {
  const store=load();const call=store.calls.find(c=>c.id===callId);
  if(!call)throw new Error('Call not found');
  if(call.conversation_state==='closed')throw new Error('This conversation has ended');
  // Duplicate request IDs should be idempotent in production; mock ignores repeats via the stored marker.
  const already=call.turns.find(t=>(t as CallTurn & {client_turn_id?:string}).client_turn_id===clientTurnId);
  if(already){const assistant=call.turns.find(t=>t.sequence===already.sequence+1);return {customer_turn:already,assistant_turn:assistant,status:call.status,conversation_state:call.conversation_state,result:call.result};}
  const rec=store.recs.find(r=>r.id===call.recommendation_id)!;
  const offer=packages.find(p=>p.id===rec.package_id)!;
  const user=newTurn(store,call,'customer',text.trim());
  (user as CallTurn & {client_turn_id?:string}).client_turn_id=clientTurnId;
  call.turns.push(user);
  const kind=classification(text);
  let reply='';let result:CallResult|undefined;
  const price=`${(offer.monthly_price_minor/100).toFixed(0)} AZN per month`;
  const offerSummary=`${offer.name} includes ${offer.data_gb} GB and ${offer.call_minutes} minutes for ${price}`;
  const close=(outcome:CallOutcome,summary:string,action:string,note?:string)=>{result=finish(call,outcome,summary,action,note);};
  if(kind==='human'){
    reply='Of course. I will record a request for an employee to contact you; this is not a live transfer.';
    close('human_requested','Customer requested a human employee.','Employee should contact customer.');
  }else if(kind==='follow'||kind==='busy'){
    reply='Understood. I will record a request for an employee to follow up. No appointment has been scheduled.';
    close('follow_up_requested','Customer prefers to be contacted later.','Employee should review the follow-up note.',text.slice(0,120));
  }else if(kind==='reject'){
    reply='Understood. I have recorded that you are not interested. Your package will remain unchanged.';
    close('rejected','Customer declined the proposed package.','No further offer action required.');
  }else if(call.conversation_state==='awaiting_consent'){
    if(kind==='yes'||kind==='accept'){
      call.conversation_state='offer_discussion';
      reply=`Thank you. Based on your last three months, ${offerSummary}. Estimated monthly savings are ${(rec.estimated_savings_minor/100).toFixed(2)} AZN based on historical charges. Would you like to know more?`;
    }else reply='May I briefly explain a potential package recommendation based on your recent usage?';
  }else if(call.conversation_state==='awaiting_accept_confirmation'){
    if(kind==='yes'||kind==='accept'){
      reply=`I have recorded your interest in ${offer.name} for employee processing. Your package has not been changed.`;
      close('accepted',`Customer explicitly confirmed interest in ${offer.name}.`,'Employee should review and process the request.');
    }else if(kind==='question'){
      call.conversation_state='offer_discussion';
      reply=answerQuestion(text,offerSummary,price);
    }else reply=`Please explicitly confirm whether you want me to record your interest in ${offer.name}. This will not activate the package.`;
  }else if(kind==='yes'||kind==='accept'){
    call.conversation_state='awaiting_accept_confirmation';
    reply=`Would you like me to record your interest in ${offerSummary} for employee processing? Please confirm yes or no.`;
  }else if(kind==='question'){
    reply=answerQuestion(text,offerSummary,price);
  }else if(kind==='price'){
    reply=`The proposed price is ${price}, compared with your observed average bill of ${(rec.average_bill_minor/100).toFixed(2)} AZN. The estimated savings are not guaranteed.`;
  }else if(kind==='need'){
    reply='Your recent usage exceeded your current allowance in at least two months, but you can keep your current plan. Would you like me to explain the comparison?';
  }else{
    reply='I can explain the proposed package, answer a verified question, or record your decision. What would you like to know?';
  }
  const assistant=newTurn(store,call,'assistant',reply);
  assistant.fact_keys=kind==='question'?['verified_package_faq']:kind==='price'?['monthly_price','observed_average_bill']:[];
  call.turns.push(assistant);
  if(call.turns.filter(t=>t.role==='customer').length>=10 && !result){close('unresolved','Ten-turn demo limit reached.','Employee may review the transcript.');}
  save(store);
  return {customer_turn:user,assistant_turn:assistant,status:call.status,conversation_state:call.conversation_state,result};
}
function answerQuestion(text:string,offerSummary:string,price:string):string {
  const t=text.toLowerCase();
  if(/discount|promotion/.test(t))return 'I do not have a verified discount to offer. An employee can discuss available options.';
  if(/roaming/.test(t))return 'Roaming is not included in this fictional package. An employee can provide more information.';
  if(/rollover|carry over/.test(t))return 'Unused allowances do not roll over to the next month.';
  if(/contract/.test(t))return 'There is no minimum contract period in this fictional catalog.';
  if(/activat/.test(t))return 'Activation requires employee processing. This demo cannot change your current package.';
  if(/tax/.test(t))return `The listed ${price} includes fictional taxes.`;
  if(/extra|overage/.test(t))return 'Additional data costs 1 AZN per GB and additional calls cost 0.05 AZN per minute in this fictional catalog.';
  if(/price|how much|cost|allowance|gb|minutes|data|include|package/.test(t))return `${offerSummary}. The offer is a historical recommendation, not a guaranteed future bill.`;
  return 'I do not have verified information about that. An employee can help.';
}
export function endDemoCall(id:number):CallSession {
  const store=load();const call=store.calls.find(c=>c.id===id);
  if(!call)throw new Error('Call not found');
  if(call.status==='active')finish(call,'unresolved','Call ended without a confirmed decision.','Employee may review the transcript.');
  save(store);return structuredClone(call);
}
