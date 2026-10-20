// Hermes 插件与长期记忆/成长自检。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-hermes-test-${Date.now()}`);
const { initPaths, paths } = await import('../src/main/paths.js');
initPaths(null);
fs.cpSync(path.join(paths.projectRoot, 'plugins', 'hermes'), path.join(paths.plugins, 'hermes'), { recursive: true });
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { MemoryEngine } = await import('../src/main/memory.js');
const { WeightEngine } = await import('../src/main/weights.js');
const { PluginHost } = await import('../src/main/plugins.js');

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};
const logger = new Logger();
const config = new ConfigManager(logger);
config.save({ plugins: { enabled: ['hermes'], disabled: [] } });
const memory = new MemoryEngine(config, logger);
const weights = new WeightEngine(config, logger);
const host = new PluginHost({ config, logger, memory, weights, emit: () => {} });
await host.loadAll();
const status = host.status();
const plugin = status.plugins.find((item) => item.id === 'hermes');
check('Hermes 插件处于 active', plugin?.status === 'active', plugin?.error || '');
check('Hermes 提供召回/写入/反思/成长工具', ['hermes_recall', 'hermes_remember', 'hermes_reflect', 'hermes_growth'].every((name) => plugin?.tools?.includes(name)), JSON.stringify(plugin?.tools));
const remembered = await host.executeTool('hermes_remember', { kind: 'relationship', memory_class: 'stable', content: '用户喜欢先听结论。' });
check('Hermes 可写入稳定关系记忆', /稳定关系记忆/.test(remembered) && memory.relationship.all().some((item) => item.memoryClass === 'stable'));
const emotional = await host.executeTool('hermes_remember', { kind: 'relationship', memory_class: 'emotional', content: '今天用户有点难过。' });
check('Hermes 区分情感记忆', /情感记忆/.test(emotional) && memory.relationship.all().some((item) => item.memoryClass === 'emotional'));
const recalled = await host.executeTool('hermes_recall', { query: '喜欢先听结论' });
check('Hermes 召回稳定与情感分层', /稳定关系记忆/.test(recalled) && /情感记忆/.test(recalled), recalled.slice(0, 300));
const growth = await host.executeTool('hermes_growth', {});
check('Hermes 成长摘要包含长期记忆和取向', /长期记忆/.test(growth) && /当前取向/.test(growth), growth.slice(0, 240));

console.log('\nHermes 插件自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
