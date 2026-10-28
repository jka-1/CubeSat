import { parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, chmodSync, openSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { RunStore } from './store.mjs';

mkdirSync(dirname(workerData.filename), { recursive: true, mode: 0o700 });
closeSync(openSync(workerData.filename, 'a', 0o600));
chmodSync(workerData.filename, 0o600);
const store = new RunStore(workerData.filename);
chmodSync(workerData.filename, 0o600);
parentPort.postMessage({ ready: true });
const operations = new Set(['start', 'stop', 'ingest', 'command', 'marker', 'get', 'list', 'samples', 'events', 'series',
  'sequenceSave', 'sequenceGet', 'sequenceList', 'sequenceStart', 'sequenceStartLive', 'sequenceState', 'sequenceEvent',
  'sequenceGetExecution', 'sequenceListExecutions', 'sequenceEvents', 'sequenceUnsafeStatus', 'sequenceRecover']);
parentPort.on('message', ({ id, operation, args }) => {
  try {
    if (operation === 'close') {
      if (store.active()) store.stop({ reason: 'bridge_shutdown', status: 'interrupted' });
      store.close();
      parentPort.postMessage({ id, result: null });
      parentPort.close();
      return;
    }
    if (!operations.has(operation)) throw new Error('Unknown recording operation');
    const result = store[operation](args);
    parentPort.postMessage({ id, result });
  } catch (error) {
    const internal = !Number.isInteger(error.statusCode);
    if (internal) {
      // Mark incomplete if storage still allows it. Disk-full may prevent even this update.
      try { if (store.active()) store.stop({ reason: 'storage_error', status: 'interrupted' }); } catch {}
    }
    parentPort.postMessage({ id, error: internal ? 'Recording storage failed' : error.message,
      statusCode: error.statusCode || 503, fatal: internal });
  }
});
