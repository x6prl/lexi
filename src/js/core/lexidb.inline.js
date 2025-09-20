/* lexidb.inline.js — offline словарь + статы (IndexedDB) для немецких
   существительных Экспортирует глобально: window.lexidb = {
       // DB
       open, // Promise<void>
       // Terms
       importText, getTerm, putTerm, allTerms, listTermIds,
       // Stats V2
       getStats, ensureStats, putStats, coverage, newTermIds,
       // Helpers
       applyPlural, pluralOf,
       // meta
       version: '2.1.0-verbs-prep'
     }
*/
(function() {
'use strict';

const DB_NAME = 'lexi.v2';
const DB_VERSION = 2;
const STORE_TERMS = 'terms';
const STORE_STATS = 'stats';
// --- verbs extension stores (v = verbs) ---
const STORE_VERBS = 'verbs';
const STORE_MORPH = 'morph';
const STORE_FRAMES = 'frames';
const STORE_COLLS = 'colls';
const STORE_CONTRASTS = 'contrasts';
const STORE_DISTRACTORS = 'distractors';
const STORE_VSTATS = 'vstats';
const STORE_VATTEMPTS = 'vattempts';

const ALLOWED_ART = new Set(['der', 'die', 'das']);
const ALLOWED_PL = new Set([
  '-', '"-', '"-e', '"-en', '-e', '-en', '"-n', '-n', '-nen', '-s', '-er',
  '"-er'
]);

// Инициализационные значения для стейтов режимов
const INIT_S = {
  M: 0.75,
  C: 0.60,
  P: 0.50
};  // days
const INIT_Q = 0.5;
const INIT_STREAK = 0;

// --- IndexedDB utils ---
let _dbPromise = null;
function open() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TERMS)) {
        const os = db.createObjectStore(STORE_TERMS, {keyPath: 'id'});
        os.createIndex('art', 'art', {unique: false});
        os.createIndex('de', 'de', {unique: false});
        os.createIndex('pl', 'pl', {unique: false});
      }
      if (!db.objectStoreNames.contains(STORE_STATS)) {
        const os = db.createObjectStore(STORE_STATS, {keyPath: 'id'});
        os.createIndex('intro', 'intro', {unique: false});
        os.createIndex('stage', 'stage', {unique: false});
      }
      // ---- verbs layer ----
      if (!db.objectStoreNames.contains(STORE_VERBS)) {
        const verbs = db.createObjectStore(STORE_VERBS, {keyPath: 'id'});
        verbs.createIndex('lemma', 'lemma', {unique: true});
      }
      if (!db.objectStoreNames.contains(STORE_MORPH)) {
        const morph = db.createObjectStore(STORE_MORPH, {keyPath: 'id'});
        morph.createIndex('verbId', 'verbId', {unique: true});
      }
      if (!db.objectStoreNames.contains(STORE_FRAMES)) {
        const frames = db.createObjectStore(STORE_FRAMES, {keyPath: 'id'});
        frames.createIndex('verbId', 'verbId');
        frames.createIndex('type', 'type');
        frames.createIndex('frequency', 'frequency');
      }
      if (!db.objectStoreNames.contains(STORE_COLLS)) {
        const colls = db.createObjectStore(STORE_COLLS, {keyPath: 'id'});
        colls.createIndex('frameId', 'frameId');
      }
      if (!db.objectStoreNames.contains(STORE_CONTRASTS)) {
        const contrasts = db.createObjectStore(STORE_CONTRASTS, {keyPath: 'id'});
        contrasts.createIndex('frameId', 'frameId');
      }
      if (!db.objectStoreNames.contains(STORE_DISTRACTORS)) {
        const dist = db.createObjectStore(STORE_DISTRACTORS, {keyPath: 'id'});
        dist.createIndex('frameId', 'frameId');
        dist.createIndex('slot', 'slot');
      }
      if (!db.objectStoreNames.contains(STORE_VSTATS)) {
        const stats = db.createObjectStore(STORE_VSTATS, {keyPath: 'id'});
        stats.createIndex('dueAt', 'due', {unique: false});
      }
      if (!db.objectStoreNames.contains(STORE_VATTEMPTS)) {
        const attempts = db.createObjectStore(STORE_VATTEMPTS, {keyPath: 'id'});
        attempts.createIndex('frameId', 'frameId');
        attempts.createIndex('slot', 'slot');
        attempts.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function withStores(mode, names, fn) {
  return open().then(db => new Promise((resolve, reject) => {
                       const tx = db.transaction(names, mode);
                       const stores = names.map(n => tx.objectStore(n));
                       let done = false;
                       tx.oncomplete = () => {
                         if (!done) {
                           done = true;
                           resolve();
                         }
                       };
                       tx.onabort = tx.onerror = () => {
                         if (!done) {
                           done = true;
                           reject(tx.error);
                         }
                       };
                       Promise.resolve(fn.apply(null, stores))
                           .then(val => { /* pass; tx completes */
                                          resolve(val);
                           })
                           .catch(err => {
                             try {
                               tx.abort();
                             } catch (_) {
                             }
                             reject(err);
                           });
                     }));
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(store) {
  if ('getAll' in store) return await reqAsPromise(store.getAll());
  // fallback cursor
  const out = [];
  await new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return resolve();
      out.push(cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out;
}

async function getAllKeys(store) {
  if ('getAllKeys' in store) return await reqAsPromise(store.getAllKeys());
  const out = [];
  await new Promise((resolve, reject) => {
    const req = store.openKeyCursor();
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return resolve();
      out.push(cur.primaryKey);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out;
}

// --- Helpers: strings / arrays ---
function normSpaces(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = typeof x === 'string' ? x.trim() : x;
    if (!k && k !== 0) continue;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

// --- ID builder & validators ---
function makeId(art, de, pl) {
  art = String(art || '').toLowerCase().trim();
  de = normSpaces(de);
  pl = (pl == null || pl === '') ? '-' : String(pl).trim();
  return `${art} ${de} ${pl}`;
}

function validateArt(art) {
  art = String(art || '').toLowerCase().trim();
  if (!ALLOWED_ART.has(art)) throw new Error(`Недопустимый артикль: "${art}"`);
  return art;
}

function validatePl(pl) {
  pl = (pl == null || pl === '') ? '-' : String(pl).trim();
  if (!ALLOWED_PL.has(pl))
    throw new Error(`Недопустимый шаблон мн. числа: "${pl}"`);
  return pl;
}

// --- Plural building ---
function applyUmlautOnce(stem) {
  // Эвристика: сначала 'au' -> 'äu' (последнее вхождение), иначе последний
  // a/o/u Учитываем регистр для первой буквы Пример: Hand -> Hände; Haus ->
  // Häuser; Mutter -> Mütter; Sohn -> Söhne
  const map = {'a': 'ä', 'o': 'ö', 'u': 'ü'};
  // Try 'au' or 'Au' (последнее вхождение)
  let idx = stem.toLowerCase().lastIndexOf('au');
  if (idx >= 0) {
    const seg = stem.slice(idx, idx + 2);
    const repl = (seg[0] === seg[0].toUpperCase()) ? 'Äu' : 'äu';
    return stem.slice(0, idx) + repl + stem.slice(idx + 2);
  }
  // Else last single vowel a/o/u
  let best = -1, vch = '';
  for (const v of ['a', 'o', 'u']) {
    const pos = stem.toLowerCase().lastIndexOf(v);
    if (pos > best) {
      best = pos;
      vch = v;
    }
  }
  if (best >= 0) {
    const orig = stem[best];
    const lower = orig.toLowerCase();
    const target = map[lower];
    const repl = (orig === orig.toUpperCase()) ? target.toUpperCase() : target;
    return stem.slice(0, best) + repl + stem.slice(best + 1);
  }
  return stem;  // нет подходящей гласной
}

function applyPlural(base, pattern) {
  base = String(base || '').trim();
  pattern = validatePl(pattern);
  const needUmlaut = pattern.startsWith('"');
  const suffix = pattern === '-' ? '' : pattern.replace(/^"?-?/, '');
  const stem = needUmlaut ? applyUmlautOnce(base) : base;
  return stem + suffix;
}

function pluralOf(art, de, pl) {
  return applyPlural(de, validatePl(pl));
}

// --- Parsing import blocks ---
function parseTermLine(line) {
  // ожидаем: "<art> <de> <pl>"
  // где <pl> ∈ ALLOWED_PL; выделяем последний токен как pl
  line = normSpaces(line);
  const parts = line.split(' ');
  if (parts.length < 2) throw new Error('Слишком короткая term-строка');
  const art = validateArt(parts[0]);
  const maybePl = parts[parts.length - 1];
  let pl = null, de = null;
  if (ALLOWED_PL.has(maybePl)) {
    pl = maybePl;
    de = normSpaces(parts.slice(1, -1).join(' '));
  } else {
    throw new Error(
        `Не найден корректный шаблон мн. числа в конце строки: "${line}"`);
  }
  if (!de) throw new Error('Пустое слово (de) после парсинга');
  return {art, de, pl};
}

function parseRuLine(line) {
  // "рука; кисть (руки);" -> ['рука','кисть (руки)']
  const raw = String(line || '').trim().replace(/;+\s*$/, '');
  if (!raw) return [];
  return uniq(raw.split(';').map(s => s.trim()).filter(Boolean));
}

function mergeRu(existingRu, incomingRu) {
  const a = Array.isArray(existingRu) ? existingRu : [];
  const b = Array.isArray(incomingRu) ? incomingRu : [];
  // Сохраняем порядок: сначала новые (b), затем недостающие из a
  const out = [];
  const seen = new Set();
  for (const x of b) {
    const t = x.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  for (const x of a) {
    const t = x.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// --- Default stats factory ---
function nowTs() {
  return Date.now();
}
function defaultModeState(Sdays, now) {
  return {
    S: +Sdays,           // days
    last: now,           // ms
    due: now,            // ms
    q: INIT_Q,           // 0..1
    streak: INIT_STREAK  // int
  };
}
function defaultStats(id, now) {
  return {
    id,
    stage: 'MC5',
    intro: false,
    M: defaultModeState(INIT_S.M, now),
    C: defaultModeState(INIT_S.C, now),
    P: defaultModeState(INIT_S.P, now)
  };
}

// --- Public: Terms CRUD ---
async function getTerm(id) {
  return await withStores('readonly', [STORE_TERMS], async (terms) => {
    return await reqAsPromise(terms.get(id));
  });
}

async function putTerm(term) {
  // expects {id, art, de, pl, ru[]}
  if (!term || !term.id) throw new Error('putTerm: отсутствует id');
  return await withStores('readwrite', [STORE_TERMS], async (terms) => {
    return await reqAsPromise(terms.put(term));
  });
}

async function listTermIds() {
  return await withStores('readonly', [STORE_TERMS], async (terms) => {
    return await getAllKeys(terms);
  });
}

async function allTerms() {
  return await withStores('readonly', [STORE_TERMS], async (terms) => {
    return await getAll(terms);
  });
}

// --- Public: Stats V2 CRUD ---
async function getStats(id) {
  return await withStores('readonly', [STORE_STATS], async (stats) => {
    return await reqAsPromise(stats.get(id));
  });
}

async function putStats(statsObj) {
  if (!statsObj || !statsObj.id) throw new Error('putStats: отсутствует id');
  return await withStores('readwrite', [STORE_STATS], async (stats) => {
    return await reqAsPromise(stats.put(statsObj));
  });
}

async function ensureStats(id) {
  return await withStores('readwrite', [STORE_STATS], async (stats) => {
    const cur = await reqAsPromise(stats.get(id));
    if (cur) return cur;
    const s = defaultStats(id, nowTs());
    await reqAsPromise(stats.put(s));
    return s;
  });
}

async function coverage() {
  // % слов, введённых в обучение (intro==true) / общее число terms
  const [tot, introduced] = await withStores(
      'readonly', [STORE_TERMS, STORE_STATS], async (terms, stats) => {
        const [allIds, allStats] =
            await Promise.all([getAllKeys(terms), getAll(stats)]);
        const introCount =
            allStats.reduce((acc, s) => acc + (s && s.intro ? 1 : 0), 0);
        return [allIds.length, introCount];
      });
  if (tot === 0) return 0;
  return introduced / tot;
}

async function newTermIds() {
  // те, кто ещё не intro==true (либо нет stats)
  return await withStores(
      'readonly', [STORE_TERMS, STORE_STATS], async (terms, stats) => {
        const [ids, statList] =
            await Promise.all([getAllKeys(terms), getAll(stats)]);
        const stById = new Map(statList.map(s => [s.id, s]));
        const out = [];
        for (const id of ids) {
          const st = stById.get(id);
          if (!st || !st.intro) out.push(id);
        }
        return out;
      });
}

// --- Public: Import ---
async function importText(txt) {
  // Формат: блоки через пустую строку: line1=term, line2=ru
  // Возвращает { added, updated, skipped, errors: [ {blockIndex, message} ] }
  const blocks =
      String(txt || '').split(/\r?\n\r?\n+/).map(b => b.trim()).filter(Boolean);
  const res = {added: 0, updated: 0, skipped: 0, errors: []};

  await withStores(
      'readwrite', [STORE_TERMS, STORE_STATS], async (terms, stats) => {
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          const lines = block.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          if (lines.length < 1) {
            res.skipped++;
            continue;
          }
          const termLine = lines[0];
          const ruLine = lines[1] || '';
          try {
            const {art, de, pl} = parseTermLine(termLine);
            const ru = parseRuLine(ruLine);
            const id = makeId(art, de, pl);
            const existing = await reqAsPromise(terms.get(id));
            if (existing) {
              // merge ru, update only if changed
              const mergedRu = mergeRu(existing.ru || [], ru);
              const needUpdate = JSON.stringify(mergedRu) !==
                  JSON.stringify(existing.ru || []);
              if (needUpdate) {
                existing.ru = mergedRu;
                await reqAsPromise(terms.put(existing));
                res.updated++;
              } else {
                res.skipped++;
              }
            } else {
              const record = {id, art, de, pl, ru};
              await reqAsPromise(terms.put(record));
              // create default stats if not present
              const st = await reqAsPromise(stats.get(id));
              if (!st) {
                await reqAsPromise(stats.put(defaultStats(id, nowTs())));
              }
              res.added++;
            }
          } catch (err) {
            res.errors.push(
                {blockIndex: i, message: String(err && err.message || err)});
          }
        }
      });

  return res;
}

// --- Public API export ---
const api = {
  open,
  importText,

  getTerm,
  putTerm,
  allTerms,
  listTermIds,

  getStats,
  ensureStats,
  putStats,
  coverage,
  newTermIds,

  applyPlural,
  pluralOf,

  version: '2.1.0-verbs-prep'
};

// attach
if (typeof window !== 'undefined')
  window.lexidb = api;
else if (typeof globalThis !== 'undefined')
  globalThis.lexidb = api;
})();
