/**
 * 混元生图 - 图库面板（右侧面板，懒加载 slot）
 *
 * 提供已生成图片的列表浏览、关键字搜索、多选批量操作、
 * 详情预览与多平台分享等。所有数据通过 services.gallery 取得，
 * 分享 / 导出动作通过宿主 bus 抛出事件。
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  GeneratedImage,
  GalleryQuery,
  IGalleryService,
  IHunyuanService,
  ModelId,
  PluginConfig,
} from '../types.js';
import type { BusLike } from './generator-panel.js';
import { injectKeyframesOnce } from './generator-panel.js';
// 本地图片回送路由：浏览器不能直接加载文件系统路径，必须转成 HTTP URL
import { localFileUrl } from '../client-services/file-url.js';
// 顺手 re-export 一次，供外部 module 仍能取到（不破坏既有公开 API）
export { injectKeyframesOnce };

// ────────────────────────────────────────────────────────────────────────────
//  Slot props
// ────────────────────────────────────────────────────────────────────────────

export interface GalleryPanelProps {
  services: { hunyuan: IHunyuanService; gallery: IGalleryService };
  config: PluginConfig;
  onConfigChange: (patch: Partial<PluginConfig>) => Promise<void>;
  bus: BusLike;
  close?: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
//  局部常量
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

const PAGE_SIZE = 24;

const MODEL_LABEL: Record<ModelId, string> = {
  'hy-image-v3.5-preview': 'v3.5-preview',
  'hy-image-v3': 'v3.0',
};

type OrderBy = GalleryQuery['orderBy'];

// ────────────────────────────────────────────────────────────────────────────
//  工具
// ────────────────────────────────────────────────────────────────────────────

/** 把任意输入规整化到 ms 范围；非法返回 undefined */
function safeTime(t: number | undefined): number | undefined {
  if (typeof t !== 'number' || !Number.isFinite(t)) return undefined;
  return t;
}

/** 截断 prompt 到指定字符数（按可见字符宽；粗略估算用 array.length） */
function truncatePrompt(s: string, max = 60): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/** 时间戳 → 简短中文 */
function shortTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 把字节数转成可读字符串 */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ────────────────────────────────────────────────────────────────────────────
//  根组件
// ────────────────────────────────────────────────────────────────────────────

