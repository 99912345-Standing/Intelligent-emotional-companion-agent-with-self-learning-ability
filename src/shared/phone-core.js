import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EMULATOR_PORTS = [5554, 5555, 5556, 5557, 5559, 5585, 7555, 62001, 62025, 62026, 21503, 16384, 58526];

function parseDevices(output) {
  const devices = [];
  for (const line of String(output).split(/\r?\n/)) {
    // adb 在 Windows 上通常用空格分隔，旧实现只认 tab，导致明明有设备却解析成 0。
    const match = /^(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(line.trim());
    if (!match || /^(List|daemon|adb|\*)/i.test(match[1])) continue;
    const [, serial, state, rest = ''] = match;
    const props = {};
    for (const pair of rest.split(/\s+/)) {
      const [key, value] = pair.split(':');
      if (key && value) props[key] = value;
    }
    devices.push({
      serial,
      state,
      model: props.model?.replace(/_/g, ' ') || '',
      product: props.product || '',
      device: props.device || '',
      transportId: props.transport_id || '',
      isEmulator: /^(emulator-|127\.0\.0\.1:|localhost:)/.test(serial)
        || /(sdk|emulator|mumu|nox|bluestacks|ldplayer|memu|genymotion|android studio|qemu)/i.test(`${props.model || ''} ${props.product || ''} ${props.device || ''} ${serial}`)
    });
  }
  return devices;
}

function cleanAdbError(error) {
  const raw = String(error?.stderr || error?.stdout || error?.message || error);
  if (/not found|不是内部或外部命令|ENOENT/i.test(raw)) {
    return '找不到 adb.exe。请确认 tools/platform-tools/adb.exe 存在，或在“手机”页手动指定 adb 路径。';
  }
  if (/unauthorized/i.test(raw)) return '设备未授权：请在手机上点“允许 USB 调试”。';
  if (/no devices|device offline|not found/i.test(raw)) return '没有可用的已授权设备。';
  return raw.replace(/\s+/g, ' ').slice(0, 600);
}

export class PhoneCore {
  constructor({
    adbPath = 'adb', mode = 'real', serial = '', emulatorPort = 5554,
    mediaSink = null, dataDir = path.join(os.homedir(), '.banxing-phone')
  } = {}) {
    this.adbPath = adbPath || 'adb';
    this.mode = ['auto', 'emulator', 'real'].includes(mode) ? mode : 'auto';
    this.preferredSerial = serial || '';
    this.emulatorPort = Number(emulatorPort) || 5554;
    this.mediaSink = mediaSink;
    this.dataDir = dataDir;
    fs.mkdirSync(this.dataDir, { recursive: true });
    // ADB 默认把 adbkey 写进 %USERPROFILE%\.android；固定到工作目录，保持“数据不散落”。
    this.androidHome = path.join(this.dataDir, 'android');
    fs.mkdirSync(this.androidHome, { recursive: true });
    this.env = { ...process.env, ANDROID_USER_HOME: this.androidHome, ANDROID_SDK_HOME: this.androidHome };
    this.cache = { devices: [], checkedAt: 0 };
    this.lastRecoveryAt = 0;
  }

  async exec(args, { serial = null, binary = false, timeout = 30000 } = {}) {
    const fullArgs = serial ? ['-s', serial, ...args] : [...args];
    try {
      if (binary) {
        return await new Promise((resolve, reject) => {
          const child = spawn(this.adbPath, fullArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: this.env });
          const chunks = [];
          const errs = [];
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error('ADB 命令超时'));
          }, timeout);
          child.stdout.on('data', (chunk) => chunks.push(chunk));
          child.stderr.on('data', (chunk) => errs.push(chunk));
          child.on('error', (error) => {
            clearTimeout(timer);
            reject(new Error(cleanAdbError(error)));
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(cleanAdbError({ stderr: Buffer.concat(errs).toString() })));
            resolve(Buffer.concat(chunks));
          });
        });
      }
      const { stdout, stderr } = await execFileAsync(this.adbPath, fullArgs, {
        timeout,
        windowsHide: true,
        maxBuffer: 12 * 1024 * 1024,
        encoding: 'utf8',
        env: this.env
      });
      if (stderr && /error:/i.test(stderr) && !stdout) throw new Error(stderr);
      return stdout;
    } catch (error) {
      if (error.message?.includes('ADB 命令超时') || error.message?.startsWith('找不到 adb')) throw error;
      throw new Error(cleanAdbError(error));
    }
  }

  async checkAdb() {
    try {
      const version = await this.exec(['version'], { timeout: 12000 });
      return { ok: true, version: String(version).split(/\r?\n/)[0].trim(), path: this.adbPath };
    } catch (error) {
      return { ok: false, error: error.message, path: this.adbPath };
    }
  }

  async portOpen(port, timeout = 450) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const done = (value) => { try { socket.destroy(); } catch {} resolve(value); };
      socket.setTimeout(timeout);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }

  async scanEmulators() {
    const openPorts = [];
    await Promise.all(EMULATOR_PORTS.map(async (port) => {
      if (await this.portOpen(port)) openPorts.push(port);
    }));
    const connected = [];
    for (const port of openPorts.sort((a, b) => a - b)) {
      try {
        const output = await this.exec(['connect', `127.0.0.1:${port}`], { timeout: 5000 });
        connected.push({ port, output: String(output).trim() });
      } catch (error) {
        connected.push({ port, error: error.message });
      }
    }
    const devices = await this.listDevices({ refresh: true, scanEmulators: false });
    return {
      scannedPorts: EMULATOR_PORTS,
      openPorts,
      connected,
      devices,
      note: openPorts.length
        ? '已尝试连接检测到端口的模拟器；如果仍显示 offline/unauthorized，请在模拟器内允许 ADB 调试。'
        : '没有检测到常见模拟器 ADB 端口。请确认模拟器已启动，并在模拟器设置中开启 ADB/网络调试；MuMu 常用 16384/7555，LDPlayer 5555/5557，Nox 62001，BlueStacks 5555，MEmu 21503。'
    };
  }

  async listDevices({ refresh = true, scanEmulators = false } = {}) {
    if (!refresh && Date.now() - this.cache.checkedAt < 3000) return this.cache.devices;
    await this.exec(['start-server'], { timeout: 20000 });
    if (scanEmulators) await this.scanEmulators().catch(() => {});
    const output = await this.exec(['devices', '-l'], { timeout: 15000 });
    const devices = parseDevices(output).map((device) => ({
      ...device,
      connected: device.state === 'device',
      authorized: device.state === 'device',
      mode: device.isEmulator ? 'emulator' : 'real'
    }));
    this.cache = { devices, checkedAt: Date.now() };
    return devices;
  }

  async selectDevice({ refresh = true } = {}) {
    let devices = await this.listDevices({ refresh, scanEmulators: !this.cache.devices.length });
    let candidates = devices.filter((device) => device.state === 'device');
    // 离线/掉线时最多每 15 秒做一次轻量恢复，避免每个动作都卡在全端口扫描。
    if (!candidates.length && Date.now() - this.lastRecoveryAt > 15000) {
      this.lastRecoveryAt = Date.now();
      await this.scanEmulators().catch(() => {});
      devices = await this.listDevices({ refresh: true, scanEmulators: false });
      candidates = devices.filter((device) => device.state === 'device');
    }
    let selected = null;
    if (this.preferredSerial) selected = candidates.find((device) => device.serial === this.preferredSerial) || null;
    if (!selected) {
      const matches = candidates.filter((device) => this.mode === 'auto'
        ? true
        : this.mode === 'emulator' ? device.isEmulator : !device.isEmulator);
      selected = matches[0] || null;
    }
    // 傻瓜式兜底：模式选错但确实有一台已授权设备时，先用起来，不再让用户卡在“未找到真机/模拟器”。
    if (!selected) selected = candidates[0] || null;
    if (!selected) {
      const all = devices.map((device) => `${device.serial}(${device.state}${device.isEmulator ? ', 模拟器' : ', 真机'})`).join('、') || '无设备';
      throw new Error(
        `未找到已授权设备。当前设备：${all}。\n` +
        '真机：开启 USB 调试，手机弹窗点“允许”，再点自动检测。\n' +
        '模拟器：先启动模拟器，在模拟器设置里开启 ADB/网络调试，再点“自动检测模拟器”。'
      );
    }
    return { selected, devices };
  }

  async deviceInfo() {
    const { selected, devices } = await this.selectDevice();
    const serial = selected.serial;
    const [model, brand, android, sdk, size, battery, ip] = await Promise.all([
      this.exec(['shell', 'getprop', 'ro.product.model'], { serial }).catch(() => ''),
      this.exec(['shell', 'getprop', 'ro.product.brand'], { serial }).catch(() => ''),
      this.exec(['shell', 'getprop', 'ro.build.version.release'], { serial }).catch(() => ''),
      this.exec(['shell', 'getprop', 'ro.build.version.sdk'], { serial }).catch(() => ''),
      this.exec(['shell', 'wm', 'size'], { serial }).catch(() => ''),
      this.exec(['shell', 'dumpsys', 'battery'], { serial }).catch(() => ''),
      this.exec(['shell', 'ip', 'route'], { serial }).catch(() => '')
    ]);
    const level = /level:\s*(\d+)/i.exec(battery)?.[1] || null;
    const routeIp = /src\s+([0-9.]+)/.exec(ip)?.[1] || null;
    return {
      ...selected,
      devices,
      model: model.trim() || selected.model || 'Android 设备',
      brand: brand.trim(),
      android: android.trim(),
      sdk: sdk.trim(),
      screen: size.trim(),
      battery: level ? `${level}%` : null,
      ip: routeIp,
      mode: selected.isEmulator ? 'emulator' : 'real',
      adbPath: this.adbPath
    };
  }

  async screenshot({ save = true } = {}) {
    const { selected } = await this.selectDevice();
    const serial = selected.serial;
    const remote = `/sdcard/__banxing_${Date.now()}.png`;
    await this.exec(['shell', 'screencap', '-p', remote], { serial, timeout: 30000 });
    const cacheDir = path.join(this.dataDir, 'phone-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = path.join(cacheDir, `screen-${Date.now()}.png`);
    await this.exec(['pull', remote, tmp], { serial, timeout: 30000 });
    await this.exec(['shell', 'rm', '-f', remote], { serial }).catch(() => {});
    this.pruneScreenshotCache(cacheDir);
    const buffer = fs.readFileSync(tmp);
    if (!buffer.length || buffer[0] !== 0x89) throw new Error('截图数据无效；请确认设备已解锁并允许截图。');
    let media = null;
    if (save && this.mediaSink) {
      media = await this.mediaSink({
        buffer,
        kind: 'screenshot',
        mime: 'image/png',
        fileName: `phone-${selected.serial.replace(/[^\w-]/g, '_')}-${Date.now()}.png`,
        source: 'phone',
        caption: `手机截图（${selected.model || selected.serial}）`,
        tags: ['手机', '截图', selected.isEmulator ? '模拟器' : '真机'],
        meta: { serial: selected.serial, mode: selected.isEmulator ? 'emulator' : 'real' }
      });
    }
    return {
      serial,
      buffer,
      file: media?.file || tmp,
      relativeFile: media?.relativeFile || null,
      mediaId: media?.id || null,
      base64: buffer.toString('base64'),
      width: null,
      height: null
    };
  }

  pruneScreenshotCache(dir) {
    try {
      const files = fs.readdirSync(dir)
        .filter((name) => /^screen-\d+\.png$/.test(name))
        .map((name) => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
      const cutoff = Date.now() - 2 * 3600 * 1000;
      for (const [index, file] of files.entries()) {
        if (index >= 20 || file.at < cutoff) fs.unlinkSync(path.join(dir, file.name));
      }
    } catch {}
  }

  async uiDump() {
    const { selected } = await this.selectDevice();
    const remote = '/sdcard/__banxing_window.xml';
    await this.exec(['shell', 'uiautomator', 'dump', remote], { serial: selected.serial, timeout: 20000 });
    const local = path.join(this.dataDir, 'ui-latest.xml');
    await this.exec(['pull', remote, local], { serial: selected.serial, timeout: 20000 });
    await this.exec(['shell', 'rm', '-f', remote], { serial: selected.serial }).catch(() => {});
    const xml = fs.readFileSync(local, 'utf8');
    const nodes = [];
    for (const match of xml.matchAll(/<node\b([^>]+?)\/?>/g)) {
      const attrs = {};
      for (const attr of match[1].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[attr[1]] = attr[2];
      const text = attrs.text || attrs['content-desc'] || '';
      if (!text.trim()) {
        if (attrs.class?.endsWith('EditText') || attrs.clickable === 'true') {
          nodes.push({ text: '', class: attrs.class, clickable: attrs.clickable === 'true', bounds: attrs.bounds, resourceId: attrs['resource-id'] || '' });
        }
        continue;
      }
      nodes.push({
        text: text.trim().slice(0, 300),
        class: attrs.class || '',
        clickable: attrs.clickable === 'true',
        enabled: attrs.enabled !== 'false',
        bounds: attrs.bounds || '',
        resourceId: attrs['resource-id'] || '',
        package: attrs.package || ''
      });
    }
    return {
      serial: selected.serial,
      xmlFile: local,
      nodes: nodes.slice(0, 200),
      text: nodes.slice(0, 120).map((node) => node.text).filter(Boolean).join('\n').slice(0, 5000),
      nodeCount: nodes.length
    };
  }

  async currentActivity() {
    const { selected } = await this.selectDevice();
    const out = await this.exec(['shell', 'dumpsys', 'activity', 'activities'], { serial: selected.serial }).catch(() => '');
    const resumed = /mResumedActivity[^}]*?([\w.]+)\/([\w.$]+)/.exec(out);
    return resumed ? { package: resumed[1], activity: resumed[2] } : { package: null, activity: null };
  }

  async tap(x, y) {
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 0 || ny < 0 || nx > 20000 || ny > 20000) throw new Error('坐标无效');
    const { selected } = await this.selectDevice();
    await this.exec(['shell', 'input', 'tap', String(Math.round(nx)), String(Math.round(ny))], { serial: selected.serial });
    return { ok: true, serial: selected.serial, x: Math.round(nx), y: Math.round(ny) };
  }

  async swipe(x1, y1, x2, y2, duration = 300) {
    const values = [x1, y1, x2, y2].map(Number);
    if (values.some((value) => !Number.isFinite(value))) throw new Error('滑动坐标无效');
    const { selected } = await this.selectDevice();
    await this.exec(['shell', 'input', 'swipe', ...values.map(String), String(Math.max(50, Math.min(5000, Number(duration) || 300)))], { serial: selected.serial });
    return { ok: true, serial: selected.serial };
  }

  async keyevent(key) {
    const allowed = new Set(['HOME', 'BACK', 'APP_SWITCH', 'ENTER', 'DEL', 'TAB', 'POWER', 'VOLUME_UP', 'VOLUME_DOWN', 'WAKEUP', 'SLEEP', 'MENU', 'SEARCH']);
    const normalized = String(key).toUpperCase().replace(/^KEYCODE_/, '');
    if (!allowed.has(normalized)) throw new Error(`不允许的按键：${key}。可用：${[...allowed].join(', ')}`);
    const { selected } = await this.selectDevice();
    await this.exec(['shell', 'input', 'keyevent', `KEYCODE_${normalized}`], { serial: selected.serial });
    return { ok: true, key: normalized };
  }

  async inputText(text, { submit = false } = {}) {
    const value = String(text ?? '');
    if (!value) throw new Error('输入文本为空');
    const { selected } = await this.selectDevice();
    const hasAdbKeyboard = await this.exec(['shell', 'ime', 'list', '-s'], { serial: selected.serial })
      .then((output) => /com\.android\.adbkeyboard/i.test(output)).catch(() => false);
    if (/[^\x00-\x7F]/.test(value) && hasAdbKeyboard) {
      const b64 = Buffer.from(value, 'utf8').toString('base64');
      await this.exec(['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', b64], { serial: selected.serial });
    } else if (/[^\x00-\x7F]/.test(value)) {
      throw new Error('中文/表情输入需要设备安装 ADBKeyboard。请安装 ADBKeyboard 并启用其输入法；或使用英文/数字输入。');
    } else {
      const escaped = value.replace(/([\\%'"$` <>|&;()*?\[\]{}~#!])/g, '\\$1').replace(/ /g, '%s');
      await this.exec(['shell', 'input', 'text', escaped], { serial: selected.serial });
    }
    if (submit) {
      await this.exec(['shell', 'input', 'keyevent', 'KEYCODE_ENTER'], { serial: selected.serial });
    }
    return { ok: true, chars: value.length, serial: selected.serial };
  }

  async launchApp(packageName, activity = '') {
    const pkg = String(packageName || '').trim();
    if (!/^[a-zA-Z0-9_.]+$/.test(pkg)) throw new Error('包名格式无效');
    const { selected } = await this.selectDevice();
    if (activity) {
      if (!/^[a-zA-Z0-9_.$]+$/.test(activity)) throw new Error('Activity 格式无效');
      await this.exec(['shell', 'am', 'start', '-n', `${pkg}/${activity}`], { serial: selected.serial });
    } else {
      await this.exec(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { serial: selected.serial, timeout: 20000 });
    }
    return { ok: true, package: pkg };
  }

  async openUrl(url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('URL 无效'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只允许打开 http/https 链接');
    const { selected } = await this.selectDevice();
    await this.exec(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url], { serial: selected.serial });
    return { ok: true, url };
  }

  async listApps({ thirdPartyOnly = true } = {}) {
    const { selected } = await this.selectDevice();
    const out = await this.exec(['shell', 'pm', 'list', 'packages', ...(thirdPartyOnly ? ['-3'] : [])], { serial: selected.serial });
    return String(out).split(/\r?\n/).map((line) => line.replace(/^package:/, '').trim()).filter(Boolean).slice(0, 200);
  }

  async shell(command, { allow = false } = {}) {
    if (!allow) throw new Error('ADB Shell 权限未开启；请在设置中显式允许。');
    const value = String(command || '').trim();
    if (!value) throw new Error('命令为空');
    if (value.length > 2000) throw new Error('命令过长');
    const { selected } = await this.selectDevice();
    const output = await this.exec(['shell', value], { serial: selected.serial, timeout: 30000 });
    return { ok: true, serial: selected.serial, output: String(output).slice(0, 12000) };
  }

  async connectWifi(address) {
    const host = String(address || '').trim();
    if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}$|^[a-zA-Z0-9.-]+:\d{2,5}$/.test(host)) {
      throw new Error('地址格式应为 IP:端口，例如 192.168.1.20:5555');
    }
    const output = await this.exec(['connect', host], { timeout: 20000 });
    return { ok: /connected to/i.test(output), output: output.trim(), address: host };
  }

  async listEmulators() {
    const avds = [];
    const emulatorPaths = [
      process.env.ANDROID_EMULATOR,
      path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'emulator', 'emulator.exe'),
      path.join(process.env.ANDROID_HOME || '', 'emulator', 'emulator.exe'),
      path.join(process.env.ANDROID_SDK_ROOT || '', 'emulator', 'emulator.exe')
    ].filter(Boolean);
    let emulatorPath = emulatorPaths.find((candidate) => fs.existsSync(candidate)) || '';
    if (emulatorPath) {
      try {
        const out = await execFileAsync(emulatorPath, ['-list-avds'], { timeout: 12000, windowsHide: true, encoding: 'utf8' });
        avds.push(...String(out.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      } catch {}
    }
    const devices = await this.listDevices({ refresh: true });
    return {
      emulatorPath,
      avds,
      running: devices.filter((device) => device.isEmulator),
      commonPorts: [5554, 5555, 62001, 62025, 7555, 21503, 16384],
      note: avds.length ? '可直接启动 AVD 模拟器。' : '未发现 Android Studio AVD；第三方模拟器请先手动启动，再在设备列表中选择。'
    };
  }

  async startEmulator(avdName) {
    const listing = await this.listEmulators();
    if (!listing.emulatorPath) throw new Error('未找到 emulator.exe。请安装 Android Studio Emulator，或在手机页手动启动第三方模拟器。');
    const name = String(avdName || listing.avds[0] || '').trim();
    if (!name) throw new Error('没有可启动的 AVD，请先在 Android Studio 创建虚拟设备。');
    if (!/^[a-zA-Z0-9_. -]+$/.test(name)) throw new Error('AVD 名称无效');
    const args = ['-avd', name, '-port', String(this.emulatorPort)];
    const child = spawn(listing.emulatorPath, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return { ok: true, avd: name, port: this.emulatorPort, pid: child.pid };
  }
}

export function summarizeUi(nodes) {
  const clickable = nodes.filter((node) => node.clickable && node.text).slice(0, 30);
  return {
    visibleText: nodes.filter((node) => node.text).map((node) => node.text).join('\n').slice(0, 3000),
    clickable: clickable.map((node) => `[${node.text}] ${node.bounds}`)
  };
}
