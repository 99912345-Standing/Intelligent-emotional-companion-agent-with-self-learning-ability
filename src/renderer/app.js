/* 伴行 · 渲染层：无框架，所有网络与文件访问均通过 preload 白名单 IPC。 */
const api = window.banxing;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const S = {
  ready: false,
  data: null,
  route: 'home',
  unread: 0,
  messages: [],
  chatStatus: null,
  chatTools: [],
  draft: '',
  attachments: [],
  memoryData: null,
  memoryTab: 'knowledge',
  memorySearch: null,
  learningList: null,
  liveLearning: null,
  selectedCycle: null,
  cycleDetail: null,
  learningRunning: false,
  qqMessages: [],
  phoneStatus: null,
  phoneShot: null,
  phoneUi: null,
  phoneBusy: false,
  deviceTab: 'phone',
  computerShot: null,
  computerStatus: null,
  windows: null,
  checkOutput: '',
  checkRunning: false,
  logs: null,
  modelBusy: false,
  modelDiscovery: {},
  modelDiscoveryAttempted: {},
  musicNow: null,
  musicTracks: [],
  musicLyrics: null,
  musicAudio: '',
  musicAudioBytes: 0,
  musicError: '',
  musicConnect: ''
};

const NAV = [
  ['home', '首页', 'home'],
  ['chat', '对话', 'chat'],
  ['memory', '记忆', 'brain'],
  ['role', '角色设定', 'heart'],
  ['people', '印象', 'users'],
  ['diary', '日记', 'book'],
  ['music', '音乐', 'music'],
  ['growth', '成长轨迹', 'chart'],
  ['learning', '学习闭环', 'orbit'],
  ['idle', '闲时学习', 'sparkle'],
  ['usage', '用量', 'gauge'],
  ['qq', 'QQ 桥接', 'qq'],
  ['devices', '手机与电脑', 'phone'],
  ['models', '模型接入', 'cpu'],
  ['plugins', '插件与 MCP', 'plug'],
  ['settings', '设置与检查', 'settings']
];
const ROUTE_META = {
  home: ['首页', '工作、陪伴与学习，三个维度同时在场'],
  chat: ['对话', '和伴行一起把事做完，也把情绪接住'],
  memory: ['记忆', '知识、关系、工作日志、权重与多模态，全部留在本地'],
  role: ['角色设定', '知识线求真，情感线接人；可以由 AI 基于记忆小步修订'],
  people: ['印象', '群聊与私聊里所有见过的人：QQ、昵称、亲近度与动态印象'],
  diary: ['日记', '允许 AI 自己写下今天，也允许你随时翻看'],
  music: ['音乐', '听你正在听的，也用本地声音唱给你听'],
  growth: ['成长轨迹', '连续权重向量如何随每一次发言移动'],
  learning: ['学习闭环', '不知道就去查，查过要交叉验证，质疑后重新核验'],
  idle: ['闲时学习', '白名单安静 1 小时后，自己搜索、学习、写入记忆'],
  usage: ['用量', '对话 token、上下文缓存命中率与记忆命中率'],
  qq: ['QQ 桥接', 'SnowLuma OneBot × qq-bridge × 伴行主智能体'],
  devices: ['手机与电脑', '真机、模拟器与 Windows 桌面，权限始终可控'],
  models: ['模型接入', '主模型 + 多模态问答模型 + 本地模型 / MCP'],
  plugins: ['插件与 MCP', '把新能力挂进同一个主智能体'],
  settings: ['设置与检查', '路径、只读检查、日志与运行信息']
};

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H6l-4 2 1.5-5A8 8 0 1 1 21 12Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
  brain: '<path d="M9.5 4.5A3 3 0 0 0 4 6a3 3 0 0 0 .8 5.2A3 3 0 0 0 7 17a3 3 0 0 0 5 2V5a3 3 0 0 0-2.5-.5Z"/><path d="M14.5 4.5A3 3 0 0 1 20 6a3 3 0 0 1-.8 5.2A3 3 0 0 1 17 17a3 3 0 0 1-5 2V5a3 3 0 0 1 2.5-.5Z"/><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="m6 15 4-5 3 3 5-7"/>',
  gauge: '<path d="M4 14a8 8 0 1 1 16 0"/><path d="m12 14 4-4"/><circle cx="12" cy="14" r="1.3"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>',
  qq: '<path d="M8 10c0-2.2 1.8-4 4-4s4 1.8 4 4c0 1.3.8 2 1.5 3.4.7 1.4.3 3.1-.8 3.8-.8.5-1.4-.2-2.1-1-.7.4-1.6.6-2.6.6s-1.9-.2-2.6-.6c-.7.8-1.3 1.5-2.1 1-1.1-.7-1.5-2.4-.8-3.8C7.2 12 8 11.3 8 10Z"/><path d="M9 21c1 .8 2 1.2 3 1.2s2-.4 3-1.2"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Z"/><path d="M12 17v5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.1h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3.1 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  play: '<path d="M8 5v14l11-7-11-7Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
  paperclip: '<path d="m21 11.5-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"/>',
  star: '<path d="m12 2 3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1L12 2Z"/>',
  warning: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/>',
  heart: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21l8.8-8.3a5 5 0 0 0 0-7.1Z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.8"/><path d="M17 14.5a5 5 0 0 1 3.5 5.5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};

function icon(name, cls = '') {
  const path = ICONS[name] || ICONS.sparkle;
  return `<span class="icon ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function safeUrl(url) {
  const value = String(url || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function inlineMd(text) {
  let value = esc(text);
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="#" data-url="${esc(safe)}">${label}</a>` : label;
  });
  value = value.replace(/(^|[\s(])(https?:\/\/[^\s<>"')]+)/g, (match, prefix, url) => `${prefix}<a href="#" data-url="${esc(url)}">${esc(url)}</a>`);
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return value;
}

function markdown(text) {
  const raw = String(text || '');
  const blocks = [];
  const placeholders = raw.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\n@@CODE${blocks.length - 1}@@\n`;
  });
  const lines = placeholders.split(/\r?\n/);
  const out = [];
  let list = null;
  let paragraph = [];
  const flushP = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.map(inlineMd).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMd(item)}</li>`).join('')}</${list.type}>`);
      list = null;
    }
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^@@CODE\d+@@$/.test(trimmed)) {
      flushP(); flushList();
      out.push(blocks[Number(trimmed.match(/\d+/)[0])]);
      continue;
    }
    if (!trimmed) { flushP(); flushList(); continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) { flushP(); flushList(); out.push(`<h${heading[1].length}>${inlineMd(heading[2])}</h${heading[1].length}>`); continue; }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushP();
      if (list?.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      flushP();
      if (list?.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(ordered[1]);
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flushP(); flushList();
      out.push(`<blockquote>${inlineMd(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }
    if (/^---+$/.test(trimmed)) { flushP(); flushList(); out.push('<hr>'); continue; }
    if (/^\|.+\|$/.test(trimmed)) {
      // 简单表格：连续 | 行
      if (!list || list.type !== 'table') { flushP(); flushList(); list = { type: 'table', items: [] }; }
      list.items.push(trimmed);
      continue;
    }
    if (list?.type === 'table') { flushList(); }
    paragraph.push(trimmed);
  }
  flushP(); flushList();
  return out.join('');
}

function timeShort(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function timeAgo(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '—';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return timeShort(value);
}

function num(value) { return Number(value || 0).toLocaleString('zh-CN'); }
function pct(value) { return `${Math.round(Number(value || 0))}%`; }

function toast(message, type = 'info', timeout = 3800) {
  const root = $('#toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'warning' : type === 'ok' ? 'check' : 'sparkle')}<span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, timeout);
}

async function call(channel, payload = {}) {
  const result = await window.banxing.invoke(channel, payload);
  if (!result?.ok) throw new Error(result?.error || '操作失败');
  return result.data;
}

async function busy(button, fn) {
  if (!button) return fn();
  if (button.classList.contains('is-busy')) return;
  button.classList.add('is-busy');
  button.disabled = true;
  try { return await fn(); } finally {
    button.classList.remove('is-busy');
    button.disabled = false;
  }
}

function statusDot(ok, warn = false) {
  return `<span class="dot ${ok ? 'dot-ok' : warn ? 'dot-warn' : 'dot-idle'}"></span>`;
}

function badge(text, cls = '') { return `<span class="badge ${cls}">${esc(text)}</span>`; }

function memoryCounts() {
  const stats = S.data?.stats || {};
  return stats;
}

function weights() {
  return S.data?.weights?.normalized || { work: 35, companion: 45, learning: 20 };
}

function modeLabel() {
  const mode = S.data?.weights?.mode;
  return mode?.label || '三线并行';
}

function configuredPrimary() {
  const cfg = S.data?.config?.models?.primary;
  return Boolean(cfg?.baseUrl && cfg?.model && (cfg?.hasApiKey || /127\.0\.0\.1|localhost/i.test(cfg.baseUrl)));
}

function buildNav() {
  const nav = $('#nav');
  const stats = memoryCounts();
  const memoryTotal = (stats.knowledge || 0) + (stats.relationship || 0) + (stats.worklogs || 0) + (stats.multimodal || 0);
  const counts = { memory: memoryTotal, learning: S.data?.learning?.cycles?.length || 0 };
  nav.innerHTML = NAV.map(([id, label, ico]) => {
    let badgeText = '';
    if (id === 'chat' && S.unread) badgeText = `<span class="nav-badge">${S.unread > 9 ? '9+' : S.unread}</span>`;
    else if (id === 'memory' && counts.memory) badgeText = `<span class="nav-badge">${counts.memory}</span>`;
    else if (id === 'qq' && S.data?.qq?.connected) badgeText = `<span class="nav-badge" style="color:#7bd0bf">在线</span>`;
    return `<button class="nav-item ${S.route === id ? 'active' : ''}" data-route="${id}">${icon(ico)}<span>${label}</span>${badgeText}</button>`;
  }).join('');
}

function updateShell() {
  if (!S.data) return;
  const [title, sub] = ROUTE_META[S.route] || ['伴行', ''];
  $('#topbar-title').textContent = title;
  $('#topbar-sub').textContent = sub;
  const w = weights();
  const mode = S.data.weights?.mode?.label || '三线并行';
  $('#mini-work').textContent = pct(w.work);
  $('#mini-companion').textContent = pct(w.companion);
  $('#mini-learning').textContent = pct(w.learning);
  $('#mini-work-bar').style.width = `${Math.max(4, w.work)}%`;
  $('#mini-companion-bar').style.width = `${Math.max(4, w.companion)}%`;
  $('#mini-learning-bar').style.width = `${Math.max(4, w.learning)}%`;
  $('#mini-mode').textContent = mode;
  $('#sidebar-version').textContent = `v${S.data.app?.version || '1.0.0'} · 本地`;
  const primary = S.data.config?.models?.primary || {};
  const chip = $('#model-chip');
  const configured = configuredPrimary();
  const verified = Boolean(primary.capabilities?.text);
  chip.innerHTML = `${statusDot(verified, configured && !verified)}<span>${esc(configured ? primary.model : '模型待接入')}</span>`;
  buildNav();
}

function afterRender() {
  hydrateIcons();
  if (S.route === 'chat') {
    renderChatMessages();
    setTimeout(() => $('#chat-input')?.focus(), 20);
  }
  if (S.route === 'growth') drawWeightChart();
  if (S.route === 'settings') renderLogsIfNeeded();
}

function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    if (el.dataset.hydrated) return;
    el.innerHTML = icon(el.dataset.icon);
    el.dataset.hydrated = '1';
  });
}

const FORM_DRAFTS = (() => {
  try { return JSON.parse(sessionStorage.getItem('banxing:form-drafts') || '{}') || {}; } catch { return {}; }
})();

function saveDrafts() {
  try { sessionStorage.setItem('banxing:form-drafts', JSON.stringify(FORM_DRAFTS)); } catch {}
}

function draftKey(el) {
  if (!el?.name && !el?.id) return '';
  if (el.dataset?.draftSkip === '1' || el.type === 'password' || el.type === 'file') return '';
  const form = el.closest?.('form[data-form]');
  const scope = form?.dataset.form || (el.id ? `#${el.id}` : 'page');
  return `${S.route}::${scope}::${el.name || el.id}`;
}

function recordDraft(el) {
  const key = draftKey(el);
  if (!key) return;
  const value = el.type === 'checkbox' || el.type === 'radio'
    ? { checked: Boolean(el.checked), value: el.value }
    : { value: el.value };
  FORM_DRAFTS[key] = value;
  saveDrafts();
}

function captureDrafts(root = document) {
  $$('input, textarea, select', root).forEach((el) => {
    if (el.closest('#modal-root')) return;
    recordDraft(el);
  });
}

function clearDrafts(formName) {
  const prefix = `${S.route}::${formName}::`;
  for (const key of Object.keys(FORM_DRAFTS)) {
    if (key.startsWith(prefix)) delete FORM_DRAFTS[key];
  }
  saveDrafts();
}

function restoreDrafts(root = document) {
  $$('input, textarea, select', root).forEach((el) => {
    if (el.closest('#modal-root')) return;
    const key = draftKey(el);
    const draft = key ? FORM_DRAFTS[key] : null;
    if (!draft) return;
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = Boolean(draft.checked);
    } else if (draft.value !== undefined && el.value !== String(draft.value)) {
      el.value = draft.value;
    }
    if (el.type === 'range' && el.dataset.output) {
      for (const output of document.querySelectorAll(`[data-output="${el.dataset.output}"]`)) output.textContent = el.value;
    }
  });
}

function render() {
  if (!S.ready || !S.data) return;
  // 路由切换时 navigate() 已经按旧路由保存过；不要用旧 DOM 覆盖新路由的草稿。
  if (S._renderedRoute === S.route) captureDrafts();
  updateShell();
  const main = $('#main');
  const scroll = main.scrollTop;
  const templates = { home: viewHome, chat: viewChat, memory: viewMemory, role: viewRole, people: viewPeople, diary: viewDiary, music: viewMusic, growth: viewGrowth, learning: viewLearning, idle: viewIdleLearning, usage: viewUsage, qq: viewQQ, devices: viewDevices, models: viewModels, plugins: viewPlugins, settings: viewSettings };
  main.innerHTML = (templates[S.route] || viewHome)();
  if (S.route !== 'chat') main.scrollTop = scroll;
  afterRender();
  restoreDrafts(main);
  S._renderedRoute = S.route;
}

// ── bootstrap ───────────────────────────────────────────────────────────────
async function bootLoad() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await api.invoke('app:bootstrap', {});
    if (result?.ok) return result.data;
    if (attempt === 0) $('#boot-text').textContent = '服务正在初始化，请稍候…';
    if (attempt > 30) $('#boot-text').textContent = result?.error ? `初始化未完成：${result.error}` : '仍在等待服务…';
    await sleep(700);
  }
  throw new Error('服务初始化超时。请关闭应用后重启，或运行工作目录下的「检查环境-只读.bat」。');
}

async function startApp() {
  initEventBridge();
  try {
    S.data = await bootLoad();
    S.ready = true;
    S.route = S.data.config?.ui?.lastRoute && ROUTE_META[S.data.config.ui.lastRoute] ? S.data.config.ui.lastRoute : 'home';
    if (S.route === 'chat') S.route = 'home';
    S.messages = S.data.conversations?.desktop || [];
    S.qqMessages = S.data.qq?.recentMessages || [];
    S.phoneStatus = S.data.phone || null;
    S.computerStatus = { enabled: Boolean(S.data.config?.computer?.enabled), config: S.data.config?.computer, permissions: S.data.config?.permissions };
    render();
    if (!S.memoryData) loadMemoryData();
    $('#boot').classList.add('hide');
    if (S.data.config?.app?.checkOnStart !== false) {
      setTimeout(() => {
        if (!S.checkOutput && !S.checkRunning) {
          runCheck(null, { silent: true }).catch(() => {});
        }
      }, 8000);
    }
  } catch (error) {
    const boot = $('#boot');
    boot.classList.add('error');
    $('#boot-text').textContent = error.message;
    boot.insertAdjacentHTML('beforeend', `<button class="btn btn-primary" style="margin-top:14px" onclick="location.reload()">重新启动界面</button><small>若持续失败，请运行「检查环境-只读.bat」查看缺失项。</small>`);
  }
}

function initEventBridge() {
  api.onEvent(async (event) => {
    const { type, payload } = event;
    if (!S.ready && !['app:ready', 'app:error'].includes(type)) return;
    try {
      if (type === 'chat:message') {
        const channel = payload.channel || 'desktop';
        if (channel !== 'desktop') {
          if (payload.message?.role === 'assistant') toast(`QQ 回复已发送：${String(payload.message.content || '').slice(0, 60)}`, 'ok');
          return;
        }
        upsertMessage(payload.message);
        if (S.route === 'chat') renderChatMessages();
        else if (payload.message?.role === 'assistant') { S.unread += 1; buildNav(); }
      } else if (type === 'chat:status') {
        if ((payload.channel || 'desktop') !== 'desktop') return;
        S.chatStatus = payload.status === 'idle' ? null : payload;
        if (S.route === 'chat') renderChatStatus();
      } else if (type === 'chat:system') {
        if ((payload.channel || 'desktop') !== 'desktop') { toast(payload.content, payload.kind === 'error' ? 'error' : 'info'); return; }
        S.messages.push({ id: `sys-${Date.now()}`, role: 'system', content: payload.content, createdAt: new Date().toISOString(), meta: { kind: payload.kind } });
        if (S.route === 'chat') renderChatMessages();
        toast(payload.content, payload.kind === 'error' ? 'error' : 'info');
      } else if (type === 'chat:tool') {
        if ((payload.channel || 'desktop') !== 'desktop') return;
        if (payload.status === 'end') S.chatTools.push(payload);
        if (S.route === 'chat') renderChatRailTools();
      } else if (type === 'weights:changed') {
        if (S.data) S.data.weights = payload;
        updateShell();
        if (S.route === 'growth') render();
        if (S.route === 'home') renderHomeDualOnly();
      } else if (type === 'stickers:labelProgress') {
        if (S.memoryData) S.memoryData.stickerLabels = payload;
        if (S.route === 'memory') render();
      } else if (type === 'memory:changed') {
        scheduleBootstrapRefresh();
        if (S.route === 'memory') scheduleMemoryRefresh();
        else S.memoryData = null;
      } else if (type === 'qq:status') {
        S.data.qq = payload;
        updateShell();
        if (S.route === 'qq') render();
        if (payload.error) toast(payload.error, 'error');
      } else if (type === 'qq:activity') {
        if (S.data?.qq?.config) {
          S.data.qq.config.groupActivity = payload.group;
          S.data.qq.config.privateActivity = payload.private;
          S.data.qq.config.groupActivityMode = payload.groupMode;
          S.data.qq.config.privateActivityMode = payload.privateMode;
        }
        for (const output of document.querySelectorAll('[data-output="groupActivity"]')) output.textContent = payload.group;
        for (const output of document.querySelectorAll('[data-output="privateActivity"]')) output.textContent = payload.private;
        for (const slider of document.querySelectorAll('input[name="groupActivity"]')) slider.value = payload.group;
        for (const slider of document.querySelectorAll('input[name="privateActivity"]')) slider.value = payload.private;
      } else if (type === 'qq:message') {
        S.qqMessages.push(payload);
        if (S.qqMessages.length > 200) S.qqMessages.shift();
        if (S.data?.qq) S.data.qq.recentMessages = S.qqMessages;
        if (S.route === 'qq') renderQQMessagesOnly();
        if (!payload.outgoing && payload.willReply === false && payload.ignoredReason) {
          // 不打扰用户，只在 QQ 页显示原因。
        }
      } else if (type === 'phone:status') {
        S.phoneStatus = payload;
        if (S.data) S.data.phone = payload;
        if (S.route === 'devices' && S.deviceTab === 'phone') render();
      } else if (type === 'learning:progress') {
        S.liveLearning = payload;
        if (S.route === 'learning') render();
      } else if (type === 'idle:learning:start') {
        if (S.route === 'idle') toast(payload.review?.fallback ? '选题未通过四审，已回退到安全方向' : '选题通过四审，开始搜索…', 'info', 4000);
      } else if (type === 'idle:learning:completed') {
        S.data.idleLearning = payload.overview || S.data.idleLearning;
        if (S.route === 'idle') render();
        if (payload.emotional) toast('自学习材料已写入情感记忆', 'ok');
      } else if (type === 'idle:learning:failed') {
        if (S.route === 'idle') toast(`闲时自学习失败：${payload.error}`, 'error', 6000);
      } else if (type === 'autonomy:started') {
        S.data.autonomy = payload.overview || S.data.autonomy;
        if (S.route === 'idle') { render(); toast('空闲自主活动开始：她自己拿起设备了', 'info', 5000); }
      } else if (type === 'autonomy:completed') {
        S.data.autonomy = payload.overview || S.data.autonomy;
        if (S.route === 'idle') render();
        if (payload.session?.status === 'completed') toast('自主活动结束，已留下活动记录', 'ok');
      } else if (type === 'learning:completed') {
        S.learningList = null;
        scheduleBootstrapRefresh();
        toast('信源复核完成，记忆已更新', 'ok');
      } else if (type === 'weights:reflected') {
        S.data?.learning?.reflections?.unshift?.(payload);
        if (S.route === 'growth') toast('已生成一次权重反思', 'ok');
        scheduleBootstrapRefresh();
      } else if (type === 'config:changed') {
        S.data.config = payload;
        updateShell();
      } else if (type === 'diary:changed') {
        try { S.data.diary = await call('diary:list', { limit: 60 }); } catch {}
        if (S.route === 'diary') render();
      } else if (type === 'usage:changed') {
        try { S.data.usage = await call('usage:summary'); } catch {}
        if (S.route === 'usage') render();
      } else if (type === 'people:changed') {
        try {
          const data = await call('people:list');
          S.data.people = data.people;
          S.data.peopleStats = data.stats;
        } catch {}
        if (S.route === 'people') render();
      } else if (type === 'persona:changed') {
        if (S.data) S.data.persona = { ...(S.data.persona || {}), profile: payload };
        if (S.route === 'role') {
          try { S.data.persona = await call('persona:get'); } catch {}
          render();
        }
      } else if (type === 'plugins:changed') {
        S.data.plugins = payload;
        if (S.route === 'plugins') render();
      } else if (type === 'mcp:changed') {
        S.data.mcp = payload;
        if (S.route === 'plugins') render();
      } else if (type === 'app:error') {
        toast(`初始化失败：${payload.error}`, 'error', 9000);
      }
    } catch (error) {
      console.error('[event]', type, error);
    }
  });
}

function upsertMessage(message) {
  if (!message) return;
  const index = S.messages.findIndex((item) => item.id === message.id);
  if (index >= 0) S.messages[index] = { ...S.messages[index], ...message };
  else {
    const localIndex = S.messages.findIndex((item) => item.local && item.role === message.role);
    if (localIndex >= 0 && message.role === 'user') S.messages[localIndex] = message;
    else S.messages.push(message);
  }
}

let refreshTimer = null;
function scheduleBootstrapRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const data = await call('app:bootstrap');
      const previousRoute = S.route;
      S.data = data;
      S.qqMessages = data.qq?.recentMessages || S.qqMessages;
      updateShell();
      if (previousRoute === 'memory') {
        S.memoryData = await call('memory:overview').catch(() => S.memoryData);
      }
      if (['home', 'memory', 'growth', 'learning', 'role', 'people', 'usage'].includes(previousRoute)) render();
    } catch {}
  }, 700);
}
let memoryTimer = null;
function scheduleMemoryRefresh() {
  clearTimeout(memoryTimer);
  memoryTimer = setTimeout(async () => {
    try {
      S.memoryData = await call('memory:overview');
      if (S.route === 'memory') render();
    } catch {}
  }, 500);
}

// ── views: home ─────────────────────────────────────────────────────────────
function renderHomeDualOnly() {
  if (S.route !== 'home') return;
  const w = weights();
  const work = $('#home-work'); const companion = $('#home-companion'); const learning = $('#home-learning');
  if (work) work.textContent = pct(w.work);
  if (companion) companion.textContent = pct(w.companion);
  if (learning) learning.textContent = pct(w.learning);
  const barWork = $('#home-bar-work'); const barComp = $('#home-bar-companion'); const barLearn = $('#home-bar-learning');
  if (barWork) barWork.style.width = `${Math.max(3, w.work)}%`;
  if (barComp) barComp.style.width = `${Math.max(3, w.companion)}%`;
  if (barLearn) barLearn.style.width = `${Math.max(3, w.learning)}%`;
  const mode = $('#home-mode'); if (mode) mode.textContent = modeLabel();
  const label = $('#home-mode'); if (label) label.textContent = modeLabel();
}

function viewHome() {
  const w = weights();
  const stats = memoryCounts();
  const qq = S.data.qq || {};
  const phone = S.data.phone;
  const primary = S.data.config?.models?.primary || {};
  const knowledge = S.memoryData?.knowledge || [];
  const recent = [
    ...knowledge.slice(0, 3).map((item) => ({ kind: '知识', title: item.title, at: item.updatedAt, dot: 'teal' })),
    ...(S.data.memory?.activeWork || []).slice(0, 2).map((item) => ({ kind: '进行中', title: item.title, at: item.lastActiveAt, dot: '' })),
    ...(S.data.learning?.reflections || []).slice(0, 2).map((item) => ({ kind: '反思', title: String(item.content || '').slice(0, 48), at: item.createdAt, dot: 'gold' }))
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 5);
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  const hour = new Date().getHours();
  const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return `<div class="page">
    <div class="hero">
      <section class="card dark hero-main">
        <div class="hero-kicker">${esc(date)} · LONG-TERM COMPANION</div>
        <h1>${greet}。今天想一起<br><em>把什么做成？</em></h1>
        <p>我会先听你说，再决定把工作、陪伴还是学习推近一点。三个维度始终同时在场，只是权重不同。</p>
        <form class="quick-chat" data-form="quick-chat">
          <input class="input" id="quick-input" autocomplete="off" placeholder="写点什么，或说说你现在最想解决的事…">
          <button class="btn btn-primary" type="submit">${icon('send')}开始</button>
        </form>
      </section>
      <section class="card dark dual-big">
        <div class="dual-head"><span class="tiny" style="color:#b9b4a9;letter-spacing:.08em">NOW · 三线状态</span><span class="dual-mode" id="home-mode">${esc(modeLabel())}</span></div>
        <div class="dual-values">
          <div class="dual-value work"><span>工作 WORK</span><b id="home-work">${pct(w.work)}</b></div>
          <div class="dual-value companion"><span>陪伴 COMPANION</span><b id="home-companion">${pct(w.companion)}</b></div>
          <div class="dual-value learning"><span>学习 LEARNING</span><b id="home-learning">${pct(w.learning)}</b></div>
        </div>
        <div class="dual-bars"><span class="work" id="home-bar-work" style="width:${Math.max(3,w.work)}%"></span><span class="companion" id="home-bar-companion" style="width:${Math.max(3,w.companion)}%"></span><span class="learning" id="home-bar-learning" style="width:${Math.max(3,w.learning)}%"></span></div>
        <div class="hero-foot">强信号会快速抬高对应维度，其他维度保留基线；没有新信号时按指数回到基线。AI 只收到定性取向，不读百分比。最近一次移动：${timeAgo(S.data.weights?.updatedAt)}。</div>
      </section>
    </div>

    <div class="stat-grid">
      <div class="stat">${icon('brain','stat-icon')}<div class="stat-copy"><span>长期记忆</span><b>${num(stats.knowledge + stats.relationship + stats.worklogs + stats.multimodal)}</b><small>${num(stats.knowledge)} 知识 · ${num(stats.relationship)} 关系 · ${num(stats.multimodal)} 多模态</small></div></div>
      <div class="stat">${icon('work','stat-icon')}<div class="stat-copy"><span>进行中的工作</span><b>${num(stats.activeWork || 0)}</b><small>超时自动整理成工作日志</small></div></div>
      <div class="stat">${icon('qq','stat-icon')}<div class="stat-copy"><span>QQ 桥接</span><b>${qq.connected ? '监听中' : '未连接'}</b><small>${qq.boundQQ ? `绑定 ${esc(qq.boundQQ)} · ${esc(qq.nickname || '')}` : '在 QQ 桥接页连接 OneBot / SnowLuma'}</small></div></div>
      <div class="stat">${icon('phone','stat-icon')}<div class="stat-copy"><span>手机能力</span><b>${phone?.ok ? (phone.mode === 'emulator' ? '模拟器' : '真机') : '待连接'}</b><small>${phone?.ok ? esc(phone.info?.model || phone.serial) : 'ADB 已就位，等待设备授权'}</small></div></div>
    </div>

    <div class="home-grid">
      <section class="card">
        <div class="card-title">${icon('sparkle')}最近在发生什么<span class="card-actions"><button class="btn btn-sm btn-ghost" data-route="memory">全部记忆 ${icon('external')}</button></span></div>
        ${recent.length ? `<div class="timeline">${recent.map((item) => `<div class="timeline-item"><span class="timeline-dot ${item.dot}"></span><div class="timeline-copy"><strong>${esc(item.title)}</strong><span>${esc(item.kind)} · ${timeAgo(item.at)}</span></div></div>`).join('')}</div>` : `<div class="empty" style="padding:24px 10px">${icon('brain')}<h3>记忆还是空的</h3><p>和伴行聊几句，或在“记忆”里手动记下一条偏好。知识需要在学习闭环里核验后才会归档。</p></div>`}
      </section>
      <div class="stack">
        <section class="card">
          <div class="card-title">${icon('orbit')}接下来</div>
          <div class="quick-actions">
            <button class="quick-action" data-route="chat">${icon('chat')}继续对话</button>
            <button class="quick-action" data-action="start-learning-shortcut">${icon('search')}查证一个问题</button>
            <button class="quick-action" data-route="devices">${icon('phone')}看看手机</button>
            <button class="quick-action" data-route="memory">${icon('brain')}整理记忆</button>
          </div>
        </section>
        <section class="card" style="padding:15px">
          <div class="card-title" style="margin-bottom:7px">${icon('shield')}运行边界</div>
          <p class="card-note">主模型 ${configuredPrimary() ? `已接入 · ${esc(primary.model)}` : '尚未接入'}。所有记忆和媒体保存在工作目录；电脑/手机操作需要显式授权，QQ 发送受白名单约束。</p>
        </section>
      </div>
    </div>
  </div>`;
}

