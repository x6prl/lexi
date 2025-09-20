/* excercise.inline.js — экран выполнения упражнения (MC5 / CHUNKS / COMPOSE)
   Модель: «толстый экран, простой роутер».
   Экран сам делает:
     - выбор следующей карточки (cardengine.sampleNext)
     - построение шагов и нормализацию опций (Keypad 3..6, WordChoice = 5)
     - обновление памяти (cardengine.onReview)
     - ведёт лог в консоль

   Зависимости (глобально):
     - window.lexidb
     - window.cardengine
     - window.lexiparts
     - window.KeypadIsland
     - window.createWordChoiceIsland
     - (опц.) window.util

   Экспорт:
     window.screens.excercise = {
       mount(container, opts),
       destroy()
     }

   opts:
     - progress?: { index:number, total:number } // "[2/5]" слева-сверху
     - seed?: number                              // детерминированные опции
     - termId?: string, mode?: 'MC5'|'CHUNKS'|'COMPOSE'  // (необязательно)
   принудительная карточка
     - onDone?: (payload) => void  // завершение упражнения:
         payload = {
           term, mode, success, errors,
           picks: { article, word?, chunks?, letters?, plural },
           correct: { article, word, chunks?, letters?, plural }
         }
*/

(function() {
'use strict';

// ---------- утилиты и фолбэки ----------
const U = window.util || {};
const log =
    (U.log ? U.log('exercise') : (...a) => console.log('[exercise]', ...a));
const el = U.el || ((tag, cls, text) => {
             const e = document.createElement(tag);
             if (cls) e.className = cls;
             if (text != null) e.textContent = text;
             return e;
           });
const clear = U.clear || (node => {
                while (node && node.firstChild)
                  node.removeChild(node.firstChild);
              });
const clamp = U.clamp || ((x, min, max) => Math.max(min, Math.min(max, x)));
const rndShuffle = (arr) =>
    arr.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);

function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const chunk of parts) {
    const text = String(chunk ?? '');
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 2 ** 32;
  };
}

