// QQ 桥接离线自检：模拟 SnowLuma OneBot HTTP+WS，不连接真实 QQ。
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

process.env.BANXING_HOME = path.join(os.tmpdir(), `banxing-qq-test-${Date.now()}`);
const { initPaths } = await import('../src/main/paths.js');
initPaths(null);
const { ConfigManager } = await import('../src/main/config.js');
const { Logger } = await import('../src/main/logger.js');
const { QQBridge, extractMessage, splitText } = await import('../src/main/qqbridge.js');

let pass = 0; let fail = 0;
const out = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; out.push(`✓ ${name}`); }
  else { fail += 1; out.push(`✗ ${name}${detail ? `：${detail}` : ''}`); }
};

check('CQ 文本/图片消息解析', (() => {
  const parsed = extractMessage('你好[CQ:image,file=a.png,url=https://example.com/a.png]世界');
  return parsed.text.includes('你好') && parsed.images.length === 1 && parsed.text.includes('世界');
})(), JSON.stringify(extractMessage('你好[CQ:image,file=a.png,url=https://example.com/a.png]世界')));
check('长文本按句切分', splitText('第一句。第二句。'.repeat(50), 80).length > 1);

const sent = [];
let wsClient = null;
const httpServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch {}
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/get_login_info') {
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 99999, nickname: '伴行测试号' } }));
    } else if (req.url === '/send_private_msg' || req.url === '/send_group_msg') {
      sent.push(payload);
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 12345 } }));
    } else if (req.url === '/get_image' || req.url === '/get_record') {
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { url: 'https://example.com/file.png' } }));
    } else {
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: {} }));
    }
  });
});
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const httpPort = httpServer.address().port;
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise((resolve) => wss.on('listening', resolve));
const wsPort = wss.address().port;
wss.on('connection', (socket) => {
  wsClient = socket;
});

const logger = new Logger();
const config = new ConfigManager(logger);
config.save({ qq: {
  enabled: true, autoReply: true, requireAtInGroup: true, ownerQQ: '10001',
  onebotMode: 'manual', primaryConversation: true,
  allowPrivate: [], allowGroups: [], allowAllWhenEmpty: false,
  httpUrl: `http://127.0.0.1:${httpPort}`, wsUrl: `ws://127.0.0.1:${wsPort}`, accessToken: '', wsToken: '', httpToken: '',
  batchWindowMs: 100, humanize: { enabled: false }
} });
const stickerFile = path.join(os.tmpdir(), `banxing-sticker-${Date.now()}.png`);
fs.writeFileSync(stickerFile, Buffer.from('89504e470d0a1a0a', 'hex'));
const memoryStub = {
  extractRelationshipFacts() {},
  saveMedia: async (input) => ({ id: 'media_x', ...input, file: input.filePath || 'x' }),
  multimodal: {
    get: (id) => id === 'media_sticker' ? { id, kind: 'sticker', mime: 'image/png', file: stickerFile, caption: '抱抱表情' } : null,
    all: () => [{ id: 'media_sticker', kind: 'sticker', mime: 'image/png', file: stickerFile, caption: '抱抱表情', tags: ['表情包'], createdAt: new Date().toISOString() }]
  }
};
const bridge = new QQBridge({
  config, logger, memory: memoryStub,
  webSearch: { assertPublicUrl() {} },
  weights: { getState: () => ({ normalized: { work: 40, companion: 60 } }) },
  emit: () => {}
});
let agentCall = null;
bridge.setAgent({
  async handleMessage({ channel, text, meta }) {
    agentCall = { channel, text, meta };
    return {
      userMessage: { role: 'user', content: text },
      assistantMessage: { role: 'assistant', content: `收到：${String(text).slice(0, 20)}，测试回复` }
    };
  },
  async proactiveTurn() {
    return { content: '我刚刚看到一个挺有意思的东西，想和你说。' };
  }
});
const status = await bridge.start();
check('手动 OneBot 模式可发现并连接', status.connected === true && status.discovered?.source === 'manual-onebot', status.error || status.hint);
check('读取到绑定 QQ', status.boundQQ === '99999', status.boundQQ);
check('QQ 主对话配置暴露给 UI', status.config.primaryConversation === true && status.config.onebotMode === 'manual');
await new Promise((resolve) => setTimeout(resolve, 800));
if (wsClient) {
  wsClient.send(JSON.stringify({
    post_type: 'message', message_type: 'private', sub_type: 'friend',
    time: Math.floor(Date.now() / 1000), self_id: 99999, user_id: 10001,
    message_id: 666, raw_message: '你好，伴行',
    message: [{ type: 'text', data: { text: '你好，伴行' } }],
    sender: { user_id: 10001, nickname: '主人' }
  }));
}
await new Promise((resolve) => setTimeout(resolve, 1800));
check('主人私聊触发 Agent 并发送回复', sent.some((item) => item.user_id === 10001 && /测试回复/.test(JSON.stringify(item.message))), JSON.stringify(sent));
check('主人私聊进入主对话通道', agentCall?.channel === 'desktop', JSON.stringify(agentCall));
check('主对话不显示 QQ 提示词前缀', agentCall?.text === '你好，伴行' && agentCall?.meta?.primaryQQ === true, JSON.stringify(agentCall));
// 戳一戳 notice 也应进入 Agent，而不是被忽略。
agentCall = null;
wsClient?.send(JSON.stringify({
  post_type: 'notice', notice_type: 'notify', sub_type: 'poke',
  time: Math.floor(Date.now() / 1000), self_id: 99999, user_id: 10001,
  target_id: 99999, sender: { user_id: 10001, nickname: '主人' }
}));
await new Promise((resolve) => setTimeout(resolve, 900));
check('戳一戳会被识别并进入对话', /戳一戳/.test(agentCall?.text || '') && agentCall?.meta?.poke === true, JSON.stringify(agentCall));
wsClient?.send(JSON.stringify({
  post_type: 'message', message_type: 'private', sub_type: 'friend',
  time: Math.floor(Date.now() / 1000), self_id: 99999, user_id: 20002,
  message_id: 667, raw_message: '陌生人的消息',
  message: '陌生人的消息', sender: { user_id: 20002, nickname: '陌生人' }
}));
await new Promise((resolve) => setTimeout(resolve, 900));
check('白名单外私聊不会自动回复', !sent.some((item) => item.user_id === 20002));

