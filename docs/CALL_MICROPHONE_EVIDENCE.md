# Chat reset, expiry, and microphone verification — 9 October 2026

## Findings and changes

- The saved Rauf call on the main backend closed with `inactivity_timeout`, after six
  customer messages. The original limits were 10 messages, 5 minutes total, and 2 minutes
  idle; a saved provider-pending message did not prevent later idle expiry.
- Limits now come from validated environment settings: 50 messages, 30 minutes total,
  and 10 minutes idle by default. They remain bounded and configurable. In-flight provider
  operations cannot be expired by concurrent business API requests. Provider failures
  refresh the idle retry window, retaining the existing retry/message semantics.
- The call read/end API includes actual configured limits. The frontend displays them,
  warns near a boundary, and explains the backend end reason.
- Closed chats have a Delete chat confirmation. The API client handles the existing
  development-only DELETE endpoint's empty 204 response, refreshes shared data, and navigates
  to the customer profile. Active calls must be ended first; production rejection remains.
- The microphone path now has distinct requesting/recording states, calls getUserMedia
  directly from the click, and handles secure-context restrictions, blocked browser/system
  permissions, absent or busy devices, capture errors, device disconnection, cancellation,
  and late permission resolution. Recording uses a supported MIME, 64 kbps target bitrate,
  periodic chunks, 20-second cap, and 2 MiB bound. Navigation/disposal releases capture
  without sending abandoned audio. Typed input returns after capture failures.

## Real-browser observations

Brave was inspected as a normal native browser, using its built-in MacBook microphone;
this was not an in-app-browser microphone test. The existing localhost:5173 site already
showed Microphone allowed. Such an origin need not show another permission prompt. Its
open chat was closed, which prevents further input.

The positive microphone test used a separate temporary SQLite database and backend on
localhost port 8001, with the existing configured AI provider:

1. Opened the synthetic Rauf profile, approved the offer, and started a call.
2. Clicking Start recording showed Brave's real “Use available microphones” prompt.
3. After allowing access for the current site lifetime, Brave displayed its active
   microphone indicator, and the app displayed Stop recording and the recording state.
4. Stopping capture submitted a real browser audio upload. The turn endpoint returned
   HTTP 200. The saved customer turn had an audio digest, a provider transcription and
   interpreted intent; a verified assistant reply was saved. Its generated speech
   endpoint also returned HTTP 200. The recording indicator stopped and the composer
   returned to typed input.

This recording was not a controlled English utterance; the returned transcript was
ambiguous and the backend correctly asked for clarification rather than recording a
customer decision. This verifies capture/upload/STT/reply/speech plumbing, not recognition
accuracy for a rehearsed spoken scenario. No customer recording was retained by the backend.

The in-app browser separately verified the closed-chat Delete confirmation and Cancel,
manual end, actual configured limits, and fresh chat creation after reset. Only the
disposable port-8001 chat was deleted through an HTTP client: DELETE returned 204 with
zero body bytes; customer profile returned `approved` and `previous_call: null`; clicking
Start in the browser created a new introduction for the same customer. The UI destructive
confirmation was not submitted against the user's saved history.

The main backend was gracefully restarted on port 8000 with the original configuration
and SQLite database. Its existing saved call remains unresolved with its original transcript
and end reason. Read API reports the new defaults. Vite port 5173 renders its new Delete
button and closure explanation, with no browser console errors observed.

Screenshots: [real Brave recording](microphone-brave.jpg),
[delete confirmation on disposable data](delete-chat-confirmation.jpg).

## Regression/build checks

- `.venv/bin/python -m unittest discover -s tests -v`: **7 passed**. Covers more than
  ten questions, duplicate-turn deduplication, configurable cap, explicit acceptance at
  the cap, manual-end preservation, idle/total expiry, concurrent expiry during provider
  work, provider failure/retry window, and delete/reset/new call.
- `npm --prefix frontend run test:microphone`: **8 passed**. Simulated device events
  cover immediate permission request, final audio chunk/MIME/upload cleanup, insecure
  origin, blocked permission and retry, late streams after cancel/dispose, abandoned
  recording cleanup, capture/size/device failures, exact 20-second cap, and pending
  permission timeout recovery.
- `npm --prefix frontend run build`: passed.
- `npm --prefix frontend run typecheck`: passed.
- `.venv/bin/ruff check backend tests`: passed.
- `git diff --check`: passed.

Physical permission denial, device removal, and the 20-second microphone cap were checked
with simulated events rather than exercised on the real device. Hosted HTTPS and a
controlled spoken acceptance rehearsal remain outside this local verification.
