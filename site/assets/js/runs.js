import { apiFetch, canOperate } from './auth.js?v=20261022a';
import {
  RUN_METRICS, MAX_SERIES_WINDOW_MS, formatDuration, formatRelativeTime, metricValue,
  nearestBucket, responseSummary, responseWindow, runEnd, runMatches, seriesExtent,
  windowForPreset
} from './runs-model.mjs?v=20261023b';

const API = '/telemetry/runs';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SOURCE_LABELS = { pv: 'PV', bat_secondary: 'BAT/secondary' };
const TYPE_LABELS = { debug: 'Debug', live_telemetry: 'Live telemetry' };
const EVENT_LABELS = {
  run_started: 'Run started', run_ended: 'Run ended', source_switch: 'Source switched',
  mode_changed: 'Mode changed', command_status: 'Command status', sequence_step: 'Sequence step'
};

let destroyed = false;
let refreshTimer;
let controller;
let runs = [];
let selectedRun = null;
let currentWindow = null;
let series = [];
let events = [];
let selectedBucket = null;
let selectedBucketIndex = -1;
let sampleAfter = null;
let eventAfter = null;
let runOffset = 0;
let hasMoreRuns = false;
let filter = 'all';

const $ = (id) => document.getElementById(id);
const text = (id, value) => { const node = $(id); if (node) node.textContent = value; };
const show = (id, visible) => { const node = $(id); if (node) node.hidden = !visible; };

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function localDateTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms), offset = date.getTimezoneOffset() * 60_000;
  return new Date(ms - offset).toISOString().slice(0, 23);
}

