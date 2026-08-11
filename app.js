'use strict';

/* ---------------------------------------------------------------------- *
 *  Storage helpers
 * ---------------------------------------------------------------------- */

const STORAGE_KEYS = {
  settings: 'tickodoro.settings',
  tasks: 'tickodoro.tasks',
  muted: 'tickodoro.muted',
  volume: 'tickodoro.volume',
  stats: 'tickodoro.stats',
  history: 'tickodoro.history',
  activeTask: 'tickodoro.activeTaskId',
  pack: 'tickodoro.pack'
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------------------------------------------------------------------- *
 *  Theme + sound packs
 *
 *  Each pack is one config object: a CSS-variable set per timer mode plus
 *  the tick-engine's filter/envelope params. Switching packs is just
 *  swapping which object applyTheme()/tickEngine.setParams() read from —
 *  no component logic changes per pack.
 * ---------------------------------------------------------------------- */

const THEME_PACKS = {
  studyHall: {
    label: 'Study Hall',
    modes: {
      focus: { accent: '#E76F51', bg: '#FFF1EE' },
      short: { accent: '#2A9D8F', bg: '#EAF7F5' },
      long: { accent: '#457B9D', bg: '#EEF4F8' }
    },
    text: '#2C2420',
    textMuted: '#6B5F58',
    cardBg: '#FFFFFF',
    border: 'rgba(0, 0, 0, 0.08)',
    // plain bandpass noise click = a soft, warm library tick
    tick: { synth: 'noise', filterType: 'bandpass', tickFreq: 2800, tockFreq: 2200, q: 8, attack: 0.002, decay: 0.045, peak: 0.2 }
  },
  midnightFocus: {
    label: 'Midnight Focus',
    modes: {
      focus: { accent: '#F2A65A', bg: '#1A1A2E' },
      short: { accent: '#6FCF97', bg: '#1A1A2E' },
      long: { accent: '#8E9AAF', bg: '#1A1A2E' }
    },
    text: '#EDEDED',
    textMuted: '#A6A6BF',
    cardBg: '#22223B',
    border: 'rgba(255, 255, 255, 0.1)',
    // softer attack + longer decay + lower Q (broader passband) = the
    // muffled, heartbeat-like feel described in the brief
    tick: { tickFreq: 1400, tockFreq: 1100, q: 2.2, attack: 0.008, decay: 0.07, peak: 0.2 }
  },
  watchmaker: {
    label: 'Watchmaker',
    modes: {
      focus: { accent: '#3D3D3D', bg: '#F7F7F5' },
      short: { accent: '#8FA998', bg: '#F7F7F5' },
      long: { accent: '#5C7C99', bg: '#F7F7F5' }
    },
    text: '#2C2C2C',
    textMuted: '#7A7A7A',
    cardBg: '#FFFFFF',
    // silver accents/dividers instead of tinted backgrounds
    border: '#C4C4C4',
    // sharper attack + shorter decay + higher Q (narrower passband), plus a
    // highpass instead of bandpass filter, for a crisp, precise, fine-instrument feel
    tick: { synth: 'noise', filterType: 'highpass', tickFreq: 1900, tockFreq: 1600, q: 10, attack: 0.001, decay: 0.03, peak: 0.2 }
  },
  forestRetreat: {
    label: 'Forest Retreat',
    modes: {
      focus: { accent: '#4A7C59', bg: '#F1F5EC' },
      short: { accent: '#C9A227', bg: '#FAF6E8' },
      long: { accent: '#5B7FA6', bg: '#EDF2F7' }
    },
    text: '#2B3328',
    textMuted: '#6B7566',
    cardBg: '#FFFFFF',
    border: 'rgba(74, 124, 89, 0.15)',
    // hybrid voice: a lowpass noise rustle layered with a low sine thump,
    // like a knuckle knocking on wood
    tick: {
      synth: 'hybrid', filterType: 'lowpass',
      tickFreq: 1800, tockFreq: 1500, q: 3, attack: 0.004, decay: 0.05, peak: 0.16,
      thump: { freq: 95, waveform: 'sine', attack: 0.001, decay: 0.09, peak: 0.14 }
    }
  },
  neonArcade: {
    label: 'Neon Arcade',
    modes: {
      focus: { accent: '#FF2E63', bg: '#0D0221' },
      short: { accent: '#08D9D6', bg: '#0D0221' },
      long: { accent: '#EAEA00', bg: '#0D0221' }
    },
    text: '#F5F5F5',
    textMuted: '#9A8FBF',
    cardBg: '#1A0B3D',
    border: 'rgba(255, 46, 99, 0.25)',
    // ordinary bandpass noise click, tuned a bit brighter/tighter than
    // Study Hall so it's still distinct but not electronic-sounding
    tick: { synth: 'noise', filterType: 'bandpass', tickFreq: 3000, tockFreq: 2500, q: 12, attack: 0.001, decay: 0.035, peak: 0.2 }
  },
  catCafe: {
    label: 'Cat Café',
    modes: {
      focus: { accent: '#D97757', bg: '#FFF7ED' },
      short: { accent: '#8B6F47', bg: '#FBF3E7' },
      long: { accent: '#6B5B95', bg: '#F3F0F9' }
    },
    text: '#3D2B1F',
    textMuted: '#8C7B6B',
    cardBg: '#FFFFFF',
    border: 'rgba(140, 100, 60, 0.15)',
    // ordinary muffled noise click, same voice family as Midnight Focus —
    // deliberately not a meow/paw sound, just a cozy soft tick
    tick: { synth: 'noise', filterType: 'lowpass', tickFreq: 2000, tockFreq: 1700, q: 5, attack: 0.003, decay: 0.05, peak: 0.18 }
  }
};

const DEFAULT_PACK_ID = 'studyHall';

/* ---------------------------------------------------------------------- *
 *  Ticking sound engine
 *
 *  Uses the classic "lookahead scheduler" pattern: a coarse setInterval
 *  merely wakes us up periodically to schedule any ticks whose target
 *  time falls within the next SCHEDULE_AHEAD_TIME seconds. The actual
 *  sound timing is always computed from AudioContext.currentTime and an
 *  accumulator that advances in exact 1-second steps, so timer-thread
 *  jitter (or background-tab throttling of setInterval) never causes the
 *  audible ticks to drift — only how far in advance they get scheduled.
 * ---------------------------------------------------------------------- */

class TickEngine {
  constructor() {
    this.audioCtx = null;
    this.schedulerId = null;
    this.nextTickTime = 0;
    this.tickCount = 0;
    this.running = false;
    this.muted = false;
    this.volume = 1;
    this.activeNodes = [];
    this.params = THEME_PACKS[DEFAULT_PACK_ID].tick;

    this.LOOKAHEAD_MS = 25;
    this.SCHEDULE_AHEAD_TIME = 1.2; // seconds; must exceed background-tab throttle interval
    this.TICK_INTERVAL = 1.0; // seconds between ticks
  }

  // Must be called with an AudioContext created inside a user-gesture
  // click handler. Safe to call repeatedly (no-op after the first time).
  init(audioCtx) {
    this.audioCtx = audioCtx;
  }

  setMuted(muted) {
    this.muted = muted;
  }

  // volume is a 0..1 fraction, multiplied into each tick's peak gain.
  setVolume(volume) {
    this.volume = volume;
  }

  // Swaps the active pack's filter/envelope params. Just numbers — safe to
  // call any time, including before the AudioContext exists.
  setParams(params) {
    this.params = params;
  }

  start() {
    if (!this.audioCtx || this.running) return;
    this.running = true;
    this.tickCount = 0;
    this.nextTickTime = this.audioCtx.currentTime + 0.05;
    this._scheduleLoop();
  }

  stop() {
    this.running = false;
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this._silenceImmediately();
  }

  _scheduleLoop() {
    const tick = () => {
      if (!this.running || !this.audioCtx) return;
      while (this.nextTickTime < this.audioCtx.currentTime + this.SCHEDULE_AHEAD_TIME) {
        this._playTick(this.nextTickTime, this.tickCount % 2 === 0);
        this.tickCount++;
        this.nextTickTime += this.TICK_INTERVAL;
      }
    };
    tick();
    this.schedulerId = setInterval(tick, this.LOOKAHEAD_MS);
  }

  // Synthesizes one "tick" or "tock". Each pack picks a synth voice via
  // params.synth: a filtered-noise click ('noise', the default), an
  // oscillator blip ('tone'), or both layered together ('hybrid'). "tick"
  // and "tock" use different center frequencies so the two alternate like
  // a real escapement's left/right swing.
  _playTick(time, isTick) {
    if (this.muted) return;
    const ctx = this.audioCtx;
    const p = this.params;
    const synth = p.synth || 'noise';

    const voices = [];
    if (synth === 'tone') {
      voices.push(this._makeToneVoice(ctx, time, isTick, p));
    } else if (synth === 'hybrid') {
      voices.push(this._makeNoiseVoice(ctx, time, isTick, p));
      voices.push(this._makeToneVoice(ctx, time, isTick, {
        tickFreq: p.thump.freq, tockFreq: p.thump.freq, waveform: p.thump.waveform,
        attack: p.thump.attack, decay: p.thump.decay, peak: p.thump.peak
      }));
    } else {
      voices.push(this._makeNoiseVoice(ctx, time, isTick, p));
    }

    const record = { voices };
    this.activeNodes.push(record);
    const cleanup = () => {
      const idx = this.activeNodes.indexOf(record);
      if (idx !== -1) this.activeNodes.splice(idx, 1);
      for (const v of voices) {
        try { v.source.disconnect(); v.gain.disconnect(); if (v.filter) v.filter.disconnect(); } catch (e) { /* already gone */ }
      }
    };
    voices[voices.length - 1].source.onended = cleanup;
  }

  // Short burst of white noise through a bandpass/highpass/lowpass filter
  // with a fast attack / short decay envelope — a dry, percussive click.
  _makeNoiseVoice(ctx, time, isTick, params) {
    const { tickFreq, tockFreq, q, attack, decay, peak, filterType } = params;
    const duration = attack + decay + 0.02;
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType || 'bandpass';
    filter.frequency.value = isTick ? tickFreq : tockFreq;
    filter.Q.value = q;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(peak * this.volume, time + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);

    noise.connect(filter);
    filter.connect(envelope);
    envelope.connect(ctx.destination);

    noise.start(time);
    noise.stop(time + duration);

    return { source: noise, gain: envelope, filter };
  }

  // Oscillator blip with an optional falling pitch, for an electronic
  // rather than percussive character.
  _makeToneVoice(ctx, time, isTick, params) {
    const { tickFreq, tockFreq, waveform, pitchDrop, attack, decay, peak } = params;
    const duration = attack + decay + 0.02;
    const freq = isTick ? tickFreq : tockFreq;

    const osc = ctx.createOscillator();
    osc.type = waveform || 'sine';
    osc.frequency.setValueAtTime(freq, time);
    if (pitchDrop) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freq - pitchDrop, 40), time + attack + decay);
    }

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(peak * this.volume, time + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);

    osc.connect(envelope);
    envelope.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + duration);

    return { source: osc, gain: envelope };
  }

  // Kills any in-flight or future-scheduled tick immediately so pause /
  // session-end never leaves a trailing tick or overlaps a fresh session.
  _silenceImmediately() {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    for (const record of this.activeNodes.slice()) {
      for (const v of record.voices) {
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setValueAtTime(0, now);
        } catch (e) { /* ignore */ }
        try {
          v.source.stop(now);
        } catch (e) { /* already stopped or never started */ }
      }
    }
    this.activeNodes = [];
  }
}

