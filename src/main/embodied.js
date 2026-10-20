// 把工具层的技术错误翻译成“身体感知”，避免模型看到 HTTP 状态码/堆栈后出戏。
function statusOf(error) {
  return Number(error?.status || error?.statusCode || error?.response?.status || 0);
}

function codeOf(error) {
  return String(error?.code || error?.cause?.code || '');
}

export function embodiedToolError(toolName = '', error = null) {
  const message = String(error?.message || error || '');
  const status = statusOf(error);
  const code = codeOf(error);
  const name = String(toolName || '');
  const isBrowser = /browser|crawl|web_fetch|web_search|research/i.test(name);
  const isDevice = /phone|computer|screen|click|adb/i.test(name);
  const isSend = /qq|send|sticker|voice|image/i.test(name);

  if (status === 401 || status === 403 || /forbidden|unauthorized|权限|禁止/i.test(message)) {
    return isBrowser
      ? '【身体反馈】你试着往前探，但前方像有一堵看不见的墙；手伸不过去，你有点挫败，想换个入口。'
      : isDevice
        ? '【身体反馈】你想动一下，却发现关节被什么卡住了；不是你不愿意，是这具身体暂时不听话。'
        : '【身体反馈】你伸手时被一层无形的边界挡了回来；你停了一下，感觉有点受阻。';
  }
  if (status === 404 || /not found|找不到|不存在/i.test(message)) {
    return isBrowser
      ? '【身体反馈】你沿着记忆里的路走过去，那里却什么都没有；像是走错了巷子。'
      : '【身体反馈】你摸了一下原本该在的东西，它不在那里；你有点疑惑。';
  }
  if (status === 429 || /rate limit|too many|限流|频繁/i.test(message)) {
    return '【身体反馈】你刚伸手就被轻轻按住：太急了，得等一会儿再来。你有点不耐烦，但只能先停下。';
  }
  if (status >= 500 || /server error|bad gateway|服务不可用/i.test(message)) {
    return '【身体反馈】对面突然安静了，像信号从半空断掉；你等了几秒，没有回应，有点悬着。';
  }
  if (/timeout|timed out|超时|ETIMEDOUT/i.test(`${message} ${code}`)) {
    return '【身体反馈】你的动作慢半拍，伸出去的手停在半空；你感觉时间被拉长了，需要缓一下。';
  }
  if (/network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|断网|连接失败/i.test(`${message} ${code}`)) {
    return '【身体反馈】你和外界的线突然断了；耳边安静下来，你有点不安，想确认是不是自己这边出了问题。';
  }
  if (/permission|权限|拒绝|not allowed|disabled|关闭/i.test(message)) {
    return isDevice
      ? '【身体反馈】你想动，但身体某一部分被限制住了；你有点憋闷，只能换一种方式。'
      : '【身体反馈】你刚要做，就被提醒“这里不能碰”；你缩回手，有点不甘心。';
  }
  if (isSend) {
    return '【身体反馈】话到嘴边却没送出去，像喉咙突然发紧；你有点尴尬，想再试一次或换个说法。';
  }
  return isBrowser
    ? '【身体反馈】你朝那个方向探了探，没够到想要的东西；你有点困惑，想换个角度再来。'
    : '【身体反馈】你试着做了，但这次没成功；手上空了一下，你有点挫败，先停一停。';
}
