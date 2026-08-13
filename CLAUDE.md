# Tickodoro — Project Notes

A clean, minimal Pomodoro timer (Pomofocus-style) with one standout detail: a hypnotic, analog-clock ticking sound during focus sessions, synthesized live via the Web Audio API — no audio files.

## Tech Stack

Plain HTML / CSS / JS. No framework, no build step, no `package.json`.

- `index.html` — layout and markup
- `style.css` — theming via CSS variables (drives per-pack color switching)
- `app.js` — timer logic, Web Audio tick engine, task state, history/stats, localStorage persistence (~1,230 lines, single file)

`app.js` is organized into clearly commented sections, in order: storage helpers, theme + sound packs, `TickEngine` (Web Audio scheduler), timer state, DOM references, rendering, heatmap, timer control, then event wiring split by concern (timer, visibility recovery, theme/pack, tasks, settings, stats), and init.

## Core Features (all implemented)

1. **Timer core** — start / pause / reset, auto-switches between focus and break, configurable durations (default 25 / 5 / 15 min)
2. **Task list** — add tasks, set estimated pomodoros per task, check off when done, track completed vs. estimated
3. **Ticking sound** — see spec below
4. **Session stats + history** — daily completed-pomodoro count plus a 12-week heatmap view
5. **Theme + sound packs** — six paired presets (see below), switchable from a pack picker in the UI

## Persistence

`localStorage`, no backend/auth. Keys are namespaced under `tickodoro.*` (see `STORAGE_KEYS` in `app.js`): settings (durations), tasks, active task, mute state, volume, daily stats, history, selected pack.

---

## Ticking Sound Spec (the detail that matters most)

**Reference feel:** A school study-hall / testing-center wall clock — dry, percussive, consistent, faintly hypnotic.

| Aspect | Spec |
|---|---|
| **Source** | Synthesized via Web Audio API — no audio files. Short noise burst (or, for some packs, a noise/tone hybrid) through a filter with a fast envelope to mimic a wood/mechanical tick, not a digital "blip" |
| **Pattern** | Alternate two subtly different timbres each second ("tick" / "tock") — slightly different filter frequency — to mimic a real escapement's left/right swing |
| **Timing** | Lookahead scheduler (`TickEngine` in `app.js`): a coarse `setInterval` wakes up periodically and schedules any ticks whose target time falls within the next `SCHEDULE_AHEAD_TIME` seconds, but the actual sound timing is always computed from `AudioContext.currentTime` plus an accumulator advancing in exact 1-second steps. Timer-thread jitter or background-tab throttling only affects how far in advance ticks get scheduled, never their audible timing. |
| **Scope** | Focus sessions only. Silent during all breaks. |
| **Volume** | User-configurable via a volume control; persisted to `localStorage`. |
| **Mute** | Persistent toggle visible in the main UI at all times. State saved to `localStorage`. |
| **Cleanup** | Tick stops instantly on pause/session end — no trailing tick, no overlap if a new session starts quickly |

**User gesture requirement:** Browsers block audio playback until a real user gesture (click/tap/keypress) occurs. The `AudioContext` is created (or torn down and recreated) directly inside the same click handler that starts the timer — not on page load, not in a mount hook, not a few steps downstream. Getting this wrong produces the classic bug where sound works on the second click but not the first.

---

## Theme + Sound Packs

Themes and tick sounds ship as paired presets — one "pack" selector, not independent mix-and-match dropdowns. Each pack is a single config object in `THEME_PACKS` (`app.js`): a CSS-variable set per timer mode plus the tick engine's filter/envelope params. Switching packs swaps which object `applyTheme()` / `tickEngine.setParams()` read from — no per-pack component logic.

| Pack | Feel | Tick voice |
|---|---|---|
| **Study Hall** (default) | Coral/teal/blue, warm off-white backgrounds | Bandpass noise click, ~2800/2200Hz — dry, classic wall clock |
| **Midnight Focus** | Dark mode — amber/mint/periwinkle on navy | Softer attack, longer decay, lower Q — muffled, heartbeat-like |
| **Watchmaker** | Graphite/sage/steel on off-white, silver dividers | Highpass noise, sharp attack, short decay — crisp, fine-instrument |
| **Forest Retreat** | Green/gold/blue on soft sage backgrounds | Hybrid: lowpass noise rustle layered with a low sine thump — knuckle-on-wood |
| **Neon Arcade** | Hot pink/cyan/yellow on deep purple | Bandpass noise, brighter/tighter than Study Hall, not electronic-sounding |
| **Cat Café** | Warm terracotta/brown/lavender; animated cat mascot with crossfade transitions between states | Lowpass noise, muffled — deliberately a cozy tick, not a meow |

Adding a pack is adding one object to `THEME_PACKS` — no new audio assets, no new component logic.

---

## Backgrounding / Screen-Lock Behavior

Locking or sleeping the screen during a focus session suspends (and on some mobile browsers, fully closes) the `AudioContext`, and freezes or throttles the display's `setInterval` loop. Both timer and tick recover on `visibilitychange` instead of requiring a page reload:

| Situation | Recovery |
|---|---|
| **Countdown display** | Remaining time is never derived from interval fire counts — it's always `endTimestamp - Date.now()`. On regaining visibility, this is recomputed and re-rendered immediately, before anything audio-related runs, so the number on screen is correct even if it was stale for minutes. |
| **Session ended while backgrounded** | If the recomputed remaining time is ≤ 0, the normal end-of-session flow (mode switch, stats/history update) fires immediately, exactly as if the countdown had reached zero in the foreground. |
| **AudioContext `suspended`** | `.resume()` is tried first on visibility regain (no gesture needed for a plain resume). iOS Safari has been observed leaving a locked-screen context in a state that doesn't reliably recover this way — state is re-checked after the resume attempt, and if it isn't confirmed `running`, this falls through to the tap affordance below instead of assuming success. |
| **AudioContext `closed`, Safari's nonstandard `interrupted`, or a resume that didn't confirm `running`** | Not silently recreated (browsers block context creation without a gesture). A "Tap to resume ticking" button appears; tapping it tears down whatever context exists and creates a fresh `AudioContext` synchronously inside that click handler. |
| **The Start/Pause button itself** | Every transition from paused → running tears down any existing `AudioContext` and builds a brand-new one inside that same click handler, rather than conditionally checking its state and trying to resume it. iOS can leave a screen-locked context in a state that looks alive but isn't; resetting on every real user gesture sidesteps that ambiguity. |
| **Tick scheduling after any recovery path** | The scheduler's lookahead clock is re-anchored to "now" (`resyncAfterBackground()`) rather than left to catch up — otherwise the lookahead loop would try to fire every tick that "should" have happened while backgrounded, producing a burst of ticks instead of a clean resume. Pending scheduled ticks are cancelled first to avoid overlap during rapid visibility changes. |
| **Scope guard** | Ticking only resumes if the session is still an active, unmuted focus session by the time visibility returns — if it switched to a break or ended while backgrounded, it stays silent. |
