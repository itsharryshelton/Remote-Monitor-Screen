// Read-only watcher for Claude Code sessions (VS Code extension and CLI share the same
// on-disk transcripts in ~/.claude/projects/<project>/<sessionId>.jsonl, with subagents in
// <sessionId>/subagents/agent-*.jsonl + .meta.json). Optionally enriched by hook events.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { clean, basename, oneLine } from '../text.mjs';

const MAX_INITIAL_BYTES = 4 * 1024 * 1024;
const THINKING_GRACE_MS = 3 * 60 * 1000;
const TOOL_STALE_MS = 20 * 60 * 1000;
const MAX_EVENTS = 80;

const ENTRYPOINTS = { 'claude-vscode': 'VS Code', cli: 'CLI', 'claude-desktop': 'Desktop', 'sdk-ts': 'SDK', 'sdk-py': 'SDK', 'sdk-cli': 'SDK' };

/** Short, non-sensitive description of a tool call. */
export function summariseTool(name, input = {}, detail = 'full') {
  const i = input && typeof input === 'object' ? input : {};
  const full = detail === 'full';
  if (name?.startsWith('mcp__')) {
    const [, server, tool] = name.split('__');
    return { name: tool || name, label: `${server} › ${tool}`, target: '' };
  }
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { name, target: i.description ? clean(i.description, 90) : full ? clean(i.command, 90) : '' };
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { name, target: basename(i.file_path || i.notebook_path) };
    case 'Grep':
      return { name, target: full ? clean(i.pattern, 60) : '' };
    case 'Glob':
      return { name, target: clean(i.pattern, 60) };
    case 'WebFetch':
      try {
        return { name, target: new URL(i.url).hostname };
      } catch {
        return { name, target: '' };
      }
    case 'WebSearch':
      return { name, target: full ? clean(i.query, 80) : '' };
    case 'Agent':
    case 'Task':
      return { name: 'Agent', target: clean(i.description || i.subagent_type || '', 80) };
    case 'Skill':
      return { name, target: clean(i.skill || i.name || '', 60) };
    case 'TodoWrite':
      return { name, target: Array.isArray(i.todos) ? `${i.todos.length} todos` : '' };
    default:
      return { name, target: full && typeof i.description === 'string' ? clean(i.description, 80) : '' };
  }
}

/** Turn a raw user prompt into something displayable, or null if it is harness noise. */
export function promptText(raw) {
  if (typeof raw !== 'string') return null;
  const cmd = raw.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) {
    const args = raw.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '';
    return `${cmd[1].trim()} ${args.trim()}`.trim();
  }
  if (/^\s*<(local-command|bash-stdout|bash-stderr|task-notification)/.test(raw)) return null;
  const stripped = raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, '')
    .replace(/<\/?[a-z_-]+(\s[^>]*)?>/g, '')
    .trim();
  return stripped || null;
}

/** State for one transcript file. Pure: feed entries via ingest(), read via view(). */
export class SessionState {
  constructor({ file = null, kind = 'main', detail = 'full', onEvent = () => {} } = {}) {
    this.file = file;
    this.kind = kind;
    this.detail = detail;
    this.onEvent = onEvent;
    this.sessionId = null;
    this.cwd = null;
    this.branch = null;
    this.entrypoint = null;
    this.model = null;
    this.title = null;
    this.firstActivity = null;
    this.lastActivity = null;
    this.lastPrompt = null;
    this.lastText = null;
    this.lastTool = null;
    this.pending = new Map();
    this.turnEnded = false;
    this.toolCount = 0;
    this.promptCount = 0;
    this.errorCount = 0;
    this.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    this.context = null;
    this.todos = null;
    this.seenMessages = new Set();
    this.meta = null; // subagent meta.json
    this.subagents = new Map();
  }

  emit(kind, text, ts) {
    this.onEvent({ ts: ts ?? this.lastActivity ?? Date.now(), kind, text, session: this });
  }

