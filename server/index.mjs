// Remote Monitor Screen: LAN dashboard server. Zero runtime dependencies.
import http from 'node:http';
import fs from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, ROOT } from './config.mjs';
import { Pairing, safeEqual } from './auth.mjs';
import { allowed, isLoopback, lanAddresses, normaliseIp } from './net.mjs';
import { WinPerf } from './collectors/winperf.mjs';
import { Lhm } from './collectors/lhm.mjs';
import { SystemStats } from './collectors/system.mjs';
import { ClaudeWatcher } from './collectors/claude.mjs';

const PUBLIC_DIR = path.join(ROOT, 'public');
const PUBLIC_FILES = new Set(['/login.html', '/login.css', '/manifest.webmanifest', '/icon.svg', '/clock.html', '/clock.css', '/clock.js']);
const APK_FILE = path.join(ROOT, 'android', 'build', 'RemoteMonitor.apk');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

const cfg = loadConfig();
const log = (msg) => console.log(`[${new Date().toLocaleTimeString('en-GB')}] ${msg}`);
const pairing = new Pairing(cfg.key);

const winperf = new WinPerf({ log }).start();
const lhm = new Lhm({ url: cfg.lhmUrl, log }).start();
const system = new SystemStats({ winperf, lhm });
const claude = cfg.claude.enabled ? new ClaudeWatcher({ ...cfg.claude, log }).start() : null;

// Host header allow-list blocks DNS-rebinding pages from talking to us via a hostile name.
const hostname = os.hostname().toLowerCase();
function sameOrigin(req) {
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function hostOk(req) {
  const h = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === hostname || h === `${hostname}.local` || h === `${hostname}.lan` || /^[\d.]+$/.test(h) || h.includes(':');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
  try {
    const data = await fs.readFile(file);
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  } catch {
    send(res, 404, 'Not found');
  }
}

// ---- Server-sent events: one shared ticker, fan out to all clients ----
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
/** Changes whenever a dashboard file changes, so open pages (e.g. the kiosk app) know to reload. */
function uiVersion() {
  try {
    return readdirSync(PUBLIC_DIR)
      .map((f) => { const st = statSync(path.join(PUBLIC_DIR, f)); return st.isFile() ? `${f}:${st.size}:${st.mtimeMs}` : ''; })
      .join('|')
      .split('')
      .reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0)
      .toString(36);
  } catch {
    return '0';
  }
}
let lastUiVersion = uiVersion();
function hello() {
  return { host: os.hostname(), dim: cfg.dim, claude: !!claude, detail: cfg.claude.detail, control: !!cfg.control, serverTime: Date.now(), ui: lastUiVersion };
}
setInterval(() => {
  const v = uiVersion();
  if (v !== lastUiVersion) {
    lastUiVersion = v;
    if (clients.size) broadcast('hello', hello());
  }
}, 5000).unref();
setInterval(() => {
  if (clients.size) broadcast('system', system.snapshot());
}, 1000).unref();
setInterval(() => {
  if (clients.size && claude) broadcast('claude', claude.snapshot());
}, 1500).unref();
setInterval(() => {
  for (const res of clients) res.write(': keep-alive\n\n');
}, 15000).unref();

