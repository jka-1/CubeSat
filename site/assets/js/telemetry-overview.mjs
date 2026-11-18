import { instrumentMarkup, renderInstruments } from './telemetry-instruments.mjs?v=20261118-power-path';
import { TelemetryOverviewModel, flattenFields } from './telemetry-overview-model.mjs';
import { WINDOWS, getStoredWindowMs, setStoredWindowMs } from './streaming-telemetry.mjs?v=20261109b';
import { fmtSI, fmtPower } from './streaming-view.mjs?v=20261118-power-path';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const format=(v,unit='',digits=2)=>{
  if(!finite(v))return 'Unavailable';
  if(unit==='W')return Math.abs(v)>0&&Math.abs(v)<.001?fmtSI(v,'W'):fmtPower(v);
  if(unit==='A')return fmtSI(v,'A');
  if(!unit&&Math.abs(v)>0&&Math.abs(v)<.001)return v.toExponential(2);
  return `${v.toFixed(digits)}${unit?' '+unit:''}`;
};
const sourceText={acdrv1:'Photovoltaic · ACDRV1',acdrv2:'BAT / secondary · ACDRV2',off:'Both paths off',both:'Both paths on',on:'On · path not reported',unknown:'Not reported'};
const clock=t=>new Date(t).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});

const plotInset = {left: 58, right: 12, top: 23, bottom: 25};
const linePatterns = [[], [7, 3], [2, 3], [8, 3, 2, 3]];

function timeDomain(series) {
  const first = Math.min(...series.map(item => item.points[0]?.[0] ?? Infinity));
  const end = series[0].end;
  const start = Number.isFinite(first) ? Math.max(series[0].start, Math.min(first, end - 1000)) : series[0].start;
  return {start, end};
}

