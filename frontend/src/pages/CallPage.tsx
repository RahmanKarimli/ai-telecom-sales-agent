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
import { CallVoiceStage } from '../components/CallVoiceStage';
import type { VoiceState } from '../components/CallVoiceStage';
import './CallPage.css';

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
  const transcriptBody=useRef<HTMLDivElement|null>(null);const microphone=useRef<MicrophoneCapture|null>(null);const player=useRef<HTMLAudioElement|null>(null);const audioUrl=useRef<string|null>(null);
  const audioGeneration=useRef(0);const audibleTurn=useRef<number|null>(null);const initialVoice=useRef<number|null>(null);
  useEffect(()=>{let active=true;setLoading(true);getCall(Number(callId)).then(async c=>{const d=await getCustomer(c.customer_id);if(active){setCall(c);setDetail(d);setPending(savedPending(c));setError('');}}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setLoading(false);});return ()=>{active=false;};},[callId]);
  useEffect(()=>{const transcript=transcriptBody.current;if(transcript)transcript.scrollTo({top:transcript.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[call?.turns.length]);
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
      const audio=new Audio(url);player.current=audio;audibleTurn.current=turnId;
      audio.onplaying=()=>{if(generation===audioGeneration.current){setPlayingId(turnId);setAudioLoadingId(null);}};
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
  const voiceState:VoiceState=microphoneState==='recording'?'listening':microphoneState==='requesting'?'requesting':playingId!==null?'speaking':(busy&&isActive)||audioLoadingId!==null?'thinking':!isActive?'ended':pending?'paused':'ready';
  const elapsedSeconds=Math.max(0,Math.floor(((call.ended_at?new Date(call.ended_at).getTime():now)-new Date(call.started_at).getTime())/1000));
  const elapsed=`${String(Math.floor(elapsedSeconds/60)).padStart(2,'0')}:${String(elapsedSeconds%60).padStart(2,'0')}`;
  const customerTurns=call.turns.filter(turn=>turn.role==='customer').length;
  const idleRemaining=call.limits&&call.last_activity_at?Math.max(0,Math.ceil((new Date(call.last_activity_at).getTime()+call.limits.idle_timeout_seconds*1000-now)/1000)):null;
  const sessionRemaining=call.limits?Math.max(0,Math.ceil((new Date(call.started_at).getTime()+call.limits.session_timeout_seconds*1000-now)/1000)):null;
  const closeReason:Record<string,string>={inactivity_timeout:'This chat ended because no customer message arrived within the idle limit.',session_timeout:'This chat reached its total time limit.',turn_limit:'This chat reached its customer message limit.',manual_end:'This chat was ended manually.'};
  return <div className="page-body call-page">
    <Link to={`/customers/${customer.id}`} className="back-link"><Icon name="arrow-left" size={17}/> {t('Back to customer profile')}</Link>
    <div className="call-title-row"><div><p className="eyebrow">{t('CUSTOMER CONVERSATION')}</p><h1>{t('AI call workspace')}</h1><p className="page-subtitle">{t('Browser call simulation — you are playing the customer.')}</p></div><div className="call-title-actions">{isActive?<button className="btn btn-outline danger-button" disabled={busy||recording} onClick={end}><Icon name="square" size={15}/>{t('End call')}</button>:!isDemoMode&&<button className="btn btn-outline danger-button" disabled={busy} onClick={()=>setConfirmDelete(true)}><Icon name="x" size={15}/>{t('Delete chat')}</button>}</div></div>
    {confirmDelete&&<section role="dialog" aria-modal="true" aria-labelledby="delete-chat-title" className="notice delete-chat-confirm"><div><strong id="delete-chat-title">{t('Delete this chat?')}</strong><p>{t('This permanently removes the transcript and result. The approved offer becomes available for a new conversation with this customer. Development mode only.')}</p></div><button className="btn btn-outline" disabled={busy} onClick={()=>setConfirmDelete(false)}>{t('Cancel')}</button><button className="btn btn-outline danger-button" disabled={busy} onClick={()=>void remove()}>{t(busy?'Deleting…':'Delete chat and reset')}</button></section>}
    {isActive&&!busy&&((idleRemaining!==null&&idleRemaining<=60)||(sessionRemaining!==null&&sessionRemaining<=60)||(call.limits&&customerTurns>=call.limits.max_customer_turns-3))&&<div role="status" className="notice">{t('This chat is approaching a limit. Send your response soon; time and message limits close the chat as unresolved.')}</div>}
    {!isActive&&call.error_code&&closeReason[call.error_code]&&<div className="notice">{t(closeReason[call.error_code]!)} {t('Delete the closed chat to start a new conversation with this customer.')}</div>}
    {isDemoMode&&<div className="notice notice-demo"><Icon name="info" size={17}/> <span><strong>{t('Preview simulation only:')}</strong> {t('responses below are deterministic sample dialogue, not live OpenAI interpretations. Use the typed message box to test all outcomes.')}</span></div>}
    {actionError&&<div className="inline-error"><Icon name="alert-circle" size={18}/>{actionError}</div>}
    {pending&&isActive&&<div className="notice"><span>A saved or uncertain message needs a retry before sending a new one.</span><button className="btn btn-outline" disabled={busy} onClick={()=>void submit(pending.content,pending)}>Retry message</button></div>}
    <div className="call-layout">
      <div className="conversation-panel">
        <div className="conversation-header">
          <div className="call-customer"><Avatar name={customer.name} seed={customer.id}/><div><strong>{customer.name}</strong><span>{t('Call #{id}',{id:String(call.id).padStart(4,'0')})}</span></div></div>
          <span className="call-duration" aria-label={t('Call duration')}><Icon name="clock" size={14}/>{elapsed}</span>
        </div>
        <CallVoiceStage state={voiceState} active={isActive} disabled={busy||!!pending} recording={recording} requesting={microphoneState==='requesting'} playing={playingId!==null} preview={isDemoMode} onMicrophone={()=>recording?stopRecording():beginRecording()} onStopAudio={()=>stopAudio()}/>
        <section className="live-transcript" aria-labelledby="live-transcript-title">
          <div className="transcript-heading"><h2 id="live-transcript-title"><Icon name="file-text" size={15}/>{t(isActive?'Live transcript':'Saved transcript')}</h2><span>{t(call.turns.length===1?'{count} turn':'{count} turns',{count:call.turns.length})}</span></div>
          <div className="conversation-body" ref={transcriptBody} tabIndex={0} role="region" aria-label={t('Conversation transcript')}>
            {call.turns.map(turn=><div className={`message-row ${turn.role==='customer'?'message-row-customer':''} ${playingId===turn.id?'message-row-speaking':''}`} key={turn.id}>
              <div className="message-content">
                <div className="message-meta"><strong>{t(turn.role==='assistant'?'TelsyAİ':'Customer')}</strong><span>{new Date(turn.created_at).toLocaleTimeString(dateLocale,{hour:'2-digit',minute:'2-digit'})}</span>{playingId===turn.id&&<span className="transcript-speaking"><Icon name="volume" size={12}/>{t('Speaking')}</span>}</div>
                <div className={`message-bubble ${turn.role==='customer'?'bubble-customer':'bubble-assistant'}`}>{turn.text}</div>
                {turn.role==='assistant'&&<div className="message-tools">{!isDemoMode&&<button disabled={audioLoadingId!==null||recording||busy} className="text-button" onClick={()=>playingId===turn.id?stopAudio():void playAudio(turn.id)}><Icon name={playingId===turn.id?'volume-x':'volume'} size={14}/>{t(audioLoadingId===turn.id?'Loading audio…':playingId===turn.id?'Stop audio':'Play voice')}</button>}{turn.fact_keys.length>0&&<span className="fact-label"><Icon name="shield" size={12}/>{t('Verified: {facts}',{facts:turn.fact_keys.join(', ')})}</span>}{turn.interrupted&&<span className="fact-label">{t('Interrupted')}</span>}</div>}
              </div>
            </div>)}
            {busy&&<div className="processing-line" role="status"><span className="transcript-thinking" aria-hidden="true"><i/><i/><i/></span>{t('Processing your response…')}</div>}
          </div>
        </section>
        {isActive?<div className="composer">
          <div className="quick-replies">{suggestions[call.conversation_state].map(text=><button key={text} disabled={busy||recording||!!pending} onClick={()=>void submit({text})}>{t(text)}</button>)}</div>
          <form onSubmit={sendText} className="message-form"><Icon name="file-text" size={16}/><input aria-label={t('Customer message')} value={message} onChange={e=>setMessage(e.target.value)} placeholder={t(microphoneState==='requesting'?'Waiting for microphone permission…':recording?'Recording… press stop to submit':'Or type your response…')} disabled={busy||recording||!!pending} maxLength={600}/><button aria-label={t('Send message')} className="send-button" disabled={busy||recording||!!pending||!message.trim()} type="submit"><Icon name="send" size={16}/></button></form>
          <div className="composer-foot"><span>{t('Multilingual interface only: demo dialogue and connected voice AI currently use English.')}</span><span>{call.limits?`${customerTurns}/${call.limits.max_customer_turns} ${t('messages')}`:`${customerTurns} ${t('messages')}`}</span></div>
        </div>:<div className="conversation-finished"><Icon name="check-circle" size={17}/><span>{t('Conversation closed · new messages are disabled')}</span></div>}
      </div>
      <aside className="call-right-panel"><section className="surface-panel call-offer-panel"><p className="eyebrow">{t('APPROVED OFFER REFERENCE')}</p><div className="offer-side-title"><h2>{offer.name}</h2><span>{t('Recommended')}</span></div><div className="side-price"><strong>{money(offer.monthly_price_minor)}</strong><span>{t('/ month')}</span></div><div className="offer-attributes"><div><Icon name="wifi" size={17}/><span>{t('Monthly data')}</span><strong>{offer.data_gb} GB</strong></div><div><Icon name="phone" size={17}/><span>{t('Call allowance')}</span><strong>{offer.call_minutes} min</strong></div><div><Icon name="chart" size={17}/><span>{t('Est. monthly savings')}</span><strong>{money(savings)}</strong></div></div><p className="offer-warning"><Icon name="shield" size={16}/>{t('Package facts are verified; activation requires employee processing.')}</p></section>
        <section className="surface-panel call-flow-panel"><p className="eyebrow">{t('CONVERSATION STATUS')}</p><div className="call-progress-heading"><h2>{t('Call progress')}</h2><Badge status={call.status}/></div><div className="call-flow-steps">{(['awaiting_consent','offer_discussion','awaiting_accept_confirmation','closed'] as const).map((state,index)=>{const states=['awaiting_consent','offer_discussion','awaiting_accept_confirmation','closed'];const current=states.indexOf(call.conversation_state);return <div className={`flow-step ${index===current?'flow-step-active':index<current?'flow-step-done':''}`} key={state}><span className="step-circle">{index<current?<Icon name="check" size={13}/>:index+1}</span><span>{t(steps[state])}</span></div>})}</div><div className="call-session-details"><span><Icon name="clock" size={13}/>{t('Started {date}',{date:prettyDateTime(call.started_at,dateLocale)})}</span>{call.limits&&<span>{t('Chat limits: {turns} customer messages · {session} minutes total · {idle} minutes idle',{turns:call.limits.max_customer_turns,session:call.limits.session_timeout_seconds/60,idle:call.limits.idle_timeout_seconds/60})}</span>}</div></section>
        {call.result&&<section className="surface-panel result-panel"><p className="eyebrow">{t('SAVED CALL RESULT')}</p><div className="result-top"><h2>{t('Outcome')}</h2><Badge status={call.result.outcome}/></div><div className="result-section"><span>{t('Summary')}</span><p>{call.result.summary}</p></div><div className="result-section"><span>{t('Next action')}</span><p>{call.result.next_action}</p></div>{call.result.follow_up_note&&<div className="result-section"><span>{t('Customer note')}</span><p>{call.result.follow_up_note}</p></div>}{call.result.outcome==='accepted'&&(call.result.package_approved_at?<div className="notice"><Icon name="check-circle" size={17}/><span>{t('Package change approved for processing on {date}',{date:prettyDateTime(call.result.package_approved_at,dateLocale)})}</span></div>:<><p className="result-section package-approval-note">{t('The customer confirmed interest. Employee approval records the request for processing; the package and bill are not changed here.')}</p><button className="btn btn-primary" disabled={busy} onClick={()=>void approveChange()}><Icon name="check" size={16}/>{t(busy?'Approving package change…':'Approve package change')}</button></>)}<span className="result-time">{t('Saved {date}',{date:prettyDateTime(call.result.created_at,dateLocale)})}</span></section>}
      </aside>
    </div>
  </div>;
}
