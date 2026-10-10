/**
 * 兼容壳 — 早期 DSH 工具按 `dist/index.js` 搜索 host 入口。
 *
 * 实际 host 入口是 `dist/server.js`（见 package.json main），
 * 这里 re-export 让老路径仍然能拿到对的 apply/name/inject。
 */
import * as server from './server.js';

export const { name, inject, apply } = server;

export default { name, inject, apply };
