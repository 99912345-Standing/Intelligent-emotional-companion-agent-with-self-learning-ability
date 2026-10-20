import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SnowLumaWebSocketClient } from '@snowluma/sdk';
import { paths, resolveSnowLumaLauncher } from './paths.js';
import { assertPublicUrl } from './websearch.js';
import {
  domainOf, id, nowIso, overlapScore, redact, sleep, tokenize
} from './utils.js';

function splitText(text, max = 900) {
  const value = String(text || '').trim();
  if (!value) return [];
  if (value.length <= max) return [value];
  const chunks = [];
  let current = '';
  const parts = value.split(/(?<=[。！？!?；;\n])/);
  for (const part of parts) {
    if (!part) continue;
    if ((current + part).length > max && current) {
      chunks.push(current.trim());
      current = '';
    }
    if (part.length > max) {
      for (let i = 0; i < part.length; i += max) chunks.push(part.slice(i, i + max));
    } else {
      current += part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean).slice(0, 8);
}

function segmentsOf(message) {
  if (Array.isArray(message)) return message;
  if (message && typeof message === 'object') return [message];
  const text = String(message ?? '');
  if (!text) return [];
  if (!text.includes('[CQ:')) return [{ type: 'text', data: { text } }];
  const segments = [];
  let cursor = 0;
  const regex = /\[CQ:([a-zA-Z0-9_]+)((?:,[^\]]*)?)\]/g;
  let match;
  while ((match = regex.exec(text))) {
    if (match.index > cursor) segments.push({ type: 'text', data: { text: text.slice(cursor, match.index) } });
    const data = {};
    for (const pair of (match[2] || '').split(',').slice(1)) {
      const [key, ...rest] = pair.split('=');
      if (key) data[key] = rest.join('=').replace(/&#44;/g, ',').replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&amp;/g, '&');
    }
    segments.push({ type: match[1], data });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ type: 'text', data: { text: text.slice(cursor) } });
  return segments;
}

function extractMessage(message) {
  const segments = segmentsOf(message);
  let text = '';
  const images = [];
  const attachments = [];
  const mentions = [];
  let replyId = null;
  for (const segment of segments) {
    const type = String(segment.type || '').replace(/^@/, '');
    const data = segment.data || {};
    if (type === 'text') text += String(data.text || '');
    else if (type === 'image') {
      const imageSummary = String(data.summary || data.sub_type || '图片');
      const isSticker = String(data.sub_type || '') === '1' || /表情|sticker|mface/i.test(imageSummary);
      images.push({ file: data.file || '', url: data.url || '', summary: imageSummary });
      attachments.push({ kind: isSticker ? 'sticker' : 'image', qq: { file: data.file, url: data.url }, summary: isSticker ? (data.summary || '表情包') : (data.summary || '') });
    } else if (type === 'record' || type === 'audio') {
      attachments.push({ kind: 'audio', qq: { file: data.file, url: data.url }, summary: '语音' });
    } else if (type === 'video') {
      attachments.push({ kind: 'video', qq: { file: data.file, url: data.url }, summary: '视频' });
    } else if (type === 'face') {
      attachments.push({ kind: 'face', summary: `QQ表情 ${data.id || ''}` });
    } else if (type === 'at') {
      mentions.push(String(data.qq || ''));
      text += ` @${data.name || data.qq || ''} `;
    } else if (type === 'reply') {
      replyId = data.id ? String(data.id) : null;
    } else if (type === 'mface') {
      attachments.push({ kind: 'sticker', summary: data.summary || '表情包', qq: { url: data.url || '', file: data.file || '' } });
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), images, attachments, mentions, replyId, segments };
}

export function naturalizeQqText(text) {
  return String(text || '')
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)、]\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^(好的|当然|没问题|作为 AI|作为一个 AI)[，,。！!\s]*/i, '')
    .replace(/\n{2,}/g, '。')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function typingDelayFor(text, humanize = {}) {
  const cfg = humanize || {};
  const base = [...String(text || '')].length * Number(cfg.perCharMs ?? 32);
  const min = Number(cfg.minDelayMs ?? 1500);
  const max = Number(cfg.maxDelayMs ?? 4500);
  const hour = new Date().getHours();
  const start = Number(cfg.quietStart ?? 23);
  const end = Number(cfg.quietEnd ?? 8);
  const quiet = start > end ? (hour >= start || hour < end) : (hour >= start && hour < end);
  const factor = quiet ? Number(cfg.quietFactor ?? 1.35) : 1;
  const raw = Math.max(min, Math.min(max, base || min)) * factor * (0.88 + Math.random() * 0.24);
  return Math.round(Math.max(min, Math.min(max * factor, raw)));
}

function fmtUser(event) {
  return {
    id: String(event.user_id ?? event.sender?.user_id ?? ''),
    name: event.sender?.card || event.sender?.nickname || String(event.user_id || '未知'),
    nickname: event.sender?.nickname || event.sender?.card || '',
    card: event.sender?.card || '',
    groupId: event.group_id ? String(event.group_id) : null,
    groupName: event.group_name || null,
    selfId: String(event.self_id || ''),
    messageId: event.message_id ? String(event.message_id) : null,
    time: event.time ? new Date(Number(event.time) * 1000).toISOString() : nowIso()
  };
}

export class QQBridge extends EventEmitter {
  constructor({ config, logger, memory, webSearch, weights = null, people = null, emit = () => {} }) {
    super();
    this.config = config;
    this.logger = logger;
    this.memory = memory;
    this.webSearch = webSearch;
    this.weights = weights;
    this.people = people;
    this.emitEvent = emit;
    this.client = null;
    this.agent = null;
    this.running = false;
    this.connecting = false;
    this.http = { url: '', token: '' };
    this.status = {
      running: false,
      connecting: false,
      connected: false,
      boundQQ: '',
      nickname: '',
      wsUrl: '',
      httpUrl: '',
      mode: '',
      error: '',
      hint: '',
      lastEventAt: null,
      connectedAt: null,
      eventCount: 0,
      messageCount: 0,
      repliedCount: 0,
      degraded: false,
      whitelistEmpty: false,
      discovered: null
    };
    this.lastMessages = [];
    this.seenMessageIds = new Set();
    this.queues = new Map();
    this.healthTimer = null;
    this.startTime = null;
    this.lastOwnerActivityAt = Date.now();
    this.lastWhitelistActivityAt = Date.now();
    this.lastProactiveAt = 0;
    this.proactiveCount = 0;
    this.lastGroupReplyAt = new Map();
    this.recentGroupMessages = [];
    this.dynamicActivity = { group: null, private: null };
    this.pendingBatches = new Map();
    this.batchTimers = new Map();
  }

  noteOwnerActivity() {
    this.lastOwnerActivityAt = Date.now();
    this.lastWhitelistActivityAt = Date.now();
  }

  noteWhitelistActivity() {
    this.lastWhitelistActivityAt = Date.now();
  }

  effectiveGroupActivity() {
    const cfg = this.config.get().qq;
    if (cfg.groupActivityMode === 'ai') {
      return Math.max(0, Math.min(100, Number(this.dynamicActivity.group ?? this.aiGroupActivityTarget())));
    }
    return Math.max(0, Math.min(100, Number(cfg.groupActivity ?? 15)));
  }

