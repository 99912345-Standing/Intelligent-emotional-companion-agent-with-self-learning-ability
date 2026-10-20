import dns from 'node:dns/promises';
import net from 'node:net';
import { clamp, domainOf, isPrivateHost, stripHtml, truncate } from './utils.js';
import { isSafeContent } from './content-policy.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 BanxingResearch/1.0';

function decodeEntities(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function parseRss(xml) {
  const items = [];
  const blocks = String(xml || '').match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const pick = (tag) => {
      const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      return match ? decodeEntities(match[1]).trim() : '';
    };
    const title = pick('title');
    const url = pick('link');
    const snippet = pick('description');
    if (url && title) items.push({ title, url, snippet: stripHtml(snippet).slice(0, 500), provider: 'bing' });
  }
  return items;
}

function parseDuckHtml(html) {
  const results = [];
  const blocks = String(html || '').match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  for (const block of blocks) {
    const link = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    let url = decodeEntities(link[1]);
    try {
      const parsed = new URL(url, 'https://duckduckgo.com');
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) url = decodeURIComponent(uddg);
    } catch {}
    const snippet = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block)?.[1] || '';
    results.push({
      title: stripHtml(decodeEntities(link[2])),
      url,
      snippet: stripHtml(decodeEntities(snippet)).slice(0, 500),
      provider: 'duckduckgo'
    });
  }
  return results;
}

function parseBingHtml(html) {
  const results = [];
  const blocks = String(html || '').match(/<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/gi) || [];
  for (const block of blocks) {
    const link = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] || '';
    results.push({
      title: stripHtml(decodeEntities(link[2])),
      url: decodeEntities(link[1]),
      snippet: stripHtml(decodeEntities(snippet)).slice(0, 500),
      provider: 'bing-html'
    });
  }
  return results;
}

function parseDuckLite(html) {
  const results = [];
  const rows = String(html || '').match(/<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi) || [];
  for (const row of rows) {
    const match = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (match) results.push({
      title: stripHtml(decodeEntities(match[2])),
      url: decodeEntities(match[1]),
      snippet: '',
      provider: 'duckduckgo-lite'
    });
  }
  return results;
}

function readableHtml(html) {
  let value = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const article = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(value)?.[1]
    || /<main[^>]*>([\s\S]*?)<\/main>/i.exec(value)?.[1]
    || value;
  return stripHtml(article)
    .replace(/^(Skip to content|跳到主要内容|导航|菜单|首页)[\s\S]{0,160}/i, '')
    .replace(/\b(?:cookie|订阅|登录|注册|广告|分享到|阅读原文)\b[^\n]{0,80}/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function normalizeResults(items, limit) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.url || !item?.title) return false;
    if (!/^https?:\/\//i.test(item.url)) return false;
    if (!isSafeContent(`${item.title} ${item.snippet || ''} ${item.url}`)) return false;
    const key = item.url.replace(/[#?].*$/, '').replace(/\/+$/, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit).map((item, index) => ({ ...item, rank: index + 1 }));
}

function parseBaiduHtml(html) {
  const results = [];
  const blocks = String(html || '').match(/<div[^>]+class="[^"]*result[^"]*c-container[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  for (const block of blocks) {
    const link = /<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const snippet = /<span[^>]+class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1]
      || /<div[^>]+class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] || '';
    results.push({
      title: stripHtml(decodeEntities(link[2])),
      url: decodeEntities(link[1]),
      snippet: stripHtml(decodeEntities(snippet)).slice(0, 500),
      provider: 'baidu'
    });
  }
  return results;
}

function parseSogouHtml(html) {
  const results = [];
  const blocks = String(html || '').match(/<div[^>]+class="[^"]*vrwrap[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  for (const block of blocks) {
    const link = /<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const snippet = /<div[^>]+class="[^"]*text-layout[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] || '';
    results.push({
      title: stripHtml(decodeEntities(link[2])),
      url: decodeEntities(link[1]),
      snippet: stripHtml(decodeEntities(snippet)).slice(0, 500),
      provider: 'sogou'
    });
  }
  return results;
}

function parseSearx(json) {
  return (json?.results || []).map((item) => ({
    title: String(item.title || ''),
    url: String(item.url || ''),
    snippet: stripHtml(String(item.content || '')).slice(0, 500),
    provider: 'searxng'
  })).filter((item) => item.title && item.url);
}

async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error('只允许 http/https');
  if (isPrivateHost(url.hostname)) throw new Error('拒绝访问本机或内网地址');
  if (net.isIP(url.hostname)) {
    if (isPrivateHost(url.hostname)) throw new Error('拒绝访问内网 IP');
    return url;
  }
  let addresses = [];
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`域名解析失败：${error.code || error.message}`);
  }
  if (!addresses.length) throw new Error('域名没有可用地址');
  for (const address of addresses) {
    if (isPrivateHost(address.address)) throw new Error('域名解析到了内网地址，已拦截');
  }
  return url;
}