const tickEngine = new TickEngine();
let audioCtx = null;

/* ---------------------------------------------------------------------- *
 *  Timer state
 * ---------------------------------------------------------------------- */

const MODE_ORDER = ['focus', 'short', 'long'];
const MODE_LABELS = { focus: 'Pomodoro', short: 'Short Break', long: 'Long Break' };
const DEFAULT_SETTINGS = { focus: 25, short: 5, long: 15 };

let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON(STORAGE_KEYS.settings, {}));
let muted = loadJSON(STORAGE_KEYS.muted, false);
let volume = Math.max(0, Math.min(100, loadJSON(STORAGE_KEYS.volume, 100)));
let tasks = loadJSON(STORAGE_KEYS.tasks, []);
let activeTaskId = loadJSON(STORAGE_KEYS.activeTask, null);
let stats = loadJSON(STORAGE_KEYS.stats, { date: todayKey(), count: 0 });
let history = loadJSON(STORAGE_KEYS.history, {});

const savedPackId = loadJSON(STORAGE_KEYS.pack, DEFAULT_PACK_ID);
let currentPackId = THEME_PACKS[savedPackId] ? savedPackId : DEFAULT_PACK_ID;

let currentMode = 'focus';
let focusSessionsCompleted = 0; // used to decide short vs. long break
let remainingSeconds = settings[currentMode] * 60;
let timerRunning = false;
let endTimestamp = null; // epoch ms; remaining time is derived from this, not decremented
let displayIntervalId = null;

