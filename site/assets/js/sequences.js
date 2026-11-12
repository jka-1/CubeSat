import { hasUnsavedChanges, confirmDiscard, saveDefinition, deleteDefinition } from './sequence-actions.mjs';
import { WRITABLE_REGISTER_WIDTHS } from './register-policy.mjs?v=20261112-registers';
import { operatorRegisters, availableRegisters, registerName } from './operator-registers.mjs';
import { apiFetch, canOperate, canEditSequences } from './auth.js?v=20261109e';
import { METRICS, OPERATORS, BLOCKS, comparison, makeBlock, findList, countBlocks, validateDraft, cloneSequence, moveBlock, parseUserRegister, userRegisterLabel, USER_REGISTER_LIMIT, remoteChange } from './sequence-editor-model.mjs?v=20261112-sequences';
import { mountSequenceHistory } from './sequence-history.mjs?v=20261112-sequences';
import { CONDITION_REGISTERS, CONDITION_FAULTS, DEVICE_LABELS } from './sequence-condition-fields.mjs?v=20261112-registers';
import { READABLE_REGISTERS } from './sequence-register-catalog.mjs?v=20261112-registers';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
const pathKey = (path) => encodeURIComponent(JSON.stringify(path));
const decodePath = (key) => JSON.parse(decodeURIComponent(key));
const labelFor = (type) => BLOCKS.find(([key]) => key === type)?.[1] || type;
const failureText = { condition_timeout: 'Condition did not become TRUE before the timeout.',
  command_failed: 'The device reported a command failure. Inspect the command result below.',
  command_outcome_unknown: 'No device response was confirmed. Inspect hardware before another live write.',
  operator_authorization_lost: 'Operator connection or ownership was lost.',
  bridge_restart: 'Bridge restarted before this run finished.', canceled: 'Stopped by an operator.' };
