# 两篇小黑盒文章精读

## 抓取方式

- 分享页由客户端异步渲染，直接 `Invoke-WebRequest` 只能拿到 SPA 壳。
- 使用本机 **Microsoft Edge Headless** 渲染 DOM：
  ```powershell
  & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
    --headless=new --disable-gpu --no-first-run `
    --user-data-dir="$env:TEMP\edge-capture-profile" `
    --dump-dom "<文章 URL>" > article-dom.html
  ```
- 再用 BeautifulSoup 提取可见文本，保留两份原文：
  - [01-教程上-从零搭建QQ小鲸鱼.txt](01-教程上-从零搭建QQ小鲸鱼.txt)
  - [02-进阶篇-日记听歌手机.txt](02-进阶篇-日记听歌手机.txt)
- 可复现脚本：[scripts/fetch-xiaoheihe.ps1](../../scripts/fetch-xiaoheihe.ps1)（浏览器抓取 DOM）与 [scripts/extract-articles.py](../../scripts/extract-articles.py)（文本提取）。

## 文章一：教程上『从零搭建自己的QQ小鲸鱼』

- URL：<https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&h_src=YXBwX3NoYXJl&link_id=5be0729b2ae0&new_post_share_style_v2=1>
- 作者：异世回忆，10-09
- 核心链路：`QQ 客户端 → SnowLuma（协议网关）→ qq-bridge（接线员：记忆/节奏/角色卡）→ DSH/AI 大脑`
- 文章指出的关键坑：
  - SnowLuma 管理台 `5099`，OneBot HTTP `3000` / WS `3001`。
  - token 字段是 `snowluma.accessToken`，不是 `onebot.accessToken`；读错会 401。
  - PowerShell 发中文必须用 UTF-8 字节，否则会变成问号。
  - 会话 token 不能混用，否则 403。
  - 推荐 QQ 小号、关闭 GitHub 劫持工具。
- 文章对应的仓库：<https://github.com/pinganbbOvO/ai-companion-kit>。其中 `packages/companion/src/transport-onebot.js` 明确支持 NapCat / Lagrange / LLOneBot / go-cqhttp / SnowLuma 等 OneBot v11 实现，这正是本项目新增“手动 OneBot 连接”的依据。

## 文章二：进阶篇（日记 · 听歌 · 主动找你 · 给她一台手机）

- URL：<https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&h_src=YXBwX3NoYXJl&link_id=51c6729d32e0&new_post_share_style_v2=1>
- 作者：异世回忆，10-11
- 核心结构：记忆、嘴、耳朵、手、心。
- 重点：
  - 记忆按“人”存，不按会话存；跨私聊/群共享同一条对话流。
  - 角色卡决定像不像人；不要写成客服手册；要有明确的“不做什么”。
  - 日记用纯文本 JSONL，给 AI 两个动作：写一条、看最近几条；不要替 AI 规定内容。
  - 听歌是“耳朵”，读网易云本地状态；只在相关时提，不每首歌都评论。
  - 语音走本地 Whisper，不要上传第三方。
  - 手机优先用模拟器/备用机，不要连主力机；中文输入要 ADBKeyboard，且要明确报错。
  - 主动找你：随机检查间隔、安静阈值、概率、深夜策略；给用户“全部暂停/只回复不主动”的开关。
  - 健康检查：端口、连接、最后一次说话时间；日志要记失败，不只记成功。
  - 防风控：单聊不超过约 20 条/分钟，群聊更慢；不可撤回操作单独限流。

## 本项目已吸收的部分

- **通用 OneBot v11 手动连接**：不再强制依赖 SnowLuma 的 per-account 配置文件；可填 WS/HTTP 地址与两个独立 Token。
- **QQ 主对话**：主人的 OneBot 私聊进入桌面主对话；应用内的回答可回写主人 QQ。
- **知识线 / 情感线角色设定**：用户可编辑；AI 可在真实长期记忆证据支持下小步修订，身份与安全边界锁定，全部修订留痕。
- **只读健康检查**：端口、配置摘要、记忆计数、脚本哈希，BAT + PowerShell 助手。
- **手机 MCP**：本项目自己的 `mcp-phone.js`，与文章强调的真机/模拟器、ADBKeyboard、明确失败提示一致。
- **多模态记忆**：图片、语音、截图、文件进入 `data/memory/media/` 与 `multimodal.jsonl`。

## 与文章的取舍

文章中的日记、网易云耳朵、本地 Whisper、QZone 连招属于可选的陪伴扩展；本项目当前把“主动找你”做成了**默认关闭、可配置**的私聊主动活跃度：安静后自主查资料/按开关看手机，再开新话题。主动发消息、第三方平台写入操作都不默认开启，避免在未明确授权时产生外部副作用。

## 文章来源说明

两篇文章的分享页依赖客户端渲染。以上内容来自 Edge Headless 渲染后的可见文本，保留了正文、评论与页面导航；原文文风与事实以文章为准。仓库 `pinganbbOvO/ai-companion-kit` 已完整放在 `vendor/ai-companion-kit`（MIT），用于对照 OneBot transport、角色卡和 phone-mcp。
