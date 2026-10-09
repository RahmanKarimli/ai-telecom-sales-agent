# TelsyAİ frontend

The supplied v6 frontend is integrated with the existing FastAPI backend. See the root
[README](../README.md) and [API contract](../docs/API_CONTRACT.md).

## Development

Start the backend from the project root on port 8000, then:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Vite proxies `/api` to `127.0.0.1:8000`.
Copy `.env.example` to `.env` if you need explicit local settings. Live mode is the default:

```env
VITE_DEMO_MODE=false
VITE_API_BASE_URL=/api
```

A server with `DEMO_ACCESS_TOKEN` prompts for that shared token; a token-free development
server opens directly. The token is validated before access and sent as a Bearer header.
OpenAI credentials belong exclusively in the root backend environment.

## Build and hosting

```sh
npm run build
```

The root Dockerfile builds this app and copies `dist` into the Python runtime. Locally,
build before starting/restarting FastAPI. HashRouter preserves the four routes on reload:
Overview, Recommendations, Customer detail, and Call/result.

## API and voice

`src/lib/api.ts` adapts the real API response shapes to frontend view models. The established
backend schema is authoritative. Approval and End send JSON; turns send FormData. Start
and turn retries reuse request IDs, and saved pending messages can be retried after reload.

Calls show saved backend transcripts, verified facts, immutable offer snapshots, results,
and updated metrics. English conversation content remains unchanged; the supplied AZ/EN/RU
interface and visual design are retained.

When a customer explicitly confirms interest, the closed result offers **Approve package
change**. This records the employee's approval time and label for downstream processing.
It does not activate the package or change the customer's bill.

Microphone recording requires localhost or HTTPS. Recordings stop at 20 seconds and enforce
2 MiB before upload. Supported browser formats include WebM, Ogg, and MP4. Pending or denied
permission keeps typed input available. Assistant replies use live generated speech; if
browser autoplay is blocked, choose Play voice. Stopping playback, recording, sending, and
ending track interruptions. Failed speech never discards saved text or results.

## Chat reset and microphone checks

Closed chats include **Delete chat** with a confirmation explaining that the transcript
and result are removed. It calls development-only `DELETE /api/calls/{call_id}`, handles
the empty 204 response, refreshes metrics, and returns to the customer profile, where the
approved offer can start a fresh chat. End an active chat first. Production backends reject
deletion with a visible error.

The microphone UI distinguishes requesting permission from active recording. When permission
is already allowed, a browser can start recording without another prompt; when blocked, allow
Microphone in the site menu and system privacy settings. Cancelling permission or leaving the
chat releases late streams and submits no audio. Capture failures restore the typed composer.

Run `npm --prefix frontend run test:microphone` from the project root for regression checks.
These use simulated device events; microphone capture was also checked in a normal browser.

## Explicit preview

Set `VITE_DEMO_MODE=true` and restart/rebuild to use the original deterministic preview.
Preview outcomes live in sessionStorage and are explicitly labeled; no live API failure
switches to mock data. The backend integration uses database records instead.
