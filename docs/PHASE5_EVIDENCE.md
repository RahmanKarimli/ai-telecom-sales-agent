# Phase 5 backend acceptance evidence

Date: 9 October 2026 (Asia/Baku). Backend version: 0.5.0.

The checks used fresh isolated SQLite databases, local HTTP requests, and real OpenAI
intent/STT/TTS calls with user-approved fictional content. The normal `data/telecom.db`
was not used for evaluation. No executable test files, test framework, or frontend changes
were added. These are observed manual results, not an automated regression suite.

## Fixes

- Need objections sometimes produced `reject` paired with `objection=need`, which the
  strict schema correctly rejected. The extraction instructions now distinguish an
  objection from an explicit decision to decline, and reinforce valid field combinations.
- Conditional interest involving unverified discounts now produces the verified-information
  limitation and employee-help option. It cannot become confirmed acceptance.
- Instructions to invent a package price now request the unsupported-information response
  instead of being interpreted as ordinary price objections. Only directly requested fact
  keys are selected; an immediate-activation question no longer adds unrelated contract facts.
- Follow-up notes extract the supplied time phrase, such as `tomorrow afternoon`.
- One initial TTS response contained only 0.36 seconds of MP3 for a full closing sentence.
  Generated MP3 frames and a conservative duration floor are now validated before caching.
  That recorded fixture returns `incomplete_speech_audio`; valid recorded replies pass.
  Invalid/incomplete speech returns HTTP 502 and leaves the text/result available for retry.

