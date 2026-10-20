// 人格演化：身体反馈、模糊记忆、情感记忆分层、题目去重自检。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-evolution-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { PersonaEngine } = await import('../src/main/persona.js');
const { embodiedToolError } = await import('../src/main/embodied.js');
const { Agent } = await import('../src/main/agent.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};

const config = new ConfigManager(new Logger());
const logger = new Logger();
const memory = new MemoryEngine(config, logger);
const persona = new PersonaEngine({ config, memory, logger });

const forbidden = embodiedToolError('web_fetch', Object.assign(new Error('HTTP 403 Forbidden'), { status: 403 }));
check('403 被包装成身体反馈', /^【身体反馈】/.test(forbidden) && !/403|HTTP|Forbidden/.test(forbidden), forbidden);
const timeout = embodiedToolError('phone_click', new Error('ETIMEDOUT'));
check('超时被包装成身体反馈', /^【身体反馈】/.test(timeout) && !/ETIMEDOUT/.test(timeout), timeout);

const old = memory.addRelationship({
  kind: 'preference', content: '对方喜欢先看结论，不喜欢被连续追问。',
  source: 'test', confidence: 0.8
});
memory.relationship.update(old.id, { updatedAt: new Date(Date.now() - 12 * 86400000).toISOString() });
const context = memory.buildContext('结论 追问', { priority: 'relationship' });
check('记忆检索带记忆质地规则', /记忆的质地/.test(context.text));
check('超过三天的关系记忆带时间模糊', /时间感模糊|约 \d+ 天前/.test(context.text), context.text.slice(0, 400));

const technical = memory.addRelationship({
  kind: 'emotional_material', content: 'AI 陪伴系统中的情感记忆与角色一致性研究需要长期记忆。',
  source: 'idle-learning'
});
const emotionalHuman = memory.addRelationship({
  kind: 'emotional_material', content: '研究发现人类在孤独时更需要稳定的陪伴与信任关系。',
  source: 'idle-learning'
});
const emotionalText = memory.buildContext('人类 孤独 陪伴', { priority: 'relationship' }).text;
check('技术性 emotional_material 不再显示为情感记忆', !emotionalText.includes(technical.id) || !emotionalText.includes('技术性'), emotionalText.slice(0, 500));
check('真正的人类情感材料仍显示为情感记忆', emotionalText.includes(emotionalHuman.content.slice(0, 12)) || emotionalText.includes('陪伴'), emotionalText.slice(0, 500));

for (const [index, mood] of ['平静', '想念', '牵挂'].entries()) {
  persona.recordEmotionalMemory({
    content: `第 ${index + 1} 次相处后，我发现自己会在对方沉默时先等一会儿，而不是急着填满空气。`,
    mood,
    intensity: 0.6,
    tags: ['陪伴', '边界'],
    source: 'test'
  });
}
const layered = persona.layerEmotionalMemory();
check('情感记忆可以分层形成稳定情感线', layered.changed === true && /陪伴|边界/.test(persona.get().emotionLine.text), JSON.stringify(layered));
check('分层写的是情感线而不是一次性事件', persona.get().emotionLine.updatedBy === 'ai-layer' && persona.get().revision > 0);
check('时间限制已移除', Number(config.get().persona.aiMinSpanDays) === 0 && Number(config.get().persona.aiCooldownHours) === 0);
check('情感记忆与知识/关系分开存储', persona.listEmotionalMemory(10).length === 3 && !memory.relationship.all().some((item) => item.id === persona.listEmotionalMemory(1)[0].id));

const similar = Agent.prototype.questionSimilarity.call({}, 'AI 陪伴中的情感记忆研究', 'AI 陪伴中的情感记忆研究');
const different = Agent.prototype.questionSimilarity.call({}, 'AI 陪伴中的情感记忆研究', '咖啡为什么能提神');
check('同一个题目会被判重', similar >= 0.99);
check('不同题目不会误判重复', different < 0.3, String(different));
const ownerProbe = {
  config: { get: () => ({ qq: { ownerQQ: '10001' } }) }
};
check('主人账号可写关系记忆', Agent.prototype.isOwnerContext.call(ownerProbe, { source: 'qq', qq: { userId: '10001' } }));
check('非主人账号关系记忆只读', !Agent.prototype.isOwnerContext.call(ownerProbe, { source: 'qq', qq: { userId: '20002' } }));
check('桌面始终是主人上下文', Agent.prototype.isOwnerContext.call(ownerProbe, { source: 'desktop' }));

console.log('\n人格演化 / 身体反馈 / 记忆分层自检\n' + '─'.repeat(64));
console.log(out.join('\n'));
console.log('─'.repeat(64));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
