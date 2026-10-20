// 后台权重不可读 + 主动话题自检。
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-behavior-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { WeightEngine } = await import('../src/main/weights.js');
const { Agent } = await import('../src/main/agent.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};
const logger = new Logger();
const config = new ConfigManager(logger);
const weights = new WeightEngine(config, logger);
const memory = {
  setSummarizer() {},
  buildContext() { return { text: '【关系记忆】用户喜欢先听结论。', hits: {} }; },
  relationship: { all: () => [{ id: 'rel_1', content: '用户喜欢先听结论。', updatedAt: new Date().toISOString() }] },
  knowledge: { all: () => [{ id: 'kn_1', title: '用户的工作节奏', content: '晚上深度工作。', status: 'active', verifiedAt: new Date().toISOString() }] },
  listReflections: () => [{ id: 'ref_1', content: '最近需要更轻一点。' }]
};
const persona = {
  promptBlock: () => '【角色】知识线：先证据。情感线：先接住人。',
  renderMemoryEvidence: () => ({ text: '证据', relation: memory.relationship.all(), knowledge: memory.knowledge.all(), reflections: memory.listReflections() })
};
const appended = [];
const conversations = {
  ensureChannel() {},
  append: (channel, message) => { const record = { ...message, channel }; appended.push(record); return record; }
};
let completed = null;
const learning = {
  async run(query) {
    completed = query;
    return { id: 'cycle_1', outcome: 'completed', assessment: { answer: '量子计算最近有一条公开进展。' }, sources: [{ url: 'https://example.com/a' }] };
  }
};
let proactiveSystem = '';
const model = {
  available: () => true,
  async simple() { return JSON.stringify({ query: '量子计算 最新进展', angle: '分享一个新发现' }); },
  async request(role, options) {
    proactiveSystem = options.system;
    return { content: '我刚刚看到一个关于量子计算的新进展，感觉你会感兴趣。要不要听听？' };
  }
};
const agent = new Agent({
  config, logger, memory, weights, model,
  webSearch: {}, learning, conversations, qq: { status: { connected: false } }, phone: null, computer: null,
  mcp: { getTools: () => [] }, plugins: { getTools: () => [] }, persona,
  people: { get: (id) => (id === 'qq:10001' ? { id, qq: '10001', nickname: '老王', affinity: 78, impression: '说话直接，喜欢先听结论' } : null) },
  emit: () => {}
});
const system = agent.buildSystemPrompt({
  channel: 'desktop',
  memoryContext: { text: '记忆片段', hits: {} },
  weightState: weights.getState(),
  learningNote: '',
  meta: {}
});
check('主模型提示词不出现权重数值', !/%/.test(system) && !/工作线|陪伴线|双轨权重/.test(system), system.slice(0, 200));
check('主模型提示词只收到行为取向', /表达取向/.test(system));
const personSystem = agent.buildSystemPrompt({
  channel: 'qq_private_10001',
  memoryContext: { text: '', hits: {} },
  weightState: weights.getState(),
  learningNote: '',
  meta: { source: 'qq', qq: { kind: 'private', userId: '10001', senderName: '老王' } }
});
check('人物亲近度与印象会影响 AI 提示词', /老王/.test(personSystem) && /亲近度/.test(personSystem) && /喜欢先听结论/.test(personSystem));
const tools = agent.buildTools({ channel: 'desktop' });
check('AI 没有 weight_status 工具', !tools.some((item) => item.name === 'weight_status'));
check('AI 有定性权重读取与微调工具', tools.some((item) => item.name === 'weight_read') && tools.some((item) => item.name === 'weight_tune'));
check('AI 有角色线维护工具', tools.some((item) => item.name === 'persona_update'));

const proactive = await agent.proactiveTurn({ channel: 'desktop', allowResearch: true, allowPhone: false });
check('主动话题会先选题并查资料', completed === '量子计算 最新进展');
check('主动话题会生成短消息', /量子计算/.test(proactive.content) && appended.some((item) => item.meta?.proactive));
check('主动话题发给模型时也不含权重数值', !/%/.test(proactiveSystem) && !/工作线|陪伴线/.test(proactiveSystem));
check('主动话题标记 research 来源', proactive.research?.cycleId === 'cycle_1');

console.log('\n后台取向 / 主动话题自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
