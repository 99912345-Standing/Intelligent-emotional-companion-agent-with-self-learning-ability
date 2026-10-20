import path from 'node:path';
import { paths } from './paths.js';
import { JsonlStore } from './jsonl.js';
import {
  atomicWriteJson, clamp, id, nowIso, readJson, round, truncate
} from './utils.js';

const WORK_TERMS = [
  ['任务', 0.8], ['项目', 0.8], ['工作', 0.55], ['代码', 0.9], ['报告', 0.8], ['文档', 0.7],
  ['方案', 0.7], ['计划', 0.6], ['整理', 0.6], ['开会', 0.6], ['推进', 0.6], ['客户', 0.8],
  ['需求', 0.7], ['bug', 0.9], ['部署', 0.8], ['配置', 0.6], ['截止', 0.9], ['ddl', 1.0],
  ['交付', 0.8], ['进度', 0.7], ['作业', 0.7], ['论文', 0.8], ['数据', 0.6], ['表', 0.4],
  ['帮我写', 0.9], ['帮我做', 0.9], ['写完', 0.7], ['修好', 0.8], ['先做', 0.6], ['开始', 0.4],
  ['实现', 0.75], ['调试', 0.85], ['测试', 0.6], ['修复', 0.8], ['报错', 0.8], ['安装', 0.55],
  ['文件', 0.55], ['网页', 0.5], ['链接', 0.45], ['搜索', 0.5], ['查一下', 0.55], ['打开', 0.45],
  ['做一个', 0.9], ['写一个', 0.85], ['改一下', 0.75], ['上线', 0.8], ['发布', 0.7]
];

const COMPANION_TERMS = [
  ['累了', 1.0], ['好累', 1.0], ['疲惫', 0.95], ['撑不住', 1.0], ['难受', 0.9], ['不开心', 0.85],
  ['难过', 0.9], ['焦虑', 0.9], ['压力', 0.8], ['孤独', 0.9], ['想哭', 1.0], ['崩溃', 1.0],
  ['陪我', 0.95], ['聊聊天', 0.8], ['抱抱', 0.9], ['安慰', 0.8], ['想你', 0.85], ['晚安', 0.7],
  ['休息', 0.7], ['放松', 0.65], ['无聊', 0.6], ['开心', 0.7], ['高兴', 0.65], ['喜欢', 0.55],
  ['爱你', 0.9], ['辛苦', 0.8], ['摸摸', 0.7], ['委屈', 0.9], ['烦', 0.75], ['叹气', 0.5],
  ['吃了吗', 0.5], ['晚安啦', 0.75], ['戳戳', 0.8], ['摸摸', 0.8], ['贴贴', 0.9],
  ['亲亲', 0.9], ['抱抱我', 1.0], ['不理你', 0.8], ['生气', 0.85], ['哼', 0.6],
  ['呜呜', 0.9], ['笑死', 0.6], ['哈哈哈', 0.55], ['可爱', 0.6], ['生硬', 0.75],
  ['笨', 0.7], ['傻', 0.65], ['逆天', 0.7], ['无语', 0.75], ['离谱', 0.7],
  ['在吗', 0.55], ['早安', 0.65], ['午安', 0.6], ['谢谢', 0.45]
];

const LEARNING_TERMS = [
  ['学习', 0.8], ['查资料', 0.9], ['研究', 0.85], ['不懂', 0.9], ['为什么', 0.8], ['原理', 0.8],
  ['教程', 0.85], ['想学', 0.95], ['教我', 0.9], ['搞清楚', 0.8], ['了解', 0.65], ['区分', 0.7],
  ['怎么做到', 0.85], ['怎么实现', 0.9], ['验证', 0.7], ['来源', 0.6],
  ['查一下', 0.8], ['搜一下', 0.8], ['搜索', 0.75], ['网址', 0.7], ['网页', 0.65],
  ['资料', 0.7], ['区别', 0.7], ['是什么', 0.55], ['如何', 0.65], ['能不能', 0.5]
];

