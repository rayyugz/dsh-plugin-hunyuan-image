/**
 * 混元生图 - 生成面板（右侧面板 slot）
 *
 * 这是插件与用户最直接的交互界面：用户在此填写 prompt、选择模型、
 * 上传参考图、调整高级参数，提交后调用 services.hunyuan.generate 获得结果图。
 *
 * 该文件**不接触任何外部资源**（不发网络请求、不读写文件），
 * 全部能力都通过宿主注入的 services 与 bus 取得。
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  GeneratedImage,
  GenerationParams,
  IGalleryService,
  IHunyuanService,
  ModelId,
  PluginConfig,
} from '../types.js';
import {
  parseSize,
  RATIOS_V3,
  RATIOS_V35,
  resolveMaxPixels,
  resolveSize,
  TIERS_V3,
  TIERS_V35,
} from '../size-presets.js';
import type { RatioOption, TierOption } from '../size-presets.js';
// 本地图片回送路由：浏览器不能直接加载文件系统路径，必须转成 HTTP URL
import { localFileUrl } from '../client-services/file-url.js';

// ────────────────────────────────────────────────────────────────────────────
//  Slot props 约定（DSH 注入方式；详见 src/index.ts 与 types.ts）
// ────────────────────────────────────────────────────────────────────────────

export interface GeneratorPanelProps {
  services: { hunyuan: IHunyuanService; gallery: IGalleryService };
  config: PluginConfig;
  onConfigChange: (patch: Partial<PluginConfig>) => Promise<void>;
  /** 宿主事件总线；emit 用于通知宿主打开其他面板，on 用于接收异步回执 */
  bus: BusLike;
  /** 仅 modal 类 slot 才会被传入，右侧面板通常不出现 */
  close?: () => void;
}

/** 宿主事件总线的最小子集，避免 hard-depend 完整的 SDK 类型 */
export interface BusLike {
  emit(event: string, payload?: unknown): void;
  on(event: string, handler: (payload: any) => void): () => void;
}

// ────────────────────────────────────────────────────────────────────────────
//  视觉常量（深色主题，硬性要求：单文件零依赖）
// ────────────────────────────────────────────────────────────────────────────

const COLOR = {
  bg: '#1a1a1a',
  bgRaised: '#232323',
  bgHover: '#2a2a2a',
  border: '#2f2f2f',
  borderStrong: '#3a3a3a',
  fg: '#e0e0e0',
  fgMuted: '#888',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  danger: '#ef4444',
  success: '#22c55e',
} as const;

// ────────────────────────────────────────────────────────────────────────────
//  尺寸：分辨率档位 + 比例
//
//  与官方 TokenHub Web UI 保持一致的两段式选择：
//    Hy-Image-3.5-preview：分辨率 1K / 1.5K / 2K / 4K，比例 21:9 … 9:16
//    Hy-Image-3.0        ：分辨率 720P / 1K，      比例 1:1 … 5:3
//  选项表与 "WxH" 换算全部来自 src/size-presets.ts。
// ────────────────────────────────────────────────────────────────────────────

/** 当前模型支持的分辨率档位表 */
function tiersFor(model: ModelId): readonly TierOption[] {
  return model === 'hy-image-v3.5-preview' ? TIERS_V35 : TIERS_V3;
}

/** 当前模型支持的比例表（顺序与官方 UI 一致） */
function ratiosFor(model: ModelId): readonly RatioOption[] {
  return model === 'hy-image-v3.5-preview' ? RATIOS_V35 : RATIOS_V3;
}

/**
 * 把回填来的 `"WxH"` 还原成两个下拉的值。
 *
 * `parseSize` 对「自动」与无法识别的输入会回落到该模型比例表里的第 4 项
 * （v3.0 是 9:16），面板侧统一规整成官方默认的 `1:1`，
 * 并再兜一层「档位 / 比例必须属于当前模型」的校验。
 */
function parseTierRatio(
  model: ModelId,
  size: string | undefined,
): { tierId: string; ratioId: string } {
  if (!size || size === 'auto') return { tierId: 'auto', ratioId: '1:1' };

  const parsed = parseSize(model, size);
  return {
    tierId: tiersFor(model).some((t) => t.id === parsed.tierId)
      ? parsed.tierId
      : 'auto',
    ratioId: ratiosFor(model).some((r) => r.id === parsed.ratioId)
      ? parsed.ratioId
      : '1:1',
  };
}

/**
 * 模型 id → 胶囊里的短标签。
 * 控制条空间紧张，这里只保留官方 UI 的简短写法（v3.5-preview / v3.0）。
 */
const MODEL_LABEL: Record<ModelId, string> = {
  'hy-image-v3.5-preview': 'v3.5-preview（最新）',
  'hy-image-v3': 'v3.0',
};

