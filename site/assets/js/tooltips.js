let tooltipCounter = 0;

function addTooltipTrigger(target) {
  if (target.dataset.tooltipReady || !target.dataset.tooltip) return;
  target.dataset.tooltipReady = 'true';
  const id = `dashboard-tooltip-${++tooltipCounter}`;
  const button = document.createElement('button');
  button.className = 'info-tip';
  button.type = 'button';
  button.setAttribute('aria-label', `More information: ${target.dataset.tooltip}`);
  button.setAttribute('aria-describedby', id);
  button.setAttribute('aria-expanded', 'false');
  const glyph = document.createElement('span');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = 'i';
  button.append(glyph);

  const popup = document.createElement('span');
  popup.id = id;
  popup.className = 'info-tip-popup';
  popup.setAttribute('role', 'tooltip');
  popup.textContent = target.dataset.tooltip;
  if (target.matches('button') && target.closest('.account-control')) target.parentElement.append(button);
  else if (target.matches('button')) {
    const wrapper = document.createElement('span');
    wrapper.className = 'info-tip-wrap';
    target.before(wrapper);
    wrapper.append(target, button);
  } else target.append(button);
  document.body.append(popup);
  const viewportListeners = new AbortController();

  const place = () => {
    const rect = button.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - popup.offsetHeight - 8))}px`;
  };
  const show = () => { button.classList.add('is-open'); button.setAttribute('aria-expanded', 'true'); popup.classList.add('is-visible'); place(); };
  const hide = () => { button.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); popup.classList.remove('is-visible'); };
  button.hideTooltip = hide;
  button.addEventListener('mouseenter', show);
  button.addEventListener('mouseleave', hide);
  button.addEventListener('focus', show);
  button.addEventListener('blur', hide);
  button.addEventListener('click', show);
  window.addEventListener('resize', () => { if (button.classList.contains('is-open')) place(); }, { signal: viewportListeners.signal });
  window.addEventListener('scroll', () => { if (button.classList.contains('is-open')) place(); }, { capture: true, signal: viewportListeners.signal });
  button.destroyTooltip = () => { hide(); viewportListeners.abort(); popup.remove(); };
}

function refreshTooltip(target) {
  const trigger = target.parentElement?.querySelector('.info-tip');
  if (!trigger) return;
  trigger.setAttribute('aria-label', `More information: ${target.dataset.tooltip}`);
  const popup = document.getElementById(trigger.getAttribute('aria-describedby'));
  if (popup) popup.textContent = target.dataset.tooltip;
}

export function initTooltips() {
  const root = document.getElementById('page-root');
  if (!root || root.dataset.tooltipObserver) return;
  root.dataset.tooltipObserver = 'true';
  const decorate = (scope) => {
    if (scope.matches?.('[data-tooltip]')) addTooltipTrigger(scope);
    scope.querySelectorAll?.('[data-tooltip]').forEach(addTooltipTrigger);
  };
  const clean = (scope) => {
    if (scope.matches?.('.info-tip')) scope.destroyTooltip?.();
    scope.querySelectorAll?.('.info-tip').forEach((button) => button.destroyTooltip?.());
  };
  decorate(document.body);
  new MutationObserver((records) => records.forEach((record) => {
    record.addedNodes.forEach((node) => { if (node.nodeType === Node.ELEMENT_NODE) decorate(node); });
    record.removedNodes.forEach((node) => { if (node.nodeType === Node.ELEMENT_NODE) clean(node); });
  })).observe(root, { childList: true, subtree: true });
  const accountButton = document.getElementById('accountButton');
  if (accountButton) new MutationObserver(() => refreshTooltip(accountButton))
    .observe(accountButton, { attributes: true, attributeFilter: ['data-tooltip'] });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.querySelectorAll('.info-tip.is-open').forEach((button) => button.hideTooltip());
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.info-tip')) document.querySelectorAll('.info-tip.is-open').forEach((button) => {
      button.hideTooltip();
    });
  });
}
