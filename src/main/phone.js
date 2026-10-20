import { paths, resolveAdb } from './paths.js';
import { PhoneCore } from '../shared/phone-core.js';
import { fileNameSafe } from './utils.js';

export class PhoneService {
  constructor(config, logger, emit = () => {}, mediaSink = null) {
    this.config = config;
    this.logger = logger;
    this.emit = emit;
    this.mediaSink = mediaSink;
    this.core = null;
    this.rebuild();
  }

  rebuild() {
    const cfg = this.config.get().phone;
    this.core = new PhoneCore({
      adbPath: resolveAdb(cfg.adbPath),
      mode: cfg.mode,
      serial: cfg.serial,
      emulatorPort: cfg.emulatorPort,
      dataDir: paths.data,
      mediaSink: this.mediaSink
    });
  }

  async status({ scan = false } = {}) {
    const adb = await this.core.checkAdb();
    if (!adb.ok) {
      return {
        ok: false,
        adb,
        mode: this.config.get().phone.mode,
        serial: this.config.get().phone.serial,
        devices: [],
        error: adb.error,
        hint: 'ADB 已随应用放在 tools/platform-tools。若缺失，可在“手机”页手动指定 adb.exe。'
      };
    }
    try {
      const cfg = this.config.get().phone;
      const shouldScan = scan || (cfg.autoScanEmulators !== false && this.core.cache.devices.length === 0);
      const devices = await this.core.listDevices({ refresh: shouldScan, scanEmulators: shouldScan });
      let selected = null;
      if (cfg.serial) selected = devices.find((device) => device.serial === cfg.serial) || null;
      if (!selected) {
        selected = devices.find((device) => device.state === 'device' && (
          cfg.mode === 'auto' ? true : cfg.mode === 'emulator' ? device.isEmulator : !device.isEmulator
        )) || null;
      }
      // 模式选错但确实有设备时，自动先选上；不再要求用户理解“真机/模拟器模式”。
      if (!selected) selected = devices.find((device) => device.state === 'device') || null;
      const info = selected ? await this.core.deviceInfo().catch((error) => ({ error: error.message })) : null;
      return {
        ok: Boolean(selected && selected.state === 'device'),
        adb,
        mode: cfg.mode,
        serial: selected?.serial || cfg.serial || '',
        selected,
        info,
        devices,
        error: selected ? null : '没有检测到已授权设备。点“自动检测模拟器”，或开启手机 USB 调试后再刷新。',
        permissions: this.config.get().phone.permissions,
        adbPath: resolveAdb(cfg.adbPath)
      };
    } catch (error) {
      return {
        ok: false,
        adb,
        mode: this.config.get().phone.mode,
        devices: [],
        error: error.message,
        permissions: this.config.get().phone.permissions
      };
    }
  }

  async choose(serial) {
    const target = String(serial || '').trim();
    this.config.save({ phone: { serial: target } });
    this.rebuild();
    this.emit('phone:changed', await this.status());
    return this.status();
  }

  async setMode(mode) {
    const next = ['auto', 'emulator', 'real'].includes(mode) ? mode : 'auto';
    this.config.save({ phone: { mode: next } });
    this.rebuild();
    return this.status();
  }

  async scanEmulators() {
    return this.core.scanEmulators();
  }

  saveScreenshotToMemory = null;

  async screenshot() {
    // 操作手机的截图只做临时视觉输入，不写入多模态记忆；由 PhoneCore 在后台缓存清理。
    const result = await this.core.screenshot({ save: false });
    return {
      ...result,
      base64: result.base64,
      dataUrl: `data:image/png;base64,${result.base64}`
    };
  }

  async uiDump() {
    return this.core.uiDump();
  }

  async readScreen() {
    const shot = await this.core.screenshot({ save: false });
    const ui = await this.core.uiDump().catch((error) => ({ error: error.message, nodes: [], text: '' }));
    const activity = await this.core.currentActivity().catch(() => ({ package: null, activity: null }));
    return {
      screenshot: { ...shot, dataUrl: `data:image/png;base64,${shot.base64}` },
      ui,
      activity,
      summary: [
        shot.mediaId ? `截图已存入多模态记忆（${shot.mediaId}）` : '截图已生成',
        activity.package ? `当前应用：${activity.package}` : '',
        ui.text ? `界面文字：\n${ui.text.slice(0, 2000)}` : ''
      ].filter(Boolean).join('\n')
    };
  }

  async installApk(filePath) {
    if (!this.config.get().phone.permissions.installApk) {
      throw new Error('安装 APK 权限未开启');
    }
    const installed = await this.core.exec(['install', '-r', filePath], { timeout: 120000 });
    return { ok: /Success/i.test(installed), output: installed.trim() };
  }
}
