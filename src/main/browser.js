import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertPublicUrl } from './websearch.js';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connect(wsUrl, expression, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      reject(new Error('浏览器页面读取超时'));
    }, timeoutMs);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      fn(value);
    };
    socket.onopen = () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    };
    socket.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.id !== 1) return;
      const result = data.result?.result;
      if (data.result?.exceptionDetails) return finish(reject, new Error(String(data.result.exceptionDetails.text || '页面脚本失败')));
      finish(resolve, result?.value ?? null);
    };
    socket.onerror = () => finish(reject, new Error('浏览器 CDP 连接失败'));
  });
}

export class BrowserCrawler {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  findBrowser() {
    const configured = String(this.config.get().search?.browserPath || '').trim();
    const list = configured ? [configured, ...CANDIDATES] : CANDIDATES;
    return list.find((file) => file && fs.existsSync(file)) || '';
  }

  async crawl(rawUrl, { timeoutMs = 35000 } = {}) {
    const url = await assertPublicUrl(rawUrl);
    const exe = this.findBrowser();
    if (!exe) throw new Error('没有找到 Edge / Chrome；可在设置里填写浏览器路径');
    const port = 9300 + Math.floor(Math.random() * 400);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'banxing-browser-'));
    const child = spawn(exe, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      url.href
    ], { windowsHide: true, stdio: 'ignore' });
    try {
      let page = null;
      for (let i = 0; i < 30; i += 1) {
        await delay(500);
        try {
          const list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) })).json();
          page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
          if (page) break;
        } catch {}
      }
      if (!page) throw new Error('浏览器没有打开调试页面');
      await delay(1200);
      const expression = `(() => {
        const videos = [...document.querySelectorAll('video')].slice(0, 8).map((video) => ({
          src: video.currentSrc || video.src || '',
          poster: video.poster || '',
          duration: Number(video.duration || 0) || null
        }));
        const links = [...document.querySelectorAll('a[href]')].slice(0, 120).map((a) => ({ text: (a.innerText || '').trim().slice(0, 120), url: a.href })).filter((x) => x.text && /^https?:/.test(x.url));
        return {
          title: document.title || '',
          url: location.href,
          text: (document.body?.innerText || '').slice(0, 120000),
          videos,
          links
        };
      })()`;
      const result = await connect(page.webSocketDebuggerUrl, expression, timeoutMs);
      if (!result) throw new Error('浏览器没有返回页面内容');
      return { ok: true, ...result, browser: exe, engine: 'chromium-headless' };
    } finally {
      try { child.kill(); } catch {}
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    }
  }
}
