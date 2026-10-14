import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { analyzeWindow, seqDelta } = await import(path.resolve(here, '../../site/assets/js/link-stats.mjs'));
// Shared with the Windows app (tests/fixtures/link_fixtures.json) and CubeSat-ref-tools.
const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures/link_fixtures.json'), 'utf8'));

for (const c of fixtures.cases) {
  for (const [windowMs, expected] of Object.entries(c.expected)) {
    test(`link-stats parity ${c.name} window=${windowMs}`, () => {
      const r = analyzeWindow(c.events, c.commands, { periodMs: c.period, windowMs: Number(windowMs), now: c.events.at(-1).t });
      assert.deepEqual(r.summary, expected.summary);
      assert.deepEqual(r.series, expected.series);
    });
  }
}

test('16-bit sequence ring skips zero', () => {
  assert.equal(seqDelta(65535, 1), 1);
  assert.equal(seqDelta(1, 65535), 65534);
});
