# Pomodoro Timer — MVP Brief

## Vision
A clean, minimal Pomodoro timer (Pomofocus-style) with one standout detail: a hypnotic, analog-clock ticking sound during focus sessions. v1 ships one visual theme and one tick sound — architecture should make it easy to add more of both later.

---

## Visual Design
- **Style:** Clean & minimal, inspired by Pomofocus
- **Layout:** Big centered countdown as the focal point. Mode tabs above it (Pomodoro / Short Break / Long Break). Minimal chrome — no heavy shadows, no gradients, generous whitespace.
- **Color:** One accent color per mode, background tints to match:
  - Focus: red/coral
  - Short Break: teal/green
  - Long Break: blue
- **Typography:** Large, rounded sans-serif or monospace numerals for the countdown.

## Core Features (v1 scope)
1. **Timer core** — start / pause / reset, auto-switches between focus and break, configurable durations (default 25 / 5 / 15 min)
2. **Task list** — add tasks, set estimated pomodoros per task, check off when done, track completed vs. estimated
3. **Ticking sound** — see full spec below
4. **Session stats** — daily count of completed pomodoros, kept simple (v1.1 candidate if time is tight — timer + tasks + tick take priority)

## Persistence
- `localStorage` for: tasks, settings (durations), mute state, daily stats
- No backend/auth needed for MVP

---

## Ticking Sound Spec (the detail that matters most)

**Reference feel:** A school study-hall / testing-center wall clock — dry, percussive, consistent, faintly hypnotic.

| Aspect | Spec |
|---|---|
| **Source** | Synthesized via Web Audio API — no audio files. Short noise burst through a bandpass filter with a fast envelope (attack ~2ms, decay ~40–60ms) to mimic a wood/mechanical tick, not a digital "blip" |
| **Pattern** | Alternate two subtly different timbres each second ("tick" / "tock") — slightly different filter frequency — to mimic a real escapement's left/right swing. This alternation is what sells the hypnotic, analog feel. |
| **Timing** | Driven by `AudioContext.currentTime`, not `setInterval` — sample-accurate, immune to tab-throttling drift over a full 25-min session |
| **Scope** | Focus sessions only. Silent during all breaks. |
| **Volume** | Fixed, quiet, not user-configurable in v1 |
| **Mute** | Persistent toggle visible in the main UI at all times (not buried in settings). State saved to `localStorage`. |
| **Cleanup** | Tick must stop instantly on pause/session end — no trailing tick, no overlap if a new session starts quickly |

**Implementation note — user gesture requirement:** Browsers block audio playback until a real user gesture (click/tap/keypress) occurs. The `AudioContext` must be created (or resumed, if already created) **directly inside the same click handler** that starts the timer — not on page load, not in a `useEffect`/mount hook, not in a function called indirectly a few steps downstream. If the context is created earlier and only resumed later outside the gesture's call stack, some browsers still block it. Getting this wrong produces the classic bug where sound works on the second click but not the first.

**Why this matters:** this sound is the app's signature. Get the drift-free timing and the tick/tock alternation right and it makes the app feel alive; get it wrong (robotic, identical ticks, or laggy/drifting) and users mute it in the first ten seconds.

---

## Tech Stack
- Plain HTML / CSS / JS — no framework needed for this scope, keeps it portable
- **Structure:**
  - `index.html` — layout
  - `style.css` — theming via CSS variables (makes mode-color switching and future themes trivial)
  - `app.js` — timer logic, Web Audio tick engine, task state, localStorage persistence

## Roadmap (post-MVP)
- Additional visual themes
- Additional tick sound variations (swap filter/envelope params — no new assets needed)
- Volume slider
- Weekly/monthly stats view

---

## Theme + Sound Packs (post-MVP, next up)

Ship themes and tick sounds as curated **paired presets**, not independent mix-and-match options. Keeps the UI simple (one "pack" selector, not two separate dropdowns) and halves the QA surface.

### Pack 1 — Study Hall (existing v1 default)
- **Colors:** Focus `#E76F51` / bg `#FFF1EE` · Short Break `#2A9D8F` / bg `#EAF7F5` · Long Break `#457B9D` / bg `#EEF4F8`
- **Tick:** bandpass center ~2800Hz, Tock ~2200Hz, Q=8, decay 45ms — dry, percussive, classic wall clock

### Pack 2 — Midnight Focus (dark mode)
- **Colors:** Focus amber `#F2A65A` · Short Break mint `#6FCF97` · Long Break periwinkle `#8E9AAF` — all on bg `#1A1A2E`, text `#EDEDED`
- **Tick:** bandpass center ~1400Hz, Tock ~1100Hz, decay ~70ms, softer attack — muffled, heartbeat-like, late-night-library feel

### Pack 3 — Watchmaker (sharp/mechanical)
- **Colors:** Focus graphite `#3D3D3D` · Short Break sage `#8FA998` · Long Break steel blue `#5C7C99` — all on bg `#F7F7F5`, silver `#C4C4C4` accents/dividers instead of tinted backgrounds
- **Tick:** bandpass center ~3400Hz, Tock ~2900Hz, decay 30ms, sharper attack, wider tick/tock frequency gap — crisp, precise, fine-instrument feel

### Implementation note
Each pack should be a single config object (CSS variable set + filter/envelope params) so switching is a matter of swapping one object, not touching component logic. No new audio assets needed — every pack reuses the same synthesis engine from the MVP, just different parameters.

---

## Backgrounding / Screen-Lock Behavior

Locking or sleeping the screen during a focus session suspends (and on some mobile browsers, fully closes) the `AudioContext`, and freezes or throttles the display's `setInterval` loop. Both timer and tick recover on `visibilitychange` instead of requiring a page reload:

| Situation | Recovery |
|---|---|
| **Countdown display** | Remaining time is never derived from interval fire counts — it's always `endTimestamp - Date.now()`. On regaining visibility, this is recomputed and re-rendered immediately, before anything audio-related runs, so the number on screen is correct even if it was stale for minutes. |
| **Session ended while backgrounded** | If the recomputed remaining time is ≤ 0, the normal end-of-session flow (mode switch, stats/history update) fires immediately, exactly as if the countdown had reached zero in the foreground. |
| **AudioContext `suspended`** | Resumed via `.resume()` on visibility regain — no user gesture required for a resume of an already-created context. |
| **AudioContext `closed`/dead** | Not silently recreated (browsers block context creation without a gesture). A small "Tap to resume ticking" button appears; tapping it creates a fresh `AudioContext` inside that click handler and hands it to the tick engine. |
| **Tick scheduling after any recovery path** | The scheduler's lookahead clock is re-anchored to "now" (`resyncAfterBackground()`) rather than left to catch up — otherwise the lookahead loop would try to fire every tick that "should" have happened while backgrounded, producing a burst of ticks instead of a clean resume. |
| **Scope guard** | Ticking only resumes if the session is still an active, unmuted focus session by the time visibility returns — if it switched to a break or ended while backgrounded, it stays silent. |
