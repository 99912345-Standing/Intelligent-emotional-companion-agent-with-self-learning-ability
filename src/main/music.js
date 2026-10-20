import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { paths } from './paths.js';
import { nowIso, truncate } from './utils.js';

const execFileAsync = promisify(execFile);

const NCM_UA = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  referer: 'https://music.163.com/'
};

async function getJson(url) {
  const response = await fetch(url, { headers: NCM_UA, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`网易云 HTTP ${response.status}`);
  return response.json();
}

function normalize(value) {
  return String(value || '').replace(/[\s·・\-—_（）()【】\[\]]/g, '').toLowerCase();
}

function cleanLyrics(raw, maxLines = 80) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]*\]\s*/g, '').trim())
    .filter((line) => line && !/^(作词|作曲|编曲|制作人|出品|混音|母带|录音|吉他|贝斯|鼓|键盘|和声|监制|统筹|企划|OP|SP|发行)\s*[:：]/.test(line))
    .slice(0, maxLines);
}

export class MusicService {
  constructor({ config, logger, emit = () => {} }) {
    this.config = config;
    this.logger = logger;
    this.emit = emit;
    this.ncm = null;
    this.dir = path.join(paths.data, 'music');
    fs.mkdirSync(this.dir, { recursive: true });
    this.lyricCache = new Map();
  }

  async ncmModule() {
    if (this.ncm) return this.ncm;
    const file = path.join(paths.vendor, 'ai-companion-kit', 'packages', 'phone-mcp', 'src', 'ncm.js');
    if (!fs.existsSync(file)) throw new Error('未找到网易云耳朵模块（vendor/ai-companion-kit）');
    this.ncm = await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
    return this.ncm;
  }

  status() {
    return {
      enabled: this.config.get().permissions?.music !== false,
      cdpPort: Number(this.config.get().music?.cdpPort || 9222),
      tts: 'Windows SAPI',
      voice: this.config.get().music?.voice || {},
      executable: this.findExecutable(),
      dir: this.dir
    };
  }

  findExecutable() {
    const configured = String(this.config.get().music?.cloudMusicPath || '').trim();
    if (configured && fs.existsSync(configured)) return configured;
    const candidates = [
      process.env.NETEASE_CLOUDMUSIC,
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Netease', 'CloudMusic', 'cloudmusic.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Netease', 'CloudMusic', 'cloudmusic.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Netease', 'CloudMusic', 'cloudmusic.exe')
    ].filter(Boolean);
    return candidates.find((file) => fs.existsSync(file)) || '';
  }

