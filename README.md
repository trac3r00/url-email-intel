# URL & Email Intel

Auth-protected security project console for URL and email investigations.

## Features

- URL Shortener with a 14-day default retention policy, custom retention up to 365 days, optional custom slugs, hit counts, and expiry handling
- Master URL Lister: fetch one URL and extract/normalize all linked URLs, then summarize by host
- URL Checker: DNS records, HTTP status, redirect chain, root-domain parsing, SSRF guard, heuristic risk score, optional VirusTotal reputation
- Email/Sender Analyzer: upload `.eml`, inspect From/Reply-To/Return-Path, MX, SPF TXT, DMARC TXT, Authentication-Results, Received chain, embedded URLs, and warnings
- Overview dashboard with recent investigations
- Quick defang/refang/domain extraction toolkit for phishing notes
- Cookie-session auth backed by SQLite

## Local run

```bash
cp .env.example .env
npm install
npm run build
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=change-me SESSION_SECRET=$(openssl rand -base64 32) npm start
```

Open http://localhost:4177 and log in.

If `ADMIN_PASSWORD` is not set on first boot, the app writes a one-time random admin credential to `data/INITIAL_ADMIN.txt`.

## Test

```bash
npm test
npm run build
npm run smoke
npm run test:e2e
```

`test:e2e` runs Playwright against the real built app and checks login, shortener, URL checker, email analyzer, and visible API-error handling.

## VirusTotal

Set `VIRUSTOTAL_API_KEY` to enable URL reputation. Without it, URL checks still return DNS/HTTP/redirect intelligence and mark VT as disabled.

## SSRF guard

By default, active URL fetch/check endpoints block localhost and private network targets. For a trusted local lab only, set:

```bash
ALLOW_PRIVATE_TARGETS=true
```

## Deploy

### Render Blueprint

This repo includes `render.yaml` and Dockerfile. Create a Render Blueprint from the GitHub repo and set:

- `PUBLIC_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- optional `VIRUSTOTAL_API_KEY`

The blueprint provisions a persistent disk at `/app/data` for SQLite.

### Docker

```bash
docker build -t url-email-intel .
docker run -p 4177:4177 \
  -e NODE_ENV=production \
  -e PUBLIC_URL=http://localhost:4177 \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=change-me \
  -e SESSION_SECRET=$(openssl rand -base64 32) \
  -v url-email-intel-data:/app/data \
  url-email-intel
```

## Security notes

- Do not expose this without a strong `SESSION_SECRET` and admin password.
- SQLite is fine for a small portfolio/security console; move to Postgres before multi-user production.
- Uploaded `.eml` files are parsed in memory and not persisted.
- Active fetch endpoints intentionally do not scan private network targets unless `ALLOW_PRIVATE_TARGETS=true`.
