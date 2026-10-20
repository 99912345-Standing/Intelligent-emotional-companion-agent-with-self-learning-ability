// 离线 OneBot v11 mock：HTTP 动作 + WebSocket 事件，供端到端 UI 测试使用。
import http from 'node:http';
import { WebSocketServer } from 'ws';

const httpPort = Number(process.env.MOCK_ONEBOT_HTTP_PORT || 13000);
const wsPort = Number(process.env.MOCK_ONEBOT_WS_PORT || 13001);
const sent = [];
const clients = new Set();
let messageId = 70000;

const httpServer = http.createServer((req, res) => {
  req.setEncoding('utf8');
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch {}
    const send = (value) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/__sent') return send(sent);
    if (req.url === '/__emit') {
      const event = body.event || body;
      let delivered = 0;
      for (const socket of clients) {
        if (socket.readyState === 1) { socket.send(JSON.stringify(event)); delivered += 1; }
      }
      return send({ ok: true, delivered });
    }
    if (req.url === '/get_login_info') {
      return send({ status: 'ok', retcode: 0, data: { user_id: 99999, nickname: '伴行测试号' } });
    }
    if (req.url === '/send_private_msg') {
      sent.push({ at: new Date().toISOString(), action: 'send_private_msg', params: body });
      return send({ status: 'ok', retcode: 0, data: { message_id: ++messageId } });
    }
    if (req.url === '/get_status') {
      return send({ status: 'ok', retcode: 0, data: { online: true, good: true } });
    }
    if (req.url === '/get_image' || req.url === '/get_record') {
      return send({ status: 'ok', retcode: 0, data: { url: 'https://example.com/file.png' } });
    }
    return send({ status: 'ok', retcode: 0, data: {} });
  });
});
await new Promise((resolve) => httpServer.listen(httpPort, '127.0.0.1', resolve));

const wss = new WebSocketServer({ port: wsPort, host: '127.0.0.1' });
await new Promise((resolve) => wss.on('listening', resolve));
wss.on('connection', (socket) => {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
  socket.send(JSON.stringify({
    post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect',
    time: Math.floor(Date.now() / 1000), self_id: 99999
  }));
});
console.log(`[mock-onebot] HTTP http://127.0.0.1:${httpPort} WS ws://127.0.0.1:${wsPort}`);
