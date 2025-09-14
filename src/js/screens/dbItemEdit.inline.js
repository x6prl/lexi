/* dbItemEdit.inline.js — экран редактирования/удаления слова
   Зависимости:
     - window.lexidb
     - (опц.) window.util (el/clear/log)
   Экспорт:
     window.screens.dbItemEdit = {
       mount(container, {
         termId,        // string — id редактируемого терма
         onBack,        // () => void
         onSaved,       // (newId) => void
         onDeleted      // () => void
       }),
       destroy()
     }
*/
(function() {
'use strict';

// ---------- utils ----------
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
    (U.log ? U.log('dbItemEdit') : (...a) => console.log('[dbItemEdit]', ...a));

const ALLOWED_ART = new Set(['der', 'die', 'das']);
const ALLOWED_PL = new Set([
  '-', '"-', '"-e', '"-en', '-e', '-en', '"-n', '-n', '-nen', '-s', '-er',
  '"-er'
]);

const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
function parseTermLine(line) {
  const parts = norm(line).split(' ');
  if (parts.length < 2) throw new Error('Слишком короткая term-строка');
  const art = String(parts[0]).toLowerCase().trim();
  if (!ALLOWED_ART.has(art))
    throw new Error('Недопустимый артикль (der/die/das)');
  const maybePl = parts[parts.length - 1];
  if (!ALLOWED_PL.has(maybePl))
    throw new Error(
        'В конце должен быть шаблон мн. числа (например, -e или "-er)');
  const de = norm(parts.slice(1, -1).join(' '));
  if (!de) throw new Error('Пустое слово (de)');
  return {art, de, pl: maybePl};
}
function parseRuLine(line) {
  const raw = String(line || '').trim().replace(/;+\s*$/, '');
  if (!raw) return [];
  return raw.split(';').map(s => s.trim()).filter(Boolean);
}
function applyUmlautOnce(stem) {
  const map = {a: 'ä', o: 'ö', u: 'ü'};
  let i = stem.toLowerCase().lastIndexOf('au');
  if (i >= 0) {
    const seg = stem.slice(i, i + 2);
    const repl = (seg[0] === seg[0].toUpperCase()) ? 'Äu' : 'äu';
    return stem.slice(0, i) + repl + stem.slice(i + 2);
  }
  let best = -1, v = '';
  for (const ch of ['a', 'o', 'u']) {
    const pos = stem.toLowerCase().lastIndexOf(ch);
    if (pos > best) {
      best = pos;
      v = ch;
    }
  }
  if (best >= 0) {
    const orig = stem[best], lo = orig.toLowerCase(), target = map[lo];
    const repl = (orig === orig.toUpperCase()) ? target.toUpperCase() : target;
    return stem.slice(0, best) + repl + stem.slice(best + 1);
  }
  return stem;
}
function pluralOf(base, pattern) {
  const needU = pattern.startsWith('"');
  const suf = pattern === '-' ? '' : pattern.replace(/^"?-?/, '');
  const stem = needU ? applyUmlautOnce(base) : base;
  return stem + suf;
}
function makeId({art, de, pl}) {
  return `${art} ${norm(de)} ${pl}`;
}

// ---------- view ----------
function build(container) {
  clear(container);
  const root = el('section', 'dbedit');
  const wrap = el('div', 'wrap');

  const head = el('div', 'head');
  const back = el('button', 'back', '←');
  const ttl = el('div', 'ttl', 'Редактировать');
  head.append(back, ttl);

  const card = el('section', 'card');
  const hint = el(
      'div', 'hint',
      'Блок импорта\n1-я строка: артикль + слово + мн. число; 2-я строка: переводы через ;');
  const ta = document.createElement('textarea');
  ta.className = 'ta';
  const err = el('div', 'err', '');
  err.style.display = 'none';
  const preview = el('div', 'preview');

  const row = el('div', 'row');
  const save = el('button', 'btn primary', 'Сохранить');
  save.disabled = true;
  const del = el('button', 'btn warn', 'Удалить');
  const cancel = el('button', 'btn ghost', 'Отмена');

  row.append(save, del);
  card.append(hint, ta, err, preview, row, cancel);

  wrap.append(head, card);
  root.appendChild(wrap);
  container.appendChild(root);

  return {root, wrap, back, ta, err, preview, save, del, cancel, ttl};
}

// ---------- DB actions ----------
async function readTerm(id) {
  await window.lexidb.open?.();
  const t = await window.lexidb.getTerm(id);
  if (!t) throw new Error('Терм не найден');
  return t;
}
async function writeTerm(oldId, next) {
  await window.lexidb.open?.();
  const oldStats = await window.lexidb.getStats(oldId);
  // put new term
  await window.lexidb.putTerm(next);
  const newId = next.id;
  // перенос статистики, если id поменялся
  if (newId !== oldId && oldStats) {
    const moved = Object.assign({}, oldStats, {id: newId});
    await window.lexidb.putStats(moved);
    // удалить старую запись stats
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('lexi.v2', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['stats'], 'readwrite');
        tx.objectStore('stats').delete(oldId);
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }
  // если id изменился — удалить старый term
  if (newId !== oldId) {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('lexi.v2', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['terms'], 'readwrite');
        tx.objectStore('terms').delete(oldId);
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }
  return newId;
}
async function deleteTermWithStats(id) {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('lexi.v2', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['terms', 'stats'], 'readwrite');
      tx.objectStore('terms').delete(id);
      tx.objectStore('stats').delete(id);
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------- state / api ----------
const state = {
  mounted: false,
  els: null,
  opts: {},
  originalId: null
};

const api = {
  async mount(container, opts = {}) {
    if (state.mounted) return;
    state.mounted = true;
    state.opts = opts || {};
    state.els = build(container);
    const {back, cancel, save, del} = state.els;

    back.addEventListener('click', () => {
      if (typeof state.opts.onBack === 'function') state.opts.onBack();
    });
    cancel.addEventListener('click', () => {
      if (typeof state.opts.onBack === 'function') state.opts.onBack();
    });

    // load
    try {
      const term = await readTerm(opts.termId);
      state.originalId = term.id;
      // prefill textarea
      const line1 = `${term.art} ${term.de} ${term.pl}`;
      const line2 =
          Array.isArray(term.ru) ? term.ru.join('; ') : String(term.ru || '');
      state.els.ta.value = `${line1}\n${line2}`;
      state.els.ttl.textContent = `Редактировать`;
    } catch (e) {
      state.els.ta.value = '';
      state.els.err.style.display = 'block';
      state.els.err.textContent =
          'Ошибка загрузки: ' + (e && e.message ? e.message : e);
    }

    function render() {
      try {
        const lines = String(state.els.ta.value || '')
                          .split(/\r?\n/)
                          .map(s => s.trim())
                          .filter(Boolean);
        if (lines.length < 1) throw new Error('Вставьте 2 строки по формату');
        const t = parseTermLine(lines[0]);
        const ru = parseRuLine(lines[1] || '');
        const plural = pluralOf(t.de, t.pl);
        state.els.preview.innerHTML =
            `<strong>Предпросмотр</strong><br>Слово: <b>${
                t.de}</b> • Артикль: <b>${t.art}</b><br>Мн. число: <b>${
                plural}</b><br>Переводы: ${ru.join('; ') || '—'}`;
        state.els.err.style.display = 'none';
        state.els.save.disabled = false;
      } catch (e) {
        state.els.err.textContent =
            'Ошибка формата — ' + (e && e.message ? e.message : e);
        state.els.err.style.display = 'block';
        state.els.preview.textContent = '';
        state.els.save.disabled = true;
      }
    }
    state.els.ta.addEventListener('input', render);
    render();

    save.addEventListener('click', async () => {
      try {
        const lines = String(state.els.ta.value || '')
                          .split(/\r?\n/)
                          .map(s => s.trim())
                          .filter(Boolean);
        const t = parseTermLine(lines[0]);
        const ru = parseRuLine(lines[1] || '');
        const id = makeId(t);
        const rec = {id, art: t.art, de: t.de, pl: t.pl, ru};
        const newId = await writeTerm(state.originalId, rec);
        state.originalId = newId;
        log('saved', newId);
        if (typeof state.opts.onSaved === 'function') state.opts.onSaved(newId);
      } catch (e) {
        alert('Не удалось сохранить: ' + (e && e.message ? e.message : e));
      }
    });

    del.addEventListener('click', async () => {
      if (!confirm('Удалить это слово и его статистику?')) return;
      try {
        await deleteTermWithStats(state.originalId);
        if (typeof state.opts.onDeleted === 'function') state.opts.onDeleted();
      } catch (e) {
        alert('Не удалось удалить: ' + (e && e.message ? e.message : e));
      }
    });

    log('mounted', {id: opts.termId});
  },

  destroy() {
    if (!state.mounted) return;
    const root = state.els?.root;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    state.mounted = false;
    state.els = null;
    state.opts = {};
    state.originalId = null;
    log('destroyed');
  }
};

window.screens = window.screens || {};
window.screens.dbItemEdit = api;
})();
