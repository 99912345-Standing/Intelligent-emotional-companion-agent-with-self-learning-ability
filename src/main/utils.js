import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const nowIso = () => new Date().toISOString();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const round = (n, digits = 2) => Number(Number(n).toFixed(digits));
export const id = (prefix = '') => `${prefix}${prefix ? '_' : ''}${crypto.randomUUID()}`;
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const shortHash = (value, length = 12) => sha256(value).slice(0, length);

export function truncate(value, max = 2000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}\n…[已截断 ${text.length - max} 字]` : text;
}

export function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const direct = safeJson(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) return safeJson(cleaned.slice(start, end + 1));
  return null;
}

export function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function atomicWriteText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, value, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readJson(filePath, fallback = null) {
  try {
    let text = fs.readFileSync(filePath, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function deepMerge(base, patch) {
  if (patch === undefined) return base;
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function redact(value) {
  return String(value ?? '')
    .replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1••••')
    .replace(/((?:api[_-]?key|token|accessToken|authorization)\s*["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi, '$1••••')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1••••');
}

export function maskSecret(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (text.length <= 8) return '已保存';
  return `${text.slice(0, 3)}••••${text.slice(-4)}`;
}

export function normalizeUrl(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  return text.replace(/\/+$/, '');
}

export function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '0.0.0.0' || host === '::') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

const STOPWORDS = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '和', '与', '及', '就', '也', '都', '而', '被', '把', '对', '中', '上', '下', '吗', '呢', '啊', '呀', '这', '那', '一个', '什么', '怎么', '可以', '需要', 'the', 'a', 'an', 'is', 'are', 'of', 'to', 'and', 'or']);

export function tokenize(text) {
  const value = String(text ?? '').toLowerCase();
  const tokens = [];
  const chunks = value.match(/[\u3400-\u9fff]+|[a-z0-9][a-z0-9_.+-]*/g) || [];
  for (const chunk of chunks) {
    if (/^[a-z0-9]/.test(chunk)) {
      if (!STOPWORDS.has(chunk) && chunk.length > 1) tokens.push(chunk);
      continue;
    }
    const chars = [...chunk].filter((char) => !STOPWORDS.has(char));
    for (let i = 0; i < chars.length; i += 1) {
      tokens.push(chars[i]);
      if (i < chars.length - 1) tokens.push(chars[i] + chars[i + 1]);
    }
  }
  return tokens;
}

export function overlapScore(queryTokens, textTokens) {
  if (!queryTokens.length || !textTokens.length) return 0;
  const set = new Set(textTokens);
  let hit = 0;
  let weight = 0;
  for (const token of new Set(queryTokens)) {
    if (set.has(token)) {
      hit += 1;
      weight += token.length > 1 ? 1.4 : 0.55;
    }
  }
  const coverage = hit / Math.max(1, new Set(queryTokens).size);
  return Math.min(1, coverage * 0.72 + Math.min(1, weight / 7) * 0.28);
}

export function recencyScore(timestamp, halfLifeDays = 30) {
  const time = Date.parse(timestamp || '');
  if (!Number.isFinite(time)) return 0.25;
  const days = Math.max(0, (Date.now() - time) / 86400000);
  return Math.pow(0.5, days / halfLifeDays);
}

export function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

export function toIsoSafe(value, fallback = null) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|section|article|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function fileNameSafe(value, fallback = 'file') {
  const cleaned = String(value ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, 120);
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function pickTop(items, n) {
  return [...items].sort((a, b) => b.score - a.score).slice(0, n);
}
