/**
 * DSH Host 路由：把 Service 暴露给 Client 端的 HTTP 端点。
 *
 * Client 不直接持有 host 服务实例，它通过 fetch(`/hunyuan/api/<method>`)
 * 调用本文件注册的端点；host 拿到请求后转给真实的 Service 层。
 *
 * 端点清单（路径固定 `prefix: '/hunyuan/api'`，方法名取自
 * `pathname.slice('/hunyuan/api/'.length)`）：
 *
 *   hunyuan.generate        POST  → IHunyuanService.generate
 *   hunyuan.listModels      POST  → IHunyuanService.listModels
 *   hunyuan.updateConfig    POST  → IHunyuanService.updateConfig
 *   gallery.list            POST  → IGalleryService.list
 *   gallery.get             POST  → IGalleryService.get
 *   gallery.delete          POST  → IGalleryService.delete
 *   gallery.deleteBatch     POST  → IGalleryService.deleteBatch
 *   gallery.count           POST  → IGalleryService.count
 *   config.get              POST  → IConfigService.get
 *   fs.stat                 POST  → 批量文件字节数（设置面板容量统计）
 *   file.export             POST  → 导出（DSH 暂无另存为对话框，返回原因）
 *   share                   POST  → 分享（DSH 暂无 IM 通道，返回可复制信息）
 *
 * 协议（与 dsh-better-sidebar 的 /sidebar/api 同形）：
 *   POST `{args: any}` → 200 `{ok:true, value}` 或 `{ok:false, error:{code,message}}`
 *
 * 注意：路由仅做信封解析 + 错误归一化，不做额外的字段裁剪 —— Service 层
 * 自己 sanitize（参见 services/config.ts 的 sanitize 函数）。这是 v0.2
 * 的最小实现：trust boundary 信任前端插件进程。
 */

import type { IHunyuanService } from '../types.js';
import type { IConfigService, Logger } from '../services/config.js';
import type { IGalleryServiceInternal } from '../services/gallery.js';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────────────────────
//  HTTP 适配器：与 dsh-better-sidebar 的 SidebarHttpRequest/Response 一致。
//  完整声明避免对 dsh-plugin-sdk 的类型耦合；运行时由 DSH 保证形状匹配。
// ────────────────────────────────────────────────────────────────────────────

export interface HunyuanHttpRequest {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>;
}

export interface HunyuanHttpResponse {
  statusCode: number;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string | Uint8Array): void;
}

export interface HunyuanWebRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: HunyuanHttpRequest, res: HunyuanHttpResponse) => void | Promise<void>;
}

export interface WebServerRegisterCtx {
  webServer: { register(route: HunyuanWebRoute): () => void };
}

// ────────────────────────────────────────────────────────────────────────────
//  协议形状
// ────────────────────────────────────────────────────────────────────────────

interface RpcEnvelopeOk<T> {
  ok: true;
  value: T;
}
interface RpcEnvelopeErr {
  ok: false;
  error: { code: string; message: string };
}

function ok<T>(value: T): RpcEnvelopeOk<T> {
  return { ok: true, value };
}
function err(code: string, message: string): RpcEnvelopeErr {
  return { ok: false, error: { code, message } };
}

// ────────────────────────────────────────────────────────────────────────────
//  body 解析：drain → JSON.parse；带大小上限与错误归一
// ────────────────────────────────────────────────────────────────────────────

async function readJsonBody(req: HunyuanHttpRequest): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const CAP = 4 * 1024 * 1024; // 4 MiB 防御上限
  for await (const chunk of req) {
    const buf =
      typeof chunk === 'string'
        ? new TextEncoder().encode(chunk)
        : chunk instanceof Uint8Array
          ? chunk
          : new Uint8Array(0);
    chunks.push(buf);
    total += buf.byteLength;
    if (total > CAP) throw new Error('payload-too-large');
  }
  if (total === 0) return {};
  const merged = new Uint8Array(total);
  let off = 0;
  for (const buf of chunks) {
    merged.set(buf, off);
    off += buf.byteLength;
  }
  const text = new TextDecoder('utf-8').decode(merged);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('bad-json: ' + (e instanceof Error ? e.message : String(e)));
  }
}