function shuffleSeeded(arr, rng) {
  const list = arr.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------- состояние экрана ----------
const state = {
  mounted: false,
  container: null,
  root: null,
  context: null,
  steps: [],    // [{type, options, correct, widget:'keypad'|'list', idx?}]
  stepIndex: 0,
  errors: 0,
  // DOM
  els: null,
  summary: null,
  summaryItems: null,
  widget: null,  // текущий инстанс Keypad/WordChoice
  onDone: null,
  layout: null
};

const LAYOUT_SHIFT_KEY = 'lexi/exerciseLayoutShift';
const LAYOUT_SHIFT_MIN = -40;
const LAYOUT_SHIFT_MAX = 40;

state.layout = (window.exerciseLayout &&
                window.exerciseLayout.createController({
                  storageKey: LAYOUT_SHIFT_KEY,
                  min: LAYOUT_SHIFT_MIN,
                  max: LAYOUT_SHIFT_MAX,
                  format: formatLayoutShift,
                  log
                })) || null;
state.layout?.load();

// ============================================================
// Генерация и НОРМАЛИЗАЦИЯ опций (главное правило: keypad 3..6)
// ============================================================

function pluralOptions(correct, k = 6) {
  // Список всех допустимых обозначений
  const ALL = [
    '-', '"-', '"-e', '-e', '-en', '"-en', '"-n', '-n', '-nen', '-s', '-er',
    '"-er'
  ];
  const uniq = (arr) => Array.from(new Set(arr));
  // эвристически добавим «родственные» вокруг correct
  const fam = {
    '-e': [
      '-', '-en', '-er', '"–e'.replace('–', '-')
    ],  // safety на случай копипаст
    '-en': ['-e', '"-en', '-'],
    '-nen': ['-en', '"-en', '-'],
    '-n': ['-e', '"-n', '-'],
    '"-e': ['"-', '"-en', '-e'],
    '"-en': ['"-', '"-e', '-en'],
    '"-n': ['"-', '"-e', '-n'],
    '-s': ['-', '-e'],
    '-er': ['-e', '"-er'],
    '"-er': ['-er', '"-e']
  };
  let pool = uniq([correct, ...(fam[correct] || []), ...ALL]);
  // к → 6, но не меньше 3
  let out = [];
  for (const x of pool) {
    if (!out.includes(x)) {
      out.push(x);
      if (out.length === k) break;
    }
  }
  if (out.length < Math.max(3, k)) {
    for (const x of ALL) {
      if (!out.includes(x)) {
        out.push(x);
        if (out.length === k) break;
      }
    }
  }
  // Гарантируем включение correct и длину 3..6
  if (!out.includes(correct)) out[0] = correct;
  if (out.length < 3) {
    while (out.length < 3) out.push('-');
  }
  return rndShuffle(out.slice(0, 5));
}

async function wordChoices(correctArt, correctDe, k = 5) {
  await window.lexidb.open?.();
  const terms = await window.lexidb.allTerms();
  const sameArt = terms.filter(t => t.art === correctArt && t.de !== correctDe)
                      .map(t => t.de);
  const rest = terms.filter(t => t.de !== correctDe).map(t => t.de);
  const pick = (arr, n) => rndShuffle(arr).slice(0, n);
  const uniqPush = (dst, src) => {
    const s = new Set(dst);
    for (const x of src) {
      if (!s.has(x)) dst.push(x);
    }
    return dst;
  };
  let distractors = pick(sameArt, k - 1);
  if (distractors.length < k - 1) {
    distractors =
        uniqPush(distractors, pick(rest, (k - 1) - distractors.length));
  }
  const all = uniqPush([correctDe], distractors);
  while (all.length < 5) all.push('');  // WordChoice сам подрежет/паддинг на 5
  return rndShuffle(all).slice(0, 5);
}

// Ключевая нормализация: гарантируем 3..6 элементов для keypad
function normalizeKeypadItems(stepType, correct, options, fallbackFactory) {
  let items = Array.isArray(options) ?
      options.map(x => String(x || '')).filter(Boolean) :
      [];
  // Гарантированное присутствие correct
  if (correct != null) {
    const s = String(correct);
    if (!items.includes(s)) items.unshift(s);
  }
  // Резка сверху
  if (items.length > 6) items = items.slice(0, 6);
  // Добор снизу, если нужно
  if (items.length < 3 && typeof fallbackFactory === 'function') {
    const fill = fallbackFactory();
    for (const v of fill) {
      if (items.length >= 6) break;
      const sv = String(v || '');
      if (sv && !items.includes(sv)) items.push(sv);
    }
  }
  // Минимальная страховка
  while (items.length < 3) items.push('•');
  return rndShuffle(items.slice(0, 6));
}

function normalizeVerbChoice(correct, options) {
  const seen = new Set();
  const out = [];
  const add = (val) => {
    const s = String(val || '').trim();
    if (!s) return;
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  add(correct);
  (Array.isArray(options) ? options : []).forEach(add);
  if (out.length < 2) add(correct ? '—' : 'нет');
  return out;
}

function prepareVerbOptions(correct, options) {
  const base = normalizeVerbChoice(correct, options);
  const maxLen = base.reduce((m, x) => Math.max(m, x.length), 0);
  if (maxLen <= 3) {
    const padded = base.slice(0, 6);
    while (padded.length < 3) padded.push('—');
    return {widget: 'keypad', options: rndShuffle(padded)};
  }
  const padded = base.slice(0, 5);
  while (padded.length < 5) padded.push('—');
  return {widget: 'list', options: rndShuffle(padded)};
}

function summarizePrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return '—';
  if (text.length <= 18) return text;
  return text.slice(0, 15).trim() + '…';
}

function createVerbSteps(card) {
  const steps = [];
  if (!card) return steps;
  const questions = Array.isArray(card.questions) ? card.questions : [];
  questions.forEach((q, idx) => {
    if (!q || !q.prompt || !q.answer) return;
    const prep = prepareVerbOptions(q.answer, q.options || []);
    const summaryKey = String(q.id || q.key || `verb-${idx}`);
    steps.push({
      type: 'verb-step',
      kind: 'verb',
      prompt: String(q.prompt),
      correct: String(q.answer),
      options: prep.options,
      widget: prep.widget,
      summaryKey,
      summaryLabel: summarizePrompt(q.summary || q.prompt)
    });
  });
  return steps;
}

const nounModePlanners = {
  MC5: planForMC5,
  CHUNKS: planForChunks,
  COMPOSE: planForCompose
};

function clonePicks(picks) {
  return JSON.parse(JSON.stringify(picks));
}

async function createNounExerciseContext(term, mode) {
  const actualMode = nounModePlanners[mode] ? mode : 'MC5';
  const picks = {article: null, word: null, plural: null, chunks: [], letters: []};
  const ruTitle = (Array.isArray(term?.ru) && term.ru[0]) ? term.ru[0] : term?.de;
  const summaryConfig = [
    {id: 'article', label: 'Артикль:'},
    {id: 'word', label: 'Слово:'},
    {id: 'plural', label: 'Мн. ч.:'}
  ];
  const planner = nounModePlanners[actualMode] || planForMC5;
  const steps = await planner(term);

  const context = {
    kind: 'noun',
    term,
    mode: actualMode,
    steps,
    title: ruTitle,
    summaryConfig
  };

  context.updateSummary = function(summaryItems) {
    if (!summaryItems) return;
    const chArt = summaryItems.article;
    const chWord = summaryItems.word;
    const chPl = summaryItems.plural;
    if (chArt) chArt.set(picks.article || '—');
    if (chWord) {
      if (context.mode === 'MC5') {
        chWord.set(picks.word || '—');
      } else if (context.mode === 'CHUNKS') {
        const parts = picks.chunks.slice();
        const remaining =
            window.lexiparts.splitChunks(term.de).length - parts.length;
        const masked =
            parts.join('') + (remaining > 0 ? '•'.repeat(Math.max(1, remaining)) : '');
        chWord.set(masked || '•');
      } else {
        const letters = picks.letters.slice();
        const remaining =
            window.lexiparts.splitCompose(term.de).length - letters.length;
        const masked =
            letters.join('') + (remaining > 0 ? '•'.repeat(Math.max(1, remaining)) : '');
        chWord.set(masked || '•');
      }
    }
    if (chPl) chPl.set(picks.plural || '—');
  };

  context.valueFor = function(step) {
    if (!step) return null;
    if (step.type === 'article') return picks.article;
    if (step.type === 'word') return picks.word;
    if (step.type === 'plural') return picks.plural;
    if (step.type === 'chunk') return picks.chunks[step.idx];
    if (step.type === 'letter') return picks.letters[step.idx];
    return null;
  };

  context.onPick = function(step, value) {
    const picked = String(value);
    if (step.type === 'article') {
      picks.article = picked;
    } else if (step.type === 'word') {
      picks.word = picked;
    } else if (step.type === 'plural') {
      picks.plural = picked;
    } else if (step.type === 'chunk') {
      picks.chunks[step.idx] = picked;
    } else if (step.type === 'letter') {
      picks.letters[step.idx] = picked;
    }
    return {ok: (picked === String(step.correct))};
  };

  context.onBack = function(step) {
    if (!step) return;
    if (step.type === 'article') picks.article = null;
    else if (step.type === 'word') picks.word = null;
    else if (step.type === 'plural') picks.plural = null;
    else if (step.type === 'chunk')
      picks.chunks = picks.chunks.slice(0, step.idx);
    else if (step.type === 'letter')
      picks.letters = picks.letters.slice(0, step.idx);
  };

  context.errorsBefore = function(limit) {
    let errs = 0;
    for (let i = 0; i < limit; i++) {
      const st = steps[i];
      if (!st) continue;
      if (String(context.valueFor(st)) !== String(st.correct)) errs++;
    }
    return errs;
  };

  context.finish = async function({errors, onDone}) {
    const correct = {article: term.art, word: term.de, plural: term.pl};
    if (context.mode === 'CHUNKS') {
      correct.chunks = window.lexiparts.splitChunks(term.de);
    } else if (context.mode === 'COMPOSE') {
      correct.letters = window.lexiparts.splitCompose(term.de);
    }

    const success = (errors === 0);
    log('done:', {
      id: term.id,
      mode: context.mode,
      success,
      errors,
      picks
    });

    try {
      await window.cardengine.onReview(term.id, context.mode, success, Date.now());
    } catch (e) {
      console.error('[exercise] onReview failed', e);
    }

    if (typeof onDone === 'function') {
      onDone({
        term,
        mode: context.mode,
        success,
        errors,
        picks: clonePicks(picks),
        correct
      });
    }

    return {errors, success};
  };

  return context;
}

function createLegacyVerbContext(card) {
  const steps = createVerbSteps(card);
  const answers = {};
  const summaryConfig = [
    {id: 'lemma', label: 'Инфинитив:', initial: card?.lemma || card?.cue || card?.id || '—'}
  ];
  steps.forEach((step) => {
    if (step.summaryKey) summaryConfig.push({id: step.summaryKey, label: step.summaryLabel});
  });

  const context = {
    kind: 'verb',
    card,
    steps,
    title: card?.translation || card?.cue || card?.lemma || 'Глагол',
    summaryConfig
  };

  context.updateSummary = function(summaryItems) {
    if (!summaryItems) return;
    const lemmaItem = summaryItems.lemma;
    if (lemmaItem) {
      const lemma = card?.lemma || card?.cue || card?.id;
      lemmaItem.set(lemma || '—');
    }
    steps.forEach((step) => {
      if (!step.summaryKey) return;
      const item = summaryItems[step.summaryKey];
      if (!item) return;
      const picked = answers[step.summaryKey]?.picked;
      item.set(picked || '•');
    });
  };

  context.valueFor = function(step) {
    if (!step || !step.summaryKey) return null;
    return answers[step.summaryKey]?.picked || null;
  };

  context.onPick = function(step, value) {
    const picked = String(value);
    const correct = String(step.correct);
    if (step.summaryKey)
      answers[step.summaryKey] = {picked, correct};
    return {ok: (picked === correct)};
  };

  context.onBack = function(step) {
    if (step?.summaryKey) delete answers[step.summaryKey];
  };

  context.errorsBefore = function(limit) {
    let errs = 0;
    for (let i = 0; i < limit; i++) {
      const st = steps[i];
      if (!st || !st.summaryKey) continue;
      const picked = answers[st.summaryKey]?.picked;
      if (String(picked) !== String(st.correct)) errs++;
    }
    return errs;
  };

  context.finish = async function({onDone}) {
    let errors = 0;
    const answersMap = {};
    const correctMap = {};
    steps.forEach((step) => {
      if (!step.summaryKey) return;
      const picked = answers[step.summaryKey]?.picked || null;
      answersMap[step.summaryKey] = picked;
      correctMap[step.summaryKey] = step.correct;
      if (String(picked) !== String(step.correct)) errors++;
    });
    const success = errors === 0;
    log('done verb:', {
      id: card?.id,
      success,
      errors,
      answers: answersMap
    });
    try {
      if (card?.id && window.verbdb?.recordResult)
        window.verbdb.recordResult(card.id, success);
    } catch (e) {
      console.warn('[exercise] verb recordResult failed', e);
    }
    if (typeof onDone === 'function') {
      onDone({
        kind: 'verb',
        card,
        success,
        errors,
        answers: answersMap,
        correct: correctMap
      });
    }
    return {errors, success};
  };

  return context;
}

const VERB_SUMMARY = {
  CASE_ENDING: {key: 'case', label: 'Падеж:'},
  LEMMA: {key: 'lemmaSlot', label: 'Инфинитив:'},
  PRAET: {key: 'praet', label: 'Präteritum:'},
  PART2_AUX: {key: 'perfekt', label: 'Perfekt:'},
  SYNTAX: {key: 'syntax', label: 'Порядок:'},
  AUDIO: {key: 'audio', label: 'Аудио:'},
  COLLOCATION: {key: 'collocation', label: 'Коллокация:'}
};

function presentAuxForm(aux) {
  const up = String(aux || '').trim().toUpperCase();
  if (up === 'SEIN') return 'ist';
  if (up === 'SEIN/HABEN' || up === 'HABEN/SEIN') return 'ist/hat';
  return 'hat';
}

function pickVerbFrame(frames, rng) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const weights = frames.map((frame) => {
    const freq = Number(frame && frame.frequency);
    return Number.isFinite(freq) && freq > 0 ? freq : 1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return frames[0];
  let r = rng() * total;
  for (let i = 0; i < frames.length; i++) {
    r -= weights[i];
    if (r <= 0) return frames[i];
  }
  return frames[0];
}

function promptForVerbSlot(slot, frame, card) {
  switch (slot) {
    case 'CASE_ENDING':
      return frame?.probeMarker ? `Заполните пропуск: ${frame.probeMarker}` : 'Падеж';
    case 'LEMMA':
      return 'Выберите глагол';
    case 'PRAET':
      return 'Präteritum (er/sie/es)';
    case 'PART2_AUX':
      return 'Perfekt: вспомогательный + Partizip II';
    case 'COLLOCATION':
      return 'Выберите устойчивое сочетание';
    case 'SYNTAX':
      return 'Словоряд: выберите правильный вариант';
    case 'AUDIO':
      return 'Слушайте и выберите форму';
    default:
      return card?.cue || 'Выберите вариант';
  }
}

function buildVerbCorrect(card, frame, slot) {
  const morph = card?.morph || {};
  switch (slot) {
    case 'CASE_ENDING':
      if (!frame?.probeAnswer) return null;
      return {text: String(frame.probeAnswer), features: ['PREP_CASE', 'ARTICLE_DECL']};
    case 'LEMMA':
      if (!card?.lemma) return null;
      return {text: String(card.lemma), features: []};
    case 'PRAET':
      if (!morph?.praet3sg) return null;
      return {text: String(morph.praet3sg), features: ['ABLAUT']};
    case 'PART2_AUX': {
      const part2 = String(morph?.part2 || '').trim();
      if (!part2) return null;
      const aux = presentAuxForm(card?.aux);
      const text = `${aux} ${part2}`.trim();
      return {text, features: ['AUX_CHOICE', 'ABLAUT']};
    }
    case 'COLLOCATION': {
      const col = Array.isArray(frame?.colls) ? frame.colls.find(Boolean) : null;
      if (!col) return null;
      return {text: String(col), features: []};
    }
    case 'SYNTAX': {
      const part2 = String(morph?.part2 || '').trim();
      const aux = presentAuxForm(card?.aux);
      if (!part2) return null;
      const clause = aux ? `weil er ${part2} ${aux}`.trim() : `weil er ${part2}`;
      return {text: clause, features: ['SYNTAX_V2']};
    }
    default:
      return null;
  }
}

function normalizeOptionList(options) {
  const out = [];
  const seen = new Set();
  (Array.isArray(options) ? options : []).forEach((opt) => {
    const text = String(opt || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out;
}

function gatherVerbDistractors(card, frame, slot, correctText) {
  const spec = frame?.distractors && frame.distractors[slot];
  const payload = spec && typeof spec.payload === 'object' ? spec.payload : {};
  const out = [];
  const push = (text) => {
    const value = String(text || '').trim();
    if (!value || value === correctText) return;
    out.push({text: value});
  };
  if (slot === 'CASE_ENDING') {
    normalizeOptionList(payload.endings).forEach(push);
    normalizeOptionList(payload.wrongCases).forEach(push);
  } else if (slot === 'LEMMA') {
    normalizeOptionList(payload.neighbors).forEach(push);
  } else if (slot === 'PRAET') {
    normalizeOptionList(payload.wrongPraet).forEach(push);
  } else if (slot === 'PART2_AUX') {
    const morph = card?.morph || {};
    const part2 = String(morph.part2 || '').trim();
    const aux = presentAuxForm(card?.aux);
    normalizeOptionList(payload.wrongPart2).forEach((wrongPart) => {
      push(`${aux} ${wrongPart}`);
    });
    if (payload.wrongAux) {
      const wrongAux = presentAuxForm(payload.wrongAux);
      if (wrongAux.includes('/')) {
        wrongAux.split('/').forEach((a) => push(`${a.trim()} ${part2}`));
      } else {
        push(`${wrongAux} ${part2}`);
      }
    }
  } else if (slot === 'COLLOCATION') {
    normalizeOptionList(payload.options).forEach(push);
    if (Array.isArray(frame?.colls)) {
      frame.colls.forEach((c) => { if (c && c !== correctText) push(c); });
    }
  } else if (slot === 'SYNTAX') {
    normalizeOptionList(payload.errors).forEach(push);
  }
  return out;
}

function fallbackVerbDistractors(slot, correctText, card, frame) {
  const variants = [];
  const push = (text) => {
    const value = String(text || '').trim();
    if (!value || value === correctText) return;
    variants.push({text: value});
  };
  if (slot === 'CASE_ENDING') {
    if (/dem\b/i.test(correctText)) push(correctText.replace(/dem\b/i, 'den'));
    if (/den\b/i.test(correctText)) push(correctText.replace(/den\b/i, 'dem'));
    if (/em\b/i.test(correctText)) push(correctText.replace(/em\b/i, 'en'));
    if (/en\b/i.test(correctText)) push(correctText.replace(/en\b/i, 'em'));
  } else if (slot === 'LEMMA') {
    if (correctText.endsWith('en')) push(correctText.slice(0, -2) + 't');
    push(correctText + 'n');
  } else if (slot === 'PRAET') {
    if (!correctText.endsWith('te')) push(correctText + 'te');
    push(correctText.replace(/ie/g, 'i'));
  } else if (slot === 'PART2_AUX') {
    const parts = correctText.split(/\s+/);
    const aux = parts[0] || '';
    const rest = parts.slice(1).join(' ');
    if (rest.startsWith('ge')) push(`${aux} ${rest.slice(2)}`);
    if (rest.endsWith('en')) push(`${aux} ${rest.slice(0, -2)}t`);
    if (aux === 'hat') push(`ist ${rest}`);
    if (aux === 'ist') push(`hat ${rest}`);
  } else if (slot === 'COLLOCATION') {
    if (frame?.cueDe) push(frame.cueDe.replace(/\(.+?\)/g, '').trim());
  } else if (slot === 'SYNTAX') {
    const morph = card?.morph || {};
    const part2 = String(morph.part2 || '').trim();
    push(`weil er ${presentAuxForm(card?.aux)} ${part2}`);
    push(`weil er ${part2} ${presentAuxForm(card?.aux)}`);
  }
  return variants;
}

function selectVerbDistractors(card, frame, slot, correctText, rng, need = 3) {
  const pool = gatherVerbDistractors(card, frame, slot, correctText);
  const extra = fallbackVerbDistractors(slot, correctText, card, frame);
  const seen = new Set();
  const result = [];
  const consider = pool.concat(extra);
  consider.forEach((item) => {
    if (result.length >= need) return;
    const text = String(item?.text || '').trim();
    if (!text || text === correctText || seen.has(text)) return;
    seen.add(text);
    result.push({text});
  });
  while (result.length < need) {
    const mutated = `${correctText}*${result.length + 1}`;
    if (!seen.has(mutated)) {
      seen.add(mutated);
      result.push({text: mutated});
    } else {
      break;
    }
  }
  const ordered = shuffleSeeded(result, rng);
  return ordered.slice(0, need);
}

function prepareVerbOptionsDeterministic(correctText, distractors, rng) {
  const seen = new Set();
  const all = [];
  const add = (value) => {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    all.push(text);
  };
  add(correctText);
  distractors.forEach((d) => add(d.text));
  let filler = 1;
  while (all.length < 4) {
    add(`—${filler > 1 ? filler : ''}`);
    filler++;
  }
  const shuffled = shuffleSeeded(all, rng);
  const maxLen = shuffled.reduce((m, x) => Math.max(m, x.length), 0);
  const widget = maxLen > 14 ? 'list' : 'keypad';
  return {options: shuffled, widget};
}

function microHint(frame, slot, correctText) {
  if (slot === 'CASE_ENDING') {
    if (frame?.prepCase) return `${frame.prepCase} → ${correctText}`;
    if (frame?.caseCore) return `${frame.caseCore}: ${correctText}`;
  }
  if (slot === 'PART2_AUX') {
    if (String(correctText).startsWith('ist '))
      return 'Движение/состояние → sein в Perfekt';
    return 'Большинство глаголов → haben в Perfekt';
  }
  if (slot === 'LEMMA' && Array.isArray(frame?.contrasts) && frame.contrasts[0])
    return frame.contrasts[0].note;
  if (slot === 'PRAET') return 'Следите за аблаутом и окончанием -te/-en';
  if (slot === 'COLLOCATION') return 'Найдите устойчивое сочетание';
  if (slot === 'SYNTAX') return 'В придаточном глагол уходит в конец';
  return 'Подумайте о форме и управлении';
}

function buildVerbStep(card, frame, slot, seedBase, index) {
  const correct = buildVerbCorrect(card, frame, slot);
  if (!correct || !correct.text) return null;
  const rng = mulberry32(hashSeed(seedBase, slot, index));
  const distractors = selectVerbDistractors(card, frame, slot, correct.text, rng, 3);
  const {options, widget} =
      prepareVerbOptionsDeterministic(correct.text, distractors, rng);
  const summary = VERB_SUMMARY[slot] || {key: `slot-${index}`, label: slot};
  const example = Array.isArray(frame?.examples) ? frame.examples.find(Boolean) : '';
  return {
    type: 'verb-step',
    kind: 'verb',
    slot,
    prompt: promptForVerbSlot(slot, frame, card),
    correct: correct.text,
    correctMeta: correct,
    options,
    widget,
    summaryKey: summary.key,
    summaryLabel: summary.label,
    hint: microHint(frame, slot, correct.text),
    example,
    features: correct.features || []
  };
}

function runVerbValidations(frame, card, text) {
  const lower = String(text || '').toLowerCase();
  const checks = [];
  const prepCase = String(frame?.prepCase || '').trim();
  if (prepCase.includes('+')) {
    const preposition = prepCase.split('+')[0].trim().toLowerCase();
    if (preposition)
      checks.push({
        type: 'preposition',
        ok: new RegExp(`\\b${preposition}\\b`).test(lower),
        message: `предлог? → ${preposition}`
      });
  }
  const caseCore = String(frame?.caseCore || '').toLowerCase();
  if (caseCore.includes('dat')) {
    const ok = /\b(den|dem|der|einem|einer|meinem|meiner|seinem|seiner|unserem|unserer|euren|eurem|ihrem|ihrer|zu)\b/.test(lower);
    checks.push({type: 'case', ok, message: 'падеж? → Dativ'});
  } else if (caseCore.includes('akk')) {
    const ok = /\b(den|die|das|einen|eine|mein|deinen|seinen|ihn)\b/.test(lower);
    checks.push({type: 'case', ok, message: 'падеж? → Akkusativ'});
  }
  const aux = presentAuxForm(card?.aux);
  if (aux && !aux.includes('/')) {
    const ok = new RegExp(`\\b${aux}\\b`).test(lower);
    checks.push({type: 'aux', ok, message: `Perfekt? → ${aux} + Part II`});
  }
  const part2 = String(card?.morph?.part2 || '').toLowerCase();
  if (part2)
    checks.push({
      type: 'part2',
      ok: lower.includes(part2),
      message: `Part II? → ${part2}`
    });
  return checks;
}

function buildVerbSummaryLine(card, frame) {
  const lemma = String(card?.lemma || '').trim();
  const probe = String(frame?.probeAnswer || '').trim();
  const praet = String(card?.morph?.praet3sg || '').trim();
  const part2 = String(card?.morph?.part2 || '').trim();
  const aux = presentAuxForm(card?.aux);
  const perfekt = part2 ? `${aux} ${part2}`.trim() : aux;
  const left = probe ? `${probe} ${lemma}`.trim() : lemma;
  const chunks = [left || lemma || '—', praet || '—', perfekt || '—'];
  return chunks.join(' — ');
}

function createVerbExerciseContext(card, opts = {}) {
  const frames = Array.isArray(card?.frames) ? card.frames.filter((f) => f && f.probeAnswer) : [];
  if (!frames.length) return createLegacyVerbContext(card);
  const seedBase = (typeof opts.seed === 'number' ? opts.seed : Date.now());
  const baseSeed = hashSeed(seedBase, card?.id || card?.lemma || 'verb');
  const rng = mulberry32(baseSeed);
  const frame = pickVerbFrame(frames, rng) || frames[0];
  const frameSeed = hashSeed(baseSeed, frame?.id || frame?.type || 'frame');

  const slots = ['CASE_ENDING', 'LEMMA', 'PRAET', 'PART2_AUX'];
  const extraCandidates = [];
  if (Array.isArray(frame?.colls) && frame.colls.length) extraCandidates.push('COLLOCATION');
  if (frame?.distractors?.SYNTAX || frame?.type) extraCandidates.push('SYNTAX');
  if (extraCandidates.length) {
    const extraRng = mulberry32(hashSeed(frameSeed, 'extra'));
    const idx = Math.floor(extraRng() * extraCandidates.length) % extraCandidates.length;
    slots.push(extraCandidates[idx]);
  }

  const steps = [];
  slots.forEach((slot, idx) => {
    const step = buildVerbStep(card, frame, slot, frameSeed, idx);
    if (step) steps.push(step);
  });

  const productionStep = {
    type: 'verb-production',
    kind: 'verb',
    slot: 'PRODUCTION',
    widget: 'production',
    prompt: 'Составьте предложение по рамке',
    summaryKey: 'production',
    summaryLabel: 'Предложение:',
    productionHint: frame?.cueDe ? `Подсказка: ${frame.cueDe}` : 'Используйте глагол в своём предложении',
    placeholder: frame?.cueDe || frame?.cueRu || ''
  };
  steps.push(productionStep);

  const summaryConfig = [
    {id: 'lemmaBase', label: 'Инфинитив:', initial: card?.lemma || card?.cue || card?.id || '—'}
  ];
  const addedSummary = new Set(['lemmaBase']);
  steps.forEach((step) => {
    if (!step.summaryKey || step.summaryKey === 'production') return;
    if (addedSummary.has(step.summaryKey)) return;
    summaryConfig.push({id: step.summaryKey, label: step.summaryLabel});
    addedSummary.add(step.summaryKey);
  });
  summaryConfig.push({id: 'production', label: 'Предложение:'});

  const answers = {
    lemmaBase: {
      picked: card?.lemma || card?.cue || card?.id || '—',
      correct: card?.lemma || ''
    }
  };
  const slotStates = {};
  steps.forEach((step) => {
    if (!step.summaryKey || step.summaryKey === 'production') return;
    slotStates[step.summaryKey] = {
      attempts: 0,
      wrong: false,
      firstWrong: null,
      finalCorrect: null,
      features: step.features || []
    };
  });
  const productionState = {attempts: 0, text: '', validations: [], ok: false};

  const context = {
    kind: 'verb',
    card,
    frame,
    steps,
    title: frame?.cueRu || card?.translation || card?.cue || card?.lemma || 'Глагол',
    summaryConfig
  };

  context.updateSummary = function(summaryItems) {
    if (!summaryItems) return;
    const lemmaItem = summaryItems.lemmaBase;
    if (lemmaItem)
      lemmaItem.set(card?.lemma || card?.cue || card?.id || '—');
    steps.forEach((step) => {
      if (!step.summaryKey) return;
      const item = summaryItems[step.summaryKey];
      if (!item) return;
      if (step.summaryKey === 'production') {
        const text = productionState.text || '';
        item.set(text ? text : '•');
        return;
      }
      const entry = answers[step.summaryKey];
      const fallback = step.summaryKey === 'lemmaSlot' ? (card?.lemma || '•') : '•';
      item.set(entry?.picked || fallback);
    });
  };

  context.valueFor = function(step) {
    if (!step) return null;
    if (step.widget === 'production') return productionState.text;
    if (!step.summaryKey) return null;
    return answers[step.summaryKey]?.picked || null;
  };

  context.onPick = function(step, value) {
    const picked = String(value ?? '');
    const correct = String(step?.correct ?? '');
    if (!step?.summaryKey || step.summaryKey === 'production')
      return {ok: picked === correct};
    const stateSlot = slotStates[step.summaryKey];
    if (!stateSlot) return {ok: picked === correct};
    stateSlot.attempts += 1;
    const entry = answers[step.summaryKey] || {picked: null, correct, attempts: 0, wrongFirst: null};
    entry.attempts = stateSlot.attempts;
    entry.picked = picked;
    entry.correct = correct;
    const ok = picked === correct;
    if (ok) {
      stateSlot.finalCorrect = true;
      answers[step.summaryKey] = entry;
      return {ok: true, countError: false, feedback: ''};
    }
    if (!stateSlot.wrong) {
      stateSlot.wrong = true;
      stateSlot.firstWrong = picked;
      entry.wrongFirst = picked;
      answers[step.summaryKey] = entry;
      const parts = [];
      if (step.hint) parts.push(step.hint);
      if (step.example) parts.push(step.example);
      return {
        ok: false,
        countError: true,
        retry: true,
        feedback: parts.join(' ').trim() || 'Попробуйте ещё раз'
      };
    }
    stateSlot.finalCorrect = false;
    answers[step.summaryKey] = entry;
    return {
      ok: false,
      countError: false,
      retry: false,
      feedback: `Верный ответ: ${correct}`
    };
  };

  context.onBack = function(step) {
    if (!step) return;
    if (step.summaryKey === 'production') {
      productionState.attempts = 0;
      productionState.text = '';
      productionState.validations = [];
      productionState.ok = false;
      delete answers.production;
      return;
    }
    if (!step.summaryKey) return;
    const init = slotStates[step.summaryKey];
    if (init) {
      init.attempts = 0;
      init.wrong = false;
      init.firstWrong = null;
      init.finalCorrect = null;
    }
    delete answers[step.summaryKey];
  };

  context.errorsBefore = function(limit) {
    let errs = 0;
    for (let i = 0; i < limit; i++) {
      const step = steps[i];
      if (!step || !step.summaryKey || step.summaryKey === 'production') continue;
      const slot = slotStates[step.summaryKey];
      if (!slot) continue;
      if (slot.wrong) errs++;
    }
    return errs;
  };

  context.onProductionSubmit = function(step, text) {
    productionState.attempts += 1;
    productionState.text = String(text || '').trim();
    productionState.validations = runVerbValidations(frame, card, productionState.text);
    productionState.ok = productionState.validations.every((v) => v.ok !== false);
    answers.production = {
      picked: productionState.text,
      correct: '',
      attempts: productionState.attempts,
      ok: productionState.ok
    };
    const retry = !productionState.ok && productionState.attempts < 2;
    return {
      ok: productionState.ok,
      retry,
      advance: !retry,
      feedback: productionState.ok ? 'Отлично!' : 'Проверьте подсказки и поправьте.',
      validations: productionState.validations
    };
  };

  context.finish = async function({onDone}) {
    let errors = 0;
    const answersMap = {};
    const correctMap = {};
    const slotDetails = {};
    const stepResults = [];
    steps.forEach((step) => {
      if (step.summaryKey === 'production') return;
      if (!step.summaryKey) return;
      const slot = slotStates[step.summaryKey];
      const entry = answers[step.summaryKey];
      answersMap[step.summaryKey] = entry ? entry.picked : null;
      correctMap[step.summaryKey] = step.correct;
      if (slot) {
        slotDetails[step.summaryKey] = {
          attempts: slot.attempts,
          wrong: slot.wrong,
          firstWrong: slot.firstWrong,
          finalCorrect: slot.finalCorrect,
          features: slot.features
        };
        if (slot.wrong) errors += 1;
      }
      stepResults.push({
        key: step.summaryKey,
        label: step.summaryLabel,
        picked: answersMap[step.summaryKey],
        correct: step.correct,
        wrong: slot ? slot.wrong : false,
        finalCorrect: slot ? slot.finalCorrect === true : (answersMap[step.summaryKey] === step.correct)
      });
    });
    const success = errors === 0;
    const summaryLine = buildVerbSummaryLine(card, frame);
    const payload = {
      kind: 'verb',
      card,
      frame,
      success,
      errors,
      answers: answersMap,
      correct: correctMap,
      slots: slotDetails,
      production: {
        text: productionState.text,
        validations: productionState.validations,
        ok: productionState.ok,
        attempts: productionState.attempts
      },
      summaryLine,
      example: Array.isArray(frame?.examples) ? frame.examples[0] || '' : '',
      stepResults,
      translation: card?.translation || '',
      cue: frame?.cueDe || ''
    };

    log('done verb:', {
      id: card?.id,
      frame: frame?.id || frame?.type,
      success,
      errors
    });
    try {
      if (card?.id && window.verbdb?.recordResult)
        window.verbdb.recordResult(card.id, success);
    } catch (e) {
      console.warn('[exercise] verb recordResult failed', e);
    }
    if (typeof onDone === 'function') onDone(payload);
    return {errors, success, payload};
  };

  return context;
}

// ---------- планировщики шагов ----------
async function planForMC5(term) {
  const articleStep = {
    type: 'article',
    prompt: 'Выберите артикль',
    correct: term.art,
    options: normalizeKeypadItems('article', term.art, ['der', 'die', 'das']),
    widget: 'keypad'
  };
  const words = await wordChoices(term.art, term.de, 5);
  const wordStep =
      {type: 'word', prompt: 'Выберите слово', correct: term.de, options: words, widget: 'list'};
  const pluralStep = {
    type: 'plural',
    prompt: 'Множественное число',
    correct: term.pl,
    options: normalizeKeypadItems(
        'plural', term.pl, pluralOptions(term.pl, 6),
        () => pluralOptions(term.pl, 6)),
    widget: 'keypad'
  };
  return [articleStep, wordStep, pluralStep];
}

async function planForChunks(term) {
  const steps = [];
  steps.push({
    type: 'article',
    prompt: 'Выберите артикль',
    correct: term.art,
    options: normalizeKeypadItems('article', term.art, ['der', 'die', 'das']),
    widget: 'keypad'
  });
  // чанки
  const chunks = window.lexiparts.splitChunks(term.de);
  const plan =
      await window.lexiparts.planChunks(term.de, 5);  // string[][] по шагам
  for (let i = 0; i < plan.length; i++) {
    const corr = chunks[i];
    const opts =
        normalizeKeypadItems('chunk', corr, plan[i], () => plan[i] || []);
    steps.push({
      type: 'chunk',
      idx: i,
      prompt: 'Соберите слово',
      correct: corr,
      options: opts,
      widget: 'keypad'
    });
  }
  steps.push({
    type: 'plural',
    prompt: 'Множественное число',
    correct: term.pl,
    options: normalizeKeypadItems(
        'plural', term.pl, pluralOptions(term.pl, 6),
        () => pluralOptions(term.pl, 6)),
    widget: 'keypad'
  });
  return steps;
}

async function planForCompose(term) {
  const steps = [];
  steps.push({
    type: 'article',
    prompt: 'Выберите артикль',
    correct: term.art,
    options: normalizeKeypadItems('article', term.art, ['der', 'die', 'das']),
    widget: 'keypad'
  });
  const letters = window.lexiparts.splitCompose(term.de);
  const plan = await window.lexiparts.planCompose(term.de, 6);
  for (let i = 0; i < plan.length; i++) {
    const corr = letters[i];
    const opts =
        normalizeKeypadItems('letter', corr, plan[i], () => plan[i] || []);
    steps.push({
      type: 'letter',
      idx: i,
      prompt: 'Соберите слово',
      correct: corr,
      options: opts,
      widget: 'keypad'
    });
  }
  steps.push({
    type: 'plural',
    prompt: 'Множественное число',
    correct: term.pl,
    options: normalizeKeypadItems(
        'plural', term.pl, pluralOptions(term.pl, 6),
        () => pluralOptions(term.pl, 6)),
    widget: 'keypad'
  });
  return steps;
}

// ---------- построение UI ----------
function buildUI(container, title, progress, summaryConfig) {
  if (state.layout) state.layout.destroy();
  clear(container);

  const root = el('section', 'ex');
  const wrap = el('div', 'wrap');

  const topbar = el('div', 'topbar');
  const prog =
      el('div', 'progress',
         progress ? `[${progress.index}/${progress.total}]` : '');
  const layoutBtn = el('button', 'layout-btn', '⇅');
  layoutBtn.type = 'button';
  layoutBtn.title = 'Настроить вертикальное положение';
  layoutBtn.setAttribute('aria-label', 'Настроить вертикальное положение');
  topbar.append(prog, layoutBtn);
  wrap.appendChild(topbar);

  const h1 = el('h1', null, (title || '').toUpperCase());
  wrap.appendChild(h1);

  const summary = window.exerciseUI.createSummary(summaryConfig || []);
  wrap.appendChild(summary.root);

  const prompt = el('div', 'ex-prompt', '');
  prompt.style.marginTop = '14px';
  prompt.style.fontSize = '18px';
  prompt.style.fontWeight = '600';
  prompt.style.letterSpacing = '0.02em';
  wrap.appendChild(prompt);

  const mount = el('div', 'mount');
  wrap.appendChild(mount);

  const feedback = el('div', 'ex-feedback', '');
  feedback.setAttribute('aria-live', 'polite');
  wrap.appendChild(feedback);

  const btnBack = el('button', 'btn-back', 'НАЗАД');
  btnBack.disabled = false;  // раньше было true
  btnBack.title = 'Назад';
  wrap.appendChild(btnBack);

  const layouts = window.exerciseUI.createLayoutModal({
    value: state.layout ? state.layout.getShift() : 0,
    min: LAYOUT_SHIFT_MIN,
    max: LAYOUT_SHIFT_MAX,
    step: 5,
    format: formatLayoutShift
  });
  wrap.appendChild(layouts.root);

  root.appendChild(wrap);
  container.appendChild(root);

  state.root = root;
  state.els = {
    wrap,
    prog,
    h1,
    prompt,
    topbar,
    layoutBtn,
    layoutModal: layouts.root,
    layoutSlider: layouts.slider,
    layoutValue: layouts.value,
    layoutReset: layouts.reset,
    layoutClose: layouts.close,
    layoutBackdrop: layouts.backdrop,
    summaryRoot: summary.root,
    mount,
    feedback,
    btnBack
  };
  state.summary = summary;
  state.summaryItems = summary.items;
  root.tabIndex = 0;
  setTimeout(() => root.focus(), 0);

  if (state.layout) {
    state.layout.init({
      wrap,
      topbar,
      heading: h1,
      summary: summary.root,
      prompt,
      mount,
      feedback,
      backBtn: btnBack,
      layoutModal: layouts.root,
      layoutBackdrop: layouts.backdrop,
      layoutSlider: layouts.slider,
      layoutValue: layouts.value,
      layoutReset: layouts.reset,
      layoutClose: layouts.close,
      layoutBtn
    });
  }
}

function formatLayoutShift(v) {
  const val = clamp(v, LAYOUT_SHIFT_MIN, LAYOUT_SHIFT_MAX);
  if (val === 0) return 'По умолчанию';
  const sign = val > 0 ? 'ниже' : 'выше';
  return `${Math.abs(val)}% ${sign}`;
}

// ---------- прогресс/заголовки ----------
function updateSummaryView() {
  if (!state.summaryItems || !state.context) return;
  state.context.updateSummary(state.summaryItems);
  state.layout?.schedule('chips');
}
function getThemeVars(scope) {
  const cs = getComputedStyle(scope || document.documentElement);
  const bg = (cs.getPropertyValue('--ex-island-bg') || '').trim() || '#F4F5F7';
  const div =
      (cs.getPropertyValue('--ex-divider') || '').trim() || 'rgba(0,0,0,.14)';
  const text = (cs.getPropertyValue('--ex-text') || '').trim() || '#0A1428';
  return {bg, div, text};
}

function setFeedback(message, mode) {
  if (!state.els || !state.els.feedback) return;
  const base = 'ex-feedback';
  if (mode) {
    state.els.feedback.className = `${base} ${base}--${mode}`;
  } else {
    state.els.feedback.className = base;
  }
  state.els.feedback.textContent = message ? String(message) : '';
}

// ---------- монтирование текущего шага ----------
function mountStep() {
  const s = state.steps[state.stepIndex];
  if (!s) {
    return;
  }
  const M = state.els.mount;
  if (state.els.prompt)
    state.els.prompt.textContent = s.prompt || '';
  // очистка предыдущего виджета
  if (state.widget && state.widget.destroy) try {
      state.widget.destroy();
    } catch (_) {
    }
  clear(M);
  setFeedback('');

  const {bg, div, text} = getThemeVars(state.root);

  if (s.widget === 'list') {
    const widget = window.createWordChoiceIsland({
      items: s.options,
      islandColor: bg,
      dividerColor: div,
      textColor: text,
      width: Math.min(520, Math.floor(window.innerWidth - 24)),
      radius: 16,
      onSelect: ({index, value}) => handlePick(s, value)
    });
    widget.mount(M);
    state.widget = widget;
  } else if (s.widget === 'production') {
    const widget = createProductionWidget(M, s);
    state.widget = widget;
  } else {
    const widget = window.KeypadIsland.create({
      mount: M,
      items: s.options,
      islandColor: bg,
      dividerColor: div,
      textColor: text,
      radius: 16,
      tile: Math.max(
          80,
          Math.min(
              108,
              Math.floor((Math.min(520, window.innerWidth - 24)) / 3 - 4))),
      onSelect: ({label}) => handlePick(s, label)
    });
    state.widget = widget;
  }

  // кнопка назад активна, если уже есть сделанные шаги
  state.els.btnBack.disabled = (state.stepIndex === 0);

  state.layout?.schedule('step');
}

function createProductionWidget(mount, step) {
  const wrap = el('div', 'ex-production');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '12px';
  const helper = el('div', 'ex-production__hint',
                   step.productionHint ||
                       'Составьте короткое предложение по рамке.');
  const textarea = document.createElement('textarea');
  textarea.className = 'ex-production__input';
  textarea.rows = 3;
  textarea.placeholder = step.placeholder || '';
  textarea.style.padding = '12px';
  textarea.style.fontSize = '16px';
  textarea.style.borderRadius = '12px';
  const submit = el('button', 'ex-production__submit', 'ГОТОВО');
  submit.type = 'button';
  submit.style.alignSelf = 'flex-start';
  submit.style.padding = '10px 18px';
  submit.style.borderRadius = '12px';
  const validationsRoot = el('div', 'ex-production__checks');

  wrap.append(helper, textarea, submit, validationsRoot);
  mount.appendChild(wrap);

  const renderValidations = (items) => {
    clear(validationsRoot);
    if (!Array.isArray(items) || !items.length) return;
    const list = el('ul');
    items.forEach((item) => {
      if (!item || !item.message) return;
      const li = el('li', item.ok ? 'ok' : 'warn', item.message);
      list.appendChild(li);
    });
    validationsRoot.appendChild(list);
  };

  const applyInitial = () => {
    const value = state.context?.valueFor?.(step);
    if (typeof value === 'string') textarea.value = value;
    if (Array.isArray(step.initialValidations))
      renderValidations(step.initialValidations);
  };

  const submitHandler = () => {
    if (!state.context || typeof state.context.onProductionSubmit !== 'function')
      return;
    const text = textarea.value || '';
    const res = state.context.onProductionSubmit(step, text);
    if (!res) return;
    renderValidations(res.validations || []);
    if (res.feedback)
      setFeedback(res.feedback, res.ok ? 'ok' : (res.retry ? 'warn' : 'err'));
    if (res.advance) {
      updateSummaryView();
      if (state.stepIndex < state.steps.length - 1) {
        state.stepIndex++;
        mountStep();
      } else {
        finishCurrentExercise();
      }
    }
  };

  submit.addEventListener('click', submitHandler);
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submitHandler();
    }
  });

  applyInitial();

  return {
    destroy() {
      submit.removeEventListener('click', submitHandler);
    }
  };
}

// ---------- обработчик выбора варианта ----------
function handlePick(step, value) {
  if (!state.context) return;
  const result = state.context.onPick(step, value) || {};
  const ok = (typeof result.ok === 'boolean') ? result.ok :
              (String(value) === String(step.correct));
  const countError = ('countError' in result) ? !!result.countError : !ok;
  if (countError) state.errors++;
  if (result.feedback)
    setFeedback(result.feedback, ok ? 'ok' : 'warn');

  updateSummaryView();

  if (result.retry) return;

  if (result.advance === false) return;

  // следующий шаг или завершение
  if (state.stepIndex < state.steps.length - 1) {
    state.stepIndex++;
    mountStep();
  } else {
    finishCurrentExercise();
  }
}

// ---------- кнопка «Назад» ----------
function attachBackHandler() {
  state.root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      exitToHome();
    }
  });
  state.els.btnBack.addEventListener('click', onBackClick);
}