tickEngine.setMuted(muted);
tickEngine.setVolume(volume / 100);
tickEngine.setParams(THEME_PACKS[currentPackId].tick);

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayKey() {
  return dateKey(new Date());
}

function ensureStatsFresh() {
  const key = todayKey();
  if (stats.date !== key) {
    stats = { date: key, count: 0 };
    saveJSON(STORAGE_KEYS.stats, stats);
  }
}

/* ---------------------------------------------------------------------- *
 *  DOM references
 * ---------------------------------------------------------------------- */

const bodyEl = document.body;
const countdownEl = document.getElementById('countdown');
const startPauseBtn = document.getElementById('start-pause-btn');
const resetBtn = document.getElementById('reset-btn');
const modeTabs = Array.from(document.querySelectorAll('.mode-tab'));
const muteToggle = document.getElementById('mute-toggle');
const volumeSlider = document.getElementById('volume-slider');
const dailyCountEl = document.getElementById('daily-count');
const catMascotEl = document.getElementById('cat-mascot');

const taskForm = document.getElementById('task-form');
const taskInput = document.getElementById('task-input');
const taskEstInput = document.getElementById('task-est');
const taskListEl = document.getElementById('task-list');

const packPicker = {
  wrap: document.querySelector('.pack-picker'),
  btn: document.getElementById('pack-picker-btn'),
  valueEl: document.getElementById('pack-picker-value'),
  list: document.getElementById('pack-picker-list'),
  options: Array.from(document.querySelectorAll('.pack-picker-option'))
};

