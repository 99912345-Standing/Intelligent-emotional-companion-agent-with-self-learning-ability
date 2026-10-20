// Token 用量统计自检：输入/输出/缓存命中/记忆命中/对话拆分。
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-usage-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { UsageStore } = await import('../src/main/usage.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};
const logger = new Logger();
const config = new ConfigManager(logger);
const store = new UsageStore({ config, logger, emit: () => {} });

store.record({
  role: 'primary', model: 'deepseek-chat', protocol: 'openai', latencyMs: 1200,
  usage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200, cachedTokens: 600, cacheMissTokens: 400, cacheAvailable: true },
  context: { channel: 'desktop', purpose: 'chat', memoryHits: { knowledge: 2, relationship: 1, worklogs: 0, multimodal: 0 } }
});
store.record({
  role: 'primary', model: 'deepseek-chat', protocol: 'openai', latencyMs: 800,
  usage: { promptTokens: 500, completionTokens: 100, totalTokens: 600, cachedTokens: 0, cacheMissTokens: 500, cacheAvailable: true },
  context: { channel: 'qq_private_10001', purpose: 'chat', memoryHits: { knowledge: 0, relationship: 0, worklogs: 0, multimodal: 0 } }
});
store.record({
  role: 'helper', model: 'vision', protocol: 'openai', latencyMs: 600,
  usage: { promptTokens: 300, completionTokens: 50, totalTokens: 350, cachedTokens: 0, cacheMissTokens: 300, cacheAvailable: false, estimated: true },
  context: { channel: 'internal', purpose: 'image' }
});

const summary = store.summary();
check('今日总 tokens 汇总', summary.totals.total === 2150, JSON.stringify(summary.totals));
check('输入输出分开统计', summary.totals.prompt === 1800 && summary.totals.completion === 350);
check('缓存命中率按缓存可用调用计算', summary.cacheHitRate === 40, String(summary.cacheHitRate));
check('记忆命中率按调用占比计算', summary.memoryHitRate === 33.3, String(summary.memoryHitRate));
check('对话按入口拆分', summary.conversations.some((item) => item.name === 'desktop') && summary.conversations.some((item) => item.name === 'qq_private_10001'));
check('按模型拆分', summary.byModel.some((item) => item.name === 'deepseek-chat') && summary.byModel.some((item) => item.name === 'vision'));
check('最近调用包含 latency/estimated', summary.recent.some((item) => item.estimated) && summary.recent.every((item) => item.latencyMs >= 0));
check('上下文窗口使用最近一次对话调用', summary.lastCall?.channel === 'qq_private_10001' && summary.contextWindow > 0);
check('7 日趋势包含今天', summary.byDay.some((item) => item.date === summary.today && item.total === 2150));
store.clear();
check('可以重置用量', store.summary().totals.total === 0);

console.log('\nToken 用量自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
