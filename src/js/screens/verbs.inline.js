/* verbs.inline.js — экран тренажёра глаголов (beta)
   Экспортирует window.screens.verbs = { mount(container, opts), update?, destroy() }
   Зависимости: util, verbdb, verbtrainer, verbrng
*/
(function() {
'use strict';

const U = window.util || {};
const el = U.el || ((tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
});
const clear = U.clear || ((node) => {
  while (node && node.firstChild) node.removeChild(node.firstChild);
});
const ensureStyles = () => {
  if (!U.injectStyle) return;
  U.injectStyle('verbs-screen-style', `
    .verbs-screen{min-height:100%;}
    .verbs-wrap{max-width:900px;margin:0 auto;padding:20px 16px 60px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial;}
    .verbs-head{display:flex;flex-direction:column;gap:6px;margin-bottom:20px;}
    .verbs-mode{font-size:13px;letter-spacing:.4px;text-transform:uppercase;color:rgba(10,20,40,.6);}
    .verbs-cue{font-size:24px;font-weight:800;color:#0a1428;}
    .verbs-cue-ru{font-size:18px;color:rgba(10,20,40,.75);}
    .verbs-examples{font-size:15px;color:rgba(10,20,40,.7);margin-top:8px;line-height:1.4;}
    .verbs-slot{margin-top:14px;font-weight:700;font-size:16px;letter-spacing:.3px;color:#0a1428;}
    .verbs-options{display:flex;flex-direction:column;gap:10px;margin-top:12px;}
    .verbs-options button{appearance:none;border:0;border-radius:12px;padding:14px 18px;font-weight:700;font-size:18px;letter-spacing:.2px;text-align:left;background:#f3f4f6;color:#0a1428;box-shadow:0 2px 0 rgba(10,20,40,.05) inset;cursor:pointer;transition:filter .15s ease,transform .02s ease;}
    .verbs-options button.correct{background:#bbf7d0;color:#064e3b;}
    .verbs-options button.wrong{background:#fecaca;color:#7f1d1d;}
    .verbs-options button:disabled{cursor:default;opacity:.85;}
    .verbs-hint{margin-top:12px;font-size:14px;color:rgba(10,20,40,.75);min-height:20px;}
    .verbs-status{margin-top:18px;font-size:15px;color:rgba(10,20,40,.65);}
    .verbs-controls{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px;}
    .verbs-production{margin-top:18px;display:none;flex-direction:column;gap:10px;}
    .verbs-production textarea{width:100%;min-height:90px;padding:12px;border-radius:12px;border:1px solid rgba(10,20,40,.2);font:16px/1.4 ui-sans-serif,system-ui;}
    .verbs-production button{align-self:flex-start;}
    .verbs-summary{margin-top:24px;padding:16px;border-radius:16px;background:#f9fafb;color:#0a1428;display:none;}
    @media (prefers-color-scheme:dark){
      .verbs-wrap{color:#e5e7eb;}
      .verbs-cue{color:#f9fafb;}
      .verbs-cue-ru{color:rgba(229,231,235,.8);}
      .verbs-options button{background:#1f2937;color:#f9fafb;box-shadow:0 2px 0 rgba(0,0,0,.3) inset;}
      .verbs-options button.correct{background:#14532d;color:#bbf7d0;}
      .verbs-options button.wrong{background:#7f1d1d;color:#fee2e2;}
      .verbs-summary{background:#1f2937;color:#e5e7eb;}
    }
  `);
};

function createUI(container) {
  ensureStyles();
  if (U.ensureBaseStyles) U.ensureBaseStyles();
  const root = el('section', 'verbs-screen');
  const wrap = el('div', 'verbs-wrap');
  const controls = el('div', 'verbs-controls');
  const bBack = el('button', 'btn ghost', '← Назад');
  const bImport = el('button', 'btn', 'Импорт JSON');
  const bExport = el('button', 'btn', 'Экспорт JSON');
  const bStart = el('button', 'btn primary', 'Старт сессии');
  controls.append(bBack, bImport, bExport, bStart);

  const head = el('div', 'verbs-head');
  const modeLabel = el('div', 'verbs-mode', 'Verben • beta');
  const cueDe = el('div', 'verbs-cue', '—');
  const cueRu = el('div', 'verbs-cue-ru', '');
  head.append(modeLabel, cueDe, cueRu);

  const examples = el('div', 'verbs-examples');
  const slotLabel = el('div', 'verbs-slot', '');
  const options = el('div', 'verbs-options');
  const hint = el('div', 'verbs-hint');
  const status = el('div', 'verbs-status');

  const production = el('div', 'verbs-production');
  const prodTitle = el('div', null, 'Соберите короткое предложение (микропрактика):');
  const prodArea = el('textarea');
  const prodButtons = el('div', 'verbs-controls');
  const prodOk = el('button', 'btn primary', 'Готово');
  const prodSkip = el('button', 'btn ghost', 'Пропустить');
  prodButtons.append(prodOk, prodSkip);
  production.append(prodTitle, prodArea, prodButtons);

  const summary = el('div', 'verbs-summary');

  wrap.append(controls, head, examples, slotLabel, options, hint, status, production, summary);
  root.appendChild(wrap);
  container.appendChild(root);

  let resolveAsk = null;
  let currentOptions = [];

  function resetOptions() {
    clear(options);
    currentOptions = [];
  }

  function renderOptions(gen) {
    resetOptions();
    const opts = Array.isArray(gen.options) && gen.options.length ? gen.options
                                                                : [gen.correct];
    currentOptions = opts.slice();
    opts.forEach((label) => {
      const btn = el('button', null, label || '—');
      btn.disabled = false;
      btn.addEventListener('click', () => {
        if (!resolveAsk) return;
        const correct = String(label).trim() === String(gen.correct).trim();
        options.querySelectorAll('button').forEach((n) => n.disabled = true);
        btn.classList.add(correct ? 'correct' : 'wrong');
        resolveAsk({correct, choice: label});
        resolveAsk = null;
      });
      options.appendChild(btn);
    });
  }

  return {
    root,
    buttons: {bBack, bImport, bExport, bStart},
    head: {cueDe, cueRu, examples},
    slotLabel,
    hint,
    status,
    summary,
    production,
    prodArea,
    prodOk,
    prodSkip,
    setFrame(bundle, ctx) {
      cueDe.textContent = bundle?.frame?.cueDe || bundle?.verb?.lemma || '—';
      cueRu.textContent = bundle?.frame?.cueRu || '';
      const ex = (bundle?.frame?.examples || []).slice(0, 2).join('\n');
      examples.textContent = ex;
      status.textContent = ctx ? `Карточка ${ctx.index + 1} из ${ctx.total}` : '';
      summary.style.display = 'none';
      hint.textContent = '';
      production.style.display = 'none';
    },
    ask(gen, ctx) {
      slotLabel.textContent = `Шаг ${ctx.step + 1}: ${gen.slot}`;
      hint.textContent = '';
      summary.style.display = 'none';
      return new Promise((resolve) => {
        resolveAsk = resolve;
        renderOptions(gen);
      });
    },
    hint(text) {
      hint.textContent = text || '';
      return Promise.resolve();
    },
    async microProduction(bundle) {
      production.style.display = 'flex';
      prodArea.value = '';
      prodArea.focus();
      return new Promise((resolve) => {
        function done(ok) {
          production.style.display = 'none';
          resolve(ok);
        }
        const check = () => {
          const val = String(prodArea.value || '').toLowerCase();
          const lemma = (bundle?.verb?.lemma || '').toLowerCase();
          const coll = (bundle?.colls?.[0] || '').toLowerCase();
          const good = lemma && val.includes(lemma) && (!coll || val.includes(coll.split(' ')[0]));
          done(good);
        };
        prodOk.onclick = () => check();
        prodSkip.onclick = () => done(false);
      });
    },
    showSummary(text) {
      summary.textContent = text || '';
      summary.style.display = text ? 'block' : 'none';
    },
    destroy() {
      if (resolveAsk) {
        try {
          resolveAsk({correct: false, choice: null, cancelled: true});
        } catch (_) {
        }
      }
      resolveAsk = null;
      root.remove();
    }
  };
}

const screen = {
  mounted: false,
  ui: null,
  opts: {},
  busy: false,
  mount(container, opts = {}) {
    this.opts = opts;
    this.mounted = true;
    this.ui = createUI(container);
    this.attachHandlers();
    return this;
  },
  attachHandlers() {
    const ui = this.ui;
    const {bBack, bImport, bExport, bStart} = ui.buttons;
    bBack.addEventListener('click', () => {
      if (this.busy) return;
      this.opts.onBack?.();
    });
    bImport.addEventListener('click', () => this.doImport());
    bExport.addEventListener('click', () => this.doExport());
    bStart.addEventListener('click', () => this.startSession());
  },
  async doImport() {
    if (!U.file?.pickTextFile) {
      alert('Импорт недоступен: нет util.file');
      return;
    }
    try {
      const picked = await U.file.pickTextFile();
      if (!picked) return;
      await window.verbdb.importJSON(picked.text);
      await window.verbtrainer.ensureStatsForAll();
      alert('Импорт завершён успешно');
    } catch (e) {
      console.warn('[verbs] import error', e);
      alert('Ошибка импорта: ' + (e?.message || e));
    }
  },
  async doExport() {
    try {
      const data = await window.verbdb.exportJSON();
      const text = JSON.stringify(data, null, 2);
      if (U.file?.downloadText) {
        U.file.downloadText(`lexi-verbs-${U.fmt?.dateStamp?.() || Date.now()}.json`, text);
      } else {
        alert(text);
      }
    } catch (e) {
      console.warn('[verbs] export error', e);
      alert('Ошибка экспорта: ' + (e?.message || e));
    }
  },
  async startSession() {
    if (this.busy) return;
    this.busy = true;
    const ui = this.ui;
    const {bStart, bImport, bExport, bBack} = ui.buttons;
    [bStart, bImport, bExport, bBack].forEach(btn => btn.disabled = true);
    try {
      const frames = await window.verbtrainer.pickNextFrames(5);
      if (!frames.length) {
        ui.showSummary('Нет доступных карточек: импортируйте глаголы.');
        return;
      }
      const seed = Date.now().toString(36);
      const results = [];
      for (let i = 0; i < frames.length; i++) {
        const bundle = frames[i];
        ui.setFrame(bundle, {index: i, total: frames.length});
        const res = await window.verbtrainer.runCard(bundle, ui, seed);
        results.push({...res, frameId: bundle.frame.id});
      }
      const ok = results.reduce((acc, r) => acc + (r.score || 0), 0);
      const summary = `Пройдено карточек: ${frames.length}. Средний результат: ${(ok / (frames.length * 5) * 100).toFixed(0)}%.`;
      ui.showSummary(summary);
    } catch (e) {
      console.warn('[verbs] session error', e);
      alert('Сессия прервана: ' + (e?.message || e));
    } finally {
      this.busy = false;
      const {bStart, bImport, bExport, bBack} = ui.buttons;
      [bStart, bImport, bExport, bBack].forEach(btn => btn.disabled = false);
    }
  },
  destroy() {
    try {
      this.ui?.destroy?.();
    } catch (e) {
    }
    this.mounted = false;
    this.ui = null;
    this.busy = false;
  }
};

window.screens = window.screens || {};
window.screens.verbs = screen;
})();
