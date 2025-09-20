/* app.js — корневой контроллер оффлайн-SPA с простым встроенным роутером
   Модель: «толстые экраны, простой роутер».
   Экран excercise сам делает sampleNext / onReview и следит за валидностью
   вариантов. Подключает экраны и модули:
   - screens: home, excercise, roundResult, excerciseResult, dbList, dbItemAdd,
   dbItemEdit
   - infra:   lexidb, cardengine, dbStatistics, util, widgets/*
*/
(function() {
'use strict';

// ---------- лог ----------
const log = (...a) => console.log('[app]', ...a);

// ---------- DOM-монтаж ----------
// В шаблоне используется <main id="root"> — монтируем именно сюда
const mountRoot = document.getElementById('root') ||
    document.getElementById('app') || document.body;

// ---------- настройки (LS) ----------
const LS_KEY = 'lexi.settings';
const defaults = {
  roundSize: 5
};
const settings = load();
function load() {
  try {
    return {...defaults, ...(JSON.parse(localStorage.getItem(LS_KEY)) || {})};
  } catch {
    return {...defaults};
  }
}
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch (_) {
  }
}

// ---------- единый лёгкий роутер ----------
const router = (() => {
  let state = {name: null, api: null};
  return {
    go(name, mountFn) {
      try {
        state.api?.destroy?.();
      } catch (e) {
        console.warn(e);
      }
      state = {name, api: null};
      const api = typeof mountFn === 'function' ? (mountFn() || null) : null;
      state.api = api;
      log('route →', name);
      return api;
    },
    reset() {
      try {
        state.api?.destroy?.();
      } catch (e) {
      }
      state = {name: null, api: null};
    },
    get name() {
      return state.name;
    },
    get api() {
      return state.api;
    }
  };
})();
window.router = router;  // опционально — удобно для отладки

// ---------- усреднённая точность БД (для Δ в roundResult) ----------
async function avgAccNow() {
  try {
    await window.lexidb.open?.();
    const ids = await window.lexidb.listTermIds();
    if (!ids.length) return 0;
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
    return +agg.avgAcc || 0;
  } catch (e) {
    console.warn('[app] avgAcc error', e);
    return 0;
  }
}

// ---------- импорт/экспорт ----------
async function doImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.md,text/plain';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const txt = await file.text();
    await window.lexidb.open?.();
    const res = await window.lexidb.importText(txt);
    console.log('[import]', res);
    alert(`Импорт завершён:
+ добавлено: ${res.added}
* обновлено: ${res.updated}
= пропущено: ${res.skipped}
! ошибок: ${res.errors.length}`);
    if (router.name === 'home') window.screens.home?.update?.();
  };
  input.click();
}

