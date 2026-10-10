/**
 * 共享类型契约：所有 Service / Slot / Tool / Event 之间流通的数据结构。
 * 改动这里 = 改动整条调用链；保持稳定是最高优先级。
 */

// ──────────────────────────────────────────────────────────────
//  模型与请求
// ──────────────────────────────────────────────────────────────

export type ModelId = 'hy-image-v3.5-preview' | 'hy-image-v3';

/** v3.5-preview 的尺寸约束：宽高 ∈ [256, 8192]，面积 ≤ 16,777,216 */
export type SizeV35 = `${number}x${number}` | 'auto';
/** v3.0 的尺寸约束：宽高 ∈ [512, 2048]，面积 ≤ 1024×1024；预设为 37 组 */
export type SizeV3 =
  | `${number}x${number}`
  | '2048x512' | '1984x512' | '1920x512' | '1856x512'
  | '1792x512' | '1728x512' | '1664x512' | '1600x512'
  | '1536x512' | '1472x576' | '1408x640' | '1344x704'
  | '1280x768' | '1216x832' | '1152x896' | '1088x960'
  | '1024x1024' | '960x1088' | '896x1152' | '832x1216'
  | '768x1280' | '704x1344' | '640x1408' | '576x1472'
  | '512x1536' | '512x1600' | '512x1664' | '512x1728'
  | '512x1792' | '512x1856' | '512x1920' | '512x1984'
  | '512x2048' | '768x1024' | '720x1280' | '1024x768'
  | '1280x720';

export type Orientation = 'square' | 'landscape' | 'portrait' | 'custom';

/** v3.5 面积档位：1K / 1.5K / 2K */
export type GenerateMaxPixels = 1048576 | 2359296 | 4194304;

export interface GenerationParams {
  /** 提示词 */
  prompt: string;
  /** 模型 ID */
  model: ModelId;
  /** 尺寸字符串 "WxH" 或 "auto"（不传时模型自主决定） */
  size?: SizeV35 | SizeV3;
  /** 种子（v3.5: [0, 2^63-1]；v3.0: [1, 4294967295]） */
  seed?: number;
  /** v3.5 专属：面积档位（未传 size 时生效） */
  generateMaxPixels?: GenerateMaxPixels;
  /**
   * v3.5 专属：输入参考图面积上限（像素数）。
   *
   * 原图面积 ≤ 阈值时原样透传；> 阈值时按比例等比缩放到 ≈ 阈值后再送入模型，
   * 用于控制大图（4K/6K）带来的上下文 token 消耗。不传时官方默认 1048576。
   */
  resizeMaxPixels?: number;
  /**
   * v3.5 专属：外部搜索增强开关。
   * 官方请求体结构固定为 `{ value: boolean }`，默认关闭。
   */
  useSearchTool?: boolean;
  /** 参考图 URL / data URI */
  referenceImages?: string[];
  /** 水印脚注（≤16 utf8 字符） */
  footnote?: string;
  /** 会话 ID（v3.5 多轮编辑时整轮保持一致） */
  session?: string;
  /** v3.0 专属：是否改写 prompt（开启后模型会优化提示词，约多耗 11 秒） */
  revise?: boolean;
  /** v3.5 专属：思维链改写历史（多轮时回灌） */
  assembledHistory?: AssembledMessage[];
}

// ──────────────────────────────────────────────────────────────
//  v3.5 Chat/Messages 协议
// ──────────────────────────────────────────────────────────────

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface UserMessage {
  role: 'user';
  content: ContentBlock[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON 字符串形式的参数 */
    arguments: string;
  };
}

export interface AssistantMessage {
  role: 'assistant';
  content?: ContentBlock[];
  reasoning?: string;
  tool_calls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: ContentBlock[];
}

export type AssembledMessage = AssistantMessage | ToolMessage;

// ──────────────────────────────────────────────────────────────
//  响应
// ──────────────────────────────────────────────────────────────

