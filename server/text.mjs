// Text helpers for anything derived from Claude transcripts before it leaves this machine.

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // Anthropic / OpenAI style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
  /\b[A-Fa-f0-9]{40,}\b/g, // long hex blobs
  /\b[A-Za-z0-9+/_-]{48,}={0,2}/g, // long base64-ish blobs
];

export function redact(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, k, sep) => (typeof k === 'string' && typeof sep === 'string' && /[:=]/.test(sep) ? `${k}${sep}[redacted]` : '[redacted]'));
  }
  return out;
}

export function oneLine(text, max = 160) {
  if (typeof text !== 'string') return '';
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function clean(text, max = 160) {
  return oneLine(redact(text), max);
}

export function basename(p) {
  if (typeof p !== 'string') return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}
