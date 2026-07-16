import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const api = async (path, opts = {}) => {
  const headers = opts.body instanceof FormData ? {} : { 'content-type': 'application/json' };
  const res = await fetch(path, { credentials: 'include', headers, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const fmt = value => value ? new Date(value).toLocaleString() : '-';
const Json = ({ data }) => <pre className="json">{data ? JSON.stringify(data, null, 2) : 'No result yet'}</pre>;

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(fn) {
    setBusy(true); setError('');
    try { return await fn(); } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  }
  return { busy, error, run, clear: () => setError('') };
}

function App() {
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState('overview');
  const [loginError, setLoginError] = useState('');
  useEffect(() => { api('/api/auth/me').then(d => setUser(d.user)).catch(() => setUser(null)); }, []);
  if (user === undefined) return <main className="login"><section className="card"><h1>Loading…</h1></section></main>;
  if (!user) return <Login onLogin={setUser} error={loginError} setError={setLoginError} />;
  return <main>
    <header>
      <div><p className="eyebrow">Security Ops Lab</p><h1>URL & Email Intel</h1></div>
      <div className="user"><span>{user.email}</span><button onClick={() => api('/api/auth/logout', { method: 'POST' }).finally(() => setUser(null))}>Logout</button></div>
    </header>
    <section className="hero"><div><h2>Phishing surface, one console.</h2><p>Short links, URL extraction, reputation checks, MX/SPF/DMARC, and .eml triage in a clean operator UI.</p></div><div className="badge">Auth protected · SQLite · VT optional · SSRF guard</div></section>
    <nav>{['overview','shortener','master','checker','email','toolkit'].map(t => <button className={tab===t?'active':''} onClick={() => setTab(t)} key={t}>{label(t)}</button>)}</nav>
    {tab === 'overview' && <Overview />}
    {tab === 'shortener' && <Shortener />}
    {tab === 'master' && <MasterList />}
    {tab === 'checker' && <Checker />}
    {tab === 'email' && <EmailAnalyzer />}
    {tab === 'toolkit' && <Toolkit />}
  </main>;
}
function label(t){ return ({overview:'Overview', shortener:'URL Shortener', master:'Master URL Lister', checker:'URL Checker', email:'Email/Sender Analyzer', toolkit:'URL/Email Toolkit'})[t]; }
function Login({ onLogin, error, setError }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  async function submit(e){ e.preventDefault(); setError(''); try { const d = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ email, password }) }); onLogin(d.user); } catch(e){ setError(e.message); } }
  return <main className="login"><section className="card"><p className="eyebrow">URL & Email Intel</p><h1>Security project console</h1><p>Log in to access the URL shortener, reputation checker, and .eml analyzer.</p><form onSubmit={submit}><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email"/><input value={password} onChange={e=>setPassword(e.target.value)} placeholder="password" type="password"/><button>Login</button></form>{error && <p className="err">{error}</p>}<p className="hint">First run creates data/INITIAL_ADMIN.txt if ADMIN_PASSWORD is not set.</p></section></main>;
}
function Notice({ action }) { return <>{action.error && <p className="err">{action.error}</p>}{action.busy && <p className="hint">Working…</p>}</>; }
function Overview(){ const [stats,setStats]=useState(null); const action=useAction(); useEffect(()=>{ action.run(async()=>setStats(await api('/api/stats'))); },[]); return <Panel title="Operations overview"><Notice action={action}/>{stats && <><div className="metrics"><Metric label="Short links" value={stats.links.total}/><Metric label="Total hits" value={stats.links.hits}/><Metric label="URL lists" value={stats.lists.total}/><Metric label="Checks" value={stats.checks.reduce((n,c)=>n+c.count,0)}/></div><h3>Recent investigations</h3><div className="table">{stats.recent.map((r,i)=><div key={i}><b>{r.kind.toUpperCase()} · {r.input}</b><span>{r.result?.risk?.verdict || r.result?.subject || 'recorded'}</span><small>{fmt(r.createdAt)}</small></div>)}</div></>}</Panel>; }
function Metric({label,value}){ return <div className="metric"><strong>{value}</strong><span>{label}</span></div>; }
function Shortener(){ const [url,setUrl]=useState(''); const [days,setDays]=useState(14); const [slug,setSlug]=useState(''); const [result,setResult]=useState(null); const [links,setLinks]=useState([]); const action=useAction(); const refresh=()=>api('/api/shorten').then(d=>setLinks(d.links)); useEffect(()=>{refresh().catch(()=>{});},[]); async function submit(e){e.preventDefault(); await action.run(async()=>{ const d=await api('/api/shorten',{method:'POST',body:JSON.stringify({url,retentionDays:days,slug:slug||undefined})}); setResult(d); setUrl(''); setSlug(''); await refresh(); });} return <Panel title="Shorten with retention"><form onSubmit={submit} className="grid"><input required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com/payroll-login"/><input type="number" min="1" max="365" value={days} onChange={e=>setDays(e.target.value)} title="Retention days"/><input value={slug} onChange={e=>setSlug(e.target.value)} placeholder="custom slug (optional)"/><button disabled={action.busy}>Create</button></form><Notice action={action}/>{result && <div className="result"><a href={result.shortUrl} target="_blank">{result.shortUrl}</a><small>Expires {fmt(result.expiresAt)}</small></div>}<h3>Recent links</h3><div className="table">{links.map(l=><div key={l.slug}><b>{l.slug}</b><span>{l.targetUrl}</span><small>{l.hits} hits · expires {fmt(l.expiresAt)}</small></div>)}</div></Panel>; }
function MasterList(){ const [url,setUrl]=useState(''); const [result,setResult]=useState(null); const action=useAction(); async function submit(e){e.preventDefault(); await action.run(async()=>setResult(await api('/api/master-list',{method:'POST',body:JSON.stringify({url})})));} return <Panel title="Master URL lister"><p>Fetch a page, resolve relative links, and group extracted URLs by host/root domain.</p><form onSubmit={submit} className="grid"><input required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com"/><button disabled={action.busy}>Extract</button></form><Notice action={action}/>{result && <><div className="metrics"><Metric label="URLs found" value={result.count}/><Metric label="Unique hosts" value={result.summary.length}/></div><div className="chips">{result.summary.slice(0,8).map(x=><span key={x.host}>{x.host} · {x.count}</span>)}</div></>}<Json data={result}/></Panel>; }
function Checker(){ const [url,setUrl]=useState(''); const [result,setResult]=useState(null); const action=useAction(); async function submit(e){e.preventDefault(); await action.run(async()=>setResult(await api('/api/check-url',{method:'POST',body:JSON.stringify({url})})));} return <Panel title="URL checker"><p>DNS, HTTP status/redirect chain, SSRF guard, domain parsing, risk score, and VirusTotal reputation when configured.</p><form onSubmit={submit} className="grid"><input required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://suspicious.example/path"/><button disabled={action.busy}>Check</button></form><Notice action={action}/>{result?.risk && <div className={`risk ${result.risk.verdict}`}><b>{result.risk.verdict}</b><span>Risk score {result.risk.score}/100</span><small>{result.risk.signals.join(', ') || 'No obvious heuristic hits'}</small></div>}<Json data={result}/></Panel>; }
function EmailAnalyzer(){ const [result,setResult]=useState(null); const action=useAction(); async function submit(e){e.preventDefault(); const fd=new FormData(e.currentTarget); await action.run(async()=>setResult(await api('/api/email-analyze',{method:'POST',body:fd})));} return <Panel title="Email/Sender analyzer"><p>Upload .eml to inspect sender identity, MX, SPF TXT, DMARC TXT, Authentication-Results, Received chain, and embedded URLs.</p><form onSubmit={submit} className="grid"><input required name="eml" type="file" accept=".eml,message/rfc822"/><button disabled={action.busy}>Analyze</button></form><Notice action={action}/>{result && <><div className="metrics"><Metric label="Received hops" value={result.receivedCount}/><Metric label="Embedded URLs" value={result.urls.length}/><Metric label="Warnings" value={result.warnings.length}/></div><div className="chips">{result.warnings.map(w=><span key={w}>{w}</span>)}</div></>}<Json data={result}/></Panel>; }
function Toolkit(){ const [text,setText]=useState('hxxps://example[.]com/login'); const refang=useMemo(()=>text.replaceAll('hxxp','http').replaceAll('[.]','.').replaceAll('(.)','.'),[text]); const defang=useMemo(()=>text.replace(/https?:\/\//g,m=>m.replace('http','hxxp')).replace(/\./g,'[.]'),[text]); const domains=useMemo(()=>[...new Set(refang.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}/gi)||[])], [refang]); return <Panel title="URL/Email quick toolkit"><textarea value={text} onChange={e=>setText(e.target.value)} /><div className="cards"><div><h3>Refang</h3><code>{refang}</code></div><div><h3>Defang</h3><code>{defang}</code></div><div><h3>Domains</h3><code>{domains.join('\n') || 'none'}</code></div></div></Panel>; }
function Panel({title, children}){ return <section className="card"><h2>{title}</h2>{children}</section>; }

createRoot(document.getElementById('root')).render(<App/>);
