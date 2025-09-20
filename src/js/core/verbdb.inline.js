(function() {
'use strict';

const STORE_VERBS = 'verbs';
const STORE_MORPH = 'morph';
const STORE_FRAMES = 'frames';
const STORE_COLLS = 'colls';
const STORE_CONTRASTS = 'contrasts';
const STORE_DISTRACTORS = 'distractors';
const STORE_VSTATS = 'vstats';
const STORE_VATTEMPTS = 'vattempts';

const DEFAULTS = {
  S0: 0.60,
  q0: 0.5,
  streak0: 0,
  tau: 0.9
};

function open() {
  if (!window.lexidb || typeof window.lexidb.open !== 'function') {
    return Promise.reject(new Error('lexidb not initialised'));
  }
  return window.lexidb.open();
}

function withStores(mode, names, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = names.map(n => tx.objectStore(n));
    let done = false;
    function finish(val) {
      if (!done) {
        done = true;
        resolve(val);
      }
    }
    tx.onabort = tx.onerror = () => {
      if (!done) {
        done = true;
        reject(tx.error);
      }
    };
    Promise.resolve(fn.apply(null, stores)).then(finish).catch(err => {
      try {
        tx.abort();
      } catch (_) {
      }
      reject(err);
    });
  }));
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid(prefix) {
  const base = prefix ? String(prefix) : 'id';
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${base}:${crypto.randomUUID()}`;
  }
  const rnd = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${base}:${ts}:${rnd}`;
}

