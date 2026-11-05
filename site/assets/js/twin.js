import { subscribe as subscribeStreaming, streamUrl } from './streaming-telemetry.mjs?v=20261019b';

let unsubscribe = null;
let activeFrame = null;

// The shared decoder handles bridge envelopes, device presence, and duplicate SSE packets.
// INA226 PV current is not a confirmed independent solar-panel current measurement.
export function twinPacketFromModel(model) {
  const visible = model.visibility || {};
  const decoded = model.decoded;
  if (!decoded) return null;
  const packet = {};
  if (visible.bms?.visible && Number.isFinite(decoded.bms?.packV)) {
    packet.battery_voltage_v = decoded.bms.packV;
  }
  if (Number.isFinite(decoded.peripheral?.temperatureC)) {
    packet.temperature_c = decoded.peripheral.temperatureC;
  }
  if (Number.isFinite(decoded.peripheral?.relativeLightLevel)) {
    packet.light_level = decoded.peripheral.relativeLightLevel;
  }
  return Object.keys(packet).length ? packet : null;
}

export function initTwinPage() {
  const frame = document.getElementById('knight-eps-twin');
  const status = document.getElementById('twinIntegrationStatus');
  if (!frame) return;
  activeFrame = frame;
  frame.addEventListener('load', async () => {
    try {
      const twin = frame.contentWindow?.knightEPSTwin;
      if (!twin) throw new Error('Viewer API unavailable');
      await twin.ready;
      if (activeFrame !== frame) return;
      let seenPackets = -1;
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
          if (ageMs !== null && ageMs < 15000) {
            const packet = twinPacketFromModel(model);
            if (packet) twin.updateTelemetry(packet, { source: 'live' });
          }
        }
      }, streamUrl());
      if (status) status.hidden = true;
    } catch (error) {
      if (activeFrame === frame && status) status.textContent = `Digital twin unavailable: ${error.message}`;
    }
  }, { once: true });
}

export function destroyTwinPage() {
  unsubscribe?.();
  unsubscribe = null;
  activeFrame = null;
}
