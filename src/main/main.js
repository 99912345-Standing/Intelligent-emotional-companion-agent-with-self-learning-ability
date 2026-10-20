import { createRequire } from 'node:module';

// Electron 的 CJS 入口在纯 ESM 下不暴露命名导出；用 createRequire 取真实模块。
const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell, screen } = require('electron');
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { initPaths, paths, seedWorkspace } from './paths.js';
import { Logger } from './logger.js';
import { ConfigManager } from './config.js';
import { MemoryEngine } from './memory.js';
import { WeightEngine } from './weights.js';
import { ModelClient } from './models.js';
import { UsageStore } from './usage.js';
import { WebSearch } from './websearch.js';
import { LearningEngine } from './learning.js';
import { ConversationStore } from './conversations.js';
import { QQBridge } from './qqbridge.js';
import { PhoneService } from './phone.js';
import { ComputerService } from './computer.js';
import { McpManager, builtinMcpSamples } from './mcp.js';
import { PluginHost } from './plugins.js';
import { PersonaEngine } from './persona.js';
import { PeopleEngine } from './people.js';
import { DiaryEngine } from './diary.js';
import { MusicService } from './music.js';
import { BrowserCrawler } from './browser.js';
import { isEmotionalTopic } from './content-policy.js';
import { JsonlStore } from './jsonl.js';
import { Agent } from './agent.js';
import { StickerLabeler } from './sticker-labeler.js';
import { id, nowIso, readJson, truncate } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

