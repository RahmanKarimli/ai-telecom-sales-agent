# Frontend/backend integration evidence — 9 October 2026

Follow-up: [chat reset, configurable expiry, and real Brave microphone verification](CALL_MICROPHONE_EVIDENCE.md)
records subsequent changes, new regression tests, and the completed local capture/upload/STT/reply
check. The original-run limits below describe the initial integration, before that follow-up.

The supplied `telsyai-frontend-v6-slogan.zip` was extracted into `frontend/` and integrated
against `backend/schemas.py`, `docs/API_CONTRACT.md`, and the user-provided `PLAN.md`.
No backend source file was changed. The root backend `.env` and original database were
preserved. Browser outcome checks used an isolated temporary SQLite database on port 8001,
with the existing live OpenAI configuration and a temporary shared demo token. A second
isolated database on port 8003 tested missing-key failures. Only synthetic customer text
was submitted. Existing development backend data was read through Vite on port 5173.

## Changes

- Live API mode by default; explicit opt-in for the supplied deterministic preview.
- Bearer authentication on JSON, multipart, and generated speech requests; token validation
  before workspace access, including token-free local development.
- Frontend adapters for recommendation envelopes/package objects, flat customer responses,
  score components, call IDs/snapshots, and nested dashboard outcomes/savings/time metrics.
- Required JSON bodies for approval and manual end; structured backend error messages.
- ISO month rendering, stable usage keys, and display rounding for fractional scores.
- No invented email/segment fields; profiles without an offer show the backend diagnostic.
- Call reference uses the immutable saved offer snapshot.
- Start request IDs retained across retries and in-flight guards prevent duplicate actions.
- Failed/uncertain customer requests expose retry with the same ID/input. Reload restores
  retry from saved transcript text. Successful responses survive a subsequent read failure.
- Recording capped at 20 seconds and 2 MiB, supported MIME/filename matching, and cleanup
  of microphone tracks/timers. Pending permission can be cancelled and times out after
  15 seconds so it cannot indefinitely disable the typed fallback.
- Generated assistant speech with manual Play/Stop controls, autoplay fallback, interruption
  tracking on send/record/end, stale audio-request cancellation, and object URL cleanup.
- Active-call polling surfaces backend expiry without a reload.
- Multi-stage Dockerfile builds React using Node 22 and serves it from the existing Python app.

## Browser checks

Executed in the Codex in-app browser against real HTTP endpoints, with live AI intent
interpretation and speech generation on port 8001. No browser API responses were mocked.

| Check | Observed result |
| --- | --- |
| Invalid demo token | Access rejected; backend error text visible |
| Valid demo token | Workspace opens after server validation |
| Token-free local backend | Workspace opens without a token prompt |
| Dashboard and recommendation list | 12 recommendations; 101.51 AZN potential monthly savings |
| Name search and profile | Leyla selected; Jul/Aug/Sep usage, 81 score, 32.67 → 28.00 AZN comparison, 4.67 AZN saving |
| Approval → Start | Approved offer creates a saved introduction and call workspace |
| Consent | “Yes, you can explain” moves to offer discussion; no acceptance recorded |
| Package question | “How much does it cost?” returns “Balanced costs 28 manats a month.” with `price` fact key |
| Explicit confirmation | Initial interest asks a separate confirmation; confirmation records accepted interest |
| Accepted result reload | Transcript, outcome, summary, next action persist |
| Rejection | Rauf: `rejected`; no package/bill change |
| Follow-up | Elvin: `follow_up_requested`; “tomorrow” saved as a note; no appointment promised |
| Typed fallback/human request | Zahra: `human_requested`; employee contact next action; no live transfer |
| Manual end | Fidan: `unresolved`, `manual_end` |
| Idle expiry | Murad: `unresolved`, `inactivity_timeout`; UI updates without reload |
| Updated dashboard | Six started, four completed; one of each completed outcome; 25% acceptance; 8 estimated staff minutes; 4.67 AZN accepted savings |
| Generated speech | Real speech fetched; Play voice shows Stop audio; Stop returns to Play voice |
| Interrupted replies | Sending while introduction/offer speech plays marks those saved turns interrupted |
| Pending microphone permission | Stop cancels permission wait and re-enables typed input |
| Missing AI key | Visible `OPENAI_API_KEY is not configured.`; saved customer turn retained; Retry offered |
| Retry and reload after failure | Repeated retry and reload leave one saved customer message; retry restored; End saves unresolved |
| Vite development proxy | Port 5173 renders real dashboard through existing backend on port 8000; no browser console errors observed |

Screenshots: [dashboard](integration-dashboard.jpg) and [outcomes](integration-outcomes.jpg).

## Build and packaging checks

- `npm --prefix frontend run build`: passed (TypeScript project build plus Vite production bundle).
- `npm --prefix frontend run typecheck`: passed.
- `.venv/bin/ruff check backend`: passed.
- `git diff --check`: passed.
- `docker build -t telsyai-integration-check .`: passed, including `npm ci` and Node 22 build.
- Production container on localhost port 8004: frontend HTTP 200, health HTTP 200,
  dashboard without token HTTP 401, dashboard with Bearer token HTTP 200 and expected
  seeded metrics. Container used disposable data and no OpenAI credentials.

## Remaining verification limits

The in-app browser did not finish its microphone permission request. Cancellation and
fallback were verified, but no microphone recording, actual browser WebM upload, or new
STT voice conversation was completed in this integration run. Those require microphone
permission and a spoken synthetic customer scenario in a supported browser. The 20-second
recording cap was implemented and inspected, but not exercised on an active microphone.
Generated speech playback/Stop controls were verified; pronunciation was not human-reviewed.

A hosted HTTPS service was not provisioned or deployed. Hosted microphone/permission,
autoplay, latency, and two consecutive complete voice rehearsals remain unverified.
No timeout injection, physical microphone denial, or successful uncertain-network retry
was claimed; missing-key recovery and saved-message deduplication were exercised directly.
No executable test suite or additional test dependency was added.
