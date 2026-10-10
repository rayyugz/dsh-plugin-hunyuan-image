/**
 * 混元生图 - 设置面板（modal slot）
 *
 * 负责插件的全部配置项：API Key、保存路径、默认值、水印；
 * 顶部还展示本地存储统计（图片数 + 估算占用体积）。
 *
 * 行为约定：
 *   - 所有字段采用 "draft → save" 模型，未点保存不会落盘
 *   - 顶部「测试连接」实时校验 API Key 有效性
 *   - 底部 toast 在保存成功后弹出 2 秒，自动消失
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  IGalleryService,
  IHunyuanService,
  ModelId,
  PluginConfig,
} from '../types.js';
import {
  parseSize,
  RATIOS_V3,
  RATIOS_V35,
  resolveSize,
  TIERS_V3,
  TIERS_V35,
} from '../size-presets.js';
import type { RatioOption, TierOption } from '../size-presets.js';
import type { BusLike } from './generator-panel.js';
import { injectKeyframesOnce } from './generator-panel.js';

// ────────────────────────────────────────────────────────────────────────────
//  Slot props
// ────────────────────────────────────────────────────────────────────────────

export interface SettingsPanelProps {
  services: { hunyuan: IHunyuanService; gallery: IGalleryService };
  config: PluginConfig;
  onConfigChange: (patch: Partial<PluginConfig>) => Promise<void>;
  bus: BusLike;
  close?: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
//  常量
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

const DEFAULT_STORAGE_PATH = '~/Pictures/DSH-Hunyuan-Image';

const MODEL_OPTIONS: Array<{ value: ModelId; label: string }> = [
  { value: 'hy-image-v3.5-preview', label: 'v3.5-preview（推荐）' },
  { value: 'hy-image-v3', label: 'v3.0（稳定）' },
];

// ────────────────────────────────────────────────────────────────────────────
//  默认尺寸：分辨率档位 + 比例
//
//  PluginConfig 只有 `defaultSize: string` 一个字段（不改 types.ts），
//  因此这里用 "WxH" 字符串做持久化：两个下拉 → resolveSize → "WxH"；
//  「自动」档直接存字符串 'auto'。读取时反向用 parseSize 还原。
//  选项表与换算是 src/size-presets.ts 的唯一事实来源。
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
 * 把持久化的 `defaultSize` 还原成两个下拉的值。
 *
 * `parseSize` 对「自动」与无法识别的输入会回落到该模型比例表里的第 4 项
 * （v3.0 是 9:16），这里统一规整成官方默认的 `1:1`，
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

/** 把两个下拉的值合成为持久化字符串；「自动」档存 'auto' */
function combineSize(model: ModelId, tierId: string, ratioId: string): string {
  return resolveSize(model, tierId, ratioId) ?? 'auto';
}

/** 「默认分辨率 / 默认比例」两个子标签的样式 */
const SUB_LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 11,
  color: COLOR.fgMuted,
};

// 注：「默认方向」控件已移除 —— 它与「默认比例」语义重复
// （方形↔1:1、横屏↔16:9、竖屏↔9:16），用户可直接用比例表达方向。
// PluginConfig.defaultOrientation 字段保留以兼容已有配置文件，但不再出现在 UI。

// ────────────────────────────────────────────────────────────────────────────
//  工具
// ────────────────────────────────────────────────────────────────────────────

/** bytes → 人类可读 */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ────────────────────────────────────────────────────────────────────────────
//  根组件
// ────────────────────────────────────────────────────────────────────────────

