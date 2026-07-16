import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uei-smoke-'));
const port = String(4300 + Math.floor(Math.random() * 500));
const env = { ...process.env, NODE_ENV: 'test', DATA_DIR: dataDir, PORT: port, PUBLIC_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'password123', SESSION_SECRET: 'smoke-secret-change-me' };
const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', d => logs += d.toString());
child.stderr.on('data', d => logs += d.toString());

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`health timeout: ${logs}`);
}
function cookie(headers) { return headers.get('set-cookie')?.split(';')[0] || ''; }
async function json(path, opts = {}, c = '') {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers: { ...(opts.headers || {}), ...(c ? { cookie: c } : {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(data)}`);
  return { r, data };
}
try {
  await waitHealth();
  const login = await json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'password123' }) });
  const c = cookie(login.r.headers);
  const short = await json('/api/shorten', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com', retentionDays: 14 }) }, c);
  if (!short.data.shortUrl || !short.data.expiresAt) throw new Error('shortener failed');
  const check = await json('/api/check-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com' }) }, c);
  if (!check.data.dns || !check.data.http) throw new Error('checker failed');
  const eml = `From: Sender <sender@example.com>\nTo: You <you@example.com>\nSubject: Smoke\nAuthentication-Results: mx.example; spf=pass\n\nVisit https://example.com/login`;
  const form = new FormData();
  form.append('eml', new Blob([eml], { type: 'message/rfc822' }), 'smoke.eml');
  const email = await json('/api/email-analyze', { method: 'POST', body: form }, c);
  if (!email.data.from || !email.data.urls?.length) throw new Error('email analyzer failed');
  console.log(JSON.stringify({ ok: true, port, slug: short.data.slug, urlStatus: check.data.http.status, emailFrom: email.data.from, emailUrls: email.data.urls.length }, null, 2));
} finally {
  child.kill('SIGTERM');
}