const HIGH_COMPANION = /(我(好|很|有点|真的|今天)?(累|疲惫|难受|不开心|难过|焦虑|孤独|崩溃|想哭|撑不住)|不想动|压力(好|很|太)大|陪陪我|抱抱我|抱抱|贴贴|摸摸|亲亲|戳戳|我快(累死|崩了)|哄哄我|别生气|呜呜)/i;
const HIGH_WORK = /(现在就要|马上要|立刻|截止|ddl|deadline|今晚必须|今天必须|客户催|交不上|来不及|紧急|帮我写|帮我做|做一个|写一个|修复|调试|部署|上线|报错)/i;
const HIGH_LEARNING = /(教我|想学|不懂|为什么|原理|怎么实现|怎么做到|搞清楚)/i;
const CONTINUATION = /(继续|接着|刚才|上次|之前|那个|回到|我们聊到|接着弄|继续弄)/i;
const META_DISCUSSION = /(权重|三线|工作线|陪伴线|学习线|插件|系统提示|Hermes|记忆层|后台判断)/i;
const MEANINGFUL = /[\u3400-\u9fffA-Za-z0-9]/;
const STOP_BIGRAMS = new Set([
  '我们', '你们', '他们', '这个', '那个', '就是', '还是', '可以', '什么', '怎么', '现在',
  '今天', '明天', '刚才', '继续', '一下', '一个', '没有', '不是', '然后', '因为', '所以'
]);

function lexicalScore(text) {
  const value = String(text || '').toLowerCase();
  const workHits = [];
  const companionHits = [];
  const learningHits = [];
  let work = 0;
  let companion = 0;
  let learning = 0;
  for (const [term, weight] of WORK_TERMS) {
    if (value.includes(term)) {
      work += weight;
      workHits.push(term);
    }
  }
  for (const [term, weight] of COMPANION_TERMS) {
    if (value.includes(term)) {
      companion += weight;
      companionHits.push(term);
    }
  }
  for (const [term, weight] of LEARNING_TERMS) {
    if (value.includes(term)) {
      learning += weight;
      learningHits.push(term);
    }
  }
  return {
    work: clamp(work / 2.4, 0, 1),
    companion: clamp(companion / 2.2, 0, 1),
    learning: clamp(learning / 2.2, 0, 1),
    workHits: [...new Set(workHits)].slice(0, 6),
    companionHits: [...new Set(companionHits)].slice(0, 6),
    learningHits: [...new Set(learningHits)].slice(0, 6)
  };
}

function topicTokens(text) {
  const value = String(text || '').toLowerCase()
    .replace(/[^\u3400-\u9fffA-Za-z0-9]+/g, ' ')
    .trim();
  const out = new Set();
  for (const part of value.split(/\s+/).filter(Boolean)) {
    if (/^[a-z0-9]+$/.test(part)) {
      if (part.length >= 2) out.add(part.slice(0, 24));
      continue;
    }
    for (let index = 0; index < part.length - 1; index += 1) {
      const bigram = part.slice(index, index + 2);
      if (!STOP_BIGRAMS.has(bigram)) out.add(bigram);
    }
  }
  return [...out].slice(0, 90);
}

function tokenOverlap(a, b) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let hit = 0;
  for (const token of a) if (setB.has(token)) hit += 1;
  return hit / Math.max(1, Math.min(a.length, b.length));
}

function normalizeVector(values, baseline) {
  const keys = ['work', 'companion', 'learning'];
  const next = {};
  let sum = 0;
  for (const key of keys) {
    next[key] = Math.max(0, Number(values?.[key] ?? 0));
    sum += next[key];
  }
  if (sum <= 0.000001) return { ...baseline };
  for (const key of keys) next[key] = next[key] / sum;
  return next;
}

