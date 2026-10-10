/**
 * DSH Host 入口 — Cordis 插件 apply。
 *
 * 插件拓扑（DSH 0.2.0-rc cordis 加载器约定）：
 *
 *   - `name`     : 与 cordis.patch.yml 的 insert.name 完全一致
 *   - `inject`   : 我启动前 DSH 必须先把 `tools` 与 `webServer` 加载好
 *   - `apply`    : 创建并返回卸载 disposer
 *
 * 模块依赖图：
 *
 *   server.ts
 *     ├─ services/config.ts    配置持久化（hunyuan-image-config.json）
 *     ├─ services/storage.ts   本地文件管理 + 远程图片下载到本地
 *     ├─ services/hunyuan.ts   腾讯混元 API 网关
 *     ├─ services/gallery.ts  JSON 文件图库（纯 JS，零原生依赖）
 *     └─ @deepseek-ai/dsh-tools  ctx.tools.register(...)
 *
 * 客户端（slots/*.tsx + dsh.client.inject）由前端开发者维护，与本文件解耦。
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createConfigService,
  type ConfigServiceDeps,
  type FsAdapter,
  type Logger,
  type PathsAdapter,
} from './services/config.js';
import { createStorageService } from './services/storage.js';
import { createHunyuanService, type HttpAdapter } from './services/hunyuan.js';
import { createGalleryService } from './services/gallery.js';
import { registerRoutes, type WebServerRegisterCtx } from './host/routes.js';

// ──────────────────────────────────────────────────────────────
//  Node 原生适配器：把 node:fs/promises 与全局 fetch 包成
//  services 层期望的 FsAdapter / HttpAdapter 形状。
//
//  说明：DSH 的 `ctx.fs` 是抽象 FS（resolve/stat/readText…），形状与
//  Node fs 不同；`ctx.http` / `ctx.paths` 服务不存在。插件跑在 DSH host
//  的 Node.js 进程内，因此直接用 Node 原生能力最稳、依赖最少。
// ──────────────────────────────────────────────────────────────

/** node:fs/promises → FsAdapter */
const nodeFsAdapter: FsAdapter = {
  async readFile(filePath, encoding) {
    return fsp.readFile(filePath, encoding);
  },
  async writeFile(filePath, data, encoding) {
    if (typeof data === 'string') {
      await fsp.writeFile(filePath, data, (encoding ?? 'utf8') as BufferEncoding);
    } else {
      await fsp.writeFile(filePath, data);
    }
  },
  async rename(oldPath, newPath) {
    await fsp.rename(oldPath, newPath);
  },
  async mkdir(dirPath, options) {
    await fsp.mkdir(dirPath, options);
  },
  async exists(filePath) {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  },
  async readdir(dirPath) {
    return fsp.readdir(dirPath);
  },
  async unlink(filePath) {
    await fsp.unlink(filePath);
  },
};

/** 全局 fetch → HttpAdapter（Node 18+ 自带 fetch） */
const nodeHttpAdapter: HttpAdapter = {
  fetch: (url, init) => fetch(url, init),
};

// ──────────────────────────────────────────────────────────────
//  插件身份：cordis.patch.yml 的 insert.name 必须与此一致
// ──────────────────────────────────────────────────────────────

export const name = 'dsh-plugin-hunyuan-image';

/**
 * 启动本插件前 DSH 必须就绪的服务：
 *   - `tools`     : dsh-tools 注册的 ToolRuntime，本插件要注册一个 Tool
 *   - `webServer` : 保留（v0.2 计划提供 /api/hunyuan/* HTTP 端点；当前仅 tool 暂用）
 *
 * DSH 加载器检查此数组，缺一个就不启动本插件（直到该服务可用）。
 */
export const inject = ['tools', 'webServer'] as const;

// ──────────────────────────────────────────────────────────────
//  适配器形状：ctx 上有 fs / paths / http 等服务，由宿主提供；
//  这里只声明本插件用到的方法子集，避免与宿主 SDK 类型强耦合
// ──────────────────────────────────────────────────────────────

interface DshContextAdapters {
  fs: FsAdapter;
  paths: PathsAdapter;
  http: HttpAdapter;
}

// ──────────────────────────────────────────────────────────────
//  Tool 输出 schema
//
//  defineTool 的 output 必须给 schema + render：schema 是模型可读的
//  JSON Schema，render 把已经校验通过的 canonical value 投影成给模型
//  看到的 text/image 内容块。本插件只投影文字 + 远程图片引用。
// ──────────────────────────────────────────────────────────────

import type { SizeV35, SizeV3 } from './types.js';

interface GeneratedImageOut {
  localPath: string;
  remoteUrl: string;
  requestId: string;
  totalTokens: number | undefined;
  width: number;
  height: number;
  model: string;
  size: string;
}

