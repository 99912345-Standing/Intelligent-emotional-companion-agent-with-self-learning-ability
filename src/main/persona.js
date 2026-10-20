import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { JsonlStore } from './jsonl.js';
import {
  atomicWriteJson, clamp, id, nowIso, parseJsonLoose, readJson, truncate
} from './utils.js';
import { isEmotionalTopic, unsafeReason } from './content-policy.js';

const MAX_LINE = 2200;

function defaultProfile(config) {
  const persona = config.get().persona;
  return {
    version: 1,
    identity: {
      name: persona.name || '伴行',
      role: '陪伴工作型智能体',
      relationship: persona.relationship || '长期同行的伙伴'
    },
    knowledgeLine: {
      text: '先证据后结论。事实要能追溯来源与核验时间；不确定就明确说不确定，并去查。把稳定知识留在知识库，把临时信息留在对话里。',
      updatedAt: nowIso(),
      updatedBy: 'system'
    },
    emotionLine: {
      text: '先接住人，再处理事。温和但不讨好，有分寸地表达关心；不替用户做重大决定，也不主动宣称自己拥有物理身体或未发生的经历。陪伴与工作两条线始终同时在场。',
      updatedAt: nowIso(),
      updatedBy: 'system'
    },
    boundaries: persona.boundaries || '不泄露密钥与隐私；不擅自进行删除、付款、对外发送等高风险操作。',
    revision: 0,
    updatedAt: nowIso(),
    updatedBy: 'system',
    lastEvidence: [],
    lastReason: '初始角色设定',
    aiLocked: Boolean(persona.aiLocked),
    lastAiRevisionAt: null,
    lastUserRevisionAt: null
  };
}

