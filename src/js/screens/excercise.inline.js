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

function createVerbExerciseContext(card) {
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

// ---------- обработчик выбора варианта ----------
function handlePick(step, value) {
  if (!state.context) return;
  const result = state.context.onPick(step, value) || {};
  const ok = (typeof result.ok === 'boolean') ? result.ok :
              (String(value) === String(step.correct));
  if (!ok) state.errors++;

  updateSummaryView();

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
    const context = createVerbExerciseContext(opts.card);
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
