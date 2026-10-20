import fs from 'node:fs';
import { parseJsonLoose, nowIso, truncate } from './utils.js';

const LABEL_PROMPT = [
  '这是 QQ 里收到的一张动画表情/表情包。请只做一次客观的画面与用法标注。',
  '只输出 JSON，不要 Markdown、解释或代码块：',
  '{"caption":"一句话画面概括，20字内","emotion":["情绪1","情绪2"],"scenes":["适用聊天场景1","适用聊天场景2"],"tags":["画面标签1","画面标签2"]}',
  'caption 写画面（人物/动物/文字/动作），不要写文件名、QQ号、昵称或“图片”。',
  'emotion 是这张表情传达的情绪；scenes 是适合在什么对话情境下发出去。',
  'tags 只写可检索的词，不要写“表情包”这种泛词。最多各 6 个。'
].join('\n');

function cleanList(value, max = 6) {
  return (Array.isArray(value) ? value : String(value || '').split(/[,，、;；]/))
    .map((item) => String(item || '').replace(/[\[\]【】]/g, '').replace(/\s+/g, ' ').trim())
    .filter((item) => item && item.length <= 40)
    .filter((item) => !/^(图片|表情包|动画表情|sticker)$/i.test(item))
    .slice(0, max);
}

export class StickerLabeler {
  constructor({ memory, model, logger, emit = () => {} }) {
    this.memory = memory;
    this.model = model;
    this.logger = logger;
    this.emit = emit;
    this.status = {
      running: false,
      total: 0,
      done: 0,
      failed: 0,
      remaining: 0,
      startedAt: null,
      finishedAt: null,
      lastError: ''
    };
  }

  overview() {
    const unlabeled = this.memory.listUnlabeledStickers(300).length;
    const labeled = this.memory.multimodal.all()
      .filter((item) => item.kind === 'sticker' && !item.duplicate && item.labeledAt).length;
    return { ...this.status, unlabeled, labeled };
  }

  async labelOne(item) {
    const prompt = `${LABEL_PROMPT}\n这张表情的画面线索：${truncate(item.caption || '', 80)}`;
    const raw = await this.model.describeImages([item.file], { role: 'primary', prompt });
    const parsed = parseJsonLoose(raw) || {};
    let caption = String(parsed.caption || parsed.stickerCaption || '').replace(/\s+/g, ' ').trim();
    let emotion = cleanList(parsed.emotion, 6);
    let scenes = cleanList(parsed.scenes, 6);
    let tags = cleanList(parsed.tags, 8);
    if (!caption) {
      // 模型偶尔会输出半截 JSON；保留一句话，至少让搜索有内容可命中。
      caption = truncate(String(raw || '').replace(/```[\s\S]*?```/g, '').replace(/[{}"]/g, ' ').trim(), 80);
    }
    if (!caption) throw new Error('视觉模型没有返回可用概括');
    if (!emotion.length && !scenes.length) {
      const fallback = cleanList(`${caption} ${tags.join(' ')}`, 6);
      emotion = fallback.slice(0, 3);
      scenes = fallback.slice(0, 4);
    }
    return this.memory.labelSticker(item.id, {
      caption,
      emotion,
      scenes,
      tags,
      source: 'vision',
      model: this.model.available('helper') ? 'vision-helper' : 'vision-primary'
    });
  }

  async labelAll({ limit = 300 } = {}) {
    if (this.status.running) return this.overview();
    if (!this.model.available('primary')) {
      this.status.lastError = '主模型未接入，暂时不能识别表情';
      return this.overview();
    }
    const items = this.memory.listUnlabeledStickers(limit);
    if (!items.length) return this.overview();
    this.status = {
      ...this.status,
      running: true,
      total: items.length,
      done: 0,
      failed: 0,
      remaining: items.length,
      startedAt: nowIso(),
      finishedAt: null,
      lastError: ''
    };
    this.emit('stickers:labelProgress', this.overview());
    for (const item of items) {
      if (!item.file || !fs.existsSync(item.file)) {
        this.status.failed += 1;
        this.status.remaining = Math.max(0, this.status.remaining - 1);
        continue;
      }
      try {
        await this.labelOne(item);
        this.status.done += 1;
      } catch (error) {
        this.status.failed += 1;
        this.status.lastError = error.message;
        this.logger?.warn?.('stickers', `表情标注失败：${error.message}`);
      }
      this.status.remaining = Math.max(0, this.status.remaining - 1);
      this.emit('stickers:labelProgress', this.overview());
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    this.status.running = false;
    this.status.finishedAt = nowIso();
    this.logger?.info?.('stickers', `表情标注完成：成功 ${this.status.done}，失败 ${this.status.failed}`);
    this.emit('stickers:labelProgress', this.overview());
    return this.overview();
  }
}
