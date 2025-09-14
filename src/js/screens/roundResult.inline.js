/* roundResult.inline.js — экран результатов раунда
   Зависимости: (опционально) window.util (el/clear/log); есть фолбэки.

   Экспорт:
     window.screens.roundResult = {
       mount(container, {
         results,            // Array<ExerciseResult> из excerciseResult (см.
   там) completed,          // (опц.) число завершённых упражнений total, //
   (опц.) всего упражнений в раунде dbDeltaPp,          // (опц.) изменение
   средней точности БД в п.п. (+4/-2/0) onShowAll,          // (list) => void —
   показать все результаты по порядку onShowErrors        // (list) => void —
   показать только ошибочные по порядку
       }),
       update(next),
       destroy()
     }
*/
(function() {
'use strict';

// ---- утилиты/фолбэки ----
const U = window.util || {};
const el = U.el || ((t, c, tx) => {
             const d = document.createElement(t);
             if (c) d.className = c;
             if (tx != null) d.textContent = tx;
             return d;
           });
const clear = U.clear || (n => {
                while (n && n.firstChild) n.removeChild(n.firstChild);
              });
const log =
    (U.log ? U.log('roundResult') :
             (...a) => console.log('[roundResult]', ...a));
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

// ---- helpers ----
function pct(x) {
  return Math.round(clamp01(x) * 100);
}
function fmtPct(x) {
  return pct(x) + '%';
}

function build(container) {
  clear(container);

  const root = el('section', 'rr');
  const wrap = el('div', 'wrap');

  const card = el('section', 'card');
  const hdr = el('div', 'hdr', 'Результаты раунда');

  const grid = el('div', 'grid3');

  const c1 = el('div', 'cell');
  c1.append(el('div', 'label', 'Верно'));
  const v1 = el('div', 'value', '0');
  c1.append(v1);

  const c2 = el('div', 'cell');
  c2.append(el('div', 'label', 'Точность'));
  const v2 = el('div', 'value', '0%');
  const sub2 = el('span', 'sub', '');
  const box2 = el('div');
  box2.append(v2, sub2);  // держим вместе
  c2.append(box2);

  const c3 = el('div', 'cell');
  c3.append(el('div', 'label', 'Δ к БД (п.п.)'));
  const delta = el('div', 'delta flat', '0');
  c3.append(delta);

  grid.append(c1, c2, c3);
  card.append(hdr, grid);

  // Progress
  const progress = el('div', 'progress');
  const bar = el('div', 'bar');
  const fill = el('div', 'fill');
  bar.appendChild(fill);
  const bartext = el('div', 'bartext', '0 из 0 завершено');
  progress.append(bar, bartext);

  // CTAs
  const cta = el('div', 'cta');
  const bAll = el('button', 'btn primary', 'Смотреть все');
  const bErr = el('button', 'btn', 'Смотреть ошибки');
  cta.append(bAll, bErr);

  // Put together
  wrap.append(card, progress, cta, el('div', 'sp'));
  root.appendChild(wrap);
  container.appendChild(root);

  return {root, wrap, v1, v2, sub2, delta, fill, bartext, bAll, bErr};
}

function computeMetrics(results, completed, total) {
  const totalR = Array.isArray(results) ? results.length : 0;
  const tot = total ?? totalR;
  const comp = completed ?? totalR;

  const ok = (results || []).reduce((a, r) => a + (r && r.success ? 1 : 0), 0);
  const acc = tot > 0 ? ok / tot : 0;
  const errors = (results || []).filter(r => r && !r.success);
  return {ok, acc, comp, tot, errors};
}

// ---- state / API ----
const state = {
  mounted: false,
  els: null,
  container: null,
  opts: {}
};

function render() {
  const {results = [], completed, total, dbDeltaPp = 0} = state.opts;
  const {ok, acc, comp, tot, errors} =
      computeMetrics(results, completed, total);

  state.els.v1.textContent = String(ok);
  state.els.v2.textContent = fmtPct(acc);
  state.els.sub2.textContent = '';

  // Δ к БД
  const d = Math.round(+dbDeltaPp || 0);
  state.els.delta.textContent = (d > 0 ? '+' : '') + String(d);
  state.els.delta.className = 'delta ' +
      (d > 0     ? 'up' :
           d < 0 ? 'down' :
                   'flat');

  // Прогресс
  const p = (tot > 0) ? Math.max(0, Math.min(1, comp / tot)) : 0;
  state.els.fill.style.width = (p * 100).toFixed(0) + '%';
  state.els.bartext.textContent = `${comp} из ${tot} завершено`;

  // Кнопки
  if (errors.length === 0) {
    // преобразуем правую кнопку в "Далее"
    state.els.bErr.disabled = false;
    state.els.bErr.textContent = 'Далее';
    state.els.bErr.classList.add('primary');
    state.els.bErr.onclick = () => state.opts.onShowAll?.();
  } else {
    // Обычный режим: "Смотреть ошибки"
    state.els.bErr.disabled = false;
    state.els.bErr.textContent = 'Смотреть ошибки';
    state.els.bErr.onclick = () => state.opts.onShowErrors?.(errors.slice());
  }
  state.els.bAll.classList.remove('primary');
  state.els.bAll.onclick = () => {
    log('show all', {count: results.length});
    if (typeof state.opts.onShowAll === 'function')
      state.opts.onShowAll(results.slice());
  };
}

const api = {
  mount(container, opts = {}) {
    if (state.mounted) return;
    state.mounted = true;
    state.container = container;
    state.opts = opts || {};
    state.els = build(container);
    render();
    log('mounted');
  },
  update(next = {}) {
    if (!state.mounted) return;
    state.opts = {...state.opts, ...next};
    render();
  },
  destroy() {
    if (!state.mounted) return;
    state.mounted = false;
    if (state.els && state.els.root && state.els.root.parentNode) {
      state.els.root.parentNode.removeChild(state.els.root);
    }
    state.els = null;
    state.container = null;
    state.opts = {};
    log('destroyed');
  }
};

window.screens = window.screens || {};
window.screens.roundResult = api;
})();
