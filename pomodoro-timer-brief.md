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