  async runningProcess() {
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='cloudmusic.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
      ], { timeout: 8000, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
      const parsed = JSON.parse(String(stdout || 'null'));
      const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      const first = list[0] || null;
      // WMI 有时拿不到路径；让用户可以在音乐页手动指定 cloudmusic.exe。
      if (!first?.ExecutablePath) {
        try {
          const gp = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            "(Get-Process -Name cloudmusic -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1).Path"
          ], { timeout: 6000, windowsHide: true, encoding: 'utf8' });
          if (String(gp.stdout || '').trim()) first.ExecutablePath = String(gp.stdout).trim();
        } catch {}
      }
      return first ? {
        pid: first.ProcessId,
        executable: first.ExecutablePath || '',
        commandLine: first.CommandLine || '',
        hasDebugPort: /--remote-debugging-port/i.test(first.CommandLine || '')
      } : null;
    } catch {
      return null;
    }
  }

  async detect() {
    const port = Number(this.config.get().music?.cdpPort || 9222);
    const running = await this.runningProcess();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
      const pages = await response.json();
      return { ok: true, port, pages: pages.length, executable: running?.executable || this.findExecutable(), running };
    } catch (error) {
      return {
        ok: false,
        port,
        executable: running?.executable || this.findExecutable(),
        running,
        needsRestart: Boolean(running && !running.hasDebugPort),
        error: running && !running.hasDebugPort
          ? '网易云已经在运行，但没有开启 CDP 调试端口；点“一键接入”会重启它并开启调试端口。'
          : `未检测到 CDP ${port}：${error.message}`
      };
    }
  }

  async restartWithDebug() {
    const exe = (await this.runningProcess())?.executable || this.findExecutable();
    if (!exe) throw new Error('没有找到网易云 PC 版；可在设置里填写 cloudmusic.exe 路径');
    const port = Number(this.config.get().music?.cdpPort || 9222);
    try { await execFileAsync('taskkill', ['/F', '/IM', 'cloudmusic.exe'], { timeout: 8000, windowsHide: true }); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1200));
    spawn(exe, [`--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return this.detect();
  }

  async launchWithDebug() {
    const exe = this.findExecutable();
    if (!exe) throw new Error('没有找到网易云 PC 版；可在设置里填写 cloudmusic.exe 路径');
    const port = Number(this.config.get().music?.cdpPort || 9222);
    spawn(exe, [`--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    await new Promise((resolve) => setTimeout(resolve, 3500));
    return this.detect();
  }

  async search(query, limit = 6) {
    const text = String(query || '').trim();
    if (!text) throw new Error('请输入歌名');
    const json = await getJson(`https://music.163.com/api/search/get?s=${encodeURIComponent(text)}&type=1&limit=${Math.max(1, Math.min(12, Number(limit) || 6))}`);
    return (json?.result?.songs || []).map((song) => ({
      id: String(song.id),
      name: song.name,
      artists: (song.artists || []).map((artist) => artist.name).join('/'),
      album: song.album?.name || '',
      duration: Number(song.duration || 0)
    }));
  }

  async findSong({ song = '', artist = '', songId = '' } = {}) {
    if (songId) return { id: String(songId), name: song || `歌曲 ${songId}`, artists: artist };
    const list = await this.search([song, artist].filter(Boolean).join(' '), 8);
    if (!list.length) throw new Error(`没搜到「${song || artist}」`);
    const want = normalize(song);
    return list.find((item) => normalize(item.name) === want)
      || list.find((item) => normalize(item.name).includes(want))
      || list[0];
  }

  async lyrics({ song = '', artist = '', songId = '', maxLines = 40 } = {}) {
    const found = await this.findSong({ song, artist, songId });
    if (this.lyricCache.has(found.id)) return { ...found, lines: this.lyricCache.get(found.id) };
    const json = await getJson(`https://music.163.com/api/song/lyric?id=${found.id}&lv=1&kv=1&tv=-1`);
    const lines = cleanLyrics(json?.lrc?.lyric || '', maxLines);
    this.lyricCache.set(found.id, lines);
    return { ...found, lines };
  }

  async nowPlaying() {
    const ncm = await this.ncmModule();
    try {
      const report = await ncm.earsReport();
      if (!report?.ok) throw new Error(report?.error || '网易云没有返回播放状态');
      return report;
    } catch (error) {
      throw new Error(`读不到网易云当前播放：${error.message}。请用 --remote-debugging-port=${Number(this.config.get().music?.cdpPort || 9222)} 启动网易云 PC 版。`);
    }
  }

  async directPlay(found) {
    const url = `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(found.id)}.mp3`;
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { ...NCM_UA, accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) throw new Error(`直链播放 HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024 || /^<!doctype|<html/i.test(buffer.slice(0, 80).toString('utf8'))) {
      throw new Error('网易云没有返回可播放音频（可能需要登录/会员）');
    }
    const file = path.join(this.dir, `play-${found.id}-${Date.now()}.mp3`);
    fs.writeFileSync(file, buffer);
    try {
      // 真正的本机播放：交给默认播放器，而不是只把歌名和歌词放进上下文。
      spawn('cmd.exe', ['/c', 'start', '', file], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    } catch (error) {
      this.logger.warn('music', `启动本地播放器失败：${error.message}`);
    }
    return {
      ...found,
      ok: true,
      mode: 'direct-audio',
      file,
      bytes: buffer.length,
      dataUrl: `data:audio/mpeg;base64,${buffer.toString('base64')}`
    };
  }

  async play({ song = '', artist = '', songId = '' } = {}) {
    const found = await this.findSong({ song, artist, songId });
    let ncmError = '';
    try {
      const ncm = await this.ncmModule();
      const result = await ncm.playSong(found.id, found.name);
      if (result?.ok) return { ...found, ...result };
      ncmError = result?.error || '网易云客户端没有接受播放请求';
    } catch (error) {
      ncmError = error.message;
    }
    // 客户端注入失败/版本变化时，退回公开 outchain 直链；至少让本机真的响起来。
    try {
      const local = await this.directPlay(found);
      this.logger.warn('music', `客户端点歌失败，已使用直链播放：${ncmError}`);
      return { ...local, fallbackReason: ncmError };
    } catch (error) {
      throw new Error(`点歌失败：${ncmError}；直链也失败：${error.message}`);
    }
  }

  async control(command) {
    const ncm = await this.ncmModule();
    await ncm.control(String(command || 'play'));
    return { ok: true, command };
  }

  async room() {
    const ncm = await this.ncmModule();
    return ncm.roomState();
  }

  ttsScript(outputFile) {
    const escaped = outputFile.replace(/'/g, "''");
    return [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$s.SetOutputToWaveFile('${escaped}')`,
      '$text = [Console]::In.ReadToEnd()',
      '$s.Rate = 0',
      '$s.Volume = 100',
      '$s.Speak($text)',
      '$s.Dispose()'
    ].join('; ');
  }

  async convertRvc(inputFile) {
    const cfg = this.config.get().music?.voice || {};
    if (!cfg.rvcEnabled) return null;
    if (!cfg.repoPath || !cfg.modelPath) throw new Error('RVC 已开启但 repoPath/modelPath 未配置');
    const repo = String(cfg.repoPath);
    const candidates = [
      path.join(repo, 'infer_cli.py'),
      path.join(repo, 'tools', 'infer_cli.py'),
      path.join(repo, 'infer.py')
    ];
    const script = candidates.find((file) => fs.existsSync(file));
    if (!script) throw new Error('RVC 目录里找不到 infer_cli.py');
    const output = path.join(this.dir, `rvc-${Date.now()}.wav`);
    const python = cfg.pythonPath || 'python';
    const args = [script, '--input_path', inputFile, '--opt_path', output,
      '--model_path', String(cfg.modelPath),
      ...(cfg.indexPath ? ['--index_path', String(cfg.indexPath)] : []),
      ...(Number(cfg.pitch) ? ['--f0up_key', String(Number(cfg.pitch))] : [])
    ];
    await new Promise((resolve, reject) => {
      const child = spawn(python, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('RVC 转换超时')); }, 180000);
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', (error) => { clearTimeout(timer); reject(new Error(`RVC 启动失败：${error.message}`)); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 || !fs.existsSync(output)) reject(new Error(`RVC 转换失败：${truncate(stderr, 200)}`));
        else resolve();
      });
    });
    return output;
  }

  async sing({ text = '', song = '', artist = '', maxLines = 6 } = {}) {
    let words = String(text || '').trim();
    let found = null;
    if (!words && (song || artist)) {
      found = await this.lyrics({ song, artist, maxLines });
      words = found.lines.slice(0, Math.max(1, Math.min(12, Number(maxLines) || 6))).join('\n');
    }
    if (!words) words = '想唱一句给你听。';
    const file = path.join(this.dir, `sing-${Date.now()}.wav`);
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', this.ttsScript(file)], {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe']
      });
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch {}
        reject(new Error('本地演唱生成超时'));
      }, 45000);
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`本地演唱启动失败：${error.message}`));
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0 || !fs.existsSync(file)) reject(new Error(`本地演唱失败：${truncate(stderr || `exit ${code}`, 180)}`));
        else resolve();
      });
      child.stdin.end(words);
    });
    let finalFile = file;
    let engine = 'Windows SAPI · 朗读式清唱';
    let rvcError = '';
    try {
      const converted = await this.convertRvc(file);
      if (converted) {
        finalFile = converted;
        engine = 'RVC 变声 · 外部模型';
      }
    } catch (error) {
      rvcError = error.message;
      this.logger.warn('music', `RVC 转换失败，保留 SAPI：${error.message}`);
    }
    const buffer = fs.readFileSync(finalFile);
    this.emit('music:changed', { file: finalFile, at: nowIso() });
    return {
      ok: true,
      file: finalFile,
      dataUrl: `data:audio/wav;base64,${buffer.toString('base64')}`,
      text: words,
      song: found,
      bytes: buffer.length,
      engine,
      rvcError
    };
  }
}
