# API contract v0.5.0

The machine-readable contract is `openapi.json` beside this file and the live
`/api/openapi.json` endpoint. Health, recommendations, customer profiles, approval,
voice/typed calls, assistant speech, and dashboard metrics are operational.

## Common conventions

- All routes start with `/api`.
- Integer IDs are positive. Request IDs are 1–100 characters using letters, digits,
  hyphens, or underscores; UUID strings work. Generate them client-side.
- Money is an integer in minor units: `2800` means `28.00 AZN`. No floats for money.
- Dates use ISO 8601. Usage months use the first day, e.g. `2026-09-01`.
- Timestamps include the UTC offset. Transcripts sort by `sequence` ascending.
- Rates range from 0 to 1. A zero denominator yields a rate of 0.
- Name search uses `GET /api/recommendations?search=Leyla`. It matches literal substrings
  without case sensitivity, trims surrounding whitespace, and returns a filtered `total`.
- Supply the shared demo token as a Bearer header; never use the OpenAI key in the browser.
- Fetch audio using that same header, create a Blob object URL, then play it.

| Method | Route | Response model | Implementation phase |
| --- | --- | --- | --- |
| GET | `/health` | `HealthResponse` | 1 |
| GET | `/dashboard` | `DashboardResponse` | 4 |
| GET | `/recommendations` | `RecommendationListResponse` | 2 |
| GET | `/customers/{customer_id}` | `CustomerResponse` | 2 |
| POST | `/recommendations/{recommendation_id}/approve` | `RecommendationResponse` | 3 |
| POST | `/calls` | `StartCallResponse` | 3 |
| GET | `/calls/{call_id}` | `CallResponse` | 3 |
| DELETE | `/calls/{call_id}` | `204 No Content` | 3 (development only) |
| POST | `/calls/{call_id}/turns` | `TurnResponse` | 3 typed / 4 audio |
| GET | `/calls/{call_id}/turns/{turn_id}/audio` | MP3 (`audio/mpeg`) | 4 |
| POST | `/calls/{call_id}/end` | `CallResponse` | 3 |

## States and outcomes

Recommendations: `pending`, `approved`, `contacted`.

Calls: `active`, `completed`, `unresolved`. Conversation states:
`awaiting_consent`, `offer_discussion`, `awaiting_accept_confirmation`, `closed`.

Results: `accepted`, `rejected`, `follow_up_requested`, `human_requested`, `unresolved`.
The first four count as completed calls. Manual ending or expiry produces unresolved.
Accepted means confirmed interest for employee processing. Packages and bills do not change.

Turn roles are `customer` and `assistant`. The intent and fact-key allowlists are in
OpenAPI. Customer turns use `client_turn_id`; assistant turns use null. Responses use
`fact_keys`, while the database stores `fact_keys_json`. Snapshot/FAQ/score JSON columns
are likewise mapped to their typed API fields by backend services.

## Representative request/response shapes

Health, with no live provider verification:

```json
{
  "status": "ok",
  "phase": 5,
  "version": "0.5.0",
  "ai_configured": false,
  "resettable_demo_data": true
}
```

Approval request:

```json
{"approved_by": "demo_employee"}
```

Start request (reuse the same ID after an uncertain response):

```json
{"recommendation_id": 1, "start_request_id": "cebb07f5-e469-48ca-8624-8fe427ca7f73"}
```

Start response (illustrative IDs/timestamps):

```json
{
  "call_id": 1,
  "status": "active",
  "conversation_state": "awaiting_consent",
  "introduction_turn": {
    "id": 1,
    "call_id": 1,
    "sequence": 1,
    "role": "assistant",
    "text": "Hi, I'm an AI telecom advisor, and this is a simulated call. Is now a good time to talk about a package that could suit your usage?",
    "intent": null,
    "fact_keys": [],
    "interrupted": false,
    "created_at": "2026-10-08T12:00:00Z",
    "client_turn_id": null
  }
}
```

Turn input is `multipart/form-data`, including for typed messages:

```text
client_turn_id: 98ff1f56-61db-4acb-8831-c45ce68bde71
text: Yes, you can explain the offer.
interrupted_assistant_turn_id: 1  (optional)
```

Supply exactly one of `text` or `audio`. Reuse `client_turn_id` and the same input on retries.
A completed duplicate returns
its originally saved response, including the state/result at that turn. Fetch the call
separately for its latest state. Reusing an ID with different text or audio returns 409.
The turn response contains `customer_turn`, `assistant_turn`, `status`,
`conversation_state`, and nullable `result`. Fetch speech from
`/api/calls/{call_id}/turns/{assistant_turn.id}/audio`.

End request is `{}` or `{"interrupted_assistant_turn_id": 5}`. End retries must
preserve an existing result.

Error shape (also used for validation, authentication, and provider failures):

```json
{
  "detail": {
    "code": "approval_required",
    "message": "Employee approval is required before starting a call."
  }
}
```

