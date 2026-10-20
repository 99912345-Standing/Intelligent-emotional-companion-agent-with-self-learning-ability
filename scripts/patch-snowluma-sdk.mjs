// 修复 @snowluma/sdk 发布包中相对 ESM import 缺少 .js 扩展名的问题。
// 上游 qq-bridge 也使用了同样的修补（scripts/patch-snowluma-sdk.mjs）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['@snowluma/sdk', '@snowluma/mcp'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

let total = 0;
for (const pkg of targets) {
  const distRoot = path.join(root, 'node_modules', pkg, 'dist');
  if (!fs.existsSync(distRoot)) continue;
  let patched = 0;
  for (const file of walk(distRoot)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(file, 'utf8');
    const next = src.replace(/from\s+'(\.[^']+)'/g, (match, spec) => {
      if (spec.endsWith('.js') || spec.endsWith('.json')) return match;
      const target = path.resolve(path.dirname(file), spec);
      if (fs.existsSync(`${target}.js`)) return match.replace(spec, `${spec}.js`);
      if (fs.existsSync(`${target}.json`)) return match.replace(spec, `${spec}.json`);
      return match;
    });
    if (next !== src) {
      fs.writeFileSync(file, next);
      patched += 1;
    }
  }
  console.log(`[patch-snowluma] ${pkg}: ${patched} 个文件`);
  total += patched;
}
console.log(`[patch-snowluma] 完成，共 ${total} 个文件`);
