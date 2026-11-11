import { subscribe as subscribeStreaming, streamUrl } from './streaming-telemetry.mjs?v=20261109b';

let unsubscribe = null;
let activeFrame = null;
let navigationObserver = null;

// The shared decoder handles bridge envelopes, device presence, and duplicate SSE packets.
// INA226 PV current is not a confirmed independent solar-panel current measurement.
export function twinPacketFromModel(model) {
  const visible = model.visibility || {};
  const decoded = model.decoded;
  if (!decoded) return null;
  const packet = {}, telemetry = model.latest?.packet?.telemetry || {};
  const put = (key, value) => { if (typeof value === 'number' && Number.isFinite(value)) packet[key] = value; };
  if (visible.bms?.visible) {
    put('battery_voltage_v', decoded.bms?.packV);
    put('bms_temperature_c', decoded.bms?.intTempC);
    for (let i = 0; i < 4; i++) put(`bms_cell_${i + 1}_v`, decoded.bms?.cells?.[i]?.v);
  }
  if (visible.pv?.visible) {
    put('pv_current_a', decoded.pv?.currentA);
    put('pv_bus_voltage_v', decoded.pv?.busV);
    put('pv_power_w', decoded.pv?.powerW);
    put('pv_shunt_voltage_mv', decoded.pv?.shuntMv);
  }
  if (visible.mppt?.visible) {
    for (const [key, field] of Object.entries({mppt_vbus_v:'vbusV',mppt_vac1_v:'vac1V',mppt_vbat_v:'vbatV',mppt_vsys_v:'vsysV',mppt_switch_temperature_c:'dieTempC'})) put(key, decoded.mppt?.[field]);
    put('mppt_ibus_a', telemetry.mppt?.ibusA);
  }
  put('esp32_temperature_c', telemetry.mcu?.temperatureC);
  put('temperature_c', decoded.peripheral?.temperatureC);
  put('light_level', decoded.peripheral?.relativeLightLevel);
  put('light_voltage_mv', decoded.peripheral?.lightVoltageMv);
  put('temperature_voltage_mv', decoded.adc?.temp?.mv);
  put('wifi_rssi_dbm', model.latest?.packet?.link?.rssi_dbm);
  return packet;
}

export function initTwinPage() {
  const frame = document.getElementById('knight-eps-twin');
  const status = document.getElementById('twinIntegrationStatus');
  if (!frame) return;
  activeFrame = frame;
  document.body.classList.add('twin-active');
  const header = document.querySelector('.site-header');
  const measureNavigation = () => document.documentElement.style.setProperty('--twin-nav-height', `${header?.getBoundingClientRect().height || 0}px`);
  navigationObserver = new ResizeObserver(measureNavigation);
  if (header) navigationObserver.observe(header);
  measureNavigation();
  let connecting = false;
  const connect = async () => {
    if (connecting || activeFrame !== frame) return;
    connecting = true;
    try {
      const twin = frame.contentWindow?.knightEPSTwin;
      if (!twin) throw new Error('Viewer API unavailable');
      await twin.ready;
      if (activeFrame !== frame) return;
      let seenPackets = -1;
      let latestReceivedAt = -Infinity;
      let lastTransport = null;
      unsubscribe = subscribeStreaming((model, { transport }) => {
        if (activeFrame !== frame) return;
        if (transport !== lastTransport) {
          twin.setTelemetryTransport(transport);
          lastTransport = transport;
        }
        // An open SSE transport does not establish fresh hardware data.
        if (model.packets !== seenPackets) {
          seenPackets = model.packets;
          const ageMs = model.ageMs();
          const sampleAt = ageMs === null ? null : Date.now() - ageMs;
          if (ageMs !== null && ageMs < model.staleMs && sampleAt >= latestReceivedAt) {
            latestReceivedAt = sampleAt;
            const packet = twinPacketFromModel(model);
            if (packet) twin.updateTelemetry(packet, { source: 'live', snapshot: true, receivedAt: sampleAt, staleMs: model.staleMs });
          }
        }
      }, streamUrl());
      if (status) status.hidden = true;
    } catch (error) {
      if (activeFrame === frame && status) status.textContent = `Digital twin unavailable: ${error.message}`;
    }
  };
  frame.addEventListener('load', connect, { once: true });
  if (frame.contentWindow?.knightEPSTwin) connect();
}

export function destroyTwinPage() {
  unsubscribe?.();
  unsubscribe = null;
  activeFrame?.contentWindow?.knightEPSTwin?.dispose();
  activeFrame = null;
  navigationObserver?.disconnect();
  navigationObserver = null;
  document.body.classList.remove('twin-active');
  document.documentElement.style.removeProperty('--twin-nav-height');
}
