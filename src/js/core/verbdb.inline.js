(function() {
'use strict';

const STORAGE_KEY = 'lexi.verbs.cards.v1';
const PROGRESS_KEY = 'lexi.verbs.progress.v1';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[verbdb] failed to parse', key, e);
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[verbdb] failed to store', key, e);
  }
}

function normaliseOption(value) {
  const text = String(value || '').trim();
  return text;
}

function normaliseQuestion(raw, cardId, qIndex) {
  if (!raw) return null;
  const prompt = String(raw.prompt || raw.label || '').trim();
  const answer = String(raw.answer || raw.correct || '').trim();
  const options = Array.isArray(raw.options) ? raw.options : raw.choices;
  const list = Array.isArray(options) ? options.map(normaliseOption).filter(Boolean) : [];
  if (!prompt || !answer) return null;
  if (!list.includes(answer)) list.unshift(answer);
  const deduped = [];
  for (const opt of list) {
    if (!opt) continue;
    if (!deduped.includes(opt)) deduped.push(opt);
    if (deduped.length >= 5) break;
  }
  if (deduped.length < 2) return null;
  return {
    prompt,
    answer,
    options: deduped
  };
}

function normaliseCard(raw, idx) {
  if (!raw) return null;
  const lemma = String(raw.lemma || raw.verb || '').trim();
  const cue = String(raw.cue || raw.cueDe || lemma).trim();
  const translation = String(raw.translation || raw.cueRu || '').trim();
  const id = String(raw.id || lemma || `card-${idx}`).trim();
  const questionsRaw = Array.isArray(raw.questions)
      ? raw.questions
      : Array.isArray(raw.slots) ? raw.slots : [];
  const questions = [];
  questionsRaw.forEach((q, qIndex) => {
    const norm = normaliseQuestion(q, id, qIndex);
    if (norm) questions.push(norm);
  });
  if (!id || !cue || questions.length === 0) return null;
  return {
    id,
    lemma,
    cue,
    translation,
    questions
  };
}

function listCards() {
  const cards = loadJSON(STORAGE_KEY, []);
  if (!Array.isArray(cards)) return [];
  return cards.map(card => ({...card, questions: (card.questions || []).map(q => ({...q, options: (q.options || []).slice()}))}));
}

function getCard(id) {
  return listCards().find(card => card.id === id) || null;
}

function loadProgress() {
  const raw = loadJSON(PROGRESS_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

function getProgress(id) {
  const store = loadProgress();
  const entry = store[id] || {seen: 0, correct: 0};
  return {...entry};
}

function recordResult(id, correct) {
  if (!id) return;
  const store = loadProgress();
  const entry = store[id] || {seen: 0, correct: 0};
  entry.seen += 1;
  if (correct) entry.correct += 1;
  store[id] = entry;
  saveJSON(PROGRESS_KEY, store);
}

function clearAll() {
  saveJSON(STORAGE_KEY, []);
  saveJSON(PROGRESS_KEY, {});
}

function importJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (e) {
    throw new Error('Не удалось прочитать JSON: ' + (e && e.message ? e.message : e));
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Ожидался массив карточек глаголов');
  }
  const cards = [];
  parsed.forEach((raw, idx) => {
    const card = normaliseCard(raw, idx);
    if (card) cards.push(card);
  });
  if (!cards.length) {
    throw new Error('Не найдено ни одной валидной карточки глаголов');
  }
  saveJSON(STORAGE_KEY, cards);
  saveJSON(PROGRESS_KEY, {});
  return {cards: cards.length};
}

function exportJSON() {
  const cards = listCards();
  return JSON.stringify(cards, null, 2);
}

window.verbdb = {
  importJSON,
  exportJSON,
  listCards,
  getCard,
  getProgress,
  recordResult,
  clearAll
};
})();
