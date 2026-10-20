import path from 'node:path';
import { paths } from './paths.js';
import { JsonlStore } from './jsonl.js';
import { nowIso, round, truncate } from './utils.js';

function localDay(value) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(value));
  } catch {
    return String(value || '').slice(0, 10);
  }
}

function sumRows(rows) {
  const totals = { calls: 0, prompt: 0, completion: 0, total: 0, cached: 0, cacheMiss: 0, latency: 0, estimated: 0 };
  for (const row of rows) {
    totals.calls += 1;
    totals.prompt += Number(row.promptTokens || 0);
    totals.completion += Number(row.completionTokens || 0);
    totals.total += Number(row.totalTokens || 0);
    totals.cached += Number(row.cachedTokens || 0);
    totals.cacheMiss += Number(row.cacheMissTokens || 0);
    totals.latency += Number(row.latencyMs || 0);
    if (row.estimated) totals.estimated += 1;
  }
  return totals;
}

export class UsageStore {
  constructor({ config, logger, emit = () => {} }) {
    this.config = config;
    this.logger = logger;
    this.emit = emit;
    this.store = new JsonlStore(path.join(paths.data, 'usage', 'events.jsonl'), 'usage');
  }

  record(input = {}) {
    const usage = input.usage || {};
    const record = {
      id: input.id || `usage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      at: input.at || nowIso(),
      day: localDay(input.at || nowIso()),
      role: input.role || 'primary',
      model: input.model || '',
      protocol: input.protocol || 'openai',
      channel: input.context?.channel || 'internal',
      purpose: input.context?.purpose || 'model',
      promptTokens: Number(usage.promptTokens || 0),
      completionTokens: Number(usage.completionTokens || 0),
      totalTokens: Number(usage.totalTokens || 0),
      cachedTokens: Number(usage.cachedTokens || 0),
      cacheMissTokens: Number(usage.cacheMissTokens || 0),
      cacheAvailable: Boolean(usage.cacheAvailable),
      estimated: Boolean(usage.estimated),
      latencyMs: Number(input.latencyMs || 0),
      memoryHits: input.context?.memoryHits || null
    };
    this.store.append(record);
    this.emit('usage:changed', { at: record.at, totalTokens: record.totalTokens, channel: record.channel });
    return record;
  }

  list() {
    return this.store.all();
  }

  clear() {
    this.store.replaceAll([]);
    this.emit('usage:changed', { cleared: true });
  }

  summary({ days = 7 } = {}) {
    const all = this.store.all();
    const today = localDay(nowIso());
    const todayRows = all.filter((row) => row.day === today);
    const totals = sumRows(todayRows);
    const allTotals = sumRows(all);
    const cacheBase = todayRows.filter((row) => row.cacheAvailable);
    const cachePrompt = cacheBase.reduce((sum, row) => sum + Number(row.promptTokens || 0), 0);
    const cacheHit = cacheBase.reduce((sum, row) => sum + Number(row.cachedTokens || 0), 0);
    const cacheHitRate = cacheBase.length && cachePrompt ? round((cacheHit / cachePrompt) * 100, 1) : null;
    const callsWithMemory = todayRows.filter((row) => {
      const hits = row.memoryHits || {};
      return ['knowledge', 'relationship', 'worklogs', 'multimodal'].some((key) => Number(hits[key] || 0) > 0);
    }).length;
    const memoryHitRate = todayRows.length ? round((callsWithMemory / todayRows.length) * 100, 1) : null;
    const last = [...all].reverse().find((row) => row.channel !== 'internal') || all[all.length - 1] || null;
    const contextWindow = Number(this.config.get().models.primary.contextWindow || 64000);
    const byDay = [];
    for (let index = days - 1; index >= 0; index -= 1) {
      const date = new Date(Date.now() - index * 86400000);
      const key = localDay(date);
      const rows = all.filter((row) => row.day === key);
      const dayTotals = sumRows(rows);
      byDay.push({ date: key, calls: dayTotals.calls, prompt: dayTotals.prompt, completion: dayTotals.completion, total: dayTotals.total });
    }
    const group = (rows, key) => {
      const map = new Map();
      for (const row of rows) {
        const name = row[key] || 'unknown';
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(row);
      }
      return [...map.entries()].map(([name, items]) => ({ name, ...sumRows(items) })).sort((a, b) => b.total - a.total);
    };
    const conversations = group(todayRows, 'channel').map((item) => ({
      ...item,
      label: item.name === 'desktop' ? '桌面主对话'
        : String(item.name).startsWith('qq_private_') ? `QQ 私聊 ${String(item.name).slice(11)}`
          : String(item.name).startsWith('qq_group_') ? `QQ 群 ${String(item.name).slice(9)}`
            : item.name
    }));
    return {
      today,
      totals,
      allTotals,
      cacheHitRate,
      cacheHitTokens: cacheHit,
      cacheMissTokens: Math.max(0, cachePrompt - cacheHit),
      cacheAvailable: cacheBase.length > 0,
      memoryHitRate,
      contextWindow,
      lastCall: last ? {
        at: last.at,
        channel: last.channel,
        purpose: last.purpose,
        promptTokens: last.promptTokens,
        totalTokens: last.totalTokens,
        model: last.model
      } : null,
      contextPercent: last ? round((Number(last.promptTokens || 0) / Math.max(1, contextWindow)) * 100, 1) : 0,
      byDay,
      byRole: group(todayRows, 'role'),
      byModel: group(todayRows, 'model'),
      conversations,
      recent: [...all].slice(-30).reverse().map((row) => ({
        id: row.id,
        at: row.at,
        role: row.role,
        model: row.model,
        channel: row.channel,
        purpose: row.purpose,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        totalTokens: row.totalTokens,
        cachedTokens: row.cachedTokens,
        cacheAvailable: row.cacheAvailable,
        estimated: row.estimated,
        latencyMs: row.latencyMs
      })),
      generatedAt: nowIso()
    };
  }
}