export default function GalleryPanel(props: GalleryPanelProps) {
  const { services, bus } = props;

  // ── 数据状态 ─────────────────────────────────────────────
  const [items, setItems] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  // ── 查询状态 ─────────────────────────────────────────────
  /** 用户即时输入关键词（输入框受控） */
  const [keywordInput, setKeywordInput] = useState('');
  /** 已 debounce 的关键词（用于触发请求） */
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [filterModel, setFilterModel] = useState<ModelId | 'all'>('all');
  const [filterRange, setFilterRange] = useState<'all' | 'day' | 'week' | 'month'>(
    'all',
  );
  const [orderBy, setOrderBy] = useState<OrderBy>('createdAt');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('desc');

  // ── UI 状态 ──────────────────────────────────────────────
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [shareImageId, setShareImageId] = useState<string | null>(null);

  // ── refs ──────────────────────────────────────────────────
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const reqIdRef = useRef(0);

  // ── 副作用：注入共享 keyframes ────────────────────────────
  useEffect(() => {
    injectKeyframesOnce();
  }, []);

  // ── 计算时间窗 ────────────────────────────────────────────
  const rangeQuery = useMemo<Pick<GalleryQuery, 'since' | 'until'>>(() => {
    const until = Date.now();
    switch (filterRange) {
      case 'day':
        return { since: until - 24 * 3600 * 1000, until };
      case 'week':
        return { since: until - 7 * 24 * 3600 * 1000, until };
      case 'month':
        return { since: until - 30 * 24 * 3600 * 1000, until };
      default:
        return {};
    }
  }, [filterRange]);

  // ── 计算查询对象 ──────────────────────────────────────────
  const baseQuery = useMemo<Omit<GalleryQuery, 'limit' | 'offset'>>(() => {
    const q: Omit<GalleryQuery, 'limit' | 'offset'> = {
      orderBy,
      orderDir,
    };
    if (debouncedKeyword.trim()) q.keyword = debouncedKeyword.trim();
    if (filterModel !== 'all') q.model = filterModel;
    const since = safeTime(rangeQuery.since);
    const until = safeTime(rangeQuery.until);
    if (since !== undefined) q.since = since;
    if (until !== undefined) q.until = until;
    return q;
  }, [debouncedKeyword, filterModel, rangeQuery, orderBy, orderDir]);

  // ── 数据加载：防抖后关键词 / 过滤变化都会触发全量刷新 ────
  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      const reqId = ++reqIdRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const rows = await services.gallery.list({
          ...baseQuery,
          limit: PAGE_SIZE,
          offset,
        });
        // 仅接受最近一次请求，避免竞态
        if (reqId !== reqIdRef.current) return;
        setItems((prev) => (append ? [...prev, ...rows] : rows));
        setHasMore(rows.length === PAGE_SIZE);
      } catch (err: any) {
        if (reqId !== reqIdRef.current) return;
        setError(err?.message ?? '加载失败，请稍后重试。');
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [services.gallery, baseQuery],
  );

  // 全量拉取（过滤/搜索变化时）
  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  // 拉取总数（用于显示）
  useEffect(() => {
    let cancelled = false;
    services.gallery
      .count()
      .then((n) => {
        if (!cancelled) setTotalCount(n);
      })
      .catch(() => {
        if (!cancelled) setTotalCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [services.gallery, items.length]);

  // 关键词 debounce
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedKeyword(keywordInput), 300);
    return () => window.clearTimeout(id);
  }, [keywordInput]);

  // 滚动到底加载更多（IntersectionObserver）
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (!hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e.isIntersecting && !loadingMore && !loading && hasMore) {
          void loadPage(items.length, true);
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, loading, loadPage, items.length]);

  // ── 选择行为 ─────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const it of items) next.add(it.id);
      return next;
    });
  }, [items]);

  // ── 批量操作 ─────────────────────────────────────────────
  const batchDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !confirm(
        `确定要删除已选的 ${ids.length} 张图片吗？该操作不可撤销，本地文件也会一并删除。`,
      )
    ) {
      return;
    }
    try {
      await services.gallery.deleteBatch(ids);
      setSelectedIds(new Set());
      setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
      if (detailId && selectedIds.has(detailId)) setDetailId(null);
    } catch (err: any) {
      setError(err?.message ?? '批量删除失败。');
    }
  }, [selectedIds, services.gallery, detailId]);

  const batchExport = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const itemsToExport = items.filter((it) => selectedIds.has(it.id));
    // 顺序触发 host 的 file:export；具体实现由宿主决定
    for (const it of itemsToExport) {
      bus.emit('file:export', { path: it.localPath, id: it.id });
    }
  }, [selectedIds, items, bus]);

  // ── 单项操作 ─────────────────────────────────────────────
  const detailImage = useMemo(
    () => items.find((it) => it.id === detailId) ?? null,
    [items, detailId],
  );

  const shareImage = useMemo(
    () => items.find((it) => it.id === shareImageId) ?? null,
    [items, shareImageId],
  );

  // ──────────────────────────────────────────────────────────
  //  渲染
  // ──────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        background: COLOR.bg,
        color: COLOR.fg,
        fontSize: 13,
        position: 'relative',
        overflow: 'hidden',
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
      }}
      role="region"
      aria-label="图库面板"
    >
      {/* ── 主列 ─────────────────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            padding: '10px 12px',
            borderBottom: `1px solid ${COLOR.border}`,
            background: COLOR.bgRaised,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                flex: '0 0 auto',
              }}
            >
              图库
              {totalCount !== null && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    color: COLOR.fgMuted,
                    fontWeight: 400,
                  }}
                >
                  共 {totalCount} 张
                </span>
              )}
            </h2>

            <input
              type="search"
              aria-label="搜索提示词"
              placeholder="搜索提示词…"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              style={{
                flex: '1 1 200px',
                minWidth: 160,
                padding: '5px 8px',
                background: COLOR.bg,
                color: COLOR.fg,
                border: `1px solid ${COLOR.border}`,
                borderRadius: 4,
                fontSize: 12,
                outline: 'none',
              }}
            />

            <div style={{ display: 'flex', gap: 4 }}>
              <FilterSelect
                aria-label="按模型过滤"
                value={filterModel}
                onChange={(v) => setFilterModel(v as ModelId | 'all')}
                options={[
                  { value: 'all', label: '全部模型' },
                  { value: 'hy-image-v3.5-preview', label: 'v3.5-preview' },
                  { value: 'hy-image-v3', label: 'v3.0' },
                ]}
              />
              <FilterSelect
                aria-label="按时间过滤"
                value={filterRange}
                onChange={(v) => setFilterRange(v as typeof filterRange)}
                options={[
                  { value: 'all', label: '全部时间' },
                  { value: 'day', label: '最近一天' },
                  { value: 'week', label: '最近一周' },
                  { value: 'month', label: '最近一月' },
                ]}
              />
              <FilterSelect
                aria-label="排序方式"
                value={`${orderBy}-${orderDir}`}
                onChange={(v) => {
                  const [by, dir] = v.split('-') as [OrderBy, 'asc' | 'desc'];
                  setOrderBy(by);
                  setOrderDir(dir);
                }}
                options={[
                  { value: 'createdAt-desc', label: '最新优先' },
                  { value: 'createdAt-asc', label: '最早优先' },
                  { value: 'model-asc', label: '按模型 A→Z' },
                  { value: 'size-desc', label: '按尺寸降序' },
                ]}
              />

              <div
                role="radiogroup"
                aria-label="视图切换"
                style={{
                  display: 'flex',
                  border: `1px solid ${COLOR.border}`,
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                {(
                  [
                    { v: 'grid', label: '网格', aria: '网格视图' },
                    { v: 'list', label: '列表', aria: '列表视图' },
                  ] as const
                ).map((b) => {
                  const active = view === b.v;
                  return (
                    <button
                      key={b.v}
                      type="button"
                      aria-label={b.aria}
                      aria-pressed={active}
                      onClick={() => setView(b.v)}
                      style={{
                        padding: '4px 10px',
                        background: active ? COLOR.accent : 'transparent',
                        color: active ? '#fff' : COLOR.fg,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                color: '#fca5a5',
                background: 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${COLOR.danger}`,
                borderRadius: 4,
                padding: '6px 10px',
                fontSize: 12,
              }}
            >
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Bulk action bar（选中项 >0 时从顶部滑出） */}
        <div
          aria-hidden={selectedIds.size === 0}
          style={{
            maxHeight: selectedIds.size === 0 ? 0 : 56,
            overflow: 'hidden',
            transition: 'max-height 0.18s ease',
            borderBottom:
              selectedIds.size === 0
                ? `1px solid transparent`
                : `1px solid ${COLOR.border}`,
            background: COLOR.bgRaised,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              height: 56,
              boxSizing: 'border-box',
            }}
          >
            <span style={{ fontSize: 12, color: COLOR.fgMuted }}>
              已选 <strong style={{ color: COLOR.fg }}>{selectedIds.size}</strong> 项
            </span>
            <button
              type="button"
              aria-label="全选当前可见项"
              onClick={selectAllVisible}
              style={toolbarBtnStyle}
            >
              全选
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              aria-label="批量导出"
              onClick={batchExport}
              style={toolbarBtnStyle}
            >
              📁 批量导出
            </button>
            <button
              type="button"
              aria-label="批量删除"
              onClick={() => void batchDelete()}
              style={{
                ...toolbarBtnStyle,
                color: '#fca5a5',
                borderColor: COLOR.danger,
              }}
            >
              🗑 批量删除
            </button>
            <button
              type="button"
              aria-label="取消选择"
              onClick={clearSelection}
              style={toolbarBtnStyle}
            >
              取消
            </button>
          </div>
        </div>

        {/* 主体列表 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
          }}
        >
          {items.length === 0 && !loading && (
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: COLOR.fgMuted,
                fontSize: 13,
                textAlign: 'center',
                padding: 40,
              }}
            >
              {debouncedKeyword || filterModel !== 'all' || filterRange !== 'all'
                ? '没有符合条件的图片。'
                : '还没有生成任何图片。\n去生成面板画一张吧 🎨'}
            </div>
          )}

          {view === 'grid' ? (
            <GridView
              items={items}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onOpenDetail={(id) => setDetailId(id)}
            />
          ) : (
            <ListView
              items={items}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onOpenDetail={(id) => setDetailId(id)}
            />
          )}

          {/* 加载更多 sentinel */}
          <div
            ref={sentinelRef}
            aria-hidden
            style={{ height: 24, marginTop: 8 }}
          />
          {loadingMore && (
            <div
              style={{
                textAlign: 'center',
                color: COLOR.fgMuted,
                fontSize: 12,
                padding: 12,
              }}
            >
              加载中…
            </div>
          )}
          {!hasMore && items.length > 0 && (
            <div
              style={{
                textAlign: 'center',
                color: COLOR.fgMuted,
                fontSize: 12,
                padding: 12,
              }}
            >
              已显示全部
            </div>
          )}
        </div>
      </main>

      {/* ── 详情侧栏 ──────────────────────────────────────────── */}
      {detailImage && (
        <DetailDrawer
          image={detailImage}
          onClose={() => setDetailId(null)}
          onSelect={(id) => {
            toggleSelect(id);
          }}
          isSelected={selectedIds.has(detailImage.id)}
          onShare={(id) => setShareImageId(id)}
          bus={bus}
          services={services}
        />
      )}

      {/* ── 分享对话框 ────────────────────────────────────────── */}
      {shareImage && (
        <ShareDialog
          image={shareImage}
          onClose={() => setShareImageId(null)}
          onShare={(target) => {
            bus.emit('share', {
              url: shareImage.localPath,
              prompt: shareImage.prompt,
              target,
            });
            setShareImageId(null);
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Toolbar 工具
// ────────────────────────────────────────────────────────────────────────────

const toolbarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  color: COLOR.fg,
  border: `1px solid ${COLOR.border}`,
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
};

function FilterSelect(props: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  'aria-label': string;
}) {
  return (
    <select
      aria-label={props['aria-label']}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      style={{
        padding: '4px 6px',
        background: COLOR.bg,
        color: COLOR.fg,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 4,
        fontSize: 12,
        outline: 'none',
        maxWidth: 140,
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

// ────────────────────────────────────────────────────────────────────────────
//  视图：网格
// ────────────────────────────────────────────────────────────────────────────

function GridView(props: {
  items: GeneratedImage[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
}) {
  const { items, selectedIds, onToggleSelect, onOpenDetail } = props;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 10,
      }}
    >
      {items.map((it) => {
        const selected = selectedIds.has(it.id);
        return (
          <div
            key={it.id}
            role="button"
            tabIndex={0}
            aria-label={`查看图片：${truncatePrompt(it.prompt, 30)}`}
            onClick={() => onOpenDetail(it.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenDetail(it.id);
              }
            }}
            style={{
              position: 'relative',
              borderRadius: 6,
              overflow: 'hidden',
              border: `2px solid ${selected ? COLOR.accent : COLOR.border}`,
              background: COLOR.bgRaised,
              cursor: 'pointer',
              aspectRatio: '1 / 1',
            }}
          >
            <img
              src={localFileUrl(it.localPath) ?? it.remoteUrl}
              alt=""
              loading="lazy"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                background: '#000',
              }}
            />
            {/* hover 浮层：复选框 */}
            <label
              aria-label={`选中 ${it.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 6,
                left: 6,
                width: 22,
                height: 22,
                background: 'rgba(0,0,0,0.55)',
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${COLOR.borderStrong}`,
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(it.id)}
                aria-label={`选中 ${truncatePrompt(it.prompt, 20)}`}
                style={{ cursor: 'pointer' }}
              />
            </label>
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '4px 6px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                color: '#fff',
                fontSize: 10,
                lineHeight: 1.3,
                display: 'flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              <span style={{ opacity: 0.8 }}>{MODEL_LABEL[it.model]}</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span style={{ opacity: 0.8 }}>{it.size}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  视图：列表
// ────────────────────────────────────────────────────────────────────────────

function ListView(props: {
  items: GeneratedImage[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
}) {
  const { items, selectedIds, onToggleSelect, onOpenDetail } = props;
  return (
    <table
      role="grid"
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 12,
      }}
    >
      <thead>
        <tr style={{ color: COLOR.fgMuted, textAlign: 'left' }}>
          <th style={listThStyle}></th>
          <th style={listThStyle}>提示词</th>
          <th style={listThStyle}>模型</th>
          <th style={listThStyle}>尺寸</th>
          <th style={listThStyle}>时间</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const selected = selectedIds.has(it.id);
          return (
            <tr
              key={it.id}
              role="row"
              tabIndex={0}
              aria-selected={selected}
              onClick={() => onOpenDetail(it.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenDetail(it.id);
                }
              }}
              style={{
                cursor: 'pointer',
                background: selected ? `${COLOR.accent}22` : 'transparent',
                borderBottom: `1px solid ${COLOR.border}`,
              }}
            >
              <td style={listTdStyle} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(it.id)}
                  aria-label={`选中 ${truncatePrompt(it.prompt, 20)}`}
                />
              </td>
              <td style={listTdStyle}>
                <span title={it.prompt}>{truncatePrompt(it.prompt, 60)}</span>
              </td>
              <td style={listTdStyle}>{MODEL_LABEL[it.model]}</td>
              <td style={listTdStyle}>{it.size}</td>
              <td style={listTdStyle}>{shortTime(it.createdAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const listThStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  padding: '8px 6px',
  borderBottom: `1px solid ${COLOR.borderStrong}`,
  color: COLOR.fgMuted,
};

const listTdStyle: React.CSSProperties = {
  padding: '8px 6px',
  verticalAlign: 'middle',
};

// ────────────────────────────────────────────────────────────────────────────
//  详情侧栏（从右滑入）
// ────────────────────────────────────────────────────────────────────────────

function DetailDrawer(props: {
  image: GeneratedImage;
  onClose: () => void;
  onSelect: (id: string) => void;
  isSelected: boolean;
  onShare: (id: string) => void;
  /** 通过 props 显式注入，避免子组件直接依赖外层闭包变量 */
  bus: BusLike;
  services: { hunyuan: IHunyuanService; gallery: IGalleryService };
}) {
  const { image, onClose, onSelect, isSelected, onShare, bus, services } = props;

  const [exportInfo, setExportInfo] = useState<string | null>(null);

  const regenerateFromImage = useCallback(() => {
    // 通过 bus 通知宿主打开生成面板并携带上下文
    bus.emit('slot:open', {
      id: 'hunyuan-generator',
      context: {
        prompt: image.prompt,
        model: image.model,
        size: image.size,
        seed: image.seed,
      },
    });
  }, [bus, image]);

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(image.prompt);
    } catch {
      /* 忽略剪贴板拒写 */
    }
  }, [image]);

  const copyImage = useCallback(async () => {
    try {
      const src = localFileUrl(image.localPath) ?? image.remoteUrl;
      const resp = await fetch(src);
      const blob = await resp.blob();
      // ClipboardItem 在所有浏览器都可用；type 退化为 png 兜底
      const type = blob.type || 'image/png';
      const item = new (window as any).ClipboardItem({ [type]: blob });
      await navigator.clipboard.write([item]);
    } catch {
      /* 退而求其次：复制本地路径 */
      try {
        await navigator.clipboard.writeText(image.localPath);
      } catch {
        /* 忽略 */
      }
    }
  }, [image]);

  const exportImage = useCallback(() => {
    bus.emit('file:export', { path: image.localPath, id: image.id });
    setExportInfo('已发送给宿主导出');
    window.setTimeout(() => setExportInfo(null), 1800);
  }, [bus, image]);

  const shareImage = useCallback(() => {
    onShare(image.id);
  }, [onShare, image]);

  const removeImage = useCallback(async () => {
    if (!confirm('确认删除该图片？本地文件也会被一并删除。')) return;
    try {
      await services.gallery.delete(image.id);
      onClose();
    } catch (err: any) {
      alert(err?.message ?? '删除失败。');
    }
  }, [services.gallery, image, onClose]);

  return (
    <aside
      role="dialog"
      aria-label="图片详情"
      style={{
        width: 400,
        maxWidth: '90%',
        flex: '0 0 400px',
        background: COLOR.bgRaised,
        borderLeft: `1px solid ${COLOR.border}`,
        display: 'flex',
        flexDirection: 'column',
        animation: 'hunyuan-fade-in 0.2s ease',
      }}
    >
      {/* 顶部 */}
      <header
        style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${COLOR.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: COLOR.fgMuted,
            flex: 1,
          }}
        >
          图片详情
        </span>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect(image.id)}
            aria-label="选中此项"
          />
          <span>选中</span>
        </label>
        <button
          type="button"
          aria-label="关闭详情"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: COLOR.fg,
            fontSize: 18,
            cursor: 'pointer',
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </header>

      {/* 大图 */}
      <div
        style={{
          padding: 12,
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={localFileUrl(image.localPath) ?? image.remoteUrl}
          alt={image.prompt}
          style={{
            maxWidth: '100%',
            maxHeight: 360,
            display: 'block',
            borderRadius: 4,
          }}
        />
      </div>

      {/* 元数据 */}
      <div
        style={{
          padding: 12,
          fontSize: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          borderBottom: `1px solid ${COLOR.border}`,
        }}
      >
        <Field label="提示词">
          <span style={{ wordBreak: 'break-word' }}>{image.prompt}</span>
        </Field>
        <Field label="模型">
          <span>{MODEL_LABEL[image.model]}</span>
        </Field>
        <Field label="尺寸">
          <span>{image.size}</span>
        </Field>
        {typeof image.seed === 'number' && image.seed !== 0 && (
          <Field label="种子">
            <span>{image.seed}</span>
          </Field>
        )}
        {image.footnote && <Field label="水印">{image.footnote}</Field>}
        <Field label="时间">
          <span>{shortTime(image.createdAt)}</span>
        </Field>
        <Field label="本地路径">
          <code
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11,
              color: COLOR.fgMuted,
              wordBreak: 'break-all',
            }}
          >
            {image.localPath}
          </code>
        </Field>
      </div>

      {/* 操作 */}
      <div
        style={{
          padding: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 6,
        }}
      >
        <DrawerBtn label="再次生图" emoji="🔁" onClick={regenerateFromImage} />
        <DrawerBtn label="复制提示词" emoji="📋" onClick={() => void copyPrompt()} />
        <DrawerBtn label="复制图片" emoji="🖼" onClick={() => void copyImage()} />
        <DrawerBtn label="导出" emoji="💾" onClick={exportImage} />
        <DrawerBtn label="生成分享链接" emoji="🔗" onClick={shareImage} />
        <DrawerBtn
          label="删除"
          emoji="🗑"
          onClick={() => void removeImage()}
          danger
        />
      </div>

      {exportInfo && (
        <div
          role="status"
          style={{
            margin: '0 12px 12px',
            padding: '6px 10px',
            background: `${COLOR.success}22`,
            border: `1px solid ${COLOR.success}`,
            borderRadius: 4,
            color: COLOR.success,
            fontSize: 12,
          }}
        >
          ✓ {exportInfo}
        </div>
      )}
    </aside>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span
        style={{
          flex: '0 0 56px',
          color: COLOR.fgMuted,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
          paddingTop: 1,
        }}
      >
        {props.label}
      </span>
      <span style={{ flex: 1, color: COLOR.fg }}>{props.children}</span>
    </div>
  );
}

function DrawerBtn(props: {
  label: string;
  emoji: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      onClick={props.onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 10px',
        background: 'transparent',
        color: props.danger ? '#fca5a5' : COLOR.fg,
        border: `1px solid ${props.danger ? COLOR.danger : COLOR.border}`,
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 12,
        textAlign: 'left',
      }}
    >
      <span aria-hidden>{props.emoji}</span>
      <span>{props.label}</span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  分享对话框
// ────────────────────────────────────────────────────────────────────────────

const SHARE_TARGETS: Array<{ value: string; label: string; emoji: string }> = [
  { value: 'wechat', label: '微信', emoji: '💬' },
  { value: 'feishu', label: '飞书', emoji: '🚀' },
  { value: 'copy', label: '复制链接', emoji: '🔗' },
];

function ShareDialog(props: {
  image: GeneratedImage;
  onClose: () => void;
  onShare: (target: string) => void;
}) {
  const { image, onClose, onShare } = props;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="生成分享链接"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        animation: 'hunyuan-fade-in 0.15s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLOR.bgRaised,
          color: COLOR.fg,
          border: `1px solid ${COLOR.border}`,
          borderRadius: 8,
          padding: 20,
          minWidth: 320,
          maxWidth: 420,
          boxShadow: '0 10px 32px rgba(0,0,0,0.5)',
        }}
      >
        <h3
          style={{
            margin: '0 0 6px',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          生成分享链接
        </h3>
        <p
          style={{
            margin: '0 0 16px',
            fontSize: 12,
            color: COLOR.fgMuted,
          }}
        >
          选择分享目标，宿主会按目标拉起对应客户端。
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
          }}
        >
          {SHARE_TARGETS.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-label={`分享到 ${t.label}`}
              onClick={() => onShare(t.value)}
              style={{
                padding: '12px 8px',
                background: COLOR.bg,
                color: COLOR.fg,
                border: `1px solid ${COLOR.border}`,
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
              }}
            >
              <span aria-hidden style={{ fontSize: 20 }}>
                {t.emoji}
              </span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <p
          style={{
            margin: '16px 0 0',
            fontSize: 11,
            color: COLOR.fgMuted,
            wordBreak: 'break-word',
          }}
        >
          来源：{image.localPath}
        </p>
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            aria-label="关闭分享对话框"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: `1px solid ${COLOR.border}`,
              color: COLOR.fg,
              padding: '6px 14px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  keyframes 注入（由 generator-panel 提供；本文件 re-export 以集中管理）
// ────────────────────────────────────────────────────────────────────────────
