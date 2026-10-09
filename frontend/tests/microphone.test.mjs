import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneCapture } from '../.test-build/microphone.js';

function harness(overrides = {}) {
  const states = [], errors = [], uploads = [], recorders = [];
  const track = { stopped: false, onended: null, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  let requests = 0;
  class Recorder {
    static isTypeSupported(mime) { return mime === 'audio/webm;codecs=opus'; }
    state = 'inactive'; mimeType = 'audio/webm;codecs=opus';
    constructor(stream, options) { this.options = options; recorders.push(this); }
    start(timeslice) { this.timeslice = timeslice; this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['final audio chunk'], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  const capture = new MicrophoneCapture({
    onState: state => states.push(state), onError: error => errors.push(error), onAudio: audio => uploads.push(audio),
  }, { secureContext: true, mediaDevices: { getUserMedia() { requests++; return Promise.resolve(stream); } }, Recorder, ...overrides });
  return { capture, states, errors, uploads, recorders, track, stream, requests: () => requests };
}

test('requests access, records supported MIME, includes final chunk, releases device and uploads once', async () => {
  const h = harness();
  const start = h.capture.start();
  assert.equal(h.requests(), 1); // Called immediately, before any async permission preflight.
  assert.deepEqual(h.states, ['requesting']);
  await start;
  assert.deepEqual(h.states, ['requesting', 'recording']);
  assert.equal(h.recorders[0].timeslice, 250);
  assert.equal(h.recorders[0].options.mimeType, 'audio/webm;codecs=opus');
  h.capture.stop(); h.capture.stop();
  assert.equal(h.uploads.length, 1);
  assert.equal(await h.uploads[0].text(), 'final audio chunk');
  assert.equal(h.track.stopped, true);
  assert.equal(h.states.at(-1), 'idle');
});
test('blocks insecure origins with a useful error instead of a silent button', async () => {
  const h = harness({ secureContext: false }); await h.capture.start();
  assert.equal(h.requests(), 0); assert.match(h.errors[0], /HTTPS or localhost/);
});
test('denied permission explains how to unblock; a second click requests again', async () => {
  let requests = 0;
  const h = harness({ mediaDevices: { getUserMedia() { requests++; return Promise.reject(new DOMException('blocked', 'NotAllowedError')); } } });
  await h.capture.start(); await h.capture.start();
  assert.equal(requests, 2); assert.match(h.errors[0], /will not prompt again/); assert.equal(h.states.at(-1), 'idle');
});
test('cancel and dispose during permission release late streams without recording or upload', async () => {
  for (const action of ['cancel', 'dispose']) {
    let resolve;
    const h = harness({ mediaDevices: { getUserMedia: () => new Promise(r => { resolve = r; }) } });
    const start = h.capture.start(); const second = h.capture.start();
    h.capture[action](); resolve(h.stream); await Promise.all([start, second]);
    assert.equal(h.track.stopped, true); assert.equal(h.recorders.length, 0); assert.equal(h.uploads.length, 0);
  }
});
test('dispose during recording stops tracks and never submits abandoned audio', async () => {
  const h = harness(); await h.capture.start(); h.capture.dispose();
  assert.equal(h.track.stopped, true); assert.equal(h.uploads.length, 0);
});
test('capture failures and oversized audio clean up and allow another attempt', async () => {
  for (const failure of ['device', 'size', 'recorder']) {
    const h = harness(); await h.capture.start();
    if (failure === 'device') h.track.onended();
    else if (failure === 'recorder') h.recorders[0].onerror();
    else h.recorders[0].ondataavailable({ data: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]) });
    assert.equal(h.track.stopped, true); assert.equal(h.uploads.length, 0); assert.equal(h.errors.length, 1);
    await h.capture.start(); assert.equal(h.recorders.length, 2); h.capture.dispose();
  }
});
test('20 second cap sends final recording once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); await h.capture.start();
  t.mock.timers.tick(19999); assert.equal(h.uploads.length, 0);
  t.mock.timers.tick(1); assert.equal(h.uploads.length, 1); assert.equal(h.track.stopped, true);
  h.capture.dispose();
});
test('permission timeout unlocks input and discards eventual device access', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve;
  const h = harness({ mediaDevices: { getUserMedia: () => new Promise(r => { resolve = r; }) } });
  const start = h.capture.start(); t.mock.timers.tick(30000);
  assert.equal(h.states.at(-1), 'idle'); assert.match(h.errors[0], /still pending/);
  resolve(h.stream); await start;
  assert.equal(h.track.stopped, true); assert.equal(h.uploads.length, 0);
});
