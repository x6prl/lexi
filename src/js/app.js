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
  baseAcc: 0
};
function resetSession(size) {
  session.running = true;
  session.size = size;
  session.index = 0;
  session.results = [];
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
      onExport: () => doExport()
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

async function startRound(size) {
  await window.lexidb.open?.();
  resetSession(size);
  session.baseAcc = await avgAccNow();
  log('round start', {size, baseAcc: session.baseAcc.toFixed(3)});
  nextExercise();
}

// ВАЖНО: роутер НЕ сэмплирует карточку и НЕ зовёт onReview — это делает
// «толстый» экран.
function nextExercise() {
  if (session.index >= session.size) {
    return finishRound();
  }
  router.go('excercise', () => {
    const ex = window.screens.excercise;
    ex.mount(mountRoot, {
      progress: {index: session.index + 1, total: session.size},  // опционально
      onDone: (payload) => {
        session.results.push(payload);
        session.index += 1;
        nextExercise();
      }
    });
    return ex;
  });
}

async function finishRound() {
  const after = await avgAccNow();
  const deltaPp = Math.round((after - session.baseAcc) * 100);  // п.п.
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
  if (!Array.isArray(list) || list.length === 0)
    return startRound(settings.roundSize);
  review.list = list.slice();
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
          onBack: () => showOneResult(),
          onSaved: () => showOneResult(),
          onDeleted: () => {
            review.deleted.add(termId);
            showOneResult();
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
    ed.mount(mountRoot, {
      termId,
      onBack: () => {
        if (typeof onBack === 'function') return onBack();
        if (from === 'list') return showDbList();
        if (from === 'exres') return showOneResult();
        showHome();
      },
      onSaved: () => {
        if (typeof onSaved === 'function') onSaved();
      },
      onDeleted: () => {
        if (typeof onDeleted === 'function') onDeleted();
        if (from === 'list') return showDbList();
        if (from === 'exres') return showOneResult();
        showHome();
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