export class WebSearch {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async search(query, { count = null } = {}) {
    const cfg = this.config.get().search;
    if (this.config.get().permissions.webSearch === false) throw new Error('联网搜索权限已关闭');
    const limit = count || cfg.maxResults || 6;
    const selected = Array.isArray(cfg.providers) && cfg.providers.length
      ? cfg.providers
      : [cfg.provider || 'bing', 'duckduckgo', 'wikipedia'];
    const factories = {
      bing: () => this.searchBing(query, limit),
      duckduckgo: () => this.searchDuckDuckGo(query, limit),
      wikipedia: () => this.searchWikipedia(query, limit),
      baidu: () => this.searchBaidu(query, limit),
      sogou: () => this.searchSogou(query, limit),
      searxng: () => cfg.searxngUrl ? this.searchSearx(query, limit) : Promise.reject(new Error('SearXNG URL 未配置'))
    };
    const providers = [...new Set(selected)].map((name) => factories[name]).filter(Boolean);
    const settled = await Promise.allSettled(providers.map((fn) => fn()));
    const results = [];
    const errors = [];
    for (const item of settled) {
      if (item.status === 'fulfilled') results.push(...item.value);
      else errors.push(item.reason?.message || String(item.reason));
    }
    const merged = normalizeResults(results, limit);
    if (!merged.length) {
      throw new Error(`搜索没有返回结果${errors.length ? `：${errors.slice(0, 3).join('；')}` : '，请换一个更具体的关键词'}`);
    }
    return merged;
  }