const server = http.createServer(async (req, res) => {
  const ip = normaliseIp(req.socket.remoteAddress);
  if (!allowed(ip, cfg.allow)) return send(res, 403, 'Forbidden');
  if (!hostOk(req)) return send(res, 421, 'Misdirected request');

  const url = new URL(req.url, 'http://local');
  const p = url.pathname;

  try {
    // Hook relay: only from this machine, with the hook token.
    if (p === '/api/hook' && req.method === 'POST') {
      if (!isLoopback(ip) || !safeEqual(req.headers['x-monitor-key'], pairing.hookToken)) return send(res, 403, 'Forbidden');
      const body = JSON.parse(await readBody(req));
      // Before each tool call: tell the relay to halt a session that was sent to the break room.
      if (body.hook_event_name === 'PreToolUse') return json(res, 200, { stop: !!(cfg.control && claude?.isBenched(body.session_id)) });
      claude?.hook(body);
      return send(res, 204, '');
    }

    // Liveness probe for the Android app (reveals nothing).
    if (p === '/api/ping') return send(res, 204, '');

    // Current pairing code for `npm run pair` (same machine + hook token only).
    if (p === '/api/pair-code') {
      if (!isLoopback(ip) || !safeEqual(req.headers['x-monitor-key'], pairing.hookToken)) return send(res, 403, 'Forbidden');
      return json(res, 200, { code: pairing.code, port: cfg.port });
    }

    if (p === '/login' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req, 4096));
      const r = pairing.tryCode(ip, form.get('code'));
      if (r === 'ok') {
        log(`paired device ${ip}`);
        return send(res, 303, '', { Location: '/', 'Set-Cookie': pairing.cookieHeader() });
      }
      log(`pairing ${r === 'locked' ? 'locked out' : 'failed'} for ${ip}`);
      return send(res, 303, '', { Location: `/login.html#${r}` });
    }

    if (p === '/pair') {
      // Direct pairing link printed by `npm run pair`.
      if (safeEqual(url.searchParams.get('k'), pairing.sessionToken)) {
        return send(res, 303, '', { Location: '/', 'Set-Cookie': pairing.cookieHeader() });
      }
      return send(res, 303, '', { Location: '/login.html#bad' });
    }

    if (PUBLIC_FILES.has(p)) return serveStatic(res, p);

    // Browsers on this PC via localhost are trusted; everything else needs the cookie.
    const localBrowser = isLoopback(ip) && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || '');
    if (!localBrowser && !pairing.isAuthed(req)) {
      if (p.startsWith('/api/')) return json(res, 401, { error: 'unauthorised' });
      return send(res, 303, '', { Location: '/login.html' });
    }

    if (p === '/api/stream') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      res.write(`event: hello\ndata: ${JSON.stringify(hello())}\n\n`);
      res.write(`event: system\ndata: ${JSON.stringify(system.snapshot())}\n\n`);
      if (claude) res.write(`event: claude\ndata: ${JSON.stringify(claude.snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    // Office control: bench/unbench a session. Stop-only; JSON + same-origin so other pages cannot trigger it.
    if (p === '/api/office' && req.method === 'POST') {
      if (!cfg.control || !claude) return json(res, 403, { error: 'control disabled' });
      if (!sameOrigin(req)) return json(res, 403, { error: 'bad origin' });
      if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'json only' });
      const b = JSON.parse(await readBody(req, 2048));
      if (typeof b.session !== 'string' || b.session.length > 100 || !['bench', 'unbench'].includes(b.action)) return json(res, 400, { error: 'bad request' });
      const ok = claude.bench(b.session, b.action === 'bench');
      log(`office: ${b.action} ${b.session.slice(0, 8)} from ${ip}${ok ? '' : ' (unknown session)'}`);
      if (ok) broadcast('claude', claude.snapshot());
      return json(res, ok ? 200 : 404, { ok });
    }
    if (p === '/api/snapshot') return json(res, 200, { hello: hello(), system: system.snapshot(), claude: claude?.snapshot() ?? null });

    if (p === '/app.apk') {
      try {
        const data = await fs.readFile(APK_FILE);
        return send(res, 200, data, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="RemoteMonitor.apk"' });
      } catch {
        return send(res, 404, 'APK not built. Run android\build.ps1 on the PC.');
      }
    }

    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
    return serveStatic(res, p);
  } catch (err) {
    log(`error on ${p}: ${err.message}`);
    if (!res.headersSent) send(res, 400, 'Bad request');
  }
});

server.listen(cfg.port, cfg.host, () => {
  log(`Remote Monitor Screen listening on ${cfg.host}:${cfg.port}`);
  console.log('');
  console.log('  Open on your phone (same network):');
  for (const a of lanAddresses()) console.log(`    http://${a.address}:${cfg.port}${a.virtual ? `   (${a.name}, virtual)` : ''}`);
  console.log(`    http://localhost:${cfg.port}   (this PC, no pairing needed)`);
  console.log('');
  console.log(`  Pairing code: ${pairing.code}   (or run "npm run pair" for a one-tap link)`);
  console.log('');
});

function shutdown() {
  winperf.stop();
  lhm.stop();
  system.stop();
  claude?.stop();
  for (const res of clients) res.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
