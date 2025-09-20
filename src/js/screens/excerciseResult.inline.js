/* excerciseResult.inline.js — экран результата одного упражнения
   Зависимости:
     - window.lexidb         — для чтения статов
     - (опц.) window.util    — el/clear/log; есть фолбэки
     - (опц.) window.lexiparts — splitChunks/splitCompose (для показа масок при
   желании) Экспорт: window.screens.excerciseResult = { mount(container, {
         payload,            // { term, mode, success:boolean, errors:number,
   picks:{article,word?,plural, chunks?, letters?},
   correct:{article,word,plural,chunks?,letters?} } onNext,             // () =>
   void — тап по экрану onEdit              // (termId) => void — клик по
   "Редактировать"
       }),
       destroy()
     }

   Визуально и по сетке символов опирается на демо макет из /exRes_demo.html.
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
    (U.log ? U.log('exResult') : (...a) => console.log('[exResult]', ...a));

// ---- helpers: форматирование/рендер ----
const toArr = (s) => Array.from(String(s ?? ''));
function joinAnswerFromPicks(p) {
  const word = p.word ??
      (Array.isArray(p.chunks) ?
           p.chunks.join('') :
           (Array.isArray(p.letters) ? p.letters.join('') : ''));
  return `${p.article ?? ''} ${word ?? ''} ${p.plural ?? ''}`.trim().replace(
      /\s+/g, ' ');
}
function joinCorrectFromObj(c) {
  const word = c.word ??
      (Array.isArray(c.chunks) ?
           c.chunks.join('') :
           (Array.isArray(c.letters) ? c.letters.join('') : ''));
  return `${c.article} ${word} ${c.plural}`.trim().replace(/\s+/g, ' ');
}
function fmtDue(ts) {
  if (!ts || typeof ts !== 'number') return '—';
  const now = Date.now(), one = 86400000;
  const d = Math.round((ts - now) / one);
  if (d === 0) return 'сегодня';
  if (d === 1) return 'завтра';
  if (d === -1) return 'вчера';
  return d > 0 ? `через ${d} дн` : `${Math.abs(d)} дн назад`;
}
function round(x, n = 2) {
  const k = 10 ** n;
  return Math.round(x * k) / k;
}

function renderRows(rootCorrect, rootAnswer, correct, answer) {
  const ref = toArr(correct);
  const usr = toArr(answer);
  const L = Math.max(ref.length, usr.length) || 1;

  rootCorrect.style.setProperty('--cols', L);
  rootAnswer.style.setProperty('--cols', L);

  clear(rootCorrect);
  clear(rootAnswer);

  for (let i = 0; i < L; i++) {
    const rc = ref[i] ?? ' ';
    const uc = usr[i] ?? ' ';

    const cCell = el('div', 'cell');
    const cCh = el('span', null, rc);
    cCell.appendChild(cCh);
    rootCorrect.appendChild(cCell);

    const aCell = el('div', 'cell ans ' + (uc === rc ? 'match' : 'error'));
    const aCh = el('span', null, uc);
    aCell.appendChild(aCh);
    rootAnswer.appendChild(aCell);
  }
}

// ---- построение UI ----
function build(container) {
  clear(container);

  const root = el('section', 'exres');
  const screen = el('div', 'screen');

  // top bar
  const top = el('div', 'top');
  const ttl = el('div', 'ttl', 'Результат');
  const badge = el('div', 'badge');
  const spacer = el('div');
  spacer.style.marginLeft = 'auto';
  const btnEdit = el('button', 'btn', '✎ Редактировать');
  top.append(ttl, badge, spacer, btnEdit);

  // term card
  const cardTerm = el('section', 'card');
  const h1 = el('h1', 'h1', '—');
  const gridC = el('div', 'grid mono');
  gridC.style.setProperty('--cols', '1');
  cardTerm.append(h1, gridC);

  // answer card
  const cardAns = el('section', 'card');
  const hint3 = el('div', 'hint', 'ваш ответ');
  const gridA = el('div', 'grid mono');
  gridA.style.setProperty('--cols', '1');
  const legend = el('div', 'legend');
  const dotOk = el('div', 'dot ok');
  const okLbl = el('span', 'sub', 'совпало');
  const dotEr = el('div', 'dot err');
  const erLbl = el('span', 'sub', 'ошибка');
  legend.append(dotOk, okLbl, dotEr, erLbl);
  cardAns.append(hint3, gridA, legend);

  // stats card
  const cardStat = el('section', 'card stat');
  const h3 = el('h3', null, 'Статистика по слову');
  const rowA = el('div', 'row2');
  const rowB = el('div', 'row2');
  const qBox = metric('q (EWMA)');
  const shownBox = metric('показов');
  const streakBox = metric('серия');
  const sBox = metric('S (дни)');
  const dueBox = metric('due');
  const stageWrap = el('div');
  stageWrap.style.display = 'flex';
  stageWrap.style.alignItems = 'center';
  stageWrap.style.justifyContent = 'flex-end';
  const stage = el('span', 'stage', 'режим: —');
  stageWrap.appendChild(stage);
  rowA.append(qBox.col, shownBox.col, streakBox.col);
  rowB.append(sBox.col, dueBox.col, stageWrap);
  cardStat.append(h3, rowA, rowB);

  const foot =
      el('p', 'foot', 'Тапните в любом месте, чтобы перейти к следующему');

  screen.append(top, cardTerm, cardAns, cardStat, foot);
  root.appendChild(screen);
  container.appendChild(root);

  return {
    root,
    screen,
    top,
    badge,
    btnEdit,
    h1,
    gridC,
    gridA,
    qBox,
    shownBox,
    streakBox,
    sBox,
    dueBox,
    stage
  };
}

function metric(label) {
  const col = el('div');
  const k = el('div', 'k', label);
  const v = el('div', 'v', '—');
  col.append(k, v);
  return {col, k, v};
}

function buildVerb(container) {
  clear(container);

  const root = el('section', 'exres verb');
  const screen = el('div', 'screen');

  const top = el('div', 'top');
  const ttl = el('div', 'ttl', 'Результат (глагол)');
  const badge = el('div', 'badge');
  top.append(ttl, badge);

  const translation = el('div', 'verb-translation', '—');
  translation.style.fontSize = '20px';
  translation.style.marginTop = '18px';

  const summary = el('div', 'verb-summary', '—');
  summary.style.marginTop = '12px';
  summary.style.fontWeight = '700';

  const steps = el('div', 'verb-steps');
  steps.style.marginTop = '18px';
  steps.style.display = 'flex';
  steps.style.flexDirection = 'column';
  steps.style.gap = '12px';

  const example = el('div', 'verb-example');
  example.style.marginTop = '12px';
  example.style.fontSize = '15px';
  example.style.opacity = '0.8';

  const prodCard = el('section', 'card verb-production');
  const prodH = el('h3', null, 'Микро-продукция');
  const prodText = el('div', 'verb-prod-text', '—');
  const prodChecks = el('ul', 'verb-prod-checks');
  prodChecks.style.marginTop = '8px';
  prodChecks.style.paddingLeft = '20px';
  prodChecks.style.listStyle = 'disc';
  prodCard.append(prodH, prodText, prodChecks);

  const foot = el('p', 'foot', 'Тапните в любом месте, чтобы перейти к следующему');

  screen.append(top, translation, summary, steps, example, prodCard, foot);
  root.appendChild(screen);
  container.appendChild(root);

  return {
    root,
    screen,
    badge,
    translation,
    summary,
    steps,
    example,
    prodText,
    prodChecks
  };
}

function fillVerb(els, payload) {
  const {success, summaryLine, stepResults = [], production = {}, example, translation, cue} = payload;
  els.badge.className = 'badge ' + (success ? 'good' : 'bad');
  els.badge.textContent = success ? '✓ Все верно' : '✕ Есть ошибки';

  const title = translation || cue || payload.frame?.cueRu || payload.card?.translation || payload.card?.cue || payload.card?.lemma || 'Глагол';
  els.translation.textContent = title;
  els.summary.textContent = summaryLine || '—';

  clear(els.steps);
  stepResults.forEach((step) => {
    const row = el('div', 'verb-step');
    const status = step.wrong ? (step.finalCorrect ? 'retry' : 'wrong') : 'ok';
    row.className = `verb-step verb-step--${status}`;
    row.style.padding = '12px 16px';
    row.style.borderRadius = '14px';
    row.style.background = status === 'ok' ? '#ebf8ff' : (status === 'retry' ? '#fef3c7' : '#fee2e2');
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '4px';
    const label = el('div', 'verb-step__label', step.label || step.key || 'Шаг');
    label.style.fontSize = '14px';
    label.style.opacity = '0.75';
    const picked = el('div', 'verb-step__picked', step.picked || '—');
    picked.style.fontSize = '18px';
    picked.style.fontWeight = '600';
    row.append(label, picked);
    if (step.wrong && step.correct && step.correct !== step.picked) {
      const corr = el('div', 'verb-step__correct', `Верно: ${step.correct}`);
      corr.style.fontSize = '14px';
      corr.style.opacity = '0.8';
      row.appendChild(corr);
    }
    els.steps.appendChild(row);
  });

  if (example) {
    els.example.textContent = `Пример: ${example}`;
    els.example.style.display = '';
  } else {
    els.example.textContent = '';
    els.example.style.display = 'none';
  }

  const text = production.text || '';
  els.prodText.textContent = text ? text : '—';
  clear(els.prodChecks);
  const validations = Array.isArray(production.validations) ? production.validations : [];
  if (validations.length) {
    validations.forEach((v) => {
      if (!v || !v.message) return;
      const li = el('li', v.ok ? 'ok' : 'warn', v.message);
      li.style.color = v.ok ? '#047857' : '#b91c1c';
      els.prodChecks.appendChild(li);
    });
  } else {
    const li = el('li', 'neutral', production.ok ? 'Валидации пройдены' : 'Подсказок нет');
    li.style.color = '#374151';
    els.prodChecks.appendChild(li);
  }
}

// ---- состояние/экспорт ----
const state = {
  mounted: false,
  els: null,
  onNext: null,
  onEdit: null,
  payload: null,
  mode: 'noun',
  clickHandler: null
};

async function fill(els, payload) {
  const {term, mode, success, picks, correct} = payload;
  // Верхняя панель
  els.badge.className = 'badge ' + (success ? 'good' : 'bad');
  els.badge.textContent = success ? '✓ Верно' : '✕ Неверно';

  // Перевод
  const ru = Array.isArray(term.ru) ? term.ru[0] : (term.ru || '');
  els.h1.textContent = ru || term.de;

  // Готовим строки
  const correctStr = joinCorrectFromObj(correct);
  const answerStr = joinAnswerFromPicks(picks);

  // Гриды
  renderRows(els.gridC, els.gridA, correctStr, answerStr);

  // Статы текущего режима
  try {
    await window.lexidb.open?.();
    const st = await window.lexidb.getStats(term.id);
    if (st) {
      const key = mode === 'MC5' ? 'M' : (mode === 'CHUNKS' ? 'C' : 'P');
      const s = st[key] || {};
      els.qBox.v.textContent =
          (typeof s.q === 'number' ? (Math.round(s.q * 100) / 100).toFixed(2) :
                                     '—');
      els.streakBox.v.textContent = String(s.streak ?? '—');
      els.sBox.v.textContent =
          (typeof s.S === 'number' ? String(round(s.S, 1)) : '—');
      els.dueBox.v.textContent =
          (typeof s.due === 'number' ? fmtDue(s.due) : '—');
      // «показов»: берём n (счётчик предъявлений режима), если cardengine его
      // ведёт
      els.shownBox.v.textContent = String((s.n != null ? s.n : '—'));
      els.stage.textContent = 'режим: ' + (st.stage || mode || '—');
    }
  } catch (err) {
    console.error('[exResult] stats error', err);
  }
}

// ---- API ----
const api = {
  async mount(container, {payload, onNext, onEdit} = {}) {
    if (state.mounted) return;
    state.mounted = true;
    state.payload = payload;
    state.onNext = typeof onNext === 'function' ? onNext : null;
    state.onEdit = typeof onEdit === 'function' ? onEdit : null;

    const mode = payload && payload.kind === 'verb' ? 'verb' : 'noun';
    state.mode = mode;

    if (mode === 'verb') {
      const els = buildVerb(container);
      state.els = els;
      const handler = (e) => {
        e.stopPropagation();
        if (state.onNext) state.onNext();
      };
      els.screen.addEventListener('click', handler);
      state.clickHandler = {node: els.screen, fn: handler};
      fillVerb(els, payload);
      log('mounted result verb', {id: payload.card?.id, ok: payload.success});
      return;
    }

    const els = build(container);
    state.els = els;

    // Навигация
    els.btnEdit.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.onEdit) state.onEdit(payload.term.id);
    });
    const handler = (e) => {
      if (e.target === els.btnEdit) return;
      if (state.onNext) state.onNext();
    };
    els.screen.addEventListener('click', handler);
    state.clickHandler = {node: els.screen, fn: handler};

    await fill(els, payload);
    log('mounted result', {id: payload.term.id, ok: payload.success});
  },

  destroy() {
    if (!state.mounted) return;
    state.mounted = false;
    if (state.clickHandler && state.clickHandler.node) {
      state.clickHandler.node.removeEventListener('click', state.clickHandler.fn);
    }
    if (state.els && state.els.root && state.els.root.parentNode) {
      state.els.root.parentNode.removeChild(state.els.root);
    }
    state.els = null;
    state.onNext = null;
    state.onEdit = null;
    state.payload = null;
    state.clickHandler = null;
    state.mode = 'noun';
    log('destroyed');
  }
};

window.screens = window.screens || {};
window.screens.excerciseResult = api;
})();