function dateLabel(ms, withDate = true) {
  if (!Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat(undefined, {
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
  }).format(new Date(ms));
}

function sourceLabel(source) { return SOURCE_LABELS[source] || (source ? String(source) : 'Unconfirmed'); }
function responseMode() { return $('analysisMode')?.value === 'response'; }
function selectedTrigger() {
  const id = Number($('responseTrigger')?.value);
  return events.find((event) => event.id === id) || null;
}
function analysisTimeLabel(ms) {
  const trigger = responseMode() ? selectedTrigger() : null;
  return trigger ? formatRelativeTime(ms - trigger.at_ms) : dateLabel(ms, false);
}
function reasonLabel(reason) {
  return ({ operator_stop: 'Stopped by operator', source_switch: 'Power source switched', debug_exit: 'Debug ended',
    bridge_restart: 'Bridge restarted', graceful_shutdown: 'Bridge stopped', queue_overflow: 'Recorder overflow' })[reason] ||
    (reason ? String(reason).replaceAll('_', ' ') : 'In progress');
}

function eventDescription(event) {
  const details = event.details || {};
  if (event.type === 'sequence_step') {
    return `${details.sequence_name || 'Sequence'} · line ${details.step_number ?? '?'} ${details.phase || ''}`.trim();
  }
  if (event.type === 'command_status') return details.label || details.summary || 'Command status';
  if (event.type === 'source_switch') return `${sourceLabel(details.from_source)} → ${sourceLabel(details.to_source)}`;
  if (event.type === 'mode_changed') return `${TYPE_LABELS[details.from_mode] || details.from_mode || 'unknown'} → ${TYPE_LABELS[details.to_mode] || details.to_mode || 'unknown'}`;
  return EVENT_LABELS[event.type] || event.type;
}

function populateResponseTriggers() {
  const select = $('responseTrigger'); if (!select) return;
  const previous = Number(select.value);
  const preferredTypes = new Set(['run_started', 'source_switch', 'mode_changed', 'command_status', 'sequence_step']);
  let candidates = events.filter((event) => preferredTypes.has(event.type));
  if (!candidates.length) candidates = events;
  select.replaceChildren();
  for (const event of candidates) {
    const option = document.createElement('option'); option.value = String(event.id);
    option.textContent = `${dateLabel(event.at_ms, false)} · ${eventDescription(event)}`;
    select.append(option);
  }
  const fallback = candidates.find((event) => event.type === 'sequence_step' && event.details?.phase === 'started') ||
    candidates.find((event) => event.type === 'command_status') ||
    candidates.find((event) => event.type === 'run_started') || candidates[0];
  const chosen = candidates.find((event) => event.id === previous) || fallback;
  if (chosen) select.value = String(chosen.id);
}

function updateAnalysisControls() {
  const response = responseMode();
  show('timelineWindowControl', !response); show('responseControls', response); show('responseHelp', response);
  show('customWindow', !response && $('seriesWindow').value === 'custom');
  if (response) populateResponseTriggers();
  text('analysisTitle', response ? 'Frequency response' : 'Measurement timeline');
  text('chartTitle', response ? 'Trigger-aligned telemetry response' : 'Telemetry measurement timeline');
}

async function api(path = '', options = {}) {
  const response = await apiFetch(API + path, { cache: 'no-store', ...options });
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { status: response.status });
  return body;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

function updateCapture(recording = {}) {
  const activeId = recording.active_run_id || runs.find((run) => run.status === 'recording')?.id;
  const operator = canOperate();
  $('runName').disabled = !operator || !!activeId;
  $('runStart').disabled = !operator || !!activeId;
  $('runStop').disabled = !operator || !activeId;
  text('captureHelp', operator
    ? activeId ? 'A run is recording. Stop it before starting another.' : 'A recording begins with the latest fresh hardware packet.'
    : 'Viewer access can inspect runs. An operator account is required to record.');
  const state = $('runsBridgeState');
  state.className = `status-pill ${activeId ? 'online' : ''}`;
  state.textContent = activeId ? 'Recording active' : 'Recorder ready';
}

function renderRunList() {
  const list = $('runList');
  list.replaceChildren();
  const matches = runs.filter((run) => runMatches(run, $('runSearch').value, filter));
  text('runCount', `${matches.length}${hasMoreRuns ? '+' : ''} shown`);
  show('runListEmpty', matches.length === 0);
  for (const run of matches) {
    const item = element('li');
    const button = element('button', 'run-list-item');
    button.type = 'button';
    button.dataset.runId = run.id;
    button.classList.toggle('selected', run.id === selectedRun?.id);
    button.setAttribute('aria-current', run.id === selectedRun?.id ? 'true' : 'false');
    const top = element('span', 'run-list-top');
    top.append(element('strong', '', run.name), element('span', `run-state ${run.status}`, run.status === 'recording' ? 'Recording' : reasonLabel(run.end_reason)));
    const meta = element('span', 'run-list-meta', `${TYPE_LABELS[run.run_type] || run.run_type} · ${sourceLabel(run.current_source)}`);
    const bottom = element('span', 'run-list-bottom');
    bottom.append(element('time', '', dateLabel(run.started_ms)), element('span', '', `${run.sample_count} packets · ${formatDuration(runEnd(run) - run.started_ms)}`));
    button.append(top, meta, bottom);
    button.addEventListener('click', () => selectRun(run.id));
    item.append(button); list.append(item);
  }
  show('runsLoadMore', hasMoreRuns && filter === 'all' && !$('runSearch').value.trim());
}

async function loadRuns({ append = false, preserveSelection = true } = {}) {
  try {
    if (!append) { runOffset = 0; show('runListSkeleton', true); }
    const body = await api(`?limit=50&offset=${runOffset}`);
    if (destroyed) return;
    runs = append ? [...runs, ...body.runs] : body.runs;
    runOffset = runs.length;
    hasMoreRuns = body.runs.length === 50;
    show('runsError', false); show('runListSkeleton', false);
    updateCapture(body.recording);
    renderRunList();
    if (selectedRun && preserveSelection) {
      const refreshed = runs.find((run) => run.id === selectedRun.id);
      if (refreshed) { selectedRun = refreshed; renderRunHeader(); }
    } else if (!selectedRun && runs.length) await selectRun(runs[0].id);
  } catch (error) {
    if (error.name === 'AbortError' || destroyed) return;
    show('runListSkeleton', false); show('runsError', true);
    text('runsErrorText', error.status === 503 && /not enabled/i.test(error.message)
      ? 'Recording is not enabled on this bridge. Configure RECORDING_DB_PATH and restart the bridge.'
      : `${error.message}. Check the telemetry bridge and try again.`);
    $('runsBridgeState').className = 'status-pill offline'; text('runsBridgeState', 'Recorder unavailable');
  }
}

function fact(term, description) {
  const wrap = element('div'); wrap.append(element('dt', '', term), element('dd', '', description)); return wrap;
}

function renderRunHeader() {
  if (!selectedRun) return;
  text('runDetailName', selectedRun.name);
  const status = $('runDetailStatus'); status.textContent = selectedRun.status === 'recording' ? 'Recording' : selectedRun.status;
  status.className = `status-pill ${selectedRun.status === 'recording' ? 'online' : selectedRun.status === 'interrupted' ? 'offline' : ''}`;
  text('runDetailDescription', `${TYPE_LABELS[selectedRun.run_type] || selectedRun.run_type} · ${sourceLabel(selectedRun.current_source)} · ${reasonLabel(selectedRun.end_reason)}`);
  const facts = $('runFacts'); facts.replaceChildren(
    fact('Started', dateLabel(selectedRun.started_ms)),
    fact('Duration', formatDuration(runEnd(selectedRun) - selectedRun.started_ms)),
    fact('Packets', String(selectedRun.sample_count)),
    fact('Device', selectedRun.device_id || '—'),
    fact('Last sequence', selectedRun.last_seq ?? '—'),
    fact('Run ID', selectedRun.id)
  );
  for (const [id, target] of [['runPrevious', selectedRun.previous_run_id], ['runNext', selectedRun.next_run_id]]) {
    const button = $(id); button.hidden = !target; button.onclick = target ? () => selectRun(target) : null;
  }
  renderRunList();
}

async function selectRun(id) {
  try {
    text('seriesState', 'Loading run…');
    const body = await api(`/${encodeURIComponent(id)}`);
    if (destroyed) return;
    selectedRun = body.run; selectedBucket = null; selectedBucketIndex = -1; events = [];
    show('runDetailEmpty', false); show('runDetailContent', true);
    renderRunHeader();
    $('analysisMode').value = 'timeline'; $('seriesWindow').value = 'full'; updateAnalysisControls();
    const window = windowForPreset(selectedRun, 'full');
    setCustomInputs(window);
    await loadAnalysis(window);
  } catch (error) { text('seriesState', error.message); }
}

function setCustomInputs(window) {
  $('seriesStart').value = localDateTime(window.start);
  $('seriesEnd').value = localDateTime(window.end);
}

function selectedMetric() { return RUN_METRICS.find((metric) => metric.id === $('seriesMetric').value) || RUN_METRICS[0]; }

async function loadAllEvents(id) {
  let after = 0, all = [];
  do {
    const body = await api(`/${encodeURIComponent(id)}/events?limit=500&after=${after}`);
    all = all.concat(body.items); after = body.next_after;
  } while (after && all.length < 5000 && !destroyed);
  return all;
}

async function loadAnalysis(window) {
  if (!selectedRun) return;
  currentWindow = window; selectedBucket = null; selectedBucketIndex = -1;
  show('seriesLoading', true); show('seriesEmpty', false); show('chartFrame', false);
  text('seriesState', 'Loading graph…');
  const query = new URLSearchParams({ metric: selectedMetric().id, start: String(window.start), end: String(window.end), points: '480' });
  try {
    const [seriesBody, allEvents] = await Promise.all([
      api(`/${encodeURIComponent(selectedRun.id)}/series?${query}`), loadAllEvents(selectedRun.id)
    ]);
    if (destroyed) return;
    series = seriesBody.points; events = allEvents; eventAfter = null; populateResponseTriggers();
    show('seriesLoading', false); show('seriesEmpty', seriesExtent(series) === null); show('chartFrame', seriesExtent(series) !== null);
    text('seriesState', series.length ? `${series.length} time buckets` : 'No samples');
    const trigger = responseMode() ? selectedTrigger() : null;
    text('windowSummary', trigger
      ? `${formatRelativeTime(window.start - trigger.at_ms)} to ${formatRelativeTime(window.end - trigger.at_ms)} · trigger ${dateLabel(trigger.at_ms)}`
      : `${dateLabel(window.start)} to ${dateLabel(window.end)} · ${formatDuration(window.end - window.start)}` +
        (window.end - window.start >= MAX_SERIES_WINDOW_MS ? ' · limited to 24 hours' : ''));
    renderResponseSummary();
    renderChart(); renderEventMarkers(); renderEvents(true); await loadSamples(true);
  } catch (error) {
    show('seriesLoading', false); show('seriesEmpty', true); show('chartFrame', false);
    show('responseSummary', false);
    text('seriesState', error.message);
  }
}

function renderResponseSummary() {
  const holder = $('responseSummary'), trigger = responseMode() ? selectedTrigger() : null;
  holder.replaceChildren(); show('responseSummary', !!trigger && seriesExtent(series) !== null);
  if (!trigger) return;
  const result = responseSummary(series, trigger.at_ms);
  const delta = Number.isFinite(result.delta)
    ? `${result.delta >= 0 ? '+' : ''}${result.delta.toFixed(selectedMetric().digits)} ${selectedMetric().unit}`
    : 'Unavailable';
  holder.append(
    fact('Pre-trigger baseline', formatValue(result.baseline)),
    fact('First bucket after T+0', formatValue(result.initial)),
    fact('Peak change', delta),
    fact('Peak time', formatRelativeTime(result.peak_at_ms)),
    fact('Post-trigger range', Number.isFinite(result.min) && Number.isFinite(result.max)
      ? `${result.min.toFixed(selectedMetric().digits)}–${result.max.toFixed(selectedMetric().digits)} ${selectedMetric().unit}` : 'Unavailable')
  );
}

function chartCoordinates(point, extent) {
  const x = 70 + ((point.start_ms + point.end_ms) / 2 - currentWindow.start) / (currentWindow.end - currentWindow.start) * 866;
  const y = (value) => 24 + (extent.max - value) / (extent.max - extent.min) * 290;
  return { x, minY: y(point.min), maxY: y(point.max), meanY: y(point.mean) };
}

function renderChart() {
  const extent = seriesExtent(series); if (!extent) return;
  const axes = $('chartAxes'), grid = $('chartGrid'); axes.replaceChildren(); grid.replaceChildren();
  for (let i = 0; i <= 4; i += 1) {
    const y = 24 + i * 72.5, value = extent.max - i * (extent.max - extent.min) / 4;
    grid.append(svgElement('line', { x1: 70, x2: 936, y1: y, y2: y, class: 'chart-grid-line' }));
    const label = svgElement('text', { x: 60, y: y + 4, class: 'chart-axis-label', 'text-anchor': 'end' });
    label.textContent = value.toFixed(selectedMetric().digits); axes.append(label);
  }
  for (let i = 0; i <= 4; i += 1) {
    const x = 70 + i * 216.5, at = currentWindow.start + i * (currentWindow.end - currentWindow.start) / 4;
    const label = svgElement('text', { x, y: 340, class: 'chart-axis-label', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' });
    label.textContent = analysisTimeLabel(at); axes.append(label);
  }
  // Separate subpaths preserve missing buckets instead of drawing invented values across gaps.
  const segments = [];
  for (const point of series) {
    if (!Number.isFinite(point.mean)) continue;
    const previous = segments.at(-1);
    const coordinates = { point, ...chartCoordinates(point, extent) };
    if (!previous || previous.at(-1).point.end_ms < point.start_ms) segments.push([coordinates]);
    else previous.push(coordinates);
  }
  const line = segments.map((segment) => segment.map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(2)},${p.meanY.toFixed(2)}`).join(' ')).join(' ');
  const band = segments.map((segment) => {
    const upper = segment.map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(2)},${p.maxY.toFixed(2)}`).join(' ');
    const lower = segment.slice().reverse().map((p) => `L${p.x.toFixed(2)},${p.minY.toFixed(2)}`).join(' ');
    return `${upper}${lower}Z`;
  }).join(' ');
  $('chartLine').setAttribute('d', line); $('chartBand').setAttribute('d', band);
  renderChartMarkers(); updateChartSelection();
  text('metricColumn', `${selectedMetric().label} (${selectedMetric().unit})`);
  const trigger = responseMode() ? selectedTrigger() : null;
  $('seriesChart').setAttribute('aria-label', trigger
    ? `${selectedMetric().label} from ${formatRelativeTime(currentWindow.start - trigger.at_ms)} to ${formatRelativeTime(currentWindow.end - trigger.at_ms)}`
    : `${selectedMetric().label} from ${dateLabel(currentWindow.start)} to ${dateLabel(currentWindow.end)}`);
}

