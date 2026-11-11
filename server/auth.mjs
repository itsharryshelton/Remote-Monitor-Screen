// Device pairing + session cookie. The master key (config.local.json) never leaves this
// machine; devices get an HMAC-derived session token in an HttpOnly cookie.
import crypto from 'node:crypto';

export const COOKIE = 'rms_session';
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

export function deriveToken(key, purpose) {
  return crypto.createHmac('sha256', key).update(`remote-monitor-screen:${purpose}:v1`).digest('base64url');
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class Pairing {
  constructor(key) {
    this.sessionToken = deriveToken(key, 'session');
    this.hookToken = deriveToken(key, 'hook');
    this.fails = new Map(); // ip -> [timestamps]
    this.rotate();
  }

  rotate() {
    this.code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.totalFails = 0;
  }

  cookieHeader() {
    return `${COOKIE}=${this.sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
  }

  isAuthed(req) {
    return safeEqual(parseCookies(req.headers.cookie)[COOKIE], this.sessionToken);
  }

  /** Returns 'ok' | 'bad' | 'locked'. */
  tryCode(ip, code) {
    const now = Date.now();
    const list = (this.fails.get(ip) || []).filter((t) => now - t < FAIL_WINDOW_MS);
    if (list.length >= MAX_FAILS) return 'locked';
    if (safeEqual(String(code || '').trim(), this.code)) {
      this.fails.delete(ip);
      return 'ok';
    }
    list.push(now);
    this.fails.set(ip, list);
    // Too many wrong guesses overall: burn the code so brute force cannot continue.
    if (++this.totalFails >= 20) this.rotate();
    return 'bad';
  }
}
