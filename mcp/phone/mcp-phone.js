#!/usr/bin/env node
/**
 * 伴行 mcp-phone.js
 * 通过 ADB 读取与操作 Android 手机；支持真机与模拟器两种模式。
 * 独立 MCP stdio 服务：可由伴行内置 MCP 管理器、Claude Desktop 或其他 MCP 客户端启动。
 *
 * 环境变量：
 *   BANXING_HOME        工作目录（默认从脚本位置向上两级）
 *   ADB_PATH            自定义 adb 路径
 *   PHONE_MODE          real | emulator（默认 real）
 *   PHONE_SERIAL        指定设备序列号
 *   PHONE_ALLOW_SHELL   1 才允许 adb shell 任意命令
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhoneCore } from '../../src/shared/phone-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.resolve(process.env.BANXING_HOME || path.join(__dirname, '..', '..'));
const MEDIA_DIR = path.join(HOME, 'data', 'memory', 'media');
const MEMORY_FILE = path.join(HOME, 'data', 'memory', 'multimodal.jsonl');
const ADB_PATH = process.env.ADB_PATH || path.join(HOME, 'tools', 'platform-tools', 'adb.exe');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });

function saveToMemory({ buffer, kind = 'image', mime = 'image/png', fileName = 'phone.png', source = 'phone', caption = '', tags = [], meta = {} }) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
  const date = new Date();
  const dir = path.join(MEDIA_DIR, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(fileName) || '.png';
  const file = path.join(dir, `${hash}${ext}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
  const record = {
    id: `media_${crypto.randomUUID()}`,
    kind,
    mime,
    fileName,
    file,
    relativeFile: path.relative(HOME, file).replace(/\\/g, '/'),
    bytes: buffer.length,
    hash,
    source,
    channel: null,
    messageId: null,
    caption,
    tags,
    createdAt: new Date().toISOString(),
    meta
  };
  fs.appendFileSync(MEMORY_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

const core = new PhoneCore({
  adbPath: ADB_PATH,
  mode: process.env.PHONE_MODE || 'real',
  serial: process.env.PHONE_SERIAL || '',
  mediaSink: saveToMemory,
  dataDir: path.join(HOME, 'data')
});

const server = new McpServer({
  name: 'banxing-phone',
  version: '1.0.0'
}, {
  instructions: '通过 ADB 读取与操作用户已授权的 Android 设备。每次执行会改变手机状态的操作前，先用 screenshot/ui_dump 确认界面；不要执行未经用户明确要求的付款、删除或消息发送操作。'
});

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (error) => ({ isError: true, content: [{ type: 'text', text: `错误：${error.message || error}` }] });

async function guard(fn) {
  try { return await fn(); } catch (error) { return fail(error); }
}

server.tool('list_devices', '列出所有 ADB 设备，区分真机与模拟器，并标注授权状态。', {}, async () => guard(async () => {
  const devices = await core.listDevices();
  return text({ devices, adb: core.adbPath, mode: core.mode });
}));

server.tool('device_info', '读取当前选中的手机型号、Android 版本、屏幕分辨率、电量与 IP。', {}, async () => guard(async () => {
  return text(await core.deviceInfo());
}));

server.tool('screenshot', '截取手机当前屏幕，返回图片并自动存入多模态记忆。', {
  save_to_memory: z.boolean().optional().describe('是否写入多模态记忆，默认 true')
}, async ({ save_to_memory = true }) => guard(async () => {
  const shot = await core.screenshot({ save: save_to_memory });
  return {
    content: [
      { type: 'image', data: shot.base64, mimeType: 'image/png' },
      { type: 'text', text: JSON.stringify({ serial: shot.serial, file: shot.file, relativeFile: shot.relativeFile, mediaId: shot.mediaId }, null, 2) }
    ]
  };
}));

server.tool('read_screen', '读取手机当前屏幕截图和 UI 控件树，用于“查看手机”与定位可点击元素。', {}, async () => guard(async () => {
  const shot = await core.screenshot({ save: true });
  const ui = await core.uiDump().catch((error) => ({ error: error.message, nodes: [], text: '' }));
  const activity = await core.currentActivity().catch(() => ({}));
  return {
    content: [
      { type: 'image', data: shot.base64, mimeType: 'image/png' },
      { type: 'text', text: JSON.stringify({ mediaId: shot.mediaId, file: shot.file, activity, ui }, null, 2).slice(0, 16000) }
    ]
  };
}));

server.tool('ui_dump', '导出当前界面的可读控件文本与可点击区域（uiautomator）。', {}, async () => guard(async () => text(await core.uiDump())));

server.tool('tap', '点击手机屏幕坐标。坐标基于当前分辨率，先用 screenshot 确认。', {
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative()
}, async ({ x, y }) => guard(async () => text(await core.tap(x, y))));

server.tool('swipe', '在手机屏幕上滑动，用于翻页或滚动。', {
  x1: z.number().int().nonnegative(),
  y1: z.number().int().nonnegative(),
  x2: z.number().int().nonnegative(),
  y2: z.number().int().nonnegative(),
  duration_ms: z.number().int().min(50).max(5000).optional()
}, async ({ x1, y1, x2, y2, duration_ms = 300 }) => guard(async () => text(await core.swipe(x1, y1, x2, y2, duration_ms))));

server.tool('input_text', '向当前输入框输入文本。中文/emoji 需要设备安装并启用 ADBKeyboard。', {
  text: z.string().min(1).max(4000),
  submit: z.boolean().optional()
}, async ({ text: value, submit = false }) => guard(async () => text(await core.inputText(value, { submit }))));

server.tool('keyevent', '发送 Android 系统按键（HOME/BACK/ENTER/DEL 等）。', {
  key: z.enum(['HOME', 'BACK', 'APP_SWITCH', 'ENTER', 'DEL', 'TAB', 'POWER', 'VOLUME_UP', 'VOLUME_DOWN', 'WAKEUP', 'SLEEP', 'MENU', 'SEARCH'])
}, async ({ key }) => guard(async () => text(await core.keyevent(key))));

server.tool('launch_app', '通过包名启动手机应用；可选指定 Activity。', {
  package_name: z.string().min(1).max(200),
  activity: z.string().max(200).optional()
}, async ({ package_name, activity = '' }) => guard(async () => text(await core.launchApp(package_name, activity))));

server.tool('open_url', '在手机默认浏览器打开 http/https 链接。', {
  url: z.string().url()
}, async ({ url }) => guard(async () => text(await core.openUrl(url))));

server.tool('list_apps', '列出手机已安装的第三方应用包名。', {}, async () => guard(async () => {
  const apps = await core.listApps({ thirdPartyOnly: true });
  return text({ count: apps.length, apps });
}));

server.tool('list_emulators', '列出 Android Studio AVD、正在运行的模拟器与常见第三方模拟器端口。', {}, async () => guard(async () => text(await core.listEmulators())));

server.tool('start_emulator', '启动 Android Studio AVD 模拟器（真机模式不会调用）。', {
  avd_name: z.string().optional()
}, async ({ avd_name = '' }) => guard(async () => text(await core.startEmulator(avd_name))));

server.tool('connect_wifi', '通过 ADB over WiFi 连接手机，地址格式 IP:端口。', {
  address: z.string().min(7).max(100)
}, async ({ address }) => guard(async () => text(await core.connectWifi(address))));

server.tool('shell', '在手机上执行 ADB shell 命令（默认关闭，只有 PHONE_ALLOW_SHELL=1 时可用）。', {
  command: z.string().min(1).max(2000)
}, async ({ command }) => guard(async () => {
  if (process.env.PHONE_ALLOW_SHELL !== '1') throw new Error('手机 Shell 未开启：设置 PHONE_ALLOW_SHELL=1 后重启 MCP 服务。');
  return text(await core.shell(command, { allow: true }));
}));

await server.connect(new StdioServerTransport());
console.error(`[mcp-phone] ready · adb=${ADB_PATH} · mode=${core.mode} · home=${HOME}`);