function renderChartMarkers() {
  const group = $('chartMarkers'); group.replaceChildren();
  const trigger = responseMode() ? selectedTrigger() : null;
  for (const event of events.filter((item) => item.at_ms >= currentWindow.start && item.at_ms <= currentWindow.end)) {
    const x = 70 + (event.at_ms - currentWindow.start) / (currentWindow.end - currentWindow.start) * 866;
    const active = event.id === trigger?.id ? ' chart-event-trigger' : '';
    group.append(svgElement('line', { x1: x, x2: x, y1: 24, y2: 314, class: `chart-event chart-event-${event.type}${active}` }));
  }
}

function updateChartSelection() {
  const line = $('chartSelection');
  if (!selectedBucket) { line.hidden = true; return; }
  const x = 70 + (((selectedBucket.start_ms + selectedBucket.end_ms) / 2 - currentWindow.start) / (currentWindow.end - currentWindow.start)) * 866;
  line.setAttribute('x1', x); line.setAttribute('x2', x); line.hidden = false;
}

async function chooseBucket(bucket) {
  selectedBucket = bucket; selectedBucketIndex = series.indexOf(bucket); updateChartSelection();
  const range = responseMode()
    ? `${analysisTimeLabel(bucket.start_ms)} to ${analysisTimeLabel(bucket.end_ms)}`
    : `${dateLabel(bucket.start_ms)} to ${dateLabel(bucket.end_ms)}`;
  text('selectedBucket', `${range} · ${bucket.valid_count} numeric of ${bucket.sample_count} packets · mean ${formatValue(bucket.mean)}`);
  text('tableScope', 'Packets represented by the selected graph bucket.');
  await loadSamples(true);
  $('packetsTab').click();
  $('packetsPanel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

function formatValue(value) {
  return Number.isFinite(value) ? `${value.toFixed(selectedMetric().digits)} ${selectedMetric().unit}` : 'Unavailable';
}

function renderEventMarkers() {
  const holder = $('eventMarkers'); holder.replaceChildren();
  const visible = events.filter((event) => event.at_ms >= currentWindow.start && event.at_ms <= currentWindow.end);
  for (const event of visible) {
    const button = element('button', `event-marker event-${event.type}`, `${EVENT_LABELS[event.type] || event.type} · ${analysisTimeLabel(event.at_ms)}`);
    button.type = 'button'; button.addEventListener('click', () => {
      $('eventsTab').click(); document.querySelector(`[data-event-id="${event.id}"]`)?.focus();
    }); holder.append(button);
  }
  if (!visible.length) holder.append(element('span', 'event-marker-empty', 'No event markers in this window'));
}

function sampleWindow() {
  return selectedBucket ? { start: selectedBucket.start_ms, end: selectedBucket.end_ms } : currentWindow;
}

async function loadSamples(reset) {
  if (!selectedRun || !currentWindow) return;
  if (reset) { sampleAfter = 0; $('sampleRows').replaceChildren(); }
  const window = sampleWindow();
  const query = new URLSearchParams({ start: String(window.start), end: String(window.end), limit: '100', after: String(sampleAfter || 0) });
  try {
    const body = await api(`/${encodeURIComponent(selectedRun.id)}/samples?${query}`);
    if (destroyed) return;
    for (const sample of body.items) renderSample(sample);
    sampleAfter = body.next_after;
    show('samplesLoadMore', !!sampleAfter); show('samplesEmpty', $('sampleRows').children.length === 0);
  } catch (error) { text('tableScope', `Packets could not be loaded: ${error.message}`); }
}

function renderSample(sample) {
  const row = document.createElement('tr');
  const sampleTime = responseMode() ? `${analysisTimeLabel(sample.received_ms)} · ${dateLabel(sample.received_ms, false)}` : dateLabel(sample.received_ms, false);
  for (const value of [sampleTime, sample.seq ?? '—', TYPE_LABELS[sample.mode] || sample.mode || '—',
    sourceLabel(sample.power_source), sample.packet_order, formatValue(metricValue(sample, selectedMetric().id))]) {
    row.append(element('td', '', String(value)));
  }
  const detailsCell = document.createElement('td'), details = document.createElement('details'), summary = document.createElement('summary');
  summary.textContent = 'Inspect';
  const pre = document.createElement('pre'); pre.textContent = JSON.stringify(sample.envelope, null, 2);
  details.append(summary, pre); detailsCell.append(details); row.append(detailsCell); $('sampleRows').append(row);
}

function detailsLabel(details) {
  if (details.label) return details.label;
  if (details.sequence_name) return `${details.sequence_name} · step ${details.step_number} ${details.phase}: ${details.step_text}`;
  if (details.reason) return reasonLabel(details.reason);
  if (details.from_mode || details.to_mode) return `${TYPE_LABELS[details.from_mode] || details.from_mode || 'unknown'} → ${TYPE_LABELS[details.to_mode] || details.to_mode || 'unknown'}`;
  if (details.summary) return details.summary;
  return Object.entries(details).slice(0, 4).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value ?? '—'}`).join(' · ') || '—';
}

function renderEvents(reset) {
  if (reset) $('eventRows').replaceChildren();
  for (const event of events) {
    const row = document.createElement('tr'); row.dataset.eventId = event.id; row.tabIndex = -1;
    row.append(element('td', '', dateLabel(event.at_ms)), element('td', '', EVENT_LABELS[event.type] || event.type), element('td', '', detailsLabel(event.details)));
    $('eventRows').append(row);
  }
  show('eventsEmpty', events.length === 0); show('eventsLoadMore', !!eventAfter);
}

async function startRun(event) {
  event.preventDefault();
  const button = $('runStart'); setBusy(button, true, 'Starting…'); text('captureMessage', '');
  try {
    const body = await api('/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('runName').value.trim() }) });
    $('runName').value = ''; text('captureMessage', `Recording “${body.run.name}” started.`); selectedRun = null;
    await loadRuns({ preserveSelection: false });
  } catch (error) { text('captureMessage', error.message); }
  finally { setBusy(button, false, 'Starting…'); updateCapture(); }
}

async function stopRun() {
  const button = $('runStop'); setBusy(button, true, 'Stopping…'); text('captureMessage', '');
  try {
    const body = await api('/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    text('captureMessage', `Recording “${body.run.name}” stopped.`); await loadRuns();
  } catch (error) { text('captureMessage', error.message); }
  finally { setBusy(button, false, 'Stopping…'); updateCapture(); }
}

function requestedWindow() {
  if (responseMode()) {
    const trigger = selectedTrigger();
    if (!trigger) throw new Error('This run has no event available as an initialization trigger.');
    return responseWindow(trigger.at_ms, Number($('responseBefore').value), Number($('responseAfter').value));
  }
  if ($('seriesWindow').value !== 'custom') return windowForPreset(selectedRun, $('seriesWindow').value);
  const start = new Date($('seriesStart').value).getTime(), end = new Date($('seriesEnd').value).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Choose a valid start and end time.');
  if (end - start > MAX_SERIES_WINDOW_MS) throw new Error('Custom graph windows are limited to 24 hours.');
  return { start, end };
}

function setTab(name) {
  const packets = name === 'packets';
  $('packetsTab').classList.toggle('active', packets); $('eventsTab').classList.toggle('active', !packets);
  $('packetsTab').setAttribute('aria-selected', String(packets)); $('eventsTab').setAttribute('aria-selected', String(!packets));
  $('packetsPanel').hidden = !packets; $('eventsPanel').hidden = packets;
}

function bindEvents() {
  $('runStartForm').addEventListener('submit', startRun); $('runStop').addEventListener('click', stopRun);
  $('runsRetry').addEventListener('click', () => loadRuns()); $('runsRefresh').addEventListener('click', () => loadRuns());
  $('runsLoadMore').addEventListener('click', () => loadRuns({ append: true }));
  $('runSearch').addEventListener('input', renderRunList);
  $('runFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-run-filter]'); if (!button) return;
    filter = button.dataset.runFilter; $('runFilters').querySelectorAll('button').forEach((node) => node.classList.toggle('active', node === button)); renderRunList();
  });
  $('analysisMode').addEventListener('change', async () => {
    updateAnalysisControls();
    if (!selectedRun) return;
    try { const window = requestedWindow(); if (!responseMode()) setCustomInputs(window); await loadAnalysis(window); }
    catch (error) { text('seriesState', error.message); }
  });
  $('seriesWindow').addEventListener('change', updateAnalysisControls);
  $('responseTrigger').addEventListener('change', async () => {
    if (!selectedRun || !responseMode()) return;
    try { await loadAnalysis(requestedWindow()); } catch (error) { text('seriesState', error.message); }
  });
  $('seriesForm').addEventListener('submit', async (event) => { event.preventDefault(); try { const window = requestedWindow(); setCustomInputs(window); await loadAnalysis(window); } catch (error) { text('seriesState', error.message); } });
  $('seriesMetric').addEventListener('change', () => loadAnalysis(currentWindow || windowForPreset(selectedRun, 'full')));
  $('seriesChart').addEventListener('click', (event) => {
    const rect = $('seriesChart').getBoundingClientRect(), viewX = (event.clientX - rect.left) / rect.width * 960;
    const at = currentWindow.start + Math.max(0, Math.min(1, (viewX - 70) / 866)) * (currentWindow.end - currentWindow.start);
    const bucket = nearestBucket(series.filter((point) => Number.isFinite(point.mean)), at); if (bucket) chooseBucket(bucket);
  });
  $('seriesChart').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const valid = series.filter((point) => Number.isFinite(point.mean)); if (!valid.length) return; event.preventDefault();
    let index = selectedBucket ? valid.indexOf(selectedBucket) : 0;
    if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
    if (event.key === 'ArrowRight') index = Math.min(valid.length - 1, index + 1);
    if (event.key === 'Home') index = 0; if (event.key === 'End') index = valid.length - 1;
    chooseBucket(valid[index]);
  });
  $('selectedBucket').addEventListener('dblclick', () => { selectedBucket = null; selectedBucketIndex = -1; updateChartSelection(); text('selectedBucket', 'Graph selection cleared.'); text('tableScope', 'Packets in the selected time window.'); loadSamples(true); });
  $('samplesLoadMore').addEventListener('click', () => loadSamples(false));
  $('packetsTab').addEventListener('click', () => setTab('packets')); $('eventsTab').addEventListener('click', () => setTab('events'));
}

export async function initRunsPage() {
  destroyed = false; controller = new AbortController();
  const metricSelect = $('seriesMetric');
  for (const metric of RUN_METRICS) { const option = document.createElement('option'); option.value = metric.id; option.textContent = `${metric.label} (${metric.unit})`; metricSelect.append(option); }
  metricSelect.value = 'pv.powerW'; bindEvents(); await loadRuns();
  refreshTimer = setInterval(() => { if (!document.hidden && runs.some((run) => run.status === 'recording')) loadRuns(); }, 5000);
}

export function destroyRunsPage() {
  destroyed = true; clearInterval(refreshTimer); controller?.abort();
  runs = []; selectedRun = null; series = []; events = []; currentWindow = null;
}