export class PersonaEngine {
  constructor({ config, memory, people = null, logger, emit = () => {} }) {
    this.config = config;
    this.memory = memory;
    this.people = people;
    this.logger = logger;
    this.emit = emit;
    this.dir = path.join(paths.data, 'persona');
    fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, 'profile.json');
    this.revisions = new JsonlStore(path.join(this.dir, 'revisions.jsonl'), 'persona-revisions');
    this.emotionalMemory = new JsonlStore(path.join(this.dir, 'emotional-memory.jsonl'), 'emotional-memory');
    this.profile = readJson(this.file, null) || defaultProfile(config);
    this.profile.aiLocked = Boolean(this.profile.aiLocked ?? config.get().persona.aiLocked);
    if (!fs.existsSync(this.file)) atomicWriteJson(this.file, this.profile);
    try { this.dedupeEmotionalMemory(); } catch {}
  }

  ownerPersonId() {
    const ownerQQ = String(this.config.get().qq.ownerQQ || '').trim();
    return ownerQQ ? `qq:${ownerQQ}` : 'owner';
  }

  isStableEvidence(item) {
    if (!item) return false;
    if (item.layer === 'knowledge') return true;
    if (item.layer === 'relationship') return ['preference', 'persona', 'boundary', 'important_person'].includes(item.kind);
    if (item.layer === 'worklogs') return true;
    return false;
  }

  recentEmotionalEvent() {
    const ownerId = this.ownerPersonId();
    return this.memory.relationship.all()
      .filter((item) => !item.duplicate && !item.archived)
      .filter((item) => item.kind === 'emotional_event' && (!item.personId || item.personId === ownerId))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
  }

  evidenceReport(proof = []) {
    const stable = proof.filter((item) => this.isStableEvidence(item));
    const emotional = proof.filter((item) => item.layer === 'relationship' && ['emotional_event', 'emotional_material'].includes(item.kind));
    const times = proof.map((item) => Date.parse(item.at || '')).filter((value) => Number.isFinite(value));
    const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 86400000 : 0;
    return {
      total: proof.length,
      stable: stable.length,
      stableCore: stable.filter((item) => item.layer === 'knowledge' || item.layer === 'relationship').length,
      emotional: emotional.length,
      spanDays: Math.round(spanDays * 10) / 10,
      stableLayers: [...new Set(stable.map((item) => item.layer))],
      emotionalOnly: proof.length > 0 && !stable.length
    };
  }

  stability() {
    const cfg = this.config.get().persona;
    const revisions = this.revisions.all();
    const now = Date.now();
    const aiRevisions = revisions.filter((revision) => revision.by === 'ai');
    const lastAi = [...aiRevisions].reverse().find(Boolean);
    const ownerId = this.ownerPersonId();
    const relation = this.memory.relationship.all()
      .filter((item) => !item.duplicate && !item.archived)
      .filter((item) => !item.personId || item.personId === ownerId);
    const stableRelation = relation.filter((item) => ['preference', 'persona', 'boundary', 'important_person'].includes(item.kind));
    const emotional = relation.filter((item) => item.kind === 'emotional_event');
    const recentEmotional = emotional.filter((item) => now - (Date.parse(item.updatedAt || '') || 0) < 7 * 86400000);
    const knowledge = this.memory.knowledge.all().filter((item) => item.status === 'active');
    const reflections = this.memory.listReflections(20);
    return {
      locked: Boolean(this.profile.aiLocked),
      lastAiRevisionAt: lastAi?.at || null,
      aiRevisions7d: aiRevisions.length,
      cooldownRemainingHours: 0,
      cooldownHours: 0,
      maxRevisions7d: null,
      minEvidence: Number(cfg.aiMinEvidence ?? 3),
      minSpanDays: 0,
      stableEvidence: stableRelation.length + knowledge.length + reflections.length,
      stableCore: stableRelation.length + knowledge.length,
      emotionalEvidence: emotional.length,
      recentEmotionalEvents: recentEmotional.length,
      emotionalCooldownHours: 0,
      note: this.profile.aiLocked
        ? 'AI 自学习已锁定，只有用户可以修改角色线。'
        : emotional.length && !stableRelation.length && !knowledge.length
          ? '目前只有情绪事件，缺少稳定证据，AI 不会改写人设。'
          : '情感线由第一人称情感记忆直接筛选分层；知识线仍以稳定证据为主。'
    };
  }

  save() {
    atomicWriteJson(this.file, this.profile);
  }

  get() {
    return structuredClone(this.profile);
  }

  publicProfile() {
    return {
      ...this.get(),
      revisionCount: this.revisions.count(),
      stability: this.stability()
    };
  }

  history(limit = 20) {
    return this.revisions.all().slice(-limit).reverse();
  }

  recordEmotionalMemory({ content = '', mood = '', intensity = 0.5, context = '', tags = [], source = 'ai' } = {}) {
    const text = String(content || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('情感记忆内容不能为空');
    if (text.length > 2000) throw new Error('情感记忆超过 2000 字');
    const blocked = unsafeReason(text);
    if (blocked) throw new Error(`情感记忆触发内容边界：${blocked}`);
    const humanCue = /(我|自己|心里|感到|感觉|情绪|关系|陪伴|孤独|信任|亲密|留恋|想念|害怕|担心|难过|开心|累|疲惫|边界|安慰|理解|沉默|靠近|离开)/;
    if (!isEmotionalTopic(text) && !humanCue.test(text)) {
      throw new Error('这段内容不像人类情感/关系记忆，已拒绝写入情感记忆');
    }
    const normalize = (value) => String(value || '').replace(/\s+/g, '');
    const duplicate = this.emotionalMemory.all().find((item) => !item.duplicate && normalize(item.content) === normalize(text));
    if (duplicate) {
      const updated = this.emotionalMemory.update(duplicate.id, {
        mentions: Number(duplicate.mentions || 1) + 1,
        updatedAt: nowIso(),
        mood: duplicate.mood || String(mood || '').slice(0, 40),
        tags: [...new Set([...(duplicate.tags || []), ...(Array.isArray(tags) ? tags.map(String) : [])])].slice(0, 8)
      });
      this.emit('persona:emotional-memory', updated);
      return updated;
    }
    const record = {
      id: id('emo'),
      kind: 'emotional_memory',
      content: text,
      mood: String(mood || '').slice(0, 40),
      intensity: clamp(Number(intensity) || 0.5, 0, 1),
      context: String(context || '').slice(0, 600),
      tags: Array.isArray(tags) ? tags.map(String).slice(0, 8) : [],
      source: String(source || 'ai'),
      mentions: 1,
      duplicate: false,
      createdAt: nowIso()
    };
    this.emotionalMemory.append(record);
    this.emit('persona:emotional-memory', record);
    return record;
  }

  listEmotionalMemory(limit = 30) {
    return this.emotionalMemory.all()
      .filter((item) => !item.duplicate)
      // 技术说明、系统总结混进情感记忆时只隐藏，不删除原始记录。
      .filter((item) => !(/AI|人工智能|模型|系统|算法|技术|数据库/i.test(item.content) && !/(我|感觉|心里|情绪|关系)/.test(item.content)))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
  }

  dedupeEmotionalMemory() {
    const seen = new Map();
    let marked = 0;
    for (const item of this.emotionalMemory.all()) {
      const key = String(item.content || '').replace(/\s+/g, '');
      if (!key) continue;
      if (!seen.has(key)) { seen.set(key, item); continue; }
      this.emotionalMemory.update(item.id, { duplicate: true, duplicateOf: seen.get(key).id, updatedAt: nowIso() });
      marked += 1;
    }
    return marked;
  }

  // 只做“筛选/分层”：从多条第一人称情感记忆里提炼反复出现的主题，形成稳定情感线。
  // 不是让模型直接改写人格，也不依赖天数冷却。
  layerEmotionalMemory({ minEntries = 1, minTheme = 1 } = {}) {
    const entries = this.listEmotionalMemory(80);
    if (entries.length < minEntries) {
      return { changed: false, reason: `情感记忆 ${entries.length} 条，尚未达到分层门槛 ${minEntries}` };
    }
    const counts = new Map();
    for (const entry of entries) {
      for (const tag of entry.tags || []) {
        const key = String(tag).trim();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
      if (entry.mood) counts.set(`mood:${entry.mood}`, (counts.get(`mood:${entry.mood}`) || 0) + 1);
    }
    let themes = [...counts.entries()].filter(([, count]) => count >= minTheme)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([theme]) => theme.replace(/^mood:/, ''));
    // 第一人称情感记忆本身就可以作为稳定人格的直接材料；没有标签时用“自我理解”兜底。
    if (!themes.length) themes = ['自我理解'];
    const chosen = entries.filter((entry) => themes.some((theme) =>
      (entry.tags || []).includes(theme) || entry.mood === theme
    )).slice(0, 6);
    const support = chosen.length >= minEntries ? chosen : entries.slice(0, Math.max(1, minEntries));
    const summary = [...new Set(support.map((entry) => entry.content))].slice(0, 4).join('；');
    const line = `我逐渐发现，自己在关系里反复在意的是「${themes.join('、')}」。${truncate(summary, 520)} 这些不是一次性情绪，而是我想继续带着走的部分。`;
    if (line === this.profile.emotionLine.text) return { changed: false, reason: '情感线已经是这个主题' };
    const result = this.update({
      emotionLine: line,
      reason: `由 ${support.length} 条情感记忆筛选分层形成（${themes.join('、')}），不是 AI 直接改人格`,
      evidenceIds: support.map((entry) => entry.id),
      by: 'ai-layer',
      requireEvidence: false
    });
    return { ...result, themes, sourceEntries: support.map((entry) => entry.id) };
  }

  evidence(ids = []) {
    const layers = [
      ['knowledge', this.memory.knowledge],
      ['relationship', this.memory.relationship],
      ['worklogs', this.memory.worklogs],
      ['multimodal', this.memory.multimodal],
      ['reflections', this.memory.reflections],
      ['emotional-journal', this.emotionalMemory]
    ];
    const out = [];
    const ownerId = this.ownerPersonId();
    for (const rawId of [...new Set(ids.map(String))]) {
      for (const [layer, store] of layers) {
        const item = store.get(rawId);
        if (item) {
          if (layer === 'relationship' && item.personId && item.personId !== ownerId) continue;
          out.push({
            id: item.id,
            layer,
            kind: item.kind || '',
            personId: item.personId || null,
            title: item.title || item.content?.slice(0, 80) || item.fileName || item.id,
            at: item.updatedAt || item.createdAt || item.at || null
          });
          break;
        }
      }
    }
    return out;
  }

  update({ knowledgeLine, emotionLine, reason = '', evidenceIds = [], by = 'user', requireEvidence = false } = {}) {
    const proof = this.evidence(evidenceIds);
    const cfg = this.config.get().persona;
    if (by === 'ai') {
      if (this.profile.aiLocked) throw new Error('角色自学习已锁定，AI 不能修改角色线');
      const report = this.evidenceReport(proof);
      if (requireEvidence && proof.length < Number(cfg.aiMinEvidence ?? 3)) {
        throw new Error(`AI 修改角色线至少需要 ${Number(cfg.aiMinEvidence ?? 3)} 条真实记忆证据；情绪事件不能单独改写人设`);
      }
      if (report.emotionalOnly) throw new Error('只有情绪事件，不能单独改写长期人设；请等待稳定偏好/知识/反思证据');
      if (!report.stableCore) throw new Error('缺少稳定核心证据（知识、偏好、边界或工作日志），不能仅凭情绪/反思改写人设');
      if (report.emotional > report.stable) throw new Error('情绪事件多于稳定证据，本次人设修改被拒绝');
      if (report.spanDays < Number(cfg.aiMinSpanDays ?? 3)) {
        throw new Error(`证据跨度只有 ${report.spanDays} 天，少于 ${Number(cfg.aiMinSpanDays ?? 3)} 天；长期人设需要跨时间稳定模式`);
      }
      // 情感线的稳定化不再等待“强烈情绪冷静期”；AI 直接写情感线仍被 Agent 禁止，
      // 由第一人称情感记忆分层生成。
      // 不再按 7 天次数或冷却小时限制人格稳定化；是否写入由证据与情感记忆内容决定。
    }
    const before = this.get();
    const next = this.get();
    let changed = false;
    for (const [key, value] of [['knowledgeLine', knowledgeLine], ['emotionLine', emotionLine]]) {
      if (value === undefined) continue;
      const text = String(value || '').replace(/\r\n/g, '\n').trim();
      if (!text) throw new Error('角色线不能为空');
      if (text.length > MAX_LINE) throw new Error(`角色线超过 ${MAX_LINE} 字上限`);
      if (text === next[key].text) continue;
      next[key] = { text, updatedAt: nowIso(), updatedBy: by };
      changed = true;
    }
    if (!changed) return { changed: false, profile: this.publicProfile(), evidence: proof };
    next.revision = Number(before.revision || 0) + 1;
    next.updatedAt = nowIso();
    next.updatedBy = by;
    next.lastReason = truncate(reason || (by === 'ai' ? 'AI 根据记忆校准' : '用户编辑'), 500);
    next.lastEvidence = proof;
    if (by === 'ai') next.lastAiRevisionAt = next.updatedAt;
    if (by === 'user') next.lastUserRevisionAt = next.updatedAt;
    this.profile = next;
    this.save();
    this.revisions.append({
      id: id('persona_rev'),
      revision: next.revision,
      at: next.updatedAt,
      by,
      reason: next.lastReason,
      evidence: proof,
      before: {
        knowledgeLine: before.knowledgeLine,
        emotionLine: before.emotionLine
      },
      after: {
        knowledgeLine: next.knowledgeLine,
        emotionLine: next.emotionLine
      }
    });
    this.logger.info('persona', `角色线已更新（${by}）`, { revision: next.revision, evidence: proof.map((item) => item.id) });
    this.emit('persona:changed', this.publicProfile());
    return { changed: true, profile: this.publicProfile(), evidence: proof };
  }

  renderMemoryEvidence() {
    const ownerId = this.ownerPersonId();
    const relation = this.memory.relationship.all()
      .filter((item) => !item.duplicate && !item.archived)
      .filter((item) => !item.personId || item.personId === ownerId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 16);
    const knowledge = this.memory.knowledge.all()
      .filter((item) => item.status === 'active')
      .sort((a, b) => String(b.verifiedAt).localeCompare(String(a.verifiedAt)))
      .slice(0, 8);
    const reflections = this.memory.listReflections(8);
    const emotionalNotes = this.listEmotionalMemory(8);
    const chunks = [];
    if (emotionalNotes.length) {
      chunks.push('第一人称情感记忆（可被分层为情感线，但不等于稳定人格）：\n' + emotionalNotes.map((item) =>
        `- [${item.id}] (${item.mood || '情绪未命名'}, 强度 ${Math.round(Number(item.intensity || 0) * 100)}%) ${truncate(item.content, 260)}`
      ).join('\n'));
    }
    if (relation.length) {
      chunks.push('关系记忆（只有主人的稳定偏好/边界可以支撑人设；情绪事件只能作为语气证据）：\n' + relation.map((item) => {
        const stable = ['preference', 'persona', 'boundary', 'important_person'].includes(item.kind);
        return `- [${item.id}] ${stable ? '[稳定]' : item.kind === 'emotional_event' ? '[情绪事件-不可单独依据]' : '[参考]'} (${item.kind}) ${truncate(item.content, 260)}`;
      }).join('\n'));
    }
    if (knowledge.length) {
      chunks.push('知识记忆：\n' + knowledge.map((item) => `- [${item.id}] ${item.title}：${truncate(item.content, 200)}`).join('\n'));
    }
    if (reflections.length) {
      chunks.push('反思：\n' + reflections.map((item) => `- [${item.id}] ${truncate(item.content, 200)}`).join('\n'));
    }
    const ownerPerson = this.people?.get(this.ownerPersonId());
    if (ownerPerson?.impression) {
      chunks.push(`【对话者印象｜仅作语气参考，不作为人设修改证据】\n- ${ownerPerson.nickname || '主人'}：${truncate(ownerPerson.impression, 200)}（亲近度 ${Math.round(Number(ownerPerson.affinity || 50))}/100）`);
    }
    return { text: chunks.join('\n\n') || '（暂时没有可用的长期记忆证据）', relation, knowledge, reflections, ownerPerson };
  }

  setLocked(locked) {
    this.profile.aiLocked = Boolean(locked);
    this.profile.updatedAt = nowIso();
    this.save();
    this.emit('persona:changed', this.publicProfile());
    return this.publicProfile();
  }

  rollback() {
    const revisions = this.revisions.all();
    const last = revisions[revisions.length - 1];
    if (!last?.before) throw new Error('没有可回滚的角色修订');
    const result = this.update({
      knowledgeLine: last.before.knowledgeLine?.text,
      emotionLine: last.before.emotionLine?.text,
      reason: `回滚 r${last.revision} 的角色线`,
      by: 'user'
    });
    return result;
  }

  async calibrate({ model, knowledgeOnly = false } = {}) {
    if (!model?.available?.('primary')) throw new Error('主模型未接入，无法让 AI 校准角色线');
    const evidence = this.renderMemoryEvidence();
    const cfg = this.config.get().persona;
    const stableRelation = evidence.relation.filter((item) => ['preference', 'persona', 'boundary', 'important_person'].includes(item.kind));
    const stableCore = stableRelation.length + evidence.knowledge.length;
    if (stableCore < Number(cfg.aiMinEvidence ?? 3)) {
      return {
        changed: false,
        skipped: true,
        reason: `长期稳定证据不足：目前 ${stableCore} 条，至少需要 ${Number(cfg.aiMinEvidence ?? 3)} 条；情绪事件不能单独改写人设。`,
        profile: this.publicProfile(),
        evidence: []
      };
    }
    const profile = this.get();
    const prompt = [
      '你是内部角色校准器。根据长期记忆，判断是否需要微调知识线（怎么求真、怎么处理不确定）和情感线（怎么陪伴、怎么保持边界）。',
      '情感线只能由情感记忆分层形成；如果 knowledgeOnly=true，你只允许输出知识线，不要输出或修改情感线。',
      '这不是写人设小作文，而是维护稳定的行为原则。不要写具体隐私、不要写用户真名、不要写一次性事件。',
      '',
      `当前知识线：${profile.knowledgeLine.text}`,
      `当前情感线（只读，除非未启用 knowledgeOnly）：${profile.emotionLine.text}`,
      `knowledgeOnly=${knowledgeOnly ? 'true' : 'false'}`,
      `不可更改的身份：${profile.identity.name} / ${profile.identity.role} / ${profile.identity.relationship}`,
      `不可更改的边界：${profile.boundaries}`,
      '',
      '可用记忆证据：',
      evidence.text,
      '',
      '只输出 JSON，不要代码围栏。字段：',
      '{"changed":true|false,"knowledgeLine":"...","emotionLine":"...","reason":"为什么改","evidence_ids":["必须来自上面的 ID"]}',
      '要求：',
      '1. 只有记忆里出现稳定、重复、值得长期遵循的模式时才改；没有充分证据就 changed=false。',
      '2. 每次最多改一到两条线，尽量小步；每条 60-500 字，不得与身份/边界冲突。',
      '3. 至少引用 3 条真实证据，且至少 1 条是知识/偏好/边界等稳定核心；情绪事件只能作为辅助，不能单独改人设。',
      '4. 证据应来自多次出现、可重复的稳定模式；不要因为一次争吵、一次撒娇或一次情绪波动改写长期人格。',
      '5. 如果最近有强烈情绪事件，情感线暂时不要改；等情绪沉淀后再评估。',
      '6. 不要写“记住用户说过 XXX”这类具体事件，只提炼行为原则；没有满足条件就 changed=false。'
    ].join('\n');
    const raw = await model.simple('primary', prompt, { temperature: 0.2, maxTokens: 1400 });
    const parsed = parseJsonLoose(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('AI 角色校准没有返回约定 JSON');
    if (parsed.changed === false) {
      return { changed: false, profile: this.publicProfile(), reason: String(parsed.reason || 'AI 认为当前角色线不需要修改'), evidence: [] };
    }
    const ids = Array.isArray(parsed.evidence_ids) ? parsed.evidence_ids.map(String) : [];
    const valid = this.evidence(ids);
    if (!valid.length) throw new Error('AI 校准没有引用有效记忆证据，本次修改已拒绝');
    const result = this.update({
      knowledgeLine: parsed.knowledgeLine,
      emotionLine: knowledgeOnly ? undefined : parsed.emotionLine,
      reason: String(parsed.reason || 'AI 根据长期记忆校准'),
      evidenceIds: valid.map((item) => item.id),
      by: 'ai',
      requireEvidence: true
    });
    return {
      ...result,
      reason: String(parsed.reason || 'AI 根据长期记忆校准'),
      evidence: valid
    };
  }

  promptBlock() {
    const p = this.get();
    return [
      '【存在设定｜长期互动中形成】',
      `身份：${p.identity.name}，${p.identity.role}，与用户的关系是「${p.identity.relationship}」。`,
      '',
      '【知识线｜怎么求真】',
      p.knowledgeLine.text,
      '',
      '【情感线｜怎么陪伴】',
      p.emotionLine.text,
      '',
      '【不可更改的边界】',
      p.boundaries,
      '',
      `当前修订 r${p.revision || 0}。知识线可以在稳定证据出现时小步修订；情感线不要直接改写，先调用 emotional_note 留下第一人称情感记忆，系统会把反复出现的主题筛选、分层后形成稳定情感线。`
    ].join('\n');
  }
}