The MP3 frame-size calculation was cross-checked against the
[FFmpeg MPEG audio header decoder](https://ffmpeg.org/doxygen/trunk/mpegaudiodecheader_8c_source.html).
This lightweight check does not decode speech, detect every partial utterance, or establish
correct pronunciation; its purpose is to reject malformed and obviously near-empty output.

## Recommendations

Manual comparison of the seed profiles with coverage, contact eligibility, and historical
bill calculations: **20/20 offer/no-offer decisions and package choices matched**.
Twelve customers qualify, with total estimated monthly savings of 101.51 AZN.

| Customer | Expected and observed decision | Average bill / savings (AZN) | Score |
|---|---|---|---|
| Leyla | Balanced | 32.67 / 4.67 | 81 |
| Murad | Everyday | 28.67 / 8.67 | 100 |
| Aysel | Balanced | 30.00 / 2.00 | 67 |
| Rashad | Plus | 45.67 / 5.67 | 77 |
| Nigar | Balanced | 30.83 / 2.83 | 72 |
| Kamran | No recurring overuse | — | — |
| Farid | No package covers both usage peaks | — | — |
| Gunel | Insufficient savings | — | — |
| Elvin | Everyday | 31.83 / 11.83 | 100 |
| Sabina | Plus | 52.67 / 12.67 | 92 |
| Orkhan | Plus | 52.17 / 12.17 | 97 |
| Narmin | Do-not-contact | — | — |
| Tural | Contact not allowed | — | — |
| Sevil | No recurring overuse | — | — |
| Emin | No recurring overuse | — | — |
| Lala | Balanced | 35.00 / 7.00 | 91 |
| Samir | Insufficient savings | — | — |
| Zahra | Everyday | 31.50 / 11.50 | 100 |
| Rauf | Plus | 55.50 / 15.50 | 100 |
| Fidan | Everyday | 27.00 / 7.00 | 100 |

Observed ranked customer IDs: `19, 9, 18, 2, 20, 11, 10, 16, 1, 4, 5, 3`.
Score-100 ties follow descending savings. Case-insensitive trimmed name search returned
Leyla for `  LEY  `. Additional detached, unsaved data-quality checks returned the expected
diagnostics for a missing month, negative/nonfinite usage, inconsistent extra charges,
inactive current package, and no active covering alternative.

## Live intent evaluation

[Raw labeled cases and before/after outputs](phase5-intent-evaluation.json) record the
utterances, conversation state, latest assistant question, expected intent/facts, actual
decision, rendered reply, outcome, and elapsed time. Labels were recorded before evaluation.

| Measure | Initial run | After fixes |
|---|---|---|
| Intent matches | 17/20 | 20/20 |
| Intent plus exact requested fact selections | 16/20 | 20/20 |
| Invalid structured decisions | 2/20 | 0/20 |

Final intent requests took 0.97–2.20 seconds on this run. Every emitted text claim was
manually compared with the saved fictional offer and catalog. No invented package amounts
or conditions appeared. The invented `5 AZN` price never reached a factual reply.
Introductory consent did not record acceptance. Interest required a separate confirmation;
`Yes, but does it include roaming?` returned to discussion without acceptance, and `Thanks`
alone did not confirm interest. Unsupported discounts offered employee help.

The prompt was tuned against these cases. This small evaluation is evidence of observed
behavior, not an independent holdout accuracy estimate or a guarantee about other utterances.
A separate live paraphrase, `Would you give me a special discount if I agree?`, also produced
the limitation response; answering its employee-help question with `Yes, please` saved
`human_requested`.

## API and persistence checks

| Scenario | Observed result |
|---|---|
| Start without approval | 409 `approval_required` |
| Duplicate start with the same ID | Same call and introduction IDs |
| Reuse start ID for another recommendation | 409 `request_id_conflict` |
| Start while another call is active | 409 `active_call_exists` |
| Missing/wrong demo token | 401; authorized request succeeded; health remained public |
| Production call deletion | 403 `development_only` |
| Neither/both text and audio | 422 |
| Wrong MIME/container | 415 `unsupported_audio` |
| Audio larger than 2 MiB | 413 `audio_too_large` |
| Request larger than 3 MiB | 413 `request_too_large` |
| Unknown customer / nonpositive call ID | 404 / 422 |
| Retry a completed audio turn after closure | Original saved response, without new turns |
| Reuse turn ID for different input | 409 `request_id_conflict` |
| Submit new input to a closed call | 409 `call_closed` |
| Request speech for a customer turn | 422 `invalid_speech_turn` |
| Missing provider key | 503 `ai_not_configured`; pending typed transcript preserved |
| Real provider request with a 1 ms timeout | Sanitized 504 `provider_timeout` |
| Simultaneous requests for the same customer turn | One 200, one 409 `turn_in_progress`; retry returned saved IDs; one customer turn persisted |
| Retry pending input with its ID | Same durable pending turn; no duplicate transcript |
| Submit another input while one is pending | 409 `pending_turn` |
| Manual end and repeated End | One `unresolved` result with no decision evidence |
| End after acceptance | Accepted result preserved |
| Invalid interruption belonging to another call | 422; active call remained active |
| End with a valid interrupted assistant ID | Saved `unresolved` result and assistant `interrupted=true` |
| Two-minute inactivity / five-minute session expiry | `unresolved`, correct reason, no decision evidence |
| Ten successfully processed customer turns | Tenth reply closes `unresolved`, reason `turn_limit` |
| Cached assistant speech | Same bytes; observed cached fetch about 2 ms |
| Delete a closed development call | 204; approval retained; a new call could start |

Expiry was checked by moving timestamps only in disposable databases, then invoking the
normal read endpoint. The ten-turn limit used ten real interpreted customer messages.
Missing-key recovery used an empty configured key, without mocked provider responses.

All four supported terminal outcomes were saved with customer evidence and next actions:
accepted, rejected, follow-up requested, and human requested. Follow-up preserved
`tomorrow afternoon` without promising an appointment. Dashboard checks after five completed
calls showed two accepted, one rejected, one follow-up, one human request, acceptance rate
2/5, accepted estimated savings 6.67 AZN, and 12 estimated staff minutes saved. Subsequent
unresolved calls reduced completion rate and contributed no staff-time estimate.

## Voice scenarios

[Raw voice workflow evidence](phase5-voice-evaluation.json) includes initial and final runs,
saved turns/results, MP3 response sizes, timings, and supplementary speech retranscription.
The customer fixtures were locally generated English WAV files. This exercises the backend
audio transport and live providers without using a browser microphone.

After the speech fix, two consecutive workflows completed:

1. Consent → roaming question → initial interest → explicit confirmation → saved acceptance.
2. The same workflow for a second Balanced recommendation → saved acceptance.

All eight customer turn requests and generated MP3 replies succeeded. Consent remained
distinct from acceptance, and package/billing changes were never claimed. Text interpretation
and transcription took 2.16–4.46 seconds for the final voice runs; the exact per-turn
measurements are in the JSON. Combined processing and audio
fetch latency ranged **3.59–15.18 seconds**, median **6.04 seconds**. Six of eight replies
arrived within ten seconds. These exclude recording duration and audio playback time.

Supplementary STT recovered the complete assistant sentences and numeric amounts/allowances.
It sometimes normalized the spoken currency to dollar/pound symbols, and sometimes to
`manat`. That output cannot establish how the audio pronounced the currency. Human listening
is still required to judge currency pronunciation, tone, and natural delivery; no subjective
voice-quality pass is claimed here.

## Validation and remaining handoff

Ruff lint, formatting, Python compilation, generated OpenAPI, and offline lockfile
consistency checks passed. Backend metadata now reports Phase 5 / version 0.5.0.

The hosted HTTPS browser checklist remains for frontend integration: actual WebM microphone
capture, permission denial, playback and Stop behavior, page reload, and cross-browser audio
handling. A Render service has not been provisioned. Provider refusal, rate limiting, and
every kind of upstream outage were not deliberately induced in this pass. No hosted-browser
or universal provider-reliability claim is made.
