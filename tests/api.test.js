import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');

async function withServer(t, extraEnv = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uei-api-test-'));
  const port = String(4800 + Math.floor(Math.random() * 800));
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    PORT: port,
    PUBLIC_URL: `http://127.0.0.1:${port}`,
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'password123',
    SESSION_SECRET: 'test-secret-change-me',
    ...extraEnv
  };
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', d => logs += d.toString());
  child.stderr.on('data', d => logs += d.toString());
  t.after(() => child.kill('SIGTERM'));
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return { base: `http://127.0.0.1:${port}`, logs: () => logs };
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${logs}`);
}
async function login(base) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123' })
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'login should set session cookie');
  return cookie;
}
async function postJson(base, pathName, body, cookie = '') {
  const r = await fetch(`${base}${pathName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

test('production HTTP lab mode can set a login cookie with COOKIE_SECURE=false', async (t) => {
  const { base } = await withServer(t, { NODE_ENV: 'production', COOKIE_SECURE: 'false' });
  const cookie = await login(base);
  assert.match(cookie, /^uei\.sid=/);
});

test('shortener rejects unusable slugs and hides duplicate DB internals', async (t) => {
  const { base } = await withServer(t);
  const cookie = await login(base);
  const bad = await postJson(base, '/api/shorten', { url: 'https://example.com', slug: 'foo/bar' }, cookie);
  assert.equal(bad.r.status, 400);
  assert.match(bad.data.error, /Slug must be/);

  const first = await postJson(base, '/api/shorten', { url: 'https://example.com', slug: 'dup-slug' }, cookie);
  assert.equal(first.r.status, 200);
  const second = await postJson(base, '/api/shorten', { url: 'https://example.org', slug: 'dup-slug' }, cookie);
  assert.equal(second.r.status, 409);
  assert.equal(second.data.error, 'Slug already exists');
});

test('logout is idempotent even without an active session', async (t) => {
  const { base } = await withServer(t);
  const r = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});
