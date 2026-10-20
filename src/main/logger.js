import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { nowIso, redact } from './utils.js';

export class Logger {
  constructor({ onEntry } = {}) {
    this.onEntry = onEntry;
    this.ring = [];
    fs.mkdirSync(paths.logs, { recursive: true });
    this.file = path.join(paths.logs, `app-${new Date().toISOString().slice(0, 10)}.log`);
  }

  write(level, scope, message, detail = null) {
    const entry = {
      at: nowIso(),
      level,
      scope,
      message: redact(message),
      detail: detail ? redact(typeof detail === 'string' ? detail : JSON.stringify(detail)) : null
    };
    this.ring.push(entry);
    if (this.ring.length > 400) this.ring.shift();
    const line = `[${entry.at}] [${level.toUpperCase()}] [${scope}] ${entry.message}${entry.detail ? ` ${entry.detail}` : ''}\n`;
    try {
      fs.appendFileSync(this.file, line, 'utf8');
    } catch {}
    try { this.onEntry?.(entry); } catch {}
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(`[${scope}] ${entry.message}`);
    return entry;
  }

  info(scope, message, detail) { return this.write('info', scope, message, detail); }
  warn(scope, message, detail) { return this.write('warn', scope, message, detail); }
  error(scope, message, detail) { return this.write('error', scope, message, detail); }

  recent(limit = 120) {
    return this.ring.slice(-limit).reverse();
  }
}
