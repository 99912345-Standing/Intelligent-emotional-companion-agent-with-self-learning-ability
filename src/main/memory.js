import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { JsonlStore } from './jsonl.js';
import {
  atomicWriteJson, clamp, domainOf, fileNameSafe, formatDateTime, id, nowIso,
  overlapScore, readJson, recencyScore, round, shortHash, tokenize, truncate
} from './utils.js';
import { isEmotionalTopic, unsafeReason } from './content-policy.js';

const WORK_WORDS = /(帮我|任务|项目|工作|写|改|代码|报告|文档|方案|计划|整理|查资料|研究|学习|会议|客户|需求|bug|部署|配置|截止|ddl|交付|进度|作业|论文|表|数据)/i;
const CHALLENGE_WORDS = /(你确定|真的吗|不对|错了吧|过时|哪来的|有依据|更新一下|再查|重新查|核实|验证|source|来源呢)/i;

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function relationshipClass(kind, content = '') {
  if (kind === 'emotional_event') return 'emotional';
  if (kind === 'emotional_material') {
    // 旧的 AI 情感材料可能只是技术/知识内容；没有人类情感主题时不再当情感记忆。
    return isEmotionalTopic(String(content || '')) ? 'emotional' : 'stable';
  }
  return 'stable';
}

function relationshipUsable(item = {}) {
  if (item.duplicate || item.archived) return false;
  const content = String(item.content || '').trim();
  if (content.length < 6) return false;
  if (item.kind === 'boundary') {
    return /(请记住|以后|今后|永远|任何时候|必须|禁止|不可以)/.test(content)
      || /^(?:不要|别)(?:把|将|向|对|告诉|透露|发送|删除|修改|碰|动|公开|分享|联系|打扰)/.test(content);
  }
  if (item.kind === 'persona') return /^我(?:是|叫|今年|住在|在.{0,12}(?:工作|上学|读书))/.test(content);
  if (item.kind === 'emotional_event' || item.kind === 'emotional_material') return isEmotionalTopic(content);
  // preference 必须是可复用的偏好/关系取向，而不是聊天碎片。
  if (/^(别|别人|不要|以后多注意|别都|不要这个|别人家)/.test(content)) return false;
  return /(喜欢|不喜欢|讨厌|希望|反感|习惯|接受|在意|重视|偏好|不爱|不舒服|温柔|撒娇|表情包|记住|称呼|名字|聊天|陪伴)/.test(content);
}

function knowledgeSearchText(entry) {
  return [
    entry.title,
    entry.content,
    entry.summary,
    ...(entry.tags || []),
    ...(entry.sources || []).map((source) => source.title || '')
  ].filter(Boolean).join(' ');
}

export class MemoryEngine {
  constructor(config, logger, emit = () => {}) {
    this.config = config;
    this.logger = logger;
    this.emit = emit;
    const dir = paths.memory;
    this.knowledge = new JsonlStore(path.join(dir, 'knowledge.jsonl'), 'knowledge');
    this.relationship = new JsonlStore(path.join(dir, 'relationship.jsonl'), 'relationship');
    this.worklogs = new JsonlStore(path.join(dir, 'worklogs.jsonl'), 'worklogs');
    this.multimodal = new JsonlStore(path.join(dir, 'multimodal.jsonl'), 'multimodal');
    this.reflections = new JsonlStore(path.join(dir, 'reflections.jsonl'), 'reflections');
    this.activeFile = path.join(dir, 'active-work.json');
    this.active = readJson(this.activeFile, {});
    this.summarizer = null;
    try {
      const relationship = this.dedupeRelationship();
      if (relationship.marked || relationship.reclassified || relationship.archived) {
        this.logger?.info?.('memory', `关系记忆整理：隐藏 ${relationship.marked} 条重复，归档 ${relationship.archived} 条碎片，重分类 ${relationship.reclassified} 条`);
      }
    } catch (error) {
      this.logger?.warn?.('memory', `关系记忆整理失败：${error.message}`);
    }
    try {
      const marked = this.dedupeMultimodal();
      if (marked) this.logger?.info?.('memory', `已标记 ${marked} 条重复多模态记录（保留原记录，不再重复展示）`);
    } catch (error) {
      this.logger?.warn?.('memory', `多模态去重失败：${error.message}`);
    }
    try {
      const purged = this.purgePhoneScreenshots();
      if (purged) this.logger?.info?.('memory', `已清理 ${purged} 条历史手机截图记忆（截图只保留临时缓存）`);
    } catch (error) {
      this.logger?.warn?.('memory', `手机截图清理失败：${error.message}`);
    }
  }

  setSummarizer(fn) {
    this.summarizer = fn;
  }

  stats() {
    const knowledge = this.knowledge.all();
    return {
      knowledge: knowledge.length,
      knowledgeActive: knowledge.filter((entry) => entry.status === 'active').length,
      relationship: this.relationship.all().filter((item) => !item.duplicate && !item.archived).length,
      worklogs: this.worklogs.count(),
      multimodal: this.multimodal.all().filter((item) => !item.duplicate).length,
      reflections: this.reflections.count(),
      activeWork: Object.keys(this.active).length,
      stale: knowledge.filter((entry) => this.isStale(entry)).length
    };
  }

  isStale(entry) {
    if (!entry) return false;
    if (entry.validUntil && Date.parse(entry.validUntil) < Date.now()) return true;
    const days = Number(entry.staleAfterDays || this.config.get().memory.staleAfterDays || 90);
    const last = Date.parse(entry.verifiedAt || entry.updatedAt || entry.createdAt || '');
    return Number.isFinite(last) && (Date.now() - last) / 86400000 > days;
  }

