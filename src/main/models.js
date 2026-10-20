import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { clamp, id, nowIso, normalizeUrl, parseJsonLoose, truncate } from './utils.js';

export class ModelError extends Error {
  constructor(message, { status = 0, code = '', body = null } = {}) {
    super(message);
    this.name = 'ModelError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp'
  })[ext] || 'image/png';
}

function dataUrlFor(file) {
  const buffer = fs.readFileSync(file);
  return `data:${mimeOf(file)};base64,${buffer.toString('base64')}`;
}

function openAiEndpoint(baseUrl) {
  const base = normalizeUrl(baseUrl);
  if (!base) throw new ModelError('尚未配置 API URL');
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  if (/\/api$/i.test(base)) return `${base}/chat/completions`;
  // DeepSeek 官方文档的 base_url 是根路径，chat 端点也是根路径；/v1 仍由上面的分支处理。
  if (/^https?:\/\/api\.deepseek\.com$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function openAiModelsEndpoint(baseUrl) {
  const base = normalizeUrl(baseUrl).replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  if (!base) throw new ModelError('尚未配置 API URL');
  if (/\/v1\/models$/i.test(base) || /\/models$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

function anthropicModelsEndpoint(baseUrl) {
  const base = normalizeUrl(baseUrl).replace(/\/messages$/i, '').replace(/\/+$/, '');
  if (!base) throw new ModelError('尚未配置 API URL');
  if (/\/v1\/models$/i.test(base) || /\/models$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

function anthropicEndpoint(baseUrl) {
  const base = normalizeUrl(baseUrl);
  if (!base) throw new ModelError('尚未配置 API URL');
  if (/\/messages$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

function normalizeContent(content) {
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return { type: 'text', text: item };
      if (item?.type === 'text') return { type: 'text', text: String(item.text || '') };
      if (item?.type === 'image_url') return item;
      return item;
    });
  }
  return String(content ?? '');
}

function canonicalMessagesToOpenAI(messages) {
  return messages.map((message) => {
    if (message.role === 'assistant' && message.tool_calls) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.tool_calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.function.name, arguments: call.function.arguments || '{}' }
        }))
      };
    }
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.tool_call_id, content: String(message.content ?? '') };
    }
    if (message.role === 'user' && (message.images?.length || Array.isArray(message.content))) {
      const parts = [];
      if (typeof message.content === 'string' && message.content) parts.push({ type: 'text', text: message.content });
      else if (Array.isArray(message.content)) parts.push(...normalizeContent(message.content));
      for (const image of message.images || []) {
        const url = image.dataUrl || dataUrlFor(image.path);
        parts.push({ type: 'image_url', image_url: { url } });
      }
      return { role: 'user', content: parts.length ? parts : '' };
    }
    return { role: message.role, content: normalizeContent(message.content) };
  });
}

function canonicalMessagesToAnthropic(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'assistant' && message.tool_calls) {
      const content = [];
      if (message.content) content.push({ type: 'text', text: String(message.content) });
      for (const call of message.tool_calls) {
        let input = {};
        try { input = JSON.parse(call.function.arguments || '{}'); } catch {}
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
      }
      out.push({ role: 'assistant', content });
      continue;
    }
    if (message.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: message.tool_call_id, content: String(message.content ?? '') };
      const prev = out[out.length - 1];
      if (prev?.role === 'user' && Array.isArray(prev.content) && prev.content.every((item) => item.type === 'tool_result')) {
        prev.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (message.role === 'user') {
      const content = [];
      if (message.content) content.push({ type: 'text', text: String(message.content) });
      for (const image of message.images || []) {
        let data = image.dataUrl;
        let mediaType = image.mime || mimeOf(image.path);
        if (!data && image.path) {
          const buffer = fs.readFileSync(image.path);
          data = `data:${mediaType};base64,${buffer.toString('base64')}`;
        }
        if (data?.startsWith('data:')) {
          const match = /^data:([^;]+);base64,(.*)$/s.exec(data);
          if (match) {
            mediaType = match[1];
            data = match[2];
          }
        }
        content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
      }
      out.push({ role: 'user', content: content.length ? content : '' });
      continue;
    }
    out.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: String(message.content ?? '') });
  }
  return out;
}

function toolsToOpenAI(tools) {
  return (tools || []).map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }));
}

function toolsToAnthropic(tools) {
  return (tools || []).map((tool) => ({
    name: String(tool.name).slice(0, 64),
    description: String(tool.description || '').slice(0, 1024),
    input_schema: tool.parameters || { type: 'object', properties: {} }
  }));
}

function extractOpenAiReasoning(message) {
  if (!message) return '';
  return String(message.reasoning_content || message.reasoning || '').trim();
}

