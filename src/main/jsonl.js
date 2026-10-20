import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteText } from './utils.js';

/**
 * 轻量 JSONL 持久层。
 * 每条记忆独立成行，损坏的单行会被跳过；重写时保留 .bak 备份。
 */
export class JsonlStore {
  constructor(filePath, label = 'store') {
    this.file = filePath;
    this.label = label;
    this.items = [];
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.load();
  }

  load() {
    this.items = [];
    if (!fs.existsSync(this.file)) return this.items;
    let text = '';
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return this.items;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item && typeof item === 'object') this.items.push(item);
      } catch {}
    }
    return this.items;
  }

  all() {
    return [...this.items];
  }

  count() {
    return this.items.length;
  }

  get(itemId) {
    return this.items.find((item) => String(item.id) === String(itemId)) || null;
  }

  append(item) {
    this.items.push(item);
    fs.appendFileSync(this.file, `${JSON.stringify(item)}\n`, 'utf8');
    return item;
  }

  update(itemId, patch) {
    const index = this.items.findIndex((item) => String(item.id) === String(itemId));
    if (index < 0) return null;
    const next = typeof patch === 'function' ? patch(this.items[index]) : { ...this.items[index], ...patch };
    this.items[index] = next;
    this.flush();
    return next;
  }

  remove(itemId) {
    const index = this.items.findIndex((item) => String(item.id) === String(itemId));
    if (index < 0) return false;
    this.items.splice(index, 1);
    this.flush();
    return true;
  }

  replaceAll(items) {
    this.items = items;
    this.flush();
  }

  flush() {
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    } catch {}
    const text = this.items.map((item) => JSON.stringify(item)).join('\n');
    atomicWriteText(this.file, text ? `${text}\n` : '');
  }

  filter(fn) {
    return this.items.filter(fn);
  }
}