function exitToHome() {
  try {
    state.onDone && state.onDone({aborted: true});
  } catch (_) {
  }
  try {
    window.app?.goHome?.();
  } catch (_) {
  }
}

function onBackClick() {
  if (state.stepIndex <= 0) {
    exitToHome();
    return;
  }
  if (!state.context) return;
  const prevIdx = state.stepIndex - 1;
  const step = state.steps[prevIdx];
  recomputeErrorsUpTo(prevIdx);

  state.context.onBack(step);

  state.stepIndex = prevIdx;
  updateSummaryView();
  mountStep();
}

function recomputeErrorsUpTo(lastIdx) {
  if (!state.context) {
    state.errors = 0;
    return;
  }
  const limit = Math.max(0, lastIdx);
  state.errors = state.context.errorsBefore(limit);
}

// ---------- завершение упражнения ----------
async function finishCurrentExercise() {
  if (!state.context) return;
  const result = await state.context.finish({
    errors: state.errors,
    onDone: state.onDone
  });
  if (result && typeof result.errors === 'number') {
    state.errors = result.errors;
  }
}

// ---------- загрузка следующей карточки (или указанной) ----------
async function loadPayload(opts) {
  const progress = opts &&
      (opts.progress ?
           opts.progress :
           (typeof opts.index === 'number' && typeof opts.total === 'number' ?
                {index: opts.index, total: opts.total} :
                null));
  const seed = opts && typeof opts.seed === 'number' ? opts.seed : null;
  if (seed != null && window.lexiparts && window.lexiparts.setSeed)
    window.lexiparts.setSeed(seed);

  const target = state.container ||
      document.getElementById('root') ||
      document.getElementById('app') ||
      document.body;
  if (!target) return;
  if (!state.container) state.container = target;

  if (opts && opts.kind === 'verb' && opts.card) {
    const context = createVerbExerciseContext(opts.card, {seed});
    state.context = context;
    state.steps = context.steps || [];
    state.errors = 0;
    state.stepIndex = 0;

    buildUI(state.container, context.title, progress, context.summaryConfig);
    attachBackHandler();
    if (!state.steps.length) {
      if (typeof state.onDone === 'function') {
        state.onDone({kind: 'verb', card: opts.card, success: true, errors: 0, answers: {}, correct: {}});
      }
      return;
    }
    updateSummaryView();
    mountStep();
    return;
  }

  // noun flow
  let termId = opts && opts.termId;
  let mode = opts && opts.mode;
  if (!termId) {
    const pick = await window.cardengine.sampleNext(Date.now());
    termId = pick.termId;
    mode = pick.mode;
  }
  const term = await window.lexidb.getTerm(termId);
  if (!term) throw new Error('excercise: term not found by id=' + termId);

  const context = await createNounExerciseContext(term, mode || 'MC5');
  state.context = context;
  state.steps = context.steps || [];
  state.errors = 0;
  state.stepIndex = 0;

  buildUI(state.container, context.title, progress, context.summaryConfig);
  attachBackHandler();
  updateSummaryView();
  mountStep();
}

