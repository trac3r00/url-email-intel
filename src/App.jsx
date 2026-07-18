import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

/* ─── API helper ──────────────────────────── */
const api = async (path, opts = {}) => {
  const headers = opts.body instanceof FormData ? {} : { 'content-type': 'application/json' };
  const res = await fetch(path, { credentials: 'include', headers, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};

/* ─── Shared UI primitives (shadcn-style) ─── */
function Button({ children, variant = 'default', className = '', ...props }) {
  const base = 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 px-4 py-2';
  const variants = {
    default: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'bg-card border border-border text-zinc-200 hover:bg-card-hover',
    ghost: 'hover:bg-card-hover text-zinc-400 hover:text-zinc-100',
    destructive: 'bg-danger text-white hover:bg-red-600',
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props}>{children}</button>;
}
function Input({ className = '', ...props }) {
  return <input className={`flex h-10 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-zinc-100 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent ${className}`} {...props} />;
}
function Card({ children, className = '' }) {
  return <div className={`rounded-lg border border-border bg-card p-6 ${className}`}>{children}</div>;
}
function Badge({ children, variant = 'default' }) {
  const styles = { default: 'bg-zinc-800 text-zinc-300', success: 'bg-green-950 text-green-400 border-green-800', danger: 'bg-red-950 text-red-400 border-red-800', warning: 'bg-yellow-950 text-yellow-400 border-yellow-800' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${styles[variant]}`}>{children}</span>;
}
function EmptyState({ icon, title, description }) {
  return (
    <div className="text-center py-12">
      <div className="text-4xl mb-3">{icon}</div>
      <p className="text-sm font-medium text-zinc-400">{title}</p>
      {description && <p className="text-xs text-muted mt-1">{description}</p>}
    </div>
  );
}
function DataRow({ label, value, mono }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex justify-between items-start py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted shrink-0 mr-4">{label}</span>
      <span className={`text-xs text-zinc-200 text-right break-all ${mono ? 'font-mono' : ''}`}>{String(value)}</span>
    </div>
  );
}

/* ─── Hook ────────────────────────────────── */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(fn) {
    setBusy(true); setError('');
    try { return await fn(); } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  }
  return { busy, error, run, clear: () => setError('') };
}

/* ─── Clipboard helper ────────────────────── */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return <Button variant="secondary" onClick={copy} className="text-xs h-8 px-3">{copied ? '✓ Copied' : 'Copy'}</Button>;
}

/* ─── App ─────────────────────────────────── */
function App() {
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState('overview');
  useEffect(() => { api('/api/auth/me').then(d => setUser(d.user)).catch(() => setUser(null)); }, []);
  if (user === undefined) return <div className="min-h-screen bg-bg flex items-center justify-center"><p className="text-muted">Loading…</p></div>;
  if (!user) return <Login onLogin={setUser} />;

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'shortener', label: 'Shortener' },
    { id: 'master', label: 'URL List' },
    { id: 'checker', label: 'Checker' },
    { id: 'email', label: 'Email' },
    { id: 'toolkit', label: 'Toolkit' },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-zinc-100">URL & Email Intel</h1>
            <Badge>Security Lab</Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted hidden sm:inline">{user.email}</span>
            <Button variant="ghost" onClick={() => api('/api/auth/logout', { method: 'POST' }).finally(() => setUser(null))}>Logout</Button>
          </div>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 pt-6">
        <nav className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.id ? 'border-accent text-zinc-100' : 'border-transparent text-muted hover:text-zinc-300'}`}>
              {t.label}
            </button>
          ))}
        </nav>
        {tab === 'overview' && <Overview />}
        {tab === 'shortener' && <Shortener />}
        {tab === 'master' && <MasterList />}
        {tab === 'checker' && <Checker />}
        {tab === 'email' && <EmailAnalyzer />}
        {tab === 'toolkit' && <Toolkit />}
      </div>
    </div>
  );
}