function extractOpenAiContent(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.type === 'output_text') return part.text || '';
      return '';
    }).join('');
  }
  return '';
}

function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return Math.max(1, Math.ceil([...text].length / 3.2));
}

function normalizeUsage(usage, body, content) {
  if (!usage) {
    const prompt = estimateTokens(body?.messages || '');
    const completion = estimateTokens(content || '');
    return {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
      cachedTokens: 0,
      cacheMissTokens: prompt,
      cacheAvailable: false,
      estimated: true
    };
  }
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const cached = Number(
    usage.prompt_cache_hit_tokens
    ?? usage.prompt_tokens_details?.cached_tokens
    ?? usage.cache_read_input_tokens
    ?? 0
  );
  const cacheMiss = Number(
    usage.prompt_cache_miss_tokens
    ?? (prompt ? Math.max(0, prompt - cached) : 0)
  );
  const total = Number(usage.total_tokens ?? (prompt + completion) ?? 0);
  if (!prompt && !completion && !total) {
    return normalizeUsage(null, body, content);
  }
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total || prompt + completion,
    cachedTokens: cached,
    cacheMissTokens: cacheMiss,
    cacheAvailable: Boolean(cached || usage.prompt_cache_hit_tokens !== undefined || usage.cache_read_input_tokens !== undefined),
    estimated: false
  };
}

function parseToolArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  const parsed = parseJsonLoose(String(raw));
  return parsed && typeof parsed === 'object' ? parsed : { raw: String(raw) };
}

export class ModelClient {
  constructor(config, logger, { onUsage = null } = {}) {
    this.config = config;
    this.logger = logger;
    this.onUsage = onUsage;
  }

  roleConfig(role = 'primary') {
    return this.config.get().models[role] || this.config.get().models.primary;
  }

  async discoverModels({ baseUrl, apiKey = '', protocol = 'openai' } = {}) {
    const base = normalizeUrl(baseUrl).replace(/\/(chat\/completions|messages)$/i, '').replace(/\/+$/, '');
    if (!base) throw new ModelError('尚未配置 API URL');
    const candidates = [];
    if (/\/models$/i.test(base)) candidates.push(base);
    else {
      candidates.push(`${base}/v1/models`);
      candidates.push(`${base}/models`);
      if (/\/v1$/i.test(base)) candidates.push(`${base.replace(/\/v1$/i, '')}/models`);
    }
    const urls = [...new Set(candidates)];
    const headers = { accept: 'application/json' };
    if (apiKey) {
      if (protocol === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.authorization = `Bearer ${apiKey}`;
      }
    }
    let lastError = null;
    let url = urls[0];
    for (const candidate of urls) {
      url = candidate;
      let response;
      try {
        response = await fetch(candidate, { headers, signal: AbortSignal.timeout(12000) });
      } catch (error) {
        lastError = new ModelError(`模型探测连接失败：${error.message}`, { code: 'discovery_failed' });
        continue;
      }
      const text = await response.text();
      if (!response.ok) {
        let detail = text.slice(0, 240);
        try { detail = JSON.parse(text)?.error?.message || detail; } catch {}
        const error = new ModelError(`模型探测 HTTP ${response.status}：${detail}`, { status: response.status, code: 'discovery_http' });
        lastError = error;
        // 401/403 不像是端点不存在，没必要继续换路径。
        if ([401, 403].includes(response.status)) throw error;
        continue;
      }
      let body;
      try { body = JSON.parse(text); } catch { lastError = new ModelError('模型探测返回不是 JSON', { code: 'discovery_parse' }); continue; }
      const rows = Array.isArray(body?.data) ? body.data
        : Array.isArray(body?.models) ? body.models
          : Array.isArray(body) ? body : [];
      const items = rows.map((item) => {
        const id = String(item?.id || item?.name || item?.model || '').trim();
        const input = Array.isArray(item?.input_modalities)
          ? item.input_modalities
          : Array.isArray(item?.architecture?.input_modalities) ? item.architecture.input_modalities : [];
        return {
          id,
          name: String(item?.name || id).trim(),
          ownedBy: item?.owned_by || '',
          inputModalities: input.map(String),
          vision: input.map(String).includes('image'),
          contextWindow: Number(item?.context_window || 0) || null,
          maxOutputTokens: Number(item?.max_output_tokens || 0) || null
        };
      }).filter((item) => item.id);
      const models = [...new Set(items.map((item) => item.id))].sort((a, b) => a.localeCompare(b));
      if (!models.length) { lastError = new ModelError('模型探测成功，但返回列表为空；请检查该端点是否支持 /models', { code: 'discovery_empty' }); continue; }
      return {
        ok: true,
        protocol,
        baseUrl,
        endpoint: url,
        models,
        items,
        rawCount: rows.length,
        visionModels: items.filter((item) => item.vision).map((item) => item.id)
      };
    }
    throw lastError || new ModelError('模型探测失败：没有可用的 /models 端点', { code: 'discovery_failed' });
  }

