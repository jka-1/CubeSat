#!/usr/bin/env node
// Password comes only from stdin. Never supply credentials as command arguments.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, realpathSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { passwordRecord, privateConfigPath } from '../auth/session.mjs';

const [file, username, role] = process.argv.slice(2);
if (!file || !/^[A-Za-z0-9_.-]{1,64}$/.test(username || '') || !['viewer', 'operator'].includes(role)) {
  throw new Error('Usage: node tools/auth-user.mjs /private/path/auth.json username viewer|operator (password on stdin)');
}
const path = resolve(file), repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const parent = realpathSync(dirname(path));
if ([repo, '/var/www'].some((root) => parent === root || parent.startsWith(root + sep))) throw new Error('Keep account configuration outside the repository and website');
let password = '';
for await (const chunk of process.stdin) { password += chunk; if (password.length > 258) throw new Error('Password is too long'); }
password = password.replace(/\r?\n$/, '');
const config = existsSync(path) ? JSON.parse(readFileSync(privateConfigPath(path), 'utf8')) : { key: randomBytes(32).toString('hex'), users: [] };
const user = { username, role, ...await passwordRecord(password) };
config.users = config.users.filter((u) => u.username !== username).concat(user);
const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
renameSync(temp, path);
console.log('Account saved. Restart the bridge to apply account changes and invalidate existing sessions.');
