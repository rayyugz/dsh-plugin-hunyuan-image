/**
 * 腾讯混元生图 API 网关：
 *   - 负责把 GenerationParams 按模型分发给 v3.5-preview / v3 两个 endpoint
 *   - 拿到 URL 后立刻调 storage 下载到本地（远程 URL 12 小时失效）
 *   - 把 HTTP 错误映射到自定义错误类，方便上层做差异化降级
 *   - 跟踪所有 in-flight 请求；dispose() 时一键 abort
 *
 * 端点契约（已从腾讯官方文档确认）：
 *   - v3.5-preview: POST https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v35-generation
 *                  OpenAI Chat/Messages 协议，支持多模态 / 多轮编辑
 *   - v3.0:        POST https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v3-generation
 *                  经典 {prompt, images, size, seed}
 * 鉴权：Authorization: Bearer <API_KEY>
 * 返回：同步 JSON（不是 SSE 流）
 */

import { randomUUID } from 'node:crypto';

import type {
  IHunyuanService,
  GenerationParams,
  GeneratedImage,
  ModelId,
  PluginConfig,
  V35Response,
  V3Response,
  ApiError,
  AssembledMessage,
} from '../types.js';
import type { Logger, IConfigService } from './config.js';
import type { IStorageService } from './storage.js';

// ──────────────────────────────────────────────────────────────
//  常量
// ──────────────────────────────────────────────────────────────

/** TokenHub 基础域名 */
const TOKENHUB_BASE = 'https://tokenhub.tencentmaas.com';
/** v3.5-preview 端点路径 */
const V35_ENDPOINT = '/v1/wand/hunyuan-image/v35-generation';
/** v3.0 端点路径 */
const V3_ENDPOINT = '/v1/wand/hunyuan-image/v3-generation';
/** 请求总超时（毫秒） */
const REQUEST_TIMEOUT_MS = 90_000;

// ──────────────────────────────────────────────────────────────
//  HTTP 适配器接口：宿主 http 必须支持 fetch(url, init) 形态
// ──────────────────────────────────────────────────────────────

export interface HttpAdapter {
  /** 与全局 fetch 同形；返回标准 Response */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<Response>;
}

// ──────────────────────────────────────────────────────────────
//  错误层级：每类错误带 requestId + code 字段，便于上层做差异化处理
// ──────────────────────────────────────────────────────────────

/** 错误基类：所有混元特定错误的祖先 */
export abstract class HunyuanError extends Error {
  /** 来自服务端响应的错误 type/code（如果有） */
  abstract readonly type: string;
  abstract readonly code: string;
  /** 服务端 request_id（用于排查） */
  readonly requestId?: string;
  /** 上游 HTTP 状态码（如果有） */
  readonly status?: number;
  /** 触发错误的模型 */
  readonly model?: ModelId;

  constructor(
    message: string,
    opts: { requestId?: string; code?: string; status?: number; model?: ModelId; cause?: unknown } = {},
  ) {
    // ES2022 Error 自带 cause 选项；把 cause 显式传给 super 让原生字段生效
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = new.target.name; // 让子类显示自己的类名
    this.requestId = opts.requestId;
    // 注：`code` 是 abstract 属性，由各子类在自己的 constructor 里赋值；
    // 抽象基类不能直接写 this.code，会触发 TS2715。
    this.status = opts.status;
    this.model = opts.model;
  }
}

/** 网络层错误（DNS 失败、连接超时、socket reset） */
export class HunyuanNetworkError extends HunyuanError {
  readonly type = 'network_error';
  readonly code: string;
  constructor(message: string, opts: { code?: string; model?: ModelId; cause?: unknown } = {}) {
    super(message, opts);
    this.code = opts.code ?? 'NETWORK';
  }
}

/** 鉴权失败（HTTP 401） */
export class HunyuanAuthError extends HunyuanError {
  readonly type = 'auth_error';
  readonly code = 'UNAUTHORIZED';
  constructor(opts: { requestId?: string; message?: string; model?: ModelId } = {}) {
    super(opts.message ?? 'TokenHub API Key 无效或过期', { ...opts, status: 401 });
  }
}

/** 内容审核拦截（HTTP 422）—— 唯一可安全重试/换 prompt 的错误类 */
export class HunyuanContentFilterError extends HunyuanError {
  readonly type = 'content_filter';
  readonly code: string;
  constructor(
    opts: { requestId?: string; message?: string; code?: string; model?: ModelId; cause?: unknown } = {},
  ) {
    super(opts.message ?? '内容未通过安全审核', { ...opts, status: 422 });
    this.code = opts.code ?? 'CONTENT_FILTER';
  }
}