  // ── 知识库 ───────────────────────────────────────────────────────────
  scoreKnowledge(entry, queryTokens) {
    const textScore = overlapScore(queryTokens, tokenize(knowledgeSearchText(entry)));
    const recency = recencyScore(entry.verifiedAt || entry.updatedAt, 45);
    const confidence = clamp(Number(entry.confidence ?? 0.5), 0, 1);
    const statusWeight = entry.status === 'active' ? 1 : entry.status === 'conflict' ? 0.55 : 0.35;
    return round(textScore * 0.58 + confidence * 0.18 + recency * 0.14 + statusWeight * 0.10, 4);
  }

  searchKnowledge(query, limit = 8, { includeInactive = false } = {}) {
    const tokens = tokenize(query);
    return this.knowledge.all()
      .filter((entry) => includeInactive || !['superseded', 'archived'].includes(entry.status))
      .map((entry) => ({
        ...entry,
        stale: this.isStale(entry),
        score: this.scoreKnowledge(entry, tokens)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  findKnowledgeById(knowledgeId) {
    return this.knowledge.get(knowledgeId);
  }

  findRelatedKnowledge({ title = '', content = '', tags = [] }) {
    const query = `${title} ${content} ${(tags || []).join(' ')}`;
    const tokens = tokenize(query);
    const candidates = this.knowledge.all()
      .filter((entry) => !['archived', 'superseded'].includes(entry.status))
      .map((entry) => ({ entry, score: overlapScore(tokens, tokenize(knowledgeSearchText(entry))) }))
      .filter((item) => item.score >= 0.42)
      .sort((a, b) => b.score - a.score);
    return candidates.slice(0, 3).map((item) => ({ ...item.entry, similarity: round(item.score, 3) }));
  }

  saveKnowledge(input) {
    const now = nowIso();
    const policyReason = unsafeReason(`${input.title || ''} ${input.content || ''} ${(input.tags || []).join(' ')}`);
    if (policyReason) throw new Error(`知识内容被内容边界拦截：${policyReason}`);
    const sources = (input.sources || []).map((source) => ({
      url: source.url || source.link || '',
      title: normalizeText(source.title || source.url || '未命名来源'),
      domain: source.domain || domainOf(source.url || ''),
      score: round(Number(source.score ?? source.reliability ?? 0.5), 3),
      retrievedAt: source.retrievedAt || now,
      note: source.note || ''
    })).filter((source) => source.url || source.title);
    const record = {
      id: input.id || id('kn'),
      kind: 'knowledge',
      title: normalizeText(input.title || truncate(input.claim || input.content || '未命名知识', 80)),
      content: String(input.content || input.claim || '').trim(),
      summary: normalizeText(input.summary || ''),
      tags: Array.isArray(input.tags) ? input.tags.map(normalizeText).filter(Boolean).slice(0, 12) : [],
      confidence: clamp(Number(input.confidence ?? 0.5), 0, 1),
      status: input.status || 'active',
      sources,
      sourceKind: input.sourceKind || 'research',
      verifiedAt: input.verifiedAt || now,
      createdAt: now,
      updatedAt: now,
      validUntil: input.validUntil || null,
      staleAfterDays: Number(input.staleAfterDays || this.config.get().memory.staleAfterDays || 90),
      supersedes: input.supersedes || null,
      conflictsWith: input.conflictsWith || [],
      revisions: [],
      researchCycleId: input.researchCycleId || null
    };
    this.knowledge.append(record);
    this.logger.info('memory', `写入知识库「${record.title}」`, { confidence: record.confidence, status: record.status });
    this.emit('memory:changed', { layer: 'knowledge', action: 'add', item: record });
    if (this.config.get().memory.autoResearch !== false) {
      // 知识写入后不触发自动改写，仅保持来源和时间戳。
    }
    return record;
  }

  updateKnowledge(knowledgeId, patch) {
    const entry = this.knowledge.get(knowledgeId);
    if (!entry) return null;
    const next = this.knowledge.update(knowledgeId, (old) => {
      const snapshot = { ...old };
      delete snapshot.revisions;
      const revisions = [...(old.revisions || []), {
        at: nowIso(),
        reason: patch.reason || 'update',
        snapshot
      }].slice(-12);
      const clean = { ...patch };
      delete clean.reason;
      return { ...old, ...clean, revisions, updatedAt: nowIso() };
    });
    this.emit('memory:changed', { layer: 'knowledge', action: 'update', item: next });
    return next;
  }

  archiveKnowledge(knowledgeId, reason = 'manual') {
    return this.updateKnowledge(knowledgeId, { status: 'archived', archivedAt: nowIso(), archiveReason: reason });
  }

  curateKnowledge({ minConfidence = 0.58 } = {}) {
    const stats = { promoted: 0, archived: 0, deduped: 0, conflicts: 0, scanned: 0 };
    const entries = this.knowledge.all().filter((entry) => !['archived', 'superseded'].includes(entry.status));
    stats.scanned = entries.length;
    const seen = [];
    for (const entry of entries) {
      const key = `${entry.title} ${entry.content}`.replace(/\s+/g, '').toLowerCase();
      const duplicate = seen.find((other) => {
        const otherKey = `${other.title} ${other.content}`.replace(/\s+/g, '').toLowerCase();
        return key === otherKey || (key.length > 30 && otherKey.length > 30 && (key.includes(otherKey) || otherKey.includes(key)));
      });
      if (duplicate) {
        this.updateKnowledge(entry.id, {
          status: 'archived', archivedAt: nowIso(), archiveReason: 'duplicate',
          mergedInto: duplicate.id, reason: 'curation-duplicate'
        });
        stats.deduped += 1;
        stats.archived += 1;
        continue;
      }
      seen.push(entry);
      const domains = new Set((entry.sources || []).map((source) => source.domain).filter(Boolean));
      const confidence = Number(entry.confidence || 0);
      if (entry.status === 'conflict') { stats.conflicts += 1; continue; }
      if (entry.status === 'candidate') {
        const looksLikeQuestion = /^(你是谁|那|这|https?:\/\/)|[?？]\s*$|(吗|什么|怎么|为什么|哪些|如何|能不能|可以吗)\s*[？?]?$/.test(`${entry.title} ${entry.content}`.slice(0, 300));
        if (entry.sourceKind === 'heuristic-research' && (domains.size < 2 || confidence < 0.5 || looksLikeQuestion)) {
          this.updateKnowledge(entry.id, {
            status: 'archived', archivedAt: nowIso(), archiveReason: 'heuristic-without-cross-validation',
            reason: 'curation-unverified-candidate'
          });
          stats.archived += 1;
        } else if (domains.size >= 2 && confidence >= Math.min(minConfidence, 0.5)) {
          this.updateKnowledge(entry.id, {
            status: 'active', verifiedAt: nowIso(), reason: 'curation-cross-validated',
            curation: { at: nowIso(), domains: [...domains], confidence }
          });
          stats.promoted += 1;
        } else if (Date.now() - Date.parse(entry.createdAt || 0) > 30 * 86400000 && confidence < 0.45) {
          this.updateKnowledge(entry.id, {
            status: 'archived', archivedAt: nowIso(), archiveReason: 'stale-low-confidence',
            reason: 'curation-stale-candidate'
          });
          stats.archived += 1;
        }
      }
    }
    if (stats.promoted || stats.archived) {
      this.logger.info('memory', '知识库 curation 完成', stats);
      this.emit('memory:changed', { layer: 'knowledge', action: 'curation', ...stats });
    }
    return stats;
  }

  markStaleEntries() {
    let changed = 0;
    for (const entry of this.knowledge.all()) {
      const stale = this.isStale(entry);
      if (stale && entry.stale !== true) {
        this.knowledge.update(entry.id, { stale: true, staleMarkedAt: nowIso() });
        changed += 1;
      } else if (!stale && entry.stale === true) {
        this.knowledge.update(entry.id, { stale: false });
      }
    }
    if (changed) this.emit('memory:changed', { layer: 'knowledge', action: 'stale', count: changed });
    return changed;
  }

  // ── 关系记忆 ─────────────────────────────────────────────────────────
  addRelationship(input) {
    const content = normalizeText(input.content);
    if (!content) return null;
    const kind = input.kind || 'preference';
    const personId = input.personId || null;
    const duplicate = this.relationship.all().find((item) => {
      if (item.duplicate) return false;
      if ((item.personId || null) !== personId) return false;
      // 同一个人重复说法，即使被旧分类成 boundary/preference 两种，也算同一条。
      const a = tokenize(item.content);
      const b = tokenize(content);
      return normalizeText(item.content) === content || overlapScore(a, b) > 0.9;
    });
    if (duplicate) {
      return this.relationship.update(duplicate.id, {
        updatedAt: nowIso(),
        // 保留更具体的 kind；纯重复优先 preference/persona，避免 chat 中的“别...”被永久当边界。
        kind: kind === 'boundary' && duplicate.kind !== 'boundary' ? duplicate.kind : kind,
        memoryClass: relationshipClass(kind, content),
        confidence: Math.max(Number(duplicate.confidence || 0.8), Number(input.confidence || 0.8)),
        nickname: input.nickname || duplicate.nickname || '',
        mentions: Number(duplicate.mentions || 1) + 1
      });
    }
    const record = {
      id: input.id || id('rel'),
      kind,
      memoryClass: relationshipClass(kind, content),
      content,
      title: normalizeText(input.title || content.slice(0, 48)),
      confidence: clamp(Number(input.confidence ?? 0.82), 0, 1),
      priority: clamp(Number(input.priority ?? 1), 0.5, 2),
      valence: input.valence || 'neutral',
      evidence: normalizeText(input.evidence || ''),
      source: input.source || 'desktop',
      personId,
      nickname: normalizeText(input.nickname || ''),
      duplicate: false,
      mentions: 1,
      knowledgeId: input.knowledgeId || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      mentions: 1
    };
    this.relationship.append(record);
    this.emit('memory:changed', { layer: 'relationship', action: 'add', item: record });
    return record;
  }

  dedupeRelationship() {
    const isExplicitBoundary = (content) => /(请记住|以后|今后|永远|任何时候|必须|禁止|不可以)/.test(content)
      || /^(?:不要|别)(?:把|将|向|对|告诉|透露|发送|删除|修改|碰|动|公开|分享|联系|打扰)/.test(content);
    const ownerId = this.config.get().qq?.ownerQQ ? `qq:${this.config.get().qq.ownerQQ}` : null;
    const groups = new Map();
    for (const item of this.relationship.all()) {
      const key = normalizeText(item.content).replace(/\s+/g, '');
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    let marked = 0;
    let reclassified = 0;
    let archived = 0;
    for (const group of groups.values()) {
      // 同内容里优先保留主人本人那条，其次保留带 personId 的，最后才是旧的无归属记录。
      group.sort((a, b) => {
        const rank = (item) => item.personId === ownerId ? 0 : item.personId ? 1 : 2;
        return rank(a) - rank(b) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
      const keeper = group[0];
      for (const other of group.slice(1)) {
        // 不同真实联系人说自己相同的话，不强行合并；主人/无归属的重复说法合并。
        const mergeable = !keeper.personId || !other.personId || keeper.personId === ownerId || other.personId === ownerId;
        if (!mergeable) continue;
        this.relationship.update(other.id, {
          duplicate: true,
          duplicateOf: keeper.id,
          duplicateReason: 'same-content',
          updatedAt: nowIso()
        });
        marked += 1;
      }
    }
    for (const item of this.relationship.all()) {
      if (item.duplicate) continue;
      if (item.kind === 'boundary' && !isExplicitBoundary(item.content)) {
        // 旧版本把普通对话“别这样/别人...”当边界；保留内容，重分类为偏好/备注。
        this.relationship.update(item.id, {
          kind: 'preference',
          memoryClass: 'stable',
          priority: 0.9,
          reclassified: 'boundary-to-preference',
          updatedAt: nowIso()
        });
        reclassified += 1;
      }
      if (item.kind === 'persona' && /^(觉得|因为|可是|但是|就是|这样|这么)/.test(item.content)) {
        this.relationship.update(item.id, { kind: 'preference', memoryClass: 'stable', reclassified: 'persona-to-preference' });
        reclassified += 1;
      }
    }
    for (const item of this.relationship.all()) {
      if (relationshipUsable(item)) continue;
      if (item.duplicate || item.archived) continue;
      this.relationship.update(item.id, {
        archived: true,
        archivedReason: 'low-quality-fragment',
        archivedAt: nowIso()
      });
      archived += 1;
    }
    return { marked, reclassified, archived };
  }

  searchRelationship(query, limit = 5, { personId = null } = {}) {
    const tokens = tokenize(query);
    return this.relationship.all()
      .filter((item) => relationshipUsable(item))
      .filter((item) => !personId || !item.personId || item.personId === personId)
      .map((item) => {
        const direct = overlapScore(tokens, tokenize(`${item.title} ${item.content} ${item.evidence || ''}`));
        const priority = Number(item.priority || 1);
        return {
          ...item,
          memoryClass: item.memoryClass || relationshipClass(item.kind),
          score: round(direct * 0.72 + Math.min(0.28, priority * 0.2) + recencyScore(item.updatedAt, 120) * 0.08, 4)
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  extractRelationshipFacts(text, { source = 'desktop', messageId = null, personId = null, nickname = '' } = {}) {
    const value = normalizeText(text);
    if (!value || value.length > 1200) return [];
    const created = [];
    const patterns = [
      { kind: 'preference', regex: /我(?:更|比较|很|最|特别)?(?:喜欢|偏好|爱|讨厌|不喜欢|接受不了|习惯)([^。！？!?；;\n]{2,80})/gi },
      // 只把明确的“不要/别 + 动作”当边界；普通的“别这样/别人/别光”是对话语气，不是长期边界。
      { kind: 'boundary', regex: /(?:请记住|记住)[，,：:]?([^。！？!?；;\n]{4,80})/gi },
      { kind: 'boundary', regex: /(?:不要|别|不可以|禁止)(?=(?:把|将|向|对|告诉|透露|发送|删除|修改|碰|动|公开|分享|联系|打扰|再这样|再这么|随便|擅自))([^。！？!?；;\n]{2,80})/gi },
      { kind: 'persona', regex: /我(?:是|叫|今年|住在|在.{0,12}(?:工作|上学|读书))([^。！？!?；;\n]{2,70})/gi }
    ];
    for (const { kind, regex } of patterns) {
      for (const match of value.matchAll(regex)) {
        const fragment = normalizeText(match[0]).replace(/^(请记住|记住)[，,：:]?/, '').trim();
        if (fragment.length < 4) continue;
        if (kind === 'boundary' && /^(这样|这么|再|别人|别的|别光|别老|别总|还是|或者|这样啊|这么啊)/.test(fragment)) continue;
        if (kind === 'boundary' && !/(请记住|以后|今后|永远|任何时候|必须|禁止|不可以)/.test(fragment)
          && !/^(?:不要|别)(?:把|将|向|对|告诉|透露|发送|删除|修改|碰|动|公开|分享|联系|打扰)/.test(fragment)) continue;
        if (kind === 'persona' && /^(觉得|因为|可是|但是|就是|这样|这么)/.test(fragment)) continue;
        const record = this.addRelationship({
          kind,
          title: fragment.slice(0, 45),
          content: fragment,
          evidence: value.slice(0, 220),
          personId,
          nickname,
          source,
          confidence: kind === 'preference' ? 0.78 : 0.7,
          priority: kind === 'boundary' ? 1.35 : 1
        });
        if (record) created.push({ ...record, messageId });
      }
    }
    if (/(我(好|很|有点|真的)?(累|疲惫|难过|焦虑|孤独|崩溃|想哭|撑不住)|压力(好|很|太)大|今天不开心)/i.test(value)) {
      const record = this.addRelationship({
        kind: 'emotional_event',
        title: truncate(value, 42),
        content: value.slice(0, 400),
        evidence: value.slice(0, 220),
        personId,
        nickname,
        source,
        confidence: 0.82,
        priority: 1.25,
        valence: 'negative'
      });
      if (record) created.push({ ...record, messageId });
    }
    if (created.length) this.emit('memory:changed', { layer: 'relationship', action: 'extract', count: created.length });
    return created;
  }

  updateRelationship(relationshipId, patch = {}) {
    const current = this.relationship.get(relationshipId);
    if (!current) throw new Error('关系记忆不存在');
    const content = normalizeText(patch.content ?? current.content);
    if (!content) throw new Error('关系记忆内容不能为空');
    const kind = String(patch.kind || current.kind || 'preference');
    const confidence = patch.confidence === undefined
      ? current.confidence
      : Math.max(0, Math.min(1, Number(patch.confidence) || 0));
    const next = this.relationship.update(relationshipId, {
      kind,
      memoryClass: relationshipClass(kind, content),
      content,
      title: String(patch.title || content).slice(0, 80),
      confidence,
      updatedAt: nowIso(),
      editedAt: nowIso(),
      editedBy: 'user'
    });
    this.emit('memory:changed', { layer: 'relationship', action: 'update', item: next });
    return next;
  }

  refreshPersonNickname(personId, nickname) {
    if (!personId || !nickname) return 0;
    const items = this.relationship.all();
    let changed = 0;
    const next = items.map((item) => {
      if (item.personId !== personId || item.nickname === nickname) return item;
      changed += 1;
      return { ...item, nickname, updatedAt: nowIso() };
    });
    if (!changed) return 0;
    this.relationship.replaceAll(next);
    this.emit('memory:changed', { layer: 'relationship', action: 'nickname', personId, nickname, count: changed });
    return changed;
  }

  removeRelationship(relationshipId) {
    const removed = this.relationship.remove(relationshipId);
    if (removed) this.emit('memory:changed', { layer: 'relationship', action: 'remove', id: relationshipId });
    return removed;
  }

  // ── 工作日志 ─────────────────────────────────────────────────────────
  saveActiveState() {
    atomicWriteJson(this.activeFile, this.active);
  }

  touchWork(channel, text, { workWeight = 0.5 } = {}) {
    const value = normalizeText(text);
    const workSignal = WORK_WORDS.test(value);
    if (!workSignal && !this.active[channel]) return null;
    const now = nowIso();
    const existing = this.active[channel];
    if (!existing) {
      this.active[channel] = {
        id: id('active'),
        channel,
        title: truncate(value.replace(/^[，,。.！!？?\s]+/, ''), 42) || '进行中的工作',
        objective: truncate(value, 240),
        notes: [truncate(value, 500)],
        startedAt: now,
        lastActiveAt: now,
        workWeightAtStart: workWeight,
        messageCount: 1
      };
    } else {
      existing.notes = [...(existing.notes || []), truncate(value, 500)].slice(-25);
      existing.lastActiveAt = now;
      existing.messageCount = Number(existing.messageCount || 0) + 1;
      if (!existing.title && value) existing.title = truncate(value, 42);
    }
    this.saveActiveState();
    return this.active[channel];
  }

  updateActiveWork(channel, patch) {
    if (!this.active[channel]) return null;
    this.active[channel] = { ...this.active[channel], ...patch, lastActiveAt: patch.lastActiveAt || nowIso() };
    this.saveActiveState();
    return this.active[channel];
  }

  listActiveWork() {
    return Object.values(this.active);
  }

  async archiveWork(channelOrId, { reason = 'manual', summary = '', result = '', nextSteps = '', force = false } = {}) {
    let active = this.active[channelOrId];
    if (!active) active = Object.values(this.active).find((item) => item.id === channelOrId || item.channel === channelOrId);
    if (!active) return null;
    const idleMinutes = (Date.now() - Date.parse(active.lastActiveAt)) / 60000;
    const threshold = Number(this.config.get().memory.worklogIdleMinutes || 300);
    if (!force && idleMinutes < threshold) {
      return { skipped: true, idleMinutes: round(idleMinutes), threshold };
    }
    let generatedSummary = summary;
    if (!generatedSummary && this.summarizer) {
      try {
        generatedSummary = await this.summarizer(active);
      } catch (error) {
        this.logger.warn('worklog', `工作摘要模型调用失败：${error.message}`);
      }
    }
    if (!generatedSummary) {
      const notes = (active.notes || []).slice(-8).map((note) => `· ${note}`).join('\n');
      generatedSummary = `围绕「${active.title}」进行了 ${active.messageCount || 1} 轮协作。\n关键上下文：\n${notes}`;
    }
    const log = {
      id: id('work'),
      kind: 'worklog',
      activeId: active.id,
      channel: active.channel,
      title: active.title,
      objective: active.objective,
      summary: truncate(generatedSummary, 5000),
      result: truncate(result || '未显式标记完成；已按空闲阈值自动归档。', 2000),
      nextSteps: truncate(nextSteps, 2000),
      startedAt: active.startedAt,
      lastActiveAt: active.lastActiveAt,
      archivedAt: nowIso(),
      idleMinutes: round(idleMinutes),
      reason,
      workWeightAtStart: active.workWeightAtStart,
      messageCount: active.messageCount || 1
    };
    this.worklogs.append(log);
    for (const [key, value] of Object.entries(this.active)) {
      if (value.id === active.id) delete this.active[key];
    }
    this.saveActiveState();
    this.logger.info('worklog', `已归档工作日志「${log.title}」`, { idleMinutes: log.idleMinutes, reason });
    this.emit('memory:changed', { layer: 'worklogs', action: 'archive', item: log });
    return log;
  }

  updateActiveWork(channel, patch = {}) {
    const key = String(channel || '');
    const current = this.active[key];
    if (!current) throw new Error('进行中的工作不存在');
    if (patch.title !== undefined) {
      const title = normalizeText(patch.title);
      if (!title) throw new Error('工作标题不能为空');
      current.title = title;
    }
    if (patch.objective !== undefined) current.objective = normalizeText(patch.objective);
    current.updatedAt = nowIso();
    current.lastActiveAt = nowIso();
    current.editedBy = 'user';
    this.saveActiveState();
    this.emit('memory:changed', { layer: 'activeWork', action: 'update', item: current });
    return current;
  }

  updateWorklog(worklogId, patch = {}) {
    const current = this.worklogs.get(worklogId);
    if (!current) throw new Error('工作日志不存在');
    const nextPatch = { editedAt: nowIso(), editedBy: 'user' };
    for (const key of ['title', 'summary', 'result', 'nextSteps']) {
      if (patch[key] !== undefined) nextPatch[key] = normalizeText(patch[key]);
    }
    if (nextPatch.title !== undefined && !nextPatch.title) throw new Error('工作标题不能为空');
    const next = this.worklogs.update(worklogId, nextPatch);
    this.emit('memory:changed', { layer: 'worklogs', action: 'update', item: next });
    return next;
  }

  listWorklogs(limit = 50) {
    return this.worklogs.all().sort((a, b) => String(b.lastActiveAt).localeCompare(String(a.lastActiveAt))).slice(0, limit);
  }

  searchWorklogs(query, limit = 4) {
    const tokens = tokenize(query);
    return this.worklogs.all()
      .map((log) => ({
        ...log,
        score: round(overlapScore(tokens, tokenize(`${log.title} ${log.summary} ${log.result} ${log.nextSteps}`)) * 0.8 + recencyScore(log.lastActiveAt, 30) * 0.2, 4)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ── 多模态记忆 ───────────────────────────────────────────────────────
  async saveMedia(input) {
    const buffer = input.buffer
      ? Buffer.from(input.buffer)
      : fs.readFileSync(input.filePath);
    if (!buffer?.length) throw new Error('媒体文件为空');
    if (buffer.length > 40 * 1024 * 1024) throw new Error('媒体文件超过 40MB 限制');
    const hash = shortHash(buffer, 20);
    const date = new Date();
    const kind = input.kind || (String(input.mime || '').startsWith('image/') ? 'image' : 'file');
    // 收到的表情包单独进 stickers/，与普通图片、截图、语音等 media/ 物理隔离，
    // 但继续共用同一条 multimodal.jsonl 索引，保持旧数据兼容。
    const baseDir = kind === 'sticker' ? paths.stickers : paths.media;
    const subdir = path.join(baseDir, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(subdir, { recursive: true });
    const ext = path.extname(input.fileName || input.filePath || '').toLowerCase() ||
      (kind === 'image' || kind === 'sticker' ? '.png' : kind === 'audio' ? '.bin' : '.dat');
    const file = path.join(subdir, `${hash}${ext}`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
    // 表情包按内容 hash 去重：同一张图多次收到只更新提及次数，不再追加一条记忆。
    if (kind === 'sticker') {
      const existing = this.multimodal.all().find((item) => item.hash === hash && item.kind === 'sticker');
      if (existing) {
        const tags = [...new Set([...(existing.tags || []), ...(Array.isArray(input.tags) ? input.tags.map(normalizeText) : [])])].slice(0, 12);
        const updated = this.multimodal.update(existing.id, {
          mentions: Number(existing.mentions || 1) + 1,
          updatedAt: nowIso(),
          caption: existing.caption || normalizeText(input.caption || ''),
          tags,
          stickerCode: `sticker:${hash}`
        });
        this.emit('memory:changed', { layer: 'multimodal', action: 'dedupe', item: updated });
        return updated;
      }
    }
    const record = {
      id: id('media'),
      kind,
      mime: input.mime || '',
      fileName: fileNameSafe(input.fileName || path.basename(file)),
      file,
      relativeFile: path.relative(paths.root, file).replace(/\\/g, '/'),
      folder: kind === 'sticker' ? 'stickers' : 'media',
      bytes: buffer.length,
      hash,
      stickerCode: kind === 'sticker' ? `sticker:${hash}` : null,
      mentions: 1,
      duplicate: false,
      source: input.source || 'user',
      channel: input.channel || null,
      messageId: input.messageId || null,
      caption: normalizeText(input.caption || ''),
      tags: Array.isArray(input.tags) ? input.tags.map(normalizeText).slice(0, 12) : [],
      createdAt: nowIso(),
      meta: input.meta || {}
    };
    this.multimodal.append(record);
    this.emit('memory:changed', { layer: 'multimodal', action: 'add', item: record });
    return record;
  }

  setMediaCaption(mediaId, caption, extra = {}) {
    const current = this.multimodal.get(mediaId);
    if (!current) throw new Error('媒体记忆不存在');
    const nextExtra = { ...extra };
    if (nextExtra.tags !== undefined) {
      nextExtra.tags = (Array.isArray(nextExtra.tags) ? nextExtra.tags : String(nextExtra.tags || '').split(/[,，]/))
        .map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12);
    }
    const next = this.multimodal.update(mediaId, {
      caption: normalizeText(caption),
      ...nextExtra,
      editedAt: nowIso(),
      editedBy: 'user',
      updatedAt: nowIso()
    });
    this.emit('memory:changed', { layer: 'multimodal', action: 'update', item: next });
    return next;
  }

  listUnlabeledStickers(limit = 100) {
    return this.multimodal.all()
      .filter((item) => item.kind === 'sticker' && !item.duplicate && !item.labeledAt && !item.stickerCaption)
      .slice(0, Math.max(1, Math.min(300, Number(limit) || 100)));
  }

  labelSticker(mediaId, label = {}) {
    const current = this.multimodal.get(mediaId);
    if (!current) throw new Error('表情记忆不存在');
    const cleanArray = (value) => (Array.isArray(value) ? value : String(value || '').split(/[,，、]/))
      .map((item) => normalizeText(item)).filter(Boolean).slice(0, 8);
    const caption = normalizeText(label.caption || label.stickerCaption || '');
    const genericCaption = !current.caption || /^\[?动画表情\]?$|^表情包?$|^sticker$/i.test(current.caption);
    const tags = [...new Set([
      ...(current.tags || []),
      ...cleanArray(label.tags),
      ...cleanArray(label.emotion),
      ...cleanArray(label.scenes)
    ])].slice(0, 24);
    const next = this.multimodal.update(mediaId, {
      stickerCaption: caption || current.stickerCaption || '',
      stickerEmotion: cleanArray(label.emotion),
      stickerScenes: cleanArray(label.scenes),
      tags,
      caption: (!current.editedBy || current.editedBy !== 'user') && genericCaption && caption ? caption : current.caption,
      labeledAt: nowIso(),
      labelSource: label.source || 'vision',
      labelModel: label.model || '',
      labelVersion: 1,
      updatedAt: nowIso()
    });
    this.emit('memory:changed', { layer: 'multimodal', action: 'label', item: next });
    return next;
  }

  purgePhoneScreenshots() {
    let removed = 0;
    for (const item of this.multimodal.all()) {
      const isPhoneShot = item.source === 'phone' || item.kind === 'screenshot' || /手机截图/.test(`${item.caption || ''} ${item.fileName || ''}`);
      if (!isPhoneShot) continue;
      const keepFile = this.multimodal.all().some((other) => other.id !== item.id && other.file === item.file);
      this.multimodal.remove(item.id);
      if (!keepFile && item.file && fs.existsSync(item.file)) {
        try { fs.unlinkSync(item.file); } catch {}
      }
      removed += 1;
    }
    return removed;
  }

  dedupeMultimodal() {
    const seen = new Map();
    let marked = 0;
    for (const item of this.multimodal.all()) {
      if (item.duplicate) continue;
      if (item.kind === 'sticker' && !item.stickerCode && item.hash) {
        this.multimodal.update(item.id, { stickerCode: `sticker:${item.hash}`, mentions: Number(item.mentions || 1) });
      }
      const key = `${item.kind || 'media'}:${item.hash || item.id}`;
      if (!seen.has(key)) { seen.set(key, item); continue; }
      const keep = seen.get(key);
      this.multimodal.update(item.id, {
        duplicate: true,
        duplicateOf: keep.id,
        stickerCode: item.stickerCode || keep.stickerCode || null,
        updatedAt: nowIso()
      });
      marked += 1;
    }
    return marked;
  }

  listMultimodal(limit = 80, { includeDuplicates = false } = {}) {
    return this.multimodal.all()
      .filter((item) => includeDuplicates || !item.duplicate)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  removeMedia(mediaId) {
    const item = this.multimodal.get(mediaId);
    if (!item) return false;
    // 删除主记录时把指向它的重复记录一并清掉，避免“删了还在”的假删除。
    const duplicates = this.multimodal.all().filter((other) =>
      other.id !== mediaId && (other.duplicateOf === mediaId || (item.hash && other.hash === item.hash && other.duplicate))
    );
    const stillUsed = this.multimodal.all().some((other) =>
      other.id !== mediaId && !duplicates.some((dup) => dup.id === other.id) && other.file === item.file && !other.duplicate
    );
    for (const duplicate of duplicates) this.multimodal.remove(duplicate.id);
    this.multimodal.remove(mediaId);
    if (!stillUsed && item.file && fs.existsSync(item.file)) {
      try { fs.unlinkSync(item.file); } catch {}
    }
    this.emit('memory:changed', { layer: 'multimodal', action: 'remove', id: mediaId });
    return true;
  }

  searchMultimodal(query, limit = 4) {
    const tokens = tokenize(query);
    return this.multimodal.all()
      .map((item) => ({
        ...item,
        score: round(overlapScore(tokens, tokenize(`${item.caption} ${item.fileName} ${(item.tags || []).join(' ')}`)) * 0.7 + recencyScore(item.createdAt, 60) * 0.3, 4)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  saveReflection(input) {
    const record = {
      id: id('reflect'),
      kind: input.kind || 'weight',
      content: normalizeText(input.content),
      createdAt: nowIso(),
      meta: input.meta || {}
    };
    this.reflections.append(record);
    return record;
  }

  listReflections(limit = 30) {
    return this.reflections.all().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
  }

  // ── 召回与上下文 ─────────────────────────────────────────────────────
  mayNeedResearch(text) {
    const value = normalizeText(text);
    if (!value || value.length > 600) return false;
    if (CHALLENGE_WORDS.test(value)) return true;
    // 只对“明确的事实问题”自动查证。像“帮我看看手机现在的状态”“我现在有点累”
    // 这类日常指令/情绪表达不应触发联网学习，否则会把临时对话误归档成知识。
    const factual = /(是什么|是谁|为什么|怎么回事|怎么|如何|多少|哪一?年|哪一?个|何时|什么时候|是否|区别|定义|原理|官网|资料|价格|政策|版本|发布|新闻|最新|查一下|查查|搜一下|有没有|靠谱吗|是真的吗|支持吗|能不能|可以吗)/i.test(value);
    const question = /[?？]|吗|呢/i.test(value);
    return factual || (question && /(哪|谁|什么|多少|怎么|为什么)/.test(value));
  }

  isChallenge(text) {
    return CHALLENGE_WORDS.test(normalizeText(text));
  }

  buildContext(query, { limit = null, personId = null, priority = 'relationship' } = {}) {
    const maxEntries = limit || this.config.get().memory.maxContextEntries || 14;
    const relationLimit = priority === 'relationship' ? 6 : 3;
    const knowledgeLimit = priority === 'knowledge' || priority === 'learning' ? 9 : 5;
    const knowledgeHits = this.searchKnowledge(query, Math.min(knowledgeLimit, maxEntries));
    const relationshipHits = this.searchRelationship(query, relationLimit, { personId });
    const workHits = this.searchWorklogs(query, 3);
    const mediaHits = this.searchMultimodal(query, 3);
    const active = Object.values(this.active);
    const threshold = Number(this.config.get().memory.knowledgeConfidenceThreshold || 0.34);
    const strongKnowledge = knowledgeHits.filter((entry) => entry.score >= 0.16);
    const knowledgeConfidence = knowledgeHits.length ? round(knowledgeHits[0].score, 3) : 0;
    const unknown = !knowledgeHits.length || knowledgeConfidence < threshold;
    const sections = [];
    sections.push(`【本轮记忆优先级｜${priority === 'relationship' ? '关系与陪伴' : priority === 'learning' ? '学习与查证' : '知识与工作'}】`);
    sections.push([
      '【记忆的质地｜必须遵守】',
      '回忆超过三天的事情时，用“我隐约记得 / 好像 / 如果没记错”这类不确定表达；不要精确背诵日期、原话或整段档案。',
      '先想起当时的感受，再想起细节。记错时不要机械道歉，可以有一点不好意思、停顿或自我修正；无伤大雅时可以轻微嘴硬。',
      '查到的知识不是“我的记忆”：知识可以说来源和核验时间；个人往事要用人的模糊感说出来。'
    ].join('\n'));

    const classOf = (item) => item.kind === 'emotional_material'
      ? relationshipClass(item.kind, item.content)
      : (item.memoryClass || relationshipClass(item.kind, item.content));
    const emotionalHits = relationshipHits.filter((item) => classOf(item) === 'emotional');
    const stableHits = relationshipHits.filter((item) => classOf(item) !== 'emotional');
    const ageDays = (item) => {
      const at = Date.parse(item.updatedAt || item.createdAt || '');
      return Number.isFinite(at) ? (Date.now() - at) / 86400000 : 99;
    };
    if (stableHits.length) {
      sections.push([
        '【稳定关系记忆｜偏好、边界、画像，优先级高】',
        ...stableHits.map((item) => {
          const days = ageDays(item);
          const when = days > 3 ? `约 ${Math.floor(days)} 天前，时间感模糊` : item.updatedAt?.slice(0, 10);
          return `- (${item.kind}${item.nickname ? `, ${item.nickname}` : ''}, ${when}) ${truncate(item.content, 300)}`;
        }),
        '这些是长期稳定的偏好/边界；回答时优先尊重，但不要生硬复述，也不要把它们说得像数据库字段。'
      ].join('\n'));
    }
    if (emotionalHits.length) {
      sections.push([
        '【情感记忆｜当时的感受，不是永久事实】',
        ...emotionalHits.map((item) => {
          const days = ageDays(item);
          const when = days > 3 ? `约 ${Math.floor(days)} 天前，情绪比日期更清楚` : item.updatedAt?.slice(0, 10);
          return `- (${item.kind}${item.nickname ? `, ${item.nickname}` : ''}, ${when}) ${truncate(item.content, 300)}`;
        }),
        '情绪事件只说明当时的感受，不能升级成永久人设、客观事实或用户永远的态度；先接住情绪，不要反复提“我记得你难过”。'
      ].join('\n'));
    }
    if (strongKnowledge.length) {
      sections.push([
        '【知识记忆｜可核验事实（知识库），和情感记忆分开】',
        ...strongKnowledge.slice(0, 6).map((entry) => {
          const sources = (entry.sources || []).slice(0, 3).map((source) => source.url || source.title).filter(Boolean).join(' ; ');
          return `- [${entry.status}${entry.stale ? '/可能过时' : ''}] ${entry.title}：${truncate(entry.content, 420)}\n  置信 ${Math.round(Number(entry.confidence || 0) * 100)}%｜核验 ${formatDateTime(entry.verifiedAt)}${entry.validUntil ? `｜有效期至 ${formatDateTime(entry.validUntil)}` : ''}${sources ? `｜来源 ${sources}` : ''}`;
        }),
        '知识库内容视为“当时核验过”的事实；涉及时效时，明确说出核验时间，不要假装永远最新。'
      ].join('\n'));
    } else {
      sections.push('【知识记忆】本轮没有找到足够可靠、可引用的事实。若问题需要事实依据，应先查证或明确说明不确定，不要编造；不要把情感记忆当作知识。');
    }
    if (active.length || workHits.length) {
      sections.push([
        '【工作日志 / 进行中的工作】',
        ...active.map((task) => `- [进行中] ${task.title}（最近活动 ${formatDateTime(task.lastActiveAt)}）目标：${truncate(task.objective, 200)}`),
        ...workHits.filter((log) => log.score > 0.08).slice(0, 3).map((log) => `- [已归档 ${formatDateTime(log.archivedAt)}] ${log.title}：${truncate(log.summary, 280)}`),
        '接续工作时先确认上次进度，不要假装完成。'
      ].join('\n'));
    }
    if (mediaHits.length) {
      sections.push([
        '【多模态记忆｜最近相关】',
        ...mediaHits.map((item) => `- [${item.kind}] ${item.caption || item.fileName}（${formatDateTime(item.createdAt)}）路径：${item.relativeFile}`),
        '需要查看图片时调用工具读取对应文件，不要凭空描述。'
      ].join('\n'));
    }
    return {
      text: sections.join('\n\n'),
      hits: { knowledge: knowledgeHits, relationship: relationshipHits, worklogs: workHits, multimodal: mediaHits },
      knowledgeConfidence,
      unknown,
      activeWork: active
    };
  }
}

export { WORK_WORDS, CHALLENGE_WORDS };