/* ─── Login ───────────────────────────────── */
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try { const d = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); onLogin(d.user); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-100 mb-1">URL & Email Intel</h1>
          <p className="text-sm text-muted">Sign in to your security console</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" required />
          <Input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" type="password" required />
          <Button className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </Card>
    </div>
  );
}

/* ─── Overview / Dashboard ────────────────── */
function Overview() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api('/api/stats').then(setStats).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <p className="text-muted text-sm py-8 text-center">Loading stats…</p>;
  if (!stats) return <EmptyState icon="📊" title="Could not load stats" />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><p className="text-2xl font-bold text-zinc-100">{stats.links?.total ?? 0}</p><p className="text-xs text-muted mt-1">Short links</p></Card>
        <Card><p className="text-2xl font-bold text-zinc-100">{stats.links?.hits ?? 0}</p><p className="text-xs text-muted mt-1">Total clicks</p></Card>
        <Card><p className="text-2xl font-bold text-zinc-100">{stats.lists?.total ?? 0}</p><p className="text-xs text-muted mt-1">URL lists</p></Card>
        <Card><p className="text-2xl font-bold text-zinc-100">{stats.checks?.reduce?.((s, c) => s + c.count, 0) ?? 0}</p><p className="text-xs text-muted mt-1">Total checks</p></Card>
      </div>
      {stats.recent?.length > 0 && (
        <Card>
          <h2 className="text-base font-medium text-zinc-100 mb-4">Recent activity</h2>
          <div className="divide-y divide-border">
            {stats.recent.map((r, i) => (
              <div key={i} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Badge variant={r.kind === 'url' ? 'default' : 'warning'}>{r.kind}</Badge>
                  <span className="ml-2 text-sm text-zinc-300 truncate">{r.input}</span>
                </div>
                <span className="text-xs text-muted shrink-0">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ─── Shortener ───────────────────────────── */
function Shortener() {
  const [url, setUrl] = useState('');
  const [days, setDays] = useState(14);
  const [slug, setSlug] = useState('');
  const [result, setResult] = useState(null);
  const [links, setLinks] = useState([]);
  const action = useAction();
  const refresh = () => api('/api/shorten').then(d => setLinks(d.links)).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function submit(e) {
    e.preventDefault();
    await action.run(async () => {
      const d = await api('/api/shorten', { method: 'POST', body: JSON.stringify({ url, retentionDays: days, slug: slug || undefined }) });
      setResult(d); setUrl(''); setSlug(''); await refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-base font-medium text-zinc-100 mb-4">Create short link</h2>
        <form onSubmit={submit} className="space-y-3">
          <Input required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/long-url" type="url" />
          <div className="flex flex-col sm:flex-row gap-3">
            <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder="Custom slug (optional)" className="flex-1" />
            <Input type="number" min="1" max="365" value={days} onChange={e => setDays(e.target.value)} className="w-full sm:w-24" title="Retention days" />
            <Button disabled={action.busy}>{action.busy ? 'Creating…' : 'Shorten'}</Button>
          </div>
        </form>
        {action.error && <p className="mt-3 text-sm text-danger">{action.error}</p>}
        {result && (
          <div className="mt-4 p-4 rounded-md bg-bg border border-border flex items-center justify-between gap-4">
            <div className="min-w-0">
              <a href={result.shortUrl} target="_blank" rel="noopener" className="text-accent font-mono text-sm truncate block hover:underline">{result.shortUrl}</a>
              <p className="text-xs text-muted mt-1">Expires {new Date(result.expiresAt).toLocaleDateString()}</p>
            </div>
            <CopyButton text={result.shortUrl} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-medium text-zinc-100 mb-4">Recent links</h2>
        {links.length === 0 ? (
          <EmptyState icon="🔗" title="No short links yet" description="Create your first link above" />
        ) : (
          <div className="divide-y divide-border">
            {links.map(l => (
              <div key={l.slug} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-accent font-mono">/s/{l.slug}</code>
                    <CopyButton text={`${window.location.origin}/s/${l.slug}`} />
                  </div>
                  <p className="text-xs text-muted truncate mt-0.5">{l.targetUrl}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-zinc-400">{l.hits} hits</p>
                  <p className="text-xs text-muted">exp {new Date(l.expiresAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── Master URL List ─────────────────────── */
function MasterList() {
  const [urls, setUrls] = useState('');
  const [title, setTitle] = useState('');
  const [result, setResult] = useState(null);
  const [lists, setLists] = useState([]);
  const action = useAction();
  const refresh = () => api('/api/master-list').then(d => setLists(d.lists || [])).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function submit(e) {
    e.preventDefault();
    const urlArray = urls.split('\n').map(u => u.trim()).filter(Boolean);
    if (!urlArray.length) { action.run(() => { throw new Error('Paste at least one URL'); }); return; }
    await action.run(async () => {
      const d = await api('/api/master-list', { method: 'POST', body: JSON.stringify({ urls: urlArray, title: title || undefined }) });
      setResult(d); setUrls(''); setTitle(''); await refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-base font-medium text-zinc-100 mb-1">Create URL list</h2>
        <p className="text-sm text-muted mb-4">Paste multiple URLs (one per line) — get a single shareable link that shows them as a plain text list.</p>
        <form onSubmit={submit} className="space-y-3">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="List title (optional)" />
          <textarea value={urls} onChange={e => setUrls(e.target.value)} placeholder={"https://example.com\nhttps://another.com\nhttps://third.com"} rows={5}
            className="flex w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-zinc-100 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent resize-y font-mono" />
          <Button disabled={action.busy}>{action.busy ? 'Creating…' : 'Create list link'}</Button>
        </form>
        {action.error && <p className="mt-3 text-sm text-danger">{action.error}</p>}
        {result && (
          <div className="mt-4 p-4 rounded-md bg-bg border border-border flex items-center justify-between gap-4">
            <div className="min-w-0">
              <a href={result.viewUrl} target="_blank" rel="noopener" className="text-accent font-mono text-sm truncate block hover:underline">{result.viewUrl}</a>
              <p className="text-xs text-muted mt-1">{result.count} URLs</p>
            </div>
            <CopyButton text={result.viewUrl} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-medium text-zinc-100 mb-4">Your lists</h2>
        {lists.length === 0 ? (
          <EmptyState icon="📋" title="No URL lists yet" description="Create your first list above" />
        ) : (
          <div className="divide-y divide-border">
            {lists.map(l => (
              <div key={l.slug} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-accent font-mono">/m/{l.slug}</code>
                    <CopyButton text={`${window.location.origin}/m/${l.slug}`} />
                  </div>
                  <p className="text-xs text-muted mt-0.5">{l.title || 'Untitled'} · {l.count} URLs</p>
                </div>
                <p className="text-xs text-muted shrink-0">{new Date(l.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── URL Checker ─────────────────────────── */
function Checker() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState(null);
  const action = useAction();
  async function submit(e) {
    e.preventDefault();
    await action.run(async () => setResult(await api('/api/check-url', { method: 'POST', body: JSON.stringify({ url }) })));
  }
  const verdictVariant = { 'high': 'danger', 'medium': 'warning', 'low': 'default', 'clean-ish': 'success' };

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-base font-medium text-zinc-100 mb-1">Check URL reputation</h2>
        <p className="text-sm text-muted mb-4">DNS, HTTP chain, risk scoring, VirusTotal (when configured).</p>
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3">
          <Input required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://suspicious.example/path" className="flex-1" type="url" />
          <Button disabled={action.busy}>{action.busy ? 'Checking…' : 'Check'}</Button>
        </form>
        {action.error && <p className="mt-3 text-sm text-danger">{action.error}</p>}
      </Card>
      {result && (
        <>
          {/* Risk verdict */}
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <Badge variant={verdictVariant[result.risk?.verdict] || 'default'}>{result.risk?.verdict?.toUpperCase()}</Badge>
              <span className="text-sm text-zinc-400">Score: {result.risk?.score}/100</span>
              <span className="text-xs text-muted">{result.elapsed_ms}ms</span>
            </div>
            {result.risk?.signals?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.risk.signals.map(s => <Badge key={s} variant="warning">{s.replace(/_/g, ' ')}</Badge>)}
              </div>
            )}
          </Card>

          {/* HTTP info */}
          <Card>
            <h3 className="text-sm font-medium text-zinc-300 mb-3">HTTP</h3>
            <DataRow label="Status" value={result.http?.status || result.http?.error} />
            <DataRow label="Content-Type" value={result.http?.content_type} />
            <DataRow label="Server" value={result.http?.server} />
            {result.redirects?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted mb-1">Redirect chain ({result.redirects.length} hops)</p>
                {result.redirects.map((r, i) => (
                  <p key={i} className="text-xs text-zinc-400 font-mono truncate pl-2 border-l border-border">{r.status} → {r.to || r.error}</p>
                ))}
              </div>
            )}
          </Card>

          {/* DNS records */}
          <Card>
            <h3 className="text-sm font-medium text-zinc-300 mb-3">DNS — {result.host}</h3>
            {result.dns && Object.entries(result.dns).map(([type, val]) => (
              <DataRow key={type} label={type} value={Array.isArray(val) ? val.join(', ') : val?.error || JSON.stringify(val)} mono />
            ))}
            {result.domain && <DataRow label="Root domain" value={result.domain.domain} />}
          </Card>

          {/* VirusTotal */}
          {result.vt && (
            <Card>
              <h3 className="text-sm font-medium text-zinc-300 mb-3">VirusTotal</h3>
              {!result.vt.enabled ? (
                <p className="text-xs text-muted">{result.vt.note}</p>
              ) : result.vt.found === false ? (
                <p className="text-xs text-muted">URL not yet scanned by VirusTotal</p>
              ) : (
                <>
                  {result.vt.stats && Object.entries(result.vt.stats).map(([k, v]) => (
                    <DataRow key={k} label={k} value={v} />
                  ))}
                  {result.vt.permalink && <a href={result.vt.permalink} target="_blank" rel="noopener" className="text-xs text-accent hover:underline mt-2 block">View on VirusTotal</a>}
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Email Analyzer ──────────────────────── */
function EmailAnalyzer() {
  const [result, setResult] = useState(null);
  const action = useAction();
  async function submit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!fd.get('eml')?.size) { action.run(() => { throw new Error('Select an .eml file first'); }); return; }
    await action.run(async () => setResult(await api('/api/email-analyze', { method: 'POST', body: fd })));
  }
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-base font-medium text-zinc-100 mb-1">Email / Sender Analyzer</h2>
        <p className="text-sm text-muted mb-4">Upload .eml — MX, SPF, DKIM, DMARC, auth results, received chain, embedded URLs.</p>
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 items-end">
          <input required name="eml" type="file" accept=".eml,message/rfc822"
            className="flex-1 text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-card-hover file:text-zinc-200 hover:file:bg-zinc-700" />
          <Button disabled={action.busy}>{action.busy ? 'Analyzing…' : 'Analyze'}</Button>
        </form>
        {action.error && <p className="mt-3 text-sm text-danger">{action.error}</p>}
      </Card>
      {result && (
        <>
          {/* Warnings */}
          <Card>
            <div className="flex flex-wrap gap-2 mb-4">
              {result.warnings?.length > 0
                ? result.warnings.map(w => <Badge key={w} variant="warning">{w.replace(/_/g, ' ')}</Badge>)
                : <Badge variant="success">No warnings</Badge>}
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><p className="text-2xl font-bold text-zinc-100">{result.receivedCount}</p><p className="text-xs text-muted">Hops</p></div>
              <div><p className="text-2xl font-bold text-zinc-100">{result.urls?.length || 0}</p><p className="text-xs text-muted">URLs</p></div>
              <div><p className="text-2xl font-bold text-zinc-100">{result.warnings?.length || 0}</p><p className="text-xs text-muted">Warnings</p></div>
            </div>
          </Card>

          {/* Sender info */}
          <Card>
            <h3 className="text-sm font-medium text-zinc-300 mb-3">Sender</h3>
            <DataRow label="From" value={result.from} mono />
            <DataRow label="Reply-To" value={result.replyTo} mono />
            <DataRow label="Return-Path" value={result.returnPath} mono />
            <DataRow label="Message-ID" value={result.messageId} mono />
            <DataRow label="Subject" value={result.subject} />
            <DataRow label="Date" value={result.date ? new Date(result.date).toLocaleString() : null} />
          </Card>

          {/* Auth results */}
          <Card>
            <h3 className="text-sm font-medium text-zinc-300 mb-3">Authentication — {result.domain}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {['spf', 'dkim', 'dmarc'].map(p => (
                <div key={p} className="p-3 rounded-md bg-bg border border-border text-center">
                  <p className="text-xs text-muted uppercase mb-1">{p}</p>
                  <Badge variant={result.auth?.[p] === 'pass' ? 'success' : result.auth?.[p] === 'fail' ? 'danger' : 'default'}>
                    {result.auth?.[p] || 'unknown'}
                  </Badge>
                </div>
              ))}
            </div>
            {result.mx && !result.mx.error && (
              <div className="mt-3">
                <p className="text-xs text-muted mb-1">MX Records</p>
                {Array.isArray(result.mx) && result.mx.map((r, i) => (
                  <p key={i} className="text-xs text-zinc-400 font-mono pl-2 border-l border-border">{r.priority} — {r.exchange}</p>
                ))}
              </div>
            )}
          </Card>

          {/* Received chain */}
          {result.received?.length > 0 && (
            <Card>
              <h3 className="text-sm font-medium text-zinc-300 mb-3">Received chain ({result.received.length} hops)</h3>
              <div className="space-y-2">
                {result.received.map((hop, i) => (
                  <p key={i} className="text-xs text-zinc-400 font-mono pl-2 border-l border-border break-all">{hop}</p>
                ))}
              </div>
            </Card>
          )}

          {/* Embedded URLs */}
          {result.urls?.length > 0 && (
            <Card>
              <h3 className="text-sm font-medium text-zinc-300 mb-3">Embedded URLs ({result.urls.length})</h3>
              <div className="space-y-1.5">
                {result.urls.map((u, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <code className="text-xs text-zinc-400 font-mono truncate flex-1">{u.url}</code>
                    <Badge>{u.rootDomain}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Toolkit ─────────────────────────────── */
function Toolkit() {
  const [text, setText] = useState('hxxps://example[.]com/login');
  const refang = useMemo(() => text.replaceAll('hxxp', 'http').replaceAll('[.]', '.').replaceAll('(.)', '.'), [text]);
  const defang = useMemo(() => text.replace(/https?:\/\//g, m => m.replace('http', 'hxxp')).replace(/\./g, '[.]'), [text]);
  const domains = useMemo(() => [...new Set(refang.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}/gi) || [])], [refang]);
  return (
    <Card>
      <h2 className="text-base font-medium text-zinc-100 mb-4">Defang / Refang toolkit</h2>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
        className="flex w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-zinc-100 font-mono placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent resize-y mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-3 rounded-md bg-bg border border-border">
          <div className="flex items-center justify-between mb-2"><h3 className="text-xs font-medium text-muted uppercase">Refanged</h3><CopyButton text={refang} /></div>
          <code className="text-xs text-zinc-300 break-all">{refang}</code>
        </div>
        <div className="p-3 rounded-md bg-bg border border-border">
          <div className="flex items-center justify-between mb-2"><h3 className="text-xs font-medium text-muted uppercase">Defanged</h3><CopyButton text={defang} /></div>
          <code className="text-xs text-zinc-300 break-all">{defang}</code>
        </div>
        <div className="p-3 rounded-md bg-bg border border-border">
          <div className="flex items-center justify-between mb-2"><h3 className="text-xs font-medium text-muted uppercase">Domains</h3><CopyButton text={domains.join('\n')} /></div>
          <code className="text-xs text-zinc-300 break-all">{domains.join('\n') || 'none'}</code>
        </div>
      </div>
    </Card>
  );
}

createRoot(document.getElementById('root')).render(<App />);
