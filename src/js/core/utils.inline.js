/* utils.inline.js — общие утилиты для всех экранов (DOM, стили, хранилище,
   файлы, логгер, тосты) Экспортирует глобально window.util:
     - ensureBaseStyles()             — базовые UI-стили (кнопки/ряды/тосты),
   инжектируются один раз
     - injectStyle(id, css)           — одноразовый инжектор произвольного CSS
   по id
     - el(tag, className?, text?)     — быстрый создатель элементов
     - clear(el)                      — очистка детей
     - on(el, type, handler, opts?)   — навесить listener, вернуть функцию
   отписки
     - debounce(fn, ms)               — дебаунс
     - clamp(x,min,max)               — ограничение
     - fmt: { dateStamp(), pct(x), fmtPct(x), fmtAcc(x) }
     - local: { get, set, getJSON, setJSON, remove }
     - file:  { pickTextFile(), downloadText(filename, text) }
     - makeToaster(parent)            — { el, show(msg, isErr=false, ms=3000) }
     - log(ns)                        — namespaced-логгер
*/
(function() {
'use strict';

// ---------- style: base UI (one-time) ----------
let _baseInjected = false;
function ensureBaseStyles() {
  if (_baseInjected) return;
  _baseInjected = true;
  const css = `
.ui-wrap{ max-width: 880px; margin: 0 auto; padding: 16px 16px 28px; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
.ui-row{ display:flex; flex-wrap:wrap; gap: 14px; margin-top: 14px; }
.btn{
  appearance:none; border:0; cursor:pointer; user-select:none;
  padding: 12px 18px; border-radius: 12px; font-weight: 800; letter-spacing:.2px;
  background:#f2f4f8; color:#0a1428; box-shadow: 0 2px 0 rgba(10,20,40,.05) inset;
  transition: filter .15s ease, transform .02s ease;
}
.btn:active{ transform: translateY(1px); }
.btn.primary{ background:#22c55e; color:white; }
.btn.ghost{ background:transparent; outline: 1px solid rgba(10,20,40,.12); }
.note{ font-size:13px; opacity:.75; margin-top:6px; }
.hidden{ display:none !important; }

.toast{
  margin-top:10px; padding:10px 12px; border-radius:10px; font-weight:700; display:none;
  background:#e8f8ef; color:#0a1428;
}
.toast.err{ background:#fde8e8; color:#7f1d1d; }

@media (prefers-color-scheme: dark){
  .btn{ background:#1b2130; color:#e5e7eb; box-shadow: 0 2px 0 rgba(0,0,0,.25) inset; }
  .btn.ghost{ outline:1px solid rgba(255,255,255,.12); }
  .toast{ background:#052e1c; color:#d1fae5; }
  .toast.err{ background:#33151b; color:#fecaca; }
}
`;
  const st = document.createElement('style');
  st.id = 'util-base-ui';
  st.textContent = css;
  document.head.appendChild(st);
}

// ---------- generic style injector ----------
function injectStyle(id, css) {
  if (!id) throw new Error('injectStyle: id is required');
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = css;
  document.head.appendChild(st);
}

// ---------- dom helpers ----------
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}
function on(node, type, handler, opts) {
  node.addEventListener(type, handler, opts);
  return () => node.removeEventListener(type, handler, opts);
}

// ---------- common small utils ----------
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
function debounce(fn, ms) {
  let t = null;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ---------- formatting ----------
const fmt = {
  dateStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${
        p(d.getHours())}-${p(d.getMinutes())}`;
  },
  pct(x) {
    x = +x || 0;
    if (x < 0) x = 0;
    if (x > 1) x = 1;
    return Math.round(x * 100);
  },
  fmtPct(x) {
    return `${fmt.pct(x)}%`;
  },
  fmtAcc(x) {
    x = +x || 0;
    if (x < 0) x = 0;
    if (x > 1) x = 1;
    return (Math.round(x * 100) / 100).toFixed(2);
  }
};

// ---------- localStorage wrappers ----------
const local = {
  get(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? def : v;
    } catch (_) {
      return def;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, String(val));
    } catch (_) {
    }
  },
  getJSON(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? def : JSON.parse(v);
    } catch (_) {
      return def;
    }
  },
  setJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {
    }
  }
};

// ---------- file helpers ----------
const file = {
  async pickTextFile() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'text/plain,.txt';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return resolve(null);
        const txt = await f.text();
        resolve({name: f.name, text: txt});
      };
      inp.click();
    });
  },
  downloadText(filename, text) {
    const blob = new Blob([text], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `download_${fmt.dateStamp()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }
};

// ---------- toaster ----------
function makeToaster(parent) {
  const elToast = el('div', 'toast');
  parent.appendChild(elToast);
  function show(msg, isErr = false, ms = 3000) {
    elToast.textContent = String(msg == null ? '' : msg);
    elToast.classList.toggle('err', !!isErr);
    elToast.style.display = 'block';
    clearTimeout(show._t);
    show._t = setTimeout(() => {
      elToast.style.display = 'none';
    }, Math.max(0, ms | 0));
  }
  return {el: elToast, show};
}

// ---------- logger ----------
function log(ns) {
  const p = ns ? `[${ns}]` : '';
  return (...a) => console.log(p, ...a);
}

// ---------- export ----------
const api = {
  ensureBaseStyles,
  injectStyle,
  el,
  clear,
  on,
  debounce,
  clamp,
  fmt,
  local,
  file,
  makeToaster,
  log
};
if (typeof window !== 'undefined')
  window.util = api;
else if (typeof globalThis !== 'undefined')
  globalThis.util = api;
})();
