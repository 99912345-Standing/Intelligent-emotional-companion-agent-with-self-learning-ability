// 角色双线自检：用户编辑、证据校验、AI 校准、提示词注入。
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-persona-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { PersonaEngine } = await import('../src/main/persona.js');

let pass = 0; let fail = 0;
const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};

const logger = new Logger();
const config = new ConfigManager(logger);
config.save({ persona: { aiMinEvidence: 2, aiMinSpanDays: 0, aiCooldownHours: 0, aiMaxRevisions7d: 10 } });
const memory = new MemoryEngine(config, logger);
const rel = memory.addRelationship({ kind: 'preference', content: '用户更喜欢先听结论，再听解释。' });
const kn = memory.saveKnowledge({
  title: '用户的工作节奏',
  content: '用户通常在晚上进行深度工作，白天更愿意处理沟通类任务。',
  status: 'active', confidence: 0.8, sources: [{ url: 'https://example.com/persona', title: '自检' }]
});
memory.saveReflection({ kind: 'weight', content: '最近用户更频繁地表达疲惫，工作线应更轻，陪伴线保持在场。' });
const persona = new PersonaEngine({ config, memory, logger });

check('初始角色包含知识与情感两条线', Boolean(persona.get().knowledgeLine.text && persona.get().emotionLine.text));
check('初始提示词包含两条线', /知识线/.test(persona.promptBlock()) && /情感线/.test(persona.promptBlock()));
const userUpdate = persona.update({
  knowledgeLine: '先给结论，再给依据；不确定时明确标注并查证。',
  emotionLine: '先接住情绪，再讨论任务；不说教，也不替用户做决定。',
  reason: '用户偏好'
});
check('用户可以编辑两条线并产生修订号', userUpdate.changed && userUpdate.profile.revision === 1, String(userUpdate.profile.revision));
check('修订历史保留 before/after', persona.history(5)[0]?.before?.knowledgeLine?.text !== persona.history(5)[0]?.after?.knowledgeLine?.text);
let rejected = false;
try {
  persona.update({ knowledgeLine: '无证据修改', by: 'ai', requireEvidence: true, evidenceIds: [] });
} catch { rejected = true; }
check('AI 无证据修改被拒绝', rejected);
const aiUpdate = persona.update({
  knowledgeLine: '先给结论，再说明证据与时效；不确定就去查。',
  reason: '多次出现对时效与来源的关注',
  evidenceIds: [rel.id, kn.id],
  by: 'ai',
  requireEvidence: true
});
check('AI 引用真实记忆后可修改', aiUpdate.changed && aiUpdate.profile.lastEvidence.length >= 2);
check('修订记录标记 AI 与证据', aiUpdate.profile.updatedBy === 'ai' && aiUpdate.profile.lastEvidence.some((item) => item.id === rel.id));

const model = {
  available: () => true,
  async simple() {
    return JSON.stringify({
      changed: true,
      knowledgeLine: '先给结论，再给出可核查的依据与核验时间；不确定就查。',
      emotionLine: '先接住情绪，再处理任务；保持温和但不讨好，不替用户做重大决定。',
      reason: '记忆显示用户重视效率，同时近期情绪事件增多',
      evidence_ids: [rel.id, kn.id]
    });
  }
};
const calibrated = await persona.calibrate({ model });
check('AI 可基于记忆一键校准两条线', calibrated.changed && calibrated.profile.updatedBy === 'ai');
check('校准后证据可追溯', calibrated.profile.lastEvidence.length >= 1);
check('提示词会随角色更新', /可核查的依据/.test(persona.promptBlock()));

// 稳定性护栏：情绪事件不能单独改人设；锁定后 AI 不能改
const emotion = memory.addRelationship({ kind: 'emotional_event', content: '今天用户很生气，说了一句重话。', personId: null });
let emotionalOnlyRejected = false;
try {
  persona.update({ emotionLine: '以后变得冷淡一点。', by: 'ai', requireEvidence: true, evidenceIds: [emotion.id], reason: '情绪事件' });
} catch { emotionalOnlyRejected = true; }
check('情绪事件不能单独改写长期人设', emotionalOnlyRejected);
persona.setLocked(true);
let lockedRejected = false;
try {
  persona.update({ knowledgeLine: '锁定后仍尝试修改。', by: 'ai', requireEvidence: true, evidenceIds: [rel.id, kn.id], reason: 'test' });
} catch { lockedRejected = true; }
check('AI 自学习锁定后无法修改角色线', lockedRejected);
check('稳定性面板可读取锁定状态与证据统计', persona.publicProfile().stability.locked === true && persona.publicProfile().stability.stableCore >= 2);
persona.setLocked(false);
const rollback = persona.rollback();
check('可以回滚角色修订', rollback.changed && Boolean(persona.history(5)[0]?.reason?.includes('回滚')));

console.log('\n角色双线自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
