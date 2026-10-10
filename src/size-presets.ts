/**
 * 尺寸档位与比例 → 实际 `size` 的换算。
 *
 * 官方 TokenHub Web UI 的尺寸选择是「**分辨率档位 + 比例**」两段式，
 * 而不是让用户填 `宽x高`：
 *
 *   Hy-Image-3.5-preview（图二）：
 *     分辨率：1K / 1.5K / 2K / 4K
 *     比例　：21:9 / 16:9 / 4:3 / 1:1 / 2:3 / 3:2 / 3:4 / 9:16
 *
 *   Hy-Image-3.0（图三）：
 *     分辨率：720P / 1K
 *     比例　：1:1 / 3:4 / 4:3 / 9:16 / 16:9 / 3:5 / 5:3
 *
 * 本模块把这套 UI 语言换算成 API 需要的 `size: "WxH"`（或 v3.5 的
 * `generate_max_pixels` 面积档位）。
 *
 * 约束（来自腾讯官方文档）：
 *   v3.5：宽高 ∈ [256, 8192]，面积 ≤ 16,777,216
 *   v3.0：宽高 ∈ [512, 2048]，面积 ≤ 1,048,576（1024×1024）
 */

import type { GenerateMaxPixels, ModelId } from './types.js';

// ──────────────────────────────────────────────────────────────
//  比例定义
// ──────────────────────────────────────────────────────────────

export interface RatioOption {
  /** 用于展示与持久化的稳定标识，如 '16:9' */
  id: string;
  label: string;
  /** 宽 / 高 */
  value: number;
}

function ratio(id: string, w: number, h: number): RatioOption {
  return { id, label: id, value: w / h };
}

/** v3.5 支持的比例（顺序与官方 UI 一致） */
export const RATIOS_V35: readonly RatioOption[] = [
  ratio('21:9', 21, 9),
  ratio('16:9', 16, 9),
  ratio('4:3', 4, 3),
  ratio('1:1', 1, 1),
  ratio('2:3', 2, 3),
  ratio('3:2', 3, 2),
  ratio('3:4', 3, 4),
  ratio('9:16', 9, 16),
];

/** v3.0 支持的比例（顺序与官方 UI 一致） */
export const RATIOS_V3: readonly RatioOption[] = [
  ratio('1:1', 1, 1),
  ratio('3:4', 3, 4),
  ratio('4:3', 4, 3),
  ratio('9:16', 9, 16),
  ratio('16:9', 16, 9),
  ratio('3:5', 3, 5),
  ratio('5:3', 5, 3),
];

// ──────────────────────────────────────────────────────────────
//  分辨率档位
// ──────────────────────────────────────────────────────────────

export interface TierOption {
  id: string;
  label: string;
  /** 目标面积（像素数）；'auto' 档为 undefined，交给服务端决定 */
  area?: number;
  /** v3.5 的 generate_max_pixels 枚举值（仅 1K/1.5K/2K 有） */
  maxPixels?: GenerateMaxPixels;
}

/** v3.5 档位：1K / 1.5K / 2K / 4K（4K 只能通过 size 精确指定） */
export const TIERS_V35: readonly TierOption[] = [
  { id: 'auto', label: '自动（由模型决定）' },
  { id: '1k', label: '1K', area: 1048576, maxPixels: 1048576 },
  { id: '1.5k', label: '1.5K', area: 2359296, maxPixels: 2359296 },
  { id: '2k', label: '2K', area: 4194304, maxPixels: 4194304 },
  { id: '4k', label: '4K', area: 16777216 },
];

/** v3.0 档位：720P / 1K（受 v3.0 的面积上限 1024×1024 约束） */
export const TIERS_V3: readonly TierOption[] = [
  { id: 'auto', label: '自动（从预设中挑选）' },
  { id: '720p', label: '720P', area: 921600 },
  { id: '1k', label: '1K', area: 1048576 },
];

// ──────────────────────────────────────────────────────────────
//  换算
// ──────────────────────────────────────────────────────────────

/**
 * 由「目标面积 + 比例」求宽高。
 *
 * 算法（保证落在官方约束内，且尽量贴近理论最优值）：
 *   1. W = √(目标面积 × 比例)，H = W ÷ 比例            —— 理论浮点值
 *   2. 把 W、H 夹到 [min, max]
 *   3. 四舍五入取整
 *   4. 若取整/夹取后面积仍超上限，用**精确等比因子** k = √(上限 ÷ 当前面积)
 *      一次性回缩（保持比例），而不是反复乘 0.98 —— 后者会把 4K 尺寸过度缩小，
 *      例如 16:9 的 4K 本应得到官方文档举例的 `5461x3072`。
 *   5. 极端情况下（min 下限导致无法再缩）做逐像素兜底，并设循环上限防御。
 */
