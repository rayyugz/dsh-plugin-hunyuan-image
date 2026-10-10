/**
 * 把 TypeScript 源码打包成 DSH 客户端模块表要求的形态。
 *
 * DSH 的 Web 端不加载普通 ESM，而是要求每个 UI 插件提供一个
 * `window.__ModuleLoader__.load({ id, factory })` 调用：
 *
 *   - `id` 必须等于 package.json 的 `name`（DSH 用它做模块标识）
 *   - `factory(require)` 返回 `{ inject, apply }`
 *   - basline 运行时（react 等）由 factory 的 `require` 提供，不重复打包
 *
 * 本脚本：
 *   1. 用 esbuild 把 src/client.ts 及其依赖（含 TSX 组件）打成一段 CJS；
 *      react / react-dom 标记为 external，保持 `require('react')` 调用；
 *   2. 把这段 CJS 包进 __ModuleLoader__.load 的 factory 里；
 *   3. 写出 dist/client.js。
 */

import { build } from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// 本脚本位于 <pkg>/scripts/ 下，包根目录是上一级
const ROOT = dirname(SCRIPT_DIR);
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const PKG_ID = PKG.name;

const TMP = join(ROOT, 'dist', '.client.tmp.cjs');
const OUT = join(ROOT, 'dist', 'client.js');

mkdirSync(join(ROOT, 'dist'), { recursive: true });

// 1) 打成 CJS（react 保持 external，交给 factory 的 require 解析）
//
// 关键：DSH 客户端模块表只提供 `React`（且是「未做 JSX 转换」的运行时），
// 不保证提供 `react/jsx-runtime`。因此必须强制把 JSX 编译成
// React.createElement 调用 —— 用 tsconfigRaw 覆盖项目 tsconfig 里的
// `"jsx": "react-jsx"`，否则 esbuild 会去 require('react/jsx-runtime')。
await build({
  entryPoints: [join(ROOT, 'src', 'client.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  tsconfigRaw: {
    compilerOptions: {
      jsx: 'react',
      target: 'es2022',
      useDefineForClassFields: false,
    },
  },
  external: ['react', 'react-dom', 'react-dom/client'],
  outfile: TMP,
  logLevel: 'warning',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
});

// 2) 包进 DSH 客户端模块表
const cjs = readFileSync(TMP, 'utf8');

const banner = `/**
 * dsh-plugin-hunyuan-image — DSH Web 客户端半。
 * 由 scripts/build-client.mjs 从 src/client.ts 打包生成，请勿手改。
 * React 由 DSH 客户端模块表提供（factory 的 require）。
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PKG_ID)},
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
`;

const footer = `
    return module.exports;
  },
});
`;

writeFileSync(OUT, banner + cjs + footer, 'utf8');
rmSync(TMP, { force: true });

console.log(`[build-client] wrote ${OUT} (${(banner + cjs + footer).length} bytes), id=${PKG_ID}`);
