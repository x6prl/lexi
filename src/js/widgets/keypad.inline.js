(() => {
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function decideMask(len) {
    // Порядок ячеек: [0..5] = [TL, TM, TR, BL, BM, BR]
    if (len === 6) return [1, 1, 1, 1, 1, 1];
    if (len === 5) return [1, 1, 1, 1, 1, 0];  // нет верхней-левой
    if (len === 4) return [0, 1, 1, 0, 1, 1];  // правый 2×2
    if (len === 3) return [0, 1, 1, 0, 1, 0];  // L-shape (без BR)
    throw new Error('items length must be 3..6');
  }

  function cellsFromMask(mask) {
    // Вернём список видимых ячеек с координатами
    const pos = [
      {c: 0, r: 0, i: 0},
      {c: 1, r: 0, i: 1},
      {c: 2, r: 0, i: 2},
      {c: 0, r: 1, i: 3},
      {c: 1, r: 1, i: 4},
      {c: 2, r: 1, i: 5},
    ];
    return pos.filter(p => mask[p.i] === 1);
  }

  function readingOrder(mask) {
    // Порядок заполнения лейблов (слева-направо, сверху-вниз, пропуская пустые)
    const order = [0, 1, 2, 3, 4, 5];
    return order.filter(i => mask[i] === 1);
  }

  function has(mask, c, r) {
    if (c < 0 || c > 2 || r < 0 || r > 1) return 0;
    const idx = r * 3 + c;
    return mask[idx] ? 1 : 0;
  }

  // Определяем, какие углы плитки скруглять (только выпуклые)
  function cornerRadii(mask, c, r, radius) {
    const up = has(mask, c, r - 1);
    const down = has(mask, c, r + 1);
    const left = has(mask, c - 1, r);
    const right = has(mask, c + 1, r);

    const diagTL = has(mask, c - 1, r - 1);
    const diagTR = has(mask, c + 1, r - 1);
    const diagBL = has(mask, c - 1, r + 1);
    const diagBR = has(mask, c + 1, r + 1);

    // выпуклый угол = нет обоих ортогональных соседей И нет диагонального
    const tl = (!up && !left && !diagTL) ? radius : 0;
    const tr = (!up && !right && !diagTR) ? radius : 0;
    const bl = (!down && !left && !diagBL) ? radius : 0;
    const br = (!down && !right && !diagBR) ? radius : 0;

    return {tl, tr, bl, br};
  }

  // Внутренние разделители: генерируем только там, где по обе стороны есть
  // ячейки
  function buildSeparators(root, mask, tile, lineColor) {
    const makeLine = (x, y, w, h) => {
      const l = document.createElement('div');
      Object.assign(l.style, {
        position: 'absolute',
        left: x + 'px',
        top: y + 'px',
        width: w + 'px',
        height: h + 'px',
        background: lineColor,
        pointerEvents: 'none'
      });
      root.appendChild(l);
    };

    // Вертикальные швы между c|c+1
    for (let c = 0; c < 2; c++) {
      for (let r = 0; r < 2; r++) {
        if (has(mask, c, r) && has(mask, c + 1, r)) {
          const x = (c + 1) * tile;
          makeLine(x, r * tile, 1, tile);
        }
      }
    }
    // Горизонтальные швы между r|r+1
    for (let c = 0; c < 3; c++) {
      // одна горизонтальная граница между 0 и 1
      if (has(mask, c, 0) && has(mask, c, 1)) {
        const y = tile;
        makeLine(c * tile, y, tile, 1);
      }
    }
  }

  function styleText(el, textColor) {
    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      fontWeight: '800',
      letterSpacing: '0.02em',
      color: textColor,
      userSelect: 'none',
      lineHeight: '1',
      padding: '6px',
      fontSize: '28px'
    });
  }

  function create(opts = {}) {
    const {
      mount = null,
      items = [],
      islandColor = '#F4F5F7',
      dividerColor = 'rgba(0,0,0, .14)',
      textColor = '#111',
      radius = 16,
      tile = 84,
      shadow = true,
      onSelect = () => {}
    } = opts;

    if (!Array.isArray(items) || items.length < 3 || items.length > 6) {
      throw new Error(
          'KeypadIsland: items must be an array of 3..6 short labels');
    }

    const mask = decideMask(items.length);
    const order = readingOrder(mask);
    const cells = cellsFromMask(mask);

    const root = document.createElement('div');
    root.className = 'keypad-island';
    const w = 3 * tile;
    const h = 2 * tile;
    Object.assign(root.style, {
      position: 'relative',
      width: w + 'px',
      height: h + 'px',
      // Никаких внешних границ; только мягкая тень, чтобы "поднять" остров
      filter: shadow ? 'drop-shadow(0px 4px 12px rgba(0,0,0,.20))' : 'none'
    });

    // Плитки
    let labelIdx = 0;
    for (const {c, r, i} of cells) {
      const cell = document.createElement('div');
      const x = c * tile, y = r * tile;
      Object.assign(cell.style, {
        position: 'absolute',
        left: x + 'px',
        top: y + 'px',
        width: tile + 'px',
        height: tile + 'px',
        background: islandColor,
        // Пер-угловые радиусы:
        borderTopLeftRadius: cornerRadii(mask, c, r, radius).tl + 'px',
        borderTopRightRadius: cornerRadii(mask, c, r, radius).tr + 'px',
        borderBottomLeftRadius: cornerRadii(mask, c, r, radius).bl + 'px',
        borderBottomRightRadius: cornerRadii(mask, c, r, radius).br + 'px',
        boxSizing: 'border-box',
        cursor: 'pointer'
      });

      const label = document.createElement('div');
      label.textContent = String(items[labelIdx++] ?? '');
      styleText(label, textColor);
      cell.appendChild(label);

      cell.addEventListener('click', (ev) => {
        const logicalIndex =
            order.indexOf(i);  // индекс элемента в текущем порядке
        onSelect(
            {index: logicalIndex, label: label.textContent, cell, event: ev});
      });

      root.appendChild(cell);
    }

    // Внутренние разделители (только между существующими парами)
    buildSeparators(root, mask, tile, dividerColor);

    // Монтирование
    if (mount) mount.appendChild(root);

    // Методы экземпляра
    const api = {
      el: root,
      update(next = {}) {
        // простая переинициализация (проще и надёжнее при inline)
        const parent = root.parentNode;
        if (parent) {
          parent.removeChild(root);
        }
        const merged = {
          mount: parent || mount,
          items: next.items ?? items,
          islandColor: next.islandColor ?? islandColor,
          dividerColor: next.dividerColor ?? dividerColor,
          textColor: next.textColor ?? textColor,
          radius: clamp(next.radius ?? radius, 0, 64),
          tile: clamp(next.tile ?? tile, 32, 200),
          shadow: next.shadow ?? shadow,
          onSelect: next.onSelect ?? onSelect
        };
        const newer = create(merged);
        // вернуть новый экземпляр наружу
        Object.assign(api, newer);
        return newer;
      },
      destroy() {
        if (root && root.parentNode) root.parentNode.removeChild(root);
      }
    };
    return api;
  }

  // Экспорт
  window.KeypadIsland = {create};
})();