const settingsBtn = document.getElementById('settings-btn');
const settingsDialog = document.getElementById('settings-dialog');
const settingsForm = document.querySelector('.settings-form');
const settingFocus = document.getElementById('setting-focus');
const settingShort = document.getElementById('setting-short');
const settingLong = document.getElementById('setting-long');

const statsBtn = document.getElementById('stats-btn');
const statsDialog = document.getElementById('stats-dialog');
const statsCloseBtn = document.getElementById('stats-close-btn');
const heatmapEl = document.getElementById('heatmap');
const statsSummaryEl = document.getElementById('stats-summary');
const heatmapDetailEl = document.getElementById('heatmap-detail');

/* ---------------------------------------------------------------------- *
 *  Rendering
 * ---------------------------------------------------------------------- */

function formatTime(totalSeconds) {
  const m = Math.max(0, Math.floor(totalSeconds / 60));
  const s = Math.max(0, Math.floor(totalSeconds % 60));
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderCountdown() {
  countdownEl.textContent = formatTime(remainingSeconds);
  document.title = `${formatTime(remainingSeconds)} · ${MODE_LABELS[currentMode]}`;
}

function renderMode() {
  bodyEl.dataset.mode = currentMode;
  modeTabs.forEach((tab) => {
    const isActive = tab.dataset.mode === currentMode;
    tab.setAttribute('aria-selected', String(isActive));
  });
  applyTheme();
}

// Pushes the active pack's colors for the current mode onto the CSS
// custom properties every themed rule in style.css reads from.
function applyTheme() {
  const pack = THEME_PACKS[currentPackId];
  const modeColors = pack.modes[currentMode];
  const root = document.documentElement.style;
  root.setProperty('--accent', modeColors.accent);
  root.setProperty('--bg', modeColors.bg);
  root.setProperty('--text', pack.text);
  root.setProperty('--text-muted', pack.textMuted);
  root.setProperty('--card-bg', pack.cardBg);
  root.setProperty('--border', pack.border);
  catMascotEl.classList.toggle('visible', currentPackId === 'catCafe');
}

function renderPackSelect() {
  const pack = THEME_PACKS[currentPackId];
  packPicker.valueEl.textContent = pack.label;
  packPicker.options.forEach((opt) => {
    opt.setAttribute('aria-selected', String(opt.dataset.pack === currentPackId));
  });
}

function renderStartPauseButton() {
  startPauseBtn.textContent = timerRunning ? 'Pause' : 'Start';
}

function renderMute() {
  muteToggle.setAttribute('aria-pressed', String(muted));
}

function renderVolume() {
  volumeSlider.value = String(volume);
}

function renderStats() {
  ensureStatsFresh();
  dailyCountEl.textContent = String(stats.count);
}

/* ---------------------------------------------------------------------- *
 *  Heatmap (12-week pomodoro history)
 * ---------------------------------------------------------------------- */

const HEATMAP_WEEKS = 12;
const HEATMAP_LEVELS = 4;

function buildHeatmapCells() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - (HEATMAP_WEEKS * 7 - 1));
  rangeStart.setDate(rangeStart.getDate() - rangeStart.getDay()); // back up to the Sunday that starts this week

  const cells = [];
  const cursor = new Date(rangeStart);
  while (cursor <= today) {
    const key = dateKey(cursor);
    cells.push({ date: new Date(cursor), key, count: history[key] || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

function levelFor(count, maxCount) {
  if (count <= 0 || maxCount <= 0) return 0;
  return Math.max(1, Math.min(HEATMAP_LEVELS, Math.ceil((count / maxCount) * HEATMAP_LEVELS)));
}

function renderHeatmap() {
  const cells = buildHeatmapCells();
  const total = cells.reduce((sum, c) => sum + c.count, 0);
  const maxCount = cells.reduce((max, c) => Math.max(max, c.count), 0);

  heatmapDetailEl.textContent = '';

  heatmapEl.innerHTML = '';
  for (const cell of cells) {
    const div = document.createElement('div');
    div.className = 'heat-cell';
    div.dataset.level = String(levelFor(cell.count, maxCount));
    const label = `${cell.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}: ${cell.count} pomodoro${cell.count === 1 ? '' : 's'}`;
    div.title = label;
    div.dataset.label = label;
    div.setAttribute('aria-label', label);
    div.tabIndex = 0;
    heatmapEl.appendChild(div);
  }

  statsSummaryEl.textContent = total === 0
    ? 'No pomodoros yet — complete a focus session to start your history.'
    : `${total} pomodoro${total === 1 ? '' : 's'} in the last ${HEATMAP_WEEKS} weeks`;
}

function renderTasks() {
  taskListEl.innerHTML = '';
  for (const task of tasks) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.done ? ' done' : '') + (task.id === activeTaskId ? ' active' : '');
    li.dataset.id = task.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', `Mark "${task.title}" done`);

    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;

    const progress = document.createElement('span');
    progress.className = 'task-progress';
    progress.textContent = `${task.completedPomodoros}/${task.estPomodoros}`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'task-delete';
    del.setAttribute('aria-label', `Delete "${task.title}"`);
    del.textContent = '×';

    li.append(checkbox, title, progress, del);
    taskListEl.appendChild(li);
  }
}

/* ---------------------------------------------------------------------- *
 *  Timer control
 * ---------------------------------------------------------------------- */

function setMode(mode, { resetTime = true } = {}) {
  currentMode = mode;
  if (resetTime) {
    remainingSeconds = settings[currentMode] * 60;
  }
  renderMode();
  renderCountdown();
}

function stopDisplayLoop() {
  if (displayIntervalId !== null) {
    clearInterval(displayIntervalId);
    displayIntervalId = null;
  }
}

function tickDisplay() {
  const remainingMs = endTimestamp - Date.now();
  remainingSeconds = Math.max(0, Math.round(remainingMs / 1000));
  renderCountdown();
  if (remainingMs <= 0) {
    completeSession();
  }
}

function startTimer() {
  if (timerRunning) return;
  timerRunning = true;

  // --- User-gesture requirement -----------------------------------------
  // This function is only ever invoked directly from the Start/Pause click
  // handler. The AudioContext is created (or resumed) right there, in that
  // same synchronous call stack — never on load, never in a mount hook —
  // so the browser always treats playback as gesture-initiated.
  // ------------------------------------------------------------------------

  endTimestamp = Date.now() + remainingSeconds * 1000;
  displayIntervalId = setInterval(tickDisplay, 200);

  if (currentMode === 'focus' && !muted) {
    tickEngine.start();
  }

  renderStartPauseButton();
}

function pauseTimer() {
  if (!timerRunning) return;
  timerRunning = false;
  stopDisplayLoop();
  tickEngine.stop();
  remainingSeconds = Math.max(0, Math.round((endTimestamp - Date.now()) / 1000));
  renderCountdown();
  renderStartPauseButton();
}

function resetTimer() {
  timerRunning = false;
  stopDisplayLoop();
  tickEngine.stop();
  remainingSeconds = settings[currentMode] * 60;
  renderCountdown();
  renderStartPauseButton();
}

function completeSession() {
  timerRunning = false;
  stopDisplayLoop();
  tickEngine.stop();

  if (currentMode === 'focus') {
    ensureStatsFresh();
    stats.count += 1;
    saveJSON(STORAGE_KEYS.stats, stats);
    renderStats();

    const key = todayKey();
    history[key] = (history[key] || 0) + 1;
    saveJSON(STORAGE_KEYS.history, history);

    focusSessionsCompleted += 1;
    const activeTask = tasks.find((t) => t.id === activeTaskId);
    if (activeTask && !activeTask.done) {
      activeTask.completedPomodoros += 1;
      saveJSON(STORAGE_KEYS.tasks, tasks);
      renderTasks();
    }

    const nextMode = focusSessionsCompleted % 4 === 0 ? 'long' : 'short';
    setMode(nextMode);
  } else {
    setMode('focus');
  }

  renderStartPauseButton();
}

/* ---------------------------------------------------------------------- *
 *  Event wiring — timer
 * ---------------------------------------------------------------------- */

startPauseBtn.addEventListener('click', () => {
  if (timerRunning) {
    pauseTimer();
    return;
  }

  // AudioContext must be created (or resumed) synchronously inside this
  // click handler — the one true user gesture that starts the timer.
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    tickEngine.init(audioCtx);
  } else if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  startTimer();
});

