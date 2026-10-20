import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { atomicWriteJson, id, nowIso, readJson, truncate } from './utils.js';

/**
 * 会话仓库：桌面主对话与每个 QQ 会话彼此隔离，文件全部位于 data/chat。
 */
export class ConversationStore {
  constructor() {
    this.dir = path.join(paths.chat, 'channels');
    fs.mkdirSync(this.dir, { recursive: true });
    this.indexFile = path.join(paths.chat, 'index.json');
    this.index = readJson(this.indexFile, { channels: [] });
    if (!Array.isArray(this.index.channels)) this.index.channels = [];
    if (!this.index.channels.find((channel) => channel.id === 'desktop')) {
      this.index.channels.push({
        id: 'desktop',
        title: '与伴行的对话',
        kind: 'desktop',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        messageCount: 0
      });
      this.saveIndex();
    }
  }

  saveIndex() {
    atomicWriteJson(this.indexFile, this.index);
  }

  safeFile(channelId) {
    const safe = String(channelId).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.dir, `${safe}.jsonl`);
  }

  ensureChannel(channelId, meta = {}) {
    let channel = this.index.channels.find((item) => item.id === channelId);
    if (!channel) {
      channel = {
        id: channelId,
        title: meta.title || channelId,
        kind: meta.kind || 'desktop',
        peerId: meta.peerId || null,
        groupId: meta.groupId || null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        messageCount: 0,
        ...meta
      };
      this.index.channels.push(channel);
      this.saveIndex();
    }
    return channel;
  }

  updateChannel(channelId, patch) {
    const channel = this.index.channels.find((item) => item.id === channelId);
    if (!channel) return null;
    Object.assign(channel, patch, { updatedAt: nowIso() });
    this.saveIndex();
    return channel;
  }

  listChannels() {
    return [...this.index.channels].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getChannel(channelId) {
    return this.index.channels.find((item) => item.id === channelId) || null;
  }

  loadMessages(channelId, limit = 200) {
    const file = this.safeFile(channelId);
    if (!fs.existsSync(file)) return [];
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const messages = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { messages.push(JSON.parse(line)); } catch {}
    }
    return messages.slice(-limit);
  }

  append(channelId, message, meta = {}) {
    this.ensureChannel(channelId, meta);
    const record = {
      id: message.id || id('msg'),
      role: message.role,
      content: message.content ?? '',
      createdAt: message.createdAt || nowIso(),
      ...message
    };
    fs.appendFileSync(this.safeFile(channelId), `${JSON.stringify(record)}\n`, 'utf8');
    const channel = this.getChannel(channelId);
    channel.messageCount = (channel.messageCount || 0) + 1;
    channel.updatedAt = nowIso();
    if (message.role === 'assistant') channel.preview = truncate(String(message.content || '').replace(/\s+/g, ' '), 80);
    this.saveIndex();
    return record;
  }

  clear(channelId) {
    const file = this.safeFile(channelId);
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, `${file}.${Date.now()}.bak`);
      fs.writeFileSync(file, '', 'utf8');
    }
    const channel = this.getChannel(channelId);
    if (channel) {
      channel.messageCount = 0;
      channel.preview = '';
      channel.updatedAt = nowIso();
      this.saveIndex();
    }
  }

  historyForModel(channelId, limit = 18) {
    return this.loadMessages(channelId, limit)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .filter((message) => message.content && !message.streaming)
      .map((message) => ({ role: message.role, content: String(message.content) }));
  }

  deleteChannel(channelId) {
    if (channelId === 'desktop') return false;
    this.index.channels = this.index.channels.filter((channel) => channel.id !== channelId);
    this.saveIndex();
    try { fs.rmSync(this.safeFile(channelId), { force: true }); } catch {}
    return true;
  }
}
