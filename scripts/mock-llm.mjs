// 本地 mock LLM：仅用于离线联调伴行 UI / 工具链 / 多模态验证，不连接任何真实模型。
import http from 'node:http';

const port = Number(process.argv[2] || 18080);

function reply(payload) {
  const messages = payload.messages || [];
  const last = messages[messages.length - 1] || {};
  const serialized = JSON.stringify(messages);
  const hasImage = /image_url|data:image/.test(JSON.stringify(last.content || ''));
  const toolResults = messages.filter((message) => message.role === 'tool');
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const userText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content || '');

  if (hasImage) return { content: '42' };
  if (/连通性测试/.test(userText)) return { content: 'OK' };
  if (toolResults.length) {
    return { content: '我读到了手机工具返回的结果。当前没有已授权设备；请在「手机与电脑」里开启 USB 调试并授权后重试。' };
  }
  if (payload.tools?.length && /手机/.test(userText)) {
    return {
      content: '',
      tool_calls: [{
        id: `call_${Date.now()}`,
        type: 'function',
        function: { name: 'phone_status', arguments: '{}' }
      }]
    };
  }
  if (/我累了/.test(userText)) return { content: '听见了。先不催你做事，我们把节奏放慢一点。要不要先说说今天最耗你的那一段？工作线还在，但可以先退半步。' };
  if (/查证|学习闭环/.test(userText)) return { content: '我会先把问题拆成可核验的子问题，再读多个独立来源；不会把单条低权重信源当成结论。' };
  if (/介绍|你是谁/.test(userText)) return { content: '我是**伴行**。一个把工作推进和情感陪伴放在同一组连续权重上的本地智能体。我的记忆、日志、截图和配置都留在你的工作目录里。' };
  return { content: `我在。刚才你说的是：“${userText.slice(0, 160)}”。我们可以把它拆成下一步，也可以先聊一会儿。` };
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-vision', object: 'model' }] }));
      return;
    }
    let payload = {};
    try { payload = JSON.parse(body); } catch {}
    const { content, tool_calls } = reply(payload);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: payload.model || 'mock-vision',
      choices: [{
        index: 0,
        message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) },
        finish_reason: tool_calls ? 'tool_calls' : 'stop'
      }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
    }));
  });
});
server.listen(port, '127.0.0.1', () => console.log(`[mock-llm] http://127.0.0.1:${port}/v1`));