/** 并发 / 速率上限（HTTP 429） */
export class HunyuanRateLimitError extends HunyuanError {
  readonly type = 'rate_limit';
  readonly code = 'RATE_LIMIT';
  constructor(opts: { requestId?: string; message?: string; model?: ModelId } = {}) {
    super(opts.message ?? '触发 TokenHub 并发上限，请稍后重试', { ...opts, status: 429 });
  }
}

/** 其他 4xx/5xx 错误——笼统归到这一类 */
export class HunyuanApiError extends HunyuanError {
  readonly type = 'api_error';
  readonly code: string;
  constructor(
    message: string,
    opts: { requestId?: string; code?: string; status?: number; model?: ModelId; cause?: unknown } = {},
  ) {
    super(message, opts);
    this.code = opts.code ?? 'API_ERROR';
  }
}

// ──────────────────────────────────────────────────────────────
//  工厂与对外接口
// ──────────────────────────────────────────────────────────────

export interface HunyuanServiceDeps {
  http: HttpAdapter;
  /** 读取当前 API Key（来自 config service，避免循环依赖） */
  getApiKey: () => string;
  /**
   * 配置服务：用于代理 IHunyuanService.getConfig / updateConfig。
   * 当前 index.ts 激活流程只注入了 getApiKey；如需 getConfig/updateConfig 代理，
   * 请同步在 index.ts 里追加 `config` 字段。
   */
  config?: IConfigService;
  storage: IStorageService;
  logger: Logger;
}

export type IHunyuanServiceWithDispose = IHunyuanService & {
  /** 取消所有 in-flight 请求；插件卸载时调用 */
  dispose(): void;
};

/**
 * 创建混元 API 网关实例。
 *
 * @param deps 宿主 http + API Key getter + config service + storage + logger
 */
