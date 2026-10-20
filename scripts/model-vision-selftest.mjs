// 多模态能力探测自检：真实发图、reasoning_content、max_tokens 不截断。
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-vision-test-${Date.now()}`);
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
let sawImage = false;
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || '{}');
  const hasImage = JSON.stringify(body.messages || []).includes('image_url');
  sawImage ||= hasImage;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    choices: [{
      message: hasImage
        ? { content: '', reasoning_content: '图上数字是 42' }
        : { content: 'OK' }
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
  }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const logger = new Logger();
const config = new ConfigManager(logger);
config.save({
  models: {
    primary: {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'test',
      model: 'deepseek-v4.1-flash',
      protocol: 'openai'
    }
  }
});
const client = new ModelClient(config, logger);
const caps = await client.test('primary', { multimodal: true });
check('多模态探测确实发送了 image_url', sawImage);
check('reasoning_content 中的 42 也能判定视觉通过', caps.vision === true, caps.visionDetail);
check('视觉详情会记录回答', /42/.test(caps.visionDetail || ''), caps.visionDetail);
server.close();
console.log('\n多模态能力探测自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
