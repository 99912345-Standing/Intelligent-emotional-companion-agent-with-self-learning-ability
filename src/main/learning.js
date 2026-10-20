import path from 'node:path';
import { paths } from './paths.js';
import { JsonlStore } from './jsonl.js';
import {
  clamp, domainOf, id, nowIso, overlapScore, parseJsonLoose, recencyScore,
  round, tokenize, truncate, uniqueBy
} from './utils.js';
import { isSafeContent, unsafeReason } from './content-policy.js';

const OFFICIAL_DOMAINS = /(^|\.)(gov\.cn|gov|edu|edu\.cn|who\.int|un\.org|ietf\.org|w3\.org|mozilla\.org|python\.org|nodejs\.org|github\.com|openai\.com|deepseek\.com|anthropic\.com)$/i;
const TRUSTED_DOMAINS = /(wikipedia\.org|britannica\.com|reuters\.com|apnews\.com|bbc\.com|xinhuanet\.com|people\.com\.cn|thepaper\.cn|caixin\.com|nytimes\.com|nature\.com|science\.org)$/i;
const COMMUNITY_DOMAINS = /(zhihu\.com|csdn\.net|juejin\.cn|medium\.com|substack\.com|reddit\.com|weibo\.com|bilibili\.com|douyin\.com)$/i;
const NEWS_DOMAINS = /(36kr\.com|sspai\.com|ithome\.com|ifeng\.com|sina\.com\.cn|163\.com|qq\.com|theverge\.com|techcrunch\.com|wired\.com)$/i;

function domainTier(domain) {
  if (!domain) return { base: 0.32, label: '未知来源' };
  if (OFFICIAL_DOMAINS.test(domain)) return { base: 0.88, label: '官方/机构/文档' };
  if (TRUSTED_DOMAINS.test(domain)) return { base: 0.78, label: '高可信媒体/百科' };
  if (COMMUNITY_DOMAINS.test(domain)) return { base: 0.48, label: '社区内容' };
  if (NEWS_DOMAINS.test(domain)) return { base: 0.64, label: '行业/新闻媒体' };
  if (/\.(gov|edu)(\.|$)/i.test(domain)) return { base: 0.86, label: '政府/教育机构' };
  return { base: 0.42, label: '一般网页' };
}

function sourceLevel(score) {
  if (score >= 0.72) return { key: 'high', label: '高权重' };
  if (score >= 0.5) return { key: 'medium', label: '中权重' };
  return { key: 'low', label: '低权重' };
}

function buildQueries(query) {
  const clean = String(query).replace(/\s+/g, ' ').trim();
  const queries = [clean];
  if (/(最新|价格|政策|版本|发布|新闻|现在|今年|今天)/.test(clean)) {
    queries.push(`${clean} 官方 最新消息`);
  } else {
    queries.push(`${clean} 官方来源`);
  }
  if (!/(官网|official)/i.test(clean)) queries.push(`${clean} site:gov.cn OR site:edu.cn`);
  return [...new Set(queries)].slice(0, 3);
}

function buildFallbackAssessment(query, sources, oldFact = null) {
  const usable = sources.filter((source) => source.ok || source.snippet);
  const avg = usable.length ? usable.reduce((sum, source) => sum + source.reliability, 0) / usable.length : 0.3;
  const domains = new Set(usable.map((source) => source.domain).filter(Boolean));
  const corroboration = clamp((domains.size - 1) / 3, 0, 1);
  const answer = usable.slice(0, 3).map((source) => source.snippet || truncate(source.text, 380)).filter(Boolean).join('\n\n');
  const confidence = clamp(avg * 0.52 + corroboration * 0.26 + Math.min(0.16, usable.length * 0.04), 0.12, 0.82);
  return {
    answer: answer || '没有抓取到足够的可用内容。',
    confidence: round(confidence, 3),
    claims: usable.slice(0, 4).map((source) => ({
      text: truncate(source.snippet || source.title, 300),
      supporting: [source.url],
      contradictions: []
    })),
    conflicts: [],
    tags: [...new Set(tokenize(query).filter((token) => token.length > 1))].slice(0, 8),
    recommendation: oldFact ? 'merge' : 'archive',
    reasoning: `未启用 AI 交叉验证，按 ${domains.size} 个独立域名、平均信源分 ${Math.round(avg * 100)}% 做出保守判断。`,
    fallback: true
  };
}

