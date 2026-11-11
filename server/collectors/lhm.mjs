// LibreHardwareMonitor integration (optional). LHM's "Remote Web Server" exposes a
// sensor tree at http://127.0.0.1:8085/data.json. This is the only practical way to
// read real CPU/GPU temperatures, fan speeds and power on Windows without writing a
// kernel driver ourselves.

export class Lhm {
  constructor({ url = 'http://127.0.0.1:8085/data.json', intervalMs = 2000, log = () => {} } = {}) {
    this.url = url;
    this.intervalMs = intervalMs;
    this.log = log;
    this.latest = null;
    this.lastOk = 0;
    this.available = false;
    this.timer = null;
    this.warned = false;
  }

  start() {
    const tick = async () => {
      try {
        const res = await fetch(this.url, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.latest = parseLhm(await res.json());
        this.lastOk = Date.now();
        if (!this.available) this.log(`lhm: connected to ${this.url}`);
        this.available = true;
      } catch (err) {
        if (this.available || !this.warned) this.log(`lhm: not reachable at ${this.url} (${err.message}); temperatures unavailable`);
        this.available = false;
        this.warned = true;
      }
      this.timer = setTimeout(tick, this.available ? this.intervalMs : 10000);
    };
    tick();
    return this;
  }

  stop() {
    clearTimeout(this.timer);
  }

  read() {
    if (!this.latest || Date.now() - this.lastOk > 15000) return null;
    return this.latest;
  }
}

/** Parse "4,850.0 MHz", "45.4 °C", "45,4 °C", "1.2 GB" etc into a number. */
export function parseValue(str) {
  if (typeof str === 'number') return str;
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^-?[\d.,]+/);
  if (!m) return null;
  let s = m[0];
  if (s.includes(',') && s.includes('.')) {
    // Whichever separator comes last is the decimal one.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{3}$/.test(s) && !/^-?0,/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const GROUP_TYPES = {
  temperatures: 'Temperature',
  load: 'Load',
  clocks: 'Clock',
  powers: 'Power',
  fans: 'Fan',
  voltages: 'Voltage',
  controls: 'Control',
  data: 'Data',
  smalldata: 'SmallData',
  throughput: 'Throughput',
  currents: 'Current',
  levels: 'Level',
  factors: 'Factor',
  energy: 'Energy',
  timing: 'Timing',
  noise: 'Noise',
};

const HW_ORDER = { cpu: 0, gpu: 1, board: 2, memory: 3, storage: 4, network: 5 };

function hardwareKind(node) {
  const img = (node.ImageURL || '').toLowerCase();
  const id = (node.HardwareId || node.SensorId || '').toLowerCase();
  if (/cpu\.png/.test(img) || /cpu\//.test(id)) return 'cpu';
  if (/(ati|amd|nvidia|intel)\.png/.test(img) || /\/gpu/.test(id)) return 'gpu';
  if (/ram\.png/.test(img) || /\/ram/.test(id)) return 'memory';
  if (/(hdd|nvme|ssd)\.png/.test(img) || /\/(hdd|nvme|ssd)/.test(id)) return 'storage';
  if (/(mainboard|chip|bigng|lpc)\.png/.test(img) || /\/(lpc|mainboard|motherboard)/.test(id)) return 'board';
  if (/nic\.png/.test(img) || /\/nic/.test(id)) return 'network';
  if (/(battery|psu)\.png/.test(img)) return 'power';
  return null;
}

/** Flatten LHM's tree into sensors with hardware context, then pick headline values. */
export function parseLhm(root) {
  const sensors = [];
  const walk = (node, hw, groupType) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.Children) ? node.Children : [];
    const kind = hardwareKind(node);
    let nextHw = hw;
    if (kind && children.length) nextHw = { kind, name: node.Text, parent: hw };
    const gt = GROUP_TYPES[(node.Text || '').toLowerCase().replace(/\s+/g, '')];
    const isGroup = gt && children.length && !kind;
    if (!children.length && hw && node.Value !== undefined && node.Value !== '') {
      const value = parseValue(node.Value);
      if (value !== null) {
        sensors.push({
          hw: hw.kind,
          hwName: hw.name,
          // Older LHM builds omit Type on leaves and label both Data and SmallData groups "Data".
          type: node.Type || (groupType === 'Data' && /\bMB\b/.test(node.Value) ? 'SmallData' : groupType) || null,
          name: node.Text,
          value,
          max: parseValue(node.Max),
          id: node.SensorId || null,
        });
      }
    }
    for (const c of children) walk(c, nextHw, isGroup ? gt : groupType);
  };
  walk(root, null, null);

