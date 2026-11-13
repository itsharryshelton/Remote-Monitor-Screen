'use strict';
// Agents "office": each Claude Code session (and each of its subagents) is a person at a desk,
// desks are grouped into pods by project, and a chat bubble shows what the person is doing.
//  - A session running several subagents gets a whiteboard; its subagents leave their desks and
//    stand in front of it, one sticky note per subagent.
//  - Quiet sessions nap in the break room; idle people now and then walk to the kitchen table.
//  - The floor scales to fit, down to a readable minimum; past that it scrolls (and auto-pans).
//  - Long-press a person to pick them up. Dropping a session in the break room benches it: the
//    server tells Claude Code (via the PreToolUse hook) to stop. Drag it back out to unbench.
// People are keyed DOM nodes reused across renders, so any move animates as a walk (FLIP).
// All transcript-derived text is inserted with textContent, never innerHTML.

(() => {
  const IDLE_AFTER_MS = 20 * 60 * 1000; // a finished session keeps its desk this long
  const SUB_LINGER_MS = 3 * 60 * 1000; // a finished subagent keeps its spot this long
  const MAX_SUBS = 6; // per session
  const MAX_LOUNGE = 8;
  const HUDDLE_MIN = 2; // subagents needed for a whiteboard huddle
  const HUDDLE_MAX = 5; // shown at a whiteboard; the rest are counted on the board
  const HOLD_MS = 350; // long-press before a person is picked up
  const UNDO_MS = 4000; // grace period before a bench is sent
  const SCALES = [1.6, 1.45, 1.3, 1.18, 1.08, 1, 0.92, 0.84, 0.78, 0.72];
  const MIN_SCALE = SCALES[SCALES.length - 1];
  const TRIP_CHANCE = 1 / 18; // per render (about once a second), when someone is free to go
  const MAX_TRIPS = 2;
  const PAN_IDLE_MS = 30000; // leave the scroll alone this long after a touch
  const PAN_EVERY_MS = 15000;

  const SHIRTS = ['#4f7cff', '#e0675a', '#36b37e', '#b07cff', '#e8a23a', '#30a9c2', '#e06aa3', '#8fa84a', '#7488ff', '#cf7f52'];
  const HAIR = ['#17110d', '#3a2618', '#5b3a22', '#25252d', '#7a4a2a', '#a8742f', '#4a2f45', '#0f0f12', '#c9c2b8'];
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68b62', '#a26a45', '#7c4d32', '#f5d6bd'];
  const RUGS = ['#4f7cff', '#36b37e', '#b07cff', '#e8a23a', '#30a9c2', '#e06aa3', '#e0675a', '#8fa84a'];
  const MUGS = ['#e0675a', '#f0f0f0', '#4f7cff', '#e8a23a', null, null];
  // Kitchen stools around the table: position in the table area and which way the sitter faces.
  const STOOLS = [{ x: 0, y: 6, rot: -90 }, { x: 88, y: 6, rot: 90 }, { x: 44, y: 42, rot: 180 }];

  function hash(s) {
    let x = 2166136261;
    for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); }
    return x >>> 0;
  }
  const pick = (arr, key, salt) => arr[hash(`${salt}:${key}`) % arr.length];
  const shirtOf = (s) => pick(SHIRTS, s.key || s.id, 'shirt');

  function el(tag, cls, ...kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) if (k != null && k !== false) e.append(k);
    return e;
  }
  const time = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const subKey = (parentKey, a) => `${parentKey}/${a.key || a.id}`;

  let root, vp, sizer, inner, ticker, pop, opts;
  let scale = 1;
  let overflow = false;
  let layoutKey = null;
  let popKey = null;
  let lastData = null;
  let lastModel = null;
  let lastTouch = 0;
  let nextPan = 0;
  const people = new Map(); // person key -> element (persistent, so it can walk between spots)
  const spots = new Map(); // spot key -> record
  const boards = new Map(); // session key -> whiteboard record
  const podSeen = new Map(); // project -> first-seen order, so pods do not shuffle around
  const trips = new Map(); // person key -> kitchen trip in progress
  const benchPending = new Map(); // session key -> { sent } (optimistic, until the server agrees)
  const unbenchPending = new Set(); // session key (optimistic, until the server agrees)
  const dropRects = new Map(); // person key -> where they were dropped, so they walk from there
  let drag = null;
  let suppressClick = false;
  let toast, toastTimer;

  // ---------- model ----------
  function isBenched(s) {
    const key = s.key || s.id;
    if (benchPending.has(key)) return true;
    return !!s.benched && !unbenchPending.has(key);
  }

  function buildModel(c, now) {
    const pods = new Map();
    const lounge = [];
    for (const s of c.sessions) {
      const key = s.key || s.id;
      const idle = isBenched(s) || s.status === 'stale' || (s.status === 'done' && now - (s.lastActivity || 0) > IDLE_AFTER_MS);
      if (idle) { lounge.push({ key, s, parent: s, main: true }); continue; }
      const name = s.project || 'session';
      if (!podSeen.has(name)) podSeen.set(name, podSeen.size);
      if (!pods.has(name)) pods.set(name, { name, branch: s.branch, sessions: [], hidden: 0 });
      pods.get(name).sessions.push(s);
    }
    const podList = [...pods.values()].sort((a, b) => podSeen.get(a.name) - podSeen.get(b.name));
    for (const pod of podList) {
      pod.sessions.sort((a, b) => (a.firstActivity || 0) - (b.firstActivity || 0));
      pod.stations = [];
      pod.huddles = [];
      for (const s of pod.sessions) {
        const key = s.key || s.id;
        pod.stations.push({ key, s, parent: s, main: true });
        const subs = (s.subagents || [])
          .filter((a) => a.status === 'working' || a.status === 'attention' || (a.status === 'done' && now - (a.lastActivity || 0) < SUB_LINGER_MS))
          .sort((a, b) => (a.firstActivity || 0) - (b.firstActivity || 0));
        let trimmed = 0;
        while (subs.length > MAX_SUBS) {
          const i = subs.findIndex((a) => a.status === 'done');
          subs.splice(i >= 0 ? i : 0, 1);
          trimmed++;
        }
        pod.hidden += trimmed;
        const list = subs.map((a) => ({ key: subKey(key, a), s: a, parent: s, main: false }));
        if (list.length >= HUDDLE_MIN) {
          // Whiteboard space is limited: keep the busy ones, count the rest on the board.
          let extra = trimmed;
          while (list.length > HUDDLE_MAX) {
            const i = list.findIndex((st) => st.s.status === 'done');
            list.splice(i >= 0 ? i : 0, 1);
            extra++;
          }
          pod.hidden += extra - trimmed;
          pod.huddles.push({ key, s, subs: list, extra });
        }
        else pod.stations.push(...list);
      }
    }
    lounge.sort((a, b) => (b.s.lastActivity || 0) - (a.s.lastActivity || 0));
    const loungeShown = lounge.slice(0, MAX_LOUNGE);
    return { pods: podList, lounge: loungeShown, loungeHidden: lounge.length - loungeShown.length };
  }

  const keyOf = (m) => `${m.pods.map((p) => `${p.name}:${p.stations.map((s) => s.key).join(',')}[${p.huddles.map((h) => `${h.key}>${h.subs.map((s) => s.key).join(',')}`).join(';')}]`).join('|')}#${m.lounge.map((l) => l.key).join(',')}`;

  // ---------- people ----------
  function person(key, s) {
    let p = people.get(key);
    if (p) return p;
    const id = s.key || s.id || key;
    p = el('div', 'pp',
      el('div', 'fig',
        el('i', 'arm l'), el('i', 'arm r'),
        el('i', 'body'),
        el('i', 'head')),
      el('i', 'zz', 'z', el('b', null, 'z')));
    p.style.setProperty('--shirt', pick(SHIRTS, id, 'shirt'));
    p.style.setProperty('--hair', pick(HAIR, id, 'hair'));
    p.style.setProperty('--skin', pick(SKIN, id, 'skin'));
    p.dataset.fresh = '1';
    people.set(key, p);
    return p;
  }

  /** Draw the person's pod above the other rooms while they walk across the floor. */
  function raise(p) {
    const pod = p.closest('.pod');
    if (!pod) return () => {};
    pod.dataset.raise = String((+pod.dataset.raise || 0) + 1);
    pod.classList.add('raised');
    return () => {
      const n = Math.max(0, (+pod.dataset.raise || 1) - 1);
      pod.dataset.raise = String(n);
      if (!n) pod.classList.remove('raised');
    };
  }

  /** Animate a person from where they were (a screen rect) to where they are now. */
  function walkFrom(p, a, extra = {}) {
    const b = p.getBoundingClientRect();
    const dx = (a.left - b.left) / scale;
    const dy = (a.top - b.top) / scale;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;
    const ms = Math.min(2600, 700 + dist * 3) * (extra.speed || 1);
    p.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) translateY(-3px)`, offset: 0.5 },
      { transform: 'none' },
    ], { duration: ms, easing: 'ease-in-out' });
    p.classList.add('walking');
    const lower = raise(p);
    setTimeout(() => { p.classList.remove('walking'); lower(); }, ms);
  }

  // ---------- spots ----------
  function labelParts() {
    const btext = el('span', 'bt');
    const bel = el('span', 'be');
    const nmText = el('span', 'nt');
    return { bubble: el('div', 'bub', btext, bel), btext, bel, nm: el('div', 'nm', el('i', 'sd'), nmText), nmText };
  }

  function station(st, flip) {
    let r = spots.get(st.key);
    if (!r || r.kind !== 'desk') {
      const mon = el('i', 'mon', el('i', 'scr'));
      const desk = el('div', 'desk', mon, el('i', 'kb'));
      const mug = pick(MUGS, st.key, 'mug');
      if (mug) { const m = el('i', 'mug'); m.style.setProperty('--mug', mug); desk.append(m); }
      if (hash(`paper:${st.key}`) % 3 === 0) desk.append(el('i', 'paper'));
      const parts = labelParts();
      const todo = el('i', 'todo', el('i'));
      const seat = el('div', 'seat', el('i', 'chair'));
      r = { kind: 'desk', ...parts, seat, todo, el: el('div', 'st', parts.bubble, parts.nm, seat, desk, todo) };
      spots.set(st.key, r);
    }
    r.base = flip ? 'st flip' : 'st';
    r.el.className = r.base;
    r.el.dataset.key = st.parent.key || st.parent.id;
    r.seat.append(person(st.key, st.s));
    return r;
  }

  function emptyDesk(flip) {
    const desk = el('div', 'desk', el('i', 'mon off', el('i', 'scr')), el('i', 'kb'));
    return el('div', `st empty${flip ? ' flip' : ''}`, el('div', 'nm ghost'), el('div', 'seat', el('i', 'chair')), desk);
  }

  function huddleSpot(st, i, n) {
    const key = `h:${st.key}`;
    let r = spots.get(key);
    if (!r) {
      const parts = labelParts();
      const stand = el('div', 'stand');
      r = { kind: 'huddle', ...parts, stand, el: el('div', 'hs', stand, parts.nm, parts.bubble) };
      spots.set(key, r);
    }
    // Stand in an arc facing the board; stagger bubbles so neighbours do not cover each other.
    const mid = (n - 1) / 2;
    r.el.style.setProperty('--dy', `${Math.round(Math.abs(i - mid) * -9)}px`);
    r.base = `hs${i % 2 ? ' low' : ''}`;
    r.el.className = r.base;
    r.el.dataset.key = st.parent.key || st.parent.id;
    r.stand.append(person(st.key, st.s));
    return r;
  }

  function whiteboard(h) {
    let b = boards.get(h.key);
    if (!b) {
      const title = el('div', 'wb-t');
      const line = el('div', 'wb-l');
      const bar = el('i', 'wb-bar', el('i'));
      const notes = el('div', 'wb-notes');
      b = { title, line, bar, notes, more: el('i', 'note more'), noteEls: new Map(), el: el('div', 'wb', el('div', 'wb-face', title, line, bar, notes, el('i', 'scrib s1'), el('i', 'scrib s2')), el('div', 'wb-tray', el('i'), el('i'), el('i'))) };
      boards.set(h.key, b);
    }
    b.el.dataset.key = h.key;
    const want = h.subs.map((st) => st.key);
    for (const k of [...b.noteEls.keys()]) if (!want.includes(k)) b.noteEls.delete(k);
    b.notes.replaceChildren(...h.subs.map((st, i) => {
      let n = b.noteEls.get(st.key);
      if (!n) {
        n = el('i', 'note');
        n.style.setProperty('--note', shirtOf(st.s));
        n.style.setProperty('--tilt', `${(hash(st.key) % 9) - 4}deg`);
        b.noteEls.set(st.key, n);
      }
      n.title = st.s.description || 'agent';
      return n;
    }), ...(h.extra ? [b.more] : []));
    b.more.textContent = `+${h.extra}`;
    return b;
  }

  function loungeSeat(l) {
    const key = `l:${l.key}`;
    let r = spots.get(key);
    if (!r) {
      const nmText = el('span', 'nt');
      const stText = el('span', 'lst');
      r = { kind: 'lounge', el: el('div', 'ls', el('div', 'lseat'), el('div', 'nm', el('i', 'sd'), nmText), stText), nmText, stText };
      spots.set(key, r);
    }
    r.el.dataset.key = l.key;
    r.el.firstChild.append(person(l.key, l.s));
    return r;
  }

  function plant(cls = '') {
    return el('i', `plant ${cls}`, el('i'), el('i'), el('i'));
  }

  // ---------- layout ----------
  function rebuild(m) {
    // Remember where everyone is (including anyone mid kitchen trip), so movers walk to the new spot.
    const before = new Map();
    for (const [k, p] of people) {
      const r = p.isConnected && p.getBoundingClientRect();
      if (r && r.width) before.set(k, r);
    }
    for (const [k, r] of dropRects) before.set(k, r);
    dropRects.clear();
    for (const k of [...trips.keys()]) endTrip(k, false);

    const used = new Set();
    const items = [];
    for (const pod of m.pods) {
      const n = pod.stations.length;
      const cols = n > 1 ? Math.ceil(n / 2) : 1;
      const grid = el('div', `pgrid${n > 1 ? ' two' : ''}`);
      grid.style.setProperty('--cols', cols);
      pod.stations.forEach((st, i) => {
        grid.append(station(st, n > 1 && i >= cols).el);
        used.add(st.key);
      });
      if (n > 1 && n % 2) grid.append(emptyDesk(true));
      const huddles = pod.huddles.map((h) => {
        const wb = whiteboard(h);
        const crowd = el('div', 'crowd', ...h.subs.map((st, i) => {
          used.add(`h:${st.key}`);
          return huddleSpot(st, i, h.subs.length).el;
        }));
        return el('div', 'huddle', wb.el, crowd);
      });
      const rug = el('div', 'rug', el('div', 'rwrap', grid, ...huddles));
      if (hash(`plant:${pod.name}`) % 2) rug.append(plant('tr'));
      const podEl = el('div', 'pod',
        el('div', 'plab', el('i', 'sd'), el('span', 'pn', pod.name),
          pod.branch && pod.branch !== 'HEAD' ? el('span', 'pb', `⎇ ${pod.branch}`) : null,
          pod.hidden ? el('span', 'pb', `+${pod.hidden} more`) : null),
        rug);
      podEl.style.setProperty('--rug', pick(RUGS, pod.name, 'rug'));
      podEl.dataset.pod = pod.name;
      items.push(podEl);
    }
    for (const k of [...boards.keys()]) if (!m.pods.some((p) => p.huddles.some((h) => h.key === k))) boards.delete(k);

    // Break room + kitchen: idle sessions nap on the sofa, anyone idle may wander to the table.
    const sofa = el('div', 'sofa');
    for (const l of m.lounge) {
      sofa.append(loungeSeat(l).el);
      used.add(`l:${l.key}`);
    }
    for (let i = m.lounge.length; i < 2; i++) sofa.append(el('div', 'ls vacant', el('div', 'lseat')));
    const table = el('div', 'ktable-area', el('i', 'ktable', el('i', 'cup'), el('i', 'cup c2')),
      ...STOOLS.map((s, i) => {
        const stool = el('i', 'stool');
        stool.style.left = `${s.x}px`;
        stool.style.top = `${s.y}px`;
        stool.dataset.stool = i;
        return stool;
      }));
    const kitchen = el('div', 'kitchen',
      el('div', 'counter',
        el('div', 'coffee', el('i', 'steam'), el('i', 'steam s2')),
        el('i', 'sink'),
        el('i', 'fruit')),
      el('i', 'fridge'),
      table);
    const quiet = !m.pods.length && !m.lounge.length;
    items.push(el('div', 'pod lounge',
      el('div', 'plab', el('i', 'sd'), el('span', 'pn', 'Break room · kitchen'),
        m.loungeHidden ? el('span', 'pb', `+${m.loungeHidden} more`) : null),
      el('div', 'rug',
        el('div', 'lroom', sofa, kitchen, plant('br')),
        quiet ? el('div', 'quiet', 'Quiet office. Start a Claude Code session and someone will sit down at a desk.') : null)));

    inner.replaceChildren(...items);

    // Forget spots and people that left.
    for (const k of [...spots.keys()]) if (!used.has(k)) spots.delete(k);
    const present = new Set([
      ...m.pods.flatMap((p) => [...p.stations.map((s) => s.key), ...p.huddles.flatMap((h) => h.subs.map((s) => s.key))]),
      ...m.lounge.map((l) => l.key),
    ]);
    for (const k of [...people.keys()]) if (!present.has(k)) people.delete(k);

    fit();

    for (const [k, p] of people) {
      if (p.dataset.fresh) {
        delete p.dataset.fresh;
        if (layoutKey !== null) p.animate([{ opacity: 0, transform: 'translateY(14px) scale(0.85)' }, { opacity: 1, transform: 'none' }], { duration: 700, easing: 'ease-out' });
        continue;
      }
      const a = before.get(k);
      if (a) walkFrom(p, a);
    }
  }

  /** Largest scale (down to a readable minimum) at which the floor fits; past that it scrolls. */
  function fit() {
    const W = vp.clientWidth;
    const H = root.clientHeight - ticker.offsetHeight;
    if (!W || !H) return;
    let s = null;
    for (const c of SCALES) {
      inner.style.width = `${W / c}px`;
      if (inner.scrollHeight * c <= H && inner.scrollWidth <= W / c + 1) { s = c; break; }
    }
    overflow = s == null;
    scale = s ?? MIN_SCALE;
    inner.style.width = `${W / scale}px`;
    const h = inner.scrollHeight * scale;
    const top = overflow ? 0 : Math.max(0, (H - h) / 2);
    inner.style.transform = `translate(0, ${top}px) scale(${scale})`;
    sizer.style.width = `${Math.max(W, inner.scrollWidth * scale)}px`;
    sizer.style.height = `${overflow ? h + ticker.offsetHeight : H}px`;
    root.classList.toggle('big', overflow);
  }

  /** On a big floor nobody scrolls a wall display: drift through it, and go to whoever needs you. */
  function autoPan(now) {
    if (!overflow || now - lastTouch < PAN_IDLE_MS) return;
    const max = vp.scrollHeight - vp.clientHeight;
    if (max <= 0) return;
    const att = inner.querySelector('.st.attention, .hs.attention');
    if (att) {
      const r = att.getBoundingClientRect();
      const v = vp.getBoundingClientRect();
      if (r.top < v.top || r.bottom > v.bottom - ticker.offsetHeight) {
        vp.scrollTo({ top: Math.min(max, Math.max(0, vp.scrollTop + r.top - v.top - vp.clientHeight / 3)), behavior: 'smooth' });
      }
      return;
    }
    if (now < nextPan) return;
    nextPan = now + PAN_EVERY_MS;
    const y = vp.scrollTop >= max - 2 ? 0 : Math.min(max, vp.scrollTop + vp.clientHeight * 0.7);
    vp.scrollTo({ top: y, behavior: 'smooth' });
  }

  // ---------- kitchen trips ----------
  function maybeTrip(m) {
    if (trips.size >= MAX_TRIPS || Math.random() > TRIP_CHANCE) return;
    const free = STOOLS.map((_, i) => i).filter((i) => ![...trips.values()].some((t) => t.stool === i));
    if (!free.length) return;
    // Who can go: finished people at desks, and (less often) nappers on the sofa.
    const pool = [
      ...m.pods.flatMap((p) => p.stations).filter((st) => st.s.status === 'done'),
      ...m.lounge.filter(() => Math.random() < 0.35),
    ].filter((st) => !trips.has(st.key) && st.key !== drag?.key && people.get(st.key)?.isConnected);
    if (!pool.length) return;
    const st = pool[Math.floor(Math.random() * pool.length)];
    const stoolIdx = free[Math.floor(Math.random() * free.length)];
    const stool = inner.querySelector(`[data-stool="${stoolIdx}"]`);
    const p = people.get(st.key);
    if (!stool) return;
    const a = p.getBoundingClientRect();
    const b = stool.getBoundingClientRect();
    const dx = (b.left + b.width / 2 - (a.left + a.width / 2)) / scale;
    const dy = (b.top + b.height / 2 - (a.top + a.height / 2)) / scale;
    const walk = Math.min(4200, 900 + Math.hypot(dx, dy) * 6);
    const stay = 7000 + Math.random() * 9000;
    const total = walk * 2 + stay;
    const at = `translate(${dx}px, ${dy}px)`;
    const anim = p.animate([
      { transform: 'none', offset: 0, easing: 'ease-in-out' },
      { transform: at, offset: walk / total },
      { transform: at, offset: (walk + stay) / total, easing: 'ease-in-out' },
      { transform: 'none', offset: 1 },
    ], { duration: total });
    const t = { stool: stoolIdx, anim, p, timers: [], lower: raise(p) };
    trips.set(st.key, t);
    p.classList.add('trip', 'walking');
    const later = (ms, fn) => t.timers.push(setTimeout(fn, ms));
    later(walk, () => {
      p.classList.remove('walking');
      p.style.setProperty('--rot', `${STOOLS[stoolIdx].rot}deg`); // sit facing the table
    });
    later(walk + stay, () => {
      p.style.removeProperty('--rot');
      p.classList.add('walking');
    });
    later(total, () => endTrip(st.key, false));
  }

  /** Stop a trip; if walkBack, the person walks from wherever they are back to their spot. */
  function endTrip(key, walkBack) {
    const t = trips.get(key);
    if (!t) return;
    const a = walkBack && t.p.isConnected ? t.p.getBoundingClientRect() : null;
    t.timers.forEach(clearTimeout);
    t.anim.cancel();
    t.lower();
    t.p.classList.remove('trip', 'walking');
    t.p.style.removeProperty('--rot');
    trips.delete(key);
    if (a) walkFrom(t.p, a, { speed: 0.7 });
  }

  // ---------- per-tick update ----------
  function bubbleFor(s, main, now) {
    const since = s.since && (s.status === 'working' || s.status === 'attention') ? opts.dur(now - s.since) : '';
    if (s.status === 'attention') return { cls: 'attn', text: `⚠ ${s.text || 'Needs you'}`, el: since };
    if (s.status === 'working') {
      if (/^Thinking/.test(s.text || '')) return { cls: 'think', text: 'Thinking', el: since };
      return { cls: 'work', text: s.text || 'Working', el: since };
    }
    if (s.status === 'done') return { cls: 'done', text: main ? '✓ done' : '✓ finished', el: '' };
    return null;
  }

  function nameFor(st) {
    if (!st.main) return st.s.description || st.s.agentType || 'agent';
    const s = st.s;
    return s.title && s.title !== s.project ? s.title : opts.model(s.model) || 'session';
  }

  function paint(r, st, now) {
    const s = st.s;
    // Got work (or needs you) while on a break: hurry back to the desk.
    if (trips.has(st.key) && s.status !== 'done' && s.status !== 'stale') endTrip(st.key, true);
    const away = trips.has(st.key);
    r.el.className = `${r.base} ${s.status}${st.main ? '' : ' sub'}${away ? ' away' : ''}`;
    r.el.title = s.text || '';
    r.nmText.textContent = nameFor(st);
    const b = away ? { cls: 'done brk', text: '☕ break', el: '' } : bubbleFor(s, st.main, now);
    r.bubble.hidden = !b;
    if (b) {
      r.bubble.className = `bub ${b.cls}`;
      if (r.btext.textContent !== b.text) r.btext.textContent = b.text;
      r.bel.textContent = b.el;
    }
    if (r.todo) {
      const t = st.main && s.todos;
      r.todo.hidden = !t;
      if (t) r.todo.firstChild.style.width = `${(100 * t.done) / Math.max(1, t.total)}%`;
    }
  }

  function paintBoard(h) {
    const b = boards.get(h.key);
    if (!b) return;
    const s = h.s;
    b.title.textContent = s.title && s.title !== s.project ? s.title : s.project || 'Plan';
    const t = s.todos;
    b.line.textContent = t?.active || s.lastPrompt?.text || `${h.subs.length} agents on it`;
    b.bar.hidden = !t;
    if (t) b.bar.firstChild.style.width = `${(100 * t.done) / Math.max(1, t.total)}%`;
    for (const st of h.subs) {
      const n = b.noteEls.get(st.key);
      if (n) n.className = `note ${st.s.status}`;
    }
  }

  function update(m, now) {
    for (const pod of m.pods) {
      for (const st of pod.stations) {
        const r = spots.get(st.key);
        if (r) paint(r, st, now);
      }
      for (const h of pod.huddles) {
        for (const st of h.subs) {
          const r = spots.get(`h:${st.key}`);
          if (r) paint(r, st, now);
        }
        paintBoard(h);
      }
      const lab = inner.querySelector(`[data-pod="${CSS.escape(pod.name)}"]`);
      if (lab) {
        const rank = Math.min(...pod.sessions.map((s) => ({ attention: 0, working: 1, done: 2 })[s.status] ?? 3));
        lab.dataset.status = ['attention', 'working', 'done', 'stale'][rank];
      }
    }
    for (const l of m.lounge) {
      const r = spots.get(`l:${l.key}`);
      if (!r) continue;
      const s = l.s;
      const benched = isBenched(s);
      const busy = s.status === 'working' || s.status === 'attention';
      r.el.className = `ls ${s.status}${trips.has(l.key) ? ' away' : ''}${benched ? ' benched' : ''}${benched && busy ? ' stopping' : ''}`;
      r.stText.textContent = benched ? (busy ? (benchPending.get(l.key)?.sent === false ? 'sending…' : 'stopping…') : 'benched') : '';
      r.el.title = `${s.project || 'session'}: ${s.text || ''} · ${opts.ago(s.lastActivity)}`;
      r.nmText.textContent = s.title && s.title !== s.project ? `${s.project} · ${s.title}` : s.project || 'session';
    }

    const e = lastData.events?.[0];
    if (e) {
      ticker.className = `office-tick k-${e.kind}`;
      ticker.replaceChildren(
        el('span', 'ft', time(e.ts)),
        el('span', 'fp', e.sub ? `↳ ${e.sub}` : e.project || ''),
        el('span', 'fx', e.text));
    } else {
      ticker.replaceChildren();
    }
    renderPop(now);
  }

  // ---------- detail popover ----------
  function renderPop(now) {
    if (!popKey) { pop.hidden = true; return; }
    const s = lastData.sessions.find((x) => (x.key || x.id) === popKey);
    if (!s) { popKey = null; pop.hidden = true; return; }
    pop.replaceChildren(opts.card(s, now));
    pop.hidden = false;
  }

  // ---------- drag & bench ----------
  const keyOfPerson = (p) => { for (const [k, v] of people) if (v === p) return k; return null; };

  /** Where a person is: at a desk, at a whiteboard, or in the break room. */
  function whoIs(key) {
    if (!lastModel) return null;
    for (const pod of lastModel.pods) {
      for (const st of pod.stations) if (st.key === key) return { ...st, where: 'desk' };
      for (const h of pod.huddles) for (const st of h.subs) if (st.key === key) return { ...st, where: 'huddle' };
    }
    const l = lastModel.lounge.find((x) => x.key === key);
    return l ? { ...l, where: 'lounge' } : null;
  }

  function onDown(ev) {
    const p = ev.target.closest('.pp');
    if (!p || drag || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const key = keyOfPerson(p);
    if (!key) return;
    drag = { key, p, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, active: false };
    drag.timer = setTimeout(() => pickUp(ev.pointerId), HOLD_MS);
  }

  function pickUp(pointerId) {
    if (!drag || drag.active) return;
    const { p, key } = drag;
    endTrip(key, false);
    p.getAnimations().forEach((a) => a.cancel());
    drag.active = true;
    drag.lower = raise(p);
    try { p.setPointerCapture(pointerId); } catch { /* pointer already gone */ }
    p.classList.add('lifted');
    opts.vibrate?.(25);
  }

  function dropTarget(x, y) {
    const hit = document.elementsFromPoint(x, y).find((e) => e.closest?.('.pod') && !drag.p.contains(e));
    return hit ? hit.closest('.pod') : null;
  }

  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x0;
    const dy = ev.clientY - drag.y0;
    if (!drag.active) {
      if (Math.hypot(dx, dy) > 10) onCancel(); // moved before the long-press: a swipe, not a pick-up
      return;
    }
    ev.preventDefault();
    drag.p.style.transform = `translate(${dx / scale}px, ${dy / scale}px) scale(1.15)`;
    const t = dropTarget(ev.clientX, ev.clientY);
    if (t !== drag.over) {
      drag.over?.classList.remove('drop-target');
      drag.over = t;
      t?.classList.add('drop-target');
    }
  }

  function onCancel() {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.active) snapBack();
    else drag = null;
  }

  /** Put the person down; returns where they were on screen, so they can walk from there. */
  function finishDrag() {
    const d = drag;
    drag = null;
    d.over?.classList.remove('drop-target');
    d.lower?.();
    const rect = d.p.getBoundingClientRect();
    d.p.classList.remove('lifted');
    d.p.style.transform = '';
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    return rect;
  }

  function snapBack() {
    const p = drag.p;
    walkFrom(p, finishDrag(), { speed: 0.6 });
  }

  function onUp(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    clearTimeout(drag.timer);
    if (!drag.active) { drag = null; return; }
    const who = whoIs(drag.key);
    const target = drag.over;
    const toLounge = !!target?.classList.contains('lounge');
    const fromLounge = who?.where === 'lounge';
    // Only two moves mean anything: desk -> break room (bench) and break room -> any pod (unbench).
    if (!who || !target || toLounge === fromLounge) return snapBack();
    if (!who.main) {
      snapBack();
      return say(`Subagents stop with their session: drag ${nameFor({ s: who.parent, main: true })} to the break room instead.`);
    }
    if (!opts.control()) {
      snapBack();
      return say('Read-only: set "control": true in config.local.json on the PC to allow this.');
    }
    const s = who.s;
    const name = nameFor({ s, main: true });
    if (toLounge) {
      dropRects.set(who.key, finishDrag());
      return bench(who.key, s, name);
    }
    if (!isBenched(s)) {
      snapBack();
      return say(`${name} is just idle. Send it a prompt to put it back to work.`);
    }
    dropRects.set(who.key, finishDrag());
    unbench(who.key, name);
  }

  function bench(key, s, name) {
    const busy = s.status === 'working' || s.status === 'attention';
    benchPending.set(key, { sent: false });
    render(lastData);
    say(busy ? `${name} will stop after its current step.` : `${name} is taking a break.`, () => {
      benchPending.delete(key);
      render(lastData);
    });
    toastTimer = setTimeout(async () => {
      hideToast();
      const ok = await post('bench', s.id);
      if (ok) {
        if (benchPending.has(key)) benchPending.set(key, { sent: true });
      } else {
        benchPending.delete(key);
        render(lastData);
        say(`Could not bench ${name}.`);
      }
    }, UNDO_MS);
  }

  async function unbench(key, name) {
    const s = lastData.sessions.find((x) => (x.key || x.id) === key);
    benchPending.delete(key);
    unbenchPending.add(key);
    render(lastData);
    if (!s || !(await post('unbench', s.id))) {
      unbenchPending.delete(key);
      render(lastData);
      say(`Could not bring ${name} back.`);
    }
  }

  async function post(action, session) {
    try {
      const r = await fetch('/api/office', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, session }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Drop optimistic state once the server's snapshot agrees with it. */
  function reconcile(c) {
    for (const [k, v] of benchPending) {
      const s = c.sessions.find((x) => (x.key || x.id) === k);
      if (!s || (v.sent && s.benched)) benchPending.delete(k);
    }
    for (const k of unbenchPending) {
      const s = c.sessions.find((x) => (x.key || x.id) === k);
      if (!s || !s.benched) unbenchPending.delete(k);
    }
  }

  function say(text, undo) {
    clearTimeout(toastTimer);
    const kids = [el('span', null, text)];
    if (undo) {
      const b = el('button', null, 'Undo');
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        clearTimeout(toastTimer);
        hideToast();
        undo();
      });
      kids.push(b);
    }
    toast.replaceChildren(...kids);
    toast.hidden = false;
    if (!undo) toastTimer = setTimeout(hideToast, 3500);
  }
  const hideToast = () => { toast.hidden = true; };

  // ---------- public ----------
  function mount(rootEl, options) {
    root = rootEl;
    opts = options;
    inner = el('div', 'office-floor');
    sizer = el('div', 'office-sizer', inner);
    vp = el('div', 'office-vp', sizer);
    ticker = el('div', 'office-tick');
    pop = el('div', 'office-pop');
    pop.hidden = true;
    toast = el('div', 'office-toast');
    toast.hidden = true;
    root.replaceChildren(vp, ticker, pop, toast);
    vp.addEventListener('pointerdown', onDown);
    vp.addEventListener('pointermove', onMove);
    vp.addEventListener('pointerup', onUp);
    vp.addEventListener('pointercancel', onCancel);
    root.addEventListener('click', (ev) => {
      if (suppressClick) { suppressClick = false; return; }
      if (pop.contains(ev.target)) { popKey = null; pop.hidden = true; return; }
      const hit = ev.target.closest('[data-key]');
      popKey = hit && hit.dataset.key !== popKey ? hit.dataset.key : null;
      renderPop(Date.now());
    });
    const touched = () => { lastTouch = Date.now(); };
    vp.addEventListener('pointerdown', touched, { passive: true });
    vp.addEventListener('touchstart', touched, { passive: true });
    vp.addEventListener('wheel', touched, { passive: true });
    new ResizeObserver(() => {
      if (!root.clientWidth) return;
      // Trip offsets point at where the kitchen was; a re-fit can move it, so call everyone back.
      for (const k of [...trips.keys()]) endTrip(k, false);
      fit();
    }).observe(root);
  }

  function render(c, now = Date.now()) {
    if (!root || !c) return;
    lastData = c;
    if (!root.clientWidth) return; // hidden view
    reconcile(c);
    const m = buildModel(c, now);
    const k = keyOf(m);
    if (k !== layoutKey && !drag?.active) {
      rebuild(m);
      layoutKey = k;
    }
    lastModel = m;
    update(m, now);
    if (!drag) {
      maybeTrip(m);
      autoPan(now);
    }
  }

  window.RmsOffice = {
    mount,
    render,
    /** A person's colours, so other views (the Split stage) draw the same character. */
    look: (id) => ({ shirt: pick(SHIRTS, id, 'shirt'), hair: pick(HAIR, id, 'hair'), skin: pick(SKIN, id, 'skin') }),
    refit: () => { layoutKey = null; if (lastData) render(lastData); },
    // Remote / keyboard navigation (keys.js).
    hold: () => { lastTouch = Date.now(); }, // pause auto-pan, as a touch does
    toggleCard: (key) => {
      popKey = key && key !== popKey ? key : null;
      renderPop(Date.now());
    },
    showCard: (key) => {
      if (popKey && key && key !== popKey) { popKey = key; renderPop(Date.now()); }
    },
    closeCard: () => {
      if (!popKey) return false;
      popKey = null;
      renderPop(Date.now());
      return true;
    },
    // For testing: send someone to the kitchen now.
    _trip: () => {
      if (!lastModel) return;
      const r = Math.random;
      Math.random = () => 0;
      try { maybeTrip(lastModel); } finally { Math.random = r; }
    },
  };
})();