export default function SettingsPanel(props: SettingsPanelProps) {
  const { services, config, onConfigChange, bus, close } = props;

  // ── 草稿状态（用户编辑但未保存的值） ──────────────────────
  const [draft, setDraft] = useState<PluginConfig>(config);
  // 跟踪用户是否做过改动
  const dirty = useMemo(() => isDifferent(config, draft), [config, draft]);

  // ── 视图状态 ─────────────────────────────────────────────
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>(
    'idle',
  );
  const [testMessage, setTestMessage] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsState>({
    count: null,
    totalBytes: null,
    loading: true,
    error: null,
  });

  // ── refs ──────────────────────────────────────────────────
  const lastKeyTest = useRef<string>('');

  // ── 派生：默认尺寸（defaultSize 字符串 ↔ 「分辨率 + 比例」两个下拉） ──
  /** 由 draft.defaultSize 反解出的两个下拉值；切换模型后会自动按新模型适配 */
  const sizeSel = useMemo(
    () => parseTierRatio(draft.defaultModel, draft.defaultSize),
    [draft.defaultModel, draft.defaultSize],
  );
  const tierOptions = useMemo(
    () =>
      tiersFor(draft.defaultModel).map((t) => ({
        value: t.id,
        label: t.label,
      })),
    [draft.defaultModel],
  );
  const ratioOptions = useMemo(
    () =>
      ratiosFor(draft.defaultModel).map((r) => ({
        value: r.id,
        label: r.label,
      })),
    [draft.defaultModel],
  );
  /** 默认分辨率是否处于「自动」档：该档不存比例，比例下拉不生效 */
  const isAutoTier = sizeSel.tierId === 'auto';

  // ── 副作用：注入共享 keyframes ────────────────────────────
  useEffect(() => {
    injectKeyframesOnce();
  }, []);

  // ── 副作用：弹窗打开时拉取存储统计 ────────────────────────
  const refreshStats = useCallback(async () => {
    setStats((s) => ({ ...s, loading: true, error: null }));
    try {
      const count = await services.gallery.count();
      // 取全量以统计体积——分批拉 pageSize=200
      const PAGE = 200;
      let totalBytes = 0;
      let offset = 0;
      let collected = 0;
      while (collected < count) {
        const rows = await services.gallery.list({
          limit: PAGE,
          offset,
          orderBy: 'createdAt',
          orderDir: 'desc',
        });
        if (rows.length === 0) break;
        collected += rows.length;
        const paths = rows.map((r) => r.localPath).filter(Boolean);
        const sizes = await statPaths(paths, bus);
        for (const p of paths) {
          totalBytes += sizes[p] ?? 0;
        }
        offset += rows.length;
        if (rows.length < PAGE) break;
      }
      setStats({
        count,
        totalBytes,
        loading: false,
        error: null,
      });
    } catch (err: any) {
      setStats({
        count: null,
        totalBytes: null,
        loading: false,
        error: err?.message ?? '统计失败',
      });
    }
  }, [services.gallery, bus]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  // ── 草稿覆盖：当 config 来自宿主更新时，重新同步到 draft ──
  useEffect(() => {
    setDraft(config);
  }, [config]);

  // ──────────────────────────────────────────────────────────
  //  行为：测试连接
  // ──────────────────────────────────────────────────────────
  const runTest = useCallback(async () => {
    setTestState('testing');
    setTestMessage('连接中…');
    try {
      // 把将要测试的 key 暂时塞进 draft 并持久化（前提：用户已经在 draft 上）
      // 为避免污染持久配置，我们直接拿 draft.apiKey 临时更新一下配置后再调用：
      const prev = config.apiKey;
      try {
        if (draft.apiKey !== prev) {
          await onConfigChange({ apiKey: draft.apiKey });
        }
        const models = await services.hunyuan.listModels();
        if (Array.isArray(models) && models.length > 0) {
          setTestState('ok');
          setTestMessage(`连接成功 · 当前可用 ${models.length} 个模型`);
          lastKeyTest.current = draft.apiKey;
        } else {
          setTestState('fail');
          setTestMessage('连接成功但未返回模型（请稍后再试）');
        }
        // 恢复原 key（避免测试误改盘上配置）
        if (draft.apiKey !== prev) {
          await onConfigChange({ apiKey: prev });
        }
      } catch (inner: any) {
        // 异常时也回滚
        if (draft.apiKey !== prev) {
          try {
            await onConfigChange({ apiKey: prev });
          } catch {
            /* 静默 */
          }
        }
        throw inner;
      }
    } catch (err: any) {
      setTestState('fail');
      setTestMessage(err?.message ?? '连接失败，请检查 API Key');
    }
  }, [config.apiKey, draft.apiKey, services.hunyuan, onConfigChange]);

  // ──────────────────────────────────────────────────────────
  //  行为：选择文件夹
  // ──────────────────────────────────────────────────────────
  const pickFolder = useCallback(async () => {
    const replyId = `folder-pick-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const off = bus.on('folder:picked', (payload: any) => {
      if (payload?.replyTo !== replyId) return;
      off();
      const p: string | undefined = payload?.path;
      if (p) setDraft((d) => ({ ...d, storagePath: p }));
    });
    bus.emit('folder:pick', { replyTo: replyId });
  }, [bus]);

  const restoreDefaultPath = useCallback(() => {
    setDraft((d) => ({ ...d, storagePath: DEFAULT_STORAGE_PATH }));
  }, []);

  // ──────────────────────────────────────────────────────────
  //  行为：默认尺寸（分辨率 + 比例）
  //
  //  两个下拉都不单独存 state，而是每次从 draft.defaultSize 反解，
  //  改动时立刻用 resolveSize 合成 "WxH" 写回 defaultSize：
  //  这样「取消」「宿主刷新配置」都只需还原 draft 即可，不会出现脏值。
  // ──────────────────────────────────────────────────────────
  const onDefaultTierChange = useCallback((nextTierId: string) => {
    setDraft((d) => {
      const cur = parseTierRatio(d.defaultModel, d.defaultSize);
      return {
        ...d,
        defaultSize: combineSize(d.defaultModel, nextTierId, cur.ratioId),
      };
    });
  }, []);

  const onDefaultRatioChange = useCallback((nextRatioId: string) => {
    setDraft((d) => {
      const cur = parseTierRatio(d.defaultModel, d.defaultSize);
      return {
        ...d,
        defaultSize: combineSize(d.defaultModel, cur.tierId, nextRatioId),
      };
    });
  }, []);

  /** 切换默认模型：先按旧模型解析出当前档位，再按新模型的支持表适配 */
  const onDefaultModelChange = useCallback((next: ModelId) => {
    setDraft((d) => {
      // 能保留的档位 / 比例原样保留，不能保留的回落 auto + 1:1
      const cur = parseTierRatio(d.defaultModel, d.defaultSize);
      const tierId = tiersFor(next).some((t) => t.id === cur.tierId)
        ? cur.tierId
        : 'auto';
      const ratioId = ratiosFor(next).some((r) => r.id === cur.ratioId)
        ? cur.ratioId
        : '1:1';
      return {
        ...d,
        defaultModel: next,
        defaultSize: combineSize(next, tierId, ratioId),
      };
    });
  }, []);

  // ──────────────────────────────────────────────────────────
  //  行为：保存 / 取消
  // ──────────────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const patch: Partial<PluginConfig> = {};
      if (draft.apiKey !== config.apiKey) patch.apiKey = draft.apiKey;
      if (draft.storagePath !== config.storagePath)
        patch.storagePath = draft.storagePath;
      if (draft.defaultModel !== config.defaultModel)
        patch.defaultModel = draft.defaultModel;
      if (draft.defaultSize !== config.defaultSize)
        patch.defaultSize = draft.defaultSize;
      if (draft.defaultOrientation !== config.defaultOrientation)
        patch.defaultOrientation = draft.defaultOrientation;
      if (draft.footnote !== config.footnote)
        patch.footnote = draft.footnote;

      if (Object.keys(patch).length > 0) {
        await onConfigChange(patch);
        // 路径变化则刷一下统计（文件位置变了，但内容没变；这里仅刷一次提示）
        if (patch.storagePath) await refreshStats();
      }
      setToast('✓ 设置已保存');
      window.setTimeout(() => setToast(null), 2000);
    } catch (err: any) {
      setToast(`⚠ 保存失败：${err?.message ?? '未知错误'}`);
      window.setTimeout(() => setToast(null), 2500);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, draft, config, onConfigChange, refreshStats]);

  const onCancel = useCallback(() => {
    setDraft(config);
    if (close) close();
  }, [config, close]);

  // ──────────────────────────────────────────────────────────
  //  渲染
  // ──────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="混元生图设置"
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        animation: 'hunyuan-fade-in 0.15s ease',
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '94vw',
          maxHeight: '88vh',
          background: COLOR.bg,
          color: COLOR.fg,
          border: `1px solid ${COLOR.border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
          overflow: 'hidden',
        }}
      >
        {/* ── 顶部统计条 ──────────────────────────────────────── */}
        <div
          style={{
            padding: '12px 16px',
            background: COLOR.bgRaised,
            borderBottom: `1px solid ${COLOR.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                margin: 0,
              }}
            >
              混元生图 · 设置
            </div>
            <div
              style={{
                fontSize: 12,
                color: COLOR.fgMuted,
                marginTop: 2,
              }}
            >
              {stats.loading
                ? '正在统计本地图库…'
                : stats.error
                ? `统计失败：${stats.error}`
                : `${stats.count ?? '—'} 张图片 · ${
                    stats.totalBytes === null
                      ? '—'
                      : humanBytes(stats.totalBytes)
                  }`}
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭设置"
            onClick={close}
            style={{
              background: 'transparent',
              border: 'none',
              color: COLOR.fg,
              fontSize: 20,
              cursor: 'pointer',
              padding: '0 6px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* ── 滚动内容 ────────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {/* API Key */}
          <Section title="API Key" hint="在腾讯云 TokenHub 控制台申请">
            <div
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'stretch',
              }}
            >
              <input
                type={showKey ? 'text' : 'password'}
                aria-label="TokenHub API Key"
                placeholder="sk-..."
                value={draft.apiKey}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, apiKey: e.target.value }))
                }
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  background: COLOR.bgRaised,
                  color: COLOR.fg,
                  border: `1px solid ${COLOR.border}`,
                  borderRadius: 4,
                  fontSize: 13,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, monospace',
                  outline: 'none',
                }}
              />
              <IconBtn
                label={showKey ? '隐藏 API Key' : '显示 API Key'}
                emoji={showKey ? '🙈' : '👁'}
                onClick={() => setShowKey((s) => !s)}
              />
              <IconBtn
                label="测试连接"
                emoji="🔌"
                onClick={() => void runTest()}
                highlight={testState === 'ok'}
              />
            </div>
            {testState !== 'idle' && (
              <div
                aria-live="polite"
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color:
                    testState === 'ok'
                      ? COLOR.success
                      : testState === 'fail'
                      ? '#fca5a5'
                      : COLOR.fgMuted,
                }}
              >
                {testState === 'testing' ? '⏳ ' : testState === 'ok' ? '✅ ' : '❌ '}
                {testMessage}
              </div>
            )}
          </Section>

          {/* 保存路径 */}
          <Section
            title="图片保存路径"
            hint={`默认 ${DEFAULT_STORAGE_PATH}`}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                aria-label="图片保存路径"
                value={draft.storagePath}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, storagePath: e.target.value }))
                }
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  background: COLOR.bgRaised,
                  color: COLOR.fg,
                  border: `1px solid ${COLOR.border}`,
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, monospace',
                  outline: 'none',
                }}
              />
              <IconBtn
                label="选择文件夹"
                emoji="📂"
                onClick={() => void pickFolder()}
              />
              <IconBtn
                label="恢复默认路径"
                emoji="↩"
                onClick={restoreDefaultPath}
              />
            </div>
          </Section>

          {/* 默认模型 */}
          <Section title="默认模型">
            <Select
              aria-label="默认模型"
              value={draft.defaultModel}
              options={MODEL_OPTIONS}
              onChange={(v) => onDefaultModelChange(v as ModelId)}
            />
          </Section>

          {/* 默认尺寸：分辨率档位 + 比例，两段式（与官方 TokenHub UI 一致） */}
          <Section title="默认尺寸">
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={SUB_LABEL_STYLE}>默认分辨率</span>
                <Select
                  aria-label="默认分辨率"
                  value={sizeSel.tierId}
                  options={tierOptions}
                  onChange={onDefaultTierChange}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={SUB_LABEL_STYLE}>默认比例</span>
                <Select
                  aria-label="默认比例"
                  value={sizeSel.ratioId}
                  options={ratioOptions}
                  onChange={onDefaultRatioChange}
                  disabled={isAutoTier}
                  title={
                    isAutoTier ? '默认分辨率选「自动」时由模型决定尺寸' : undefined
                  }
                />
              </div>
            </div>
          </Section>

          {/* 水印 */}
          <Section title="水印脚注" hint="默认会画在图片右下角；最长 16 个字符">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="text"
                aria-label="水印脚注"
                placeholder="留空不添加水印"
                maxLength={16}
                value={draft.footnote}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, footnote: e.target.value }))
                }
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  background: COLOR.bgRaised,
                  color: COLOR.fg,
                  border: `1px solid ${COLOR.border}`,
                  borderRadius: 4,
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <span
                aria-live="polite"
                style={{
                  fontSize: 11,
                  color: COLOR.fgMuted,
                  minWidth: 40,
                  textAlign: 'right',
                }}
              >
                {draft.footnote.length}/16
              </span>
            </div>
          </Section>
        </div>

        {/* ── 底部操作 ────────────────────────────────────────── */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: `1px solid ${COLOR.border}`,
            background: COLOR.bgRaised,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            position: 'relative',
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: dirty ? COLOR.accent : COLOR.fgMuted,
              flex: 1,
            }}
          >
            {dirty ? '● 有未保存的修改' : '所有修改已保存'}
          </span>
          <button
            type="button"
            aria-label="取消"
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: COLOR.fg,
              border: `1px solid ${COLOR.border}`,
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            type="button"
            aria-label="保存设置"
            disabled={!dirty || saving}
            onClick={() => void onSave()}
            style={{
              padding: '8px 16px',
              background: dirty && !saving ? COLOR.accent : COLOR.bgHover,
              color: dirty && !saving ? '#fff' : COLOR.fgMuted,
              border: 'none',
              borderRadius: 4,
              cursor: dirty && !saving ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {saving && (
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'hunyuan-spin 0.8s linear infinite',
                  display: 'inline-block',
                }}
              />
            )}
            {saving ? '保存中…' : '保存'}
          </button>

          {/* toast */}
          {toast && (
            <div
              role="status"
              style={{
                position: 'absolute',
                bottom: '110%',
                right: 16,
                padding: '6px 12px',
                background: COLOR.bgRaised,
                border: `1px solid ${COLOR.borderStrong}`,
                color: COLOR.fg,
                borderRadius: 6,
                fontSize: 12,
                boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
                animation: 'hunyuan-fade-in 0.18s ease',
              }}
            >
              {toast}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  内部小组件
// ────────────────────────────────────────────────────────────────────────────

function Section(props: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            color: COLOR.fg,
          }}
        >
          {props.title}
        </h3>
        {props.hint && (
          <span style={{ fontSize: 11, color: COLOR.fgMuted }}>
            {props.hint}
          </span>
        )}
      </div>
      {props.children}
    </section>
  );
}

function Select<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  'aria-label': string;
  /** 置灰（用于「自动」档下的比例下拉） */
  disabled?: boolean;
  title?: string;
}) {
  return (
    <select
      aria-label={props['aria-label']}
      title={props.title}
      disabled={props.disabled}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
      style={{
        width: '100%',
        padding: '7px 10px',
        background: props.disabled ? COLOR.bg : COLOR.bgRaised,
        color: props.disabled ? COLOR.fgMuted : COLOR.fg,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 4,
        fontSize: 13,
        outline: 'none',
        cursor: props.disabled ? 'not-allowed' : undefined,
      }}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function IconBtn(props: {
  label: string;
  emoji: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      style={{
        padding: '7px 12px',
        background: props.highlight ? `${COLOR.success}22` : COLOR.bgRaised,
        color: props.highlight ? COLOR.success : COLOR.fg,
        border: `1px solid ${props.highlight ? COLOR.success : COLOR.border}`,
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span aria-hidden>{props.emoji}</span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  工具：判断 PluginConfig 变化
// ────────────────────────────────────────────────────────────────────────────

function isDifferent(a: PluginConfig, b: PluginConfig): boolean {
  return (
    a.apiKey !== b.apiKey ||
    a.storagePath !== b.storagePath ||
    a.defaultModel !== b.defaultModel ||
    a.defaultSize !== b.defaultSize ||
    a.defaultOrientation !== b.defaultOrientation ||
    a.footnote !== b.footnote
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  文件大小批查询（通过宿主 bus 让 fs.stat 异步返回）
//
//  协议（发射）：
//    bus.emit('fs:stat', { paths, replyTo: <id> })
//  协议（接收）：
//    bus.on('fs:stat:result', { replyTo, sizes: Record<path, bytes> })
//
//  兼容与降级：
//    - 宿主不支持时：1.5s 超时兜底，返回空 map
//    - 单个 path 查询失败：记为 0，不影响其他
// ────────────────────────────────────────────────────────────────────────────

interface StatsState {
  count: number | null;
  totalBytes: number | null;
  loading: boolean;
  error: string | null;
}

function statPaths(
  paths: string[],
  bus: BusLike,
): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    if (paths.length === 0) {
      resolve({});
      return;
    }
    const replyId = `fs-stat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timeout = window.setTimeout(() => {
      off();
      resolve({});
    }, 1500);
    const off = bus.on('fs:stat:result', (payload: any) => {
      if (payload?.replyTo !== replyId) return;
      window.clearTimeout(timeout);
      off();
      const sizes = (payload?.sizes ?? {}) as Record<string, number>;
      resolve(sizes);
    });
    bus.emit('fs:stat', { paths, replyTo: replyId });
  });
}