export class LearningEngine {
  constructor({ config, logger, memory, model, webSearch, browserCrawler = null, emit = () => {} }) {
    this.config = config;
    this.logger = logger;
    this.memory = memory;
    this.model = model;
    this.webSearch = webSearch;
    this.browserCrawler = browserCrawler;
    this.emit = emit;
    this.cycles = new JsonlStore(path.join(paths.learning, 'cycles.jsonl'), 'learning-cycles');
    this.running = new Map();
  }

  listCycles(limit = 40) {
    return this.cycles.all().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, limit);
  }

  getCycle(cycleId) {
    return this.cycles.get(cycleId);
  }

  scoreSources(results, pages, query) {
    const queryTokens = tokenize(query);
    const pageMap = new Map(pages.map((page) => [page.url, page]));
    const preliminary = results.map((result) => {
      const page = pageMap.get(result.url) || null;
      const domain = domainOf(result.url);
      const tier = domainTier(domain);
      const text = `${result.title} ${result.snippet} ${page?.text || ''}`;
      const relevance = overlapScore(queryTokens, tokenize(text));
      const freshness = page?.publishedAt ? recencyScore(page.publishedAt, 120) : 0.45;
      const quality = page?.ok
        ? clamp((page.text || '').length / 1800, 0, 1) * 0.08
        : 0;
      const reasons = [
        tier.label,
        relevance >= 0.25 ? '与问题高度相关' : relevance >= 0.1 ? '部分相关' : '相关性较弱',
        page?.ok ? '正文已核读' : '仅搜索摘要'
      ];
      return {
        ...result,
        domain,
        tier: tier.label,
        relevance: round(relevance, 3),
        freshness: round(freshness, 3),
        ok: Boolean(page?.ok),
        title: page?.title || result.title,
        snippet: truncate(page?.description || result.snippet || '', 400),
        excerpt: truncate(page?.text || result.snippet || '', 2200),
        publishedAt: page?.publishedAt || null,
        baseScore: round(clamp(tier.base + relevance * 0.16 + freshness * 0.04 + quality + (page?.ok ? 0.03 : -0.02), 0.1, 0.97), 3),
        reasons
      };
    });

    // 交叉印证：不同独立域名出现相似表述时提高权重，同域名不重复加分。
    const supportCounts = new Map();
    for (const source of preliminary) {
      const sourceTokens = new Set(tokenize(`${source.title} ${source.snippet}`));
      let support = 0;
      for (const other of preliminary) {
        if (other === source || other.domain === source.domain) continue;
        const otherTokens = tokenize(`${other.title} ${other.snippet}`);
        const overlap = otherTokens.filter((token) => sourceTokens.has(token) && token.length > 1).length;
        if (overlap >= 3) support += 1;
      }
      supportCounts.set(source.url, support);
    }
    return preliminary.map((source) => {
      const support = supportCounts.get(source.url) || 0;
      const reliability = clamp(source.baseScore + Math.min(0.13, support * 0.035), 0.08, 0.97);
      return {
        ...source,
        support,
        reliability: round(reliability, 3),
        level: sourceLevel(reliability),
        reasons: [...source.reasons, support > 0 ? `${support} 个独立来源交叉印证` : '暂无独立交叉印证']
      };
    }).sort((a, b) => b.reliability - a.reliability);
  }

  async synthesize(query, sources, oldFact) {
    const cfg = this.config.get();
    if (!this.model.available('primary') || sources.length === 0) {
      return buildFallbackAssessment(query, sources, oldFact);
    }
    const sourceBlocks = sources.slice(0, 6).map((source, index) => [
      `[S${index + 1}] ${source.title}`,
      `URL: ${source.url}`,
      `域名: ${source.domain}｜信源基础分: ${Math.round(source.reliability * 100)}/100｜${source.ok ? '已读取正文' : '仅摘要'}｜支持数: ${source.support}`,
      `内容: ${truncate(source.excerpt || source.snippet || '', 1500)}`
    ].join('\n')).join('\n\n');
    const oldBlock = oldFact ? `【旧知识条目】\n标题：${oldFact.title}\n内容：${truncate(oldFact.content, 1200)}\n核验时间：${oldFact.verifiedAt}\n置信：${oldFact.confidence}\n来源：${(oldFact.sources || []).map((source) => source.url).join(' ; ')}` : '无旧条目。';
    const prompt = [
      `请就以下问题做多信源交叉验证，并只输出一个 JSON 对象。问题：${query}`,
      '',
      '信源（已按域名、相关性、正文质量和交叉印证打了基础分，但你要独立判断证据是否真的支持结论）：',
      sourceBlocks,
      '',
      oldBlock,
      '',
      '要求：',
      '1. answer 用中文给出简洁、可核查的结论；区分“有共识”与“存在冲突”。',
      '2. claims 列出 1-5 条原子事实，每条附 supporting 的 URL 数组；不要编造来源。',
      '3. conflicts 列出信源间真实冲突；没有就空数组。',
      '4. confidence 是 0-1 的数值，必须反映证据质量、独立来源数量、时效性。单一低权重来源不得给高分。',
      '5. recommendation 仅可为 "archive"（新知识）、"replace"（替换旧条目）、"merge"（合并补充）、"keep"（保留旧结论）、"conflict"（冲突待人工裁决）。',
      '6. tags 为 2-8 个中文/英文短标签。',
      '',
      '输出字段：{"answer":"","confidence":0.0,"claims":[{"text":"","supporting":["url"],"contradictions":[]}],"conflicts":[],"tags":[],"recommendation":"archive","reasoning":""}',
      '不要输出 Markdown 代码围栏，不要输出 JSON 之外的内容。'
    ].join('\n');
    try {
      const text = await this.model.simple('primary', prompt, { temperature: 0.1, maxTokens: 2400 });
      const parsed = parseJsonLoose(text);
      if (!parsed || typeof parsed.answer !== 'string') throw new Error('模型未返回约定的 JSON');
      return {
        answer: parsed.answer,
        confidence: clamp(Number(parsed.confidence ?? 0.5), 0, 0.98),
        claims: Array.isArray(parsed.claims) ? parsed.claims.slice(0, 6) : [],
        conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts.slice(0, 6) : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : [],
        recommendation: ['archive', 'replace', 'merge', 'keep', 'conflict'].includes(parsed.recommendation) ? parsed.recommendation : 'archive',
        reasoning: String(parsed.reasoning || ''),
        fallback: false
      };
    } catch (error) {
      this.logger.warn('learning', `AI 交叉验证失败，退回启发式：${error.message}`);
      const fallback = buildFallbackAssessment(query, sources, oldFact);
      fallback.reasoning = `${fallback.reasoning}（AI 综合失败：${error.message}）`;
      return fallback;
    }
  }

  async run(query, { trigger = 'manual', oldKnowledgeId = null, channel = 'desktop', archive = true } = {}) {
    const clean = String(query || '').trim();
    if (!clean) throw new Error('请输入要查证的问题');
    const policyReason = unsafeReason(clean);
    if (policyReason) throw new Error(`该主题触发内容边界（${policyReason}），不进入知识学习`);
    const cfg = this.config.get();
    if (!this.config.get().permissions.webSearch) throw new Error('联网搜索权限未开启');
    const cycle = {
      id: id('cycle'),
      query: clean,
      trigger,
      channel,
      startedAt: nowIso(),
      completedAt: null,
      status: 'running',
      oldKnowledgeId: oldKnowledgeId || null,
      queryText: clean,
      steps: [],
      sources: [],
      assessment: null,
      knowledgeId: null,
      outcome: null,
      error: null
    };
    this.cycles.append(cycle);
    this.running.set(cycle.id, cycle);
    this.progress(cycle, 'blank', '空白识别', `触发方式：${trigger}；正在确认知识缺口。`, {
      knowledgeConfidence: this.memory.searchKnowledge(clean, 1)[0]?.score ?? 0,
      challenge: this.memory.isChallenge(clean)
    });

    try {
      let oldFact = oldKnowledgeId ? this.memory.findKnowledgeById(oldKnowledgeId) : null;
      if (!oldFact) {
        const related = this.memory.findRelatedKnowledge({ title: clean, content: clean });
        oldFact = related[0] || null;
      }
      if (oldFact) cycle.oldKnowledgeId = oldFact.id;

      // 1. 空白识别
      const known = this.memory.searchKnowledge(clean, 3);
      const top = known[0];
      const unknown = !top || top.score < Number(cfg.memory.knowledgeConfidenceThreshold || 0.34);
      this.addStep(cycle, 'blank', '空白识别', unknown ? '知识库没有足够可靠的答案，进入联网查证。' : `知识库有一条候选答案，但本次仍按任务要求重新核验（${top.title}）。`, {
        unknown, topScore: top?.score ?? 0, existing: top ? [top.id] : []
      });

      // 2. 联网搜集
      const queries = buildQueries(clean);
      this.progress(cycle, 'search', '联网搜集', `并行检索 ${queries.length} 组关键词。`, { queries });
      const { results, errors } = await this.webSearch.searchMany(queries, { countPerQuery: Math.max(3, Math.ceil(cfg.search.maxResults / 2)) });
      cycle.reviewed = true;
      const safeResults = results.filter((item) => isSafeContent(`${item.title} ${item.snippet} ${item.url}`));
      if (!safeResults.length) {
        throw new Error(`没有搜到符合内容边界的可用结果。${errors.length ? `搜索错误：${errors.join('；')}` : '请换一个更具体的主题。'}`);
      }
      results.splice(0, results.length, ...safeResults);
      this.addStep(cycle, 'search', '联网搜集', `获得 ${results.length} 条去重结果，来自 ${new Set(results.map((item) => domainOf(item.url))).size} 个域名；已通过内容审查。`, {
        queries, count: results.length, errors, reviewed: true, results: results.slice(0, 12).map(({ title, url, snippet }) => ({ title, url, snippet: truncate(snippet, 200) }))
      });

      // 3. 读取正文（最多 N 篇）
      this.progress(cycle, 'fetch', '读取信源正文', '正在抓取高相关页面的正文，用于交叉验证。');
      let pages = await this.webSearch.fetchMany(results, { limit: cfg.search.fetchTop });
      // 动态页面/反爬页面用本机 Chromium 再渲染一次；失败不影响其它信源。
      if (this.browserCrawler && cfg.search.browserCrawler !== false) {
        const failed = pages.filter((page) => !page.ok).slice(0, 2);
        for (const page of failed) {
          try {
            const rendered = await this.browserCrawler.crawl(page.url, { timeoutMs: 35000 });
            page.ok = true;
            page.title = rendered.title || page.title;
            page.text = rendered.text || '';
            page.videoUrl = rendered.videos?.[0]?.src || page.videoUrl || '';
            page.imageUrl = rendered.videos?.[0]?.poster || page.imageUrl || '';
            this.addStep(cycle, 'fetch', '浏览器渲染', `用无头浏览器补充读取：${page.url}`, { url: page.url, chars: page.text.length });
          } catch (error) {
            page.error = `${page.error || ''}；浏览器渲染失败：${error.message}`;
          }
        }
      }
      const okPages = pages.filter((page) => page.ok).length;
      this.addStep(cycle, 'fetch', '读取信源正文', `成功读取 ${okPages} / ${pages.length} 篇正文；其余仅使用搜索摘要。`, {
        pages: pages.map((page) => ({ url: page.url, ok: page.ok, title: page.title, chars: page.text?.length || 0, videoUrl: page.videoUrl || null, error: page.error || null }))
      });
      // 视频页面：保存元数据，允许时下载到多模态记忆，供后续归档。
      for (const page of pages.filter((item) => item.ok && item.videoUrl).slice(0, 2)) {
        try {
          const canonical = /\.(mp4|webm|mov|mkv|m4v)(?:$|\?)/i.test(page.videoUrl) ? page.videoUrl : '';
          if (canonical && cfg.search.allowVideoDownload !== false) {
            const downloaded = await this.webSearch.downloadMedia(canonical, { maxMb: Number(cfg.search.maxVideoMb || 80) });
            const media = await this.memory.saveMedia({
              buffer: downloaded.buffer,
              kind: 'video',
              mime: downloaded.mime,
              fileName: `research-${Date.now()}.mp4`,
              source: 'idle-learning',
              caption: page.title,
              tags: ['视频', '自学习', page.domain],
              meta: { pageUrl: page.url, videoUrl: page.videoUrl }
            });
            page.mediaId = media.id;
            this.addStep(cycle, 'fetch', '视频归档', `已保存视频到多模态记忆：${page.title}`, { mediaId: media.id, bytes: downloaded.buffer.length });
          } else {
            this.addStep(cycle, 'fetch', '视频元数据', `发现视频页面，保留元数据：${page.title}`, { pageUrl: page.url, videoUrl: page.videoUrl, note: '流媒体或未允许下载，仅保留元数据' });
          }
        } catch (error) {
          this.addStep(cycle, 'fetch', '视频归档失败', error.message, { pageUrl: page.url });
        }
      }
      pages = pages
        .filter((page) => isSafeContent(`${page.title || ''} ${page.description || ''} ${page.text || ''}`))
        .map((page) => ({ ...page, text: page.text || page.description || page.snippet || '' }));

      // 4. 信源打分
      const scored = this.scoreSources(results.slice(0, Math.max(6, cfg.search.fetchTop + 2)), pages, clean);
      cycle.sources = scored.map((source) => ({
        title: source.title,
        url: source.url,
        domain: source.domain,
        snippet: truncate(source.snippet, 600),
        reliability: source.reliability,
        baseScore: source.baseScore,
        level: source.level,
        support: source.support,
        ok: source.ok,
        publishedAt: source.publishedAt,
        reasons: source.reasons,
        excerpt: truncate(source.excerpt, 2000)
      }));
      this.addStep(cycle, 'score', '信源鉴定', `按域名权威度、相关性、正文质量、时效与交叉印证打分；最高 ${Math.round((scored[0]?.reliability || 0) * 100)} 分。`, {
        sources: cycle.sources.map((source) => ({ title: source.title, domain: source.domain, reliability: source.reliability, level: source.level }))
      });

      // 5. 交叉验证
      this.progress(cycle, 'validate', '交叉验证', '正在比对不同信源，识别共识与冲突。');
      const assessment = await this.synthesize(clean, scored, oldFact);
      const domains = new Set(scored.filter((source) => source.reliability >= 0.4).map((source) => source.domain));
      const evidenceBonus = clamp(domains.size / 5, 0, 1) * 0.08;
      assessment.confidence = round(clamp(Number(assessment.confidence) + evidenceBonus, 0, 0.96), 3);
      cycle.assessment = assessment;
      this.addStep(cycle, 'validate', '交叉验证', `AI 综合置信度 ${Math.round(assessment.confidence * 100)}%；发现 ${assessment.conflicts.length} 处冲突。`, {
        confidence: assessment.confidence,
        conflicts: assessment.conflicts,
        reasoning: assessment.reasoning
      });

      // 6. 归档 / 比对替换
      this.progress(cycle, 'archive', '筛选归档', '正在判断新结论与旧记忆的关系。');
      const archival = archive ? await this.archive(cycle, clean, scored, assessment, oldFact, cfg) : { outcome: 'skipped', reason: '本次仅查证，不归档。' };
      cycle.outcome = archival.outcome;
      cycle.knowledgeId = archival.knowledgeId || null;
      this.addStep(cycle, 'archive', '筛选归档', archival.message, archival);

      cycle.status = 'completed';
      cycle.completedAt = nowIso();
      cycle.durationMs = Date.parse(cycle.completedAt) - Date.parse(cycle.startedAt);
      this.cycles.update(cycle.id, cycle);
      this.running.delete(cycle.id);
      this.progress(cycle, 'done', '闭环完成', `已形成可追溯的查证记录（${cycle.id.slice(-8)}）。`, { cycle });
      return cycle;
    } catch (error) {
      cycle.status = 'failed';
      cycle.error = error.message;
      cycle.completedAt = nowIso();
      this.cycles.update(cycle.id, cycle);
      this.running.delete(cycle.id);
      this.addStep(cycle, 'error', '流程中止', error.message, {});
      this.progress(cycle, 'error', '查证失败', error.message, {});
      this.logger.error('learning', `查证失败：${error.message}`);
      throw error;
    }
  }

  async archive(cycle, query, sources, assessment, oldFact, cfg) {
    const policyReason = unsafeReason(`${query} ${assessment.answer || ''} ${(assessment.claims || []).map((claim) => claim.text || '').join(' ')}`);
    if (policyReason) {
      return { outcome: 'blocked', knowledgeId: null, message: `内容边界拦截（${policyReason}），不写入知识库。` };
    }
    const minSources = Number(cfg.search.minSources || 2);
    const uniqueDomains = new Set(sources.filter((source) => source.reliability >= 0.42).map((source) => source.domain));
    const sourcePayload = sources.slice(0, 6).map((source) => ({
      url: source.url,
      title: source.title,
      domain: source.domain,
      score: source.reliability,
      retrievedAt: nowIso()
    }));
    let recommendation = assessment.recommendation;
    if (!oldFact) recommendation = 'archive';
    // 没有可用模型时的启发式综合只能作为线索，不能直接成为“客观事实”，更不能覆盖旧记忆。
    if (assessment.fallback) {
      const candidate = this.memory.saveKnowledge({
        title: query,
        content: assessment.answer,
        tags: assessment.tags,
        confidence: Math.min(Number(assessment.confidence || 0.4), 0.55),
        status: 'candidate',
        sources: sourcePayload,
        sourceKind: 'heuristic-research',
        researchCycleId: cycle.id
      });
      return {
        outcome: 'candidate',
        knowledgeId: candidate.id,
        message: `主模型未参与综合，本轮只按启发式存为候选（置信 ${Math.round(Number(assessment.confidence || 0) * 100)}%）；旧记忆未被覆盖。`
      };
    }
    if (recommendation === 'keep') {
      return {
        outcome: 'kept',
        knowledgeId: oldFact?.id || null,
        message: `保留旧结论（新证据置信度不足或未超过旧条目）。本次查证仍保留在轨迹中。`
      };
    }
    if (recommendation === 'conflict' || (assessment.confidence < Number(cfg.search.archiveConfidence || 0.58) && oldFact && assessment.conflicts.length)) {
      const newFact = this.memory.saveKnowledge({
        title: query,
        content: assessment.answer,
        tags: assessment.tags,
        confidence: assessment.confidence,
        status: 'conflict',
        sources: sourcePayload,
        sourceKind: 'research',
        conflictsWith: oldFact ? [oldFact.id] : [],
        validUntil: null,
        researchCycleId: cycle.id
      });
      if (oldFact) {
        this.memory.updateKnowledge(oldFact.id, {
          status: 'conflict',
          conflictsWith: [...new Set([...(oldFact.conflictsWith || []), newFact.id])],
          reason: 'new research conflicts'
        });
      }
      return {
        outcome: 'conflict',
        knowledgeId: newFact.id,
        message: '新旧结论存在冲突，两条都保留并标记待裁决；没有静默覆盖旧记忆。'
      };
    }
    if (assessment.confidence < Number(cfg.search.archiveConfidence || 0.58) || uniqueDomains.size < minSources) {
      const newFact = this.memory.saveKnowledge({
        title: query,
        content: assessment.answer,
        tags: assessment.tags,
        confidence: assessment.confidence,
        status: 'candidate',
        sources: sourcePayload,
        sourceKind: 'research',
        researchCycleId: cycle.id
      });
      return {
        outcome: 'candidate',
        knowledgeId: newFact.id,
        message: `证据尚不足（独立域名 ${uniqueDomains.size}/${minSources}，置信 ${Math.round(assessment.confidence * 100)}%），已存为候选而不是正式事实。`
      };
    }

    if (oldFact && recommendation === 'replace') {
      const updated = this.memory.updateKnowledge(oldFact.id, {
        title: query,
        content: assessment.answer,
        tags: [...new Set([...(oldFact.tags || []), ...(assessment.tags || [])])],
        confidence: Math.max(assessment.confidence, Number(oldFact.confidence || 0)),
        sources: sourcePayload,
        status: 'active',
        verifiedAt: nowIso(),
        validUntil: null,
        researchCycleId: cycle.id,
        reason: 'new research replaced older evidence'
      });
      return {
        outcome: 'replaced',
        knowledgeId: updated.id,
        message: `用更高置信度的新证据替换旧结论；旧版本已写入 revisions，可追溯。`
      };
    }
    if (oldFact && recommendation === 'merge') {
      const mergedContent = `${oldFact.content}\n\n【${new Date().toLocaleDateString('zh-CN')} 复核补充】\n${assessment.answer}`;
      const updated = this.memory.updateKnowledge(oldFact.id, {
        content: truncate(mergedContent, 9000),
        tags: [...new Set([...(oldFact.tags || []), ...(assessment.tags || [])])],
        confidence: Math.max(Number(oldFact.confidence || 0), assessment.confidence),
        sources: uniqueBy([...(oldFact.sources || []), ...sourcePayload], (source) => source.url),
        status: 'active',
        verifiedAt: nowIso(),
        researchCycleId: cycle.id,
        reason: 'new research merged into older entry'
      });
      return {
        outcome: 'merged',
        knowledgeId: updated.id,
        message: `新旧证据合并，保留旧内容并追加本次复核补充。`
      };
    }
    const existing = oldFact || this.memory.findRelatedKnowledge({ title: query, content: assessment.answer })[0];
    if (existing) {
      const updated = this.memory.updateKnowledge(existing.id, {
        content: assessment.answer,
        tags: [...new Set([...(existing.tags || []), ...(assessment.tags || [])])],
        confidence: Math.max(Number(existing.confidence || 0), assessment.confidence),
        sources: uniqueBy([...(existing.sources || []), ...sourcePayload], (source) => source.url),
        status: 'active',
        verifiedAt: nowIso(),
        researchCycleId: cycle.id,
        reason: 'high confidence revalidation'
      });
      return { outcome: 'updated', knowledgeId: updated.id, message: '已有相关条目，已用本次交叉验证结果更新并保留修订历史。' };
    }
    const newFact = this.memory.saveKnowledge({
      title: query,
      content: assessment.answer,
      tags: assessment.tags,
      confidence: assessment.confidence,
      status: 'active',
      sources: sourcePayload,
      sourceKind: 'research',
      researchCycleId: cycle.id,
      staleAfterDays: /(价格|政策|版本|最新|新闻)/.test(query) ? 30 : 120
    });
    return {
      outcome: 'archived',
      knowledgeId: newFact.id,
      message: `证据达到阈值，已归档为正式知识，并记下核验时间与 ${sourcePayload.length} 个来源。`
    };
  }

  addStep(cycle, key, title, message, data = {}) {
    cycle.steps.push({ key, title, message, at: nowIso(), data });
    this.cycles.update(cycle.id, cycle);
  }

  progress(cycle, stage, title, message, data = {}) {
    this.emit('learning:progress', {
      id: cycle.id,
      query: cycle.query,
      status: cycle.status,
      stage,
      title,
      message,
      data,
      steps: cycle.steps,
      sources: cycle.sources,
      assessment: cycle.assessment,
      outcome: cycle.outcome
    });
  }

  async revalidateKnowledge(knowledgeId) {
    const entry = this.memory.findKnowledgeById(knowledgeId);
    if (!entry) throw new Error('找不到要复核的知识条目');
    return this.run(entry.title, {
      trigger: 'challenge',
      oldKnowledgeId: knowledgeId,
      channel: 'memory'
    });
  }
}
