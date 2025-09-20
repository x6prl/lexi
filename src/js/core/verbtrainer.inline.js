(function() {
'use strict';

const SLOT_SEQUENCE = [
  'LEMMA',
  'CASE_ENDING',
  'PRAET',
  'PART2_AUX',
  'COLLOCATION'
];
const FALLBACK_SLOT = 'LEMMA';

const TAU = 0.9;
const RHO = 0.2;
const S_MIN = 0.25;
const D_MAX = 60; // days
const ETA_VERB = 0.36;
const LAMBDA = 0.2;

function ensureDeps() {
  if (!window.verbdb) throw new Error('verbdb not initialised');
  if (!window.verbrng) throw new Error('verbrng not available');
}

function availableSlots(bundle) {
  const data = new Set();
  if (!bundle) return data;
  const morph = bundle.morph || {};
  const frame = bundle.frame || {};
  if (bundle.verb?.lemma) data.add('LEMMA');
  if (frame.probeAnswer || frame.caseCore || frame.prepCase)
    data.add('CASE_ENDING');
  if (morph.praet3sg) data.add('PRAET');
  if (morph.part2 || bundle.verb?.aux) data.add('PART2_AUX');
  if ((bundle.colls || []).length) data.add('COLLOCATION');
  if (frame.syntax) data.add('SYNTAX');
  if (frame.audio) data.add('AUDIO');
  if (frame.metadata?.slot5 === 'SYNTAX') data.add('SYNTAX');
  if (frame.metadata?.slot5 === 'AUDIO') data.add('AUDIO');
  if (frame.metadata?.slot5 === 'COLLOCATION') data.add('COLLOCATION');
  return data;
}

function pickSlot(bundle, step) {
  const avail = availableSlots(bundle);
  const seq = SLOT_SEQUENCE.slice();
  const picked = [];
  for (const slot of seq) {
    if (avail.has(slot)) picked.push(slot);
  }
  if (avail.has('SYNTAX') && !picked.includes('SYNTAX')) picked.push('SYNTAX');
  if (avail.has('AUDIO') && !picked.includes('AUDIO')) picked.push('AUDIO');
  if (picked.length === 0) picked.push(FALLBACK_SLOT);
  const idx = picked.length ? (step % picked.length) : 0;
  return picked[idx] || FALLBACK_SLOT;
}

function dedupe(arr, correct) {
  const seen = new Set();
  const out = [];
  const canonical = (x) => String(x || '').trim();
  const corr = canonical(correct);
  for (const item of arr || []) {
    const norm = canonical(item);
    if (!norm) continue;
    if (norm === corr) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(item);
  }
  return out;
}

function balanceAcrossFeatures(pool, count, rng) {
  if (!Array.isArray(pool) || !pool.length) return [];
  const list = pool.slice(0, 32);
  const shuffled = window.verbrng.shuffleSeeded(list, rng);
  return shuffled.slice(0, count);
}

function tagsForSlot(bundle, slot) {
  const tags = [slot];
  if (bundle?.frame?.type) tags.push(bundle.frame.type);
  if (bundle?.verb?.lemma) tags.push(bundle.verb.lemma);
  return tags;
}

function microHint(bundle, slot, correct) {
  const frame = bundle?.frame || {};
  const morph = bundle?.morph || {};
  switch (slot) {
    case 'CASE_ENDING':
      return frame.caseCore || frame.prepCase || 'Падеж?';
    case 'PRAET':
      return `Präteritum → ${morph.stem ? morph.stem + '-' : ''}`;
    case 'PART2_AUX':
      return `${bundle?.verb?.aux || 'haben'} + Partizip II`;
    case 'COLLOCATION':
      return 'Подумайте о типичном словосочетании';
    case 'SYNTAX':
      return 'V2 / позиция сказуемого';
    case 'AUDIO':
      return 'Воспроизведите услышанное';
    default:
      return correct;
  }
}

function correctForSlot(bundle, slot) {
  const frame = bundle?.frame || {};
  const morph = bundle?.morph || {};
  const verb = bundle?.verb || {};
  switch (slot) {
    case 'LEMMA':
      return verb.lemma || '';
    case 'CASE_ENDING':
      return frame.probeAnswer || frame.caseCore || frame.prepCase || verb.lemma || '';
    case 'PRAET':
      return morph.praet3sg || '';
    case 'PART2_AUX': {
      const aux = verb.aux || 'haben';
      const part = morph.part2 || '';
      return `${aux.toLowerCase()} ${part}`.trim();
    }
    case 'COLLOCATION':
      return (bundle.colls && bundle.colls[0]) || frame.cueDe || verb.lemma || '';
    case 'SYNTAX':
      return frame.syntax || frame.cueDe || '';
    case 'AUDIO':
      return frame.audio || (frame.examples && frame.examples[0]) || verb.lemma || '';
    default:
      return verb.lemma || '';
  }
}

async function fromUserMistakes(bundle, slot, rng) {
  try {
    const attempts = await window.verbdb.recentAttempts(bundle.frame.id, slot, 12);
    const wrong = attempts.filter(a => !a.correct).map(a => a.answer).filter(Boolean);
    return window.verbrng.shuffleSeeded(wrong, rng);
  } catch (e) {
    console.warn('[verbtrainer] fromUserMistakes', e);
    return [];
  }
}

function fromContrastNotes(bundle, slot) {
  if (slot !== 'LEMMA' && slot !== 'CASE_ENDING' && slot !== 'COLLOCATION') return [];
  return (bundle.contrasts || []).map((note) => {
    if (!note) return '';
    const parts = String(note).split(/≠|=/);
    return parts.length ? parts[parts.length - 1].trim() : note;
  }).filter(Boolean);
}

function fromTemplates(bundle, slot) {
  const spec = bundle?.distractors?.[slot];
  if (!spec) return [];
  const out = [];
  const payload = spec.payload || {};
  switch (spec.strategy) {
    case 'STATIC':
      if (Array.isArray(payload.options)) out.push(...payload.options);
      if (Array.isArray(payload.values)) out.push(...payload.values);
      if (Array.isArray(payload.wrongPart2)) out.push(...payload.wrongPart2);
      if (payload.wrongAux) out.push(payload.wrongAux);
      break;
    case 'PATTERN':
      if (Array.isArray(payload.endings)) out.push(...payload.endings);
      if (Array.isArray(payload.wrongCases)) out.push(...payload.wrongCases);
      break;
    case 'MORPH_NOISE':
      if (Array.isArray(payload.wrongPart2)) out.push(...payload.wrongPart2);
      if (Array.isArray(payload.morphNoise)) out.push(...payload.morphNoise);
      if (payload.wrongAux) out.push(payload.wrongAux);
      break;
    case 'LEXICAL_NEIGHBOR':
      if (Array.isArray(payload.neighbors)) out.push(...payload.neighbors);
      break;
    default:
      if (Array.isArray(payload.options)) out.push(...payload.options);
  }
  return out;
}

function morphNoise(bundle, slot) {
  const out = [];
  const morph = bundle?.morph || {};
  if (slot === 'PRAET' && morph.praet3sg) {
    if (morph.praet3sg.endsWith('f')) out.push(morph.praet3sg + 'te');
    if (morph.stem) out.push(morph.stem + 'te');
  }
  if (slot === 'PART2_AUX' && morph.part2) {
    out.push(`sein ${morph.part2}`);
    out.push(`haben ${morph.part2.replace(/^ge/, 'ge') + 'en'}`);
  }
  return out;
}

async function genSlot(bundle, slot, sessionSeed, attemptNum) {
  const frame = bundle.frame;
  const seed = window.verbrng.hashSeed(sessionSeed, frame.id, slot, String(attemptNum));
  const rng = window.verbrng.mulberry32(seed);
  const correct = correctForSlot(bundle, slot);
  let pool = [];

  try {
    pool = pool.concat(await fromUserMistakes(bundle, slot, rng));
  } catch (_) {
  }
  pool = pool.concat(fromTemplates(bundle, slot));
  pool = pool.concat(fromContrastNotes(bundle, slot));
  pool = pool.concat(morphNoise(bundle, slot));

  pool = dedupe(pool, correct);
  const distractors = balanceAcrossFeatures(pool, 3, rng);
  const options = window.verbrng.shuffleSeeded([correct, ...distractors], rng);
  const hint = microHint(bundle, slot, correct);
  const features = tagsForSlot(bundle, slot);

  return {options, correct, hint, features, slot};
}

async function recordAttempt(bundle, slot, res, gen) {
  try {
    await window.verbdb.recordAttempt({
      frameId: bundle.frame.id,
      slot,
      correct: !!res.correct,
      answer: res.choice
    });
  } catch (e) {
    console.warn('[verbtrainer] recordAttempt', e);
  }
}

async function updateSRS(frameId, score0to5) {
  const stats = await window.verbdb.ensureVStats(frameId);
  const now = Date.now();
  const dtDays = Math.max(0, (now - (stats.last || now)) / 86400000);
  const pHat = Math.pow(2, -dtDays / (stats.S || window.verbdb.defaults.S0));
  const r = score0to5 >= 4 ? 1 : score0to5 >= 3 ? 0.5 : 0;
  const g = r === 1 ? (1 - pHat) : -(pHat + LAMBDA);
  const lnS = Math.log(Math.max(stats.S || window.verbdb.defaults.S0, 1e-3)) + ETA_VERB * g;
  const maxS = D_MAX / Math.log2(1 / TAU);
  let S = Math.exp(lnS);
  if (!isFinite(S) || S <= 0) S = window.verbdb.defaults.S0;
  S = Math.max(S_MIN, Math.min(S, maxS));
  const q = (1 - RHO) * (stats.q || window.verbdb.defaults.q0) + RHO * (r ? 1 : 0);
  const streak = r ? (stats.streak || 0) + 1 : 0;
  const due = now + S * Math.log2(1 / TAU) * 86400000;
  const next = {...stats, S, last: now, due, q, streak};
  await window.verbdb.putVStats(next);
  return next;
}

async function ensureStatsForAll() {
  const ids = await window.verbdb.listFrameIds();
  for (const id of ids) {
    await window.verbdb.ensureVStats(id);
  }
}

async function pickNextFrames(limit = 5) {
  ensureDeps();
  await ensureStatsForAll();
  const dueStats = await window.verbdb.listDue(limit * 3);
  const out = [];
  const used = new Set();
  for (const stat of dueStats) {
    if (stat && stat.id && !used.has(stat.id)) {
      const bundle = await window.verbdb.getFrame(stat.id);
      if (bundle && bundle.frame && bundle.verb) {
        out.push(bundle);
        used.add(stat.id);
        if (out.length >= limit) return out;
      }
    }
  }
  if (out.length < limit) {
    const ids = await window.verbdb.listFrameIds();
    for (const id of ids) {
      if (used.has(id)) continue;
      const bundle = await window.verbdb.getFrame(id);
      if (bundle && bundle.frame && bundle.verb) {
        out.push(bundle);
        used.add(id);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

async function runCard(bundle, ui, sessionSeed) {
  ensureDeps();
  if (!bundle || !bundle.frame) throw new Error('frame bundle required');
  const seed = sessionSeed || `${bundle.frame.id}:${Date.now()}`;
  let score = 0;
  for (let i = 0; i < 5; i++) {
    const slot = pickSlot(bundle, i);
    const gen = await genSlot(bundle, slot, seed, i);
    const res = await ui.ask(gen, {slot, bundle, step: i});
    await recordAttempt(bundle, slot, res, gen);
    if (res.correct) {
      score++;
      continue;
    }
    if (gen.hint) await ui.hint(gen.hint, {slot, bundle});
    const retry = await ui.ask(gen, {slot, bundle, step: i, retry: true});
    await recordAttempt(bundle, slot, retry, gen);
  }
  const productionOk = await ui.microProduction(bundle);
  await updateSRS(bundle.frame.id, score);
  return {score, productionOk};
}

window.verbtrainer = {
  pickSlot,
  genSlot,
  runCard,
  pickNextFrames,
  ensureStatsForAll,
  updateSRS
};
})();
