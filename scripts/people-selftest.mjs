// 人物账本 / 亲近度 / 动态印象 / 昵称刷新 / 按人隔离 自检。
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-people-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { PeopleEngine } = await import('../src/main/people.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};
const logger = new Logger();
const config = new ConfigManager(logger);
config.save({ qq: { ownerQQ: '10001' } });
const memory = new MemoryEngine(config, logger);
const people = new PeopleEngine({ config, memory, logger });

const first = people.observe({ qq: '20002', nickname: '小鱼', text: '谢谢你，今天和你聊天很开心', channel: 'qq_group_30001' });
check('人物以 QQ 号为稳定主键', first.id === 'qq:20002' && first.qq === '20002');
check('亲近度会随正向对话上升', first.affinity > 50, String(first.affinity));
check('群聊与私聊进入同一本人物账本', first.channels.includes('qq_group_30001'));
const second = people.observe({ qq: '20002', nickname: '小鱼', text: '晚安，明天继续聊', channel: 'qq_private_20002' });
check('私聊出现后频道合并', second.channels.includes('qq_private_20002') && second.channels.length === 2);
check('同一 QQ 只保留一条人物记录', people.list().filter((item) => item.qq === '20002').length === 1);

// 旧昵称写入关系记忆，改昵称后应刷新
memory.extractRelationshipFacts('我喜欢先听结论，再听细节。', { source: 'qq:20002', personId: 'qq:20002', nickname: '小鱼' });
const beforeNick = memory.relationship.all().find((item) => item.personId === 'qq:20002');
const renamed = people.observe({ qq: '20002', nickname: '小鱼改名了', text: '我改昵称了', channel: 'qq_private_20002' });
const afterNick = memory.relationship.all().find((item) => item.personId === 'qq:20002');
check('QQ 号不变、昵称变化会刷新人物记录', renamed.nickname === '小鱼改名了' && renamed.aliases.includes('小鱼'));
check('昵称变化会刷新关系记忆中的昵称', afterNick?.nickname === '小鱼改名了' && afterNick.id === beforeNick.id, JSON.stringify(afterNick));
check('QQ 和昵称双显示', people.list().find((item) => item.id === 'qq:20002').display.includes('QQ 20002'));

// 手动锁定
people.update('qq:20002', { manual: true, affinity: 88, impression: '手动写下的印象' });
const lockedBefore = people.get('qq:20002');
people.observe({ qq: '20002', nickname: '小鱼改名了', text: '谢谢谢谢谢谢', channel: 'qq_private_20002' });
check('手动锁定后亲近度不再自动变化', people.get('qq:20002').affinity === lockedBefore.affinity);
check('手动印象可保存', people.get('qq:20002').impression === '手动写下的印象');

// 动态印象
people.update('qq:20002', { manual: false });
const model = { available: () => true, async simple() { return '聊天直接，喜欢先听结论，最近在慢慢变得熟络。'; } };
const refreshed = await people.refreshImpressions({ model, force: true });
check('人物印象可由模型动态刷新', refreshed.some((item) => /喜欢先听结论/.test(item.impression)));

// 按人隔离：A 的关系记忆不应出现在 B 的上下文
memory.extractRelationshipFacts('我喜欢苹果。', { source: 'qq:20002', personId: 'qq:20002', nickname: '小鱼改名了' });
memory.extractRelationshipFacts('我喜欢香蕉。', { source: 'qq:20003', personId: 'qq:20003', nickname: '阿蕉' });
memory.addRelationship({ content: '我喜欢蓝色。', kind: 'preference', personId: null, nickname: '' });
const contextA = memory.buildContext('喜欢', { personId: 'qq:20002' }).text;
check('按人读取关系记忆不会串到别人', /苹果/.test(contextA) && !/香蕉/.test(contextA), contextA);
check('全局关系记忆仍可见', /蓝色/.test(contextA));

// 删除
check('可以删除人物档案', people.remove('qq:20002') === true && !people.get('qq:20002'));

console.log('\n人物 / 亲近度 / 印象自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