// ── views: chat ─────────────────────────────────────────────────────────────
function viewChat() {
  const w = weights();
  const configured = configuredPrimary();
  const qqPrimary = Boolean(S.data.config?.qq?.primaryConversation);
  const qqConnected = Boolean(S.data.qq?.connected);
  const lastAssistant = [...S.messages].reverse().find((message) => message.role === 'assistant');
  const hits = lastAssistant?.meta?.memoryHits || {};
  return `<div class="page" style="padding-top:18px;height:100%;display:flex;flex-direction:column">
    ${!configured ? `<div class="banner-warning">${icon('warning')}<div><b>主模型尚未接入。</b>你仍然可以浏览记忆、配置 QQ/手机、运行只读检查；要对话，请先到 <a href="#" data-route="models">模型接入</a> 填写 API URL、模型名与密钥。</div></div>` : ''}
    <div class="chat-layout" style="flex:1">
      <section class="chat-panel">
        <header class="chat-head">
          <span class="avatar">伴</span>
          <div style="min-width:0"><b>和伴行的对话</b><div class="muted">${S.messages.length} 条消息 · ${qqPrimary ? 'QQ 主人私聊已接入主对话' : '权重会随每一次发言漂移'}</div></div>
          <div class="spacer"></div>
          ${qqPrimary ? `<span class="badge ${qqConnected ? 'badge-teal' : 'badge-gold'}">${qqConnected ? `QQ 主对话 · ${esc(S.data.config.qq.ownerQQ || '')}` : 'QQ 主对话 · 未连接'}</span>` : ''}
          <span class="badge ${configured ? 'badge-teal' : 'badge-gold'}">${configured ? '在线' : '待接入模型'}</span>
          <button class="btn btn-sm btn-ghost" data-action="clear-chat" title="清空当前桌面会话">清空</button>
        </header>
        <div class="chat-scroll" id="chat-scroll"></div>
        <div class="composer-wrap">
          <div class="attachments" id="attachment-strip">${S.attachments.map((item, index) => `<span class="attachment-chip">${item.dataUrl ? `<img src="${item.dataUrl}" alt="">` : icon('paperclip')}${esc(item.name)}<button type="button" style="border:0;background:transparent;color:#6b8f86" data-action="remove-attachment" data-index="${index}">×</button></span>`).join('')}</div>
          <form class="composer" data-form="chat">
            <textarea id="chat-input" rows="1" placeholder="说点什么…（Enter 发送，Shift+Enter 换行）">${esc(S.draft)}</textarea>
            <div class="composer-foot">
              <div class="left">
                <button class="btn btn-sm btn-ghost" type="button" data-action="attach-image" title="添加图片">${icon('paperclip')}</button>
                <button class="btn btn-sm btn-ghost" type="button" data-action="attach-file" title="添加音频或其他文件">${icon('folder')}</button>
                <span class="composer-hint">${configured ? '记忆已接入 · 联网可按需查证' : '先接入模型'}</span>
              </div>
              <button class="btn btn-primary btn-sm composer-send" type="submit" ${S.chatStatus && S.chatStatus.status !== 'idle' ? 'disabled' : ''}>${icon('send')}发送</button>
            </div>
          </form>
        </div>
      </section>
      <aside class="chat-rail">
        <div class="rail-card">
          <div class="rail-title">${icon('chart')}三线状态</div>
          <div class="rail-weights">
            <div class="rail-weight work"><b>${pct(w.work)}</b><span>工作</span></div>
            <div class="rail-weight companion"><b>${pct(w.companion)}</b><span>陪伴</span></div>
          </div>
          <div class="rail-bars"><span class="work" style="width:${Math.max(3,w.work)}%"></span><span class="companion" style="width:${Math.max(3,w.companion)}%"></span><span class="learning" style="width:${Math.max(3,w.learning)}%"></span></div>
          <div class="small muted" style="margin-top:7px">${esc(modeLabel())} · 工 ${pct(w.work)} / 伴 ${pct(w.companion)} / 学 ${pct(w.learning)}</div>
          <div class="tiny muted" style="margin-top:4px">AI 只收到定性取向，不读百分比；可小幅微调。</div>
        </div>
        <div class="rail-card">
          <div class="rail-title">${icon('brain')}本轮召回</div>
          ${lastAssistant?.meta?.memoryHits ? `<div class="kv"><span>关系记忆</span><b>${hits.relationship || 0}</b></div><div class="kv"><span>知识库</span><b>${hits.knowledge || 0}</b></div><div class="kv"><span>工作日志</span><b>${hits.worklogs || 0}</b></div><div class="kv"><span>多模态</span><b>${hits.multimodal || 0}</b></div>` : `<div class="empty-rail">还没有本轮召回。发一条消息后，这里会显示实际使用的记忆层。</div>`}
        </div>
        <div class="rail-card">
          <div class="rail-title">${icon('plug')}工具轨迹</div>
          <div class="tool-trace" id="chat-tool-trace">${renderTools()}</div>
        </div>
        <div class="rail-card">
          <div class="rail-title">${icon('shield')}提醒</div>
          <div class="empty-rail">QQ 发送、手机点击、电脑输入都属于现实操作。伴行会在执行前先确认，不会自作主张。</div>
        </div>
      </aside>
    </div>
  </div>`;
}

function renderTools() {
  if (!S.chatTools.length) return '<div class="empty-rail">暂无工具调用。涉及查证、手机或电脑时，这里会留下轨迹。</div>';
  return [...S.chatTools].reverse().slice(0, 10).map((tool) => `<div class="tool-row">${icon('check')}<span>${esc(tool.name)}</span><span class="ok">${tool.durationMs || 0}ms</span></div>`).join('');
}

function renderChatRailTools() {
  const target = $('#chat-tool-trace');
  if (target) target.innerHTML = renderTools();
}

function messageHtml(message) {
  if (message.role === 'system') {
    return `<div class="msg system" data-message-id="${esc(message.id)}"><div class="bubble">${esc(message.content)}</div></div>`;
  }
  const user = message.role === 'user';
  const meta = message.meta || {};
  const attachments = (message.attachments || []).filter((item) => item.kind === 'image' && item.path);
  const weightLine = !user && meta.weights ? `<span>工作 ${meta.weights.work}% / 陪伴 ${meta.weights.companion}%</span>` : '';
  return `<div class="msg ${user ? 'user' : ''}" data-message-id="${esc(message.id)}">
    <div class="avatar">${user ? '你' : '伴'}</div>
    <div class="msg-body">
      <div class="msg-name">${user ? '你' : '伴行'}${meta.source === 'qq' ? '<span class="badge badge-teal" style="font-size:8px">QQ</span>' : ''}${meta.proactive ? '<span class="badge badge-gold" style="font-size:8px">主动</span>' : ''}<span>${timeShort(message.createdAt)}</span>${message.local ? '<span>发送中…</span>' : ''}</div>
      ${attachments.length ? `<div class="attachments" style="margin-bottom:5px">${attachments.map((item) => `<span class="attachment-chip">${icon('paperclip')}${esc(item.caption || item.kind)}</span>`).join('')}</div>` : ''}
      <div class="bubble">${user ? esc(message.content).replace(/\n/g, '<br>') : markdown(message.content)}</div>
      <div class="msg-meta">${weightLine}${meta.tools?.length ? `<span>${meta.tools.length} 次工具</span>` : ''}${meta.learningCycleId ? '<span>含信源核验</span>' : ''}</div>
    </div>
  </div>`;
}

function renderChatMessages() {
  const scroll = $('#chat-scroll');
  if (!scroll) return;
  const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 160;
  if (!S.messages.length && !S.chatStatus) {
    scroll.innerHTML = `<div class="empty" style="padding:60px 20px">${icon('chat')}<h3>从一句话开始</h3><p>你可以直接说“我累了”，也可以把一份工作丢进来。伴行会先判断此刻该接住你，还是该推进任务。</p></div>`;
  } else {
    scroll.innerHTML = S.messages.map(messageHtml).join('') + (S.chatStatus ? `<div class="msg typing"><div class="avatar">伴</div><div class="msg-body"><div class="bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span><span style="margin-left:4px">${esc(S.chatStatus.message || '思考中…')}</span></div></div></div>` : '');
  }
  if (nearBottom) setTimeout(() => { scroll.scrollTop = scroll.scrollHeight; }, 30);
}

function renderChatStatus() {
  const scroll = $('#chat-scroll');
  if (!scroll) return;
  const typing = $('.msg.typing', scroll);
  if (S.chatStatus) {
    if (typing) {
      const text = $('.bubble', typing);
      if (text) text.innerHTML = `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span><span style="margin-left:4px">${esc(S.chatStatus.message || '思考中…')}</span>`;
    } else renderChatMessages();
  } else if (typing) {
    typing.remove();
    if (!S.messages.length) renderChatMessages();
  }
  const send = $('.composer-send');
  if (send) send.disabled = Boolean(S.chatStatus);
}

function renderQQMessagesOnly() {
  const target = $('#qq-message-stream');
  if (target) target.innerHTML = qqMessagesHtml();
}

function qqMessagesHtml() {
  if (!S.qqMessages.length) return `<div class="empty" style="padding:24px 10px">${icon('qq')}<h3>还没有 QQ 消息</h3><p>连接 SnowLuma 并启动监听后，白名单内的消息会出现在这里。</p></div>`;
  return [...S.qqMessages].reverse().slice(0, 60).map((message) => `<div class="qq-msg ${message.outgoing ? 'out' : ''}">
    <div class="qq-msg-head"><b>${esc(message.senderName || (message.outgoing ? '伴行' : '未知'))}</b><span>${timeShort(message.at)}</span>${message.outgoing ? badge('发出', 'badge-teal') : message.allowed ? (message.willReply ? badge('将回复', 'badge-coral') : badge(message.ignoredReason || '仅记录', 'badge-outline')) : badge(message.accessReason || '忽略', 'badge-outline')}</div>
    <p>${esc(message.text || '（非文本消息）')}</p>
  </div>`).join('');
}

// ── views: memory ───────────────────────────────────────────────────────────
const MEMORY_TABS = [
  ['knowledge', '知识库', 'brain'],
  ['relationship', '关系记忆', 'heart'],
  ['worklogs', '工作日志', 'work'],
  ['weights', '权重轨迹', 'chart'],
  ['multimodal', '多模态', 'camera'],
  ['reflections', '反思', 'sparkle']
];

function viewMemory() {
  const data = S.memoryData;
  if (!data) return `<div class="page"><div class="empty">${icon('brain')}<h3>正在打开记忆库…</h3><p>读取工作目录下的分层记忆。</p></div></div>`;
  const stats = data.stats || {};
  const tab = S.memoryTab;
  const stickerLabels = data.stickerLabels;
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">FIVE LAYERS · LOCAL ONLY</div><h1 class="page-title">记忆不是一堆聊天记录</h1><p class="page-desc">知识、关系、工作日志、权重轨迹和多模态素材各司其职。关系记忆优先级最高；知识条目保留核验时间与来源。任何记错的内容都可以在卡片上手动修正或移除。</p></div><div class="page-actions">${stats.stale ? `<button class="btn" data-action="revalidate-all-stale">${icon('refresh')}复核过时 ${stats.stale}</button>` : ''}<button class="btn" data-action="open-add-relationship">${icon('plus')}关系</button><button class="btn btn-primary" data-action="open-add-knowledge">${icon('plus')}手动记一条</button></div></div>
    <div class="memory-toolbar">
      <form class="row" data-form="memory-search" style="flex:1">
        <input class="input" name="query" placeholder="在五层记忆里回忆…" value="${esc(S.memorySearch?.query || '')}" style="max-width:460px">
        <button class="btn" type="submit">${icon('search')}召回</button>
      </form>
      <span class="small muted">${num(stats.knowledge||0)} 知识 · ${num(stats.relationship||0)} 关系 · ${num(stats.stale||0)} 待复核</span>
      ${stickerLabels ? `<span class="small muted">表情标注 ${stickerLabels.labeled || stickerLabels.done || 0} 张${stickerLabels.unlabeled ? ` · 待标 ${stickerLabels.unlabeled}` : ' · 已全部标注'}</span>` : ''}${stickerLabels?.unlabeled ? `<button class="btn btn-sm" data-action="label-stickers">${icon('sparkle')}识别并标记 ${stickerLabels.unlabeled} 张表情</button>` : ''}<button class="btn btn-sm btn-ghost" data-action="memory-curate" title="自动整理重复/未验证知识">${icon('sparkle')}整理知识库</button><button class="btn btn-sm btn-ghost" data-action="memory-refresh" title="重新读取记忆库">${icon('refresh')}刷新</button>
    </div>
    ${S.memorySearch ? `<section class="card" style="margin-bottom:14px"><div class="card-title">${icon('search')}召回预览<span class="card-actions"><button class="btn btn-sm btn-ghost" data-action="clear-memory-search">关闭</button></span></div><div class="memory-card-body">${esc(S.memorySearch.text || '没有命中相关记忆。')}</div></section>` : ''}
    <div class="memory-tabs">${MEMORY_TABS.map(([id, label, ico]) => {
      const count = id === 'knowledge' ? stats.knowledge : id === 'relationship' ? stats.relationship : id === 'worklogs' ? stats.worklogs : id === 'multimodal' ? stats.multimodal : id === 'weights' ? data.weights?.length : data.reflections?.length;
      return `<button class="memory-tab ${tab===id?'active':''}" data-action="memory-tab" data-tab="${id}">${icon(ico)}${label}<span class="count">${num(count||0)}</span></button>`;
    }).join('')}</div>
    <div id="memory-content">${memoryTabContent(data, tab)}</div>
  </div>`;
}

function memoryTabContent(data, tab) {
  if (tab === 'knowledge') {
    if (!data.knowledge?.length) return emptyMemory('知识库还是空的', '通过“学习闭环”查证事实，或手动记录已有可靠来源的资料。只有带核验记录的内容才适合作为事实使用。');
    return `<div class="memory-list">${data.knowledge.map((item) => `<article class="memory-card">
      <div class="memory-card-head"><h3>${esc(item.title)}</h3><div class="memory-actions">${badge(item.stale ? '可能过时' : item.status === 'active' ? '已归档' : item.status === 'conflict' ? '冲突待裁决' : item.status === 'candidate' ? '候选' : item.status, item.stale ? 'badge-danger' : item.status === 'active' ? 'badge-teal' : item.status === 'conflict' ? 'badge-danger' : 'badge-gold')}${badge(`核验 ${timeShort(item.verifiedAt)}`, 'badge-outline')}</div></div>
      <div class="memory-card-body">${esc(item.content)}</div>
      <div class="memory-meta"><div class="confidence ${Number(item.confidence) < .55 ? 'low' : ''}"><span>置信</span><div class="confidence-bar"><span style="width:${Math.round(Number(item.confidence||0)*100)}%"></span></div><b>${pct(Number(item.confidence||0)*100)}</b></div><span>${esc((item.tags||[]).map(t=>'#'+t).join(' '))}</span><span>创建 ${timeShort(item.createdAt)}</span>${item.stale ? '<span style="color:#b6473c">已超过时效窗口</span>' : ''}</div>
      ${(item.sources||[]).length ? `<div class="source-list">${item.sources.slice(0,6).map((source)=>safeUrl(source.url)?`<a class="source-link" href="#" data-url="${esc(source.url)}">${icon('link')}${esc(source.title||source.domain||source.url)}</a>`:`<span class="source-link">${esc(source.title||'来源')}</span>`).join('')}</div>`:''}
      <div class="memory-actions" style="margin-top:9px;margin-left:0">
        <button class="btn btn-sm" data-action="revalidate-knowledge" data-id="${esc(item.id)}">${icon('refresh')}重新核验</button>
        <button class="btn btn-sm btn-ghost" data-action="edit-knowledge" data-id="${esc(item.id)}">编辑</button>
        ${item.status !== 'archived' ? `<button class="btn btn-sm btn-ghost" data-action="archive-knowledge" data-id="${esc(item.id)}">归档</button>` : ''}
      </div>
    </article>`).join('')}</div>`;
  }
  if (tab === 'relationship') {
    if (!data.relationship?.length) return emptyMemory('还没有关系记忆', '用户明确说出的偏好、边界、情感事件或人格画像会出现在这里。它独立于知识库，检索优先级更高。');
    const labels = { preference: '稳定偏好', emotional_event: '情感事件', emotional_material: '自学习情感材料', persona: '人格画像', boundary: '边界', important_person: '重要的人' };
    return `<div class="relation-grid">${data.relationship.map((item) => {
      const materialText = String(item.content || '');
      const materialEmotional = !/(AI|人工智能|模型|系统|算法|技术|数据库|检索)/i.test(materialText)
        && /(人类|人的|情感|情绪|关系|陪伴|孤独|亲密|信任|共情|依恋|爱|思念|沟通|心理|安慰|悲伤|失去|幸福|愤怒|恐惧|羞耻|内疚|友谊|家庭)/i.test(materialText);
      const memoryClass = item.kind === 'emotional_material'
        ? (materialEmotional ? 'emotional' : 'stable')
        : (item.memoryClass || (item.kind === 'emotional_event' ? 'emotional' : 'stable'));
      const classBadge = memoryClass === 'emotional' ? badge('情感记忆 · 当时感受','badge-gold') : badge('稳定关系','badge-teal');
      return `<article class="relation-card ${memoryClass === 'emotional' ? 'emotional' : ''}"><span class="relation-kind">${esc(labels[item.kind] || item.kind)}</span>${classBadge}${item.nickname ? `<span class="relation-person">${esc(item.nickname)}${item.personId ? ` · ${esc(String(item.personId).replace(/^qq:/, 'QQ '))}` : ''}</span>` : ''}<h4>${esc(item.title || item.content)}</h4><p>${esc(item.content)}</p><div class="memory-meta"><span>提及 ${num(item.mentions||1)} 次</span><span>${timeAgo(item.updatedAt)}</span>${item.editedBy === 'user' ? badge('已手改','badge-gold') : ''}<button class="btn btn-sm btn-ghost" style="margin-left:auto" data-action="edit-relationship" data-id="${esc(item.id)}">编辑</button><button class="btn btn-sm btn-ghost" data-action="delete-relationship" data-id="${esc(item.id)}">移除</button></div></article>`;
    }).join('')}</div>`;
  }
  if (tab === 'worklogs') {
    const active = data.activeWork || [];
    const logs = data.worklogs || [];
    if (!active.length && !logs.length) return emptyMemory('没有工作记录', '当对话出现明确的工作任务时，伴行会自动开始跟踪；超过 5 小时没有工作信号后会压缩为工作日志，并留下可恢复的话题锚点。');
    return `<div class="memory-list">
      ${active.map((item) => `<article class="memory-card active-work"><div class="worklog"><div class="worklog-rail"><b>进行中</b><span>${timeAgo(item.lastActiveAt)}</span></div><div class="worklog-body"><h3>${esc(item.title)}</h3><p>${esc(item.objective || '')}</p><div class="memory-meta"><span>${num(item.messageCount)} 轮上下文</span><span>开始 ${timeShort(item.startedAt)}</span><button class="btn btn-sm btn-ghost" style="margin-left:auto" data-action="edit-active-work" data-channel="${esc(item.channel)}">编辑</button><button class="btn btn-sm btn-ghost" data-action="archive-work" data-channel="${esc(item.channel)}">现在归档</button></div></div></div></article>`).join('')}
      ${logs.map((log) => `<article class="memory-card"><div class="worklog"><div class="worklog-rail"><b>${timeShort(log.lastActiveAt).slice(0,5)}</b><span>${timeShort(log.archivedAt).slice(0,10)}</span></div><div class="worklog-body"><h3>${esc(log.title)}</h3><p>${esc(log.summary)}</p>${log.nextSteps ? `<p><b>下一步：</b>${esc(log.nextSteps)}</p>` : ''}<div class="memory-meta"><span>${esc(log.reason === 'idle' || log.reason === 'idle-transfer' ? '超过 5 小时自动转存' : log.reason === 'weight-zero' ? '旧版权重归零归档' : log.reason)}</span><span>${num(log.messageCount)} 轮</span>${log.editedBy === 'user' ? badge('已手改','badge-gold') : ''}<button class="btn btn-sm btn-ghost" style="margin-left:auto" data-action="edit-worklog" data-id="${esc(log.id)}">编辑</button></div></div></div></article>`).join('')}
    </div>`;
  }
  if (tab === 'weights') {
    const history = [...(data.weights||[])].reverse();
    if (!history.length) return emptyMemory('还没有权重轨迹', '每一次发言都会让工作/陪伴/学习三个维度发生变化。强信号会快速重加权，没有信号时按指数回到基线。');
    return `<div class="memory-list">${history.map((event) => `<article class="memory-card"><div class="memory-card-head"><div class="weight-delta">${timeShort(event.at)}</div><div class="memory-card-body" style="margin:0;flex:1"><b>${esc((event.drivers||[]).join(' · '))}</b><div class="small muted">${esc(event.excerpt || '')}</div></div><div class="memory-actions">${badge('工 '+pct(event.normalized?.work||0),'badge-teal')}${badge('伴 '+pct(event.normalized?.companion||0),'badge-coral')}${badge('学 '+pct(event.normalized?.learning||0),'badge-gold')}${event.eventType === 'decay' ? badge('时间衰减','badge-outline') : event.eventType === 'ai_tune' ? badge('AI 微调','badge-teal') : event.eventType === 'anchor_restore' ? badge('锚点恢复','badge-gold') : event.eventType === 'learning_done' ? badge('学习回落','badge-teal') : event.eventType !== 'drift' ? badge('快变量','badge-gold') : ''}</div></div></article>`).join('')}</div>`;
  }
  if (tab === 'multimodal') {
    if (!data.multimodal?.length) return emptyMemory('没有多模态记忆', '用户发来的表情包、图片、音频，QQ 图片、手机截图和伴行生成的图片都会保存在这里，并保留来源与时间。');
    return `<div class="row" style="margin-bottom:9px"><span class="small muted">表情包按内容 hash 去重；普通图片不会当表情。手机截图只进临时缓存，不在这里。</span><button class="btn btn-sm" style="margin-left:auto" data-action="memory-dedupe">${icon('sparkle')}去重多模态</button></div><div class="gallery">${data.multimodal.map((item) => {
      if (item.mime?.startsWith('image/')) {
        return `<div class="gallery-item"><img src="${esc(item.url)}" alt="${esc(item.caption||item.fileName)}" data-action="open-image" data-media-url="${esc(item.url)}" data-caption="${esc(item.caption||item.fileName)}" loading="lazy"><div class="cap">${item.kind === 'sticker' || item.folder === 'stickers' ? badge('表情包','badge-gold') : ''} ${esc(item.stickerCaption || item.caption || item.fileName)}<br>${(item.stickerEmotion || []).length ? `<span class="tiny">情绪：${esc(item.stickerEmotion.join('、'))}</span><br>` : ''}${(item.stickerScenes || []).length ? `<span class="tiny">场景：${esc(item.stickerScenes.slice(0, 3).join('、'))}</span><br>` : ''}${timeShort(item.createdAt)}${item.folder === 'stickers' ? ' · memory/stickers' : ''}${item.editedBy === 'user' ? ' · 已手改' : ''}<br><button class="btn btn-sm btn-ghost" data-action="edit-media" data-id="${esc(item.id)}">编辑说明</button><button class="btn btn-sm btn-ghost btn-danger-text" data-action="delete-media" data-id="${esc(item.id)}">删除</button></div></div>`;
      }
      if (item.mime?.startsWith('audio/')) {
        return `<div class="gallery-item file"><span>${esc(item.caption||item.fileName)}</span><audio controls preload="none" src="${esc(item.url)}" style="width:100%;height:30px"></audio><span class="tiny">${esc(item.kind)} · ${num(Math.round((item.bytes||0)/1024))}KB</span><button class="btn btn-sm btn-ghost" data-action="edit-media" data-id="${esc(item.id)}">编辑说明</button><button class="btn btn-sm btn-ghost btn-danger-text" data-action="delete-media" data-id="${esc(item.id)}">删除</button></div>`;
      }
      return `<div class="gallery-item file">${icon('paperclip')}<span>${esc(item.caption||item.fileName)}</span><span class="tiny">${esc(item.kind)} · ${num(Math.round((item.bytes||0)/1024))}KB</span><button class="btn btn-sm btn-ghost" data-action="edit-media" data-id="${esc(item.id)}">编辑说明</button><button class="btn btn-sm btn-ghost btn-danger-text" data-action="delete-media" data-id="${esc(item.id)}">删除</button></div>`;
    }).join('')}</div>`;
  }
  if (tab === 'reflections') {
    if (!data.reflections?.length) return emptyMemory('还没有反思', '权重轨迹积累到一定数量后，伴行会生成一次不向用户展示的自我校准；你也可以在成长轨迹手动生成。');
    return `<div class="memory-list">${data.reflections.map((item) => `<div class="reflection"><div class="memory-meta" style="margin-bottom:5px">${badge(item.kind==='weight'?'权重反思':'反思','badge-gold')}<span>${timeShort(item.createdAt)}</span></div><p>${esc(item.content)}</p></div>`).join('')}</div>`;
  }
  return '';
}

function emptyMemory(title, body) {
  return `<div class="empty">${icon('brain')}<h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
}