  const find = (hw, type, ...names) => {
    const pool = sensors.filter((s) => s.hw === hw && s.type === type);
    for (const n of names) {
      const re = n instanceof RegExp ? n : new RegExp(`^${n}$`, 'i');
      const hit = pool.find((s) => re.test(s.name));
      if (hit) return hit.value;
    }
    return null;
  };

  // Prefer the GPU with the most memory/power reported (the discrete card).
  const gpuNames = [...new Set(sensors.filter((s) => s.hw === 'gpu').map((s) => s.hwName))];
  const gpuScore = (n) => sensors.filter((s) => s.hwName === n && (s.type === 'Power' || s.type === 'Fan' || s.type === 'Temperature')).length;
  const mainGpu = gpuNames.sort((a, b) => gpuScore(b) - gpuScore(a))[0] || null;
  const gpuSensors = sensors.filter((s) => s.hw !== 'gpu' || s.hwName === mainGpu);
  const findGpu = (type, ...names) => {
    const pool = gpuSensors.filter((s) => s.hw === 'gpu' && s.type === type);
    for (const n of names) {
      const re = n instanceof RegExp ? n : new RegExp(`^${n}$`, 'i');
      const hit = pool.find((s) => re.test(s.name));
      if (hit) return hit.value;
    }
    return null;
  };

  const vramUsedMb = findGpu('SmallData', 'GPU Memory Used', /memory used/i);
  const vramTotalMb = findGpu('SmallData', 'GPU Memory Total', /memory total/i);

  return {
    cpu: {
      name: sensors.find((s) => s.hw === 'cpu')?.hwName ?? null,
      temp: find('cpu', 'Temperature', 'Core \\(Tctl/Tdie\\)', 'CPU Package', 'Core \\(Tctl\\)', 'Tctl', 'Tdie', 'Core Average', /package/i, /core/i, /.*/),
      ccdTemps: sensors.filter((s) => s.hw === 'cpu' && s.type === 'Temperature' && /ccd/i.test(s.name)).map((s) => ({ name: s.name, value: s.value })),
      power: find('cpu', 'Power', 'Package', 'CPU Package', /package/i),
      load: find('cpu', 'Load', 'CPU Total'),
      clocks: sensors.filter((s) => s.hw === 'cpu' && s.type === 'Clock' && /core #\d+/i.test(s.name)).map((s) => s.value),
    },
    gpu: mainGpu
      ? {
          name: mainGpu,
          temp: findGpu('Temperature', 'GPU Core', /core/i, /.*/),
          hotspot: findGpu('Temperature', 'GPU Hot Spot', /hot ?spot/i),
          memTemp: findGpu('Temperature', 'GPU Memory', /memory/i),
          load: findGpu('Load', 'GPU Core', /core/i),
          power: findGpu('Power', 'GPU Package', 'GPU Core', /package|total|board/i, /.*/),
          clock: findGpu('Clock', 'GPU Core', /core/i),
          memClock: findGpu('Clock', 'GPU Memory', /memory/i),
          fanRpm: findGpu('Fan', /.*/),
          fanPct: findGpu('Control', /fan/i, /.*/),
          vramUsed: vramUsedMb !== null ? vramUsedMb * 1024 * 1024 : null,
          vramTotal: vramTotalMb !== null ? vramTotalMb * 1024 * 1024 : null,
        }
      : null,
    fans: sensors.filter((s) => s.type === 'Fan' && s.hw !== 'gpu' && s.value > 0).map((s) => ({ name: s.name, rpm: s.value })),
    temps: sensors
      .filter((s) => s.type === 'Temperature' && s.value > 0 && s.value < 150 && !/limit|resolution|threshold|warning|critical/i.test(s.name) && (s.hw !== 'gpu' || s.hwName === mainGpu))
      .sort((a, b) => (HW_ORDER[a.hw] ?? 9) - (HW_ORDER[b.hw] ?? 9))
      .map((s) => ({ hw: s.hw, hwName: s.hwName, name: s.name, value: s.value, max: s.max })),
  };
}
