// 依赖安装后的本地补丁入口。
// @snowluma/sdk 的 npm 发布包存在 ESM 相对导入缺少 .js 的问题；修补后才能在主进程直接 import。
import './patch-snowluma-sdk.mjs';
console.log('[postinstall] 伴行 Agent 依赖就绪');
