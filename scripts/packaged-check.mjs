// 便携 exe 冒烟：CDP 检查页面、内置只读检查、MCP 单文件、插件加载，并截取首页。
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || 9223);
const out = path.resolve('docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });
let target;
for (let i = 0; i < 60; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((item) => item.type === 'page');
    if (target) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 400));
}
if (!target) throw new Error('no CDP target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.text || 'exception');
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed');
  return result.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');
await evaluate('new Promise(r => setTimeout(r, 800))');

const bootstrap = await evaluate(`window.banxing.invoke('app:bootstrap').then(r => ({ok:r.ok, version:r.data?.app?.version, packaged:r.data?.app?.packaged, plugins:r.data?.plugins?.plugins?.map(p=>({id:p.id,status:p.status,tools:p.tools})), memory:r.data?.stats}))`);
console.log('[bootstrap]', JSON.stringify(bootstrap));
console.log('[config-gate]', bootstrap?.ok && bootstrap.packaged && bootstrap.plugins?.some((p) => p.id === 'hermes' && p.status === 'active') && bootstrap.plugins.find((p) => p.id === 'hermes').tools.length >= 4 ? 'PASS' : 'FAIL');

const check = await evaluate(`window.banxing.invoke('check:run').then(r => r.data || r)`);
console.log('[check]', check?.ok === false ? `FAIL ${check.error}` : `exit=${check?.code} chars=${String(check?.output || '').length} conclusion=${/结论：/.test(check?.output || '')}`);
console.log('[check-gate]', check?.code === 0 && /结论：关键文件齐全/.test(check?.output || '') ? 'PASS' : 'FAIL');

const mcpAdd = await evaluate(`window.banxing.invoke('mcp:add', { name:'手机 MCP 自检', transport:'stdio', command:'node', args:['mcp/phone/mcp-phone.bundle.mjs'], enabled:true }).then(r => r)`);
await evaluate('new Promise(r => setTimeout(r, 4000))');
const mcpStatus = await evaluate(`window.banxing.invoke('mcp:get').then(r => r.data)`);
const phoneServer = mcpStatus?.servers?.find((s) => s.name === '手机 MCP 自检');
console.log('[mcp]', JSON.stringify({ ok: mcpAdd?.ok, status: phoneServer?.status, error: phoneServer?.error, tools: phoneServer?.tools }));
console.log('[mcp-gate]', phoneServer?.status === 'running' && phoneServer.tools?.includes('screenshot') ? 'PASS' : 'FAIL');
const remove = await evaluate(`window.banxing.invoke('mcp:remove', { id: '${phoneServer?.id || 'missing'}' }).then(r => r.ok)`);

// 截取干净首页
await evaluate(`document.querySelector('[data-route="home"]').click()`);
await evaluate('new Promise(r => setTimeout(r, 500))');
const screenshot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(out, 'home.png'), Buffer.from(screenshot.data, 'base64'));
console.log('[screenshot]', path.join(out, 'home.png'));

console.log('[errors]', errors.length ? errors.join(' || ') : 'none');
console.log('[result]', !errors.length && phoneServer?.status === 'running' && check?.code === 0 ? 'PASS' : 'FAIL');
await evaluate(`window.banxing.invoke('app:quit')`).catch(() => {});
ws.close();
process.exit(0);