  ingest(e) {
    if (!e || typeof e !== 'object') return;
    const ts = Date.parse(e.timestamp);
    if (Number.isFinite(ts)) {
      if (!this.lastActivity || ts > this.lastActivity) this.lastActivity = ts;
      if (!this.firstActivity || ts < this.firstActivity) this.firstActivity = ts;
    }
    if (e.sessionId) this.sessionId = e.sessionId;
    if (e.cwd) this.cwd = e.cwd;
    if (e.gitBranch) this.branch = e.gitBranch;
    if (e.entrypoint) this.entrypoint = e.entrypoint;
    if (typeof e.customTitle === 'string') this.title = oneLine(e.customTitle, 80);
    else if (e.type === 'summary' && typeof e.summary === 'string' && !this.title) this.title = oneLine(e.summary, 80);
    else if (/title/i.test(e.type || '') && typeof e.title === 'string') this.title = oneLine(e.title, 80);

    if (e.type === 'user') this.#user(e, ts);
    else if (e.type === 'assistant') this.#assistant(e, ts);
    else if (e.type === 'system' && e.subtype === 'compact_boundary') this.emit('info', 'Context compacted', ts);
  }

  #user(e, ts) {
    if (e.isMeta || e.isCompactSummary) return;
    const c = e.message?.content;
    if (typeof c === 'string') return this.#prompt(c, ts);
    if (!Array.isArray(c)) return;
    let hadResult = false;
    for (const b of c) {
      if (b?.type === 'tool_result') {
        hadResult = true;
        const p = this.pending.get(b.tool_use_id);
        this.pending.delete(b.tool_use_id);
        const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x?.text || '').join(' ') : '';
        if (/^\[Request interrupted/.test(text)) this.#interrupted(ts);
        else if (b.is_error) {
          this.errorCount++;
          if (this.lastTool && p && this.lastTool.id === b.tool_use_id) this.lastTool.error = true;
          if (p && !/denied|rejected|doesn't want/i.test(text)) this.emit('error', `${p.name} failed${p.target ? `: ${p.target}` : ''}`, ts);
          else if (p) this.emit('error', `${p.name} denied`, ts);
        }
      }
    }
    if (!hadResult) {
      const text = c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
      if (text) this.#prompt(text, ts);
    }
  }

  #prompt(raw, ts) {
    if (/^\s*\[Request interrupted/.test(raw)) return this.#interrupted(ts);
    const text = promptText(raw);
    if (!text) return;
    this.pending.clear();
    this.turnEnded = false;
    this.promptCount++;
    this.lastPrompt = { text: clean(text, 200), ts };
    this.emit('prompt', this.detail === 'full' ? clean(text, 120) : 'New prompt', ts);
  }

