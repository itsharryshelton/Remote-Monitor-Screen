// Config lives in config.local.json at the repo root (git-ignored). Created on first run
// with a random access key. Delete the file to rotate the key and unpair all devices.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = path.join(ROOT, 'config.local.json');

const DEFAULTS = {
  host: '0.0.0.0',
  port: 7865,
  lhmUrl: 'http://127.0.0.1:8085/data.json',
  claude: {
    enabled: true,
    // "full": prompts, assistant text snippets and command descriptions (secret-redacted).
    // "minimal": tool names and file names only.
    detail: 'full',
    windowMinutes: 45,
  },
  // Only these client ranges may connect (CIDR). Defaults to loopback + private LAN ranges.
  allow: ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'],
  dim: { from: '23:00', to: '07:00', level: 0.35 },
  // Lets a paired device stop a Claude session by dragging it to the office break room
  // (needs the PreToolUse hook from `npm run hooks:install`). false = fully read-only.
  control: true,
};

export function loadConfig() {
  let file = {};
  if (fs.existsSync(CONFIG_FILE)) {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
  let changed = false;
  if (typeof file.key !== 'string' || file.key.length < 32) {
    file.key = crypto.randomBytes(32).toString('base64url');
    changed = true;
  }
  if (changed) {
    const toWrite = { ...structuredClone(DEFAULTS), ...file };
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(toWrite, null, 2)}\n`, { mode: 0o600 });
    file = toWrite;
  }
  const cfg = { ...structuredClone(DEFAULTS), ...file, claude: { ...DEFAULTS.claude, ...(file.claude || {}) }, dim: { ...DEFAULTS.dim, ...(file.dim || {}) } };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.HOST) cfg.host = process.env.HOST;
  return cfg;
}
