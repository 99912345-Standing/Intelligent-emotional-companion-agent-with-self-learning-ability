// QQ 拟人化发送层自检：Markdown 清理、分条、延迟边界。
import { naturalizeQqText, typingDelayFor } from '../src/main/qqbridge.js';

let pass = 0; let fail = 0; const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};

const cleaned = naturalizeQqText('**好的**\n- 第一件事\n- 第二件事\n```js\nconst x = 1;\n```\n首先，我们开始。');
check('QQ 文本会去掉 Markdown 粗体与代码围栏', !/\*\*|```/.test(cleaned), cleaned);
check('QQ 文本会去掉标题/列表/编号', !/^\s*[-*#]|^\s*\d+[.)]/m.test(cleaned), cleaned);
check('清理后仍有可读内容', cleaned.length > 10, cleaned);

const humanize = { perCharMs: 30, minDelayMs: 500, maxDelayMs: 1500, quietStart: 0, quietEnd: 0, quietFactor: 1.2 };
const shortDelay = typingDelayFor('在', humanize);
const longDelay = typingDelayFor('这是一段比较长的回复，用来测试按字数增长的等待时间。', humanize);
check('短回复等待不低于最小值', shortDelay >= 500 && shortDelay <= 1800, String(shortDelay));
check('长回复等待更高但有上限', longDelay >= shortDelay && longDelay <= 1800, `${shortDelay} / ${longDelay}`);

console.log('\nQQ 拟人化发送自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
