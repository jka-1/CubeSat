// TEMT6000 LIGHT_OUT level bands (calibrated mV). Boundaries: < LIGHT_BRIGHT_MIN_MV -> Lightly Lit,
// LIGHT_BRIGHT_MIN_MV..LIGHT_VERY_BRIGHT_MIN_MV -> Bright, > LIGHT_VERY_BRIGHT_MIN_MV -> Very Bright.
export const LIGHT_BRIGHT_MIN_MV = 800;
export const LIGHT_VERY_BRIGHT_MIN_MV = 1800;
export function lightLevelFromMv(mv) {
  if (mv === null || mv === undefined || mv === '' || !Number.isFinite(Number(mv))) return null;
  const v = Number(mv);
  if (v < LIGHT_BRIGHT_MIN_MV) return 'Lightly Lit';
  if (v <= LIGHT_VERY_BRIGHT_MIN_MV) return 'Bright';
  return 'Very Bright';
}
// MCP9700 TEMP_OUT: 500 mV at 0 degC, 10 mV/degC.
export function mcp9700TempCFromMv(mv) {
  if (mv === null || mv === undefined || !Number.isFinite(Number(mv))) return null;
  return (Number(mv) - 500) / 10;
}

export function unavailablePeripheralTelemetry() {
  return {
    temperatureC: null,
    temperatureSaturated: null,
    lightVoltageMv: null,
    lightLevel: null,
    relativeLightLevel: null,
    lightSaturated: null
  };
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizePeripheralTelemetry(candidate) {
  const peripheral = candidate?.peripheral;
  if (!peripheral || typeof peripheral !== 'object') {
    return unavailablePeripheralTelemetry();
  }

  const temperatureC = finiteOrNull(peripheral.temperatureC);
  const lightVoltageMv = finiteOrNull(peripheral.lightVoltageMv);
  const relativeLightLevel = finiteOrNull(peripheral.relativeLightLevel);

  return {
    temperatureC,
    temperatureSaturated: temperatureC === null
      ? null
      : peripheral.temperatureSaturated === true,
    lightVoltageMv,
    lightLevel: lightLevelFromMv(lightVoltageMv),
    relativeLightLevel: relativeLightLevel === null
      ? null
      : Math.min(1, Math.max(0, relativeLightLevel)),
    lightSaturated: relativeLightLevel === null
      ? null
      : peripheral.lightSaturated === true
  };
}

export function createMockPeripheralTelemetry(random = Math.random) {
  const temperatureC = 21 + random() * 12;
  const relativeLightLevel = 0.12 + random() * 0.76;

  return {
    temperatureC,
    temperatureSaturated: false,
    lightVoltageMv: Math.round(relativeLightLevel * 3100),
    lightLevel: lightLevelFromMv(Math.round(relativeLightLevel * 3100)),
    relativeLightLevel,
    lightSaturated: false
  };
}

export function peripheralTelemetryForMode(mode, random = Math.random) {
  return mode === 'mock'
    ? createMockPeripheralTelemetry(random)
    : unavailablePeripheralTelemetry();
}
