/* verbs.inline.js — простой экран для глагольных карточек.
   Без сложного планировщика: карточки хранятся в localStorage через verbdb,
   сессия проходит последовательно по всем карточкам.
*/
(function() {
'use strict';

const U = window.util || {};
const el = U.el || ((tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
});
const clear = U.clear || ((node) => {
  while (node && node.firstChild) node.removeChild(node.firstChild);
});
const ensureBaseStyles = U.ensureBaseStyles || (() => {});
const injectStyle = U.injectStyle || (() => {});
const file = (U.file) || {};
const makeToaster = U.makeToaster || ((parent) => {
  return {el: el('div'), show: (msg) => alert(msg)};
});

function createUI(container) {
  ensureBaseStyles();
  injectStyle('verbs-simple-style', `
    .verbs-simple{min-height:100%;}
    .verbs-simple h2{margin:18px 0 6px;font-size:26px;font-weight:800;}
    .verbs-simple .verbs-translation{font-size:18px;opacity:.75;}
    .verbs-simple .verbs-progress{margin-top:12px;font-size:14px;opacity:.7;}
    .verbs-simple .verbs-question{margin-top:24px;font-size:18px;font-weight:700;}
    .verbs-simple .verbs-options{display:flex;flex-direction:column;gap:10px;margin-top:16px;}
    .verbs-simple .verbs-options button{appearance:none;border:0;border-radius:12px;padding:14px 18px;font-weight:700;font-size:17px;letter-spacing:.2px;text-align:left;background:#f3f4f6;color:#0a1428;box-shadow:0 2px 0 rgba(10,20,40,.05) inset;cursor:pointer;transition:filter .15s ease,transform .02s ease;}
    .verbs-simple .verbs-options button.correct{background:#bbf7d0;color:#064e3b;}
    .verbs-simple .verbs-options button.wrong{background:#fecaca;color:#7f1d1d;}
    .verbs-simple .verbs-feedback{min-height:22px;margin-top:14px;font-size:15px;}
    .verbs-simple .verbs-summary{margin-top:24px;padding:16px;border-radius:16px;background:#f9fafb;font-size:15px;}
    @media (prefers-color-scheme: dark){
      .verbs-simple .verbs-options button{background:#1f2937;color:#f9fafb;box-shadow:0 2px 0 rgba(0,0,0,.25) inset;}
      .verbs-simple .verbs-options button.correct{background:#14532d;color:#bbf7d0;}
      .verbs-simple .verbs-options button.wrong{background:#7f1d1d;color:#fee2e2;}
      .verbs-simple .verbs-summary{background:#1f2937;color:#e5e7eb;}
    }
  `);

  const root = el('section', 'verbs-simple');
  const wrap = el('div', 'ui-wrap');
  const controls = el('div', 'ui-row');
  const bBack = el('button', 'btn ghost', '← Назад');
  const bImport = el('button', 'btn', 'Импорт JSON');
  const bExport = el('button', 'btn', 'Экспорт JSON');
  const bStart = el('button', 'btn primary', 'Старт сессии');
  controls.append(bBack, bImport, bExport, bStart);

  const title = el('h2', null, 'Глаголы');
  const translation = el('div', 'verbs-translation');
  const progress = el('div', 'verbs-progress');
  const question = el('div', 'verbs-question', 'Здесь появится задание.');
  const options = el('div', 'verbs-options');
  const feedback = el('div', 'verbs-feedback');
  const nextRow = el('div', 'ui-row');
  const bNext = el('button', 'btn primary hidden', 'Дальше');
  nextRow.append(bNext);
  const summary = el('div', 'verbs-summary hidden');
  const note = el('div', 'note', 'Импортируйте JSON с карточками глаголов — они появятся в общих проходах. Здесь же можно тренировать только глаголы.');

  const toaster = makeToaster(wrap);

  wrap.append(controls, title, translation, progress, question, options, feedback, nextRow, summary, note, toaster.el);
  root.appendChild(wrap);
  container.appendChild(root);

  function hideNext() {
    bNext.classList.add('hidden');
    bNext.disabled = true;
  }
  function showNext(label, handler) {
    bNext.textContent = label || 'Дальше';
    bNext.onclick = handler;
    bNext.disabled = false;
    bNext.classList.remove('hidden');
  }

  return {
    root,
    buttons: {bBack, bImport, bExport, bStart, bNext},
    title,
    translation,
    progress,
    question,
    options,
    feedback,
    summary,
    note,
    toaster,
    clearOptions() {
      clear(options);
    },
    renderOptions(list, onPick) {
      clear(options);
      list.forEach((label) => {
        const btn = el('button', null, label);
        btn.addEventListener('click', () => onPick(label, btn));
        options.appendChild(btn);
      });
    },
    setTitle(text) {
      title.textContent = text || 'Глаголы';
    },
    setTranslation(text) {
      translation.textContent = text || '';
    },
    setProgress(text) {
      progress.textContent = text || '';
    },
    setQuestion(text) {
      question.textContent = text || '';
    },
    setFeedback(text) {
      feedback.textContent = text || '';
    },
    showSummary(text) {
      summary.textContent = text || '';
      summary.classList.toggle('hidden', !text);
    },
    showNote(text) {
      note.textContent = text || '';
      note.classList.toggle('hidden', !text);
    },
    hideNote() {
      note.classList.add('hidden');
    },
    showNext,
    hideNext,
    destroy() {
      root.remove();
    }
  };
}

function formatAccuracy(entry) {
  if (!entry) return '';
  const seen = entry.seen || 0;
  if (!seen) return '';
  const pct = Math.round(((entry.correct || 0) / seen) * 100);
  return `Точность: ${pct}% (${entry.correct}/${seen})`;
}

const screen = {
  mounted: false,
  ui: null,
  opts: {},
  session: null,
  mount(container, opts = {}) {
    this.opts = opts;
    this.ui = createUI(container);
    this.mounted = true;
    const {bBack, bImport, bExport, bStart} = this.ui.buttons;
    bBack.addEventListener('click', () => {
      opts.onBack && opts.onBack();
    });
    bImport.addEventListener('click', () => this.handleImport());
    bExport.addEventListener('click', () => this.handleExport());
    bStart.addEventListener('click', () => this.startSession());
    this.refreshState();
    return this;
  },
  refreshState() {
    const cards = (window.verbdb && window.verbdb.listCards) ? window.verbdb.listCards() : [];
    if (!cards.length) {
      this.ui.setTitle('Глаголы');
      this.ui.setTranslation('');
      this.ui.setProgress('');
      this.ui.setQuestion('Здесь появится задание.');
      this.ui.clearOptions();
      this.ui.setFeedback('');
      this.ui.showSummary('');
      this.ui.showNote('Импортируйте JSON с карточками глаголов — после импорта они будут участвовать в обычных проходах.');
      this.ui.hideNext();
      return;
    }
    const first = cards[0];
    const prog = window.verbdb.getProgress ? window.verbdb.getProgress(first.id) : null;
    this.ui.setTitle(first.cue || first.lemma || 'Глаголы');
    this.ui.setTranslation(first.translation || '');
    this.ui.setProgress(formatAccuracy(prog));
    this.ui.setQuestion('Нажмите «Старт сессии», чтобы потренироваться.');
    this.ui.clearOptions();
    this.ui.setFeedback('');
    this.ui.showSummary('Всего карточек: ' + cards.length);
    this.ui.hideNext();
    this.ui.showNote('Глаголы уже в общем расписании. Хотите отдельную тренировку — нажмите «Старт сессии».');
  },
  async handleImport() {
    if (!file.pickTextFile) {
      this.ui.toaster.show('Импорт недоступен в этом браузере', true);
      return;
    }
    const picked = await file.pickTextFile();
    if (!picked || !picked.text) return;
    try {
      const res = window.verbdb.importJSON(picked.text);
      this.ui.toaster.show(`Импортировано карточек: ${res.cards}`);
    } catch (e) {
      this.ui.toaster.show(e.message || 'Не удалось импортировать JSON', true);
    }
    this.refreshState();
  },
  handleExport() {
    if (!window.verbdb || !window.verbdb.exportJSON) {
      this.ui.toaster.show('Экспорт недоступен', true);
      return;
    }
    const text = window.verbdb.exportJSON();
    if (file.downloadText) file.downloadText('lexi-verbs.json', text);
    else this.ui.toaster.show('Скопируйте данные:\n' + text);
  },
  startSession() {
    const cards = (window.verbdb && window.verbdb.listCards) ? window.verbdb.listCards() : [];
    if (!cards.length) {
      this.ui.toaster.show('Нет карточек. Импортируйте JSON.', true);
      return;
    }
    this.session = {
      cards,
      cardIdx: 0,
      questionIdx: 0,
      totalCorrect: 0,
      answered: 0,
      cardCorrect: true
    };
    this.ui.hideNote();
    this.showCurrentCard();
  },
  currentCard() {
    if (!this.session) return null;
    return this.session.cards[this.session.cardIdx] || null;
  },
  showCurrentCard() {
    const card = this.currentCard();
    if (!card) return this.finishSession();
    this.session.questionIdx = 0;
    this.session.cardCorrect = true;
    this.ui.setTitle(card.cue || card.lemma || 'Карточка');
    this.ui.setTranslation(card.translation || '');
    const prog = window.verbdb.getProgress ? window.verbdb.getProgress(card.id) : null;
    this.ui.setProgress(formatAccuracy(prog));
    this.ui.showSummary(`Карточка ${this.session.cardIdx + 1} из ${this.session.cards.length}`);
    this.showCurrentQuestion();
  },
  showCurrentQuestion() {
    const card = this.currentCard();
    if (!card) return;
    const questions = card.questions || [];
    const question = questions[this.session.questionIdx];
    if (!question) return this.finishCard();
    this.ui.setQuestion(question.prompt);
    this.ui.setFeedback('');
    this.ui.hideNext();
    const options = question.options || [];
    this.ui.renderOptions(options, (label, btn) => {
      this.handleAnswer(question, label, btn);
    });
  },
  handleAnswer(question, choice, btn) {
    const card = this.currentCard();
    if (!card) return;
    const opts = Array.from(this.ui.options.querySelectorAll('button'));
    opts.forEach(b => b.disabled = true);
    if (choice === question.answer) {
      btn.classList.add('correct');
      this.session.totalCorrect += 1;
      this.ui.setFeedback('Верно!');
    } else {
      btn.classList.add('wrong');
      this.session.cardCorrect = false;
      this.ui.setFeedback(`Нужно: ${question.answer}`);
      opts.forEach((b) => {
        if (b.textContent === question.answer) b.classList.add('correct');
      });
    }
    this.session.answered += 1;
    const isLastStep = this.session.questionIdx >= (card.questions.length - 1);
    this.ui.showNext(isLastStep ? 'Следующая карточка' : 'Следующий шаг', () => {
      this.ui.hideNext();
      if (isLastStep) {
        this.finishCard();
      } else {
        this.session.questionIdx += 1;
        this.showCurrentQuestion();
      }
    });
  },
  finishCard() {
    const card = this.currentCard();
    if (card && window.verbdb && window.verbdb.recordResult) {
      window.verbdb.recordResult(card.id, this.session.cardCorrect);
    }
    this.session.cardIdx += 1;
    this.session.questionIdx = 0;
    this.showCurrentCard();
  },
  finishSession() {
    const total = this.session ? this.session.cards.length : 0;
    const done = this.session ? this.session.cardIdx : 0;
    this.ui.setQuestion('Сессия завершена.');
    this.ui.clearOptions();
    this.ui.setFeedback('');
    this.ui.showSummary(`Ответов: ${this.session?.answered || 0}. Карточек пройдено: ${done} из ${total}.`);
    this.ui.showNext('Вернуться к списку', () => {
      this.ui.hideNext();
      this.session = null;
      this.refreshState();
    });
  },
  destroy() {
    this.session = null;
    if (this.ui) this.ui.destroy();
    this.mounted = false;
  }
};

window.screens = window.screens || {};
window.screens.verbs = screen;
})();