## Conversation controller behavior

Before creating a call, verify employee approval, contact permissions, offer validity,
one active demo call globally, and the one-call-per-recommendation limit. Reusing a start
ID for the same recommendation returns the original call; reusing it for a different
recommendation is a conflict. Copy the package and recommendation evidence into an
immutable offer snapshot.

Serialize processing per call and keep SQLite transactions short; never await providers
inside a database transaction. Verify an interruption refers to an assistant turn in
this call. Outcome evidence must refer to a customer turn in the same call. Only explicit
confirmation in `awaiting_accept_confirmation` can record accepted interest; consent
or initial interest cannot do so. Reject new turns after closure.

Questions and objections during confirmation return to discussion; subsequent interest
requires a fresh confirmation. Simple consent never counts as acceptance. Unknown facts
use a verified-information limitation and offer to note an employee-help request.
An affirmative to that specific offer requests employee help, not package acceptance.
Question-word checks guard interest/acceptance, not consent: permission such as
"Sure, please tell me what you recommend" advances to `offer_discussion`.
Replies use conversational wording, say gigabytes/manats for clear speech, and retain
the exact verified amounts. Only reviewed seed FAQ sentences are paraphrased; custom
FAQ wording is returned verbatim. Replies contain at most two selected facts for
compound package questions.

Expire calls on business API reads/writes at five minutes total or two minutes idle.
After the tenth successfully processed customer turn, an otherwise active call closes
unresolved. Terminal decisions on that tenth turn retain their confirmed outcome.
Manual ending/expiry has no customer decision evidence. Terminal outcomes persist
exactly one result per call, and repeated end requests preserve it.

Customer transcripts are committed before intent extraction. An intent-provider failure leaves the
customer turn with null intent, no assistant response, and an error code on the call.
Retry the same message/ID; submitting another ID returns 409 `pending_turn`. Concurrent
submissions return 409 `turn_in_progress`. No SQLite transaction remains open during AI.
Calls can be read or manually ended while AI is running; a late decision cannot overwrite
a closed result. A small additive startup migration adds the internal `response_json`
column used for durable completed-response retries, and `input_audio_sha256` for audio
retries, to existing databases without deleting data.

In development, `DELETE /api/calls/{call_id}` removes a closed call, its turns, and its
result in one transaction. The recommendation returns to `approved` with its original
approval metadata, allowing a new `POST /api/calls` with a fresh `start_request_id`.
Deletion returns `204` without a body, `404` for an unknown call, `409` while the call
or turn processing is active, and `403` in production. All call history is lost.

Important error codes: `approval_required`, `contact_ineligible`, `stale_recommendation`,
`recommendation_already_called`, `active_call_exists`, `request_id_conflict`, `call_closed`,
`invalid_interruption`, `invalid_turn_input`, `pending_turn`, `turn_in_progress`,
`call_not_closed`, `development_only`.
Provider errors use 502/503/504 with `ai_not_configured`, `provider_timeout`,
`provider_unavailable`, `provider_rate_limited`, `provider_error`, `invalid_ai_output`,
`invalid_ai_evidence`, or `missing_ai_evidence`. Pending transcript IDs are available
in `GET /api/calls/{id}` after an uncertain or failed response.

## Phase 4 audio behavior

Upload `audio` as a multipart file with a matching MIME type and container signature:
WebM (`audio/webm`, `video/webm`), Ogg (`audio/ogg`, `application/ogg`), MP4/M4A
(`audio/mp4`, `video/mp4`, `audio/x-m4a`), WAV (`audio/wav`, `audio/x-wav`, `audio/wave`),
or MP3 (`audio/mpeg`, `audio/mp3`). MIME codec parameters are allowed. The backend sends a
canonical filename/type to STT and never trusts an uploaded filename for a filesystem path.
The browser caps recordings at 20 seconds; the server checks file size rather than duration.

Files over 2 MiB return 413 `audio_too_large`. Entire turn bodies over 3 MiB return 413
`request_too_large`, enforced before multipart parsing even without Content-Length.
Empty audio returns 422 `empty_audio`; a type/signature mismatch returns 415
`unsupported_audio`; provider decode failure returns 422 `invalid_audio`. Empty STT text
returns 422 `empty_transcript`; transcripts over 4000 characters return 422
`transcript_too_long`. None creates a customer decision or assistant reply.

STT uses English and the configured transcription model. Successful transcription is
saved with its audio SHA-256 hash before intent extraction. Identical-audio retries use
that saved transcript rather than repeating STT. Retry a pending transcript using the
identical recording or the saved text and original `client_turn_id`. If STT itself fails,
there is no pending transcript; a new recording or typed input can be submitted.
One processing guard covers both STT and interpretation, so concurrent turns return 409.
Ending during STT cannot be overwritten by a late transcription or model decision.
Uploaded customer files are closed and discarded; only their transcript/hash persist.

