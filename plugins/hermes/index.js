/**
 * Hermes 长期记忆插件（内置）
 *
 * 通过插件 API 接入伴行的分层记忆：
 *   - hermes_recall：跨知识/稳定关系/情感事件/工作日志/多模态召回
 *   - hermes_remember：受控写入稳定关系记忆或候选知识
 *   - hermes_reflect：读取最近互动取向，形成可保存的反思
 *   - hermes_growth：查看长期记忆与三线成长的定性摘要
 *
 * 情绪事件与稳定偏好分开标记，避免把一时情绪写成永久人设。
 */
export function activate(api) {
  api.logger.info('Hermes 已加载：长期记忆与成长工具就绪');

  api.registerTool({
    name: 'hermes_recall',
    description: '从伴行的分层长期记忆中做加权召回。稳定偏好/边界优先；知识附核验时间、置信度和来源；情感事件只作为当时感受。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要回忆的主题或用户当前问题' },
        layer: {
          type: 'string',
          enum: ['all', 'knowledge', 'stable', 'emotional', 'worklogs', 'multimodal'],
          description: '只召回某一层；默认 all'
        }
      },
      required: ['query']
    },
    async execute({ query, layer = 'all' }, ctx) {
      const built = api.memory.buildContext(String(query || ctx.text || ''));
      const stable = (built.hits.relationship || []).filter((item) => (item.memoryClass || (item.kind === 'emotional_event' ? 'emotional' : 'stable')) === 'stable');
      const emotional = (built.hits.relationship || []).filter((item) => (item.memoryClass || (item.kind === 'emotional_event' ? 'emotional' : 'stable')) === 'emotional');
      const groups = {
        knowledge: built.hits.knowledge || [],
        stable,
        emotional,
        worklogs: built.hits.worklogs || [],
        multimodal: built.hits.multimodal || []
      };
      const format = (name, items) => {
        if (!items.length) return '';
        const label = name === 'knowledge' ? '知识记忆' : name === 'stable' ? '稳定关系记忆' : name === 'emotional' ? '情感记忆（仅当时感受）' : name;
        return `${label}：\n${items.map((item) => {
          const title = item.title || item.content || item.fileName || item.id;
          const meta = [
            item.verifiedAt ? `核验 ${item.verifiedAt.slice(0, 16)}` : '',
            item.confidence != null ? `置信 ${Math.round(Number(item.confidence) * 100)}%` : '',
            item.score != null ? `召回分 ${item.score}` : ''
          ].filter(Boolean).join('｜');
          return `- [${item.id}] ${String(title).slice(0, 300)}${meta ? `（${meta}）` : ''}`;
        }).join('\n')}`;
      };
      if (layer === 'all') {
        return [format('knowledge', groups.knowledge), format('stable', groups.stable), format('emotional', groups.emotional), format('worklogs', groups.worklogs), format('multimodal', groups.multimodal)].filter(Boolean).join('\n\n') || '没有召回相关记忆。';
      }
      return format(layer, groups[layer] || []) || `「${layer}」没有召回相关条目。`;
    }
  });

  api.registerTool({
    name: 'hermes_remember',
    description: '把用户明确表达且值得长期保留的信息写入稳定关系记忆，或把已验证事实存为知识候选。不要保存寒暄、临时任务、未核实传闻或一次性情绪。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['relationship', 'knowledge'], description: 'relationship=偏好/边界/画像；knowledge=事实候选' },
        memory_class: { type: 'string', enum: ['stable', 'emotional'], description: 'relationship 时区分稳定偏好/边界和一次情绪事件' },
        content: { type: 'string', description: '要保存的内容，保留用户原话中的关键限定' },
        title: { type: 'string', description: '简短标题' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        confidence: { type: 'number', description: '0-1；没有来源时不要高于 0.6' }
      },
      required: ['kind', 'content']
    },
    async execute({ kind, memory_class = 'stable', content, title = '', tags = [], confidence = 0.6 }, ctx) {
      if (kind === 'relationship') {
        const relationshipKind = memory_class === 'emotional' ? 'emotional_event' : 'preference';
        const record = api.memory.addRelationship({
          kind: relationshipKind,
          title: title || String(content).slice(0, 40),
          content,
          confidence: Math.min(0.95, Math.max(0.3, Number(confidence) || 0.6)),
          source: ctx.channel || 'plugin',
          evidence: ctx.text || ''
        });
        return `已写入${memory_class === 'emotional' ? '情感记忆' : '稳定关系记忆'}：${record?.title || content}（id=${record?.id}）`;
      }
      const fact = api.memory.saveKnowledge({
        title: title || String(content).slice(0, 60),
        content,
        tags,
        confidence: Math.min(0.65, Math.max(0.2, Number(confidence) || 0.5)),
        status: 'candidate',
        sources: [],
        sourceKind: 'plugin-candidate'
      });
      return `已存为知识候选（未经交叉验证，不会当作正式事实）：${fact.title}（id=${fact.id}）`;
    }
  });

  api.registerTool({
    name: 'hermes_reflect',
    description: '读取最近交互取向的定性反思（不包含权重数值）。适合在一天结束或用户询问“我们最近怎么样”时使用。',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      const text = api.weights.fallbackReflection();
      return text || '还没有足够的权重轨迹可供反思。';
    }
  });

  api.registerTool({
    name: 'hermes_growth',
    description: '查看长期记忆与三线成长的定性摘要：记忆层数量、当前取向、最近触发点和可用的反思。',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      const stats = api.memory.stats();
      const state = api.weights.getState();
      return [
        `长期记忆：知识 ${stats.knowledge} · 关系 ${stats.relationship} · 工作日志 ${stats.worklogs} · 多模态 ${stats.multimodal} · 反思 ${stats.reflections}`,
        `当前取向：${state.mode?.label || '并行'}`,
        state.history?.slice(-3).map((event) => `· ${event.at?.slice(0, 16)} ${(event.drivers || []).join('、')}`).join('\n') || '· 还没有轨迹',
        api.weights.fallbackReflection() || '· 还没有足够轨迹形成反思'
      ].join('\n');
    }
  });

  api.on('onStartup', async () => {
    const stats = api.memory.stats();
    api.logger.info(`Hermes 记忆总览：知识 ${stats.knowledge} · 关系 ${stats.relationship} · 工作日志 ${stats.worklogs} · 多模态 ${stats.multimodal}`);
  });

  api.on('onUserMessage', async ({ text }) => {
    if (api.memory.isChallenge(text)) {
      api.logger.warn('Hermes', '检测到用户质疑，交由学习闭环复核相关条目');
    }
  });

  return {
    async deactivate() {
      api.logger.info('Hermes 已卸载');
    }
  };
}
