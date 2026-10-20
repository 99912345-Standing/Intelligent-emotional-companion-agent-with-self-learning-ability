// 端到端 UI 验证：记忆刷新、角色双线、手动 OneBot、QQ 主对话与回写。
import fs from 'node:fs';
import path from 'node:path';

const cdpPort = Number(process.argv[2] || 9223);
const oneBotHttp = (process.argv[3] || 'http://127.0.0.1:13000').startsWith('http')
  ? process.argv[3] || 'http://127.0.0.1:13000'
  : `http://127.0.0.1:${process.argv[3]}`;
const outDir = path.resolve('data', 'e2e');
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `：${detail}`}`);
};

let target;
for (let i = 0; i < 80; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    target = list.find((item) => item.type === 'page');
    if (target) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (!target) throw new Error('no CDP target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.text || 'exception');
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed');
  return result.result?.value;
};
const wait = (ms) => evaluate(`new Promise(r => setTimeout(r, ${ms}))`);
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const shot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(result.data, 'base64'));
};
await send('Page.enable');
await send('Runtime.enable');
await wait(1200);

// 1. 角色双线
const roleBefore = await evaluate(`window.banxing.invoke('persona:get').then(r => r.data)`);
check('角色双线接口可用', Boolean(roleBefore?.profile?.knowledgeLine?.text && roleBefore?.profile?.emotionLine?.text));
const updated = await evaluate(`window.banxing.invoke('persona:update', { knowledgeLine: 'E2E 知识线：先证据，再结论；不确定就查。', emotionLine: 'E2E 情感线：先接住人，再处理事。', reason: '端到端测试' }).then(r => r)`);
check('用户可保存两条角色线', updated?.ok && /E2E 知识线/.test(updated.data.profile.knowledgeLine.text));
await click('[data-route="role"]');
await wait(700);
const roleText = await evaluate(`document.getElementById('main').innerText`);
check('角色页显示两条线', /E2E 知识线/.test(roleText) && /E2E 情感线/.test(roleText));
check('角色页保留边界与修订历史', /不可更改的边界/.test(roleText) && /修订历史/.test(roleText));
await shot('role');

// 2. 活跃度：两个独立滑杆 + 手动/AI 动态模式
await click('[data-route="qq"]');
await wait(700);
const rangeCount = await evaluate(`document.querySelectorAll('form[data-form="qq-activity"] input[type="range"]').length`);
const modeCount = await evaluate(`document.querySelectorAll('form[data-form="qq-activity"] [data-action="activity-mode"]').length`);
check('群聊/私聊活跃度拆成独立滑杆', rangeCount >= 5 && modeCount >= 4, `${rangeCount} ranges / ${modeCount} modes`);
await shot('activity');
await evaluate(`document.querySelector('[data-action="activity-mode"][data-kind="group"][data-mode="ai"]')?.click()`);
await wait(900);
const autoMode = await evaluate(`window.banxing.invoke('qq:status').then(r => r.data.config.groupActivityMode)`);
check('群聊活跃度可切换 AI 动态模式', autoMode === 'ai', String(autoMode));
await evaluate(`document.querySelector('[data-action="activity-mode"][data-kind="group"][data-mode="manual"]')?.click()`);
await wait(700);

// 3. 记忆库刷新（先写关系记忆，再从其它页面进入记忆）
await click('[data-route="chat"]');
await wait(300);
const rel = await evaluate(`window.banxing.invoke('memory:addRelationship', { kind:'preference', content:'E2E 记忆显示测试：喜欢先听结论。', confidence:0.8 }).then(r => r)`);
check('可写入关系记忆', rel?.ok);
await click('[data-route="memory"]');
await wait(900);
const memoryText = await evaluate(`document.getElementById('main').innerText`);
const badgeText = await evaluate(`document.querySelector('[data-route="memory"] .nav-badge')?.textContent || ''`);
check('侧边栏有记忆计数', Boolean(badgeText), badgeText);
check('记忆库实际显示刚写入的关系记忆', /E2E 记忆显示测试/.test(memoryText));
await evaluate(`document.querySelector('[data-action="edit-relationship"]')?.click()`);
await wait(350);
await evaluate(`(() => { const f = document.querySelector('form[data-form="edit-relationship"]'); if (!f) return false; f.querySelector('[name="content"]').value = 'E2E 记忆已手动修正：先听结论，再看细节。'; f.requestSubmit(); return true; })()`);
await wait(900);
const memoryText2 = await evaluate(`document.getElementById('main').innerText`);
check('关系记忆可手动修正', /E2E 记忆已手动修正/.test(memoryText2), memoryText2.slice(0, 300));
await shot('memory');

// 3. 手动 OneBot 连接
const qqStatus = await evaluate(`window.banxing.invoke('qq:start').then(r => r)`);
check('手动 OneBot 可连接', qqStatus?.ok && qqStatus.data.connected, JSON.stringify(qqStatus?.data?.error || qqStatus));
const qqPublic = await evaluate(`window.banxing.invoke('qq:status').then(r => r.data)`);
check('手动 OneBot 状态与主对话开关可见', qqPublic?.config?.onebotMode === 'manual' && qqPublic?.config?.primaryConversation === true);

// 4. 主人 QQ 消息进入主对话
const event = {
  post_type: 'message', message_type: 'private', sub_type: 'friend',
  time: Math.floor(Date.now() / 1000), self_id: 99999, user_id: 10001,
  message_id: 88001, raw_message: '在吗？我想继续刚才的工作',
  message: [{ type: 'text', data: { text: '在吗？我想继续刚才的工作' } }],
  sender: { user_id: 10001, nickname: '主人' }
};
await fetch(`${oneBotHttp}/__emit`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event })
});
await wait(3500);
await click('[data-route="chat"]');
await wait(500);
const chatText = await evaluate(`document.getElementById('chat-scroll').innerText`);
check('QQ 主人私聊进入主对话', /在吗？我想继续刚才的工作/.test(chatText), chatText.slice(0, 300));
const sent = await (await fetch(`${oneBotHttp}/__sent`)).json();
check('QQ 消息得到 OneBot 回复', sent.some((item) => item.action === 'send_private_msg' && JSON.stringify(item.params?.message || '').length > 2), JSON.stringify(sent).slice(0, 400));
await shot('chat-primary');

// 4.1 人物印象：QQ + 昵称双显示，昵称变化刷新记忆
const ownerPeople = await evaluate(`window.banxing.invoke('people:list').then(r => (r.data.people || []).find(p => p.qq === '10001'))`);
check('人物账本记录 QQ 和昵称', ownerPeople?.qq === '10001' && ownerPeople?.nickname === '主人', JSON.stringify(ownerPeople));
await click('[data-route="people"]');
await wait(700);
const peopleText = await evaluate(`document.getElementById('main').innerText`);
check('印象页显示昵称与 QQ', /主人/.test(peopleText) && /10001/.test(peopleText), peopleText.slice(0, 300));
await shot('people');
const renameEvent = {
  post_type: 'message', message_type: 'private', sub_type: 'friend',
  time: Math.floor(Date.now() / 1000), self_id: 99999, user_id: 10001,
  message_id: 88002, raw_message: '我喜欢先听结论，再听细节。',
  message: [{ type: 'text', data: { text: '我喜欢先听结论，再听细节。' } }],
  sender: { user_id: 10001, nickname: '主人新昵称' }
};
await fetch(`${oneBotHttp}/__emit`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: renameEvent })
});
await wait(2600);
const renamedPeople = await evaluate(`window.banxing.invoke('people:list').then(r => (r.data.people || []).find(p => p.qq === '10001'))`);
check('QQ 号不变时昵称自动刷新', renamedPeople?.nickname === '主人新昵称' && renamedPeople?.aliases?.includes('主人'), JSON.stringify(renamedPeople));
const relationNick = await evaluate(`window.banxing.invoke('memory:overview').then(r => (r.data.relationship || []).map(x => x.nickname))`);
check('昵称刷新同步到关系记忆', relationNick.includes('主人新昵称'), JSON.stringify(relationNick));

// 5. 应用内消息 -> 回答回写 QQ
await click('[data-route="chat"]');
await wait(500);
await evaluate(`(() => { const input = document.getElementById('chat-input'); input.value = '你好，请介绍下角色线'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-form="chat"]').requestSubmit(); return true; })()`);
await wait(4000);
const sent2 = await (await fetch(`${oneBotHttp}/__sent`)).json();
check('应用内回答回写主人 QQ', sent2.length > sent.length, `${sent.length} -> ${sent2.length}`);

// 6. 多模态图片可以打开，并可以修正说明
const overviewBeforeMedia = await evaluate(`window.banxing.invoke('memory:overview').then(r => (r.data.multimodal || []).length)`);
const imagePath = path.resolve('docs/screenshots/home.png').replace(/\\/g, '\\\\');
await evaluate(`window.banxing.invoke('chat:send', { text: '我发一张测试图片', attachments: [{ path: '${imagePath}', name: 'home.png', mime: 'image/png' }] }).then(r => r.ok)`);
await wait(2400);
const mediaCount = await evaluate(`window.banxing.invoke('memory:overview').then(r => (r.data.multimodal || []).length)`);
check('附件进入多模态记忆', mediaCount > overviewBeforeMedia, `${overviewBeforeMedia} -> ${mediaCount}`);
await click('[data-route="memory"]');
await wait(700);
await click('[data-tab="multimodal"]');
await wait(500);
const galleryCount = await evaluate(`document.querySelectorAll('img[data-action="open-image"]').length`);
check('多模态图片显示在记忆库', galleryCount > 0, String(galleryCount));
await evaluate(`document.querySelector('img[data-action="open-image"]')?.click()`);
await wait(400);
const modalImage = await evaluate(`Boolean(document.querySelector('.modal-img'))`);
check('多模态图片可点开查看', modalImage);
await evaluate(`document.querySelector('[data-action="close-modal"]')?.click()`);
await wait(250);
await evaluate(`document.querySelector('[data-action="edit-media"]')?.click()`);
await wait(350);
await evaluate(`(() => { const f = document.querySelector('form[data-form="edit-media"]'); if (!f) return false; f.querySelector('[name="caption"]').value = 'E2E 修正后的图片说明'; f.querySelector('[name="tags"]').value = '测试,修正'; f.requestSubmit(); return true; })()`);
await wait(900);
const mediaText = await evaluate(`document.getElementById('main').innerText`);
check('多模态说明可手动修正', /E2E 修正后的图片说明/.test(mediaText), mediaText.slice(0, 250));

// 7. 桌面截图只读、不写入多模态记忆
const beforeShot = await evaluate(`window.banxing.invoke('memory:overview').then(r => (r.data.multimodal || []).length)`);
await evaluate(`window.banxing.invoke('settings:save', { patch: { computer: { enabled: true }, permissions: { computerControl: true } } }).then(r => r.ok)`);
const shotResult = await evaluate(`window.banxing.invoke('computer:screenshot').then(r => ({ ok: r.ok, mediaId: r.data?.mediaId, dataUrl: Boolean(r.data?.dataUrl), error: r.error }))`);
const afterShot = await evaluate(`window.banxing.invoke('memory:overview').then(r => (r.data.multimodal || []).length)`);
check('桌面截图只在本页返回', shotResult.ok && shotResult.dataUrl === true, JSON.stringify(shotResult));
check('桌面截图不进入多模态记忆', shotResult.mediaId === null && afterShot === beforeShot, `${beforeShot} -> ${afterShot}`);

// 8. 私聊主动活跃度：强制一次，验证 Agent 选题、生成并发送
await evaluate(`window.banxing.invoke('qq:save', { qq: { privateActivity: 100, privateIdleMinutes: 1, privateMinIntervalMinutes: 1, proactiveUseResearch: false, proactiveUsePhone: false } }).then(r => r.ok)`);
const proactive = await evaluate(`window.banxing.invoke('qq:proactive').then(r => r)`);
const proactiveContent = proactive?.data?.content || proactive?.content || '';
check('私聊主动话题可生成并发送', proactive?.ok && proactive?.data?.ok && proactiveContent.length > 4, JSON.stringify(proactive));

// 8.1 模型名只能从 URL+Key 探测结果中选择
await click('[data-route="models"]');
await wait(1300);
const modelSelect = await evaluate(`(() => { const s = document.querySelector('form[data-form="model-primary"] select[name="model"]'); return s ? [...s.options].map(o => o.value) : []; })()`);
const freeModelInput = await evaluate(`document.querySelectorAll('form[data-form="model-primary"] input[name="model"]').length`);
check('模型名来自自动探测下拉框', Array.isArray(modelSelect) && modelSelect.includes('mock-vision') && freeModelInput === 0, JSON.stringify(modelSelect));
const mmSlots = await evaluate(`document.querySelectorAll('[data-mm-role]').length`);
check('多模态插件有 5 个可路由插槽', mmSlots === 5, String(mmSlots));

// 8.2 日记：手写一篇并能在页面看到
await click('[data-route="diary"]');
await wait(500);
await evaluate(`window.banxing.invoke('diary:add', { title:'E2E 日记测试', content:'今天测试了日记写入与展示，这是一条只在测试目录里存在的记录。', mood:'平静', source:'user' }).then(r => r.ok)`);
await wait(500);
await click('[data-route="diary"]');
await wait(500);
const diaryText = await evaluate(`document.getElementById('main').innerText`);
check('日记可手写并在页面查看', /E2E 日记测试/.test(diaryText) && /今天测试了日记写入与展示/.test(diaryText), diaryText.slice(0, 300));

// 8.25 闲时自学习页
await click('[data-route="idle"]');
await wait(500);
const idleText = await evaluate(`document.getElementById('main').innerText`);
const idleOverview = await evaluate(`window.banxing.invoke('idle:overview').then(r => r.data)`);
check('闲时自学习有独立侧边页', /安静一小时后/.test(idleText) && /自学习轨迹/.test(idleText) && Number.isFinite(Number(idleOverview?.minIdleMinutes)), idleText.slice(0, 260));
check('闲时自学习默认 1 小时门槛', Number(idleOverview?.minIdleMinutes) === 60, JSON.stringify(idleOverview?.minIdleMinutes));
check('闲时页有自主手机/电脑活动入口', /闲时自主活动/.test(idleText) && await evaluate(`Boolean(document.querySelector('[data-action="autonomy-run"]'))`));
const idleSaved = await evaluate(`window.banxing.invoke('idle:save', { patch: { enabled:true, minIdleMinutes:75, checkIntervalMinutes:3, cooldownMinutes:90, maxPerDay:2, quietStart:1, quietEnd:6 } }).then(r => r)`);
check('闲时学习间隔/检查/上限/静默可自定义', idleSaved?.ok && idleSaved.data?.minIdleMinutes === 75 && idleSaved.data?.checkIntervalMinutes === 3 && idleSaved.data?.cooldownMinutes === 90 && idleSaved.data?.maxPerDay === 2 && idleSaved.data?.quietStart === 1 && idleSaved.data?.quietEnd === 6, JSON.stringify(idleSaved?.data));

// 8.3 音乐：侧边栏可视化调试入口
await click('[data-route="music"]');
await wait(500);
const musicText = await evaluate(`document.getElementById('main').innerText`);
check('音乐页有耳朵与清唱调试入口', /听你正在听的/.test(musicText) && /唱给你听/.test(musicText) && /读取正在播放/.test(musicText), musicText.slice(0, 300));
const sung = await evaluate(`window.banxing.invoke('music:sing', { text: '测试一句清唱。' }).then(r => r)`);
check('本地清唱能生成可播放 WAV', sung?.ok && String(sung.data?.dataUrl || '').startsWith('data:audio/wav') && sung.data.bytes > 1000, JSON.stringify({ ok: sung?.ok, bytes: sung?.data?.bytes, error: sung?.error }));
const musicFeatureText = await evaluate(`document.getElementById('main').innerText`);
check('音乐页有一键接入与 RVC 入口', /一键探测/.test(musicFeatureText) && /RVC/.test(musicFeatureText));

// 8.9 手机：自动检测入口、路径选择、未保存输入在刷新后保留
await click('[data-route="devices"]');
await wait(500);
const phoneAuto = await evaluate(`Boolean(document.querySelector('[data-action="phone-autodetect"]'))`);
const pathPick = await evaluate(`Boolean(document.querySelector('[data-action="choose-path"]'))`);
check('手机页有自动检测模拟器与路径选择入口', phoneAuto && pathPick);
await evaluate(`(() => { const input = document.querySelector('#tap-x'); if (!input) return false; input.value = '987'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await click('[data-action="phone-refresh"]');
await wait(900);
const draftAfterRefresh = await evaluate(`document.querySelector('#tap-x')?.value || ''`);
check('未保存的输入在页面刷新后仍保留', draftAfterRefresh === '987', draftAfterRefresh);

// 9. 用量侧边栏
await click('[data-route="usage"]');
await wait(800);
const usageText = await evaluate(`document.getElementById('main').innerText`);
const usageSummary = await evaluate(`window.banxing.invoke('usage:summary').then(r => r.data)`);
check('侧边栏有用量页', await evaluate(`Boolean(document.querySelector('[data-route="usage"]'))`));
check('用量页显示 token 与命中率', /今日总 tokens/.test(usageText) && /缓存命中率/.test(usageText) && /记忆命中率/.test(usageText), usageText.slice(0, 260));
check('用量记录包含实际模型调用', usageSummary?.totals?.calls > 0 && usageSummary?.totals?.total > 0, JSON.stringify(usageSummary?.totals));
await shot('usage');

console.log('\n端到端结果：' + (results.every((item) => item.ok) && !errors.length ? 'PASS' : 'FAIL'));
if (errors.length) console.log('renderer errors:', errors.join(' || '));
await evaluate(`window.banxing.invoke('app:quit')`).catch(() => {});
ws.close();
process.exit(results.every((item) => item.ok) && !errors.length ? 0 : 1);
