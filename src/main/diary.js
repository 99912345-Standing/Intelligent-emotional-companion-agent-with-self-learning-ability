import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { JsonlStore } from './jsonl.js';
import { id, nowIso, truncate } from './utils.js';

/**
 * 本地日记：只写工作目录，不上传。
 * source=ai 表示 AI 主动写；source=user 表示用户手写；两者都可被用户查看/删除。
 */
function sanitizeDiaryText(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/【[^】]{1,30}】/g, '')
    .replace(/(系统提示|系统反馈|工具调用|工具结果|权重|记忆命中|提示词|prompt|token|API Key|persona|multimodal|JSON)\s*[:：]?/gi, '')
    .replace(/\d{1,3}\s*%/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[，,。.\s]+|[，,。.\s]+$/g, '')
    .trim();
}
export class DiaryEngine {
  constructor({ config, logger, emit = () => {} }) {
    this.config = config;
    this.logger = logger;
    this.emit = emit;
    const dir = path.join(paths.data, 'diary');
    fs.mkdirSync(dir, { recursive: true });
    this.store = new JsonlStore(path.join(dir, 'diary.jsonl'), 'diary');
  }

  list(limit = 60) {
    return this.store.all()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(200, Number(limit) || 60)))
      .map((item) => ({
        ...item,
        title: sanitizeDiaryText(item.title) || '无题',
        content: sanitizeDiaryText(item.content)
      }));
  }

  get(entryId) {
    return this.store.get(entryId);
  }

  write({ title = '', content = '', mood = '', tags = [], source = 'ai', channel = 'desktop' } = {}) {
    const text = sanitizeDiaryText(content);
    if (!text) throw new Error('日记内容不能为空');
    const record = {
      id: id('diary'),
      date: new Date().toISOString().slice(0, 10),
      title: truncate(String(title || text.replace(/\s+/g, ' ').slice(0, 36)), 80),
      content: truncate(text, 12000),
      mood: truncate(String(mood || ''), 40),
      tags: Array.isArray(tags) ? tags.map(String).filter(Boolean).slice(0, 8) : [],
      source: source === 'user' ? 'user' : 'ai',
      channel,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      editedBy: null
    };
    this.store.append(record);
    this.logger.info('diary', `日记已写入「${record.title}」`, { source: record.source });
    this.emit('diary:changed', { action: 'add', item: record });
    return record;
  }

  update(entryId, patch = {}) {
    const record = this.get(entryId);
    if (!record) return null;
    const next = this.store.update(entryId, {
      title: patch.title !== undefined ? truncate(String(patch.title), 80) : record.title,
      content: patch.content !== undefined ? truncate(sanitizeDiaryText(patch.content), 12000) : record.content,
      mood: patch.mood !== undefined ? truncate(String(patch.mood), 40) : record.mood,
      tags: Array.isArray(patch.tags) ? patch.tags.map(String).slice(0, 8) : record.tags,
      updatedAt: nowIso(),
      editedBy: 'user'
    });
    this.emit('diary:changed', { action: 'update', item: next });
    return next;
  }

  remove(entryId) {
    const removed = this.store.remove(entryId);
    if (removed) this.emit('diary:changed', { action: 'remove', id: entryId });
    return removed;
  }

  stats() {
    const all = this.store.all();
    return { count: all.length, latest: all[all.length - 1]?.createdAt || null };
  }
}