resetBtn.addEventListener('click', () => {
  resetTimer();
});

modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.dataset.mode === currentMode) return;
    timerRunning = false;
    stopDisplayLoop();
    tickEngine.stop();
    setMode(tab.dataset.mode);
    renderStartPauseButton();
  });
});

muteToggle.addEventListener('click', () => {
  muted = !muted;
  saveJSON(STORAGE_KEYS.muted, muted);
  tickEngine.setMuted(muted);
  renderMute();
  if (muted) {
    tickEngine.stop();
  } else if (timerRunning && currentMode === 'focus' && audioCtx) {
    tickEngine.start();
  }
});

volumeSlider.addEventListener('input', () => {
  volume = Math.max(0, Math.min(100, parseInt(volumeSlider.value, 10) || 0));
  saveJSON(STORAGE_KEYS.volume, volume);
  tickEngine.setVolume(volume / 100);
  if (muted) {
    muted = false;
    saveJSON(STORAGE_KEYS.muted, false);
    tickEngine.setMuted(false);
    renderMute();
    if (timerRunning && currentMode === 'focus' && audioCtx) {
      tickEngine.start();
    }
  }
});

/* ---------------------------------------------------------------------- *
 *  Event wiring — theme + sound pack
 * ---------------------------------------------------------------------- */

