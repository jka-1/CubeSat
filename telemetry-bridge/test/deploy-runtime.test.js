import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('deployment preflights dependencies and backs up/restores bridge modules without touching recordings', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'deployment-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (relative, data, mode) => {
    const file = join(root, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, data, mode ? { mode } : undefined);
    return file;
  };
  const source = join(root, 'source'), live = join(root, 'live');
  write('source/site/index.html', 'new site');
  write('source/bridge/server.js', 'new server');
  write('source/bridge/package.json', '{}');
  write('source/bridge/package-lock.json', '{}');
  write('source/bridge/recording/client.mjs', 'new module');
  write('source/bridge/node_modules/example/index.js', 'new dependency');
  write('live/site/index.html', 'old site');
  write('live/bridge/server.js', 'old server');
  write('live/bridge/package.json', '{}');
  write('live/bridge/package-lock.json', '{}');
  write('live/bridge/recording/client.mjs', 'old module');
  write('live/bridge/node_modules/example/index.js', 'old dependency');
  write('private/runs.sqlite', 'untouched recording data');
  // These shims exercise deployment orchestration only; the actual native driver is tested separately.
  write('bin/node', '#!/bin/sh\nexit 0\n', 0o755);
  write('bin/curl', '#!/bin/sh\nprintf \'{"status":"ok"}\'\n', 0o755);
  const npm = write('bin/npm', '#!/bin/sh\nexit 23\n', 0o755);
  const env = { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH,
    SITE_SOURCE: join(source, 'site'), BRIDGE_SOURCE: join(source, 'bridge/server.js'),
    BRIDGE_PACKAGE_SOURCE: join(source, 'bridge/package.json'), SITE_ROOT: join(live, 'site'),
    BRIDGE_FILE: join(live, 'bridge/server.js'), BRIDGE_PACKAGE_FILE: join(live, 'bridge/package.json'),
    BACKUP_ROOT: join(root, 'backups'), SERVICE_NAME: '', EXPECTED_BRANCH: '' };
  const deploy = fileURLToPath(new URL('../../scripts/deploy-live.sh', import.meta.url));
  const rollback = fileURLToPath(new URL('../../scripts/rollback-live.sh', import.meta.url));
  assert.equal(spawnSync('bash', [deploy], { env }).status, 23);
  assert.equal(readFileSync(join(live, 'bridge/server.js'), 'utf8'), 'old server');
  writeFileSync(npm, '#!/bin/sh\nexit 0\n');
  execFileSync('bash', [deploy], { env });
  assert.equal(readFileSync(join(live, 'bridge/recording/client.mjs'), 'utf8'), 'new module');
  const backup = join(root, 'backups', readdirSync(join(root, 'backups'))[0]);
  execFileSync('bash', [rollback, backup], { env });
  assert.equal(readFileSync(join(live, 'site/index.html'), 'utf8'), 'old site');
  assert.equal(readFileSync(join(live, 'bridge/server.js'), 'utf8'), 'old server');
  assert.equal(readFileSync(join(live, 'bridge/recording/client.mjs'), 'utf8'), 'old module');
  assert.equal(readFileSync(join(live, 'bridge/node_modules/example/index.js'), 'utf8'), 'old dependency');
  assert.equal(readFileSync(join(root, 'private/runs.sqlite'), 'utf8'), 'untouched recording data');
});
