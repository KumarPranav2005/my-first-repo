// store.js — simple append-only JSON file storage for visits.
//
// This is intentionally boring: one file, in-memory cache, periodic flush
// to disk. Fine for a personal site or small project (thousands of visits/
// day). If you outgrow it, swap this file for a Postgres/SQLite version —
// the function signatures below are the only contract server.js relies on.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'visitors.json');
const MAX_STORED = 20000; // hard cap so the file can't grow forever

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let visits = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    visits = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
} catch (err) {
  console.error('Could not read existing data file, starting fresh:', err.message);
  visits = [];
}

let dirty = false;
function scheduleFlush() {
  dirty = true;
}
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(DATA_FILE, JSON.stringify(visits), (err) => {
    if (err) console.error('Failed to persist visitor data:', err.message);
  });
}, 3000).unref();

// Also flush on shutdown so recent visits aren't lost.
function flushSync() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(visits));
  } catch (err) {
    console.error('Final flush failed:', err.message);
  }
}
process.on('SIGINT', () => { flushSync(); process.exit(0); });
process.on('SIGTERM', () => { flushSync(); process.exit(0); });

function addVisit(visit) {
  visits.push(visit);
  if (visits.length > MAX_STORED) {
    visits = visits.slice(visits.length - MAX_STORED);
  }
  scheduleFlush();
}

function getRecentVisitors(limit = 20) {
  return visits.slice(-limit).reverse();
}

function getStats() {
  const now = Date.now();
  const todayStr = new Date().toDateString();
  const uniqueIds = new Set();
  let todayCount = 0;

  // Bounce rate: group by visitorId, a "session" is visits from the same
  // visitor within a 30-minute window. A session with exactly one pageview
  // counts as a bounce.
  const byVisitor = new Map();

  for (const v of visits) {
    uniqueIds.add(v.visitorId || v.ipHash);
    if (new Date(v.timestamp).toDateString() === todayStr) todayCount++;
    const key = v.visitorId || v.ipHash;
    if (!byVisitor.has(key)) byVisitor.set(key, []);
    byVisitor.get(key).push(new Date(v.timestamp).getTime());
  }

  let sessions = 0;
  let bounces = 0;
  for (const timestamps of byVisitor.values()) {
    timestamps.sort((a, b) => a - b);
    let sessionStart = null;
    let sessionCount = 0;
    const closeSession = () => {
      if (sessionCount > 0) {
        sessions++;
        if (sessionCount === 1) bounces++;
      }
    };
    for (const t of timestamps) {
      if (sessionStart === null || t - sessionStart > 30 * 60 * 1000) {
        closeSession();
        sessionStart = t;
        sessionCount = 1;
      } else {
        sessionCount++;
      }
      sessionStart = t;
    }
    closeSession();
  }

  const bounceRate = sessions > 0 ? Math.round((bounces / sessions) * 100) : 0;

  return {
    totalVisits: visits.length,
    uniqueVisitors: uniqueIds.size,
    todayVisits: todayCount,
    bounceRate,
  };
}

function getHourlyBuckets(hours = 24) {
  const now = Date.now();
  const bucketMs = 60 * 60 * 1000;
  const buckets = new Array(hours).fill(0);

  for (const v of visits) {
    const t = new Date(v.timestamp).getTime();
    const bucketsAgo = Math.floor((now - t) / bucketMs);
    if (bucketsAgo >= 0 && bucketsAgo < hours) {
      buckets[hours - 1 - bucketsAgo]++;
    }
  }

  const labels = [];
  for (let i = hours - 1; i >= 0; i--) {
    labels.push(i === 0 ? 'Now' : `${i}h ago`);
  }

  return { labels, data: buckets };
}

function getTopPages(limit = 10) {
  const counts = new Map();
  for (const v of visits) {
    const page = v.page || '/';
    counts.set(page, (counts.get(page) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([page, count]) => ({ page, count }));
}

module.exports = {
  addVisit,
  getRecentVisitors,
  getStats,
  getHourlyBuckets,
  getTopPages,
};
