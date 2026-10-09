import { Icon } from './Icon';
import { useLanguage } from '../i18n/LanguageContext';

export type VoiceState = 'ready' | 'requesting' | 'listening' | 'thinking' | 'speaking' | 'paused' | 'ended';

const stateCopy: Record<VoiceState, { title: string; hint: string }> = {
  ready: { title: 'Ready when you are', hint: 'Tap the microphone, speak, then send your response.' },
  requesting: { title: 'Opening your microphone', hint: 'Allow microphone access in your browser, or cancel below.' },
  listening: { title: 'Listening to you', hint: 'Take your time. Tap Stop & send when you’re finished.' },
  thinking: { title: 'Thinking it through', hint: 'TelsyAİ is preparing a response for you.' },
  speaking: { title: 'TelsyAİ is speaking', hint: 'Listen, or tap the microphone to interrupt and respond.' },
  paused: { title: 'Let’s pick up your response', hint: 'Retry the saved message above to continue your conversation.' },
  ended: { title: 'Conversation complete', hint: 'Your transcript and call outcome have been saved.' },
};

type Props = {
  state: VoiceState;
  active: boolean;
  disabled: boolean;
  recording: boolean;
  requesting: boolean;
  playing: boolean;
  preview: boolean;
  onMicrophone: () => void;
  onStopAudio: () => void;
};

export function CallVoiceStage({ state, active, disabled, recording, requesting, playing, preview, onMicrophone, onStopAudio }: Props) {
  const { t } = useLanguage();
  const copy = stateCopy[state];
  const buttonLabel = requesting ? 'Cancel microphone request' : recording ? 'Stop & send' : 'Start speaking';
  return <section className={`voice-stage voice-stage-${state}`} aria-label={t('Voice conversation')}>
    <div className="voice-stage-topline"><span><Icon name="headset" size={14} /> {t('TelsyAİ voice assistant')}</span><span className="voice-state-pill"><i />{t(preview && state === 'ready' ? 'Preview mode' : state === 'ready' ? 'Ready' : state === 'requesting' ? 'Connecting' : state === 'listening' ? 'Listening' : state === 'thinking' ? 'Thinking' : state === 'speaking' ? 'Speaking' : state === 'paused' ? 'Paused' : 'Ended')}</span></div>
    <div className="voice-orb-scene" aria-hidden="true">
      <div className="voice-orb-ring" />
      <div className="voice-orb">
        <div className="voice-orb-wave">{[0, 1, 2, 3, 4, 5, 6].map(i => <i key={i} />)}</div>
      </div>
    </div>
    <div className="voice-stage-copy" role="status" aria-live="polite" aria-atomic="true">
      <h2>{t(copy.title)}</h2>
      <p>{t(preview && state === 'ready' ? 'Voice is available in connected mode. Try a message below.' : !active && state === 'speaking' ? 'Listen to the response. You can stop playback at any time.' : copy.hint)}</p>
    </div>
    <div className="voice-stage-controls">
      {active && <button type="button" className={`voice-mic-button ${recording ? 'voice-mic-recording' : ''}`} disabled={disabled} onClick={onMicrophone} aria-label={t(buttonLabel)}>
        <Icon name={requesting ? 'x' : recording ? 'square' : 'mic'} size={18} />{t(buttonLabel)}
      </button>}
      {playing && <button type="button" className="voice-stop-button" onClick={onStopAudio} aria-label={t('Stop audio')} title={t('Stop audio')}><Icon name="volume-x" size={19} /></button>}
      {!active && !playing && <span className="voice-ended-label"><Icon name="check-circle" size={16} />{t('Call ended')}</span>}
    </div>
    <p className="voice-stage-footnote">{t(preview ? 'Voice preview · typed responses available below' : recording && !requesting ? 'Recording · up to 20 seconds' : 'AI-generated speech · you control the microphone')}</p>
  </section>;
}
