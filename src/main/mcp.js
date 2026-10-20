import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { paths } from './paths.js';
import { id, nowIso, truncate } from './utils.js';

function resolveCommand(server) {
  const command = String(server.command || '').trim();
  if (!command || command === 'node' || command === 'auto' || command === 'electron-node') {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { command, env: {} };
}

function resolveArgs(args = []) {
  return args.map((arg) => String(arg)
    .replace(/\$\{ROOT\}/g, paths.root)
    .replace(/\$\{TOOLS\}/g, paths.tools)
    .replace(/\$\{HOME\}/g, paths.root));
}

export class McpManager {
  constructor({ config, logger, emit = () => {} }) {
    this.config = config;
    this.logger = logger;
    this.emit = emit;
    this.clients = new Map();
    this.statusMap = new Map();
    this.tools = [];
  }

  serverConfigs() {
    return (this.config.get().mcp?.servers || []).filter((server) => server && server.id);
  }

  publicStatus() {
    return {
      servers: this.serverConfigs().map((server) => {
        const status = this.statusMap.get(server.id) || {};
        return {
          id: server.id,
          name: server.name || server.id,
          transport: server.transport || 'stdio',
          command: server.command || '',
          args: server.args || [],
          url: server.url || '',
          enabled: Boolean(server.enabled),
          status: status.status || (server.enabled ? 'stopped' : 'disabled'),
          error: status.error || '',
          tools: status.tools || [],
          pid: status.pid || null,
          startedAt: status.startedAt || null
        };
      }),
      tools: this.tools
    };
  }

  publish() {
    this.emit('mcp:changed', this.publicStatus());
  }

  async startAll() {
    if (!this.config.get().permissions.mcpServers) return this.publicStatus();
    for (const server of this.serverConfigs()) {
      if (server.enabled) {
        await this.start(server).catch((error) => {
          this.logger.warn('mcp', `MCP ${server.name || server.id} 启动失败：${error.message}`);
        });
      }
    }
    return this.publicStatus();
  }

  async start(server) {
    if (!server?.enabled) return null;
    if (this.clients.has(server.id)) await this.stop(server.id);
    const timeoutMs = Number(this.config.get().mcp?.startupTimeoutMs || 25000);
    const status = { status: 'starting', error: '', tools: [], startedAt: nowIso() };
    this.statusMap.set(server.id, status);
    this.publish();
    let transport;
    const transportType = server.transport || 'stdio';
    try {
      if (transportType === 'http') {
        if (!server.url) throw new Error('HTTP MCP 缺少 URL');
        transport = new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: server.headers || {} }
        });
      } else {
        const { command, env } = resolveCommand(server);
        const args = resolveArgs(server.args);
        transport = new StdioClientTransport({
          command,
          args,
          cwd: server.cwd ? path.resolve(paths.root, server.cwd) : paths.root,
          env: {
            ...process.env,
            ...env,
            BANXING_HOME: paths.root,
            ...(server.env || {})
          },
          stderr: 'pipe'
        });
        transport.stderr?.on('data', (chunk) => {
          const text = String(chunk).trim();
          if (text) this.logger.info(`mcp:${server.id}`, truncate(text, 800));
        });
      }
      const client = new Client(
        { name: `banxing-${server.id}`, version: '1.0.0' },
        { capabilities: {} }
      );
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`连接超时（${Math.round(timeoutMs / 1000)}s）`)), timeoutMs))
      ]);
      const listed = await client.listTools();
      const tools = (listed.tools || []).map((tool) => ({
        serverId: server.id,
        serverName: server.name || server.id,
        name: tool.name,
        agentName: this.agentToolName(server.id, tool.name),
        description: truncate(tool.description || '', 900),
        parameters: tool.inputSchema || { type: 'object', properties: {} }
      }));
      this.clients.set(server.id, { client, transport, server, tools });
      this.statusMap.set(server.id, {
        status: 'running',
        error: '',
        tools: tools.map((tool) => tool.name),
        pid: transport.pid || null,
        startedAt: status.startedAt
      });
      this.rebuildTools();
      this.logger.info('mcp', `MCP 已连接：${server.name || server.id}`, { tools: tools.map((tool) => tool.name) });
      this.publish();
      return tools;
    } catch (error) {
      try { await transport?.close?.(); } catch {}
      this.statusMap.set(server.id, { ...status, status: 'error', error: error.message });
      this.rebuildTools();
      this.publish();
      throw error;
    }
  }

  agentToolName(serverId, toolName) {
    return `mcp_${String(serverId).replace(/[^a-zA-Z0-9_]/g, '_')}_${String(toolName).replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 64);
  }

  rebuildTools() {
    this.tools = [];
    for (const { tools, server } of this.clients.values()) {
      for (const tool of tools) {
        this.tools.push({ ...tool, serverName: server.name || server.id });
      }
    }
  }

  getTools() {
    if (!this.config.get().permissions.mcpServers) return [];
    return this.tools.map(({ serverId, serverName, agentName, description, parameters }) => ({
      name: agentName,
      description: `[MCP:${serverName}] ${description || ''}`.slice(0, 2000),
      parameters
    }));
  }

  async execute(agentName, args) {
    const entry = this.tools.find((tool) => tool.agentName === agentName);
    if (!entry) throw new Error(`MCP 工具不存在：${agentName}`);
    const connection = this.clients.get(entry.serverId);
    if (!connection) throw new Error(`MCP 服务未连接：${entry.serverId}`);
    const result = await connection.client.callTool({ name: entry.name, arguments: args }, undefined, { timeout: 90000 });
    const content = (result.content || []).map((item) => {
      if (item.type === 'text') return item.text;
      if (item.type === 'image') return `[图片 ${item.mimeType || 'image'}，${String(item.data || '').length} base64 字符]`;
      if (item.type === 'resource') return `[资源 ${item.resource?.uri || ''}]`;
      return JSON.stringify(item);
    }).join('\n');
    return {
      content: content || '(MCP 工具无文本输出)',
      isError: Boolean(result.isError),
      structured: result.structuredContent || null,
      raw: result
    };
  }

  async stop(serverId) {
    const connection = this.clients.get(serverId);
    if (!connection) {
      this.statusMap.set(serverId, { status: 'stopped', error: '', tools: [] });
      this.publish();
      return;
    }
    try { await connection.client.close(); } catch (error) {
      this.logger.warn('mcp', `关闭 MCP ${serverId} 失败：${error.message}`);
    }
    try { await connection.transport.close(); } catch {}
    this.clients.delete(serverId);
    this.statusMap.set(serverId, { status: 'stopped', error: '', tools: [] });
    this.rebuildTools();
    this.publish();
  }

  async stopAll() {
    for (const serverId of [...this.clients.keys()]) await this.stop(serverId);
  }

  async addServer(input) {
    const server = {
      id: input.id || id('mcp'),
      name: input.name || input.id || 'MCP 服务',
      transport: input.transport === 'http' ? 'http' : 'stdio',
      command: input.command || 'node',
      args: Array.isArray(input.args) ? input.args : [],
      url: input.url || '',
      cwd: input.cwd || '',
      env: input.env && typeof input.env === 'object' ? input.env : {},
      headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
      enabled: input.enabled !== false,
      createdAt: nowIso()
    };
    const servers = [...this.serverConfigs(), server];
    this.config.save({ mcp: { servers } });
    if (server.enabled) await this.start(server);
    return this.publicStatus();
  }

  async updateServer(serverId, patch) {
    const servers = this.serverConfigs().map((server) => server.id === serverId ? { ...server, ...patch, id: serverId } : server);
    this.config.save({ mcp: { servers } });
    const target = servers.find((server) => server.id === serverId);
    if (this.clients.has(serverId)) await this.stop(serverId);
    if (target?.enabled) await this.start(target);
    return this.publicStatus();
  }

  async removeServer(serverId) {
    await this.stop(serverId);
    const servers = this.serverConfigs().filter((server) => server.id !== serverId);
    this.config.save({ mcp: { servers } });
    return this.publicStatus();
  }

  async restart(serverId) {
    const server = this.serverConfigs().find((item) => item.id === serverId);
    if (!server) throw new Error('MCP 服务不存在');
    await this.stop(serverId);
    return this.start(server);
  }
}

export function builtinMcpSamples() {
  const phoneBundle = fs.existsSync(path.join(paths.root, 'mcp', 'phone', 'mcp-phone.bundle.mjs'));
  const computerBundle = fs.existsSync(path.join(paths.root, 'mcp', 'computer', 'mcp-computer.bundle.mjs'));
  return [
    {
      id: 'phone',
      name: '手机 MCP（真机/模拟器）',
      transport: 'stdio',
      command: 'node',
      args: [phoneBundle ? 'mcp/phone/mcp-phone.bundle.mjs' : 'mcp/phone/mcp-phone.js'],
      enabled: false,
      note: '与内置手机面板共用 ADB；独立 MCP 服务可给其他客户端使用。'
    },
    {
      id: 'computer',
      name: '电脑 MCP（Windows）',
      transport: 'stdio',
      command: 'node',
      args: [computerBundle ? 'mcp/computer/mcp-computer.bundle.mjs' : 'mcp/computer/mcp-computer.js'],
      enabled: false,
      note: '截图、点击、输入；Shell 默认关闭。'
    }
  ];
}
