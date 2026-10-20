// 学习闭环联网自检：真实 Bing 搜索/正文抓取，不调用任何真实大模型（走启发式交叉验证）。
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-research-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { WebSearch } = await import('../src/main/websearch.js');
const { LearningEngine } = await import('../src/main/learning.js');

const logger = new Logger();
const config = new ConfigManager(logger);
config.save({ search: { maxResults: 4, fetchTop: 3, minSources: 2, archiveConfidence: 0.3 } });
const memory = new MemoryEngine(config, logger);
const webSearch = new WebSearch(config, logger);
const model = { available: () => false, simple: async () => { throw new Error('offline'); } };
const learning = new LearningEngine({ config, logger, memory, model, webSearch, emit: () => {} });
const cycle = await learning.run('SnowLuma OneBot WebSocket 默认端口 3001 官方文档', { trigger: 'selftest', archive: true });
const fact = cycle.knowledgeId ? memory.findKnowledgeById(cycle.knowledgeId) : null;
const checks = [
  ['闭环完成', cycle.status === 'completed', cycle.error],
  ['抓取多个信源', (cycle.sources || []).length >= 2, String((cycle.sources || []).length)],
  ['信源被赋予不同权重', new Set((cycle.sources || []).map((source) => Math.round(source.reliability * 100))).size > 1],
  ['生成可追溯结论', Boolean(cycle.assessment?.answer), String(cycle.assessment?.answer).slice(0, 80)],
  ['归档或候选写入知识库', Boolean(fact), String(cycle.outcome)],
  ['知识保留来源与时间', Boolean(fact?.verifiedAt) && (fact?.sources || []).length > 0],
  ['闭环保存 7 步痕迹', (cycle.steps || []).length >= 5, String((cycle.steps || []).length)]
];
console.log('\n学习闭环联网自检\n' + '─'.repeat(60));
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `：${detail || ''}`}`);
  if (!ok) failed += 1;
}
console.log('─'.repeat(60));
console.log(`来源：${(cycle.sources || []).slice(0, 3).map((source) => `${source.domain}(${Math.round(source.reliability * 100)})`).join(' · ')}`);
console.log(`结论：${String(cycle.assessment?.answer || '').slice(0, 200)}`);
console.log(`结果：${cycle.outcome} · 置信 ${Math.round((cycle.assessment?.confidence || 0) * 100)}% · ${cycle.durationMs}ms`);
process.exit(failed ? 1 : 0);