function selectPack(id) {
  if (!THEME_PACKS[id]) return;
  currentPackId = id;
  saveJSON(STORAGE_KEYS.pack, currentPackId);
  applyTheme();
  tickEngine.setParams(THEME_PACKS[currentPackId].tick);
  renderPackSelect();
}

function setFocusedPackOption(option) {
  packPicker.options.forEach((opt) => opt.classList.toggle('focused', opt === option));
  option.focus();
}

function openPackList() {
  packPicker.list.hidden = false;
  packPicker.btn.setAttribute('aria-expanded', 'true');
  const selected = packPicker.options.find((opt) => opt.dataset.pack === currentPackId) || packPicker.options[0];
  setFocusedPackOption(selected);
}

function closePackList({ refocusButton = false } = {}) {
  packPicker.list.hidden = true;
  packPicker.btn.setAttribute('aria-expanded', 'false');
  packPicker.options.forEach((opt) => opt.classList.remove('focused'));
  if (refocusButton) packPicker.btn.focus();
}

packPicker.btn.addEventListener('click', () => {
  const isOpen = packPicker.btn.getAttribute('aria-expanded') === 'true';
  if (isOpen) {
    closePackList();
  } else {
    openPackList();
  }
});

packPicker.options.forEach((opt) => {
  opt.addEventListener('click', () => {
    selectPack(opt.dataset.pack);
    closePackList({ refocusButton: true });
  });
});