export function sizeFromAreaAndRatio(
  area: number,
  ratioValue: number,
  bounds: { min: number; max: number; maxArea: number },
): { width: number; height: number } {
  const { min, max, maxArea } = bounds;

  // 目标面积本身不能超过硬上限
  const target = Math.min(area, maxArea);

  // 1) 理论宽高
  let width = Math.sqrt(target * ratioValue);
  let height = width / ratioValue;

  // 2) 夹到边长范围（保持浮点，先不取整）
  width = Math.min(max, Math.max(min, width));
  height = Math.min(max, Math.max(min, height));

  // 3) 取整
  width = Math.round(width);
  height = Math.round(height);

  // 4) 精确等比回缩（最多两轮：一轮处理取整误差，一轮处理夹取后的再超限）
  for (let i = 0; i < 2 && width * height > maxArea; i += 1) {
    const k = Math.sqrt(maxArea / (width * height));
    width = Math.max(min, Math.floor(width * k));
    height = Math.max(min, Math.floor(height * k));
  }

  // 5) 兜底：若 min 下限导致仍超限，逐像素削减较长边
  let guard = 0;
  while (width * height > maxArea && guard < 100_000) {
    if (width >= height) {
      if (width <= min) break;
      width -= 1;
    } else {
      if (height <= min) break;
      height -= 1;
    }
    guard += 1;
  }

  return { width, height };
}

/** Hy-Image-3.5-preview 的约束 */
const BOUNDS_V35 = { min: 256, max: 8192, maxArea: 16777216 } as const;
/** Hy-Image-3.0 的约束 */
const BOUNDS_V3 = { min: 512, max: 2048, maxArea: 1048576 } as const;

/**
 * 计算最终要传给 API 的 `size` 字符串。
 *
 * @returns `"WxH"`，或 `undefined` 表示不传 size（交给服务端按
 *          `generate_max_pixels` / prompt 语义决定）
 */
export function resolveSize(
  model: ModelId,
  tierId: string,
  ratioId: string,
): string | undefined {
  const isV35 = model === 'hy-image-v3.5-preview';
  const tiers = isV35 ? TIERS_V35 : TIERS_V3;
  const ratios = isV35 ? RATIOS_V35 : RATIOS_V3;
  const bounds = isV35 ? BOUNDS_V35 : BOUNDS_V3;

  const tier = tiers.find((t) => t.id === tierId);
  const ratioOpt = ratios.find((r) => r.id === ratioId);

  // 自动档：不传 size，让服务端决定
  if (!tier || tier.area === undefined || !ratioOpt) return undefined;

  const { width, height } = sizeFromAreaAndRatio(tier.area, ratioOpt.value, bounds);
  return `${width}x${height}`;
}

/**
 * 取该「档位」对应的 `generate_max_pixels` 枚举（仅 v3.5 且未传 size 时生效）。
 * 官方文档：该参数最高只到 2K；要更高分辨率必须走 `size`。
 */
export function resolveMaxPixels(model: ModelId, tierId: string): GenerateMaxPixels | undefined {
  if (model !== 'hy-image-v3.5-preview') return undefined;
  return TIERS_V35.find((t) => t.id === tierId)?.maxPixels;
}

/**
 * 把 `"WxH"` 反解成最接近的「档位 + 比例」，用于图库「再次生图」回填 UI。
 * 解析失败时回落到自动档。
 */
export function parseSize(model: ModelId, size: string | undefined): { tierId: string; ratioId: string } {
  const isV35 = model === 'hy-image-v3.5-preview';
  const ratios = isV35 ? RATIOS_V35 : RATIOS_V3;
  const fallback = { tierId: 'auto', ratioId: ratios[3]?.id ?? ratios[0]!.id };

  if (!size || size === 'auto') return fallback;
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return fallback;

  const w = Number.parseInt(m[1]!, 10);
  const h = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return fallback;

  const actualRatio = w / h;
  const area = w * h;

  // 1) 找最接近的比例（按比例值的对数距离，避免大比例主导）
  let bestRatio = ratios[0]!;
  let bestRatioDist = Number.POSITIVE_INFINITY;
  for (const r of ratios) {
    const dist = Math.abs(Math.log(actualRatio) - Math.log(r.value));
    if (dist < bestRatioDist) {
      bestRatioDist = dist;
      bestRatio = r;
    }
  }

  // 2) 找最接近的档位（按面积比例）
  const tiers = isV35 ? TIERS_V35 : TIERS_V3;
  let bestTierId = 'auto';
  let bestTierDist = Number.POSITIVE_INFINITY;
  for (const t of tiers) {
    if (t.area === undefined) continue;
    const dist = Math.abs(Math.log(area) - Math.log(t.area));
    if (dist < bestTierDist) {
      bestTierDist = dist;
      bestTierId = t.id;
    }
  }

  return { tierId: bestTierId, ratioId: bestRatio.id };
}