export class WeightEngine {
  constructor(config, logger, emit = () => {}) {
    this.config = config;
    this.logger = logger;
    this.emit = emit;
    this.file = path.join(paths.memory, 'weight-state.json');
    this.history = new JsonlStore(path.join(paths.memory, 'weights.jsonl'), 'weights');
    this.anchors = new JsonlStore(path.join(paths.memory, 'weight-anchors.jsonl'), 'weight-anchors');
    const saved = readJson(this.file, null);
    const baseline = this.baseline();
    const initial = config.get().weights.initial || {};
    const savedAt = saved?.updatedAt || nowIso();
    this.state = normalizeVector({
      work: saved?.work ?? initial.work ?? baseline.work,
      companion: saved?.companion ?? initial.companion ?? baseline.companion,
      learning: saved?.learning ?? initial.learning ?? baseline.learning
    }, baseline);
    this.state = {
      ...this.state,
      updatedAt: savedAt,
      lastSignalAt: saved?.lastSignalAt || savedAt,
      lastDecayAt: saved?.lastDecayAt || savedAt,
      lastEventAt: saved?.lastEventAt || null,
      lastEventType: saved?.lastEventType || '',
      lastAiTuneAt: saved?.lastAiTuneAt || null,
      lastIntent: saved?.lastIntent || { primary: 'balanced', confidence: 0 },
      lastAnchor: saved?.lastAnchor || null,
      events: Number(saved?.events || this.history.count()),
      lastReflectedEvent: Number(saved?.lastReflectedEvent || 0)
    };
  }

  baseline() {
    const cfg = this.config.get().weights || {};
    const raw = cfg.baseline || { work: 0.3, companion: 0.4, learning: 0.3 };
    return normalizeVector(raw, { work: 0.3, companion: 0.4, learning: 0.3 });
  }

  save() {
    atomicWriteJson(this.file, this.state);
  }

  normalized(raw = this.state) {
    return {
      work: round(Number(raw.work || 0) * 100, 1),
      companion: round(Number(raw.companion || 0) * 100, 1),
      learning: round(Number(raw.learning || 0) * 100, 1)
    };
  }

  mode(raw = this.state) {
    const entries = [
      ['work', Number(raw.work || 0), '工作主导', '工作与陪伴同时在场'],
      ['companion', Number(raw.companion || 0), '陪伴主导', '工作与学习仍然保留'],
      ['learning', Number(raw.learning || 0), '学习探索', '工作与陪伴仍然保留']
    ].sort((a, b) => b[1] - a[1]);
    if (entries[0][1] - entries[1][1] <= 0.1) {
      return { key: 'parallel', label: '三线并行', detail: '工作、陪伴与学习同时在场' };
    }
    return { key: entries[0][0], label: entries[0][2], detail: entries[0][3] };
  }

  analyzeText(text) {
    const value = String(text || '').trim();
    const lexical = lexicalScore(value);
    let work = lexical.work;
    let companion = lexical.companion;
    let learning = lexical.learning;
    const workHigh = HIGH_WORK.test(value);
    const companionHigh = HIGH_COMPANION.test(value);
    const learningHigh = HIGH_LEARNING.test(value);
    if (workHigh) work = Math.max(work, 0.92);
    if (companionHigh) companion = Math.max(companion, 1);
    if (learningHigh) learning = Math.max(learning, 0.9);
    // “工作/陪伴/学习机制本身”是元讨论，不应把整段对话硬判成工作线。
    const metaDiscussion = META_DISCUSSION.test(value) && !/(帮我|做一个|写一个|修复|调试|查一下|抱抱|难受|累了)/.test(value);
    if (metaDiscussion) {
      work *= 0.35;
      companion *= 0.55;
      learning *= 0.75;
    }
    const maxScore = Math.max(work, companion, learning);
    const primary = companionHigh ? 'companion'
      : workHigh ? 'work'
        : learningHigh ? 'learning'
          : maxScore > 0.18
            ? (companion >= work && companion >= learning ? 'companion' : work >= learning ? 'work' : 'learning')
            : 'balanced';
    const intentConfidence = maxScore <= 0 ? 0.3 : round(clamp(maxScore, 0, 1), 3);
    const salience = clamp(
      Math.max(work, companion, learning) * 0.6 +
      (workHigh || companionHigh || learningHigh ? 0.4 : 0) +
      (lexical.workHits.length + lexical.companionHits.length + lexical.learningHits.length > 1 ? 0.1 : 0),
      0, 1
    );
    return {
      work: round(work, 3),
      companion: round(companion, 3),
      learning: round(learning, 3),
      workHigh,
      companionHigh,
      learningHigh,
      salience: round(salience, 3),
      workHits: lexical.workHits,
      companionHits: lexical.companionHits,
      learningHits: lexical.learningHits,
      intent: { primary, confidence: intentConfidence, metaDiscussion }
    };
  }