let _exportBusy = false;
async function doExport() {
  if (_exportBusy) return;
  _exportBusy = true;
  try {
    await window.lexidb.open?.();
    const list = await window.lexidb.allTerms();
    const blocks = list.map(t => {
      const ru = Array.isArray(t.ru) ? t.ru.join('; ') : (t.ru || '');
      return `${t.art} ${t.de} ${t.pl}\n${ru}\n`;
    });
    const blob =
        new Blob([blocks.join('\n')], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lexi-export.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // дать браузеру стартовать загрузку и освободить URL
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } finally {
    // небольшой троттлинг, чтобы двойной клик не вызвал второй старт
    setTimeout(() => {
      _exportBusy = false;
    }, 400);
  }
}

// ---------- «сессия» раунда ----------
const session = {
  running: false,
  size: settings.roundSize,
  index: 0,
  results: [],
  baseAcc: 0,
  plan: [],
  verbs: [],
  verbIndex: 0
};
function resetSession(size) {
  session.running = true;
  session.size = size;
  session.index = 0;
  session.results = [];
  session.plan = [];
  session.verbs = [];
  session.verbIndex = 0;
}

// ---------- экраны ----------
function showHome() {
  router.go('home', () => {
    const api = window.screens.home;
    api.mount(mountRoot, {
      roundSize: settings.roundSize,
      onChangeRoundSize: (n) => {
        settings.roundSize =
            Math.max(3, Math.min(60, +n || defaults.roundSize));
        save();
        api.update({roundSize: settings.roundSize});
      },
      onStartRound: () => startRound(settings.roundSize),
      onDb: () => showDbList(),
      onAdd: () => showDbItemAdd(),
      onImport: () => doImport(),
      onExport: () => doExport(),
      onVerbs: () => showVerbs()
    });
    (async () => {
      try {
        await window.lexidb.open?.();
        api.update();
      } catch (e) {
      }
    })();
    return api;
  });
}

function showVerbs() {
  router.go('verbs', () => {
    const api = window.screens.verbs;
    if (!api || typeof api.mount !== 'function') {
      alert('Экран глаголов недоступен');
      showHome();
      return null;
    }
    return api.mount(mountRoot, {
      onBack: () => showHome()
    });
  });
}

async function buildRoundPlan(size) {
  const plan = [];
  const verbs = (window.verbdb && typeof window.verbdb.listCards === 'function')
      ? window.verbdb.listCards() : [];
  let nounIds = [];
  try {
    nounIds = await window.lexidb.listTermIds();
  } catch (e) {
    nounIds = [];
  }
  const haveNouns = nounIds.length > 0;
  const haveVerbs = verbs.length > 0;
  if (!haveNouns && !haveVerbs) return {plan: [], verbs: []};

  let vIdx = 0;
  for (let i = 0; i < size; i++) {
    const useVerb = haveVerbs && (!haveNouns || (i % 2 === 1));
    if (useVerb) {
      plan.push({kind: 'verb', verbIndex: vIdx % verbs.length});
      vIdx += 1;
    } else {
      plan.push({kind: 'noun'});
    }
  }
  if (haveVerbs && plan.length && !plan.some((item) => item.kind === 'verb')) {
    plan[plan.length - 1] = {kind: 'verb', verbIndex: 0};
  }
  return {plan, verbs};
}

async function startRound(size) {
  await window.lexidb.open?.();
  resetSession(size);
  const {plan, verbs} = await buildRoundPlan(size);
  if (!plan.length) {
    alert('Добавьте слова или импортируйте глаголы, чтобы начать проход.');
    session.running = false;
    showHome();
    return;
  }
  session.plan = plan;
  session.size = plan.length;
  session.verbs = verbs;
  session.baseAcc = await avgAccNow();
  log('round start', {
    size: plan.length,
    baseAcc: session.baseAcc.toFixed(3),
    verbs: verbs.length
  });
  nextExercise();
}

// ВАЖНО: роутер НЕ сэмплирует карточку и НЕ зовёт onReview — это делает
// «толстый» экран.
function nextExercise() {
  if (session.index >= session.size) {
    return finishRound();
  }
  const entry = session.plan[session.index] || {kind: 'noun'};
  router.go('excercise', () => {
    const ex = window.screens.excercise;
    const opts = {
      progress: {index: session.index + 1, total: session.size},
      onDone: (payload) => {
        if (payload && payload.aborted) {
          session.running = false;
          showHome();
          return;
        }
        session.results.push(payload);
        session.index += 1;
        nextExercise();
      }
    };
    if (entry.kind === 'verb') {
      const card = session.verbs[entry.verbIndex] || null;
      if (!card) {
        opts.kind = 'noun';
      } else {
        opts.kind = 'verb';
        opts.card = card;
      }
    }
    ex.mount(mountRoot, opts);
    return ex;
  });
}

async function finishRound() {
  const after = await avgAccNow();
  const deltaPp = Math.round((after - session.baseAcc) * 100);  // п.п.
  session.running = false;
  showRoundResult(deltaPp);
}

function showRoundResult(deltaPp) {
  router.go('roundResult', () => {
    const rr = window.screens.roundResult;
    rr.mount(mountRoot, {
      results: session.results,
      completed: session.results.length,
      total: session.size,
      dbDeltaPp: deltaPp,
      onShowAll: (list) => startReviewSequence(list),
      onShowErrors: (list) => startReviewSequence(list)
    });
    return rr;
  });
}

// последовательный просмотр результатов и правки
const review = {
  list: [],
  idx: 0,
  deleted: new Set()
};

function startReviewSequence(list) {
  const actual = Array.isArray(list) ? list.slice() : [];
  if (!actual.length)
    return startRound(settings.roundSize);
  review.list = actual;
  review.idx = 0;
  review.deleted = new Set();
  showOneResult();
}

function showOneResult() {
  const r = review.list[review.idx];
  if (!r) return startRound(settings.roundSize);
  router.go('excerciseResult', () => {
    const er = window.screens.excerciseResult;
    er.mount(mountRoot, {
      payload: r,
      canEdit: !review.deleted.has(r.termId),
      onNext: () => {
        review.idx += 1;
        showOneResult();
      },
      onEdit: (termId) => {
        showDbItemEdit(termId, {
          from: 'exres',
          onDeleted: () => {
            review.deleted.add(termId);
          }
        });
      }
    });
    return er;
  });
}

function showDbList() {
  router.go('dbList', () => {
    const db = window.screens.dbList;
    db.mount(mountRoot, {
      onBack: () => showHome(),
      onOpen: (termId) => showDbItemEdit(termId, {from: 'list'}),
      onDeleted: () => {}
    });
    return db;
  });
}

function showDbItemAdd() {
  router.go('dbItemAdd', () => {
    const add = window.screens.dbItemAdd;
    add.mount(mountRoot, {onBack: () => showHome(), onAdded: () => showHome()});
    return add;
  });
}

function showDbItemEdit(termId, {from, onBack, onSaved, onDeleted} = {}) {
  router.go('dbItemEdit', () => {
    const ed = window.screens.dbItemEdit;
    const goBack = () => {
      if (typeof onBack === 'function') return onBack();
      if (from === 'list') return showDbList();
      if (from === 'exres') return showOneResult();
      showHome();
    };
    ed.mount(mountRoot, {
      termId,
      onBack: goBack,
      onSaved: () => {
        if (typeof onSaved === 'function') onSaved();
        goBack();
      },
      onDeleted: () => {
        if (typeof onDeleted === 'function') onDeleted();
        goBack();
      }
    });
    return ed;
  });
}

// ---------- boot ----------
async function boot() {
  try {
    await window.lexidb.open?.();
    // Настройки движка карточек (экран сам ими пользуется)
    window.cardengine.configure?.({targetNewShare: 0.6, maxIntervalDays: 60});
    log('db ready');
  } catch (e) {
    console.error('[app] DB open failed', e);
  }
  showHome();
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', boot, {once: true});
else
  boot();

// --- History glue (минимально) ---
window.addEventListener('popstate', (e) => {
  // простейший восстановитель: возвращаемся на home
  // (при желании можно хранить стек имен в state и восстанавливать точнее)
  showHome();
});

// пушим состояние на каждый показ экрана
const origGo = router.go;
router.go = function(name, mountFn) {
  const api = origGo(name, mountFn);
  try {
    history.pushState({name}, '', '#' + name);
  } catch (_) {
  }
  return api;
};

// Предупреждение при активном раунде
window.addEventListener('beforeunload', (e) => {
  if (session.running) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});


// expose for debug
window.app = {
  goHome: showHome,
  startRound: (n) => startRound(n || settings.roundSize),
  import: doImport,
  export: doExport,
  settings,
  router
};
})();