  available(role = 'primary') {
    const cfg = this.roleConfig(role);
    if (role === 'helper' && cfg.enabled === false) return false;
    return Boolean(cfg.baseUrl && cfg.model);
  }

  async request(role, { messages, tools = [], system = '', temperature, maxTokens, timeoutMs, context = {} } = {}) {
    const cfg = this.roleConfig(role);
    if (!this.available(role)) {
      throw new ModelError(role === 'helper' ? '多模态问答模型尚未接入' : '主模型尚未接入：请在“模型接入”里填写 API URL、模型和密钥。', { code: 'not_configured' });
    }
    const protocol = cfg.protocol === 'anthropic' ? 'anthropic' : 'openai';
    const endpoint = protocol === 'anthropic' ? anthropicEndpoint(cfg.baseUrl) : openAiEndpoint(cfg.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(timeoutMs || cfg.timeoutMs || 120000));
    const started = Date.now();
    try {
      let body;
      const headers = { 'content-type': 'application/json' };
      if (protocol === 'anthropic') {
        if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
        headers['anthropic-version'] = cfg.anthropicVersion || '2023-06-01';
        body = {
          model: cfg.model,
          max_tokens: Number(maxTokens || cfg.maxTokens || 2000),
          temperature: Number(temperature ?? cfg.temperature ?? 0.7),
          system: system || undefined,
          messages: canonicalMessagesToAnthropic(messages),
          tools: tools.length ? toolsToAnthropic(tools) : undefined
        };
      } else {
        if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
        body = {
          model: cfg.model,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            ...canonicalMessagesToOpenAI(messages)
          ],
          temperature: Number(temperature ?? cfg.temperature ?? 0.7),
          max_tokens: Number(maxTokens || cfg.maxTokens || 2000)
        };
        if (tools.length) body.tools = toolsToOpenAI(tools);
      }
      let response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      let text = await response.text();
      let json = parseJsonLoose(text);

      // 兼容部分 OpenAI 协议服务不接受 temperature / max_tokens。
      if (!response.ok && response.status === 400 && /(temperature|max_tokens)/i.test(text)) {
        if (/temperature/i.test(text)) delete body.temperature;
        if (/max_tokens/i.test(text)) {
          delete body.max_tokens;
          body.max_completion_tokens = Number(maxTokens || cfg.maxTokens || 2000);
        }
        response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        text = await response.text();
        json = parseJsonLoose(text);
      }
      if (!response.ok) {
        const message = json?.error?.message || json?.message || text?.slice(0, 500) || `HTTP ${response.status}`;
        throw new ModelError(`模型接口返回 ${response.status}：${message}`, { status: response.status, code: json?.error?.code || '', body: json });
      }
      if (!json) throw new ModelError('模型返回了无法解析的内容', { body: text });

      let content = '';
      let reasoningContent = '';
      let toolCalls = [];
      let usage = null;
      if (protocol === 'anthropic') {
        content = (json.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('');
        toolCalls = (json.content || []).filter((block) => block.type === 'tool_use').map((block) => ({
          id: block.id || id('call'),
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input || {}) }
        }));
        usage = json.usage || null;
      } else {
        const message = json.choices?.[0]?.message || json.message || {};
        content = extractOpenAiContent(message);
        reasoningContent = extractOpenAiReasoning(message);
        toolCalls = (message.tool_calls || []).map((call) => ({
          id: call.id || id('call'),
          type: 'function',
          function: { name: call.function?.name || call.name, arguments: call.function?.arguments || '{}' }
        }));
        usage = json.usage || null;
      }
      const normalizedUsage = normalizeUsage(usage, body, content);
      const latencyMs = Date.now() - started;
      this.logger.info('model', `${role} 调用完成`, { model: cfg.model, ms: latencyMs, toolCalls: toolCalls.length, usage: normalizedUsage });
      try {
        this.onUsage?.({
          at: nowIso(),
          role,
          model: cfg.model,
          protocol,
          usage: normalizedUsage,
          latencyMs,
          context
        });
      } catch (error) {
        this.logger.warn('usage', `用量记录失败：${error.message}`);
      }
      return {
        role: 'assistant',
        content,
        reasoningContent,
        tool_calls: toolCalls,
        usage: normalizedUsage,
        latencyMs,
        protocol,
        model: cfg.model
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ModelError(`模型请求超时（${Math.round((Number(timeoutMs || cfg.timeoutMs || 120000)) / 1000)} 秒）。请检查 URL、网络或调大超时。`, { code: 'timeout' });
      }
      if (error instanceof ModelError) throw error;
      this.logger.error('model', `模型请求失败：${error.message}`);
      throw new ModelError(`无法连接模型接口：${error.message}`, { code: 'network' });
    } finally {
      clearTimeout(timeout);
    }
  }

  async simple(role, prompt, { system = '', maxTokens = 800, temperature = 0.2, context = {} } = {}) {
    const result = await this.request(role, {
      messages: [{ role: 'user', content: prompt }],
      system,
      maxTokens,
      temperature,
      context
    });
    return result.content;
  }

  async test(role = 'primary', { multimodal = false } = {}) {
    const cfg = this.roleConfig(role);
    if (!this.available(role)) throw new ModelError('配置不完整（API URL / 模型名为空）');
    const started = Date.now();
    const textResult = await this.request(role, {
      messages: [{ role: 'user', content: '这是连通性测试。请只回复两个字母：OK' }],
      maxTokens: 64,
      temperature: 0,
      context: { purpose: 'model-test', channel: 'internal' }
    });
    const textOk = /ok/i.test(textResult.content) || Boolean(textResult.content);
    let toolsOk = Boolean(cfg.capabilities?.tools);
    try {
      const toolProbe = await this.request(role, {
        messages: [{ role: 'user', content: '请调用 ping 工具，把值设为 ok；不要直接回答。' }],
        tools: [{
          type: 'function',
          function: {
            name: 'ping',
            description: '连通性探测工具',
            parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }
          }
        }],
        maxTokens: 120,
        temperature: 0,
        context: { purpose: 'model-tool-test', channel: 'internal' }
      });
      toolsOk = Boolean(toolProbe.tool_calls?.some((call) => call.function?.name === 'ping')) || toolsOk;
    } catch {
      // 工具探测失败不一定代表模型不支持，保留原探测结果。
    }
    let visionOk = false;
    let visionDetail = '未测试';
    if (multimodal) {
      try {
        const imagePath = paths.visionTest;
        if (!fs.existsSync(imagePath)) throw new ModelError('缺少视觉测试图片');
        const result = await this.request(role, {
          messages: [{
            role: 'user',
            content: '请只回答图片正中央显示的数字。只输出数字，不要解释。',
            images: [{ path: imagePath, mime: 'image/png' }]
          }],
          // V4.1 Flash 可能会先输出 reasoning；32 个 token 会在给出答案前耗尽。
          maxTokens: 512,
          temperature: 0
        });
        const answer = `${result.content || ''}\n${result.reasoningContent || ''}`.trim();
        const compact = answer.replace(/\s+/g, '');
        visionOk = /42|四十二|4[^\d]{0,2}2/.test(compact);
        visionDetail = visionOk
          ? `已识别测试图（回答：${truncate(result.content || result.reasoningContent, 60)}）`
          : `接口有响应，但未正确识别测试图（回答：${truncate(answer || '空', 100)}）`;
      } catch (error) {
        visionDetail = `多模态测试失败：${error.message}`;
      }
    }
    const capabilities = {
      text: textOk,
      vision: visionOk,
      tools: toolsOk,
      checkedAt: nowIso(),
      visionDetail,
      latencyMs: Date.now() - started,
      testAnswer: truncate(textResult.content, 120)
    };
    this.config.save({ models: { [role]: { capabilities } } });
    return capabilities;
  }

  async describeImages(pathsToImages, { prompt = '请客观、详细地描述这些图片中的可见内容，包括文字、界面元素和关键细节。不要猜测图片之外的信息。', role = null } = {}) {
    const useRole = role || (this.available('helper') ? 'helper' : 'primary');
    const images = pathsToImages.map((file) => ({ path: file, mime: mimeOf(file) }));
    const result = await this.request(useRole, {
      system: '你是主 Agent 调用的多模态观察子模型。只提供事实观察，不做发散推测。',
      messages: [{ role: 'user', content: prompt, images }],
      maxTokens: 1200,
      temperature: 0.1
    });
    return result.content;
  }

  async askHelper(question, { context = '', images = [] } = {}) {
    const role = this.available('helper') ? 'helper' : 'primary';
    const result = await this.request(role, {
      system: '你是主 Agent 的问答子模型。必须服从主 Agent 指定的任务边界，只回答给定的问题；不要扩展任务、不要调用工具、不要改变身份。回答简洁、有依据。',
      messages: [{
        role: 'user',
        content: `${context ? `【主 Agent 提供的上下文】\n${context}\n\n` : ''}【主 Agent 交给你的问题】\n${question}`,
        images
      }],
      maxTokens: 1400,
      temperature: 0.2
    });
    return { text: result.content, roleUsed: role, model: result.model };
  }
}