// ── views: role ─────────────────────────────────────────────────────────────
function viewRole() {
  const data = S.data.persona || {};
  const profile = data.profile;
  if (!profile) return `<div class="page"><div class="empty">${icon('heart')}<h3>正在读取角色设定…</h3></div></div>`;
  const history = data.history || [];
  const evidence = profile.lastEvidence || [];
  const stability = profile.stability || {};
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">EMERGENT SELF × MEMORY LAYERS</div><h1 class="page-title">这个个体是谁，不是一张写死的卡</h1><p class="page-desc">基础身份和边界保持稳定；知识线决定怎么求真，情感线由长期情感记忆筛选分层形成。知识可以更聪明，情感记忆让人更有人情味；两者不混写。</p></div><div class="page-actions"><button class="btn" data-action="role-refresh">${icon('refresh')}刷新</button><button class="btn" data-action="open-persona-edit">${icon('edit')}编辑两条线</button><button class="btn btn-primary" data-action="persona-calibrate">${icon('sparkle')}根据记忆校准知识线</button></div></div>
    <section class="card role-identity">
      <div class="role-avatar">伴</div>
      <div style="min-width:0"><div class="tiny muted">IDENTITY · 不可由 AI 修改</div><h2>${esc(profile.identity?.name || '伴行')}</h2><p>${esc(profile.identity?.role || '陪伴工作型智能体')} · 与你的关系：${esc(profile.identity?.relationship || '长期同行的伙伴')}</p></div>
      <div class="role-meta">${badge(`修订 r${profile.revision || 0}`, 'badge-teal')}<span class="tiny muted">最近 ${timeAgo(profile.updatedAt)} · ${esc(profile.updatedBy === 'ai' ? 'AI 修订' : profile.updatedBy === 'user' ? '你修订' : '初始设定')}</span></div>
    </section>
    <div class="grid grid-2" style="margin-top:14px">
      <section class="card role-line-card knowledge-line">
        <div class="role-line-head"><span class="role-line-icon">${icon('search')}</span><div><b>知识线</b><small>怎么求真、怎么处理不确定</small></div><button class="btn btn-sm btn-ghost" data-action="open-persona-edit">编辑</button></div>
        <div class="role-line-text">${esc(profile.knowledgeLine?.text || '')}</div>
        <div class="tiny muted" style="margin-top:10px">最近更新：${timeAgo(profile.knowledgeLine?.updatedAt)} · ${esc(profile.knowledgeLine?.updatedBy === 'ai' ? 'AI' : '你')}</div>
      </section>
      <section class="card role-line-card emotion-line">
        <div class="role-line-head"><span class="role-line-icon">${icon('heart')}</span><div><b>情感线</b><small>怎么陪伴、怎么保持边界</small></div><button class="btn btn-sm btn-ghost" data-action="open-persona-edit">编辑</button></div>
        <div class="role-line-text">${esc(profile.emotionLine?.text || '')}</div>
        <div class="tiny muted" style="margin-top:10px">最近更新：${timeAgo(profile.emotionLine?.updatedAt)} · ${esc(profile.emotionLine?.updatedBy === 'ai-layer' ? '情感记忆分层' : profile.emotionLine?.updatedBy === 'ai' ? '内部校准' : '你')}</div>
      </section>
    </div>
    <section class="card" style="margin-top:14px">
      <div class="card-title">${icon('heart')}第一人称情感记忆 <span class="card-actions"><span class="tiny muted">先记录，再筛选分层；不直接改人格</span></span></div>
      ${(data.emotionalMemory || []).length ? `<div class="relation-grid">${data.emotionalMemory.slice(0, 8).map((item) => `<article class="relation-card emotional"><span class="relation-kind">情感记忆</span>${badge(item.mood || '未命名情绪','badge-gold')}<h4>${esc(item.content.slice(0, 80))}</h4><p>${esc(item.content)}</p><div class="memory-meta"><span>${timeAgo(item.createdAt)}</span><span>强度 ${num(Math.round(Number(item.intensity || 0) * 100))}%</span><span>${esc(item.source || 'ai')}</span></div></article>`).join('')}</div>` : '<div class="empty-rail" style="padding:24px">还没有第一人称情感记忆。聊天中遇到值得留下的感受时，内部会先写一条；你也可以通过对话让它记下。</div>'}
    </section>
    <div class="grid grid-2" style="margin-top:14px;align-items:start">
      <section class="card"><div class="card-title">${icon('shield')}不可更改的边界</div><div class="answer-box">${esc(profile.boundaries || '')}</div><div class="notice" style="margin-top:10px">${icon('shield')}<div>AI 只能通过 <span class="code-inline">persona_update</span> 小步修改两条线，必须引用真实记忆 ID；身份、关系和安全边界不在可编辑范围内。每次修订都会写入 <span class="code-inline">data/persona/revisions.jsonl</span>。</div></div></section>
      <section class="card"><div class="card-title">${icon('link')}本次修订的证据<span class="card-actions"><span class="tiny muted">${evidence.length} 条</span></span></div>
        ${evidence.length ? `<div class="memory-list">${evidence.map((item)=>`<div class="evidence-row">${badge(item.layer,'badge-outline')}<span>${esc(item.title)}</span><code>${esc(item.id.slice(-8))}</code></div>`).join('')}</div>` : `<div class="empty-rail">还没有 AI 修订证据。初始角色线由应用生成；你手动编辑会记录为 user 修订。</div>`}
        <div class="tiny muted" style="margin-top:8px">最近理由：${esc(profile.lastReason || '—')}</div>
      </section>
    </div>
    <section class="card stability-card" style="margin-top:14px">
      <div class="card-title">${icon('shield')}人格稳定性<span class="card-actions">${stability.locked ? badge('AI 自学习已锁定','badge-gold') : badge('AI 小步演化开启','badge-teal')}</span></div>
      <div class="stability-grid"><div class="kv"><span>人格稳定化次数</span><b>不限</b></div><div class="kv"><span>冷却</span><b>已移除</b></div><div class="kv"><span>稳定核心证据</span><b>${num(stability.stableCore || 0)}</b></div><div class="kv"><span>情绪事件证据</span><b>${num(stability.emotionalEvidence || 0)}</b></div></div>
      ${stability.recentEmotionalEvents ? `<p class="small muted" style="margin:7px 0 0">近 7 天有 ${num(stability.recentEmotionalEvents)} 条情绪事件；情感线不靠一次情绪直接改写，而是先进入第一人称情感记忆再分层。</p>` : ''}
      <p class="small muted" style="margin:9px 0 0">${esc(stability.note || '')} 稳定知识线至少需要 ${num(stability.minEvidence || 3)} 条真实证据；主要时间门槛：${Number(stability.minSpanDays ?? 0) === 0 ? '已移除' : `${num(stability.minSpanDays)} 天`}；情感线由反复主题分层形成，不按天数硬等。</p>
      <div class="stability-actions"><div class="switchline" style="margin:0;flex:1"><div class="switch-copy">允许自学习形成人格<small>情感线来自第一人称情感记忆；不限次数、无冷却</small></div><label class="switch"><input type="checkbox" data-persona-lock ${stability.locked ? 'checked' : ''}><span></span></label></div><button class="btn btn-sm btn-ghost" data-action="persona-rollback">回滚上一版</button></div>
    </section>
    <section class="card" style="margin-top:14px"><div class="card-title">${icon('clock')}修订历史<span class="card-actions"><span class="tiny muted">${history.length} 条</span></span></div>
      ${history.length ? `<div class="memory-list">${history.slice(0,8).map((rev)=>`<div class="revision-row"><div>${badge(rev.by === 'ai' ? 'AI' : '你', rev.by === 'ai' ? 'badge-teal' : 'badge-gold')}<b>r${rev.revision}</b><span class="tiny muted">${timeShort(rev.at)}</span></div><p>${esc(rev.reason || '')}</p>${(rev.evidence||[]).length?`<div class="tiny muted">证据：${rev.evidence.map((item)=>esc(item.title)).join(' · ')}</div>`:''}</div>`).join('')}</div>` : `<div class="empty-rail">还没有修订。点击“让 AI 根据记忆校准”或手动编辑。</div>`}
    </section>
  </div>`;
}

function openPersonaEdit() {
  const p = S.data.persona?.profile;
  if (!p) return;
  openModal(`<div class="modal-head"><h2>编辑角色线</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="persona-edit">
      <div class="field"><label>知识线 · 怎么求真</label><textarea class="textarea" name="knowledgeLine" rows="5" maxlength="2200">${esc(p.knowledgeLine?.text || '')}</textarea></div>
      <div class="field" style="margin-top:10px"><label>情感线 · 怎么陪伴</label><textarea class="textarea" name="emotionLine" rows="5" maxlength="2200">${esc(p.emotionLine?.text || '')}</textarea></div>
      <div class="field" style="margin-top:10px"><label>修改理由（可选）</label><input class="input" name="reason" placeholder="例如：希望减少说教，更多先接住情绪"></div>
      <div class="notice" style="margin-top:10px">${icon('shield')}<div>身份、关系和安全边界不在此表单内。手动修改会记录为 user 修订；AI 修改必须引用记忆证据。</div></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存两条线</button></div>
    </form>`);
}

// ── views: people / impressions ─────────────────────────────────────────────
function channelLabel(channel) {
  if (channel === 'desktop') return '桌面';
  if (String(channel).startsWith('qq_group_')) return `群 ${String(channel).slice(9)}`;
  if (String(channel).startsWith('qq_private_')) return '私聊';
  return String(channel);
}

function viewPeople() {
  const list = S.data.people || [];
  const stats = S.data.peopleStats || {};
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">PEOPLE × AFFINITY × IMPRESSION</div><h1 class="page-title">群里和私聊里的人，都在同一本账上</h1><p class="page-desc">以 QQ 号作为稳定身份，昵称变化会自动刷新；亲近度随对话动态变化，印象会随近期聊天更新。你可以随时删除，或打开手动修改，让 AI 暂停改写。</p></div><div class="page-actions"><button class="btn" data-action="people-refresh">${icon('sparkle')}刷新印象</button></div></div>
    <div class="stat-grid people-stats">
      <div class="stat">${icon('users','stat-icon')}<div class="stat-copy"><span>见过的人</span><b>${num(stats.total || 0)}</b><small>群聊与私聊合并去重</small></div></div>
      <div class="stat">${icon('heart','stat-icon')}<div class="stat-copy"><span>平均亲近度</span><b>${num(stats.averageAffinity || 0)}</b><small>0-100，按对话信号缓慢变化</small></div></div>
      <div class="stat">${icon('edit','stat-icon')}<div class="stat-copy"><span>手动锁定</span><b>${num(stats.manual || 0)}</b><small>锁定后 AI 不再自动改写</small></div></div>
      <div class="stat">${icon('qq','stat-icon')}<div class="stat-copy"><span>群聊出现过</span><b>${num(stats.groups || 0)}</b><small>只在群聊里见过的人</small></div></div>
    </div>
    ${list.length ? `<div class="people-grid">${list.map((person) => {
      const affinity = Math.max(0, Math.min(100, Number(person.affinity ?? 50)));
      const initial = String(person.nickname || person.qq || '?').trim().slice(0, 1) || '?';
      return `<article class="card person-card ${person.manual ? 'manual' : ''}">
        <div class="person-top"><div class="person-avatar">${esc(initial)}</div><div class="person-name"><h3>${esc(person.nickname || '未知昵称')}</h3><div class="person-qq">QQ ${esc(person.qq || '未记录')} <span class="tiny">· ${person.manual ? '手动锁定' : 'AI 动态'}</span></div></div><div class="person-manual"><span class="tiny">手动</span><label class="switch person-switch" title="手动锁定：AI 不再自动改写亲近度和印象"><input type="checkbox" data-person-manual="${esc(person.id)}" ${person.manual ? 'checked' : ''}><span></span></label></div></div>
        <div class="affinity-line"><span>亲近度</span><div class="affinity-bar"><i style="width:${affinity}%"></i></div><b>${affinity}</b></div>
        <div class="person-impression">${esc(person.impression || '还没有形成印象。等几次对话后自动刷新，或点右上角“刷新印象”。')}</div>
        <div class="person-meta"><span>${timeAgo(person.lastSeenAt)}</span><span>${num(person.messageCount || 0)} 条</span>${(person.channels || []).slice(0, 3).map((channel) => badge(channelLabel(channel), 'badge-outline')).join('')}</div>
        ${(person.aliases || []).length ? `<div class="tiny muted person-aliases">曾用昵称：${person.aliases.map((alias) => esc(alias)).join('、')}</div>` : ''}
        <div class="person-actions"><button class="btn btn-sm btn-ghost" data-action="edit-person" data-id="${esc(person.id)}">${icon('edit')}编辑</button><button class="btn btn-sm btn-ghost btn-danger-text" data-action="delete-person" data-id="${esc(person.id)}">删除</button></div>
      </article>`;
    }).join('')}</div>` : `<div class="card"><div class="empty">${icon('users')}<h3>还没有见过任何人</h3><p>连接 QQ 后，群聊与私聊里出现的联系人会自动进入这里；QQ 号作为稳定身份，昵称变化会自动刷新。</p></div></div>`}
  </div>`;
}

function openPersonEdit(id) {
  const person = (S.data.people || []).find((item) => item.id === id);
  if (!person) return;
  openModal(`<div class="modal-head"><h2>编辑印象 · ${esc(person.nickname || person.qq)}</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="person-edit">
      <input type="hidden" name="id" value="${esc(person.id)}">
      <div class="person-identity-box"><b>${esc(person.nickname || '未知昵称')}</b><span>QQ ${esc(person.qq || '未记录')}</span><small>QQ 号是主键；昵称由 QQ 资料变化自动刷新，不在这里手动改。</small></div>
      <div class="field" style="margin-top:12px"><div class="activity-subhead"><span>亲近度</span><output data-output="personAffinity">${Number(person.affinity ?? 50)}</output><span>/100</span></div><input class="activity-range" type="range" min="0" max="100" step="1" name="affinity" value="${Number(person.affinity ?? 50)}" data-output="personAffinity"></div>
      <div class="field" style="margin-top:10px"><label>印象</label><textarea class="textarea" name="impression" rows="4" maxlength="600" placeholder="一句简短的相处印象">${esc(person.impression || '')}</textarea></div>
      <div class="switchline" style="margin-top:10px"><div class="switch-copy">手动修改（锁定）<small>开启后 AI 不再自动改写亲近度和印象；关闭后恢复动态更新</small></div><label class="switch"><input type="checkbox" name="manual" ${person.manual ? 'checked' : ''}><span></span></label></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存印象</button></div>
    </form>`);
}

async function loadPeople() {
  try {
    const data = await call('people:list');
    S.data.people = data.people;
    S.data.peopleStats = data.stats;
    if (S.route === 'people') render();
  } catch (error) { toast(error.message, 'error'); }
}

// ── views: diary ────────────────────────────────────────────────────────────
function viewDiary() {
  const entries = S.data?.diary || [];
  const emotional = S.data?.persona?.emotionalMemory || [];
  const latestEmotion = emotional[0];
  const emotionIntensity = Math.round(Number(latestEmotion?.intensity || 0) * 100);
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">PRIVATE NOTES · LOCAL ONLY</div><h1 class="page-title">今天，留下一点东西</h1><p class="page-desc">伴行可以自己写日记，也可以由你手写。日记只保存在工作目录，不会被当成知识事实，也不会自动发给 QQ。</p></div><div class="page-actions"><button class="btn" data-action="diary-write">${icon('edit')}手写一篇</button><button class="btn btn-primary" data-action="diary-generate">${icon('sparkle')}让 AI 写今天</button></div></div>
    <section class="card" style="margin-bottom:14px">
      <div class="card-title">${icon('heart')}此刻的情绪状态<span class="card-actions">${latestEmotion ? badge(latestEmotion.mood || '未命名情绪','badge-gold') : badge('平静','badge-outline')}</span></div>
      <div class="row" style="gap:12px;align-items:center"><div style="flex:1"><div class="affinity-bar"><i style="width:${Math.max(4, emotionIntensity)}%;background:linear-gradient(90deg,#d8a35d,#b6473c)"></i></div></div><b>${emotionIntensity}%</b><span class="tiny muted">来自最近一条第一人称情感记忆</span></div>
      <p class="small muted" style="margin:8px 0 0">${esc(latestEmotion?.content || S.data.persona?.profile?.emotionLine?.text || '还没有形成今天的情感底色。')}</p>
    </section>
    ${entries.length ? `<div class="diary-list">${entries.map((item) => `<article class="card diary-card"><div class="diary-head"><span class="diary-date">${esc(item.date || '')}</span>${item.mood ? badge(item.mood, 'badge-gold') : ''}${badge(item.source === 'ai' ? 'AI 写的' : '你写的', item.source === 'ai' ? 'badge-teal' : 'badge-outline')}<button class="btn btn-sm btn-ghost" style="margin-left:auto" data-action="diary-delete" data-id="${esc(item.id)}">删除</button></div><h3>${esc(item.title || '无题')}</h3><p>${esc(item.content)}</p><div class="memory-meta"><span>${timeShort(item.createdAt)}</span>${(item.tags || []).map((tag) => `<span>#${esc(tag)}</span>`).join('')}</div></article>`).join('')}</div>` : `<div class="empty" style="padding:60px 10px">${icon('book')}<h3>还没有日记</h3><p>手写一篇，或者让 AI 回看今天的对话后写一篇。它不会把日记内容当成事实四处引用。</p></div>`}
  </div>`;
}

// ── views: music ────────────────────────────────────────────────────────────
function viewMusic() {
  const now = S.musicNow;
  const lyrics = S.musicLyrics;
  const tracks = S.musicTracks || [];
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">EARS × VOICE · LOCAL DEBUG</div><h1 class="page-title">听你正在听的，也唱给你听</h1><p class="page-desc">一键探测网易云 PC 版的 CDP 耳朵；点歌优先走客户端，失败时回退到公开直链并真的在本机播放。本地 TTS 生成清唱语音，AI 在 QQ 会话中会发送语音。</p></div><div class="page-actions"><button class="btn" data-action="music-now">${icon('refresh')}读取正在播放</button><button class="btn btn-primary" data-action="music-connect">${icon('search')}一键探测 / 接入</button></div></div>
    <div class="grid grid-2" style="align-items:start">
      <section class="card music-now">
        <div class="card-title">${icon('music')}此刻在听<span class="card-actions">${S.data.music?.cdpPort ? badge(`CDP ${S.data.music.cdpPort}`,'badge-outline') : ''}</span></div>
        ${now ? `<div class="music-now-title">${esc(now.title || '未知歌曲')}</div><div class="small muted">${esc(now.artist || '')}${now.playing ? ' · 播放中' : ' · 已暂停'}</div>${now.currentLine ? `<blockquote class="music-line">「${esc(now.currentLine)}」</blockquote>` : ''}` : '<div class="empty-rail" style="padding:24px">点“一键探测 / 接入”，会自动查找网易云并尝试打开 CDP 端口。</div>'}
        ${S.musicConnect ? `<div class="model-diagnostic">${icon('search')}<span>${esc(S.musicConnect)}</span></div>` : ''}
        <div class="field-row" style="margin-top:8px"><div class="field" style="flex:1"><label>网易云路径（探测不到时手动指定）</label><div class="inline-fields"><input class="input" id="music-exe-path" value="${esc(S.data.config.music?.cloudMusicPath||'')}" placeholder="...\\cloudmusic.exe"><button class="btn btn-sm" type="button" data-action="choose-path" data-kind="file" data-target="music-exe-path">浏览</button><button class="btn btn-sm" type="button" data-action="music-save-path">保存路径</button></div></div></div>
        ${S.musicError ? `<div class="model-diagnostic">${icon('warning')}<span>${esc(S.musicError)}</span></div>` : ''}
        <div class="music-controls"><button class="btn btn-sm" data-action="music-control" data-command="play">播放</button><button class="btn btn-sm" data-action="music-control" data-command="pause">暂停</button><button class="btn btn-sm" data-action="music-control" data-command="next">下一首</button><button class="btn btn-sm" data-action="music-control" data-command="previous">上一首</button></div>
      </section>
      <section class="card">
        <div class="card-title">${icon('search')}点一首 / 查歌词</div>
        <form data-form="music-search"><div class="inline-fields"><input class="input" name="query" placeholder="歌名，例如：遐想"><button class="btn btn-primary" type="submit">搜索</button></div></form>
        ${tracks.length ? `<div class="music-tracks">${tracks.map((track) => `<div class="music-track"><div><b>${esc(track.name)}</b><small>${esc(track.artists)}</small></div><button class="btn btn-sm btn-ghost" data-action="music-lyrics" data-id="${esc(track.id)}" data-name="${esc(track.name)}" data-artist="${esc(track.artists)}">歌词</button><button class="btn btn-sm btn-ghost" data-action="music-play" data-name="${esc(track.name)}" data-artist="${esc(track.artists)}">播放</button></div>`).join('')}</div>` : '<div class="empty-rail" style="padding:18px">搜索后会列出歌曲。</div>'}
      </section>
    </div>
    <div class="grid grid-2" style="margin-top:14px;align-items:start">
      <section class="card">
        <div class="card-title">${icon('edit')}歌词<span class="card-actions">${lyrics ? esc(lyrics.name) : ''}</span></div>
        ${lyrics ? `<pre class="music-lyrics">${esc((lyrics.lines || []).join('\n'))}</pre>` : '<div class="empty-rail" style="padding:24px">选一首歌后读取歌词。AI 也可以调用 music_lyrics 在对话里接一句。</div>'}
      </section>
      <section class="card">
        <div class="card-title">${icon('sparkle')}唱给你听<span class="card-actions">${badge('TTS / 可选 RVC','badge-gold')}</span></div>
        <form data-form="music-sing">
          <div class="field"><label>歌名（可选）</label><input class="input" name="song" placeholder="输入歌名，会取几句歌词"></div>
          <div class="field" style="margin-top:9px"><label>或直接写一句</label><textarea class="textarea" name="text" rows="3" placeholder="今天辛苦了，唱一句给你听。"></textarea></div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('music')}生成清唱</button></div>
        </form>
        ${S.musicAudio ? `<audio controls autoplay src="${esc(S.musicAudio)}" style="width:100%;margin-top:10px"></audio><div class="tiny muted" style="margin-top:6px">已生成 ${S.musicAudioBytes ? `${Math.round(S.musicAudioBytes/1024)} KB` : ''}；AI 在 QQ 会话中会直接发送语音。</div>` : ''}
        <div class="notice" style="margin-top:10px">${icon('warning')}<div>本地清唱使用 Windows SAPI，是朗读式声音，不会伪装成真人歌手。若已导入 RVC 音色，会自动过变声；失败回退 SAPI。</div></div>
      </section>
    </div>
    <section class="card" style="margin-top:14px">
      <div class="card-title">${icon('mic')}RVC 音色<span class="card-actions"><button class="btn btn-sm btn-ghost" data-action="music-import-voice">${icon('download')}一键导入训练好的音色</button><button class="btn btn-sm btn-ghost" data-action="open-rvc">${icon('external')}RVC 下载 / 教程</button></span></div>
      <p class="small muted" style="margin:0 0 9px">先用 RVC WebUI 训练自己的音色；这里直接导入 .pth 模型（同目录有 .index 会自动带上）。之后 AI 的清唱工具会使用当前音色，歌词由她自己抓取。</p>
      <form data-form="music-voice">
        <label class="checkline"><input type="checkbox" name="rvcEnabled" ${S.data.config.music?.voice?.rvcEnabled?'checked':''}>启用 RVC 变声（失败自动回退 SAPI）</label>
        <div class="field-row" style="margin-top:8px"><div class="field"><label>Python</label><div class="inline-fields"><input class="input" name="pythonPath" value="${esc(S.data.config.music?.voice?.pythonPath||'')}" placeholder="python.exe"><button class="btn btn-sm" type="button" data-action="choose-path" data-kind="file" data-target="pythonPath">浏览</button></div></div><div class="field"><label>RVC 目录</label><div class="inline-fields"><input class="input" name="repoPath" value="${esc(S.data.config.music?.voice?.repoPath||'')}" placeholder="Retrieval-based-Voice-Conversion-WebUI"><button class="btn btn-sm" type="button" data-action="choose-path" data-kind="directory" data-target="repoPath">浏览</button></div></div></div>
        <div class="field-row" style="margin-top:8px"><div class="field"><label>模型 .pth</label><div class="inline-fields"><input class="input" name="modelPath" value="${esc(S.data.config.music?.voice?.modelPath||'')}"><button class="btn btn-sm" type="button" data-action="choose-path" data-kind="file" data-target="modelPath">浏览</button></div></div><div class="field"><label>Index（可选）</label><div class="inline-fields"><input class="input" name="indexPath" value="${esc(S.data.config.music?.voice?.indexPath||'')}"><button class="btn btn-sm" type="button" data-action="choose-path" data-kind="file" data-target="indexPath">浏览</button></div></div><div class="field"><label>变调</label><input class="input" type="number" name="pitch" value="${Number(S.data.config.music?.voice?.pitch||0)}"></div></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">保存 RVC 配置</button></div>
      </form>
    </section>
  </div>`;
}

