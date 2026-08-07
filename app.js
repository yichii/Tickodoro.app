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
    tick: { tickFreq: 2800, tockFreq: 2200, q: 8, attack: 0.002, decay: 0.045, peak: 0.2 }
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
    // sharper attack + shorter decay + higher Q (narrower passband) = the
    // crisp, precise, fine-instrument feel described in the brief
    tick: { tickFreq: 3400, tockFreq: 2900, q: 10, attack: 0.001, decay: 0.03, peak: 0.2 }
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

  // Synthesizes one dry, percussive "tick" or "tock": a short burst of
  // white noise through a bandpass filter with a fast attack / short decay
  // envelope. "tick" and "tock" use different filter center frequencies so
  // the two alternate like a real escapement's left/right swing.
  _playTick(time, isTick) {
    if (this.muted) return;
    const ctx = this.audioCtx;
    const { tickFreq, tockFreq, q, attack, decay, peak } = this.params;

    const margin = 0.02;
    const duration = attack + decay + margin;
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = isTick ? tickFreq : tockFreq;
    bandpass.Q.value = q;

    const envelope = ctx.createGain();

    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(peak * this.volume, time + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);

    noise.connect(bandpass);
    bandpass.connect(envelope);
    envelope.connect(ctx.destination);

    const stopAt = time + duration;
    noise.start(time);
    noise.stop(stopAt);

    const record = { source: noise, gain: envelope };
    this.activeNodes.push(record);
    noise.onended = () => {
      const idx = this.activeNodes.indexOf(record);
      if (idx !== -1) this.activeNodes.splice(idx, 1);
      try { noise.disconnect(); bandpass.disconnect(); envelope.disconnect(); } catch (e) { /* already gone */ }
    };
  }

  // Kills any in-flight or future-scheduled tick immediately so pause /
  // session-end never leaves a trailing tick or overlaps a fresh session.
  _silenceImmediately() {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    for (const node of this.activeNodes.slice()) {
      try {
        node.gain.gain.cancelScheduledValues(now);
        node.gain.gain.setValueAtTime(0, now);
      } catch (e) { /* ignore */ }
      try {
        node.source.stop(now);
      } catch (e) { /* already stopped or never started */ }
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

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
