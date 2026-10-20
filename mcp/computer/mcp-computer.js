#!/usr/bin/env node
/**
 * 伴行 mcp-computer.js — 通过 Windows PowerShell 读取屏幕、点击、输入与启动应用。
 * 独立 MCP stdio 服务。默认只暴露读取、鼠标、键盘、启动应用；Shell 必须显式开启。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.resolve(process.env.BANXING_HOME || path.join(__dirname, '..', '..'));
const SCRIPT = path.join(__dirname, 'desktop.ps1');
const SHOT_DIR = path.join(HOME, 'data', 'computer', 'screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function run(action, env = {}) {
  const { stdout, stderr } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT
  ], {
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    encoding: 'utf8',
    env: { ...process.env, BX_ACTION: action, ...env }
  });
  if (stderr && !stdout) throw new Error(stderr.trim());
  const parsed = JSON.parse(String(stdout).trim().split(/\r?\n/).pop());
  if (parsed.ok === false) throw new Error(parsed.error || '操作失败');
  return parsed;
}

const server = new McpServer({ name: 'banxing-computer', version: '1.0.0' }, {
  instructions: '操作用户 Windows 桌面。改变系统状态前先截图确认；不要擅自执行付款、删除、发送消息或关闭用户工作。'
});
const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (error) => ({ isError: true, content: [{ type: 'text', text: `错误：${error.message || error}` }] });
const guard = (fn) => Promise.resolve().then(fn).catch(fail);

server.tool('screenshot', '截取 Windows 桌面并在当前调用中返回图片与尺寸；写入 data/computer/screenshots 临时目录，不进入多模态记忆。', {}, async () => guard(async () => {
  const file = path.join(SHOT_DIR, `desktop-${Date.now()}.png`);
  const info = await run('screenshot', { BX_OUT: file });
  const buffer = fs.readFileSync(file);
  return {
    content: [
      { type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' },
      { type: 'text', text: JSON.stringify({ ...info, file, relativeFile: path.relative(HOME, file).replace(/\\/g, '/'), ephemeral: true }, null, 2) }
    ]
  };
}));

server.tool('screen_info', '读取虚拟桌面原点与分辨率。', {}, async () => guard(async () => text(await run('screen-info'))));

server.tool('list_windows', '列出当前带标题的桌面窗口、PID 与进程名。', {}, async () => guard(async () => text(await run('windows'))));

server.tool('click', '点击桌面坐标（相对于虚拟屏幕左上角）。', {
  x: z.number().int(), y: z.number().int()
}, async ({ x, y }) => guard(async () => text(await run('click', { BX_X: x, BX_Y: y }))));

server.tool('type_text', '向当前焦点窗口输入 Unicode 文本。', {
  text: z.string().min(1).max(5000)
}, async ({ text: value }) => guard(async () => text(await run('type', { BX_TEXT_B64: Buffer.from(value).toString('base64') }))));

server.tool('press_keys', '发送按键或组合键，使用 SendKeys 语法，例如 ^s 表示 Ctrl+S。', {
  keys: z.string().min(1).max(200)
}, async ({ keys }) => guard(async () => text(await run('keys', { BX_KEYS: keys }))));

server.tool('focus_window', '按 PID 将窗口切换到前台。', {
  pid: z.number().int().positive()
}, async ({ pid }) => guard(async () => text(await run('focus', { BX_PID: pid }))));

server.tool('launch_app', '启动程序、文件、网址或 shell: 路径。', {
  target: z.string().min(1).max(1000)
}, async ({ target }) => guard(async () => text(await run('launch', { BX_TARGET: target }))));

server.tool('run_powershell', '执行 PowerShell（默认关闭；需 COMPUTER_ALLOW_SHELL=1）。', {
  command: z.string().min(1).max(4000)
}, async ({ command }) => guard(async () => {
  if (process.env.COMPUTER_ALLOW_SHELL !== '1') throw new Error('Shell 未开启：设置 COMPUTER_ALLOW_SHELL=1 后重启 MCP 服务。');
  const { stdout, stderr } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { timeout: 45000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
  return text({ stdout: stdout.slice(0, 12000), stderr: stderr.slice(0, 4000) });
}));

await server.connect(new StdioServerTransport());
console.error(`[mcp-computer] ready · home=${HOME}`);
