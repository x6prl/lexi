/* dbList.inline.js — экран со списком всех слов из БД с фильтром
   Зависимости:
     - window.lexidb              (обязателен)
     - window.dbItemStatistics    (виджет одной строки)
     - (опц.) window.util         (el/clear/log), есть фолбэки

   Экспорт:
     window.screens.dbList = {
       mount(container, {
         onBack,          // () => void
         onOpen,          // (termId:string) => void   — тап по строке
         onDeleted        // () => void                — после очистки БД
       }),
       update(),          // перечитать БД и перерисовать
       destroy()
     }
*/
(function() {
'use strict';

// ---------- утилиты ----------
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
const log = (U.log ? U.log('dbList') : (...a) => console.log('[dbList]', ...a));

// ---------- helpers ----------
function formatTerm(t) {
  return `${t.art} ${t.de} ${t.pl}`;
}
function normalizeQuery(q) {
  return String(q || '').toLowerCase().trim();
}
function tokenMatch(hay, q) {
  if (!q) return true;
  const s = String(hay || '').toLowerCase();
  return s.includes(q);
}
function matches(term, q) {
  if (!q) return true;
  const toks = q.split(/\s+/).filter(Boolean);
  const base = [
    term.art, term.de, term.pl,
    ...(Array.isArray(term.ru) ? term.ru : [term.ru || ''])
  ].map(x => String(x || '').toLowerCase());
  return toks.every(tok => base.some(f => f.includes(tok)));
}
function sumShown(st) {
  return (+st?.M?.n || 0) + (+st?.C?.n || 0) + (+st?.P?.n || 0);
}

// ---------- DOM build ----------
function build(container) {
  clear(container);

  const root = el('section', 'dbl');
  const wrap = el('div', 'wrap');

  const top = el('div', 'top');
  const back = el('button', 'back', '←');
  const ttl = el('div', 'ttl', 'База');
  top.append(back, ttl);
  const sub = el('div', 'sub', 'все слова со статистикой');

  const search = el('div', 'search');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Фильтр: артикль/слово/перевод…';
  search.appendChild(input);

  const list = el('div', 'list');

  wrap.append(top, sub, search, list);
  root.appendChild(wrap);
  container.appendChild(root);

  return {root, wrap, back, input, list};
}

// ---------- загрузка и рендер ----------
async function readAll() {
  await window.lexidb.open?.();
  const terms = await window.lexidb.allTerms();
  // читаем статы пачкой
  const stats = await Promise.all(terms.map(
      t => window.lexidb.getStats(t.id).then(
          s => s || window.lexidb.ensureStats(t.id))));
  // склеиваем
  const rows = terms.map((t, i) => ({term: t, stats: stats[i]}));
  // сортировка по слову
  rows.sort((a, b) => a.term.de.localeCompare(b.term.de, 'de'));
  return rows;
}

function renderRows(rows, q) {
  clear(state.els.list);

  // Кнопка «Удалить всё»
  const wipe = el('div', 'wipe');
  wipe.append(el('div', 'icon', '␡'), el('div', 'txt', 'Удалить всё'));
  wipe.addEventListener('click', onWipeAll);
  state.els.list.appendChild(wipe);

  let shown = 0;

  for (const {term, stats} of rows) {
    if (!matches(term, q)) continue;

    const s = Object.assign({}, stats || {});
    // добавим stage/shown (для виджета)
    s.shown = sumShown(stats);

    const row = window.dbItemStatistics.create({
      term: formatTerm(term),
      translations: term.ru || [],
      stats: s,
      onClick: () => {
        if (typeof state.opts.onOpen === 'function') state.opts.onOpen(term.id);
      }
    });

    state.els.list.appendChild(row);
    shown++;
  }

  if (shown === 0) {
    const empty = el('div', 'empty', 'Ничего не найдено. Измените запрос.');
    state.els.list.appendChild(empty);
  }
}

// ---------- очистка БД ----------
async function wipeAll() {
  // Полная очистка IndexedDB базы 'lexi.v2' (stores: 'terms', 'stats')
  // См. реализацию lexidb.inline.js (DB_NAME/STORE_TERMS/STORE_STATS).
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('lexi.v2', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['terms', 'stats'], 'readwrite');
      const stT = tx.objectStore('terms');
      const stS = tx.objectStore('stats');
      stT.clear();
      stS.clear();
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    };
  });
}

async function onWipeAll() {
  if (!confirm('Удалить все слова и статистику? Это действие нельзя отменить.'))
    return;
  try {
    await wipeAll();
    log('DB cleared');
    await api.update();
    if (typeof state.opts.onDeleted === 'function') state.opts.onDeleted();
  } catch (e) {
    console.error('[dbList] wipe error', e);
    alert('Не удалось очистить базу: ' + (e && e.message ? e.message : e));
  }
}

// ---------- state / API ----------
const state = {
  mounted: false,
  els: null,
  rows: [],
  opts: {}
};

const api = {
  async mount(container, opts = {}) {
    if (state.mounted) return;
    state.mounted = true;
    state.opts = opts || {};
    state.els = build(container);

    state.els.back.addEventListener('click', () => {
      if (typeof state.opts.onBack === 'function') state.opts.onBack();
    });

    state.els.input.addEventListener('input', () => {
      const q = normalizeQuery(state.els.input.value);
      renderRows(state.rows, q);
    });

    await api.update();
    log('mounted');
  },

  async update() {
    if (!state.mounted) return;
    try {
      state.rows = await readAll();
      const q = normalizeQuery(state.els.input.value);
      renderRows(state.rows, q);
    } catch (e) {
      console.error('[dbList] update error', e);
      clear(state.els.list);
      state.els.list.appendChild(
          el('div', 'empty',
             'Ошибка чтения базы. Попробуйте перезагрузить страницу.'));
    }
  },

  destroy() {
    if (!state.mounted) return;
    state.mounted = false;
    const root = state.els && state.els.root;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    state.els = null;
    state.rows = [];
    state.opts = {};
    log('destroyed');
  }
};

window.screens = window.screens || {};
window.screens.dbList = api;
})();
