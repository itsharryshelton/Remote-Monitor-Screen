// Combines Node's os module, Windows perf counters and (optionally) LibreHardwareMonitor
// into one snapshot shape consumed by the dashboard.
import os from 'node:os';

export class SystemStats {
  constructor({ winperf, lhm }) {
    this.winperf = winperf;
    this.lhm = lhm;
    this.prevCpus = os.cpus();
    this.cores = this.prevCpus.map(() => 0);
    this.total = 0;
    this.cpuModel = (this.prevCpus[0]?.model || '').trim();
    this.timer = setInterval(() => this.#sampleCpu(), 1000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  #sampleCpu() {
    const now = os.cpus();
    let busyAll = 0;
    let totalAll = 0;
    this.cores = now.map((c, i) => {
      const p = this.prevCpus[i]?.times;
      if (!p) return 0;
      const t = c.times;
      const idle = t.idle - p.idle;
      const total = t.user - p.user + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + idle;
      busyAll += total - idle;
      totalAll += total;
      return total > 0 ? Math.round(((total - idle) / total) * 1000) / 10 : 0;
    });
    this.total = totalAll > 0 ? (busyAll / totalAll) * 100 : 0;
    this.prevCpus = now;
  }

  snapshot() {
    const perf = this.winperf?.read() ?? null;
    const hw = this.lhm?.read() ?? null;
    const memTotal = os.totalmem();
    const memFree = os.freemem();

    const gpuPerf = perf?.gpu ?? null;
    const gpuHw = hw?.gpu ?? null;
    const gpu =
      gpuPerf || gpuHw
        ? {
            name: gpuHw?.name || gpuPerf?.name || null,
            util: gpuPerf?.util ?? gpuHw?.load ?? null,
            engines: gpuPerf?.engines ?? null,
            vramUsed: gpuHw?.vramUsed ?? gpuPerf?.vramUsed ?? null,
            vramTotal: gpuHw?.vramTotal ?? gpuPerf?.vramTotal ?? null,
            temp: gpuHw?.temp ?? null,
            hotspot: gpuHw?.hotspot ?? null,
            memTemp: gpuHw?.memTemp ?? null,
            power: gpuHw?.power ?? null,
            clock: gpuHw?.clock ?? null,
            fanRpm: gpuHw?.fanRpm ?? null,
            fanPct: gpuHw?.fanPct ?? null,
          }
        : null;

    return {
      t: Date.now(),
      host: os.hostname(),
      uptime: os.uptime(),
      cpu: {
        name: hw?.cpu?.name || this.cpuModel,
        // Perf counter "% Processor Utility" matches Task Manager; fall back to os.cpus() deltas.
        util: perf?.cpu?.utility ?? round1(this.total),
        cores: this.cores,
        mhz: perf?.cpu?.effectiveMhz ?? null,
        temp: hw?.cpu?.temp ?? null,
        ccdTemps: hw?.cpu?.ccdTemps ?? [],
        power: hw?.cpu?.power ?? null,
        processes: perf?.cpu?.processes ?? null,
      },
      gpu,
      mem: { total: memTotal, used: memTotal - memFree },
      disk: perf?.disk ?? null,
      net: perf?.net ?? null,
      fans: hw?.fans ?? [],
      temps: hw?.temps ?? [],
      sources: { perfCounters: !!perf, lhm: !!hw },
    };
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
