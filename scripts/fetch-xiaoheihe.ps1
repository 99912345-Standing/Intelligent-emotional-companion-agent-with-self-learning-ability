param(
  [string]$OutDir = "docs\articles\raw"
)
$ErrorActionPreference = "Stop"
$edgeCandidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) { throw "没有找到 Microsoft Edge，无法进行客户端渲染抓取。" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$articles = @(
  @{
    Name = "01"
    Url = "https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&h_src=YXBwX3NoYXJl&link_id=5be0729b2ae0&new_post_share_style_v2=1"
  },
  @{
    Name = "02"
    Url = "https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&h_src=YXBwX3NoYXJl&link_id=51c6729d32e0&new_post_share_style_v2=1"
  }
)
foreach ($article in $articles) {
  $profile = Join-Path $env:TEMP ("edge-xiaoheihe-" + $article.Name)
  $output = Join-Path $OutDir ("article" + $article.Name + "-dom.html")
  Write-Host ("抓取 " + $article.Name + " ...")
  & $edge --headless=new --disable-gpu --no-first-run --user-data-dir="$profile" --dump-dom $article.Url 2>$null | Out-File -Encoding utf8 $output
  Write-Host ("已保存 " + $output)
}
Write-Host "用 scripts/extract-articles.py 进一步提取可见文本。"
