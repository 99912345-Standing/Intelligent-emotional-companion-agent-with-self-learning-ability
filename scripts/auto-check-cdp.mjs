// 验证启动自动只读检查与批量过时复核 IPC。
import fs from 'node:fs';

const port = Number(process.argv[2] || 9223);
let target;
for (let i = 0; i < 60; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((item) => item.type === 'page');
    if (target) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (!target) throw new Error('no target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'eval failed');
  return result.result?.value;
};
await send('Runtime.enable');
await evaluate('new Promise(r => setTimeout(r, 20000))');
const config = await evaluate(`window.banxing.invoke('app:bootstrap').then(r => r.data?.config?.app)`);
await evaluate(`document.querySelector('[data-route="settings"]').click()`);
await evaluate('new Promise(r => setTimeout(r, 700))');
const checkText = await evaluate(`document.getElementById('check-output')?.innerText || ''`);
const status = await evaluate(`document.querySelector('[data-action="run-check"]')?.className || ''`);
console.log('[config]', JSON.stringify(config));
console.log('[auto-check]', checkText.includes('退出码') ? 'PASS 启动后已自动产生检查结果' : 'FAIL');
console.log('[auto-check-badge]', status.includes('is-busy') ? 'still-running' : 'idle');
console.log('[auto-check-tail]', JSON.stringify(checkText.slice(-180)));
const staleResult = await evaluate(`window.banxing.invoke('memory:revalidateStale', { limit: 2 }).then(r => r)`);
console.log('[stale-ipc]', JSON.stringify(staleResult));
console.log('[result]', config?.checkOnStart !== false && checkText.includes('退出码') && staleResult?.ok ? 'PASS' : 'FAIL');
await evaluate(`window.banxing.invoke('app:quit')`).catch(() => {});
ws.close();
process.exit(0);