/** 数量下拉的三档固定值（与官方一致：1 / 2 / 4 张） */
const COUNT_OPTIONS: readonly number[] = [1, 2, 4];

const ROOT_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: COLOR.bg,
  color: COLOR.fg,
  fontSize: 13,
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
  overflow: 'hidden',
};

const FIELD_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: COLOR.fgMuted,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  margin: '0 0 6px',
};

/**
 * 控制条里每个下拉的「胶囊」样式（对齐官方 TokenHub UI）：
 * 全圆角、细边框、无填充底色，仅靠边框与字号区分层级。
 */
const PILL_SELECT_STYLE: React.CSSProperties = {
  borderRadius: 999,
  border: `1px solid ${COLOR.border}`,
  background: 'transparent',
  color: COLOR.fg,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
  outline: 'none',
  flex: '0 0 auto',
  maxWidth: '100%',
};

/** 控制条里「模型 | 分辨率…」之间的竖线分隔符 */
const PILL_DIVIDER_STYLE: React.CSSProperties = {
  width: 1,
  height: 20,
  background: COLOR.borderStrong,
  flex: '0 0 auto',
};

/** 控制条下方「实际下发尺寸」小字提示 */
const HINT_STYLE: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 11,
  color: COLOR.fgMuted,
};

/**
 * 高级区复选框行：用 `<label>` 包住 input，整行可点。
 * 这样既扩大了点击热区，也天然满足键盘可达性（Tab 聚焦 + 空格切换），
 * 无需额外的 aria-checked 手工同步。
 */
const CHECKBOX_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  cursor: 'pointer',
};

/** 复选框主标签下方的说明小字（设计意图：把「代价 / 适用范围」写在控件旁） */
const CHECKBOX_HINT_STYLE: React.CSSProperties = {
  display: 'block',
  marginTop: 2,
  fontSize: 11,
  color: COLOR.fgMuted,
  lineHeight: 1.4,
};

/** 高级区下拉（与种子 / 脚注输入框同宽的整行控件） */
const ADVANCED_SELECT_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  background: COLOR.bg,
  color: COLOR.fg,
  border: `1px solid ${COLOR.border}`,
  borderRadius: 4,
  fontSize: 13,
  outline: 'none',
  cursor: 'pointer',
};

// ────────────────────────────────────────────────────────────────────────────
//  组件
// ────────────────────────────────────────────────────────────────────────────

/**
 * 生成面板入口。
 *
 * 内部状态划分：
 *   prompt       — 用户提示词
 *   model        — 选中的模型
 *   references   — 参考图 URL 数组
 *   showAdvanced — 高级折叠区是否展开
 *   tierId       — 分辨率档位 id（'auto' / '1k' / '1.5k' / '2k' / '4k' / '720p'）
 *   ratioId      — 比例 id（'1:1' / '16:9' …；档位为「自动」时不生效）
 *   seed         — 种子字符串（0 表示随机；输入框刻意用 string 方便空字符串态）
 *   footnote     — 水印脚注
 *   loading      — 当前是否在生成中（用于禁用主按钮与展示提示）
 *   error        — 最近一次错误的展示文本；null 表示无错误
 *   lastResult   — 最近一次成功的生成结果；null 表示还没有出图
 */
