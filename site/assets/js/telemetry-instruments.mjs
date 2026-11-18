const instruments = [
  { id:'solar', title:'Solar input', device:'INA226 · 0x40', unit:'W',
    metrics:[['pv.powerW','PV power']], supplements:[['pv.busV','Bus voltage'],['pv.currentA','PV current'],['pv.shuntMv','Shunt']] },
  { id:'cells', title:'Battery cell voltages', device:'BQ76942 · 0x08', unit:'V',
    metrics:[1,2,3,4].map((n,i)=>[`bms.cell${i}`,`Cell ${n}`]),
    supplements:[['bms.packV','Pack pin'],['bms.deltaMv','Cell spread']] },
  { id:'rails', title:'Charger voltage rails', device:'BQ25798 · 0x6B', unit:'V',
    metrics:[['mppt.vac1V','VAC1'],['mppt.vbusV','VBUS'],['mppt.vsysV','VSYS'],['mppt.vbatV','VBAT']],
    supplements:[['mppt.ibusMa','Bus current'],['mppt.faults','Active faults']] },
  { id:'temperature', title:'Temperature', device:'MCP9700 · BMS · Charger', unit:'°C',
    metrics:[['per.tempC','Peripheral'],['bms.intTempC','BMS internal'],['mppt.dieTempC','Charger die']],
    supplements:[['per.tempMv','MCP9700 output']] },
  { id:'light', title:'Relative light', device:'TEMT6000 · ADC1', unit:'mV',
    metrics:[['per.lightMv','Sensor output']], supplements:[] }
];

export function instrumentMarkup() {
  return instruments.map(({id,title,device,unit,metrics,supplements}) => `
    <section class="telemetry-panel instrument-card" data-instrument="${id}" aria-labelledby="instrument-${id}">
      <header><div><h3 id="instrument-${id}">${title}</h3><p>${device}</p></div><span class="instrument-unit">${unit}</span></header>
      <div class="instrument-legend">
        ${metrics.map(([key,label],i) => `
          <button type="button" data-select-metric="${key}" class="instrument-series" data-series-color="${i}" aria-label="Inspect ${title}: ${label}">
            <span>${label}</span><strong data-instrument-value="${key}">Unavailable</strong>
          </button>`).join('')}
      </div>
      <canvas data-instrument-chart role="img" aria-label="${title} over the selected time window in ${unit}"></canvas>
      ${supplements.length ? `<dl class="instrument-supplement">${supplements.map(([key,label]) =>
        `<div><dt>${label}</dt><dd data-instrument-value="${key}">Unavailable</dd></div>`).join('')}</dl>` : ''}
    </section>`).join('');
}

export function renderInstruments(root, model, windowMs, draw, format) {
  for (const card of instruments) {
    const panel = root.querySelector(`[data-instrument="${card.id}"]`);
    const canvas = panel.querySelector('canvas');
    const series = card.metrics.map(([key]) => model.series(key,windowMs));
    draw(canvas, series[0], {overlays:series.slice(1),axisUnit:card.unit});
    for (const node of panel.querySelectorAll('[data-instrument-value]')) {
      const metric = model.metrics.find(item => item.key === node.dataset.instrumentValue);
      const value = model.value(metric.key);
      node.classList.toggle('unavailable', value == null);
      node.textContent = format(value,metric.unit,metric.digits);
    }
  }
}
