// Regenerates the shared link-stats fixtures and checks they match the committed copy
// (also used by the site test and the Windows app's tests/test_link_stats.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const SITE = process.env.SITE_LINK_STATS || new URL('../../../site/assets/js/link-stats.mjs', import.meta.url).pathname;
test('fixtures regenerate identically and tools == site module', { skip: !fs.existsSync(SITE) && 'site module not found' }, () => {
  const out = execFileSync(process.execPath, [new URL('../scripts/gen_link_fixtures.mjs', import.meta.url).pathname, SITE]).toString();
  assert.deepEqual(JSON.parse(out), JSON.parse(fs.readFileSync(new URL('./fixtures/link_fixtures.json', import.meta.url), 'utf8')));
});
