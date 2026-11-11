// Small IP helpers: CIDR allow-list matching (IPv4 + IPv6, incl. IPv4-mapped IPv6).
import net from 'node:net';
import os from 'node:os';

function v4ToBig(ip) {
  return ip.split('.').reduce((a, o) => (a << 8n) + BigInt(Number(o)), 0n);
}

function v6ToBig(ip) {
  let [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  // Embedded IPv4 in the last group (e.g. ::ffff:10.0.0.1)
  const fix = (arr) => {
    const last = arr[arr.length - 1];
    if (last && last.includes('.')) {
      const n = v4ToBig(last);
      arr.splice(arr.length - 1, 1, ((n >> 16n) & 0xffffn).toString(16), (n & 0xffffn).toString(16));
    }
    return arr;
  };
  fix(h);
  fix(t);
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g || '0', 16)), 0n);
}

export function normaliseIp(ip) {
  if (!ip) return '';
  const s = ip.replace(/%.*$/, '');
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : s;
}

export function inCidr(ip, cidr) {
  const addr = normaliseIp(ip);
  const [range, bitsStr] = cidr.split('/');
  const fam = net.isIP(addr);
  if (!fam || fam !== net.isIP(range)) return false;
  const width = fam === 4 ? 32 : 128;
  const bits = bitsStr === undefined ? width : Number(bitsStr);
  const toBig = fam === 4 ? v4ToBig : v6ToBig;
  const shift = BigInt(width - bits);
  return toBig(addr) >> shift === toBig(range) >> shift;
}

export function allowed(ip, list) {
  return list.some((c) => inCidr(ip, c));
}

export function isLoopback(ip) {
  return inCidr(ip, '127.0.0.0/8') || inCidr(ip, '::1/128');
}

export function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        out.push({ name, address: a.address, virtual: /vethernet|virtual|vmware|hyper-v|wsl|docker|tailscale|zerotier/i.test(name) });
      }
    }
  }
  return out.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}
