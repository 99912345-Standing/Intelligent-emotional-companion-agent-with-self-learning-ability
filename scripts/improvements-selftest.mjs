// 本轮修复自检：后台泄漏、长度、缓存前缀、工具权限、记忆分层、Hermes、表情包。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-improve-test-${Date.now()}`);
const { initPaths, paths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { WeightEngine } = await import('../src/main/weights.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { Agent, sanitizeReply, trimReply } = await import('../src/main/agent.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};
const logger = new Logger();
const config = new ConfigManager(logger);
config.save({ models: { primary: { model: 'deepseek-flash', capabilities: { text: true, tools: false, checkedAt: new Date().toISOString() } } } });
const memory = new MemoryEngine(config, logger);
const weights = new WeightEngine(config, logger);
const agent = new Agent({
  config, logger, memory, weights,
  model: { available: () => true },
  webSearch: { fetchReadable: async () => ({ title: 't', finalUrl: 'u', text: 'p' }) },
  learning: {}, conversations: {}, qq: { status: {}, stickerCatalog: () => [] },
  phone: null, computer: null, mcp: { getTools: () => [] }, plugins: { getTools: () => [] },
  persona: { promptBlock: () => '【角色】稳定', renderMemoryEvidence: () => ({}) },
  people: { get: () => null }, emit: () => {}
});

const leaked = sanitizeReply('<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>');
check('后端工具调用文本不会进入最终回复', leaked === '', leaked);
check('后台章节标记会被清理', sanitizeReply('【关系记忆】用户喜欢猫。\n你好。') === '你好。');
check('QQ 回复会被截短到 3 句', trimReply('一。二。三。四。五。', { channel: 'qq', maxChars: 500, maxSentences: 3 }) === '一。二。三。');
const system1 = agent.buildSystemPrompt({ channel: 'desktop', meta: {} });
const system2 = agent.buildSystemPrompt({ channel: 'desktop', meta: {} });
check('稳定 system 前缀不含时间和动态记忆', system1 === system2 && !/当前时间|本轮记忆优先级/.test(system1));
const dynamic = agent.buildDynamicContext({ channel: 'desktop', memoryContext: { text: '动态记忆', hits: {} }, weightState: weights.getState(), learningNote: '', meta: {} });
check('动态上下文仍包含记忆与取向', /动态记忆/.test(dynamic) && /表达取向/.test(dynamic));
check('DeepSeek Flash 旧 tools=false 不会禁用工具', agent.shouldProvideTools() === true);
const tools = agent.buildTools({ channel: 'desktop' });
check('搜索与抓取工具可见', tools.some((item) => item.name === 'web_search') && tools.some((item) => item.name === 'web_fetch'));

const emotional = memory.addRelationship({ kind: 'emotional_event', content: '今天很难过。' });
const stable = memory.addRelationship({ kind: 'preference', content: '喜欢先听结论。' });
check('情感/稳定关系有不同 memoryClass', emotional.memoryClass === 'emotional' && stable.memoryClass === 'stable');
const context = memory.buildContext('今天', { personId: null }).text;
check('上下文明确分开情感记忆与稳定关系', /情感记忆/.test(context) && /稳定关系记忆/.test(context));
check('Hermes 插件名和工具已更正', JSON.parse(fs.readFileSync(path.join(paths.projectRoot, 'plugins', 'hermes', 'plugin.json'), 'utf8')).id === 'hermes');
const stickers = JSON.parse(fs.readFileSync(path.join(paths.projectRoot, 'resources', 'stickers', 'manifest.json'), 'utf8')).stickers;
check('内置表情包资源存在', Array.isArray(stickers) && stickers.length >= 6 && stickers.every((item) => fs.existsSync(path.join(paths.projectRoot, 'resources', 'stickers', item.file))));

console.log('\n本轮修复自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
