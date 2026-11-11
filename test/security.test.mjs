import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inCidr, allowed } from '../server/net.mjs';
import { redact } from '../server/text.mjs';
import { Pairing, deriveToken } from '../server/auth.mjs';

const LAN = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'];

test('CIDR allow-list', () => {
  assert.ok(allowed('10.0.100.25', LAN));
  assert.ok(allowed('::ffff:192.168.1.20', LAN));
  assert.ok(allowed('::1', LAN));
  assert.ok(allowed('fe80::1%12', LAN));
  assert.ok(!allowed('8.8.8.8', LAN));
  assert.ok(!allowed('172.32.0.1', LAN));
  assert.ok(!allowed('2001:4860::1', LAN));
  assert.ok(inCidr('172.31.255.255', '172.16.0.0/12'));
});

test('redact masks common secret shapes', () => {
  const out = redact('key sk-ant-api03-abcdefghijklmnopqrstu and ghp_abcdefghijklmnopqrstuvwxyz123456 password=hunter2 AKIAABCDEFGHIJKLMNOP');
  assert.ok(!out.includes('abcdefghijklmnopqrstu'));
  assert.ok(!out.includes('ghp_'));
  assert.ok(!out.includes('hunter2'));
  assert.ok(!out.includes('AKIA'));
  assert.equal(redact('Run unit tests'), 'Run unit tests');
});

test('pairing rate limits per IP and burns the code after many failures', () => {
  const p = new Pairing('k'.repeat(43));
  for (let i = 0; i < 5; i++) assert.equal(p.tryCode('10.0.0.9', 'nope'), 'bad');
  assert.equal(p.tryCode('10.0.0.9', p.code), 'locked');
  assert.equal(p.tryCode('10.0.0.8', p.code), 'ok');
  const before = p.code;
  for (let i = 0; i < 20; i++) p.tryCode(`10.0.1.${i}`, 'nope');
  assert.notEqual(p.code, before);
});

test('session and hook tokens differ and are derived from the key', () => {
  assert.notEqual(deriveToken('a', 'session'), deriveToken('a', 'hook'));
  assert.notEqual(deriveToken('a', 'session'), deriveToken('b', 'session'));
});
