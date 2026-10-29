import { apiFetch, canOperate } from './auth.js?v=20261028d';
import { METRICS, OPERATORS, BLOCKS, comparison, makeBlock, findList, countBlocks, validateDraft, cloneSequence, moveBlock } from './sequence-editor-model.mjs?v=20261029e';
import { mountSequenceHistory } from './sequence-history.mjs?v=20261029e';
import { CONDITION_REGISTERS, CONDITION_FAULTS, DEVICE_LABELS } from './sequence-condition-fields.mjs';

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
  if (!response.ok) throw new Error(data.error || `Bridge returned HTTP ${response.status}`);
  return data;
};
const jsonPost = (path, body, token = '') => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Command-Token': token } : {}) }, body: JSON.stringify(body) });
let draft, selectedPath = [], selectedIndex = null, selectedId = null, saved = [], execution = null, timer = null, lastEvent = 0, events = [], alive = false, busy = false, confirmation = null, savedSnapshot = null, polling = false;
let historyView = null;
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
function operandHtml(value, id) {
  const metric = METRICS.find((item) => item.id === value?.metric) || METRICS[0];
  const kind = value?.metric ? 'metric' : value?.register ? 'register' : value?.fault ? 'fault' : 'constant';
  const field = kind === 'metric' ? `<select class="seq-input" data-condition="${id}" data-field="metric">${optionMetrics(value.metric)}</select>`
    : kind === 'register' ? `<select class="seq-input" data-condition="${id}" data-field="register">${CONDITION_REGISTERS.map((item) => option(item.id, item.label, value.register)).join('')}</select>`
      : kind === 'fault' ? `<select class="seq-input" data-condition="${id}" data-field="fault">${CONDITION_FAULTS.map((name) => option(name, name, value.fault)).join('')}</select>`
        : value?.unit === 'boolean' ? `<select class="seq-input" data-condition="${id}" data-field="constant">${option('true', 'Active', String(value.constant))}${option('false', 'Clear', String(value.constant))}</select>`
          : `<input class="seq-input" type="${value?.unit === 'hex' ? 'text' : 'number'}" ${value?.unit === 'hex' ? 'pattern="0x[0-9a-fA-F]+" placeholder="0x00"' : 'step="any"'} value="${esc(value?.unit === 'hex' && Number.isInteger(value.constant) ? `0x${value.constant.toString(16).toUpperCase()}` : value?.constant ?? '')}" data-condition="${id}" data-field="constant" aria-label="Comparison value"><select class="seq-input" data-condition="${id}" data-field="unit" aria-label="Value format">${['V', 'A', 'W', 'C', 'mV', 'hex', 'boolean'].map((unit) => option(unit, unit === 'hex' ? 'Hex' : unit === 'boolean' ? 'Flag' : unit, value?.unit)).join('')}</select>`;
  return `<span class="seq-operand"><select class="seq-input" data-condition="${id}" data-field="kind">${option('metric', 'Telemetry', kind)}${option('register', 'Register', kind)}${option('fault', 'Fault flag', kind)}${option('constant', 'Value', kind)}</select>${field}</span>`;
}
function conditionHtml(condition, address) {
  const key = encodeURIComponent(JSON.stringify(address));
  const op = condition?.op || '>';
  const choices = [...OPERATORS, 'AND', 'OR', 'NOT'].map((item) => option(item, item, op)).join('');
  let body = '';
  if (op === 'AND' || op === 'OR') body = `<div class="seq-logic-children">${condition.conditions.map((part, index) => `<div class="seq-logic-part">${conditionHtml(part, [...address, index])}<button class="seq-mini" type="button" data-cond-remove="${key}" data-index="${index}" aria-label="Remove condition ${index + 1}"${condition.conditions.length <= 2 ? ' disabled' : ''}>Remove</button></div>`).join('')}<button class="seq-mini" type="button" data-cond-add="${key}"${condition.conditions.length >= 8 ? ' disabled' : ''}>Add condition</button></div>`;
  else if (op === 'NOT') body = conditionHtml(condition.condition, [...address, 'condition']);
  else body = `<div class="seq-compare">${operandHtml(condition.left, `${key}:left`)}<strong>${esc(op)}</strong>${operandHtml(condition.right, `${key}:right`)}</div>`;
  return `<div class="seq-condition"><label>Condition <select class="seq-input" data-cond-op="${key}">${choices}</select></label>${body}</div>`;
}
function registerOptions(command, write) {
  const allowed = write ? { '0x08': '3E', '0x6B': '0F 10 12 13 14 2E 30', '0x40': '00 05 06 07' } : { '0x08': '14 16 18 1A 36 3A 68 3E', '0x6B': '0F 10 12 13 14 1B 1C 1E 2E 30 48 31 33 35 37 39 3B 3D 41', '0x40': '00 01 02 03 04 05 06 07 FE FF' };
  const regs = (allowed[command.addr] || '').split(' ').filter(Boolean);
  return `<label>Device <select class="seq-input" data-field="addr">${Object.keys(allowed).map((addr) => option(addr, DEVICE_LABELS[addr], command.addr)).join('')}</select></label><label>Register <select class="seq-input" data-field="reg">${regs.map((reg) => option(`0x${reg}`, `0x${reg}`, command.reg)).join('')}</select></label>${write ? `<label>Data bytes (hex, space separated) <input class="seq-input" data-field="data" value="${esc(command.data?.join(' ') || '')}" placeholder="0x00 0x00"></label>` : `<label>Width <select class="seq-input" data-field="len">${option('1', '1 byte', String(command.len))}${option('2', '2 bytes', String(command.len))}</select></label>`}`;
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
  const options = step.type === 'delay' ? `<label>Duration (ms) <input class="seq-input" type="number" min="1" max="600000" data-field="durationMs" value="${esc(step.durationMs)}"></label>` : step.type === 'waitUntil' ? `${conditionHtml(step.condition, [step.id])}<label>Timeout (ms) <input class="seq-input" type="number" min="1" max="600000" data-field="timeoutMs" value="${esc(step.timeoutMs)}"></label>` : step.type === 'if' ? conditionHtml(step.condition, [step.id]) : commandHtml(step);
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
  $('seqValidation').innerHTML = errors.length ? `<strong>${errors.length} validation issue${errors.length === 1 ? '' : 's'}</strong><ul>${errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>` : '<span class="seq-valid">Visual Code is ready to save.</span>';
  $('seqSave').disabled = !canOperate() || busy || errors.length > 0;
  $('seqDuplicate').disabled = !draft.id || !canOperate() || busy;
  const dirty = !draft.id || JSON.stringify(draft) !== savedSnapshot;
  $('seqSimulate').disabled = !canOperate() || busy || errors.length > 0 || dirty || !!execution && ['running', 'paused'].includes(execution.state);
  $('seqLive').disabled = $('seqSimulate').disabled;
  $('seqPause').disabled = !canOperate() || execution?.state !== 'running';
  $('seqResume').disabled = !canOperate() || execution?.state !== 'paused';
  $('seqStop').disabled = !canOperate() || !['running', 'paused'].includes(execution?.state);
  $('seqConfirmRun').disabled = !canOperate() || !confirmation;
  $('seqRunState').textContent = execution ? `${execution.mode} · ${execution.state}` : 'Idle';
  const completed = events.filter((event) => event.type === 'block_completed').length;
  const total = execution?.definition ? countBlocks(execution.definition.steps) : countBlocks(draft.steps);
  $('seqProgress').value = execution?.state === 'completed' ? 100 : total ? Math.round(100 * completed / total) : 0;
  const lastStarted = [...events].reverse().find((event) => event.type === 'block_started');
  const activeId = lastStarted && !events.some((event) => event.event_order > lastStarted.event_order && ['block_completed', 'block_failed'].includes(event.type) && event.block_id === lastStarted.block_id) ? lastStarted.block_id : null;
  const executionBlock = activeId && execution?.definition ? (() => { const walk = (steps) => { for (const step of steps) { if (step.id === activeId) return step; if (step.type === 'if') { const found = walk(step.then) || walk(step.else); if (found) return found; } } return null; }; return walk(execution.definition.steps); })() : null;
  $('seqProgressLabel').textContent = execution ? `${completed} completed · ${total} blocks · ${execution.state}${activeId ? ` · active ${labelFor(executionBlock?.type || '')} (${activeId.slice(0, 8)})` : ''}` : 'No execution selected';
  document.querySelectorAll('.seq-block.active').forEach((node) => node.classList.remove('active'));
  if (activeId) document.querySelectorAll('.seq-block').forEach((node) => { if (node.dataset.id === activeId) node.classList.add('active'); });
  const lastError = [...events].reverse().find((event) => event.type === 'command_error' || event.type === 'condition' && event.details?.error);
  $('seqRunError').textContent = execution?.reason ? `${failureText[execution.reason] || execution.reason}${lastError?.details?.error ? ` ${lastError.details.error}` : ''}` : '';
  const recoveryNeeded = execution?.mode === 'live' && ['command_outcome_unknown', 'bridge_restart'].includes(execution.reason) && !execution.recovery_ms;
  $('seqRecovery').hidden = !recoveryNeeded;
  $('seqRecover').disabled = !recoveryNeeded || !canOperate() || !$('seqReviewed').checked || !$('seqToken').value.trim();
  $('seqEvents').innerHTML = events.slice(-30).map((event) => `<li><time>${esc(new Date(event.at_ms).toLocaleTimeString())}</time> ${esc(event.type.replaceAll('_', ' '))}${event.details?.selected ? ` · ${event.details.selected === 'then' ? 'TRUE' : 'FALSE'}` : ''}${event.details?.error ? ` · ${esc(event.details.error)}` : ''}</li>`).join('');
}
function updateSaved() { $('seqSaved').innerHTML = `<option value="">New Visual Code</option>${saved.map((item) => option(item.id, `${item.name} · r${item.revision}`, draft.id)).join('')}`; }
async function loadSaved() { saved = (await request('/sequences')).sequences || []; updateSaved(); }
async function save() {
  const errors = validateDraft(draft); if (errors.length) { notice('Fix validation issues before saving.', true); render(); return false; }
  if (!canOperate()) { notice('Active operator access is required.', true); return false; }
  busy = true; render();
  try {
    const method = draft.id ? 'PUT' : 'POST';
    const data = await request(draft.id ? `/sequences/${encodeURIComponent(draft.id)}` : '/sequences', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
    draft = data.sequence; savedSnapshot = JSON.stringify(draft); await loadSaved(); notice(`Saved revision ${draft.revision}.`); return true;
  } catch (error) { notice(`Save failed: ${error.message}`, true); return false; }
  finally { busy = false; render(); }
}
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
      $('seqConfirmText').textContent = `Confirm ${data.name} revision ${data.revision} on device ${data.device_id} at ${data.target.address}:${data.target.port}. Token expires in 30 seconds.`;
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
function handleChange(event) {
  const el = event.target;
  if (el.id === 'seqName') { draft.name = el.value; render(false); return; }
  if (el.dataset.condOp) {
    const address = JSON.parse(decodeURIComponent(el.dataset.condOp)), op = el.value;
    replaceCondition(address, op === 'AND' || op === 'OR' ? { op, conditions: [comparison(), comparison()] } : op === 'NOT' ? { op, condition: comparison() } : { ...comparison(), op }); render(); return;
  }
  if (el.dataset.condition) {
    const [key, side] = el.dataset.condition.split(':'), condition = conditionAt(JSON.parse(decodeURIComponent(key))); if (!condition) return;
    const value = condition[side];
    if (el.dataset.field === 'kind') condition[side] = el.value === 'metric' ? { metric: METRICS[0].id } : el.value === 'register' ? { register: CONDITION_REGISTERS[0].id } : el.value === 'fault' ? { fault: CONDITION_FAULTS[0] } : { constant: 0, unit: 'V' };
    if (el.dataset.field === 'metric') condition[side] = { metric: el.value };
    if (el.dataset.field === 'register') condition[side] = { register: el.value };
    if (el.dataset.field === 'fault') condition[side] = { fault: el.value };
    if (el.dataset.field === 'unit') condition[side] = { constant: el.value === 'boolean' ? false : 0, unit: el.value };
    if (el.dataset.field === 'constant') condition[side].constant = condition[side].unit === 'boolean' ? el.value === 'true' : condition[side].unit === 'hex' ? /^0x[0-9a-f]+$/i.test(el.value) ? Number(el.value) : NaN : el.value === '' ? NaN : Number(el.value);
    render(); return;
  }
  const article = el.closest('.seq-block'); if (!article || !el.dataset.field) return;
  const step = stepById(article.dataset.id), field = el.dataset.field; if (!step) return;
  if (field === 'commandType') step.command = commandFor(el.value);
  else if (field === 'durationMs' || field === 'timeoutMs') step[field] = el.value === '' ? NaN : Number(el.value);
  else if (field === 'addr') { step.command.addr = el.value; const writing = step.type === 'registerWrite' || step.command.type === 'i2c_write'; step.command.reg = el.value === '0x40' ? (writing ? '0x05' : '0x00') : el.value === '0x08' ? (writing ? '0x3E' : '0x14') : '0x0F'; const width = el.value === '0x6B' ? 1 : 2; if (writing) { delete step.command.len; step.command.data = Array(width).fill('0x00'); } else step.command.len = width; }
  else if (field === 'reg') { step.command.reg = el.value; const width = step.command.addr === '0x6B' && !['0x31','0x33','0x35','0x37','0x39','0x3B','0x3D','0x41'].includes(el.value) ? 1 : 2; if (step.type === 'registerWrite' || step.command.type === 'i2c_write') { delete step.command.len; step.command.data = Array(width).fill('0x00'); } else step.command.len = width; }
  else if (field === 'data') step.command.data = el.value.trim().split(/\s+/).filter(Boolean);
  else if (field === 'len' || field === 'period_ms') step.command[field] = Number(el.value);
  else if (field === 'enabled') step.command.enabled = el.value === 'true';
  else if (field === 'probeAddr') step.command.addr = el.value;
  else step.command[field] = el.value;
  render();
}
function handleClick(event) {
  const el = event.target.closest('button'); if (!el) return;
  if (el.dataset.add) { if (countBlocks(draft.steps) >= 200) return; const list = currentList(); list.splice(selectedIndex === null ? list.length : selectedIndex, 0, makeBlock(el.dataset.add)); if (selectedIndex !== null) selectedIndex++; render(); return; }
  if (el.dataset.insert) { selectedPath = decodePath(el.dataset.insert); selectedIndex = Number(el.dataset.index); selectedId = null; render(); return; }
  if (el.dataset.select) { selectedId = selectedId === el.dataset.select ? null : el.dataset.select; render(); return; }
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
  alive = true; draft = fresh(); savedSnapshot = null; selectedPath = []; selectedIndex = null; selectedId = null; execution = null; events = []; lastEvent = 0; busy = false; confirmation = null; polling = false;
  historyView = mountSequenceHistory($('sequenceHistory'));
  $('seqPaletteList').innerHTML = BLOCKS.map(([type, label]) => `<div class="seq-palette-item" draggable="true" data-palette="${type}"><span>${esc(label)}</span><button class="seq-mini" type="button" data-add="${type}" aria-label="Add ${esc(label)} to selected path">Add</button></div>`).join('');
  $('seqPaletteList').addEventListener('click', handleClick); $('seqCanvas').addEventListener('click', handleClick);
  $('seqCanvas').addEventListener('change', handleChange);
  $('seqName').addEventListener('input', handleChange);
  $('seqNew').addEventListener('click', () => { savedSnapshot = null; draft = fresh(); $('seqName').value = ''; selectedPath = []; selectedIndex = null; selectedId = null; updateSaved(); render(); notice('New Visual Code.'); });
  $('seqLoad').addEventListener('click', async () => { const id = $('seqSaved').value; if (!id) return; try { draft = (await request(`/sequences/${encodeURIComponent(id)}`)).sequence; savedSnapshot = JSON.stringify(draft); $('seqName').value = draft.name; selectedPath = []; selectedIndex = null; selectedId = null; render(); notice(`Loaded revision ${draft.revision}.`); } catch (error) { notice(`Load failed: ${error.message}`, true); } });
  $('seqDuplicate').addEventListener('click', () => { draft = cloneSequence(draft); savedSnapshot = null; $('seqName').value = draft.name; updateSaved(); render(); notice('Copy created. Save to keep it.'); });
  $('seqSave').addEventListener('click', save);
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
  try { await loadSaved(); const recent = (await request('/sequence-executions')).executions?.find((item) => ['running', 'paused'].includes(item.state)); if (recent) { execution = recent; await pollExecution(); timer = setInterval(pollExecution, 750); } }
  catch (error) { notice(`Visual Code service unavailable: ${error.message}`, true); }
}
export function destroySequencesPage() { alive = false; clearInterval(timer); timer = null; historyView?.dispose(); historyView = null; }
