/* dbItemStatistics.inline.js — виджет показа статистики по одному терму
   Глобально экспортирует:
     window.dbItemStatistics = { create, update, format }
   Виджет не требует внешних стилей, использует Shadow DOM и CSS-переменные.

   Props:
   {
     term: string,                 // например: 'der Hand "-e'
     translations: string[]|string,// ['рука','кисть (руки)'] или строка с ;
     stats: TermStatsV2|{
       stage:'MC5'|'CHUNKS'|'COMPOSE',
       M:{S:number,last:number,due:number,q:number,streak:number},
       C:{S:number,last:number,due:number,q:number,streak:number},
       P:{S:number,last:number,due:number,q:number,streak:number},
       shown?: number
     },
     accentColor?: string,         // необязательно, переопределит --accent
     dangerColor?: string,         // необязательно, переопределит --danger
     onClick?: (ev)=>void          // клик по строке
   }
*/
(function() {
'use strict';

const CSS = `
:host, .root { box-sizing: border-box; }
* { box-sizing: inherit; }

:host { display:block; font: 500 16px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji"; }

.wrap {
  border-radius: 12px;
  padding: 12px 14px;
  cursor: default;
  user-select: none;
  background: var(--card, transparent);
  transition: background .15s ease, transform .05s ease;
}
.wrap.clickable { cursor: pointer; }
.wrap.clickable:active { transform: translateY(1px); }

.title {
  font-weight: 800;
  letter-spacing: .2px;
  font-size: 20px;
  color: var(--fg, #0f172a);
  margin: 0 0 4px 0;
}
.sub {
  color: var(--muted, #64748b);
  font-weight: 500;
  margin: 0 0 10px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* блок с тремя колонками */
.stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  column-gap: 18px;
  align-items: start;
}
.col { position: relative; padding-left: 0; }
.col + .col { padding-left: 18px; }
.col + .col::before {
  content: "";
  position: absolute; left: 0; top: 4px; bottom: 4px;
  width: 1px; background: var(--border, rgba(100,116,139,.25));
}

.label {
  font-size: 13px;
  letter-spacing: .02em;
  color: var(--muted, #64748b);
  margin-bottom: 4px;
}
.value {
  font-size: 22px;
  font-weight: 900;
  color: var(--fg, #0f172a);
}
.value.accent { color: var(--accent, #16a34a); }
.value.danger { color: var(--danger, #e11d48); }

/* Ховер/фокус для кликабельных рядов */
.wrap.clickable:hover {
  background: color-mix(in srgb, var(--accent, #16a34a) 8%, transparent);
}
:host([data-theme="dark"]) .wrap.clickable:hover {
  background: color-mix(in srgb, var(--accent, #22c55e) 18%, transparent);
}

/* базовые переменные на случай отсутствия глобальной темы */
:host {
  --fg:           var(--app-fg, #0f172a);
  --muted:        var(--app-muted, #64748b);
  --border:       var(--app-border, rgba(100,116,139,.25));
  --accent:       var(--app-accent, #16a34a);
  --danger:       var(--app-danger, #e11d48);
  --card:         var(--app-card, transparent);
}
@media (prefers-color-scheme: dark) {
  :host {
    --fg:     var(--app-fg, #e5e7eb);
    --muted:  var(--app-muted, #9aa4b2);
    --border: var(--app-border, rgba(148,163,184,.28));
    --card:   var(--app-card, transparent);
  }
}
`;

// Нормализация входных данных
function asArray(x) {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  return String(x).split(';').map(s => s.trim()).filter(Boolean);
}

// Из TermStatsV2 достаём state активного режима
const modeKey = (stage) =>
    stage === 'MC5' ? 'M' : (stage === 'CHUNKS' ? 'C' : 'P');

function clamp(x, a, b) {
  return Math.min(b, Math.max(a, x));
}
function round2(x) {
  return Math.round(x * 100) / 100;
}

// Форматирование чисел
function fmtAcc(q) {
  if (q == null || Number.isNaN(q)) return '—';
  const v = clamp(q, 0, 1);
  // Для item-строки по макету — в диапазоне 0..1 с 2 знаками
  return String(round2(v).toFixed(2));
}
function fmtInt(n) {
  return (n == null || Number.isNaN(n)) ? '—' :
                                          String(Math.max(0, Math.trunc(n)));
}

// Создание DOM
function create(props) {
  const host = document.createElement('db-item-statistics');
  const shadow = host.attachShadow({mode: 'open'});

  // Позволяем локально переопределять цвета
  const style = document.createElement('style');
  style.textContent = CSS;

  const wrap = el('div', 'wrap');
  const title = el('h3', 'title');
  const sub = el('div', 'sub');

  const stats = el('div', 'stats');
  const c1 = metric('точность');
  const c2 = metric('верно подр.');
  const c3 = metric('показов');

  stats.appendChild(c1.col);
  stats.appendChild(c2.col);
  stats.appendChild(c3.col);

  wrap.appendChild(title);
  wrap.appendChild(sub);
  wrap.appendChild(stats);

  shadow.appendChild(style);
  shadow.appendChild(wrap);

  // Публичные ссылки на элементы для быстрого обновления
  host._els = {wrap, title, sub, c1, c2, c3};
  host._props = {};
  update(host, props || {});

  // Клик
  host._els.wrap.addEventListener('click', (ev) => {
    if (host._props && typeof host._props.onClick === 'function') {
      host._props.onClick(ev);
    }
  });

  return host;
}

// Вспомогательные построители
function el(tag, cls) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  return d;
}
function metric(label) {
  const col = el('div', 'col');
  const l = el('div', 'label');
  l.textContent = label;
  const v = el('div', 'value');
  col.appendChild(l);
  col.appendChild(v);
  return {col, l, v};
}

// Рендер / обновление
function update(host, nextProps) {
  const props = Object.assign({}, host._props, nextProps || {});
  host._props = props;

  // term + translations
  host._els.title.textContent = String(props.term || '—');
  const tr = asArray(props.translations);
  host._els.sub.textContent = tr.join('; ');

  // Поддержка кликабельности
  if (props.onClick)
    host._els.wrap.classList.add('clickable');
  else
    host._els.wrap.classList.remove('clickable');

  // Цвета через инлайн-переменные (не ломают тему приложения)
  if (props.accentColor) host.style.setProperty('--accent', props.accentColor);
  if (props.dangerColor) host.style.setProperty('--danger', props.dangerColor);

  // Достаём state активного режима
  const st = (props.stats && props.stats.stage) ?
      props.stats[modeKey(props.stats.stage)] || {} :
      {};

  const q = st.q;
  const streak = st.streak;
  const shown = (props.stats && props.stats.shown);

  // Значения
  host._els.c1.v.textContent = fmtAcc(q);
  host._els.c2.v.textContent = fmtInt(streak);
  host._els.c3.v.textContent = fmtInt(shown);

  // Подсветка «долга» (ошибки приводят к низкой точности)
  host._els.c1.v.classList.toggle('danger', (q != null && q < 0.6));
  host._els.c1.v.classList.toggle('accent', (q != null && q >= 0.85));
}

// Экспортируемое форматирование (если нужно извне)
const format = {
  acc: fmtAcc,
  int: fmtInt
};

// Глобальный экспорт
window.dbItemStatistics = {
  create,
  update,
  format
};
})();