packPicker.list.addEventListener('keydown', (e) => {
  const currentIndex = packPicker.options.findIndex((opt) => opt.classList.contains('focused'));

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = packPicker.options[(currentIndex + 1) % packPicker.options.length];
    setFocusedPackOption(next);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = packPicker.options[(currentIndex - 1 + packPicker.options.length) % packPicker.options.length];
    setFocusedPackOption(prev);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const focused = packPicker.options[currentIndex];
    if (focused) {
      selectPack(focused.dataset.pack);
      closePackList({ refocusButton: true });
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePackList({ refocusButton: true });
  } else if (e.key === 'Tab') {
    closePackList();
  }
});

document.addEventListener('click', (e) => {
  if (!packPicker.wrap.contains(e.target)) {
    closePackList();
  }
});

/* ---------------------------------------------------------------------- *
 *  Event wiring — tasks
 * ---------------------------------------------------------------------- */

function createTaskId() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = taskInput.value.trim();
  if (!title) return;
  const est = Math.max(1, Math.min(99, parseInt(taskEstInput.value, 10) || 1));

  const task = {
    id: createTaskId(),
    title,
    estPomodoros: est,
    completedPomodoros: 0,
    done: false
  };
  tasks.push(task);
  if (activeTaskId === null) {
    activeTaskId = task.id;
    saveJSON(STORAGE_KEYS.activeTask, activeTaskId);
  }
  saveJSON(STORAGE_KEYS.tasks, tasks);
  renderTasks();

  taskInput.value = '';
  taskEstInput.value = '1';
  taskInput.focus();
});

taskListEl.addEventListener('click', (e) => {
  const li = e.target.closest('.task-item');
  if (!li) return;
  const id = li.dataset.id;
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  if (e.target.matches('input[type="checkbox"]')) {
    task.done = e.target.checked;
    saveJSON(STORAGE_KEYS.tasks, tasks);
    renderTasks();
    return;
  }

  if (e.target.matches('.task-delete')) {
    tasks = tasks.filter((t) => t.id !== id);
    if (activeTaskId === id) {
      activeTaskId = tasks.length ? tasks[0].id : null;
      saveJSON(STORAGE_KEYS.activeTask, activeTaskId);
    }
    saveJSON(STORAGE_KEYS.tasks, tasks);
    renderTasks();
    return;
  }

  // Clicking the row itself (not the checkbox/delete) selects it as the
  // task the current/next focus session counts toward.
  activeTaskId = id;
  saveJSON(STORAGE_KEYS.activeTask, activeTaskId);
  renderTasks();
});

/* ---------------------------------------------------------------------- *
 *  Event wiring — settings
 * ---------------------------------------------------------------------- */

settingsBtn.addEventListener('click', () => {
  settingFocus.value = settings.focus;
  settingShort.value = settings.short;
  settingLong.value = settings.long;
  settingsDialog.showModal();
});

settingsForm.addEventListener('submit', () => {
  settings = {
    focus: Math.max(1, Math.min(180, parseInt(settingFocus.value, 10) || DEFAULT_SETTINGS.focus)),
    short: Math.max(1, Math.min(60, parseInt(settingShort.value, 10) || DEFAULT_SETTINGS.short)),
    long: Math.max(1, Math.min(120, parseInt(settingLong.value, 10) || DEFAULT_SETTINGS.long))
  };
  saveJSON(STORAGE_KEYS.settings, settings);
  if (!timerRunning) {
    remainingSeconds = settings[currentMode] * 60;
    renderCountdown();
  }
});

/* ---------------------------------------------------------------------- *
 *  Event wiring — stats
 * ---------------------------------------------------------------------- */

statsBtn.addEventListener('click', () => {
  renderHeatmap();
  statsDialog.showModal();
});

statsCloseBtn.addEventListener('click', () => {
  statsDialog.close();
});

heatmapEl.addEventListener('click', (e) => {
  const cell = e.target.closest('.heat-cell');
  if (!cell) return;
  heatmapDetailEl.textContent = cell.dataset.label;
});

/* ---------------------------------------------------------------------- *
 *  Init
 * ---------------------------------------------------------------------- */

function init() {
  renderPackSelect();
  renderMode();
  renderCountdown();
  renderStartPauseButton();
  renderMute();
  renderVolume();
  renderStats();
  renderTasks();
}

init();