protocol.registerSchemesAsPrivileged([{
  scheme: 'banxing-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

// 在 ready 之前固定 userData/sessionData，保证 Chromium 缓存也落在工作目录。
initPaths(app);

let mainWindow = null;
let logger = null;
let config = null;
let memory = null;
let weights = null;
let model = null;
let usage = null;
let webSearch = null;
let learning = null;
let conversations = null;
let qq = null;
let phone = null;
let computer = null;
let mcp = null;
let plugins = null;
let persona = null;
let people = null;
let diary = null;
let music = null;
let browserCrawler = null;
let stickerLabeler = null;
let agent = null;
let servicesReady = false;
let initError = null;
let phoneStatusCache = null;
let schedulerTimer = null;
let idleDecayTimer = null;
let idleLearnTimer = null;
let idleLearningRunning = false;
let idleActivityRunning = false;
let autonomyRunning = false;
let autonomyStore = null;
let lastIdleLearnAt = 0;
let staleTimer = null;
let peopleTimer = null;
let quitting = false;
let readyPromise = null;

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.json': 'application/json'
};

function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function isInsideRoot(candidate) {
  const absolute = path.resolve(candidate);
  const root = path.resolve(paths.root) + path.sep;
  return absolute === path.resolve(paths.root) || absolute.startsWith(root);
}

function broadcast(type, payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:event', { type, payload, at: nowIso() });
    }
  } catch {}
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const work = display.workAreaSize;
  const bounds = display.bounds;
  // 高 DPI/虚拟化环境下 workAreaSize 可能和屏幕截图像素不同；显式左上角定位并留出余量，
  // 避免“居中被系统按另一套坐标计算”把右侧窗口按钮推出屏幕。
  const width = Math.max(1000, Math.min(1200, Math.floor(bounds.width * 0.78)));
  const height = Math.max(660, Math.min(720, Math.floor(bounds.height * 0.72)));
  logger?.info('ui', `窗口尺寸 ${width}×${height}（屏幕 ${bounds.width}×${bounds.height}，工作区 ${work.width}×${work.height}，DPI ${display.scaleFactor}）`);
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1000,
    minHeight: 640,
    x: 16,
    y: 16,
    show: false,
    backgroundColor: '#f6f1e8',
    title: '伴行 · 陪伴工作型 Agent',
    icon: path.join(paths.appRoot, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#171c26',
      symbolColor: '#f8f1e7',
      height: 46
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(paths.appRoot, 'src', 'main', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);
  const page = path.join(paths.appRoot, 'src', 'renderer', 'index.html');
  mainWindow.loadFile(page).catch((error) => logger?.error('ui', `页面加载失败：${error.message}`));
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`JSON.stringify({innerWidth,innerHeight,outerWidth,outerHeight,scrollWidth:document.documentElement.scrollWidth,mainWidth:document.getElementById('main')?.clientWidth,pageWidth:document.querySelector('.page')?.getBoundingClientRect().width,statWidth:document.querySelector('.stat-grid')?.getBoundingClientRect().width,dpr:devicePixelRatio})`).then((info) => logger?.info('ui', '布局测量', info)).catch(() => {});
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function registerMediaProtocol() {
  protocol.handle('banxing-media', async (request) => {
    try {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const target = path.resolve(paths.root, relative);
      if (!isInsideRoot(target)) return new Response('forbidden', { status: 403 });
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return new Response('not found', { status: 404 });
      const stat = fs.statSync(target);
      if (stat.size > 120 * 1024 * 1024) return new Response('too large', { status: 413 });
      const buffer = fs.readFileSync(target);
      return new Response(buffer, {
        status: 200,
        headers: { 'content-type': mimeOf(target), 'cache-control': 'no-cache' }
      });
    } catch {
      return new Response('bad request', { status: 400 });
    }
  });
}

function mediaUrl(relativeFile) {
  if (!relativeFile) return '';
  return `banxing-media://local/${String(relativeFile).split('/').map(encodeURIComponent).join('/')}`;
}

async function initializeServices() {
  seedWorkspace();
  if (!logger) logger = new Logger({ onEntry: (entry) => broadcast('log', entry) });
  const boot = logger.info('app', `正在启动 · ${new Date().toISOString()}`, {
    root: paths.root, packed: app.isPackaged, version: app.getVersion()
  });
  config = new ConfigManager(logger);
  // 兼容用户已经写入的配置：只迁移插件 ID，不动模型 Key、记忆或角色数据。
  const pluginConfig = config.get().plugins || {};
  const enabled = (pluginConfig.enabled || []).map((id) => id === 'harmes' ? 'hermes' : id);
  const disabled = (pluginConfig.disabled || []).map((id) => id === 'harmes' ? 'hermes' : id);
  if (JSON.stringify(enabled) !== JSON.stringify(pluginConfig.enabled || []) || JSON.stringify(disabled) !== JSON.stringify(pluginConfig.disabled || [])) {
    config.save({ plugins: { enabled, disabled } });
  }
  // 旧版本的角色自迭代门槛是 3 天/72 小时，导致已有大量稳定证据也无法更新。
  // 只迁移护栏参数，不改知识线/情感线/身份，也不重置 API。
  const personaCfg = config.get().persona || {};
  if ([3, 0].includes(Number(personaCfg.aiMinSpanDays)) && [24, 72].includes(Number(personaCfg.aiCooldownHours))) {
    config.save({ persona: { aiMinSpanDays: 0, aiCooldownHours: 0, aiEmotionalCooldownHours: 0, aiMaxRevisions7d: 3, autoEvolve: true, autoEvolveEvery: 24 } });
  }
  const humanize = config.get().qq?.humanize || {};
  if (Number(humanize.minDelayMs) === 900 && Number(humanize.maxDelayMs) === 4200 && Number(humanize.perCharMs) === 28) {
    config.save({ qq: { humanize: { minDelayMs: 1500, maxDelayMs: 4500, perCharMs: 32 } } });
  }
  memory = new MemoryEngine(config, logger, broadcast);
  weights = new WeightEngine(config, logger, broadcast);
  usage = new UsageStore({ config, logger, emit: broadcast });
  model = new ModelClient(config, logger, { onUsage: (event) => usage.record(event) });
  stickerLabeler = new StickerLabeler({ memory, model, logger, emit: broadcast });
  webSearch = new WebSearch(config, logger);
  browserCrawler = new BrowserCrawler({ config, logger });
  learning = new LearningEngine({ config, logger, memory, model, webSearch, browserCrawler, emit: broadcast });
  conversations = new ConversationStore();
  const mediaSink = (input) => memory.saveMedia(input);
  phone = new PhoneService(config, logger, broadcast, mediaSink);
  computer = new ComputerService(config, logger, broadcast, mediaSink);
  people = new PeopleEngine({ config, memory, logger, emit: broadcast });
  diary = new DiaryEngine({ config, logger, emit: broadcast });
  music = new MusicService({ config, logger, emit: broadcast });
  persona = new PersonaEngine({ config, memory, people, logger, emit: broadcast });
  plugins = new PluginHost({ config, logger, memory, weights, emit: broadcast });
  mcp = new McpManager({ config, logger, emit: broadcast });
  qq = new QQBridge({ config, logger, memory, webSearch, weights, people, emit: broadcast });
  qq.stickerLabeler = stickerLabeler;
  agent = new Agent({
    config, logger, memory, weights, model, webSearch, learning,
    conversations, qq, phone, computer, mcp, plugins, persona, people, diary, music, browserCrawler,
    autonomy: config.get().autonomy,
    emit: broadcast
  });
  fs.mkdirSync(path.join(paths.data, 'autonomy'), { recursive: true });
  autonomyStore = new JsonlStore(path.join(paths.data, 'autonomy', 'sessions.jsonl'), 'autonomy');
  qq.setAgent(agent);
  await plugins.loadAll();
  await agent.initialize();
  mcp.startAll().catch((error) => logger.warn('mcp', `MCP 批量启动失败：${error.message}`));
  startScheduler();
  phone.status().then((status) => {
    phoneStatusCache = status;
    broadcast('phone:status', status);
  }).catch(() => {});
  if (config.get().qq.enabled && config.get().qq.autoConnect) {
    qq.start().catch((error) => logger.warn('qq', `自动连接失败：${error.message}`));
  }
  servicesReady = true;
  logger.info('app', '服务初始化完成');
  broadcast('app:ready', { ok: true });
  // 旧表情在后台补标注；只处理未标注项，已标注的不会重复消耗视觉调用。
  setTimeout(() => {
    const cfg = config.get();
    const visionReady = (cfg.models.primary.capabilities?.vision === true)
      || (cfg.models.helper.enabled && cfg.models.helper.capabilities?.vision === true);
    if (!visionReady || !model.available('primary')) return;
    if (!memory.listUnlabeledStickers(1).length) return;
    stickerLabeler.labelAll().catch((error) => logger.warn('stickers', `后台表情标注失败：${error.message}`));
  }, 12000);
  return boot;
}

function scheduleIdleLearningTimer() {
  clearInterval(idleLearnTimer);
  const idleEvery = Math.max(1, Number(config.get().idleLearning?.checkIntervalMinutes || 5)) * 60000;
  idleLearnTimer = setInterval(() => {
    maybeIdleLearn().catch((error) => logger.warn('idle-learning', `闲时自学习检查失败：${error.message}`));
    maybeIdleAutonomy().catch((error) => logger.warn('autonomy', `闲时自主活动检查失败：${error.message}`));
  }, idleEvery);
}

function startScheduler() {
  clearInterval(schedulerTimer);
  clearInterval(staleTimer);
  schedulerTimer = setInterval(async () => {
    if (!servicesReady) return;
    try {
      const active = memory.listActiveWork();
      for (const task of active) {
        const archived = await memory.archiveWork(task.channel, { reason: 'idle', force: false });
        if (archived && !archived.skipped) {
          weights.addAnchor({
            channel: task.channel,
            excerpt: `${task.title} ${task.objective || ''} ${(task.notes || []).slice(-3).join(' ')}`,
            worklogId: archived.id,
            weights: {
              work: Math.max(Number(task.workWeightAtStart || 0), weights.state.work),
              companion: weights.state.companion,
              learning: weights.state.learning
            }
          });
          broadcast('chat:system', {
            channel: task.channel,
            content: `工作「${task.title}」超过空闲阈值，已自动整理为工作日志。`,
            kind: 'worklog'
          });
        }
      }
      qq.tuneActivities();
      if (qq.status.connected && qq.effectivePrivateActivity() > 0) {
        const proactive = await qq.maybeProactive();
        if (proactive?.ok) logger.info('qq', `主动话题已发送：${proactive.channel}`);
      }
    } catch (error) {
      logger.warn('scheduler', `工作日志检查失败：${error.message}`);
    }
  }, 60000);
  clearInterval(idleDecayTimer);
  idleDecayTimer = setInterval(async () => {
    if (!servicesReady || !agent) return;
    try {
      await agent.handleIdleDecay();
    } catch (error) {
      logger.warn('scheduler', `空档衰减检查失败：${error.message}`);
    }
  }, 30000);
  setTimeout(async () => {
    try {
      await memory.markStaleEntries();
      const curation = memory.curateKnowledge();
      logger.info('memory', '知识库整理完成', curation);
    } catch (error) { logger.warn('memory', `知识库整理失败：${error.message}`); }
  }, 8000);
  scheduleIdleLearningTimer();
  setTimeout(() => {
    maybeIdleLearn().catch(() => {});
    maybeIdleAutonomy().catch(() => {});
  }, 5000);
  staleTimer = setInterval(async () => {
    try {
      await memory.markStaleEntries();
      memory.curateKnowledge();
    } catch {}
  }, 6 * 3600 * 1000);
  clearInterval(peopleTimer);
  peopleTimer = setInterval(async () => {
    if (!servicesReady || !people) return;
    try {
      const updated = await people.refreshImpressions({ model, limit: 6 });
      if (updated.length) logger.info('people', `已刷新 ${updated.length} 条人物印象`);
    } catch (error) {
      logger.warn('people', `人物印象刷新失败：${error.message}`);
    }
  }, 5 * 60 * 1000);
}

function idleLearningOverview() {
  const cfg = config.get().idleLearning || {};
  const cycles = learning.listCycles(200)
    .filter((cycle) => cycle.trigger === 'idle')
    .map((cycle) => ({ ...cycle, classify: cycle.classify || 'legacy' }));
  const ids = new Set(cycles.map((cycle) => cycle.id));
  const knowledgeIds = new Set(cycles.map((cycle) => cycle.knowledgeId).filter(Boolean));
  const knowledge = memory.knowledge.all()
    .filter((entry) => knowledgeIds.has(entry.id) || ids.has(entry.researchCycleId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const emotional = [
    ...(persona?.listEmotionalMemory?.(30) || []).map((entry) => ({ ...entry, title: '情感记忆', memoryClass: 'emotional' })),
    ...memory.relationship.all()
      .filter((entry) => entry.source === 'idle-learning' && isEmotionalTopic(`${entry.title || ''} ${entry.content || ''}`))
      .map((entry) => ({ ...entry, title: entry.title || '历史情感材料' }))
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const lastActivity = Math.max(Number(qq?.lastWhitelistActivityAt || 0), Number(qq?.lastOwnerActivityAt || 0));
  const idleMinutes = lastActivity ? Math.max(0, Math.round((Date.now() - lastActivity) / 60000)) : 0;
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = cycles.filter((cycle) => String(cycle.startedAt || '').slice(0, 10) === today).length;
  return {
    enabled: cfg.enabled !== false,
    minIdleMinutes: Number(cfg.minIdleMinutes || 60),
    idleMinutes,
    lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    running: idleLearningRunning,
    checkIntervalMinutes: Number(cfg.checkIntervalMinutes || 5),
    cooldownMinutes: Number(cfg.cooldownMinutes || 180),
    quietStart: Number(cfg.quietStart ?? 0),
    quietEnd: Number(cfg.quietEnd ?? 7),
    usedToday,
    maxPerDay: Number(cfg.maxPerDay || 4),
    lastLearnedAt: cycles[0]?.startedAt || null,
    cycles,
    knowledge,
    emotional
  };
}

async function maybeIdleLearn({ force = false } = {}) {
  const cfg = config.get().idleLearning || {};
  if (!servicesReady || !agent || !learning || !webSearch) return { skipped: 'not-ready' };
  if (!force && cfg.enabled === false) return { skipped: 'disabled' };
  if (config.get().permissions.webSearch === false) return { skipped: 'no-search-permission' };
  if (idleLearningRunning || idleActivityRunning) return { skipped: 'running' };
  const lastActivity = Math.max(Number(qq?.lastWhitelistActivityAt || 0), Number(qq?.lastOwnerActivityAt || 0));
  const idleMinutes = lastActivity ? (Date.now() - lastActivity) / 60000 : 0;
  if (!force && idleMinutes < Number(cfg.minIdleMinutes || 60)) return { skipped: 'not-idle', idleMinutes: Math.round(idleMinutes) };
  const hour = new Date().getHours();
  const quietStart = Number(cfg.quietStart ?? 0);
  const quietEnd = Number(cfg.quietEnd ?? 7);
  const quiet = quietStart > quietEnd ? (hour >= quietStart || hour < quietEnd) : (hour >= quietStart && hour < quietEnd);
  if (!force && quiet) return { skipped: 'quiet-hours' };
  const cycles = learning.listCycles(200).filter((cycle) => cycle.trigger === 'idle');
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = cycles.filter((cycle) => String(cycle.startedAt || '').slice(0, 10) === today).length;
  if (!force && usedToday >= Number(cfg.maxPerDay || 4)) return { skipped: 'daily-limit', usedToday };
  const cooldownMs = Number(cfg.cooldownMinutes || 180) * 60000;
  if (!force && cycles[0] && Date.now() - Date.parse(cycles[0].startedAt) < cooldownMs) return { skipped: 'cooldown' };
  idleLearningRunning = true;
  idleActivityRunning = true;
  lastIdleLearnAt = Date.now();
  let cycle = null;
  try {
    const query = await agent.suggestIdleQuery();
    const queryReview = agent.idleQueryReview || {};
    const classify = isEmotionalTopic(query) ? 'emotional' : 'knowledge';
    broadcast('idle:learning:start', { query, classify, review: queryReview, at: nowIso() });
    // 情感主题只写关系记忆，知识主题才写知识库；避免同一条内容双写。
    cycle = await learning.run(query, { trigger: 'idle', channel: 'idle', archive: classify === 'knowledge' });
    cycle.classify = classify;
    cycle.queryReview = queryReview;
    learning.cycles.update(cycle.id, { classify, queryReview });
    const emotional = classify === 'emotional' ? await agent.recordIdleLearning(cycle) : null;
    broadcast('idle:learning:completed', { cycle, emotional, classify, overview: idleLearningOverview() });
    logger.info('idle-learning', `闲时自学习完成：${query}（${cycle.outcome}）`);
    return { ok: true, cycle, emotional, classify };
  } catch (error) {
    logger.warn('idle-learning', `闲时自学习失败：${error.message}`);
    broadcast('idle:learning:failed', { error: error.message, at: nowIso() });
    return { skipped: 'error', error: error.message };
  } finally {
    idleLearningRunning = false;
    idleActivityRunning = false;
  }
}

function autonomyOverview() {
  const cfg = config.get().autonomy || {};
  const sessions = autonomyStore ? autonomyStore.all().slice(-30).reverse() : [];
  return {
    enabled: cfg.enabled !== false,
    usePhone: cfg.usePhone !== false,
    useComputer: Boolean(cfg.useComputer),
    allowAppDownload: Boolean(cfg.allowAppDownload),
    minIdleMinutes: Number(cfg.minIdleMinutes || 60),
    checkIntervalMinutes: Number(cfg.checkIntervalMinutes || 5),
    cooldownMinutes: Number(cfg.cooldownMinutes || 180),
    maxMinutes: Number(cfg.maxMinutes || 10),
    maxSteps: Number(cfg.maxSteps || 8),
    running: autonomyRunning,
    sessions
  };
}

async function maybeIdleAutonomy({ force = false } = {}) {
  const cfg = config.get().autonomy || {};
  if (!servicesReady || !agent || cfg.enabled === false) return { skipped: 'disabled' };
  if (idleActivityRunning) return { skipped: 'running' };
  // 自主活动只看主人/桌面活动；群里别人聊天不应让她一直“没空自己玩”。
  const lastActivity = Number(qq?.lastOwnerActivityAt || 0);
  const idleMinutes = lastActivity ? (Date.now() - lastActivity) / 60000 : 0;
  if (!force && idleMinutes < Number(cfg.minIdleMinutes || 60)) return { skipped: 'not-idle', idleMinutes: Math.round(idleMinutes) };
  const sessions = autonomyStore ? autonomyStore.all() : [];
  const latest = sessions[sessions.length - 1];
  if (!force && latest && Date.now() - Date.parse(latest.startedAt || 0) < Number(cfg.cooldownMinutes || 180) * 60000) {
    return { skipped: 'cooldown' };
  }
  let device = '';
  if (cfg.usePhone !== false) {
    try {
      const status = await phone.status();
      if (status.ok) device = 'phone';
    } catch {}
  }
  if (!device && cfg.useComputer) {
    if (config.get().computer?.enabled && config.get().permissions?.computerControl) device = 'computer';
  }
  if (!device) return { skipped: 'no-device' };
  idleActivityRunning = true;
  autonomyRunning = true;
  const session = {
    id: id('auto'),
    startedAt: nowIso(),
    device,
    status: 'running',
    finalText: '',
    trace: []
  };
  autonomyStore?.append(session);
  broadcast('autonomy:started', { session, overview: autonomyOverview() });
  try {
    const result = await agent.autonomousPlay({
      device,
      maxSteps: Number(cfg.maxSteps || 8),
      maxMinutes: Number(cfg.maxMinutes || 10),
      allowAppDownload: Boolean(cfg.allowAppDownload)
    });
    const done = {
      ...session,
      status: result.ok ? 'completed' : 'skipped',
      completedAt: nowIso(),
      finalText: truncate(String(result.finalText || ''), 1200),
      trace: (result.trace || []).map((item) => ({ name: item.name, at: item.at })).slice(0, 40),
      skipped: result.skipped || null
    };
    autonomyStore?.update(session.id, done);
    broadcast('autonomy:completed', { session: done, overview: autonomyOverview() });
    logger.info('autonomy', `闲时自主活动${done.status === 'completed' ? '完成' : '跳过'}：${device}`);
    return { ok: true, session: done };
  } catch (error) {
    const failed = { ...session, status: 'failed', completedAt: nowIso(), error: error.message };
    autonomyStore?.update(session.id, failed);
    broadcast('autonomy:completed', { session: failed, overview: autonomyOverview() });
    logger.warn('autonomy', `闲时自主活动失败：${error.message}`);
    return { skipped: 'error', error: error.message };
  } finally {
    idleActivityRunning = false;
    autonomyRunning = false;
  }
}

async function buildBootstrap() {
  if (!readyPromise) throw new Error('应用仍在启动，请稍候…');
  await readyPromise;
  if (initError) throw new Error(initError);
  const cfg = config.publicConfig();
  const desktopMessages = conversations.loadMessages('desktop', 80);
  return {
    ready: servicesReady,
    app: {
      name: '伴行',
      version: app.getVersion(),
      workspace: paths.root,
      data: paths.data,
      logs: paths.logs,
      plugins: paths.plugins,
      vendor: paths.vendor,
      snowluma: paths.snowluma,
      packaged: app.isPackaged,
      platform: process.platform,
      electron: process.versions.electron,
      node: process.versions.node,
      startedAt: nowIso()
    },
    config: cfg,
    stats: memory.stats(),
    weights: weights.getState(),
    memory: {
      stats: memory.stats(),
      activeWork: memory.listActiveWork()
    },
    qq: qq.publicStatus(),
    phone: phoneStatusCache,
    mcp: mcp.publicStatus(),
    plugins: plugins.status(),
    persona: {
      profile: persona.publicProfile(),
      history: persona.history(12),
      emotionalMemory: persona.listEmotionalMemory(20)
    },
    people: people.list(),
    peopleStats: people.stats(),
    diary: diary.list(40),
    diaryStats: diary.stats(),
    music: music.status(),
    browser: { available: Boolean(browserCrawler.findBrowser()), path: browserCrawler.findBrowser() },
    usage: usage.summary(),
    conversations: {
      channels: conversations.listChannels(),
      desktop: desktopMessages
    },
    learning: {
      cycles: learning.listCycles(8),
      reflections: memory.listReflections(5)
    },
    idleLearning: idleLearningOverview(),
    autonomy: autonomyOverview(),
    logs: logger.recent(60),
    paths: {
      workspace: paths.root,
      data: paths.data,
      checkScript: paths.checkScript
    }
  };
}

function registerApi() {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return { ok: true, data: await fn(payload || {}, event) };
      } catch (error) {
        logger?.error('ipc', `${channel} 失败：${error.message}`);
        return { ok: false, error: error.message || String(error), code: error.code || '' };
      }
    });
  };

  handle('app:bootstrap', () => buildBootstrap());
  handle('app:info', () => ({
    ready: servicesReady,
    initError,
    version: app.getVersion(),
    workspace: paths.root
  }));
  handle('app:quit', () => { app.quit(); return true; });
  handle('app:openWorkspace', async () => shell.openPath(paths.root));

  handle('chat:get', ({ channel = 'desktop', limit = 100 } = {}) => ({
    channel,
    messages: conversations.loadMessages(channel, Math.min(400, Number(limit) || 100)),
    channels: conversations.listChannels()
  }));
  handle('chat:send', async ({ text = '', channel = 'desktop', attachments = [] } = {}) => {
    await readyPromise;
    if (initError) throw new Error(initError);
    qq?.noteOwnerActivity();
    const qqCfg = config.get().qq;
    const ownerQQ = String(qqCfg.ownerQQ || '').trim();
    if (people && channel === 'desktop') {
      const existingPerson = ownerQQ ? people.get(`qq:${ownerQQ}`) : people.get('owner');
      people.observe({
        qq: ownerQQ,
        nickname: existingPerson?.nickname || config.get().persona.userTitle || '你',
        text,
        channel,
        source: 'desktop',
        allowed: true
      });
    }
    const saved = [];
    for (const item of (attachments || []).slice(0, 6)) {
      const file = String(item.path || '');
      if (!file || !fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      if (stat.size > 40 * 1024 * 1024) throw new Error('附件超过 40MB');
      const kind = String(item.mime || mimeOf(file)).startsWith('image/') ? 'image' : String(item.mime || '').startsWith('audio/') ? 'audio' : 'file';
      const record = await memory.saveMedia({
        filePath: file,
        fileName: item.name || path.basename(file),
        mime: item.mime || mimeOf(file),
        kind,
        source: 'user',
        channel,
        caption: item.caption || '',
        tags: ['用户附件']
      });
      saved.push({ ...item, kind, path: record.file, mime: record.mime, mediaId: record.id, caption: record.caption });
    }
    const result = await agent.handleMessage({
      channel,
      text,
      attachments: saved,
      meta: { source: 'desktop', title: '与伴行的对话' }
    });
    // QQ 主对话：应用内发出的消息，最终回答同步到主人 QQ 私聊。
    // 用户自己的话不伪装成机器人发送；QQ 侧的用户消息应直接在 QQ 里输入。

    if (channel === 'desktop' && qqCfg.primaryConversation && qqCfg.ownerQQ && qq.status.connected && result?.assistantMessage?.content && !result.setupNeeded) {
      try {
        await qq.sendManual({ kind: 'private', targetId: qqCfg.ownerQQ, text: result.assistantMessage.content });
        result.qqMirror = { ok: true, target: qqCfg.ownerQQ };
      } catch (error) {
        result.qqMirror = { ok: false, error: error.message, target: qqCfg.ownerQQ };
        logger.warn('qq', `QQ 主对话回写失败：${error.message}`);
      }
    } else if (channel === 'desktop' && qqCfg.primaryConversation && !qq.status.connected) {
      result.qqMirror = { ok: false, error: 'QQ 未连接，本条只在本地保存', target: qqCfg.ownerQQ || '' };
    }
    return result;
  });
  handle('chat:clear', ({ channel = 'desktop' } = {}) => {
    conversations.clear(channel);
    return { ok: true };
  });
  handle('dialog:pickFiles', async ({ kind = 'image' } = {}) => {
    const filters = kind === 'image'
      ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
      : [{ name: '所有文件', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要交给伴行的文件',
      properties: ['openFile', 'multiSelections'],
      filters
    });
    if (result.canceled) return [];
    return result.filePaths.slice(0, 6).map((file) => {
      const mime = mimeOf(file);
      let dataUrl = '';
      try {
        if (mime.startsWith('image/') && fs.statSync(file).size <= 8 * 1024 * 1024) {
          dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
        }
      } catch {}
      return { path: file, name: path.basename(file), size: fs.statSync(file).size, mime, dataUrl };
    });
  });

  handle('memory:dedupeMedia', () => ({ marked: memory.dedupeMultimodal(), stats: memory.stats() }));
  handle('memory:curate', () => memory.curateKnowledge());
  handle('stickers:overview', () => stickerLabeler?.overview() || { unlabeled: 0 });
  handle('stickers:labelAll', () => stickerLabeler.labelAll());
  handle('memory:overview', () => {
    const items = {
      knowledge: memory.knowledge.all().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 500),
      relationship: memory.relationship.all().filter((item) => !item.duplicate && !item.archived).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 500),
      worklogs: memory.listWorklogs(200),
      weights: weights.recent(200),
      multimodal: memory.listMultimodal(200).map((item) => ({ ...item, url: mediaUrl(item.relativeFile) })),
      reflections: memory.listReflections(60),
      activeWork: memory.listActiveWork()
    };
    for (const entry of items.knowledge) entry.stale = memory.isStale(entry);
    return { ...items, stats: memory.stats(), stickerLabels: stickerLabeler?.overview() || null };
  });
  handle('memory:search', ({ query = '' } = {}) => {
    const built = memory.buildContext(query);
    return {
      text: built.text,
      knowledge: built.hits.knowledge,
      relationship: built.hits.relationship,
      worklogs: built.hits.worklogs,
      multimodal: built.hits.multimodal,
      unknown: built.unknown
    };
  });
  handle('memory:addKnowledge', ({ title, content, tags = [], sourceUrls = [], confidence = 0.8 } = {}) => {
    if (!String(content || '').trim()) throw new Error('知识内容不能为空');
    const sources = String(sourceUrls || '').split(/\s+/).filter(Boolean).map((url) => ({
      url, title: url, score: 0.7
    }));
    return memory.saveKnowledge({
      title: title || String(content).slice(0, 60),
      content,
      tags: Array.isArray(tags) ? tags : String(tags || '').split(/[,，\s]+/).filter(Boolean),
      sources,
      confidence: Math.min(0.98, Math.max(0.1, Number(confidence) || 0.8)),
      status: sources.length ? 'active' : 'candidate',
      sourceKind: 'manual'
    });
  });
  handle('memory:updateKnowledge', ({ id: knowledgeId, patch = {} } = {}) => {
    const allowed = {};
    for (const key of ['title', 'content', 'tags', 'confidence', 'status', 'validUntil']) {
      if (patch[key] !== undefined) allowed[key] = patch[key];
    }
    return memory.updateKnowledge(knowledgeId, { ...allowed, reason: 'manual-edit' });
  });
  handle('memory:archiveKnowledge', ({ id: knowledgeId } = {}) => memory.archiveKnowledge(knowledgeId, 'manual'));
  handle('memory:updateRelationship', ({ id: relationId, patch = {} } = {}) => memory.updateRelationship(relationId, patch));
  handle('memory:deleteRelationship', ({ id: relationId } = {}) => ({ deleted: memory.removeRelationship(relationId) }));
  handle('memory:updateWorklog', ({ id: worklogId, patch = {} } = {}) => memory.updateWorklog(worklogId, patch));
  handle('memory:updateActiveWork', ({ channel, patch = {} } = {}) => memory.updateActiveWork(channel, patch));
  handle('memory:updateMedia', ({ id: mediaId, caption = '', tags = [] } = {}) => memory.setMediaCaption(mediaId, caption, { tags }));
  handle('memory:addRelationship', ({ kind = 'preference', content, confidence = 0.8 } = {}) => {
    if (!String(content || '').trim()) throw new Error('内容不能为空');
    const ownerQQ = String(config.get().qq.ownerQQ || '').trim();
    const owner = ownerQQ ? people.get(`qq:${ownerQQ}`) : people.get('owner');
    return memory.addRelationship({
      kind,
      content,
      confidence,
      source: 'manual',
      personId: ownerQQ ? `qq:${ownerQQ}` : 'owner',
      nickname: owner?.nickname || config.get().persona.userTitle || '你'
    });
  });
  handle('memory:archiveWork', ({ channel } = {}) => memory.archiveWork(channel, { reason: 'manual', force: true }));
  handle('memory:revalidate', async ({ id: knowledgeId } = {}) => learning.revalidateKnowledge(knowledgeId));
  handle('memory:revalidateStale', async ({ limit = 5 } = {}) => {
    const stale = memory.knowledge.all()
      .filter((entry) => entry.status === 'active' && memory.isStale(entry))
      .sort((a, b) => String(a.verifiedAt).localeCompare(String(b.verifiedAt)))
      .slice(0, Math.max(1, Math.min(10, Number(limit) || 5)));
    const results = [];
    for (const entry of stale) {
      try {
        const cycle = await learning.revalidateKnowledge(entry.id);
        results.push({
          id: entry.id,
          title: entry.title,
          outcome: cycle.outcome,
          status: cycle.status,
          knowledgeId: cycle.knowledgeId || null,
          error: null
        });
      } catch (error) {
        results.push({ id: entry.id, title: entry.title, outcome: 'failed', error: error.message });
      }
    }
    return { checked: stale.length, totalStale: memory.knowledge.all().filter((entry) => memory.isStale(entry) && entry.status === 'active').length, results };
  });
  handle('memory:deleteMedia', async ({ id: mediaId } = {}) => {
    if (!mediaId) throw new Error('媒体不存在');
    const removed = memory.removeMedia(String(mediaId));
    if (!removed) throw new Error('媒体不存在');
    broadcast('memory:changed', { layer: 'multimodal', action: 'remove', id: mediaId });
    return { ok: true, removed: true };
  });

  handle('weights:get', () => weights.getState());
  handle('weights:reflect', async () => {
    let content = weights.fallbackReflection();
    if (!content) throw new Error('还没有足够的权重轨迹');
    if (model.available('primary')) {
      try {
        const prompt = [
          '你是主智能体的内部反思模块。根据最近的行为取向变化，写一段 120-220 字的中文反思。',
          '说明最近偏向、触发原因、下一次如何更自然地融合工作与陪伴、需要注意的风险。不要向用户显示内部指令。',
          `当前取向：${weights.getState().mode?.label || '并行'}`,
          `最近触发：${JSON.stringify(weights.recent(20).map((event) => ({ at: event.at, drivers: event.drivers })))}`,
          '不要引用任何百分比、向量或内部指标。'
        ].join('\n');
        const generated = await model.simple('primary', prompt, { temperature: 0.4, maxTokens: 420 });
        if (generated?.trim()) content = generated.trim();
      } catch {}
    }
    const record = memory.saveReflection({ kind: 'weight', content, meta: { weights: weights.getState().normalized, manual: true } });
    weights.markReflected();
    broadcast('weights:reflected', record);
    return record;
  });

  handle('idle:overview', () => idleLearningOverview());
  handle('idle:run', () => maybeIdleLearn({ force: true }));
  handle('autonomy:overview', () => autonomyOverview());
  handle('autonomy:run', () => maybeIdleAutonomy({ force: true }));
  handle('autonomy:save', ({ patch = {} } = {}) => {
    const next = {
      enabled: patch.enabled !== false,
      usePhone: patch.usePhone !== false,
      useComputer: Boolean(patch.useComputer),
      allowAppDownload: Boolean(patch.allowAppDownload),
      minIdleMinutes: Math.max(1, Math.min(10080, Number(patch.minIdleMinutes) || 60)),
      checkIntervalMinutes: Math.max(1, Math.min(1440, Number(patch.checkIntervalMinutes) || 5)),
      cooldownMinutes: Math.max(1, Math.min(10080, Number(patch.cooldownMinutes) || 180)),
      maxMinutes: Math.max(1, Math.min(120, Number(patch.maxMinutes) || 10)),
      maxSteps: Math.max(1, Math.min(30, Number(patch.maxSteps) || 8))
    };
    config.save({ autonomy: next });
    scheduleIdleLearningTimer();
    broadcast('config:changed', config.publicConfig());
    return autonomyOverview();
  });
  handle('idle:save', ({ patch = {} } = {}) => {
    const next = {
      enabled: patch.enabled !== false,
      minIdleMinutes: Math.max(1, Math.min(10080, Number(patch.minIdleMinutes) || 60)),
      checkIntervalMinutes: Math.max(1, Math.min(1440, Number(patch.checkIntervalMinutes) || 5)),
      cooldownMinutes: Math.max(1, Math.min(10080, Number(patch.cooldownMinutes) || 180)),
      maxPerDay: Math.max(1, Math.min(48, Number(patch.maxPerDay) || 4)),
      quietStart: Math.max(0, Math.min(23, Number(patch.quietStart) || 0)),
      quietEnd: Math.max(0, Math.min(24, Number(patch.quietEnd) || 7))
    };
    config.save({ idleLearning: next });
    scheduleIdleLearningTimer();
    broadcast('config:changed', config.publicConfig());
    return idleLearningOverview();
  });
  handle('learning:list', () => learning.listCycles(100));
  handle('learning:get', ({ id: cycleId } = {}) => learning.getCycle(cycleId));
  handle('learning:run', async ({ query, archive = true } = {}) => {
    if (!String(query || '').trim()) throw new Error('请输入需要查证的问题');
    return learning.run(query, { trigger: 'manual', channel: 'desktop', archive });
  });
  handle('learning:revalidate', ({ id: knowledgeId } = {}) => learning.revalidateKnowledge(knowledgeId));

  handle('diary:list', ({ limit = 60 } = {}) => diary.list(limit));
  handle('diary:add', ({ title, content, mood, tags, source = 'user' } = {}) => diary.write({ title, content, mood, tags, source, channel: 'desktop' }));
  handle('diary:update', ({ id: entryId, patch = {} } = {}) => diary.update(entryId, patch));
  handle('diary:delete', ({ id: entryId } = {}) => ({ deleted: diary.remove(entryId) }));
  handle('browser:status', () => ({ available: Boolean(browserCrawler.findBrowser()), path: browserCrawler.findBrowser(), enabled: config.get().search?.browserCrawler !== false }));
  handle('browser:crawl', async ({ url } = {}) => {
    if (config.get().search?.browserCrawler === false) throw new Error('浏览器爬虫已在设置中关闭');
    if (!agent) throw new Error('Agent 未就绪');
    return browserCrawler.crawl(url, { timeoutMs: 40000 });
  });
  handle('music:voiceSave', ({ patch = {} } = {}) => {
    config.save({ music: { voice: {
      engine: patch.engine === 'rvc' ? 'rvc' : 'sapi',
      rvcEnabled: Boolean(patch.rvcEnabled),
      pythonPath: String(patch.pythonPath || '').trim(),
      repoPath: String(patch.repoPath || '').trim(),
      modelPath: String(patch.modelPath || '').trim(),
      indexPath: String(patch.indexPath || '').trim(),
      pitch: Number(patch.pitch) || 0
    } } });
    return config.publicConfig();
  });
  handle('music:importVoice', async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '导入训练好的 RVC 音色模型（.pth）',
      properties: ['openFile'],
      filters: [{ name: 'RVC 模型', extensions: ['pth'] }]
    });
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
    const modelPath = picked.filePaths[0];
    const dir = path.dirname(modelPath);
    const stem = path.basename(modelPath, path.extname(modelPath));
    let indexPath = '';
    try {
      const index = fs.readdirSync(dir).find((name) => /\.index$/i.test(name) && (name.includes(stem) || !indexPath));
      if (index) indexPath = path.join(dir, index);
    } catch {}
    const voice = {
      ...(config.get().music?.voice || {}),
      rvcEnabled: true,
      modelPath,
      indexPath
    };
    config.save({ music: { voice } });
    broadcast('config:changed', config.publicConfig());
    return { ok: true, modelPath, indexPath, config: config.publicConfig() };
  });
  handle('music:openRvc', async () => {
    await shell.openExternal('https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI');
    return true;
  });
  handle('music:pathSave', ({ path: musicPath = '' } = {}) => {
    config.save({ music: { cloudMusicPath: String(musicPath || '').trim() } });
    return config.publicConfig();
  });
  handle('music:detect', () => music.detect());
  handle('music:connect', async () => {
    const detected = await music.detect();
    if (detected.ok) return detected;
    if (!detected.executable) return detected;
    if (detected.needsRestart) return music.restartWithDebug();
    return music.launchWithDebug();
  });
  handle('music:launch', () => music.launchWithDebug());
  handle('music:search', ({ query, limit } = {}) => music.search(query, limit));
  handle('music:lyrics', ({ song, artist, songId, maxLines } = {}) => music.lyrics({ song, artist, songId, maxLines }));
  handle('music:now', () => music.nowPlaying());
  handle('music:play', ({ song, artist, songId } = {}) => music.play({ song, artist, songId }));
  handle('music:control', ({ command } = {}) => music.control(command));
  handle('music:room', () => music.room());
  handle('music:sing', ({ text, song, artist, maxLines } = {}) => music.sing({ text, song, artist, maxLines }));

  handle('diary:generate', async () => {
    if (!agent) throw new Error('Agent 未就绪');
    return agent.generateDiary();
  });

  handle('usage:summary', () => usage.summary());
  handle('usage:clear', () => { usage.clear(); return usage.summary(); });
  handle('people:list', () => ({ people: people.list(), stats: people.stats() }));
  handle('people:update', ({ id, patch = {} } = {}) => people.update(id, patch));
  handle('people:delete', ({ id } = {}) => ({ deleted: people.remove(id) }));
  handle('people:refresh', async () => {
    const updated = await people.refreshImpressions({ model, force: true, limit: 12 });
    return { updated, people: people.list(), stats: people.stats() };
  });

  handle('persona:get', () => ({
    profile: persona.publicProfile(),
    history: persona.history(20),
    emotionalMemory: persona.listEmotionalMemory(30)
  }));
  handle('persona:update', ({ knowledgeLine, emotionLine, reason } = {}) => persona.update({
    knowledgeLine, emotionLine, reason, by: 'user'
  }));
  handle('persona:setLocked', ({ locked } = {}) => persona.setLocked(locked));
  handle('persona:rollback', () => persona.rollback());
  handle('persona:calibrate', async () => {
    if (!model.available('primary')) throw new Error('主模型未接入，无法校准角色线');
    return persona.calibrate({ model, knowledgeOnly: true });
  });

  handle('multimodal:save', ({ slots } = {}) => {
    if (!Array.isArray(slots)) throw new Error('缺少多模态插槽配置');
    const allowed = new Set(['primary', 'helper', 'custom', 'off']);
    const previous = new Map((config.get().multimodal?.slots || []).map((slot) => [slot.id, slot]));
    const clean = slots.slice(0, 5).map((slot) => {
      const id = String(slot.id || '').slice(0, 40);
      const old = previous.get(id) || {};
      const apiKey = String(slot.apiKey || '').trim();
      return {
        id,
        label: String(slot.label || old.label || '').slice(0, 80),
        role: allowed.has(slot.role) ? slot.role : (old.role || 'helper'),
        description: String(slot.description || old.description || '').slice(0, 200),
        protocol: slot.protocol === 'anthropic' ? 'anthropic' : (slot.protocol || old.protocol || 'openai'),
        baseUrl: slot.baseUrl !== undefined ? String(slot.baseUrl || '').slice(0, 500) : (old.baseUrl || ''),
        model: slot.model !== undefined ? String(slot.model || '').slice(0, 200) : (old.model || ''),
        ...(apiKey && !apiKey.includes('••••') ? { apiKey } : {})
      };
    }).filter((slot) => slot.id);
    config.save({ multimodal: { slots: clean } });
    const publicConfig = config.publicConfig();
    broadcast('config:changed', publicConfig);
    return publicConfig.multimodal;
  });

  handle('models:save', ({ primary, helper } = {}) => {
    const patch = { models: {} };
    if (primary) patch.models.primary = primary;
    if (helper) patch.models.helper = helper;
    const saved = config.save(patch);
    broadcast('config:changed', config.publicConfig());
    return config.publicConfig();
  });
  handle('models:discover', async ({ role = 'primary', baseUrl, apiKey = '', protocol = 'openai' } = {}) => {
    const existing = config.get().models[role] || {};
    let effectiveKey = String(apiKey || '').trim();
    if (!effectiveKey || effectiveKey.includes('••••') || effectiveKey === '已保存') {
      effectiveKey = existing.apiKey || '';
    }
    const actualBase = String(baseUrl || existing.baseUrl || '').trim();
    if (!actualBase) throw new Error('请先填写 API URL');
    const result = await model.discoverModels({
      baseUrl: actualBase,
      apiKey: effectiveKey,
      protocol: protocol || existing.protocol || 'openai'
    });
    return { ...result, role, hasApiKey: Boolean(effectiveKey) };
  });

  handle('models:test', async ({ role = 'primary', multimodal = true } = {}) => {
    const capabilities = await model.test(role, { multimodal });
    broadcast('config:changed', config.publicConfig());
    return { capabilities, config: config.publicConfig() };
  });
  handle('models:discoverLocal', async () => {
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return { ok: false, models: [], error: `Ollama HTTP ${res.status}` };
      const json = await res.json();
      return {
        ok: true,
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: (json.models || []).map((item) => item.name)
      };
    } catch (error) {
      return { ok: false, models: [], error: `未发现本机 Ollama：${error.message}` };
    }
  });

  handle('qq:save', ({ qq: qqPatch, permissions: permissionPatch = null } = {}) => {
    if (!qqPatch) throw new Error('缺少 QQ 配置');
    const sanitized = { ...qqPatch };
    for (const key of ['accessToken', 'wsToken', 'httpToken']) {
      if (sanitized[key] && (String(sanitized[key]).includes('••••') || sanitized[key] === '已保存')) delete sanitized[key];
    }
    for (const key of ['hasAccessToken', 'hasWsToken', 'hasHttpToken']) delete sanitized[key];
    if (sanitized.onebotMode !== undefined) sanitized.onebotMode = sanitized.onebotMode === 'manual' ? 'manual' : 'auto';
    if (sanitized.primaryConversation && !sanitized.ownerQQ) {
      throw new Error('开启 QQ 主对话前必须填写主人 QQ');
    }
    if (sanitized.groupActivityMode !== undefined) sanitized.groupActivityMode = sanitized.groupActivityMode === 'ai' ? 'ai' : 'manual';
    if (sanitized.privateActivityMode !== undefined) sanitized.privateActivityMode = sanitized.privateActivityMode === 'ai' ? 'ai' : 'manual';
    if (sanitized.groupActivity !== undefined) sanitized.groupActivity = Math.max(0, Math.min(100, Number(sanitized.groupActivity) || 0));
    if (sanitized.groupCooldownSec !== undefined) sanitized.groupCooldownSec = Math.max(0, Math.min(3600, Number(sanitized.groupCooldownSec) || 0));
    if (sanitized.privateActivity !== undefined) sanitized.privateActivity = Math.max(0, Math.min(100, Number(sanitized.privateActivity) || 0));
    if (sanitized.privateIdleMinutes !== undefined) sanitized.privateIdleMinutes = Math.max(1, Math.min(10080, Number(sanitized.privateIdleMinutes) || 180));
    if (sanitized.privateMinIntervalMinutes !== undefined) sanitized.privateMinIntervalMinutes = Math.max(1, Math.min(10080, Number(sanitized.privateMinIntervalMinutes) || 120));
    if (sanitized.homeDir) {
      const launcher = path.join(sanitized.homeDir, 'launcher.bat');
      if (fs.existsSync(launcher)) sanitized.launcherPath = launcher;
    }
    config.save({ qq: sanitized, ...(permissionPatch && typeof permissionPatch === 'object' ? { permissions: permissionPatch } : {}) });
    qq.tuneActivities();
    broadcast('config:changed', config.publicConfig());
    return { config: config.publicConfig(), status: qq.publicStatus() };
  });
  handle('qq:status', () => qq.publicStatus());
  handle('qq:test', () => qq.test());
  handle('qq:start', () => qq.start());
  handle('qq:proactive', () => qq.maybeProactive({ force: true }));
  handle('qq:stop', () => qq.stop());
  handle('qq:restart', () => qq.restart());
  handle('qq:launchSnowLuma', () => qq.launchSnowLuma());
  handle('qq:openWebUI', async () => shell.openExternal(config.get().qq.webuiUrl || 'http://127.0.0.1:5099'));
  handle('qq:send', (payload) => qq.sendManual(payload));
  handle('qq:saveConfig', () => config.publicConfig());

  handle('phone:status', async () => {
    phoneStatusCache = await phone.status({ scan: false });
    broadcast('phone:status', phoneStatusCache);
    return phoneStatusCache;
  });
  handle('phone:scan', async () => {
    const result = await phone.scanEmulators();
    phoneStatusCache = await phone.status({ scan: false });
    broadcast('phone:status', phoneStatusCache);
    broadcast('phone:scan', result);
    return { ...result, status: phoneStatusCache };
  });
  handle('phone:setMode', async ({ mode } = {}) => {
    const result = await phone.setMode(mode);
    phoneStatusCache = result;
    broadcast('phone:status', result);
    return result;
  });
  handle('phone:select', async ({ serial } = {}) => {
    const result = await phone.choose(serial);
    phoneStatusCache = result;
    return result;
  });
  handle('phone:save', async ({ phone: phonePatch } = {}) => {
    if (!phonePatch) throw new Error('缺少手机配置');
    config.save({ phone: phonePatch });
    phone.rebuild();
    phoneStatusCache = await phone.status();
    broadcast('config:changed', config.publicConfig());
    broadcast('phone:status', phoneStatusCache);
    return { config: config.publicConfig(), status: phoneStatusCache };
  });
  handle('phone:screenshot', async () => phone.screenshot());
  handle('phone:readScreen', async () => phone.readScreen());
  handle('phone:action', async ({ action, ...args } = {}) => {
    // 配置变化时 phone:save/setMode 已经 rebuild；普通操作复用缓存，避免反复扫描 ADB。
    switch (action) {
      case 'tap': return phone.core.tap(args.x, args.y);
      case 'swipe': return phone.core.swipe(args.x1, args.y1, args.x2, args.y2, args.durationMs || 300);
      case 'inputText': return phone.core.inputText(args.text, { submit: args.submit });
      case 'keyevent': return phone.core.keyevent(args.key);
      case 'launchApp': return phone.core.launchApp(args.packageName, args.activity || '');
      case 'openUrl': return phone.core.openUrl(args.url);
      case 'uiDump': return phone.uiDump();
      case 'listApps': return phone.core.listApps();
      case 'listEmulators': return phone.core.listEmulators();
      case 'startEmulator': return phone.core.startEmulator(args.avdName || '');
      case 'connectWifi': return phone.core.connectWifi(args.address);
      case 'shell': return phone.core.shell(args.command, { allow: config.get().phone.permissions.shell });
      default: throw new Error(`未知手机操作：${action}`);
    }
  });

  handle('computer:status', () => ({
    enabled: Boolean(config.get().computer.enabled && config.get().permissions.computerControl),
    config: config.get().computer,
    permissions: config.get().permissions,
    script: computer.script
  }));
  handle('computer:save', ({ computer: patch } = {}) => {
    if (!patch) throw new Error('缺少电脑配置');
    const merged = config.save({ computer: patch, permissions: patch.globalPermissions || {} });
    broadcast('config:changed', config.publicConfig());
    return { config: config.publicConfig(), enabled: Boolean(merged.computer.enabled && merged.permissions.computerControl) };
  });
  handle('computer:screenshot', () => computer.screenshot());
  handle('computer:action', async ({ action, ...args } = {}) => {
    switch (action) {
      case 'windows': return computer.windows();
      case 'screenInfo': return computer.screenInfo();
      case 'click': return computer.click(args.x, args.y);
      case 'type': return computer.typeText(args.text);
      case 'keys': return computer.keys(args.keys);
      case 'launch': return computer.launch(args.target);
      case 'focus': return computer.focusWindow(args.pid);
      case 'shell': return computer.shell(args.command);
      default: throw new Error(`未知电脑操作：${action}`);
    }
  });

  handle('mcp:get', () => ({ ...mcp.publicStatus(), samples: builtinMcpSamples() }));
  handle('mcp:add', (payload) => mcp.addServer(payload));
  handle('mcp:update', ({ id: serverId, patch } = {}) => mcp.updateServer(serverId, patch));
  handle('mcp:remove', ({ id: serverId } = {}) => mcp.removeServer(serverId));
  handle('mcp:start', async ({ id: serverId } = {}) => {
    const server = mcp.serverConfigs().find((item) => item.id === serverId);
    if (!server) throw new Error('MCP 服务不存在');
    await mcp.updateServer(serverId, { enabled: true });
    return mcp.publicStatus();
  });
  handle('mcp:stop', async ({ id: serverId } = {}) => {
    await mcp.updateServer(serverId, { enabled: false });
    return mcp.publicStatus();
  });
  handle('mcp:restart', async ({ id: serverId } = {}) => {
    await mcp.restart(serverId);
    return mcp.publicStatus();
  });

  handle('plugins:get', () => plugins.status());
  handle('plugins:reload', () => plugins.reload());
  handle('plugins:toggle', ({ id: pluginId, enabled } = {}) => plugins.setEnabled(pluginId, Boolean(enabled)));
  handle('plugins:openFolder', async ({ id: pluginId } = {}) => {
    const plugin = plugins.status().plugins.find((item) => item.id === pluginId);
    return shell.openPath(plugin?.dir || paths.plugins);
  });

  handle('settings:save', ({ patch } = {}) => {
    if (!patch) throw new Error('缺少设置');
    const saved = config.save(patch);
    if (patch.phone) phone.rebuild();
    broadcast('config:changed', config.publicConfig());
    return config.publicConfig();
  });
  handle('settings:choosePath', async ({ kind = 'directory' } = {}) => {
    const result = kind === 'file'
      ? await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] })
      : await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? '' : result.filePaths[0];
  });
  handle('settings:openPath', async ({ key = 'workspace' } = {}) => {
    const map = {
      workspace: paths.root,
      data: paths.data,
      logs: paths.logs,
      memory: paths.memory,
      plugins: paths.plugins,
      vendor: paths.vendor,
      snowluma: paths.snowluma,
      docs: path.join(paths.root, 'docs')
    };
    const target = map[key];
    if (!target) throw new Error('未知路径');
    return shell.openPath(target);
  });
  handle('logs:get', () => logger.recent(300));
  handle('shell:openExternal', async ({ url } = {}) => {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('只允许打开 http/https 链接');
    await shell.openExternal(url);
    return true;
  });

  handle('check:run', async () => {
    const script = fs.existsSync(paths.checkScript)
      ? paths.checkScript
      : path.join(process.resourcesPath, 'check', 'check-readonly.bat');
    if (!fs.existsSync(script)) throw new Error('找不到只读检查脚本');
    const child = await new Promise((resolve) => {
      const proc = execFile('cmd.exe', ['/d', '/s', '/c', script, paths.root, '--no-pause'], {
        cwd: paths.root,
        timeout: 90000,
        windowsHide: true,
        encoding: null,
        env: { ...process.env, BX_CHECK_ROOT: paths.root }
      }, (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout: Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || ''),
          stderr: Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '')
        });
      });
      proc.on('error', (error) => resolve({ code: -1, stdout: '', stderr: error.message }));
    });
    return {
      script,
      code: child.code,
      output: truncate(`${child.stdout}${child.stderr ? `\n[stderr]\n${child.stderr}` : ''}`, 40000)
    };
  });
}

function maybeOpenSecondInstance() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  return true;
}

async function shutdown() {
  try { await qq?.stop(); } catch {}
  try { await mcp?.stopAll(); } catch {}
}

if (!maybeOpenSecondInstance()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    app.setName('伴行Agent');
    registerMediaProtocol();
    logger = new Logger({ onEntry: (entry) => broadcast('log', entry) });
    createWindow();
    registerApi();
    readyPromise = initializeServices().then(() => {
      logger.info('app', '伴行已就绪');
    }).catch((error) => {
      initError = error.message;
      logger.error('app', `初始化失败：${error.message}`);
      broadcast('app:error', { error: error.message });
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  clearInterval(schedulerTimer);
  clearInterval(idleDecayTimer);
  clearInterval(idleLearnTimer);
  clearInterval(staleTimer);
  clearInterval(peopleTimer);
  await shutdown();
  app.exit(0);
});

process.on('uncaughtException', (error) => {
  logger?.error('process', `未捕获异常：${error.message}`, { stack: error.stack });
});
process.on('unhandledRejection', (error) => {
  logger?.error('process', `未处理 Promise：${error?.message || String(error)}`, { stack: error?.stack });
});