// ── views: growth ───────────────────────────────────────────────────────────
function viewGrowth() {
  const w = weights();
  const state = S.data.weights || {};
  const history = [...(state.history || [])];
  const reflections = S.memoryData?.reflections || S.data.learning?.reflections || [];
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">CONTINUOUS STATE VECTOR</div><h1 class="page-title">三个维度，不是状态机</h1><p class="page-desc">工作、陪伴、学习同时存在，连续值归一化。强信号触发快变量重加权，其他维度保留基线；没有新信号时按各自半衰期指数衰减。旧话题命中锚点时会恢复当时的权重。</p></div><div class="page-actions"><button class="btn btn-primary" data-action="reflect-now">${icon('sparkle')}生成一次反思</button></div></div>
    <div class="growth-hero">
      <section class="card growth-current">
        <div><div class="card-title">${icon('chart')}此刻</div><div class="growth-number work"><b>${w.work}</b><span>% 工作</span></div><div class="growth-label">${esc(state.mode?.detail || '同时在场')}</div></div>
        <div class="growth-split"><div><div class="growth-number companion" style="font-size:32px"><b>${w.companion}</b><span>% 陪伴</span></div><div class="growth-label">${esc(state.mode?.label || '三线并行')}</div></div><div><div class="growth-number learning" style="font-size:32px"><b>${w.learning}</b><span>% 学习</span></div><div class="growth-label">向基线 ${pct((state.baseline?.learning||.3)*100)} 回归</div></div><div><div class="kv"><span>累计漂移</span><b>${num(state.events||0)} 次</b></div><div class="kv"><span>最近更新</span><b>${timeAgo(state.updatedAt)}</b></div><div class="kv"><span>强信号目标（归一化前）</span><b>${Number(S.data.config?.weights?.highThreshold||.7).toFixed(2)}</b></div></div></div>
      </section>
      <section class="card chart-card">
        <div class="chart-head"><div class="card-title" style="margin:0">${icon('chart')}最近轨迹</div><div class="chart-legend"><span><i class="work"></i>工作</span><span><i class="companion"></i>陪伴</span><span><i class="learning"></i>学习</span></div></div>
        <div class="chart-wrap"><canvas id="weight-chart"></canvas></div>
        <div class="chart-note">横轴为最近 ${history.length} 个事件（含时间衰减/锚点/学习回落）；纵轴为归一化占比。</div>
      </section>
    </div>
    <div class="explain-grid">
      <div class="explain"><b>连续权重</b><p>每条消息只推动一点，避免在工作与陪伴之间硬切。</p></div>
      <div class="explain"><b>快变量 · 强信号</b><p>“我累了”会把目标维度抬到 0.70 的原始目标强度，其他维度保留 0.30 基线，再归一化；所以 UI 百分比会因其他维度而被摊薄，0.70 不是最终的界面 70%。</p></div>
      <div class="explain"><b>慢变量 · 指数衰减</b><p>没有新信号时，各维度按自己的半衰期指数回到基线；工作半衰期约 20 分钟，超过 5 小时才转存工作日志。</p></div>
    </div>
    <div class="activation-strip">
      <span class="activation-label">最新激活</span>
      ${[
        ['work', '工作', 'work'], ['companion', '陪伴', 'companion'], ['learning', '学习', 'learning']
      ].map(([key, label, cls]) => {
        const active = (state.lastEvent?.eventType || '').startsWith(key) || (state.lastEvent?.drivers || []).some((driver) => driver.includes(label));
        return `<span class="activation-pill ${cls} ${active ? 'active' : ''}"><i></i>${label}<b>${w[key]}%</b></span>`;
      }).join('')}
      <span class="tiny muted" style="margin-left:auto">本轮意图：${esc({ work: '工作推进', companion: '情感陪伴', learning: '学习查证', balanced: '并行' }[state.intent?.primary] || '并行')} · ${esc((state.lastEvent?.drivers || []).slice(0, 2).join(' · ') || '等待下一条信号')}</span>
    </div>
    <div class="grid grid-2" style="margin-top:15px">
      <section class="card"><div class="card-title">${icon('clock')}最近的移动<span class="card-actions"><button class="btn btn-sm btn-ghost" data-route="memory">更早的轨迹</button></span></div><div class="weight-events">${(state.history||[]).slice(-8).reverse().map((event)=>`<div class="weight-event"><div class="weight-delta">${timeShort(event.at)}</div><div class="weight-event-copy"><strong>${esc((event.drivers||[]).slice(0,2).join(' · '))}</strong><br><span class="small muted">${esc((event.excerpt||'').slice(0,80))}</span></div><div class="weight-event-badge">${event.eventType === 'decay' ? badge('时间衰减','badge-outline') : event.eventType === 'ai_tune' ? badge('AI 微调','badge-teal') : event.eventType === 'anchor_restore' ? badge('锚点恢复','badge-gold') : event.eventType === 'learning_done' ? badge('学习回落','badge-teal') : event.eventType !== 'drift' ? badge('高权重','badge-gold') : ''}</div></div>`).join('') || '<div class="empty-rail">还没有轨迹。</div>'}</div></section>
      <section class="card"><div class="card-title">${icon('sparkle')}反思<span class="card-actions"><button class="btn btn-sm btn-ghost" data-route="memory">全部</button></span></div>${reflections.length ? reflections.slice(0,3).map((item)=>`<div class="reflection" style="margin-bottom:8px"><p>${esc(item.content)}</p><div class="memory-meta"><span>${timeShort(item.createdAt)}</span></div></div>`).join('') : `<div class="empty-rail">还没有反思记录。轨迹积累后会自动生成，也可以手动生成一次。</div>`}</section>
    </div>
  </div>`;
}

function drawWeightChart() {
  const canvas = $('#weight-chart');
  if (!canvas) return;
  const history = [...(S.data?.weights?.history || [])];
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 520;
  const height = canvas.clientHeight || 210;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  const padding = { left: 32, right: 12, top: 12, bottom: 24 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const values = history.flatMap((event) => {
    const n = event.normalized || {};
    return ['work', 'companion', 'learning'].map((key) => Number(n[key]) || 0);
  });
  const dataMin = values.length ? Math.min(...values) : 0;
  const dataMax = values.length ? Math.max(...values) : 100;
  const pad = Math.max(4, (dataMax - dataMin) * 0.18);
  const yMin = Math.max(0, Math.floor(dataMin - pad));
  const yMax = Math.min(100, Math.ceil(dataMax + pad));
  const yRange = Math.max(1, yMax - yMin);
  ctx.strokeStyle = 'rgba(120,103,80,.12)';
  ctx.lineWidth = 1;
  ctx.font = '9px "Cascadia Code", Consolas, monospace';
  ctx.fillStyle = '#a29684';
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + plotH * (i / 4);
    ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
    ctx.fillText(`${Math.round(yMax - (yRange * i) / 4)}%`, 4, y + 3);
  }
  if (!history.length) {
    ctx.fillStyle = '#9d9180'; ctx.font = '11px "Microsoft YaHei UI", sans-serif';
    ctx.fillText('还没有足够的数据，先聊几句吧。', padding.left + 10, padding.top + plotH / 2);
    return;
  }
  const points = history.map((event, index) => {
    const n = event.normalized || { work: 50, companion: 50 };
    return {
      x: padding.left + (history.length === 1 ? plotW / 2 : plotW * index / (history.length - 1)),
      work: padding.top + plotH * (1 - ((Number(n.work) || 0) - yMin) / yRange),
      companion: padding.top + plotH * (1 - ((Number(n.companion) || 0) - yMin) / yRange),
      learning: padding.top + plotH * (1 - ((Number(n.learning) || 0) - yMin) / yRange)
    };
  });
  const drawLine = (key, color, fill) => {
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
    gradient.addColorStop(0, fill);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point[key]) : ctx.lineTo(point.x, point[key]));
    ctx.lineTo(points[points.length - 1].x, padding.top + plotH);
    ctx.lineTo(points[0].x, padding.top + plotH);
    ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath();
    points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point[key]) : ctx.lineTo(point.x, point[key]));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  };
  drawLine('work', '#2c7a70', 'rgba(44,122,112,.10)');
  drawLine('companion', '#dd6a4e', 'rgba(221,106,78,.09)');
  drawLine('learning', '#b99a4f', 'rgba(185,154,79,.08)');
  const last = points[points.length - 1];
  ctx.beginPath(); ctx.arc(last.x, last.work, 3, 0, Math.PI * 2); ctx.fillStyle = '#2c7a70'; ctx.fill();
  ctx.beginPath(); ctx.arc(last.x, last.companion, 3, 0, Math.PI * 2); ctx.fillStyle = '#dd6a4e'; ctx.fill();
  ctx.beginPath(); ctx.arc(last.x, last.learning, 3, 0, Math.PI * 2); ctx.fillStyle = '#b99a4f'; ctx.fill();
  const first = history[0]?.at; const end = history[history.length - 1]?.at;
  ctx.fillStyle = '#a29684'; ctx.font = '8px "Cascadia Code", Consolas, monospace';
  if (first) ctx.fillText(timeShort(first).slice(0, 8), padding.left, height - 5);
  if (end) ctx.textAlign = 'right', ctx.fillText(timeShort(end).slice(0, 8), width - padding.right, height - 5);
}

// ── views: learning ─────────────────────────────────────────────────────────
const FLOW = [
  ['blank', '空白识别', '知识库无把握'],
  ['search', '联网搜集', '多组关键词'],
  ['validate', '交叉验证', '比对多个信源'],
  ['score', '信源鉴定', '给来源分权'],
  ['archive', '筛选归档', '可用才入库'],
  ['recheck', '质疑重验', '按需重新采集'],
  ['compare', '比对替换', '替换/合并/冲突']
];

function currentLearningCycle() {
  if (S.liveLearning) return S.liveLearning;
  if (S.cycleDetail) return S.cycleDetail;
  if (S.selectedCycle) return S.selectedCycle;
  return S.learningList?.[0] || null;
}

function viewLearning() {
  const cycle = currentLearningCycle();
  const cycles = S.learningList || S.data.learning?.cycles || [];
  const running = S.learningRunning || cycle?.status === 'running';
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">SELF-LEARNING LOOP</div><h1 class="page-title">不知道，就去查清楚</h1><p class="page-desc">知识库说“不确定”，或你质疑一条记忆时，伴行会搜索多个信源、读正文、交叉验证，再决定归档、替换、合并，还是保留冲突。</p></div><div class="page-actions"><span class="small muted">搜索：${esc(S.data.config?.search?.provider || 'bing')} · 最少 ${S.data.config?.search?.minSources || 2} 个独立来源</span></div></div>
    <section class="card">
      <form class="learn-search" data-form="learning-run">
        <input class="input" name="query" id="learning-query" placeholder="例如：SnowLuma 1.14.22 的 OneBot 默认端口和配置方式？" value="${esc(S.learningQuery || '')}">
        <label class="toggle-chip"><input type="checkbox" name="archive" checked> 写入长期记忆</label>
        <button class="btn btn-primary" type="submit" ${running ? 'disabled' : ''}>${icon('search')}${running ? '查证中…' : '开始查证'}</button>
      </form>
      <div class="learn-flow">${FLOW.map(([key, title, sub], index) => {
        const stepKeys = { blank:['blank'], search:['search','fetch'], validate:['validate'], score:['score'], archive:['archive'], recheck:[], compare:['archive'] };
        const done = cycle?.steps?.some((step) => stepKeys[key].includes(step.key));
        const activeKey = cycle?.stage || (cycle?.status === 'running' ? 'search' : '');
        const active = running && (activeKey === key || (key === 'search' && activeKey === 'fetch'));
        const recheckDone = key === 'recheck' && cycle?.trigger === 'challenge' && cycle?.status === 'completed';
        const compareDone = key === 'compare' && cycle?.outcome;
        return `<div class="flow-step ${done || recheckDone || compareDone ? 'done' : ''} ${active ? 'active' : ''} ${cycle?.status === 'failed' && active ? 'fail' : ''}"><b>${title}</b><span>${sub}</span></div>`;
      }).join('')}</div>
    </section>
    <div class="learn-layout" style="margin-top:15px">
      <section class="card">
        <div class="card-title">${icon('orbit')}${cycle ? esc(cycle.query) : '查证记录'}<span class="card-actions">${cycle ? badge(cycle.status === 'completed' ? (cycle.outcome ? `结果：${cycle.outcome}` : '已完成') : cycle.status === 'running' ? '进行中' : '失败', cycle.status === 'completed' ? 'badge-teal' : cycle.status === 'failed' ? 'badge-danger' : 'badge-gold') : ''}</span></div>
        ${!cycle ? `<div class="learn-empty">${icon('search')}<br>输入一个问题开始第一次闭环。过程会完整记录在 data/learning/cycles.jsonl，随时可复核。</div>` : safeLearningCycleHtml(cycle)}
      </section>
      <aside class="stack">
        <section class="card"><div class="card-title">${icon('clock')}最近闭环<span class="card-actions"><button class="btn btn-sm btn-ghost" data-action="refresh-learning">${icon('refresh')}</button></span></div>
          ${cycles.length ? `<div class="cycle-list">${cycles.slice(0,12).map((item)=>`<div class="cycle-item ${cycle?.id===item.id?'active':''}" data-action="select-cycle" data-id="${esc(item.id)}"><span class="cycle-status">${badge(item.status==='completed'?'完成':item.status==='failed'?'失败':'进行中', item.status==='completed'?'badge-teal':item.status==='failed'?'badge-danger':'badge-gold')}</span><b>${esc(item.query)}</b><span>${timeShort(item.startedAt)} · ${esc(item.trigger||'manual')}</span></div>`).join('')}</div>` : `<div class="empty-rail">还没有记录。</div>`}
        </section>
        <section class="card"><div class="card-title">${icon('shield')}证据规则</div><p class="card-note">域名权威度、相关性、正文可读性、时效与交叉印证共同决定信源分。低分来源不会被当作同等证据；独立来源不足时只入候选，不写成确定事实。</p></section>
      </aside>
    </div>
  </div>`;
}

function safeLearningCycleHtml(cycle) {
  try {
    return learningCycleHtml(cycle);
  } catch (error) {
    return `<div class="answer-box conflict-box">这条闭环的字段格式不完整，已阻止页面整体崩溃：${esc(error.message)}。<br>原始记录仍在 data/learning/cycles.jsonl，可刷新或导出检查。</div>`;
  }
}

