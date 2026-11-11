import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionState, ClaudeWatcher, promptText, summariseTool } from '../server/collectors/claude.mjs';

const T0 = Date.parse('2026-11-11T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const base = { sessionId: 'S1', cwd: 'D:\\Git\\demo-project', gitBranch: 'main', entrypoint: 'claude-vscode' };

const prompt = (s, text) => ({ ...base, type: 'user', timestamp: at(s), message: { role: 'user', content: text } });
const toolUse = (s, id, name, input, msgId = `m${s}`) => ({
  ...base,
  type: 'assistant',
  timestamp: at(s),
  message: { id: msgId, model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000 } },
});
const result = (s, id, extra = {}) => ({ ...base, type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...extra }] } });
const final = (s, text) => ({ ...base, type: 'assistant', timestamp: at(s), message: { id: `f${s}`, model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 50 } } });

test('session walks working -> done with tool summaries', () => {
  const events = [];
  const s = new SessionState({ onEvent: (e) => events.push(e) });
  s.ingest(prompt(0, 'Fix the login bug'));
  s.ingest(toolUse(5, 't1', 'Bash', { command: 'npm test', description: 'Run unit tests' }));
  let st = s.status(T0 + 20_000);
  assert.equal(st.status, 'working');
  assert.equal(st.text, 'Bash · Run unit tests');

  s.ingest(result(30, 't1'));
  st = s.status(T0 + 31_000);
  assert.equal(st.status, 'working');
  assert.equal(st.text, 'Thinking…');

  s.ingest(final(40, 'All tests pass now.'));
  st = s.status(T0 + 41_000);
  assert.equal(st.status, 'done');
  const v = s.view(T0 + 41_000);
  assert.equal(v.project, 'demo-project');
  assert.equal(v.app, 'VS Code');
  assert.equal(v.lastPrompt.text, 'Fix the login bug');
  assert.equal(v.lastText.text, 'All tests pass now.');
  assert.equal(v.toolCount, 1);
  assert.deepEqual(events.map((e) => e.kind), ['prompt', 'tool', 'done']);
});

test('token usage is counted once per message id', () => {
  const s = new SessionState();
  s.ingest(toolUse(1, 'a', 'Read', { file_path: 'C:\\x\\a.js' }, 'same'));
  s.ingest(toolUse(1, 'b', 'Read', { file_path: 'C:\\x\\b.js' }, 'same'));
  assert.equal(s.tokens.output, 5);
  assert.equal(s.context, 1010);
  assert.equal(s.lastTool.target, 'b.js');
});

test('interrupt and stale handling', () => {
  const s = new SessionState();
  s.ingest(prompt(0, 'go'));
  s.ingest(toolUse(1, 't1', 'Bash', { description: 'long thing' }));
  assert.equal(s.status(T0 + 30 * 60_000).status, 'stale');
  s.ingest(result(2, 't1', { content: '[Request interrupted by user for tool use]', is_error: true }));
  assert.equal(s.status(T0 + 3000).status, 'done');
});

test('hook notification marks attention until newer transcript activity', () => {
  const s = new SessionState();
  s.ingest(toolUse(1, 't1', 'Bash', { description: 'deploy' }));
  const hook = { ts: T0 + 2000, attention: true, message: 'Claude needs your permission to use Bash' };
  assert.equal(s.status(T0 + 3000, hook).status, 'attention');
  s.ingest(result(4, 't1'));
  assert.equal(s.status(T0 + 5000, hook).status, 'working');
});

test('promptText strips harness noise and formats slash commands', () => {
  assert.equal(promptText('<command-name>/goal</command-name><command-args>ship it</command-args>'), '/goal ship it');
  assert.equal(promptText('<local-command-stdout>x</local-command-stdout>'), null);
  assert.equal(promptText('hello <system-reminder>secret context</system-reminder>'), 'hello');
});

test('summariseTool never exposes raw commands in minimal mode and redacts secrets', () => {
  assert.equal(summariseTool('Bash', { command: 'curl -H "Authorization: x"' }, 'minimal').target, '');
  assert.match(summariseTool('Bash', { command: 'export API_KEY=abcd1234efgh' }, 'full').target, /API_KEY=\[redacted\]/);
  assert.equal(summariseTool('mcp__github__create_issue', {}).label, 'github › create_issue');
  assert.equal(summariseTool('WebFetch', { url: 'https://example.com/a?b=c' }).target, 'example.com');
});

test('watcher tails files incrementally and links subagents', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rms-'));
  const proj = path.join(root, 'D--Git-demo');
  fs.mkdirSync(path.join(proj, 'S1', 'subagents'), { recursive: true });
  const now = Date.now();
  const iso = (ms) => new Date(now + ms).toISOString();
  const main = path.join(proj, 'S1.jsonl');
  fs.writeFileSync(main, `${JSON.stringify({ ...prompt(0, 'start'), timestamp: iso(-5000) })}\n`);
  fs.writeFileSync(path.join(proj, 'S1', 'subagents', 'agent-x.jsonl'), `${JSON.stringify({ ...toolUse(0, 'z', 'Grep', { pattern: 'TODO' }), sessionId: 'S1', timestamp: iso(-1000) })}\n`);
  fs.writeFileSync(path.join(proj, 'S1', 'subagents', 'agent-x.meta.json'), JSON.stringify({ description: 'Find TODOs', agentType: 'Explore', finished: false }));

  const w = new ClaudeWatcher({ root, windowMinutes: 60 });
  await w.poll();
  let snap = w.snapshot();
  assert.equal(snap.sessions.length, 1);
  assert.equal(snap.sessions[0].subagents[0].description, 'Find TODOs');
  assert.equal(snap.sessions[0].subagents[0].status, 'working');

  // Append a partial line, then complete it: only whole lines are ingested.
  const line = JSON.stringify({ ...final(0, 'done!'), timestamp: iso(0) });
  fs.appendFileSync(main, line.slice(0, 20));
  await w.poll();
  fs.appendFileSync(main, `${line.slice(20)}\n`);
  await w.poll();
  snap = w.snapshot();
  assert.equal(snap.sessions[0].lastText.text, 'done!');
  // Main turn ended but a subagent is still running.
  assert.equal(snap.sessions[0].status, 'working');
  assert.match(snap.sessions[0].text, /1 agent running/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bench holds a session until its next prompt, and only for known main sessions', () => {
  const w = new ClaudeWatcher({ root: os.tmpdir() });
  const s = new SessionState({});
  s.ingest(prompt(0, 'Long refactor'));
  s.ingest(toolUse(5, 't1', 'Bash', { command: 'npm test' }));
  w.files.set('S1.jsonl', { state: s });

  assert.equal(w.bench('nope', true), false);
  assert.equal(w.isBenched('S1'), false);
  assert.equal(w.bench('S1', true, T0 + 10_000), true);
  assert.equal(w.isBenched('S1'), true);
  assert.equal(w.snapshot(T0 + 11_000).sessions[0].benched, true);

  // A new prompt from you after benching puts it back to work.
  s.ingest(prompt(20, 'Carry on'));
  assert.equal(w.isBenched('S1'), false);

  w.bench('S1', true, T0 + 30_000);
  w.bench('S1', false);
  assert.equal(w.isBenched('S1'), false);
});
