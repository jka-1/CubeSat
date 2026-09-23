export function unavailablePeripheralTelemetry() {
  return {
    temperatureC: null,
    temperatureSaturated: null,
    lightVoltageMv: null,
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
    relativeLightLevel,
    lightSaturated: false
  };
}

export function peripheralTelemetryForMode(mode, random = Math.random) {
  return mode === 'mock'
    ? createMockPeripheralTelemetry(random)
    : unavailablePeripheralTelemetry();
}
