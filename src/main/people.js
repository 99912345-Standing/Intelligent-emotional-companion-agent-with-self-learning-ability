import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { JsonlStore } from './jsonl.js';
import { clamp, nowIso, round, truncate } from './utils.js';

const POSITIVE = /(谢谢|感谢|喜欢|开心|信任|辛苦|抱抱|晚安|爱你|靠谱|厉害|帮了我|陪我|想你)/i;
const NEGATIVE = /(滚|烦死|讨厌|闭嘴|傻|生气|别烦|垃圾|骗子|恶心)/i;

/**
 * 人 × 印象 × 亲近度。
 * 统一以 QQ 号为稳定主键；昵称只是可刷新的显示名。
 * 群聊和私聊都进入同一份人物账本，避免“换个地方就不认识”。
 */
export class PeopleEngine {
  constructor({ config, memory, logger, emit = () => {} }) {
    this.config = config;
    this.memory = memory;
    this.logger = logger;
    this.emit = emit;
    this.dir = path.join(paths.data, 'people');
    fs.mkdirSync(this.dir, { recursive: true });
    this.store = new JsonlStore(path.join(this.dir, 'people.jsonl'), 'people');
  }

  list() {
    return this.store.all()
      .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
      .map((person) => this.publicPerson(person));
  }

  get(personId) {
    return this.store.get(personId) || null;
  }

  publicPerson(person) {
    if (!person) return null;
    return {
      ...person,
      display: `${person.nickname || '未知昵称'}（${person.qq ? `QQ ${person.qq}` : '无 QQ'}）`
    };
  }

  stats() {
    const people = this.store.all();
    return {
      total: people.length,
      manual: people.filter((person) => person.manual).length,
      averageAffinity: people.length ? round(people.reduce((sum, person) => sum + Number(person.affinity || 50), 0) / people.length, 1) : 0,
      groups: people.filter((person) => (person.channels || []).some((channel) => String(channel).startsWith('qq_group_'))).length
    };
  }

  observe({ qq, nickname, text = '', channel = 'desktop', source = 'qq', allowed = true } = {}) {
    const qqId = String(qq || '').trim();
    if (!qqId && !nickname) return null;
    const ownerQQ = String(this.config.get().qq.ownerQQ || '');
    const personId = qqId ? `qq:${qqId}` : 'owner';
    const now = nowIso();
    let person = this.store.get(personId);
    const isNew = !person;
    const isOwner = Boolean(qqId && ownerQQ && qqId === ownerQQ);
    if (!person) {
      person = {
        id: personId,
        qq: qqId,
        nickname: String(nickname || (isOwner ? '主人' : qqId || '未知')),
        aliases: [],
        affinity: isOwner ? 65 : 50,
        impression: '',
        tags: [],
        manual: false,
        firstSeenAt: now,
        lastSeenAt: now,
        messageCount: 0,
        channels: [],
        recent: [],
        dirty: true,
        createdAt: now,
        updatedAt: now
      };
    }
    let nicknameChanged = false;
    if (nickname && String(nickname).trim() && String(nickname).trim() !== person.nickname) {
      const old = person.nickname;
      if (old && !(person.aliases || []).includes(old)) person.aliases = [...(person.aliases || []), old].slice(-6);
      person.nickname = String(nickname).trim();
      nicknameChanged = Boolean(person.qq);
    }
    person.qq = qqId || person.qq;
    person.lastSeenAt = now;
    person.updatedAt = now;
    person.messageCount = Number(person.messageCount || 0) + 1;
    person.channels = [...new Set([...(person.channels || []), channel])].slice(-12);
    if (text) {
      person.recent = [...(person.recent || []), {
        at: now,
        channel,
        text: truncate(String(text), 240),
        allowed: Boolean(allowed)
      }].slice(-8);
    }
    if (!person.manual && text) {
      let delta = 0;
      if (POSITIVE.test(text)) delta += 0.8;
      if (NEGATIVE.test(text)) delta -= 1.2;
      if (/[?？]/.test(text)) delta += 0.2;
      if (String(text).length > 20) delta += 0.1;
      if (delta) {
        person.affinity = round(clamp(Number(person.affinity ?? 50) + delta, 0, 100), 1);
        person.affinityUpdatedAt = now;
      }
    }
    person.dirty = true;
    if (isNew) this.store.append(person);
    else this.store.update(person.id, person);
    if (person.qq && nickname && (nicknameChanged || isNew) && this.memory?.refreshPersonNickname) {
      const changed = this.memory.refreshPersonNickname(personId, person.nickname);
      if (changed) this.logger.info('people', `昵称已刷新：${personId} → ${person.nickname}（${changed} 条记忆）`);
    }
    const out = this.publicPerson(person);
    this.emit('people:changed', out);
    return out;
  }

