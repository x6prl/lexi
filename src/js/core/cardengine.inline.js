/* cardengine.inline.js — выбор следующей карточки и обновление статов
   Зависимости (опционально, но ожидаемо): window.lexidb (из lexidb.inline.js)
   Экспортирует глобально:
     window.cardengine = {
       configure,              // (settings?: Partial<Settings>) -> void
       sampleNext,             // (now=Date.now()) -> Promise<{termId, mode}>
       onReview,               // (termId, mode, result:boolean, now=Date.now())
   -> Promise<void> getProgress,            // () -> Promise<{coverage, debt,
   nearly, totalIntro, totalTerms}>
       // вспомогательное
       getStatsSafe,           // (termId) -> Promise<TermStatsV2>
       introduce,              // (termId, now=Date.now()) -> Promise<void>
       version: '2.0.0-final'
     }

   Минимальные структуры (как в ТЗ) + счётчик n (число предъявлений в режиме):
     ModeState = { S:number, last:number, due:number, q:number, streak:number,
   n?:number } TermStatsV2 = { id, stage:'MC5'|'CHUNKS'|'COMPOSE',
   intro:boolean, M:ModeState, C:ModeState, P:ModeState }

   Настройки (интерфейс из ТЗ):
     Settings = {
       id:'singleton',
       leitnerDays:number[],                // напр. [0,1,3,7,15,30,60]
       toCHUNKS:{ minBox:number,minShown:number,minAcc:number },
       toCOMPOSE:{minBox:number,minShown:number,minAcc:number },
       maxIntervalDays:number,              // напр. 60
       targetNewShare:number                // 0..1
     }
*/
(function() {
'use strict';

// ---- Константы «ядра памяти» (по умолчанию из ТЗ) ----
const TAU = 0.9;     // целевая надёжность показа
const DELTA = 0.05;  // коридор «почти due»
const LAMBDA = 0.2;  // штраф за уверенную ошибку
const RHO = 0.2;     // EWMA-коэффициент точности q
const ETA = {
  MC5: 0.30,
  CHUNKS: 0.36,
  COMPOSE: 0.45
};  // шаги обучения
const S_MIN = 0.25;   // дни
const ALPHA = 0.5;    // вес (1-q)
const BETA = 0.3;     // вес «долга»
const KAPPA = 6;      // «жадность» softmax
const Q_DOWN = 0.55;  // порог для понижения
const QUICK_RETRY_MS =
    2 * 60 * 1000;  // 2 минуты (внутрисессионный мягкий повтор)
const ONE_DAY = 86400000;

// ---- Настройки по умолчанию (можно переопределить через configure) ----
const defaultSettings = Object.freeze({
  id: 'singleton',
  leitnerDays: [0, 1, 3, 7, 15, 30, 60],
  toCHUNKS: {minBox: 3, minShown: 5, minAcc: 0.75},
  toCOMPOSE: {minBox: 2, minShown: 10, minAcc: 0.70},
  maxIntervalDays: 60,
  targetNewShare: 0.6
});

let settings = {...defaultSettings};

function configure(partial) {
  if (!partial) return;
  // неглубокий merge
  const s = {...settings, ...partial};
  if (partial.toCHUNKS)
    s.toCHUNKS = {...settings.toCHUNKS, ...partial.toCHUNKS};
  if (partial.toCOMPOSE)
    s.toCOMPOSE = {...settings.toCOMPOSE, ...partial.toCOMPOSE};
  if (Array.isArray(partial.leitnerDays))
    s.leitnerDays = partial.leitnerDays.slice();
  settings = s;
}

// ---- Вспомогательные функции математики ----
const LOG2_1_OVER_TAU = Math.log2(1 / TAU);

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function expm1(x) {
  return Math.exp(x) - 1;
}

function pHat(dtDays, S) {  // 2^{-Δt/S}
  if (S <= 0) S = S_MIN;
  return Math.pow(2, -dtDays / S);
}

function dueFrom(now, S) {  // now + S * log2(1/τ)
  return now + S * ONE_DAY * LOG2_1_OVER_TAU;
}

function Smax() {  // из настроек maxIntervalDays
  return settings.maxIntervalDays / LOG2_1_OVER_TAU;
}

function clipExp(logS, sMin, sMax) {  // exp(clamp(logS))
  const v = Math.exp(clamp(logS, Math.log(sMin), Math.log(sMax)));
  return v;
}

function intervalDaysFromS(S) {
  return S * LOG2_1_OVER_TAU;
}

function currentLeitnerBox(S) {
  // «Виртуальный» бокс = индекс наибольшего интервала в settings.leitnerDays,
  // который <= текущего интервала
  const d = intervalDaysFromS(S);
  const L = settings.leitnerDays;
  let box = 0;
  for (let i = 0; i < L.length; i++) {
    if (d >= L[i])
      box = i;
    else
      break;
  }
  return box;
}

function softmaxSample(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// ---- Быстрые внутрисессионные повторы (RAM only) ----
// элементы: { id, mode, availableAt }
const quickQueue = [];
function enqueueQuickRetry(id, mode, now) {
  quickQueue.push({id, mode, availableAt: now + QUICK_RETRY_MS});
}
function pickupQuickRetry(now) {
  for (let i = 0; i < quickQueue.length; i++) {
    if (quickQueue[i].availableAt <= now) {
      const it = quickQueue.splice(i, 1)[0];
      return it;
    }
  }
  return null;
}

// ---- Доступ к базе (lexidb) ----
async function getStatsSafe(termId) {
  await window.lexidb.open?.();
  const s = await window.lexidb.getStats(termId);
  if (s) return normalizeStats(s);
  // если нет — создадим дефолт (lexidb.ensureStats уже это делает)
  return await window.lexidb.ensureStats(termId).then(normalizeStats);
}

function normalizeModeState(ms) {
  // добавляем n при отсутствии
  if (typeof ms.n !== 'number') ms.n = 0;
  return ms;
}

function normalizeStats(s) {
  s.M = normalizeModeState(s.M);
  s.C = normalizeModeState(s.C);
  s.P = normalizeModeState(s.P);
  // корректность due при странных S
  if (!(s.M.S > 0)) s.M.S = S_MIN;
  if (!(s.C.S > 0)) s.C.S = S_MIN;
  if (!(s.P.S > 0)) s.P.S = S_MIN;
  if (!(s.M.due > 0)) s.M.due = dueFrom(Date.now(), s.M.S);
  if (!(s.C.due > 0)) s.C.due = dueFrom(Date.now(), s.C.S);
  if (!(s.P.due > 0)) s.P.due = dueFrom(Date.now(), s.P.S);
  return s;
}

// ---- Сервис: introduce нового терма ----
async function introduce(termId, now) {
  const s = await getStatsSafe(termId);
  s.intro = true;
  s.stage = 'MC5';
  // «вводим» с немедленным показом
  s.M.last = now;
  s.M.due = now;
  await window.lexidb.putStats(s);
}

// ---- Кандидаты и приоритеты ----
async function collectCandidates(now) {
  const ids = await window.lexidb.listTermIds();
  const stats = await Promise.all(ids.map(id => window.lexidb.getStats(id)));
  const introStats = [];
  let totalIntro = 0;
  for (let i = 0; i < ids.length; i++) {
    const st = stats[i] ? normalizeStats(stats[i]) : null;
    if (!st) {
      continue;
    }
    if (st.intro) totalIntro++;
    introStats.push(st);
  }

  const due = [];
  const nearly = [];
  for (const st of introStats) {
    if (!st.intro) continue;
    const mode = st.stage || 'MC5';
    const mstate = (mode === 'MC5' ? st.M : mode === 'CHUNKS' ? st.C : st.P);
    const dtDays = (now - mstate.last) / ONE_DAY;
    const p = pHat(Math.max(1 / 1440, dtDays), mstate.S);
    if (mstate.due <= now)
      due.push(st);
    else if (p > TAU && p <= TAU + DELTA)
      nearly.push(st);
  }
  return {
    due,
    nearly,
    totalIntro,
    totalTerms: ids.length,
    allIntroStats: introStats
  };
}

function priorityOf(st, now) {
  const mode = st.stage || 'MC5';
  const ms = (mode === 'MC5' ? st.M : mode === 'CHUNKS' ? st.C : st.P);
  const dtDays = Math.max(1 / 1440, (now - ms.last) / ONE_DAY);
  const p = pHat(dtDays, ms.S);
  const overdueRatio =
      Math.max(0, (now - ms.due) / (ms.S * ONE_DAY * LOG2_1_OVER_TAU));
  const pi = Math.max(0, TAU - p) + ALPHA * (1 - ms.q) + BETA * overdueRatio;
  return {pi, p};
}

function pickBySoftmax(cands, now) {
  if (!cands.length) return null;
  const weights = cands.map(st => Math.exp(KAPPA * priorityOf(st, now).pi));
  const idx = softmaxSample(weights);
  return cands[idx];
}

// ---- Вероятность ввода новых ----
function newProbability(debtSize, coverage, targetNewShare) {
  const B_low = 20;  // порог «мало должников»
  const theta = 0.7;
  const kappa_c = 0.5;
  const partA = theta * clamp((B_low - debtSize) / B_low, 0, 1);
  const partB = kappa_c * clamp(targetNewShare - coverage, 0, 1);
  return clamp(partA + partB, 0, 1);
}

// ---- Публичная функция выбора следующей карточки ----
async function sampleNext(now = Date.now()) {
  if (!window.lexidb) throw new Error('cardengine: требуется window.lexidb');

  // 0) быстрый внутри-сессионный повтор, если готов
  const retry = pickupQuickRetry(now);
  if (retry) {
    // гарантируем, что статы существуют и intro установлен
    const st = await getStatsSafe(retry.id);
    if (!st.intro) await introduce(retry.id, now);
    return {termId: retry.id, mode: retry.mode};
  }

  // 1) собираем кандидатов
  const {due, nearly, totalIntro, totalTerms, allIntroStats} =
      await collectCandidates(now);
  const debt = due.length + nearly.length;

  // 2) ввод новых по вероятности
  const cov = (totalTerms === 0) ? 0 : (totalIntro / totalTerms);
  const pNew = newProbability(debt, cov, settings.targetNewShare);
  if (Math.random() < pNew) {
    const newIds = await window.lexidb.newTermIds();
    if (newIds.length) {
      const id = newIds[Math.floor(Math.random() * newIds.length)];
      await introduce(id, now);
      return {termId: id, mode: 'MC5'};
    }
  }

  // 3) пул due → softmax
  let chosen = null;
  if (due.length) {
    chosen = pickBySoftmax(due, now);
  } else if (nearly.length) {
    chosen = pickBySoftmax(nearly, now);
  } else if (allIntroStats.length) {
    // fallback: горячий пул из топ-приоритетов
    // сортируем по pi, берём верхние 30 и сэмплируем
    const ranked = allIntroStats.map(s => ({s, pr: priorityOf(s, now).pi}))
                       .sort((a, b) => b.pr - a.pr)
                       .slice(0, Math.min(30, allIntroStats.length))
                       .map(x => x.s);
    chosen = pickBySoftmax(ranked, now);
  }

  if (!chosen) {
    // вообще пусто (нет ни терминов, ни статов) — пробуем ввести новый, если
    // есть термы
    const newIds = await window.lexidb.newTermIds();
    if (newIds.length) {
      const id = newIds[Math.floor(Math.random() * newIds.length)];
      await introduce(id, now);
      return {termId: id, mode: 'MC5'};
    }
    throw new Error('cardengine: нет данных для показа');
  }

  // Возможное мягкое понижение stage при слабом q
  const stage = chosen.stage || 'MC5';
  const ms = stage === 'MC5' ? chosen.M :
      stage === 'CHUNKS'     ? chosen.C :
                               chosen.P;
  let mode = stage;
  if (ms.q <= Q_DOWN) {
    mode =
        (stage === 'COMPOSE') ? 'CHUNKS' : (stage === 'CHUNKS' ? 'MC5' : 'MC5');
  }

  return {termId: chosen.id, mode};
}

function carryForwardProgress(src, dst, now) {
  // переносим уверенность
  if (typeof src.q === 'number') dst.q = Math.max(dst.q ?? 0.5, src.q);
  // немного переносим интервал (чтобы новый режим не был совсем «нулёвым»)
  if (typeof src.S === 'number') dst.S = Math.max(dst.S ?? 0, src.S * 0.8);
  // небольшая «наследуемая» серия (макс 3), чтобы мягко ускорить закрепление
  dst.streak = Math.min(src.streak || 0, 3);
  // стартовые метки времени под текущую сессию
  dst.last = now;
  dst.due = now;  // хотим показать новый режим сразу
  // счётчик показов нового режима пока не трогаем — он должен расти с нуля
}

// ---- Переходы между режимами (по Settings) ----
function maybePromote(stats) {
  const stg = stats.stage || 'MC5';
  const now = Date.now();

  if (stg === 'MC5') {
    const m = stats.M, c = stats.C;
    const box = currentLeitnerBox(m.S);
    const ready = box >= settings.toCHUNKS.minBox &&
        (m.n || 0) >= settings.toCHUNKS.minShown &&
        (m.q || 0) >= settings.toCHUNKS.minAcc;
    const fast = (m.n || 0) >= 8 && (m.q || 0) >= 0.92;

    if (ready || fast) {
      carryForwardProgress(m, c, now);
      stats.stage = 'CHUNKS';
      return;
    }
  } else if (stg === 'CHUNKS') {
    const c = stats.C, p = stats.P;
    const box = currentLeitnerBox(c.S);
    const ready = box >= settings.toCOMPOSE.minBox &&
        (c.n || 0) >= settings.toCOMPOSE.minShown &&
        (c.q || 0) >= settings.toCOMPOSE.minAcc;
    const fast = (c.n || 0) >= 10 && (c.q || 0) >= 0.90;

    if (ready || fast) {
      carryForwardProgress(c, p, now);
      stats.stage = 'COMPOSE';
      return;
    }
  }
}

function maybeDemoteOnError(stats, mode) {
  // мягкое понижение stage (сохраняем прогресс режимов)
  const stg = stats.stage || 'MC5';
  const state = mode === 'MC5' ? stats.M :
      mode === 'CHUNKS'        ? stats.C :
                                 stats.P;
  if (state.q <= Q_DOWN) {
    if (stg === 'COMPOSE')
      stats.stage = 'CHUNKS';
    else if (stg === 'CHUNKS')
      stats.stage = 'MC5';
    // MC5 уже минимум
  }
}

// ---- Реакция на ответ пользователя ----
async function onReview(termId, mode, result, now = Date.now()) {
  if (!window.lexidb) throw new Error('cardengine: требуется window.lexidb');

  const s = await getStatsSafe(termId);
  const st = (mode === 'MC5' ? s.M : mode === 'CHUNKS' ? s.C : s.P);

  // время от последнего показа
  const dtDays = Math.max(1 / 1440, (now - st.last) / ONE_DAY);
  const p = pHat(dtDays, st.S);

  // адаптация шага на текущий апдейт
  const baseEta = ETA[mode] || 0.3;
  let eta = baseEta;
  if (st.streak >= 2 && result) eta *= (1 + 0.1 * Math.min(st.streak, 5));
  if (st.streak >= 2 && !result) eta *= 0.5;

  // обновление S в лог-пространстве
  const g = result ? (1 - p) : -(p + LAMBDA);
  const S_next = clipExp(Math.log(st.S) + eta * g, S_MIN, Smax());
  const due_next = dueFrom(now, S_next);

  // обновляем состояние
  st.S = S_next;
  st.last = now;
  st.due = due_next;
  st.q = (1 - RHO) * st.q + RHO * (result ? 1 : 0);
  st.streak = result ? (st.streak + 1) : 0;
  st.n = (st.n || 0) + 1;

  // продвижение/понижение stage
  if (result) {
    maybePromote(s);
  } else {
    maybeDemoteOnError(s, mode);
    // быстрый внутрисессионный повтор
    enqueueQuickRetry(termId, mode, now);
  }

  await window.lexidb.putStats(s);
}

// ---- Прогресс/метрики ----
async function getProgress(now = Date.now()) {
  const {due, nearly, totalIntro, totalTerms} = await collectCandidates(now);
  const coverage = (totalTerms === 0) ? 0 : (totalIntro / totalTerms);
  return {
    coverage,
    debt: due.length,
    nearly: nearly.length,
    totalIntro,
    totalTerms
  };
}

// ---- Экспорт API ----
const api = {
  configure,
  sampleNext,
  onReview,
  getProgress,
  getStatsSafe,
  introduce,
  version: '2.0.0-final'
};

if (typeof window !== 'undefined')
  window.cardengine = api;
else if (typeof globalThis !== 'undefined')
  globalThis.cardengine = api;
})();
