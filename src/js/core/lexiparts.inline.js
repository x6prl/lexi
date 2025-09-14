/* lexiparts.inline.js — генерация чанков/букв и опций клавиатуры для режимов
   CHUNKS/COMPOSE Использует (по желанию) window.lexidb для построения
   глобального инвентаря. Экспортирует глобально: window.lexiparts = {
       // Разбиение
       splitChunks(word),     // -> string[] (чанки 1..3)
       splitCompose(word),    // -> string[] (по буквам с учётом äöüß)
       // Инвентарь (ленивое построение из lexidb)
       ensureInventory(),     // -> Promise<{lettersFreq, chunksFreq, letters,
   chunks}> clearInventoryCache(),
       // Опции для шагов
       chunkOptionsFor(word, index, k=5),   // -> Promise<string[]> (варианты
   для очередного чанка) letterOptionsFor(word, index, k=6),  // ->
   Promise<string[]> (варианты для очередной буквы)
       // Планировщики шагов (все шаги сразу)
       planChunks(word, k=5),   // -> Promise<string[][]>   (по шагам)
       planCompose(word, k=6),  // -> Promise<string[][]>   (по шагам)
       // RNG
       setSeed(seedNumber),
       // Служебное
       version: '2.0.0-final'
     }
*/
(function() {
'use strict';

// ---------------- RNG: детерминируемый и быстрый ----------------
let _rngState =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) >>> 0;
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let _rand = mulberry32(_rngState);
function setSeed(seed) {
  _rngState = (seed >>> 0);
  _rand = mulberry32(_rngState);
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(_rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function weightedSampleDistinct(items, weightFn, k, excludeSet) {
  const pool = [];
  for (const it of items) {
    if (excludeSet && excludeSet.has(it)) continue;
    const w = Math.max(0, +weightFn(it) || 0);
    if (w <= 0) continue;
    pool.push([it, w]);
  }
  if (pool.length <= k) return pool.map(p => p[0]);
  // Roulette-wheel without replacement
  const res = [];
  const tmp = pool.slice();
  for (let n = 0; n < k && tmp.length > 0; n++) {
    const total = tmp.reduce((s, p) => s + p[1], 0);
    let r = _rand() * total, pick = 0;
    for (let i = 0; i < tmp.length; i++) {
      r -= tmp[i][1];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    res.push(tmp[pick][0]);
    tmp.splice(pick, 1);
  }
  return res;
}

// ---------------- Базовые наборы и утилиты ----------------
const VOWELS = 'aeiouyäöü';
const GERMAN_LOWER = Array.from('abcdefghijklmnopqrstuvwxyzäöüß');
function isVowel(ch) {
  return VOWELS.includes(ch.toLowerCase());
}

// Список приоритетных графем для ЧАНКОВ (макс длина 3, чтобы соответствовать
// ТЗ) Порядок важен — более длинные сначала
const CHUNK_GRAPHEMES = [
  // триграфы
  'sch', 'chs', 'spr', 'str', 'spl',
  // диграфы — частые
  'ch', 'ck', 'tz', 'pf', 'ph', 'qu', 'ng', 'sp', 'st', 'ei', 'ie', 'au', 'eu',
  'äu',
  // удвоенные согласные (диграфы)
  'ss', 'll', 'mm', 'nn', 'rr', 'tt', 'pp', 'ff', 'kk', 'dd', 'bb', 'gg', 'zz'
];

// Набор замен/пары для правдоподобных дистракторов
const CONFUSION_PAIRS = [
  ['ie', 'ei'], ['eu', 'äu'], ['ch', 'sch'], ['ck', 'k'], ['tz', 'z'],
  ['sp', 'st'], ['pf', 'f'], ['ph', 'f'], ['qu', 'ku'], ['ä', 'a'], ['ö', 'o'],
  ['ü', 'u'], ['ß', 'ss']
];

const UPPER_MAP = {
  'ä': 'Ä',
  'ö': 'Ö',
  'ü': 'Ü',
  'ß': 'ẞ'
};  // визуальная корректность

function lower(s) {
  return String(s || '').toLowerCase();
}
function keepCase(sample, pattern) {
  // Если pattern начинается с заглавной — делаем первую букву sample заглавной
  if (!pattern) return sample;
  if (pattern[0] === pattern[0].toUpperCase()) {
    if (sample.length === 0) return sample;
    const first = sample[0];
    const up = UPPER_MAP[first] || first.toUpperCase();
    return up + sample.slice(1);
  }
  return sample;
}

// ---------------- Разбиение слова ----------------
function splitChunks(word) {
  // Возвращает массив чанков 1..3 символа. Сохраняет регистр оригинала.
  const w = String(word || '');
  const lw = w.toLowerCase();
  const out = [];
  for (let i = 0; i < lw.length;) {
    let matched = null;
    // пробуем триграфы/диграфы
    for (const g of CHUNK_GRAPHEMES) {
      const L = g.length;
      if (i + L <= lw.length && lw.slice(i, i + L) === g) {
        matched = w.slice(i, i + L);  // оригинал с регистром
        i += L;
        break;
      }
    }
    if (!matched) {
      // одиночная буква
      matched = w[i];
      i += 1;
    }
    out.push(matched);
  }
  return out;
}

function splitCompose(word) {
  // По буквам (включая äöüß как единицы)
  const w = String(word || '');
  return Array.from(w);
}

function confusionsOf(tokenLower) {
  const out = new Set();
  for (const [a, b] of CONFUSION_PAIRS) {
    if (tokenLower === a) out.add(b);
    if (tokenLower === b) out.add(a);
  }
  // мягкая мутация (даже для многобуквенных чанков)
  out.add(mutateOnce(tokenLower));
  return Array.from(out).filter(x => x && x !== tokenLower);
}

// ---------------- Инвентарь (частоты) ----------------
let _inventory = null;  // {lettersFreq, chunksFreq, letters, chunks}

async function ensureInventory() {
  if (_inventory) return _inventory;
  const inv =
      {lettersFreq: new Map(), chunksFreq: new Map(), letters: [], chunks: []};
  const addFreq = (map, key, inc = 1) =>
      map.set(key, (map.get(key) || 0) + inc);

  let terms = [];
  try {
    if (typeof window !== 'undefined' && window.lexidb &&
        window.lexidb.allTerms) {
      await window.lexidb.open?.();
      terms = await window.lexidb.allTerms();
    }
  } catch (_) {
  }

  if (!terms || !terms.length) {
    for (const ch of GERMAN_LOWER) {
      addFreq(inv.lettersFreq, ch, 1);
    }
    for (const g of CHUNK_GRAPHEMES) {
      addFreq(inv.chunksFreq, g, 1);
    }
  } else {
    for (const t of terms) {
      const de = String(t.de || '');
      for (const L of splitCompose(de).map(lower))
        addFreq(inv.lettersFreq, L, 1);
      for (const C of splitChunks(de).map(lower)) addFreq(inv.chunksFreq, C, 1);
    }
    // маленький «подсев» базового алфавита/графем — по 1 очку
    for (const ch of GERMAN_LOWER) addFreq(inv.lettersFreq, ch, 1);
    for (const g of CHUNK_GRAPHEMES) addFreq(inv.chunksFreq, g, 1);
  }

  inv.letters = Array.from(inv.lettersFreq.keys());
  inv.chunks = Array.from(inv.chunksFreq.keys());
  _inventory = inv;
  return inv;
}

function clearInventoryCache() {
  _inventory = null;
}

// ---------------- Генерация дистракторов ----------------
function mutateOnce(token) {
  const x = lower(token);
  // Пробуем пары путаниц
  for (const [a, b] of CONFUSION_PAIRS) {
    if (x === a) return b;
    if (x === b) return a;
  }
  // Лёгкая буква-замена: поменять одну букву на соседнюю по набору
  if (x.length >= 1) {
    const i = Math.floor(_rand() * x.length);
    const c = x[i];
    const alphabet = GERMAN_LOWER;
    const alt = alphabet[Math.floor(_rand() * alphabet.length)];
    return x.slice(0, i) + alt + x.slice(i + 1);
  }
  return x;
}

function sameLength(items, len) {
  return items.filter(s => s.length === len);
}
function sameType(items, token) {
  // грубая эвристика: по шаблону "V/C" (гласная/согласная)
  const pat =
      Array.from(lower(token)).map(c => isVowel(c) ? 'V' : 'C').join('');
  return items.filter(
      s => Array.from(lower(s)).map(c => isVowel(c) ? 'V' : 'C').join('') ===
          pat);
}

// ---------------- Опции для CHUNKS ----------------
// CHUNKS: если целевой чанк = 1 символ, то все варианты тоже односимвольные
async function chunkOptionsFor(word, index, _ignoredK) {
  const inv = await ensureInventory();
  const chunks = splitChunks(word);
  const target = chunks[index] || '';
  const tLower = lower(target);
  const isSingle = tLower.length === 1;

  // исключаем ВСЕ чанки из того же слова, чтобы не подсказывать порядок
  const excl = new Set(chunks.map(lower));
  excl.add(tLower);

  const freq = (s) => inv.chunksFreq.get(lower(s)) || 1;

  // базовый пул: либо все односимвольные, либо 1..3 символа
  const basePoolAll = inv.chunks;
  const basePool = isSingle ?
      basePoolAll.filter(s => s.length === 1) :
      basePoolAll.filter(s => s.length >= 1 && s.length <= 3);

  const wantSimilar = _rand() < 0.5;
  const picks = [];

  // «похожие» (до 2 шт.), с учётом ограничения по длине
  if (wantSimilar) {
    const sims = confusionsOf(tLower)
                     .filter(s => !excl.has(s))
                     .filter(
                         s => isSingle ? s.length === 1 :
                                         (s.length >= 1 && s.length <= 3));
    for (const s of shuffle(sims).slice(0, 2)) {
      picks.push(keepCase(s, target));
      excl.add(lower(s));
    }
  }
  // добираем по частоте из пула, избегая исключений
  const need = Math.max(0, 4 - picks.length);
  const more = weightedSampleDistinct(basePool, (s) => freq(s), need, excl)
                   .map(s => keepCase(s, target));
  picks.push(...more);

  // крайний случай: домутируем до 4 дистракторов
  while (picks.length < 4) {
    let m = mutateOnce(tLower);
    if (isSingle) m = m.slice(0, 1);  // гарантируем 1 символ

    const okLen =
        isSingle ? (m.length === 1) : (m.length >= 1 && m.length <= 3);
    if (m && okLen && !excl.has(m)) {
      picks.push(keepCase(m, target));
      excl.add(m);
      continue;
    }
    // резервная ветка, если мутация не подошла
    if (isSingle) {
      const ch = GERMAN_LOWER[Math.floor(_rand() * GERMAN_LOWER.length)];
      if (!excl.has(ch)) {
        picks.push(keepCase(ch, target));
        excl.add(ch);
      }
    } else {
      const fb = basePool[Math.floor(_rand() * basePool.length)];
      if (fb && !excl.has(lower(fb))) {
        picks.push(keepCase(fb, target));
        excl.add(lower(fb));
      }
    }
  }

  return shuffle([target, ...picks.slice(0, 4)]);
}

// ---------------- Опции для COMPOSE ----------------
async function letterOptionsFor(word, index, _ignoredK) {
  const inv = await ensureInventory();
  const letters = splitCompose(word);
  const target = letters[index] || '';
  const tLower = lower(target);

  // исключаем ВСЕ буквы этого слова, кроме целевой
  const excl = new Set(letters.map(lower));
  excl.delete(tLower);
  excl.add(tLower);

  const freq = (s) => inv.lettersFreq.get(lower(s)) || 1;
  const basePool =
      (inv.letters && inv.letters.length >= 12) ? inv.letters : GERMAN_LOWER;

  const wantSimilar = _rand() < 0.5;
  const picks = [];

  if (wantSimilar) {
    const sims =
        confusionsOf(tLower).filter(s => s.length === 1 && !excl.has(s));
    for (const s of shuffle(sims).slice(0, 2)) {
      picks.push(keepCase(s, target));
      excl.add(lower(s));
    }
  }

  // добираем случайными буквами
  const need = Math.max(0, 4 - picks.length);
  const more = weightedSampleDistinct(basePool, (s) => freq(s), need, excl)
                   .map(s => keepCase(s, target));
  picks.push(...more);

  while (picks.length < 4) {
    const m = mutateOnce(tLower);
    if (m && m[0] && !excl.has(m[0])) {
      picks.push(keepCase(m[0], target));
      excl.add(m[0]);
    }
  }

  return shuffle([target, ...picks.slice(0, 4)]);
}


// ---------------- Планировщики шагов ----------------
async function planChunks(word, _k) {
  const chunks = splitChunks(word);
  const steps = [];
  for (let i = 0; i < chunks.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const opts = await chunkOptionsFor(word, i, 5);
    steps.push(opts);
  }
  return steps;
}
async function planCompose(word, _k) {
  const letters = splitCompose(word);
  const steps = [];
  for (let i = 0; i < letters.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const opts = await letterOptionsFor(word, i, 5);
    steps.push(opts);
  }
  return steps;
}

// ---------------- Экспорт API ----------------
const api = {
  // Разбиение
  splitChunks,
  splitCompose,
  // Инвентарь
  ensureInventory,
  clearInventoryCache,
  // Опции
  chunkOptionsFor,
  letterOptionsFor,
  // Шаги
  planChunks,
  planCompose,
  // RNG
  setSeed,
  // Версия
  version: '2.0.0-final'
};

if (typeof window !== 'undefined')
  window.lexiparts = api;
else if (typeof globalThis !== 'undefined')
  globalThis.lexiparts = api;
})();
