# TelsyAİ — AI telecom offer advisor

An integrated React/TypeScript dashboard and Python 3.12 FastAPI backend with SQLAlchemy/SQLite,
shared API contracts, a fictional catalog and customer histories, explainable rule-based
recommendations, employee approval, voice and typed AI conversations, saved outcomes,
temporary speech caching, dashboard estimates, and Render deployment configuration.
Backend and microphone regression checks are included.

## Run locally

From this repository's root:

```sh
cp .env.example .env
uv sync --locked
npm --prefix frontend ci
npm --prefix frontend run build
uv run python -m backend
```

Open [the integrated dashboard](http://127.0.0.1:8000),
[Swagger API contracts](http://127.0.0.1:8000/api/docs), or
[service health](http://127.0.0.1:8000/api/health).
Startup creates the seven tables in `data/telecom.db`. If all application tables are empty,
it seeds four fictional packages, 20 customers, and 60 usage records for the most recent
three completed UTC calendar months. It then generates recommendations in the same
transaction. No provider request runs at startup.
The initial fictional dataset yields 12 eligible recommendations and eight exclusions.

For development auto-reload:

```sh
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Without uv, create a Python 3.12 virtual environment, install `requirements.txt`, and
run `python -m backend` from the repository root. The lockfile pins the full dependency
graph; `requirements.txt` is its production-only export for the Docker image.

For frontend development, keep the backend running on port 8000 and run
`npm --prefix frontend run dev`. Open http://127.0.0.1:5173; Vite proxies `/api`
to `127.0.0.1:8000`. The production build is served directly by FastAPI on port 8000.
Build before starting (or restart) the backend so it mounts the frontend.

## Configuration

Copy `.env.example` to `.env` and set `OPENAI_API_KEY` for live AI access. Keep keys
on the server. Model names, voice, timeout, database path, host, port, and optional CORS
origins are configurable. The default models match the plan: `gpt-4.1-mini`,
`gpt-4o-mini-transcribe`, and `gpt-4o-mini-tts`.

The shared demo gate uses `Authorization: Bearer <DEMO_ACCESS_TOKEN>`. It is optional
locally and mandatory when `APP_ENV=production`. Swagger's **Authorize** control accepts
the demo token. `/api/health`, the documentation, and the root shell are public;
business endpoints require the gate when configured. `approved_by` is a display label,
not an authenticated employee account. The frontend verifies access against the backend
before opening the workspace; token-free development skips the gate automatically.
Only the shared demo token is stored in browser session storage.

`ai_configured` in health means a nonempty API key is configured. It does **not** mean
model access or billing has been verified. Provider failures never switch to fake AI.

## Implementation through Phase 5

- `backend/models.py`: all seven models, integer minor units, UTC timestamps,
  foreign keys, unique constraints, and basic data validation.
- `backend/schemas.py` and `backend/enums.py`: the frontend/backend contract.
- `backend/api.py`: health, recommendations, profiles, approval, voice/typed calls, and metrics.
- `backend/audio.py`: upload validation, bounded multipart requests, and temporary speech cache.
- `backend/dashboard.py`: outcome counts, rates, savings, and estimated staff time saved.
- `backend/seed.py`: four verified packages and deterministic customer usage histories.
- `backend/recommendations.py`: eligibility, offer selection, scoring, savings, reasons,
  and recommendation evidence; algorithm version `rules-v1`.
- `backend/reads.py` and `backend/serialization.py`: database reads and typed API mapping.
- `backend/workflow.py`: approval, call snapshots, retry-safe requests, transcript/result
  persistence, call limits, and manual ending.
- `backend/conversation.py`: authoritative state transitions, verified replies, and summaries.
- `backend/migrations.py`: additive upgrades for stored turn responses and audio retry hashes.
- `backend/providers.py`: real asynchronous structured intent extraction, transcription,
  and MP3 speech generation with sanitized provider errors and evidence validation.
- `backend/main.py`: lifespan initialization, optional CORS, error format, and optional
  built frontend serving.
- `frontend/`: supplied TelsyAİ design, live API adapters, approval/call workflow,
  retryable typed/audio input, generated speech, and dashboard metrics.
- `Dockerfile` and `render.yaml`: Node frontend build plus Python runtime and Render configuration.
- `docs/openapi.json`: generated API schema for frontend development without a running server.
- `docs/API_CONTRACT.md`: conventions, lifecycle rules, and representative payloads.

`GET /api/recommendations` returns ranked offers with optional case-insensitive name
search. `GET /api/customers/{customer_id}` returns usage, current/proposed package facts,
score components, reasons, and existing call/result information. Customers without an
offer have a `recommendation_diagnostic` explaining the exclusion. Unknown customers
return 404. Audio input, generated assistant speech, and dashboard metrics are operational.

Recommendations require contact permission, three consecutive valid months, allowance
overuse in at least two months, full coverage of both usage peaks, and at least 2 AZN
in estimated monthly savings. Extra charges must match this fictional catalog's overage
rates. The cheapest eligible offer wins; ties use data allowance, minute allowance,
and package ID. Ranking uses score descending, savings descending, and customer ID.

Money calculations use Decimal. The savings threshold and score use the unrounded
three-month average; response money and the final score round half-up. Score components
remain unrounded. Savings are historical estimates, and the rule-based score is not an
acceptance probability. Leyla's Everyday-to-Balanced offer has a 32.67 AZN average bill,
4.67 AZN estimated monthly savings, and a score of 81.

Restarting refreshes pending recommendations in place without duplicating data. Approved
or previously called recommendations are preserved. Usage dates are not shifted on a
restart; after a new month begins, missing recent history excludes a pending offer until
data is updated. Exclusion codes appear in customer profiles and are logged at INFO.

## Voice and typed call workflow

1. Approve a recommendation with `POST /api/recommendations/{id}/approve` and
   `{"approved_by":"demo_employee"}`. Repeating approval preserves the original label/time.
2. Start with `POST /api/calls`, supplying `recommendation_id` and a unique
   `start_request_id`. Retry with the same ID after an uncertain response.
3. Send customer messages to `POST /api/calls/{id}/turns` as multipart form fields
   `client_turn_id` and either `text` or `audio`. Reuse the same ID and input when retrying.
   Fetch speech for the introduction or any returned assistant turn at
   `GET /api/calls/{id}/turns/{turn_id}/audio`.
4. Read the saved transcript/result using `GET /api/calls/{id}`. End manually with
   `POST /api/calls/{id}/end` and `{}`.
5. To repeat a call for the same recommendation in development, use
   `DELETE /api/calls/{id}` after it closes. This returns `204`, removes its transcript
   and result, and restores the recommendation to `approved`. Start again with a new
   `start_request_id` (the old ID is also released, but a new one is clearer).

Call creation checks approval, current contact permissions, a still-valid recommendation,
one call per recommendation, and one active demo call globally. The call copies verified
package facts and usage evidence into an immutable snapshot. Running one worker and one
service instance is required for the in-process concurrency guard.
Call deletion returns `409` while a call or its turn processing is active, `404` for an
unknown ID, and `403` when `APP_ENV=production`. Deleted calls cannot be recovered.

Each transcribed or typed turn uses real structured intent extraction with `gpt-4.1-mini`, following
the official OpenAI Structured Outputs interface. The model selects an intent and
allowlisted fact keys; the backend supplies every reply and summary. Evidence quotes and
follow-up notes must match customer wording. Unsupported facts receive an employee-help
message. No model-generated prose is spoken or used as a package fact.

Consent permits discussion and never records acceptance. Initial interest asks an explicit
confirmation naming the package, allowances, and price. Only confirmation in that state
records accepted interest for employee processing. Questions or objections interrupt
confirmation and return to discussion, requiring a fresh confirmation before acceptance.
For accepted results, the employee can approve the package request for processing from the
call result panel. That saves the approval time and employee label; it does not activate the
package or change billing.
Rejection, follow-up, and employee requests can close the call at any stage.
Permission to hear an explanation, including "Sure, please tell me what you recommend",
advances to offer discussion without treating indirect question words as acceptance.
Replies use warmer language, shorter acknowledgments, and spoken units (gigabytes/manats)
while preserving the verified amounts and required confirmation. Reviewed seed FAQ sentences
have conversational equivalents; custom FAQ wording stays verbatim.

Transcripts are saved before awaiting AI, without holding a SQLite transaction open.
Provider failures preserve the pending customer message and return a sanitized error;
retry that message with its original ID, or end the call. A new message while one is
pending returns 409. Successful duplicate turns return their originally stored response,
even after later turns; fetch call state separately to see the latest status.

Calls close unresolved at the configured message/time limits or manual ending. Defaults:
`CALL_MAX_CUSTOMER_TURNS=50`, `CALL_SESSION_TIMEOUT_SECONDS=1800` (30 minutes), and
`CALL_IDLE_TIMEOUT_SECONDS=600` (10 minutes). Set 10/300/120 to restore the short demo
policy; restart the backend after changing configuration. Expiry is enforced on business
API reads/writes. In-flight provider operations are protected from expiry; failures refresh
the idle retry window. The workspace displays actual limits, warns near expiry, and explains
closure. Closed chats offer **Delete chat** with confirmation, using the existing development
reset endpoint; active chats must be ended first and production deletion remains prohibited.
Results contain outcome, summary, next action, follow-up wording, timestamps, and customer
evidence for confirmed decisions. End retries preserve existing outcomes. Optional
`interrupted_assistant_turn_id` on a turn/end request marks an assistant turn in that call.

Audio input accepts WebM, Ogg, MP4/M4A, WAV, and MP3 with matching MIME/container signatures.
Files are capped at 2 MiB and entire turn requests at 3 MiB, including chunked uploads.
The browser must enforce the plan's 20-second recording limit; the backend checks bytes
and signatures, rather than decoding duration. Customer audio is discarded after the
request. English STT uses `gpt-4o-mini-transcribe`. Empty/undecodable speech prompts a
new recording or typed input without inferring a decision.

Once transcription succeeds, its text and an audio SHA-256 hash are saved before intent
extraction. Retrying identical audio skips STT, and a completed duplicate returns the
original response. A different file with the same turn ID returns 409. A pending audio
turn can also be retried with its saved transcript as `text` and the same ID. If STT
fails before saving a transcript, record again or send typed input.

Speech uses `gpt-4o-mini-tts` and the configured voice, and accepts only a saved assistant
turn belonging to the call. MP3 responses carry `X-AI-Generated: true`; the frontend must
disclose AI speech. The `gpt-4o-mini-tts` model family is instructed to use a warm, calm
voice with natural pauses and read the saved reply without changing its words or numbers.
Legacy `tts-1` models omit these delivery instructions.
A private temporary directory holds at most 32 MiB of cached speech,
with a 5 MiB limit per reply and least-recently-used eviction. Cache keys include call
and turn creation timestamps, text, model, voice, and delivery instructions.
Call deletion purges cached speech;
process shutdown removes the directory. TTS failure leaves the saved reply/result intact
for text display and audio retry. Closed-call replies can still be fetched as audio.
Generated MP3 frames are checked before caching. Malformed audio returns
`invalid_speech_audio`; truncated or implausibly short speech returns
`incomplete_speech_audio`, both HTTP 502. Retry the audio GET while retaining the saved text.
The duration floor is deliberately conservative and cannot verify pronunciation or meaning.

`GET /api/dashboard` returns the top five ranked recommendations, outcome counts,
completion and acceptance rates (0 when their denominator is zero), potential monthly
savings, and savings on accepted offers from their immutable call snapshots. Accepted
and rejected calls save an assumed four staff minutes each; follow-up, human-request,
active, and unresolved calls contribute zero. All savings and staff time are estimates.

Set `OPENAI_API_KEY` and restart to exercise live conversations. Without a key, creation,
reading, dashboard metrics, and manual ending work. Provider operations return 503
`ai_not_configured`; typed transcripts remain retryable. No test code has been added.

Phase 5 used isolated synthetic databases and manual API requests, without adding executable
tests. Recommendation choices matched all 20 seeded profiles. Live intent matches improved
from 17/20 to 20/20 after fixes for need objections, conditional discounts, and prompt
injection. Final fact selections also matched the labeled cases. All four terminal outcomes,
retry behavior, approval, demo access, limits, expiry, and missing-key recovery were checked.
Two consecutive local voice workflows completed with real STT, interpretation, MP3 speech,
and saved acceptance. One earlier near-empty speech response led to the MP3 validation fix.
See [Phase 5 evidence](docs/PHASE5_EVIDENCE.md) for recorded outputs, timings, and limitations.
Microphone access was verified locally; hosted browser and microphone checks remain after deployment.

## Deploy to Render

1. Push this repository to your Git hosting account.
2. Create a Render Blueprint from the repository; it reads `render.yaml`.
3. Supply `OPENAI_API_KEY` when Render prompts for the secret.
4. Render generates `DEMO_ACCESS_TOKEN`; retrieve it from the service environment
   settings for the demo frontend gate.
5. Open the service URL, `/api/health`, and `/api/docs`.

The container runs one Uvicorn worker, binds to `0.0.0.0`, and uses Render's `PORT`.
The free service uses an ephemeral SQLite file: treat results as resettable demo data.
A hosted URL remains unverified until the Git repository and Render service are
connected. Deployment configuration is prepared; no service has been provisioned
by this implementation.

Render supplies managed TLS certificates for its `onrender.com` URL and redirects HTTP
traffic to HTTPS. The app uses a same-origin frontend/API path, so no browser CORS setup is
needed for the deployed demo; the microphone works on the HTTPS origin. For a custom domain,
add it in Render and configure the DNS records Render provides. The Blueprint trusts
Render's forwarded headers so FastAPI sees the original HTTPS scheme. Supply a valid
`OPENAI_API_KEY` and retain the generated `DEMO_ACCESS_TOKEN` as server-side secrets.

For a local container:

```sh
docker build -t telecom-offer-advisor .
docker run --rm --env-file .env -e APP_ENV=production -e HOST=0.0.0.0 -p 8000:8000 telecom-offer-advisor
```

Set a nonempty `DEMO_ACCESS_TOKEN` in `.env` before starting the production container.

## Frontend integration

The ZIP is extracted under `frontend/`. Live FastAPI integration is the default;
`VITE_DEMO_MODE=true` explicitly opts into the original synthetic preview. No API failure
silently switches to preview. `VITE_API_BASE_URL=/api` uses the same origin or Vite proxy.

Microphone permission and recording have separate visible states. Capture selects a
supported browser format, sends bounded chunks at stop or after 20 seconds, and releases
tracks on stop/cancel/navigation. Errors explain blocked permission, insecure origins,
missing devices, or unavailable devices. The microphone flow was verified locally in a normal browser.

Regression checks: `.venv/bin/python -m unittest discover -s tests -v` and
`npm --prefix frontend run test:microphone`.
The browser never receives the OpenAI key.

`frontend/src/lib/api.ts` maps the existing API contract to the supplied view models:
recommendation envelopes and package objects, flat customer profiles, score components,
`call_id`, saved offer snapshots, and dashboard outcome counts. Normal requests and MP3
fetches use `Authorization: Bearer <demo token>`. Approval and manual end send JSON bodies.
Customer turns use multipart form data.

Start retries retain their request ID. Failed/uncertain turns offer **Retry message** using
the same ID and input; reloading a pending saved transcript restores retry using its text.
A successful turn remains visible even if the follow-up read fails. The backend continues
to own approval, consent, explicit confirmation, package facts, and all outcomes.

Voice uses browser recording capped at 20 seconds and 2 MiB, with supported WebM/Ogg/MP4
formats and matching upload filenames. Permission denial, pending permission, or unsupported
recording preserves the typed fallback. Saved assistant replies request generated speech;
if autoplay is blocked, use **Play voice**. Stop/record/send/end interrupts playback and
reports the assistant turn to the backend. Navigating away releases microphone tracks,
recording timers, playback, and object URLs.

Hash routing preserves all four screens on reload. The Dockerfile builds React with Node 22
and copies `frontend/dist` into the Python runtime. `/api/*` routes retain precedence over
static assets. Render deployment is prepared; provisioning and hosted HTTPS/microphone
verification are separate from this local integration.

To refresh the committed frontend schema after changing contracts:

```sh
uv run python -c 'import json; from pathlib import Path; from backend.main import app; Path("docs/openapi.json").write_text(json.dumps(app.openapi(), indent=2) + "\n")'
```

To refresh the production requirements after changing dependencies:

```sh
uv lock
uv export --locked --no-dev --no-emit-project --format requirements-txt --output-file requirements.txt
```

Implementation references: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[transcription API](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create),
[speech generation](https://developers.openai.com/api/docs/guides/text-to-speech),
[FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/),
[SQLAlchemy SQLite](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html), and
[Render Blueprint specification](https://render.com/docs/blueprint-spec).
