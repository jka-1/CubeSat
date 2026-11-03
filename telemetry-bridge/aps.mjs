// Autodesk Platform Services (APS) helper for the digital-twin viewer.
// Credentials come only from the environment (APS_CLIENT_ID, APS_CLIENT_SECRET).
// The browser receives a short-lived viewables:read token, never the secret.
const APS_BASE = 'https://developer.api.autodesk.com';
const VIEWER_SCOPE = 'viewables:read';

export class ApsClient {
  constructor({ clientId, clientSecret, bucket, modelUrn, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.clientId = String(clientId || '').trim();
    this.clientSecret = String(clientSecret || '').trim();
    this.bucket = String(bucket || '').trim();
    this.modelUrn = String(modelUrn || '').trim();
    this.fetch = fetchImpl;
    this.now = now;
    this.cached = null;
    this.pending = null;
  }

  static fromEnv(env = process.env, options = {}) {
    return new ApsClient({
      clientId: env.APS_CLIENT_ID, clientSecret: env.APS_CLIENT_SECRET,
      bucket: env.APS_BUCKET, modelUrn: env.APS_MODEL_URN, ...options
    });
  }

  get enabled() { return Boolean(this.clientId && this.clientSecret && this.modelUrn); }

  model() {
    return { enabled: this.enabled, urn: this.enabled ? this.modelUrn : null, bucket: this.bucket || null };
  }

  async viewerToken() {
    if (!this.enabled) { const e = new Error('APS viewer is not configured'); e.statusCode = 503; throw e; }
    // Reuse a cached token while it has at least 60 s left.
    if (this.cached && this.cached.expiresAt - this.now() > 60_000) return this.publicToken();
    if (!this.pending) this.pending = this.fetchToken().finally(() => { this.pending = null; });
    await this.pending;
    return this.publicToken();
  }

  publicToken() {
    return { access_token: this.cached.token, token_type: 'Bearer',
      expires_in: Math.max(0, Math.floor((this.cached.expiresAt - this.now()) / 1000)), scope: VIEWER_SCOPE };
  }

  async fetchToken() {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this.fetch(`${APS_BASE}/authentication/v2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: VIEWER_SCOPE }).toString()
    });
    if (!res.ok) { const e = new Error(`APS token request failed (${res.status})`); e.statusCode = 502; throw e; }
    const body = await res.json();
    if (!body.access_token) { const e = new Error('APS token response missing access_token'); e.statusCode = 502; throw e; }
    this.cached = { token: body.access_token, expiresAt: this.now() + Number(body.expires_in || 0) * 1000 };
  }
}
