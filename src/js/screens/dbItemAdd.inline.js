/* dbItemAdd.inline.js — экран добавления нового слова */
(function() {
'use strict';
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
    (U.log ? U.log('dbItemAdd') : (...a) => console.log('[dbItemAdd]', ...a));

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
    throw new Error('В конце нужен шаблон мн. числа (например, -e или "-er)');
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

function build(container) {
  clear(container);
  const root = el('section', 'dbadd');
  const wrap = el('div', 'wrap');
  const head = el('div', 'head');
  const back = el('button', 'back', '←');
  const ttl = el('div', 'ttl', 'Добавить слово');
  head.append(back, ttl);

  const card = el('section', 'card');
  const hint = el(
      'div', 'hint',
      'Блок импорта\n1-я строка: артикль + слово + мн. число\n2-я строка: переводы через ;');
  const ta = document.createElement('textarea');
  ta.className = 'ta';
  ta.placeholder = 'der Hand "-e\nрука; кисть (руки)';
  const err = el('div', 'err', '');
  const preview =
      el('div', 'preview', 'Предпросмотр появится при корректном формате');

  const row = el('div', 'row');
  const cancel = el('button', 'btn ghost', 'Отмена');
  const add = el('button', 'btn primary', 'Добавить');
  add.disabled = true;
  row.append(cancel, add);

  card.append(hint, ta, err, preview, row);
  wrap.append(head, card);
  root.appendChild(wrap);
  container.appendChild(root);
  return {root, wrap, back, ttl, ta, err, preview, add, cancel};
}

const state = {
  mounted: false,
  els: null,
  opts: {}
};

async function saveBlock(text) {
  await window.lexidb.open?.();
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim());
  if (!lines[0]) throw new Error('Нет 1-й строки');
  const t = parseTermLine(lines[0]);
  const ru = parseRuLine(lines[1] || '');
  const id = makeId(t);
  const rec = {id, art: t.art, de: t.de, pl: t.pl, ru};
  await window.lexidb.putTerm(rec);
  await window.lexidb.ensureStats(id);  // на всякий
  return id;
}

function renderPreview() {
  const {ta, err, preview, add} = state.els;
  try {
    const lines = String(ta.value || '').split(/\r?\n/).map(s => s.trim());
    if (!lines[0]) {
      add.disabled = true;
      err.style.display = 'none';
      preview.textContent = '';
      return;
    }
    const t = parseTermLine(lines[0]);
    const ru = parseRuLine(lines[1] || '');
    const pl = pluralOf(t.de, t.pl);
    preview.innerHTML = `<strong>Предпросмотр</strong><br>Слово: <b>${
        t.de}</b> • Артикль: <b>${t.art}</b><br>Мн. число: <b>${
        pl}</b><br>Переводы: ${ru.join('; ') || '—'}`;
    err.style.display = 'none';
    add.disabled = false;
  } catch (e) {
    err.textContent = 'Ошибка формата — ' + (e?.message || e);
    err.style.display = 'block';
    add.disabled = true;
    preview.textContent = '';
  }
}

const api = {
  mount(container, opts = {}) {
    if (state.mounted) return;
    state.mounted = true;
    state.opts = opts || {};
    state.els = build(container);

    // чистые поля при каждом открытии
    state.els.ta.value = '';
    state.els.err.style.display = 'none';
    state.els.preview.textContent =
        'Предпросмотр появится при корректном формате';
    state.els.add.disabled = true;

    state.els.ta.addEventListener('input', renderPreview);
    state.els.back.addEventListener(
        'click', () => opts.onBack && opts.onBack());
    state.els.cancel.addEventListener(
        'click', () => opts.onBack && opts.onBack());

    state.els.add.addEventListener('click', async () => {
      try {
        const id = await saveBlock(state.els.ta.value);
        // reset формы после добавления
        state.els.ta.value = '';
        state.els.add.disabled = true;
        state.els.preview.textContent =
            'Предпросмотр появится при корректном формате';
        state.els.err.style.display = 'none';
        if (typeof opts.onAdded === 'function') opts.onAdded(id);
      } catch (e) {
        alert('Не удалось добавить: ' + (e?.message || e));
      }
    });

    renderPreview();
    log('mounted');
  },
  destroy() {
    if (!state.mounted) return;
    state.mounted = false;
    if (state.els?.root?.parentNode)
      state.els.root.parentNode.removeChild(state.els.root);
    state.els = null;
    state.opts = {};
    log('destroyed');
  }
};
window.screens = window.screens || {};
window.screens.dbItemAdd = api;
})();
