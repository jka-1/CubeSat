let active = null;

export function confirmDialog(message, { title = 'Confirm action', action = 'Confirm', danger = false } = {}) {
  if (active) return Promise.resolve(false);
  const dialog = document.createElement('dialog');
  dialog.className = 'app-confirm';
  dialog.setAttribute('aria-labelledby', 'appConfirmTitle');
  dialog.setAttribute('aria-describedby', 'appConfirmMessage');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="appConfirmTitle"></h2>
      <p id="appConfirmMessage"></p>
      <div class="app-confirm-actions">
        <button type="submit" class="button secondary" value="cancel" autofocus>Cancel</button>
        <button type="submit" class="button" value="confirm"></button>
      </div>
    </form>`;
  dialog.querySelector('h2').textContent = title;
  dialog.querySelector('p').textContent = message;
  const submit = dialog.querySelector('[value="confirm"]');
  submit.textContent = action;
  if (danger) submit.classList.add('danger');
  const trigger = document.activeElement;
  active = dialog;
  document.body.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      active = null;
      dialog.remove();
      if (trigger?.isConnected && !trigger.disabled) trigger.focus({preventScroll:true});
      resolve(dialog.returnValue === 'confirm');
    }, {once:true});
    dialog.showModal();
  });
}
