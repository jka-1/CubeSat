import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createMockPeripheralTelemetry,
  normalizePeripheralTelemetry,
  peripheralTelemetryForMode
} from '../../site/assets/js/telemetry-model.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

test('mock peripheral telemetry uses the live field names and data types', () => {
  const values = [0.25, 0.75];
  const mock = createMockPeripheralTelemetry(() => values.shift());

  assert.equal(typeof mock.temperatureC, 'number');
  assert.equal(typeof mock.lightVoltageMv, 'number');
  assert.equal(typeof mock.relativeLightLevel, 'number');
  assert.equal(mock.temperatureSaturated, false);
  assert.equal(mock.lightSaturated, false);
  assert.equal(mock.lightVoltageMv, Math.round(mock.relativeLightLevel * 3100));
});

test('switching from mock to live clears sensor values instead of retaining simulations', () => {
  const mock = peripheralTelemetryForMode('mock', () => 0.5);
  assert.notEqual(mock.temperatureC, null);
  assert.notEqual(mock.relativeLightLevel, null);

  const liveWaiting = peripheralTelemetryForMode('live');
  assert.deepEqual(liveWaiting, {
    temperatureC: null,
    temperatureSaturated: null,
    lightVoltageMv: null,
    relativeLightLevel: null,
    lightSaturated: null
  });

  const mockAgain = peripheralTelemetryForMode('mock', () => 0.25);
  assert.notEqual(mockAgain.temperatureC, null);
  assert.notEqual(mockAgain.relativeLightLevel, null);
});

test('live packets with missing peripheral fields normalize to unavailable', () => {
  assert.deepEqual(normalizePeripheralTelemetry({}), peripheralTelemetryForMode('live'));
  assert.deepEqual(
    normalizePeripheralTelemetry({ peripheral: { temperatureC: null } }),
    peripheralTelemetryForMode('live')
  );

  assert.deepEqual(normalizePeripheralTelemetry({
    peripheral: {
      temperatureC: 24.5,
      temperatureSaturated: false,
      lightVoltageMv: 1550,
      relativeLightLevel: 0.5,
      lightSaturated: true
    }
  }), {
    temperatureC: 24.5,
    temperatureSaturated: false,
    lightVoltageMv: 1550,
    relativeLightLevel: 0.5,
    lightSaturated: true
  });
});

test('active dashboard contains and drives both peripheral sensor components', async () => {
  const html = await readFile(
    path.join(repositoryRoot, 'site/modules/communication.html'),
    'utf8'
  );
  const script = await readFile(
    path.join(repositoryRoot, 'site/assets/js/i2c.js'),
    'utf8'
  );

  for (const id of [
    'summaryPeripheralTemp',
    'summaryRelativeLight',
    'peripheralTemperatureValue',
    'peripheralTemperatureStatus',
    'relativeLightValue',
    'lightVoltageValue'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(script, new RegExp(id));
  }

  assert.match(html, /It is not a lux measurement/);
  assert.match(script, /dataMode = 'live'/);
  assert.match(script, /dataMode = 'mock'/);
});

test('production route loads the current communication dashboard assets', async () => {
  const [index, app, router] = await Promise.all([
    readFile(path.join(repositoryRoot, 'site/index.html'), 'utf8'),
    readFile(path.join(repositoryRoot, 'site/assets/js/app.js'), 'utf8'),
    readFile(path.join(repositoryRoot, 'site/assets/js/router.js'), 'utf8')
  ]);

  assert.match(index, /assets\/js\/app\.js\?v=20260929e/);
  assert.match(index, /assets\/css\/styles\.css\?v=20260929e/);
  assert.match(app, /router\.js\?v=20260929e/);
  assert.match(router, /i2c\.js\?v=20260929e/);
  assert.match(router, /communication:\s*`\.\/modules\/communication\.html/);
  assert.match(router, /communication:\s*initI2CPage/);
  assert.match(router, /route === 'dashboard'\) return 'communication'/);
  assert.doesNotMatch(router, /dashboard\.js/);
});
