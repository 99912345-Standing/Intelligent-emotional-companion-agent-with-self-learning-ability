param(
  [string]$Root = "",
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Get-Location).Path
}
try { $Root = (Resolve-Path -LiteralPath $Root).Path } catch {
  Write-Output "工作目录不存在：$Root"
  exit 1
}

$fail = 0
function Require-File([string]$Relative, [string]$Label) {
  $full = Join-Path $Root $Relative
  if (Test-Path -LiteralPath $full -PathType Leaf) {
    Write-Output ("[OK]   " + $Label)
  } else {
    Write-Output ("[FAIL] " + $Label + "  缺少：" + $Relative)
    $script:fail += 1
  }
}
function Read-JsonFile([string]$Path) {
  try {
    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
    return ($raw | ConvertFrom-Json)
  } catch { return $null }
}
function Invoke-Check {
  Write-Output ""
  Write-Output "============================================================"
  Write-Output "  伴行 Agent · 只读环境检查"
  Write-Output "  本脚本只读取状态，不创建、不修改、不删除任何文件。"
  Write-Output "  工作目录：$Root"
  Write-Output "============================================================"
  Write-Output ""

  Write-Output "关键文件"
  Write-Output "------------------------------------------------------------"
  Require-File "伴行Agent.exe" "便携应用 伴行Agent.exe"
  Require-File "package.json" "运行清单 package.json"
  Require-File "src\main\main.js" "主进程 src\main\main.js"
  Require-File "src\renderer\index.html" "界面 src\renderer\index.html"
  Require-File "mcp\phone\mcp-phone.js" "手机 MCP mcp/phone/mcp-phone.js"
  Require-File "mcp\phone\mcp-phone.bundle.mjs" "手机 MCP 便携单文件"
  Require-File "mcp\computer\desktop.ps1" "电脑控制脚本"
  Require-File "plugins\hermes\plugin.json" "Hermes 内置插件"
  Require-File "vendor\qq-bridge\src\snowluma-conn.js" "qq-bridge 上游源码"
  Require-File "tools\platform-tools\adb.exe" "ADB tools/platform-tools/adb.exe"
  Require-File "check-readonly.ps1" "只读检查助手"

  Write-Output ""
  Write-Output "可选组件"
  Write-Output "------------------------------------------------------------"
  if (Test-Path -LiteralPath (Join-Path $Root "integrations\SnowLuma\launcher.bat")) {
    Write-Output "[OK]   SnowLuma: integrations\SnowLuma\launcher.bat"
  } else {
    Write-Output "[WARN] SnowLuma 未放入 integrations\SnowLuma；QQ 注入/登录需手动安装。"
  }
  $qqPkg = Join-Path $Root "vendor\qq-bridge\package.json"
  if (Test-Path -LiteralPath $qqPkg) {
    $q = Read-JsonFile $qqPkg
    Write-Output ("[OK]   qq-bridge 版本：" + [string]$q.version)
  } else {
    Write-Output "[WARN] qq-bridge 清单缺失。"
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $node) {
    $nodeVersion = (& node --version 2>$null)
    Write-Output ("[OK]   Node " + [string]$nodeVersion)
  } else {
    Write-Output "[WARN] 系统 Node 不在 PATH；便携 exe 自带运行时，通常不影响使用。"
  }

  Write-Output ""
  Write-Output "配置摘要（不显示密钥）"
  Write-Output "------------------------------------------------------------"
  $configPath = Join-Path $Root "data\config.json"
  if (Test-Path -LiteralPath $configPath) {
    $c = Read-JsonFile $configPath
    if ($null -eq $c) {
      Write-Output "[WARN] data\config.json 无法解析；请启动一次应用或检查 JSON。"
    } else {
      $primary = $c.models.primary
      Write-Output ("主模型：" + [string]$primary.model + "  URL：" + [string]$primary.baseUrl)
      $keyState = if ([string]::IsNullOrEmpty([string]$primary.apiKey)) { "未填写" } else { "已填写（已隐藏）" }
      Write-Output ("主模型 Key：" + $keyState)
      $helper = if ($c.models.helper.enabled) { [string]$c.models.helper.model } else { "未启用" }
      Write-Output ("辅助多模态：" + $helper)
      $qqState = if ($c.qq.enabled) { "启用" } else { "关闭" }
      $qqAuto = if ($c.qq.autoConnect) { "是" } else { "否" }
      Write-Output ("QQ 桥接：" + $qqState + "  自动连接：" + $qqAuto)
      $phoneState = if ($c.permissions.phoneControl) { "开" } else { "关" }
      $pcState = if ($c.permissions.computerControl) { "开" } else { "关" }
      Write-Output ("手机权限：" + $phoneState + "  电脑权限：" + $pcState)
      Write-Output ("MCP 服务数：" + @($c.mcp.servers).Count + "  插件：" + (@($c.plugins.enabled) -join ","))
    }
  } else {
    Write-Output "[INFO] 运行配置尚未生成；首次启动应用后自动创建。只读检查不会写它。"
  }

  Write-Output ""
  Write-Output "记忆与学习数据（只读计数）"
  Write-Output "------------------------------------------------------------"
  $memoryDir = Join-Path $Root "data\memory"
  if (Test-Path -LiteralPath $memoryDir) {
    foreach ($name in @("knowledge", "relationship", "worklogs", "weights", "multimodal", "reflections")) {
      $file = Join-Path $memoryDir ($name + ".jsonl")
      if (Test-Path -LiteralPath $file) {
        $count = (Get-Content -LiteralPath $file | Measure-Object -Line).Lines
        Write-Output ("  " + $name + ": " + $count + " 条")
      } else {
        Write-Output ("  " + $name + ": 0 条（尚未创建）")
      }
    }
  } else {
    Write-Output "  记忆目录尚未创建。"
  }
  $cycles = Join-Path $Root "data\learning\cycles.jsonl"
  if (Test-Path -LiteralPath $cycles) {
    Write-Output ("  学习闭环记录：" + ((Get-Content -LiteralPath $cycles | Measure-Object -Line).Lines) + " 条")
  } else {
    Write-Output "  学习闭环记录：0 条"
  }

  Write-Output ""
  Write-Output "本机端口（只连接，不启动服务）"
  Write-Output "------------------------------------------------------------"
  foreach ($port in @(3000, 3001, 5099)) {
    $client = New-Object Net.Sockets.TcpClient
    try {
      $null = $client.Connect("127.0.0.1", $port)
      Write-Output ("[OPEN]   " + $port)
    } catch {
      Write-Output ("[CLOSED] " + $port)
    } finally {
      $client.Close()
    }
  }
  Write-Output "  3000/3001 = SnowLuma OneBot HTTP/WS；5099 = SnowLuma WebUI（以实际配置为准）"

  Write-Output ""
  Write-Output "内置检查脚本哈希（与应用内集成副本对照）"
  Write-Output "------------------------------------------------------------"
  $rootBat = Join-Path $Root "检查环境-只读.bat"
  $rootPs1 = Join-Path $Root "check-readonly.ps1"
  $scriptBat = Join-Path $Root "scripts\check-readonly.bat"
  $scriptPs1 = Join-Path $Root "scripts\check-readonly.ps1"
  foreach ($pair in @(@($rootBat, "根目录副本"), @($scriptBat, "scripts 副本"))) {
    if (Test-Path -LiteralPath $pair[0]) {
      $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pair[0]).Hash
      Write-Output ("  " + $pair[1] + " BAT：" + $hash)
    }
  }
  foreach ($pair in @(@($rootPs1, "根目录副本"), @($scriptPs1, "scripts 副本"))) {
    if (Test-Path -LiteralPath $pair[0]) {
      $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pair[0]).Hash
      Write-Output ("  " + $pair[1] + " PS1：" + $hash)
    }
  }

  Write-Output ""
  Write-Output "============================================================"
  if ($fail -eq 0) {
    Write-Output "  结论：关键文件齐全，未发现阻断项。"
  } else {
    Write-Output ("  结论：有 " + $fail + " 项关键文件缺失，请先补齐再启动。")
  }
  Write-Output "  提示：本检查不测试账号登录、模型密钥有效性或 QQ 消息收发。"
  Write-Output "============================================================"
  Write-Output ""
}

try {
  Invoke-Check
  exit ([int]$script:fail)
} catch {
  Write-Output ("[FAIL] 只读检查执行异常：" + $_.Exception.Message)
  exit 1
}