export function drawTelemetryChart(canvas, series, {small=false, highlight=null, overlays=[], axisUnit='', accent}={}) {
  if (!canvas?.clientWidth) return;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width*dpr)) canvas.width = Math.round(width*dpr);
  if (canvas.height !== Math.round(height*dpr)) canvas.height = Math.round(height*dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,width,height);
  const theme = getComputedStyle(canvas);
  const color = name => theme.getPropertyValue(name).trim();
  const muted = color('--muted');
  const colors = [color(accent || (small ? '--dash-secondary' : '--dash-series')),color('--dash-secondary'),color('--instrument-teal'),color('--instrument-violet')];
  const datasets = [series,...overlays];
  const {start,end} = timeDomain(datasets);
  const {left,right,top,bottom} = small ? {left:2,right:3,top:3,bottom:3} : plotInset;
  const floor = height-bottom, edge = width-right;
  const x = time => left+(time-start)/(end-start)*(edge-left);
  let min = Infinity, max = -Infinity;
  for (const {points} of datasets) for (const [,value] of points) {
    if (finite(value)) { min = Math.min(min,value); max = Math.max(max,value); }
  }
  const hasValues = Number.isFinite(min);
  const pad = hasValues ? (max-min)*.06 || Math.max(Math.abs(max)*.01,.001) : 0;
  const rough = hasValues ? (max-min+2*pad)/4 : 1;
  const base = 10**Math.floor(Math.log10(rough));
  const step = ([1,2,2.5,5,10].find(n => n*base >= rough) || 10)*base;
  const low = hasValues ? Math.floor((min-pad)/step)*step : 0;
  const high = hasValues ? Math.ceil((max+pad)/step)*step : 4;
  const y = value => floor-(value-low)/(high-low)*(floor-top);
  ctx.font = `11px ${color('--font-data') || 'sans-serif'}`;
  ctx.fillStyle = muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  if (!small) {
    ctx.textAlign = 'right';
    if (axisUnit) ctx.fillText(axisUnit, left-8, 12);
    for (let i=0; i<=Math.round((high-low)/step); i++) {
      const value = low+i*step, yy = Math.round(y(value))+.5;
      ctx.strokeStyle = color('--hairline');
      ctx.beginPath(); ctx.moveTo(left,yy); ctx.lineTo(edge,yy); ctx.stroke();
      if (hasValues) {
        const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + (step/base === 2.5 ? 1 : 0)));
        const label = Math.abs(value) < step/100 ? '0' : value.toFixed(decimals);
        ctx.fillText(label.length > 7 ? value.toExponential(1) : label, left-8, yy+4);
      }
    }
    ctx.textAlign = 'left'; ctx.fillText(clock(start),left,height-4);
    if (edge-left > 320 && end-start >= 2000) {
      ctx.textAlign = 'center'; ctx.fillText(clock((start+end)/2),(left+edge)/2,height-4);
    }
    ctx.textAlign = 'right'; ctx.fillText(clock(end),edge,height-4);
  }
  if (!hasValues) {
    if (!small) {
      ctx.font = '12px Manrope, sans-serif'; ctx.textAlign = 'center';
      const message = 'No measurements in this window', center = (left+edge)/2;
      const half = ctx.measureText(message).width/2 + 9;
      ctx.fillStyle = color('--dash-surface'); ctx.fillRect(center-half,height/2-12,half*2,24);
      ctx.fillStyle = muted; ctx.fillText(message,center,height/2+4);
    }
    return;
  }
  ctx.lineJoin = 'round';
  datasets.forEach(({points}, index) => {
    const stroke = colors[index];
    ctx.strokeStyle = ctx.fillStyle = stroke;
    ctx.lineWidth = small ? 1.4 : 2;
    ctx.setLineDash(linePatterns[index]);
    ctx.beginPath();
    let previous = null;
    for (let i=0; i<points.length; i++) {
      const [time,value] = points[i];
      if (!finite(value)) { previous = null; continue; }
      if (previous === null) ctx.moveTo(x(time),y(value));
      else ctx.lineTo(x(time),y(value));
      if (previous === null && !finite(points[i+1]?.[1])) ctx.fillRect(x(time)-1,y(value)-1,2,2);
      previous = value;
    }
    ctx.stroke();
    const last = points.at(-1);
    if (last && finite(last[1])) {
      ctx.beginPath(); ctx.arc(x(last[0]),y(last[1]),small ? 1.8 : 2.7,0,Math.PI*2); ctx.fill();
    }
  });
  if (highlight && finite(highlight[1])) {
    ctx.strokeStyle = muted; ctx.setLineDash([3,3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(highlight[0]),top); ctx.lineTo(x(highlight[0]),floor); ctx.stroke();
    ctx.fillStyle = color('--ink'); ctx.beginPath(); ctx.arc(x(highlight[0]),y(highlight[1]),4,0,Math.PI*2); ctx.fill();
  }
}

// Pause owns a bounded view of the received history while the live model keeps ingesting.
function freezeMeasurements(model, at) {
  const longest = Math.max(...WINDOWS.map(window => window.ms));
  const history = new Map(model.metrics.map(({key}) => [key,model.series(key,longest,at)]));
  const values = new Map(model.metrics.map(({key}) => [key,model.value(key)]));
  return {
    metrics: [...model.metrics],
    value: key => values.get(key),
    series(key, windowMs) {
      const {end,points} = history.get(key);
      const start = end-windowMs;
      return {start,end,points:points.filter(([time]) => time >= start && time <= end)};
    }
  };
}

