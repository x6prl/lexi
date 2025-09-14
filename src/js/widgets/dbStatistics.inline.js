(function() {
'use strict';

// --------- tiny utils ----------
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const pct = x => Math.round(clamp01(x) * 100);
const fmtPct = x => `${pct(x)}%`;
const fmtAcc = x => (Math.round(clamp01(x) * 100) / 100).toFixed(2);  // 0.78

// one-time style injector
let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
:root{
  --card-bg: #ffffff;
  --card-elev: 0 10px 30px rgba(28,31,38,0.06);
  --text: #0f172a;
  --muted: #667085;
  --line: #e6e8f0;
  --ok: #22c55e;
  --ok-weak: #e8f8ef;
  --warn: #ef4444;
  --warn-weak: #fde8e8;
  --cov: #5b8cff;        /* coverage blue */
  --cov-weak:#e9efff;
  --track:#e9ecf2;
  --chip:#f3f4f6;
}
@media (prefers-color-scheme: dark){
  :root{
    --card-bg:#0f1117;
    --card-elev: 0 10px 30px rgba(0,0,0,0.35);
    --text:#e5e7eb;
    --muted:#98a2b3;
    --line:#1f2430;
    --track:#1f2430;
    --chip:#1a1f2e;
    --ok:#34d399;
    --ok-weak:#052e1c;
    --warn:#fb7185;
    --warn-weak:#33151b;
    --cov:#7aa2ff;
    --cov-weak:#0f1a3a;
  }
}
.dbstat[data-theme="light"]{
  --card-bg:#ffffff; --text:#0f172a; --muted:#667085; --line:#e6e8f0; --track:#e9ecf2; --chip:#f3f4f6;
  --ok:#22c55e; --ok-weak:#e8f8ef; --warn:#ef4444; --warn-weak:#fde8e8; --cov:#5b8cff; --cov-weak:#e9efff;
}
.dbstat[data-theme="dark"]{
  --card-bg:#0f1117; --text:#e5e7eb; --muted:#98a2b3; --line:#1f2430; --track:#1f2430; --chip:#1a1f2e;
  --ok:#34d399; --ok-weak:#052e1c; --warn:#fb7185; --warn-weak:#33151b; --cov:#7aa2ff; --cov-weak:#0f1a3a;
}

.dbstat{font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji","Segoe UI Emoji"; color:var(--text);}
.dbstat *{box-sizing:border-box}

.dbstat.card{
  background:var(--card-bg);
  border-radius:20px;
  box-shadow:var(--card-elev);
  padding:18px 18px 22px;
}
.dbstat .hdr{
  font-weight:800; font-size:22px; letter-spacing:.2px; margin:2px 0 16px 4px;
}
.dbstat .grid3{display:grid; grid-template-columns: 1fr 1fr 1fr; gap:0;}
.dbstat .cell{display:flex; flex-direction:column; align-items:center; padding:8px 0;}
.dbstat .cell + .cell{border-left:1px solid var(--line);}
.dbstat .label{font-size:14px; color:var(--muted); margin-bottom:6px;}
.dbstat .value{font-weight:900; font-size:36px; line-height:1;}
.dbstat .value.small{font-size:30px}
.dbstat .value .sub{font-weight:800; font-size:18px; color:var(--muted); margin-left:6px}
.dbstat .value.warn{color:var(--warn)}

.dbstat.compact{
  padding:10px 8px;
}
.dbstat .row{
  display:flex; align-items:center; gap:24px;
}
.dbstat .col{flex:1; min-width:180px}
.dbstat .sep{width:1px; height:30px; background:var(--line); opacity:.8}
.dbstat .bar{
  height:10px; width:100%; background:var(--track); border-radius:999px; position:relative; overflow:hidden;
}
.dbstat .bar > .fill{
  position:absolute; left:0; top:0; height:100%; width:0%; border-radius:999px; transition: width .6s ease;
}
.dbstat .pill{
  display:inline-flex; align-items:center; gap:8px;
  background:var(--chip); padding:8px 12px; border-radius:999px; font-weight:700;
}
.dbstat .k{font-weight:800; font-size:16px; margin-bottom:6px;}
.dbstat .acc .fill{ background: var(--ok); }
.dbstat .cov .fill{ background: var(--cov); }
.dbstat .debt{ color: var(--warn); }
.dbstat .muted{color:var(--muted)}
    `;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
}

// ------- DOM builders ----------
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function buildCardRoot(theme) {
  injectStyle();
  const root = el('section', 'dbstat card');
  if (theme && theme !== 'auto') root.setAttribute('data-theme', theme);
  root.setAttribute('role', 'group');
  return root;
}

function buildCompactRoot(theme) {
  injectStyle();
  const root = el('section', 'dbstat compact');
  if (theme && theme !== 'auto') root.setAttribute('data-theme', theme);
  root.setAttribute('role', 'group');
  return root;
}

// --- renderers ---
function renderCard(root, s) {
  root.innerHTML = '';
  root.appendChild(el('div', 'hdr', 'Статистика по базе'));

  const grid = el('div', 'grid3');
  // Точность
  const c1 = el('div', 'cell');
  c1.appendChild(el('div', 'label', 'Точность'));
  const v1 = el('div', 'value');
  v1.textContent = fmtPct(s.avgAcc);
  c1.appendChild(v1);

  // Введено
  const c2 = el('div', 'cell');
  c2.appendChild(el('div', 'label', 'Введено'));
  const v2 = el('div', 'value');
  v2.innerHTML = `${s.entered}<span class="sub">/${s.total}</span>`;
  c2.appendChild(v2);

  // Долг
  const c3 = el('div', 'cell');
  c3.appendChild(el('div', 'label', 'Долг'));
  const v3 = el('div', 'value warn');
  v3.textContent = String(s.debt);
  c3.appendChild(v3);

  grid.appendChild(c1);
  grid.appendChild(c2);
  grid.appendChild(c3);
  root.appendChild(grid);
  return root;
}

function renderCompact(root, s) {
  root.innerHTML = '';
  const row = el('div', 'row');

  const col1 = el('div', 'col cov');
  const k1 = el('div', 'k');
  k1.innerHTML = `coverage <span class="muted">${fmtPct(s.coverage)}</span>`;
  const bar1 = el('div', 'bar');
  const fill1 = el('div', 'fill');
  fill1.style.width = `${pct(s.coverage)}%`;
  bar1.appendChild(fill1);
  col1.append(k1, bar1);

  const sep = el('div', 'sep');

  const col2 = el('div', 'col acc');
  const k2 = el('div', 'k');
  k2.innerHTML =
      `средняя точность <span class="muted">${fmtAcc(s.avgAcc)}</span>`;
  const bar2 = el('div', 'bar');
  const fill2 = el('div', 'fill');
  fill2.style.width = `${pct(s.avgAcc)}%`;
  bar2.appendChild(fill2);
  col2.append(k2, bar2);

  const debt = el('div', 'pill debt');
  debt.innerHTML = `<span class="muted">долг</span> <strong>${s.debt}</strong>`;

  row.append(col1, sep, col2, debt);
  root.appendChild(row);
  return root;
}

// ------- aggregator from TermStatsV2 ------
/**
 * Принимает массив TermStatsV2:
 * {
 *   id:string, stage:'MC5'|'CHUNKS'|'COMPOSE', intro:boolean,
 *   M:{q:number, due:number}, C:{q:number, due:number}, P:{q:number,
 * due:number}
 * }
 * Возвращает DbStats.
 * Логика:
 *  - coverage = entered / total;
 *  - avgAcc   = средний q по intro==true, берём q ведущего режима
 * (term[term.stage].q);
 *  - debt     = intro && (term[term.stage].due <= now) → считаем 1;
 */
function fromTermStats(list) {
  const total = list?.length || 0;
  const entered = list?.reduce((a, t) => a + (t?.intro ? 1 : 0), 0) || 0;

  let accSum = 0, accN = 0, debt = 0;
  const now = Date.now();
  if (list && list.length) {
    for (const t of list) {
      if (!t || !t.intro) continue;
      const st = (t.stage || 'MC5')[0];  // 'M'|'C'|'P'
      const mode = st === 'M' ? t.M : st === 'C' ? t.C : t.P;
      const q = (mode && typeof mode.q === 'number') ? mode.q : 0;
      accSum += q;
      accN++;
      const due = mode && typeof mode.due === 'number' ? mode.due : 0;
      if (due > 0 && due <= now) debt++;
    }
  }
  const avgAcc = accN ? (accSum / accN) : 0;
  const coverage = total ? (entered / total) : 0;
  return {coverage, avgAcc, debt, entered, total};
}

// ------- state & API -------
let _root = null;
let _variant = 'card';

function normalizeStats(s) {
  return {
    coverage: clamp01(Number(s?.coverage ?? 0)),
    avgAcc: clamp01(Number(s?.avgAcc ?? 0)),
    debt: Math.max(0, Math.trunc(Number(s?.debt ?? 0))),
    entered: Math.max(0, Math.trunc(Number(s?.entered ?? 0))),
    total: Math.max(0, Math.trunc(Number(s?.total ?? 0))),
  };
}

function mount(container, opts = {}) {
  const {variant = 'card', theme = 'auto', initial = null} = opts || {};
  _variant = variant;

  if (variant === 'compact') {
    _root = buildCompactRoot(theme);
    container.innerHTML = '';
    container.appendChild(_root);
    update(initial || {coverage: 0, avgAcc: 0, debt: 0, entered: 0, total: 0});
  } else {
    _root = buildCardRoot(theme);
    container.innerHTML = '';
    container.appendChild(_root);
    update(initial || {coverage: 0, avgAcc: 0, debt: 0, entered: 0, total: 0});
  }
  return _root;
}

function update(stats) {
  if (!_root) return;
  const s = normalizeStats(stats || {});
  if (_variant === 'compact')
    renderCompact(_root, s);
  else
    renderCard(_root, s);
}

// expose
window.dbStatistics = {
  mount,
  update,
  fromTermStats
};
})();