// 群活跃度：关闭“必须 @”后，100% 活跃度会接普通群消息；0% 不接。
config.save({ qq: { requireAtInGroup: false, groupActivity: 100, groupCooldownSec: 0, allowGroups: ['30001'] } });
wsClient?.send(JSON.stringify({
  post_type: 'message', message_type: 'group', sub_type: 'normal',
  time: Math.floor(Date.now() / 1000), self_id: 99999, user_id: 20003,
  group_id: 30001, message_id: 668, raw_message: '群里随便聊聊',
  message: [{ type: 'text', data: { text: '群里随便聊聊' } }],
  sender: { user_id: 20003, nickname: '群友', card: '群友' }
}));
await new Promise((resolve) => setTimeout(resolve, 1800));
check('群活跃度 100 会接普通群消息', sent.some((item) => item.group_id === 30001), JSON.stringify(sent));
sent.length = 0;
config.save({ qq: { groupActivity: 0 } });
wsClient?.send(JSON.stringify({
  post_type: 'message', message_type: 'group', sub_type: 'normal',
  time: Math.floor(Date.now() / 1000), self_id: 99999, user_id: 20003,
  group_id: 30001, message_id: 669, raw_message: '再说一句',
  message: [{ type: 'text', data: { text: '再说一句' } }],
  sender: { user_id: 20003, nickname: '群友', card: '群友' }
}));
await new Promise((resolve) => setTimeout(resolve, 900));
check('群活跃度 0 不接普通群消息', !sent.some((item) => item.group_id === 30001));

// AI 动态模式：群聊按群热度、私聊按当前权重自动给出建议值。
config.save({ qq: { groupActivityMode: 'ai', privateActivityMode: 'ai' } });
bridge.recentGroupMessages = [Date.now(), Date.now() - 60000, Date.now() - 120000];
const autoActivity = bridge.tuneActivities();
check('群聊/私聊都有 AI 动态活跃度模式', autoActivity.group >= 8 && autoActivity.private > 0, JSON.stringify(autoActivity));

// 私聊主动活跃度：强制触发一次，走 proactiveTurn + 发送。
config.save({ qq: { privateActivity: 100, privateMinIntervalMinutes: 1, privateActivityMode: 'manual' } });
const proactive = await bridge.maybeProactive({ force: true });
check('私聊主动活跃度可触发新话题', proactive.ok && sent.some((item) => /挺有意思/.test(JSON.stringify(item.message))), JSON.stringify(proactive));
const voiceFile = path.join(os.tmpdir(), `banxing-voice-${Date.now()}.wav`);
fs.writeFileSync(voiceFile, Buffer.alloc(2048, 1));
const voice = await bridge.sendVoice('private', '10001', voiceFile);
check('QQ 可发送本地 TTS 语音', voice.ok && sent.some((item) => JSON.stringify(item.message).includes('"record"')));
const imageFile = path.join(os.tmpdir(), `banxing-image-${Date.now()}.png`);
fs.writeFileSync(imageFile, Buffer.from('89504e470d0a1a0a', 'hex'));
const image = await bridge.sendImage('private', '10001', imageFile, { caption: '测试图片' });
check('QQ 可发送图片段', image.ok && sent.some((item) => JSON.stringify(item.message).includes('"image"')));
check('可搜索多模态中保存的表情包', bridge.stickerMemory('抱抱').some((item) => item.mediaId === 'media_sticker'));
const savedSticker = await bridge.sendStoredMedia('private', '10001', 'media_sticker');
check('可发送多模态中保存的表情包', savedSticker.ok && savedSticker.mediaId === 'media_sticker');
await bridge.stop();
wss.close();
httpServer.close();
console.log('\nQQ 桥接自检\n' + '─'.repeat(60));
console.log(out.join('\n'));
console.log('─'.repeat(60));
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
