# Orbit 2.0 — changes from the prior frontend

This is an in-place upgrade of the existing hackathon prototype. The four React routes, API types, fictional data, scoring, approval gate, and call workflow remain.

## What's new
- AZ / EN / RU controls on top bar and demo access screen; defaults to AZ and persists in `localStorage`.
- Translation dictionary and language context in `src/i18n/`. Site headings, labels, statuses, buttons, action descriptions, table headings, usage dates and demo notices are translated. Backend-supplied English call content stays English (not silently translated into a verified utterance). Quick-reply labels are translated for convenience but send their canonical English intent text.
- Dark editorial sidebar; brighter teal + pale-lime accents; responsive hero with animated signal rings, equalizer and floating chips; staggered screen entrances; bar-growth and card hover effects; live activity indicator.
- Accessibility: keyboard focus remains visible, locale buttons use `aria-pressed`, motion respects OS `prefers-reduced-motion` setting.

## Start on Windows PowerShell
1. Extract ZIP. Enter the directory that contains `package.json` (not its parent).
2. `npm.cmd install`
3. `npm.cmd run dev`
4. Open `http://localhost:5173/`.

If Vite picks a different port, use the **Local** URL printed in the terminal.

## QA
- Check AZ, EN, RU on Dashboard, Recommendations, Customer detail, AI call.
- Refresh browser to confirm language is retained.
- Change status filter, search customers, approve one, start a call, send quick replies, confirm interest; return to Overview and inspect outcome.
- Manually end an open call, ensure result is unresolved.
- Check mobile navigation and `prefers-reduced-motion` mode.

## Limitations
- No real voice AI or telephony in demo mode. Live STT / LLM / TTS require backend integration.
- The original PLAN.md specifies English voice conversations. Three-language dashboard does **not** change the server-side OpenAI prompts or TTS locale. Transcript payloads and text typed by users are presented verbatim.
- No fabricated accuracy metrics or package activation.