  async searchBing(query, limit) {
    const timeout = Number(this.config.get().search.timeoutMs || 18000);
    const rssUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&cc=CN&setlang=zh-Hans&count=${limit}`;
    const rss = await fetch(rssUrl, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(timeout)
    });
    if (rss.ok) {
      const text = await rss.text();
      const items = parseRss(text);
      if (items.length) return normalizeResults(items, limit);
    }
    const html = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=CN&setlang=zh-Hans&count=${limit}`, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(timeout)
    });
    if (!html.ok) throw new Error(`Bing 搜索 HTTP ${html.status}`);
    return normalizeResults(parseBingHtml(await html.text()), limit);
  }

  async searchDuckDuckGo(query, limit) {
    const timeout = Number(this.config.get().search.timeoutMs || 18000);
    const html = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(timeout)
    });
    if (html.ok) {
      const items = parseDuckHtml(await html.text());
      if (items.length) return normalizeResults(items, limit);
    }
    const lite = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(timeout)
    });
    if (!lite.ok) throw new Error(`DuckDuckGo HTTP ${lite.status}`);
    return normalizeResults(parseDuckLite(await lite.text()), limit);
  }

  async searchBaidu(query, limit) {
    const timeout = Number(this.config.get().search.timeoutMs || 18000);
    const response = await fetch(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${limit}`, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(timeout)
    });
    if (!response.ok) throw new Error(`Baidu HTTP ${response.status}`);
    return normalizeResults(parseBaiduHtml(await response.text()), limit);
  }

  async searchSogou(query, limit) {
    const timeout = Number(this.config.get().search.timeoutMs || 18000);
    const response = await fetch(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(timeout)
    });
    if (!response.ok) throw new Error(`Sogou HTTP ${response.status}`);
    return normalizeResults(parseSogouHtml(await response.text()), limit);
  }

  async searchWikipedia(query, limit) {
    const url = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=${Math.min(5, limit)}`;
    const response = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
    const json = await response.json();
    return normalizeResults((json?.query?.search || []).map((item) => ({
      title: String(item.title || ''),
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(item.title || '')}`,
      snippet: stripHtml(String(item.snippet || '')).slice(0, 500),
      provider: 'wikipedia'
    })), limit);
  }

  async searchSearx(query, limit) {
    const base = String(this.config.get().search.searxngUrl || '').replace(/\/+$/, '');
    const response = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN&safesearch=1`, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(18000)
    });
    if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
    const json = await response.json();
    return parseSearx(json).slice(0, limit).map((item, index) => ({ ...item, rank: index + 1 }));
  }

  async searchMany(queries, { countPerQuery = 4 } = {}) {
    const settled = await Promise.allSettled(queries.map((query) => this.search(query, { count: countPerQuery })));
    const results = [];
    const errors = [];
    for (const item of settled) {
      if (item.status === 'fulfilled') results.push(...item.value);
      else errors.push(item.reason?.message || String(item.reason));
    }
    const seen = new Set();
    return {
      results: results.filter((result) => {
        const key = result.url.replace(/[#?].*$/, '').replace(/\/+$/, '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
      errors
    };
  }

  async fetchReadable(rawUrl, { maxChars = null } = {}) {
    const cfg = this.config.get().search;
    let current = rawUrl;
    let response = null;
    for (let redirect = 0; redirect < 4; redirect += 1) {
      const url = await assertPublicUrl(current);
      response = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6'
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(Number(cfg.timeoutMs || 18000))
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('重定向缺少 Location');
        current = new URL(location, url).toString();
        continue;
      }
      break;
    }
    if (!response) throw new Error('抓取失败');
    if (!response.ok) throw new Error(`页面 HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!/(text\/html|text\/plain|application\/xhtml)/.test(contentType)) {
      throw new Error(`不支持的内容类型：${contentType || 'unknown'}`);
    }
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 3 * 1024 * 1024) throw new Error('页面过大');
    const html = await response.text();
    if (html.length > 3 * 1024 * 1024) throw new Error('页面内容过大');
    const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || domainOf(current)).trim();
    const description = decodeEntities(
      /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ||
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i.exec(html)?.[1] ||
      ''
    ).trim();
    const publishedAt = /(?:datePublished|article:published_time|pubdate|publishdate)["'\s:=]+([0-9T:+\-.Z/]{8,40})/i.exec(html)?.[1] || null;
    const pickMeta = (names) => {
      for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const first = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i').exec(html)?.[1];
        const second = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i').exec(html)?.[1];
        if (first || second) return decodeEntities(first || second).trim();
      }
      return '';
    };
    const videoRaw = pickMeta(['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream'])
      || /<video[^>]+src=["']([^"']+)["']/i.exec(html)?.[1] || '';
    let videoUrl = '';
    try { if (videoRaw) videoUrl = new URL(videoRaw, current).toString(); } catch {}
    const imageRaw = pickMeta(['og:image:secure_url', 'og:image', 'twitter:image']);
    let imageUrl = '';
    try { if (imageRaw) imageUrl = new URL(imageRaw, current).toString(); } catch {}
    const durationRaw = pickMeta(['video:duration', 'og:video:duration']);
    const duration = Number(durationRaw || 0) || null;
    let text = readableHtml(html);
    const limit = Number(maxChars || cfg.maxPageChars || 6000);
    if (text.length > limit) {
      // 尽量保留与开头、结尾都有关的信息，而不是只截取导航栏。
      text = `${text.slice(0, Math.floor(limit * 0.72))}\n…\n${text.slice(-Math.floor(limit * 0.28))}`;
    }
    return {
      url: current,
      finalUrl: current,
      title: title.slice(0, 200),
      description: description.slice(0, 500),
      publishedAt,
      videoUrl,
      imageUrl,
      duration,
      text,
      domain: domainOf(current),
      fetchedAt: new Date().toISOString(),
      chars: text.length
    };
  }

  async downloadMedia(rawUrl, { maxMb = 80 } = {}) {
    const url = await assertPublicUrl(rawUrl);
    const response = await fetch(url, {
      headers: { 'user-agent': UA, accept: '*/*', referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`媒体下载 HTTP ${response.status}`);
    const type = String(response.headers.get('content-type') || '');
    if (/mpegurl|m3u8/i.test(type) || /\.m3u8($|\?)/i.test(url.href)) throw new Error('这是流媒体 m3u8，暂不下载；可保存元数据');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxMb * 1024 * 1024) throw new Error(`媒体超过 ${maxMb}MB`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxMb * 1024 * 1024) throw new Error(`媒体超过 ${maxMb}MB`);
    return { buffer, mime: type || 'application/octet-stream', url: url.href };
  }

  async fetchMany(results, { limit = null } = {}) {
    const cfg = this.config.get().search;
    const top = results.slice(0, limit || cfg.fetchTop || 4);
    const settled = await Promise.allSettled(top.map((result) => this.fetchReadable(result.url)));
    return settled.map((item, index) => {
      if (item.status === 'fulfilled') {
        return { ...top[index], ...item.value, ok: true };
      }
      return { ...top[index], ok: false, error: item.reason?.message || String(item.reason) };
    });
  }
}

export { assertPublicUrl };
