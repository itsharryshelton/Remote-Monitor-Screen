'use strict';
// Dashboard client. All transcript-derived text is inserted with textContent, never innerHTML.

const $ = (id) => document.getElementById(id);
const HIST = 120;
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(`rms:${k}`)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(`rms:${k}`, JSON.stringify(v)),
};

// Android TV / Google TV app (or ?tv for trying the TV layout in a browser): Agents view by default,
// remote-control navigation (keys.js), overscan-safe margins.
const TV = !!window.RmsNative?.isTv?.() || new URLSearchParams(location.search).has('tv');

const state = {
  hello: null,
  sys: null,
  claude: null,
  lastMsg: 0,
  hist: { cpu: [], gpu: [], mem: [], rx: [], tx: [] },
  prevStatus: new Map(),
  flash: new Map(),
  chime: store.get('chime', false),
  view: store.get('view', TV ? 'agents' : 'split'),
  undimUntil: 0,
  loadedAt: Date.now(),
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'title') el.title = v;
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

// ---------- formatting ----------
const pct = (v) => (v == null ? '--' : Math.round(v));
const gb = (b) => (b == null ? '--' : (b / 1024 ** 3).toFixed(b >= 100 * 1024 ** 3 ? 0 : 1));
function rate(bytes, bits = false) {
  if (bytes == null) return '--';
  let v = bits ? bytes * 8 : bytes;
  const units = bits ? ['b/s', 'Kb/s', 'Mb/s', 'Gb/s'] : ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
/** Render "12.3 Mb/s" as number + smaller unit. */
function setRate(el, bytes, bits = false) {
  const [num, unit] = rate(bytes, bits).split(' ');
  el.replaceChildren(num, unit ? h('small', null, unit) : '');
}
function dur(ms) {
  if (ms == null || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const hrs = Math.floor(m / 60);
  if (hrs < 24) return `${hrs}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function uptime(sec) {
  const d = Math.floor(sec / 86400);
  const hr = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `up ${d}d ${hr}h` : `up ${hr}h ${m}m`;
}
function tempClass(el, v, warm = 70, hot = 85) {
  el.classList.toggle('na', v == null);
  el.classList.toggle('warm', v != null && v >= warm && v < hot);
  el.classList.toggle('hot', v != null && v >= hot);
}
const deg = (v) => (v == null ? '--°C' : `${Math.round(v)}°C`);
function model(m) {
  if (!m) return null;
  const x = m.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/i);
  if (!x) return m.replace(/^claude-/, '');
  return `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] ? `.${x[3]}` : ''}`;
}
const kTokens = (n) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
function cpuShort(name) {
  return (name || '').replace(/\(R\)|\(TM\)|CPU|Processor|\d+-Core/gi, '').replace(/\s+/g, ' ').trim();
}

// ---------- sparklines ----------
const sparks = {};
function spark(id, series, opts = {}) {
  const c = $(id);
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const hgt = c.clientHeight;
  if (!w || !hgt) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(hgt * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  const max = opts.max ?? Math.max(1, ...series.flatMap((s) => s.data));
  // Faint 50% guide for percentage charts.
  if (opts.max === 100) {
    ctx.strokeStyle = '#151a20';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(hgt / 2) + 0.5);
    ctx.lineTo(w, Math.round(hgt / 2) + 0.5);
    ctx.stroke();
  }
  for (const s of series) {
    const d = s.data;
    if (d.length < 2) continue;
    const step = w / (HIST - 1);
    const x0 = w - (d.length - 1) * step;
    const y = (v) => hgt - 1 - (Math.min(v, max) / max) * (hgt - 3);
    ctx.beginPath();
    d.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, y(v)) : ctx.moveTo(x0, y(v))));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
    if (s.fill !== false) {
      ctx.lineTo(w, hgt);
      ctx.lineTo(x0, hgt);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, hgt);
      g.addColorStop(0, `${s.color}55`);
      g.addColorStop(1, `${s.color}00`);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }
  sparks[id] = true;
}
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function push(arr, v) {
  arr.push(v ?? 0);
  if (arr.length > HIST) arr.shift();
}

// ---------- system ----------
function onSystem(s) {
  state.sys = s;
  state.lastMsg = Date.now();
  $('host').textContent = `${s.host} · ${uptime(s.uptime)}`;
  $('uptime').textContent = s.cpu.processes ? `${s.cpu.processes} processes` : '';

  // CPU
  $('cpu-name').textContent = cpuShort(s.cpu.name);
  $('cpu-util').textContent = pct(s.cpu.util);
  const ct = $('cpu-temp');
  ct.textContent = deg(s.cpu.temp);
  tempClass(ct, s.cpu.temp, 75, 88);
  ct.hidden = s.cpu.temp == null && !s.sources.lhm;
  $('cpu-clock').textContent = s.cpu.mhz ? `${(s.cpu.mhz / 1000).toFixed(2)} GHz` : '';
  $('cpu-power').textContent = s.cpu.power != null ? `${Math.round(s.cpu.power)} W` : '';
  const cores = $('cpu-cores');
  if (cores.childElementCount !== s.cpu.cores.length) cores.replaceChildren(...s.cpu.cores.map(() => h('i')));
  s.cpu.cores.forEach((v, i) => { cores.children[i].style.height = `${Math.max(4, v)}%`; });
  push(state.hist.cpu, s.cpu.util);

  // GPU
  const g = s.gpu || {};
  $('gpu-name').textContent = (g.name || '').replace(/^(AMD|NVIDIA|Intel\(R\))\s+/i, '');
  $('gpu-util').textContent = pct(g.util);
  const gt = $('gpu-temp');
  gt.textContent = deg(g.temp);
  tempClass(gt, g.temp, 75, 90);
  gt.hidden = g.temp == null && !s.sources.lhm;
  $('gpu-hot').textContent = g.hotspot != null ? `hotspot ${Math.round(g.hotspot)}°` : '';
  $('gpu-power').textContent = g.power != null ? `${Math.round(g.power)} W` : '';
  $('gpu-vram').textContent = g.vramUsed != null ? `VRAM ${gb(g.vramUsed)} / ${gb(g.vramTotal)} GB` : 'VRAM --';
  $('gpu-vram-bar').style.width = g.vramTotal ? `${(100 * g.vramUsed) / g.vramTotal}%` : '0';
  $('gpu-fan').textContent = g.fanRpm ? `fan ${Math.round(g.fanRpm)} rpm` : g.fanRpm === 0 ? 'fan idle' : g.engines?.video > 1 ? `video ${Math.round(g.engines.video)}%` : '';
  push(state.hist.gpu, g.util);

  // Memory
  const mp = (100 * s.mem.used) / s.mem.total;
  $('mem-pct').textContent = pct(mp);
  $('mem-used').textContent = `${gb(s.mem.used)} / ${gb(s.mem.total)} GB`;
  $('mem-bar').style.width = `${mp}%`;
  $('proc-count').textContent = '';
  push(state.hist.mem, mp);

  // IO
  setRate($('net-rx'), s.net?.rx, true);
  setRate($('net-tx'), s.net?.tx, true);
  setRate($('disk-r'), s.disk?.read);
  setRate($('disk-w'), s.disk?.write);
  push(state.hist.rx, s.net?.rx);
  push(state.hist.tx, s.net?.tx);

  drawSparks();
  renderSensors(s);
}

function drawSparks() {
  spark('s-cpu', [{ data: state.hist.cpu, color: css('--cpu') }], { max: 100 });
  spark('s-gpu', [{ data: state.hist.gpu, color: css('--gpu') }], { max: 100 });
  spark('s-mem', [{ data: state.hist.mem, color: css('--mem') }], { max: 100 });
  spark('s-net', [
    { data: state.hist.rx, color: css('--net') },
    { data: state.hist.tx, color: '#9be9d0', fill: false },
  ]);
}

const HW_LABEL = { cpu: 'CPU', gpu: 'GPU', board: 'Board', memory: 'RAM', network: 'NIC' };
function sensorLabel(t) {
  if (t.hw === 'memory' && /dimm/i.test(t.name)) return `RAM ${t.name}`;
  const prefix = HW_LABEL[t.hw] || (t.hwName || '').split(/\s+/).slice(0, 2).join(' ');
  // Avoid "GPU GPU Core".
  const name = t.name.toLowerCase().startsWith(`${prefix.toLowerCase()} `) ? t.name.slice(prefix.length + 1) : t.name;
  return `${prefix} ${name}`;
}

let sensorKey = '';
function renderSensors(s) {
  const list = $('sensor-list');
  if (!s.sources.lhm) {
    $('sensor-src').textContent = 'not connected';
    if (sensorKey !== 'none') {
      sensorKey = 'none';
      list.replaceChildren(
        h('p', { class: 'hint' },
          'Temperatures, fans and power need LibreHardwareMonitor running on the PC with its Remote Web Server enabled on port 8085. ',
          'See the README section "Temperatures".'),
      );
    }
    return;
  }
  $('sensor-src').textContent = 'LibreHardwareMonitor';
  const rows = [
    ...s.temps.map((t) => ({ k: sensorLabel(t), v: `${t.value.toFixed(0)}°C`, t: t.value })),
    ...s.fans.map((f) => ({ k: f.name, v: `${Math.round(f.rpm)} rpm` })),
  ];
  sensorKey = 'lhm';
  list.replaceChildren(
    ...rows.map((r) => {
      const v = h('span', { class: 'temp' }, r.v);
      if (r.t != null) tempClass(v, r.t, 70, 85);
      return h('div', null, h('span', { title: r.k }, r.k), v);
    }),
  );
}

// ---------- Claude ----------
const STATUS_LABEL = { working: 'Working', attention: 'Needs you', done: 'Done', stale: 'Idle' };

function onClaude(c) {
  state.claude = c;
  for (const s of c.sessions) {
    const prev = state.prevStatus.get(s.id);
    if (prev && prev !== s.status) {
      if (s.status === 'attention') { notify('attention'); state.flash.set(s.id, Date.now()); }
      else if (s.status === 'done' && prev === 'working') { notify('done'); state.flash.set(s.id, Date.now()); }
    }
    state.prevStatus.set(s.id, s.status);
  }
  renderClaude();
}

function renderClaude() {
  const c = state.claude;
  if (!c) return;
  const now = Date.now();

  // Header summary + chips
  const chips = [];
  if (c.counts.attention) chips.push(h('span', { class: 'chip attn' }, `${c.counts.attention} need${c.counts.attention > 1 ? '' : 's'} you`));
  if (c.counts.working) chips.push(h('span', { class: 'chip work' }, `${c.counts.working} working`));
  if (c.counts.agents) chips.push(h('span', { class: 'chip work' }, `${c.counts.agents} subagent${c.counts.agents > 1 ? 's' : ''}`));
  if (c.counts.done) chips.push(h('span', { class: 'chip ok' }, `${c.counts.done} done`));
  const idle = c.sessions.filter((s) => s.status === 'stale').length;
  if (idle) chips.push(h('span', { class: 'chip' }, `${idle} idle`));
  $('agent-counts').replaceChildren(...chips);
  $('summary').replaceChildren(...chips.map((x) => x.cloneNode(true)));

  if (state.view === 'agents') {
    window.RmsOffice?.render(c, now);
    return; // the office replaces the session cards and feed in this view
  }

  const sessions = $('sessions');
  if (!c.sessions.length) {
    sessions.replaceChildren(h('div', { class: 'empty' }, 'No Claude Code sessions active in the last few hours. Start one in VS Code or the CLI and it will appear here.'));
  } else {
    sessions.replaceChildren(...c.sessions.map((s) => sessionCard(s, now)));
  }

  const feed = $('feed');
  feed.replaceChildren(
    ...c.events.map((e) =>
      h('li', { class: `k-${e.kind}` },
        h('span', { class: 'ft' }, new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })),
        h('span', { class: 'fp', title: e.project || '' }, e.sub ? `↳ ${e.sub}` : e.project || ''),
        h('span', { class: 'fx', title: e.text }, e.text)),
    ),
  );
}

function sessionCard(s, now) {
  const flash = now - (state.flash.get(s.id) || 0) < 3000;
  const expanded = s.status === 'working' || s.status === 'attention' || now - (s.lastActivity || 0) < 10 * 60 * 1000;
  const cls = `s ${s.status}${flash ? ' flash' : ''}${expanded ? '' : ' compact'}`;
  const name = s.title && s.title !== s.project ? `${s.project} · ${s.title}` : s.project || 'session';

  if (!expanded) {
    return h('div', { class: cls },
      h('div', { class: 's-top' },
        h('span', { class: 'dot' }),
        h('span', { class: 'proj' }, s.project || 'session'),
        h('span', { class: 'what' }, s.text),
        h('span', { class: 'ago' }, ago(s.lastActivity))));
  }

  const tags = [s.branch && s.branch !== 'HEAD' ? `⎇ ${s.branch}` : null, s.app, model(s.model)].filter(Boolean);
  const subsWorking = s.subagents.filter((a) => a.status === 'working' || a.status === 'attention');
  const subsDone = s.subagents.filter((a) => a.status === 'done').length;

  return h('div', { class: cls },
    h('div', { class: 's-top' },
      h('span', { class: 'dot' }),
      h('span', { class: 'proj', title: name }, name),
      ...tags.map((t) => h('span', { class: 'tag' }, t)),
      h('span', { class: 'ago' }, s.status === 'working' ? STATUS_LABEL.working : ago(s.lastActivity))),
    h('div', { class: 's-now' },
      h('span', { class: 'what', title: s.text }, s.text),
      s.since && (s.status === 'working' || s.status === 'attention') ? h('span', { class: 'el' }, dur(now - s.since)) : null),
    s.todos ? h('div', { class: 's-line' }, `☑ ${s.todos.done}/${s.todos.total}${s.todos.active ? ` · ${s.todos.active}` : ''}`) : null,
    s.lastPrompt ? h('div', { class: 's-line prompt', title: s.lastPrompt.text }, s.lastPrompt.text) : null,
    s.status !== 'working' && s.lastText ? h('div', { class: 's-line', title: s.lastText.text }, s.lastText.text) : null,
    subsWorking.length
      ? h('div', { class: 'subs' },
          ...subsWorking.slice(0, 4).map((a) =>
            h('div', { class: `sub-a ${a.status}` },
              h('span', { class: 'dot' }),
              h('span', { class: 'd' }, a.description || a.agentType || 'agent'),
              h('span', { class: 'w' }, a.text),
              a.since ? h('span', { class: 'el' }, dur(now - a.since)) : null)),
          subsWorking.length > 4 ? h('div', { class: 'sub-a' }, `+${subsWorking.length - 4} more`) : null)
      : null,
    h('div', { class: 's-foot' },
      s.context ? h('span', null, `ctx ${kTokens(s.context)}`) : null,
      h('span', null, `${s.toolCount} tools`),
      s.subagents.length ? h('span', null, `${subsDone}/${s.subagents.length} agents done`) : null,
      s.errorCount ? h('span', null, `${s.errorCount} errors`) : null,
      s.tokens?.output ? h('span', null, `${kTokens(s.tokens.output)} out`) : null),
    s.status === 'working' ? h('span', { class: 'progress' }) : null,
  );
}

// ---------- chime / vibrate ----------
let audio;
function notify(kind) {
  if (!state.chime) return;
  try {
    audio ||= new AudioContext();
    const notes = kind === 'attention' ? [880, 660, 880] : [660, 990];
    notes.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t = audio.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.16);
    });
  } catch { /* audio unavailable */ }
  vibrate(kind === 'attention' ? 320 : 60, kind === 'attention' ? [120, 80, 120] : 60);
}

function vibrate(ms, pattern) {
  if (window.RmsNative) window.RmsNative.vibrate(ms); // Android app bridge
  else navigator.vibrate?.(pattern);
}

// ---------- offline clock ----------
// If the PC stops sending data (asleep, off, network down), cover the dashboard with a clock.
const OFFLINE_AFTER_MS = 12000;
let offlineClock = null;
function updateOffline() {
  const offline = Date.now() - state.lastMsg > OFFLINE_AFTER_MS && Date.now() - state.loadedAt > OFFLINE_AFTER_MS;
  const el = $('offline-clock');
  if (offline && el.hidden) {
    offlineClock ||= window.RmsClock.mount(el);
    const last = state.lastMsg ? new Date(state.lastMsg).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
    offlineClock.setStatus(last ? `PC offline since ${last}` : 'Waiting for PC');
    el.hidden = false;
    offlineClock.start();
  } else if (!offline && !el.hidden) {
    el.hidden = true;
    offlineClock?.stop();
  }
}

// ---------- clock, dim, burn-in ----------
function tick() {
  const d = new Date();
  $('time').textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  $('secs').textContent = String(d.getSeconds()).padStart(2, '0');
  $('date').textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  $('conn').classList.toggle('ok', Date.now() - state.lastMsg < 5000);
  updateOffline();
  if (state.claude) renderClaude();
  applyDim(d);
}

function minutes(hhmm) {
  const [hh, mm] = String(hhmm).split(':').map(Number);
  return hh * 60 + (mm || 0);
}
function applyDim(d) {
  const dim = state.hello?.dim;
  if (!dim) return;
  const m = d.getHours() * 60 + d.getMinutes();
  const from = minutes(dim.from);
  const to = minutes(dim.to);
  const inWindow = from > to ? m >= from || m < to : m >= from && m < to;
  const attention = state.claude?.counts?.attention > 0;
  document.body.classList.toggle('dim', inWindow && !attention && Date.now() > state.undimUntil);
  document.documentElement.style.setProperty('--dim', String(1 - (dim.level ?? 0.35)));
}

// Shift the whole layout a few pixels every couple of minutes to spread OLED wear.
const SHIFTS = [[0, 0], [2, 1], [3, -1], [1, -2], [-1, -2], [-3, -1], [-2, 1], [-1, 2], [1, 2]];
let shiftIdx = 0;
function pixelShift() {
  shiftIdx = (shiftIdx + 1) % SHIFTS.length;
  const [x, y] = SHIFTS[shiftIdx];
  $('app').style.transform = `translate(${x}px, ${y}px)`;
}

// ---------- wake lock ----------
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* needs a secure context; see README */ }
}

// ---------- controls ----------
function setView(v) {
  state.view = v;
  store.set('view', v);
  document.body.dataset.view = v;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  requestAnimationFrame(() => {
    drawSparks();
    if (v === 'agents') window.RmsOffice?.refit();
    else if (state.claude) renderClaude();
  });
}

function setupControls() {
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  const chime = $('chime');
  const paintChime = () => {
    chime.setAttribute('aria-pressed', String(state.chime));
    chime.textContent = state.chime ? '🔔' : '🔕';
  };
  paintChime();
  chime.addEventListener('click', () => {
    state.chime = !state.chime;
    store.set('chime', state.chime);
    paintChime();
    if (state.chime) {
      audio ||= new AudioContext();
      audio.resume();
      notify('done');
    }
  });
  $('fs').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await screen.orientation?.lock?.('landscape').catch(() => {});
      } else {
        await document.exitFullscreen();
      }
    } catch { /* not supported */ }
    keepAwake();
  });
  // Tap anywhere (or press a remote key) during night-dim to brighten for a minute.
  const wake = () => {
    if (document.body.classList.contains('dim')) {
      state.undimUntil = Date.now() + 60000;
      document.body.classList.remove('dim');
    }
    keepAwake();
  };
  document.addEventListener('pointerdown', wake);
  document.addEventListener('keydown', wake);
  document.addEventListener('visibilitychange', keepAwake);
  new ResizeObserver(() => drawSparks()).observe(document.body);
}

// ---------- stream ----------
let es;
function connect() {
  es = new EventSource('/api/stream');
  es.addEventListener('hello', (e) => {
    const next = JSON.parse(e.data);
    // Dashboard files changed on the PC (update, or server restarted with new code): load them.
    if (state.hello?.ui && next.ui && next.ui !== state.hello.ui) return location.reload();
    state.hello = next;
    if (!state.hello.claude) document.querySelector('.agents').classList.add('off');
  });
  es.addEventListener('system', (e) => onSystem(JSON.parse(e.data)));
  es.addEventListener('claude', (e) => onClaude(JSON.parse(e.data)));
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      setTimeout(async () => {
        try {
          const r = await fetch('/api/snapshot', { cache: 'no-store' });
          if (r.status === 401) return location.replace('/login.html');
        } catch { /* server down; retry */ }
        connect();
      }, 3000);
    }
  };
}

if (window.RmsNative) document.body.classList.add('in-app');
if (TV) document.body.classList.add('tv');
window.RmsOffice?.mount($('office'), { card: sessionCard, dur, ago, model, control: () => !!state.hello?.control, vibrate: (ms) => vibrate(ms, ms) });
setupControls();
setView(state.view);
tick();
setInterval(tick, 1000);
setInterval(pixelShift, 120000);
connect();
keepAwake();
