'use strict';
// Remote-control (D-pad) and keyboard navigation, mainly for Android TV / Google TV.
//  - Arrow keys move a focus ring between the header buttons and, in the Agents view, the people
//    in the office. The first press only shows the ring.
//  - OK / Enter presses a button, or opens (and closes) the session card of the focused person.
//    While a card is open, moving to someone else shows their card instead.
//  - Back (wired from the Android app through RmsKeys.back()) closes the card, then the ring;
//    when there is nothing left to close it returns false and the app opens its settings.
//  - After a while without key presses the ring and card go away, so the office auto-pans again.
// The office pauses its auto-pan while someone is navigating (RmsOffice.hold).

(() => {
  const IDLE_MS = 20000;
  const DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  let cur = null;
  let shown = false;
  let idleTimer;

  const office = () => window.RmsOffice;
  const isPerson = (e) => e?.classList.contains('pp');
  const spotKey = (p) => p.closest('[data-key]')?.dataset.key || null;

  function targets() {
    const list = [...document.querySelectorAll('.controls button')];
    if (document.body.dataset.view === 'agents') list.push(...document.querySelectorAll('#office .pp'));
    return list
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter((t) => t.r.width > 0 && t.r.height > 0);
  }

  const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];

  /** Nearest target in the given direction, favouring ones in line with the current one. */
  function step(dir) {
    const all = targets();
    const from = all.find((t) => t.e === cur);
    if (!from) return null;
    const [cx, cy] = center(from.r);
    let best = null;
    let bestScore = Infinity;
    for (const t of all) {
      if (t.e === cur) continue;
      const [tx, ty] = center(t.r);
      const along = (tx - cx) * dir[0] + (ty - cy) * dir[1];
      if (along <= 4) continue;
      const across = Math.abs((tx - cx) * dir[1] + (ty - cy) * dir[0]);
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = t.e; }
    }
    return best;
  }

  /** Where the ring starts: someone who needs you, else the first person, else the current view's tab. */
  function first() {
    const all = targets().map((t) => t.e);
    return all.find((e) => isPerson(e) && e.closest('.attention'))
      || all.find(isPerson)
      || all.find((e) => e.classList.contains('on'))
      || all[0]
      || null;
  }

  function paint() {
    document.querySelectorAll('.kfocus').forEach((e) => { if (e !== cur || !shown) e.classList.remove('kfocus'); });
    if (cur && shown) cur.classList.add('kfocus');
  }

  /** Scroll the office so the focused person (and their bubble above) is in view. */
  function reveal(e) {
    const vp = e.closest('.office-vp');
    if (!vp) return;
    const r = e.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    const pad = 70;
    let dy = 0;
    if (r.top - pad < v.top) dy = r.top - pad - v.top;
    else if (r.bottom + pad > v.bottom) dy = r.bottom + pad - v.bottom;
    let dx = 0;
    if (r.left - pad < v.left) dx = r.left - pad - v.left;
    else if (r.right + pad > v.right) dx = r.right + pad - v.right;
    if (dx || dy) vp.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  }

  function focus(e) {
    cur = e;
    shown = !!e;
    paint();
    if (isPerson(e)) {
      reveal(e);
      office()?.showCard(spotKey(e));
    }
  }

  function hide() {
    shown = false;
    paint();
  }

  function touchIdle() {
    office()?.hold();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      office()?.closeCard();
      hide();
    }, IDLE_MS);
  }

  function press() {
    if (!cur) return;
    if (isPerson(cur)) office()?.toggleCard(spotKey(cur));
    else cur.click();
  }

  function onKey(ev) {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    const dir = DIRS[ev.key];
    const ok = ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Select' || ev.keyCode === 23;
    if (!dir && !ok) return;
    ev.preventDefault(); // keep the WebView's own focus handling and scrolling out of it
    touchIdle();
    if (!cur?.isConnected || !targets().some((t) => t.e === cur)) cur = null;
    if (!shown || !cur) {
      focus(cur || first());
      return; // first press only shows where you are
    }
    if (ok) {
      if (!ev.repeat) press();
      return;
    }
    const next = step(dir);
    if (next) focus(next);
  }

  /** Called by the Android app for the Back key. True if something was closed. */
  function back() {
    touchIdle();
    if (office()?.closeCard()) return true;
    if (shown) { hide(); return true; }
    return false;
  }

  document.addEventListener('keydown', onKey);
  // Touch and mouse users do not need the ring.
  document.addEventListener('pointerdown', hide, { passive: true });

  window.RmsKeys = { back };
})();
