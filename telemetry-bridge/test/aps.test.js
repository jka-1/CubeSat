import test from 'node:test';
import assert from 'node:assert/strict';
import { ApsClient } from '../aps.mjs';

test('APS disabled without env', async () => {
  const aps = ApsClient.fromEnv({});
  assert.deepEqual(aps.model(), { enabled: false, urn: null, bucket: null });
  await assert.rejects(aps.viewerToken(), (e) => e.statusCode === 503);
});

test('APS viewer token is viewables:read only, cached, and hides the secret', async () => {
  let calls = 0; let now = 1_000_000;
  const fetchImpl = async (url, init) => {
    calls++;
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('grant_type'), 'client_credentials');
    assert.equal(body.get('scope'), 'viewables:read');
    assert.match(init.headers.Authorization, /^Basic /);
    return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3599 }) };
  };
  const aps = new ApsClient({ clientId: 'id', clientSecret: 'shh', modelUrn: 'dXJu', fetchImpl, now: () => now });
  const t = await aps.viewerToken();
  assert.equal(t.access_token, 'tok'); assert.equal(t.scope, 'viewables:read');
  await aps.viewerToken(); assert.equal(calls, 1);
  now += 3_560_000; await aps.viewerToken(); assert.equal(calls, 2);
  assert.ok(!JSON.stringify([t, aps.model()]).includes('shh'));
});

test('APS token failure maps to 502', async () => {
  const aps = new ApsClient({ clientId: 'i', clientSecret: 's', modelUrn: 'u', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(aps.viewerToken(), (e) => e.statusCode === 502);
});
