/**
 * 本地图片 URL 助手。
 *
 * 浏览器**不能**加载 `file:///...` 或裸文件系统路径（`/Users/xxx/a.png`），
 * 所以插件在 host 端注册了 `/hunyuan/file?path=<绝对路径>` 回送路由
 * （见 src/host/routes.ts 的 serveLocalFile），把落盘的图片喂给前端。
 *
 * 为什么不用生图返回的 remoteUrl：
 *   - remoteUrl 是腾讯 COS 的**临时签名地址**，12 小时后就失效；
 *   - 图库要长期展示历史图片，必须依赖本地文件。
 * 因此统一走本助手；remoteUrl 仅作为回退。
 */

/** 回送路由前缀（与 host/routes.ts 保持一致） */
const FILE_PREFIX = '/hunyuan/file';

/**
 * 把本地文件绝对路径转成浏览器可加载的 URL。
 *
 * @param localPath 落盘图片的绝对路径
 * @returns 可直接放进 `<img src>` 的 URL；路径为空时返回 undefined
 */
export function localFileUrl(localPath: string | undefined | null): string | undefined {
  if (!localPath) return undefined;
  return `${FILE_PREFIX}?path=${encodeURIComponent(localPath)}`;
}