  addAnchor({ channel = 'desktop', excerpt = '', worklogId = null, weights: snapshot = null } = {}) {
    const text = String(excerpt || '').trim();
    const tokens = topicTokens(text);
    if (tokens.length < 2) return null;
    const recent = this.anchors.all().slice(-100);
    const duplicate = [...recent].reverse().find((anchor) => tokenOverlap(anchor.tokens || [], tokens) > 0.9);
    const anchorWeights = snapshot || { work: this.state.work, companion: this.state.companion, learning: this.state.learning };
    if (duplicate) {
      const updated = {
        ...duplicate,
        at: nowIso(),
        channel,
        excerpt: truncate(text, 260),
        weights: anchorWeights,
        worklogId: worklogId || duplicate.worklogId
      };
      this.anchors.update(duplicate.id, updated);
      return updated;
    }
    const anchor = {
      id: id('anchor'),
      at: nowIso(),
      channel,
      excerpt: truncate(text, 260),
      tokens,
      weights: anchorWeights,
      worklogId
    };
    this.anchors.append(anchor);
    const all = this.anchors.all();
    if (all.length > 100) this.anchors.replaceAll(all.slice(-100));
    return anchor;
  }

  getAnchor(anchorId) {
    if (!anchorId) return null;
    return this.anchors.get(anchorId) || null;
  }

  findAnchor(text) {
    const tokens = topicTokens(text);
    if (!tokens.length) return null;
    const cue = CONTINUATION.test(String(text || ''));
    let best = null;
    for (const anchor of this.anchors.all().slice(-100)) {
      const similarity = tokenOverlap(anchor.tokens || [], tokens);
      if (!best || similarity > best.similarity) best = { ...anchor, similarity };
    }
    if (!best) return null;
    if (cue && best.similarity >= 0.18) return { ...best, cue: true };
    if (!cue && best.similarity >= 0.55) return { ...best, cue: false };
    return null;
  }

  decayTo(now = Date.now()) {
    const last = Date.parse(this.state.lastDecayAt || this.state.updatedAt) || now;
    const minutes = Math.max(0, (now - last) / 60000);
    if (minutes < 0.04) return { changed: false, idleMinutes: minutes };
    const cfg = this.config.get().weights;
    const baseline = this.baseline();
    const halfLife = cfg.halfLifeMinutes || {};
    const tau = {
      work: Math.max(1, Number(halfLife.work || 20)) / Math.LN2,
      companion: Math.max(1, Number(halfLife.companion || 90)) / Math.LN2,
      learning: Math.max(1, Number(halfLife.learning || 45)) / Math.LN2
    };
    const before = { work: this.state.work, companion: this.state.companion, learning: this.state.learning };
    const next = {};
    for (const key of ['work', 'companion', 'learning']) {
      next[key] = baseline[key] + (before[key] - baseline[key]) * Math.exp(-minutes / tau[key]);
    }
    const normalizedNext = normalizeVector(next, baseline);
    const changed = Math.max(
      Math.abs(normalizedNext.work - before.work),
      Math.abs(normalizedNext.companion - before.companion),
      Math.abs(normalizedNext.learning - before.learning)
    ) > 0.00005;
    if (changed) {
      this.state = {
        ...this.state,
        ...normalizedNext,
        updatedAt: new Date(now).toISOString(),
        lastDecayAt: new Date(now).toISOString()
      };
    }
    const idleMinutes = Math.max(0, (now - (Date.parse(this.state.lastSignalAt || this.state.updatedAt) || now)) / 60000);
    return {
      changed,
      before,
      after: { work: this.state.work, companion: this.state.companion, learning: this.state.learning },
      idleMinutes,
      shouldArchive: idleMinutes >= Number(this.config.get().weights.worklogTransferMinutes || 300)
    };
  }