export function mountTelemetryOverview(root) {
  const model=new TelemetryOverviewModel(),page=root.closest('#communication');
  const controller=new AbortController(),opts={signal:controller.signal};
  let windowMs=getStoredWindowMs(),selected='pv.powerW',metricKeys='',lastStatus='Waiting for telemetry',connected=false,hoverIndex=-1;
  let frozen=null, paused=false, pausedAt=null, source=null, bridgeSeenAt=0;
  let advanced=false;try{advanced=localStorage.getItem('knight.telemetryView')==='advanced';}catch{}
  const $=selector=>root.querySelector(selector);
  root.innerHTML=`
    <div class="telemetry-toolbar kit-toolbar">
      <div class="mode-switch telemetry-source" role="group" aria-label="Telemetry source">
        <button type="button" data-source-mode="mock" aria-pressed="false">Simulated</button>
        <button type="button" data-source-mode="live" aria-pressed="true">Live</button>
      </div>
      <div class="telemetry-health" data-health data-state="waiting">
        <i aria-hidden="true"></i><strong data-health-label role="status">Waiting for telemetry</strong><span data-packet-meta>No packets received</span>
      </div>
      <button class="kit-pause" type="button" data-pause-view aria-label="Pause Advanced display" hidden>
        <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" fill="none" aria-hidden="true"><path data-pause-icon d="M5 3v10m6-10v10"/></svg>
        <span>Pause</span>
      </button>
      <div class="telemetry-clock"><time data-utc></time><span data-bridge-state>Awaiting bridge</span></div>
    </div>
    <div data-advanced-view hidden>
    <section class="telemetry-panel live-readout" aria-labelledby="readoutTitle">
      <div class="telemetry-panel-heading"><div><h2 id="readoutTitle">Live readout</h2><p>Latest packet by subsystem</p></div><span class="readout-packet" data-readout-packet>No packets received</span></div>
      <div class="readout-grid" data-readout></div>
    </section>
    <section class="instrument-section" aria-labelledby="instrumentTitle">
      <header class="instrument-heading"><div><h2 id="instrumentTitle">Component telemetry</h2><p>Received samples · local time</p></div><label>Window<select class="select" data-window-select>${WINDOWS.map(w=>`<option value="${w.ms}">${w.label}</option>`).join('')}</select></label></header>
      <div class="instrument-grid">${instrumentMarkup()}</div>
    </section>
    <div class="telemetry-workbench">
      <section class="telemetry-panel" aria-labelledby="trendTitle"><div class="telemetry-panel-heading"><div><h2 id="trendTitle">Measurement trend</h2><p>Received samples · local time</p></div><div class="chart-options"><label>Measurement<select class="select" data-metric-select></select></label></div></div><canvas class="telemetry-chart" data-main-chart tabindex="0" role="img" aria-label="Measurement trend; use left and right arrows to inspect samples" aria-describedby="trendReadout"></canvas><div class="chart-reading" id="trendReadout" aria-live="polite"><span data-chart-current>No measurements</span><span data-chart-range>Waiting for samples</span></div></section>
      <section class="telemetry-panel" aria-labelledby="cellTitle"><div class="telemetry-panel-heading"><div><h2 id="cellTitle">Cell balance</h2><p>BQ76942 · individual cell measurements</p></div></div>${[0,1,2,3].map(i=>`<div class="battery-cell"><span>Cell ${i+1}</span><meter data-cell-meter="${i}" min="3" max="4.3" low="3.2" high="4.25" optimum="3.8" value="3" aria-label="Cell ${i+1} voltage"></meter><strong data-overview="cell${i}">--</strong></div>`).join('')}<div class="cell-spread"><span>Cell spread trend · mV</span><canvas data-spread-chart role="img" aria-label="Cell voltage spread over selected time window"></canvas></div><div class="battery-summary"><span>Min <b data-overview="cellMin">--</b></span><span>Max <b data-overview="cellMax">--</b></span><span>Spread <b data-overview="cellDelta">--</b></span></div><p class="telemetry-subtitle">Bar scale 3.0–4.3 V. Individual voltage readings do not establish state of charge.</p><button class="battery-inspect" type="button" data-detail-target="bms">Battery register details</button></section>
    </div>
    <details class="telemetry-raw" data-advanced>
      <summary>Packet evidence</summary>
      <div class="telemetry-field-wrap"><table class="table"><thead><tr><th scope="col">Field</th><th scope="col">Received value</th></tr></thead><tbody data-fields><tr><td colspan="2">Waiting for a telemetry packet.</td></tr></tbody></table></div>
      <details><summary>Complete received packet</summary><pre data-raw>Waiting for telemetry.</pre></details>
    </details>
    </div>`;
  const set=(key,value)=>{const el=$(`[data-overview="${key}"]`);if(el&&el.textContent!==value)el.textContent=value;};
  const modeButtons=page.querySelectorAll('[data-telemetry-view]');
  function viewMode(value) {
    if (value !== 'advanced' && paused) setPaused(false);
    advanced=value==='advanced';$('[data-pause-view]').hidden=!advanced;page.dataset.view=advanced?'advanced':'simple';$('[data-advanced-view]').hidden=!advanced;
    modeButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.telemetryView===value)));
    try{localStorage.setItem('knight.telemetryView',value);}catch{}
    requestAnimationFrame(() => draw());
  }
  modeButtons.forEach(button=>button.addEventListener('click',()=>viewMode(button.dataset.telemetryView),opts));
  function options() {
    const keys=model.metrics.map(m=>m.key).join('|');if(keys===metricKeys)return;metricKeys=keys;
    $('[data-metric-select]').innerHTML=model.metrics.map(m=>`<option value="${esc(m.key)}">${esc(m.label)}${m.unit?' · '+esc(m.unit):''}</option>`).join('');
    if (!model.metrics.some(metric => metric.key === selected)) selected = model.metrics[0].key;
    $('[data-metric-select]').value=selected;
    if ($('[data-readout]').hasChildNodes()) return;
    const groups = [
      ['Payload current sensor', 'INA226 · 0x40', ['pv']],
      ['Battery monitor', 'BQ76942 · 0x08', ['bms']],
      ['Charger & power path', 'BQ25798 · 0x6B', ['mppt']],
      ['Environmental sensors', 'ESP32-S3 · ADC1', ['per']]
    ];
    const extra = (label, key) => `<div class="readout-context"><dt>${label}</dt><dd data-overview="${key}">Unavailable</dd></div>`;
    $('[data-readout]').innerHTML = groups.map(([label, device, prefixes]) => {
      const subsystem = prefixes[0];
      const readings = model.metrics.filter(m => m.register !== 'packet' && m.key !== 'mppt.ibatMa' && prefixes.includes(m.key.split('.')[0]));
      const leadKey = {pv:'pv.powerW', bms:'bms.deltaMv', mppt:'mppt.faults', per:'per.tempC'}[subsystem];
      const row = m => {
        const cell = /^bms\.cell([0-3])$/.exec(m.key);
        return `<div class="readout-metric${m.key === leadKey ? ' readout-lead' : ''}"><dt><button type="button" data-select-metric="${esc(m.key)}" title="Plot ${esc(m.label)}">${esc(m.label)}<small${m.register.startsWith('0x') ? ' class="register-address"' : ''}>${esc(m.register)}</small></button></dt>
          <dd>
            ${cell ? `<meter class="readout-cell" data-readout-cell="${cell[1]}" min="3" max="4.3" value="3" aria-label="${esc(m.label)}"></meter>` : ''}
            <strong data-reading-key="${esc(m.key)}">Unavailable</strong>
            <canvas data-readout-trend="${esc(m.key)}" aria-hidden="true"></canvas>
          </dd></div>`;
      };
      const adc = subsystem === 'per' ? extra('Relative light', 'lightLevel') : '';
      const railNames = { 'mppt.vac1V':'VAC1', 'mppt.vbusV':'VBUS', 'mppt.vsysV':'VSYS', 'mppt.vbatV':'VBAT' };
      const rails = subsystem === 'mppt' ? `<div class="kit-rails" aria-label="Reported charger rail voltages">${Object.entries(railNames).map(([key,name]) => {
        const metric = readings.find(item => item.key === key);
        return `<button type="button" data-select-metric="${key}" aria-label="Inspect ${name}, register ${metric.register}">
          <span>${name}</span><small class="register-address">${metric.register}</small><b data-rail-value="${key}" data-reading-key="${key}">Unavailable</b>
          <canvas data-readout-trend="${key}" aria-hidden="true"></canvas>
        </button>`;
      }).join('')}</div><div class="kit-faults" data-fault-flags></div>` : '';
      const charger = subsystem === 'mppt'
        ? extra('Selected input','path') + extra('REG13','pathRegister') + extra('ADC disable · 0x2F / 0x30','adcRegisters') : '';
      return `<section data-subsystem="${subsystem}"><header><h3>${label}</h3><small>${device}</small></header>
        <dl>${row(readings.find(m => m.key === leadKey))}</dl>
        ${rails}<dl>${readings.filter(m => m.key !== leadKey && !railNames[m.key]).map(row).join('')}${charger}${adc}</dl></section>`;
    }).join('');
  }
  function setPaused(value) {
    paused = value;
    pausedAt = value ? Date.now() : null;
    frozen = value ? freezeMeasurements(model, pausedAt) : null;
    const button = $('[data-pause-view]');
    button.querySelector('span').textContent = value ? 'Resume' : 'Pause';
    button.querySelector('path').setAttribute('d',value ? 'm5 3 8 5-8 5Z' : 'M5 3v10m6-10v10');
    button.setAttribute('aria-label',value ? 'Resume Advanced display' : 'Pause Advanced display');
    if (value) { health(); draw(); } else render();
  }
  $('[data-pause-view]').addEventListener('click', () => setPaused(!paused), opts);
  root.querySelectorAll('[data-source-mode]').forEach(button => button.addEventListener('click', () => {
    const checkbox = document.getElementById('mockModeToggle');
    const mock = button.dataset.sourceMode === 'mock';
    if (checkbox && checkbox.checked !== mock) checkbox.click();
  }, opts));

  function draw(refreshInstruments = true) {
    if (controller.signal.aborted || !advanced) return;
    const display = frozen || model;
    const metric=display.metrics.find(m=>m.key===selected)||model.metrics[0];
    const series=display.series(selected,windowMs),valid=series.points.filter(p=>finite(p[1]));
    const sample=hoverIndex>=0?valid[Math.min(hoverIndex,valid.length-1)]:null;
    drawTelemetryChart($('[data-main-chart]'),series,{highlight:sample,axisUnit:metric.unit});
    const current=sample||valid.at(-1);
    $('[data-chart-current]').textContent=current?`${metric.label}: ${format(current[1],metric.unit,metric.digits)} · ${clock(current[0])}`:'No measurements in this window';
    $('[data-chart-range]').textContent=valid.length?`${valid.length} samples · min ${format(Math.min(...valid.map(p=>p[1])),metric.unit,metric.digits)} · max ${format(Math.max(...valid.map(p=>p[1])),metric.unit,metric.digits)}`:'Waiting for samples';
    if (refreshInstruments) {
      for (const canvas of root.querySelectorAll('[data-readout-trend]')) {
        drawTelemetryChart(canvas, display.series(canvas.dataset.readoutTrend,windowMs),{small:true,accent:'--dash-series'});
      }
      renderInstruments(root, display, windowMs, drawTelemetryChart, format);
      drawTelemetryChart($('[data-spread-chart]'),display.series('bms.deltaMv',windowMs),{small:true});
    }
  }
  function health() {
    const stream=model.stream,age=stream.ageMs(),stale=stream.isStale();
    const state=model.mode==='mock'?'mock':!stream.latest?'waiting':stale||!connected?'stale':'live';
    const simulated = model.mode === 'mock';
    $('[data-health]').dataset.state=paused?'paused':state;
    const status = paused?'Display paused':simulated?'Simulated data':state==='live'?'Live data':state==='stale'?'Telemetry stale':lastStatus;
    $('#readoutTitle').textContent = paused ? 'Paused readout' : simulated ? 'Simulated readout' : 'Live readout';
    const statusLabel = $('[data-health-label]');
    if (statusLabel.textContent !== status) statusLabel.textContent = status;
    $('[data-packet-meta]').textContent=paused?`at ${new Date(pausedAt).toISOString().slice(11,19)} UTC`
      : stream.latest ? `updated ${Math.floor(Math.max(0,age)/1000)} s ago` : 'No packets received';
    root.querySelectorAll('[data-source-mode]').forEach(button =>
      button.setAttribute('aria-pressed',String(button.dataset.sourceMode === (simulated?'mock':'live'))));
    const time = $('[data-utc]');
    const now = new Date();
    time.dateTime = now.toISOString();
    time.textContent = `${time.dateTime.slice(11,19)} UTC`;
    const uptime = stream.latest?.packet?.device_uptime_ms;
    const hours = Math.floor(uptime / 3600000), minutes = Math.floor(uptime / 60000) % 60;
    $('[data-bridge-state]').textContent = simulated?'Local simulation'
      : finite(uptime) && uptime > 0 ? `ESP32 up ${hours}h ${minutes}m`
      : bridgeSeenAt && Date.now()-bridgeSeenAt<30000?'Bridge responding':'Awaiting bridge';
  }

  function render() {
    options();health();
    const d=model.devices();
    const {latest, packets} = model.stream;
    const device = model.metadata?.deviceId || latest?.packet?.device_id || 'ESP32';
    const seq = latest?.packet?.seq ?? model.metadata?.sequence;
    const packetFormat = latest?.source === 'udp' ? latest.packet?.packet_format : null;
    $('[data-readout-packet]').textContent = latest ? `${device}${packetFormat ? ' · ' + packetFormat : ''} · Seq ${seq ?? '—'} · ${packets} packets` : 'No packets received';
    const cells = d.bms.cells.map((_, i) => model.value(`bms.cell${i}`));
    set('path', sourceText[d.mppt.acdrv] || d.mppt.acdrv || 'Not reported');
    set('faultNames', model.value('mppt.faults') === null ? 'Unavailable' : d.mppt.faults.filter(fault => fault.active).map(fault => fault.name.replace(/_STAT$/, '')).join(', ') || 'None active');
    set('pathRegister', d.mppt.reg13 == null ? 'Unavailable' : `0x${d.mppt.reg13.toString(16).toUpperCase()}`);
    set('adcRegisters', 'Not sampled');
    set('lightLevel', d.peripheral.lightLevel || 'Unavailable');
    const flags=$('[data-fault-flags]');
    const faultsAvailable=model.value('mppt.faults')!==null;
    flags.innerHTML=faultsAvailable && d.mppt.faults.length
      ? d.mppt.faults.map(fault=>`<span data-active="${Boolean(fault.active)}">${esc(fault.name.replace(/_STAT$/,''))}${fault.active?' · active':''}</span>`).join('')
      : `<span>${faultsAvailable?'None active':'Fault state unavailable'}</span>`;
    cells.forEach((value,i)=>{
      const strip=$(`[data-readout-cell="${i}"]`);
      if (strip) {
        strip.value=finite(value)?value:3;strip.hidden=!finite(value);
        strip.setAttribute('aria-valuetext',finite(value)?`${value.toFixed(3)} volts`:'Unavailable');
      }
      set(`cell${i}`,finite(value)?format(value,'V',3):'--');const meter=$(`[data-cell-meter="${i}"]`);meter.value=finite(value)?value:3;meter.style.opacity=finite(value)?'1':'.25';meter.setAttribute('aria-valuetext',finite(value)?`${value.toFixed(3)} volts`:'Unavailable');});
    const validCells=cells.filter(finite);set('cellMin',validCells.length?format(Math.min(...validCells),'V',3):'--');set('cellMax',validCells.length?format(Math.max(...validCells),'V',3):'--');set('cellDelta',format(model.value('bms.deltaMv'),'mV',0));
    for (const node of root.querySelectorAll('[data-reading-key]')) {
      const metric = model.metrics.find(m => m.key === node.dataset.readingKey);
      node.classList.toggle('unavailable', model.value(metric.key) == null);
      node.textContent = metric.key === 'mppt.faults' && model.value(metric.key) != null
        ? String(model.value(metric.key)) : format(model.value(metric.key), metric.unit, metric.digits);
    }
    if(!model.raw){$('[data-fields]').innerHTML='<tr><td colspan="2">Waiting for a telemetry packet.</td></tr>';$('[data-raw]').textContent='Waiting for telemetry.';}
    if(model.raw){$('[data-fields]').innerHTML=flattenFields(model.raw).map(([key,value])=>`<tr><td>${esc(key)}</td><td>${value===null?'Unavailable':esc(String(value))}</td></tr>`).join('');$('[data-raw]').textContent=JSON.stringify(model.raw,null,2);}
    draw();
  }
  $('[data-window-select]').value=String(windowMs);
  $('[data-window-select]').addEventListener('change',event=>{windowMs=Number(event.target.value);setStoredWindowMs(windowMs);hoverIndex=-1;draw();},opts);
  $('[data-metric-select]').addEventListener('change',event=>{selected=event.target.value;hoverIndex=-1;draw();},opts);
  root.addEventListener('click',event=>{const button=event.target.closest('[data-select-metric]');if(!button)return;selected=button.dataset.selectMetric;$('[data-metric-select]').value=selected;hoverIndex=-1;draw();$('[data-main-chart]').scrollIntoView({block:'center'});$('[data-main-chart]').focus({preventScroll:true});},opts);
  const mainChart=$('[data-main-chart]');
  mainChart.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const values=(frozen || model).series(selected,windowMs).points.filter(p=>finite(p[1]));if(!values.length)return;hoverIndex=event.key==='Home'?0:event.key==='End'?values.length-1:Math.max(0,Math.min(values.length-1,(hoverIndex<0?values.length-1:hoverIndex)+(event.key==='ArrowLeft'?-1:1)));draw();},opts);
  mainChart.addEventListener('pointermove', event => {
    const series = (frozen || model).series(selected,windowMs);
    const values = series.points.filter(point => finite(point[1]));
    if (!values.length) return;
    const box = mainChart.getBoundingClientRect(), {start,end} = timeDomain([series]);
    const fraction = (event.clientX-box.left-plotInset.left)/(box.width-plotInset.left-plotInset.right);
    const time = start+Math.max(0,Math.min(1,fraction))*(end-start);
    hoverIndex = values.reduce((best,p,i) => Math.abs(p[0]-time) < Math.abs(values[best][0]-time) ? i : best,0);
    draw(false);
  },opts);
  window.addEventListener('dashboard-theme-change', () => draw(),opts);
  mainChart.addEventListener('pointerleave',()=>{hoverIndex=-1;draw(false);},opts);
  const observer=new ResizeObserver(draw);observer.observe(mainChart);
  const timer=setInterval(health,1000);
  viewMode(advanced?'advanced':'simple');render();
  return {
    update(telemetry,metadata,mode,envelope){
      const changed = source !== mode;
      source = mode;
      model.ingest(telemetry,metadata,mode,envelope);
      if (changed && paused) setPaused(false);
      if (!paused) {hoverIndex=-1;render();}
    },
    bridgeStatus(){bridgeSeenAt=Date.now();},
    status(text,online){lastStatus=text;connected=online;health();},
    destroy(){controller.abort();observer.disconnect();clearInterval(timer);root.replaceChildren();}
  };
}
