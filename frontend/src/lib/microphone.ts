export type MicrophoneState = 'idle' | 'requesting' | 'recording';
type CaptureCallbacks = {
  onState: (state: MicrophoneState) => void;
  onAudio: (audio: Blob) => void;
  onError: (message: string) => void;
};
type CaptureEnvironment = {
  secureContext: boolean;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  Recorder?: typeof MediaRecorder;
};
const MAX_BYTES = 2 * 1024 * 1024;
export const RECORDING_SECONDS = 20;

export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone access is blocked. Allow Microphone in this site’s browser settings and in your system privacy settings, then try again. A browser will not prompt again while access is blocked.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect a microphone and try again.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone cannot be opened. Check system microphone permission and close other apps using the device, then try again.';
  if (name === 'SecurityError') return 'Browser security settings prevent microphone access. Open this app over HTTPS or on localhost and check microphone permissions.';
  if (name === 'NotSupportedError') return 'This browser cannot record a supported audio format. Try a current Chrome, Brave, Firefox, or Safari browser.';
  return 'Microphone capture failed. Check your microphone and browser permissions, then try again or use typed input.';
}

/** Owns one capture, including cancellation while getUserMedia is still pending. */
export class MicrophoneCapture {
  private state: MicrophoneState = 'idle';
  private generation = 0;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private permissionTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private callbacks: CaptureCallbacks, private environment: CaptureEnvironment = {
    secureContext: window.isSecureContext,
    mediaDevices: navigator.mediaDevices,
    Recorder: typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder,
  }) {}

  private setState(state: MicrophoneState) { this.state = state; this.callbacks.onState(state); }
  private release() {
    clearTimeout(this.timer); clearTimeout(this.permissionTimer);
    const recorder = this.recorder; this.recorder = null;
    if (recorder) {
      recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    const stream = this.stream; this.stream = null;
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  }
  cancel() { this.generation++; this.release(); this.setState('idle'); }
  dispose() { this.generation++; this.release(); this.state = 'idle'; }
  stop() {
    if (this.state === 'requesting') this.cancel();
    else if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  async start() {
    if (this.state !== 'idle') return;
    const { secureContext, mediaDevices, Recorder } = this.environment;
    if (!secureContext) {
      this.callbacks.onError('Microphone access requires HTTPS or localhost. Open the app on localhost on this computer, or use HTTPS for a remote host.'); return;
    }
    if (!mediaDevices?.getUserMedia || !Recorder) {
      this.callbacks.onError('Audio recording is unavailable in this browser. Use a current browser with microphone support or typed input.'); return;
    }
    const generation = ++this.generation;
    this.setState('requesting');
    this.permissionTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.cancel();
      this.callbacks.onError('Microphone permission is still pending. Check the browser’s microphone indicator or system permission prompt, allow access, and try again.');
    }, 30000);
    try {
      // Invoke directly from the click. Do not await a permission query before requesting access.
      const stream = await mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      clearTimeout(this.permissionTimer); this.stream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
        .find(mime => typeof Recorder.isTypeSupported === 'function' && Recorder.isTypeSupported(mime));
      const recorder = new Recorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      this.recorder = recorder;
      const chunks: Blob[] = []; let bytes = 0;
      const fail = (message: string) => {
        if (generation !== this.generation) return;
        this.cancel(); this.callbacks.onError(message);
      };
      recorder.ondataavailable = event => {
        if (generation !== this.generation || !event.data.size) return;
        chunks.push(event.data); bytes += event.data.size;
        if (bytes > MAX_BYTES) fail('Recording exceeds 2 MiB. Record a shorter message or use typed input.');
      };
      recorder.onerror = () => fail('The microphone stopped recording unexpectedly. Check your device, then try again or use typed input.');
      stream.getTracks().forEach(track => {
        track.onended = () => fail('The microphone was disconnected or access was revoked. Reconnect it or allow access, then try again.');
      });
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        this.release(); this.setState('idle');
        if (audio.size) this.callbacks.onAudio(audio);
        else this.callbacks.onError('No audio was captured. Speak for a moment, then press Stop and send, or use typed input.');
      };
      // Periodic chunks make the final upload reliable across supported browsers.
      recorder.start(250); this.setState('recording');
      this.timer = setTimeout(() => this.stop(), RECORDING_SECONDS * 1000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel(); this.callbacks.onError(microphoneError(error));
    }
  }
}