  update(personId, patch = {}) {
    const current = this.store.get(personId);
    if (!current) throw new Error('人物不存在');
    const next = { ...current };
    if (patch.manual !== undefined) next.manual = Boolean(patch.manual);
    if (patch.affinity !== undefined) {
      next.affinity = round(clamp(Number(patch.affinity) || 0, 0, 100), 1);
      next.affinityUpdatedAt = nowIso();
    }
    if (patch.impression !== undefined) {
      next.impression = truncate(String(patch.impression || '').trim(), 600);
      next.impressionUpdatedAt = nowIso();
    }
    if (Array.isArray(patch.tags)) {
      next.tags = [...new Set(patch.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 10);
    }
    next.updatedAt = nowIso();
    this.store.update(personId, next);
    const out = this.publicPerson(next);
    this.emit('people:changed', out);
    return out;
  }

  remove(personId) {
    const person = this.store.get(personId);
    if (!person) return false;
    this.store.remove(personId);
    this.emit('people:changed', { id: personId, removed: true });
    return true;
  }

  fallbackImpression(person) {
    const channels = (person.channels || []).some((channel) => String(channel).startsWith('qq_group_')) ? '群聊和私聊' : '私聊';
    const mood = Number(person.affinity || 50) >= 70 ? '相处起来比较亲近' : Number(person.affinity || 50) <= 35 ? '目前还有一些距离' : '关系在慢慢熟悉';
    const last = person.recent?.[person.recent.length - 1]?.text;
    return truncate(`${channels}里都出现过，${mood}。${last ? `最近聊到：${last.slice(0, 34)}` : ''}`, 120);
  }

  async refreshImpressions({ model, limit = 6, force = false } = {}) {
    const candidates = this.store.all()
      .filter((person) => !person.manual && (force || person.dirty || !person.impression))
      .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
      .slice(0, limit);
    if (!candidates.length) return [];
    const updated = [];
    for (const person of candidates) {
      let impression = '';
      if (model?.available?.('primary')) {
        try {
          const recent = (person.recent || []).slice(-6).map((item) => `- ${item.text}`).join('\n');
          impression = await model.simple('primary', [
            '你在维护一份本地人物印象账本。下面是一个 QQ 联系人的公开昵称、亲近度和最近发言。',
            '写一条不超过 70 字的中文印象，写沟通风格、兴趣或相处感受；不要写联系方式、住址、诊断、秘密，也不要逐字复述原话。',
            '只输出印象短句，不要解释。',
            `昵称：${person.nickname}`,
            `亲近度（0-100）：${person.affinity}`,
            `最近发言：\n${recent || '（暂无）'}`
          ].join('\n'), { temperature: 0.5, maxTokens: 180 });
        } catch (error) {
          this.logger.warn('people', `印象刷新失败：${error.message}`);
        }
      }
      if (!impression) impression = this.fallbackImpression(person);
      const next = {
        ...person,
        impression: truncate(String(impression).replace(/^["“]|["”]$/g, '').trim(), 240),
        impressionUpdatedAt: nowIso(),
        dirty: false,
        updatedAt: nowIso()
      };
      this.store.update(person.id, next);
      updated.push(this.publicPerson(next));
    }
    if (updated.length) this.emit('people:changed', { batch: updated });
    return updated;
  }
}
