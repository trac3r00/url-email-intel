import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const api = async (path, opts = {}) => {
  const res = await fetch(path, { credentials: 'include', headers: opts.body instanceof FormData ? {} : { 'content-type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const Json = ({ data }) => <pre className="json">{data ? JSON.stringify(data, null, 2) : 'No result yet'}</pre>;

function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('shortener');
  const [error, setError] = useState('');
  useEffect(() => { api('/api/auth/me').then(d => setUser(d.user)); }, []);
  if (!user) return <Login onLogin={setUser} error={error} setError={setError} />;
  return <main>
    <header><div><p className="eyebrow">Security Ops Lab</p><h1>URL & Email Intel</h1></div><button onClick={() => api('/api/auth/logout', { method: 'POST' }).then(() => setUser(null))}>Logout</button></header>
    <section className="hero"><div><h2>Phishing surface, one console.</h2><p>Short links, URL extraction, reputation checks, MX/SPF/DMARC, and .eml triage in a clean operator UI.</p></div><div className="badge">Auth protected · SQLite · VT optional</div></section>
    <nav>{['shortener','master','checker','email','toolkit'].map(t => <button className={tab===t?'active':''} onClick={() => setTab(t)} key={t}>{label(t)}</button>)}</nav>
    {tab === 'shortener' && <Shortener />}
    {tab === 'master' && <MasterList />}
    {tab === 'checker' && <Checker />}
    {tab === 'email' && <EmailAnalyzer />}
    {tab === 'toolkit' && <Toolkit />}
  </main>;
}
function label(t){ return ({shortener:'URL Shortener', master:'Master URL Lister', checker:'URL Checker', email:'Email/Sender Analyzer', toolkit:'URL/Email Toolkit'})[t]; }
function Login({ onLogin, error, setError }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  async function submit(e){ e.preventDefault(); setError(''); try { const d = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ email, password }) }); onLogin(d.user); } catch(e){ setError(e.message); } }
  return <main className="login"><section className="card"><p className="eyebrow">URL & Email Intel</p><h1>Security project console</h1><p>Log in to access the URL shortener, reputation checker, and .eml analyzer.</p><form onSubmit={submit}><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email"/><input value={password} onChange={e=>setPassword(e.target.value)} placeholder="password" type="password"/><button>Login</button></form>{error && <p className="err">{error}</p>}<p className="hint">First run creates data/INITIAL_ADMIN.txt if ADMIN_PASSWORD is not set.</p></section></main>;
}
function Shortener(){ const [url,setUrl]=useState(''); const [days,setDays]=useState(14); const [result,setResult]=useState(null); const [links,setLinks]=useState([]); const refresh=()=>api('/api/shorten').then(d=>setLinks(d.links)); useEffect(refresh,[]); async function submit(e){e.preventDefault(); const d=await api('/api/shorten',{method:'POST',body:JSON.stringify({url,retentionDays:days})}); setResult(d); refresh();} return <Panel title="Shorten with retention"><form onSubmit={submit} className="grid"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com/payroll-login"/><input type="number" min="1" max="365" value={days} onChange={e=>setDays(e.target.value)} /><button>Create</button></form><Json data={result}/><h3>Recent links</h3><div className="table">{links.map(l=><div key={l.slug}><b>{l.slug}</b><span>{l.targetUrl}</span><small>{l.hits} hits · expires {new Date(l.expiresAt).toLocaleDateString()}</small></div>)}</div></Panel>; }
function MasterList(){ const [url,setUrl]=useState(''); const [result,setResult]=useState(null); async function submit(e){e.preventDefault(); setResult(await api('/api/master-list',{method:'POST',body:JSON.stringify({url})}));} return <Panel title="Master URL lister"><p>Fetch a page, resolve relative links, and group extracted URLs by host/root domain.</p><form onSubmit={submit} className="grid"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com"/><button>Extract</button></form><Json data={result}/></Panel>; }
function Checker(){ const [url,setUrl]=useState(''); const [result,setResult]=useState(null); async function submit(e){e.preventDefault(); setResult(await api('/api/check-url',{method:'POST',body:JSON.stringify({url})}));} return <Panel title="URL checker"><p>DNS, HTTP status/redirect chain, domain parsing, and VirusTotal reputation when VIRUSTOTAL_API_KEY is configured.</p><form onSubmit={submit} className="grid"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://suspicious.example/path"/><button>Check</button></form><Json data={result}/></Panel>; }
function EmailAnalyzer(){ const [result,setResult]=useState(null); async function submit(e){e.preventDefault(); const fd=new FormData(e.currentTarget); setResult(await api('/api/email-analyze',{method:'POST',body:fd}));} return <Panel title="Email/Sender analyzer"><p>Upload .eml to inspect sender identity, MX, SPF TXT, DMARC TXT, Authentication-Results, Received chain, and embedded URLs.</p><form onSubmit={submit} className="grid"><input name="eml" type="file" accept=".eml,message/rfc822"/><button>Analyze</button></form><Json data={result}/></Panel>; }
function Toolkit(){ const [text,setText]=useState('hxxps://example[.]com/login'); const refang=text.replaceAll('hxxp','http').replaceAll('[.]','.').replaceAll('(.)','.'); const defang=text.replace(/https?:\/\//g,m=>m.replace('http','hxxp')).replace(/\./g,'[.]'); return <Panel title="URL/Email quick toolkit"><textarea value={text} onChange={e=>setText(e.target.value)} /><div className="cards"><div><h3>Refang</h3><code>{refang}</code></div><div><h3>Defang</h3><code>{defang}</code></div></div></Panel>; }
function Panel({title, children}){ return <section className="card"><h2>{title}</h2>{children}</section>; }

createRoot(document.getElementById('root')).render(<App/>);