  /**
   * 指数衰减：每个维度向自己的 baseline 回归。
   * 工作半衰期短、陪伴更长；学习介于两者之间。
   */
  decayIdle(now = Date.now()) {
    const result = this.decayTo(now);
    if (!result.changed) return { ...result, eventType: 'decay' };
    const at = new Date(now).toISOString();
    const record = {
      id: id('wt_decay'),
      at,
      channel: null,
      source: 'idle',
      excerpt: '无新信号，权重按指数向基线衰减',
      before: result.before,
      after: result.after,
      normalized: this.normalized(),
      salience: 0,
      drivers: ['时间衰减 → 基线'],
      eventType: 'decay',
      mode: this.mode().key
    };
    this.history.append(record);
    this.save();
    this.emit('weights:changed', this.getState(record));
    return { ...result, eventType: 'decay', record };
  }

  updateFromMessage(text, { channel = 'desktop', source = 'user', excerpt = null } = {}) {
    const meaningful = MEANINGFUL.test(String(text || ''));
    if (!meaningful) return this.getState();
    const cfg = this.config.get().weights;
    const now = Date.now();
    const at = new Date(now).toISOString();
    // 先结算时间衰减，再处理本轮信号；衰减不会触发归档，归档由 handleIdleDecay 处理。
    this.decayTo(now);
    const signal = this.analyzeText(text);
    const before = { work: this.state.work, companion: this.state.companion, learning: this.state.learning };
    const anchor = this.findAnchor(text);
    let anchorRestored = null;
    let vector = { ...before };
    if (anchor) {
      vector = normalizeVector(anchor.weights, this.baseline());
      this.state.lastAnchor = anchor.id;
      anchorRestored = anchor;
    }

    // 普通信号：只推一小步，不做硬切。
    // 普通信号给足可见幅度；三线不是只在“强事件”时才动。
    if (signal.work > 0.03) vector.work += signal.work * 0.3;
    if (signal.companion > 0.03) vector.companion += signal.companion * 0.3;
    if (signal.learning > 0.03) vector.learning += signal.learning * 0.3;

    // 快变量：强信号立即重加权，但另一维度保留 baseline。
    const high = signal.companionHigh ? 'companion' : signal.workHigh ? 'work' : signal.learningHigh ? 'learning' : null;
    let highApplied = false;
    let highBlocked = '';
    if (high) {
      const lastAt = Date.parse(this.state.lastEventAt || '') || 0;
      const cooldownMs = Math.max(0, Number(cfg.eventCooldownSec ?? 30)) * 1000;
      const withinCooldown = lastAt && now - lastAt < cooldownMs;
      const reverse = this.state.lastEventType && this.state.lastEventType !== high;
      const reverseThreshold = Number(cfg.reverseConfidenceThreshold ?? 0.75);
      if (withinCooldown && (reverse ? signal.salience < reverseThreshold : true)) {
        highBlocked = reverse ? '反向触发置信度不足（迟滞）' : '事件冷却中';
        highApplied = false;
      } else {
        highApplied = true;
      }
      if (highApplied) {
        const others = ['work', 'companion', 'learning'].filter((key) => key !== high);
        const otherFloor = Number(cfg.otherBaseline ?? 0.3);
        const maxOther = Math.max(...others.map((key) => vector[key]));
        vector[high] = Math.max(
          Number(vector[high] || 0),
          Number(cfg.highThreshold ?? 0.7),
          maxOther + Number(cfg.eventMargin ?? 0.05)
        );
        for (const key of others) vector[key] = Math.max(Number(vector[key] || 0), otherFloor);
      }
    }

    const normalized = normalizeVector(vector, this.baseline());
    this.state = {
      ...this.state,
      ...normalized,
      updatedAt: at,
      lastSignalAt: at,
      lastDecayAt: at,
      events: this.state.events + 1,
      lastIntent: signal.intent,
      lastReflectedEvent: this.state.lastReflectedEvent
    };
    if (highApplied && high) {
      this.state.lastEventAt = at;
      this.state.lastEventType = high;
    }
    const drivers = [];
    if (anchorRestored) drivers.push('话题锚点恢复');
    if (highApplied && high === 'companion') drivers.push('高权重陪伴事件');
    if (highApplied && high === 'work') drivers.push('高权重工作事件');
    if (highApplied && high === 'learning') drivers.push('高权重学习事件');
    if (highBlocked) drivers.push(highBlocked);
    if (signal.companionHits.length) drivers.push(`陪伴信号：${signal.companionHits.join('、')}`);
    if (signal.workHits.length) drivers.push(`工作信号：${signal.workHits.join('、')}`);
    if (signal.learningHits.length) drivers.push(`学习信号：${signal.learningHits.join('、')}`);
    if (!drivers.length) drivers.push('自然漂移');
    const eventType = highApplied ? `${high}_event` : anchorRestored ? 'anchor_restore' : 'drift';
    const record = {
      id: id('wt'),
      at,
      channel,
      source,
      excerpt: truncate(excerpt || text, 180),
      before,
      after: { work: this.state.work, companion: this.state.companion, learning: this.state.learning },
      normalized: this.normalized(),
      salience: signal.salience,
      intent: signal.intent,
      drivers,
      eventType,
      anchorId: anchorRestored?.id || null,
      anchorSimilarity: anchorRestored?.similarity || null,
      mode: this.mode().key
    };
    this.history.append(record);
    this.save();
    this.emit('weights:changed', this.getState(record));

    // 工作/学习信号会留下话题锚点，供“继续刚才那个”恢复当时的权重。
    if (signal.work > 0.16 || signal.learning > 0.14) {
      this.addAnchor({ channel, excerpt: excerpt || text });
    }
    return this.getState(record);
  }