  #interrupted(ts) {
    this.pending.clear();
    this.turnEnded = true;
    this.emit('info', 'Interrupted by user', ts);
  }

  #assistant(e, ts) {
    const m = e.message;
    if (!m) return;
    if (m.model && m.model !== '<synthetic>') this.model = m.model;
    if (m.usage) {
      const u = m.usage;
      if (!m.id || !this.seenMessages.has(m.id)) {
        if (m.id) this.seenMessages.add(m.id);
        this.tokens.input += u.input_tokens || 0;
        this.tokens.output += u.output_tokens || 0;
        this.tokens.cacheRead += u.cache_read_input_tokens || 0;
        this.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
      }
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (ctx > 0) this.context = ctx;
    }
    const blocks = Array.isArray(m.content) ? m.content : [];
    let hasTool = false;
    for (const b of blocks) {
      if (b?.type === 'text' && b.text?.trim()) {
        this.lastText = { text: clean(b.text, 220), ts };
      } else if (b?.type === 'tool_use') {
        hasTool = true;
        const s = summariseTool(b.name, b.input, this.detail);
        const call = { id: b.id, name: s.name, label: s.label || s.name, target: s.target, ts };
        this.pending.set(b.id, call);
        this.lastTool = call;
        this.toolCount++;
        if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) this.#todos(b.input.todos);
        this.emit(s.name === 'Agent' ? 'agent' : 'tool', `${call.label}${call.target ? ` · ${call.target}` : ''}`, ts);
      }
    }
    if (hasTool) this.turnEnded = false;
    else if (m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence' || m.stop_reason === 'max_tokens' || m.stop_reason === 'refusal') {
      this.turnEnded = true;
      this.pending.clear();
      if (this.kind === 'main') this.emit('done', this.detail === 'full' && this.lastText ? this.lastText.text : 'Turn complete', ts);
    }
    if (e.isApiErrorMessage) {
      this.errorCount++;
      this.emit('error', 'API error', ts);
    }
  }

  #todos(todos) {
    const done = todos.filter((t) => t.status === 'completed').length;
    const active = todos.find((t) => t.status === 'in_progress');
    this.todos = { total: todos.length, done, active: active ? clean(active.activeForm || active.content, 90) : null };
  }

  /** Derive display status. hook = latest hook event for this session (optional). */
  status(now = Date.now(), hook = null) {
    const last = this.lastActivity || 0;
    if (this.kind === 'sub' && this.meta?.finished) return { status: 'done', text: 'Finished' };
    if (hook && hook.ts > last && hook.attention) return { status: 'attention', text: hook.message || 'Needs your input' };
    if (this.pending.size) {
      const oldest = Math.min(...[...this.pending.values()].map((p) => p.ts || now));
      const call = [...this.pending.values()].pop();
      if (now - oldest < TOOL_STALE_MS) return { status: 'working', text: `${call.label}${call.target ? ` · ${call.target}` : ''}`, since: oldest, tool: call.name };
      return { status: 'stale', text: `Stuck on ${call.label}?`, since: oldest };
    }
    if (!this.turnEnded && now - last < THINKING_GRACE_MS) return { status: 'working', text: 'Thinking…', since: last };
    if (this.turnEnded) return { status: 'done', text: this.kind === 'sub' ? 'Finished' : 'Waiting for you', since: last };
    return { status: 'stale', text: 'Inactive', since: last };
  }

  view(now = Date.now(), hook = null) {
    const st = this.status(now, hook);
    const full = this.detail === 'full';
    return {
      id: this.sessionId,
      // Subagent transcripts carry the parent's sessionId, so the file name is the stable unique key.
      key: this.kind === 'sub' && this.file ? path.basename(this.file, '.jsonl') : this.sessionId,
      kind: this.kind,
      project: basename(this.cwd) || null,
      title: this.title,
      description: this.meta?.description ? clean(this.meta.description, 90) : null,
      agentType: this.meta?.agentType ?? null,
      branch: this.branch,
      app: ENTRYPOINTS[this.entrypoint] || this.entrypoint || null,
      model: this.model,
      ...st,
      firstActivity: this.firstActivity,
      lastActivity: this.lastActivity,
      lastTool: this.lastTool ? { name: this.lastTool.label, target: this.lastTool.target, ts: this.lastTool.ts, error: !!this.lastTool.error } : null,
      lastPrompt: full ? this.lastPrompt : null,
      lastText: full ? this.lastText : null,
      toolCount: this.toolCount,
      promptCount: this.promptCount,
      errorCount: this.errorCount,
      tokens: { ...this.tokens },
      context: this.context,
      todos: this.todos,
    };
  }
}

export class ClaudeWatcher {
  constructor({ root = path.join(os.homedir(), '.claude', 'projects'), windowMinutes = 240, detail = 'full', log = () => {} } = {}) {
    this.root = root;
    this.windowMs = windowMinutes * 60 * 1000;
    this.detail = detail;
    this.log = log;
    this.files = new Map(); // file path -> { state, offset, partial, mtime, parent }
    this.hooks = new Map(); // sessionId -> latest hook info
    this.benches = new Map(); // sessionId -> when it was sent to the break room
    this.events = [];
    this.lastScan = 0;
    this.busy = false;
  }

