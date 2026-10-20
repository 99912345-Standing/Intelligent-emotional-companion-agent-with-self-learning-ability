// 三线状态：归一化、快变量、指数衰减、5h 转存、锚点恢复、AI 微调。
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-state-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { WeightEngine } = await import('../src/main/weights.js');
const { Agent } = await import('../src/main/agent.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};
const logger = new Logger();
const config = new ConfigManager(logger);
const memory = new MemoryEngine(config, logger);
const weights = new WeightEngine(config, logger);
const agent = new Agent({
  config, logger, memory, weights,
  model: { available: () => false },
  webSearch: {}, learning: {}, conversations: {}, qq: null, phone: null, computer: null,
  mcp: { getTools: () => [] }, plugins: { getTools: () => [] },
  persona: { promptBlock: () => '', renderMemoryEvidence: () => ({ text: '', relation: [], knowledge: [], reflections: [] }) },
  emit: () => {}
});

const total = (v) => Number(v.work) + Number(v.companion) + Number(v.learning);
check('状态向量包含工作/陪伴/学习三维', Number.isFinite(weights.state.learning));
check('状态向量归一化为 1', Math.abs(total(weights.state) - 1) < 0.0001, String(total(weights.state)));
check('初始状态向基线靠拢', weights.getState().baseline.learning === 0.3);

// 快变量：工作很高时“我累了”快速拉高陪伴，其他维度保留基线
weights.state = { ...weights.state, work: 0.9, companion: 0.05, learning: 0.05, lastEventAt: null, lastEventType: '' };
weights.save();
const comfort = weights.updateFromMessage('我累了');
check('强陪伴信号会快速越过工作', comfort.raw.companion > comfort.raw.work, JSON.stringify(comfort.raw));
check('其他维度不会被清零', comfort.raw.work >= 0.2 && comfort.raw.learning >= 0.1, JSON.stringify(comfort.raw));
check('快变量后仍是归一化向量', Math.abs(total(comfort.raw) - 1) < 0.0001);

// 慢变量：指数衰减回基线，而不是归零
weights.state = { ...weights.state, work: 0.8, companion: 0.1, learning: 0.1 };
weights.state.lastDecayAt = new Date(Date.now() - 20 * 60000).toISOString();
weights.state.lastSignalAt = new Date(Date.now() - 20 * 60000).toISOString();
weights.save();
const decay20 = weights.decayIdle();
check('工作维度按半衰期指数衰减', decay20.changed && decay20.after.work < 0.8 && decay20.after.work > 0.3, JSON.stringify(decay20.after));
check('衰减目标是基线，不是 0', decay20.after.work >= 0.3, String(decay20.after.work));

// 5 小时：工作上下文转存为日志 + 话题锚点
const longAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
weights.state = { ...weights.state, work: 0.45, companion: 0.4, learning: 0.15, lastSignalAt: longAgo, lastDecayAt: longAgo };
weights.save();
memory.touchWork('desktop', '继续完成量子计算报告的数据整理', { workWeight: 0.45 });
const archived = await agent.handleIdleDecay();
check('5 小时无工作信号会转存工作日志', archived.shouldArchive === true && memory.worklogs.all().some((item) => item.reason === 'idle-transfer'));
check('转存后仍保留可读取的工作日志', memory.worklogs.all().some((item) => /量子计算报告/.test(item.title + item.summary + item.objective)));

// 话题锚点：恢复当时的权重
weights.state = { ...weights.state, work: 0.72, companion: 0.16, learning: 0.12, lastEventAt: null, lastEventType: '' };
weights.save();
const anchor = weights.addAnchor({ excerpt: '继续完成量子计算报告的数据整理和图表', channel: 'desktop' });
weights.state = { ...weights.state, work: 0.31, companion: 0.4, learning: 0.29 };
weights.save();
const resumed = weights.updateFromMessage('继续刚才那个量子计算报告');
check('相似旧话题会命中权重锚点', Boolean(anchor) && resumed.lastAnchor === anchor.id, JSON.stringify(resumed.lastAnchor));
check('锚点恢复当时的工作权重', resumed.raw.work > 0.5, JSON.stringify(resumed.raw));
check('锚点恢复后状态仍归一化', Math.abs(total(resumed.raw) - 1) < 0.0001);

// AI 微调与冷却
const beforeTune = weights.state.companion;
const tuned = weights.aiTune({ direction: 'companion', strength: 0.04, reason: '用户需要陪伴' });
check('AI 可以通过对话微调权重', tuned.changed && weights.state.companion > beforeTune);
check('AI 微调结果不返回百分比', !/%/.test(JSON.stringify(tuned)));
let cooldown = false;
try { weights.aiTune({ direction: 'work', reason: '立即再调' }); } catch { cooldown = true; }
check('AI 微调有冷却', cooldown);

// 学习完成回落
weights.state = { ...weights.state, learning: 0.8, work: 0.1, companion: 0.1 };
weights.save();
const learned = weights.completeLearning();
check('学习成果归档后学习维度回落', learned.raw.learning < 0.8 && learned.raw.learning > 0.3, JSON.stringify(learned.raw));

// 旧话题无锚点时不会凭空恢复
const noAnchor = weights.updateFromMessage('今天天气不错');
check('没有锚点时保持当前状态平滑变化', noAnchor.raw.work < 0.5, JSON.stringify(noAnchor.raw));

console.log('\n三线状态 / 衰减 / 锚点自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
