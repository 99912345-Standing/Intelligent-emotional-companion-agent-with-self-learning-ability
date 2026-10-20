import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { paths } from './paths.js';

const execFileAsync = promisify(execFile);

export class ComputerService {
  constructor(config, logger, emit = () => {}, mediaSink = null) {
    this.config = config;
    this.logger = logger;
    this.emit = emit;
    this.mediaSink = mediaSink;
    this.script = path.join(paths.root, 'mcp', 'computer', 'desktop.ps1');
    this.dir = path.join(paths.data, 'computer');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  enabled() {
    return Boolean(this.config.get().computer.enabled && this.config.get().permissions.computerControl);
  }

  assertEnabled(permission = null) {
    const cfg = this.config.get();
    if (!cfg.computer.enabled || !cfg.permissions.computerControl) {
      throw new Error('电脑操作权限未开启。请在“模型接入 → 权限”中显式开启，并确认你理解风险。');
    }
    if (permission && cfg.computer.permissions?.[permission] === false) {
      throw new Error(`电脑操作子权限「${permission}」未开启`);
    }
  }

  async runPowerShell(action, env = {}) {
    this.assertEnabled();
    if (!fs.existsSync(this.script)) throw new Error(`缺少电脑控制脚本：${this.script}`);
    const childEnv = {
      ...process.env,
      BX_ACTION: action,
      ...Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value ?? '')]))
    };
    try {
      const { stdout, stderr } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script
      ], {
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
        env: childEnv
      });
      if (stderr && !stdout) throw new Error(stderr.trim());
      const parsed = JSON.parse(String(stdout).trim().split(/\r?\n/).pop());
      if (parsed.ok === false) throw new Error(parsed.error || '电脑操作失败');
      return parsed;
    } catch (error) {
      throw new Error(`电脑操作失败：${String(error.stderr || error.message).replace(/\s+/g, ' ').slice(0, 500)}`);
    }
  }

  async screenInfo() {
    return this.runPowerShell('screen-info');
  }

  async windows() {
    return this.runPowerShell('windows');
  }

  async screenshot() {
    this.assertEnabled();
    const shots = path.join(this.dir, 'screenshots');
    fs.mkdirSync(shots, { recursive: true });
    const file = path.join(shots, `desktop-${Date.now()}.png`);
    const info = await this.runPowerShell('screenshot', { BX_OUT: file });
    if (!fs.existsSync(file)) throw new Error('截图文件未生成');
    const buffer = fs.readFileSync(file);
    // 桌面截图只在“手机与电脑”页面临时查看，不写入多模态记忆。
    // 这里保留最近 10 张，供当前页面重开时使用；不产生 memory/multimodal.jsonl 记录。
    try {
      const old = fs.readdirSync(shots)
        .filter((name) => /^desktop-\d+\.png$/.test(name))
        .map((name) => ({ name, at: fs.statSync(path.join(shots, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at)
        .slice(10);
      for (const item of old) fs.unlinkSync(path.join(shots, item.name));
    } catch {}
    return {
      ok: true,
      file,
      relativeFile: path.relative(paths.root, file).replace(/\\/g, '/'),
      mediaId: null,
      base64: buffer.toString('base64'),
      dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
      width: info.width,
      height: info.height,
      origin: { x: info.x, y: info.y },
      screenScaleHint: info.scale,
      ephemeral: true
    };
  }

  async click(x, y) {
    this.assertEnabled('mouse');
    return this.runPowerShell('click', { BX_X: Math.round(Number(x)), BX_Y: Math.round(Number(y)) });
  }

  async typeText(text) {
    this.assertEnabled('keyboard');
    const value = String(text || '');
    if (!value) throw new Error('输入文本为空');
    if (value.length > 5000) throw new Error('单次输入过长');
    return this.runPowerShell('type', { BX_TEXT_B64: Buffer.from(value, 'utf8').toString('base64') });
  }

  async keys(keys) {
    this.assertEnabled('keyboard');
    return this.runPowerShell('keys', { BX_KEYS: String(keys || '') });
  }

  async focusWindow(pid) {
    this.assertEnabled('appLaunch');
    if (!Number.isFinite(Number(pid))) throw new Error('PID 无效');
    return this.runPowerShell('focus', { BX_PID: Number(pid) });
  }

  async launch(target) {
    this.assertEnabled('appLaunch');
    const value = String(target || '').trim();
    if (!value) throw new Error('启动目标为空');
    return this.runPowerShell('launch', { BX_TARGET: value });
  }

  async shell(command) {
    const cfg = this.config.get();
    if (!cfg.computer.allowShell || !cfg.computer.permissions?.shell || !cfg.permissions.dangerousShell) {
      throw new Error('PowerShell 执行权限未开启（需要同时开启电脑 Shell 与全局危险 Shell 权限）。');
    }
    const value = String(command || '');
    if (!value || value.length > 4000) throw new Error('命令为空或过长');
    const { stdout, stderr } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', value
    ], { timeout: 45000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
    return { ok: true, stdout: String(stdout).slice(0, 16000), stderr: String(stderr).slice(0, 4000) };
  }
}
