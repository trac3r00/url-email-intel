import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { simpleParser } from 'mailparser';
import { customAlphabet } from 'nanoid';
import * as cheerio from 'cheerio';
import dns from 'node:dns/promises';
import net from 'node:net';
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
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 12000);
const ALLOW_PRIVATE_TARGETS = process.env.ALLOW_PRIVATE_TARGETS === 'true';
const cookieSecure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== 'false' : (isProd ? 'auto' : false);

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
  cookie: { httpOnly: true, sameSite: 'lax', secure: cookieSecure, maxAge: 1000 * 60 * 60 * 24 * 14 }
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
  if (!raw) throw new Error('URL is required');
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  url.hash = '';
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are supported');
  return url.toString();
}
function retentionDate(days = 14) {
  const n = Number(days);
  const safe = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1), 365) : 14;
  return new Date(Date.now() + safe * 86400000).toISOString();
}
function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
  }
  if (family === 6) {
    const v = ip.toLowerCase();
    return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80:') || v === '::';
  }
  return false;
}
async function assertPublicTarget(url) {
  if (ALLOW_PRIVATE_TARGETS) return;
  const host = new URL(url).hostname;
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Private/localhost targets are blocked');
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length) throw new Error('Host did not resolve');
  const blocked = records.find(r => isPrivateIp(r.address));
  if (blocked) throw new Error(`Private network target blocked (${blocked.address})`);
}
async function dnsMx(domain) {
  try { return (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority); } catch (e) { return { error: e.code || e.message }; }
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
  const body = await r.json().catch(() => ({}));
  return { enabled: true, found: r.ok, status: r.status, stats: body?.data?.attributes?.last_analysis_stats, reputation: body?.data?.attributes?.reputation, permalink: `https://www.virustotal.com/gui/url/${id}` };
}
function scoreUrl(result) {
  const signals = [];
  let score = 0;
  const host = result.host || '';
  if (/\d+\.\d+\.\d+\.\d+/.test(host)) { score += 20; signals.push('host_is_ip_address'); }
  if (result.url.length > 120) { score += 10; signals.push('long_url'); }
  if ((result.redirects || []).length >= 3) { score += 15; signals.push('multiple_redirects'); }
  if (result.http?.status >= 400) { score += 5; signals.push('http_error_status'); }
  if (result.vt?.stats?.malicious) { score += Math.min(70, result.vt.stats.malicious * 15); signals.push('virustotal_malicious_votes'); }
  if (result.vt?.stats?.suspicious) { score += Math.min(30, result.vt.stats.suspicious * 10); signals.push('virustotal_suspicious_votes'); }
  const verdict = score >= 70 ? 'high' : score >= 35 ? 'medium' : score >= 10 ? 'low' : 'clean-ish';
  return { score: Math.min(score, 100), verdict, signals };
}
async function checkUrl(input) {
  const url = normalizeUrl(input);
  await assertPublicTarget(url);
  const parsed = new URL(url);
  const domain = parseDomain(parsed.hostname);
  const started = Date.now();
  const result = { url, host: parsed.hostname, domain, dns: await dnsAnyHost(parsed.hostname), http: {}, redirects: [], vt: null, risk: null, elapsed_ms: 0 };
  try {
    let currentUrl = url;
    for (let i = 0; i < 6; i++) {
      await assertPublicTarget(currentUrl);
      const resp = await fetch(currentUrl, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), headers: { 'user-agent': 'url-email-intel/0.2 security-checker' } });
      const hop = { url: currentUrl, status: resp.status, content_type: resp.headers.get('content-type'), server: resp.headers.get('server'), location: resp.headers.get('location') };
      if (i === 0) result.http = { status: hop.status, ok: resp.ok, content_type: hop.content_type, server: hop.server, location: hop.location };
      const location = resp.headers.get('location');
      if (!location || resp.status < 300 || resp.status >= 400) break;
      currentUrl = new URL(location, currentUrl).toString();
      result.redirects.push({ to: currentUrl, status: resp.status });
      if (i === 5) result.redirects.push({ error: 'redirect_limit_reached' });
    }
    const finalHop = result.redirects.at(-1);
    if (finalHop?.to) result.final = { url: finalHop.to };
  } catch (e) {
    result.http = { error: e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : e.message };
  }
  try { result.vt = await vtLookup(url); } catch (e) { result.vt = { enabled: true, error: e.message }; }
  result.risk = scoreUrl(result);
  result.elapsed_ms = Date.now() - started;
  return result;
}
function extractUrls(text, base) {
  const found = new Set();
  const re = /https?:\/\/[^\s"'<>]+/gi;
  for (const m of String(text || '').matchAll(re)) found.add(m[0].replace(/[),.;\]]+$/g, ''));
  const $ = cheerio.load(String(text || ''));
  $('[href],[src],[action]').each((_, el) => {
    for (const attr of ['href', 'src', 'action']) {
      const v = $(el).attr(attr);
      if (!v || /^javascript:/i.test(v) || /^mailto:/i.test(v)) continue;
      try { found.add(new URL(v, base).toString()); } catch {}
    }
  });
  return [...found].filter(u => /^https?:\/\//i.test(u));
}
function summarizeUrls(urls) {
  const byHost = {};
  for (const item of urls) byHost[item.host] = (byHost[item.host] || 0) + 1;
  return Object.entries(byHost).sort((a, b) => b[1] - a[1]).map(([host, count]) => ({ host, count }));
}
function extractAuthPassFail(value) {
  const s = String(value || '').toLowerCase();
  return {
    spf: /spf=pass/.test(s) ? 'pass' : /spf=fail|spf=softfail/.test(s) ? 'fail' : 'unknown',
    dkim: /dkim=pass/.test(s) ? 'pass' : /dkim=fail/.test(s) ? 'fail' : 'unknown',
    dmarc: /dmarc=pass/.test(s) ? 'pass' : /dmarc=fail/.test(s) ? 'fail' : 'unknown'
  };
}
function safeJsonParse(value) { try { return JSON.parse(value); } catch { return null; } }

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'url-email-intel', version: '0.2.0' }));
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'invalid_credentials' });
  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.json({ user: req.session.user });
});
app.post('/api/auth/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => res.json({ ok: true }));
});
app.get('/api/auth/me', (req, res) => res.json({ user: req.session?.user || null }));
app.get('/api/stats', requireAuth, (req, res) => {
  const links = db.prepare('SELECT count(*) AS total, coalesce(sum(hits),0) AS hits FROM links').get();
  const checks = db.prepare('SELECT kind, count(*) AS count FROM checks GROUP BY kind').all();
  const lists = db.prepare('SELECT count(*) AS total FROM url_lists').get();
  const recent = db.prepare('SELECT input, kind, result_json AS resultJson, created_at AS createdAt FROM checks ORDER BY created_at DESC LIMIT 8').all().map(r => ({ ...r, result: safeJsonParse(r.resultJson), resultJson: undefined }));
  res.json({ links, checks, lists, recent });
});
app.post('/api/shorten', requireAuth, (req, res) => {
  try {
    const target = normalizeUrl(req.body.url);
    const slug = String(req.body.slug || makeSlug()).trim();
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(slug)) return res.status(400).json({ error: 'Slug must be 3-64 URL-safe characters' });
    const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : retentionDate(req.body.retentionDays || 14);
    db.prepare('INSERT INTO links (slug, target_url, title, created_by, expires_at) VALUES (?, ?, ?, ?, ?)').run(slug, target, req.body.title || null, req.session.user.id, expiresAt);
    res.json({ slug, shortUrl: absoluteUrl(req, slug), targetUrl: target, expiresAt });
  } catch (e) {
    const status = String(e.message).includes('UNIQUE') ? 409 : 400;
    res.status(status).json({ error: status === 409 ? 'Slug already exists' : e.message });
  }
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
    await assertPublicTarget(sourceUrl);
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), headers: { 'user-agent': 'url-email-intel/0.2 master-url-lister' } });
    if (!response.ok) throw new Error(`Fetch failed with HTTP ${response.status}`);
    const html = await response.text();
    const urls = extractUrls(html, sourceUrl).map(u => ({ url: u, host: new URL(u).hostname, rootDomain: parseDomain(new URL(u).hostname).domain })).sort((a, b) => a.host.localeCompare(b.host));
    db.prepare('INSERT INTO url_lists (source_url, urls_json, created_by) VALUES (?, ?, ?)').run(sourceUrl, JSON.stringify(urls), req.session.user.id);
    res.json({ sourceUrl, count: urls.length, summary: summarizeUrls(urls), urls });
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
    const mx = domain ? await dnsMx(domain) : null;
    const spf = domain ? await dnsTxt(domain) : null;
    const dmarc = domain ? await dnsTxt(`_dmarc.${domain}`) : null;
    const auth = extractAuthPassFail(authResults);
    const warnings = [];
    if (replyTo && from && replyTo.split('@')[1]?.toLowerCase() !== domain) warnings.push('reply_to_domain_mismatch');
    if (auth.spf === 'fail' || auth.dkim === 'fail' || auth.dmarc === 'fail') warnings.push('auth_failure');
    if (urls.length) warnings.push('embedded_urls_present');
    const result = { subject: parsed.subject || '', from, replyTo, returnPath: String(returnPath), messageId: parsed.messageId, date: parsed.date, domain, mx, spf, dmarc, authenticationResults: String(authResults), auth, warnings, receivedCount: received.length, received, urls, urlSummary: summarizeUrls(urls) };
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
