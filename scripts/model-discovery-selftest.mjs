// 模型自动探测自检：URL + Key → /models，不手输模型名。
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-model-discovery-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { ModelClient } = await import('../src/main/models.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};
let lastAuth = '';
const server = http.createServer((req, res) => {
  lastAuth = String(req.headers.authorization || req.headers['x-api-key'] || '');
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', input_modalities: ['text', 'image'] },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', input_modalities: ['text'] }
      ]
    }));
    return;
  }
  if (req.url === '/anthropic/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'claude-3-5-sonnet' }] }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'not found' } }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const logger = new Logger();
const config = new ConfigManager(logger);
const client = new ModelClient(config, logger);

const discovered = await client.discoverModels({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-test', protocol: 'openai' });
check('OpenAI 兼容端点可通过 URL+Key 探测模型', discovered.ok && discovered.models.includes('deepseek-flash') && discovered.models.includes('deepseek-v4-pro'), JSON.stringify(discovered));
check('探测结果保留 input_modalities 视觉元数据', discovered.items.find((item) => item.id === 'deepseek-flash')?.vision === true, JSON.stringify(discovered.items));
check('探测请求携带 Bearer Key', lastAuth === 'Bearer sk-test', lastAuth);
const anthropic = await client.discoverModels({ baseUrl: `http://127.0.0.1:${port}/anthropic/v1`, apiKey: 'ak-test', protocol: 'anthropic' });
check('Anthropic 端点也可探测模型', anthropic.ok && anthropic.models[0] === 'claude-3-5-sonnet', JSON.stringify(anthropic));
let failed = false;
try { await client.discoverModels({ baseUrl: `http://127.0.0.1:${port}/missing`, apiKey: 'x', protocol: 'openai' }); } catch { failed = true; }
check('不可用端点会明确报错而不是编造模型', failed);
server.close();
console.log('\n模型自动探测自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
