(function() {
'use strict';

// ---- once-per-page style injection ----
const STYLE_ID = 'wci-inline-style';
const CSS = `
  .wci { position: relative; display: block; width: var(--wci-w, 600px);
         aspect-ratio: 4 / 3; border-radius: var(--wci-r,16px);
         background: var(--wci-bg, #F5F7FA); overflow: hidden; }
  /* минимальная «воздушная» тень, не рамка */
  .wci::after { content:''; position:absolute; inset:0; pointer-events:none;
                box-shadow: 0 4px 12px rgba(0,0,0,.08); }
  .wci-list { list-style: none; margin: 0; padding: 0; height: 100%;
              display: grid; grid-template-rows: repeat(5, 1fr); }
  .wci-item { position: relative; display: flex; align-items: center; justify-content: center;
              font: 700 24px/1.15 system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif;
              color: var(--wci-text, #0A1428); letter-spacing: .2px; cursor: pointer;
              user-select: none; padding: .55em 1.2em; }
  /* Внутренние разделители — тонкие линии, доходят до краёв острова */
  .wci-item + .wci-item::before { content: ''; position: absolute; left: 0; right: 0; top: 0;
                                  height: 1px; background: var(--wci-div, #D7DFEA); }
  /* Ховер/фокус без внешней рамки */
  .wci-item:focus { outline: none; }
  .wci-item:is(:hover, :focus-visible) { background: color-mix(in oklab, var(--wci-bg,#F5F7FA) 90%, #000 10%); }
  .wci-item:active { transform: scale(0.996); }
  /* Доступность */
  .wci[role="listbox"] { outline: none; }
  .wci-item[aria-selected="true"] { background: color-mix(in oklab, var(--wci-bg,#F5F7FA) 80%, #000 20%); }
  @media (max-width: 480px) {
    .wci-item { font-size: 18px; }
  }`;

function injectStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---- core factory ----
function createWordChoiceIsland(opts) {
  injectStylesOnce();

  const state = {
    items: normalizeItems(opts && opts.items),
    onSelect: (opts && opts.onSelect) || function() {},
    islandColor: (opts && opts.islandColor) || '#F5F7FA',
    dividerColor: (opts && opts.dividerColor) || '#D7DFEA',
    textColor: (opts && opts.textColor) || '#0A1428',
    width: (opts && opts.width) || 600,  // px
    radius: (opts && opts.radius) || 16,
    selected: -1
  };

  const root = document.createElement('div');
  root.className = 'wci';
  root.setAttribute('role', 'listbox');
  applyVars();

  const list = document.createElement('ul');
  list.className = 'wci-list';
  root.appendChild(list);

  renderItems();

  // keyboard navigation (Up/Down/Enter/Space)
  root.tabIndex = 0;
  root.addEventListener('keydown', (e) => {
    const max = 4;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(+1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      const i = focusedIndex();
      if (i != null) activate(i);
    }
  });

  function applyVars() {
    root.style.setProperty('--wci-w', state.width + 'px');
    root.style.setProperty('--wci-r', state.radius + 'px');
    root.style.setProperty('--wci-bg', state.islandColor);
    root.style.setProperty('--wci-div', state.dividerColor);
    root.style.setProperty('--wci-text', state.textColor);
  }

  function normalizeItems(items) {
    const a = (Array.isArray(items) ? items : []).slice(0, 5);
    while (a.length < 5) a.push('');
    return a;
  }

  function renderItems() {
    list.innerHTML = '';
    state.items.forEach((label, i) => {
      const li = document.createElement('li');
      li.className = 'wci-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(state.selected === i));
      li.tabIndex = -1;
      li.textContent = String(label || '');
      li.addEventListener('click', () => activate(i));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate(i);
        }
      });
      list.appendChild(li);
    });
  }

  function activate(i) {
    state.selected = i;
    [...list.children].forEach(
        (el, idx) => el.setAttribute('aria-selected', String(idx === i)));
    state.onSelect(
        {index: i, value: state.items[i], element: list.children[i], root});
  }

  function focusedIndex() {
    const nodes = [...list.children];
    const idx = nodes.findIndex((n) => n === document.activeElement);
    return idx === -1 ? null : idx;
  }

  function moveFocus(dir) {
    const nodes = [...list.children];
    let idx = focusedIndex();
    if (idx == null)
      idx = dir > 0 ? 0 : nodes.length - 1;
    else
      idx = (idx + dir + nodes.length) % nodes.length;
    nodes[idx].focus();
  }

  // ---- public API ----
  const api = {
    el: root,
    mount(target) {
      (target || document.body).appendChild(root);
      return api;
    },
    updateItems(newItems) {
      state.items = normalizeItems(newItems);
      renderItems();
      return api;
    },
    updateColors({islandColor, dividerColor, textColor} = {}) {
      if (islandColor) state.islandColor = islandColor;
      if (dividerColor) state.dividerColor = dividerColor;
      if (textColor) state.textColor = textColor;
      applyVars();
      return api;
    },
    setWidth(px) {
      state.width = px;
      applyVars();
      return api;
    },
    setRadius(r) {
      state.radius = r;
      applyVars();
      return api;
    },
    select(i) {
      if (i >= 0 && i < 5) activate(i);
      return api;
    },
    get value() {
      return state.selected >= 0 ?
          {index: state.selected, value: state.items[state.selected]} :
          null;
    }
  };
  return api;
}

// expose globally
window.createWordChoiceIsland = createWordChoiceIsland;
})();
