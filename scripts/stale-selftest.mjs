// 知识时效自动复核：验证“命中过时知识 → 回答前先重验 → 再调主模型”的顺序。
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-stale-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { WeightEngine } = await import('../src/main/weights.js');
const { ConversationStore } = await import('../src/main/conversations.js');
const { Agent } = await import('../src/main/agent.js');

const logger = new Logger();
const config = new ConfigManager(logger);
config.save({
  memory: { autoResearch: true, staleAfterDays: 30 },
  permissions: { webSearch: true, qqSend: false, phoneControl: false, computerControl: false, mcpServers: false }
});
const memory = new MemoryEngine(config, logger);
const weights = new WeightEngine(config, logger);
const conversations = new ConversationStore();
const events = [];
const order = [];
const old = memory.saveKnowledge({
  title: 'SnowLuma 最新版本是多少',
  content: 'SnowLuma 的旧版本是 v1.14.9。',
  tags: ['SnowLuma'],
  sources: [{ url: 'https://example.com/old', title: '旧来源' }],
  confidence: 0.8,
  status: 'active',
  verifiedAt: new Date(Date.now() - 86400000 * 120).toISOString(),
  staleAfterDays: 30
});
memory.markStaleEntries();
const before = memory.findKnowledgeById(old.id);

let revalidated = 0;
let modelCalls = 0;
const learning = {
  async revalidateKnowledge(id) {
    revalidated += 1;
    order.push('revalidate');
    memory.updateKnowledge(id, {
      content: 'SnowLuma 当前版本已通过复核更新为 v1.14.22。',
      verifiedAt: new Date().toISOString(),
      reason: 'stale auto revalidate test'
    });
    return { status: 'completed', outcome: 'updated', knowledgeId: id, id: 'cycle_stub' };
  },
  async run() { return { status: 'completed', outcome: 'candidate' }; }
};
const model = {
  available: () => true,
  async request(role, { system }) {
    modelCalls += 1;
    order.push('model');
    return { role: 'assistant', content: '已按最新核验结果回答：SnowLuma 当前版本是 v1.14.22。', tool_calls: [], model: 'stub' };
  },
  async simple() { return '内部反思'; },
  async describeImages() { return '图片描述'; },
  async askHelper() { return { text: '帮助' }; }
};
const agent = new Agent({
  config, logger, memory, weights, model,
  webSearch: { search: async () => [], fetchReadable: async () => ({}) },
  learning,
  conversations,
  qq: { publicStatus: () => ({}), sendManual: async () => ({}) },
  phone: { status: async () => ({ ok: false }), rebuild() {} },
  computer: {},
  mcp: { getTools: () => [], execute: async () => ({}) },
  plugins: { getTools: () => [], runHook: async () => {}, executeTool: async () => ({}) },
  emit: (type, payload) => events.push({ type, payload })
});
const result = await agent.handleMessage({ channel: 'desktop', text: 'SnowLuma 最新版本是多少？' });
const after = memory.findKnowledgeById(old.id);
const text = result.assistantMessage?.content || '';
const checks = [
  ['命中过时知识触发复核', revalidated === 1, String(revalidated)],
  ['先复核再调用主模型', order.join(',') === 'revalidate,model', order.join(',')],
  ['知识核验时间被更新', after.verifiedAt !== before.verifiedAt],
  ['知识内容已由复核更新', /v1\.14\.22/.test(after.content)],
  ['主模型最终回答被保存', /v1\.14\.22/.test(text), text],
  ['无过时条目时正常调用主模型', modelCalls === 1, String(modelCalls)]
];
console.log('\n知识时效自检\n' + '─'.repeat(60));
let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `：${detail || ''}`}`);
  if (!ok) fail += 1;
}
console.log('─'.repeat(60));
console.log(`通过 6 · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
