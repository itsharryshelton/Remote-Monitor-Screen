'use strict';
// Split view "stage": each Claude Code session is a character drawn side-on, acting out what it
// is doing right now (typing at a desk, at a terminal, reading, searching a filing cabinet, at a
// globe for web lookups, handing boxes to subagent helpers, writing a to-do list, thinking,
// tinkering at a workbench, waving for you, feet up when done, asleep when idle). Now and then an
// idle one does a chore instead: dusting the desk, cleaning their screen, or polishing a PC metrics tile.
// Characters keep the same shirt, hair and skin as their person in the Agents office.
// The SVG is built from constant markup only; transcript-derived text goes in with textContent.

(() => {
  const MIN_W = 104; // px per character; fewer fit, the rest are counted
  const MAX_HELPERS = 3;

  const FALLBACK = { shirt: '#4f7cff', hair: '#3a2618', skin: '#e0ac85' };

  // ---------- drawing helpers (viewBox 0 0 120 100, floor at y 94.5, facing right) ----------
  const pts = (list) => list.map((p) => p.join(',')).join(' ');
  const pl = (cls, ...list) => `<polyline class="${cls}" points="${pts(list)}"/>`;
  const hand = (x, y) => `<circle class="hand" cx="${x}" cy="${y}" r="2.6"/>`;
  const origin = (x, y) => `style="transform-origin:${x}px ${y}px"`;
  /** Shoulder, elbow, hand. cls may hold "bk" (far side, darker) and an animation class. */
  const arm = (cls, s, e, h) => `<g class="${cls}" ${origin(...s)}>${pl('am', s, e, h)}${hand(...h)}</g>`;
  /** Hip, knee, heel, toe. */
  const leg = (cls, hip, knee, heel, toe) => `<g class="${cls}">${pl('lg', hip, knee, heel)}${pl('shoe', heel, toe)}</g>`;
  const torso = (hip, sh) => `<line class="torso" x1="${hip[0]}" y1="${hip[1]}" x2="${sh[0]}" y2="${sh[1]}"/>`;
  const head = (x, y, rot = 0, cls = '') => `<g class="hd ${cls}" ${origin(x, y + 8)}><g transform="translate(${x} ${y}) rotate(${rot})">`
    + '<circle class="sk" r="8.5"/>'
    + '<path class="hr" d="M-8.6 1.5A8.6 8.6 0 0 1 7.5-4.5Q3-2.6-1-3.4Q-3.2 1-8.6 1.5Z"/>'
    + '<circle class="ear" cx="-2.2" cy="1.6" r="1.9"/>'
    + '<circle class="eye" cx="4.6" cy="-0.6" r="1.1"/>'
    + '</g></g>';

  // Each character stands on their own patch of floor: they're scattered, not in one line.
  const FLOOR = '<line class="floor" x1="2" y1="94.5" x2="118" y2="94.5"/>';
  const shadow = (x, w = 20) => `<ellipse class="shadow" cx="${x}" cy="94.5" rx="${w}" ry="2.2"/>`;
  const CHAIR = '<g class="xchair"><line x1="27" y1="44" x2="31" y2="72"/><line x1="40" y1="74" x2="40" y2="89"/><line x1="31" y1="91" x2="49" y2="91"/></g>'
    + '<rect class="xseat" x="28" y="69.5" width="24" height="4.5" rx="2.2"/>';
  const DESK = '<rect class="xdesk" x="60" y="62" width="54" height="4" rx="1"/>'
    + '<line class="dleg" x1="74" y1="66" x2="74" y2="94"/><line class="dleg" x1="108" y1="66" x2="108" y2="94"/>';
  const KEYBOARD = '<rect class="kbd" x="62" y="60" width="16" height="2" rx="1"/>';
  const monitor = (inner, x = 80, cls = '') => `<line class="mstand" x1="${x + 12}" y1="62" x2="${x + 12}" y2="53"/>`
    + `<rect class="mfoot" x="${x + 7}" y="60.5" width="10" height="2" rx="1"/>`
    + `<rect class="bezel" x="${x}" y="33" width="24" height="20" rx="2"/>`
    + `<g class="screen ${cls}"><rect class="glass" x="${x + 2}" y="35" width="20" height="16" rx="1"/>${inner}</g>`;
  /** A line of text being typed out (stroke-dash animation). */
  const tline = (x1, y, len, delay, cls = '') => `<line class="tl ${cls}" x1="${x1}" y1="${y}" x2="${x1 + len}" y2="${y}" style="--l:${len}px;animation-delay:${delay}s"/>`;

  const sitLegBack = leg('bk', [40, 69], [56, 70], [56, 91], [61, 91]);
  const sitLegFront = leg('', [40, 69], [59, 69], [59, 91], [65, 91]);
  /** Standing legs for a body whose hips are at x. */
  const standLegs = (x) => [
    leg('bk', [x, 64], [x - 2, 78], [x - 3, 92], [x + 2, 92]),
    leg('', [x, 64], [x + 5, 78], [x + 6, 92], [x + 11, 92]),
  ];

  // ---------- scenes ----------
  const SCENES = {
    // Edit / Write: typing at the desk, code appearing on the screen.
    type: () => {
      const code = tline(84, 38.5, 11, 0) + tline(86, 42, 13, 0.5) + tline(86, 45.5, 8, 1) + tline(84, 49, 14, 1.5);
      return shadow(52) + CHAIR + DESK + monitor(code) + KEYBOARD + sitLegBack
        + arm('bk tap d2', [43, 50], [53, 61], [65, 59])
        + torso([40, 67], [43, 49]) + sitLegFront + head(47, 36, 4)
        + arm('tap', [44, 50], [55, 62], [69, 60]);
    },
    // Bash / PowerShell: at a terminal.
    term: () => {
      const out = '<path class="prm" d="M84 37.6l2 1.5-2 1.5"/>' + tline(88, 39.1, 11, 0, 'g') + tline(84, 43, 14, 0.6, 'g')
        + tline(84, 47, 7, 1.2, 'g') + '<rect class="cur" x="93" y="45.4" width="2.6" height="3.2"/>';
      return shadow(52) + CHAIR + DESK + monitor(out, 80, 'term') + KEYBOARD + sitLegBack
        + arm('bk tap d2', [43, 50], [53, 61], [65, 59])
        + torso([40, 67], [43, 49]) + sitLegFront + head(47, 36, 2)
        + arm('tap', [44, 50], [55, 62], [69, 60]);
    },
    // Read: leaning back in the chair with a book, pages turning; reading lamp on a side table.
    read: () => shadow(50)
      + '<path class="glow" d="M94 52L106 52L115 70L85 70Z"/>'
      + '<rect class="xdesk" x="84" y="70" width="24" height="3.5" rx="1"/><line class="dleg" x1="96" y1="73.5" x2="96" y2="93"/><line class="dleg" x1="88" y1="93" x2="104" y2="93"/>'
      + '<line class="mstand" x1="101" y1="70" x2="101" y2="52"/><path class="lshade" d="M95 52L107 52L104 44L98 44Z"/>'
      + '<rect class="xmug" x="87" y="64" width="5" height="6" rx="1"/>'
      + CHAIR + sitLegBack
      + arm('bk', [42, 51], [48, 62], [55, 57])
      + torso([40, 67], [41, 49]) + sitLegFront + head(45, 36, 14, 'nod')
      + '<g class="book"><path class="cover" d="M53 46L60 48L67 46L67 57L60 59L53 57Z"/>'
      + '<path class="page" d="M54 46.6L60 48.6L60 57.6L54 55.6Z"/><path class="page" d="M60 48.6L66 46.6L66 55.6L60 57.6Z"/>'
      + `<path class="page flip" ${origin(60, 52)} d="M60 48.6L66 46.6L66 55.6L60 57.6Z"/></g>`
      + arm('', [42, 51], [52, 62], [66, 57]),
    // Grep / Glob: bent over a filing cabinet with a magnifying glass.
    search: () => {
      const [back, front] = standLegs(48);
      return shadow(62, 28)
        + '<rect class="cab" x="76" y="62" width="28" height="32" rx="1.5"/><line class="cabl" x1="76" y1="72.5" x2="104" y2="72.5"/><line class="cabl" x1="76" y1="83" x2="104" y2="83"/>'
        + '<rect class="hdl" x="86" y="66" width="8" height="2" rx="1"/><rect class="hdl" x="86" y="76.5" width="8" height="2" rx="1"/><rect class="hdl" x="86" y="87" width="8" height="2" rx="1"/>'
        + '<rect class="xpaper" x="78" y="59" width="22" height="3" rx=".5" transform="rotate(-2 89 60)"/>'
        + '<rect class="xpaper" x="81" y="56.4" width="16" height="2.6" rx=".5" transform="rotate(3 89 58)"/>'
        + '<rect class="hit" x="86" y="56.6" width="5" height="1.4" rx=".5"/>'
        + back + arm('bk', [54, 49], [48, 57], [51, 64])
        + torso([48, 63], [55, 47]) + front + head(61, 37, 22)
        + `<g class="sweep" ${origin(56, 49)}>${pl('am', [56, 49], [65, 55], [72, 53])}`
        + '<line class="mgh" x1="72" y1="53" x2="76" y2="56"/><circle class="lens" cx="80" cy="58.5" r="4.5"/>'
        + `${hand(72, 53)}</g>`;
    },
    // WebFetch / WebSearch: pointing at a spinning globe.
    web: () => {
      const [back, front] = standLegs(46);
      return shadow(68, 32)
        + '<line class="mstand" x1="92" y1="75" x2="92" y2="92"/><line class="mstand" x1="84" y1="93" x2="100" y2="93"/>'
        + '<path class="ring" d="M92 37A19 19 0 0 1 92 75"/>'
        + '<circle class="globe" cx="92" cy="56" r="15"/>'
        + '<ellipse class="land" cx="88" cy="50" rx="5" ry="3.4"/><ellipse class="land d2" cx="94" cy="62" rx="4" ry="5"/><ellipse class="land d3" cx="90" cy="57" rx="3" ry="2"/>'
        + `<ellipse class="mer" cx="92" cy="56" rx="15" ry="15" ${origin(92, 56)}/><ellipse class="mer d2" cx="92" cy="56" rx="15" ry="15" ${origin(92, 56)}/>`
        + '<line class="eq" x1="77" y1="56" x2="107" y2="56"/>'
        + back + arm('bk', [47, 46], [44, 57], [46, 65])
        + torso([46, 63], [47, 45]) + front + head(50, 33, -6)
        + arm('point', [48, 47], [58, 44], [69, 40]);
    },
    // Agent / running subagents: directing little helpers who carry boxes off.
    delegate: (helpers) => {
      const [back, front] = standLegs(30);
      return shadow(34)
        + helpers.map((color, i) => helper(color, i, helpers.length)).join('')
        + back + arm('bk', [31, 47], [34, 58], [41, 58])
        + '<g transform="rotate(8 43 55)"><rect class="clipb" x="38" y="49" width="10" height="13" rx="1"/><rect class="clipc" x="41" y="48" width="4" height="2.2" rx=".6"/>'
        + '<line class="ink" x1="40" y1="53" x2="46" y2="53"/><line class="ink" x1="40" y1="56" x2="45" y2="56"/><line class="ink" x1="40" y1="59" x2="46" y2="59"/></g>'
        + torso([30, 63], [31, 45]) + front + head(34, 33, 0)
        + arm('point', [32, 47], [42, 41], [51, 35]);
    },
    // TodoWrite: writing a checklist on an easel.
    plan: () => {
      const [back, front] = standLegs(54);
      const rows = [0, 1, 2].map((i) => {
        const y = 31 + i * 8;
        return `<rect class="cbx" x="76" y="${y - 2}" width="4" height="4" rx=".6"/>`
          + (i < 2 ? `<path class="chk" d="M76.8 ${y}l1.2 1.3 2.4-3"/><line class="ink" x1="83" y1="${y}" x2="${i ? 100 : 104}" y2="${y}"/>` : tline(83, y, 15, 0, 'ink'));
      }).join('');
      return shadow(70, 30)
        + '<line class="easel" x1="80" y1="94" x2="86" y2="54"/><line class="easel" x1="104" y1="94" x2="98" y2="54"/><line class="easel bk" x1="92" y1="94" x2="92" y2="58"/>'
        + `<rect class="board" x="72" y="24" width="38" height="32" rx="1.5"/>${rows}`
        + back + arm('bk', [55, 47], [52, 57], [54, 65])
        + torso([54, 63], [56, 45]) + front + head(59, 33, -4)
        + `<g class="write" ${origin(57, 47)}>${pl('am', [57, 47], [67, 50], [78, 47])}<line class="marker" x1="78" y1="47" x2="82" y2="47"/>${hand(78, 47)}</g>`;
    },
    // Thinking: hand on chin, thought cloud.
    think: () => {
      const [back, front] = standLegs(48);
      return shadow(50)
        + '<g class="thought"><circle cx="63" cy="24" r="1.6"/><circle cx="68" cy="18.5" r="2.4"/>'
        + '<circle cx="80" cy="12" r="6.5"/><circle cx="88" cy="9" r="7.5"/><circle cx="96" cy="12" r="6.5"/><circle cx="88" cy="15" r="6.5"/></g>'
        + '<circle class="tdot" cx="82.5" cy="12" r="1.5"/><circle class="tdot d2" cx="88" cy="12" r="1.5"/><circle class="tdot d3" cx="93.5" cy="12" r="1.5"/>'
        + back + arm('bk', [49, 47], [56, 55], [53, 58])
        + torso([48, 63], [49, 45]) + front + head(52, 32, -10, 'sway')
        + arm('', [50, 47], [61, 53], [58, 41]);
    },
    // Skills, MCP tools and anything else: cranking gears at a workbench.
    tool: () => {
      const [back, front] = standLegs(50);
      return shadow(76, 36)
        + '<rect class="xdesk" x="68" y="62" width="44" height="4" rx="1"/><line class="dleg" x1="72" y1="66" x2="72" y2="94"/><line class="dleg" x1="108" y1="66" x2="108" y2="94"/>'
        + '<line class="dleg" x1="72" y1="84" x2="108" y2="84"/><rect class="tbox" x="90" y="78" width="13" height="6" rx="1"/>'
        + '<line class="mstand" x1="96" y1="50" x2="96" y2="62"/>'
        + `<g class="gear" ${origin(96, 48)}><circle class="gt" cx="96" cy="48" r="9"/><circle class="gb" cx="96" cy="48" r="7"/><circle class="gh" cx="96" cy="48" r="2.2"/></g>`
        + `<g class="gear rev" ${origin(83, 56)}><circle class="gt" cx="83" cy="56" r="5"/><circle class="gb" cx="83" cy="56" r="3.6"/><circle class="gh" cx="83" cy="56" r="1.3"/></g>`
        + '<g class="sparks"><line x1="86" y1="44" x2="84" y2="40"/><line x1="88" y1="46" x2="91" y2="43"/><line x1="84" y1="48" x2="80" y2="47"/></g>'
        + back + arm('bk', [52, 47], [60, 55], [69, 60])
        + torso([50, 63], [52, 45]) + front + head(56, 33, 10)
        + `<g class="crank" ${origin(53, 47)}>${pl('am', [53, 47], [64, 52], [74, 48])}`
        + `<line class="wrench" x1="74" y1="48" x2="81" y2="51.5"/><circle class="wrj" cx="82.5" cy="52" r="2.2"/>${hand(74, 48)}</g>`;
    },
    // Needs you: waving both arms, with a "!" sign.
    attn: () => {
      const [back, front] = standLegs(50);
      return shadow(54)
        + `<g class="alert" ${origin(84, 22)}><rect x="72" y="8" width="24" height="20" rx="6"/><path d="M77 27L83 27L73 34Z"/>`
        + '<rect class="ex" x="82.5" y="11.5" width="3" height="9" rx="1.5"/><circle class="ex" cx="84" cy="24" r="1.7"/></g>'
        + `<g class="hop">${back}${arm('bk wave d2', [49, 46], [39, 38], [34, 28])}`
        + torso([50, 63], [50, 45]) + front + head(52, 32, -6)
        + `${arm('wave', [51, 46], [62, 39], [68, 28])}</g>`;
    },
    // Done (waiting for your next prompt): feet up on the desk, hands behind head, coffee steaming.
    done: () => shadow(52)
      + CHAIR + DESK + monitor('<path class="okc" d="M95 43l3 3 6-6"/>', 88, 'off')
      + '<rect class="xmug" x="76" y="55" width="6" height="7" rx="1"/><path class="mugh" d="M82 57q3 0 3 2.5t-3 2.5"/>'
      + '<g class="xsteam"><path d="M78 52q-1.5-2.5 0-5t0-5"/><path class="d2" d="M81 52q-1.5-2.5 0-5t0-5"/></g>'
      + arm('bk', [38, 50], [24, 42], [30, 32])
      + leg('bk', [40, 68], [52, 63], [64, 60], [66, 54])
      + torso([40, 66], [37, 48])
      + leg('', [40, 68], [55, 62], [68, 59], [70, 53])
      + arm('', [38, 50], [25, 37], [31, 30])
      + head(36, 35, -12),
    // ---- idle chores (see CHORES below): played now and then instead of "done" or "sleep" ----
    // Tidying: feather-dusting the desk, puffs of dust coming off it.
    dust: () => {
      const [back, front] = standLegs(44);
      return shadow(70, 34)
        + DESK + monitor('<path class="okc" d="M95 43l3 3 6-6"/>', 88, 'off')
        + '<rect class="xpaper" x="96" y="59" width="14" height="3" rx=".5"/><rect class="xpaper" x="97" y="56.6" width="12" height="2.4" rx=".5" transform="rotate(-3 103 58)"/>'
        + '<g class="puff"><circle cx="70" cy="58" r="1.8"/><circle class="d2" cx="76" cy="57" r="1.4"/><circle class="d3" cx="82" cy="58.5" r="1.6"/></g>'
        + back + arm('bk', [45, 47], [49, 57], [54, 62])
        + torso([44, 63], [46, 45]) + front + head(50, 33, 16)
        + `<g class="dusting" ${origin(47, 47)}>${pl('am', [47, 47], [56, 54], [63, 57])}`
        + '<line class="dstick" x1="63" y1="57" x2="71" y2="58.5"/>'
        + '<g class="feather"><ellipse cx="76" cy="58.6" rx="6" ry="2.6"/><ellipse cx="74.5" cy="57" rx="4.5" ry="1.8" transform="rotate(-14 74.5 57)"/><ellipse cx="74.5" cy="60.2" rx="4.5" ry="1.8" transform="rotate(14 74.5 60.2)"/></g>'
        + `${hand(63, 57)}</g>`;
    },
    // Cleaning the screen: cloth in circles on their own monitor, a gleam left behind.
    wipe: () => {
      const [back, front] = standLegs(52);
      return shadow(70, 30)
        + DESK + monitor('<line class="gleam" x1="86" y1="51" x2="92" y2="35"/><line class="gleam d2" x1="90" y1="51" x2="96" y2="35"/>', 80, 'off')
        + '<rect class="xbottle" x="104" y="52" width="5" height="10" rx="1.2"/><path class="xnozzle" d="M104.5 52L106.5 48.6L109 49.6L108.5 52Z"/>'
        + back + arm('bk', [53, 47], [56, 57], [60, 62])
        + torso([52, 63], [54, 45]) + front + head(58, 33, 6)
        + `<g class="scrub" ${origin(55, 47)}>${pl('am', [55, 47], [66, 50], [88, 43])}`
        + `<rect class="cloth" x="86" y="39.5" width="7" height="7" rx="2"/>${hand(88, 43)}</g>`
        + '<g class="sparkle"><path d="M98 37l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/><path class="d3" d="M85 47.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></g>';
    },
    // Polishing the PC metrics: up on a step stool, spray and cloth aimed at the stats panel
    // (which gets a real sheen; see polishTile). Drawn facing right, then mirrored to face it.
    polish: () => '<g transform="matrix(-1 0 0 1 120 0)">' + shadow(56, 22)
      + '<rect class="xstool" x="40" y="80" width="30" height="4" rx="1.2"/><line class="xsleg" x1="44" y1="84" x2="42" y2="94"/><line class="xsleg" x1="66" y1="84" x2="68" y2="94"/><line class="xsleg" x1="43" y1="89" x2="67" y2="89"/>'
      + leg('bk', [54, 54], [52, 67], [51, 79], [56, 79])
      + `<g class="spray bk" ${origin(55, 38)}>${pl('am', [55, 38], [62, 46], [67, 38])}`
      + '<rect class="xbottle" x="65.5" y="33" width="5" height="9" rx="1.2"/><path class="xnozzle" d="M66 33L68 29.6L70.5 30.6L70 33Z"/>'
      + `${hand(67, 38)}<g class="mist"><circle cx="74" cy="28" r="1.3"/><circle cx="77" cy="26" r="1"/><circle cx="76" cy="30.5" r="1.1"/></g></g>`
      + torso([54, 53], [56, 35]) + leg('', [54, 54], [59, 67], [60, 79], [65, 79]) + head(59, 23, -16)
      + `<g class="scrub big" ${origin(57, 37)}>${pl('am', [57, 37], [66, 27], [74, 15])}`
      + `<rect class="cloth" x="72" y="9.5" width="8" height="8" rx="2.2"/>${hand(74, 15)}</g>`
      + '<g class="sparkle"><path d="M86 8l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/><path class="d3" d="M80 22l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></g>'
      + '</g>',
    // Idle or benched: asleep with head on the desk.
    sleep: () => shadow(52)
      + CHAIR + DESK + monitor('', 80, 'off') + sitLegBack
      + `<g class="breathe" ${origin(40, 69)}>`
      + arm('bk', [48, 55], [56, 61], [68, 59])
      + torso([40, 67], [48, 54]) + head(62, 52, 75)
      + arm('', [49, 56], [58, 62], [71, 60]) + '</g>'
      + sitLegFront
      + '<g class="xzz"><text x="58" y="40">z</text><text class="d2" x="63" y="32">z</text><text class="d3" x="69" y="23">Z</text></g>',
  };

  /** A small helper (subagent) walking right with a box. color comes from the fixed shirt palette. */
  function helper(color, i, n) {
    const delay = -(i * 4.5) / n;
    return `<g class="helper" style="animation-delay:${delay}s;--hs:${color}"><g transform="translate(0 94)">`
      + `<g class="wl" ${origin(0, -14)}>${pl('hlg', [0, -14], [-1, -1])}</g>`
      + `<g class="wl d2" ${origin(0, -14)}>${pl('hlg', [0, -14], [1, -1])}</g>`
      + '<line class="htr" x1="0" y1="-15" x2="0.5" y2="-25"/>'
      + '<circle class="sk" cx="2" cy="-31" r="4.6"/><path class="hr" d="M-2.6-30A4.6 4.6 0 0 1 6.2-33.4Q2-32.4-2.6-30Z"/>'
      + '<rect class="box" x="3" y="-29" width="9" height="8" rx=".8"/>'
      + pl('ham', [0.5, -23], [5, -20], [6, -24])
      + '</g></g>';
  }

  // ---------- model ----------
  const TOOL_SCENE = {
    Edit: 'type', Write: 'type', MultiEdit: 'type', NotebookEdit: 'type',
    Bash: 'term', PowerShell: 'term', BashOutput: 'term', KillShell: 'term',
    Read: 'read',
    Grep: 'search', Glob: 'search', LS: 'search', ToolSearch: 'search',
    WebFetch: 'web', WebSearch: 'web',
    Agent: 'delegate', Task: 'delegate',
    TodoWrite: 'plan',
  };
  const busy = (a) => a.status === 'working' || a.status === 'attention';

  function sceneOf(s) {
    if (s.benched || s.status === 'stale') return 'sleep';
    if (s.status === 'attention') return 'attn';
    if (s.status === 'done') return 'done';
    if (s.tool) return TOOL_SCENE[s.tool] || 'tool';
    if ((s.subagents || []).some(busy)) return 'delegate';
    return 'think';
  }

  // ---------- idle chores ----------
  // Now and then one idle character (finished a while ago, or dozing) gets up to dust their desk,
  // clean their screen, or polish one of the PC metrics tiles. One chore at a time, a few seconds each.
  const CHORES = ['dust', 'wipe', 'polish'];
  const CHORE_TICK_MS = 5000;
  const CHORE_CHANCE = 0.1; // per tick while someone is free: roughly one chore a minute
  const CHORE_MS = [9000, 13000];
  const CHORE_REST_MS = 2 * 60 * 1000; // the same character won't take another chore for this long
  const SETTLE_MS = 45 * 1000; // a freshly finished agent gets its feet-up moment first
  let chore = null; // { key, scene, until, tile, force }
  const choreEnded = new Map(); // session key -> when its last chore ended

  const idleFor = (s, now) => !s.benched
    && (s.status === 'stale' || (s.status === 'done' && now - (s.lastActivity || 0) > SETTLE_MS));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /** A visible PC metrics tile to polish, or null (e.g. in portrait it may be scrolled away; fine). */
  function polishTile() {
    const tiles = [...document.querySelectorAll('.system .tile')].filter((t) => t.clientWidth > 0);
    return tiles.length ? pick(tiles) : null;
  }

  function startChore(key, scene, force = false) {
    if (chore) endChore();
    const tile = scene === 'polish' ? polishTile() : null;
    if (scene === 'polish' && !tile) scene = 'wipe';
    tile?.classList.add('polish');
    const [lo, hi] = CHORE_MS;
    chore = { key, scene, tile, force, until: Date.now() + lo + Math.random() * (hi - lo) };
  }

  function endChore() {
    if (!chore) return;
    chore.tile?.classList.remove('polish');
    choreEnded.set(chore.key, Date.now());
    chore = null;
  }

  function choreTick() {
    const now = Date.now();
    if (chore) {
      if (now >= chore.until) { endChore(); if (lastData) render(lastData, now); }
      return;
    }
    if (!lastData || !root.clientWidth || document.hidden) return;
    const free = lastData.sessions
      .filter((s) => actors.has(s.key || s.id) && idleFor(s, now) && now - (choreEnded.get(s.key || s.id) || 0) > CHORE_REST_MS);
    if (!free.length || Math.random() > CHORE_CHANCE) return;
    const s = pick(free);
    startChore(s.key || s.id, pick(CHORES));
    render(lastData, now);
  }

  function shade(hex, f) {
    const n = parseInt(String(hex).slice(1), 16);
    if (Number.isNaN(n)) return hex;
    return `rgb(${[16, 8, 0].map((b) => Math.round(((n >> b) & 255) * f)).join(',')})`;
  }

  // ---------- render ----------
  let root, opts, more, empty, pop;
  let popKey = null;
  let lastData = null;
  const actors = new Map(); // session key -> { el, svg, name, el2, what, scene }
  let orderKey = '';

  const lookOf = (id) => opts.look?.(id) || FALLBACK;

  function actor(key) {
    let a = actors.get(key);
    if (a) return a;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 100');
    svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    svg.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'an';
    const since = document.createElement('span');
    since.className = 'ael';
    const dot = document.createElement('i');
    dot.className = 'dot';
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.append(dot, name, since);
    const what = document.createElement('div');
    what.className = 'aw';
    const el = document.createElement('div');
    el.className = 'actor';
    el.dataset.key = key;
    el.append(svg, cap, what);
    const look = lookOf(key);
    el.style.setProperty('--shirt', look.shirt);
    el.style.setProperty('--shirt2', shade(look.shirt, 0.72));
    el.style.setProperty('--hair', look.hair);
    el.style.setProperty('--skin', look.skin);
    a = { el, svg, name, since, what, scene: null };
    actors.set(key, a);
    return a;
  }

  function paint(a, s, now) {
    let scene = sceneOf(s);
    if (chore?.key === a.el.dataset.key) {
      // A chore is only for idle hands: if the agent picks up work (or gets benched) it drops it.
      if (chore.force || idleFor(s, now)) scene = chore.scene;
      else endChore();
    }
    let sceneKey = scene;
    let helpers = [];
    if (scene === 'delegate') {
      const subs = (s.subagents || []).filter(busy).slice(0, MAX_HELPERS);
      helpers = subs.length ? subs.map((x) => lookOf(x.key || x.id).shirt) : [lookOf(`${s.key || s.id}/helper`).shirt];
      sceneKey += `:${helpers.join(',')}`;
    }
    if (a.scene !== sceneKey) {
      a.scene = sceneKey;
      // Constant markup (plus palette colours), never transcript text.
      a.svg.innerHTML = FLOOR + SCENES[scene](helpers);
    }
    a.el.className = `actor ${s.status}${s.benched ? ' benched' : ''}`;
    a.el.dataset.scene = scene;
    const nm = s.project || 'session';
    if (a.name.textContent !== nm) a.name.textContent = nm;
    const text = s.benched ? (busy(s) ? 'Stopping…' : 'Benched') : s.text || '';
    if (a.what.textContent !== text) a.what.textContent = text;
    a.el.title = `${s.title && s.title !== s.project ? `${nm} · ${s.title}` : nm}\n${text}`;
    a.since.textContent = busy(s) && s.since ? opts.dur(now - s.since) : opts.ago(s.lastActivity);
  }

  // ---------- layout: fill the whole stage ----------
  // Pick the rows x columns that draws everyone biggest, then drop each character somewhere
  // random inside its cell. Cells never overlap, so neither do characters or their captions.
  const ART_W = 120; // scene viewBox
  const ART_H = 100;
  const CAP_H = 34; // name + status lines under each character
  const PAD = 8; // .actor padding, both axes
  const MAX_S = 2.4; // don't let a lone character get absurdly large

  /** Stable pseudo-random number in [0, 1) for a session key (FNV-1a). */
  function rnd(key, salt) {
    let h = 2166136261 ^ salt;
    for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  }

  function grid(n, W, H) {
    let best = null;
    for (let rows = 1; rows <= n; rows++) {
      const cols = Math.ceil(n / rows);
      const s = Math.min((W / cols - PAD) / ART_W, (H / rows - CAP_H - PAD) / ART_H, MAX_S);
      if (!best || s > best.s + 0.01) best = { rows, cols, s };
    }
    return best;
  }

  function place(keys, W, H) {
    if (!keys.length) return;
    const { cols, rows, s } = grid(keys.length, W, H);
    const w = Math.floor(s * ART_W + PAD);
    const h = Math.floor(s * ART_H + CAP_H + PAD);
    const ch = H / rows;
    keys.forEach((k, i) => {
      const r = Math.floor(i / cols);
      const inRow = Math.min(cols, keys.length - r * cols); // a short last row spreads out too
      const cw = W / inRow;
      const x = (i % cols) * cw + Math.max(0, cw - w) * rnd(k, 1);
      const y = r * ch + Math.max(0, ch - h) * rnd(k, 2);
      const st = actors.get(k).el.style;
      st.left = `${Math.round(x)}px`;
      st.top = `${Math.round(y)}px`;
      st.width = `${w}px`;
      st.height = `${h}px`;
      st.zIndex = String(Math.round(y + h)); // lower on screen = nearer, drawn in front
    });
  }

  function render(c, now = Date.now()) {
    if (!root || !c) return;
    lastData = c;
    const W = root.clientWidth;
    const H = root.clientHeight;
    if (!W) return; // hidden view
    let fit = c.sessions.length;
    while (fit > 1 && grid(fit, W, H).s * ART_W < MIN_W - PAD) fit--;
    // Sessions arrive most-urgent first; take the ones that fit, then scatter them in a fixed
    // pseudo-random order (seeded by session key, so nobody hops about between updates).
    const shown = c.sessions.slice(0, fit).sort((a, b) => rnd(a.key || a.id, 0) - rnd(b.key || b.id, 0));
    const keys = shown.map((s) => s.key || s.id);
    for (const k of [...actors.keys()]) if (!keys.includes(k)) actors.delete(k);
    if (chore && !actors.has(chore.key)) endChore();
    shown.forEach((s, i) => paint(actor(keys[i]), s, now));
    place(keys, W, H);

    const hidden = c.sessions.length - shown.length;
    more.textContent = hidden > 0 ? `+${hidden} more` : '';
    const k = keys.join('|');
    if (k !== orderKey) {
      // Only reorder when the cast changes: moving nodes would restart their animations.
      orderKey = k;
      root.replaceChildren(...(keys.length ? keys.map((x) => actors.get(x).el) : [empty]), more, pop);
    }
    renderPop(now);
  }

  /** Tap a character for its full session card (tap again, or tap the card, to close). */
  function renderPop(now) {
    const s = popKey && lastData?.sessions.find((x) => (x.key || x.id) === popKey);
    if (!s || !opts.card) { popKey = null; pop.hidden = true; return; }
    pop.replaceChildren(opts.card(s, now));
    pop.hidden = false;
  }

  function mount(el, options) {
    root = el;
    opts = options;
    more = document.createElement('span');
    more.className = 'stage-more';
    empty = document.createElement('div');
    empty.className = 'stage-empty';
    empty.textContent = 'No Claude Code sessions in the last few hours. Start one in VS Code or the CLI and a character will walk on.';
    pop = document.createElement('div');
    pop.className = 'office-pop stage-pop';
    pop.hidden = true;
    root.replaceChildren(empty, more, pop);
    root.addEventListener('click', (ev) => {
      const hit = !pop.contains(ev.target) && ev.target.closest('.actor');
      popKey = hit && hit.dataset.key !== popKey ? hit.dataset.key : null;
      renderPop(Date.now());
    });
    new ResizeObserver(() => { if (opts.data?.()) render(opts.data()); }).observe(root);
    setInterval(choreTick, CHORE_TICK_MS);
  }

  /** Debug: make a character (default: the first on stage) do a chore now, idle or not. */
  function _chore(scene = pick(CHORES), key = actors.keys().next().value) {
    if (!key || !SCENES[scene]) return null;
    startChore(key, scene, true);
    if (lastData) render(lastData);
    return chore && { key: chore.key, scene: chore.scene };
  }

  window.RmsStage = { mount, render, _scenes: Object.keys(SCENES), _chore };
})();