export default function GeneratorPanel(props: GeneratorPanelProps) {
  const { services, config, onConfigChange, bus } = props;

  // ── 表单状态 ─────────────────────────────────────────────
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<ModelId>(config.defaultModel);
  const [references, setReferences] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 尺寸拆成「分辨率档位 + 比例」两段，提交时再换算成 "WxH"。
  // 初值由设置面板的「默认尺寸」反解而来（defaultSize 以 "WxH" 或 'auto' 持久化），
  // 这样设置里的默认值才真正对生成面板生效。惰性初始化，只算一次。
  const [tierId, setTierId] = useState(
    () => parseTierRatio(config.defaultModel, config.defaultSize).tierId,
  );
  const [ratioId, setRatioId] = useState(
    () => parseTierRatio(config.defaultModel, config.defaultSize).ratioId,
  );
  const [seed, setSeed] = useState('0');
  const [footnote, setFootnote] = useState(config.footnote);
  /**
   * 外部搜索增强（仅 v3.5）。
   *
   * 官方默认关闭，因此初值取 false：联网检索会显著拉长耗时，
   * 属于「用户主动要求才付费」的能力，不做默认开启。
   * 面板不持久化该项，每次打开生成面板都回到官方默认，避免用户
   * 在不知情的情况下持续承担额外延迟与费用。
   */
  const [useSearchTool, setUseSearchTool] = useState(false);
  /**
   * 输入参考图面积上限（仅 v3.5）。
   *
   * undefined = 不下发该字段，由服务端按官方默认（1048576）处理；
   * 之所以用 `undefined` 而不是把默认值写死成 1048576，是为了让「默认」
   * 与「显式选 1K」在请求体上保持可区分，将来官方调整默认值时无需改前端。
   */
  const [resizeMaxPixels, setResizeMaxPixels] = useState<number | undefined>(
    undefined,
  );
  /**
   * prompt 自动改写（仅 v3.0）。
   *
   * 官方 FAQ 建议保持开启（模型先优化提示词再出图，代价约多耗 11 秒），
   * 故默认 true；只有在用户自己实现了改写链路时才值得关闭。
   */
  const [revise, setRevise] = useState(true);

  // ── 任务状态 ─────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 最近一次生成的**全部**结果。
   * 支持一次生成多张（count = 1 / 2 / 4），所以用数组而非单值；
   * 数组第 0 项是「主结果」，供「再次生图 / 复制提示词 / 删除本次」使用。
   */
  const [lastResults, setLastResults] = useState<GeneratedImage[]>([]);
  /** 每次提交生成几张（1 / 2 / 4） */
  const [count, setCount] = useState(1);

  // ── 引用 ──────────────────────────────────────────────────
  /** 当前 in-flight 请求的 AbortController，用于组件卸载时取消 */
  const abortRef = useRef<AbortController | null>(null);
  /** 当前待响应的 file:pick 请求 id（见下方 pickReferenceImage） */
  const pendingPickRef = useRef<string | null>(null);

  // ── 副作用：组件卸载时取消进行中的请求 + 注入共享动画 ──
  useEffect(() => {
    injectKeyframesOnce();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ── 副作用：监听 file:picked 一次性回执 ──────────────────
  useEffect(() => {
    const off = bus.on('file:picked', (payload: any) => {
      const replyId = payload?.replyTo;
      if (
        replyId &&
        pendingPickRef.current &&
        pendingPickRef.current === replyId
      ) {
        pendingPickRef.current = null;
        const url: string | undefined = payload?.url;
        if (url) {
          setReferences((prev) => [...prev, url]);
        }
      }
    });
    return off;
  }, [bus]);

  // ── 行为：切换模型（下拉切换，或宿主推送了新的默认模型） ──
  // 档位一律重置为「自动」；比例若不在新模型的比例表里则回落到 1:1。
  const applyModel = useCallback((next: ModelId) => {
    setModel(next);
    setTierId('auto');
    setRatioId((current) =>
      ratiosFor(next).some((r) => r.id === current) ? current : '1:1',
    );
  }, []);

  // ── 副作用：配置随宿主更新 → 同步部分默认值 ──────────────
  useEffect(() => {
    applyModel(config.defaultModel);
  }, [config.defaultModel, applyModel]);
  useEffect(() => {
    setFootnote(config.footnote);
  }, [config.footnote]);

  // ── 副作用：消费「再次生图」从图库传来的 context ──────────
  // 图库面板的"再次生图"按钮会 emit `slot:open { id:'hunyuan-generator', context:{prompt,model,size,seed} }`，
  // 我们这里一次性把表单回填，让用户少敲一遍字；size 字符串用 parseSize 反解成档位 + 比例。
  useEffect(() => {
    const off = bus.on('slot:open', (payload: any) => {
      if (payload?.id !== 'hunyuan-generator') return;
      const ctx = payload?.context;
      if (!ctx || typeof ctx !== 'object') return;
      if (typeof ctx.prompt === 'string' && ctx.prompt.length > 0) setPrompt(ctx.prompt);
      // 回填要按图片自己的模型来反解，因此先算出本次生效的模型
      const nextModel: ModelId =
        ctx.model === 'hy-image-v3.5-preview' || ctx.model === 'hy-image-v3'
          ? (ctx.model as ModelId)
          : model;
      if (nextModel !== model) setModel(nextModel);
      if (typeof ctx.size === 'string') {
        const parsed = parseTierRatio(nextModel, ctx.size);
        setTierId(parsed.tierId);
        setRatioId(parsed.ratioId);
      }
      if (typeof ctx.seed === 'number') setSeed(String(ctx.seed));
    });
    return off;
  }, [bus, model]);

  // ── 计算属性：提交尺寸 / 种子 / 当前选中的参图数 ──────────
  /** 最终下发的 size（"WxH"）；「自动」档为 undefined，表示不传、交给服务端决定 */
  const resolvedSize = useMemo(
    () => resolveSize(model, tierId, ratioId),
    [model, tierId, ratioId],
  );
  /** v3.5 面积档位：仅在没有精确 size 可下发时兜底（v3.0 不支持该参数） */
  const resolvedMaxPixels = useMemo(
    () =>
      resolvedSize === undefined ? resolveMaxPixels(model, tierId) : undefined,
    [model, tierId, resolvedSize],
  );
  /** 分辨率是否处于「自动」档：该档不传 size，比例不生效 */
  const isAutoTier = tierId === 'auto';

  const parsedSeed = useMemo<number | undefined>(() => {
    if (!seed.trim()) return undefined;
    const n = Number(seed);
    if (!Number.isFinite(n) || n < 0) return undefined;
    if (n === 0) return undefined; // 0 在 UI 上等同随机
    return n;
  }, [seed]);

  const canSubmit = prompt.trim().length > 0 && !loading;

  // ──────────────────────────────────────────────────────────
  //  行为：参考图上传（通过宿主 bus 单向 emit，异步回来 URL）
  // ──────────────────────────────────────────────────────────
  const pickReferenceImage = useCallback(() => {
    const replyId = `pick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingPickRef.current = replyId;
    bus.emit('file:pick', { accept: 'image/*', replyTo: replyId });
  }, [bus]);

  const removeReference = useCallback((index: number) => {
    setReferences((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ──────────────────────────────────────────────────────────
  //  行为：比例下拉
  // ──────────────────────────────────────────────────────────
  /**
   * 比例下拉：只写 ratioId。
   *
   * 历史上这里还要同步「方向」segment 的高亮，方向控件删除后该联动一并移除，
   * 比例成为尺寸的唯一样式来源（避免两套控件互相覆盖）。
   */
  const onRatioChange = useCallback((next: string) => {
    setRatioId(next);
  }, []);

  // ──────────────────────────────────────────────────────────
  //  行为：核心 - 调用 generate
  // ──────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;

    const params: GenerationParams = {
      prompt: prompt.trim(),
      model,
      size: resolvedSize as GenerationParams['size'],
      // 「自动」档没有精确尺寸时才下发面积档位（仅 v3.5 支持）
      generateMaxPixels: resolvedMaxPixels,
      seed: parsedSeed,
      footnote: footnote.trim() || undefined,
      referenceImages: references.length > 0 ? references : undefined,
      // 仅 v3.5 生效：外部搜索增强 + 参考图面积上限。
      // 按模型分支传入而不是无条件传，避免把 v3.5 专属字段喂给 v3.0。
      // 其中 resizeMaxPixels 为 undefined（=「默认」档）时由 host 侧跳过，不下发。
      ...(model === 'hy-image-v3.5-preview'
        ? { useSearchTool, resizeMaxPixels }
        : {}),
      // 仅 v3.0 生效：prompt 自动改写
      ...(model === 'hy-image-v3' ? { revise } : {}),
    };

    try {
      // 并行发起 count 次生成；用 allSettled 让「部分成功」也能展示出来。
      const tasks = Array.from({ length: count }, () =>
        services.hunyuan.generate(params, ctrl.signal),
      );
      const settled = await Promise.allSettled(tasks);

      const ok = settled
        .filter(
          (r): r is PromiseFulfilledResult<GeneratedImage> => r.status === 'fulfilled',
        )
        .map((r) => r.value);
      const failures = settled.filter((r) => r.status === 'rejected');

      setLastResults(ok);

      // 全部失败：报第一个错误；部分失败：展示成功的图 + 一条提示
      if (ok.length === 0) {
        const first = failures[0] as PromiseRejectedResult | undefined;
        const reason = first?.reason;
        if (reason?.name !== 'AbortError') {
          setError(
            reason?.message ??
              '生成失败：未知错误。请稍后重试，或在设置中检查 API Key。',
          );
        }
      } else if (failures.length > 0) {
        setError(
          `已生成 ${ok.length} 张，另有 ${failures.length} 张失败（可重试）。`,
        );
      }

      // 同步一次配置脚注（让"水印"改动立即回灌到全局）
      if (footnote.trim() !== config.footnote) {
        try {
          await onConfigChange({ footnote: footnote.trim() });
        } catch {
          /* 配置失败不影响生成结果展示 */
        }
      }
    } catch (err: any) {
      // 用户主动中止不当作错误处理
      if (err?.name !== 'AbortError') {
        setError(
          err?.message ??
            '生成失败：未知错误。请稍后重试，或在设置中检查 API Key。',
        );
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }, [
    canSubmit,
    prompt,
    model,
    resolvedSize,
    resolvedMaxPixels,
    parsedSeed,
    footnote,
    references,
    count,
    // v3.5 / v3.0 高级参数：任一项变化都必须让 submit 闭包更新
    useSearchTool,
    resizeMaxPixels,
    revise,
    services.hunyuan,
    config.footnote,
    onConfigChange,
  ]);

  /**
   * 始终指向最新一次渲染的 submit。
   *
   * 「再次生图」会先回填档位 / 比例再异步提交，而 `setTimeout` 里拿到的
   * 仍是旧闭包；用 layout effect 在重渲染提交后刷新引用，保证提交的是
   * 回填后的参数。
   */
  const submitRef = useRef(submit);
  useLayoutEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  // ──────────────────────────────────────────────────────────
  //  行为：键盘快捷键 - Cmd/Ctrl + Enter 提交
  // ──────────────────────────────────────────────────────────
  const onPromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  // ──────────────────────────────────────────────────────────
  //  行为：结果区操作
  //  说明：多张结果时，这些操作针对**第一张（主结果）**；删除按钮
  //        另有「全部删除」语义由 deleteResult 处理（删全部）。
  // ──────────────────────────────────────────────────────────
  const primaryResult = lastResults[0] ?? null;

  const regenerate = useCallback(async () => {
    if (!primaryResult) return;
    setPrompt(primaryResult.prompt);
    setModel(primaryResult.model);
    // 用图片的实际尺寸反解回「档位 + 比例」，让下拉与真正提交的参数一致
    const parsed = parseTierRatio(primaryResult.model, primaryResult.size);
    setTierId(parsed.tierId);
    setRatioId(parsed.ratioId);
    if (typeof primaryResult.seed === 'number') {
      setSeed(String(primaryResult.seed));
    }
    setTimeout(() => {
      void submitRef.current();
    }, 0);
  }, [primaryResult]);

  const copyResultPrompt = useCallback(async () => {
    if (!primaryResult) return;
    try {
      await navigator.clipboard.writeText(primaryResult.prompt);
    } catch {
      /* 浏览器策略拒写剪贴板时静默 */
    }
  }, [primaryResult]);

  const openInGallery = useCallback(() => {
    bus.emit('slot:open', { id: 'hunyuan-gallery' });
  }, [bus]);

  /** 删除本次生成的**全部**图片 */
  const deleteResult = useCallback(async () => {
    if (lastResults.length === 0) return;
    try {
      await services.gallery.deleteBatch(lastResults.map((r) => r.id));
      setLastResults([]);
    } catch (err: any) {
      setError(err?.message ?? '删除失败，请稍后重试。');
    }
  }, [lastResults, services.gallery]);

  // ──────────────────────────────────────────────────────────
  //  渲染
  // ──────────────────────────────────────────────────────────
  return (
    <div style={ROOT_STYLE} role="region" aria-label="混元生图生成面板">
      {/* ── Header ───────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderBottom: `1px solid ${COLOR.border}`,
          background: COLOR.bgRaised,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            flex: '0 0 auto',
            letterSpacing: 0.3,
          }}
        >
          混元生图
        </h2>

        {/* 模型下拉已下移到提示词下方的控制条，Header 只保留标题与图库入口 */}
        <button
          type="button"
          aria-label="打开图库"
          title="打开图库"
          onClick={openInGallery}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: `1px solid ${COLOR.border}`,
            color: COLOR.fg,
            padding: '4px 8px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          📁 图库
        </button>
      </header>

      {/* ── 滚动主体 ─────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* ── Prompt ─────────────────────────────────────────── */}
        <section aria-label="提示词">
          <p style={FIELD_LABEL_STYLE}>提示词</p>
          <textarea
            aria-label="图片描述提示词"
            placeholder="描述你想生成的图片…（Cmd / Ctrl + Enter 提交）"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onPromptKeyDown}
            rows={6}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 10,
              background: COLOR.bgRaised,
              color: COLOR.fg,
              border: `1px solid ${COLOR.border}`,
              borderRadius: 6,
              fontSize: 13,
              lineHeight: 1.5,
              resize: 'vertical',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />

          {/* ── 控制条：模型 / 分辨率 / 比例 / 数量 / 生成 ─────────
              对齐官方 TokenHub UI：所有控件挤在提示词输入框正下方的一行胶囊里，
              顺序固定为「模型 → 分辨率 → 比例 → 数量」，最右侧是提交按钮。
              面板可能很窄，因此允许换行（gap 不变，视觉上仍是一整条）。 */}
          <div
            role="group"
            aria-label="生成参数"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginTop: 8,
            }}
          >
            {/* 1) 模型 */}
            <select
              aria-label="模型"
              title="模型"
              value={model}
              onChange={(e) => applyModel(e.target.value as ModelId)}
              style={PILL_SELECT_STYLE}
            >
              <option value="hy-image-v3.5-preview">
                {MODEL_LABEL['hy-image-v3.5-preview']}
              </option>
              <option value="hy-image-v3">{MODEL_LABEL['hy-image-v3']}</option>
            </select>

            {/* 竖线分隔符：把「模型」与后面的尺寸类控件分开（对齐官方视觉） */}
            <span aria-hidden style={PILL_DIVIDER_STYLE} />

            {/* 2) 分辨率档位（选项随模型变化） */}
            <select
              aria-label="分辨率"
              title="分辨率"
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              style={PILL_SELECT_STYLE}
            >
              {tiersFor(model).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            {/* 3) 比例：档位为「自动」时尺寸由模型决定，此下拉禁用 */}
            <select
              aria-label="比例"
              title={
                isAutoTier ? '分辨率选「自动」时由模型决定尺寸' : '比例'
              }
              value={ratioId}
              disabled={isAutoTier}
              onChange={(e) => onRatioChange(e.target.value)}
              style={{
                ...PILL_SELECT_STYLE,
                color: isAutoTier ? COLOR.fgMuted : COLOR.fg,
                cursor: isAutoTier ? 'not-allowed' : 'pointer',
              }}
            >
              {ratiosFor(model).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>

            {/* 4) 数量：固定三档 1 / 2 / 4 张 */}
            <select
              aria-label="生成数量"
              title="生成数量"
              value={count}
              disabled={loading}
              onChange={(e) => setCount(Number(e.target.value))}
              style={{
                ...PILL_SELECT_STYLE,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} 张
                </option>
              ))}
            </select>

            {/* 5) 生成按钮：marginLeft:auto 把它顶到本行最右侧 */}
            <button
              type="button"
              aria-label={loading ? '正在生成图片' : '生成图片'}
              disabled={!canSubmit}
              onClick={() => void submit()}
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                flex: '0 0 auto',
                padding: '6px 18px',
                borderRadius: 999,
                border: 'none',
                background: canSubmit ? COLOR.accent : COLOR.bgHover,
                color: canSubmit ? '#fff' : COLOR.fgMuted,
                fontSize: 13,
                fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {loading ? (
                <>
                  <Spinner />
                  {count > 1
                    ? `生成中（${count} 张，约 10-60 秒）`
                    : '生成中（约 10-30 秒）'}
                </>
              ) : (
                <>{count > 1 ? `🎨 生成 ${count} 张` : '🎨 生成'}</>
              )}
            </button>
          </div>

          {/* 控制条下方的尺寸回显（「自动」档不传 size，由模型决定） */}
          <p style={HINT_STYLE}>
            {resolvedSize
              ? `实际下发尺寸：${resolvedSize}`
              : '不指定尺寸，由模型自行决定'}
          </p>
        </section>

        {/* ── 参考图区 ───────────────────────────────────────── */}
        <section aria-label="参考图">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <p style={{ ...FIELD_LABEL_STYLE, margin: 0 }}>
              参考图（可选，{references.length}/8）
            </p>
            <button
              type="button"
              aria-label="添加参考图"
              disabled={references.length >= 8}
              onClick={pickReferenceImage}
              style={{
                background: COLOR.bgRaised,
                border: `1px dashed ${COLOR.borderStrong}`,
                color: references.length >= 8 ? COLOR.fgMuted : COLOR.fg,
                padding: '4px 10px',
                borderRadius: 4,
                cursor: references.length >= 8 ? 'not-allowed' : 'pointer',
                fontSize: 12,
              }}
            >
              + 添加参考图
            </button>
          </div>

          {references.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                overflowX: 'auto',
                paddingBottom: 4,
              }}
            >
              {references.map((url, idx) => (
                <div
                  key={`${url}-${idx}`}
                  style={{ position: 'relative', flex: '0 0 auto' }}
                >
                  <img
                    src={url}
                    alt={`参考图 ${idx + 1}`}
                    style={{
                      width: 72,
                      height: 72,
                      objectFit: 'cover',
                      borderRadius: 6,
                      border: `1px solid ${COLOR.border}`,
                      display: 'block',
                      background: COLOR.bgHover,
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`删除参考图 ${idx + 1}`}
                    onClick={() => removeReference(idx)}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: COLOR.danger,
                      color: '#fff',
                      border: '2px solid #1a1a1a',
                      cursor: 'pointer',
                      fontSize: 11,
                      lineHeight: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 高级选项 ───────────────────────────────────────── */}
        <section aria-label="高级选项">
          <button
            type="button"
            aria-expanded={showAdvanced}
            aria-controls="advanced-panel"
            onClick={() => setShowAdvanced((s) => !s)}
            style={{
              background: 'transparent',
              border: 'none',
              color: COLOR.fg,
              fontSize: 13,
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: 600,
            }}
          >
            <span>⚙️ 高级</span>
            <span style={{ color: COLOR.fgMuted, fontSize: 11 }}>
              {showAdvanced ? '收起' : '展开'}
            </span>
          </button>

          {showAdvanced && (
            <div
              id="advanced-panel"
              style={{
                marginTop: 10,
                padding: 12,
                background: COLOR.bgRaised,
                border: `1px solid ${COLOR.border}`,
                borderRadius: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* 原「方向」radiogroup 已删除：它与控制条上的「比例」下拉功能重复，
                  两套控件还会互相覆盖，现由「比例」作为尺寸的唯一样式来源。 */}

              {/* 种子 */}
              <div>
                <p style={FIELD_LABEL_STYLE}>种子（0 = 随机）</p>
                <input
                  type="number"
                  min={0}
                  aria-label="生成种子"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 8px',
                    background: COLOR.bg,
                    color: COLOR.fg,
                    border: `1px solid ${COLOR.border}`,
                    borderRadius: 4,
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              </div>

              {/* 水印 */}
              <div>
                <p style={FIELD_LABEL_STYLE}>
                  水印脚注{' '}
                  <span style={{ color: COLOR.fgMuted, fontWeight: 400 }}>
                    {footnote.length}/16
                  </span>
                </p>
                <input
                  type="text"
                  maxLength={16}
                  aria-label="水印脚注"
                  placeholder="≤16 字符，留空不添加"
                  value={footnote}
                  onChange={(e) => setFootnote(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 8px',
                    background: COLOR.bg,
                    color: COLOR.fg,
                    border: `1px solid ${COLOR.border}`,
                    borderRadius: 4,
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              </div>

              {/* ── 外部搜索增强（仅 v3.5）────────────────────────────
                  刻意「条件渲染」而不是 disable：v3.0 请求体里根本没有这个字段，
                  给用户看一个永远点不动的开关只会造成误解（以为是自己用错了）。 */}
              {model === 'hy-image-v3.5-preview' && (
                <div>
                  <label style={CHECKBOX_ROW_STYLE}>
                    <input
                      type="checkbox"
                      aria-label="外部搜索增强"
                      checked={useSearchTool}
                      onChange={(e) => setUseSearchTool(e.target.checked)}
                      style={{
                        marginTop: 2,
                        accentColor: COLOR.accent,
                        cursor: 'pointer',
                      }}
                    />
                    <span>
                      <span style={{ fontWeight: 600 }}>外部搜索增强</span>
                      <span style={CHECKBOX_HINT_STYLE}>
                        让模型联网检索后再生图（仅 v3.5-preview）
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {/* ── 参考图面积上限（仅 v3.5）──────────────────────────
                  选项值即「像素面积阈值」；第一档刻意留空字符串映射到 undefined，
                  表示不下发 resize_max_pixels、沿用官方默认，而不是把 1048576 写死。 */}
              {model === 'hy-image-v3.5-preview' && (
                <div>
                  <p style={FIELD_LABEL_STYLE}>参考图面积上限</p>
                  <select
                    aria-label="参考图面积上限"
                    title="参考图面积上限"
                    value={
                      resizeMaxPixels === undefined
                        ? ''
                        : String(resizeMaxPixels)
                    }
                    onChange={(e) =>
                      setResizeMaxPixels(
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value),
                      )
                    }
                    style={ADVANCED_SELECT_STYLE}
                  >
                    <option value="">默认（1024×1024）</option>
                    <option value="1048576">1K（1024×1024）</option>
                    <option value="4194304">2K（2048×2048）</option>
                    <option value="16777216">4K（4096×4096）</option>
                  </select>
                  <p style={CHECKBOX_HINT_STYLE}>
                    超过阈值的参考图会等比缩小后再送入，用于控制 token 消耗
                  </p>
                </div>
              )}

              {/* ── prompt 自动改写（仅 v3.0）────────────────────────
                  默认开启（官方建议）；同理条件渲染，v3.5 不接受 revise 字段。 */}
              {model === 'hy-image-v3' && (
                <div>
                  <label style={CHECKBOX_ROW_STYLE}>
                    <input
                      type="checkbox"
                      aria-label="自动改写提示词"
                      checked={revise}
                      onChange={(e) => setRevise(e.target.checked)}
                      style={{
                        marginTop: 2,
                        accentColor: COLOR.accent,
                        cursor: 'pointer',
                      }}
                    />
                    <span>
                      <span style={{ fontWeight: 600 }}>自动改写提示词</span>
                      <span style={CHECKBOX_HINT_STYLE}>
                        模型会先优化提示词再出图，约多耗 11 秒，建议开启
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── 错误条 ─────────────────────────────────────────── */}
        {error && (
          <div
            role="alert"
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: `1px solid ${COLOR.danger}`,
              borderRadius: 6,
              color: '#fca5a5',
              fontSize: 12,
            }}
          >
            <span style={{ flex: 1 }}>⚠ {error}</span>
            <button
              type="button"
              aria-label="重试生成"
              onClick={() => void submit()}
              style={{
                background: COLOR.danger,
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              重试
            </button>
          </div>
        )}

        {/* ── 结果区：多张时逐张展示，让你一眼看到本次全部产出 ── */}
        {lastResults.length > 0 && (
          <div
            role="group"
            aria-label={`生成结果（${lastResults.length} 张）`}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {lastResults.length > 1 && (
              <div
                style={{
                  fontSize: 12,
                  color: COLOR.fgMuted,
                }}
              >
                本次生成 {lastResults.length} 张
              </div>
            )}
            {lastResults.map((img, idx) => (
              <ResultCard
                key={img.id}
                image={img}
                index={idx + 1}
                total={lastResults.length}
                onRegenerate={() => void regenerate()}
                onCopyPrompt={() => void copyResultPrompt()}
                onOpenGallery={openInGallery}
                onDelete={() => void deleteResult()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  结果卡（hover 浮层）
// ────────────────────────────────────────────────────────────────────────────

interface ResultCardProps {
  image: GeneratedImage;
  /** 在本批结果中的序号（从 1 开始），多张时用于标注 */
  index?: number;
  /** 本批结果总数，>1 时展示序号角标 */
  total?: number;
  onRegenerate: () => void;
  onCopyPrompt: () => void;
  onOpenGallery: () => void;
  onDelete: () => void;
}

function ResultCard(props: ResultCardProps) {
  const { image, index, total, onRegenerate, onCopyPrompt, onOpenGallery, onDelete } = props;
  const [hover, setHover] = useState(false);

  // 优先用本地回送路由（浏览器不能直接加载文件系统路径）；
  // 本地路径缺失时回退到远程签名 URL（12 小时内有效）。
  const src = localFileUrl(image.localPath) ?? image.remoteUrl;

  return (
    <section
      aria-label={
        total !== undefined && total > 1
          ? `生成结果 第 ${index ?? ''} / ${total} 张`
          : '生成结果'
      }
      style={{
        position: 'relative',
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${COLOR.border}`,
        background: COLOR.bgRaised,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* 多张时左上角序号角标 */}
      {total !== undefined && total > 1 && index !== undefined && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 2,
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            background: 'rgba(0,0,0,0.62)',
            border: `1px solid ${COLOR.borderStrong}`,
          }}
        >
          {index} / {total}
        </span>
      )}
      <img
        src={src}
        alt={image.prompt.slice(0, 60)}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          background: '#000',
        }}
      />

      {/* hover 浮层 */}
      {hover && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          <OverlayBtn label="再次生图" emoji="🔁" onClick={onRegenerate} />
          <OverlayBtn
            label="复制提示词"
            emoji="📋"
            onClick={onCopyPrompt}
          />
          <OverlayBtn
            label="在图库查看"
            emoji="📁"
            onClick={onOpenGallery}
          />
          <OverlayBtn label="删除本次" emoji="🗑" onClick={onDelete} />
        </div>
      )}

      <div
        style={{
          padding: '8px 10px',
          fontSize: 11,
          color: COLOR.fgMuted,
          borderTop: `1px solid ${COLOR.border}`,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span>{image.model}</span>
        <span>·</span>
        <span>{image.size}</span>
        {typeof image.seed === 'number' && image.seed !== 0 && (
          <>
            <span>·</span>
            <span>seed {image.seed}</span>
          </>
        )}
      </div>
    </section>
  );
}

function OverlayBtn(props: {
  label: string;
  emoji: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: 'rgba(255,255,255,0.95)',
        color: '#111',
        border: 'none',
        cursor: 'pointer',
        fontSize: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span aria-hidden>{props.emoji}</span>
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        border: '2px solid rgba(255,255,255,0.4)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'hunyuan-spin 0.8s linear infinite',
        display: 'inline-block',
      }}
    />
  );
}

// 注入 keyframes（生成面板与图库/设置面板共用）
let KEYFRAMES_INJECTED = false;
export function injectKeyframesOnce(): void {
  if (KEYFRAMES_INJECTED) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById('hunyuan-keyframes')) {
    KEYFRAMES_INJECTED = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'hunyuan-keyframes';
  style.textContent = `
    @keyframes hunyuan-spin { to { transform: rotate(360deg); } }
    @keyframes hunyuan-fade-in { from { opacity: 0; } to { opacity: 1; } }
  `;
  document.head.appendChild(style);
  KEYFRAMES_INJECTED = true;
}
