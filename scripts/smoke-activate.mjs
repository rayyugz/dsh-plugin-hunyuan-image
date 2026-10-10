/**
 * 激活冒烟测试：用 mock cordis ctx 调用插件的 apply()，
 * 在「用户重启 DSH」之前就抓出运行时错误。
 *
 * 运行：node scripts/smoke-activate.mjs
 *
 * 它 mock 掉：
 *   - ctx.logger          真实 console
 *   - ctx.tools.register  记录工具名
 *   - ctx.webServer.register 记录路由前缀
 *   - 环境变量 DSH_PROFILE_DIR 指向临时目录（隔离，不污染 ~/.dsh）
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// 1) 隔离数据目录，避免写入真实 ~/.dsh
const sandbox = mkdtempSync(join(tmpdir(), 'hunyuan-smoke-'));
process.env.DSH_PROFILE_DIR = sandbox;

const registeredTools = [];
const registeredRoutes = [];
let disposed = false;

const ctx = {
  logger: {
    debug: () => {},
    info: (m, ...r) => console.log('  [info]', m, ...r),
    warn: (m, ...r) => console.warn('  [warn]', m, ...r),
    error: (m, ...r) => console.error('  [error]', m, ...r),
  },
  tools: {
    register(def) {
      registeredTools.push(def?.name ?? String(def));
      return () => {
        disposed = true;
      };
    },
  },
  webServer: {
    register(route) {
      registeredRoutes.push({ kind: route.kind, path: route.path });
      return () => {};
    },
    registerUpgrade: () => () => {},
  },
};

console.log(`[smoke] 沙箱数据目录: ${sandbox}`);
console.log('[smoke] 导入 dist/server.js …');

const mod = await import(pathToFileURL(join(ROOT, 'dist', 'server.js')).href);
console.log(`[smoke] 导出: ${Object.keys(mod).join(', ')}`);
console.log(`[smoke] name = ${mod.name}`);
console.log(`[smoke] inject = ${JSON.stringify(mod.inject)}`);

if (typeof mod.apply !== 'function') {
  console.error('[smoke] ❌ 没有导出 apply 函数');
  process.exit(1);
}

console.log('[smoke] 调用 apply(ctx) …');
let disposeFn;
try {
  disposeFn = await mod.apply(ctx);
} catch (e) {
  console.error('[smoke] ❌ apply() 抛错:', e?.stack ?? e);
  rmSync(sandbox, { recursive: true, force: true });
  process.exit(1);
}

console.log(`[smoke] ✅ apply() 成功返回（disposer 类型: ${typeof disposeFn}）`);
console.log(`[smoke] 注册的工具: ${JSON.stringify(registeredTools)}`);
console.log(`[smoke] 注册的路由: ${JSON.stringify(registeredRoutes)}`);

// 校验关键预期
const problems = [];
if (!registeredTools.includes('hunyuan_generate_image')) {
  problems.push('未注册 hunyuan_generate_image 工具');
}
if (!registeredRoutes.some((r) => r.path === '/hunyuan/api')) {
  problems.push('未注册 /hunyuan/api 路由');
}

if (typeof disposeFn === 'function') {
  try {
    await disposeFn();
    console.log('[smoke] ✅ dispose() 执行成功');
  } catch (e) {
    problems.push(`dispose() 抛错: ${e?.message ?? e}`);
  }
}

rmSync(sandbox, { recursive: true, force: true });

if (problems.length > 0) {
  console.error('[smoke] ❌ 问题:');
  for (const p of problems) console.error('   -', p);
  process.exit(1);
}

console.log('[smoke] 🎉 全部通过：apply 可执行、工具已注册、路由已注册、dispose 正常');
