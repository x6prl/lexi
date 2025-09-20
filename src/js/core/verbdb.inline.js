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
  const summary = String(raw.summary || raw.short || prompt).trim();
  const id = raw.id || raw.key || `${cardId || 'card'}-${qIndex}`;
  return {
    id: String(id),
    prompt,
    answer,
    options: deduped,
    summary: summary || prompt
  };
}

function questionsFromFrame(raw, frame) {
  const out = [];
  if (!frame || typeof frame !== 'object') return out;
  const marker = String(frame.probeMarker || '').trim();
  const answerCase = String(frame.probeAnswer || '').trim();
  if (marker && answerCase) {
    let opts = [];
    const payload = frame.distractors && frame.distractors.CASE_ENDING &&
        frame.distractors.CASE_ENDING.payload;
    if (payload) {
      if (Array.isArray(payload.endings)) opts = opts.concat(payload.endings);
      if (Array.isArray(payload.wrongCases))
        opts = opts.concat(payload.wrongCases);
    }
    out.push({prompt: marker, answer: answerCase, options: opts, summary: 'Падеж'});
  }
  const praet = raw && raw.morph && raw.morph.praet3sg;
  if (praet) {
    let opts = [];
    const payload = frame.distractors && frame.distractors.PRAET &&
        frame.distractors.PRAET.payload;
    if (payload && Array.isArray(payload.wrongPraet))
      opts = opts.concat(payload.wrongPraet);
    out.push({
      prompt: 'Präteritum (er/sie/es)',
      answer: String(praet),
      options: opts,
      summary: 'Präteritum'
    });
  }
  const part2 = raw && raw.morph && raw.morph.part2;
  if (part2) {
    let opts = [];
    const payload = frame.distractors && frame.distractors.PART2_AUX &&
        frame.distractors.PART2_AUX.payload;
    if (payload && Array.isArray(payload.wrongPart2))
      opts = opts.concat(payload.wrongPart2);
    out.push({
      prompt: 'Partizip II',
      answer: String(part2),
      options: opts,
      summary: 'Partizip II'
    });
  }
  return out;
}

function normaliseCard(raw, idx) {
  if (!raw) return null;
  const lemma = String(raw.lemma || raw.verb || '').trim();
  const cue = String(raw.cue || raw.cueDe || lemma).trim();
  const translation = String(raw.translation || raw.cueRu || '').trim();
  const id = String(raw.id || lemma || `card-${idx}`).trim();
  let questionsRaw = Array.isArray(raw.questions)
      ? raw.questions.slice()
      : Array.isArray(raw.slots) ? raw.slots.slice() : [];
  if ((!questionsRaw || questionsRaw.length === 0) && Array.isArray(raw.frames)) {
    raw.frames.forEach((frame) => {
      questionsRaw = questionsRaw.concat(questionsFromFrame(raw, frame));
    });
  }
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