const request = async (path, options = {}) => {
  const response = await apiFetch(`/telemetry${path}`, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Bridge returned HTTP ${response.status}`), { status: response.status, data });
  return data;
};
const jsonPost = (path, body, token = '') => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Command-Token': token } : {}) }, body: JSON.stringify(body) });
let draft, selectedPath = [], selectedIndex = null, selectedId = null, saved = [], execution = null, timer = null, lastEvent = 0, events = [], alive = false, busy = false, confirmation = null, savedSnapshot = null, polling = false;
let historyView = null;
let addingRegister = null;
let registryUnsubscribe = null;
window.addEventListener('cubesat-auth-change', () => { if (!canEditSequences()) { draft = undefined; savedSnapshot = null; } else if (alive && draft) render(false); });
function userRegisters() {
  const own = draft.registers || [], ids = new Set(own.map((item) => item.id));
  return [...own, ...operatorRegisters.list().filter((item) => !ids.has(item.id))];
}
function shareDefinitionRegisters() {
  for (const entry of draft.registers || []) operatorRegisters.add(entry).catch(() => {});
}
function useRegister(id) {
  if ((draft.registers || []).some((item) => item.id === id)) return true;
  const entry = operatorRegisters.list().find((item) => item.id === id);
  if (!entry) return CONDITION_REGISTERS.some((item) => item.id === id);
  if ((draft.registers || []).length >= USER_REGISTER_LIMIT) { notice(`A Branch Definition can hold at most ${USER_REGISTER_LIMIT} added registers.`, true); return false; }
  draft.registers = [...(draft.registers || []), { ...entry }];
  return true;
}
function addRegisterForm(id) {
  return `<span class="seq-register-form" data-regform-for="${esc(id)}"><label>Device addr <input class="seq-input" data-regform="addr" placeholder="0x48" maxlength="4" size="5" aria-label="Device address (hex)"></label><label>Register <input class="seq-input" data-regform="reg" placeholder="0x00" maxlength="4" size="5" aria-label="Register (hex)"></label><label>Width <select class="seq-input" data-regform="len">${option('1', '1 byte', '1')}${option('2', '2 bytes', '1')}</select></label><label>Byte order <select class="seq-input" data-regform="endian">${option('big', 'Big endian', 'big')}${option('little', 'Little endian', 'big')}</select></label><label>Name (optional) <input class="seq-input" data-regform="label" maxlength="60" placeholder="e.g. Temp sensor"></label><button class="seq-mini" type="button" data-reg-add="${esc(id)}">Add</button><button class="seq-mini" type="button" data-reg-cancel>Cancel</button><span class="seq-register-error" role="alert"></span></span>`;
}
let pendingExecution = null;
function executionId(mode) {
  if (!pendingExecution || pendingExecution.mode !== mode || pendingExecution.sequenceId !== draft.id || pendingExecution.revision !== draft.revision) {
    pendingExecution = { mode, sequenceId: draft.id, revision: draft.revision, id: crypto.randomUUID() };
  }
  return pendingExecution.id;
}
const fresh = () => ({ schemaVersion: 1, name: '', steps: [] });
function notice(text, error = false) { $('seqState').textContent = text; $('seqState').classList.toggle('error', error); }
function currentList() { return findList(draft.steps, selectedPath) || draft.steps; }
function stepById(id) {
  const visit = (steps) => { for (const step of steps) { if (step.id === id) return step; if (step.type === 'if') { const found = visit(step.then) || visit(step.else); if (found) return found; } } return null; };
  return visit(draft.steps);
}
function optionMetrics(selected) { return METRICS.map((metric) => option(metric.id, `${metric.label} (${metric.unit})`, selected)).join(''); }
// Register-read blocks in execution order, so a condition can use "the result of a previous block".
function readBlocks() {
  const out = [];
  const visit = (steps, prefix) => steps.forEach((step, index) => {
    const label = `${prefix}${index + 1}`;
    if (step.type === 'registerRead' || step.command?.type === 'i2c_read') out.push({ id: step.id, label: `Block ${label} · ${DEVICE_LABELS[step.command.addr] || step.command.addr} ${step.command.reg}` });
    if (step.type === 'if') { visit(step.then, `${label}.T`); visit(step.else, `${label}.F`); }
  });
  visit(draft.steps, '');
  return out;
}
function conditionOptions(selected) {
  const entries = new Map(CONDITION_REGISTERS.map((item) => [item.id, item]));
  const targets = new Set(CONDITION_REGISTERS.filter((item) => item.addr).map((item) => `${item.addr}:${item.reg}:${item.len}`));
  for (const item of userRegisters()) {
    const key = `${item.addr}:${item.reg}:${item.len}`;
    if (!targets.has(key) || selected === item.id) entries.set(item.id, { ...item, label: userRegisterLabel(item) });
    targets.add(key);
  }
  return [...entries.values()].map((item) => option(item.id, item.addr ? registerName(item) : item.label, selected)).join('');
}
// Update options only: text inputs, focused forms and the draft are left intact.
function refreshRegisterMenus() {
  if (!alive) return;
  document.querySelectorAll('[data-condition][data-field="register"]').forEach((select) => {
    select.innerHTML = conditionOptions(select.value);
  });
  document.querySelectorAll('.seq-block').forEach((article) => {
    const step = stepById(article.dataset.id);
    if (!['i2c_read', 'i2c_write'].includes(step?.command?.type)) return;
    const template = document.createElement('template');
    template.innerHTML = registerOptions(step.command, step.command.type === 'i2c_write');
    for (const field of ['addr', 'readRegister', 'reg']) {
      const select = article.querySelector(`select[data-field="${field}"]`);
      const next = template.content.querySelector(`select[data-field="${field}"]`);
      if (select && next) select.innerHTML = next.innerHTML;
    }
  });
}
function operandHtml(value, id) {
  const metric = METRICS.find((item) => item.id === value?.metric) || METRICS[0];
  const kind = value?.step ? 'step' : value?.metric ? 'metric' : value?.register ? 'register' : value?.fault ? 'fault' : 'constant';
  const reads = readBlocks();
  const field = kind === 'step' ? `<select class="seq-input" data-condition="${id}" data-field="step">${reads.length ? reads.map((item) => option(item.id, item.label, value.step)).join('') : option('', 'Add a Register read block first', '')}</select>`
    : kind === 'metric' ? `<select class="seq-input" data-condition="${id}" data-field="metric">${optionMetrics(value.metric)}</select>`
    : kind === 'register' ? `<select class="seq-input" data-condition="${id}" data-field="register">${conditionOptions(value.register)}</select><button class="seq-mini" type="button" data-reg-open="${id}"${addingRegister === id ? ' hidden' : ''}>Add register</button>${addingRegister === id ? addRegisterForm(id) : ''}`
      : kind === 'fault' ? `<select class="seq-input" data-condition="${id}" data-field="fault">${CONDITION_FAULTS.map((name) => option(name, name, value.fault)).join('')}</select>`
        : value?.unit === 'boolean' ? `<select class="seq-input" data-condition="${id}" data-field="constant">${option('true', 'Active', String(value.constant))}${option('false', 'Clear', String(value.constant))}</select>`
          : `<input class="seq-input" type="${value?.unit === 'hex' ? 'text' : 'number'}" ${value?.unit === 'hex' ? 'pattern="0x[0-9a-fA-F]+" placeholder="0x00"' : 'step="any"'} value="${esc(value?.unit === 'hex' && Number.isInteger(value.constant) ? `0x${value.constant.toString(16).toUpperCase()}` : value?.constant ?? '')}" data-condition="${id}" data-field="constant" aria-label="Comparison value"><select class="seq-input" data-condition="${id}" data-field="unit" aria-label="Value format">${['V', 'A', 'W', 'C', 'mV', 'hex', 'boolean'].map((unit) => option(unit, unit === 'hex' ? 'Hex' : unit === 'boolean' ? 'Flag' : unit, value?.unit)).join('')}</select>`;
  return `<span class="seq-operand"><select class="seq-input" data-condition="${id}" data-field="kind">${option('step', 'Block result', kind)}${option('metric', 'Telemetry', kind)}${option('register', 'Register', kind)}${option('fault', 'Fault flag', kind)}${option('constant', 'Value', kind)}</select>${field}</span>`;
}
function conditionHtml(condition, address) {
  const key = encodeURIComponent(JSON.stringify(address));
  const op = condition?.op || '>';
  const choices = [...OPERATORS, 'AND', 'OR', 'NOT'].map((item) => option(item, item === '&' ? '& (bit mask)' : item, op)).join('');
  let body = '';
  if (op === 'AND' || op === 'OR') body = `<div class="seq-logic-children">${condition.conditions.map((part, index) => `<div class="seq-logic-part">${conditionHtml(part, [...address, index])}<button class="seq-mini" type="button" data-cond-remove="${key}" data-index="${index}" aria-label="Remove condition ${index + 1}"${condition.conditions.length <= 2 ? ' disabled' : ''}>Remove</button></div>`).join('')}<button class="seq-mini" type="button" data-cond-add="${key}"${condition.conditions.length >= 8 ? ' disabled' : ''}>Add condition</button></div>`;
  else if (op === 'NOT') body = conditionHtml(condition.condition, [...address, 'condition']);
  else body = `<div class="seq-compare">${operandHtml(condition.left, `${key}:left`)}<strong>${esc(op)}</strong>${operandHtml(condition.right, `${key}:right`)}</div>`;
  return `<div class="seq-condition"><label>Condition <select class="seq-input" data-cond-op="${key}">${choices}</select></label>${body}</div>`;
}
function registerOptions(command, write) {
  // Catalog presence grants reads only. Keep the verified write allowlist independent.
  const allowed = WRITABLE_REGISTER_WIDTHS;
  const reads = availableRegisters(draft.registers || []);
  const addresses = write ? Object.keys(allowed) : [...new Set([...Object.keys(DEVICE_LABELS), ...reads.map((item) => item.addr)])];
  const regs = write ? Object.keys(allowed[command.addr] || {}).map((reg) => ({ reg })) : reads.filter((item) => item.addr === command.addr);
  return `<label>Device <select class="seq-input" data-field="addr">${addresses.map((addr) => option(addr, DEVICE_LABELS[addr] || addr, command.addr)).join('')}</select></label><label>Register <select class="seq-input" data-field="${write ? 'reg' : 'readRegister'}">${regs.map((item) => option(write ? item.reg : `${item.reg}/${item.len}`, `${registerName({ ...item, addr: command.addr })}${item.len ? ` (${item.len} B, ${item.endian})` : ''}`, write ? command.reg : `${command.reg}/${command.len}`)).join('')}</select></label>${write ? `<label>Data bytes (hex, space separated) <input class="seq-input" data-field="data" value="${esc(command.data?.join(' ') || '')}" placeholder="0x00 0x00"></label>` : `<span>Width: ${esc(command.len)} byte(s)</span>`}`;
}

const commandTypes = [['led_control', 'LED'], ['debug_control', 'Debug mode'], ['sensor_control', 'Sensor polling'], ['mppt_acdrv_control', 'MPPT ACDRV'], ['i2c_read', 'I²C read'], ['i2c_write', 'I²C write'], ['set_scan_period', 'Scan period'], ['i2c_scan', 'I²C scan'], ['i2c_probe', 'I²C probe']];
function commandHtml(step) {
  const cmd = step.command;
  if (step.type === 'registerRead' || step.type === 'registerWrite') return registerOptions(cmd, step.type === 'registerWrite');
  let fields = `<label>Action <select class="seq-input" data-field="commandType">${commandTypes.map(([id, label]) => option(id, label, cmd.type)).join('')}</select></label>`;
  if (cmd.type === 'i2c_read' || cmd.type === 'i2c_write') fields += registerOptions(cmd, cmd.type === 'i2c_write');
  if (['led_control', 'debug_control', 'sensor_control'].includes(cmd.type)) fields += `<label>State <select class="seq-input" data-field="enabled">${option('true', 'On', String(cmd.enabled))}${option('false', 'Off', String(cmd.enabled))}</select></label>`;
  if (cmd.type === 'sensor_control') fields += `<label>Sensor <select class="seq-input" data-field="sensor">${[['pv', '0x40'], ['bms', '0x08'], ['mppt', '0x6B']].map(([s, addr]) => option(s, DEVICE_LABELS[addr], cmd.sensor)).join('')}</select></label>`;
  if (cmd.type === 'mppt_acdrv_control') fields += `<label>Source <select class="seq-input" data-field="state">${['acdrv1', 'acdrv2', 'disabled'].map((s) => option(s, s, cmd.state)).join('')}</select></label>`;
  if (cmd.type === 'set_scan_period') fields += `<label>Period (ms) <input class="seq-input" type="number" min="200" max="5000" data-field="period_ms" value="${esc(cmd.period_ms)}"></label>`;
  if (cmd.type === 'i2c_probe') fields += `<label>Address <input class="seq-input" data-field="probeAddr" value="${esc(cmd.addr)}"></label>`;
  return fields;
}
function blockHtml(step, path, index) {
  const selected = selectedId === step.id;
  const reference = step.type === 'runSaved' ? `<label>Saved Branch Definition <select class="seq-input" data-field="sequenceId">${option('', 'Choose a saved definition', step.sequenceId)}${saved.filter((item) => item.id !== draft.id).map((item) => option(item.id, `${item.name} · r${item.revision}`, step.sequenceId)).join('')}${step.sequenceId && !saved.some((item) => item.id === step.sequenceId && item.id !== draft.id) ? option(step.sequenceId, `${step.sequenceId} (pinned)`, step.sequenceId) : ''}</select></label><label>Pinned revision <input class="seq-input" type="number" min="1" max="1000000" data-field="revision" value="${esc(step.revision)}"></label><small>Changing the selected definition pins its current revision. Later saves do not update this reference.</small>` : '';
  const options = step.type === 'runSaved' ? reference : step.type === 'message' ? `<label>Operator message <textarea class="seq-input" data-field="message" maxlength="1000" rows="3">${esc(step.message)}</textarea></label><small>Plain text, recorded only when this block executes.</small>` : step.type === 'delay' ? `<label>Duration (ms) <input class="seq-input" type="number" min="1" max="600000" data-field="durationMs" value="${esc(step.durationMs)}"></label>` : step.type === 'waitUntil' ? `${conditionHtml(step.condition, [step.id])}<label>Timeout (ms) <input class="seq-input" type="number" min="1" max="600000" data-field="timeoutMs" value="${esc(step.timeoutMs)}"></label>` : step.type === 'if' ? conditionHtml(step.condition, [step.id]) : commandHtml(step);
  const branches = step.type === 'if' ? `<div class="seq-branches"><div class="seq-branch"><h4>TRUE path</h4>${listHtml(step.then, [...path, { id: step.id, branch: 'then' }])}</div><div class="seq-branch"><h4>FALSE path</h4>${listHtml(step.else, [...path, { id: step.id, branch: 'else' }])}</div></div>` : '';
  return `<article class="seq-block${selected ? ' selected' : ''}${execution?.current_block === step.id ? ' active' : ''}" data-id="${esc(step.id)}" data-path="${pathKey(path)}" draggable="true"><div class="seq-block-header"><button class="seq-block-title" type="button" data-select="${esc(step.id)}" aria-expanded="${selected}">${esc(labelFor(step.type))} <small>${index + 1}</small></button><div class="seq-block-actions"><button type="button" class="seq-mini" data-move="up" aria-label="Move ${esc(labelFor(step.type))} up"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" class="seq-mini" data-move="down" aria-label="Move ${esc(labelFor(step.type))} down">↓</button><button type="button" class="seq-mini" data-remove aria-label="Remove ${esc(labelFor(step.type))}">Remove</button></div></div>${selected ? `<div class="seq-config">${options}</div>` : ''}${branches}</article>`;
}
function listHtml(steps, path) {
  const key = pathKey(path), selected = JSON.stringify(path) === JSON.stringify(selectedPath);
  return `<div class="seq-list${selected ? ' target' : ''}" data-list="${key}"><button class="seq-insert" type="button" data-insert="${key}" data-index="0">${steps.length ? 'Insert before' : 'Select path / add a block'}</button>${steps.map((step, index) => `${blockHtml(step, path, index)}<button class="seq-insert" type="button" data-insert="${key}" data-index="${index + 1}">Insert here</button>`).join('')}</div>`;
}
function render(updateCanvas = true) {
  if (!alive) return;
  if (updateCanvas) $('seqCanvas').innerHTML = listHtml(draft.steps, []);
  $('seqCount').textContent = `${countBlocks(draft.steps)} blocks`;
  const errors = validateDraft(draft);
  $('seqValidation').innerHTML = errors.length ? `<strong>${errors.length} validation issue${errors.length === 1 ? '' : 's'}</strong><ul>${errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>` : '<span class="seq-valid">Branch Definition is ready to save.</span>';
  $('seqSave').disabled = !canEditSequences() || busy || errors.length > 0;
  $('seqDelete').disabled = !canEditSequences() || busy || !$('seqSaved').value;
  $('seqLoad').disabled = busy; $('seqNew').disabled = busy;
  $('seqDuplicate').disabled = !draft.id || !canEditSequences() || busy;
  const dirty = !draft.id || JSON.stringify(draft) !== savedSnapshot;
  $('seqSimulate').disabled = !canOperate() || busy || errors.length > 0 || dirty || !!execution && ['running', 'paused'].includes(execution.state);
  $('seqLive').disabled = $('seqSimulate').disabled;
  $('seqPause').disabled = !canOperate() || execution?.state !== 'running';
  $('seqResume').disabled = !canOperate() || execution?.state !== 'paused';
  $('seqStop').disabled = !canOperate() || !['running', 'paused'].includes(execution?.state);
  $('seqConfirmRun').disabled = !canOperate() || !confirmation;
  $('seqRunState').textContent = execution ? `${execution.mode} · ${execution.state}` : 'Idle';
  const completed = events.filter((event) => event.type === 'block_completed').length;
  const expandedCount = (definition) => { const walk = (steps) => steps.reduce((n, step) => n + 1 + (step.type === 'if' ? walk(step.then) + walk(step.else || []) : step.type === 'runSaved' ? walk((execution.definition.dependencies || []).find((item) => item.id === step.sequenceId && item.revision === step.revision)?.steps || []) : 0), 0); return walk(definition.steps); };
  const total = execution?.definition ? expandedCount(execution.definition) : countBlocks(draft.steps);
  $('seqProgress').value = execution?.state === 'completed' ? 100 : total ? Math.round(100 * completed / total) : 0;
  const lastStarted = [...events].reverse().find((event) => event.type === 'block_started');
  const activeId = lastStarted && !events.some((event) => event.event_order > lastStarted.event_order && ['block_completed', 'block_failed'].includes(event.type) && event.block_id === lastStarted.block_id && JSON.stringify(event.details?.path || []) === JSON.stringify(lastStarted.details?.path || [])) ? lastStarted.block_id : null;
  const activeDefinition = lastStarted?.details?.definition_id && execution?.definition?.dependencies?.find((item) => item.id === lastStarted.details.definition_id && item.revision === lastStarted.details.revision) || execution?.definition;
  const executionBlock = activeId && activeDefinition ? (() => { const walk = (steps) => { for (const step of steps) { if (step.id === activeId) return step; if (step.type === 'if') { const found = walk(step.then) || walk(step.else); if (found) return found; } } return null; }; return walk(activeDefinition.steps); })() : null;
  $('seqProgressLabel').textContent = execution ? `${completed} completed · ${total} blocks · ${execution.state}${lastStarted?.details?.path?.length && activeId ? ` · ${lastStarted.details.path.join(' / ')}` : ''}${activeId ? ` · active ${labelFor(executionBlock?.type || '')} (${activeId.slice(0, 8)})` : ''}` : 'No execution selected';
  document.querySelectorAll('.seq-block.active').forEach((node) => node.classList.remove('active'));
  if (activeId && activeDefinition?.id === draft.id && !lastStarted?.details?.path?.some((part) => part.includes('@'))) document.querySelectorAll('.seq-block').forEach((node) => { if (node.dataset.id === activeId) node.classList.add('active'); });
  const lastError = [...events].reverse().find((event) => event.type === 'command_error' || event.type === 'condition' && event.details?.error);
  $('seqRunError').textContent = execution?.reason ? `${failureText[execution.reason] || execution.reason}${lastError?.details?.error ? ` ${lastError.details.error}` : ''}` : '';
  const recoveryNeeded = execution?.mode === 'live' && ['command_outcome_unknown', 'bridge_restart'].includes(execution.reason) && !execution.recovery_ms;
  $('seqRecovery').hidden = !recoveryNeeded;
  $('seqRecover').disabled = !recoveryNeeded || !canOperate() || !$('seqReviewed').checked || !$('seqToken').value.trim();
  $('seqEvents').innerHTML = events.slice(-30).map((event) => `<li><time>${esc(new Date(event.at_ms).toLocaleTimeString())}</time> ${esc(event.type.replaceAll('_', ' '))}${event.details?.path?.length ? ` · ${esc(event.details.path.join(' / '))}` : ''}${event.type === 'message' ? ` · ${esc(event.block_id)} · ${esc(event.details.message)}` : ''}${event.details?.sequence_name ? ` · ${esc(event.details.sequence_name)} r${event.details.sequence_revision}` : ''}${event.details?.selected ? ` · ${event.details.selected === 'then' ? 'TRUE' : 'FALSE'}` : ''}${event.details?.error ? ` · ${esc(event.details.error)}` : ''}</li>`).join('');
}
// Concurrent editing (web + desktop app): poll the saved list and warn when the loaded definition changed elsewhere.
let listTimer = null, remoteNotice = '';
async function refreshSavedList() {
  if (!alive || document.hidden) return;
  try {
    const list = (await request('/sequences')).sequences || [];
    const changed = JSON.stringify(list) !== JSON.stringify(saved);
    const info = remoteChange(draft, list);
    saved = list; if (changed) updateSaved();
    const text = info ? `"${info.name}" was saved elsewhere as revision ${info.revision} (you have r${draft.revision}). ${JSON.stringify(draft) === savedSnapshot ? 'Click Load to get it.' : 'Saving will ask how to resolve the conflict.'}` : '';
    if (text !== remoteNotice) { remoteNotice = text; $('seqRemote').textContent = text; $('seqRemote').hidden = !text; }
  } catch { /* transient; next poll retries */ }
}
function updateSaved() { const selected = $('seqSaved').value; $('seqSaved').innerHTML = `<option value="">New Branch Definition</option>${saved.map((item) => option(item.id, `${item.name} · r${item.revision}`, draft.id)).join('')}`; if (saved.some((item) => item.id === selected)) $('seqSaved').value = selected; }
async function loadSaved() { saved = (await request('/sequences')).sequences || []; updateSaved(); render(false); }
async function save() {
  const errors = validateDraft(draft); if (errors.length) { notice('Fix validation issues before saving.', true); render(); return false; }
  if (!canEditSequences()) { notice('An operator account is required to save.', true); return false; }
  if (busy) return false;
  busy = true; render(false);
  const original = JSON.stringify(draft);
  try {
    const savedDefinition = await saveDefinition(draft, request);
    if (!savedDefinition) return false;
    if (JSON.stringify(draft) === original) draft = savedDefinition;
    else { draft.id = savedDefinition.id; draft.revision = savedDefinition.revision; }
    savedSnapshot = JSON.stringify(savedDefinition);
    confirmation = null;
    await loadSaved(); await refreshSavedList(); notice(`Saved revision ${savedDefinition.revision}.`); return true;
  } catch (error) { notice(`Save failed: ${error.message}`, true); return false; }
  finally { busy = false; render(false); }
}
async function removeSaved() {
  if (busy || !canEditSequences()) return;
  const target = saved.find((item) => item.id === $('seqSaved').value);
  if (!target) return;
  busy = true; render(false);
  try {
    if (!await deleteDefinition(target, request)) return;
    if (draft.id === target.id) { delete draft.id; delete draft.revision; savedSnapshot = null; }
    confirmation = null;
    await loadSaved(); notice(`Deleted "${target.name}" revision ${target.revision}.`);
  } catch (error) { notice(`Delete failed: ${error.message}`, true); }
  finally { busy = false; render(false); }
}
export function confirmLeaveSequences() { return !alive || !hasUnsavedChanges(draft, savedSnapshot) || confirm(`Leave "${draft.name || 'Untitled Branch Definition'}" with unsaved edits? They remain in this browser until sign-out or reload. Cancel stays in the editor.`); }
window.addEventListener('beforeunload', (event) => {
  if (alive && hasUnsavedChanges(draft, savedSnapshot)) { event.preventDefault(); event.returnValue = ''; }
});
async function pollExecution() {
  if (!alive || !execution || polling) return;
  polling = true;
  try {
    const id = encodeURIComponent(execution.id);
    execution = (await request(`/sequence-executions/${id}`)).execution;
    let newer;
    do {
      newer = (await request(`/sequence-executions/${id}/events?after=${lastEvent}`)).events || [];
      for (const event of newer) { events.push(event); lastEvent = Math.max(lastEvent, event.event_order); }
    } while (newer.length === 100 && alive);
    render(false);
    if (['completed', 'failed', 'canceled'].includes(execution.state)) { clearInterval(timer); timer = null; historyView?.refresh(execution.id); }
  } catch (error) { notice(`Execution status unavailable: ${error.message}`, true); }
  finally { polling = false; }
}
async function start(mode) {
  if (!draft.id || !canOperate() || JSON.stringify(draft) !== savedSnapshot) { notice('Save the current sequence before execution.', true); return; }
  if (mode === 'live') {
    try {
      const token = $('seqToken').value.trim();
      if (!token) { $('seqConfirm').hidden = false; $('seqToken').focus(); notice('Enter the command token to review live execution.'); return; }
      const data = await jsonPost(`/sequences/${encodeURIComponent(draft.id)}/preflight`, {}, token);
      confirmation = data.confirmation_token;
      $('seqConfirmText').textContent = `Confirm ${data.name} revision ${data.revision} on device ${data.device_id} at ${data.target.address}:${data.target.port}. Token expires in 30 seconds.${data.dependencies?.length ? ` Pinned saved sequences: ${data.dependencies.map((item) => `${item.name} (${item.id}) revision ${item.revision}`).join('; ')}.` : ''}`;
      $('seqConfirm').hidden = false; render();
    } catch (error) { notice(`Preflight failed: ${error.message}`, true); }
    return;
  }
  try {
    let telemetry;
    const input = $('seqSimulationTelemetry').value.trim();
    if (input) { telemetry = JSON.parse(input); if (!telemetry || typeof telemetry !== 'object' || Array.isArray(telemetry)) throw new Error('Simulation telemetry must be a JSON object'); }
    const data = await jsonPost(`/sequences/${encodeURIComponent(draft.id)}/execute`, { mode: 'simulation', execution_id: executionId('simulation'), ...(telemetry ? { telemetry } : {}) });
    pendingExecution = null;
    execution = data.execution; events = []; lastEvent = 0; notice('Simulation started.'); historyView?.refresh(execution.id); await pollExecution(); timer = setInterval(pollExecution, 750);
  } catch (error) { notice(`Simulation failed: ${error.message}`, true); }
}
async function runLive() {
  if (!confirmation || !canOperate()) return;
  const token = $('seqToken').value.trim();
  try {
    const data = await jsonPost(`/sequences/${encodeURIComponent(draft.id)}/execute`, { mode: 'live', confirmation_token: confirmation, execution_id: executionId('live') }, token);
    pendingExecution = null;
    confirmation = null; $('seqConfirm').hidden = true; $('seqToken').value = '';
    execution = data.execution; events = []; lastEvent = 0; notice('Live execution started.'); historyView?.refresh(execution.id); await pollExecution(); timer = setInterval(pollExecution, 750);
  } catch (error) { confirmation = null; notice(`Live execution failed: ${error.message}`, true); render(); }
}
async function control(action) {
  if (!execution || !canOperate()) return;
  try { const data = await jsonPost(`/sequence-executions/${encodeURIComponent(execution.id)}/${action}`, {}, action === 'resume' ? $('seqToken').value.trim() : ''); execution = data.execution; await pollExecution(); }
  catch (error) { notice(`${action} failed: ${error.message}`, true); }
}
function conditionAt(address) {
  const [id, ...parts] = address; const step = stepById(id); if (!step?.condition) return null;
  let current = step.condition;
  for (const part of parts) current = part === 'condition' ? current.condition : current.conditions?.[part];
  return current;
}
function replaceCondition(address, value) {
  const [id, ...parts] = address; const step = stepById(id); if (!step) return;
  if (!parts.length) { step.condition = value; return; }
  const parent = conditionAt([id, ...parts.slice(0, -1)]), last = parts.at(-1);
  if (last === 'condition') parent.condition = value; else parent.conditions[last] = value;
}
function commandFor(type) {
  return ({ led_control: { type, enabled: true }, debug_control: { type, enabled: true }, sensor_control: { type, sensor: 'pv', enabled: true }, mppt_acdrv_control: { type, state: 'acdrv1' }, set_scan_period: { type, period_ms: 1000 }, i2c_scan: { type }, i2c_probe: { type, addr: '0x40' }, i2c_read: { type, addr: '0x40', reg: '0x00', len: 2 }, i2c_write: { type, addr: '0x40', reg: '0x05', data: ['0x00', '0x00'] } })[type];
}
function handleChange(event, updateCanvas = true) {
  const el = event.target;
  if (el.id === 'seqName') { draft.name = el.value; render(false); return; }
  if (el.dataset.condOp) {
    const address = JSON.parse(decodeURIComponent(el.dataset.condOp)), op = el.value;
    const current = conditionAt(address);
    replaceCondition(address, op === 'AND' || op === 'OR' ? { op, conditions: [comparison(), comparison()] } : op === 'NOT' ? { op, condition: comparison() } : { ...(OPERATORS.includes(current?.op) ? current : comparison()), op }); render(updateCanvas); return;
  }
  if (el.dataset.condition) {
    const [key, side] = el.dataset.condition.split(':'), condition = conditionAt(JSON.parse(decodeURIComponent(key))); if (!condition) return;
    const value = condition[side];
    if (el.dataset.field === 'kind') condition[side] = el.value === 'step' ? { step: readBlocks()[0]?.id || '' } : el.value === 'metric' ? { metric: METRICS[0].id } : el.value === 'register' ? { register: CONDITION_REGISTERS[0].id } : el.value === 'fault' ? { fault: CONDITION_FAULTS[0] } : { constant: 0, unit: 'V' };
    if (el.dataset.field === 'metric') condition[side] = { metric: el.value };
    if (el.dataset.field === 'register' && useRegister(el.value)) condition[side] = { register: el.value };
    if (el.dataset.field === 'step') condition[side] = { step: el.value };
    if (el.dataset.field === 'fault') condition[side] = { fault: el.value };
    if (el.dataset.field === 'unit') condition[side] = { constant: el.value === 'boolean' ? false : 0, unit: el.value };
    if (el.dataset.field === 'constant') condition[side].constant = condition[side].unit === 'boolean' ? el.value === 'true' : condition[side].unit === 'hex' ? /^0x[0-9a-f]+$/i.test(el.value) ? Number(el.value) : NaN : el.value === '' ? NaN : Number(el.value);
    render(updateCanvas); return;
  }
  const article = el.closest('.seq-block'); if (!article || !el.dataset.field) return;
  const step = stepById(article.dataset.id), field = el.dataset.field; if (!step) return;
  if (field === 'commandType') step.command = commandFor(el.value);
  else if (field === 'message') { step.message = el.value; render(false); return; }
  else if (field === 'sequenceId') { step.sequenceId = el.value; step.revision = saved.find((item) => item.id === el.value)?.revision || 1; }
  else if (field === 'revision') step.revision = Number(el.value);
  else if (field === 'durationMs' || field === 'timeoutMs') step[field] = el.value === '' ? NaN : Number(el.value);
  else if (field === 'addr') {
    const writing = step.command.type === 'i2c_write';
    const choices = availableRegisters(draft.registers || []).filter((item) => item.addr === el.value);
    const entry = writing ? choices.find((item) => item.reg === (el.value === '0x40' ? '0x05' : el.value === '0x08' ? '0x3E' : '0x0F')) : choices[0];
    if (!entry || !writing && !useRegister(entry.id)) return;
    step.command.addr = el.value; step.command.reg = entry.reg;
    if (writing) { delete step.command.len; step.command.data = Array(entry.len).fill('0x00'); } else step.command.len = entry.len;
  }
  else if (field === 'readRegister') {
    const [reg, len] = el.value.split('/');
    const entry = availableRegisters(draft.registers || []).find((item) => item.addr === step.command.addr && item.reg === reg && item.len === Number(len));
    if (!entry || !useRegister(entry.id)) return;
    step.command.reg = entry.reg; step.command.len = entry.len;
  }
  else if (field === 'reg') {
    step.command.reg = el.value;
    const width = READABLE_REGISTERS.find((item) => item.addr === step.command.addr && item.reg === el.value)?.len ?? 2;
    delete step.command.len; step.command.data = Array(width).fill('0x00');
  }
  else if (field === 'data') step.command.data = el.value.trim().split(/\s+/).filter(Boolean);
  else if (field === 'len' || field === 'period_ms') step.command[field] = Number(el.value);
  else if (field === 'enabled') step.command.enabled = el.value === 'true';
  else if (field === 'probeAddr') step.command.addr = el.value;
  else step.command[field] = el.value;
  render(updateCanvas);
}
async function handleClick(event) {
  const el = event.target.closest('button'); if (!el) return;
  if (el.dataset.add) { if (countBlocks(draft.steps) >= 200) return; const list = currentList(); list.splice(selectedIndex === null ? list.length : selectedIndex, 0, makeBlock(el.dataset.add)); if (selectedIndex !== null) selectedIndex++; render(); return; }
  if (el.dataset.insert) { selectedPath = decodePath(el.dataset.insert); selectedIndex = Number(el.dataset.index); selectedId = null; render(); return; }
  if (el.dataset.select) { selectedId = selectedId === el.dataset.select ? null : el.dataset.select; render(); return; }
  if (el.dataset.regOpen) { addingRegister = el.dataset.regOpen; render(); document.querySelector('[data-regform="addr"]')?.focus(); return; }
  if (el.hasAttribute('data-reg-cancel')) { addingRegister = null; render(); return; }
  if (el.dataset.regAdd) {
    const form = el.closest('.seq-register-form'), field = (name) => form.querySelector(`[data-regform="${name}"]`).value;
    const { entry, errors } = parseUserRegister({ addr: field('addr'), reg: field('reg'), len: Number(field('len')), endian: field('endian'), label: field('label') });
    if (errors.length) { form.querySelector('.seq-register-error').textContent = errors.join(' '); return; }
    const target = draft;
    if (!(target.registers || []).some((item) => item.id === entry.id) && (target.registers || []).length >= USER_REGISTER_LIMIT) { form.querySelector('.seq-register-error').textContent = `At most ${USER_REGISTER_LIMIT} added registers per Branch Definition.`; return; }
    const [key, side] = el.dataset.regAdd.split(':'), condition = conditionAt(JSON.parse(decodeURIComponent(key)));
    el.disabled = true;
    try {
      const committed = await operatorRegisters.add(entry);
      if (committed.id.startsWith('user-') && !(target.registers || []).some((item) => item.id === committed.id)) target.registers = [...(target.registers || []), committed];
      if (condition) condition[side] = { register: committed.id };
      if (alive && draft === target) { addingRegister = null; notice(`Added register ${userRegisterLabel(committed)}.`); render(); }
    } catch (error) { if (form.isConnected) form.querySelector('.seq-register-error').textContent = error.message; }
    finally { el.disabled = false; }
    return;
  }
  if (el.dataset.condAdd) { const condition = conditionAt(JSON.parse(decodeURIComponent(el.dataset.condAdd))); condition.conditions.push(comparison()); render(); return; }
  if (el.dataset.condRemove) { const condition = conditionAt(JSON.parse(decodeURIComponent(el.dataset.condRemove))); condition.conditions.splice(Number(el.dataset.index), 1); render(); return; }
  const article = el.closest('.seq-block'); if (!article) return;
  const path = decodePath(article.dataset.path), list = findList(draft.steps, path), index = list.findIndex((step) => step.id === article.dataset.id);
  if (el.hasAttribute('data-remove')) { list.splice(index, 1); if (selectedId === article.dataset.id) selectedId = null; render(); }
  if (el.dataset.move) { const target = index + (el.dataset.move === 'up' ? -1 : 2); moveBlock(draft.steps, path, article.dataset.id, path, target); render(); document.querySelector(`[data-id="${article.dataset.id}"] [data-move="${el.dataset.move}"]`)?.focus(); }
}
function wireDrag() {
  const canvas = $('seqCanvas'); let dragging = null;
  $('seqPaletteList').addEventListener('dragstart', (event) => { const source = event.target.closest('[data-palette]'); if (!source) return; dragging = { type: source.dataset.palette }; event.dataTransfer.setData('text/plain', source.dataset.palette); });
  canvas.addEventListener('dragstart', (event) => { const article = event.target.closest('.seq-block'); if (!article) return; dragging = { id: article.dataset.id, path: decodePath(article.dataset.path) }; event.dataTransfer.setData('text/plain', article.dataset.id); });
  canvas.addEventListener('dragover', (event) => { if (event.target.closest('[data-insert]')) event.preventDefault(); });
  canvas.addEventListener('drop', (event) => { const point = event.target.closest('[data-insert]'); if (!point || !dragging) return; event.preventDefault(); const path = decodePath(point.dataset.insert), index = Number(point.dataset.index); if (dragging.type) { if (countBlocks(draft.steps) < 200) findList(draft.steps, path).splice(index, 0, makeBlock(dragging.type)); } else moveBlock(draft.steps, dragging.path, dragging.id, path, index); selectedPath = path; selectedIndex = null; dragging = null; render(); });
  canvas.addEventListener('dragend', () => { dragging = null; });
}
export async function initSequencesPage() {
  alive = true; draft ||= fresh(); selectedPath = []; selectedIndex = null; selectedId = null; execution = null; events = []; lastEvent = 0; busy = false; confirmation = null; polling = false;
  $('seqName').value = draft.name;
  shareDefinitionRegisters();
  registryUnsubscribe = operatorRegisters.subscribe(refreshRegisterMenus);
  historyView = mountSequenceHistory($('sequenceHistory'));
  $('seqPaletteList').innerHTML = BLOCKS.map(([type, label]) => `<div class="seq-palette-item" draggable="true" data-palette="${type}"><span>${esc(label)}</span><button class="seq-mini" type="button" data-add="${type}" aria-label="Add ${esc(label)} to selected path">Add</button></div>`).join('');
  $('seqPaletteList').addEventListener('click', handleClick); $('seqCanvas').addEventListener('click', handleClick);
  $('seqCanvas').addEventListener('change', handleChange);
  $('seqCanvas').addEventListener('input', (event) => { if (event.target.matches('input[data-field], textarea[data-field]')) handleChange(event, false); });
  $('seqName').addEventListener('input', handleChange);
  $('seqNew').addEventListener('click', () => { if (!confirmDiscard(draft, savedSnapshot)) return; confirmation = null; savedSnapshot = null; draft = fresh(); $('seqName').value = ''; selectedPath = []; selectedIndex = null; selectedId = null; updateSaved(); render(); notice('New Branch Definition.'); });
  $('seqLoad').addEventListener('click', async () => { const id = $('seqSaved').value; if (!id) return; try { const loaded = (await request(`/sequences/${encodeURIComponent(id)}`)).sequence; if (!confirmDiscard(draft, savedSnapshot)) return; draft = loaded; confirmation = null; savedSnapshot = JSON.stringify(draft); $('seqName').value = draft.name; selectedPath = []; selectedIndex = null; selectedId = null; render(); notice(`Loaded revision ${draft.revision}.`); shareDefinitionRegisters(); refreshSavedList(); } catch (error) { notice(`Load failed: ${error.message}`, true); } });
  $('seqDuplicate').addEventListener('click', () => { draft = cloneSequence(draft); savedSnapshot = null; $('seqName').value = draft.name; updateSaved(); render(); notice('Copy created. Save to keep it.'); });
  $('seqSave').addEventListener('click', save);
  $('seqDelete').addEventListener('click', removeSaved);
  $('seqSaved').addEventListener('change', () => render(false));
  $('seqSimulate').addEventListener('click', () => start('simulation'));
  $('seqLive').addEventListener('click', () => start('live'));
  $('seqConfirmRun').addEventListener('click', runLive);
  $('seqCancelRun').addEventListener('click', () => { confirmation = null; $('seqConfirm').hidden = true; $('seqToken').value = ''; render(); });
  $('seqToken').addEventListener('change', () => { if (!confirmation && !$('seqConfirm').hidden) start('live'); else render(false); });
  $('seqReviewed').addEventListener('change', () => render(false));
  $('seqRecover').addEventListener('click', async () => {
    if (!execution || !canOperate() || !$('seqReviewed').checked) return;
    try { await jsonPost(`/sequence-executions/${encodeURIComponent(execution.id)}/recover`, {}, $('seqToken').value.trim()); $('seqReviewed').checked = false; $('seqToken').value = ''; await pollExecution(); notice('Device review acknowledged; live lock cleared.'); }
    catch (error) { notice(`Recovery failed: ${error.message}`, true); }
  });
  for (const action of ['pause', 'resume', 'stop']) $(`seq${action[0].toUpperCase()}${action.slice(1)}`).addEventListener('click', () => control(action));
  wireDrag(); render();
  clearInterval(listTimer); listTimer = setInterval(refreshSavedList, 5000);
  try { await loadSaved(); const recent = (await request('/sequence-executions')).executions?.find((item) => ['running', 'paused'].includes(item.state)); if (recent) { execution = recent; await pollExecution(); timer = setInterval(pollExecution, 750); } }
  catch (error) { notice(`Branch Definition service unavailable: ${error.message}`, true); }
}
export function destroySequencesPage() { registryUnsubscribe?.(); registryUnsubscribe = null; alive = false; clearInterval(timer); timer = null; clearInterval(listTimer); listTimer = null; remoteNotice = ''; historyView?.dispose(); historyView = null; }