function writeJson(
  res: HunyuanHttpResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(json);
}

// ────────────────────────────────────────────────────────────────────────────
//  注册路由
// ────────────────────────────────────────────────────────────────────────────

export interface RegisterRoutesOptions {
  hunyuan: IHunyuanService;
  /** 用 internal 接口：路由需要 insert（生图成功后立刻入库） */
  gallery: IGalleryServiceInternal;
  config: IConfigService;
  logger?: Logger;
}

type RpcHandler = (args: any) => Promise<unknown> | unknown;

export function registerRoutes(
  ctx: WebServerRegisterCtx,
  opts: RegisterRoutesOptions,
): () => void {
  const { hunyuan, gallery, config, logger } = opts;
  const log = {
    warn: (msg: string, ...rest: unknown[]) =>
      logger ? logger.warn(msg, ...rest) : console.warn(msg, ...rest),
  };

  const methodHandlers: Record<string, RpcHandler> = {
    'hunyuan.generate': async (args) => {
      // abort 信号由 Service 层负责；这里给个保守 120s 上限
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 120_000);
      try {
        const image = await hunyuan.generate(args ?? {}, c.signal);
        // 生图成功后**立刻入库**，UI 生成的图片才会出现在图库里。
        // 入库失败不该让用户拿不到图，所以单独 try 并只告警。
        try {
          await gallery.insert(image);
        } catch (e) {
          log.warn('[hunyuan] gallery.insert 失败（图片仍已返回）', e);
        }
        return image;
      } finally {
        clearTimeout(timer);
      }
    },
    'hunyuan.listModels': () => hunyuan.listModels(),
    'hunyuan.updateConfig': async (args) => {
      const next = await hunyuan.updateConfig(args ?? {});
      return next;
    },
    'gallery.list': (args) => gallery.list(args ?? {}),
    'gallery.get': async (args) => {
      const id = (args as { id?: string })?.id;
      if (typeof id !== 'string') throw new Error('args.id required');
      return gallery.get(id);
    },
    'gallery.delete': async (args) => {
      const id = (args as { id?: string })?.id;
      if (typeof id !== 'string') throw new Error('args.id required');
      await gallery.delete(id);
      return { ok: true };
    },
    'gallery.deleteBatch': async (args) => {
      const ids = (args as { ids?: string[] })?.ids;
      if (!Array.isArray(ids)) throw new Error('args.ids required');
      await gallery.deleteBatch(ids);
      return { ok: true };
    },
    'gallery.count': () => gallery.count(),
    'config.get': () => config.get(),
    // ── 客户端 Bus 转发过来的辅助操作 ────────────────────────────
    /** 计算若干本地文件的字节数（设置面板显示「已占用 X MB」） */
    'fs.stat': async (args) => {
      const paths = (args as { paths?: unknown })?.paths;
      const replyTo = (args as { replyTo?: unknown })?.replyTo;
      const sizes: Record<string, number> = {};
      if (Array.isArray(paths)) {
        // 逐个 stat；单个失败只跳过，不影响整批
        const results = await Promise.all(
          paths
            .filter((p): p is string => typeof p === 'string')
            .map(async (p) => {
              try {
                const st = await fsp.stat(p);
                return [p, st.size] as const;
              } catch {
                return [p, 0] as const;
              }
            }),
        );
        for (const [p, size] of results) sizes[p] = size;
      }
      return { replyTo, sizes };
    },
    /** 把插件生成的文件复制到用户指定位置（尽力而为；无 GUI 时返回失败原因） */
    'file.export': async (args) => {
      const src = (args as { path?: unknown })?.path;
      if (typeof src !== 'string') throw new Error('args.path required');
      // DSH 目前没有向插件暴露「另存为」对话框；返回源路径让 UI 提示用户。
      return { ok: false, reason: 'no-save-dialog', path: src };
    },
    /** 分享：DSH 未暴露 IM 分享通道；返回可复制的信息给 UI 兜底 */
    'share': async (args) => {
      const a = (args ?? {}) as { url?: unknown; prompt?: unknown; target?: unknown };
      return {
        ok: false,
        reason: 'no-share-channel',
        target: typeof a.target === 'string' ? a.target : null,
        url: typeof a.url === 'string' ? a.url : null,
        prompt: typeof a.prompt === 'string' ? a.prompt : null,
      };
    },
  };

  const prefixHandler = async (
    req: HunyuanHttpRequest,
    res: HunyuanHttpResponse,
  ): Promise<void> => {
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
    const method = pathname.startsWith('/hunyuan/api/')
      ? pathname.slice('/hunyuan/api/'.length)
      : undefined;
    if (method === undefined || method === '' || method.includes('/')) {
      writeJson(res, 404, err('not-found', `unknown hunyuan API method "${method ?? ''}"`));
      return;
    }
    const handler = methodHandlers[method];
    if (handler === undefined) {
      writeJson(res, 404, err('not-found', `unknown hunyuan API method "${method}"`));
      return;
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, err('method-error', 'method not allowed'));
      return;
    }
    let payload: { args?: unknown };
    try {
      const parsed = await readJsonBody(req);
      payload = (parsed && typeof parsed === 'object'
        ? (parsed as { args?: unknown })
        : {}) ?? {};
    } catch (e) {
      writeJson(res, 400, err('bad-request', e instanceof Error ? e.message : String(e)));
      return;
    }
    try {
      const value = await handler(payload.args);
      writeJson(res, 200, ok(value));
    } catch (e) {
      log.warn(`[hunyuan] /api/${method} error`, e);
      writeJson(res, 500, err('rpc-error', e instanceof Error ? e.message : String(e)));
    }
  };

  // ── 本地图片回送路由 ───────────────────────────────────────────
  //
  // 浏览器无法直接加载 `file:///...` 或裸的文件系统路径，所以插件把生成到
  // 本地的图片通过本路由回送，供「结果预览」与「图库缩略图」使用。
  //
  // 安全：只允许读取**当前保存目录**（config.storagePath）内的文件，
  // 用 path.resolve + 前缀比对挡住 `../` 路径穿越。
  const serveLocalFile = async (
    req: HunyuanHttpRequest,
    res: HunyuanHttpResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://dsh.internal');
    const raw = url.searchParams.get('path') ?? '';
    if (raw === '') {
      res.statusCode = 400;
      res.end('missing path');
      return;
    }

    let root: string;
    let target: string;
    try {
      root = path.resolve(config.get().storagePath);
      target = path.resolve(decodeURIComponent(raw));
    } catch {
      res.statusCode = 400;
      res.end('bad path');
      return;
    }

    // 必须是保存目录本身或其子孙
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }

    try {
      const data = await fsp.readFile(target);
      const ext = path.extname(target).toLowerCase();
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
              ? 'image/webp'
              : 'application/octet-stream';
      res.writeHead(200, {
        'content-type': mime,
        'content-length': String(data.byteLength),
        // 文件名含 uuid，内容不会变，可长缓存
        'cache-control': 'private, max-age=31536000, immutable',
      });
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  };

  const apiDisposer = ctx.webServer.register({
    kind: 'prefix',
    path: '/hunyuan/api',
    handler: prefixHandler,
  });

  const fileDisposer = ctx.webServer.register({
    kind: 'prefix',
    path: '/hunyuan/file',
    handler: serveLocalFile,
  });

  // 两个路由一起注销
  return () => {
    try {
      apiDisposer();
    } catch {
      /* ignore */
    }
    try {
      fileDisposer();
    } catch {
      /* ignore */
    }
  };
}