export function createHunyuanService(deps: HunyuanServiceDeps): IHunyuanServiceWithDispose {
  const { http, getApiKey, config, storage, logger } = deps;

  // 跟踪所有 in-flight 请求的 AbortController；dispose 时一键取消
  const inFlight = new Set<AbortController>();

  // ── 私有：构造请求头（Bearer 鉴权 + Content-Type） ──
  function buildHeaders(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  // ── 私有：从 HTTP 状态码 + 响应体 映射到具体错误类 ──
  async function mapHttpError(
    status: number,
    rawText: string,
    model: ModelId,
  ): Promise<HunyuanError> {
    // 尝试解析 OpenAI 风格的错误体
    let apiErr: ApiError | undefined;
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (isApiErrorEnvelope(parsed)) {
        apiErr = parsed.error;
      }
    } catch {
      // 非 JSON 体时 apiErr 保持 undefined
    }

    const message = apiErr?.message ?? rawText.slice(0, 200);
    const requestId = apiErr?.request_id;
    const code = apiErr?.code;

    switch (status) {
      case 401:
        return new HunyuanAuthError({ requestId, message, model });
      case 422:
        return new HunyuanContentFilterError({ requestId, message, code, model });
      case 429:
        return new HunyuanRateLimitError({ requestId, message, model });
      default:
        return new HunyuanApiError(message, { requestId, code, status, model });
    }
  }

  // ── 私有：发起一次 API 请求，统一处理 abort / 超时 / 错误映射 ──
  async function requestJson<T>(url: string, body: unknown, model: ModelId, signal?: AbortSignal): Promise<T> {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new HunyuanAuthError({
        message: '未配置 TokenHub API Key，请在插件设置中填入',
        model,
      });
    }

    // 1. 合并用户 signal + 超时 signal
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(new Error('request timeout')), REQUEST_TIMEOUT_MS);

    // 跟踪 in-flight：dispose 时可一键中断
    const linkedCtrl = new AbortController();
    inFlight.add(linkedCtrl);
    const onUserAbort = (): void => linkedCtrl.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) {
        linkedCtrl.abort(signal.reason);
      } else {
        signal.addEventListener('abort', onUserAbort, { once: true });
      }
    }
    const onTimeout = (): void => linkedCtrl.abort(new Error('request timeout'));
    if (timeoutCtrl.signal.aborted) {
      linkedCtrl.abort(new Error('request timeout'));
    } else {
      timeoutCtrl.signal.addEventListener('abort', onTimeout, { once: true });
    }

    // 2. 发起请求
    let response: Response;
    try {
      response = await http.fetch(url, {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: JSON.stringify(body),
        signal: linkedCtrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      inFlight.delete(linkedCtrl);
      // 用户中止 → 透传 AbortError
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
      }
      // 超时中止
      if (timeoutCtrl.signal.aborted) {
        throw new HunyuanNetworkError('请求超时', { code: 'TIMEOUT', model, cause: err });
      }
      throw new HunyuanNetworkError('网络错误', { code: 'NETWORK', model, cause: err });
    }

    clearTimeout(timer);
    inFlight.delete(linkedCtrl);

    // 3. 读取响应体（先读再判状态，保证错误体也能解析）
    const text = await response.text();
    if (!response.ok) {
      throw await mapHttpError(response.status, text, model);
    }

    // 4. 业务层也可能用 error 字段返回 200 但内部失败（极少见但要兜底）
    try {
      const parsed: unknown = JSON.parse(text);
      if (isApiErrorEnvelope(parsed)) {
        const apiErr = parsed.error;
        throw new HunyuanApiError(apiErr.message ?? '业务错误', {
          requestId: apiErr.request_id,
          code: apiErr.code,
          status: response.status,
          model,
        });
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof HunyuanError) throw err;
      throw new HunyuanApiError('响应解析失败', {
        code: 'PARSE_ERROR',
        status: response.status,
        model,
        cause: err,
      });
    }
  }

  // ── 私有：v3.5-preview 请求体装配 ──
  function buildV35Body(params: GenerationParams): Record<string, unknown> {
    const messages: Array<Record<string, unknown>> = [];
    // 多轮编辑时：先灌入上轮的 assembled_history（AssistantMessage / ToolMessage）
    if (params.assembledHistory && params.assembledHistory.length > 0) {
      for (const msg of params.assembledHistory) {
        messages.push(msg as unknown as Record<string, unknown>);
      }
    }
    // 用户本轮输入：text + 参考图
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: params.prompt }];
    if (params.referenceImages && params.referenceImages.length > 0) {
      for (const url of params.referenceImages) {
        content.push({ type: 'image_url', image_url: { url } });
      }
    }
    messages.push({ role: 'user', content });
    const body: Record<string, unknown> = { model: params.model, messages };
    // 可选字段：仅在有值时下发，避免后端做无意义的默认回退
    if (params.size !== undefined) body.size = params.size;
    if (params.seed !== undefined) body.seed = params.seed;
    if (params.generateMaxPixels !== undefined) body.generate_max_pixels = params.generateMaxPixels;
    // 输入参考图面积上限：控制大图（4K/6K）带来的上下文 token 消耗
    if (params.resizeMaxPixels !== undefined) body.resize_max_pixels = params.resizeMaxPixels;
    if (params.footnote !== undefined && params.footnote.length > 0) body.footnote = params.footnote;
    if (params.session !== undefined) body.session = params.session;
    // 外部搜索增强：官方结构固定为 { value: boolean }
    if (params.useSearchTool !== undefined) {
      body.use_search_tool = { value: params.useSearchTool };
    }
    // v3.5 不接受 revise 字段
    return body;
  }

  // ── 私有：v3.0 请求体装配 ──
  function buildV3Body(params: GenerationParams): Record<string, unknown> {
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      // v3 的 images 字段：仅在有参考图时下发，避免空数组
    };
    if (params.referenceImages && params.referenceImages.length > 0) {
      body.images = params.referenceImages;
    }
    if (params.size !== undefined) body.size = params.size;
    if (params.seed !== undefined) body.seed = params.seed;
    if (params.footnote !== undefined && params.footnote.length > 0) body.footnote = params.footnote;
    if (params.revise !== undefined) body.revise = params.revise;
    // v3.0 不接受 session / generateMaxPixels / assembledHistory
    return body;
  }

  // ── 私有：从响应 URL 解析文件扩展名（兜底 png） ──
  function extFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const pathname = u.pathname.toLowerCase();
      const m = /\.([a-z0-9]{2,5})(\?|$)/.exec(pathname);
      if (m && m[1]) return m[1];
    } catch {
      /* 非合法 URL 时走兜底 */
    }
    return 'png';
  }

  // ── 对外：generate（按模型分派） ──
  async function generate(params: GenerationParams, signal?: AbortSignal): Promise<GeneratedImage> {
    // 0. 主动检查 abort，避免无意义的网络往返
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
    }

    // 1. 同步构造请求体 / 选端点
    const isV35 = params.model === 'hy-image-v3.5-preview';
    const url = TOKENHUB_BASE + (isV35 ? V35_ENDPOINT : V3_ENDPOINT);
    const body = isV35 ? buildV35Body(params) : buildV3Body(params);

    // 2. 发起请求（已经统一了 abort / 超时 / 错误映射）
    const response = isV35
      ? await requestJson<V35Response>(url, body, params.model, signal)
      : await requestJson<V3Response>(url, body, params.model, signal);

    // 3. 抽出图片 URL（v3.5 从 choices[0].delta.image.url；v3 从 data[0].url）
    //    因 response 是联合类型 V35Response|V3Response，需用 isV35 分别断言以让 TS 收窄。
    const remoteUrl = isV35
      ? (response as V35Response).choices?.[0]?.delta?.image?.url
      : (response as V3Response).data?.[0]?.url;
    if (!remoteUrl) {
      throw new HunyuanApiError('响应中未包含图片 URL', {
        requestId: response.request_id,
        model: params.model,
      });
    }

    // 4. 立刻下载到本地（远程 URL 12 小时后失效——关键不变量）
    const ext = extFromUrl(remoteUrl);
    const localPath = storage.generateLocalPath(params.model, ext);
    await storage.downloadFromUrl(remoteUrl, localPath, signal);

    // 5. 构造统一的 GeneratedImage
    const isV35Resp = isV35 && 'choices' in response;
    const assembledHistory: AssembledMessage[] | undefined = isV35Resp
      ? (response as V35Response).assembled_history
      : undefined;
    const totalTokens = isV35Resp
      ? (response as V35Response).usage?.total_tokens ?? (response as V35Response).tokenhub_usage?.total_tokens
      : (response as V3Response).tokenhub_usage?.total_tokens;
    const traceId = isV35Resp ? (response as V35Response).id : undefined;
    const revisedPrompt = !isV35Resp ? (response as V3Response).data?.[0]?.revised_prompt : undefined;

    const image: GeneratedImage = {
      id: randomUUID(),
      requestId: response.request_id,
      traceId,
      model: params.model,
      prompt: params.prompt,
      revisedPrompt,
      // size 由调用方传入或模型自决（v3.5 的 'auto'）；这里原样回传
      size: params.size ?? 'auto',
      remoteUrl,
      localPath,
      session: params.session,
      assembledHistory,
      seed: params.seed,
      footnote: params.footnote,
      totalTokens,
      createdAt: Date.now(),
    };

    return image;
  }

  // ── 对外：listModels（硬编码，因为 /v1/models 需要真 key） ──
  async function listModels(): Promise<ModelId[]> {
    return ['hy-image-v3.5-preview', 'hy-image-v3'];
  }

  // ── 对外：getConfig（代理到 config service；缺注入时抛错引导上层补 config） ──
  function getConfig(): PluginConfig {
    if (!config) {
      throw new Error('[hunyuan] getConfig 未连接：缺少 config service 注入');
    }
    return config.get();
  }

  // ── 对外：updateConfig（代理到 config service；缺注入时抛错引导上层补 config） ──
  async function updateConfig(patch: Partial<PluginConfig>): Promise<PluginConfig> {
    if (!config) {
      throw new Error('[hunyuan] updateConfig 未连接：缺少 config service 注入');
    }
    return config.update(patch);
  }

  // ── 对外：dispose（取消所有 in-flight） ──
  function dispose(): void {
    for (const ctrl of inFlight) {
      try {
        ctrl.abort(new Error('service disposed'));
      } catch {
        /* swallow: 单个 controller abort 失败不影响其他 */
      }
    }
    inFlight.clear();
    logger.info?.('[hunyuan] service disposed');
  }

  return { generate, listModels, getConfig, updateConfig, dispose };
}

// ──────────────────────────────────────────────────────────────
//  内部辅助：OpenAI 风格错误体守卫（运行时收窄 unknown，避免 any）
// ──────────────────────────────────────────────────────────────

/**
 * 判断一个 unknown 是否形如 `{ error: { type, code, message, request_id } }`。
 * 符合则把 error 字段收窄为 ApiError；否则返回 false。
 */
function isApiErrorEnvelope(v: unknown): v is { error: ApiError } {
  if (v === null || typeof v !== 'object') return false;
  if (!('error' in v)) return false;
  const err = (v as Record<string, unknown>).error;
  if (err === null || typeof err !== 'object') return false;
  // 字段类型全 string 才算合规（type/code/message/request_id）
  const obj = err as Record<string, unknown>;
  const fields: Array<keyof ApiError> = ['type', 'code', 'message'];
  for (const f of fields) {
    if (obj[f] !== undefined && typeof obj[f] !== 'string') return false;
  }
  // request_id 是可选的，但若有则必须是 string
  if (obj.request_id !== undefined && typeof obj.request_id !== 'string') return false;
  return true;
}
