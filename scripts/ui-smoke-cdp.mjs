// 通过 Chrome DevTools Protocol 驱动正在运行的伴行窗口，做离线 UI 冒烟测试。
// 用法：node scripts/ui-smoke-cdp.mjs 9223 http://127.0.0.1:18080
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || 9223);
const outDir = path.resolve('data', 'ui-smoke');
fs.mkdirSync(outDir, { recursive: true });

async function waitForTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('未能连接到 Electron DevTools 端口');
}

const target = await waitForTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params?.exceptionDetails?.text || 'exception');
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    consoleErrors.push(msg.params.args?.map((arg) => arg.value || arg.description).join(' '));
  }
});
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed');
  return result.result?.value;
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  console.log(`[shot] ${file}`);
}

await send('Page.enable');
await send('Runtime.enable');
await evaluate(`new Promise(r => setTimeout(r, 1200))`);

const routes = ['home', 'chat', 'memory', 'growth', 'learning', 'qq', 'devices', 'models', 'plugins', 'settings'];
for (const route of routes) {
  const hasRoute = await evaluate(`Boolean(document.querySelector('[data-route="${route}"]'))`);
  if (!hasRoute) {
    console.log(`[skip] no nav for ${route}`);
    continue;
  }
  await evaluate(`document.querySelector('[data-route="${route}"]').click()`);
  await evaluate(`new Promise(r => setTimeout(r, ${route === 'devices' ? 1600 : 700}))`);
  const title = await evaluate(`document.getElementById('topbar-title')?.textContent`);
  const mainText = await evaluate(`document.getElementById('main')?.innerText?.slice(0, 300)`);
  const width = await evaluate(`JSON.stringify({innerWidth, scrollWidth: document.documentElement.scrollWidth, mainWidth: document.getElementById('main')?.clientWidth})`);
  console.log(`[route] ${route} · ${title} · ${width}`);
  console.log(`  ${String(mainText || '').replace(/\n/g, ' | ').slice(0, 180)}`);
  await shot(route);
}

// 主对话：普通回复
await evaluate(`document.querySelector('[data-route="chat"]').click()`);
await evaluate(`new Promise(r => setTimeout(r, 500))`);
await evaluate(`(() => { const input = document.getElementById('chat-input'); input.value = '你好，介绍一下你自己'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-form="chat"]').requestSubmit(); return true; })()`);
await evaluate(`new Promise(r => setTimeout(r, 3500))`);
const assistantText = await evaluate(`[...document.querySelectorAll('.msg:not(.user):not(.system) .bubble')].at(-1)?.innerText || ''`);
console.log(`[chat] ${String(assistantText).slice(0, 180)}`);
await shot('chat-reply');

// 工具调用：手机状态
await evaluate(`(() => { const input = document.getElementById('chat-input'); input.value = '帮我看看手机现在的状态'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-form="chat"]').requestSubmit(); return true; })()`);
await evaluate(`new Promise(r => setTimeout(r, 6000))`);
const toolText = await evaluate(`[...document.querySelectorAll('.msg:not(.user):not(.system) .bubble')].at(-1)?.innerText || ''`);
const toolTrace = await evaluate(`document.getElementById('chat-tool-trace')?.innerText || ''`);
console.log(`[tool] ${String(toolText).slice(0, 180)}`);
console.log(`[tool-trace] ${String(toolTrace).replace(/\n/g, ' | ').slice(0, 180)}`);
await shot('chat-tool');
const junkKnowledge = await evaluate(`window.banxing.invoke('memory:overview').then(r => (r.data?.knowledge || []).filter(k => /手机现在的状态|帮我看看/.test(k.title)).length)`);
console.log(`[auto-research-guard] ${junkKnowledge === 0 ? 'PASS 日常指令未误归档' : 'FAIL 产生了无关知识'}`);

// 高权重陪伴事件
await evaluate(`(() => { const input = document.getElementById('chat-input'); input.value = '我累了'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-form="chat"]').requestSubmit(); return true; })()`);
await evaluate(`new Promise(r => setTimeout(r, 3200))`);
const weightState = await evaluate(`window.banxing.invoke('weights:get').then(r => r.data)`);
const lastWeightEvent = weightState?.history?.at(-1);
const tiredBubble = await evaluate(`[...document.querySelectorAll('.msg:not(.user):not(.system) .bubble')].at(-1)?.innerText || ''`);
console.log(`[weights] 工作 ${weightState?.normalized?.work}% / 陪伴 ${weightState?.normalized?.companion}% · ${weightState?.mode?.label} · 事件 ${lastWeightEvent?.eventType}`);
console.log(`[weights-check] ${weightState?.raw?.companion > weightState?.raw?.work && lastWeightEvent?.eventType === 'companion_event' ? 'PASS 陪伴线即时越位' : 'FAIL'}`);
console.log(`[tired-reply] ${String(tiredBubble).slice(0, 100)}`);
await shot('chat-tired');

// 记忆新增
await evaluate(`document.querySelector('[data-route="memory"]').click()`);
await evaluate(`new Promise(r => setTimeout(r, 700))`);
await evaluate(`document.querySelector('[data-action="open-add-knowledge"]').click()`);
await evaluate(`new Promise(r => setTimeout(r, 300))`);
await evaluate(`(() => {
  const form = document.querySelector('[data-form="add-knowledge"]');
  form.querySelector('[name="title"]').value = 'UI 冒烟测试事实';
  form.querySelector('[name="content"]').value = '这条记录由 UI 冒烟测试写入临时工作目录，用于验证知识表单与召回。';
  form.querySelector('[name="tags"]').value = '测试,UI';
  form.querySelector('[name="sourceUrls"]').value = 'https://example.com/ui-smoke';
  form.requestSubmit(); return true;
})()`);
await evaluate(`new Promise(r => setTimeout(r, 1600))`);
const memoryText = await evaluate(`document.getElementById('main')?.innerText?.slice(0, 1200)`);
console.log(`[memory] ${/UI 冒烟测试事实/.test(memoryText) ? '表单写入并显示成功' : '未看到新增知识'}`);
await shot('memory-added');

// 设置页：内置只读检查
await evaluate(`document.querySelector('[data-route="settings"]').click()`);
await evaluate(`new Promise(r => setTimeout(r, 500))`);
await evaluate(`document.querySelector('[data-action="run-check"]').click()`);
await evaluate(`new Promise(r => setTimeout(r, 12000))`);
const checkText = await evaluate(`document.getElementById('check-output')?.innerText || ''`);
console.log(`[check] ${/结论：/.test(checkText) ? 'PASS 内置只读检查返回结论' : 'FAIL 无结论'} · 长度 ${checkText.length}`);
await shot('check');

console.log(`[errors] ${consoleErrors.length ? consoleErrors.join(' || ') : 'none'}`);
console.log(`[result] ${consoleErrors.length || junkKnowledge !== 0 || !(weightState?.raw?.companion > weightState?.raw?.work) ? 'FAIL' : 'PASS'}`);
ws.close();
process.exit(consoleErrors.length ? 1 : 0);
