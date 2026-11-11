'use strict';
// Agents "office": each Claude Code session (and each of its subagents) is a person at a desk,
// desks are grouped into pods by project, and a chat bubble shows what the person is doing.
// Finished-and-quiet sessions wander off to the break room. People are keyed DOM nodes that are
// reused across renders, so moving between desk and sofa animates as a walk (FLIP).
// All transcript-derived text is inserted with textContent, never innerHTML.

(() => {
  const IDLE_AFTER_MS = 20 * 60 * 1000; // a finished session keeps its desk this long
  const SUB_LINGER_MS = 3 * 60 * 1000; // a finished subagent keeps its desk this long
  const MAX_SUBS = 6; // per session
  const MAX_LOUNGE = 8;
  const SCALES = [1.6, 1.45, 1.3, 1.18, 1.08, 1, 0.92, 0.84, 0.76, 0.69, 0.62, 0.56, 0.5];

  const SHIRTS = ['#4f7cff', '#e0675a', '#36b37e', '#b07cff', '#e8a23a', '#30a9c2', '#e06aa3', '#8fa84a', '#7488ff', '#cf7f52'];
  const HAIR = ['#17110d', '#3a2618', '#5b3a22', '#25252d', '#7a4a2a', '#a8742f', '#4a2f45', '#0f0f12', '#c9c2b8'];
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68b62', '#a26a45', '#7c4d32', '#f5d6bd'];
  const RUGS = ['#4f7cff', '#36b37e', '#b07cff', '#e8a23a', '#30a9c2', '#e06aa3', '#e0675a', '#8fa84a'];
  const MUGS = ['#e0675a', '#f0f0f0', '#4f7cff', '#e8a23a', null, null];

  function hash(s) {
    let x = 2166136261;
    for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); }
    return x >>> 0;
  }
  const pick = (arr, key, salt) => arr[hash(`${salt}:${key}`) % arr.length];

  function el(tag, cls, ...kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) if (k != null && k !== false) e.append(k);
    return e;
  }
  const time = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  let root, inner, ticker, pop, opts;
  let scale = 1;
  let layoutKey = null;
  let popKey = null;
  let lastData = null;
  const people = new Map(); // person key -> element (persistent, so it can walk between spots)
  const spots = new Map(); // station/seat key -> record
  const podSeen = new Map(); // project -> first-seen order, so pods do not shuffle around

  // ---------- model ----------
  function buildModel(c, now) {
    const pods = new Map();
    const lounge = [];
    for (const s of c.sessions) {
      const key = s.key || s.id;
      const idle = s.status === 'stale' || (s.status === 'done' && now - (s.lastActivity || 0) > IDLE_AFTER_MS);
      if (idle) { lounge.push({ key, s, parent: s }); continue; }
      const name = s.project || 'session';
      if (!podSeen.has(name)) podSeen.set(name, podSeen.size);
      if (!pods.has(name)) pods.set(name, { name, branch: s.branch, sessions: [], hidden: 0 });
      pods.get(name).sessions.push(s);
    }
    const podList = [...pods.values()].sort((a, b) => podSeen.get(a.name) - podSeen.get(b.name));
    for (const pod of podList) {
      pod.sessions.sort((a, b) => (a.firstActivity || 0) - (b.firstActivity || 0));
      pod.stations = [];
      for (const s of pod.sessions) {
        const key = s.key || s.id;
        pod.stations.push({ key, s, parent: s, main: true });
        const subs = (s.subagents || [])
          .filter((a) => a.status === 'working' || a.status === 'attention' || (a.status === 'done' && now - (a.lastActivity || 0) < SUB_LINGER_MS))
          .sort((a, b) => (a.firstActivity || 0) - (b.firstActivity || 0));
        while (subs.length > MAX_SUBS) {
          const i = subs.findIndex((a) => a.status === 'done');
          subs.splice(i >= 0 ? i : 0, 1);
          pod.hidden++;
        }
        for (const a of subs) pod.stations.push({ key: `${key}/${a.key || a.id}`, s: a, parent: s, main: false });
      }
    }
    lounge.sort((a, b) => (b.s.lastActivity || 0) - (a.s.lastActivity || 0));
    const loungeShown = lounge.slice(0, MAX_LOUNGE);
    return { pods: podList, lounge: loungeShown, loungeHidden: lounge.length - loungeShown.length };
  }

  const keyOf = (m) => `${m.pods.map((p) => `${p.name}:${p.stations.map((s) => s.key).join(',')}`).join('|')}#${m.lounge.map((l) => l.key).join(',')}`;

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

  // ---------- spots ----------
  function station(st, flip) {
    let r = spots.get(st.key);
    if (!r) {
      const mon = el('i', 'mon', el('i', 'scr'));
      const desk = el('div', 'desk', mon, el('i', 'kb'));
      const mug = pick(MUGS, st.key, 'mug');
      if (mug) { const m = el('i', 'mug'); m.style.setProperty('--mug', mug); desk.append(m); }
      if (hash(`paper:${st.key}`) % 3 === 0) desk.append(el('i', 'paper'));
      const btext = el('span', 'bt');
      const bel = el('span', 'be');
      const bubble = el('div', 'bub', btext, bel);
      const nmText = el('span', 'nt');
      const nm = el('div', 'nm', el('i', 'sd'), nmText);
      const todo = el('i', 'todo', el('i'));
      const seat = el('div', 'seat', el('i', 'chair'));
      r = { kind: 'desk', el: el('div', 'st', bubble, nm, seat, desk, todo), bubble, btext, bel, nm, nmText, seat, todo };
      spots.set(st.key, r);
    }
    r.el.classList.toggle('flip', flip);
    r.el.classList.toggle('sub', !st.main);
    r.el.dataset.key = st.parent.key || st.parent.id;
    r.seat.append(person(st.key, st.s));
    return r;
  }

  function emptyDesk(flip) {
    const desk = el('div', 'desk', el('i', 'mon off', el('i', 'scr')), el('i', 'kb'));
    return el('div', `st empty${flip ? ' flip' : ''}`, el('div', 'nm ghost'), el('div', 'seat', el('i', 'chair')), desk);
  }

  function loungeSeat(l) {
    const key = `l:${l.key}`;
    let r = spots.get(key);
    if (!r) {
      const nmText = el('span', 'nt');
      r = { kind: 'lounge', el: el('div', 'ls', el('div', 'lseat'), el('div', 'nm', el('i', 'sd'), nmText)), nmText };
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
    // Remember where everyone is standing, so whoever moves can walk to the new spot.
    const before = new Map();
    for (const [k, p] of people) {
      const r = p.isConnected && p.getBoundingClientRect();
      if (r && r.width) before.set(k, r);
    }

    const used = new Set();
    const items = [];
    for (const pod of m.pods) {
      const n = pod.stations.length;
      const cols = n > 1 ? Math.ceil(n / 2) : 1;
      const grid = el('div', `pgrid${n > 1 ? ' two' : ''}`);
      grid.style.setProperty('--cols', cols);
      pod.stations.forEach((st, i) => {
        const r = station(st, n > 1 && i >= cols);
        used.add(st.key);
        grid.append(r.el);
      });
      if (n > 1 && n % 2) grid.append(emptyDesk(true));
      const tint = pick(RUGS, pod.name, 'rug');
      const rug = el('div', 'rug', grid);
      if (hash(`plant:${pod.name}`) % 2) rug.append(plant('tr'));
      const podEl = el('div', 'pod',
        el('div', 'plab', el('i', 'sd'), el('span', 'pn', pod.name),
          pod.branch && pod.branch !== 'HEAD' ? el('span', 'pb', `⎇ ${pod.branch}`) : null,
          pod.hidden ? el('span', 'pb', `+${pod.hidden} more`) : null),
        rug);
      podEl.style.setProperty('--rug', tint);
      podEl.dataset.pod = pod.name;
      items.push(podEl);
    }

    // Break room: always there, idle sessions nap on the sofa.
    const sofa = el('div', 'sofa');
    for (const l of m.lounge) {
      const r = loungeSeat(l);
      used.add(`l:${l.key}`);
      sofa.append(r.el);
    }
    for (let i = m.lounge.length; i < 3; i++) sofa.append(el('div', 'ls vacant', el('div', 'lseat')));
    const quiet = !m.pods.length && !m.lounge.length;
    const lounge = el('div', 'pod lounge',
      el('div', 'plab', el('i', 'sd'), el('span', 'pn', 'Break room'),
        m.loungeHidden ? el('span', 'pb', `+${m.loungeHidden} more`) : null),
      el('div', 'rug',
        el('div', 'lroom',
          sofa,
          el('div', 'lside',
            el('div', 'coffee', el('i', 'steam'), el('i', 'steam s2')),
            el('div', 'ctable', el('i', 'cup'))),
          plant('br')),
        quiet ? el('div', 'quiet', 'Quiet office. Start a Claude Code session and someone will sit down at a desk.') : null));
    items.push(lounge);

    inner.replaceChildren(...items);

    // Forget spots and people that left.
    for (const k of [...spots.keys()]) if (!used.has(k)) spots.delete(k);
    const present = new Set([...m.pods.flatMap((p) => p.stations.map((s) => s.key)), ...m.lounge.map((l) => l.key)]);
    for (const k of [...people.keys()]) if (!present.has(k)) people.delete(k);

    fit();

    for (const [k, p] of people) {
      if (p.dataset.fresh) {
        delete p.dataset.fresh;
        if (layoutKey !== null) p.animate([{ opacity: 0, transform: 'translateY(14px) scale(0.85)' }, { opacity: 1, transform: 'none' }], { duration: 700, easing: 'ease-out' });
        continue;
      }
      const a = before.get(k);
      if (!a) continue;
      const b = p.getBoundingClientRect();
      const dx = (a.left - b.left) / scale;
      const dy = (a.top - b.top) / scale;
      if (Math.hypot(dx, dy) < 4) continue;
      const ms = Math.min(2600, 700 + Math.hypot(dx, dy) * 3);
      p.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) translateY(-3px)`, offset: 0.5 },
        { transform: 'none' },
      ], { duration: ms, easing: 'ease-in-out' });
      p.classList.add('walking');
      setTimeout(() => p.classList.remove('walking'), ms);
    }
  }

  /** Pick the largest scale at which the whole floor fits without scrolling. */
  function fit() {
    const W = root.clientWidth;
    const H = root.clientHeight - ticker.offsetHeight;
    if (!W || !H) return;
    let s = SCALES[SCALES.length - 1];
    for (const c of SCALES) {
      inner.style.width = `${W / c}px`;
      if (inner.scrollHeight * c <= H && inner.scrollWidth <= W / c + 1) { s = c; break; }
    }
    scale = s;
    inner.style.width = `${W / s}px`;
    const top = Math.max(0, (H - inner.scrollHeight * s) / 2);
    inner.style.transform = `translate(0, ${top}px) scale(${s})`;
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

  function update(m, now) {
    for (const pod of m.pods) {
      for (const st of pod.stations) {
        const r = spots.get(st.key);
        if (!r) continue;
        const s = st.s;
        r.el.className = `st ${s.status}${r.el.classList.contains('flip') ? ' flip' : ''}${st.main ? '' : ' sub'}`;
        r.el.title = s.text || '';
        r.nmText.textContent = nameFor(st);
        const b = bubbleFor(s, st.main, now);
        r.bubble.hidden = !b;
        if (b) {
          r.bubble.className = `bub ${b.cls}`;
          if (r.btext.textContent !== b.text) r.btext.textContent = b.text;
          r.bel.textContent = b.el;
        }
        const t = st.main && s.todos;
        r.todo.hidden = !t;
        if (t) r.todo.firstChild.style.width = `${(100 * t.done) / Math.max(1, t.total)}%`;
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
      r.el.className = `ls ${s.status}`;
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

  // ---------- public ----------
  function mount(rootEl, options) {
    root = rootEl;
    opts = options;
    inner = el('div', 'office-floor');
    ticker = el('div', 'office-tick');
    pop = el('div', 'office-pop');
    pop.hidden = true;
    root.replaceChildren(inner, ticker, pop);
    root.addEventListener('click', (ev) => {
      if (pop.contains(ev.target)) { popKey = null; pop.hidden = true; return; }
      const hit = ev.target.closest('[data-key]');
      popKey = hit && hit.dataset.key !== popKey ? hit.dataset.key : null;
      renderPop(Date.now());
    });
    new ResizeObserver(() => { if (root.clientWidth) fit(); }).observe(root);
  }

  function render(c, now = Date.now()) {
    if (!root || !c) return;
    lastData = c;
    if (!root.clientWidth) return; // hidden view
    const m = buildModel(c, now);
    const k = keyOf(m);
    if (k !== layoutKey) {
      rebuild(m);
      layoutKey = k;
    }
    update(m, now);
  }

  window.RmsOffice = { mount, render, refit: () => { layoutKey = null; if (lastData) render(lastData); } };
})();