  start() {
    const loop = async () => {
      if (!this.busy) {
        this.busy = true;
        try {
          await this.poll();
        } catch (err) {
          this.log(`claude: poll failed: ${err.message}`);
        }
        this.busy = false;
      }
      this.timer = setTimeout(loop, 1500);
    };
    loop();
    return this;
  }

  stop() {
    clearTimeout(this.timer);
  }

  #onEvent = (ev) => {
    if (ev.ts < Date.now() - this.windowMs) return;
    const s = ev.session;
    this.events.push({
      ts: ev.ts,
      kind: ev.kind,
      text: ev.text,
      sessionId: s.sessionId,
      project: basename(s.cwd) || null,
      sub: s.kind === 'sub' ? s.meta?.description || 'subagent' : null,
    });
    if (this.events.length > MAX_EVENTS * 2) this.#trimEvents();
  };

  #trimEvents() {
    this.events.sort((a, b) => a.ts - b.ts);
    this.events = this.events.slice(-MAX_EVENTS);
  }

  async poll() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    if (now - this.lastScan > 10000) {
      this.lastScan = now;
      await this.#discover(cutoff);
    }
    for (const [file, t] of this.files) {
      let st;
      try {
        st = await fs.stat(file);
      } catch {
        this.files.delete(file);
        continue;
      }
      if (st.mtimeMs < cutoff) {
        this.files.delete(file);
        continue;
      }
      if (st.size !== t.offset) await this.#read(file, t, st.size);
      if (t.metaFile && st.mtimeMs !== t.metaMtime) {
        t.metaMtime = st.mtimeMs;
        await this.#readMeta(t);
      }
    }
  }

  async #discover(cutoff) {
    let dirs;
    try {
      dirs = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(this.root, d.name);
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of entries) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const file = path.join(dir, f.name);
        if (this.files.has(file)) continue;
        try {
          const st = await fs.stat(file);
          if (st.mtimeMs >= cutoff) this.#track(file, 'main', null);
        } catch {
          /* vanished */
        }
      }
    }
    // Subagents of tracked sessions.
    for (const [file, t] of [...this.files]) {
      if (t.state.kind !== 'main') continue;
      const subDir = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
      let subs;
      try {
        subs = await fs.readdir(subDir);
      } catch {
        continue;
      }
      for (const name of subs) {
        if (!name.endsWith('.jsonl')) continue;
        const sf = path.join(subDir, name);
        const known = this.files.get(sf);
        if (known) {
          // meta.json gets "finished" written separately from the transcript.
          if (!known.state.meta?.finished) await this.#readMeta(known);
          continue;
        }
        try {
          const st = await fs.stat(sf);
          if (st.mtimeMs >= cutoff) {
            const sub = this.#track(sf, 'sub', file);
            sub.metaFile = sf.replace(/\.jsonl$/, '.meta.json');
          }
        } catch {
          /* vanished */
        }
      }
    }
  }

  #track(file, kind, parentFile) {
    const state = new SessionState({ file, kind, detail: this.detail, onEvent: this.#onEvent });
    const t = { state, offset: 0, partial: '', parentFile, metaFile: null, metaMtime: 0 };
    this.files.set(file, t);
    return t;
  }

  async #readMeta(t) {
    try {
      t.state.meta = JSON.parse(await fs.readFile(t.metaFile, 'utf8'));
    } catch {
      /* not written yet */
    }
  }

  async #read(file, t, size) {
    if (size < t.offset) {
      // File was rewritten; start over.
      const fresh = this.#track(file, t.state.kind, t.parentFile);
      fresh.metaFile = t.metaFile;
      t = fresh;
    }
    if (t.metaFile && !t.state.meta) await this.#readMeta(t);
    let start = t.offset;
    let skipFirst = false;
    if (start === 0 && size > MAX_INITIAL_BYTES) {
      start = size - MAX_INITIAL_BYTES;
      skipFirst = true;
    }
    const fh = await fs.open(file, 'r');
    try {
      const len = size - start;
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, start);
      t.offset = start + bytesRead;
      let text = t.partial + buf.subarray(0, bytesRead).toString('utf8');
      const lines = text.split('\n');
      t.partial = lines.pop() ?? '';
      if (skipFirst) lines.shift();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          t.state.ingest(JSON.parse(line));
        } catch {
          /* ignore malformed line */
        }
      }
    } finally {
      await fh.close();
    }
  }

  /** Called by the hook relay endpoint. */
  hook(payload) {
    const id = payload?.session_id;
    if (!id) return;
    const event = payload.hook_event_name;
    const ntype = payload.notification_type || '';
    const message = typeof payload.message === 'string' ? clean(payload.message, 140) : null;
    const attention = event === 'Notification' && ntype !== 'idle_prompt' && !/waiting for your input/i.test(message || '');
    const info = { ts: Date.now(), event, message, attention };
    this.hooks.set(id, info);
    if (attention) {
      const t = [...this.files.values()].find((x) => x.state.sessionId === id && x.state.kind === 'main');
      if (t) t.state.emit('attention', message || 'Needs your input', info.ts);
    }
  }

  #mainState(sessionId) {
    for (const t of this.files.values()) if (t.state.kind === 'main' && t.state.sessionId === sessionId) return t.state;
    return null;
  }

  /** Send a main session to the break room (it stops at its next tool call), or bring it back. */
  bench(sessionId, on, now = Date.now()) {
    if (typeof sessionId !== 'string' || !this.#mainState(sessionId)) return false;
    if (on) this.benches.set(sessionId, now);
    else this.benches.delete(sessionId);
    return true;
  }

  /** Benched until the next prompt you send it. */
  isBenched(sessionId) {
    const at = this.benches.get(sessionId);
    if (!at) return false;
    const prompt = this.#mainState(sessionId)?.lastPrompt?.ts;
    if (prompt && prompt > at) {
      this.benches.delete(sessionId);
      return false;
    }
    return true;
  }

  snapshot(now = Date.now()) {
    const cutoff = now - this.windowMs;
    const mains = new Map();
    const subs = [];
    for (const [file, t] of this.files) {
      const s = t.state;
      if (!s.lastActivity || s.lastActivity < cutoff) continue;
      if (s.kind === 'main') mains.set(file, { view: s.view(now, this.hooks.get(s.sessionId)), subs: [] });
      else subs.push(t);
    }
    for (const t of subs) {
      const parent = mains.get(t.parentFile);
      if (parent) parent.subs.push(t.state.view(now));
    }
    const rank = { attention: 0, working: 1, done: 2, stale: 3 };
    const sessions = [...mains.values()].map(({ view, subs }) => {
      subs.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.lastActivity - a.lastActivity));
      const running = subs.filter((s) => s.status === 'working').length;
      // Background subagents keep a session "working" after the main turn has ended.
      if (running && (view.status === 'done' || view.status === 'stale')) {
        view.status = 'working';
        view.text = `${running} agent${running > 1 ? 's' : ''} running`;
        view.since = Math.min(...subs.filter((s) => s.status === 'working').map((s) => s.since || now));
      }
      return { ...view, benched: this.isBenched(view.id), subagents: subs, runningSubagents: running };
    });
    sessions.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.lastActivity - a.lastActivity));
    this.#trimEvents();
    const events = this.events.filter((e) => e.ts >= cutoff).slice(-40).reverse();
    return {
      t: now,
      sessions,
      events,
      counts: {
        working: sessions.filter((s) => s.status === 'working').length,
        attention: sessions.filter((s) => s.status === 'attention').length,
        done: sessions.filter((s) => s.status === 'done').length,
        agents: sessions.reduce((a, s) => a + s.runningSubagents, 0),
      },
      hooksSeen: this.hooks.size > 0,
    };
  }
}
