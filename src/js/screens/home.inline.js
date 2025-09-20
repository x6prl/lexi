/* home.inline.js — экран Home (мобайл ~6.3")
   Зависимости: window.lexidb, window.dbStatistics, (опц.) window.util
   Экспорт: window.screens.home = { mount(container, opts), update(next?),
   destroy() }

   Поведение по ТЗ:
   - Вверху dbStatistics со всей БД.
   - Кнопки: «Импорт», «Добавить», «Экспорт», «База».
   - Кнопка «Проход» и строка «+ N −» не отображаются, если в базе нет
   элементов.
   - При +/− меняется число упражнений в проходе, сообщаем наружу
   onChangeRoundSize(n).
   - «Проход» вызывает onStartRound().
*/
(function() {
'use strict';

// -------- utils / fallbacks --------
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
const log = (U.log ? U.log('home') : (...a) => console.log('[home]', ...a));

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function fmtPct01(x) {
  const v = Math.max(0, Math.min(1, +x || 0));
  return Math.round(v * 100) + '%';
}

async function importFromUrl(btn, url) {
  url = url || btn?.dataset?.url || '';
  if (!url) {
    log('ImportByLink: не задан URL');
    alert('Не задан URL для импорта');
    return;
  }

  const wasText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Импорт...';

  try {
    const resp = await fetch(url, {mode: 'cors', cache: 'no-store'});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();

    const res = await window.lexidb.importText(text);
    await render();  // обновит карточку dbStatistics

    alert(
        `Импорт завершён:\n` +
        `+ добавлено: ${res.added}\n` +
        `~ обновлено: ${res.updated}\n` +
        `= пропущено: ${res.skipped}\n`);
    log('ImportByLink: success', res);
  } catch (e) {
    console.warn('[home] ImportByLink error', e);
    alert('Импорт не удался: ' + (e?.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = wasText;
  }
}
// -------- helpers: сбор агрегата для dbStatistics --------
async function computeDbStats() {
  try {
    await window.lexidb.open?.();
    const ids = await window.lexidb.listTermIds();
    const termsTotal = ids.length;
    if (termsTotal === 0) {
      return {
        hasData: false,
        stats: {coverage: 0, avgAcc: 0, debt: 0, entered: 0, total: 0}
      };
    }
    const stats = await Promise.all(ids.map(id => window.lexidb.getStats(id)));
    const list = [];
    for (let i = 0; i < ids.length; i++) {
      const s = stats[i];
      if (!s) continue;
      list.push({
        id: ids[i],
        stage: s.stage || 'MC5',
        intro: !!s.intro,
        M: {q: s.M?.q || 0, due: s.M?.due || 0},
        C: {q: s.C?.q || 0, due: s.C?.due || 0},
        P: {q: s.P?.q || 0, due: s.P?.due || 0}
      });
    }
    const agg = window.dbStatistics.fromTermStats(list);
    return {hasData: true, stats: agg};
  } catch (e) {
    console.warn('[home] computeDbStats error', e);
    return {
      hasData: false,
      stats: {coverage: 0, avgAcc: 0, debt: 0, entered: 0, total: 0}
    };
  }
}

// -------- view build --------
function build(container) {
  clear(container);

  const root = el('section', 'home');
  const wrap = el('div', 'wrap');

  // dbStatistics card
  const statsHost = el('div', 'block');
  const statsMount = document.createElement('div');
  statsHost.appendChild(statsMount);

  // actions
  const actions = el('div', 'grid4');
  const bImport = el('button', 'btn', 'Импорт');
  const bImport600 = el('button', 'btn', 'Импортировать 600 самых популярных');
  const bImportAll = el('button', 'btn', 'Импортировать всё (1200+)');
  const bAdd = el('button', 'btn', 'Добавить слово');
  const bVerbs = el('button', 'btn', 'Verben (beta)');
  const bExport = el('button', 'btn', 'Экспорт');
  const bDb = el('button', 'btn', 'База слов');
  actions.append(bImport, bAdd, bVerbs, bExport, bDb);

  // round size row
  const roundRow = el('div', 'round');
  const left = el('div', 'inc');
  const minus = el('button', 'icon', '−');
  const value = el('div', 'value', '—');
  const plus = el('button', 'icon', '+');
  left.append(minus, value, plus);
  const right = el('div');
  right.appendChild(el('div', 'hint', 'слов за раунд'));
  roundRow.append(left, right);

  // start button
  const bGo = el('button', 'btn primary', 'Поехали');

  // assemble
  wrap.append(
      statsHost, el('div', 'sp'), actions, el('div', 'sp'), roundRow,
      el('div', 'sp'), bGo, el('div', 'sp'), el('div', 'sp'), el('div', 'sp'),
      bImport600, el('div', 'sp'), bImportAll, el('div', 'footer'));
  root.appendChild(wrap);
  container.appendChild(root);

  return {
    root,
    wrap,
    statsMount,
    actions,
    bImport,
    bImport600,
    bImportAll,
    bAdd,
    bVerbs,
    bExport,
    bDb,
    roundRow,
    minus,
    plus,
    value,
    bGo
  };
}

// -------- state / API --------
const state = {
  mounted: false,
  els: null,
  opts: {},
  statsWidget: null,
  hasData: false,
  roundSize: 5
};

async function render() {
  // 1) статы
  const {hasData, stats} = await computeDbStats();
  if (!state.mounted || !state.els) return;
  state.hasData = hasData;

  if (!state.statsWidget) {
    state.statsWidget = window.dbStatistics.mount(
        state.els.statsMount, {variant: 'card', theme: 'auto', initial: stats});
  } else {
    window.dbStatistics.update(stats);
  }

  // 2) показать/скрыть «Проход» и «+ N −»
  state.els.roundRow.style.display = hasData ? '' : 'none';
  state.els.bGo.style.display = hasData ? '' : 'none';

  // 3) значение размера
  state.els.value.textContent = String(state.roundSize);

  log('stats', {
    coverage: fmtPct01(stats.coverage),
    avgAcc: stats.avgAcc?.toFixed?.(2) ?? '0.00',
    debt: stats.debt,
    entered: stats.entered,
    total: stats.total,
    hasData
  });
}

const api = {
  mount(container, opts = {}) {
    if (state.mounted) return;
    state.mounted = true;
    state.opts = opts || {};
    state.roundSize = clamp(+opts.roundSize || 5, 2, 60);

    state.els = build(container);

    // actions → наружу
    state.els.bImport.addEventListener('click', () => {
      log('click Import');
      state.opts.onImport && state.opts.onImport();
    });
    state.els.bImport600.addEventListener('click', () => {
      log('click Import 600');
      importFromUrl(state.els.bImport600, 'nouns/600.txt');
    });
    state.els.bImportAll.addEventListener('click', () => {
      log('click Import ALL');
      importFromUrl(state.els.bImportAll, 'nouns/all.txt');
    });
    state.els.bAdd.addEventListener('click', () => {
      log('click Add');
      state.opts.onAdd && state.opts.onAdd();
    });
    state.els.bVerbs.addEventListener('click', () => {
      log('click Verbs');
      state.opts.onVerbs && state.opts.onVerbs();
    });
    state.els.bExport.addEventListener('click', () => {
      log('click Export');
      state.opts.onExport && state.opts.onExport();
    });
    state.els.bDb.addEventListener('click', () => {
      log('click DB');
      state.opts.onDb && state.opts.onDb();
    });

    // round control
    state.els.minus.addEventListener('click', () => {
      state.roundSize = clamp(state.roundSize - 1, 3, 60);
      state.els.value.textContent = String(state.roundSize);
      state.opts.onChangeRoundSize &&
          state.opts.onChangeRoundSize(state.roundSize);
      log('roundSize-', state.roundSize);
    });
    state.els.plus.addEventListener('click', () => {
      state.roundSize = clamp(state.roundSize + 1, 3, 60);
      state.els.value.textContent = String(state.roundSize);
      state.opts.onChangeRoundSize &&
          state.opts.onChangeRoundSize(state.roundSize);
      log('roundSize+', state.roundSize);
    });

    state.els.bGo.addEventListener('click', () => {
      log('start round', {n: state.roundSize});
      state.opts.onStartRound && state.opts.onStartRound(state.roundSize);
    });

    render();
  },

  update(next = {}) {
    if (!state.mounted) return;
    if (next && typeof next.roundSize === 'number') {
      state.roundSize = clamp(next.roundSize, 3, 60);
    }
    render();
  },

  destroy() {
    if (!state.mounted) return;
    state.mounted = false;
    if (state.els && state.els.root && state.els.root.parentNode) {
      state.els.root.parentNode.removeChild(state.els.root);
    }
    state.els = null;
    state.statsWidget = null;
    state.hasData = false;
    log('destroy');
  }
};

window.screens = window.screens || {};
window.screens.home = api;
})();
