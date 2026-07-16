import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { simpleParser } from 'mailparser';
import { customAlphabet } from 'nanoid';
import * as cheerio from 'cheerio';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDomain } from 'tldts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');

const isProd = process.env.NODE_ENV === 'production';
const app = express();
class BetterSqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.db.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL)');
  }
  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
      if (!row || row.expired < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb = () => {}) {
    try {
      const expired = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 14 * 86400000;
      this.db.prepare('INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired').run(sid, JSON.stringify(sess), expired);
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb = () => {}) {
    try { this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb(null); } catch (e) { cb(e); }
  }
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const makeSlug = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', 7);

initDb();
seedAdmin();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new BetterSqliteSessionStore(db),
  name: 'uei.sid',
  secret: process.env.SESSION_SECRET || 'dev-change-me-url-email-intel',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 24 * 14 }
}));

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, target_url TEXT NOT NULL, title TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0, last_hit_at TEXT);
    CREATE TABLE IF NOT EXISTS url_lists (id INTEGER PRIMARY KEY, source_url TEXT NOT NULL, urls_json TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY, input TEXT NOT NULL, kind TEXT NOT NULL, result_json TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
}

function seedAdmin() {
  const count = db.prepare('SELECT count(*) AS c FROM users').get().c;
  if (count) return;
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, bcrypt.hashSync(password, 12));
  if (!process.env.ADMIN_PASSWORD) fs.writeFileSync(path.join(dataDir, 'INITIAL_ADMIN.txt'), `email=${email}\npassword=${password}\n`, { mode: 0o600 });
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'authentication_required' });
}

function absoluteUrl(req, slug) {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/s/${slug}`;
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are supported');
  return url.toString();
}

function retentionDate(days = 14) {
  const n = Number(days);
  const safe = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1), 365) : 14;
  return new Date(Date.now() + safe * 86400000).toISOString();
}

async function dnsMx(domain) {
  try {
    return (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority);
  } catch (e) {
    return { error: e.code || e.message };
  }
}
async function dnsTxt(domain) {
  try { return await dns.resolveTxt(domain); } catch (e) { return { error: e.code || e.message }; }
}
async function dnsAnyHost(host) {
  const out = {};
  for (const type of ['A', 'AAAA', 'CNAME']) {
    try { out[type] = await dns.resolve(host, type); } catch (e) { out[type] = { error: e.code || e.message }; }
  }
  return out;
}

async function vtLookup(url) {
  if (!process.env.VIRUSTOTAL_API_KEY) return { enabled: false, note: 'Set VIRUSTOTAL_API_KEY to enable VirusTotal URL reputation.' };
  const id = Buffer.from(url).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const r = await fetch(`https://www.virustotal.com/api/v3/urls/${id}`, { headers: { 'x-apikey': process.env.VIRUSTOTAL_API_KEY } });
  if (r.status === 404) return { enabled: true, found: false };
  const body = await r.json();
  return { enabled: true, found: r.ok, status: r.status, stats: body?.data?.attributes?.last_analysis_stats, reputation: body?.data?.attributes?.reputation };
}