const GENERATE_IMAGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    localPath: { type: 'string', required: true, description: '本地保存绝对路径（图片已被立刻下载）' },
    remoteUrl: { type: 'string', required: true, description: '腾讯混元远程 URL（12 小时内有效）' },
    requestId: { type: 'string', required: true, description: '服务端请求 ID（用于溯源 / 报错）' },
    totalTokens: { type: 'integer', description: '本次消耗的 token 数（v3.5 / v3 协议字段）' },
    width: { type: 'integer', required: true, description: '图像宽度像素' },
    height: { type: 'integer', required: true, description: '图像高度像素' },
    model: { type: 'string', required: true, description: '实际使用的模型 ID' },
    size: { type: 'string', required: true, description: '实际输出尺寸，WxH 或 auto' },
  },
} as const satisfies import('@deepseek-ai/dsh-tools').ObjectValueSchemaSpec;

/** 把 "1024x1024" 拆成 [w, h]；解析失败兜底 1024×1024 */
function parseSize(size: string | undefined): [number, number] {
  if (!size || size === 'auto') return [1024, 1024];
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return [1024, 1024];
  const w = Number.parseInt(m[1]!, 10);
  const h = Number.parseInt(m[2]!, 10);
  return [w, h];
}

/**
 * 纯函数：从已校验的生成结果投影出模型可看的 content blocks。
 *
 * 只投影文字（ImageBlock 的 dsh-llm 形状要求 attachment 字段，由 attachment
 * 服务解析；本工具直接返回原始 URL，由 chat 渲染层或工具消费方各自取用）。
 */
function renderGeneratedImage(_args: unknown, value: GeneratedImageOut) {
  const lines = [
    `已生成图片：模型=${value.model}，尺寸=${value.size}（${value.width}×${value.height}）`,
    `requestId=${value.requestId}`,
    value.totalTokens !== undefined ? `消耗 tokens=${value.totalTokens}` : null,
    `本地路径=${value.localPath}`,
    `远程 URL=${value.remoteUrl}`,
  ].filter((l): l is string => l !== null);
  return [
    { type: 'text', text: lines.join('\n') } as unknown as never,
  ];
}

// ──────────────────────────────────────────────────────────────
//  apply：cordis 加载器在本插件被 include 时调用一次
// ──────────────────────────────────────────────────────────────