function learningCycleHtml(cycle) {
  const assessment = cycle.assessment;
  const sources = cycle.sources || [];
  const steps = cycle.steps || [];
  return `<div class="stack">
    <div class="answer-box">${esc(assessment?.answer || (cycle.status === 'running' ? '正在读取信源并交叉比对…' : cycle.error || '暂无结论'))}</div>
    ${assessment ? `<div class="memory-meta">${badge(`置信 ${pct((assessment.confidence||0)*100)}`, (assessment.confidence||0)>=.58?'badge-teal':'badge-gold')}${badge(assessment.fallback ? '启发式综合' : 'AI 交叉验证','badge-outline')}${assessment.reasoning ? `<span>${esc(assessment.reasoning).slice(0,240)}</span>` : ''}</div>` : ''}
    ${assessment?.conflicts?.length ? `<div class="answer-box conflict-box"><b>发现冲突，未静默覆盖：</b>\n${esc(assessment.conflicts.map((item)=>typeof item==='string'?item:JSON.stringify(item)).join('\n'))}</div>` : ''}
    ${sources.length ? `<div style="overflow-x:auto"><table class="source-table"><thead><tr><th>信源</th><th>权重</th><th>依据</th></tr></thead><tbody>${sources.slice(0,8).map((source)=>`<tr><td><a href="#" data-url="${esc(source.url)}">${esc(source.title||source.url)}</a><span class="tiny muted">${esc(source.domain||'')} · ${source.ok?'正文已读':'仅摘要'} · ${source.support||0} 个佐证</span></td><td><div class="reliability ${source.reliability<.5?'low':''}"><div class="bar"><span style="width:${Math.round((source.reliability||0)*100)}%"></span></div><b>${Math.round((source.reliability||0)*100)}</b></div></td><td class="tiny muted">${esc(Array.isArray(source.reasons) ? source.reasons.join(' · ') : String(source.reasons || ''))}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div><div class="card-title" style="font-size:11px;margin-bottom:4px">执行步骤</div><div class="step-list">${steps.map((step,index)=>`<div class="step-row done"><div class="step-index">${index+1}</div><div class="step-copy"><b>${esc(step.title)}</b><p>${esc(step.message)}</p></div></div>`).join('') || '<div class="empty-rail">等待第一步…</div>'}</div></div>
    <div class="small muted">闭环 ID：<span class="mono">${esc(cycle.id)}</span>${cycle.knowledgeId ? ` · 记忆：${esc(cycle.knowledgeId)}` : ''}</div>
  </div>`;
}

// ── views: idle self-learning ───────────────────────────────────────────────
function viewIdleLearning() {
  const d = S.data.idleLearning || { cycles: [], knowledge: [], emotional: [] };
  const a = S.data.autonomy || {};
  const idle = Number(d.idleMinutes || 0);
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">IDLE CURIOSITY · WHITELIST ONLY</div><h1 class="page-title">安静一小时后，我自己去学点东西</h1><p class="page-desc">只在白名单会话安静达到 ${num(d.minIdleMinutes || 60)} 分钟后运行；不向用户发消息。选题可自由发散，但先做四项审查：安全范围、隐私、高危内容、空泛古怪；不通过就回退到预设安全方向。结果只进知识库或情感记忆中的一个。</p></div><div class="page-actions"><button class="btn btn-primary" data-action="idle-run">${icon('sparkle')}立即自学习</button></div></div>
    <section class="card" style="margin-bottom:14px">
      <div class="card-title">${icon('settings')}自学习节奏<span class="card-actions">${badge(d.enabled === false ? '已关闭' : '已启用', d.enabled === false ? 'badge-outline' : 'badge-teal')}</span></div>
      <form data-form="idle-settings">
        <div class="switchline"><div class="switch-copy">启用闲时自学习<small>只在白名单空闲时运行，不主动发消息</small></div><label class="switch"><input type="checkbox" name="enabled" ${d.enabled !== false ? 'checked' : ''}><span></span></label></div>
        <div class="field-row-3" style="margin-top:9px">
          <div class="field"><label>空闲门槛（分钟）</label><input class="input" type="number" min="1" max="10080" name="minIdleMinutes" value="${num(d.minIdleMinutes || 60)}"></div>
          <div class="field"><label>检查间隔（分钟）</label><input class="input" type="number" min="1" max="1440" name="checkIntervalMinutes" value="${num(d.checkIntervalMinutes || 5)}"></div>
          <div class="field"><label>两次学习间隔（分钟）</label><input class="input" type="number" min="1" max="10080" name="cooldownMinutes" value="${num(d.cooldownMinutes || 180)}"></div>
        </div>
        <div class="field-row-3" style="margin-top:9px">
          <div class="field"><label>每天最多（次）</label><input class="input" type="number" min="1" max="48" name="maxPerDay" value="${num(d.maxPerDay || 4)}"></div>
          <div class="field"><label>静默开始（0-23）</label><input class="input" type="number" min="0" max="23" name="quietStart" value="${num(d.quietStart ?? 0)}"></div>
          <div class="field"><label>静默结束（0-24）</label><input class="input" type="number" min="0" max="24" name="quietEnd" value="${num(d.quietEnd ?? 7)}"></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">保存自学习节奏</button></div>
      </form>
    </section>
    <section class="card" style="margin-bottom:14px">
      <div class="card-title">${icon('phone')}闲时自主活动<span class="card-actions">${badge(a.running ? '正在玩' : a.enabled === false ? '已关闭' : '待机', a.running ? 'badge-gold' : 'badge-teal')} <button class="btn btn-sm btn-ghost" data-action="autonomy-run">立即自主活动</button></span></div>
      <p class="small muted" style="margin:0 0 8px">空闲达到门槛后，她可以自己拿起手机/电脑玩 B 站、视频、游戏或探索应用，不必等用户发指令。默认不碰用户文件；下载应用需单独开启。</p>
      <form data-form="autonomy-settings">
        <label class="checkline"><input type="checkbox" name="enabled" ${a.enabled !== false ? 'checked' : ''}>允许空闲时自己拿起设备（关闭后仍可手动点“立即自主活动”）</label>
        <div class="field-row-3" style="margin-top:8px">
          <div class="field"><label>允许自己用手机</label><label class="checkline"><input type="checkbox" name="usePhone" ${a.usePhone !== false ? 'checked' : ''}>手机 / 模拟器</label></div>
          <div class="field"><label>允许自己用电脑</label><label class="checkline"><input type="checkbox" name="useComputer" ${a.useComputer ? 'checked' : ''}>Windows 桌面</label></div>
          <div class="field"><label>允许下载应用</label><label class="checkline"><input type="checkbox" name="allowAppDownload" ${a.allowAppDownload ? 'checked' : ''}>APK 下载安装</label></div>
        </div>
        <div class="field-row-3" style="margin-top:9px">
          <div class="field"><label>空闲门槛（分钟）</label><input class="input" type="number" min="1" max="10080" name="minIdleMinutes" value="${Number(a.minIdleMinutes || 60)}"></div>
          <div class="field"><label>两次活动间隔（分钟）</label><input class="input" type="number" min="1" max="10080" name="cooldownMinutes" value="${Number(a.cooldownMinutes || 180)}"></div>
          <div class="field"><label>最多动作步数</label><input class="input" type="number" min="1" max="30" name="maxSteps" value="${Number(a.maxSteps || 8)}"></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">保存自主活动设置</button></div>
      </form>
      ${(a.sessions || []).length ? `<div class="idle-cycles" style="margin-top:9px">${a.sessions.slice(0, 5).map((s) => `<div class="idle-cycle"><div class="idle-cycle-head"><b>${s.device === 'computer' ? '电脑' : '手机'} · ${s.status}</b><span class="tiny muted">${timeAgo(s.startedAt)}</span></div><p>${esc(String(s.finalText || s.error || '（无文字记录）').slice(0, 260))}</p></div>`).join('')}</div>` : ''}
    </section>
    <div class="stat-grid">
      <div class="stat">${icon('clock','stat-icon')}<div class="stat-copy"><span>白名单空闲</span><b>${num(idle)} 分钟</b><small>${d.lastActivityAt ? `最近活动 ${timeAgo(d.lastActivityAt)}` : '尚未记录'}</small></div></div>
      <div class="stat">${icon('sparkle','stat-icon')}<div class="stat-copy"><span>今日自学习</span><b>${num(d.usedToday || 0)} / ${num(d.maxPerDay || 4)}</b><small>${d.lastLearnedAt ? `上次 ${timeAgo(d.lastLearnedAt)}` : '还没有运行'}</small></div></div>
      <div class="stat">${icon('brain','stat-icon')}<div class="stat-copy"><span>知识写入</span><b>${num((d.knowledge || []).length)}</b><small>含候选与正式条目</small></div></div>
      <div class="stat">${icon('heart','stat-icon')}<div class="stat-copy"><span>情感材料</span><b>${num((d.emotional || []).length)}</b><small>可成为情感线证据</small></div></div>
    </div>
    <div class="grid grid-2" style="align-items:start">
      <section class="card">
        <div class="card-title">${icon('search')}自学习轨迹<span class="card-actions">${badge(d.running ? '运行中' : d.enabled === false ? '已关闭' : '监听空闲', d.running ? 'badge-gold' : 'badge-teal')}</span></div>
        ${(d.cycles || []).length ? `<div class="idle-cycles">${d.cycles.slice(0, 30).map((cycle) => `<article class="idle-cycle"><div class="idle-cycle-head"><b>${esc(cycle.query || '未命名主题')}</b>${badge(cycle.classify === 'emotional' ? '情感材料' : cycle.classify === 'legacy' ? '历史记录' : '知识学习', cycle.classify === 'emotional' ? 'badge-gold' : cycle.classify === 'legacy' ? 'badge-outline' : 'badge-teal')}${cycle.queryReview?.fallback ? badge('已回退安全题','badge-gold') : cycle.queryReview?.passed ? badge('四审通过','badge-outline') : ''}${badge(cycle.outcome || cycle.status || '运行中', cycle.outcome === 'archived' ? 'badge-teal' : 'badge-gold')}</div><div class="memory-meta"><span>${timeShort(cycle.startedAt)}</span><span>${num((cycle.sources || []).length)} 个信源</span><span>${cycle.assessment?.confidence != null ? `置信 ${Math.round(cycle.assessment.confidence * 100)}%` : ''}</span></div><p>${esc(String(cycle.assessment?.answer || cycle.error || '正在搜索…').slice(0, 320))}</p></article>`).join('')}</div>` : '<div class="empty-rail" style="padding:28px">还没有闲时自学习记录。安静一小时后会自己开始，也可以点“立即自学习”。</div>'}
      </section>
      <section class="card">
        <div class="card-title">${icon('brain')}进入知识库的结果</div>
        ${(d.knowledge || []).length ? `<div class="idle-knowledge">${d.knowledge.slice(0, 20).map((item) => `<div class="idle-knowledge-item"><b>${esc(item.title)}</b>${badge(item.status || 'active', item.status === 'active' ? 'badge-teal' : 'badge-gold')}<p>${esc(String(item.content || '').slice(0, 260))}</p><div class="memory-meta"><span>${num((item.sources || []).length)} 来源</span><span>${timeShort(item.verifiedAt || item.createdAt)}</span></div></div>`).join('')}</div>` : '<div class="empty-rail" style="padding:28px">还没有由闲时自学习写入的知识。候选和正式条目都会显示在这里。</div>'}
      </section>
    </div>
    <section class="card" style="margin-top:14px">
      <div class="card-title">${icon('heart')}情感相关材料<span class="card-actions"><span class="tiny muted">进入关系记忆 · 可作为情感线证据</span></span></div>
      ${(d.emotional || []).length ? `<div class="relation-grid">${d.emotional.slice(0, 12).map((item) => `<article class="relation-card emotional"><span class="relation-kind">${esc(item.kind === 'emotional_material' ? '自学习情感材料' : item.kind)}</span>${badge('情感记忆','badge-gold')}<h4>${esc(item.title || '')}</h4><p>${esc(item.content || '')}</p><div class="memory-meta"><span>${timeAgo(item.createdAt)}</span><span>${item.knowledgeId ? '关联知识' : '自学习'}</span></div></article>`).join('')}</div>` : '<div class="empty-rail" style="padding:24px">当自学习内容涉及关系、陪伴、信任、孤独等主题时，会在这里出现，并作为情感线的辅助证据。</div>'}
    </section>
  </div>`;
}

// ── views: usage ────────────────────────────────────────────────────────────
function formatTokens(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function viewUsage() {
  const u = S.data.usage;
  if (!u) return `<div class="page"><div class="empty">${icon('gauge')}<h3>正在读取用量…</h3></div></div>`;
  const t = u.totals || {};
  const cacheText = u.cacheAvailable ? pct(u.cacheHitRate || 0) : '—';
  const memoryText = u.memoryHitRate == null ? '—' : pct(u.memoryHitRate);
  const maxDay = Math.max(1, ...(u.byDay || []).map((day) => Number(day.total || 0)));
  const last = u.lastCall;
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">TOKENS × CACHE × MEMORY</div><h1 class="page-title">每一次对话，花了多少上下文</h1><p class="page-desc">统计今天所有模型调用的输入/输出 token、上下文缓存命中与记忆召回命中。数据只写在工作目录，不上传。</p></div><div class="page-actions"><button class="btn" data-action="usage-refresh">${icon('refresh')}刷新</button><button class="btn btn-danger" data-action="usage-reset">重置统计</button></div></div>
    <div class="stat-grid usage-stats">
      <div class="stat">${icon('gauge','stat-icon')}<div class="stat-copy"><span>今日总 tokens</span><b>${formatTokens(t.total)}</b><small>${num(t.calls || 0)} 次模型调用</small></div></div>
      <div class="stat">${icon('chat','stat-icon')}<div class="stat-copy"><span>输入 / 输出</span><b>${formatTokens(t.prompt)} / ${formatTokens(t.completion)}</b><small>今日累计</small></div></div>
      <div class="stat">${icon('sparkle','stat-icon')}<div class="stat-copy"><span>缓存命中率</span><b>${cacheText}</b><small>${u.cacheAvailable ? `${formatTokens(u.cacheHitTokens)} 命中 / ${formatTokens(u.cacheMissTokens)} 未命中` : '当前模型未返回缓存字段'}</small></div></div>
      <div class="stat">${icon('brain','stat-icon')}<div class="stat-copy"><span>记忆命中率</span><b>${memoryText}</b><small>本轮至少召回一层记忆的调用占比</small></div></div>
    </div>
    <div class="grid grid-2" style="align-items:start">
      <section class="card usage-context">
        <div class="card-title">${icon('gauge')}当前上下文${last ? `<span class="card-actions">${badge(last.model || 'primary','badge-outline')}</span>` : ''}</div>
        <div class="usage-context-main"><b>${last ? formatTokens(last.promptTokens) : '0'}</b><span>/ ${formatTokens(u.contextWindow)} 窗口</span><strong>${last ? `${(Number(u.contextPercent) || 0).toFixed(1)}%` : '0%'}</strong></div>
        <div class="usage-context-bar"><i style="width:${Math.min(100, Number(u.contextPercent || 0))}%"></i></div>
        <div class="small muted" style="margin-top:8px">${last ? `最近一次：${timeAgo(last.at)} · ${esc(channelLabel(last.channel))} · ${esc(last.purpose || 'chat')}` : '还没有模型调用。' }</div>
        <div class="notice" style="margin-top:10px">${icon('warning')}<div>窗口占比按最近一次调用的输入 token 估算，不等于模型实际上下文上限；不同模型可在模型接入里调整。</div></div>
      </section>
      <section class="card">
        <div class="card-title">${icon('chart')}最近 7 天</div>
        <div class="usage-days">${(u.byDay || []).map((day) => `<div class="usage-day"><span>${esc(day.date?.slice(5) || '')}</span><div class="usage-day-track"><i style="width:${Math.max(2, (Number(day.total || 0) / maxDay) * 100)}%"></i></div><b>${formatTokens(day.total)}</b></div>`).join('') || '<div class="empty-rail">还没有记录。</div>'}</div>
      </section>
    </div>
    <div class="grid grid-2" style="margin-top:14px;align-items:start">
      <section class="card">
        <div class="card-title">${icon('chat')}对话消耗<span class="card-actions"><span class="tiny muted">按入口汇总</span></span></div>
        ${(u.conversations || []).length ? `<table class="usage-table"><thead><tr><th>对话</th><th>调用</th><th>输入</th><th>输出</th></tr></thead><tbody>${u.conversations.map((row) => `<tr><td>${esc(row.label || row.name)}</td><td>${num(row.calls)}</td><td>${formatTokens(row.prompt)}</td><td>${formatTokens(row.completion)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty-rail">连接 QQ 或在桌面聊天后，这里会按对话拆分。</div>`}
      </section>
      <section class="card">
        <div class="card-title">${icon('cpu')}模型 / 角色</div>
        <table class="usage-table"><thead><tr><th>模型</th><th>调用</th><th>总 tokens</th><th>缓存命中</th></tr></thead><tbody>${(u.byModel || []).map((row) => `<tr><td>${esc(row.name)}</td><td>${num(row.calls)}</td><td>${formatTokens(row.total)}</td><td>${formatTokens(row.cached)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">还没有模型调用</td></tr>'}</tbody></table>
      </section>
    </div>
    <section class="card" style="margin-top:14px">
      <div class="card-title">${icon('clock')}最近调用<span class="card-actions"><span class="tiny muted">最近 30 次</span></span></div>
      <div class="usage-recent">${(u.recent || []).length ? u.recent.map((row) => `<div class="usage-recent-row"><span>${timeShort(row.at)}</span>${badge(row.role, row.role === 'primary' ? 'badge-teal' : 'badge-gold')}<b>${esc(row.model || '—')}</b><span>${esc(channelLabel(row.channel))}</span><span>${formatTokens(row.promptTokens)} in</span><span>${formatTokens(row.completionTokens)} out</span><span>${row.cacheAvailable ? `cache ${formatTokens(row.cachedTokens)}` : (row.estimated ? '估算' : '—')}</span><i>${num(row.latencyMs)}ms</i></div>`).join('') : '<div class="empty-rail">还没有调用记录。发一条消息后再回来。</div>'}</div>
    </section>
  </div>`;
}

// ── views: QQ ───────────────────────────────────────────────────────────────
function viewQQ() {
  const qq = S.data.qq || {};
  const cfg = S.data.config.qq || {};
  const live = qq.config || cfg;
  const groupMode = live.groupActivityMode || 'manual';
  const groupValue = Number(live.groupActivity ?? cfg.groupActivity ?? 15);
  const privateMode = live.privateActivityMode || 'manual';
  const privateValue = Number(live.privateActivity ?? cfg.privateActivity ?? 0);
  const status = qq.connected ? '正在监听' : qq.connecting ? '连接中' : qq.running ? '已启动，等待连接' : '未启动';
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">ONEBOT × QQ</div><h1 class="page-title">把 QQ 接进同一条记忆</h1><p class="page-desc">任意 OneBot v11 网关（SnowLuma / NapCat / Lagrange / LLOneBot）都能接入；只监听白名单、发送有审计。群聊与私聊各有活跃度，私聊还可以在安静时自主查资料、看手机，回来开一个新话题。</p></div><div class="page-actions"><a href="#" class="btn btn-ghost" data-url="https://github.com/pinganbbOvO/ai-companion-kit">${icon('external')}OneBot 参考</a></div></div>
    <div class="status-hero">
      <div class="status-orb">${icon('qq')}</div>
      <div class="status-copy"><h2>${status}</h2><p>${qq.connected ? `${esc(qq.nickname||'QQ')} · ${esc(qq.boundQQ||'')} · ${esc(qq.wsUrl||'')}` : qq.error || qq.hint || '填 OneBot 地址与 Token，或先用 SnowLuma 自动发现。'}</p><div class="row" style="margin-top:6px">${badge(`群活跃 ${groupValue}% · ${groupMode === 'ai' ? 'AI 动态' : '手动'}`, 'badge-outline')}${badge(`私聊主动 ${privateValue}% · ${privateMode === 'ai' ? 'AI 动态' : '手动'}`, 'badge-gold')}${qq.activity?.lastProactiveAt ? `<span class="tiny muted">上次主动 ${timeAgo(qq.activity.lastProactiveAt)}</span>` : ''}</div></div>
      <div class="status-actions">
        <button class="btn btn-sm btn-primary" data-action="qq-start">${icon('play')}启动监听</button>
        <button class="btn btn-sm" data-action="qq-stop">${icon('stop')}停止</button>
        <button class="btn btn-sm" data-action="qq-test">${icon('refresh')}诊断</button>
        <button class="btn btn-sm" data-action="qq-open-webui">${icon('external')}SnowLuma 面板</button>
      </div>
    </div>
    ${!qq.connected && qq.hint ? `<div class="banner-warning">${icon('warning')}<div>${esc(qq.hint)}${qq.error ? ` · ${esc(qq.error)}` : ''}</div></div>` : ''}
    <section class="card activity-card">
      <div class="card-title">${icon('chart')}互动活跃度<span class="card-actions"><span class="tiny muted">群聊与私聊独立设置</span></span></div>
      <form data-form="qq-activity">
        <div class="activity-grid">
          <div class="activity-block">
            <div class="activity-head"><div><b>群聊回复活跃度</b><small>普通群消息被接住的概率；@ 永远优先</small></div><div class="segmented activity-mode"><button type="button" class="seg ${groupMode === 'manual' ? 'active' : ''}" data-action="activity-mode" data-kind="group" data-mode="manual">手动</button><button type="button" class="seg ${groupMode === 'ai' ? 'active' : ''}" data-action="activity-mode" data-kind="group" data-mode="ai">AI 动态</button></div></div>
            <input type="hidden" name="groupActivityMode" value="${esc(groupMode)}">
            <div class="activity-value"><output data-output="groupActivity">${groupValue}</output><span>%</span><small>${groupMode === 'ai' ? '根据群聊热度自动调整' : '由你拖动控制'}</small></div>
            <input class="activity-range" type="range" min="0" max="100" step="1" name="groupActivity" value="${groupValue}" data-output="groupActivity" data-kind="group">
            <div class="activity-scale"><span>安静 · 只回 @</span><span>更主动</span></div>
            <div class="switchline"><div class="switch-copy">群聊必须 @ 机器人<small>开启时只回应 @；关闭后才使用上面的普通消息活跃度</small></div><label class="switch"><input type="checkbox" name="requireAtInGroup" ${(live.requireAtInGroup ?? cfg.requireAtInGroup) !== false ? 'checked' : ''}><span></span></label></div>
            <div class="activity-subfield"><div class="activity-subhead"><span>群回复冷却</span><output data-output="groupCooldownSec">${Number(live.groupCooldownSec ?? cfg.groupCooldownSec ?? 30)}</output><span>秒</span></div><input class="activity-range" type="range" min="0" max="300" step="5" name="groupCooldownSec" value="${Number(live.groupCooldownSec ?? cfg.groupCooldownSec ?? 30)}" data-output="groupCooldownSec"></div>
          </div>
          <div class="activity-block">
            <div class="activity-head"><div><b>私聊主动活跃度</b><small>安静后主动查资料 / 看手机，再开新话题</small></div><div class="segmented activity-mode"><button type="button" class="seg ${privateMode === 'manual' ? 'active' : ''}" data-action="activity-mode" data-kind="private" data-mode="manual">手动</button><button type="button" class="seg ${privateMode === 'ai' ? 'active' : ''}" data-action="activity-mode" data-kind="private" data-mode="ai">AI 动态</button></div></div>
            <input type="hidden" name="privateActivityMode" value="${esc(privateMode)}">
            <div class="activity-value"><output data-output="privateActivity">${privateValue}</output><span>%</span><small>${privateMode === 'ai' ? '根据当前陪伴/工作权重自动调整' : '0 = 不主动打扰'}</small></div>
            <input class="activity-range" type="range" min="0" max="100" step="1" name="privateActivity" value="${privateValue}" data-output="privateActivity" data-kind="private">
            <div class="activity-scale"><span>不打扰</span><span>更常主动</span></div>
            <div class="field-row" style="margin-top:12px"><div class="activity-subfield"><div class="activity-subhead"><span>安静阈值</span><output data-output="privateIdleMinutes">${Number(live.privateIdleMinutes ?? cfg.privateIdleMinutes ?? 180)}</output><span>分钟</span></div><input class="activity-range" type="range" min="10" max="720" step="10" name="privateIdleMinutes" value="${Number(live.privateIdleMinutes ?? cfg.privateIdleMinutes ?? 180)}" data-output="privateIdleMinutes"></div><div class="activity-subfield"><div class="activity-subhead"><span>最短间隔</span><output data-output="privateMinIntervalMinutes">${Number(live.privateMinIntervalMinutes ?? cfg.privateMinIntervalMinutes ?? 120)}</output><span>分钟</span></div><input class="activity-range" type="range" min="10" max="720" step="10" name="privateMinIntervalMinutes" value="${Number(live.privateMinIntervalMinutes ?? cfg.privateMinIntervalMinutes ?? 120)}" data-output="privateMinIntervalMinutes"></div></div>
            <div class="switchline"><div class="switch-copy">主动话题可先查资料<small>使用学习闭环检索并归档；不把隐私当搜索词</small></div><label class="switch"><input type="checkbox" name="proactiveUseResearch" ${(live.proactiveUseResearch ?? cfg.proactiveUseResearch) !== false ? 'checked' : ''}><span></span></label></div>
            <div class="switchline"><div class="switch-copy">主动话题可先看手机<small>需已连接 ADB 且开启手机控制；只读界面文字</small></div><label class="switch"><input type="checkbox" name="proactiveUsePhone" ${(live.proactiveUsePhone ?? cfg.proactiveUsePhone) ? 'checked' : ''}><span></span></label></div>
          </div>
        </div>
        <div class="activity-actions"><span class="tiny muted">AI 动态模式下，后台会根据对话信号自动调；拖动滑杆会切回手动。</span><button class="btn btn-sm" type="button" data-action="qq-proactive">${icon('sparkle')}立即主动试一次</button><button class="btn btn-primary" type="submit">保存活跃度</button></div>
      </form>
    </section>
    <div class="qq-grid">
      <div class="stack">
        <section class="card flush">
          <div class="card-title" style="padding:14px 16px 0;margin-bottom:6px">${icon('chat')}最近消息<span class="card-actions"><span class="small muted">${qq.messageCount||0} 条事件</span></span></div>
          <div class="qq-messages" id="qq-message-stream" style="padding:0 16px 12px">${qqMessagesHtml()}</div>
        </section>
        <section class="card">
          <div class="card-title">${icon('shield')}连接与安全边界</div>
          <div class="kv"><span>qq-bridge 连接器</span><b>${esc(qq.discovered?.source || '自动发现')}</b></div>
          <div class="kv"><span>账号监听</span><b>${esc(qq.boundQQ || '未登录')}</b></div>
          <div class="kv"><span>白名单</span><b>${(cfg.ownerQQ?`主人 ${cfg.ownerQQ} · `:'')}${(cfg.allowPrivate||[]).length} 私聊 / ${(cfg.allowGroups||[]).length} 群</b></div>
          <div class="kv"><span>群聊回复</span><b>${cfg.requireAtInGroup ? '必须 @ 机器人' : '允许监听全部白名单群消息'}</b></div>
          <div class="integration-note">${icon('warning')}<div>SnowLuma 是第三方 QQ 互操作项目，使用可能违反平台条款并带来账号风险。它按自己的 EULA 独立运行，伴行不会修改 QQ 进程，也不会自动扫码或代你同意协议。<br>首次使用：启动 SnowLuma → 登录绑定 QQ → 在 SnowLuma WebUI 开启 OneBot HTTP(3000)/WS(3001) → 回到这里启动监听。</div></div>
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <div class="card-title">${icon('settings')}桥接配置</div>
          <form data-form="qq-save">
            <div class="switchline"><div class="switch-copy">启用 QQ 桥接<small>关闭时不会连接 OneBot / SnowLuma</small></div><label class="switch"><input type="checkbox" name="enabled" ${cfg.enabled?'checked':''}><span></span></label></div>
            <div class="switchline"><div class="switch-copy">把 QQ 主人私聊接入主对话<small>侧边“对话”会同步显示/回复主人 QQ 私聊；应用内回答也会回写 QQ</small></div><label class="switch"><input type="checkbox" name="primaryConversation" ${cfg.primaryConversation?'checked':''}><span></span></label></div>
            <div class="switchline"><div class="switch-copy">自动回复<small>只对通过白名单的消息</small></div><label class="switch"><input type="checkbox" name="autoReply" ${cfg.autoReply!==false?'checked':''}><span></span></label></div>
            <div class="switchline"><div class="switch-copy">拟人化发送<small>按长度等待、正在输入、分条发送；关闭后使用固定延迟</small></div><label class="switch"><input type="checkbox" name="humanizeEnabled" ${cfg.humanize?.enabled!==false?'checked':''}><span></span></label></div>
            <div class="card" style="margin-top:10px;padding:10px;background:#fffaf0">
              <div class="card-title" style="margin:0 0 7px">${icon('sparkle')}表情包频率</div>
              <div class="activity-subfield"><div class="activity-subhead"><span>使用倾向</span><output data-output="stickerUseFrequency">${Number(cfg.stickerUseFrequency ?? 35)}</output><span>%</span></div><input class="activity-range" type="range" min="0" max="100" step="5" name="stickerUseFrequency" value="${Number(cfg.stickerUseFrequency ?? 35)}" data-output="stickerUseFrequency"></div>
              <div class="activity-subfield" style="margin-top:7px"><div class="activity-subhead"><span>单发表情包回复概率</span><output data-output="stickerReplyChance">${Number(cfg.stickerReplyChance ?? 35)}</output><span>%</span></div><input class="activity-range" type="range" min="0" max="100" step="5" name="stickerReplyChance" value="${Number(cfg.stickerReplyChance ?? 35)}" data-output="stickerReplyChance"></div>
              <div class="tiny muted" style="margin-top:4px">使用倾向越低越少发表情；单发表情包未命中时只入库不回复。</div>
            </div>
            <div class="notice" style="margin-top:9px">${icon('chart')}<div>群聊回复活跃度、私聊主动活跃度、@ 策略与查资料/看手机权限已独立到上方“互动活跃度”卡片，支持手动与 AI 动态两种模式。</div></div>
            <div class="field-row" style="margin-top:10px"><div class="field"><label>连接方式</label><select class="select" name="onebotMode"><option value="auto" ${cfg.onebotMode!=='manual'?'selected':''}>自动发现 SnowLuma</option><option value="manual" ${cfg.onebotMode==='manual'?'selected':''}>手动 OneBot v11（NapCat / Lagrange / LLOneBot / SnowLuma…）</option></select></div><div class="field"><label>主人 QQ（唯一可私聊自动放行的号码）</label><input class="input" name="ownerQQ" value="${esc(cfg.ownerQQ||'')}" placeholder="例如 123456789"></div></div>
            <div class="field-row" style="margin-top:9px"><div class="field"><label>OneBot WS</label><input class="input" name="wsUrl" value="${esc(cfg.wsUrl||'ws://127.0.0.1:3001')}"></div><div class="field"><label>OneBot HTTP</label><input class="input" name="httpUrl" value="${esc(cfg.httpUrl||'http://127.0.0.1:3000')}"></div></div>
            <div class="field-row" style="margin-top:9px"><div class="field"><label>WS Token（留空保持）</label><input class="input" type="password" name="wsToken" placeholder="${cfg.hasWsToken?'已保存 · 留空保持不变':'可选'}"></div><div class="field"><label>HTTP Token（留空保持）</label><input class="input" type="password" name="httpToken" placeholder="${cfg.hasHttpToken||cfg.hasAccessToken?'已保存 · 留空保持不变':'可选'}"></div></div>
            <div class="notice" style="margin-top:9px">${icon('qq')}<div>手动模式不依赖 SnowLuma 的配置文件；任何兼容 OneBot v11 的网关都可以。WS 用来收事件，HTTP 用来发消息，两个 Token 可以不同。<br>QQ 主对话：你在 QQ 里直接输入即可；应用内发出的回答也会回写主人私聊，但不会把你的话伪装成机器人消息发出去。</div></div>
            <div class="field" style="margin-top:9px"><label>SnowLuma 主目录（自动发现模式用）</label><div class="inline-fields"><input class="input" name="homeDir" value="${esc(cfg.homeDir||'')}"><button class="btn btn-sm" type="button" data-action="pick-snowluma-dir">选择</button></div></div>
            <div class="field-row" style="margin-top:9px"><div class="field"><label>私聊白名单（逗号/换行分隔）</label><textarea class="textarea" name="allowPrivate" rows="2">${esc((cfg.allowPrivate||[]).join('\n'))}</textarea></div><div class="field"><label>群白名单</label><textarea class="textarea" name="allowGroups" rows="2">${esc((cfg.allowGroups||[]).join('\n'))}</textarea></div></div>
            <div class="field-row" style="margin-top:9px"><div class="field"><label>私聊黑名单</label><input class="input" name="denyPrivate" value="${esc((cfg.denyPrivate||[]).join(','))}"></div><div class="field"><label>群黑名单</label><input class="input" name="denyGroups" value="${esc((cfg.denyGroups||[]).join(','))}"></div></div>
            <div class="switchline" style="margin-top:8px"><div class="switch-copy">空白名单时全部放行<small style="color:#b6473c">高风险：等同于把账号控制权交给模型</small></div><label class="switch"><input type="checkbox" name="allowAllWhenEmpty" ${cfg.allowAllWhenEmpty?'checked':''}><span></span></label></div>
            <label class="checkline"><input type="checkbox" name="qqDynamic" ${S.data.config.permissions?.qqDynamic !== false ? 'checked' : ''}>允许 AI 自己发 QQ 空间动态</label>
            <div class="form-actions"><button class="btn btn-sm" type="button" data-action="qq-launch">${icon('play')}启动 SnowLuma</button><button class="btn btn-sm" type="button" data-action="qq-test">${icon('refresh')}测试 OneBot</button><button class="btn btn-primary" type="submit">保存配置</button></div>
          </form>
        </section>
        <section class="card">
          <div class="card-title">${icon('sparkle')}伴行能做什么</div>
          <ol class="steps-mini"><li>读取白名单内私聊/群聊，注入同一套关系记忆；后台权重只影响表达取向，AI 不读取数值。</li><li>图片可进入多模态记忆；需要时调用主模型或辅助视觉模型。</li><li>你在 QQ 里问事实问题，伴行可以独立联网查证，再把结论带回对话。</li><li>所有主动发送受白名单与活跃度限制，不能自行联系陌生人。</li></ol>
        </section>
      </div>
    </div>
  </div>`;
}
// ── views: devices ──────────────────────────────────────────────────────────
function viewDevices() {
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">PHONE MCP × DESKTOP CONTROL</div><h1 class="page-title">看得到，也动得了，但由你授权</h1><p class="page-desc">手机通过 ADB 接入，真机与模拟器共用 mcp-phone.js；操作手机产生的截图只放在后台临时缓存（2 小时后/最多 20 张自动清理），不写入多模态记忆。电脑控制默认关闭，桌面截图只在本页临时查看。</p></div></div>
    <div class="segmented device-tabs"><button class="${S.deviceTab==='phone'?'active':''}" data-action="device-tab" data-tab="phone">${icon('phone')} 手机</button><button class="${S.deviceTab==='computer'?'active':''}" data-action="device-tab" data-tab="computer">${icon('cpu')} 电脑</button></div>
    ${S.deviceTab === 'phone' ? phoneView() : computerView()}
  </div>`;
}

function phoneView() {
  const p = S.phoneStatus;
  const cfg = S.data.config.phone || {};
  if (!p) return `<section class="card"><div class="empty">${icon('phone')}<h3>正在检查 ADB 与设备…</h3><p>首次启动可能需要几秒。</p><button class="btn" data-action="phone-refresh">重新检查</button></div></section>`;
  const devices = p.devices || [];
  const info = p.info || {};
  return `<div class="device-layout">
    <div class="stack">
      <section class="card">
        <div class="row" style="margin-bottom:10px"><div class="segmented"><button class="${p.mode==='auto'?'active':''}" data-action="phone-mode" data-mode="auto">${icon('sparkle')} 自动</button><button class="${p.mode==='real'?'active':''}" data-action="phone-mode" data-mode="real">${icon('phone')} 真机</button><button class="${p.mode==='emulator'?'active':''}" data-action="phone-mode" data-mode="emulator">${icon('phone')} 模拟器</button></div><button class="btn btn-sm btn-primary" data-action="phone-autodetect">${icon('search')}自动检测并连接</button><button class="btn btn-sm" data-action="phone-emulators">${icon('phone')}选择/启动模拟器</button><span class="spacer"></span><span class="small muted">ADB 与 mcp-phone.js 共用</span></div>
        <div class="phone-meta"><div class="card-title" style="margin:0">${icon('phone')}${p.ok ? esc(info.model || p.serial) : '手机未连接'} ${badge(p.mode==='emulator'?'模拟器模式':'真机模式', p.mode==='emulator'?'badge-gold':'badge-teal')}</div><div class="row">${statusDot(p.ok, Boolean(p.adb?.ok))}<span class="small muted">${p.ok ? esc(p.serial) : esc(p.error || '等待设备')}</span><button class="btn btn-sm" data-action="phone-refresh">${icon('refresh')}刷新</button></div></div>
        <div class="screen-actions"><button class="btn btn-sm btn-primary" data-action="phone-screenshot" ${p.ok?'':'disabled'}>${icon('camera')}截图</button><button class="btn btn-sm" data-action="phone-read" ${p.ok?'':'disabled'}>${icon('eye')}读取界面</button><button class="btn btn-sm" data-action="phone-autodetect">${icon('search')}自动检测</button><span class="small muted" style="align-self:center">ADB ${esc(p.adb?.version || '')}</span></div>
        ${S.phoneScan ? `<div class="screen-ui-text">${esc(S.phoneScan.note || '')}${S.phoneScan.openPorts?.length ? `\n开放端口：${S.phoneScan.openPorts.join(', ')}` : ''}</div>` : ''}
        <div class="phone-screen">${S.phoneShot?.dataUrl ? `<img src="${S.phoneShot.dataUrl}" alt="手机屏幕">` : `<div class="empty-screen">${icon('phone')}<br>${p.ok ? '点击“截图”查看当前屏幕' : '开启 USB 调试并授权后，点击刷新'}<br><span class="tiny">${esc(p.error || '')}</span></div>`}</div>
        ${S.phoneUi ? `<div class="screen-ui-text">${esc(S.phoneUi.ui?.text || S.phoneUi.summary || '')}</div>` : ''}
      </section>
      <section class="card">
        <div class="card-title">${icon('settings')}设备与 ADB</div>
        <div class="device-list">${devices.length ? devices.map((device)=>`<div class="device-row">${icon('phone')}<code>${esc(device.serial)}</code><span class="muted">${esc(device.model||'')} ${device.isEmulator?'· 模拟器':'· 真机'}</span>${badge(device.state, device.state==='device'?'badge-teal':'badge-gold')}${device.state==='device'?`<button class="btn btn-sm btn-ghost" data-action="phone-select" data-serial="${esc(device.serial)}">用这台</button>`:''}</div>`).join('') : '<div class="empty-rail">没有检测到设备。先启动模拟器，然后点“自动检测并连接”；真机请开启 USB 调试。</div>'}</div>
        <form data-form="phone-save" style="margin-top:10px">
          <div class="field-row"><div class="field"><label>设备序列号（可留空自动选择）</label><select class="select" name="serial"><option value="">自动选择</option>${devices.map((device)=>`<option value="${esc(device.serial)}" ${cfg.serial===device.serial?'selected':''}>${esc(device.serial)} · ${device.isEmulator?'模拟器':'真机'}</option>`).join('')}</select></div><div class="field"><label>ADB 路径</label><div class="inline-fields"><input class="input" name="adbPath" value="${esc(cfg.adbPath||'')}" placeholder="tools/platform-tools/adb.exe" data-draft="adbPath"><button class="btn btn-sm" type="button" data-action="choose-path" data-kind="file" data-target="adbPath">浏览</button></div></div></div>
          <div class="row" style="margin-top:9px"><span class="small muted">真机：USB 调试 → 允许本电脑。模拟器：先启动，点“自动检测并连接”；常见端口 5555 / 16384 / 62001 / 21503。</span><button class="btn btn-sm btn-primary" type="submit" style="margin-left:auto">保存</button></div>
        </form>
        <div class="inline-fields" style="margin-top:9px"><input class="input" id="wifi-address" placeholder="无线调试 IP:端口，如 192.168.1.8:5555"><button class="btn btn-sm" data-action="phone-connect-wifi">连接</button></div>
        ${S.phoneEmulators ? `<div class="screen-ui-text">${esc(JSON.stringify(S.phoneEmulators, null, 2))}</div>${(S.phoneEmulators.avds||[]).length ? `<div class="row" style="margin-top:8px">${S.phoneEmulators.avds.slice(0,3).map((avd)=>`<button class="btn btn-sm" data-action="phone-start-emulator" data-avd="${esc(avd)}">${icon('play')}启动 ${esc(avd)}</button>`).join('')}</div>` : ''}` : ''}
      </section>
    </div>
    <div class="stack">
      <section class="card">
        <div class="card-title">${icon('phone')}操作</div>
        <div class="control-grid">
          <div class="control-group"><h4>点击坐标</h4><div class="inline-fields"><input class="input" id="tap-x" placeholder="x"><input class="input" id="tap-y" placeholder="y"><button class="btn btn-sm" data-action="phone-tap">点击</button></div><p class="hint" style="margin-top:5px">基于截图原始分辨率；先读取界面确认目标。</p></div>
          <div class="control-group"><h4>系统按键</h4><div class="inline-fields"><select class="select" id="phone-key"><option>HOME</option><option>BACK</option><option>APP_SWITCH</option><option>ENTER</option><option>DEL</option><option>WAKEUP</option></select><button class="btn btn-sm" data-action="phone-key">发送</button></div></div>
          <div class="control-group"><h4>输入文本</h4><div class="inline-fields"><input class="input" id="phone-text" placeholder="中文需 ADBKeyboard"><button class="btn btn-sm" data-action="phone-type">输入</button></div></div>
          <div class="control-group"><h4>启动应用</h4><div class="inline-fields"><input class="input" id="phone-package" placeholder="如 com.tencent.mobileqq"><button class="btn btn-sm" data-action="phone-launch">启动</button></div></div>
          <div class="control-group"><h4>滑动</h4><div class="inline-fields"><input class="input" id="swipe-x1" placeholder="x1"><input class="input" id="swipe-y1" placeholder="y1"><input class="input" id="swipe-x2" placeholder="x2"><input class="input" id="swipe-y2" placeholder="y2"><button class="btn btn-sm" data-action="phone-swipe">滑动</button></div></div>
          <div class="control-group"><h4>UI 控件树</h4><button class="btn btn-sm btn-block" data-action="phone-ui">读取可点击控件</button></div>
        </div>
      </section>
      <section class="card">
        <div class="card-title">${icon('plug')}mcp-phone.js</div>
        <p class="card-note">独立 MCP 服务位于 <span class="code-inline">mcp/phone/mcp-phone.js</span>，可被伴行内置 MCP 管理器、Claude Desktop 或其他 MCP 客户端启动。工具包括 list_devices、screenshot、read_screen、tap、swipe、input_text、keyevent、launch_app、ui_dump、start_emulator。</p>
        <div class="permission-callout" style="margin-top:9px">机器人只能操作你已授权的设备。不要用来操作他人的手机；支付、删除和发送消息前应再次确认。</div>
      </section>
    </div>
  </div>`;
}

function computerView() {
  const cfg = S.data.config.computer || {};
  const permissions = S.data.config.permissions || {};
  const enabled = Boolean(cfg.enabled && permissions.computerControl);
  return `<div class="device-layout">
    <div class="stack">
      <section class="card">
        <div class="phone-meta"><div class="card-title" style="margin:0">${icon('cpu')}Windows 桌面 ${enabled?badge('已授权','badge-teal'):badge('未授权','badge-outline')}</div><button class="btn btn-sm" data-action="computer-refresh">${icon('refresh')}刷新</button></div>
        <div class="computer-screen">${S.computerShot?.dataUrl ? `<img src="${S.computerShot.dataUrl}" alt="电脑屏幕">` : `<div class="empty-screen">${icon('cpu')}<br>电脑控制默认关闭<br><span class="tiny">在右侧开启权限后截图；截图只在本页查看，不进入多模态记忆</span></div>`}</div>
        <div class="screen-actions" style="margin-top:10px"><button class="btn btn-sm btn-primary" data-action="computer-screenshot" ${enabled?'':'disabled'}>${icon('camera')}截取桌面</button><button class="btn btn-sm" data-action="computer-windows">${icon('eye')}窗口列表</button></div>
        ${S.windows ? `<div class="window-list">${(S.windows.windows||[]).slice(0,20).map((win)=>`<div class="window-row">${icon('cpu')}<span>${esc(win.title)}</span><code>${win.pid} ${esc(win.process)}</code></div>`).join('')}</div>` : ''}
      </section>
    </div>
    <div class="stack">
      <section class="card">
        <div class="card-title">${icon('shield')}权限</div>
        <form data-form="computer-save">
          <div class="switchline"><div class="switch-copy">允许伴行操作电脑<small>关闭时所有电脑工具不可见</small></div><label class="switch"><input type="checkbox" name="enabled" ${cfg.enabled?'checked':''}><span></span></label></div>
          <div class="switchline"><div class="switch-copy">鼠标点击<small>仅限当前桌面坐标</small></div><label class="switch"><input type="checkbox" name="mouse" ${cfg.permissions?.mouse!==false?'checked':''}><span></span></label></div>
          <div class="switchline"><div class="switch-copy">键盘输入<small>Unicode 文本与按键组合</small></div><label class="switch"><input type="checkbox" name="keyboard" ${cfg.permissions?.keyboard!==false?'checked':''}><span></span></label></div>
          <div class="switchline"><div class="switch-copy">启动应用<small>程序和 URL</small></div><label class="switch"><input type="checkbox" name="appLaunch" ${cfg.permissions?.appLaunch!==false?'checked':''}><span></span></label></div>
          <div class="switchline"><div class="switch-copy">PowerShell 执行<small style="color:#b6473c">高风险，默认关闭</small></div><label class="switch"><input type="checkbox" name="shellPermission" ${cfg.allowShell?'checked':''}><span></span></label></div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">保存授权</button></div>
        </form>
      </section>
      <section class="card">
        <div class="card-title">${icon('cpu')}测试操作</div>
        <div class="control-grid">
          <div class="control-group"><h4>点击</h4><div class="inline-fields"><input class="input" id="pc-x" placeholder="x"><input class="input" id="pc-y" placeholder="y"><button class="btn btn-sm" data-action="computer-click" ${enabled?'':'disabled'}>点击</button></div></div>
          <div class="control-group"><h4>输入</h4><div class="inline-fields"><input class="input" id="pc-text" placeholder="文本"><button class="btn btn-sm" data-action="computer-type" ${enabled?'':'disabled'}>输入</button></div></div>
          <div class="control-group"><h4>按键</h4><div class="inline-fields"><input class="input" id="pc-keys" placeholder="^s 保存"><button class="btn btn-sm" data-action="computer-keys" ${enabled?'':'disabled'}>发送</button></div></div>
          <div class="control-group"><h4>启动</h4><div class="inline-fields"><input class="input" id="pc-launch" placeholder="notepad 或 https://…"><button class="btn btn-sm" data-action="computer-launch" ${enabled?'':'disabled'}>启动</button></div></div>
        </div>
      </section>
      <section class="card"><div class="card-title">${icon('shield')}风险提示</div><p class="card-note">电脑控制相当于把桌面交给 AI 工具。保持“需要时开启”，不要在不信任的模型会话里长期开启 PowerShell。桌面截图只在本页临时查看、不写入多模态记忆，但仍可能包含敏感画面；手机截图会进入多模态记忆。</p></section>
    </div>
  </div>`;
}

// ── views: models ───────────────────────────────────────────────────────────
function capabilityChip(label, value, detail = '') {
  if (value === true) return `<span class="cap ok">${icon('check')}${label}${detail ? ` · ${esc(detail)}` : ''}</span>`;
  if (value === false && detail) return `<span class="cap fail">${icon('warning')}${label}</span>`;
  return `<span class="cap">${label} 未验证</span>`;
}

function modelOptionsHtml(role, current) {
  const discovery = S.modelDiscovery?.[role] || {};
  const discovered = discovery.models || [];
  const items = new Map((discovery.items || []).map((item) => [item.id, item]));
  const values = [...new Set([current, ...discovered].filter(Boolean))];
  if (!values.length) return '<option value="">填写 URL / Key 后自动探测</option>';
  return values.map((value) => {
    const vision = items.get(value)?.vision;
    const suffix = vision ? ' · 支持图片' : '';
    return `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}${suffix}</option>`;
  }).join('');
}

function modelAlias(value) {
  const id = String(value || '').trim().toLowerCase();
  if (/^deepseek-v4(?:\.1)?-flash(?:-vision-exp)?$/.test(id)) return 'deepseek-flash';
  return '';
}

function preferredModel(role, models, items = []) {
  if (!models.length) return '';
  const byId = new Map(items.map((item) => [item.id, item]));
  const visionIds = models.filter((model) => byId.get(model)?.vision);
  const namedVision = models.find((item) => /(deepseek-flash|v4\.1-flash|v4.*flash|vl|vision|omni|multimodal|gpt-4o|claude-3)/i.test(item));
  if (role === 'helper') return visionIds[0] || namedVision || models[0];
  return visionIds[0] || namedVision || models.find((item) => /(deepseek-chat|deepseek-reasoner|qwen)/i.test(item)) || models[0];
}

async function discoverModels(role, { silent = false } = {}) {
  const form = role === 'primary' ? $('[data-form="model-primary"]') : $('[data-form="model-helper"]');
  if (!form) return null;
  const data = formObject(form);
  try {
    const result = await call('models:discover', {
      role,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
      protocol: data.protocol
    });
    S.modelDiscovery[role] = result;
    const select = form.querySelector('[data-model-select]');
    if (select) {
      const current = select.value;
      const alias = modelAlias(current);
      // 旧版 Flash 别名自动归一到官方 deepseek-flash；其他未知 ID 保留为当前项，不静默丢弃。
      const values = current && !result.models.includes(current) && !result.models.includes(alias)
        ? [current, ...result.models]
        : result.models;
      const chosen = result.models.includes(current) ? current
        : alias && result.models.includes(alias) ? alias
          : current && !alias ? current : preferredModel(role, result.models, result.items);
      select.innerHTML = values.map((model) => `<option value="${esc(model)}" ${model === chosen ? 'selected' : ''}>${esc(model)}</option>`).join('');
    }
    if (!silent) toast(`探测到 ${result.models.length} 个可用模型`, 'ok', 5000);
    return result;
  } catch (error) {
    if (!silent) toast(`模型探测失败：${error.message}`, 'error', 8000);
    return null;
  }
}

async function autoDiscoverModels() {
  if (S.route !== 'models') return;
  const cfg = S.data?.config?.models || {};
  for (const role of ['primary', 'helper']) {
    const item = cfg[role] || {};
    if (S.modelDiscoveryAttempted[role]) continue;
    if (!item.baseUrl) continue;
    if (role === 'helper' && item.enabled === false) continue;
    const local = /127\.0\.0\.1|localhost/i.test(item.baseUrl);
    if (!item.hasApiKey && !local) continue;
    S.modelDiscoveryAttempted[role] = true;
    await discoverModels(role, { silent: true });
  }
}

function viewModels() {
  const primary = S.data.config.models.primary;
  const helper = S.data.config.models.helper;
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">MODEL ACCESS</div><h1 class="page-title">只填 URL 和 Key，模型由接口自己报出来</h1><p class="page-desc">支持 OpenAI 兼容接口与 Anthropic Messages。填写 URL 和 API Key 后，应用会请求 <span class="code-inline">/models</span> 自动探测可用模型，不再要求手输模型名。辅助模型只作为问答/观察子模型，所有行动由主模型统一决策。</p></div><div class="page-actions"><button class="btn btn-sm" data-action="discover-local">${icon('search')}发现本机 Ollama</button></div></div>
    ${!configuredPrimary() ? `<div class="banner-warning">${icon('warning')}<div>当前没有可用的主模型。填写 URL 与 Key，点“自动探测模型”选择模型，再“保存并测试”。本地模型（Ollama / LM Studio）通常不需要 Key。</div></div>` : ''}
    <div class="model-grid">
      <section class="card">
        <div class="model-card-head"><div class="model-icon">${icon('cpu')}</div><div><b>主模型 · Primary</b><span>决策、工具调用与最终回答</span></div>${badge(primary.capabilities?.text?'文字已验证':'待测试', primary.capabilities?.text?'badge-teal':'badge-gold')}</div>
        <div class="capabilities">${capabilityChip('文字', primary.capabilities?.text)}${capabilityChip('多模态', primary.capabilities?.vision, primary.capabilities?.visionDetail?.slice(0,40))}${capabilityChip('工具调用', primary.capabilities?.tools)}</div>
        ${primary.capabilities?.checkedAt && !primary.capabilities.vision ? `<div class="model-diagnostic">${icon('warning')}<span>${esc(primary.capabilities.visionDetail || '多模态未通过')}</span></div>` : ''}
        <form data-form="model-primary">
          <div class="field"><label>API URL</label><input class="input" name="baseUrl" value="${esc(primary.baseUrl)}" placeholder="https://api.deepseek.com/v1" data-model-autodiscover="primary"></div>
          <div class="field-row" style="margin-top:9px"><div class="field"><label>协议</label><select class="select" name="protocol" data-model-autodiscover="primary"><option value="openai" ${primary.protocol==='openai'?'selected':''}>OpenAI 兼容</option><option value="anthropic" ${primary.protocol==='anthropic'?'selected':''}>Anthropic Messages</option></select></div><div class="field"><label>可用模型（自动探测）</label><select class="select" name="model" data-model-select="primary">${modelOptionsHtml('primary', primary.model)}</select></div></div>
          <div class="field" style="margin-top:9px"><label>API Key ${primary.hasApiKey?'（已保存，留空保持不变）':''}</label><div class="inline-fields"><input class="input" type="password" name="apiKey" placeholder="${primary.hasApiKey?'已保存 · 输入新值覆盖':'sk-...'}" data-model-autodiscover="primary"><button class="btn btn-sm btn-ghost" type="button" data-action="clear-primary-key">清除</button></div><div class="tiny muted" style="margin-top:4px">模型名不再手输；填写 URL 和 Key 后会自动请求 <span class="code-inline">/models</span> 并生成下拉列表。</div></div>
          <div class="field-row-3" style="margin-top:9px"><div class="field"><label>温度</label><input class="input" name="temperature" type="number" step="0.1" min="0" max="2" value="${primary.temperature}"></div><div class="field"><label>最大 tokens</label><input class="input" name="maxTokens" type="number" min="128" value="${primary.maxTokens}"></div><div class="field"><label>超时 ms</label><input class="input" name="timeoutMs" type="number" min="5000" value="${primary.timeoutMs}"></div></div>
          <div class="form-actions"><button class="btn" type="button" data-action="discover-models" data-role="primary">${icon('search')}自动探测模型</button><button class="btn" type="submit">保存</button><button class="btn btn-primary" type="button" data-action="test-primary">${icon('sparkle')}保存并测试</button></div>
          <div class="tiny muted" style="margin-top:5px">模型列表来自接口返回；填入 URL/Key 后自动刷新，也可以点“自动探测模型”。</div>
        </form>
        <div class="local-model-box">${icon('cpu')}本机模型：<code>http://127.0.0.1:11434/v1</code>（Ollama）或 LM Studio 的 OpenAI 兼容地址。不需要 API Key。</div>
      </section>
      <section class="card">
        <div class="model-card-head"><div class="model-icon helper">${icon('eye')}</div><div><b>多模态问答模型 · Helper</b><span>观察图片、回答独立问题，全部听从主模型</span></div><label class="switch"><input type="checkbox" id="helper-enabled" ${helper.enabled?'checked':''}><span></span></label></div>
        <div class="capabilities">${capabilityChip('文字', helper.capabilities?.text)}${capabilityChip('视觉', helper.capabilities?.vision, helper.capabilities?.visionDetail?.slice(0,40))}</div>
        ${helper.capabilities?.checkedAt && !helper.capabilities.vision ? `<div class="model-diagnostic">${icon('warning')}<span>${esc(helper.capabilities.visionDetail || '视觉未通过')}</span></div>` : ''}
        <form data-form="model-helper">
          <div class="field"><label>API URL</label><input class="input" name="baseUrl" value="${esc(helper.baseUrl||'')}" placeholder="https://api.openai.com/v1 或本地地址" data-model-autodiscover="helper"></div>
          <div class="field-row" style="margin-top:9px"><div class="field"><label>协议</label><select class="select" name="protocol" data-model-autodiscover="helper"><option value="openai" ${helper.protocol==='openai'?'selected':''}>OpenAI 兼容</option><option value="anthropic" ${helper.protocol==='anthropic'?'selected':''}>Anthropic Messages</option></select></div><div class="field"><label>可用模型（自动探测）</label><select class="select" name="model" data-model-select="helper">${modelOptionsHtml('helper', helper.model)}</select></div></div>
          <div class="field" style="margin-top:9px"><label>API Key ${helper.hasApiKey?'（已保存，留空保持不变）':''}</label><div class="inline-fields"><input class="input" type="password" name="apiKey" placeholder="${helper.hasApiKey?'已保存 · 输入新值覆盖':'sk-...'}"><button class="btn btn-sm btn-ghost" type="button" data-action="clear-helper-key">清除</button></div></div>
          <div class="field-row-3" style="margin-top:9px"><div class="field"><label>温度</label><input class="input" name="temperature" type="number" step="0.1" min="0" max="2" value="${helper.temperature}"></div><div class="field"><label>最大 tokens</label><input class="input" name="maxTokens" type="number" min="128" value="${helper.maxTokens}"></div><div class="field"><label>超时 ms</label><input class="input" name="timeoutMs" type="number" min="5000" value="${helper.timeoutMs}"></div></div>
          <div class="form-actions"><button class="btn" type="button" data-action="discover-models" data-role="helper">${icon('search')}自动探测模型</button><button class="btn" type="submit">保存</button><button class="btn btn-teal" type="button" data-action="test-helper">${icon('eye')}保存并测试多模态</button></div>
        </form>
        <div class="notice" style="margin-top:10px">${icon('sparkle')}<div>它们没有独立人格，也不会自行联系 QQ 或操作设备。主模型调用 <span class="code-inline">ask_helper</span> 时，Helper 才会收到被限定的问题与图片。</div></div>
      </section>
    </div>
    <section class="card" style="margin-top:15px">
      <div class="card-title">${icon('camera')}多模态插件插槽<span class="card-actions"><span class="tiny muted">输出统一回主模型；子模型只观察/处理</span></span></div>
      <p class="small muted" style="margin:2px 0 10px">五个插槽：识图、OCR、语音转写、文档解析、图像生成。选择 primary / helper / off；主模型通过 <span class="code-inline">multimodal_task</span> 调用，最终回答仍由主模型完成。</p>
      <div class="mm-slots">
        ${(S.data.config.multimodal?.slots || []).map((slot) => `<div class="mm-slot"><div><b>${esc(slot.label || slot.id)}</b><small>${esc(slot.description || '')}${slot.model ? `<br>端点：${esc(slot.model)}` : ''}</small></div><select class="select" data-mm-role="${esc(slot.id)}"><option value="primary" ${slot.role==='primary'?'selected':''}>主模型</option><option value="helper" ${slot.role==='helper'?'selected':''}>辅助模型</option><option value="custom" ${slot.role==='custom'?'selected':''}>自定义端点</option><option value="off" ${slot.role==='off'?'selected':''}>关闭</option></select><button class="btn btn-sm btn-ghost" data-action="mm-slot-config" data-id="${esc(slot.id)}">配置</button></div>`).join('')}
      </div>
      <div class="form-actions"><button class="btn" type="button" data-action="multimodal-save">${icon('check')}保存插槽路由</button></div>
    </section>
    <section class="card" style="margin-top:15px">
      <div class="card-title">${icon('shield')}权限与工具口</div>
      <form data-form="permissions">
        <div class="permissions-grid">
          <div class="permission-card"><h4>联网检索</h4><p>允许学习闭环与主模型读取公网信源。内网地址会被 SSRF 防护拦截。</p><label class="checkline"><input type="checkbox" name="webSearch" ${S.data.config.permissions.webSearch?'checked':''}>开启 web_search / research_topic</label></div>
          <div class="permission-card"><h4>QQ 发送</h4><p>允许主模型在用户明确要求时向白名单目标发送消息。</p><label class="checkline"><input type="checkbox" name="qqSend" ${S.data.config.permissions.qqSend?'checked':''}>开启 QQ 发送工具</label></div>
          <div class="permission-card"><h4>手机控制</h4><p>允许读取屏幕、点击、输入和启动应用。需 ADB 设备授权。</p><label class="checkline"><input type="checkbox" name="phoneControl" ${S.data.config.permissions.phoneControl?'checked':''}>开启手机工具</label></div>
          <div class="permission-card"><h4>电脑控制</h4><p>在电脑页单独授权后，才允许操作鼠标键盘和屏幕。</p><label class="checkline"><input type="checkbox" name="computerControl" ${S.data.config.permissions.computerControl?'checked':''}>开启电脑工具</label></div>
          <div class="permission-card"><h4>MCP 扩展</h4><p>允许伴行连接你添加的 MCP 服务。扩展工具由对应服务器提供。</p><label class="checkline"><input type="checkbox" name="mcpServers" ${S.data.config.permissions.mcpServers?'checked':''}>开启 MCP 工具</label></div>
          <div class="permission-card"><h4>危险 Shell</h4><p>同时开启电脑页的 PowerShell 开关后才会生效。默认关闭。</p><label class="checkline"><input type="checkbox" name="dangerousShell" ${S.data.config.permissions.dangerousShell?'checked':''}>允许 shell 工具</label></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">保存权限</button></div>
      </form>
    </section>
  </div>`;
}

// ── views: plugins ──────────────────────────────────────────────────────────
function viewPlugins() {
  const pluginData = S.data.plugins || { plugins: [], tools: [] };
  const mcpData = S.data.mcp || { servers: [] };
  const samples = [{ id: 'phone', name: '手机 MCP', args: ['mcp/phone/mcp-phone.bundle.mjs'] }, { id: 'computer', name: '电脑 MCP', args: ['mcp/computer/mcp-computer.bundle.mjs'] }];
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">PLUGIN PORT · MCP PORT</div><h1 class="page-title">能力可以长出来，权力不必交出去</h1><p class="page-desc">插件通过受控 API 注册工具与 hooks；MCP 服务作为外部进程接入。新增能力不会改写核心记忆，也不能绕过权限开关。</p></div><div class="page-actions"><button class="btn" data-action="plugins-open-folder">${icon('folder')}插件目录</button><button class="btn" data-action="plugins-reload">${icon('refresh')}重新加载</button></div></div>
    <div class="grid grid-2" style="align-items:start">
      <div class="stack">
        <section class="card"><div class="card-title">${icon('plug')}已安装插件<span class="card-actions"><span class="small muted">${pluginData.plugins?.length||0} 个</span></span></div>
          <div class="stack">${(pluginData.plugins||[]).map((plugin)=>`<article class="plugin-card"><div class="plugin-icon">${plugin.builtin?'H':'P'}</div><div class="plugin-copy"><h3>${esc(plugin.name)} ${plugin.builtin?badge('内置','badge-teal'):badge(plugin.status==='active'?'启用':'停用',plugin.status==='active'?'badge-teal':'badge-outline')}</h3><p>${esc(plugin.description)}</p><div class="tiny muted">${esc(plugin.id)} · v${esc(plugin.version)} · ${esc(plugin.author||'')}</div><div class="tool-pills">${(plugin.tools||[]).map((tool)=>`<span class="tool-pill">${esc(tool)}</span>`).join('')}</div>${plugin.error?`<div class="tiny" style="color:#b6473c">${esc(plugin.error)}</div>`:''}<div class="plugin-actions"><label class="switch"><input type="checkbox" ${plugin.status==='active'?'checked':''} data-action="plugin-toggle" data-id="${esc(plugin.id)}"><span></span></label><button class="btn btn-sm btn-ghost" data-action="plugin-folder" data-id="${esc(plugin.id)}">打开目录</button><span class="tiny muted">${esc((plugin.permissions||[]).join(' · '))}</span></div></div></article>`).join('') || `<div class="empty-rail">plugins/ 下还没有清单。</div>`}</div>
        </section>
        <section class="card"><div class="card-title">${icon('sparkle')}插件口怎么用<span class="card-actions"><span class="small muted">plugins/&lt;id&gt;/</span></span></div><p class="card-note">创建 <span class="code-inline">plugin.json</span> 与 <span class="code-inline">index.js</span>，导出 <span class="code-inline">activate(api)</span>。通过 <span class="code-inline">api.registerTool()</span> 注册工具、<span class="code-inline">api.on('onUserMessage', fn)</span> 挂接生命周期。插件默认不启用；新增第三方插件需在列表中手动开启。</p><div class="notice" style="margin-top:9px">${icon('shield')}<div>插件运行在主进程中，拥有你授予的本地能力。只加载你读过源码的插件；示例插件位于 <span class="code-inline">plugins/example-tool</span>。</div></div></section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-title">${icon('plug')}MCP 服务<span class="card-actions"><span class="small muted">${mcpData.servers?.length||0} 个</span></span></div>
          <div class="stack">${(mcpData.servers||[]).map((server)=>`<article class="mcp-card"><div class="mcp-card-head">${statusDot(server.status==='running',server.status==='error')}<b>${esc(server.name)}</b>${badge(server.status,server.status==='running'?'badge-teal':server.status==='error'?'badge-danger':'badge-outline')}<div class="spacer"></div><button class="btn btn-sm" data-action="mcp-restart" data-id="${esc(server.id)}">${icon('refresh')}</button></div><div class="tiny muted" style="margin-top:4px">${esc(server.transport)} · ${esc(server.command||server.url)} ${esc((server.args||[]).join(' '))}</div>${server.error?`<div class="tiny" style="color:#b6473c;margin-top:4px">${esc(server.error)}</div>`:''}<div class="tool-pills">${(server.tools||[]).slice(0,12).map((tool)=>`<span class="tool-pill">${esc(tool)}</span>`).join('')}</div><div class="plugin-actions"><button class="btn btn-sm" data-action="mcp-toggle" data-id="${esc(server.id)}" data-enabled="${server.enabled?'false':'true'}">${server.enabled?'停用':'启用'}</button><button class="btn btn-sm btn-danger" data-action="mcp-remove" data-id="${esc(server.id)}">移除</button></div></article>`).join('') || `<div class="empty-rail">还没有 MCP 服务。可以用下方示例添加手机/电脑 MCP，或接入你自己的虚拟机/本地模型服务。</div>`}</div>
        </section>
        <section class="card"><div class="card-title">${icon('plus')}添加 MCP</div>
          <div class="row" style="margin-bottom:9px">${samples.map((sample)=>`<button class="btn btn-sm" data-action="mcp-add-sample" data-sample="${sample.id}">${icon('plus')}${esc(sample.name)}示例</button>`).join('')}</div>
          <form data-form="mcp-add">
            <div class="mcp-form-grid"><div class="field"><label>名称</label><input class="input" name="name" placeholder="我的虚拟机 MCP"></div><div class="field"><label>传输</label><select class="select" name="transport"><option value="stdio">stdio</option><option value="http">HTTP</option></select></div></div>
            <div class="field" style="margin-top:8px"><label>命令（stdio）</label><input class="input" name="command" placeholder="node 或 npx" value="node"></div>
            <div class="field" style="margin-top:8px"><label>参数（每行一个，${'${ROOT}'} 会替换为工作目录）</label><textarea class="textarea codearea" name="args" placeholder="mcp/phone/mcp-phone.js"></textarea></div>
            <div class="field" style="margin-top:8px"><label>HTTP URL（transport=http 时）</label><input class="input" name="url" placeholder="http://127.0.0.1:3333/mcp"></div>
            <div class="field" style="margin-top:8px"><label>环境变量 JSON</label><textarea class="textarea codearea" name="env" placeholder='{"API_KEY":""}'></textarea></div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('plus')}添加并启动</button></div>
          </form>
        </section>
      </div>
    </div>
  </div>`;
}

// ── views: settings ─────────────────────────────────────────────────────────
function viewSettings() {
  const app = S.data.app || {};
  const paths = S.data.paths || {};
  return `<div class="page">
    <div class="page-head"><div><div class="page-eyebrow">LOCAL FIRST</div><h1 class="page-title">所有东西，都在这个文件夹里</h1><p class="page-desc">记忆、日志、媒体、插件、配置和便携运行时都不写到系统目录（Chromium 缓存也固定在 data/.electron）。你可以随时备份或迁移整个工作目录。</p></div><div class="page-actions"><button class="btn" data-action="open-workspace">${icon('folder')}打开工作目录</button><button class="btn btn-primary" data-action="run-check">${icon('shield')}运行只读检查</button></div></div>
    <div class="grid grid-2" style="align-items:start">
      <div class="stack">
        <section class="card"><div class="card-title">${icon('folder')}路径</div><div class="path-grid">
          <div class="path-item">${icon('folder')}<code>${esc(paths.workspace||app.workspace||'')}</code><button class="btn btn-sm" data-action="open-path" data-key="workspace">打开</button></div>
          <div class="path-item">${icon('brain')}<code>${esc(paths.data||'data')}</code><button class="btn btn-sm" data-action="open-path" data-key="data">打开</button></div>
          <div class="path-item">${icon('brain')}<code>data/memory</code><button class="btn btn-sm" data-action="open-path" data-key="memory">打开</button></div>
          <div class="path-item">${icon('plug')}<code>plugins/</code><button class="btn btn-sm" data-action="open-path" data-key="plugins">打开</button></div>
          <div class="path-item">${icon('qq')}<code>integrations/SnowLuma</code><button class="btn btn-sm" data-action="open-path" data-key="snowluma">打开</button></div>
          <div class="path-item">${icon('clock')}<code>data/logs</code><button class="btn btn-sm" data-action="open-path" data-key="logs">打开</button></div>
        </div>
        <div class="notice" style="margin-top:10px">${icon('shield')}<div>只读检查脚本同时存在于工作目录的「检查环境-只读.bat」和应用内置副本中。它不会创建、修改或删除任何文件。</div></div>
        </section>
        <section class="card"><div class="card-title">${icon('check')}只读环境检查<span class="card-actions">${S.checkRunning?badge('运行中','badge-gold'):S.checkOutput?badge('已运行','badge-teal'):''}</span></div><div class="check-output" id="check-output">${esc(S.checkOutput || '点击右上角“运行只读检查”。脚本会检查关键文件、配置摘要、记忆计数和本机端口，不测试登录与密钥有效性。')}</div><div class="row" style="margin-top:9px"><span class="small muted">独立脚本：${esc(paths.checkScript||'检查环境-只读.bat')}</span><button class="btn btn-sm" style="margin-left:auto" data-action="copy-check">${icon('external')}复制结果</button></div></section>
        <section class="card"><div class="card-title">${icon('settings')}运行偏好</div><form data-form="settings-general"><label class="checkline"><input type="checkbox" name="checkOnStart" ${S.data.config.app?.checkOnStart!==false?'checked':''}>启动后自动运行只读检查（只读，不修改文件）</label><label class="checkline"><input type="checkbox" name="autoResearch" ${S.data.config.memory?.autoResearch!==false?'checked':''}>知识库不确定或命中过时条目时自动联网查证（会消耗模型与网络）</label><div class="field-row" style="margin-top:8px"><div class="field"><label>工作日志空闲阈值（分钟）</label><input class="input" type="number" min="10" max="10080" name="worklogIdleMinutes" value="${S.data.config.memory?.worklogIdleMinutes||300}"></div><div class="field"><label>知识时效窗口（天）</label><input class="input" type="number" min="1" max="3650" name="staleAfterDays" value="${S.data.config.memory?.staleAfterDays||90}"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">保存</button></div></form></section>
        <section class="card"><div class="card-title">${icon('search')}搜索与爬虫</div><form data-form="settings-search">
          <div class="field"><label>搜索引擎（可多选）</label><div class="search-engines">${[['bing','Bing'],['duckduckgo','DuckDuckGo'],['wikipedia','Wikipedia'],['baidu','百度'],['sogou','搜狗'],['searxng','SearXNG']].map(([id,label]) => `<label class="checkline"><input type="checkbox" name="provider_${id}" ${(S.data.config.search?.providers||['bing','duckduckgo','wikipedia']).includes(id)?'checked':''}>${label}</label>`).join('')}</div></div>
          <div class="field-row" style="margin-top:9px"><div class="field"><label>SearXNG URL（可选）</label><input class="input" name="searxngUrl" value="${esc(S.data.config.search?.searxngUrl||'')}" placeholder="http://127.0.0.1:8080"></div><div class="field"><label>浏览器路径（可选）</label><div class="inline-fields"><input class="input" name="browserPath" value="${esc(S.data.config.search?.browserPath||'')}" placeholder="留空自动找 Edge / Chrome" data-draft="browserPath"><button class="btn btn-sm" type="button" data-action="choose-path" data-kind="file" data-target="browserPath">浏览</button></div></div></div>
          <label class="checkline" style="margin-top:9px"><input type="checkbox" name="browserCrawler" ${S.data.config.search?.browserCrawler!==false?'checked':''}>启用无头 Edge/Chrome 爬虫（动态页面/视频页面）</label>
          <label class="checkline"><input type="checkbox" name="allowVideoDownload" ${S.data.config.search?.allowVideoDownload!==false?'checked':''}>允许下载视频到多模态记忆（流媒体只存元数据）</label>
          <div class="tiny muted" style="margin-top:5px">浏览器：${esc(S.data.browser?.available ? S.data.browser.path : '未检测到，需填写路径')}</div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">保存搜索设置</button></div>
        </form></section>
      </div>
      <div class="stack">
        <section class="card about-card"><div class="about-mark"><span class="brand-orbit orbit-a"></span><span class="brand-orbit orbit-b"></span><span class="brand-core"></span></div><div class="about-copy"><b>伴行 · 陪伴工作型 Agent</b><p>v${esc(app.version||'1.0.0')} · Electron ${esc(app.electron||'')} · Node ${esc(app.node||'')} · ${app.packaged?'便携版':'开发版'}</p></div></section>
        <section class="card"><div class="card-title">${icon('clock')}最近日志<span class="card-actions"><button class="btn btn-sm btn-ghost" data-action="refresh-logs">${icon('refresh')}刷新</button></span></div><div class="log-list" id="log-list">${renderLogs()}</div></section>
        <section class="card"><div class="card-title">${icon('warning')}边界说明</div><p class="card-note">SnowLuma 与 QQ 的互操作存在账号风险；本应用不包含自动扫码或绕过平台限制的能力。API Key 保存在本地 data/config.json，请勿分享整个目录。第三方软件按其各自许可使用。</p><div class="row" style="margin-top:10px"><button class="btn btn-sm" data-action="open-docs">${icon('external')}用户手册</button><button class="btn btn-sm btn-danger" data-action="quit-app">退出应用</button></div></section>
      </div>
    </div>
  </div>`;
}

function renderLogs() {
  const logs = S.logs || S.data?.logs || [];
  if (!logs.length) return '<div class="empty-rail">暂无日志。</div>';
  return logs.slice(0,80).map((entry)=>`<div class="log-row ${entry.level}"><span class="lvl">${esc(entry.level)}</span><span class="scope">${esc(entry.scope)}</span><span class="msg">${esc(entry.message)}</span></div>`).join('');
}

function renderLogsIfNeeded() {
  const target = $('#log-list');
  if (target) target.innerHTML = renderLogs();
}
// ── data loaders ────────────────────────────────────────────────────────────
async function loadMemoryData({ renderAfter = true } = {}) {
  try {
    S.memoryData = await call('memory:overview');
    const counts = {
      knowledge: S.memoryData.knowledge?.length || 0,
      relationship: S.memoryData.relationship?.length || 0,
      worklogs: S.memoryData.worklogs?.length || 0,
      weights: S.memoryData.weights?.length || 0,
      multimodal: S.memoryData.multimodal?.length || 0,
      reflections: S.memoryData.reflections?.length || 0
    };
    // 默认标签可能是空的（例如只有关系记忆）。自动落到第一个有内容的层，
    // 避免侧边栏有计数、记忆库却空白的观感。
    if (!counts[S.memoryTab]) {
      const first = MEMORY_TABS.find(([key]) => counts[key] > 0);
      if (first) S.memoryTab = first[0];
    }
    if (renderAfter && (S.route === 'memory' || S.route === 'home')) render();
  } catch (error) {
    S.memoryData = S.memoryData || null;
    toast(`记忆读取失败：${error.message}`, 'error');
  }
}

async function loadLearning() {
  try {
    S.learningList = await call('learning:list');
    if (!S.selectedCycle && S.learningList[0] && !S.liveLearning) S.selectedCycle = S.learningList[0];
    if (S.route === 'learning') render();
  } catch (error) { toast(`学习记录读取失败：${error.message}`, 'error'); }
}

async function loadPhone() {
  try {
    S.phoneStatus = await call('phone:status');
    if (S.route === 'devices') render();
  } catch (error) {
    S.phoneStatus = { ok: false, error: error.message, devices: [], mode: 'real' };
    if (S.route === 'devices') render();
    toast(`手机检查失败：${error.message}`, 'error');
  }
}

async function loadLogs() {
  try {
    S.logs = await call('logs:get');
    if (S.route === 'settings') render();
  } catch (error) { toast(error.message, 'error'); }
}

async function navigate(route) {
  if (!ROUTE_META[route]) return;
  captureDrafts();
  S.route = route;
  if (route === 'chat') {
    S.unread = 0;
    try {
      const data = await call('chat:get', { channel: 'desktop', limit: 200 });
      S.messages = data.messages || [];
    } catch {}
  }
  if (route === 'memory') {
    // 侧边栏计数来自 bootstrap，记忆库内容来自 memory:overview；两者必须每次进入都同步，
    // 否则会出现“侧边栏有数字、记忆库却是空”的旧数据问题。
    await loadMemoryData({ renderAfter: false });
  }
  if (route === 'role') {
    try { S.data.persona = await call('persona:get'); } catch {}
  }
  if (route === 'people') {
    try {
      const data = await call('people:list');
      S.data.people = data.people;
      S.data.peopleStats = data.stats;
    } catch {}
  }
  if (route === 'idle') {
    try { S.data.idleLearning = await call('idle:overview'); } catch {}
  }
  if (route === 'usage') {
    try { S.data.usage = await call('usage:summary'); } catch {}
  }
  if (route === 'models') {
    setTimeout(() => autoDiscoverModels(), 120);
  }
  if (route === 'qq') {
    try { S.data.qq = await call('qq:status'); } catch {}
  }
  if (route === 'learning' && !S.learningList) loadLearning();
  if (route === 'devices' && S.deviceTab === 'phone' && !S.phoneStatus) loadPhone();
  if (route === 'settings' && !S.logs) loadLogs();
  if (route === 'home' && !S.memoryData) loadMemoryData();
  render();
  if (route === 'chat') setTimeout(() => $('#chat-input')?.focus(), 50);
}

// ── chat actions ────────────────────────────────────────────────────────────
async function sendChatMessage(text) {
  const clean = String(text ?? '').trim();
  if (!clean && !S.attachments.length) return;
  if (!S.ready) return;
  const local = { id: `local-${Date.now()}`, role: 'user', content: clean, createdAt: new Date().toISOString(), local: true, attachments: S.attachments.map((item) => ({ kind: item.mime?.startsWith('image/') ? 'image' : 'file', path: item.path, caption: item.name })) };
  S.messages.push(local);
  S.draft = '';
  S.chatTools = [];
  const attachments = S.attachments.map((item) => ({ path: item.path, name: item.name, mime: item.mime }));
  S.attachments = [];
  S.chatStatus = { channel: 'desktop', status: 'thinking', message: '正在整理记忆与上下文…' };
  if (S.route !== 'chat') { S.route = 'chat'; }
  render();
  renderChatMessages();
  try {
    const result = await call('chat:send', { channel: 'desktop', text: clean, attachments });
    if (result?.userMessage) upsertMessage(result.userMessage);
    if (result?.assistantMessage) upsertMessage(result.assistantMessage);
    if (result?.weights) S.data.weights = result.weights;
    if (result?.tools) S.chatTools = result.tools;
    S.chatStatus = null;
    if (result?.qqMirror?.ok) toast(`回答已同步到 QQ 主人私聊 ${result.qqMirror.target}`, 'ok');
    if (result?.qqMirror && !result.qqMirror.ok) toast(`QQ 主对话回写失败：${result.qqMirror.error}`, 'error', 6000);
    if (S.route === 'chat') render();
    scheduleBootstrapRefresh();
  } catch (error) {
    S.chatStatus = null;
    S.messages = S.messages.filter((message) => message.id !== local.id);
    if (S.route === 'chat') renderChatMessages();
    toast(`发送失败：${error.message}`, 'error', 7000);
  }
}

function openImageModal(url, caption) {
  openModal(`<div class="modal-head"><h2>${esc(caption || '图片')}</h2><button class="modal-close" data-action="close-modal">×</button></div><img class="modal-img" src="${esc(url)}" alt="${esc(caption || '')}">`);
}

// ── modals ──────────────────────────────────────────────────────────────────
function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.classList.add('open');
}

function closeModal() {
  const root = $('#modal-root');
  root.classList.remove('open');
  root.innerHTML = '';
}

function openAddKnowledge() {
  openModal(`<div class="modal-head"><h2>手动记一条知识</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="add-knowledge">
      <div class="field"><label>标题</label><input class="input" name="title" required placeholder="一句话说明这条资料是什么"></div>
      <div class="field" style="margin-top:9px"><label>内容</label><textarea class="textarea" name="content" rows="5" required placeholder="保留原始限定条件、统计口径与时间。不要把推测写成事实。"></textarea></div>
      <div class="field-row" style="margin-top:9px"><div class="field"><label>标签（逗号分隔）</label><input class="input" name="tags" placeholder="资料, 工作"></div><div class="field"><label>置信度 0-1</label><input class="input" name="confidence" type="number" min="0" max="1" step="0.05" value="0.8"></div></div>
      <div class="field" style="margin-top:9px"><label>来源 URL（换行分隔，可留空）</label><textarea class="textarea" name="sourceUrls" rows="2" placeholder="https://…"></textarea></div>
      <div class="notice" style="margin-top:10px">${icon('shield')}<div>有来源时才会标记为 active；没有来源会先存为 candidate。知识库不会静默覆盖旧版本，编辑与复核都会留下 revisions。</div></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">写入知识库</button></div>
    </form>`);
}

function openEditKnowledge(id) {
  const item = (S.memoryData?.knowledge || []).find((entry) => entry.id === id);
  if (!item) return;
  openModal(`<div class="modal-head"><h2>编辑知识条目</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="edit-knowledge">
      <input type="hidden" name="id" value="${esc(item.id)}">
      <div class="field"><label>标题</label><input class="input" name="title" value="${esc(item.title)}"></div>
      <div class="field" style="margin-top:9px"><label>内容</label><textarea class="textarea" name="content" rows="6">${esc(item.content)}</textarea></div>
      <div class="field-row" style="margin-top:9px"><div class="field"><label>标签</label><input class="input" name="tags" value="${esc((item.tags||[]).join(', '))}"></div><div class="field"><label>置信度</label><input class="input" type="number" min="0" max="1" step="0.05" name="confidence" value="${Number(item.confidence||0.5)}"></div></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存修订</button></div>
    </form>`);
}

function openMultimodalSlot(slotId) {
  const slot = (S.data.config.multimodal?.slots || []).find((item) => item.id === slotId);
  if (!slot) return;
  openModal(`<div class="modal-head"><h2>配置多模态插槽 · ${esc(slot.label || slot.id)}</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="multimodal-slot">
      <input type="hidden" name="id" value="${esc(slot.id)}">
      <div class="field"><label>执行方式</label><select class="select" name="role"><option value="primary" ${slot.role==='primary'?'selected':''}>主模型</option><option value="helper" ${slot.role==='helper'?'selected':''}>Helper</option><option value="custom" ${slot.role==='custom'?'selected':''}>自定义 API / 本地模型</option><option value="off" ${slot.role==='off'?'selected':''}>关闭</option></select></div>
      <div class="field" style="margin-top:9px"><label>API URL（自定义时填，可填本地 Ollama / LM Studio）</label><input class="input" name="baseUrl" value="${esc(slot.baseUrl || '')}" placeholder="http://127.0.0.1:11434/v1 或 https://.../v1"></div>
      <div class="field-row" style="margin-top:9px"><div class="field"><label>协议</label><select class="select" name="protocol"><option value="openai" ${slot.protocol!=='anthropic'?'selected':''}>OpenAI 兼容</option><option value="anthropic" ${slot.protocol==='anthropic'?'selected':''}>Anthropic</option></select></div><div class="field"><label>模型名</label><input class="input" name="model" value="${esc(slot.model || '')}" placeholder="qwen2.5-vl / llava / ..."></div></div>
      <div class="field" style="margin-top:9px"><label>API Key ${slot.hasApiKey ? '（已保存，留空不变）' : '（本地模型可留空）'}</label><input class="input" type="password" name="apiKey" placeholder="${slot.hasApiKey ? '已保存' : 'sk-...'}"></div>
      <div class="notice" style="margin-top:10px">${icon('cpu')}<div>主模型会通过 multimodal_task 调用这个端点；端点只返回观察/处理结果，最终回答仍由主模型负责。</div></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存插槽</button></div>
    </form>`);
}

function openDiaryWrite() {
  openModal(`<div class="modal-head"><h2>写一篇日记</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="diary-write">
      <div class="field"><label>标题</label><input class="input" name="title" maxlength="80" placeholder="今天的一小段"></div>
      <div class="field" style="margin-top:9px"><label>正文</label><textarea class="textarea" name="content" rows="7" required placeholder="写点什么…"></textarea></div>
      <div class="field-row" style="margin-top:9px"><div class="field"><label>心情</label><input class="input" name="mood" placeholder="平静 / 有点累 / 开心"></div><div class="field"><label>标签</label><input class="input" name="tags" placeholder="工作, 生活"></div></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存日记</button></div>
    </form>`);
}

function openAddRelationship() {
  openModal(`<div class="modal-head"><h2>记一条关系记忆</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="add-relationship">
      <div class="field"><label>类型</label><select class="select" name="kind"><option value="preference">偏好</option><option value="emotional_event">情感事件</option><option value="persona">人格画像</option><option value="boundary">边界</option></select></div>
      <div class="field" style="margin-top:9px"><label>内容</label><textarea class="textarea" name="content" rows="3" required placeholder="例如：晚上十点后不希望被工作打扰。"></textarea></div>
      <div class="field" style="margin-top:9px"><label>置信度</label><input class="input" type="number" name="confidence" min="0" max="1" step="0.05" value="0.85"></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">记下来</button></div>
    </form>`);
}

function openEditRelationship(id) {
  const item = (S.memoryData?.relationship || []).find((entry) => entry.id === id);
  if (!item) return;
  const labels = { preference: '偏好', emotional_event: '情感事件', emotional_material: '自学习情感材料', persona: '人格画像', boundary: '边界', important_person: '重要的人' };
  openModal(`<div class="modal-head"><h2>修正关系记忆</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="edit-relationship">
      <input type="hidden" name="id" value="${esc(item.id)}">
      <div class="field"><label>类型</label><select class="select" name="kind">${Object.entries(labels).map(([key, label]) => `<option value="${key}" ${item.kind === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field" style="margin-top:9px"><label>内容</label><textarea class="textarea" name="content" rows="4" required>${esc(item.content)}</textarea></div>
      <div class="field" style="margin-top:9px"><label>置信度</label><input class="input" type="number" name="confidence" min="0" max="1" step="0.05" value="${Number(item.confidence ?? 0.8)}"></div>
      <div class="notice" style="margin-top:10px">${icon('edit')}<div>这是你手动修正的记忆，会标记 editedBy=user；检索时会使用修正后的内容。</div></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存修正</button></div>
    </form>`);
}

function openEditActiveWork(channel) {
  const item = (S.memoryData?.activeWork || []).find((entry) => entry.channel === channel);
  if (!item) return;
  openModal(`<div class="modal-head"><h2>修正进行中的工作</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="edit-active-work">
      <input type="hidden" name="channel" value="${esc(item.channel)}">
      <div class="field"><label>标题</label><input class="input" name="title" value="${esc(item.title || '')}" required></div>
      <div class="field" style="margin-top:9px"><label>目标</label><textarea class="textarea" name="objective" rows="4">${esc(item.objective || '')}</textarea></div>
      <div class="notice" style="margin-top:10px">${icon('edit')}<div>修正后会继续沿用这条工作线，不会清除已有上下文。</div></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存修正</button></div>
    </form>`);
}

function openEditWorklog(id) {
  const item = (S.memoryData?.worklogs || []).find((entry) => entry.id === id);
  if (!item) return;
  openModal(`<div class="modal-head"><h2>修正工作日志</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="edit-worklog">
      <input type="hidden" name="id" value="${esc(item.id)}">
      <div class="field"><label>标题</label><input class="input" name="title" value="${esc(item.title || '')}" required></div>
      <div class="field" style="margin-top:9px"><label>摘要</label><textarea class="textarea" name="summary" rows="4">${esc(item.summary || '')}</textarea></div>
      <div class="field" style="margin-top:9px"><label>下一步</label><input class="input" name="nextSteps" value="${esc(item.nextSteps || '')}"></div>
      <div class="field" style="margin-top:9px"><label>结果</label><input class="input" name="result" value="${esc(item.result || '')}"></div>
      <div class="form-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存修正</button></div>
    </form>`);
}

function openEditMedia(id) {
  const item = (S.memoryData?.multimodal || []).find((entry) => entry.id === id);
  if (!item) return;
  openModal(`<div class="modal-head"><h2>修正多模态记忆</h2><button class="modal-close" data-action="close-modal">×</button></div>
    <form data-form="edit-media">
      <input type="hidden" name="id" value="${esc(item.id)}">
      ${item.mime?.startsWith('image/') ? `<img src="${esc(item.url)}" alt="${esc(item.caption || item.fileName)}" style="max-width:100%;max-height:260px;border-radius:10px;object-fit:contain;background:#f3ecdf">` : ''}
      <div class="field" style="margin-top:10px"><label>说明</label><textarea class="textarea" name="caption" rows="3">${esc(item.caption || '')}</textarea></div>
      <div class="field" style="margin-top:9px"><label>标签（逗号分隔）</label><input class="input" name="tags" value="${esc((item.tags || []).join(', '))}"></div>
      <div class="tiny muted" style="margin-top:8px">${esc(item.kind || '')} · ${esc(item.fileName || '')} · ${timeShort(item.createdAt)}</div>
      <div class="form-actions"><button class="btn btn-danger" type="button" data-action="delete-media" data-id="${esc(item.id)}">删除这条记忆</button><span class="spacer"></span><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存说明</button></div>
    </form>`);
}

// ── check / clipboard ───────────────────────────────────────────────────────
async function runCheck(button = null, { silent = false } = {}) {
  if (S.checkRunning) {
    if (!silent) toast('只读检查正在运行…', 'info');
    return;
  }
  S.checkRunning = true;
  if (!silent && S.route !== 'settings') {
    S.route = 'settings';
    render();
  }
  if (S.route === 'settings') render();
  try {
    const result = await call('check:run');
    S.checkOutput = `$ ${result.script}\n\n${result.output}\n\n[退出码 ${result.code}]`;
    if (!silent || result.code !== 0) {
      toast(result.code === 0 ? '只读检查通过' : '只读检查发现缺失项，请查看输出', result.code === 0 ? 'ok' : 'error');
    }
  } catch (error) {
    S.checkOutput = `检查执行失败：${error.message}`;
    if (!silent) toast(error.message, 'error');
  } finally {
    S.checkRunning = false;
    if (S.route === 'settings') render();
  }
}

async function copyCheckOutput() {
  const text = S.checkOutput || '';
  if (!text) return toast('还没有检查结果', 'info');
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制检查结果', 'ok');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    toast('已复制检查结果', 'ok');
  }
}

// ── forms ───────────────────────────────────────────────────────────────────
function formObject(form) {
  const out = {};
  for (const [key, value] of new FormData(form).entries()) out[key] = value;
  return out;
}
const listFrom = (value) => String(value || '').split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean);

async function submitForm(form) {
  const name = form.dataset.form;
  const data = formObject(form);
  if (name === 'chat') {
    const value = $('#chat-input')?.value ?? S.draft;
    S.draft = '';
    await sendChatMessage(value);
    return;
  }
  if (name === 'quick-chat') {
    const value = $('#quick-input')?.value || '';
    if (!value.trim()) return;
    S.draft = '';
    S.route = 'chat';
    await sendChatMessage(value);
    return;
  }
  if (name === 'memory-search') {
    if (!String(data.query || '').trim()) return;
    try {
      S.memorySearch = { ...(await call('memory:search', { query: data.query })), query: data.query };
      render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'add-knowledge') {
    try {
      await call('memory:addKnowledge', { title: data.title, content: data.content, tags: listFrom(data.tags), sourceUrls: data.sourceUrls, confidence: Number(data.confidence) });
      closeModal();
      await loadMemoryData();
      if (S.route === 'memory') render();
      toast('已写入记忆', 'ok');
      scheduleBootstrapRefresh();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'edit-knowledge') {
    try {
      await call('memory:updateKnowledge', { id: data.id, patch: { title: data.title, content: data.content, tags: listFrom(data.tags), confidence: Number(data.confidence) } });
      closeModal();
      await loadMemoryData();
      toast('修订已保存，旧版本保留在 revisions', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'multimodal-slot') {
    try {
      const slots = (S.data.config.multimodal?.slots || []).map((slot) => slot.id === data.id ? {
        ...slot,
        role: data.role,
        baseUrl: data.baseUrl,
        protocol: data.protocol,
        model: data.model,
        ...(data.apiKey ? { apiKey: data.apiKey } : {})
      } : slot);
      const saved = await call('multimodal:save', { slots });
      S.data.config.multimodal = saved;
      closeModal();
      render();
      toast('多模态插槽已保存', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'autonomy-settings') {
    try {
      S.data.autonomy = await call('autonomy:save', { patch: {
        enabled: data.enabled === 'on',
        usePhone: data.usePhone === 'on',
        useComputer: data.useComputer === 'on',
        allowAppDownload: data.allowAppDownload === 'on',
        minIdleMinutes: Number(data.minIdleMinutes),
        cooldownMinutes: Number(data.cooldownMinutes),
        maxSteps: Number(data.maxSteps)
      } });
      render();
      toast('自主活动设置已保存', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'idle-settings') {
    try {
      S.data.idleLearning = await call('idle:save', { patch: {
        enabled: data.enabled === 'on',
        minIdleMinutes: Number(data.minIdleMinutes),
        checkIntervalMinutes: Number(data.checkIntervalMinutes),
        cooldownMinutes: Number(data.cooldownMinutes),
        maxPerDay: Number(data.maxPerDay),
        quietStart: Number(data.quietStart),
        quietEnd: Number(data.quietEnd)
      } });
      render();
      toast('自学习节奏已保存', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'music-search') {
    try {
      S.musicTracks = await call('music:search', { query: data.query });
      S.musicLyrics = null;
      render();
      toast(`找到 ${S.musicTracks.length} 首歌`, 'ok');
    } catch (error) { toast(`搜索失败：${error.message}`, 'error', 7000); }
    return;
  }
  if (name === 'music-voice') {
    try {
      S.data.config = await call('music:voiceSave', { patch: {
        rvcEnabled: data.rvcEnabled === 'on',
        pythonPath: data.pythonPath,
        repoPath: data.repoPath,
        modelPath: data.modelPath,
        indexPath: data.indexPath,
        pitch: Number(data.pitch) || 0
      } });
      render();
      toast('RVC 配置已保存', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'music-sing') {
    try {
      const result = await call('music:sing', { song: data.song, text: data.text });
      S.musicAudio = result.dataUrl;
      S.musicAudioBytes = result.bytes;
      render();
      toast('清唱已生成；在 QQ 对话里可以让伴行直接发给你', 'ok');
    } catch (error) { toast(`生成失败：${error.message}`, 'error', 7000); }
    return;
  }
  if (name === 'diary-write') {
    try {
      await call('diary:add', { title: data.title, content: data.content, mood: data.mood, tags: String(data.tags || '').split(',').map((item) => item.trim()).filter(Boolean), source: 'user' });
      closeModal();
      S.data.diary = await call('diary:list', { limit: 60 });
      render();
      toast('日记已保存', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'add-relationship') {
    try {
      await call('memory:addRelationship', { kind: data.kind, content: data.content, confidence: Number(data.confidence) });
      closeModal();
      await loadMemoryData();
      toast('关系记忆已更新', 'ok');
      scheduleBootstrapRefresh();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'edit-relationship') {
    try {
      await call('memory:updateRelationship', { id: data.id, patch: { kind: data.kind, content: data.content, confidence: Number(data.confidence) } });
      closeModal();
      await loadMemoryData();
      toast('关系记忆已修正', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'edit-active-work') {
    try {
      await call('memory:updateActiveWork', { channel: data.channel, patch: { title: data.title, objective: data.objective } });
      closeModal();
      await loadMemoryData();
      toast('进行中的工作已修正', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'edit-worklog') {
    try {
      await call('memory:updateWorklog', { id: data.id, patch: { title: data.title, summary: data.summary, nextSteps: data.nextSteps, result: data.result } });
      closeModal();
      await loadMemoryData();
      toast('工作日志已修正', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'edit-media') {
    try {
      await call('memory:updateMedia', { id: data.id, caption: data.caption, tags: listFrom(data.tags) });
      closeModal();
      await loadMemoryData();
      toast('多模态说明已修正', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'person-edit') {
    try {
      await call('people:update', {
        id: data.id,
        patch: {
          affinity: Number(data.affinity),
          impression: data.impression,
          manual: data.manual === 'on'
        }
      });
      closeModal();
      await loadPeople();
      toast('印象已保存', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'persona-edit') {
    try {
      await call('persona:update', { knowledgeLine: data.knowledgeLine, emotionLine: data.emotionLine, reason: data.reason || '用户编辑角色线' });
      closeModal();
      S.data.persona = await call('persona:get');
      render();
      toast('两条角色线已保存，修订历史保留', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'learning-run') {
    const query = String(data.query || '').trim();
    if (!query) return;
    S.learningQuery = query;
    S.learningRunning = true;
    S.liveLearning = null;
    S.selectedCycle = null;
    S.cycleDetail = null;
    render();
    try {
      const cycle = await call('learning:run', { query, archive: data.archive === 'on' });
      S.liveLearning = cycle;
      S.selectedCycle = cycle;
      S.learningRunning = false;
      S.learningList = await call('learning:list');
      S.liveLearning = null;
      S.cycleDetail = cycle;
      if (S.route === 'learning') render();
      toast('闭环完成，结论已写入可追溯记录', 'ok');
      loadMemoryData();
      scheduleBootstrapRefresh();
    } catch (error) {
      S.learningRunning = false;
      if (S.route === 'learning') render();
      toast(`查证失败：${error.message}`, 'error', 8000);
    }
    return;
  }
  if (name === 'qq-activity') {
    try {
      const result = await call('qq:save', {
        qq: {
          groupActivityMode: data.groupActivityMode === 'ai' ? 'ai' : 'manual',
          groupActivity: Number(data.groupActivity || 0),
          groupCooldownSec: Number(data.groupCooldownSec || 0),
          requireAtInGroup: data.requireAtInGroup === 'on',
          privateActivityMode: data.privateActivityMode === 'ai' ? 'ai' : 'manual',
          privateActivity: Number(data.privateActivity || 0),
          privateIdleMinutes: Number(data.privateIdleMinutes || 180),
          privateMinIntervalMinutes: Number(data.privateMinIntervalMinutes || 120),
          proactiveUseResearch: data.proactiveUseResearch === 'on',
          proactiveUsePhone: data.proactiveUsePhone === 'on'
        }
      });
      S.data.config = result.config;
      S.data.qq = result.status;
      render();
      toast('活跃度已保存；AI 动态模式会继续在后台微调', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'qq-save') {
    try {
      const payload = {
        enabled: data.enabled === 'on',
        primaryConversation: data.primaryConversation === 'on',
        autoReply: data.autoReply === 'on',
        humanize: { enabled: data.humanizeEnabled === 'on' },
        stickerUseFrequency: Math.max(0, Math.min(100, Number(data.stickerUseFrequency) || 0)),
        stickerReplyChance: Math.max(0, Math.min(100, Number(data.stickerReplyChance) || 0)),
        allowAllWhenEmpty: data.allowAllWhenEmpty === 'on',
        onebotMode: data.onebotMode === 'manual' ? 'manual' : 'auto',
        wsUrl: data.wsUrl.trim(),
        httpUrl: data.httpUrl.trim(),
        homeDir: data.homeDir.trim(),
        ownerQQ: data.ownerQQ.trim(),
        allowPrivate: listFrom(data.allowPrivate),
        allowGroups: listFrom(data.allowGroups),
        denyPrivate: listFrom(data.denyPrivate),
        denyGroups: listFrom(data.denyGroups)
      };
      if (String(data.wsToken || '').trim()) payload.wsToken = String(data.wsToken).trim();
      if (String(data.httpToken || '').trim()) payload.httpToken = String(data.httpToken).trim();
      const result = await call('qq:save', { qq: payload, permissions: { qqDynamic: data.qqDynamic === 'on' } });
      S.data.config = result.config;
      S.data.qq = result.status;
      toast('桥接配置已保存', 'ok');
      if (S.route === 'qq') render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'phone-save') {
    try {
      const result = await call('phone:save', { phone: { serial: data.serial, adbPath: data.adbPath, mode: S.phoneStatus?.mode || S.data.config.phone.mode } });
      S.phoneStatus = result.status;
      S.data.config = result.config;
      toast('手机配置已保存', 'ok');
      render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'computer-save') {
    try {
      const enabled = data.enabled === 'on';
      const result = await call('computer:save', {
        computer: {
          enabled,
          allowShell: data.shellPermission === 'on',
          permissions: { mouse: data.mouse === 'on', keyboard: data.keyboard === 'on', appLaunch: data.appLaunch === 'on', shell: data.shellPermission === 'on' },
          globalPermissions: { computerControl: enabled }
        }
      });
      S.data.config = result.config;
      S.computerStatus = { enabled: result.enabled, config: result.config.computer, permissions: result.config.permissions };
      toast('电脑控制授权已保存', 'ok');
      render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'model-primary' || name === 'model-helper') {
    try {
      await saveModelForm(name === 'model-primary' ? 'primary' : 'helper', form);
      toast('模型配置已保存', 'ok');
      S.data = await call('app:bootstrap');
      render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'permissions') {
    try {
      const patch = {
        permissions: {
          webSearch: data.webSearch === 'on',
          qqSend: data.qqSend === 'on',
          phoneControl: data.phoneControl === 'on',
          computerControl: data.computerControl === 'on',
          mcpServers: data.mcpServers === 'on',
          dangerousShell: data.dangerousShell === 'on'
        }
      };
      S.data.config = await call('settings:save', { patch });
      toast('权限已保存', 'ok');
      render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'mcp-add') {
    try {
      let env = {};
      if (String(data.env || '').trim()) {
        try { env = JSON.parse(data.env); } catch { throw new Error('环境变量不是合法 JSON'); }
      }
      const payload = {
        name: data.name.trim() || 'MCP 服务',
        transport: data.transport,
        command: data.command.trim(),
        args: String(data.args || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        url: data.url.trim(),
        env,
        enabled: true
      };
      await call('mcp:add', payload);
      toast('MCP 服务已添加，正在启动', 'ok');
      if (S.route === 'plugins') render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'settings-general') {
    try {
      const patch = {
        app: { checkOnStart: data.checkOnStart === 'on' },
        memory: { autoResearch: data.autoResearch === 'on', worklogIdleMinutes: Number(data.worklogIdleMinutes) || 300, staleAfterDays: Number(data.staleAfterDays) || 90 }
      };
      S.data.config = await call('settings:save', { patch });
      toast('设置已保存', 'ok');
      render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (name === 'settings-search') {
    try {
      const providers = ['bing','duckduckgo','wikipedia','baidu','sogou','searxng'].filter((id) => data[`provider_${id}`] === 'on');
      const patch = { search: {
        providers: providers.length ? providers : ['bing'],
        searxngUrl: String(data.searxngUrl || '').trim(),
        browserPath: String(data.browserPath || '').trim(),
        browserCrawler: data.browserCrawler === 'on',
        allowVideoDownload: data.allowVideoDownload === 'on'
      } };
      S.data.config = await call('settings:save', { patch });
      toast('搜索与爬虫设置已保存', 'ok');
      render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
}

async function saveModelForm(role, form) {
  const data = formObject(form);
  const section = {
    baseUrl: data.baseUrl.trim(),
    protocol: data.protocol,
    model: String(data.model || '').trim(),
    temperature: Number(data.temperature) || 0.7,
    maxTokens: Number(data.maxTokens) || 2000,
    timeoutMs: Number(data.timeoutMs) || 120000
  };
  if (!section.model) throw new Error('请先探测并选择一个可用模型');
  if (String(data.apiKey || '').trim()) section.apiKey = data.apiKey.trim();
  if (role === 'helper') section.enabled = $('#helper-enabled')?.checked ?? true;
  const result = await call('models:save', role === 'primary' ? { primary: section } : { helper: section });
  S.data.config = result;
  return result;
}

async function testModel(role) {
  const form = role === 'primary' ? $('[data-form="model-primary"]') : $('[data-form="model-helper"]');
  try {
    if (role === 'helper') {
      const enabled = $('#helper-enabled');
      if (enabled && !enabled.checked) enabled.checked = true;
    }
    if (form) await saveModelForm(role, form);
    toast('开始验证模型能力（多模态测试会发送一张本地测试图）…', 'info', 5500);
    const result = await call('models:test', { role, multimodal: true });
    S.data.config = result.config;
    toast(role === 'primary'
      ? `主模型：文字${result.capabilities.text ? '通过' : '失败'}，多模态${result.capabilities.vision ? '通过' : '未通过'}，${result.capabilities.visionDetail || ''}`
      : `辅助模型：文字${result.capabilities.text ? '通过' : '失败'}，视觉${result.capabilities.vision ? '通过' : '未通过'}`, result.capabilities.vision ? 'ok' : 'info', 6500);
    if (S.route === 'models') render();
  } catch (error) {
    toast(`模型测试失败：${error.message}`, 'error', 8000);
  }
}

// ── action dispatch ────────────────────────────────────────────────────────
document.addEventListener('click', async (event) => {
  const urlTarget = event.target.closest('[data-url]');
  if (urlTarget) {
    event.preventDefault();
    const url = safeUrl(urlTarget.dataset.url);
    if (url) api.invoke('shell:openExternal', { url }).catch(() => toast('打开链接失败', 'error'));
    return;
  }
  const routeTarget = event.target.closest('[data-route]');
  if (routeTarget) {
    event.preventDefault();
    navigate(routeTarget.dataset.route);
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (target.matches('input[type="checkbox"]') || target.tagName === 'INPUT') return;
  event.preventDefault();
  const action = target.dataset.action;
  const id = target.dataset.id;
  try {
    if (action === 'close-modal') closeModal();
    else if (action === 'open-workspace') api.invoke('app:openWorkspace', {});
    else if (action === 'run-check') runCheck(target);
    else if (action === 'copy-check') copyCheckOutput();
    else if (action === 'clear-chat') { if (confirm('清空桌面会话消息？记忆库不会被删除。')) { await call('chat:clear', { channel: 'desktop' }); S.messages = []; S.chatTools = []; render(); toast('会话已清空', 'ok'); } }
    else if (action === 'attach-image') {
      const files = await call('dialog:pickFiles', { kind: 'image' });
      S.attachments = [...S.attachments, ...files].slice(0, 4);
      if (S.route === 'chat') render();
    } else if (action === 'attach-file') {
      const files = await call('dialog:pickFiles', { kind: 'file' });
      S.attachments = [...S.attachments, ...files].slice(0, 4);
      if (S.route === 'chat') render();
    } else if (action === 'remove-attachment') {
      S.attachments.splice(Number(target.dataset.index), 1);
      render();
    } else if (action === 'label-stickers') {
      toast('已开始识别表情包，后台会逐张标注；可继续使用其他页面。', 'info', 6000);
      call('stickers:labelAll').then(() => {
        loadMemoryData().catch(() => {});
        toast('表情包标注完成', 'ok');
      }).catch((error) => toast(error.message, 'error'));
    } else if (action === 'memory-curate') {
      await busy(target, async () => {
        const result = await call('memory:curate');
        await loadMemoryData();
        render();
        toast(`知识库整理：晋升 ${result.promoted} · 归档 ${result.archived} · 去重 ${result.deduped}`, 'ok', 6000);
      });
    } else if (action === 'memory-refresh') {
      await busy(target, async () => {
        await loadMemoryData({ renderAfter: false });
        render();
        toast('记忆库已重新读取', 'ok');
      });
    } else if (action === 'usage-refresh') {
      await busy(target, async () => {
        S.data.usage = await call('usage:summary');
        render();
        toast('用量统计已刷新', 'ok');
      });
    } else if (action === 'usage-reset') {
      if (!confirm('清空所有 token 用量记录？不会删除聊天和记忆。')) return;
      await busy(target, async () => {
        S.data.usage = await call('usage:clear');
        render();
        toast('用量统计已重置', 'ok');
      });
    } else if (action === 'people-refresh') {
      await busy(target, async () => {
        toast('正在根据最近对话刷新人物印象…', 'info', 4000);
        const result = await call('people:refresh');
        S.data.people = result.people;
        S.data.peopleStats = result.stats;
        render();
        toast(result.updated?.length ? `已刷新 ${result.updated.length} 条印象` : '没有需要刷新的印象', 'ok');
      });
    } else if (action === 'edit-person') openPersonEdit(id);
    else if (action === 'delete-person') {
      if (!confirm('删除这个人的印象档案？已有记忆库中的关系条目不会被删除。')) return;
      await call('people:delete', { id });
      await loadPeople();
      toast('人物档案已删除', 'ok');
    } else if (action === 'persona-rollback') {
      if (!confirm('回滚到上一版角色线？会新增一条回滚修订记录。')) return;
      await busy(target, async () => {
        await call('persona:rollback');
        S.data.persona = await call('persona:get');
        render();
        toast('已回滚到上一版角色线', 'ok');
      });
    } else if (action === 'role-refresh') {
      await busy(target, async () => {
        S.data.persona = await call('persona:get');
        render();
        toast('角色线已刷新', 'ok');
      });
    } else if (action === 'open-persona-edit') openPersonaEdit();
    else if (action === 'persona-calibrate') {
      await busy(target, async () => {
        toast('AI 正在根据长期记忆校准两条线…', 'info', 5000);
        const result = await call('persona:calibrate');
        S.data.persona = await call('persona:get');
        render();
        toast(result.changed ? `角色线已更新：${result.reason}` : `本轮无需修改：${result.reason}`, result.changed ? 'ok' : 'info', 6500);
      });
    } else if (action === 'open-add-knowledge') openAddKnowledge();
    else if (action === 'edit-knowledge') openEditKnowledge(id);
    else if (action === 'mm-slot-config') openMultimodalSlot(id);
    else if (action === 'diary-write') openDiaryWrite();
    else if (action === 'diary-generate') {
      await busy(target, async () => {
        await call('diary:generate');
        S.data.diary = await call('diary:list', { limit: 60 });
        render();
        toast('AI 日记已写好', 'ok');
      });
    } else if (action === 'diary-delete') {
      if (!confirm('删除这篇日记？')) return;
      await call('diary:delete', { id });
      S.data.diary = await call('diary:list', { limit: 60 });
      render();
      toast('日记已删除', 'ok');
    } else if (action === 'open-add-relationship') openAddRelationship();
    else if (action === 'edit-relationship') openEditRelationship(id);
    else if (action === 'edit-active-work') openEditActiveWork(target.dataset.channel);
    else if (action === 'edit-worklog') openEditWorklog(id);
    else if (action === 'edit-media') openEditMedia(id);
    else if (action === 'delete-media') {
      if (!confirm('删除这条多模态记忆及其文件？此操作不可恢复。')) return;
      await call('memory:deleteMedia', { id });
      await loadMemoryData();
      toast('多模态记忆已删除', 'ok');
    } else if (action === 'memory-dedupe') {
      await busy(target, async () => {
        const result = await call('memory:dedupeMedia');
        await loadMemoryData();
        render();
        toast(`已标记 ${result.marked} 条重复记录，不再展示`, 'ok');
      });
    }
    else if (action === 'clear-memory-search') { S.memorySearch = null; render(); }
    else if (action === 'memory-tab') { S.memoryTab = target.dataset.tab; render(); }
    else if (action === 'revalidate-knowledge') {
      await busy(target, async () => {
        toast('正在重新采集信源并交叉验证…', 'info', 5000);
        const cycle = await call('memory:revalidate', { id });
        toast(`复核完成：${cycle.outcome || cycle.status}`, 'ok');
        await loadMemoryData();
        render();
      });
    } else if (action === 'revalidate-all-stale') {
      if (!confirm('依次复核最多 5 条过时知识？会进行联网搜索与模型综合，耗时较长。')) return;
      await busy(target, async () => {
        toast('开始复核过时知识，最多 5 条…', 'info', 6000);
        const result = await call('memory:revalidateStale', { limit: 5 });
        const failed = result.results.filter((item) => item.error).length;
        toast(`已复核 ${result.checked} 条${failed ? `，${failed} 条失败` : ''}；仍有过时 ${result.totalStale} 条`, failed ? 'error' : 'ok', 7000);
        await loadMemoryData();
        render();
      });
    } else if (action === 'archive-knowledge') {
      if (!confirm('归档这条知识？仍可在 revisions 中追溯，但默认检索会排除。')) return;
      await call('memory:archiveKnowledge', { id });
      await loadMemoryData();
      toast('已归档', 'ok');
    } else if (action === 'delete-relationship') {
      if (!confirm('移除这条关系记忆？')) return;
      await call('memory:deleteRelationship', { id });
      await loadMemoryData();
      toast('已移除', 'ok');
    } else if (action === 'archive-work') {
      await busy(target, async () => {
        await call('memory:archiveWork', { channel: target.dataset.channel });
        await loadMemoryData();
        scheduleBootstrapRefresh();
        toast('工作已整理为日志', 'ok');
      });
    } else if (action === 'open-image') openImageModal(target.dataset.mediaUrl || target.dataset.url, target.dataset.caption);
    else if (action === 'reflect-now') {
      await busy(target, async () => {
        const record = await call('weights:reflect');
        toast('已生成一条反思', 'ok');
        await loadMemoryData();
        S.data.learnng = S.data.learning || {};
        if (S.route === 'growth') render();
      });
    } else if (action === 'refresh-learning') loadLearning();
    else if (action === 'select-cycle') {
      S.liveLearning = null;
      const detail = await call('learning:get', { id });
      S.selectedCycle = detail;
      S.cycleDetail = detail;
      render();
    } else if (action === 'autonomy-run') {
      await busy(target, async () => {
        const result = await call('autonomy:run');
        S.data.autonomy = await call('autonomy:overview');
        render();
        if (result?.skipped) toast(`未运行：${result.skipped}${result.error ? ` · ${result.error}` : ''}`, 'info');
        else toast('自主活动结束', 'ok');
      });
    } else if (action === 'idle-run') {
      await busy(target, async () => {
        const result = await call('idle:run');
        S.data.idleLearning = await call('idle:overview');
        render();
        if (result?.skipped) toast(`未运行：${result.skipped}${result.error ? ` · ${result.error}` : ''}`, 'info');
        else toast('闲时自学习完成', 'ok');
      });
    } else if (action === 'start-learning-shortcut') {
      navigate('learning');
      setTimeout(() => $('#learning-query')?.focus(), 80);
    } else if (action === 'pick-snowluma-dir' || action === 'choose-path') {
      const kind = action === 'choose-path' ? (target.dataset.kind === 'file' ? 'file' : 'directory') : 'directory';
      const name = action === 'choose-path' ? String(target.dataset.target || '') : 'homeDir';
      const dir = await call('settings:choosePath', { kind });
      if (dir && name) {
        const input = target.closest('form')?.querySelector(`[name="${name}"]`)
          || document.querySelector(`[name="${name}"]`)
          || document.getElementById(name);
        if (input) {
          input.value = dir;
          recordDraft(input);
          toast(kind === 'directory' ? '文件夹已选择' : '文件已选择', 'ok');
        }
      }
    } else if (action === 'qq-start') {
      await busy(target, async () => { const status = await call('qq:start'); S.data.qq = status; render(); toast(status.connected ? 'QQ 已连接，开始监听' : (status.error || '未能连接，请查看状态'), status.connected ? 'ok' : 'error'); });
    } else if (action === 'qq-stop') {
      await busy(target, async () => { S.data.qq = await call('qq:stop'); render(); toast('已停止监听', 'ok'); });
    } else if (action === 'qq-test') {
      await busy(target, async () => {
        const form = $('[data-form="qq-save"]');
        if (form) await submitForm(form);
        const result = await call('qq:test');
        toast(result.ok
          ? `OneBot HTTP 可用：${result.snowluma?.nickname || ''} ${result.snowluma?.user_id || ''}（${result.mode === 'manual' ? '手动' : '自动'}）`
          : result.discovery?.error || result.hint, result.ok ? 'ok' : 'error', 7000);
      });
    } else if (action === 'activity-mode') {
      const form = target.closest('form');
      const kind = target.dataset.kind;
      const mode = target.dataset.mode === 'ai' ? 'ai' : 'manual';
      if (form) {
        const hidden = form.querySelector(`[name="${kind}ActivityMode"]`);
        if (hidden) hidden.value = mode;
        target.parentElement.querySelectorAll('[data-action="activity-mode"]').forEach((button) => {
          button.classList.toggle('active', button.dataset.mode === mode);
        });
        await submitForm(form);
      }
    } else if (action === 'qq-proactive') {
      await busy(target, async () => {
        const form = target.closest('form') || $('[data-form="qq-save"]');
        if (form) await submitForm(form);
        toast('正在让伴行自主选题、查资料/看手机并生成新话题…', 'info', 6000);
        const result = await call('qq:proactive');
        if (result?.ok) toast(`已发到主人私聊：${result.content}`, 'ok', 9000);
        else toast(`本轮没有主动发送：${result?.skipped || result?.error || '未知原因'}`, 'info', 6000);
      });
    } else if (action === 'qq-open-webui') {
      await call('qq:openWebUI');
    } else if (action === 'qq-launch') {
      await busy(target, async () => { const result = await call('qq:launchSnowLuma'); toast(result.note || '已请求启动 SnowLuma', 'info', 6500); });
    } else if (action === 'phone-refresh') loadPhone();
    else if (action === 'phone-screenshot') {
      await busy(target, async () => {
        S.phoneShot = await call('phone:screenshot');
        S.phoneUi = null;
        render();
        toast('截图已放入临时缓存，不会进入多模态记忆', 'ok');
      });
    } else if (action === 'phone-read') {
      await busy(target, async () => {
        S.phoneUi = await call('phone:readScreen');
        S.phoneShot = S.phoneUi.screenshot;
        render();
      });
    } else if (action === 'phone-autodetect') {
      await busy(target, async () => {
        const result = await call('phone:scan');
        S.phoneScan = result;
        S.phoneStatus = result.status || await call('phone:status');
        render();
        toast(result.status?.ok ? '已连接设备' : (result.note || '没有检测到已授权设备'), result.status?.ok ? 'ok' : 'info', 7000);
      });
    } else if (action === 'phone-select') {
      await busy(target, async () => {
        const result = await call('phone:select', { serial: target.dataset.serial });
        S.phoneStatus = result;
        render();
        toast('已切换到这台设备', 'ok');
      });
    } else if (action === 'phone-emulators') {
      S.phoneEmulators = await call('phone:action', { action: 'listEmulators' });
      render();
    } else if (action === 'phone-start-emulator') {
      await busy(target, async () => { await call('phone:action', { action: 'startEmulator', avdName: target.dataset.avd }); toast('已请求启动模拟器，请等待设备上线', 'info', 5000); });
    } else if (action === 'phone-connect-wifi') {
      const address = $('#wifi-address')?.value;
      if (!address) return toast('请输入 IP:端口', 'info');
      await busy(target, async () => { const result = await call('phone:action', { action: 'connectWifi', address }); toast(result.output || '已连接', result.ok ? 'ok' : 'error'); loadPhone(); });
    } else if (action === 'phone-tap') {
      await call('phone:action', { action: 'tap', x: Number($('#tap-x')?.value), y: Number($('#tap-y')?.value) });
      toast('点击已发送', 'ok');
    } else if (action === 'phone-key') {
      await call('phone:action', { action: 'keyevent', key: $('#phone-key')?.value });
      toast('按键已发送', 'ok');
    } else if (action === 'phone-type') {
      await busy(target, async () => { await call('phone:action', { action: 'inputText', text: $('#phone-text')?.value }); toast('输入已发送', 'ok'); });
    } else if (action === 'phone-launch') {
      await call('phone:action', { action: 'launchApp', packageName: $('#phone-package')?.value });
      toast('启动请求已发送', 'ok');
    } else if (action === 'phone-swipe') {
      await call('phone:action', { action: 'swipe', x1: Number($('#swipe-x1')?.value), y1: Number($('#swipe-y1')?.value), x2: Number($('#swipe-x2')?.value), y2: Number($('#swipe-y2')?.value) });
      toast('滑动已发送', 'ok');
    } else if (action === 'phone-ui') {
      await busy(target, async () => { S.phoneUi = await call('phone:action', { action: 'uiDump' }); render(); });
    } else if (action === 'phone-mode') {
      const status = await call('phone:setMode', { mode: target.dataset.mode });
      S.phoneStatus = status;
      render();
    } else if (action === 'device-tab') {
      S.deviceTab = target.dataset.tab;
      if (S.deviceTab === 'phone' && !S.phoneStatus) loadPhone();
      if (S.deviceTab === 'computer') S.computerStatus = await call('computer:status').catch(() => S.computerStatus);
      render();
    } else if (action === 'computer-refresh') S.computerStatus = await call('computer:status');
    else if (action === 'computer-screenshot') {
      await busy(target, async () => { S.computerShot = await call('computer:screenshot'); render(); toast('桌面截图仅在本页临时查看，不写入多模态记忆', 'ok'); });
    } else if (action === 'computer-windows') {
      S.windows = await call('computer:action', { action: 'windows' });
      render();
    } else if (action === 'computer-click') {
      await call('computer:action', { action: 'click', x: Number($('#pc-x')?.value), y: Number($('#pc-y')?.value) });
      toast('点击已发送', 'ok');
    } else if (action === 'computer-type') {
      await busy(target, async () => { await call('computer:action', { action: 'type', text: $('#pc-text')?.value }); toast('文本已输入', 'ok'); });
    } else if (action === 'computer-keys') {
      await call('computer:action', { action: 'keys', keys: $('#pc-keys')?.value });
      toast('按键已发送', 'ok');
    } else if (action === 'computer-launch') {
      await call('computer:action', { action: 'launch', target: $('#pc-launch')?.value });
      toast('启动请求已发送', 'ok');
    } else if (action === 'music-save-path') {
      await busy(target, async () => {
        S.data.config = await call('music:pathSave', { path: $('#music-exe-path')?.value || '' });
        toast('网易云路径已保存', 'ok');
      });
    } else if (action === 'music-import-voice') {
      await busy(target, async () => {
        const result = await call('music:importVoice');
        if (result?.canceled) return;
        S.data.config = result.config || await call('app:bootstrap').then((r) => r.config);
        render();
        toast(result.indexPath ? '音色已导入（含 index）' : '音色已导入，未找到匹配 index', 'ok');
      });
    } else if (action === 'open-rvc') {
      await call('music:openRvc');
    } else if (action === 'music-connect') {
      await busy(target, async () => {
        const result = await call('music:connect');
        S.musicConnect = result.ok
          ? `已接入 CDP ${result.port}${result.executable ? ` · ${result.executable}` : ''}`
          : (result.error || '没有找到可接入的网易云');
        if (result.ok) toast('网易云耳朵已接入', 'ok');
        else toast(S.musicConnect, 'info', 7000);
        render();
      });
    } else if (action === 'music-now') {
      await busy(target, async () => {
        try {
          S.musicNow = await call('music:now');
          S.musicError = '';
        } catch (error) { S.musicError = error.message; }
        render();
      });
    } else if (action === 'music-control') {
      await busy(target, async () => {
        try { await call('music:control', { command: target.dataset.command || 'play' }); toast('已发送播放控制', 'ok'); }
        catch (error) { toast(error.message, 'error'); }
      });
    } else if (action === 'music-lyrics') {
      await busy(target, async () => {
        try {
          S.musicLyrics = await call('music:lyrics', { songId: id, song: target.dataset.name, artist: target.dataset.artist });
          render();
        } catch (error) { toast(error.message, 'error'); }
      });
    } else if (action === 'music-play') {
      await busy(target, async () => {
        try {
          const played = await call('music:play', { song: target.dataset.name, artist: target.dataset.artist });
          if (played?.dataUrl) S.musicAudio = played.dataUrl;
          if (played?.fallbackReason) toast('客户端点歌失败，已用直链在本机播放', 'info', 6000);
          else toast('已开始播放', 'ok');
          render();
        } catch (error) { toast(error.message, 'error'); }
      });
    } else if (action === 'multimodal-save') {
      await busy(target, async () => {
        const slots = (S.data.config.multimodal?.slots || []).map((slot) => ({
          ...slot,
          role: $(`[data-mm-role="${CSS.escape(slot.id)}"]`)?.value || slot.role
        }));
        const saved = await call('multimodal:save', { slots });
        S.data.config.multimodal = saved;
        render();
        toast('多模态插槽已保存', 'ok');
      });
    } else if (action === 'discover-models') {
      await busy(target, async () => {
        const role = target.dataset.role === 'helper' ? 'helper' : 'primary';
        await discoverModels(role, { silent: false });
      });
    } else if (action === 'discover-local') {
      await busy(target, async () => {
        const result = await call('models:discoverLocal');
        if (result.ok) {
          toast(`发现 ${result.models.length} 个本地模型：${result.models.slice(0,5).join('、')}`, 'ok', 6500);
          const form = $('[data-form="model-primary"]');
          const input = form?.querySelector('input[name="baseUrl"]');
          if (input) input.value = result.baseUrl;
          const select = form?.querySelector('[data-model-select]');
          if (select) {
            const chosen = preferredModel('primary', result.models, result.items);
            select.innerHTML = result.models.map((model) => `<option value="${esc(model)}" ${model === chosen ? 'selected' : ''}>${esc(model)}</option>`).join('');
            S.modelDiscovery.primary = { models: result.models, baseUrl: result.baseUrl };
          }
        } else toast(result.error, 'info');
      });
    } else if (action === 'clear-primary-key' || action === 'clear-helper-key') {
      const role = action.includes('primary') ? 'primary' : 'helper';
      if (!confirm('清除已保存的 API Key？')) return;
      await call('models:save', { [role]: { clearApiKey: true } });
      S.data = await call('app:bootstrap');
      render();
      toast('Key 已清除', 'ok');
    } else if (action === 'test-primary') testModel('primary');
    else if (action === 'test-helper') testModel('helper');
    else if (action === 'plugins-open-folder') await call('plugins:openFolder', {});
    else if (action === 'plugins-reload') {
      await busy(target, async () => { S.data.plugins = await call('plugins:reload'); render(); toast('插件已重新加载', 'ok'); });
    } else if (action === 'plugin-folder') await call('plugins:openFolder', { id });
    else if (action === 'mcp-restart') {
      await busy(target, async () => { S.data.mcp = await call('mcp:restart', { id }); render(); toast('MCP 已重启', 'ok'); });
    } else if (action === 'mcp-toggle') {
      await busy(target, async () => {
        S.data.mcp = await call(target.dataset.enabled === 'true' ? 'mcp:start' : 'mcp:stop', { id });
        render();
      });
    } else if (action === 'mcp-remove') {
      if (!confirm('移除这个 MCP 服务？不会删除服务端文件。')) return;
      S.data.mcp = await call('mcp:remove', { id });
      render();
    } else if (action === 'mcp-add-sample') {
      const sample = target.dataset.sample;
      await busy(target, async () => {
        await call('mcp:add', {
          name: sample === 'phone' ? '手机 MCP' : '电脑 MCP',
          transport: 'stdio',
          command: 'node',
          args: [sample === 'phone' ? 'mcp/phone/mcp-phone.bundle.mjs' : 'mcp/computer/mcp-computer.bundle.mjs'],
          enabled: true
        });
        toast('MCP 服务已添加并启动', 'ok');
        render();
      });
    } else if (action === 'open-path') await call('settings:openPath', { key: target.dataset.key });
    else if (action === 'refresh-logs') loadLogs();
    else if (action === 'open-docs') await call('settings:openPath', { key: 'docs' });
    else if (action === 'quit-app') { if (confirm('退出伴行？QQ 监听与 MCP 服务会停止。')) await call('app:quit'); }
    else if (action === 'plugin-toggle') { /* 由 change 处理 */ }
  } catch (error) {
    toast(error.message || '操作失败', 'error', 6500);
  }
});

document.addEventListener('change', async (event) => {
  recordDraft(event.target);
  const autoModel = event.target.closest('[data-model-autodiscover]');
  if (autoModel) {
    const role = autoModel.dataset.modelAutodiscover === 'helper' ? 'helper' : 'primary';
    setTimeout(() => discoverModels(role, { silent: false }), 250);
    return;
  }
  const personaLock = event.target.closest('[data-persona-lock]');
  if (personaLock) {
    try {
      await call('persona:setLocked', { locked: personaLock.checked });
      S.data.persona = await call('persona:get');
      render();
      toast(personaLock.checked ? '已锁定 AI 自学习；只有你能修改角色线' : '已开启 AI 小步演化', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  const manual = event.target.closest('[data-person-manual]');
  if (manual) {
    try {
      await call('people:update', { id: manual.dataset.personManual, patch: { manual: manual.checked } });
      await loadPeople();
      toast(manual.checked ? '已手动锁定，AI 不再自动改写' : '已恢复 AI 动态', 'ok');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  const target = event.target.closest('[data-action="plugin-toggle"]');
  if (!target) return;
  try {
    await busy(target, async () => {
      S.data.plugins = await call('plugins:toggle', { id: target.dataset.id, enabled: target.checked });
      render();
      toast(target.checked ? '插件已启用' : '插件已停用', 'ok');
    });
  } catch (error) {
    target.checked = !target.checked;
    toast(error.message, 'error');
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  try {
    if (button) await busy(button, () => submitForm(form));
    else await submitForm(form);
    clearDrafts(form.dataset.form);
  } catch (error) {
    toast(error.message || '提交失败', 'error');
  }
});

document.addEventListener('input', (event) => {
  recordDraft(event.target);
  if (event.target.id === 'chat-input') {
    S.draft = event.target.value;
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(150, event.target.scrollHeight)}px`;
  }
  const range = event.target.closest('input[type="range"][data-output]');
  if (!range) return;
  for (const output of document.querySelectorAll(`[data-output="${range.dataset.output}"]`)) output.textContent = range.value;
  // 在 AI 动态模式下手动拖滑杆，自动切回手动，避免“拖了却没生效”的困惑。
  const kind = range.dataset.kind;
  const form = range.closest('form');
  if (kind && form) {
    const hidden = form.querySelector(`[name="${kind}ActivityMode"]`);
    if (hidden && hidden.value === 'ai') {
      hidden.value = 'manual';
      form.querySelectorAll(`[data-action="activity-mode"][data-kind="${kind}"]`).forEach((button) => {
        button.classList.toggle('active', button.dataset.mode === 'manual');
      });
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('#modal-root').classList.contains('open')) closeModal();
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    const form = $('[data-form="chat"]');
    if (form && !$('.composer-send')?.disabled) form.requestSubmit();
  }
});

window.addEventListener('resize', () => {
  if (S.route === 'growth') drawWeightChart();
});

startApp();