// ---------- API ----------
const api = {
  async mount(container, opts = {}) {
    if (state.mounted) return;
    state.mounted = true;
    state.container = container;
    state.onDone =
        opts.onDone || opts.onComplete || null;  // совместимость с роутером
    if (!state.layout && window.exerciseLayout?.createController) {
      state.layout = window.exerciseLayout.createController({
        storageKey: LAYOUT_SHIFT_KEY,
        min: LAYOUT_SHIFT_MIN,
        max: LAYOUT_SHIFT_MAX,
        format: formatLayoutShift,
        log
      });
    }
    try {
      await window.lexidb.open?.();
      state.layout?.load();
      await loadPayload(opts);
      const ctx = state.context;
      log('mounted', {
        kind: ctx?.kind,
        id: ctx?.kind === 'verb' ? ctx.card?.id : ctx?.term?.id,
        mode: ctx?.kind === 'noun' ? ctx.mode : 'VERB'
      });
    } catch (e) {
      console.error('[exercise] mount error:', e);
      const fallback =
          el('div', null, 'Ошибка загрузки упражнения. Проверьте базу.');
      const host = container ||
          document.getElementById('root') ||
          document.getElementById('app') ||
          document.body;
      if (host) host.appendChild(fallback);
    }
  },
  destroy() {
    if (!state.mounted) return;
    state.mounted = false;
    if (state.widget && state.widget.destroy) try {
        state.widget.destroy();
      } catch (_) {
      }
    state.layout?.destroy();
    if (state.root && state.root.parentNode)
      state.root.parentNode.removeChild(state.root);
    state.container = null;
    state.root = null;
    state.els = null;
    state.widget = null;
    state.summary = null;
    state.summaryItems = null;
    state.context = null;
    state.steps = [];
    state.stepIndex = 0;
    state.errors = 0;
    log('destroyed');
  }
};

window.screens = window.screens || {};
window.screens.excercise = api;
})();