  aiTune({ direction = 'balance', strength = 0.03, reason = '', channel = 'desktop' } = {}) {
    const cfg = this.config.get().weights;
    const now = Date.now();
    const cooldownMs = Math.max(0, Number(cfg.aiTuneCooldownSec ?? 20)) * 1000;
    if (this.state.lastAiTuneAt && now - Date.parse(this.state.lastAiTuneAt) < cooldownMs) {
      throw new Error('权重微调太频繁，请等下一轮对话再调整');
    }
    const delta = clamp(Number(strength) || 0.03, 0.01, Number(cfg.aiTuneMaxDelta ?? 0.06));
    const before = { work: this.state.work, companion: this.state.companion, learning: this.state.learning };
    const vector = { ...before };
    if (direction === 'work') vector.work += delta;
    else if (direction === 'companion') vector.companion += delta;
    else if (direction === 'learning') vector.learning += delta;
    else {
      const baseline = this.baseline();
      for (const key of ['work', 'companion', 'learning']) vector[key] += (baseline[key] - vector[key]) * 0.25;
    }
    const normalized = normalizeVector(vector, this.baseline());
    this.state = {
      ...this.state,
      ...normalized,
      updatedAt: nowIso(),
      lastAiTuneAt: nowIso()
    };
    const record = {
      id: id('wt_ai'),
      at: this.state.updatedAt,
      channel,
      source: 'ai',
      excerpt: truncate(reason || 'AI 根据对话微调权重', 160),
      before,
      after: { work: this.state.work, companion: this.state.companion, learning: this.state.learning },
      normalized: this.normalized(),
      salience: delta,
      drivers: [`AI 微调：${truncate(reason || direction, 80)}`],
      eventType: 'ai_tune',
      mode: this.mode().key
    };
    this.history.append(record);
    this.save();
    this.emit('weights:changed', this.getState(record));
    return { ...this.qualitativeState(), changed: true, direction };
  }

  completeLearning() {
    const baseline = this.baseline();
    const before = { work: this.state.work, companion: this.state.companion, learning: this.state.learning };
    const vector = {
      ...before,
      learning: baseline.learning + (this.state.learning - baseline.learning) * 0.35
    };
    const normalized = normalizeVector(vector, baseline);
    this.state = {
      ...this.state,
      ...normalized,
      updatedAt: nowIso()
    };
    const record = {
      id: id('wt_learning'),
      at: this.state.updatedAt,
      channel: null,
      source: 'learning',
      excerpt: '学习成果已归档，学习维度权重回落',
      before,
      after: { work: this.state.work, companion: this.state.companion, learning: this.state.learning },
      normalized: this.normalized(),
      salience: 0.2,
      drivers: ['学习完成 → 权重回落'],
      eventType: 'learning_done',
      mode: this.mode().key
    };
    this.history.append(record);
    this.save();
    this.emit('weights:changed', this.getState(record));
    return this.getState(record);
  }

