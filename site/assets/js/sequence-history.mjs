import { apiFetch } from './auth.js?v=20261028d';

const date = (ms) => ms ? new Date(ms).toLocaleString() : 'In progress';
const explanation = {
  bridge_restart: 'Bridge restarted before execution finished.',
  operator_authorization_lost: 'Operator connection or ownership was lost.',
  condition_timeout: 'Condition did not become TRUE before the timeout.',
  command_failed: 'The device or command transport reported a failure.',
  command_outcome_unknown: 'No device response before timeout; inspect hardware before another write.',
  canceled: 'Stopped by an operator.',
  stale_telemetry: 'Fresh hardware telemetry was lost.',
  stale_accepted_telemetry: 'No fresh telemetry arrived from the selected device.',
  device_connection_changed: 'The connected device or endpoint changed.',
  device_reboot: 'The device rebooted during execution.',
  maximum_duration: 'The maximum execution duration expired.',
  pause_timeout: 'The pause limit expired.',
  storage_failure: 'Run recording failed.'
};
async function get(path) {
  const response = await apiFetch(`/telemetry${path}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
function node(tag, content, className = '') {
  const item = document.createElement(tag);
  item.textContent = content;
  if (className) item.className = className;
  return item;
}
function summary(event) {
  const details = event.details || {};
  if (event.type === 'branch') return `Branch ${details.result ? 'TRUE' : 'FALSE'} → ${details.selected || 'unknown'}`;
  if (event.type === 'condition') return details.error || `Condition ${details.result === true ? 'TRUE' : details.result === false ? 'FALSE' : 'unknown'}`;
  if (event.type === 'comparison') return `Comparison ${details.result === true ? 'TRUE' : details.result === false ? 'FALSE' : 'unknown'}`;
  if (event.type === 'command_result') return `Command ${details.status || 'result'}${details.result?.ok === false ? ': device reported failure' : ''}`;
  if (event.type === 'command_error') return `Command error: ${details.error || 'unknown error'}`;
  if (event.type === 'block_failed') return `Step failed: ${details.error || 'unknown error'}`;
  if (event.type === 'state') return `Run ${details.state}${details.reason ? `: ${explanation[details.reason] || details.reason}` : ''}`;
  return event.type.replaceAll('_', ' ');
}

export function mountSequenceHistory(container, { onRecording } = {}) {
  let disposed = false, selected = null;
  container.innerHTML = '<div class="sequence-history-heading"><h3>Sequence runs</h3><button type="button" class="seq-history-refresh">Refresh</button></div><p class="seq-history-message" role="status"></p><div class="sequence-history-layout"><ol class="seq-history-list"></ol><div class="seq-history-detail">Select a run to inspect its saved results.</div></div>';
  const list = container.querySelector('.seq-history-list');
  const detail = container.querySelector('.seq-history-detail');
  const message = container.querySelector('.seq-history-message');
  async function select(id) {
    selected = id;
    detail.replaceChildren(node('p', 'Loading saved result…'));
    try {
      const execution = (await get(`/sequence-executions/${encodeURIComponent(id)}`)).execution;
      const events = [];
      let after = 0, page;
      do {
        page = (await get(`/sequence-executions/${encodeURIComponent(id)}/events?after=${after}`)).events || [];
        events.push(...page);
        if (page.length) after = page.at(-1).event_order;
      } while (page.length === 100 && !disposed);
      if (disposed || selected !== id) return;
      detail.replaceChildren();
      detail.append(node('h4', `${execution.definition.name} · revision ${execution.revision}`),
        node('p', `${execution.mode === 'simulation' ? 'Simulation' : 'Live hardware'} · ${execution.state} · ${execution.completed_steps} completed steps`),
        node('p', `Started ${date(execution.started_ms)} · Ended ${date(execution.ended_ms)}`));
      if (execution.reason) detail.append(node('p', explanation[execution.reason] || execution.reason, 'seq-history-error'));
      if (execution.recording_run_id && onRecording) {
        const button = node('button', 'Open telemetry recording', 'seq-history-refresh');
        button.type = 'button'; button.addEventListener('click', () => onRecording(execution.recording_run_id)); detail.append(button);
      }
      const timeline = document.createElement('ol');
      for (const event of events) {
        const item = document.createElement('li');
        item.append(node('strong', `${event.block_id ? `${event.block_id} · ` : ''}${summary(event)}`),
          node('time', date(event.at_ms)));
        if (['comparison', 'condition', 'branch', 'command_result', 'command_error', 'block_failed', 'block_started'].includes(event.type)) {
          const evidence = document.createElement('details');
          evidence.append(node('summary', 'Details'), node('pre', JSON.stringify(event.details, null, 2)));
          item.append(evidence);
        }
        timeline.append(item);
      }
      if (!events.length) timeline.append(node('li', 'No steps were recorded before this run ended.'));
      detail.append(timeline);
    } catch (error) { if (!disposed) detail.replaceChildren(node('p', `Unable to load result: ${error.message}`)); }
  }
  async function refresh(preferId = null) {
    if (typeof preferId === 'string') selected = preferId;
    try {
      const executions = (await get('/sequence-executions')).executions || [];
      if (disposed) return;
      list.replaceChildren();
      for (const run of executions) {
        const item = document.createElement('li'), button = node('button', `${run.name || run.sequence_id || 'Sequence'} · r${run.revision} · ${run.mode === 'simulation' ? 'Simulation' : 'Live'} · ${run.state} · ${date(run.started_ms)}`);
        button.type = 'button'; button.className = 'seq-history-item';
        button.addEventListener('click', () => select(run.id)); item.append(button); list.append(item);
      }
      message.textContent = executions.length ? `${executions.length} recent runs` : 'No sequence runs yet.';
      if (!selected && executions.length) selected = executions[0].id;
      if (selected && executions.some((run) => run.id === selected)) await select(selected);
    } catch (error) { if (!disposed) message.textContent = `Sequence history unavailable: ${error.message}`; }
  }
  container.querySelector('.seq-history-refresh').addEventListener('click', () => refresh());
  refresh();
  return { refresh, dispose: () => { disposed = true; } };
}
