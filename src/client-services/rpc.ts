/**
 * 客户端 → Host 的 RPC 工具：fetch('/hunyuan/api/<method>') 信封解析。
 *
 * 与 src/host/routes.ts 的服务端 handler 严格对位：
 *   POST `{args: any}` → 200 `{ok:true, value}` 或 `{ok:false, error:{code,message}}`
 *
 * 任何 RPC 调用错误都抛 `HunyuanRpcError`，slots 拿到后只需 .message 渲染。
 *
 * 关于 IHunyuanService.getConfig 的实现约束：
 *   types.ts 里它声明为同步 `(): PluginConfig`（host 侧直接拿内存快照）。
 *   客户端不能保证同步拿到 host 状态，所以本包装在初始化时异步 fetch 一次
 *   缓存到本地，updateConfig 同时 POST + 同步更新缓存 —— 这样 getConfig
 *   仍保持同步签名。slots 没有用到 services.hunyuan.getConfig 的代码路径，
 *   所以这是兼容的；后续若 slots 真要直读，再加 async getConfig 即可。
 */

import type {
  GalleryQuery,
  GeneratedImage,
  GenerationParams,
  IHunyuanService,
  IGalleryService,
  ModelId,
  PluginConfig,
} from '../types.js';

const API_PREFIX = '/hunyuan/api';

/** RPC 错误：携带服务端 code 字段，方便上层做差异化处理 */
export class HunyuanRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HunyuanRpcError';
  }
}

interface EnvelopeOk<T> {
  ok: true;
  value: T;
}
interface EnvelopeErr {
  ok: false;
  error: { code: string; message: string };
}

/**
 * 调用 host 端注册在 /hunyuan/api/* 的 RPC 端点。
 *
 * @param method 方法名（如 'hunyuan.generate' / 'config.get'）
 * @param args   传给 host handler 的参数对象
 * @param signal 可选取消信号
 * @returns host handler 的返回值
 */
export async function call<T>(method: string, args: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: args ?? {} }),
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw e;
    }
    throw new HunyuanRpcError(
      'network',
      e instanceof Error ? e.message : String(e),
    );
  }

  let parsed: EnvelopeOk<T> | EnvelopeErr | null = null;
  try {
    parsed = (await response.json()) as EnvelopeOk<T> | EnvelopeErr;
  } catch {
    throw new HunyuanRpcError('http', `HTTP ${response.status} (non-JSON)`);
  }

  if (parsed === null) {
    throw new HunyuanRpcError('http', `HTTP ${response.status}`);
  }
  if (parsed.ok === false) {
    throw new HunyuanRpcError(parsed.error.code, parsed.error.message);
  }
  if (!response.ok) {
    throw new HunyuanRpcError('http', `HTTP ${response.status}`);
  }
  return parsed.value;
}

/** IHunyuanService.getConfig 的兜底默认（避免 slots 在 client 初始化前调用炸掉） */
function emptyConfig(): PluginConfig {
  return {
    apiKey: '',
    storagePath: '',
    defaultModel: 'hy-image-v3.5-preview',
    defaultSize: '1024x1024',
    defaultOrientation: 'square',
    footnote: '',
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  IHunyuanService 的 fetch wrapper
// ────────────────────────────────────────────────────────────────────────────

export function createHunyuanClient(): IHunyuanService {
  // 内存中的配置缓存：init() 后保持最新；updateConfig 既 POST 又同步更新本地。
  let cached: PluginConfig = emptyConfig();

  // 客户端首次激活时异步把 host 的配置拉到本地（fire-and-forget；
  // 失败也不致命 —— slots 拿到的 props.config 由 props 注入器提供）。
  void call<PluginConfig>('config.get', {})
    .then((c) => {
      cached = c;
    })
    .catch(() => {
      /* swallow: 首屏拿不到配置也不影响 generate */
    });

  return {
    async generate(params: GenerationParams, signal?: AbortSignal): Promise<GeneratedImage> {
      return await call<GeneratedImage>('hunyuan.generate', params, signal);
    },
    async listModels(): Promise<ModelId[]> {
      return await call<ModelId[]>('hunyuan.listModels', {});
    },
    getConfig(): PluginConfig {
      return cached;
    },
    async updateConfig(patch: Partial<PluginConfig>): Promise<PluginConfig> {
      const next = await call<PluginConfig>('hunyuan.updateConfig', patch);
      cached = next;
      return next;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  IGalleryService 的 fetch wrapper
// ────────────────────────────────────────────────────────────────────────────

export function createGalleryClient(): IGalleryService {
  return {
    async list(query: GalleryQuery): Promise<GeneratedImage[]> {
      return await call<GeneratedImage[]>('gallery.list', query);
    },
    async get(id: string): Promise<GeneratedImage | null> {
      return await call<GeneratedImage | null>('gallery.get', { id });
    },
    async delete(id: string): Promise<void> {
      await call<{ ok: true }>('gallery.delete', { id });
    },
    async deleteBatch(ids: string[]): Promise<void> {
      await call<{ ok: true }>('gallery.deleteBatch', { ids });
    },
    async count(): Promise<number> {
      return await call<number>('gallery.count', {});
    },
    // 关键词监听：v0.2 暂不实现，返回一次性清理函数。
    // 真实实现需要 host 推送（WebSocket / SSE），等插件跑起来再补。
    onKeywordDetected(
      _handler: (context: { keyword: string; messageId: string }) => void,
    ): () => void {
      return () => {
        /* no-op: v0.2 暂不监听 */
      };
    },
  };
}
