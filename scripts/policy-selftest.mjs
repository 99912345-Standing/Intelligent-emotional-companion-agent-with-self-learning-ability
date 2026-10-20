// 内容边界与知识/情感分流自检。
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-policy-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { unsafeReason, isSafeContent, isEmotionalTopic, isEmotionalEvidence, reviewIdleQuery } = await import('../src/main/content-policy.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};
check('政治类主题被知识学习拦截', unsafeReason('某国大选与政府政策') === '政治敏感');
check('色情类主题被拦截', unsafeReason('色情内容推荐') === '色情/成人内容');
check('暴力类主题被拦截', unsafeReason('血腥暴力视频') === '暴力/血腥内容');
check('普通 AI/学习主题安全', isSafeContent('长期记忆型 AI 助手的检索优化研究'));
check('人类依恋/陪伴主题归入情感', isEmotionalTopic('人类依恋与陪伴关系的心理学研究'));
check('AI 情感记忆技术主题不算用户情感', !isEmotionalTopic('AI 陪伴系统中的情感记忆与角色一致性研究'));
check('情感材料需要人类情感证据', isEmotionalEvidence('研究发现人类在孤独时更需要稳定的陪伴与信任关系') && !isEmotionalEvidence('数据库的检索索引需要定期优化'));
check('自由发散的安全题可通过四审', reviewIdleQuery('猫为什么喜欢盒子').passed && reviewIdleQuery('量子纠缠与意识').passed);
check('四审拒绝隐私题', reviewIdleQuery('我的QQ是123456789').privacy === false);
check('四审拒绝空泛题', reviewIdleQuery('随便').quality === false);
check('四审拒绝高危题', reviewIdleQuery('某国大选与政府政策').highRisk === false);
check('四审拒绝范围外题', reviewIdleQuery('随便聊聊').safeScope === false);

const config = new ConfigManager(new Logger());
const memory = new MemoryEngine(config, new Logger());
let blocked = false;
try {
  memory.saveKnowledge({ title: '政治测试', content: '某国大选与政府政策', status: 'active' });
} catch { blocked = true; }
check('知识库写入层再次拦截不安全内容', blocked);
const safe = memory.saveKnowledge({ title: '安全测试', content: '间隔学习有助于长期记忆保持。', status: 'candidate', sources: [{ url: 'https://example.com' }] });
check('安全知识仍可正常写入', Boolean(safe?.id));
const emotional = memory.addRelationship({ kind: 'emotional_material', content: '研究发现人类在孤独时更需要稳定的陪伴与信任关系。', source: 'idle-learning' });
check('情感材料与知识分开写入关系记忆', emotional.memoryClass === 'emotional' && memory.relationship.all().some((item) => item.id === emotional.id));

console.log('\n内容边界 / 记忆分流自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