export interface V35Response {
  id: string;
  object: 'image.chat.completion.chunk';
  created: number;
  model: string;
  round: number;
  choices: Array<{
    index: number;
    delta: {
      type?: 'image';
      image?: {
        url: string;
        width: number;
        height: number;
        source: string;
        tool_call_id: string;
      };
    };
    finish_reason: string | null;
  }>;
  usage?: { total_tokens: number };
  tokenhub_usage?: { total_tokens: number };
  request_id: string;
  assembled_history?: AssembledMessage[];
  error?: ApiError;
}

export interface V3Response {
  id: string;
  created: number;
  data: Array<{
    url: string;
    revised_prompt?: string;
  }>;
  request_id: string;
  tokenhub_usage?: { total_tokens: number };
  error?: ApiError;
}

export interface ApiError {
  type: string;
  code: string;
  message: string;
  request_id?: string;
}

export type GenerationResponse = V35Response | V3Response;

// ──────────────────────────────────────────────────────────────
//  内部统一结构（图库入库用）
// ──────────────────────────────────────────────────────────────

export interface GeneratedImage {
  /** 本地主键：UUIDv4 */
  id: string;
  /** 服务端 request_id（用于排查） */
  requestId: string;
  /** Trace ID（v3.5 的 id 字段） */
  traceId?: string;
  /** 模型 ID */
  model: ModelId;
  /** 提示词原文 */
  prompt: string;
  /** v3.0 改写后的 prompt（如有） */
  revisedPrompt?: string;
  /** 实际尺寸 "WxH" */
  size: string;
  /** 服务端最终图 URL（已 12h 内下载转存，原 URL 仅作记录） */
  remoteUrl: string;
  /** 本地绝对路径（用户自定义保存路径下） */
  localPath: string;
  /** 关联的会话 ID（多轮编辑时） */
  session?: string;
  /** v3.5 多轮历史（下一轮编辑用） */
  assembledHistory?: AssembledMessage[];
  /** 生成种子 */
  seed?: number;
  /** 水印脚注 */
  footnote?: string;
  /** 消耗 token */
  totalTokens?: number;
  /** 生成时间（Unix ms） */
  createdAt: number;
  /** 关联的提示词搜索关键字（自动从 prompt 提取，可空） */
  searchKeywords?: string;
}

// ──────────────────────────────────────────────────────────────
//  图库查询过滤
// ──────────────────────────────────────────────────────────────

export interface GalleryQuery {
  /** 关键词（匹配 prompt 或 revisedPrompt） */
  keyword?: string;
  /** 按模型过滤 */
  model?: ModelId;
  /** 时间范围起点（Unix ms） */
  since?: number;
  /** 时间范围终点（Unix ms） */
  until?: number;
  /** 分页 */
  limit?: number;
  offset?: number;
  /** 排序 */
  orderBy?: 'createdAt' | 'model' | 'size';
  orderDir?: 'asc' | 'desc';
}

// ──────────────────────────────────────────────────────────────
//  插件配置（与 manifest.config 对齐，运行时形态）
// ──────────────────────────────────────────────────────────────

export interface PluginConfig {
  apiKey: string;
  storagePath: string;
  defaultModel: ModelId;
  defaultSize: string;
  defaultOrientation: Orientation;
  footnote: string;
}

// ──────────────────────────────────────────────────────────────
//  Service 暴露给 Slot/Tool 的接口
// ──────────────────────────────────────────────────────────────

export interface IHunyuanService {
  generate(params: GenerationParams, signal?: AbortSignal): Promise<GeneratedImage>;
  /** 列出可用模型 */
  listModels(): Promise<ModelId[]>;
  /** 取配置 */
  getConfig(): PluginConfig;
  /** 更新配置 */
  updateConfig(patch: Partial<PluginConfig>): Promise<PluginConfig>;
}

export interface IGalleryService {
  /** 列出图片（带过滤） */
  list(query: GalleryQuery): Promise<GeneratedImage[]>;
  /** 按 ID 查单张 */
  get(id: string): Promise<GeneratedImage | null>;
  /** 删除（含本地文件） */
  delete(id: string): Promise<void>;
  /** 批量删除 */
  deleteBatch(ids: string[]): Promise<void>;
  /** 取总数（用于 UI 角标） */
  count(): Promise<number>;
  /** 触发关键词监听 */
  onKeywordDetected(handler: (context: { keyword: string; messageId: string }) => void): () => void;
}
