import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths } from './paths.js';
import { nowIso } from './utils.js';

const ALLOWED_PERMISSIONS = new Set([
  'memory:read', 'memory:write', 'weights:read', 'weights:write',
  'qq:read', 'qq:send', 'web:read', 'phone:read', 'phone:control',
  'computer:read', 'computer:control', 'files:read', 'files:write'
]);

function validateTool(tool, pluginId) {
  if (!tool?.name || !/^[a-z][a-z0-9_]{1,63}$/.test(tool.name)) {
    throw new Error(`插件 ${pluginId} 注册了非法工具名：${tool?.name}`);
  }
  if (!tool.description) throw new Error(`插件 ${pluginId} 的工具 ${tool.name} 缺少 description`);
  if (!tool.parameters || tool.parameters.type !== 'object') {
    throw new Error(`插件 ${pluginId} 的工具 ${tool.name} 缺少 object 参数 schema`);
  }
  return {
    name: tool.name,
    description: String(tool.description).slice(0, 2000),
    parameters: tool.parameters,
    pluginId
  };
}

export class PluginHost {
  constructor({ config, logger, memory, weights, emit = () => {} }) {
    this.config = config;
    this.logger = logger;
    this.memory = memory;
    this.weights = weights;
    this.emit = emit;
    this.loaded = new Map();
    this.tools = new Map();
    this.hooks = new Map();
    this.manifests = [];
  }

  scan() {
    const manifests = [];
    if (!fs.existsSync(paths.plugins)) return manifests;
    for (const entry of fs.readdirSync(paths.plugins, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestFile = path.join(paths.plugins, entry.name, 'plugin.json');
      if (!fs.existsSync(manifestFile)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
        if (!/^[a-z0-9][a-z0-9_-]{1,40}$/i.test(manifest.id || '')) throw new Error('插件 id 非法');
        if (!manifest.entry || manifest.entry.includes('..') || path.isAbsolute(manifest.entry)) throw new Error('entry 路径非法');
        const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
        const invalid = permissions.filter((permission) => !ALLOWED_PERMISSIONS.has(permission));
        if (invalid.length) throw new Error(`未声明的权限：${invalid.join(', ')}`);
        manifests.push({
          ...manifest,
          permissions,
          dir: path.join(paths.plugins, entry.name),
          entryFile: path.join(paths.plugins, entry.name, manifest.entry),
          manifestFile
        });
      } catch (error) {
        manifests.push({
          id: entry.name,
          name: entry.name,
          version: '?',
          description: '清单读取失败',
          error: error.message,
          dir: path.join(paths.plugins, entry.name),
          permissions: []
        });
      }
    }
    this.manifests = manifests;
    return manifests;
  }

  isEnabled(manifest) {
    const cfg = this.config.get().plugins;
    const enabled = (cfg.enabled || []).includes(manifest.id);
    const disabled = (cfg.disabled || []).includes(manifest.id);
    return enabled && !disabled;
  }

  async loadAll() {
    await this.unloadAll();
    this.scan();
    for (const manifest of this.manifests) {
      if (manifest.error) {
        this.loaded.set(manifest.id, { manifest, status: 'error', error: manifest.error });
        continue;
      }
      if (!this.isEnabled(manifest)) {
        this.loaded.set(manifest.id, { manifest, status: 'disabled', tools: [], hooks: [] });
        continue;
      }
      await this.loadOne(manifest);
    }
    const status = this.status();
    this.emit('plugins:changed', status);
    return status;
  }

  async loadOne(manifest) {
    const pluginTools = [];
    const pluginHooks = [];
    const hookNames = new Set();
    const api = {
      pluginId: manifest.id,
      workspace: paths.root,
      memory: this.memory,
      weights: this.weights,
      logger: {
        info: (message, detail) => this.logger.info(`plugin:${manifest.id}`, String(message), detail),
        warn: (message, detail) => this.logger.warn(`plugin:${manifest.id}`, String(message), detail),
        error: (message, detail) => this.logger.error(`plugin:${manifest.id}`, String(message), detail)
      },
      registerTool: (tool) => {
        const validated = validateTool(tool, manifest.id);
        if (this.tools.has(validated.name)) throw new Error(`工具名冲突：${validated.name}`);
        const handler = typeof tool.execute === 'function' ? tool.execute : tool.handler;
        if (typeof handler !== 'function') throw new Error(`工具 ${validated.name} 缺少 execute`);
        this.tools.set(validated.name, { ...validated, execute: handler });
        pluginTools.push(validated.name);
      },
      on: (hook, fn) => {
        if (typeof fn !== 'function') throw new Error(`hook ${hook} 不是函数`);
        if (!hookNames.has(hook)) {
          hookNames.add(hook);
          pluginHooks.push(hook);
        }
        if (!this.hooks.has(hook)) this.hooks.set(hook, []);
        this.hooks.get(hook).push({ pluginId: manifest.id, fn });
      }
    };
    try {
      if (!fs.existsSync(manifest.entryFile)) throw new Error(`入口不存在：${manifest.entry}`);
      const moduleUrl = `${pathToFileURL(manifest.entryFile).href}?v=${Date.now()}`;
      const pluginModule = await import(moduleUrl);
      const activate = pluginModule.activate || pluginModule.default;
      if (typeof activate !== 'function') throw new Error('插件必须导出 activate(api)');
      const instance = await activate(api);
      this.loaded.set(manifest.id, {
        manifest,
        status: 'active',
        instance: instance || null,
        tools: pluginTools,
        hooks: pluginHooks,
        loadedAt: nowIso()
      });
      this.logger.info('plugins', `插件已加载：${manifest.name || manifest.id}`, { tools: pluginTools, hooks: pluginHooks });
    } catch (error) {
      for (const toolName of pluginTools) this.tools.delete(toolName);
      this.loaded.set(manifest.id, {
        manifest,
        status: 'error',
        error: error.message,
        tools: pluginTools,
        hooks: pluginHooks
      });
      this.logger.error('plugins', `插件加载失败：${manifest.id}：${error.message}`);
    }
  }

  async unloadAll() {
    for (const [id, record] of this.loaded) {
      try { await record.instance?.deactivate?.(); } catch (error) {
        this.logger.warn('plugins', `插件卸载失败：${id}：${error.message}`);
      }
    }
    this.loaded.clear();
    this.tools.clear();
    this.hooks.clear();
  }

  getTools() {
    return [...this.tools.values()].map(({ execute, ...tool }) => tool);
  }

  async executeTool(name, args = {}, ctx = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`插件工具不存在：${name}`);
    return tool.execute(args, {
      ...ctx,
      workspace: paths.root,
      pluginId: tool.pluginId
    });
  }