  effectivePrivateActivity() {
    const cfg = this.config.get().qq;
    if (cfg.privateActivityMode === 'ai') {
      return Math.max(0, Math.min(100, Number(this.dynamicActivity.private ?? this.aiPrivateActivityTarget())));
    }
    return Math.max(0, Math.min(100, Number(cfg.privateActivity ?? 0)));
  }

  aiGroupActivityTarget() {
    const now = Date.now();
    const recent = this.recentGroupMessages.filter((at) => now - at < 10 * 60000).length;
    return Math.round(Math.max(8, Math.min(50, 8 + recent * 4)));
  }

  aiPrivateActivityTarget() {
    const normalized = this.weights?.getState?.().normalized;
    if (!normalized) return 15;
    const diff = Number(normalized.companion || 50) - Number(normalized.work || 50);
    return Math.round(Math.max(0, Math.min(60, 12 + diff * 0.45)));
  }

  tuneActivities() {
    const cfg = this.config.get().qq;
    let changed = false;
    if (cfg.groupActivityMode === 'ai') {
      const target = this.aiGroupActivityTarget();
      if (this.dynamicActivity.group !== target) {
        this.dynamicActivity.group = target;
        changed = true;
      }
    } else {
      this.dynamicActivity.group = null;
    }
    if (cfg.privateActivityMode === 'ai') {
      const target = this.aiPrivateActivityTarget();
      if (this.dynamicActivity.private !== target) {
        this.dynamicActivity.private = target;
        changed = true;
      }
    } else {
      this.dynamicActivity.private = null;
    }
    if (changed) this.emitEvent('qq:activity', {
      group: this.effectiveGroupActivity(),
      private: this.effectivePrivateActivity(),
      groupMode: this.config.get().qq.groupActivityMode === 'ai' ? 'ai' : 'manual',
      privateMode: this.config.get().qq.privateActivityMode === 'ai' ? 'ai' : 'manual'
    });
    return { group: this.effectiveGroupActivity(), private: this.effectivePrivateActivity() };
  }

  setAgent(agent) {
    this.agent = agent;
  }

  publicStatus() {
    return {
      ...this.status,
      config: {
        enabled: this.config.get().qq.enabled,
        autoReply: this.config.get().qq.autoReply,
        requireAtInGroup: this.config.get().qq.requireAtInGroup,
        onebotMode: this.config.get().qq.onebotMode || 'auto',
        primaryConversation: Boolean(this.config.get().qq.primaryConversation),
        groupActivityMode: this.config.get().qq.groupActivityMode === 'ai' ? 'ai' : 'manual',
        groupActivity: this.effectiveGroupActivity(),
        groupCooldownSec: Number(this.config.get().qq.groupCooldownSec ?? 30),
        privateActivityMode: this.config.get().qq.privateActivityMode === 'ai' ? 'ai' : 'manual',
        privateActivity: this.effectivePrivateActivity(),
        privateIdleMinutes: Number(this.config.get().qq.privateIdleMinutes ?? 180),
        privateMinIntervalMinutes: Number(this.config.get().qq.privateMinIntervalMinutes ?? 120),
        proactiveUseResearch: this.config.get().qq.proactiveUseResearch !== false,
        proactiveUsePhone: Boolean(this.config.get().qq.proactiveUsePhone),
        ownerQQ: this.config.get().qq.ownerQQ,
        allowPrivate: this.config.get().qq.allowPrivate,
        allowGroups: this.config.get().qq.allowGroups,
        allowAllWhenEmpty: this.config.get().qq.allowAllWhenEmpty,
        homeDir: this.config.get().qq.homeDir,
        launcherPath: resolveSnowLumaLauncher(this.config.get().qq.launcherPath),
        wsUrl: this.config.get().qq.wsUrl,
        httpUrl: this.config.get().qq.httpUrl
      },
      recentMessages: this.lastMessages.slice(-40),
      activity: {
        lastOwnerActivityAt: this.lastOwnerActivityAt ? new Date(this.lastOwnerActivityAt).toISOString() : null,
        lastWhitelistActivityAt: this.lastWhitelistActivityAt ? new Date(this.lastWhitelistActivityAt).toISOString() : null,
        lastProactiveAt: this.lastProactiveAt ? new Date(this.lastProactiveAt).toISOString() : null,
        proactiveCount: this.proactiveCount,
        activeGroupCooldowns: this.lastGroupReplyAt.size
      }
    };
  }

  pushStatus(patch = {}) {
    Object.assign(this.status, patch);
    const payload = this.publicStatus();
    this.emit('status', payload);
    this.emitEvent('qq:status', payload);
  }

  pushMessage(message) {
    this.lastMessages.push(message);
    if (this.lastMessages.length > 200) this.lastMessages.shift();
    this.emit('message', message);
    this.emitEvent('qq:message', message);
  }