  qualitativeState() {
    const mode = this.mode();
    const recent = this.recent(8).slice(-5).map((event) => ({
      at: event.at,
      drivers: event.drivers,
      eventType: event.eventType
    }));
    const guidance = mode.key === 'work'
      ? '当前更偏工作推进；如果用户明确需要被接住，可以小幅调高陪伴。'
      : mode.key === 'companion'
        ? '当前更偏陪伴；如果用户重新进入具体任务，可以小幅调高工作。'
        : mode.key === 'learning'
          ? '当前更偏探索与查证；如果用户需要结论，先把学习成果落回工作或陪伴。'
          : '三条线较均衡；只在对话出现明确偏向时微调。';
    return {
      mode: mode.key,
      label: mode.label,
      guidance,
      recentDrivers: recent
    };
  }

  behaviorBlock() {
    const mode = this.mode();
    return [
      '【本轮表达取向｜后台策略】',
      mode.key === 'work'
        ? '此刻更适合先给出可执行的结论与下一步；语气保持温度，但不要拖沓。'
        : mode.key === 'companion'
          ? '此刻更适合先回应对方的情绪和状态，不急着给方案；在合适的位置保留一条轻量的工作线索。'
          : mode.key === 'learning'
            ? '此刻更适合先把不确定的地方查清、说明证据边界，再把结论落回用户能用的下一步。'
            : '先判断对方此刻更需要被理解、被推进，还是需要一起弄清楚；再把三者自然融合。',
      '你可以看到定性取向，但看不到百分比。如果对话信号明显与当前取向不符，可以用 weight_tune 小幅修正；不要频繁调整，也不要把内部机制说给用户听。'
    ].join('\n');
  }

  markReflected() {
    this.state.lastReflectedEvent = this.state.events;
    this.save();
  }

  getState(lastEvent = null) {
    const cfg = this.config.get().weights;
    const normalized = this.normalized();
    const mode = this.mode();
    return {
      raw: { work: round(this.state.work, 4), companion: round(this.state.companion, 4), learning: round(this.state.learning, 4) },
      normalized,
      baseline: this.baseline(),
      mode,
      updatedAt: this.state.updatedAt,
      events: this.state.events,
      lastReflectedEvent: this.state.lastReflectedEvent,
      minActivation: cfg.minActivation,
      lastEvent,
      lastAnchor: this.state.lastAnchor || null,
      intent: lastEvent?.intent || this.state.lastIntent || { primary: 'balanced', confidence: 0 },
      history: this.recent(60)
    };
  }

  recent(limit = 80) {
    return this.history.all().slice(-limit).map((event) => ({
      ...event,
      normalized: event.normalized || this.normalized(event.after || event)
    }));
  }

  fallbackReflection() {
    const recent = this.recent(20);
    const events = recent.filter((event) => event.eventType !== 'drift' && event.eventType !== 'decay');
    if (!events.length) return null;
    const mode = this.mode();
    const lastEvents = events.slice(-4).map((event) => `${event.at.slice(5, 16)} ${event.drivers.join('、')}`);
    return [
      `最近的交互取向偏向：${mode.label}。`,
      '触发点：',
      ...lastEvents.map((line) => `· ${line}`),
      mode.key === 'companion'
        ? '反思：近期情绪事件更多。接下来减少任务推进的密度，先维持稳定陪伴，再在合适时机轻量地接回工作。'
        : mode.key === 'work'
          ? '反思：近期任务信号更强。推进时注意主动询问状态，避免把陪伴需求当作打断。'
          : mode.key === 'learning'
            ? '反思：近期学习信号更强。查证后要把成果落回用户能用的结论，不要只停在探索。'
            : '反思：三条线较均衡。继续保持“先回应人，再处理事，必要时一起查清楚”的顺序。'
    ].join('\n');
  }
}
