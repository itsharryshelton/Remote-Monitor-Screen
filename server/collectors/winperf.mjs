// Supervises the PowerShell performance-counter sampler and keeps the latest sample.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sampler.ps1');

const VIRTUAL_NIC = /vethernet|hyper-v|loopback|isatap|teredo|wan miniport|bluetooth|kernel debug|virtualbox|vmware|tap-|wireguard|tailscale|zerotier/i;

export class WinPerf {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.latest = null;
    this.adapters = [];
    this.child = null;
    this.stopped = false;
    this.restartDelay = 1000;
  }

  start() {
    if (process.platform !== 'win32') {
      this.log('winperf: not on Windows, GPU/disk/network counters disabled');
      return this;
    }
    this.#spawn();
    return this;
  }

  stop() {
    this.stopped = true;
    this.child?.kill();
  }

  #spawn() {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'adapters') this.adapters = msg.adapters || [];
        else if (msg.type === 'sample') {
          this.latest = msg;
          this.restartDelay = 1000;
        }
      } catch {
        /* ignore partial or non-JSON lines */
      }
    });
    child.stderr.on('data', () => {});
    child.on('exit', (code) => {
      this.child = null;
      if (this.stopped) return;
      this.log(`winperf: sampler exited (${code}), restarting in ${this.restartDelay}ms`);
      setTimeout(() => this.#spawn(), this.restartDelay);
      this.restartDelay = Math.min(this.restartDelay * 2, 30000);
    });
  }

  /** Normalised view of the latest sample, or null if none / stale. */
  read() {
    const s = this.latest;
    if (!s || Date.now() - s.t > 10000) return null;
    return summariseSample(s, this.adapters);
  }
}

export function summariseSample(s, adapters = []) {
  const gpus = Array.isArray(s.gpus) ? s.gpus : s.gpus ? [s.gpus] : [];
  // Primary GPU = adapter using the most dedicated VRAM (the discrete card on most desktops).
  const primary = [...gpus].sort((a, b) => (b.dedicated || 0) - (a.dedicated || 0))[0];
  const biggest = [...adapters].sort((a, b) => (b.vram || 0) - (a.vram || 0))[0];
  const nets = (Array.isArray(s.net) ? s.net : s.net ? [s.net] : []).filter((n) => !VIRTUAL_NIC.test(n.name));
  const kinds = primary?.kinds || {};
  const maxKind = (re) => Math.max(0, ...Object.entries(kinds).filter(([k]) => re.test(k)).map(([, v]) => v));

  return {
    cpu: {
      utility: clamp(s.cpuUtility),
      effectiveMhz: s.cpuBaseMhz && s.cpuPerf ? Math.round((s.cpuBaseMhz * s.cpuPerf) / 100) : null,
      baseMhz: s.cpuBaseMhz ?? null,
      processes: s.processes ?? null,
    },
    gpu: primary
      ? {
          name: biggest?.name ?? null,
          util: clamp(primary.util),
          engines: { d3: clamp(maxKind(/3d/)), compute: clamp(maxKind(/compute/)), video: clamp(maxKind(/video/)), copy: clamp(maxKind(/copy/)) },
          vramUsed: primary.dedicated ?? null,
          vramTotal: biggest?.vram || null,
          sharedUsed: primary.shared ?? null,
        }
      : null,
    disk: { read: s.diskRead ?? 0, write: s.diskWrite ?? 0, busy: clamp(s.diskBusy) },
    net: {
      rx: nets.reduce((a, n) => a + (n.rx || 0), 0),
      tx: nets.reduce((a, n) => a + (n.tx || 0), 0),
      interfaces: nets.filter((n) => n.rx > 0 || n.tx > 0).map((n) => n.name),
    },
  };
}

function clamp(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}
