(function() {
'use strict';

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function createController(options = {}) {
  const storageKey = options.storageKey || 'lexi/exerciseLayoutShift';
  const min = options.min ?? -40;
  const max = options.max ?? 40;
  const formatter = typeof options.format === 'function' ? options.format :
                    ((v) => String(v));
  const logger = typeof options.log === 'function' ? options.log : null;

  const state = {
    shift: clamp(options.initialShift || 0, min, max),
    raf: 0,
    listeners: false,
    modalOpen: false,
    refs: {},
    resizeHandler: null,
    keyHandler: null,
    bound: {
      onTrigger: null,
      onBackdrop: null,
      onClose: null,
      onReset: null,
      onSliderInput: null,
      onSliderChange: null
    }
  };

  function format(v) {
    return formatter(clamp(v, min, max));
  }

  function load() {
    let raw = state.shift;
    try {
      const stored = window.localStorage?.getItem(storageKey);
      if (stored != null) raw = parseFloat(stored);
    } catch (_) {
    }
    if (!Number.isFinite(raw)) raw = 0;
    state.shift = clamp(raw, min, max);
    return state.shift;
  }

  function persist() {
    try {
      window.localStorage?.setItem(storageKey, String(state.shift));
    } catch (_) {
    }
  }

  function updateDisplay() {
    const {slider, value} = state.refs;
    if (slider && slider.value !== String(state.shift))
      slider.value = String(state.shift);
    if (value) value.textContent = format(state.shift);
  }

  function setShift(value, opts = {}) {
    const {apply = true, persist: shouldPersist = false} = opts;
    const num = clamp(Number(value) || 0, min, max);
    state.shift = num;
    updateDisplay();
    if (apply) schedule('user');
    if (shouldPersist) persist();
  }

  function applyMetrics(reason) {
    const {wrap, topbar, heading, summary, mount, backBtn} = state.refs;
    if (!wrap) return;

    const viewport = window.visualViewport?.height || window.innerHeight || 0;
    if (!viewport) return;

    let topPad = clamp(viewport * 0.012, 6, 20);
    let gap = clamp(viewport * 0.02, 10, 28);
    let summaryPad = clamp(viewport * 0.016, 8, 18);
    let bottomPad = clamp(viewport * 0.12, 72, 132);
    let mountPadTop = clamp(viewport * 0.1, 24, 132);
    let mountPadBottom = clamp(viewport * 0.085, 24, 112);
    let btnMargin = clamp(viewport * 0.04, 16, 50);

    const shiftRatio = clamp(state.shift || 0, min, max) / 100;
    if (shiftRatio !== 0) {
      const shiftPx = viewport * shiftRatio;
      topPad = clamp(topPad + shiftPx * 0.35, 4, viewport * 0.12);
      summaryPad = clamp(summaryPad + shiftPx * 0.08, 6, viewport * 0.06);
      bottomPad = clamp(bottomPad - shiftPx * 0.45, 56, viewport * 0.24);
      mountPadTop = clamp(mountPadTop + shiftPx * 1.05, 12, viewport * 0.26);
      mountPadBottom = clamp(mountPadBottom - shiftPx * 0.75, 16, viewport * 0.22);
      btnMargin = clamp(btnMargin - shiftPx * 0.25, 12, viewport * 0.18);
    }

    wrap.style.setProperty('--ex-top-pad', `${Math.round(topPad)}px`);
    wrap.style.setProperty('--ex-gap', `${Math.round(gap)}px`);
    wrap.style.setProperty('--ex-summary-pad-y', `${Math.round(summaryPad)}px`);
    wrap.style.setProperty('--ex-bottom-pad', `${Math.round(bottomPad)}px`);
    wrap.style.setProperty('--ex-mount-pad-top', `${Math.round(mountPadTop)}px`);
    wrap.style.setProperty('--ex-mount-pad-bottom', `${Math.round(mountPadBottom)}px`);
    wrap.style.setProperty('--ex-btn-margin-top', `${Math.round(btnMargin)}px`);

    const wrapTop = wrap.getBoundingClientRect?.().top || 0;
    const headerHeight = (topbar?.offsetHeight || 0) + (heading?.offsetHeight || 0);
    const summaryHeight = summary?.offsetHeight || 0;
    const buttonHeight = backBtn?.offsetHeight || 0;
    const computedGap = parseFloat(getComputedStyle(wrap).rowGap || gap) || gap;
    const totalGaps = computedGap * 4;

    let available = viewport - wrapTop - topPad - bottomPad - headerHeight -
        summaryHeight - buttonHeight - totalGaps;
    if (!Number.isFinite(available)) available = 0;
    const mountMin = clamp(available, 220, viewport * 0.7);
    wrap.style.setProperty('--ex-mount-min', `${Math.round(Math.max(mountMin, 220))}px`);

    if (mount) {
      if (available < 220) mount.classList.add('mount--centered');
      else mount.classList.remove('mount--centered');
    }

    if (reason === 'init' && logger) {
      logger('layout', {
        viewport: Math.round(viewport),
        topPad: Math.round(topPad),
        gap: Math.round(gap),
        mountMin: Math.round(Math.max(mountMin, 220)),
        available: Math.round(available)
      });
    }
  }

  function schedule(reason = 'manual') {
    if (!state.refs.wrap) return;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      applyMetrics(reason);
    });
  }

  function setupListeners() {
    if (state.listeners) return;
    const handler = () => schedule('resize');
    window.addEventListener('resize', handler);
    window.visualViewport?.addEventListener('resize', handler);
    state.resizeHandler = handler;
    state.listeners = true;
  }

  function teardownListeners() {
    if (!state.listeners) return;
    window.removeEventListener('resize', state.resizeHandler);
    window.visualViewport?.removeEventListener('resize', state.resizeHandler);
    state.resizeHandler = null;
    state.listeners = false;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
  }

  function openModal() {
    const {modal, trigger, slider} = state.refs;
    if (!modal || state.modalOpen) return;
    state.modalOpen = true;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    updateDisplay();
    state.keyHandler = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeModal();
      }
    };
    document.addEventListener('keydown', state.keyHandler);
    if (slider) setTimeout(() => slider.focus(), 0);
    // Keep trigger for focus restore
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }

  function closeModal(opts = {}) {
    const {persist: shouldPersist = true, returnFocus = true} = opts;
    const {modal, trigger} = state.refs;
    if (!modal || !state.modalOpen) return;
    state.modalOpen = false;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (state.keyHandler) {
      document.removeEventListener('keydown', state.keyHandler);
      state.keyHandler = null;
    }
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (shouldPersist) persist();
    if (returnFocus) trigger?.focus?.();
  }

  function bindUI() {
    const {backdrop, closeBtn, reset, slider, trigger} = state.refs;
    const bound = state.bound;
    if (trigger && !bound.onTrigger) {
      bound.onTrigger = () => openModal();
      trigger.addEventListener('click', bound.onTrigger);
    }
    if (backdrop && !bound.onBackdrop) {
      bound.onBackdrop = () => closeModal();
      backdrop.addEventListener('click', bound.onBackdrop);
    }
    if (closeBtn && !bound.onClose) {
      bound.onClose = () => closeModal();
      closeBtn.addEventListener('click', bound.onClose);
    }
    if (reset && !bound.onReset) {
      bound.onReset = () => {
        setShift(0, {apply: true, persist: true});
        state.refs.slider?.focus?.();
      };
      reset.addEventListener('click', bound.onReset);
    }
    if (slider && !bound.onSliderInput) {
      bound.onSliderInput = (ev) => setShift(ev.target.value, {apply: true});
      bound.onSliderChange = () => persist();
      slider.addEventListener('input', bound.onSliderInput);
      slider.addEventListener('change', bound.onSliderChange);
    }
  }

  function unbindUI() {
    const {backdrop, closeBtn, reset, slider, trigger} = state.refs;
    const bound = state.bound;
    if (trigger && bound.onTrigger) {
      trigger.removeEventListener('click', bound.onTrigger);
      bound.onTrigger = null;
    }
    if (backdrop && bound.onBackdrop) {
      backdrop.removeEventListener('click', bound.onBackdrop);
      bound.onBackdrop = null;
    }
    if (closeBtn && bound.onClose) {
      closeBtn.removeEventListener('click', bound.onClose);
      bound.onClose = null;
    }
    if (reset && bound.onReset) {
      reset.removeEventListener('click', bound.onReset);
      bound.onReset = null;
    }
    if (slider && bound.onSliderInput) {
      slider.removeEventListener('input', bound.onSliderInput);
      slider.removeEventListener('change', bound.onSliderChange);
      bound.onSliderInput = null;
      bound.onSliderChange = null;
    }
  }

  function init(refs = {}) {
    state.refs = {
      wrap: refs.wrap || null,
      topbar: refs.topbar || null,
      heading: refs.heading || null,
      summary: refs.summary || null,
      mount: refs.mount || null,
      backBtn: refs.backBtn || null,
      modal: refs.layoutModal || null,
      backdrop: refs.layoutBackdrop || null,
      slider: refs.layoutSlider || null,
      value: refs.layoutValue || null,
      reset: refs.layoutReset || null,
      closeBtn: refs.layoutClose || null,
      trigger: refs.layoutBtn || null
    };
    updateDisplay();
    unbindUI();
    bindUI();
    setupListeners();
    schedule('init');
  }

  function destroy() {
    unbindUI();
    closeModal({persist: false, returnFocus: false});
    teardownListeners();
    state.refs = {};
  }

  return {
    load,
    init,
    destroy,
    schedule,
    setShift,
    getShift: () => state.shift,
    format,
    openModal,
    closeModal
  };
}

window.exerciseLayout = {
  createController
};
})();
