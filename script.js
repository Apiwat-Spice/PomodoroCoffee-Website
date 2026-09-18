

(function () {
  'use strict';

  /* ---------------------------------------------------------
     1. Constants & helpers
     --------------------------------------------------------- */
  const THEME_ORDER = ['light', 'dark', 'latte', 'matcha', 'blueberry'];

  const DEFAULT_SETTINGS = {
    theme: 'light',
    sound: 'classicBell',
    volume: 60,
    autoStart: false,
    enableAnimation: true,
    reducedMotion: false,
    durations: { focus: 25 * 60, short: 5 * 60, long: 15 * 60 },
  };

  // Coffee liquid geometry inside the SVG (must match the clipPath rect in index.html)
  const LIQUID_TOP_Y = 98;
  const LIQUID_BOTTOM_Y = 288;
  const LIQUID_RANGE = LIQUID_BOTTOM_Y - LIQUID_TOP_Y; // 190
  const LIQUID_LEFT_X = 78;
  const LIQUID_WIDTH = 144;

  const DRAIN_DURATION_MS = 2500; // how long the "coffee drains" animation takes on pause
  const RISE_DURATION_MS = 400; // how long the "coffee catches back up" animation takes on resume

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampInt(value, min, max) {
    let n = parseInt(value, 10);
    if (Number.isNaN(n)) n = min;
    return clamp(n, min, max);
  }

  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function formatTime(totalSeconds) {
    const secs = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function modeLabel(mode) {
    if (mode === 'focus') return 'Focus';
    if (mode === 'short') return 'Short Break';
    return 'Long Break';
  }

  /* ---------------------------------------------------------
     2. Settings — persisted to localStorage (non-sensitive only)
     --------------------------------------------------------- */
  const SETTINGS_KEY = 'pomodoroCoffeeSettings';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      const parsed = JSON.parse(raw);
      return {
        ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
        ...parsed,
        durations: {
          ...DEFAULT_SETTINGS.durations,
          ...(parsed.durations || {}),
        },
      };
    } catch (err) {
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
    } catch (err) {
      /* localStorage unavailable (e.g. private mode) — fail silently */
    }
  }

  function isReducedMotion() {
    return (
      currentSettings.reducedMotion ||
      (window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    );
  }

  function applySettingsToPage() {
    document.documentElement.setAttribute('data-theme', currentSettings.theme);
    document.body.classList.toggle(
      'reduced-motion',
      currentSettings.reducedMotion,
    );
    document.body.classList.toggle(
      'no-animation',
      !currentSettings.enableAnimation,
    );
  }

  let currentSettings = loadSettings();

  /* ---------------------------------------------------------
     3. Application state
     --------------------------------------------------------- */
  const state = {
    mode: 'focus', // 'focus' | 'short' | 'long'
    durations: { ...currentSettings.durations }, // seconds per mode
    totalDuration: currentSettings.durations.focus,
    remaining: currentSettings.durations.focus,

    isRunning: false,
    isPaused: false,
    isFinished: false,

    startTimestamp: null, // ms, Date.now() when current running stretch began
    elapsedBeforePause: 0, // ms accumulated from previous running stretches

    rafId: null,

    coffeeDisplay: 0, // 0-100, what's currently rendered in the cup
    coffeeAnimMode: 'idle', // 'idle' | 'sync' | 'drain' | 'rise'
    drainStart: 0,
    drainFrom: 0,
    riseStart: 0,
    riseFrom: 0,

    cyclesPerLongBreak: 4,
    focusSessionsSinceLongBreak: 0,
    pendingNextMode: 'short',
  };

  /* ---------------------------------------------------------
     4. DOM cache
     --------------------------------------------------------- */
  const el = {};

  function cacheDom() {
    el.srAnnouncer = document.getElementById('srAnnouncer');
    el.themeBtn = document.getElementById('themeBtn');
    el.settingsBtn = document.getElementById('settingsBtn');
    el.modeTabs = Array.from(document.querySelectorAll('.mode-tab'));
    el.cycleCount = document.getElementById('cycleCount');
    el.timeDisplay = document.getElementById('timeDisplay');
    el.cupStatus = document.getElementById('cupStatus');
    el.liquidFill = document.getElementById('liquidFill');
    el.liquidWave = document.getElementById('liquidWave');
    el.steamGroup = document.getElementById('steamGroup');

    el.presetRow = document.getElementById('presetRow');
    el.presetButtons = Array.from(document.querySelectorAll('.preset-btn'));
    el.customPresetBtn = document.getElementById('customPresetBtn');
    el.customTimeRow = document.getElementById('customTimeRow');
    el.customHours = document.getElementById('customHours');
    el.customMinutes = document.getElementById('customMinutes');
    el.customSeconds = document.getElementById('customSeconds');
    el.applyCustomTime = document.getElementById('applyCustomTime');

    el.startBtn = document.getElementById('startBtn');
    el.pauseBtn = document.getElementById('pauseBtn');
    el.resetBtn = document.getElementById('resetBtn');

    el.modalOverlay = document.getElementById('modalOverlay');
    el.modalCloseBtn = document.getElementById('modalCloseBtn');
    el.cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    el.saveSettingsBtn = document.getElementById('saveSettingsBtn');

    el.setFocus = document.getElementById('setFocus');
    el.setShort = document.getElementById('setShort');
    el.setLong = document.getElementById('setLong');
    el.setSound = document.getElementById('setSound');
    el.setVolume = document.getElementById('setVolume');
    el.testSoundBtn = document.getElementById('testSoundBtn');
    el.setTheme = document.getElementById('setTheme');
    el.setAutoStart = document.getElementById('setAutoStart');
    el.setEnableAnimation = document.getElementById('setEnableAnimation');
    el.setReducedMotion = document.getElementById('setReducedMotion');
  }

  /* ---------------------------------------------------------
     5. Rendering helpers
     --------------------------------------------------------- */
  function updateTimeDisplay() {
    el.timeDisplay.textContent = formatTime(state.remaining);
  }

  function announce(text) {
    el.cupStatus.textContent = text;
    el.srAnnouncer.textContent = `${text} — ${formatTime(state.remaining)}`;
  }

  function updateCupVisual(percent, ts) {
    const pct = clamp(percent, 0, 100);
    const fillHeight = (pct / 100) * LIQUID_RANGE;
    const fillY = LIQUID_BOTTOM_Y - fillHeight;

    el.liquidFill.setAttribute('x', LIQUID_LEFT_X);
    el.liquidFill.setAttribute('width', LIQUID_WIDTH);
    el.liquidFill.setAttribute('y', fillY.toFixed(2));
    el.liquidFill.setAttribute('height', Math.max(0, fillHeight).toFixed(2));

    // gentle life-like bob/drift on the surface wave, unless animation is off
    let bob = 0;
    let driftX = 0;
    if (currentSettings.enableAnimation && !isReducedMotion() && pct > 0.5) {
      bob = Math.sin(ts / 500) * 1.4;
      driftX = Math.sin(ts / 900) * 4;
    }
    el.liquidWave.setAttribute(
      'transform',
      `translate(${driftX.toFixed(2)}, ${(-fillHeight + bob).toFixed(2)})`,
    );
  }

  function updateModeTabsUI() {
    el.modeTabs.forEach((btn) => {
      btn.setAttribute(
        'aria-selected',
        btn.dataset.mode === state.mode ? 'true' : 'false',
      );
    });
  }

  function updateCycleDisplay() {
    const n =
      state.focusSessionsSinceLongBreak > 0
        ? state.focusSessionsSinceLongBreak
        : 1;
    el.cycleCount.textContent = `Pomodoro ${Math.min(n, state.cyclesPerLongBreak)} / ${state.cyclesPerLongBreak}`;
  }

  function updatePresetActiveState() {
    const totalMinutes = state.durations[state.mode] / 60;
    let matched = false;
    el.presetButtons.forEach((btn) => {
      if (btn.dataset.minutes === 'custom') return;
      const isMatch = Number(btn.dataset.minutes) === totalMinutes;
      btn.classList.toggle('active', isMatch);
      if (isMatch) matched = true;
    });
    el.customPresetBtn.classList.toggle('active', !matched);
    el.customTimeRow.hidden = matched; // keep custom row open if custom is active
  }

  function updateControlsUI() {
    el.startBtn.disabled = state.isRunning;
    el.startBtn.textContent = state.isFinished
      ? 'Start Again'
      : state.isPaused
        ? 'Resume'
        : 'Start';
    el.pauseBtn.disabled = !state.isRunning;
    el.pauseBtn.textContent = 'Pause';
  }

  function setSteamVisible(visible) {
    el.steamGroup.classList.toggle('is-visible', visible);
  }

  /* ---------------------------------------------------------
     6. Timer engine — timestamp based so throttled tabs don't drift
     --------------------------------------------------------- */
  function tick() {
    let continueLoop = false;
    const ts = performance.now();

    if (state.isRunning) {
      const elapsedMs =
        state.elapsedBeforePause + (Date.now() - state.startTimestamp);
      const totalMs = state.totalDuration * 1000;
      const remainingMs = totalMs - elapsedMs;

      if (remainingMs <= 0) {
        finishTimer();
        return;
      }

      state.remaining = Math.ceil(remainingMs / 1000);
      updateTimeDisplay();

      const realPct = clamp((elapsedMs / totalMs) * 100, 0, 100);

      if (state.coffeeAnimMode === 'rise') {
        const t = (ts - state.riseStart) / RISE_DURATION_MS;
        if (t >= 1) {
          state.coffeeDisplay = realPct;
          state.coffeeAnimMode = 'sync';
        } else {
          state.coffeeDisplay =
            state.riseFrom +
            (realPct - state.riseFrom) * easeOutQuad(clamp(t, 0, 1));
        }
      } else {
        state.coffeeDisplay = realPct;
      }

      updateCupVisual(state.coffeeDisplay, ts);
      continueLoop = true;
    } else if (state.coffeeAnimMode === 'drain') {
      const t = (ts - state.drainStart) / DRAIN_DURATION_MS;
      if (t >= 1) {
        state.coffeeDisplay = 0;
        state.coffeeAnimMode = 'idle';
        updateCupVisual(0, ts);
      } else {
        state.coffeeDisplay =
          state.drainFrom * (1 - easeOutQuad(clamp(t, 0, 1)));
        updateCupVisual(state.coffeeDisplay, ts);
        continueLoop = true;
      }
    }

    state.rafId = continueLoop ? requestAnimationFrame(tick) : null;
  }

  function startLoop() {
    if (!state.rafId) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function cancelLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function finishTimer() {
    cancelLoop();
    state.isRunning = false;
    state.isPaused = false;
    state.isFinished = true;
    state.remaining = 0;
    state.coffeeAnimMode = 'sync';
    state.coffeeDisplay = 100;

    updateTimeDisplay();
    updateCupVisual(100, performance.now());
    announce("Time's Up!");
    setSteamVisible(true);
    playSound(currentSettings.sound, currentSettings.volume);

    // work out what comes next in the Pomodoro cycle
    let nextMode;
    if (state.mode === 'focus') {
      nextMode =
        state.focusSessionsSinceLongBreak >= state.cyclesPerLongBreak
          ? 'long'
          : 'short';
    } else if (state.mode === 'long') {
      state.focusSessionsSinceLongBreak = 0;
      nextMode = 'focus';
    } else {
      nextMode = 'focus';
    }
    state.pendingNextMode = nextMode;

    updateControlsUI();
    updateCycleDisplay();

    if (currentSettings.autoStart) {
      setTimeout(() => {
        if (state.isFinished) advanceToNext();
      }, 1200);
    }
  }

  /* ---------------------------------------------------------
     7. Actions
     --------------------------------------------------------- */
  function freshStartCurrentMode() {
    state.startTimestamp = Date.now();
    state.elapsedBeforePause = 0;
    state.isRunning = true;
    state.isPaused = false;
    state.isFinished = false;
    state.coffeeDisplay = 0;
    state.coffeeAnimMode = 'sync';

    if (state.mode === 'focus') {
      state.focusSessionsSinceLongBreak += 1;
      if (state.focusSessionsSinceLongBreak > state.cyclesPerLongBreak) {
        state.focusSessionsSinceLongBreak = 1;
      }
    }

    updateCycleDisplay();
    announce(modeLabel(state.mode));
    setSteamVisible(true);
    updateControlsUI();
    startLoop();
  }

  function resumeTimer() {
    state.startTimestamp = Date.now();
    state.isRunning = true;
    state.isPaused = false;
    state.coffeeAnimMode = 'rise';
    state.riseFrom = state.coffeeDisplay;
    state.riseStart = performance.now();

    announce(modeLabel(state.mode));
    setSteamVisible(true);
    updateControlsUI();
    startLoop();
  }

  function pauseTimer() {
    if (!state.isRunning) return;
    state.elapsedBeforePause += Date.now() - state.startTimestamp;
    state.isRunning = false;
    state.isPaused = true;

    if (currentSettings.enableAnimation && !isReducedMotion()) {
      state.coffeeAnimMode = 'drain';
      state.drainFrom = state.coffeeDisplay;
      state.drainStart = performance.now();
      startLoop();
    } else {
      state.coffeeAnimMode = 'idle';
      state.coffeeDisplay = 0;
      updateCupVisual(0, performance.now());
    }

    announce('Paused');
    setSteamVisible(false);
    updateControlsUI();
  }

  function resetTimer() {
    cancelLoop();
    state.isRunning = false;
    state.isPaused = false;
    state.isFinished = false;
    state.elapsedBeforePause = 0;
    state.startTimestamp = null;
    state.remaining = state.durations[state.mode];
    state.totalDuration = state.durations[state.mode];
    state.coffeeDisplay = 0;
    state.coffeeAnimMode = 'idle';

    updateTimeDisplay();
    updateCupVisual(0, performance.now());
    announce('Ready');
    setSteamVisible(false);
    updateControlsUI();
  }

  function switchMode(mode, opts) {
    opts = opts || {};
    cancelLoop();
    state.mode = mode;
    state.totalDuration = state.durations[mode];
    state.remaining = state.durations[mode];
    state.isRunning = false;
    state.isPaused = false;
    state.isFinished = false;
    state.coffeeDisplay = 0;
    state.coffeeAnimMode = 'idle';

    updateModeTabsUI();
    updateTimeDisplay();
    updateCupVisual(0, performance.now());
    announce(opts.autoTriggerStart ? modeLabel(mode) : 'Ready');
    updateCycleDisplay();
    updatePresetActiveState();
    updateControlsUI();
    setSteamVisible(false);

    if (opts.autoTriggerStart) {
      freshStartCurrentMode();
    }
  }

  function advanceToNext() {
    const next = state.pendingNextMode || 'focus';
    switchMode(next, { autoTriggerStart: true });
  }

  function handleStartClick() {
    if (state.isFinished) {
      advanceToNext();
      return;
    }
    if (state.isPaused) {
      resumeTimer();
      return;
    }
    freshStartCurrentMode();
  }

  /* ---------------------------------------------------------
     8. Sound engine — Web Audio API, no external audio files
     --------------------------------------------------------- */
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTone(ctx, freq, type, startTime, duration, peakGain) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(peakGain, 0.0002),
      startTime + 0.02,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  function playSound(name, volumePercent) {
    if (!name || name === 'none') return;
    const ctx = getAudioContext();
    const vol = clamp(volumePercent, 0, 100) / 100;
    if (vol <= 0) return;
    const now = ctx.currentTime;

    switch (name) {
      case 'classicBell':
        playTone(ctx, 880, 'sine', now, 1.1, 0.5 * vol);
        playTone(ctx, 1320, 'sine', now, 1.0, 0.22 * vol);
        break;
      case 'coffeeBell':
        // two-tone counter-bell "ding-ding"
        playTone(ctx, 660, 'triangle', now, 0.32, 0.5 * vol);
        playTone(ctx, 880, 'triangle', now + 0.3, 0.5, 0.5 * vol);
        break;
      case 'softBell':
        playTone(ctx, 440, 'sine', now, 1.6, 0.32 * vol);
        playTone(ctx, 660, 'sine', now, 1.6, 0.12 * vol);
        break;
      case 'digitalBeep':
        for (let i = 0; i < 3; i++) {
          playTone(ctx, 1000, 'square', now + i * 0.18, 0.12, 0.35 * vol);
        }
        break;
      case 'gentleChime':
        [523.25, 659.25, 783.99].forEach((freq, i) => {
          playTone(ctx, freq, 'sine', now + i * 0.14, 0.9, 0.28 * vol);
        });
        break;
      default:
        break;
    }
  }

  /* ---------------------------------------------------------
     9. Settings modal
     --------------------------------------------------------- */
  function populateModalFields() {
    el.setFocus.value = Math.round(currentSettings.durations.focus / 60);
    el.setShort.value = Math.round(currentSettings.durations.short / 60);
    el.setLong.value = Math.round(currentSettings.durations.long / 60);
    el.setSound.value = currentSettings.sound;
    el.setVolume.value = currentSettings.volume;
    el.setTheme.value = currentSettings.theme;
    el.setAutoStart.checked = currentSettings.autoStart;
    el.setEnableAnimation.checked = currentSettings.enableAnimation;
    el.setReducedMotion.checked = currentSettings.reducedMotion;
  }

  function openModal() {
    populateModalFields();
    el.modalOverlay.hidden = false;
  }

  function closeModal() {
    el.modalOverlay.hidden = true;
  }

  function saveSettings() {
    try {
      const newFocusSec = clampInt(el.setFocus.value, 1, 180) * 60;

      const newShortSec = clampInt(el.setShort.value, 1, 60) * 60;

      const newLongSec = clampInt(el.setLong.value, 1, 90) * 60;

      const currentModeDurationBefore = state.durations[state.mode];

      currentSettings.durations = {
        focus: newFocusSec,
        short: newShortSec,
        long: newLongSec,
      };

      currentSettings.sound = el.setSound.value;
      currentSettings.volume = clampInt(el.setVolume.value, 0, 100);

      currentSettings.theme = el.setTheme.value;
      currentSettings.autoStart = el.setAutoStart.checked;

      currentSettings.enableAnimation = el.setEnableAnimation.checked;

      currentSettings.reducedMotion = el.setReducedMotion.checked;

      state.durations = {
        ...currentSettings.durations,
      };

      applySettingsToPage();
      persistSettings();
      updatePresetActiveState();

      // ถ้าเปลี่ยนเวลาของโหมดปัจจุบัน ให้ Reset
      if (state.durations[state.mode] !== currentModeDurationBefore) {
        resetTimer();
      }

      // ปิด Modal หลัง Save สำเร็จ
      closeModal();
    } catch (error) {
      console.error('Save Settings Error:', error);
      alert('ไม่สามารถบันทึก Settings ได้ กรุณาดู Console');
    }
  }

  /* ---------------------------------------------------------
     10. Presets & custom time
     --------------------------------------------------------- */
  function wirePresets() {
    el.presetButtons.forEach((btn) => {
      if (btn.dataset.minutes === 'custom') {
        btn.addEventListener('click', () => {
          el.customTimeRow.hidden = false;
          el.presetButtons.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          // pre-fill custom fields with the current mode duration for convenience
          const total = state.durations[state.mode];
          el.customHours.value = Math.floor(total / 3600);
          el.customMinutes.value = Math.floor((total % 3600) / 60);
          el.customSeconds.value = total % 60;
        });
        return;
      }
      btn.addEventListener('click', () => {
        el.customTimeRow.hidden = true;
        const minutes = Number(btn.dataset.minutes);
        state.durations[state.mode] = minutes * 60;
        resetTimer();
        updatePresetActiveState();
      });
    });

    el.applyCustomTime.addEventListener('click', () => {
      const h = clampInt(el.customHours.value, 0, 23);
      const m = clampInt(el.customMinutes.value, 0, 59);
      const s = clampInt(el.customSeconds.value, 0, 59);
      let total = h * 3600 + m * 60 + s;
      if (total < 1) total = 1;
      state.durations[state.mode] = total;
      resetTimer();
      updatePresetActiveState();
      el.customTimeRow.hidden = false;
      el.customPresetBtn.classList.add('active');
    });
  }

  /* ---------------------------------------------------------
     11. Keyboard shortcuts
     --------------------------------------------------------- */
  function wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      const activeTag =
        (document.activeElement && document.activeElement.tagName) || '';
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag);

      if (e.key === 'Escape' && !el.modalOverlay.hidden) {
        closeModal();
        return;
      }

      if (isTyping || !el.modalOverlay.hidden) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (state.isRunning) {
          pauseTimer();
        } else {
          handleStartClick();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        resetTimer();
      } else if (e.key === 's' || e.key === 'S') {
        openModal();
      }
    });
  }

  /* ---------------------------------------------------------
     12. Init
     --------------------------------------------------------- */
  function wireEvents() {
    el.startBtn.addEventListener('click', handleStartClick);
    el.pauseBtn.addEventListener('click', pauseTimer);
    el.resetBtn.addEventListener('click', resetTimer);

    // Mode tabs
    el.modeTabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === state.mode) return;
        switchMode(btn.dataset.mode);
      });
    });

    // Theme button
    el.themeBtn.addEventListener('click', () => {
      const idx = THEME_ORDER.indexOf(currentSettings.theme);
      currentSettings.theme = THEME_ORDER[(idx + 1) % THEME_ORDER.length];

      applySettingsToPage();
      persistSettings();
    });

    // =========================
    // Settings Modal
    // =========================

    // เปิด Settings
    el.settingsBtn.addEventListener('click', () => {
      openModal();
    });

    // ปุ่ม X
    el.modalCloseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    });

    // ปุ่ม Cancel
    el.cancelSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    });

    // ปุ่ม Save
    el.saveSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      saveSettings();
    });

    // คลิกพื้นที่ด้านนอก Modal เพื่อปิด
    el.modalOverlay.addEventListener('click', (e) => {
      if (e.target === el.modalOverlay) {
        closeModal();
      }
    });

    // Test Sound
    el.testSoundBtn.addEventListener('click', (e) => {
      e.preventDefault();

      try {
        playSound(el.setSound.value, Number(el.setVolume.value));
      } catch (error) {
        console.error('Test Sound Error:', error);
      }
    });

    wirePresets();
    wireKeyboard();
  }

  function init() {
    cacheDom();
    applySettingsToPage();
    wireEvents();

    state.durations = { ...currentSettings.durations };
    state.totalDuration = state.durations.focus;
    state.remaining = state.durations.focus;

    updateModeTabsUI();
    updateTimeDisplay();
    updateCupVisual(0, performance.now());
    updateCycleDisplay();
    updatePresetActiveState();
    updateControlsUI();
    el.cupStatus.textContent = 'Ready';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
