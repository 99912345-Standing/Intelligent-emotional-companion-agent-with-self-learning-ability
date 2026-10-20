// 将两个独立 MCP 服务打包成单文件，避免便携版运行时依赖 app.asar 内的 node_modules。
// 源文件保持可读；.bundle.cjs 才是给 exe 内置 MCP 管理器/外部 MCP 客户端直接运行的文件。
import { build } from 'esbuild';
import fs from 'node:fs';

fs.mkdirSync('mcp/phone', { recursive: true });
fs.mkdirSync('mcp/computer', { recursive: true });

const targets = [
  ['mcp/phone/mcp-phone.js', 'mcp/phone/mcp-phone.bundle.mjs'],
  ['mcp/computer/mcp-computer.js', 'mcp/computer/mcp-computer.bundle.mjs']
];

for (const [entry, outfile] of targets) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: false,
    legalComments: 'none',
    banner: { js: '/* 伴行 Agent · 独立 MCP 服务（esbuild 单文件构建） */' }
  });
  console.log(`[build-mcp] ${outfile} ${Math.round(fs.statSync(outfile).size / 1024)}KB`);
}
