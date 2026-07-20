# URL & Email Intel

An authenticated web console for investigating URLs, inspecting email metadata, and managing short links.

[![CI](https://github.com/Trac3r00/url-email-intel/actions/workflows/ci.yml/badge.svg)](https://github.com/Trac3r00/url-email-intel/actions/workflows/ci.yml)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-F7DF1E?logo=javascript&logoColor=000)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)

## Overview

URL & Email Intel combines a React interface with an Express API and SQLite storage. It provides a small, single-admin workspace for URL analysis, `.eml` inspection, shareable URL lists, and expiring short links. Most API operations require an authenticated session; generated short links and URL-list views are public.

## Features

- **URL checker:** resolves A, AAAA, and CNAME records; follows HTTP redirects; parses the registrable domain; records response metadata; and assigns a heuristic risk score.
- **VirusTotal integration:** adds URL reputation data when `VIRUSTOTAL_API_KEY` is configured.
- **SSRF protection:** blocks localhost and private-network destinations for active URL checks, including redirect targets, unless explicitly disabled for a trusted lab.
- **Email analyzer:** accepts `.eml` files up to 5 MiB, extracts sender and routing metadata, reports SPF/DKIM/DMARC outcomes from `Authentication-Results`, queries sender-domain MX/SPF/DMARC DNS records, and lists embedded URLs.
- **Short links:** creates expiring redirects with a 14-day default retention period, configurable retention from 1 to 365 days, optional custom slugs, and hit counts.
- **URL lists:** publishes user-supplied URLs at a shareable plain-text endpoint.
- **Investigation dashboard:** summarizes links, clicks, URL lists, checks, and recent activity.
- **Analyst toolkit:** defangs and refangs URL text and extracts domain names in the browser.
- **Persistent sessions and records:** stores users, sessions, links, lists, and analysis results in SQLite.

The risk score is heuristic context for an analyst, not a definitive safety verdict.

## Architecture

```text
Browser
  |
  | React UI and same-origin API requests
  v
Express server ---------------------> DNS / HTTP targets
  |                                      |
  |                                      +--> VirusTotal API (optional)
  |
  +--> SQLite (users, sessions, links, lists, analysis results)
  |
  +--> Public redirects (/s/:slug) and URL lists (/m/:slug)
```

Vite serves the React application during development and builds it into `dist/`. In a production build, the Express server serves both the static application and the API. Uploaded `.eml` files are parsed in memory; the original files are not written to disk.

## Requirements

- Node.js 22 or newer
- npm
- Network access for DNS queries, URL checks, and optional VirusTotal lookups

## Installation

Install the locked dependency versions:

```bash
git clone https://github.com/Trac3r00/url-email-intel.git
cd url-email-intel
npm ci
```

## Usage

### Development

Start the Express API and Vite development server together:

```bash
export ADMIN_EMAIL=admin@example.com
export ADMIN_PASSWORD='replace-with-a-strong-password'
export SESSION_SECRET="$(openssl rand -base64 32)"
npm run dev
```

Open the URL printed by Vite. API, short-link, and URL-list requests are proxied to `http://localhost:4177`.

### Production build

Build the frontend, then start the combined application:

```bash
npm run build
export NODE_ENV=production
export PUBLIC_URL=http://localhost:4177
export ADMIN_EMAIL=admin@example.com
export ADMIN_PASSWORD='replace-with-a-strong-password'
export SESSION_SECRET="$(openssl rand -base64 32)"
npm start
```

Open [http://localhost:4177](http://localhost:4177) and sign in with the configured administrator credentials.

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are used only when the users table is empty. If `ADMIN_PASSWORD` is omitted on first startup, the server generates a password and writes the initial credentials to `DATA_DIR/INITIAL_ADMIN.txt` (by default, `data/INITIAL_ADMIN.txt`) with owner-only permissions.

### Loading `.env.example`

The repository includes `.env.example`, but the application does not load `.env` files itself. To use a local `.env` file in a POSIX-compatible shell:

```bash
cp .env.example .env
# Edit .env and replace the example credentials and session secret.
set -a
. ./.env
set +a
npm start
```

Build the frontend with `npm run build` before using this command outside the development workflow.

## Configuration

Configuration is supplied through environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4177` | Port used by the Express server. |
| `PUBLIC_URL` | Request origin | Public base URL used when generating short-link and URL-list URLs. |
| `DATA_DIR` | `./data` | Directory containing `app.db` and, when generated, `INITIAL_ADMIN.txt`. |
| `ADMIN_EMAIL` | `admin@example.com` | Email assigned to the initial administrator account. |
| `ADMIN_PASSWORD` | Random on first startup | Password assigned to the initial administrator account. |
| `SESSION_SECRET` | Development-only fallback | Secret used to sign session cookies. Set a strong value for every deployment. |
| `VIRUSTOTAL_API_KEY` | Unset | Enables VirusTotal URL reputation lookups. |
| `HTTP_TIMEOUT_MS` | `12000` | Timeout in milliseconds for each outbound HTTP request made by the URL checker. |
| `ALLOW_PRIVATE_TARGETS` | `false` | Set to `true` only in a trusted lab to permit localhost and private-network URL checks. |
| `COOKIE_SECURE` | Automatic | Set to `false` only for production-mode testing over plain HTTP. In production, secure-cookie handling otherwise follows the proxied request protocol. |
| `NODE_ENV` | Unset | Set to `production` to enable production defaults, including automatic secure-cookie handling. |

Never commit `.env`, `INITIAL_ADMIN.txt`, the SQLite database, or API keys. The existing `.gitignore` excludes `.env` and the default `data/` directory.

## Development

Available validation commands:

```bash
npm test          # Node.js API and package tests
npm run build     # Production frontend build
npm run smoke     # Live API smoke test against an isolated temporary database
npm run test:e2e  # Playwright end-to-end tests against the built application
```

Install Playwright's Chromium browser before the first end-to-end test run:

```bash
npx playwright install chromium
```

The CI workflow runs `npm ci`, the Node.js tests, the production build, and the Playwright suite on pushes and pull requests.

## Deployment

### Docker

The included multi-stage Dockerfile builds and runs the application on Node.js 26:

```bash
docker build -t url-email-intel .
docker run --rm -p 4177:4177 \
  -e NODE_ENV=production \
  -e PUBLIC_URL=http://localhost:4177 \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD='replace-with-a-strong-password' \
  -e SESSION_SECRET='replace-with-a-long-random-secret' \
  -v url-email-intel-data:/app/data \
  url-email-intel
```

### Render

`render.yaml` defines a Render Blueprint backed by the repository's Dockerfile. It provisions a 1 GiB persistent disk at `/app/data` and declares the production URL, administrator credentials, session secret, and optional VirusTotal API key as environment variables.

## Project structure

```text
server/index.js        Express API, authentication, SQLite storage, and static serving
src/App.jsx            React application and investigation tools
src/style.css          Application styles
scripts/smoke.js       Live API smoke test
tests/                 Node.js and Playwright tests
Dockerfile             Production container image
render.yaml            Render Blueprint
vite.config.js         Frontend build and development proxy configuration
```

## Security considerations

- Use strong, unique values for `ADMIN_PASSWORD` and `SESSION_SECRET` before exposing the service.
- Keep `ALLOW_PRIVATE_TARGETS` disabled outside an isolated, trusted environment.
- Treat URL checks and email-analysis results as investigative signals rather than guarantees.
- The application is designed around one seeded administrator and SQLite-backed local persistence; it does not implement user-management workflows.

## License

This repository does not currently include a license file.
