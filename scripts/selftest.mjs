// 伴行集成自检：不依赖 Electron，不连接真实 QQ/手机，不写入正式记忆。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = process.env.BANXING_HOME || path.join(os.tmpdir(), `banxing-selftest-${Date.now()}`);
const { initPaths, paths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { WeightEngine } = await import('../src/main/weights.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { ModelClient } = await import('../src/main/models.js');
const { pathToFileURL } = await import('node:url');

let pass = 0; let fail = 0;
const results = [];
function check(name, condition, detail = '') {
  if (condition) { pass += 1; results.push(`✓ ${name}`); }
  else { fail += 1; results.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
}

// 1) 纯函数/权重
const logger = new Logger();
const config = new ConfigManager(logger);
const weights = new WeightEngine(config, logger);
weights.updateFromMessage('帮我整理一下项目报告', { channel: 'selftest' });
const beforeTired = weights.getState();
const afterTired = weights.updateFromMessage('我累了', { channel: 'selftest' });
check('连续权重会随工作信号移动', beforeTired.raw.work > 0.36 && beforeTired.raw.work > beforeTired.baseline.work, JSON.stringify(beforeTired.raw));
check('“我累了”后陪伴权重高于工作权重', afterTired.raw.companion > afterTired.raw.work, JSON.stringify(afterTired.raw));
check('高权重事件被标记', afterTired.lastEvent?.eventType === 'companion_event', afterTired.lastEvent?.eventType);
check('双轨同时激活', Math.min(afterTired.raw.work, afterTired.raw.companion) > 0.07, JSON.stringify(afterTired.raw));

// 2) 分层记忆
const memory = new MemoryEngine(config, logger);
const fact = memory.saveKnowledge({
  title: '伴行自检事实',
  content: '这是一条只在自检临时目录存在的测试事实，核验于今天。',
  tags: ['自检', '临时'],
  sources: [{ url: 'https://example.com/self-test', title: 'Example Self Test', score: 0.8 }],
  confidence: 0.82,
  status: 'active'
});
check('知识写入并可按查询召回', memory.searchKnowledge('伴行自检事实').some((item) => item.id === fact.id));
check('知识保留核验时间和来源', Boolean(fact.verifiedAt) && fact.sources.length === 1);
memory.updateKnowledge(fact.id, { content: '修订后的自检事实', reason: 'selftest' });
check('知识修订保留 revisions', memory.findKnowledgeById(fact.id).revisions.length === 1);
const oldFact = memory.saveKnowledge({
  title: '过时自检事实',
  content: '这条事实的核验时间被故意设置得很早，用于验证时效标记。',
  sources: [{ url: 'https://example.com/old', title: 'old' }],
  confidence: 0.8,
  status: 'active',
  verifiedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  staleAfterDays: 1
});
memory.markStaleEntries();
check('过时知识被标记且搜索返回 stale', memory.isStale(memory.findKnowledgeById(oldFact.id)) && memory.searchKnowledge('过时自检事实')[0]?.stale === true);
check('日常指令不会误触发自动查证', memory.mayNeedResearch('帮我看看手机现在的状态') === false);
check('明确事实问题会触发自动查证', memory.mayNeedResearch('SnowLuma 最新版本是多少？') === true);
const rel = memory.extractRelationshipFacts('我喜欢在晚上听爵士乐。', { source: 'selftest' });
check('偏好被抽取到关系记忆', rel.length > 0 && memory.searchRelationship('爵士乐').length > 0);
const touched = memory.touchWork('selftest', '帮我完成一个自检报告');
const archived = await memory.archiveWork('selftest', { reason: 'selftest', force: true, result: '完成' });
check('工作轨迹可归档为日志', Boolean(touched && archived?.summary));
const media = await memory.saveMedia({
  buffer: Buffer.from('selftest-media'),
  kind: 'file', mime: 'text/plain', fileName: 'selftest.txt', caption: '自检附件', source: 'selftest'
});
check('多模态文件写入并保留路径', fs.existsSync(media.file) && memory.listMultimodal().some((item) => item.id === media.id));
const context = memory.buildContext('自检事实');
check('上下文聚合关系/知识/工作', context.text.includes('关系记忆') && context.text.includes('知识库'));

// 3) OpenAI 兼容模型（本地 mock，含视觉测试图识别）
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch {}
    const messages = payload.messages || [];
    const last = messages[messages.length - 1] || {};
    const contentText = JSON.stringify(last.content || '');
    const hasImage = /image_url|data:image/.test(contentText);
    const hasToolResult = messages.some((message) => message.role === 'tool');
    let content = 'OK';
    let toolCalls = null;
    if (hasImage) content = '42';
    else if (payload.tools && !hasToolResult && /手机|工具测试/.test(JSON.stringify(messages))) {
      toolCalls = [{ id: 'call_test_1', type: 'function', function: { name: 'phone_status', arguments: '{}' } }];
      content = '';
    } else if (hasToolResult) content = '手机工具已经可用（自检模拟结果）。';
    else if (/只用一句话介绍伴行/.test(contentText)) content = '伴行是一个把工作推进与情感陪伴放在同一组连续权重上的本地 AI 智能体。';
    else content = 'OK';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
      model: payload.model || 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }));
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const port = mock.address().port;
config.save({ models: { primary: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key', model: 'mock-vision', protocol: 'openai' } } });
const model = new ModelClient(config, logger);
const caps = await model.test('primary', { multimodal: true });
check('模型连通性测试通过', caps.text === true, JSON.stringify(caps));
check('多模态测试图被正确识别', caps.vision === true, caps.visionDetail);
const answer = await model.simple('primary', '只用一句话介绍伴行', { maxTokens: 100 });
check('模型普通对话返回内容', /伴行/.test(answer), answer);
mock.close();

// 4) MCP 单文件服务可启动并暴露手机工具（不要求有设备）
try {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const bundle = path.join(process.cwd(), 'mcp', 'phone', 'mcp-phone.bundle.mjs');
  if (fs.existsSync(bundle)) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundle],
      env: { ...process.env, BANXING_HOME: paths.root, ADB_PATH: path.join(process.cwd(), 'tools', 'platform-tools', 'adb.exe') },
      stderr: 'pipe'
    });
    const client = new Client({ name: 'selftest', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    check('mcp-phone 单文件可启动', tools.tools.some((tool) => tool.name === 'screenshot'), tools.tools.map((tool) => tool.name).join(','));
    await client.close();
  } else {
    check('mcp-phone 单文件存在（需先 npm run build:mcp）', false);
  }
} catch (error) {
  check('mcp-phone 单文件可启动', false, error.message);
}

// 5) 只读检查脚本
try {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const script = path.join(process.cwd(), '检查环境-只读.bat');
  const output = await run('cmd.exe', ['/d', '/s', '/c', script, process.cwd(), '--no-pause'], { cwd: process.cwd(), encoding: 'utf8', timeout: 90000 });
  check('独立只读检查脚本可运行并在结论中报告', /结论：/.test(output.stdout), output.stdout.slice(-200));
  check('只读检查报告关键文件', /qq-bridge 上游源码/.test(output.stdout) && /手机 MCP/.test(output.stdout));
  check('只读检查没有 cmd 伪错误', !String(output.stderr || '').trim(), String(output.stderr || '').slice(0, 200));
} catch (error) {
  check('独立只读检查脚本可运行', false, error.message);
}

console.log('\n伴行自检结果\n' + '─'.repeat(60));
console.log(results.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
console.log(`临时工作目录：${paths.root}`);
process.exit(fail ? 1 : 0);
