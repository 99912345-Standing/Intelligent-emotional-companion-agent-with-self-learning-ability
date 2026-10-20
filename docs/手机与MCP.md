# 手机与 MCP 部署说明

## 文件

- `mcp/phone/mcp-phone.js` — 可读源码，标准 MCP stdio server。
- `mcp/phone/mcp-phone.bundle.mjs` — esbuild 单文件构建，便携 exe 内置 MCP 管理器默认使用它。
- `mcp/computer/mcp-computer.js` / `.bundle.mjs` — 电脑端。
- `tools/platform-tools/adb.exe` — ADB 37.0.1 Windows 平台工具。
- `data/memory/media/` — 所有截图/附件按年月与 SHA 前缀存储。
- `data/memory/multimodal.jsonl` — 多模态元数据。

## 运行内置 MCP（手动）

```powershell
$env:BANXING_HOME = 'E:\deepseek\陪伴工作型agent'
$env:ADB_PATH = 'E:\deepseek\陪伴工作型agent\tools\platform-tools\adb.exe'
$env:PHONE_MODE = 'real'      # 或 emulator
node mcp/phone/mcp-phone.bundle.mjs
```

这是一个 stdio MCP 服务，请由 MCP 客户端启动，不要直接在交互终端里等待它“打印结果”。

## 在伴行中启用

1. 「插件与 MCP」→ 手机 MCP 示例 → 添加并启动。
2. 或手动添加一个 stdio 服务：
   - 命令：`node`
   - 参数：`mcp/phone/mcp-phone.bundle.mjs`
3. 服务出现 `running` 且工具列表包含 `screenshot`、`read_screen`、`tap` 等即成功。
4. 主模型需支持工具调用，并在「模型接入 → 权限」开启手机控制。

内置「手机与电脑」页面直接调用同一套 `PhoneCore`，不依赖 MCP 进程，所以即使 MCP 未启动，也能手动截图和操作。

## 真机模式

1. 手机开启开发者选项与 USB 调试。
2. USB 连接后执行：
   ```powershell
   .\tools\platform-tools\adb.exe devices -l
   ```
3. 状态为 `device` 才可用；`unauthorized` 需要在手机上点允许。
4. 伴行中选择「真机」→ 刷新 → 选择序列号。
5. 中文输入需要 ADBKeyboard（安装后启用其输入法）；否则只支持 ASCII。

无线调试：

```powershell
.\tools\platform-tools\adb.exe tcpip 5555
.\tools\platform-tools\adb.exe connect 192.168.1.8:5555
```

或直接在伴行手机页输入 `IP:端口` 点连接。

## 模拟器模式

- **Android Studio AVD**：安装 SDK Emulator，创建 AVD；伴行可列出并启动（5554）。
- **第三方模拟器**（LDPlayer / MuMu / Nox / MEmu 等）：先手动启动，确认其 ADB 调试开启；伴行从 `adb devices` 里选择。常见端口：5555、62001、7555、21503。
- 伴行不捆绑闭源模拟器；也不会自动点击模拟器广告。

## 工具清单

`list_devices`, `device_info`, `screenshot`, `read_screen`, `ui_dump`, `tap`, `swipe`, `input_text`, `keyevent`, `launch_app`, `open_url`, `list_apps`, `list_emulators`, `start_emulator`, `connect_wifi`, `shell`（默认关闭）。

所有坐标基于设备实际分辨率；`read_screen` 同时返回 UI 文本，优先用它定位，而不是只看缩放后的截图。

## 安全

- 只操作自己已授权的设备；不要操作他人手机。
- 截图可能包含隐私信息，会进入多模态记忆；请定期清理 `data/memory/media/` 或关闭权限。
- `PHONE_ALLOW_SHELL=1` / UI 中的手机 Shell 开关会授予任意 ADB shell 能力，非必要不要开启。
- 支付、删除、发送消息等不可逆操作，应由用户明确确认。

## 虚拟机 / 本地模型 MCP

「插件与 MCP」支持两种传输，因此可以把虚拟机控制、本地模型或任何 MCP server 作为扩展接入：

- **stdio**：命令 + 参数。例如虚拟机厂商提供的 MCP CLI：
  - 名称：`我的虚拟机`
  - 传输：`stdio`
  - 命令：`node`（或该 MCP 自带的 exe）
  - 参数：每行一个，例如 `C:\mcp\vm-server.js`
  - 环境变量 JSON：按服务文档填写
- **HTTP**：直接填 `http://127.0.0.1:<port>/mcp`；适合 Docker/虚拟机内运行、通过端口映射暴露的 MCP。
- 添加后主模型会看到带 `[MCP:服务名]` 的工具。是否允许主模型调用取决于「模型接入 → 权限 → MCP 扩展」开关。
- 本地模型不需要 MCP：在模型接入里填 Ollama/LM Studio 的 OpenAI 兼容 URL 即可；若本地模型只提供 MCP 接口，也可以按 HTTP 方式接入后作为工具调用。

`${ROOT}`、`${TOOLS}`、`${HOME}` 会在参数里替换为工作目录、tools 目录和工作目录。

## 电脑 MCP

同样的模式：

```powershell
$env:COMPUTER_ALLOW_SHELL = '1'   # 可选，高风险
node mcp/computer/mcp-computer.bundle.mjs
```

工具：`screenshot`, `screen_info`, `list_windows`, `click`, `type_text`, `press_keys`, `focus_window`, `launch_app`, `run_powershell`（默认关闭）。