  async discover() {
    const cfg = this.config.get().qq;
    const manualMode = cfg.onebotMode === 'manual';
    if (manualMode) {
      // 通用 OneBot v11：不再依赖 SnowLuma 的 per-account 配置文件。
      // 只用用户显式填写的 HTTP/WS 端点与 token 做一次探测，失败也允许继续尝试 WS。
      const baseUrl = String(cfg.httpUrl || '').replace(/\/+$/, '');
      const token = cfg.httpToken || cfg.accessToken || '';
      try {
        const res = await fetch(`${baseUrl}/get_login_info`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: '{}',
          signal: AbortSignal.timeout(5000)
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.status === 'ok') {
          return {
            ok: true,
            token,
            baseUrl,
            wsUrl: cfg.wsUrl,
            wsToken: cfg.wsToken || cfg.accessToken || '',
            self: body.data,
            source: 'manual-onebot',
            via: 'manual-onebot'
          };
        }
        return {
          ok: false,
          baseUrl,
          wsUrl: cfg.wsUrl,
          wsToken: cfg.wsToken || cfg.accessToken || '',
          error: res.status === 401 ? 'OneBot HTTP 401：HTTP Token 不被接受' : `OneBot HTTP ${res.status}：${body.wording || body.message || '接口未返回 ok'}`,
          via: 'manual-onebot'
        };
      } catch (error) {
        return {
          ok: false,
          baseUrl,
          wsUrl: cfg.wsUrl,
          wsToken: cfg.wsToken || cfg.accessToken || '',
          error: `OneBot HTTP 连接失败（${baseUrl}）：${error.message}`,
          via: 'manual-onebot'
        };
      }
    }
    const homeDirs = [cfg.homeDir, paths.snowluma].filter(Boolean);
    const connector = paths.qqBridge && fs.existsSync(path.join(paths.qqBridge, 'src', 'snowluma-conn.js'))
      ? await import(pathToFileURL(path.join(paths.qqBridge, 'src', 'snowluma-conn.js')).href)
      : null;
    if (connector?.discoverSnowLumaConnection) {
      const result = await connector.discoverSnowLumaConnection({
        cfg: {
          snowluma: {
            homeDir: cfg.homeDir,
            launcherPath: cfg.launcherPath,
            httpUrl: cfg.httpUrl,
            accessToken: cfg.accessToken
          }
        },
        homeDirs,
        timeoutMs: 5000
      });
      return { ...result, via: 'qq-bridge/snowluma-conn' };
    }
    // 后备：直接探测配置里的 HTTP 端点。
    try {
      const res = await fetch(`${String(cfg.httpUrl).replace(/\/+$/, '')}/get_login_info`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.accessToken ? { authorization: `Bearer ${cfg.accessToken}` } : {}) },
        body: '{}',
        signal: AbortSignal.timeout(5000)
      });
      const body = await res.json();
      if (res.ok && body.status === 'ok') return { ok: true, token: cfg.accessToken, baseUrl: cfg.httpUrl, self: body.data, via: 'direct' };
      return { ok: false, error: `HTTP ${res.status}`, via: 'direct' };
    } catch (error) {
      return { ok: false, error: error.message, via: 'direct' };
    }
  }

  async test() {
    const discovery = await this.discover();
    return {
      ok: Boolean(discovery.ok),
      discovery,
      snowluma: discovery.ok ? { user_id: discovery.self?.user_id, nickname: discovery.self?.nickname } : null,
      homeDir: this.config.get().qq.homeDir,
      launcher: resolveSnowLumaLauncher(this.config.get().qq.launcherPath),
      mode: this.config.get().qq.onebotMode || 'auto',
      hint: discovery.ok
        ? `OneBot HTTP 可用（${this.config.get().qq.onebotMode === 'manual' ? '手动' : '自动发现'}模式）。接着启动监听即可。`
        : this.config.get().qq.onebotMode === 'manual'
          ? '手动 OneBot HTTP 探测失败。请确认网关已登录、HTTP 端口与 HTTP Token 正确；WS 仍会尝试连接。'
          : '未能连接 SnowLuma。请先启动并登录 SnowLuma，在 WebUI 打开 OneBot HTTP 与 WebSocket 服务；也可以在“连接方式”里改为手动 OneBot 并直接填写网关地址与 Token。'
    };
  }

  async start() {
    if (this.running || this.connecting) return this.publicStatus();
    const cfg = this.config.get().qq;
    if (!cfg.enabled) throw new Error('QQ 桥接未启用：请先在“QQ 桥接”页勾选启用。');
    this.connecting = true;
    this.pushStatus({
      running: false, connecting: true, connected: false, error: '',
      hint: cfg.onebotMode === 'manual' ? '正在探测手动 OneBot 端点…' : '正在发现 SnowLuma 端点…',
      whitelistEmpty: !cfg.ownerQQ && !(cfg.allowPrivate || []).length && !(cfg.allowGroups || []).length && !cfg.allowAllWhenEmpty
    });
    try {
      const discovery = await this.discover();
      this.status.discovered = {
        ok: discovery.ok,
        source: discovery.source || discovery.via,
        tried: discovery.tried?.map((item) => ({ source: item.source, url: item.url, ok: item.ok, status: item.status })),
        error: discovery.error
      };
      const httpUrl = (discovery.baseUrl || cfg.httpUrl || '').replace(/\/+$/, '');
      const httpToken = discovery.token || cfg.httpToken || cfg.accessToken || '';
      this.http = { url: httpUrl, token: httpToken };
      const wsUrl = discovery.wsUrl || cfg.wsUrl;
      const wsToken = discovery.wsToken || cfg.wsToken || cfg.accessToken || '';
      this.pushStatus({
        httpUrl,
        wsUrl,
        boundQQ: discovery.self?.user_id ? String(discovery.self.user_id) : '',
        nickname: discovery.self?.nickname || '',
        hint: discovery.ok
          ? `${cfg.onebotMode === 'manual' ? 'OneBot' : 'SnowLuma'} 端点已确认，正在连接 OneBot WebSocket…`
          : `HTTP 探测未成功（${discovery.error || '未知'}），仍尝试连接 WebSocket…`
      });

      if (this.client) this.client.close(1000, 'restart');
      const client = new SnowLumaWebSocketClient({
        url: wsUrl,
        accessToken: wsToken || undefined,
        reconnect: { minDelayMs: 1000, maxDelayMs: 15000 }
      });
      this.client = client;
      client.on('open', () => {
        this.pushStatus({
          connected: true,
          running: true,
          connecting: false,
          connectedAt: nowIso(),
          error: '',
          hint: 'OneBot WebSocket 已连接。'
        });
        this.logger.info('qq', `OneBot 已连接：${wsUrl}（${this.config.get().qq.onebotMode === 'manual' ? '手动' : 'SnowLuma 自动'}）`);
        this.refreshLoginInfo().catch(() => {});
      });
      client.on('close', (info) => {
        this.pushStatus({
          connected: false,
          running: this.running,
          error: info?.code === 1006 ? '连接断开（1006）；可能是 WebSocket token 不正确，或 SnowLuma 未开启 WS 服务。' : '',
          hint: this.running ? '连接断开，SDK 将自动重连。若持续失败，请检查 token。' : '已停止。'
        });
      });
      client.on('error', (error) => {
        this.pushStatus({ error: `WebSocket 错误：${error?.message || String(error)}` });
      });
      client.onPrivateMessage((event) => this.handleIncoming('private', event));
      client.onGroupMessage((event) => this.handleIncoming('group', event));
      client.onEvent((event) => {
        this.status.eventCount += 1;
        this.status.lastEventAt = nowIso();
        if (event?.post_type === 'meta_event' && event?.meta_event_type === 'heartbeat' && event?.status?.good === false) {
          this.pushStatus({ degraded: true, hint: 'SnowLuma 心跳报告接收链路异常（good=false）；QQ 消息可能收不到。' });
        } else if (this.status.degraded) {
          this.pushStatus({ degraded: false, hint: '上游心跳恢复。' });
        }
        if (event?.self_id) this.status.boundQQ = String(event.self_id);
        if (event?.post_type === 'notice' && event?.notice_type === 'notify' && event?.sub_type === 'poke') {
          this.handlePoke(event).catch((error) => this.logger.warn('qq', `戳一戳处理失败：${error.message}`));
        }
      });
      this.running = true;
      this.startTime = Date.now();
      this.pushStatus({ running: true, connecting: true });
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('连接超时（12 秒）')), 12000));
      await Promise.race([client.connect(), timeout]);
      await this.refreshLoginInfo().catch(() => {});
      this.pushStatus({ connecting: false, connected: true, running: true, hint: '监听中。' });
      this.startHealthTimer();
      return this.publicStatus();
    } catch (error) {
      this.running = false;
      this.connecting = false;
      this.pushStatus({
        running: false,
        connecting: false,
        connected: false,
        error: error.message,
        hint: this.config.get().qq.onebotMode === 'manual'
          ? '手动 OneBot 连接失败。请核对 WS/HTTP 地址、WS Token、HTTP Token，并确认网关已登录 QQ。'
          : '请检查 SnowLuma 是否已登录 QQ、OneBot HTTP/WS 服务是否开启、token 是否正确；也可切换到手动 OneBot 模式。'
      });
      try { this.client?.close(1000, 'start-failed'); } catch {}
      this.client = null;
      return this.publicStatus();
    }
  }

  async refreshLoginInfo() {
    try {
      const info = await this.onebot('get_login_info');
      if (info?.user_id) {
        this.pushStatus({ boundQQ: String(info.user_id), nickname: info.nickname || this.status.nickname });
      }
      return info;
    } catch (error) {
      if (this.client?.isConnected) {
        try {
          const info = await this.client.getLoginInfo();
          this.pushStatus({ boundQQ: String(info.user_id || ''), nickname: info.nickname || '' });
          return info;
        } catch {}
      }
      throw error;
    }
  }

  startHealthTimer() {
    clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => {
      if (!this.running) return;
      const last = Date.parse(this.status.lastEventAt || this.status.connectedAt || '');
      const warnMs = Number(this.config.get().qq.healthWarnMs || 600000);
      if (Number.isFinite(last) && Date.now() - last > warnMs) {
        this.pushStatus({ degraded: true, hint: '超过 10 分钟没有收到任何 OneBot 事件；请检查网关是否仍在线、Hook/账号会话是否正常。' });
      }
    }, 60000);
  }

  async stop() {
    this.running = false;
    for (const timer of this.batchTimers.values()) clearTimeout(timer);
    this.batchTimers.clear();
    this.pendingBatches.clear();
    clearInterval(this.healthTimer);
    this.healthTimer = null;
    try { this.client?.close(1000, 'user-stop'); } catch {}
    this.client = null;
    this.pushStatus({ running: false, connected: false, connecting: false, hint: '已停止监听。' });
    return this.publicStatus();
  }

  async restart() {
    await this.stop();
    await sleep(400);
    return this.start();
  }

  async onebot(action, params = {}) {
    if (!this.http.url) throw new Error('OneBot HTTP 端点未配置');
    const res = await fetch(`${this.http.url}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.http.token ? { authorization: `Bearer ${this.http.token}` } : {})
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(20000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = res.status === 426 ? '（HTTP 426：端口可能填成了 WebSocket 端口）' : '';
      throw new Error(`OneBot HTTP ${res.status}${hint}`);
    }
    if (body.status !== 'ok' || body.retcode !== 0) throw new Error(`OneBot ${action} 失败：${body.wording || body.retcode}`);
    return body.data;
  }

  allowedIncoming(kind, userId, groupId) {
    const cfg = this.config.get().qq;
    const user = String(userId || '');
    const group = String(groupId || '');
    const denyPrivate = (cfg.denyPrivate || []).map(String);
    const denyGroups = (cfg.denyGroups || []).map(String);
    if (kind === 'private') {
      if (denyPrivate.includes(user)) return { allowed: false, reason: '私聊黑名单' };
      if (cfg.ownerQQ && String(cfg.ownerQQ) === user) return { allowed: true, reason: '主人私聊' };
      if ((cfg.allowPrivate || []).map(String).includes(user)) return { allowed: true, reason: '私聊白名单' };
      if (!(cfg.allowPrivate || []).length && cfg.allowAllWhenEmpty) return { allowed: true, reason: '空白名单放行已开启' };
      return { allowed: false, reason: '不在私聊白名单' };
    }
    if (denyGroups.includes(group)) return { allowed: false, reason: '群黑名单' };
    if ((cfg.allowGroups || []).map(String).includes(group)) return { allowed: true, reason: '群白名单' };
    if (!(cfg.allowGroups || []).length && cfg.allowAllWhenEmpty) return { allowed: true, reason: '空白名单放行已开启' };
    return { allowed: false, reason: '群不在白名单' };
  }

  async handleIncoming(kind, event) {
    if (!this.running) return;
    const selfId = String(event.self_id || this.status.boundQQ || '');
    const sender = fmtUser(event);
    if (!sender.id || sender.id === selfId) return;
    const msgId = sender.messageId || id('qqmsg');
    if (this.seenMessageIds.has(msgId)) return;
    this.seenMessageIds.add(msgId);
    if (this.seenMessageIds.size > 2000) {
      const values = [...this.seenMessageIds].slice(-1000);
      this.seenMessageIds = new Set(values);
    }
    const parsed = extractMessage(event.message ?? event.raw_message ?? '');
    if (!parsed.text && !parsed.attachments.length) return;
    const groupId = kind === 'group' ? sender.groupId : null;
    const access = this.allowedIncoming(kind, sender.id, groupId);
    if (access.allowed) this.noteWhitelistActivity();
    const cfg = this.config.get().qq;
    const personChannel = kind === 'group' ? `qq_group_${groupId}` : `qq_private_${sender.id}`;
    // QQ 号是稳定主键；昵称只是显示名。群聊/私聊都进入同一本人物账本。
    try {
      this.people?.observe({
        qq: sender.id,
        nickname: sender.nickname || sender.name,
        text: parsed.text || parsed.attachments.map((item) => item.summary).join(' '),
        channel: personChannel,
        source: kind,
        allowed: access.allowed
      });
    } catch (error) {
      this.logger.warn('people', `人物印象更新失败：${error.message}`);
    }
    if (cfg.ownerQQ && String(cfg.ownerQQ) === String(sender.id)) this.noteOwnerActivity();
    if (kind === 'group') {
      this.recentGroupMessages.push(Date.now());
      if (this.recentGroupMessages.length > 200) this.recentGroupMessages.shift();
      this.tuneActivities();
    }
    const requireAt = kind === 'group' && cfg.requireAtInGroup !== false;
    const mentioned = parsed.mentions.map(String).includes(selfId) || parsed.segments.some((segment) => segment.type === 'at' && String(segment.data?.qq) === selfId);
    let groupTrigger = true;
    let groupReason = '';
    if (kind === 'group') {
      const lastReply = this.lastGroupReplyAt.get(String(groupId)) || 0;
      const cooldownMs = Math.max(0, Number(cfg.groupCooldownSec ?? 30)) * 1000;
      const cooling = cooldownMs > 0 && Date.now() - lastReply < cooldownMs;
      if (cooling) {
        groupTrigger = false;
        groupReason = `群回复冷却中（${Math.ceil((cooldownMs - (Date.now() - lastReply)) / 1000)}s）`;
      } else if (requireAt) {
        groupTrigger = mentioned;
        if (!mentioned) groupReason = '群聊仅回复 @ 机器人';
      } else if (!mentioned) {
        const activity = this.effectiveGroupActivity();
        groupTrigger = activity > 0 && Math.random() * 100 < activity;
        if (!groupTrigger) groupReason = activity <= 0 ? '群聊活跃度为 0，只回复 @' : '群聊活跃度未命中';
      }
    }
    const shouldProcess = access.allowed && this.config.get().qq.autoReply && groupTrigger;
    const stickerOnly = !String(parsed.text || '').trim()
      && parsed.attachments.some((item) => item.kind === 'sticker')
      && !parsed.attachments.some((item) => ['image', 'audio', 'record', 'video'].includes(item.kind));
    // 表情包也交给模型看一眼，再结合上下文决定回不回；不再因为“只发表情”直接丢弃。
    // stickerReplyChance 现在只作为一个“这轮可以更安静”的提示，不阻止视觉输入。
    parsed.stickerOnly = stickerOnly;
    parsed.stickerSilent = stickerOnly && Math.random() * 100 >= Math.max(0, Math.min(100, Number(cfg.stickerReplyChance ?? 35)));
    const primary = Boolean(cfg.primaryConversation && kind === 'private' && cfg.ownerQQ && String(cfg.ownerQQ) === String(sender.id));
    const display = {
      id: msgId,
      at: nowIso(),
      channel: primary ? 'desktop' : (kind === 'group' ? `qq_group_${groupId}` : `qq_private_${sender.id}`),
      kind,
      primary,
      userId: sender.id,
      groupId,
      senderName: sender.name,
      groupName: sender.groupName,
      text: parsed.text,
      attachments: parsed.attachments.map((item) => ({ kind: item.kind, summary: item.summary })),
      allowed: access.allowed,
      accessReason: access.reason,
      willReply: Boolean(shouldProcess),
      ignoredReason: shouldProcess ? '' : (!access.allowed ? access.reason : (!this.config.get().qq.autoReply ? '自动回复已关闭' : (groupReason || '未触发回复')))
    };
    this.status.messageCount += 1;
    this.pushMessage(display);
    try {
      this.memory.extractRelationshipFacts(parsed.text, { source: `qq:${sender.id}` });
    } catch {}
    if (!shouldProcess) {
      // 即使不回复，白名单里的表情包仍要进入专用表情库；否则 AI 以后没有可用素材。
      if (access.allowed) {
        for (const attachment of parsed.attachments.filter((item) => item.kind === 'sticker')) {
          this.ingestMedia(attachment, { channel: personChannel, messageId: msgId, sender }).catch((error) => {
            this.logger.warn('qq', `表情包入库失败：${error.message}`);
          });
        }
      }
      return;
    }
    const channel = primary ? 'desktop' : (kind === 'group' ? `qq_group_${groupId}` : `qq_private_${sender.id}`);
    this.enqueueBatch({ channel, kind, sender, groupId, parsed, msgId, primary });
  }

  async handlePoke(event) {
    if (!this.running) return;
    const selfId = String(event.self_id || this.status.boundQQ || '');
    const target = String(event.target_id || '');
    if (target && target !== selfId) return;
    const userId = String(event.user_id || '');
    if (!userId || userId === selfId) return;
    const kind = event.group_id ? 'group' : 'private';
    const groupId = event.group_id ? String(event.group_id) : null;
    const access = this.allowedIncoming(kind, userId, groupId);
    if (!access.allowed || !this.config.get().qq.autoReply) return;
    this.noteWhitelistActivity();
    const sender = fmtUser({
      user_id: userId,
      group_id: groupId,
      self_id: selfId,
      sender: event.sender || { nickname: event.sender?.nickname || userId },
      time: event.time
    });
    const parsed = { text: '', attachments: [], mentions: [], replyId: null, segments: [], poke: true };
    const primary = Boolean(this.config.get().qq.primaryConversation && kind === 'private' && this.config.get().qq.ownerQQ === userId);
    const channel = primary ? 'desktop' : (kind === 'group' ? `qq_group_${groupId}` : `qq_private_${userId}`);
    const display = {
      id: id('qqpoke'), at: nowIso(), channel, kind, primary, poke: true,
      userId, groupId, senderName: sender.name, text: '[戳一戳]',
      allowed: true, accessReason: access.reason, willReply: true,
      ignoredReason: ''
    };
    this.pushMessage(display);
    this.enqueueBatch({ channel, kind, sender: { ...sender, id: userId }, groupId, parsed, msgId: id('qqpoke'), primary, poke: true });
  }

  chooseBatch(items) {
    let best = items[0];
    let bestScore = -Infinity;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const text = item.parsed?.text || '';
      let score = index * 0.1;
      if (item.parsed?.mentions?.map(String).includes(String(this.status.boundQQ))) score += 6;
      if (item.parsed?.replyId) score += 5;
      if (/(你|伴行|在吗|理我|帮我|怎么|为什么|如何|吗|？|\?)/.test(text)) score += 3;
      if (item.parsed?.poke) score += 4;
      if (item.primary) score += 1.5;
      score += Math.min(1.5, text.length / 120);
      if (score > bestScore) { best = item; bestScore = score; }
    }
    return best;
  }

  enqueueBatch(item) {
    const key = item.channel;
    const list = this.pendingBatches.get(key) || [];
    list.push(item);
    if (list.length > 8) list.shift();
    this.pendingBatches.set(key, list);
    clearTimeout(this.batchTimers.get(key));
    const wait = Math.max(150, Number(this.config.get().qq.batchWindowMs || 900));
    this.batchTimers.set(key, setTimeout(() => this.flushBatch(key), wait));
  }

  async flushBatch(key) {
    this.batchTimers.delete(key);
    const items = this.pendingBatches.get(key) || [];
    this.pendingBatches.delete(key);
    if (!items.length || !this.running) return;
    const selected = this.chooseBatch(items);
    const others = items.filter((item) => item !== selected && item.parsed?.text);
    if (others.length) {
      selected.parsed = {
        ...selected.parsed,
        batch: others.slice(0, 6).map((item) => ({ text: item.parsed.text, sender: item.sender.name }))
      };
    }
    const previous = this.queues.get(key) || Promise.resolve();
    const next = previous.then(() => this.processIncoming(selected)).catch((error) => {
      this.logger.error('qq', `处理 QQ 消息失败：${error.message}`);
      this.pushStatus({ error: `处理消息失败：${error.message}` });
    });
    this.queues.set(key, next);
  }

  async processIncoming({ channel, kind, sender, groupId, parsed, msgId, primary = false }) {
    if (!this.agent) throw new Error('Agent 未就绪');
    const stickerOnly = !String(parsed.text || '').trim()
      && parsed.attachments.some((item) => item.kind === 'sticker')
      && !parsed.attachments.some((item) => ['image', 'audio', 'record', 'video'].includes(item.kind));
    const attachments = [];
    for (const attachment of parsed.attachments) {
      if (!['image', 'sticker', 'audio', 'record'].includes(attachment.kind)) continue;
      try {
        const media = await this.ingestMedia(attachment, { channel, messageId: msgId, sender });
        if (media) {
          if (media.kind === 'sticker' && !media.labeledAt && this.stickerLabeler) {
            this.stickerLabeler.labelOne(media).catch((error) => this.logger.warn('stickers', `新表情标注失败：${error.message}`));
          }
          attachments.push({
            kind: media.kind,
            path: media.file,
            mime: media.mime,
            caption: media.caption,
            dataUrl: media.mime.startsWith('image/')
              ? `data:${media.mime};base64,${fs.readFileSync(media.file).toString('base64')}`
              : ''
          });
        }
      } catch (error) {
        this.logger.warn('qq', `QQ 附件读取失败：${error.message}`);
      }
    }
    const title = primary ? '与伴行的对话' : (kind === 'group' ? `QQ群 ${groupId}` : `QQ · ${sender.name}`);
    let prompt = primary
      ? (parsed.text || (parsed.poke ? '[戳一戳]' : '[图片]'))
      : (kind === 'group'
        ? `[QQ群 ${groupId}] ${sender.name}(${sender.id})：${parsed.text || (parsed.poke ? '[戳一戳]' : '[图片]')}`
        : `[QQ私聊] ${sender.name}(${sender.id})：${parsed.text || (parsed.poke ? '[戳一戳]' : '[图片]')}`);
    if (parsed.poke) prompt += '\n（对方戳了戳你。用一句自然短句回应，不要长篇，也不要每次都用同一句。）';
    if (stickerOnly) {
      prompt += `\n（对方只发了一个表情包。结合前面的对话看一眼它表达了什么；可以很短地接一句、回一个贴合的表情，或者只回复 [SILENT]。不要机械地每张都回。${parsed.stickerSilent ? '这一轮单发表情包回复概率未命中，只观察不回复，最终输出 [SILENT]。' : '这一轮概率命中，可以自然回应。'}）`;
    } else if (parsed.attachments.some((item) => item.kind === 'sticker')) {
      prompt += '\n（对方的表情包是文字语气的补充。可以看一眼它作为语气判断，但不要逐张描述图片；按文字内容自然回应，不必单独评论表情包。）';
    }
    if (parsed.batch?.length) {
      prompt += `\n【同批其他消息｜仅作上下文，不要逐条回复】\n${parsed.batch.map((item) => `- ${item.sender}: ${truncate(item.text, 160)}`).join('\n')}`;
    }
    const result = await this.agent.handleMessage({
      channel,
      text: prompt,
      attachments,
      meta: {
        source: 'qq',
        primaryQQ: primary,
        qq: { kind, userId: sender.id, groupId, senderName: sender.name, messageId: msgId },
        poke: Boolean(parsed.poke),
        batch: parsed.batch || [],
        stickerOnly: Boolean(parsed.stickerOnly),
        stickerSilent: Boolean(parsed.stickerSilent),
        stickerReplyAllowed: !stickerOnly || !parsed.stickerSilent,
        title
      }
    });
    // Agent.handleMessage 返回 { userMessage, assistantMessage, ... }；
    // 兼容旧测试桩直接返回 { content } 的形式。
    // 单发表情包的回复概率是真实闸门：概率未命中时即使模型忍不住写了字，也不发送。
    if (stickerOnly && parsed.stickerSilent) return;
    const reply = String(result?.assistantMessage?.content ?? result?.content ?? '').trim();
    if (!reply || reply === '[SILENT]') return;
    if (this.config.get().qq.humanize?.enabled === false) {
      await sleep(Number(this.config.get().qq.sendDelayMs || 500));
    }
    await this.sendAuto(kind, groupId || sender.id, reply, {
      replyId: parsed.replyId || (parsed.mentions?.length ? msgId : null)
    });
    if (kind === 'group') this.lastGroupReplyAt.set(String(groupId), Date.now());
    this.status.repliedCount += 1;
    this.pushMessage({
      id: id('qqout'),
      at: nowIso(),
      kind,
      outgoing: true,
      userId: this.status.boundQQ,
      groupId,
      senderName: '伴行',
      text: reply,
      allowed: true,
      willReply: false
    });
  }

  async ingestMedia(attachment, context) {
    const info = attachment.qq || {};
    const isAudio = attachment.kind === 'audio' || attachment.kind === 'record';
    let mediaInfo = null;
    if (info.file || info.url) {
      try {
        mediaInfo = await this.onebot(isAudio ? 'get_record' : 'get_image', { file: info.file || info.url });
      } catch {}
    }
    const url = mediaInfo?.url || mediaInfo?.file || info.url;
    if (!url || !/^https?:\/\//i.test(url)) return null;
    await assertPublicUrl(url);
    const response = await fetch(url, { headers: { 'user-agent': 'BanxingQQ/1.0' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`附件 HTTP ${response.status}`);
    const type = String(response.headers.get('content-type') || (isAudio ? 'audio/mpeg' : 'image/png'));
    if (isAudio ? !/^(audio|video|application\/octet-stream)/.test(type) : !type.startsWith('image/')) {
      throw new Error(`附件类型不符：${type}`);
    }
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 20 * 1024 * 1024) throw new Error('附件超过 20MB');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 20 * 1024 * 1024) throw new Error('附件超过 20MB');
    const ext = isAudio
      ? (type.includes('ogg') ? '.ogg' : type.includes('wav') ? '.wav' : type.includes('amr') ? '.amr' : '.mp3')
      : (type.includes('jpeg') ? '.jpg' : type.includes('gif') ? '.gif' : type.includes('webp') ? '.webp' : '.png');
    const sticker = attachment.kind === 'sticker';
    return this.memory.saveMedia({
      buffer,
      kind: isAudio ? 'audio' : (sticker ? 'sticker' : 'image'),
      mime: type,
      fileName: `qq-${context.sender.id}-${Date.now()}${ext}`,
      source: 'qq',
      channel: context.channel,
      messageId: context.messageId,
      caption: attachment.summary || (isAudio ? 'QQ 语音' : sticker ? 'QQ 表情包' : 'QQ 图片'),
      tags: ['QQ', context.sender.name, ...(sticker ? ['表情包', 'sticker'] : [])],
      meta: { sender: context.sender.id, domain: domainOf(url), sticker }
    });
  }

  async sendAuto(kind, targetId, text, { replyId = null } = {}) {
    const cfg = this.config.get().qq;
    const humanize = cfg.humanize || {};
    const value = naturalizeQqText(redact(String(text || ''))).slice(0, Number(cfg.maxReplyChars || 900) * 2);
    let chunks = splitText(value, Number(cfg.maxReplyChars || 900));
    if (humanize.enabled !== false) chunks = chunks.slice(0, Math.max(1, Number(humanize.maxChunks ?? 3)));
    if (!chunks.length) return;
    const quote = cfg.quoteReplies !== false && replyId;
    const firstDelay = typingDelayFor(chunks.join(''), humanize);
    if (humanize.enabled !== false) {
      try {
        await this.onebot('set_input_status', {
          ...(kind === 'group' ? { group_id: Number(targetId) } : { user_id: Number(targetId) }),
          event_type: 1
        });
      } catch {}
      await sleep(firstDelay);
    }
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      await this.onebot(kind === 'group' ? 'send_group_msg' : 'send_private_msg', {
        ...(kind === 'group' ? { group_id: Number(targetId) } : { user_id: Number(targetId) }),
        message: [
          ...(quote && index === 0 ? [{ type: 'reply', data: { id: String(replyId) } }] : []),
          { type: 'text', data: { text: chunk } }
        ],
        auto_escape: false
      });
      if (index < chunks.length - 1) {
        const gap = humanize.enabled === false
          ? Number(cfg.sendDelayMs || 500)
          : Math.round(
            Math.max(Number(humanize.gapMinMs ?? 650), Math.min(Number(humanize.gapMaxMs ?? 2400), Number(humanize.perCharMs ?? 28) * chunk.length))
            * (0.85 + Math.random() * 0.35)
          );
        await sleep(gap);
      }
    }
  }

  /**
   * 私聊主动活跃度：安静达到阈值后，按概率让主模型自主查资料/看手机，
   * 回来发起一段新话题。默认 privateActivity=0，不会主动打扰。
   */
  async maybeProactive({ force = false } = {}) {
    const cfg = this.config.get().qq;
    if (!this.agent || !this.agent.proactiveTurn) return { skipped: 'agent-unavailable' };
    if (!this.running || !this.status.connected) return { skipped: 'not-connected' };
    if (!cfg.ownerQQ) return { skipped: 'no-owner' };
    const hour = new Date().getHours();
    const quietStart = Number(cfg.proactiveQuietStart ?? 0);
    const quietEnd = Number(cfg.proactiveQuietEnd ?? 7);
    const quiet = quietStart > quietEnd ? (hour >= quietStart || hour < quietEnd) : (hour >= quietStart && hour < quietEnd);
    if (quiet && !force) return { skipped: 'quiet-hours' };
    const activity = this.effectivePrivateActivity();
    if (activity <= 0 && !force) return { skipped: 'inactive' };
    const idleMs = Date.now() - (this.lastOwnerActivityAt || 0);
    if (!force && idleMs < Math.max(1, Number(cfg.privateIdleMinutes ?? 180)) * 60000) return { skipped: 'not-idle' };
    const gapMs = Date.now() - (this.lastProactiveAt || 0);
    const minInterval = Math.max(1, Number(cfg.privateMinIntervalMinutes ?? 120)) * 60000;
    if (!force && gapMs < minInterval * (0.8 + Math.random() * 0.45)) return { skipped: 'cooldown' };
    if (!force && Math.random() * 100 >= activity) return { skipped: 'chance' };
    const channel = cfg.primaryConversation ? 'desktop' : `qq_private_${cfg.ownerQQ}`;
    this.lastProactiveAt = Date.now();
    try {
      const result = await this.agent.proactiveTurn({
        channel,
        allowResearch: cfg.proactiveUseResearch !== false,
        allowPhone: Boolean(cfg.proactiveUsePhone)
      });
      if (!result?.content) return { skipped: 'empty' };
      await this.sendAuto('private', cfg.ownerQQ, result.content);
      this.proactiveCount += 1;
      this.pushStatus({ hint: '刚刚主动发起了一段新话题。' });
      this.pushMessage({
        id: id('qqproactive'),
        at: nowIso(),
        channel,
        kind: 'private',
        outgoing: true,
        proactive: true,
        userId: this.status.boundQQ,
        senderName: '伴行',
        text: result.content,
        allowed: true,
        willReply: false
      });
      return { ok: true, channel, content: result.content, research: result.research || null, phoneUsed: result.phoneUsed || false };
    } catch (error) {
      this.logger.warn('qq', `主动话题生成失败：${error.message}`);
      return { skipped: 'error', error: error.message };
    }
  }

  stickerCatalog() {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(paths.resources, 'stickers', 'manifest.json'), 'utf8'));
      return (manifest.stickers || []).map((item) => ({
        ...item,
        path: path.join(paths.resources, 'stickers', item.file)
      })).filter((item) => fs.existsSync(item.path));
    } catch {
      return [];
    }
  }

  stickerMemory(query = '', limit = 12) {
    const queryText = String(query || '').trim();
    const tokens = tokenize(queryText);
    const candidates = (this.memory.multimodal?.all?.() || [])
      .filter((item) => !item.duplicate)
      .map((item) => ({
        item,
        searchText: [
          item.stickerCaption,
          item.caption,
          ...(item.stickerEmotion || []),
          ...(item.stickerScenes || []),
          ...(item.tags || []),
          item.fileName
        ].filter(Boolean).join(' '),
        isSticker: item.kind === 'sticker'
          || item.folder === 'stickers'
          || (item.tags || []).some((tag) => /表情|sticker|mface|贴纸/.test(String(tag)))
          || /表情|sticker|mface|贴纸/.test(`${item.caption} ${item.fileName}`)
      }))
      // 只让表情包进入这个通道；普通照片/截图不会被 AI 当表情发出去。
      .filter(({ isSticker }) => isSticker);
    const scored = candidates.map((candidate) => ({
      ...candidate,
      score: tokens.length ? overlapScore(tokens, tokenize(candidate.searchText)) : 0
    }));
    const matched = queryText ? scored.filter((candidate) => candidate.score > 0) : scored;
    // 语义匹配失败时才回退到最近表情；有标签时绝不直接跳到内置表情。
    const chosen = matched.length ? matched : scored;
    return chosen
      .sort((a, b) => (b.score - a.score)
        || String(b.item.updatedAt || b.item.createdAt || '').localeCompare(String(a.item.updatedAt || a.item.createdAt || '')))
      .slice(0, Math.max(1, Math.min(30, Number(limit) || 12)))
      .map(({ item, score }) => ({
        mediaId: item.id,
        caption: item.stickerCaption || item.caption || '未命名表情',
        emotion: item.stickerEmotion || [],
        scenes: item.stickerScenes || [],
        tags: item.tags || [],
        labeled: Boolean(item.labeledAt),
        labelSource: item.labelSource || '',
        score: Math.round(score * 1000) / 1000,
        fileName: item.fileName,
        folder: item.folder || (item.relativeFile?.includes('/stickers/') ? 'stickers' : 'legacy'),
        createdAt: item.createdAt,
        mime: item.mime,
        isSticker: true
      }));
  }

  async sendStoredMedia(kind, targetId, mediaId) {
    if (!this.memory?.multimodal) throw new Error('多模态记忆不可用');
    const item = this.memory.multimodal.get(String(mediaId || ''));
    if (!item) throw new Error('这条多模态记忆不存在');
    if (!item.file || !fs.existsSync(item.file)) throw new Error('这条记忆的文件已被移动或删除');
    if (item.kind === 'sticker' || String(item.mime || '').startsWith('image/')) {
      await this.sendImage(kind, targetId, item.file, { caption: item.caption || '表情' });
      return { ok: true, mediaId: item.id, kind: 'image', caption: item.caption || '' };
    }
    if (String(item.mime || '').startsWith('audio/') || item.kind === 'audio') {
      await this.sendVoice(kind, targetId, item.file);
      return { ok: true, mediaId: item.id, kind: 'audio', caption: item.caption || '' };
    }
    throw new Error(`这条记忆是 ${item.mime || item.kind}，不能作为表情/图片发送`);
  }

  async sendImage(kind, targetId, imageFile, { caption = '' } = {}) {
    if (!this.running || !this.status.connected) throw new Error('QQ 尚未连接');
    if (!this.config.get().permissions.qqSend) throw new Error('QQ 发送权限已关闭');
    if (!imageFile || !fs.existsSync(imageFile)) throw new Error('图片文件不存在');
    if (fs.statSync(imageFile).size > 12 * 1024 * 1024) throw new Error('图片超过 12MB');
    const idText = String(targetId || '');
    const cfg = this.config.get().qq;
    if (kind === 'private') {
      const allowed = (cfg.ownerQQ && String(cfg.ownerQQ) === idText) || (cfg.allowPrivate || []).map(String).includes(idText) || (!(cfg.allowPrivate || []).length && cfg.allowAllWhenEmpty);
      if (!allowed) throw new Error('目标私聊不在白名单');
    } else {
      const allowed = (cfg.allowGroups || []).map(String).includes(idText) || (!(cfg.allowGroups || []).length && cfg.allowAllWhenEmpty);
      if (!allowed) throw new Error('目标群不在白名单');
    }
    if (cfg.humanize?.enabled !== false) await sleep(typingDelayFor(caption || '图片', cfg.humanize));
    const file = `base64://${fs.readFileSync(imageFile).toString('base64')}`;
    await this.onebot(kind === 'group' ? 'send_group_msg' : 'send_private_msg', {
      ...(kind === 'group' ? { group_id: Number(targetId) } : { user_id: Number(targetId) }),
      message: [{ type: 'image', data: { file } }],
      auto_escape: false
    });
    this.pushMessage({
      id: id('qqimage'), at: nowIso(), kind, outgoing: true, userId: this.status.boundQQ,
      groupId: kind === 'group' ? targetId : null, senderName: '伴行',
      text: `[图片] ${caption || '图片'}`, image: true, allowed: true, willReply: false
    });
    return { ok: true, bytes: fs.statSync(imageFile).size };
  }

  async sendVoice(kind, targetId, audioFile) {
    if (!this.running || !this.status.connected) throw new Error('QQ 尚未连接');
    if (!this.config.get().permissions.qqSend) throw new Error('QQ 发送权限已关闭');
    if (!audioFile || !fs.existsSync(audioFile)) throw new Error('语音文件不存在');
    if (fs.statSync(audioFile).size > 8 * 1024 * 1024) throw new Error('语音文件超过 8MB');
    const idText = String(targetId || '');
    const cfg = this.config.get().qq;
    if (kind === 'private') {
      const allowed = (cfg.ownerQQ && String(cfg.ownerQQ) === idText) || (cfg.allowPrivate || []).map(String).includes(idText) || (!(cfg.allowPrivate || []).length && cfg.allowAllWhenEmpty);
      if (!allowed) throw new Error('目标私聊不在白名单');
    } else {
      const allowed = (cfg.allowGroups || []).map(String).includes(idText) || (!(cfg.allowGroups || []).length && cfg.allowAllWhenEmpty);
      if (!allowed) throw new Error('目标群不在白名单');
    }
    if (cfg.humanize?.enabled !== false) await sleep(typingDelayFor('语音', cfg.humanize));
    const file = `base64://${fs.readFileSync(audioFile).toString('base64')}`;
    await this.onebot(kind === 'group' ? 'send_group_msg' : 'send_private_msg', {
      ...(kind === 'group' ? { group_id: Number(targetId) } : { user_id: Number(targetId) }),
      message: [{ type: 'record', data: { file } }],
      auto_escape: false
    });
    this.pushMessage({
      id: id('qqvoice'),
      at: nowIso(),
      kind,
      outgoing: true,
      userId: this.status.boundQQ,
      groupId: kind === 'group' ? targetId : null,
      senderName: '伴行',
      text: '[语音] 唱给你听',
      voice: true,
      allowed: true,
      willReply: false
    });
    return { ok: true, bytes: fs.statSync(audioFile).size };
  }

  async sendSticker(kind, targetId, stickerId) {
    if (!this.running || !this.status.connected) throw new Error('QQ 尚未连接');
    if (!this.config.get().permissions.qqSend) throw new Error('QQ 发送权限已关闭');
    const item = this.stickerCatalog().find((sticker) => sticker.id === String(stickerId || '').trim());
    if (!item) throw new Error(`没有这个表情包：${stickerId || '空'}`);
    const cfg = this.config.get().qq;
    if (kind === 'private') {
      const idText = String(targetId || '');
      const allowed = (cfg.ownerQQ && String(cfg.ownerQQ) === idText) || (cfg.allowPrivate || []).map(String).includes(idText) || (!(cfg.allowPrivate || []).length && cfg.allowAllWhenEmpty);
      if (!allowed) throw new Error('目标私聊不在白名单');
    } else {
      const idText = String(targetId || '');
      const allowed = (cfg.allowGroups || []).map(String).includes(idText) || (!(cfg.allowGroups || []).length && cfg.allowAllWhenEmpty);
      if (!allowed) throw new Error('目标群不在白名单');
    }
    if (cfg.humanize?.enabled !== false) await sleep(typingDelayFor(item.label || '表情', cfg.humanize));
    const file = `base64://${fs.readFileSync(item.path).toString('base64')}`;
    await this.onebot(kind === 'group' ? 'send_group_msg' : 'send_private_msg', {
      ...(kind === 'group' ? { group_id: Number(targetId) } : { user_id: Number(targetId) }),
      message: [{ type: 'image', data: { file } }],
      auto_escape: false
    });
    this.pushMessage({
      id: id('qqsticker'),
      at: nowIso(),
      kind,
      outgoing: true,
      userId: this.status.boundQQ,
      groupId: kind === 'group' ? targetId : null,
      senderName: '伴行',
      text: `[表情] ${item.label}`,
      sticker: item.id,
      allowed: true,
      willReply: false
    });
    return { ok: true, sticker: item.id, label: item.label };
  }

  async postDynamic(text, { ugcRight = 1 } = {}) {
    if (!this.running || !this.status.connected) throw new Error('QQ 尚未连接');
    if (this.config.get().permissions.qqSend === false || this.config.get().permissions.qqDynamic === false) {
      throw new Error('QQ 动态发送权限已关闭');
    }
    const content = String(text || '').trim();
    if (!content) throw new Error('动态内容为空');
    if (content.length > 1200) throw new Error('动态正文过长');
    const result = await this.onebot('send_qzone_msg', { content, ugc_right: Number(ugcRight) || 1 });
    this.pushMessage({
      id: id('qqzone'), at: nowIso(), kind: 'qzone', outgoing: true,
      userId: this.status.boundQQ, senderName: '伴行', text: `[QQ动态] ${content.slice(0, 120)}`,
      allowed: true, willReply: false
    });
    return { ok: true, result, content };
  }

  async sendManual({ kind = 'private', targetId, text }) {
    if (!this.running || !this.status.connected) throw new Error('QQ 尚未连接');
    if (!this.config.get().permissions.qqSend) throw new Error('QQ 发送权限已关闭');
    const cfg = this.config.get().qq;
    const idText = String(targetId || '');
    if (kind === 'private') {
      const allowed = (cfg.ownerQQ && String(cfg.ownerQQ) === idText) || (cfg.allowPrivate || []).map(String).includes(idText) || (!(cfg.allowPrivate || []).length && cfg.allowAllWhenEmpty);
      if (!allowed) throw new Error('目标私聊不在白名单');
    } else {
      const allowed = (cfg.allowGroups || []).map(String).includes(idText) || (!(cfg.allowGroups || []).length && cfg.allowAllWhenEmpty);
      if (!allowed) throw new Error('目标群不在白名单');
    }
    await this.sendAuto(kind, idText, String(text || ''));
    return { ok: true, chunks: splitText(text, cfg.maxReplyChars || 900).length };
  }

  async launchSnowLuma() {
    const cfg = this.config.get().qq;
    const launcher = resolveSnowLumaLauncher(cfg.launcherPath);
    if (!launcher) throw new Error('未找到 SnowLuma launcher.bat。请将 SnowLuma 放在 integrations/SnowLuma，或在设置里填写路径。');
    if (!fs.existsSync(launcher)) throw new Error('SnowLuma launcher 不存在');
    const child = spawn('cmd.exe', ['/c', 'start', '', 'launcher.bat'], {
      cwd: path.dirname(launcher),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    this.logger.info('qq', `已请求启动 SnowLuma：${launcher}`);
    return { ok: true, launcher, note: 'SnowLuma 将打开自己的 WebUI。请在浏览器中完成登录与 OneBot 配置。' };
  }

  getRecentMessages() {
    return this.lastMessages.slice(-80);
  }
}

export { extractMessage, splitText };
