$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user;$env:Path"
  $candidates = @(
    'C:\Program Files\Git\cmd',
    'C:\Program Files\GitHub CLI',
    "$env:LOCALAPPDATA\GitHubCLI"
  )
  foreach ($dir in $candidates) {
    if (Test-Path $dir) { $env:Path = "$dir;$env:Path" }
  }
}

function Need-Command($name) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  return $command
}

Refresh-Path

if (-not (Need-Command 'git')) {
  Write-Host ''
  Write-Host '未检测到 Git，准备用 winget 安装 Git for Windows...' -ForegroundColor Yellow
  if (-not (Need-Command 'winget')) {
    throw '没有 winget。请先安装 Git for Windows，再重新运行本脚本。'
  }
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
}
if (-not (Need-Command 'git')) {
  throw 'Git 安装后仍未找到，请关闭窗口后重新运行本脚本。'
}

if (-not (Need-Command 'gh')) {
  Write-Host ''
  Write-Host '未检测到 GitHub CLI，准备用 winget 安装...' -ForegroundColor Yellow
  winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
}
if (-not (Need-Command 'gh')) {
  throw 'GitHub CLI 安装后仍未找到，请关闭窗口后重新运行本脚本。'
}

Write-Host ''
Write-Host '=== 伴行 · GitHub 发布向导 ===' -ForegroundColor Cyan
Write-Host '这个脚本只会把源码提交到 GitHub；data/ 和伴行Agent.exe 不会进入 Git 仓库。'
Write-Host ''

# 1. 登录（token 只由 gh 保存在系统凭据中，不写入仓库）
gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host '需要先登录 GitHub。接下来会打开浏览器，请在浏览器里完成授权。' -ForegroundColor Yellow
  gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { throw 'GitHub 登录失败。' }
}

# 2. 仓库信息
$defaultRepo = 'self-learning-emotion-agent'
$repo = Read-Host "仓库名（默认 $defaultRepo）"
if ([string]::IsNullOrWhiteSpace($repo)) { $repo = $defaultRepo }
$visibility = Read-Host '公开仓库输入 public，私有仓库输入 private（默认 private）'
if ($visibility -notin @('public', 'private')) { $visibility = 'private' }

# 3. Git 身份
if (-not (git config --global user.name)) {
  $name = Read-Host '你的 GitHub 显示名'
  git config --global user.name $name
}
if (-not (git config --global user.email)) {
  $email = Read-Host '你的 GitHub 邮箱'
  git config --global user.email $email
}

# 4. 初始化本地仓库
if (-not (Test-Path (Join-Path $PSScriptRoot '.git'))) {
  git init -b main
}
git add .
if (git diff --cached --quiet) {
  Write-Host '没有新的文件需要提交。' -ForegroundColor Yellow
} else {
  git commit -m 'Initial release: 伴行 self-learning emotion agent'
}

# 5. 创建远程仓库并推送
$remotes = git remote
if ($remotes -notcontains 'origin') {
  $repoArgs = @('repo', 'create', $repo, '--source', '.', '--remote', 'origin', '--push', "--$visibility")
  gh @repoArgs
  if ($LASTEXITCODE -ne 0) { throw '创建 GitHub 仓库或推送失败。' }
} else {
  git push -u origin main
}

# 6. 把便携版作为 Release 附件（不打进 Git 仓库）
$exe = Join-Path $PSScriptRoot '伴行Agent.exe'
if (Test-Path $exe) {
  Write-Host ''
  Write-Host '上传便携版到 GitHub Releases...' -ForegroundColor Cyan
  $releaseArgs = @('release', 'create', 'v1.0.0', $exe, '--title', '伴行 Agent v1.0.0', '--notes', '首个可运行版本。下载 伴行Agent.exe，双击 启动伴行.bat 即可运行。')
  gh @releaseArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Release 可能已存在，尝试覆盖上传 exe...' -ForegroundColor Yellow
    gh release upload v1.0.0 $exe --clobber
  }
} else {
  Write-Host '未找到 伴行Agent.exe；仓库已发布，但 Release 附件未上传。' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '完成。' -ForegroundColor Green
gh repo view --web