async function checkUrl(input) {
  const url = normalizeUrl(input);
  const parsed = new URL(url);
  const domain = parseDomain(parsed.hostname);
  const started = Date.now();
  const result = { url, host: parsed.hostname, domain, dns: await dnsAnyHost(parsed.hostname), http: {}, redirects: [], vt: null, elapsed_ms: 0 };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'url-email-intel/0.1 security-checker' } });
    clearTimeout(timeout);
    result.http = { status: resp.status, ok: resp.ok, content_type: resp.headers.get('content-type'), server: resp.headers.get('server'), location: resp.headers.get('location') };
    let current = resp;
    let nextUrl = url;
    for (let i = 0; i < 5 && current.headers.get('location'); i++) {
      nextUrl = new URL(current.headers.get('location'), nextUrl).toString();
      result.redirects.push(nextUrl);
      current = await fetch(nextUrl, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'url-email-intel/0.1 security-checker' } });
    }
    if (result.redirects.length) result.final = { url: nextUrl, status: current.status };
  } catch (e) {
    result.http = { error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
  try { result.vt = await vtLookup(url); } catch (e) { result.vt = { enabled: true, error: e.message }; }
  result.elapsed_ms = Date.now() - started;
  return result;
}

function extractUrls(text, base) {
  const found = new Set();
  const re = /https?:\/\/[^\s"'<>]+/gi;
  for (const m of text.matchAll(re)) found.add(m[0].replace(/[),.;]+$/g, ''));
  const $ = cheerio.load(text);
  $('[href],[src],[action]').each((_, el) => {
    for (const attr of ['href', 'src', 'action']) {
      const v = $(el).attr(attr);
      if (!v) continue;
      try { found.add(new URL(v, base).toString()); } catch {}
    }
  });
  return [...found].filter(u => /^https?:\/\//i.test(u));
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'url-email-intel' }));
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'invalid_credentials' });
  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.json({ user: req.session.user });
});
app.post('/api/auth/logout', requireAuth, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', (req, res) => res.json({ user: req.session?.user || null }));

app.post('/api/shorten', requireAuth, (req, res) => {
  try {
    const target = normalizeUrl(req.body.url);
    const slug = (req.body.slug || makeSlug()).trim();
    const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : retentionDate(req.body.retentionDays || 14);
    db.prepare('INSERT INTO links (slug, target_url, title, created_by, expires_at) VALUES (?, ?, ?, ?, ?)').run(slug, target, req.body.title || null, req.session.user.id, expiresAt);
    res.json({ slug, shortUrl: absoluteUrl(req, slug), targetUrl: target, expiresAt });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/shorten', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT slug,target_url AS targetUrl,title,created_at AS createdAt,expires_at AS expiresAt,hits,last_hit_at AS lastHitAt FROM links ORDER BY created_at DESC LIMIT 100').all();
  res.json({ links: rows });
});
app.get('/s/:slug', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE slug = ?').get(req.params.slug);
  if (!link) return res.status(404).send('short link not found');
  if (new Date(link.expires_at) < new Date()) return res.status(410).send('short link expired');
  db.prepare('UPDATE links SET hits = hits + 1, last_hit_at = CURRENT_TIMESTAMP WHERE id = ?').run(link.id);
  res.redirect(link.target_url);
});

app.post('/api/master-list', requireAuth, async (req, res) => {
  try {
    const sourceUrl = normalizeUrl(req.body.url);
    const html = await (await fetch(sourceUrl, { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'url-email-intel/0.1 master-url-lister' } })).text();
    const urls = extractUrls(html, sourceUrl).map(u => ({ url: u, host: new URL(u).hostname, rootDomain: parseDomain(new URL(u).hostname).domain })).sort((a, b) => a.host.localeCompare(b.host));
    db.prepare('INSERT INTO url_lists (source_url, urls_json, created_by) VALUES (?, ?, ?)').run(sourceUrl, JSON.stringify(urls), req.session.user.id);
    res.json({ sourceUrl, count: urls.length, urls });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/check-url', requireAuth, async (req, res) => {
  try {
    const result = await checkUrl(req.body.url);
    db.prepare('INSERT INTO checks (input, kind, result_json, created_by) VALUES (?, ?, ?, ?)').run(result.url, 'url', JSON.stringify(result), req.session.user.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/email-analyze', requireAuth, upload.single('eml'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Upload an .eml file');
    const parsed = await simpleParser(req.file.buffer);
    const from = parsed.from?.value?.[0]?.address || '';
    const replyTo = parsed.replyTo?.value?.[0]?.address || '';
    const returnPath = parsed.headers.get('return-path') || '';
    const domain = (from.split('@')[1] || '').toLowerCase();
    const authResults = parsed.headers.get('authentication-results') || '';
    const received = parsed.headerLines.filter(h => h.key.toLowerCase() === 'received').map(h => h.line);
    const urls = extractUrls(`${parsed.text || ''}\n${parsed.html || ''}`, 'https://email.local/').map(url => ({ url, host: new URL(url).hostname, rootDomain: parseDomain(new URL(url).hostname).domain }));
    const result = { subject: parsed.subject, from, replyTo, returnPath: String(returnPath), messageId: parsed.messageId, date: parsed.date, domain, mx: domain ? await dnsMx(domain) : null, spf: domain ? await dnsTxt(domain) : null, dmarc: domain ? await dnsTxt(`_dmarc.${domain}`) : null, authenticationResults: String(authResults), receivedCount: received.length, received, urls };
    db.prepare('INSERT INTO checks (input, kind, result_json, created_by) VALUES (?, ?, ?, ?)').run(from || req.file.originalname, 'email', JSON.stringify(result), req.session.user.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/s/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const port = Number(process.env.PORT || 4177);
app.listen(port, '0.0.0.0', () => console.log(`url-email-intel listening on ${port}`));
