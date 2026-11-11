import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLhm, parseValue } from '../server/collectors/lhm.mjs';
import { summariseSample } from '../server/collectors/winperf.mjs';

test('parseValue handles LHM unit strings and locales', () => {
  assert.equal(parseValue('45.4 °C'), 45.4);
  assert.equal(parseValue('45,4 °C'), 45.4);
  assert.equal(parseValue('4,850.2 MHz'), 4850.2);
  assert.equal(parseValue('4.850,2 MHz'), 4850.2);
  assert.equal(parseValue('1,021 RPM'), 1021);
  assert.equal(parseValue('0,5 V'), 0.5);
  assert.equal(parseValue(''), null);
  assert.equal(parseValue('Value'), null);
});

test('parseLhm picks CPU/GPU headline sensors and ignores the iGPU', () => {
  const r = parseLhm(JSON.parse(fs.readFileSync(new URL('./fixtures/lhm.json', import.meta.url), 'utf8')));
  assert.equal(r.cpu.name, 'AMD Ryzen 7 7800X3D');
  assert.equal(r.cpu.temp, 62.4);
  assert.equal(r.cpu.power, 48.3);
  assert.deepEqual(r.cpu.ccdTemps, [{ name: 'CCD1 (Tdie)', value: 58 }]);
  assert.equal(r.gpu.name, 'AMD Radeon RX 6900 XT');
  assert.equal(r.gpu.temp, 55);
  assert.equal(r.gpu.hotspot, 68);
  assert.equal(r.gpu.power, 121);
  assert.equal(r.gpu.fanRpm, 1200);
  assert.equal(r.gpu.vramUsed, 4812 * 1024 * 1024);
  assert.equal(r.gpu.vramTotal, 16368 * 1024 * 1024);
  assert.deepEqual(r.fans, [{ name: 'Fan #1', rpm: 1021 }]);
  assert.ok(r.temps.some((t) => t.name === 'Motherboard' && t.value === 34.5));
});

test('summariseSample chooses the GPU using most VRAM and drops virtual NICs', () => {
  const s = summariseSample(
    {
      t: Date.now(),
      cpuUtility: 120,
      cpuPerf: 110,
      cpuBaseMhz: 4200,
      gpus: [
        { luid: 'a', util: 1, dedicated: 100, kinds: { '3d': 1 } },
        { luid: 'b', util: 42, dedicated: 5e9, kinds: { '3d': 42, 'video decode': 7 } },
      ],
      net: [
        { name: 'realtek ethernet', rx: 1000, tx: 10 },
        { name: 'vEthernet (Default Switch)', rx: 999999, tx: 999999 },
      ],
    },
    [{ name: 'iGPU', vram: 5e8 }, { name: 'Big GPU', vram: 16e9 }],
  );
  assert.equal(s.cpu.utility, 100);
  assert.equal(s.cpu.effectiveMhz, 4620);
  assert.equal(s.gpu.util, 42);
  assert.equal(s.gpu.name, 'Big GPU');
  assert.equal(s.gpu.engines.video, 7);
  assert.equal(s.net.rx, 1000);
});
