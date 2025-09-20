(function() {
'use strict';

function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const text = String(part ?? '');
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
      h >>>= 0;
    }
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffleSeeded(arr, rng) {
  const out = Array.isArray(arr) ? arr.slice() : [];
  if (typeof rng !== 'function') rng = Math.random;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

window.verbrng = {hashSeed, mulberry32, shuffleSeeded};
})();
