# Website Analytics Dashboard — real backend

A small self-hosted analytics service: a tracking pixel/script you drop on
any site you own, a backend that logs real pageviews, and a dashboard that
shows them live.

## What actually happens now (vs. the old version)

The original file faked everything in the browser with `localStorage` and
`Math.random()` — it could only ever "see" your own browser, never real
visitors. This version:

- Logs a real row (time, page, referrer, browser, OS, rough location) every
  time the tracking pixel loads, from **any device that visits your site**.
- Stores it server-side (`data/visitors.json`), so it's not tied to one
  browser.
- Serves the dashboard from that same server, refreshing every 5s.

It only starts collecting data once it's **deployed somewhere reachable** —
running it on your laptop only tracks pages that hit your laptop.

## Run it locally

```bash
npm install
npm start
```

- Dashboard: http://localhost:3000/dashboard.html
- Tracking test: http://localhost:3000/track.gif?page=/test

Locally, IPs resolve to "Unknown" location since 127.0.0.1 / private IPs
aren't in any geo database — that's expected, not a bug. It'll resolve real
cities/countries once deployed with real public traffic.

## Add tracking to a site you own

Drop this one line right before `</body>` on any page you want tracked:

```html
<script src="https://YOUR-DEPLOYED-DOMAIN/track.js"></script>
```

(The dashboard also shows this snippet with your actual domain filled in,
under "Add tracking to any site".)

Every page load on that site pings your `/track.gif` endpoint and shows up
in the dashboard within 5 seconds.

## Deploying so it's actually reachable

Any Node host works. Two easy free-tier options:

**Render.com**
1. Push this folder to a GitHub repo.
2. New → Web Service → connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Deploy — you'll get a URL like `https://your-app.onrender.com`.

**Railway.app**
1. `railway init` in this folder, then `railway up` (or connect the GitHub repo in their dashboard).
2. It auto-detects `npm start`.

Either way, once deployed:
- Dashboard lives at `https://your-app-url/dashboard.html`.
- Add `<script src="https://your-app-url/track.js"></script>` to the sites
  you want tracked.

## Notes / limitations (read before relying on this)

- **Storage**: a JSON file, capped at the last 20,000 visits. Fine for a
  personal site or small project. For real production traffic, swap
  `store.js` for Postgres/SQLite — `server.js` only calls
  `addVisit / getStats / getRecentVisitors / getHourlyBuckets / getTopPages`,
  so you can reimplement just that file.
- **Free hosting tiers sleep** when idle (e.g. Render's free plan spins
  down after 15 min of no traffic, then takes a few seconds to wake back up
  on the next request) — fine for personal use, not for anything
  latency-sensitive.
- **Privacy**: IPs are hashed (SHA-256 + salt) before being stored — raw
  IPs are never written to disk. Set your own `IP_SALT` env var in
  production. Still, tracking visitors on a site has legal implications
  (e.g. GDPR/ePrivacy in the EU, CCPA in California) depending on who
  visits and where you operate — a cookie/privacy notice is likely required
  if you deploy this on a public site. This isn't legal advice; check what
  applies to your situation.
- **Ad blockers**: privacy-focused browsers and ad blockers commonly block
  tracking pixels and third-party cookies, so numbers will always
  undercount real traffic to some degree — true of virtually all
  client-side analytics, not specific to this setup.
- **Bounce rate** is computed from real sessions (visits from the same
  visitor within a 30-minute window; a session with one pageview counts as
  a bounce) — no longer a random number.

## Project structure

```
server.js            Express app: routes for /track.gif, /track.js, /api/*
store.js              JSON-file storage + stats/aggregation logic
public/dashboard.html  Frontend, fetches live data from the API
data/visitors.json     Where visits are persisted (created automatically)
```
