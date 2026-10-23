import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function passwordRecord(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Password must contain 12–256 characters');
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await derive(password, salt, 64, options)).toString('hex') };
}
export function privateConfigPath(file) {
  const path = realpathSync(file);
  const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const site = resolve(fileURLToPath(new URL('../../site', import.meta.url)));
  if ([repository, site, '/var/www'].some((root) => path === root || path.startsWith(root + sep))) {
    throw new Error('Auth config must be outside the repository and public website');
  }
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('Auth config must be a private regular file (chmod 600)');
  return path;
}

export class Sessions {
  constructor(env = process.env) {
    this.enabled = !!env.AUTH_CONFIG_PATH;
    if (env.AUTH_ENABLED === 'true' && !this.enabled) throw new Error('AUTH_CONFIG_PATH is required');
    if (!this.enabled) return;
    const config = JSON.parse(readFileSync(privateConfigPath(env.AUTH_CONFIG_PATH), 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(config.key || '') || !Array.isArray(config.users) || !config.users.length) throw new Error('Invalid auth configuration');
    this.users = new Map();
    for (const user of config.users) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(user.username || '') || !['viewer', 'operator'].includes(user.role) ||
          !/^[a-f0-9]{32}$/.test(user.salt || '') || !/^[a-f0-9]{128}$/.test(user.hash || '') || this.users.has(user.username)) throw new Error('Invalid auth user configuration');
      this.users.set(user.username, user);
    }
    this.key = Buffer.from(config.key, 'hex');
    const origin = new URL(env.AUTH_ORIGIN);
    if (origin.origin !== env.AUTH_ORIGIN || origin.username || origin.password) throw new Error('AUTH_ORIGIN must be an exact origin without a path');
    const loopback = ['127.0.0.1', 'localhost', '[::1]'];
    this.secure = origin.protocol === 'https:';
    if (!this.secure && !(origin.protocol === 'http:' && env.AUTH_ALLOW_LOCAL_HTTP === 'true' && loopback.includes(origin.hostname) && loopback.includes(env.HTTP_BIND_ADDRESS || '127.0.0.1'))) throw new Error('JWT login requires HTTPS (local HTTP must be explicitly enabled on loopback)');
    this.origin = origin.origin;
    this.ttl = Number(env.AUTH_SESSION_SECONDS || 900);
    if (!Number.isInteger(this.ttl) || this.ttl < 60 || this.ttl > 3600) throw new Error('AUTH_SESSION_SECONDS must be 60–3600');
    this.sessions = new Map();
    this.attempts = new Map();
    this.busy = 0;
  }
  cookie(jwt = '', maxAge = this.ttl) {
    return `cubesat_session=${jwt}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secure ? '; Secure' : ''}`;
  }
  originCheck(request) {
    if (request.headers.origin !== this.origin) throw fail(403, 'Request origin is not allowed');
  }
  prune() {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expires <= now) this.revoke(id);
    for (const [id, item] of this.attempts) if (item.until <= now) this.attempts.delete(id);
  }
  limit(request) {
    this.prune();
    // Use the socket peer only. Forwarded headers are not trusted; a reverse proxy
    // intentionally shares one limit unless a future trusted-proxy policy is added.
    for (const [key, limit] of [['global', 60], [`ip:${request.socket.remoteAddress}`, 10]]) {
      let item = this.attempts.get(key);
      if (!item) { item = { count: 0, until: Date.now() + 60000 }; this.attempts.set(key, item); }
      if (++item.count > limit) throw fail(429, 'Too many login attempts. Try again in one minute.');
    }
    if (this.busy >= 2 || this.sessions.size >= 256) throw fail(503, 'Login is busy. Try again shortly.');
  }
  async login(request, body) {
    this.originCheck(request);
    this.limit(request);
    if (typeof body?.username !== 'string' || body.username.length > 64 || typeof body.password !== 'string' || body.password.length > 256) throw fail(401, 'Incorrect username or password');
    const user = this.users.get(body.username);
    this.busy++;
    let hash;
    try { hash = (await derive(body.password, user?.salt || '0'.repeat(32), 64, options)).toString('hex'); }
    finally { this.busy--; }
    if (!user || !equal(hash, user.hash)) throw fail(401, 'Incorrect username or password');
    const id = randomBytes(24).toString('hex'), csrf = randomBytes(24).toString('hex');
    const now = Math.floor(Date.now() / 1000), exp = now + this.ttl;
    const jwt = await new SignJWT({ role: user.role }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.username).setJti(id).setIssuer(this.origin).setAudience('cubesat-bridge')
      .setIssuedAt(now).setExpirationTime(exp).sign(this.key);
    // Replace this browser's prior session to avoid orphan sessions on repeated login.
    try { const previous = await this.authenticate(request); this.revoke(previous.id); } catch {}
    const session = { id, username: user.username, role: user.role, csrf, expires: exp * 1000, streams: new Set() };
    this.sessions.set(id, session);
    return { jwt, session };
  }
  async authenticate(request) {
    this.prune();
    const cookies = String(request.headers.cookie || '').split(';').map((v) => v.trim()).filter((v) => v.startsWith('cubesat_session='));
    if (cookies.length !== 1) throw fail(401, 'Sign in to continue');
    try {
      const { payload } = await jwtVerify(cookies[0].slice('cubesat_session='.length), this.key, {
        algorithms: ['HS256'], issuer: this.origin, audience: 'cubesat-bridge', typ: 'JWT', requiredClaims: ['sub', 'jti', 'exp', 'iat', 'role']
      });
      const session = this.sessions.get(payload.jti);
      if (!session || session.username !== payload.sub || session.role !== payload.role) throw new Error();
      return session;
    } catch { throw fail(401, 'Session expired or invalid. Sign in again.'); }
  }
  async authorize(request) {
    const session = await this.authenticate(request);
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (session.role !== 'operator') throw fail(403, 'An operator account is required');
      this.csrfCheck(request, session);
    }
    return session;
  }
  csrfCheck(request, session) {
    this.originCheck(request);
    if (!equal(request.headers['x-csrf-token'], session.csrf)) throw fail(403, 'Session verification failed. Reload and try again.');
  }
  publicSession(session) {
    return { enabled: true, user: { username: session.username, role: session.role }, csrf: session.csrf, expires_at: new Date(session.expires).toISOString() };
  }
  attachStream(session, response) {
    session.streams.add(response);
    const timer = setTimeout(() => this.revoke(session.id), Math.max(1, session.expires - Date.now()));
    timer.unref();
    response.on('close', () => { clearTimeout(timer); session.streams.delete(response); });
  }
  revoke(id) {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    for (const response of session?.streams || []) response.end();
  }
}
