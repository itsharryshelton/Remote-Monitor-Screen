// Adds (or with --remove, removes) the Notification + Stop hooks in ~/.claude/settings.json
// that let the dashboard show "needs your permission" states, and the PreToolUse hook that lets
// the office break room stop a session. Backs the file up first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAY = path.join(ROOT, 'hooks', 'relay.mjs').replace(/\\/g, '/');
const COMMAND = `node "${RELAY}"`;
const EVENTS = ['Notification', 'Stop', 'PreToolUse'];
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const remove = process.argv.includes('--remove');

const settings = fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) : {};
const backup = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, backup);

settings.hooks ||= {};
const isOurs = (h) => typeof h?.command === 'string' && h.command.includes('hooks/relay.mjs') && h.command.includes(ROOT.replace(/\\/g, '/'));

for (const ev of EVENTS) {
  const groups = (settings.hooks[ev] || [])
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length);
  if (!remove) groups.push({ hooks: [{ type: 'command', command: COMMAND, timeout: 5 }] });
  if (groups.length) settings.hooks[ev] = groups;
  else delete settings.hooks[ev];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
console.log(`${remove ? 'Removed' : 'Installed'} Remote Monitor Screen hooks (${EVENTS.join(', ')}) in ${SETTINGS}`);
if (fs.existsSync(backup)) console.log(`Backup: ${backup}`);
if (!remove) console.log('New Claude Code sessions pick this up automatically; restart open sessions to include them.');