  async runHook(name, ctx = {}) {
    const entries = this.hooks.get(name) || [];
    for (const entry of entries) {
      try {
        await entry.fn(ctx);
      } catch (error) {
        this.logger.warn('plugins', `hook ${name}（${entry.pluginId}）执行失败：${error.message}`);
      }
    }
  }

  async setEnabled(pluginId, enabled) {
    const cfg = this.config.get().plugins;
    const set = new Set(cfg.enabled || []);
    const disabled = new Set(cfg.disabled || []);
    if (enabled) {
      set.add(pluginId);
      disabled.delete(pluginId);
    } else {
      set.delete(pluginId);
      disabled.add(pluginId);
    }
    this.config.save({ plugins: { enabled: [...set], disabled: [...disabled] } });
    return this.loadAll();
  }

  async reload() {
    return this.loadAll();
  }

  status() {
    return {
      directory: paths.plugins,
      plugins: this.manifests.map((manifest) => {
        const record = this.loaded.get(manifest.id);
        return {
          id: manifest.id,
          name: manifest.name || manifest.id,
          version: manifest.version || '?',
          description: manifest.description || '',
          author: manifest.author || '',
          builtin: Boolean(manifest.builtin),
          permissions: manifest.permissions || [],
          hooks: record?.hooks || manifest.hooks || [],
          tools: record?.tools || [],
          status: record?.status || 'not-loaded',
          error: record?.error || manifest.error || '',
          loadedAt: record?.loadedAt || null,
          dir: manifest.dir
        };
      }),
      tools: this.getTools().map((tool) => ({ name: tool.name, description: tool.description, pluginId: tool.pluginId })),
      hookNames: [...this.hooks.keys()]
    };
  }
}
