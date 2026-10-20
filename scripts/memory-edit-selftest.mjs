// 记忆手动修正自检：关系、工作日志、进行中工作、多模态说明。
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-edit-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { MemoryEngine } = await import('../src/main/memory.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};
const logger = new Logger();
const config = new ConfigManager(logger);
const memory = new MemoryEngine(config, logger);

const rel = memory.addRelationship({ kind: 'preference', content: '喜欢甜的。' });
const rel2 = memory.updateRelationship(rel.id, { kind: 'preference', content: '喜欢微甜，不喜欢太甜。', confidence: 0.95 });
check('关系记忆可手动修正', rel2.content === '喜欢微甜，不喜欢太甜。' && rel2.editedBy === 'user');
check('修正后置信度保留', rel2.confidence === 0.95);
check('修正会写入关系存储', memory.relationship.get(rel.id)?.content.includes('微甜'));

memory.saveKnowledge({ title: '测试知识', content: '旧结论', status: 'active', confidence: 0.8, sources: [{ url: 'https://example.com' }] });
const log = { id: 'work_test', kind: 'worklog', title: '旧标题', summary: '旧摘要', result: '', nextSteps: '旧下一步', archivedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), messageCount: 1, reason: 'manual' };
memory.worklogs.append(log);
const log2 = memory.updateWorklog(log.id, { title: '新标题', summary: '新摘要', nextSteps: '新下一步' });
check('工作日志可手动修正', log2.title === '新标题' && log2.summary === '新摘要' && log2.editedBy === 'user');

const media = await memory.saveMedia({
  buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
  kind: 'image', mime: 'image/png', fileName: 'test.png', caption: '旧说明', tags: ['旧标签']
});
const media2 = memory.setMediaCaption(media.id, '新说明', { tags: ['新标签', '修正'] });
check('多模态说明与标签可修正', media2.caption === '新说明' && media2.tags.includes('新标签') && media2.editedBy === 'user');
check('多模态修正保留文件', Boolean(media2.file && memory.multimodal.get(media.id)));

// 进行中的工作
memory.active.channel_test = {
  id: 'active_test', channel: 'channel_test', title: '旧任务',
  objective: '旧目标', startedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
  notes: [], messageCount: 1
};
const active2 = memory.updateActiveWork('channel_test', { title: '修正任务', objective: '修正目标' });
check('进行中的工作可修正', active2.title === '修正任务' && active2.objective === '修正目标' && active2.editedBy === 'user');

console.log('\n记忆手动修正自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
