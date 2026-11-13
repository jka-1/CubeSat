// Only shared library presentation order; this module never loads or executes a definition.
export function mountLibraryOrder({ trigger, panel, request, onLibrary, getSelected, onSelect, closeOnSelect = false }) {
  const list = panel.querySelector('[data-order-list]');
  const status = panel.querySelector('[data-order-status]');
  const retry = panel.querySelector('[data-order-retry]');
  const newChoice = panel.querySelector('[data-order-new]');
  const controller = new AbortController(), { signal } = controller;
  let library = { sequences: [], order: { version: 0, ids: [] } }, saving = false, failedMove = null, drag = null, frame = null, disposed = false;
  const announce = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };
  const selected = () => {
    newChoice?.setAttribute('aria-pressed', String(!getSelected()));
    for (const row of list.children) {
      const active = row.dataset.orderId === getSelected();
      row.classList.toggle('selected', active);
      row.querySelector('[data-order-select]').setAttribute('aria-pressed', String(active));
    }
  };
  function render(focusId, action) {
    if (drag || disposed) return;
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const activeId = focused?.closest('[data-order-id]')?.dataset.orderId;
    const activeSelector = focused?.hasAttribute('data-order-select') ? '[data-order-select]' : focused?.hasAttribute('data-order-handle') ? '[data-order-handle]' : focused?.dataset.orderMove ? `[data-order-move="${focused.dataset.orderMove}"]` : null;
    const scroll = list.scrollTop;
    list.replaceChildren(...library.sequences.map((item, index) => {
      const row = document.createElement('li'); row.dataset.orderId = item.id;
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'seq-order-handle'; handle.dataset.orderHandle = '';
      handle.setAttribute('aria-label', `Drag ${item.name} to reorder`); handle.disabled = saving;
      handle.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><circle cx="8" cy="5" r="1.5"/><circle cx="16" cy="5" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/></svg>';
      const choose = document.createElement('button'); choose.type = 'button'; choose.dataset.orderSelect = ''; choose.className = 'seq-order-name';
      choose.textContent = `${item.name} · r${item.revision}`; choose.setAttribute('aria-label', `Select ${item.name}, revision ${item.revision}. Use Load to open.`);
      row.append(handle, choose);
      const actions = document.createElement('span'); actions.className = 'seq-order-actions';
      for (const [direction, label, disabled] of [['up', 'Move up', index === 0], ['down', 'Move down', index === library.sequences.length - 1]]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'seq-order-move'; button.dataset.orderMove = direction;
        button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction === 'up' ? 'M12 19V5m-5 5 5-5 5 5' : 'M12 5v14m-5-5 5 5 5-5'}"/></svg>`;
        button.setAttribute('aria-label', `${label}: ${item.name}`); button.disabled = saving || disabled; actions.append(button);
      }
      row.append(actions);
      return row;
    }));
    list.scrollTop = scroll; selected();
    trigger.disabled = false;
    if (!library.sequences.length && !failedMove && !saving) announce('No saved definitions yet. Save a definition to add it to the library.');
    retry.hidden = !failedMove; retry.disabled = saving;
    if (!focusId && activeId && activeSelector) {
      const row = [...list.children].find((row) => row.dataset.orderId === activeId);
      (row?.querySelector(activeSelector + ':not(:disabled)') || row?.querySelector('[data-order-select]') || panel.querySelector('[data-order-close]')).focus({ preventScroll: true });
    }
    if (focusId) {
      const row = [...list.children].find((row) => row.dataset.orderId === focusId);
      const button = row?.querySelector(action ? `[data-order-move="${action}"]:not(:disabled)` : '[data-order-handle]') || row?.querySelector('[data-order-select]');
      button?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' });
    }
  }
  function update(next) {
    if (disposed || next.order.version < library.order.version) return;
    if (JSON.stringify(next) === JSON.stringify(library)) return;
    library = next; render();
  }
  function close() {
    cancelDrag(); panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus();
  }
  async function move(intent, action) {
    if (saving || disposed) return;
    const { id, before_id } = intent;
    if (!library.order.ids.includes(id) || before_id !== null && !library.order.ids.includes(before_id)) {
      failedMove = null; announce('A definition in this move was deleted. Choose a new position.', true); render(); return;
    }
    saving = true; failedMove = null; announce('Saving library order…'); render();
    try {
      const next = await request('/sequences/order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...intent, expected_version: library.order.version }) });
      if (disposed) return;
      update(next); onLibrary(next);
      const position = next.order.ids.indexOf(id) + 1;
      announce(`Moved ${next.sequences.find((item) => item.id === id)?.name} to position ${position} of ${next.sequences.length}. Order saved.`);
    } catch (error) {
      if (disposed) return;
      failedMove = intent;
      if (error.status === 409) {
        try { const next = await request('/sequences'); if (!disposed) { update(next); onLibrary(next); } } catch { /* keep last confirmed order */ }
      }
      announce(`Order not saved: ${error.message} Review the list, then Retry move or choose another position.`, true);
    } finally {
      saving = false;
      render(panel.hidden ? null : id, action);
    }
  }
  function insertion(y) {
    const rows = [...list.children].filter((row) => row.dataset.orderId !== drag.id);
    const next = rows.find((row) => y < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    list.querySelectorAll('.insert-before, .insert-after').forEach((row) => row.classList.remove('insert-before', 'insert-after'));
    if (next) next.classList.add('insert-before'); else rows.at(-1)?.classList.add('insert-after');
    drag.before_id = next?.dataset.orderId ?? null;
  }
  function scrollDrag() {
    if (!drag) return;
    const rect = list.getBoundingClientRect();
    const speed = drag.y < rect.top + 48 ? -Math.min(18, (rect.top + 48 - drag.y) / 3) : drag.y > rect.bottom - 48 ? Math.min(18, (drag.y - rect.bottom + 48) / 3) : 0;
    if (speed) list.scrollTop += speed;
    insertion(drag.y); frame = requestAnimationFrame(scrollDrag);
  }
  function cancelDrag() {
    if (!drag) return;
    const handle = drag.handle, pointerId = drag.pointerId;
    drag = null; cancelAnimationFrame(frame); frame = null;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    list.classList.remove('dragging'); render();
  }
  trigger.addEventListener('click', () => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); render();
    const chosen = !getSelected() && newChoice || list.querySelector('.selected [data-order-select]') || list.querySelector('[data-order-select]') || newChoice || panel.querySelector('[data-order-close]');
    const row = chosen.closest('li');
    if (row) list.scrollTop = row.offsetTop - list.offsetTop;
    panel.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    chosen.focus({ preventScroll: true });
  }, { signal });
  panel.querySelector('[data-order-close]').addEventListener('click', close, { signal });
  const choose = (id) => { onSelect(id); selected(); if (closeOnSelect) close(); };
  newChoice?.addEventListener('click', () => choose(''), { signal });
  panel.addEventListener('keydown', (event) => {
    if (!closeOnSelect || !event.target.matches('[data-order-select], [data-order-new]') || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const choices = [newChoice, ...list.querySelectorAll('[data-order-select]')].filter(Boolean);
    const index = choices.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    choices[next]?.focus();
  }, { signal });
  document.addEventListener('keydown', (event) => { if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); close(); } }, { signal });
  document.addEventListener('pointerdown', (event) => { if (!panel.hidden && !drag && !panel.contains(event.target) && !trigger.contains(event.target)) close(); }, { signal });
  list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-order-id]'); if (!row) return;
    if (event.target.closest('[data-order-select]')) choose(row.dataset.orderId);
    const button = event.target.closest('[data-order-move]'); if (!button) return;
    const index = library.order.ids.indexOf(row.dataset.orderId), down = button.dataset.orderMove === 'down';
    move({ id: row.dataset.orderId, before_id: library.order.ids[index + (down ? 2 : -1)] ?? null }, button.dataset.orderMove);
  }, { signal });
  list.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-order-handle]');
    if (!handle || saving || event.button !== 0) return;
    event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
    const row = handle.closest('[data-order-id]');
    drag = { id: row.dataset.orderId, pointerId: event.pointerId, handle, y: event.clientY, before_id: row.nextElementSibling?.dataset.orderId ?? null };
    row.classList.add('drag-source'); list.classList.add('dragging'); scrollDrag();
  }, { signal });
  list.addEventListener('pointermove', (event) => { if (drag && event.pointerId === drag.pointerId) { drag.y = event.clientY; insertion(drag.y); } }, { signal });
  list.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const intent = { id: drag.id, before_id: drag.before_id };
    cancelDrag(); move(intent);
  }, { signal });
  for (const type of ['pointercancel', 'lostpointercapture']) list.addEventListener(type, cancelDrag, { signal });
  retry.addEventListener('click', () => { if (failedMove) move(failedMove); }, { signal });
  return { update, selected, dispose() { disposed = true; cancelDrag(); controller.abort(); } };
}
