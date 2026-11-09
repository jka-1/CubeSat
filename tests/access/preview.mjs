// Disposable loopback-only fixture; never uses production credentials or hardware.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { passwordRecord } from '../../telemetry-bridge/auth/session.mjs';
const directory = mkdtempSync(join(tmpdir(), 'knight-access-preview-'));
const file = join(directory, 'auth.json');
const credentials = await passwordRecord('local-test-only');
writeFileSync(file, JSON.stringify({ key: randomBytes(32).toString('hex'), users: ['viewer', 'operator'].map((role) => ({ username: role, role, ...credentials })) }), { mode: 0o600 });
const bridge = spawn(process.execPath, ['telemetry-bridge/server.js'], { env: { ...process.env,
  AUTH_CONFIG_PATH: file, AUTH_ORIGIN: 'http://127.0.0.1:8096', AUTH_ALLOW_LOCAL_HTTP: 'true',
  HTTP_PORT: '8097', UDP_PORT: '33396', UDP_BIND_ADDRESS: '127.0.0.1', HTTP_BIND_ADDRESS: '127.0.0.1',
  RECORDING_DB_PATH: join(directory, 'runs.sqlite'), COMMAND_TOKEN: 'local-fixture-only'
}, stdio: 'inherit' });
const site = spawn(process.execPath, ['tools/link-tools/site_dev_server.mjs', '--port', '8096', '--bridge', 'http://127.0.0.1:8097'], { stdio: 'inherit' });
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await Promise.all([bridge, site].map(async (child) => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit'); child.kill(); await exited;
  }));
  rmSync(directory, { recursive: true, force: true });
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