export async function apply(ctx: Context): Promise<() => void> {
  // 1. 构造宿主适配器。
  //
  //    重要：DSH 的 cordis 服务目录里 **没有** `http` / `paths` 服务，
  //    而 `ctx.fs` 是 DSH 的抽象 FS（resolve/stat/readText/writeText），
  //    与 Node 风格 FsAdapter 形状完全不同。因此本插件直接使用宿主进程
  //    自带的 Node 原生能力（插件运行在 DSH host 的 Node.js 里）：
  //      - 文件系统：node:fs/promises
  //      - 数据目录：~/.dsh/hunyuan-image（或 $DSH_PROFILE_DIR）
  //      - 网络：全局 fetch（Node 18+）
  //    只有 `logger` 仍取自 cordis Context。
  const userDataDir =
    process.env.DSH_PROFILE_DIR ?? path.join(os.homedir(), '.dsh', 'hunyuan-image');
  await fsp.mkdir(userDataDir, { recursive: true });

  const adapters: DshContextAdapters = {
    fs: nodeFsAdapter,
    paths: { userData: () => userDataDir },
    http: nodeHttpAdapter,
  };

  const logger: Logger = (ctx as unknown as { logger?: Logger }).logger ?? {
    warn: (msg: string, ...rest: unknown[]) => console.warn(msg, ...rest),
    error: (msg: string, ...rest: unknown[]) => console.error(msg, ...rest),
  };
  logger.info?.(`[hunyuan] server entry activated (data dir: ${userDataDir})`);

  // ── 配置层 ─────────────────────────────────────────────────────
  // 注意：DSH 0.2.0-rc 的 cordis 加载器目前不支持 manifest 默认 config（v1.1 才落地）；
  // 这里 initial 始终为空对象，等设置面板写入后再回灌。
  const configDeps: ConfigServiceDeps = {
    fs: adapters.fs,
    paths: adapters.paths,
    logger,
    initial: {},
  };
  const config = createConfigService(configDeps);
  await config.load();
  logger.info?.(`[hunyuan] 配置加载完成：模型=${config.get().defaultModel}，保存路径=${config.get().storagePath}`);

  // ── 文件存储层 ───────────────────────────────────────────────
  // basePath 传 getter：用户在设置面板改保存路径后**立即生效**，
  // 无需重启插件（否则会一直写激活那一刻的旧路径）。
  const storage = createStorageService({
    fs: adapters.fs,
    basePath: () => config.get().storagePath,
    logger,
  });
  await storage.ensureDir();

  // ── API 网关 ─────────────────────────────────────────────────
  const hunyuan = createHunyuanService({
    http: adapters.http,
    getApiKey: () => config.get().apiKey,
    config,
    storage,
    logger,
  });

  // ── 图库层 ─────────────────────────────────────────────────
  const gallery = createGalleryService({
    fs: adapters.fs,
    paths: adapters.paths,
    logger,
    storage,
  });
  await gallery.init();

  // ── 客户端 HTTP RPC 路由：把 Service 暴露给前端 ────────────────
  // Client 不直接持有 host 服务实例，通过 fetch('/hunyuan/api/<method>')
  // 调用本插件注册的端点；handler 委托给真实的 hunyuan / gallery / config。
  // 卸载时由 webServer 注册返回的 disposer 一键注销。
  const routesDisposer = registerRoutes(
    ctx as unknown as WebServerRegisterCtx,
    { hunyuan, gallery, config, logger },
  );
  logger.info?.('[hunyuan] client RPC routes registered at /hunyuan/api/*');

  // ── 工具：模型可直调的 hunyuan_generate_image ────────────────────
  // ctx.tools 是 ToolRuntime；它的 .register() 返回的 disposer
  // 卸载时直接调用即可注销本插件注册的工具。
  const toolDisposer = ctx.tools.register(
    defineTool({
      name: 'hunyuan_generate_image',
      description:
        '调用腾讯混元生图 API（hy-image-v3.5-preview / hy-image-v3）生成一张图片。' +
        '当用户希望「画一张图 / 生成图片 / 根据这段描述出图」时使用。' +
        '返回本地保存路径 + 远程 URL + requestId，图片会被立刻下载到本地（远程 URL 12 小时内有效）。',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: '图片生成提示词，中英文均可，建议 ≤ 2000 字符',
        },
        model: {
          type: 'string',
          enum: ['hy-image-v3.5-preview', 'hy-image-v3'],
          description: '模型 ID；默认 hy-image-v3.5-preview（支持多模态）',
        },
        size: {
          type: 'string',
          description: '输出尺寸 "WxH" 或 v3.5 的 "auto"；省略时使用插件默认',
        },
        reference_image_urls: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图 URL / data URI 列表；v3.5-preview / v3.0 都支持',
        },
        footnote: {
          type: 'string',
          description: '水印脚注，≤ 16 utf8 字符；非空时生成在右下角',
        },
      },
      output: {
        schema: GENERATE_IMAGE_OUTPUT_SCHEMA,
        render: renderGeneratedImage,
      },
      execute: async (args, exec) => {
        // 1. 主动检查 abort，避免无意义的网络往返
        exec.signal.throwIfAborted();

        // 2. 组装 service 层期望的 GenerationParams。
        //    size 在 tool schema 是 string，在 service 层是 `SizeV35 | SizeV3`
        //    模板字面量联合；按定义形如 "1024x1024" 都是 size，不能收窄时
        //    原样透传，运行时由 hunyuan service 校验具体尺寸白名单。
        const params = {
          prompt: args.prompt,
          model: args.model ?? 'hy-image-v3.5-preview',
          ...(args.size !== undefined ? { size: args.size as SizeV35 | SizeV3 } : {}),
          ...(args.reference_image_urls !== undefined ? { referenceImages: args.reference_image_urls } : {}),
          ...(args.footnote !== undefined ? { footnote: args.footnote } : {}),
        };

        // 3. 调用混元网关（内部完成下载到本地 + 构造 GeneratedImage）
        const image = await hunyuan.generate(params, exec.signal);

        // 4. 同步入库到图库；失败仅记日志，不影响用户拿图
        try {
          await gallery.insert(image);
        } catch (e) {
          logger.warn?.('[hunyuan] gallery.insert failed', e);
        }

        // 5. 解析尺寸并投影为 output schema 形状（必须含 width/height）
        const [width, height] = parseSize(image.size);
        const out: GeneratedImageOut = {
          localPath: image.localPath,
          remoteUrl: image.remoteUrl,
          requestId: image.requestId,
          totalTokens: image.totalTokens,
          width,
          height,
          model: image.model,
          size: image.size,
        };
        return out;
      },
    }),
  );

  // ── 返回卸载 disposer ──────────────────────────────────────
  // 释放顺序：先卸前端路由（避免 in-flight 请求继续命中），再卸工具，
  // 最后关 service。
  return async () => {
    try { routesDisposer(); } catch {}
    try { toolDisposer(); } catch {}
    try { await gallery.dispose(); } catch {}
    try { hunyuan.dispose(); } catch {}
    try { await storage.dispose(); } catch {}
    logger.info?.('[hunyuan] server entry disposed');
  };
}
