import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from './defaults.js';
import { paths } from './paths.js';
import {
  atomicWriteJson, deepMerge, maskSecret, readJson, redact
} from './utils.js';

function detectIntegrationDefaults(config) {
  const snowHome = config.qq.homeDir || paths.snowluma;
  if (!config.qq.homeDir && fs.existsSync(snowHome)) config.qq.homeDir = snowHome;
  const launcher = config.qq.launcherPath || path.join(snowHome, 'launcher.bat');
  if (!config.qq.launcherPath && fs.existsSync(launcher)) config.qq.launcherPath = launcher;
  if (!config.phone.adbPath) {
    const adb = path.join(paths.tools, 'platform-tools', 'adb.exe');
    if (fs.existsSync(adb)) config.phone.adbPath = adb;
  }
  return config;
}

export class ConfigManager {
  constructor(logger = console) {
    this.logger = logger;
    this.file = path.join(paths.data, 'config.json');
    this.backup = path.join(paths.data, 'config.backup.json');
    this.config = this.load();
  }

  load() {
    const defaults = structuredClone(DEFAULT_CONFIG);
    const existing = readJson(this.file, null);
    const merged = detectIntegrationDefaults(deepMerge(defaults, existing || {}));
    merged.version = DEFAULT_CONFIG.version;
    if (!existing) {
      atomicWriteJson(this.file, merged);
      this.logger.info?.('config', `已创建配置文件：${this.file}`);
    }
    return merged;
  }

  get() {
    return this.config;
  }

  save(patch, { merge = true } = {}) {
    const sanitized = structuredClone(patch || {});
    // API Key 不回显：以掩码/“已保存”回传的字段不覆盖原值；clearApiKey 可显式清空。
    for (const key of ['primary', 'helper']) {
      const section = sanitized.models?.[key];
      if (!section) continue;
      if (section.clearApiKey === true) section.apiKey = '';
      else if (!section.apiKey || String(section.apiKey).includes('••••') || section.apiKey === '已保存') delete section.apiKey;
      delete section.clearApiKey;
      if (section.apiKey !== undefined) section.apiKey = String(section.apiKey).trim();
      // 只有真正换了端点/模型/协议，旧的验证才作废；仅保存其它字段不应清空能力徽章。
      const old = this.config.models?.[key] || {};
      const endpointChanged =
        (section.baseUrl !== undefined && String(section.baseUrl) !== String(old.baseUrl || '')) ||
        (section.model !== undefined && String(section.model) !== String(old.model || '')) ||
        (section.protocol !== undefined && String(section.protocol) !== String(old.protocol || ''));
      if (endpointChanged) {
        section.capabilities = { text: false, vision: false, tools: false, checkedAt: null };
      }
    }
    if (sanitized.security && sanitized.security.maskKeysInUi !== false) {
      // local-only 与掩码是产品约束，不允许通过 UI 关掉。
      sanitized.security.localOnly = true;
    }
    const next = merge ? deepMerge(this.config, sanitized) : deepMerge(structuredClone(DEFAULT_CONFIG), sanitized);
    this.config = detectIntegrationDefaults(next);
    atomicWriteJson(this.backup, this.config);
    atomicWriteJson(this.file, this.config);
    return this.config;
  }

  publicConfig() {
    const copy = structuredClone(this.config);
    for (const key of ['primary', 'helper']) {
      const model = copy.models?.[key];
      if (!model) continue;
      model.hasApiKey = Boolean(this.config.models[key].apiKey);
      model.apiKey = this.config.models[key].apiKey ? maskSecret(this.config.models[key].apiKey) : '';
    }
    for (const slot of copy.multimodal?.slots || []) {
      const raw = (this.config.multimodal?.slots || []).find((item) => item.id === slot.id);
      slot.hasApiKey = Boolean(raw?.apiKey);
      slot.apiKey = raw?.apiKey ? maskSecret(raw.apiKey) : '';
    }
    copy.qq.accessToken = this.config.qq.accessToken ? maskSecret(this.config.qq.accessToken) : '';
    copy.qq.wsToken = this.config.qq.wsToken ? maskSecret(this.config.qq.wsToken) : '';
    copy.qq.httpToken = this.config.qq.httpToken ? maskSecret(this.config.qq.httpToken) : '';
    copy.qq.hasAccessToken = Boolean(this.config.qq.accessToken);
    copy.qq.hasWsToken = Boolean(this.config.qq.wsToken);
    copy.qq.hasHttpToken = Boolean(this.config.qq.httpToken);
    copy.meta = {
      configFile: this.file,
      workspace: paths.root,
      version: DEFAULT_CONFIG.version
    };
    return copy;
  }

  effectiveConfig() {
    return this.config;
  }

  describeSecrets() {
    return {
      primaryKey: redact(this.config.models.primary.apiKey),
      helperKey: redact(this.config.models.helper.apiKey)
    };
  }
}
