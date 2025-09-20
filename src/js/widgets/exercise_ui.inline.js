(function() {
'use strict';

function createSummary(items = []) {
  const root = document.createElement('div');
  root.className = 'chips';
  const map = {};
  for (const {id, label, initial = '—'} of items) {
    const entry = makeSummaryItem(label, initial);
    if (id) entry.root.dataset.key = id;
    if (id) map[id] = entry;
    root.appendChild(entry.root);
  }
  return {root, items: map};
}

function makeSummaryItem(label, value) {
  const root = document.createElement('div');
  root.className = 'chip';
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = label;
  const val = document.createElement('div');
  val.className = 'subCon';
  val.textContent = value;
  root.append(sub, val);
  return {
    root,
    set(v) {
      val.textContent = String(v == null ? '—' : v);
    }
  };
}

function createLayoutModal(opts = {}) {
  const {
    value = 0,
    min = -40,
    max = 40,
    step = 5,
    format = (x) => String(x)
  } = opts;

  const root = document.createElement('div');
  root.className = 'layout-modal hidden';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-hidden', 'true');

  const titleId = 'layout-tune-title';
  const hintId = 'layout-tune-hint';
  root.setAttribute('aria-labelledby', titleId);
  root.setAttribute('aria-describedby', hintId);

  const backdrop = document.createElement('div');
  backdrop.className = 'layout-modal__backdrop';

  const sheet = document.createElement('div');
  sheet.className = 'layout-modal__sheet';

  const header = document.createElement('div');
  header.className = 'layout-modal__header';

  const title = document.createElement('h2');
  title.className = 'layout-modal__title';
  title.id = titleId;
  title.textContent = 'Положение элементов';

  const close = document.createElement('button');
  close.className = 'layout-modal__close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Закрыть настройку');
  close.textContent = '×';

  header.append(title, close);

  const hint = document.createElement('p');
  hint.className = 'layout-modal__hint';
  hint.id = hintId;
  hint.textContent =
      'Сместите контрольные элементы выше или ниже, если экран кажется тесным.';

  const sliderWrap = document.createElement('label');
  sliderWrap.className = 'layout-modal__slider';
  sliderWrap.textContent = 'Смещение:';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  sliderWrap.appendChild(slider);

  const val = document.createElement('div');
  val.className = 'layout-modal__value';
  val.textContent = format(value);

  const footer = document.createElement('div');
  footer.className = 'layout-modal__footer';
  const reset = document.createElement('button');
  reset.className = 'layout-modal__reset';
  reset.type = 'button';
  reset.textContent = 'Сбросить по умолчанию';
  footer.appendChild(reset);

  sheet.append(header, hint, sliderWrap, val, footer);
  root.append(backdrop, sheet);

  return {
    root,
    backdrop,
    sheet,
    slider,
    value: val,
    reset,
    close
  };
}

window.exerciseUI = {
  createSummary,
  createLayoutModal
};
})();
