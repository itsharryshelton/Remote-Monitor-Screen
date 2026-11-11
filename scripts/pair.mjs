// Prints how to pair a device with the running server.
import { loadConfig } from '../server/config.mjs';
import { deriveToken } from '../server/auth.mjs';
import { lanAddresses } from '../server/net.mjs';

const cfg = loadConfig();
const hookToken = deriveToken(cfg.key, 'hook');
const session = deriveToken(cfg.key, 'session');
const addrs = lanAddresses().filter((a) => !a.virtual);

let code = null;
try {
  const r = await fetch(`http://127.0.0.1:${cfg.port}/api/pair-code`, { headers: { 'x-monitor-key': hookToken }, signal: AbortSignal.timeout(2000) });
  if (r.ok) code = (await r.json()).code;
} catch {
  /* server not running */
}

console.log('');
if (code) {
  console.log(`  Pairing code: ${code}`);
  console.log('  On the phone, open one of these and type the code:');
  for (const a of addrs) console.log(`    http://${a.address}:${cfg.port}`);
} else {
  console.log('  Server is not running. Start it with "npm start" first.');
}
console.log('');
console.log('  One-tap link (pairs without the code). Treat it like a password, do not share it:');
for (const a of addrs) console.log(`    http://${a.address}:${cfg.port}/pair?k=${session}`);
console.log('');
console.log('  To unpair every device, stop the server, delete config.local.json and start again.');
console.log('');
