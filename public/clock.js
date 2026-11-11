'use strict';
// Standalone AMOLED-friendly clock. Used as the dashboard's "PC offline" overlay and, bundled
// inside the Android app, as the fallback page when the PC cannot be reached at all.
// No network access and no dependencies.
(function () {
  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function mount(root, opts) {
    const o = opts || {};
    const wrap = el('div', 'ck-wrap');
    const time = el('div', 'ck-time');
    const hm = el('span', 'ck-hm');
    const s = el('span', 'ck-s');
    time.append(hm, s);
    const date = el('div', 'ck-date');
    const status = el('div', 'ck-status');
    wrap.append(time, date, status);
    root.replaceChildren(wrap);

    let timer = null;
    let drift = null;
    const tick = () => {
      const d = new Date();
      hm.textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      s.textContent = String(d.getSeconds()).padStart(2, '0');
      date.textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    };
    // Wander slowly around the screen so no pixel shows the same thing for long (OLED burn-in).
    const move = () => {
      const maxX = Math.max(0, (root.clientWidth - wrap.offsetWidth) / 2 - 12);
      const maxY = Math.max(0, (root.clientHeight - wrap.offsetHeight) / 2 - 12);
      const x = Math.round((Math.random() * 2 - 1) * maxX);
      const y = Math.round((Math.random() * 2 - 1) * maxY);
      wrap.style.transform = `translate(${x}px, ${y}px)`;
    };
    const api = {
      setStatus(text) {
        status.textContent = text || '';
      },
      start() {
        if (timer) return;
        tick();
        timer = setInterval(tick, 1000);
        drift = setInterval(move, o.driftMs || 60000);
        requestAnimationFrame(move);
      },
      stop() {
        clearInterval(timer);
        clearInterval(drift);
        timer = drift = null;
      },
    };
    api.setStatus(o.status);
    return api;
  }

  window.RmsClock = { mount };

  // Standalone page (clock.html): status text comes from ?msg=
  const standalone = document.getElementById('clock-standalone');
  if (standalone) {
    const msg = new URLSearchParams(location.search).get('msg');
    const c = mount(standalone, { status: msg || '' });
    c.start();
    window.rmsSetStatus = (t) => c.setStatus(t);
  }
})();
