let tooltipCounter = 0;
let activeTooltip = null;

function addTooltip(target) {
  if (target.dataset.tooltipReady || !target.dataset.tooltip) return;
  target.dataset.tooltipReady = 'true';

  const id = `dashboard-tooltip-${++tooltipCounter}`;
  const iconMode = target.hasAttribute('data-tooltip-icon');
  const trigger = iconMode ? document.createElement('button') : target;
  const hadTabindex = target.hasAttribute('tabindex');
  if (iconMode) {
    trigger.className = 'info-tip';
    trigger.type = 'button';
    const label = (target.getAttribute('aria-label') || target.textContent || '').replace(/\s+/g, ' ').trim();
    trigger.setAttribute('aria-label', label ? `More information about ${label}` : 'More information');
    trigger.innerHTML = '<span aria-hidden="true">i</span>';
    target.append(trigger);
  } else {
    target.classList.add('tooltip-target');
    if (!target.matches('button, a, input, select, textarea') && !hadTabindex) target.tabIndex = 0;
  }
  trigger.setAttribute('aria-describedby', id);

  const popup = document.createElement('span');
  popup.id = id;
  popup.className = 'info-tip-popup';
  popup.setAttribute('role', 'tooltip');
  popup.textContent = target.dataset.tooltip;
  document.body.append(popup);
  const viewportListeners = new AbortController();
  let touchPress = false;

  const place = () => {
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 8;
    const { width, height } = popup.getBoundingClientRect();
    const below = innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const top = height > below && above > below ? rect.top - gap - height : rect.bottom + gap;
    popup.style.left = `${Math.max(margin, Math.min(rect.left, innerWidth - width - margin))}px`;
    popup.style.top = `${Math.max(margin, Math.min(top, innerHeight - height - margin))}px`;
  };
  const hide = () => {
    trigger.classList.remove('is-open');
    popup.classList.remove('is-visible');
    if (activeTooltip === hide) activeTooltip = null;
  };
  const show = () => {
    if (activeTooltip && activeTooltip !== hide) activeTooltip();
    activeTooltip = hide;
    trigger.classList.add('is-open');
    popup.classList.add('is-visible');
    place();
  };
  trigger.hideTooltip = hide;
  trigger.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') show(); });
  trigger.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') hide(); });
  trigger.addEventListener('focus', () => { if (!touchPress) show(); });
  trigger.addEventListener('blur', hide);
  trigger.addEventListener('pointerdown', (event) => { touchPress = event.pointerType === 'touch'; });
  trigger.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'touch') return;
    if (trigger.classList.contains('is-open')) hide();
    else show();
    touchPress = false;
  });
  trigger.addEventListener('pointercancel', () => { touchPress = false; });
  window.addEventListener('resize', () => { if (activeTooltip === hide) place(); }, { signal: viewportListeners.signal });
  window.addEventListener('scroll', () => { if (activeTooltip === hide) place(); }, { capture: true, signal: viewportListeners.signal });
  target.destroyTooltip = () => {
    hide();
    viewportListeners.abort();
    popup.remove();
    if (iconMode) trigger.remove();
    else {
      target.classList.remove('tooltip-target');
      if (!hadTabindex) target.removeAttribute('tabindex');
    }
    target.removeAttribute('data-tooltip-ready');
  };
}

export function initTooltips() {
  const root = document.getElementById('page-root');
  if (!root || root.dataset.tooltipObserver) return;
  root.dataset.tooltipObserver = 'true';
  const decorate = (scope) => {
    if (scope.matches?.('[data-tooltip]')) addTooltip(scope);
    scope.querySelectorAll?.('[data-tooltip]').forEach(addTooltip);
  };
  const clean = (scope) => {
    if (scope.matches?.('[data-tooltip]')) scope.destroyTooltip?.();
    scope.querySelectorAll?.('[data-tooltip]').forEach((target) => target.destroyTooltip?.());
  };
  decorate(document.body);
  new MutationObserver((records) => records.forEach((record) => {
    record.addedNodes.forEach((node) => { if (node.nodeType === Node.ELEMENT_NODE) decorate(node); });
    record.removedNodes.forEach((node) => { if (node.nodeType === Node.ELEMENT_NODE) clean(node); });
  })).observe(root, { childList: true, subtree: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') activeTooltip?.();
  });
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-tooltip]')) activeTooltip?.();
  });
}
