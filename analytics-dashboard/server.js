// server.js — Real visitor-tracking backend
//
// What this does:
//   1. Serves a 1x1 tracking pixel / a small JS snippet that other sites embed.
//   2. Every time that pixel/script loads on a visited page, it logs a real
//      pageview: IP (hashed), rough geo-location, browser, OS, page, referrer.
//   3. Exposes a small JSON API that the dashboard reads and auto-refreshes.
//
// Storage: a local JSON file (data/visitors.json). No database server to set
// up — good for a personal site or small project. Swap `store.js` for a real
// DB (Postgres/SQLite) later without touching the routes if traffic grows.

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const geoip = require('geoip-lite');
const { UAParser } = require('ua-parser-js');
const { nanoid } = require('nanoid');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the first proxy hop (Render/Railway/Heroku/Fly all sit behind one)
// so req.ip reflects the real visitor, not the load balancer.
app.set('trust proxy', 1);

// A transparent 1x1 GIF, served for every /track.gif hit.
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
);

// --- CORS: the tracking pixel/script is loaded from *other* websites, so
// this endpoint must allow cross-origin requests. The dashboard itself is
// same-origin, so only /track.gif and /track.js need the open policy.
function allowCrossOrigin(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
}

function getVisitorIp(req) {
  // req.ip already respects X-Forwarded-For because of `trust proxy` above.
  return req.ip || req.connection.remoteAddress || 'unknown';
}

function hashIp(ip) {
  // We never store raw IPs. A salted one-way hash still lets us count
  // "unique visitors" without keeping personal data around.
  const salt = process.env.IP_SALT || 'change-this-salt-in-production';
  return crypto.createHash('sha256').update(ip + salt).digest('hex').slice(0, 16);
}

function getOrSetVisitorCookie(req, res) {
  const existing = req.cookies && req.cookies.aid;
  if (existing) return existing;
  const id = nanoid();
  // Cookie is set on the analytics domain (first-party here), 1 year expiry.
  // Some browsers block third-party cookies on other sites' pages — the
  // IP hash is the fallback for uniqueness in that case.
  res.cookie && res.cookie('aid', id, { maxAge: 365 * 24 * 3600 * 1000 });
  return id;
}

// Minimal cookie parsing (avoids pulling in cookie-parser for one field).
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    header.split(';').forEach((pair) => {
      const [k, ...v] = pair.trim().split('=');
      req.cookies[k] = decodeURIComponent(v.join('='));
    });
  }
  res.cookie = (name, value, opts = {}) => {
    const maxAge = opts.maxAge ? `; Max-Age=${Math.floor(opts.maxAge / 1000)}` : '';
    res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; SameSite=None; Secure${maxAge}`);
  };
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---------------------------------------------------------------------------
// GET /track.gif — the actual tracking endpoint. Embed this as an <img> (or
// use the /track.js snippet below, which does it automatically) on any page
// you want to track.
// ---------------------------------------------------------------------------
app.get('/track.gif', (req, res) => {
  allowCrossOrigin(req, res);

  const ip = getVisitorIp(req);
  const visitorId = getOrSetVisitorCookie(req, res);
  const ua = UAParser(req.headers['user-agent'] || '');
  const geo = geoip.lookup(ip.replace('::ffff:', ''));

  store.addVisit({
    id: Date.now() + '-' + nanoid(6),
    visitorId,
    ipHash: hashIp(ip),
    timestamp: new Date().toISOString(),
    page: req.query.page || '/',
    title: req.query.title || '',
    referrer: req.query.ref || 'Direct',
    browser: ua.browser.name || 'Other',
    os: ua.os.name || 'Other',
    device: ua.device.type || 'desktop',
    country: geo ? geo.country : 'Unknown',
    city: geo ? geo.city : 'Unknown',
  });

  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store');
  res.send(TRACKING_PIXEL);
});

// ---------------------------------------------------------------------------
// GET /track.js — drop this one line on any site instead of hand-building
// the pixel:  <script src="https://YOUR-DOMAIN/track.js"></script>
// ---------------------------------------------------------------------------
app.get('/track.js', (req, res) => {
  allowCrossOrigin(req, res);
  const origin = `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(`(function(){
  var img = new Image();
  var params = new URLSearchParams({
    page: location.pathname,
    title: document.title,
    ref: document.referrer || 'Direct'
  });
  img.src = "${origin}/track.gif?" + params.toString();
})();`);
});

// ---------------------------------------------------------------------------
// JSON API consumed by the dashboard
// ---------------------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  res.json(store.getStats());
});

app.get('/api/visitors', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 200);
  res.json(store.getRecentVisitors(limit));
});

app.get('/api/chart', (req, res) => {
  const hours = Math.min(parseInt(req.query.hours) || 24, 24 * 30);
  res.json(store.getHourlyBuckets(hours));
});

app.get('/api/top-pages', (req, res) => {
  res.json(store.getTopPages());
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Analytics backend running on http://localhost:${PORT}`);
  console.log(`Dashboard:      http://localhost:${PORT}/dashboard.html`);
  console.log(`Tracking pixel: http://localhost:${PORT}/track.gif`);
  console.log(`Tracking script:http://localhost:${PORT}/track.js`);
});
