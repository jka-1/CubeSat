import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class Recorder {
  constructor(filename, { maxPending = 256 } = {}) {
    const site = fileURLToPath(new URL('../../site/', import.meta.url));
    const absolute = resolve(filename);
    if (absolute.startsWith(site) || absolute.startsWith('/var/www/')) throw new Error('Recording database must be outside the web root');
    if (!Number.isInteger(maxPending) || maxPending < 1) throw new Error('Invalid recording queue limit');
    this.maxPending = maxPending;
    this.pending = new Map();
    this.serial = 0;
    this.state = { enabled: true, ready: false, active_run_id: null, error: null, dropped_records: 0 };
    this.worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { filename: absolute } });
    this.ready = new Promise((resolveReady, rejectReady) => { this.resolveReady = resolveReady; this.rejectReady = rejectReady; });
    this.worker.on('message', (message) => {
      if (message.ready) { this.state.ready = true; this.resolveReady(); return; }
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);
      if (message.error) {
        if (message.fatal) this.fail(message.error);
        task.reject(Object.assign(new Error(message.error), { statusCode: message.statusCode }));
      } else {
        if (task.operation === 'start') this.state.active_run_id = message.result.id;
        if (task.operation === 'sequenceStartLive') this.state.active_run_id = message.result.run.id;
        if (task.operation === 'stop' || task.operation === 'close') this.state.active_run_id = null;
        if (!this.state.error && task.operation === 'ingest' && message.result) this.state.active_run_id = message.result.run_id;
        task.resolve(message.result);
      }
    });
    this.worker.on('error', (error) => this.fail(`Recording worker failed: ${error.message}`));
    this.worker.on('exit', (code) => {
      if (!this.closing && !this.state.error) this.fail(`Recording worker stopped with exit code ${code}`);
    });
  }
  fail(message) {
    this.state.error = message;
    this.state.ready = false;
    this.state.active_run_id = null;
    this.rejectReady(new Error(message));
    for (const task of this.pending.values()) task.reject(Object.assign(new Error(message), { statusCode: 503 }));
    this.pending.clear();
    this.worker.terminate().catch(() => {});
  }
  status() { return { ...this.state, ready: this.state.ready && !this.state.error, pending_operations: this.pending.size }; }
  call(operation, args, { priority = false } = {}) {
    if (this.state.error && !(priority && operation === 'close')) return Promise.reject(Object.assign(new Error(this.state.error), { statusCode: 503 }));
    if (!this.state.ready) return Promise.reject(Object.assign(new Error('Recorder is not ready'), { statusCode: 503 }));
    if (!priority && this.pending.size >= this.maxPending) {
      return Promise.reject(Object.assign(new Error('Recording queue is full'), { statusCode: 503, overflow: true }));
    }
    const id = ++this.serial;
    return new Promise((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject, operation });
      this.worker.postMessage({ id, operation, args });
    });
  }
  capture(operation, args) {
    if (this.state.error) { this.state.dropped_records++; return; }
    if (!this.state.active_run_id || this.closing) return;
    // Queue admission is synchronous; only a first overflow schedules the terminal marker.
    if (this.pending.size >= this.maxPending) {
      this.state.dropped_records++;
      this.state.active_run_id = null;
      this.drain = this.call('stop', { reason: 'queue_overflow', status: 'interrupted' }, { priority: true }).catch(() => {});
      this.state.error = 'Recording queue overflow; run interrupted';
      return;
    }
    this.call(operation, args).catch(() => { this.state.dropped_records++; });
  }
  async close() {
    this.closing = true;
    if (this.drain) await this.drain;
    if (this.state.ready) {
      try { await this.call('close', {}, { priority: true }); } finally { await this.worker.terminate(); }
    } else await this.worker.terminate();
  }
}