async function getIndexKeys(store, indexName, key) {
  const index = store.index(indexName);
  if ('getAllKeys' in index) {
    return await reqAsPromise(index.getAllKeys(key));
  }
  const out = [];
  await new Promise((resolve, reject) => {
    const req = index.openKeyCursor(key);
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return resolve();
      out.push(cur.primaryKey);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out;
}

async function deleteByKeys(store, keys) {
  for (const key of keys || []) {
    await reqAsPromise(store.delete(key));
  }
}

async function importJSON(text) {
  let data;
  try {
    data = JSON.parse(String(text || ''));
  } catch (e) {
    throw new Error('Некорректный JSON: ' + (e && e.message));
  }
  if (!Array.isArray(data)) {
    throw new Error('JSON импорта должен быть массивом глаголов');
  }
  const summary = {added: 0, updated: 0, frames: 0};

  await withStores(
      'readwrite',
      [STORE_VERBS, STORE_MORPH, STORE_FRAMES, STORE_COLLS, STORE_CONTRASTS,
       STORE_DISTRACTORS, STORE_VSTATS, STORE_VATTEMPTS],
      async (verbs, morph, frames, colls, contrasts, distractors, vstats,
             vattempts) => {
        for (const rawVerb of data) {
          if (!rawVerb || typeof rawVerb.lemma !== 'string') continue;
          const lemma = rawVerb.lemma.trim();
          if (!lemma) continue;
          const verbId = rawVerb.id || lemma;
          const existing = await reqAsPromise(verbs.get(verbId));
          if (existing) summary.updated++; else summary.added++;

          await verbs.put({
            id: verbId,
            lemma,
            aux: rawVerb.aux || 'HABEN',
            tags: rawVerb.tags || [],
            createdAt: existing?.createdAt || Date.now(),
            updatedAt: Date.now()
          });

          const morphId = verbId;
          await morph.put({
            id: morphId,
            verbId,
            ...(rawVerb.morph || {})
          });

          // cleanup existing frames + related records
          const frameKeys = await getIndexKeys(frames, 'verbId', verbId);
          for (const fk of frameKeys) {
            const collKeys = await getIndexKeys(colls, 'frameId', fk);
            await deleteByKeys(colls, collKeys);
            const contrastKeys = await getIndexKeys(contrasts, 'frameId', fk);
            await deleteByKeys(contrasts, contrastKeys);
            const distKeys = await getIndexKeys(distractors, 'frameId', fk);
            await deleteByKeys(distractors, distKeys);
            const attemptKeys = await getIndexKeys(vattempts, 'frameId', fk);
            await deleteByKeys(vattempts, attemptKeys);
            await reqAsPromise(vstats.delete(fk));
            await reqAsPromise(frames.delete(fk));
          }

          const framesList = Array.isArray(rawVerb.frames) ? rawVerb.frames : [];
          for (let idx = 0; idx < framesList.length; idx++) {
            const frame = framesList[idx];
            const frameId = frame.id || `${verbId}#${idx}`;
            const base = {
              id: frameId,
              verbId,
              type: frame.type || 'DAT_VERB',
              cueRu: frame.cueRu || '',
              cueDe: frame.cueDe || '',
              caseCore: frame.caseCore || '',
              prepCase: frame.prepCase || '',
              probeMarker: frame.probeMarker || '',
              probeAnswer: frame.probeAnswer || '',
              examples: Array.isArray(frame.examples) ? frame.examples : [],
              frequency: frame.frequency == null ? 50 : +frame.frequency,
              metadata: frame.metadata || {}
            };
            await reqAsPromise(frames.put(base));
            summary.frames++;

            const collList = Array.isArray(frame.colls) ? frame.colls : [];
            for (let i = 0; i < collList.length; i++) {
              const text = collList[i];
              await reqAsPromise(colls.put({
                id: `${frameId}|coll|${i}`,
                frameId,
                text: String(text || '')
              }));
            }

            const contrastList = Array.isArray(frame.contrasts) ? frame.contrasts : [];
            for (let i = 0; i < contrastList.length; i++) {
              const item = contrastList[i];
              await reqAsPromise(contrasts.put({
                id: `${frameId}|contrast|${i}`,
                frameId,
                note: typeof item === 'string' ? item : String(item?.note || '')
              }));
            }

            const distMap = frame.distractors || {};
            for (const slot of Object.keys(distMap)) {
              const spec = distMap[slot];
              if (!spec) continue;
              await reqAsPromise(distractors.put({
                id: `${frameId}|${slot}`,
                frameId,
                slot,
                strategy: spec.strategy || 'STATIC',
                payload: spec.payload || {}
              }));
            }
          }
        }
      });

  return summary;
}

function asArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

async function getFrame(frameId) {
  if (!frameId) return null;
  return withStores('readonly',
                    [STORE_FRAMES, STORE_VERBS, STORE_MORPH, STORE_COLLS,
                     STORE_CONTRASTS, STORE_DISTRACTORS],
                    async (frames, verbs, morph, colls, contrasts, distractors) => {
                      const frame = await reqAsPromise(frames.get(frameId));
                      if (!frame) return null;
                      const verb = await reqAsPromise(verbs.get(frame.verbId));
                      const morphEntry = await reqAsPromise(morph.get(frame.verbId));

                      async function collect(store, indexName) {
                        const keys = await getIndexKeys(store, indexName, frameId);
                        const values = [];
                        for (const key of keys) {
                          const val = await reqAsPromise(store.get(key));
                          if (val) values.push(val);
                        }
                        return values;
                      }

                      const collocations = await collect(colls, 'frameId');
                      const contrastItems = await collect(contrasts, 'frameId');
                      const distractorItems = await collect(distractors, 'frameId');

                      const distMap = {};
                      distractorItems.forEach((item) => {
                        distMap[item.slot] = {
                          strategy: item.strategy,
                          payload: item.payload
                        };
                      });

                      return {
                        frame,
                        verb,
                        morph: morphEntry || {},
                        colls: collocations.map(c => c.text).filter(Boolean),
                        contrasts: contrastItems.map(c => c.note).filter(Boolean),
                        distractors: distMap
                      };
                    });
}

async function listFrameIds() {
  return withStores('readonly', [STORE_FRAMES], async (frames) => {
    if ('getAllKeys' in frames) return await reqAsPromise(frames.getAllKeys());
    const out = [];
    await new Promise((resolve, reject) => {
      const req = frames.openKeyCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return resolve();
        out.push(cur.primaryKey);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  });
}

async function ensureVStats(frameId) {
  const now = Date.now();
  const existing = await withStores('readonly', [STORE_VSTATS], async (vstats) => {
    return await reqAsPromise(vstats.get(frameId));
  });
  if (existing) return existing;
  const baseS = DEFAULTS.S0;
  const due = now + baseS * Math.log2(1 / DEFAULTS.tau) * 86400000;
  const fresh = {
    id: frameId,
    S: baseS,
    last: now,
    due,
    q: DEFAULTS.q0,
    streak: DEFAULTS.streak0
  };
  await withStores('readwrite', [STORE_VSTATS], async (vstats) => {
    await vstats.put(fresh);
  });
  return fresh;
}

async function getVStats(frameId) {
  if (!frameId) return null;
  return withStores('readonly', [STORE_VSTATS], async (vstats) => {
    return await reqAsPromise(vstats.get(frameId));
  });
}

async function putVStats(stats) {
  if (!stats || !stats.id) return;
  await withStores('readwrite', [STORE_VSTATS], async (vstats) => {
    await vstats.put(stats);
  });
}

async function listDue(limit = 10) {
  const now = Date.now();
  return withStores('readonly', [STORE_VSTATS], async (vstats) => {
    const out = [];
    const byDue = vstats.index('dueAt');
    await new Promise((resolve, reject) => {
      const req = byDue.openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return resolve();
        const value = cur.value;
        out.push(value);
        if (out.length >= limit) return resolve();
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    const overdue = out.filter(s => (s.due || 0) <= now);
    const upcoming = out.filter(s => (s.due || 0) > now);
    overdue.sort((a, b) => (a.due || 0) - (b.due || 0));
    upcoming.sort((a, b) => (a.due || 0) - (b.due || 0));
    return overdue.concat(upcoming).slice(0, limit);
  });
}

async function recordAttempt(entry) {
  if (!entry || !entry.frameId) return;
  const payload = {
    id: entry.id || uid('vattempt'),
    frameId: entry.frameId,
    slot: entry.slot || 'LEMMA',
    correct: !!entry.correct,
    answer: entry.answer || '',
    createdAt: entry.createdAt || Date.now()
  };
  await withStores('readwrite', [STORE_VATTEMPTS], async (vattempts) => {
    await vattempts.put(payload);
  });
  return payload;
}

async function recentAttempts(frameId, slot, limit = 5) {
  if (!frameId) return [];
  return withStores('readonly', [STORE_VATTEMPTS], async (vattempts) => {
    const index = vattempts.index('frameId');
    const list = [];
    await new Promise((resolve, reject) => {
      const query = (typeof IDBKeyRange !== 'undefined' &&
                     typeof IDBKeyRange.only === 'function')
          ? IDBKeyRange.only(frameId)
          : frameId;
      const req = index.openCursor(query, 'prev');
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return resolve();
        const value = cur.value;
        if (!slot || value.slot === slot) list.push(value);
        if (list.length >= limit) return resolve();
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return list;
  });
}

async function exportJSON() {
  const ids = await listFrameIds();
  const result = [];
  for (const frameId of ids) {
    const bundle = await getFrame(frameId);
    if (!bundle || !bundle.verb) continue;
    let verbEntry = result.find(v => v.lemma === bundle.verb.lemma);
    if (!verbEntry) {
      verbEntry = {
        lemma: bundle.verb.lemma,
        aux: bundle.verb.aux,
        morph: {...bundle.morph},
        frames: []
      };
      result.push(verbEntry);
    }
    const f = bundle.frame;
    verbEntry.frames.push({
      type: f.type,
      cueRu: f.cueRu,
      cueDe: f.cueDe,
      caseCore: f.caseCore,
      prepCase: f.prepCase,
      probeMarker: f.probeMarker,
      probeAnswer: f.probeAnswer,
      examples: asArray(f.examples),
      frequency: f.frequency,
      colls: bundle.colls.slice(),
      contrasts: bundle.contrasts.map(note => ({note})),
      distractors: bundle.distractors
    });
  }
  return result;
}

window.verbdb = {
  open,
  importJSON,
  exportJSON,
  listFrameIds,
  getFrame,
  ensureVStats,
  getVStats,
  putVStats,
  listDue,
  recordAttempt,
  recentAttempts,
  defaults: DEFAULTS
};
})();
