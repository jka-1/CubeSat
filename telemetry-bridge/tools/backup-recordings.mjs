// Consistent SQLite backup, including committed WAL contents; never reset active runs.
import Database from 'better-sqlite3';
import { existsSync, chmodSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
const [source, destination] = process.argv.slice(2);
if (!source || !destination || resolve(source) === resolve(destination) || existsSync(destination)) {
  throw new Error('Usage: node tools/backup-recordings.mjs <database> <new-backup-path>');
}
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  closeSync(openSync(destination, 'wx', 0o600));
  await db.backup(destination);
  // Ownership is process-local coordination, never something to restore from a snapshot.
  const copy = new Database(destination);
  try { copy.prepare('DELETE FROM recorder_owner').run(); } finally { copy.close(); }
  chmodSync(destination, 0o600);
  console.log('Recording backup complete');
} finally { db.close(); }
