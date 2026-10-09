import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, approvePackageChange, deleteCall, endCall, getCall, getCustomer, getTurnAudio, isDemoMode, sendTurn } from '../lib/api';
import { MicrophoneCapture } from '../lib/microphone';
import type { MicrophoneState } from '../lib/microphone';
import type { TurnContent } from '../lib/api';
import { idempotencyKey, money, prettyDateTime } from '../lib/format';
import { useRefresh } from '../context/RefreshContext';
import { useLanguage } from '../i18n/LanguageContext';
import type { CallSession, CustomerDetail, ConversationState } from '../types';
import { Icon } from '../components/Icon';
import { Avatar, Badge, ErrorState, Loading } from '../components/UI';

const steps:Record<ConversationState,string>={awaiting_consent:'Awaiting consent',offer_discussion:'Offer discussion',awaiting_accept_confirmation:'Confirming interest',closed:'Conversation ended'};
const suggestions:Record<ConversationState,string[]>={
  awaiting_consent:['Yes, you can explain','Not interested','Could we talk tomorrow?'],
  offer_discussion:['How much does it cost?','Does it include roaming?','I am interested','I want to speak to an employee'],
  awaiting_accept_confirmation:['Yes, I confirm my interest','No thanks','What about the contract?'],
  closed:[],
};
type PendingTurn = { id: string; content: TurnContent };
function savedPending(call: CallSession): PendingTurn | null {
  const last = call.turns.at(-1);
  return call.status === 'active' && last?.role === 'customer' && last.client_turn_id
    ? { id: last.client_turn_id, content: { text: last.text } } : null;
}
export function CallPage(){
  const {callId}=useParams();const navigate=useNavigate();const {refresh}=useRefresh();const {t,dateLocale}=useLanguage();
  const [call,setCall]=useState<CallSession|null>(null);const [detail,setDetail]=useState<CustomerDetail|null>(null);
  const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [actionError,setActionError]=useState('');const [microphoneState,setMicrophoneState]=useState<MicrophoneState>('idle');const [audioLoadingId,setAudioLoadingId]=useState<number|null>(null);const [playingId,setPlayingId]=useState<number|null>(null);
  const [confirmDelete,setConfirmDelete]=useState(false);const [now,setNow]=useState(Date.now());
  const recording=microphoneState!=='idle';
  const [pending,setPending]=useState<PendingTurn|null>(null);
  const inFlight=useRef(false);const mounted=useRef(true);const interrupted=useRef<number|undefined>(undefined);
  const messagesEnd=useRef<HTMLDivElement|null>(null);const microphone=useRef<MicrophoneCapture|null>(null);const player=useRef<HTMLAudioElement|null>(null);const audioUrl=useRef<string|null>(null);
  const audioGeneration=useRef(0);const audibleTurn=useRef<number|null>(null);const initialVoice=useRef<number|null>(null);
  useEffect(()=>{let active=true;setLoading(true);getCall(Number(callId)).then(async c=>{const d=await getCustomer(c.customer_id);if(active){setCall(c);setDetail(d);setPending(savedPending(c));setError('');}}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setLoading(false);});return ()=>{active=false;};},[callId]);
  useEffect(()=>{messagesEnd.current?.scrollIntoView({behavior:'smooth',block:'end'});},[call?.turns.length]);
  useEffect(()=>{mounted.current=true;setMicrophoneState('idle');return ()=>{mounted.current=false;audioGeneration.current++;microphone.current?.dispose();player.current?.pause();if(audioUrl.current)URL.revokeObjectURL(audioUrl.current);};},[callId]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(!call||call.status!=='active'||busy||recording||isDemoMode)return;let active=true;const timer=setInterval(()=>{void getCall(call.id).then(c=>{if(active){setCall(c);if(c.status!=='active'){setPending(null);refresh();}}}).catch(()=>{/* Keep the transcript during temporary read failures. */});},15000);return()=>{active=false;clearInterval(timer);};},[call?.id,call?.status,busy,recording]);
  const stopAudio=(markInterrupted=true)=>{
    audioGeneration.current++;
    if(markInterrupted&&audibleTurn.current!==null)interrupted.current=audibleTurn.current;
    player.current?.pause();player.current=null;audibleTurn.current=null;
    if(audioUrl.current){URL.revokeObjectURL(audioUrl.current);audioUrl.current=null;}
    setPlayingId(null);setAudioLoadingId(null);
  };
  const playAudio=async(turnId:number)=>{
    if(!call||isDemoMode)return;
    stopAudio(false);const generation=audioGeneration.current;setAudioLoadingId(turnId);
    try{
      const blob=await getTurnAudio(call.id,turnId);
      if(!mounted.current||generation!==audioGeneration.current)return;
      const url=URL.createObjectURL(blob);audioUrl.current=url;
      const audio=new Audio(url);player.current=audio;audibleTurn.current=turnId;setPlayingId(turnId);
      audio.onended=()=>{if(generation===audioGeneration.current)stopAudio(false);};
      audio.onerror=()=>{if(generation===audioGeneration.current){setActionError('Audio playback failed. The verified text remains available; use Play voice to retry.');stopAudio(false);}};
      await audio.play();
    }catch(e){if(mounted.current&&generation===audioGeneration.current){setActionError(e instanceof DOMException&&e.name==='NotAllowedError'?'Use Play voice to start AI-generated speech.':(e as Error).message);stopAudio(false);}}
    finally{if(mounted.current&&generation===audioGeneration.current)setAudioLoadingId(null);}
  };
  useEffect(()=>{if(!call||loading||call.status!=='active'||isDemoMode||initialVoice.current===call.id)return;initialVoice.current=call.id;const last=call.turns.at(-1);if(last?.role==='assistant')void playAudio(last.id);},[call?.id,loading]);
  const submit=async(content:TurnContent,retry?:PendingTurn)=>{
    if(!call||call.status!=='active'||inFlight.current||(!retry&&pending))return;
    if(content.text!==undefined&&!content.text.trim())return;
    stopAudio();inFlight.current=true;setBusy(true);setActionError('');
    const attempt=retry??{id:idempotencyKey(),content:{...content,interruptedAssistantTurnId:interrupted.current}};
    setPending(attempt);
    try{
      const response=await sendTurn(call.id,attempt.id,attempt.content);
      // The successful response is enough to update the UI even if a subsequent read fails.
      setCall(c=>c?{...c,status:response.status,conversation_state:response.conversation_state,result:response.result??undefined,
        turns:[...c.turns.filter(turn=>turn.id!==response.customer_turn.id&&turn.id!==response.assistant_turn?.id),response.customer_turn,...(response.assistant_turn?[response.assistant_turn]:[])].sort((a,b)=>a.sequence-b.sequence)}:c);
      setPending(null);setMessage('');interrupted.current=undefined;refresh();
      const next=await getCall(call.id).catch(()=>null);if(next&&mounted.current)setCall(next);
      if(response.assistant_turn)void playAudio(response.assistant_turn.id);
    }catch(e){
      setActionError((e as Error).message);
      const next=await getCall(call.id).catch(()=>null);
      if(next){setCall(next);const saved=savedPending(next);const completed=next.turns.some(turn=>turn.client_turn_id===attempt.id)&&!saved;
        if(completed||next.status!=='active'){setPending(null);setMessage('');refresh();}
        else if(saved)setPending({...saved,content:{...saved.content,interruptedAssistantTurnId:attempt.content.interruptedAssistantTurnId}});
        else if(e instanceof ApiError&&e.status!==409)setPending(null);
      }
    }finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  };
  function beginRecording(){
    if(inFlight.current||pending||recording||!call||call.status!=='active')return;
    if(isDemoMode){setActionError('Preview mode uses typed messages. Connect the FastAPI backend for live speech-to-text and voice replies.');return;}
    stopAudio();setActionError('');
    microphone.current?.dispose();
    const capture=new MicrophoneCapture({onState:state=>{if(mounted.current)setMicrophoneState(state);},onError:message=>{if(mounted.current)setActionError(message);},onAudio:audio=>{if(mounted.current)void submit({audio});}});
    microphone.current=capture;void capture.start();
  }
  const stopRecording=()=>microphone.current?.stop();
  const remove=async()=>{if(!call||call.status==='active'||inFlight.current)return;stopAudio(false);inFlight.current=true;setBusy(true);setActionError('');try{await deleteCall(call.id);refresh();navigate(`/customers/${call.customer_id}`,{replace:true});}catch(e){setActionError((e as Error).message);setConfirmDelete(false);}finally{inFlight.current=false;if(mounted.current)setBusy(false);}};
  const end=async()=>{if(!call||inFlight.current)return;if(recording){setActionError('Stop the recording before ending the call.');return;}stopAudio();inFlight.current=true;setBusy(true);setActionError('');try{const c=await endCall(call.id,interrupted.current);setCall(c);setPending(null);refresh();}catch(e){setActionError((e as Error).message);}finally{inFlight.current=false;setBusy(false);}};
  const approveChange=async()=>{if(!call||inFlight.current)return;inFlight.current=true;setBusy(true);setActionError('');try{const updated=await approvePackageChange(call.id);setCall(updated);refresh();}catch(e){setActionError((e as Error).message);}finally{inFlight.current=false;setBusy(false);}};
  const sendText=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();void submit({text:message});};
  if(loading)return <Loading/>;
  if(error||!call||!detail)return <ErrorState message={error||'Conversation unavailable'}/>;
  const {customer}=detail;
  const offer=call.offer_snapshot?.proposed_package??detail.proposed_package;
  const savings=call.offer_snapshot?.evidence.estimated_savings_minor??detail.recommendation?.estimated_savings_minor??0;
  if(!offer)return <ErrorState message="Approved offer unavailable"/>;
  const isActive=call.status==='active';
  const customerTurns=call.turns.filter(turn=>turn.role==='customer').length;
  const idleRemaining=call.limits&&call.last_activity_at?Math.max(0,Math.ceil((new Date(call.last_activity_at).getTime()+call.limits.idle_timeout_seconds*1000-now)/1000)):null;
  const sessionRemaining=call.limits?Math.max(0,Math.ceil((new Date(call.started_at).getTime()+call.limits.session_timeout_seconds*1000-now)/1000)):null;
  const closeReason:Record<string,string>={inactivity_timeout:'This chat ended because no customer message arrived within the idle limit.',session_timeout:'This chat reached its total time limit.',turn_limit:'This chat reached its customer message limit.',manual_end:'This chat was ended manually.'};
  return <div className="page-body call-page">
    <Link to={`/customers/${customer.id}`} className="back-link"><Icon name="arrow-left" size={17}/> {t('Back to customer profile')}</Link>
    <div className="call-title-row"><div><p className="eyebrow">{t('CUSTOMER CONVERSATION')}</p><h1>{t('AI call workspace')}</h1><p className="page-subtitle">{t('Browser call simulation — you are playing the customer.')}</p></div><div className="call-title-actions"><Badge status={call.status}/>{isActive?<button className="btn btn-outline danger-button" disabled={busy||recording} onClick={end}><Icon name="square" size={15}/>{t('End call')}</button>:!isDemoMode&&<button className="btn btn-outline danger-button" disabled={busy} onClick={()=>setConfirmDelete(true)}><Icon name="x" size={15}/>{t('Delete chat')}</button>}</div></div>
    {confirmDelete&&<section role="dialog" aria-modal="true" aria-labelledby="delete-chat-title" className="notice delete-chat-confirm"><div><strong id="delete-chat-title">{t('Delete this chat?')}</strong><p>{t('This permanently removes the transcript and result. The approved offer becomes available for a new conversation with this customer. Development mode only.')}</p></div><button className="btn btn-outline" disabled={busy} onClick={()=>setConfirmDelete(false)}>{t('Cancel')}</button><button className="btn btn-outline danger-button" disabled={busy} onClick={()=>void remove()}>{t(busy?'Deleting…':'Delete chat and reset')}</button></section>}
    {isActive&&call.limits&&<p className="call-limit-note">{t('Chat limits: {turns} customer messages · {session} minutes total · {idle} minutes idle',{turns:call.limits.max_customer_turns,session:call.limits.session_timeout_seconds/60,idle:call.limits.idle_timeout_seconds/60})}</p>}
    {isActive&&!busy&&((idleRemaining!==null&&idleRemaining<=60)||(sessionRemaining!==null&&sessionRemaining<=60)||(call.limits&&customerTurns>=call.limits.max_customer_turns-3))&&<div role="status" className="notice">{t('This chat is approaching a limit. Send your response soon; time and message limits close the chat as unresolved.')}</div>}
    {!isActive&&call.error_code&&closeReason[call.error_code]&&<div className="notice">{t(closeReason[call.error_code]!)} {t('Delete the closed chat to start a new conversation with this customer.')}</div>}
    {isDemoMode&&<div className="notice notice-demo"><Icon name="info" size={17}/> <span><strong>{t('Preview simulation only:')}</strong> {t('responses below are deterministic sample dialogue, not live OpenAI interpretations. Use the typed message box to test all outcomes.')}</span></div>}
    {actionError&&<div className="inline-error"><Icon name="alert-circle" size={18}/>{actionError}</div>}
    {pending&&isActive&&<div className="notice"><span>A saved or uncertain message needs a retry before sending a new one.</span><button className="btn btn-outline" disabled={busy} onClick={()=>void submit(pending.content,pending)}>Retry message</button></div>}
    <p className="call-language-note"><Icon name="info" size={14}/>{t('Multilingual interface only: demo dialogue and connected voice AI currently use English.')}</p><div className="call-layout">
      <div className="conversation-panel"><div className="conversation-header"><div className="call-customer"><Avatar name={customer.name} seed={customer.id}/><div><strong>{customer.name}</strong><span>{t('Call #{id} · Started {date}',{id:String(call.id).padStart(4,'0'),date:prettyDateTime(call.started_at,dateLocale)})}</span></div></div><span className="conversation-header-state"><i className={isActive?'pulse-dot':'muted-dot'}/>{t(steps[call.conversation_state])}</span></div>
        <div className="conversation-body"><div className="conversation-day">{t('TODAY · TRANSCRIPT')}</div>{call.turns.map(turn=><div className={`message-row ${turn.role==='customer'?'message-row-customer':''}`} key={turn.id}>{turn.role==='assistant'&&<div className="ai-avatar"><img src="/telsyai-mark.png" alt="" width="23" height="23" /></div>}<div className="message-content"><div className="message-meta"><strong>{t(turn.role==='assistant'?'TelsyAİ':'Customer')}</strong><span>{new Date(turn.created_at).toLocaleTimeString(dateLocale,{hour:'2-digit',minute:'2-digit'})}</span></div><div className={`message-bubble ${turn.role==='customer'?'bubble-customer':'bubble-assistant'}`}>{turn.text}</div>{turn.role==='assistant'&&<div className="message-tools">{!isDemoMode&&<button disabled={audioLoadingId!==null||recording||busy} className="text-button" onClick={()=>playingId===turn.id?stopAudio():void playAudio(turn.id)}><Icon name={playingId===turn.id?'volume-x':'volume'} size={15}/>{t(audioLoadingId===turn.id?'Loading audio…':playingId===turn.id?'Stop audio':'Play voice')}</button>}{turn.fact_keys.length>0&&<span className="fact-label"><Icon name="shield" size={13}/> {t('Verified: {facts}',{facts:turn.fact_keys.join(', ')})}</span>}{turn.interrupted&&<span className="fact-label">{t('Interrupted')}</span>}</div>}</div>{turn.role==='customer'&&<Avatar name={customer.name} seed={customer.id} size="sm"/>}</div>)}{busy&&<div className="processing-line"><div className="spinner spinner-small"/>{t('Processing your response…')}</div>}<div ref={messagesEnd}/></div>
        {isActive?<div className="composer"><div className="quick-replies">{suggestions[call.conversation_state].map(text=><button key={text} disabled={busy||recording||!!pending} onClick={()=>void submit({text})}>{t(text)}</button>)}</div><form onSubmit={sendText} className="message-form"><button type="button" aria-label={t(microphoneState==='requesting'?'Cancel microphone request':recording?'Stop recording':'Start recording')} title={t(microphoneState==='requesting'?'Waiting for microphone permission':recording?'Stop and send recording':'Record a voice message')} className={`record-button ${microphoneState==='recording'?'recording':''}`} disabled={busy||!!pending} onClick={()=>recording?stopRecording():void beginRecording()}><Icon name={recording?'square':'mic'} size={19}/></button><input aria-label={t('Customer message')} value={message} onChange={e=>setMessage(e.target.value)} placeholder={t(microphoneState==='requesting'?'Waiting for microphone permission…':recording?'Recording… press stop to submit':'Type a customer response or question…')} disabled={busy||recording||!!pending} maxLength={600}/><button aria-label={t('Send message')} className="send-button" disabled={busy||recording||!!pending||!message.trim()} type="submit"><Icon name="send" size={17}/></button></form><p className="microphone-status" role="status">{microphoneState==='requesting'?t('Waiting for permission. Check the browser or system microphone prompt; press Cancel to return to typing.'):microphoneState==='recording'?t('Recording from your microphone. Speak, then press Stop to send.'):t('Click the microphone to record a voice message.')}</p><div className="composer-foot"><span><Icon name="info" size={13}/> {isDemoMode?t('Push-to-talk in API mode · typed fallback always available'):'AI-generated speech · recordings stop after 20 seconds · typed fallback available'}</span><span>{call.limits?`${customerTurns}/${call.limits.max_customer_turns} ${t('messages')}`:`${customerTurns} ${t('messages')}`}</span></div></div>:<div className="conversation-finished"><Icon name="check-circle" size={19}/><span>{t('Conversation closed · new messages are disabled')}</span></div>}
      </div>
      <aside className="call-right-panel"><section className="surface-panel call-offer-panel"><p className="eyebrow">{t('APPROVED OFFER REFERENCE')}</p><div className="offer-side-title"><h2>{offer.name}</h2><span>{t('Recommended')}</span></div><div className="side-price"><strong>{money(offer.monthly_price_minor)}</strong><span>{t('/ month')}</span></div><div className="offer-attributes"><div><Icon name="wifi" size={17}/><span>{t('Monthly data')}</span><strong>{offer.data_gb} GB</strong></div><div><Icon name="phone" size={17}/><span>{t('Call allowance')}</span><strong>{offer.call_minutes} min</strong></div><div><Icon name="chart" size={17}/><span>{t('Est. monthly savings')}</span><strong>{money(savings)}</strong></div></div><p className="offer-warning"><Icon name="shield" size={16}/>{t('Package facts are verified; activation requires employee processing.')}</p></section>
        <section className="surface-panel call-flow-panel"><p className="eyebrow">{t('CONVERSATION STATUS')}</p><h2>{t('Call progress')}</h2>{(['awaiting_consent','offer_discussion','awaiting_accept_confirmation','closed'] as const).map((state,index)=>{const states=['awaiting_consent','offer_discussion','awaiting_accept_confirmation','closed'];const current=states.indexOf(call.conversation_state);return <div className={`flow-step ${index===current?'flow-step-active':index<current?'flow-step-done':''}`} key={state}><span className="step-circle">{index<current?<Icon name="check" size={13}/>:index+1}</span><span>{t(steps[state])}</span></div>})}</section>
        {call.result&&<section className="surface-panel result-panel"><p className="eyebrow">{t('SAVED CALL RESULT')}</p><div className="result-top"><h2>{t('Outcome')}</h2><Badge status={call.result.outcome}/></div><div className="result-section"><span>{t('Summary')}</span><p>{call.result.summary}</p></div><div className="result-section"><span>{t('Next action')}</span><p>{call.result.next_action}</p></div>{call.result.follow_up_note&&<div className="result-section"><span>{t('Customer note')}</span><p>{call.result.follow_up_note}</p></div>}{call.result.outcome==='accepted'&&(call.result.package_approved_at?<div className="notice"><Icon name="check-circle" size={17}/><span>{t('Package change approved for processing on {date}',{date:prettyDateTime(call.result.package_approved_at,dateLocale)})}</span></div>:<><p className="result-section package-approval-note">{t('The customer confirmed interest. Employee approval records the request for processing; the package and bill are not changed here.')}</p><button className="btn btn-primary" disabled={busy} onClick={()=>void approveChange()}><Icon name="check" size={16}/>{t(busy?'Approving package change…':'Approve package change')}</button></>)}<span className="result-time">{t('Saved {date}',{date:prettyDateTime(call.result.created_at,dateLocale)})}</span></section>}
      </aside>
    </div>
  </div>;
}