`GET /api/calls/{call_id}/turns/{turn_id}/audio` returns MP3 bytes, `Content-Type: audio/mpeg`,
`Cache-Control: private, no-store`, and `X-AI-Generated: true`. The frontend must disclose
AI-generated speech. A missing/mismatched turn returns 404 `turn_not_found`; a customer
turn returns 422 `invalid_speech_turn`. Audio remains available for closed calls.
TTS reads only stored assistant text and changes no conversation state or result.
The `gpt-4o-mini-tts` model family receives warm, calm delivery instructions with natural
intonation and pauses, while being instructed to read the saved words and numbers unchanged.
Legacy `tts-1` models receive no unsupported delivery instructions.
On failure, retain the verified text and retry this GET; no fake speech is substituted.

The temporary speech cache is limited to 32 MiB with least-recently-used eviction;
one generated reply over 5 MiB returns 502 `speech_too_large`. Requests for the same
reply reuse its audio. Keys include IDs, creation timestamps, text, model, voice, and delivery instructions
to prevent stale audio after deletion/ID reuse. Call deletion purges its entries, and
shutdown removes the temporary directory. No SQLite transaction stays open during TTS.
Phase 5 validates MPEG Layer III frames and a conservative minimum speech duration
before caching. Malformed MP3 returns 502 `invalid_speech_audio`; truncated frames or
audio shorter than 0.1 seconds per supplied word (minimum 0.2 seconds) return
502 `incomplete_speech_audio`. Failed audio is not cached. Retry the same audio GET;
the saved transcript, conversation state, and outcome are preserved. This check does
not establish speech fidelity, pronunciation, or natural delivery.

Phase 5 intent fixes distinguish need objections from rejection, conditional discounts
from price objections, and invented-price instructions from verified package questions.
Unverified conditions request employee help; all existing schema and evidence checks remain.

## Phase 4 dashboard calculations

`GET /api/dashboard` reads current saved data after stale-call expiry:

- `recommended_customers`: recommendation count, including approved/contacted offers.
- `potential_monthly_savings_minor`: sum of all stored recommendation savings.
- `calls_started`: count of all remaining calls, including active and unresolved calls.
- `calls_completed`: accepted, rejected, follow-up, and human-request results on completed calls.
- `call_completion_rate`: completed / started; 0 when started is 0.
- `accepted_offers`: completed calls with accepted results.
- `acceptance_rate`: accepted / completed; 0 when completed is 0.
- `accepted_monthly_savings_minor`: accepted calls' snapshot savings, rather than mutable offers.
- `estimated_staff_minutes_saved`: (accepted + rejected) × 4; assumes 5 manual minutes minus
  1 employee review minute. Follow-up, human-request, unresolved, and active calls are excluded.
- `outcome_counts`: counts for all five outcomes; active calls have no outcome.
- `top_opportunities`: the first five recommendations in the usual ranking, with approval/call status.

Savings are historical estimates and staff time is an assumption. Development call deletion
removes the deleted call from every metric. No evaluation accuracy is inferred from match scores.

## Phase 2 read behavior

An empty database is seeded once with four packages, 20 customers, and three completed
UTC calendar months per customer. For an initial seed in October 2026, those months are
July, August, and September. Repeated startup refreshes only pending, uncalled
recommendations; approved and contacted records are preserved.

The recommendation list is ordered by score descending, estimated savings descending,
then customer ID ascending. Every item includes both packages, observed average bill,
estimated savings, the three score components, a backend-generated reason, approval
status, and nullable call ID/status. `total` is the number of matching recommendations.
No matches returns `{"items": [], "total": 0}`.

Customer profiles include up to three recent usage records, nullable recommendation,
nullable previous call, and `recommendation_diagnostic`. The diagnostic is null when
a recommendation exists; otherwise it contains `code`, `message`, and the three
`evaluated_months`. Codes cover contact exclusions, missing/invalid usage, inconsistent
charges, invalid current package, nonrecurring overuse, no covering alternative, and
insufficient savings. A nonexistent customer returns 404 `customer_not_found`.
Malformed usage rows are omitted from the typed usage array and prevent eligibility;
their exclusion diagnostic explains the issue. Invalid current package facts return
409 `invalid_customer_data` rather than publishing unverified package information.

Eligibility and scoring use the unrounded Decimal mean of historical extra charges.
Only response money and the final score round half-up. The minimum savings comparison
is inclusive at 200 minor units. Candidate ties use monthly price, data allowance,
minutes, and package ID, all ascending. Both observed peaks must be covered by an
active alternative. Historical overage is verified against the fictional rates.

For Leyla (`/api/customers/1` in a new demo database), the average bill is 3267 minor
units, proposed package Balanced costs 2800, savings are 467, and the match score is
81. Her three monthly extra charges are 1000, 1300, and 1500 minor units.
