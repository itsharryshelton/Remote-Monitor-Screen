#!/usr/bin/env node
// Claude Code hook -> Remote Monitor Screen relay.
// Reads the hook JSON from stdin and forwards a trimmed copy to the local server.
// Never fails Claude: short timeout, always exits 0. Prints nothing, except on PreToolUse for a
// session you sent to the office break room, where it tells Claude Code to stop.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const done = () => process.exit(0);
setTimeout(done, 1500).unref();

try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.local.json'), 'utf8'));
  const token = crypto.createHmac('sha256', cfg.key).update('remote-monitor-screen:hook:v1').digest('base64url');
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => {
    raw += c;
    if (raw.length > 256 * 1024) done();
  });
  process.stdin.on('end', async () => {
    try {
      const h = JSON.parse(raw || '{}');
      // Only forward what the dashboard needs, not tool inputs or transcript contents.
      const body = JSON.stringify({
        session_id: h.session_id,
        hook_event_name: h.hook_event_name,
        notification_type: h.notification_type,
        message: typeof h.message === 'string' ? h.message.slice(0, 300) : undefined,
      });
      const r = await fetch(`http://127.0.0.1:${cfg.port || 7865}/api/hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-monitor-key': token },
        body,
        signal: AbortSignal.timeout(800),
      });
      if (h.hook_event_name === 'PreToolUse' && r.ok) {
        const reply = await r.json().catch(() => null);
        if (reply?.stop) {
          const reason = 'Sent to the break room from Remote Monitor Screen. Send a new prompt to resume.';
          const out = JSON.stringify({
            continue: false,
            stopReason: reason,
            hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
          });
          return process.stdout.write(out, done);
        }
      }
    } catch {
      /* server not running: ignore */
    }
    done();
  });
} catch {
  done();
}
