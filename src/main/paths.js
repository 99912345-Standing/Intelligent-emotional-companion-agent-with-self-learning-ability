import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export const paths = {
  projectRoot: PROJECT_ROOT,
  root: PROJECT_ROOT,
  appRoot: PROJECT_ROOT,
  resources: path.join(PROJECT_ROOT, 'resources'),
  data: path.join(PROJECT_ROOT, 'data'),
  logs: path.join(PROJECT_ROOT, 'data', 'logs'),
  memory: path.join(PROJECT_ROOT, 'data', 'memory'),
  media: path.join(PROJECT_ROOT, 'data', 'memory', 'media'),
  stickers: path.join(PROJECT_ROOT, 'data', 'memory', 'stickers'),
  chat: path.join(PROJECT_ROOT, 'data', 'chat'),
  learning: path.join(PROJECT_ROOT, 'data', 'learning'),
  pluginData: path.join(PROJECT_ROOT, 'data', 'plugins'),
  plugins: path.join(PROJECT_ROOT, 'plugins'),
  vendor: path.join(PROJECT_ROOT, 'vendor'),
  qqBridge: path.join(PROJECT_ROOT, 'vendor', 'qq-bridge'),
  tools: path.join(PROJECT_ROOT, 'tools'),
  snowluma: path.join(PROJECT_ROOT, 'integrations', 'SnowLuma'),
  checkScript: path.join(PROJECT_ROOT, '检查环境-只读.bat'),
  visionTest: path.join(PROJECT_ROOT, 'resources', 'vision-test.png')
};

export function initPaths(app) {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const packaged = Boolean(app?.isPackaged);
  const root = path.resolve(
    process.env.BANXING_HOME ||
    portableDir ||
    (packaged ? path.dirname(app.getPath('exe')) : PROJECT_ROOT)
  );
  const appRoot = app?.getAppPath?.() || PROJECT_ROOT;
  const resourcesRoot = packaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(PROJECT_ROOT, 'resources');

  Object.assign(paths, {
    projectRoot: PROJECT_ROOT,
    root,
    appRoot,
    resources: resourcesRoot,
    data: path.join(root, 'data'),
    logs: path.join(root, 'data', 'logs'),
    memory: path.join(root, 'data', 'memory'),
    media: path.join(root, 'data', 'memory', 'media'),
    stickers: path.join(root, 'data', 'memory', 'stickers'),
    chat: path.join(root, 'data', 'chat'),
    learning: path.join(root, 'data', 'learning'),
    pluginData: path.join(root, 'data', 'plugins'),
    plugins: path.join(root, 'plugins'),
    vendor: path.join(root, 'vendor'),
    qqBridge: path.join(root, 'vendor', 'qq-bridge'),
    tools: path.join(root, 'tools'),
    snowluma: path.join(root, 'integrations', 'SnowLuma'),
    checkScript: path.join(root, '检查环境-只读.bat'),
    visionTest: path.join(resourcesRoot, 'vision-test.png'),
    packaged,
    portableDir: portableDir || null
  });

  for (const dir of [
    paths.data, paths.logs, paths.memory, paths.media, paths.stickers, paths.chat,
    paths.learning, paths.pluginData, paths.plugins
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // 运行时把 Chromium 用户数据也固定在工作目录内，避免散落到 AppData。
  try {
    if (app?.setPath) {
      const userData = path.join(paths.data, '.electron');
      fs.mkdirSync(userData, { recursive: true });
      app.setPath('userData', userData);
      app.setPath('sessionData', path.join(userData, 'session'));
      app.setPath('crashDumps', path.join(paths.data, 'logs', 'crashes'));
    }
  } catch {
    // Electron 早期阶段可能不允许设置；主进程稍后再次尝试并记录。
  }
  return paths;
}

function copyIfMissing(source, target, label) {
  if (!source || !fs.existsSync(source) || fs.existsSync(target)) return false;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: false });
    return true;
  } catch (error) {
    console.warn(`[seed] ${label} 复制失败：${error.message}`);
    return false;
  }
}

/**
 * 便携版首次运行时，从安装包附带的资源里播种可编辑的插件、MCP、qq-bridge 与 ADB。
 * 这些内容必须位于工作目录，AI 与用户都能直接查看、修改。
 */
export function seedWorkspace() {
  if (!paths.packaged) return [];
  const seeded = [];
  const res = process.resourcesPath;
  const pairs = [
    [path.join(res, 'plugins'), paths.plugins, 'plugins'],
    [path.join(res, 'vendor', 'qq-bridge'), paths.qqBridge, 'vendor/qq-bridge'],
    [path.join(res, 'mcp'), path.join(paths.root, 'mcp'), 'mcp'],
    [path.join(res, 'src', 'shared'), path.join(paths.root, 'src', 'shared'), 'src/shared'],
    [path.join(res, 'tools', 'platform-tools'), path.join(paths.tools, 'platform-tools'), 'ADB'],
    [path.join(res, 'docs'), path.join(paths.root, 'docs'), 'docs'],
    [path.join(res, 'check', 'check-readonly.bat'), paths.checkScript, '只读检查脚本'],
    [path.join(res, 'check', 'check-readonly.ps1'), path.join(paths.root, 'check-readonly.ps1'), '只读检查助手']
  ];
  for (const [source, target, label] of pairs) {
    if (copyIfMissing(source, target, label)) seeded.push(label);
  }
  return seeded;
}

export function resolveSnowLumaLauncher(configured) {
  const candidates = [
    configured,
    path.join(paths.snowluma, 'launcher.bat'),
    path.join(paths.snowluma, 'SnowLuma.exe')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

export function resolveAdb(configured) {
  const candidates = [
    configured,
    path.join(paths.tools, 'platform-tools', 'adb.exe'),
    path.join(paths.tools, 'adb.exe')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || 'adb';
}
