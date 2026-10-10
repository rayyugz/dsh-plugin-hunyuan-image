/**
 * DSH Client 入口 — Cordis 客户端 plugin apply。
 *
 * 与 src/server.ts 对偶：客户端 entry 把 UI 注册进 DSH 的 Web 页面。
 *
 * 采用的 slot：`conversation.composer.dock`
 *   —— DSH 官方模板（templates/decoration）推荐的「有分配空间的 list slot」，
 *   在输入框下方渲染一行 ambient 入口，注册字段为 { id, order, label }。
 *   点击后在 `shell.overlay` 之上弹出本插件自己的面板浮层。
 *
 * 通过 /hunyuan/api/* HTTP RPC 调用 host 端真实 Service（见 host/routes.ts）。
 *
 * 构建说明：本文件最终由 build-client.mjs 用 esbuild 打包成
 * `window.__ModuleLoader__.load({ id, factory })` 格式（DSH 客户端模块表）。
 * 因此这里按普通 ESM 写，React 由 factory 的 require 提供。
 */

import { createElement, useEffect, useState, type ReactNode } from 'react';

import GeneratorPanel from './slots/generator-panel.js';
import GalleryPanel from './slots/gallery-panel.js';
import SettingsPanel from './slots/settings-panel.js';

import { createHunyuanClient, createGalleryClient } from './client-services/rpc.js';
import { createConfigClient } from './client-services/config-client.js';
import { createClientBus } from './client-services/bus.js';

// ────────────────────────────────────────────────────────────────────────────
//  客户端 ctx 形状（由 DSH client runtime 注入；避免 hard-depend SDK 类型）
// ────────────────────────────────────────────────────────────────────────────

interface SlotRegisterOptions {
  name: string;
  id: string;
  order?: number;
  label?: string | (() => string);
  inject?: (...args: never[]) => Record<string, unknown>;
}

interface ClientSlots {
  register(options: SlotRegisterOptions, component: unknown): () => void;
  inject(slotName: string, factory: () => () => void): () => void;
}

interface ClientCtx {
  slots: ClientSlots;
  /** DSH 客户端工作区服务：提供原生目录选择器（设置面板「选择保存路径」用） */
  uiWorkspace?: {
    pickDirectory(): Promise<string | null>;
  };
  logger?: { info?: (msg: string, ...rest: unknown[]) => void; warn?: (msg: string, ...rest: unknown[]) => void };
}

// ────────────────────────────────────────────────────────────────────────────
//  插件身份（client 端不需要 name 导出；id 由构建脚本注入 factory）
// ────────────────────────────────────────────────────────────────────────────

export const name = 'dsh-plugin-hunyuan-image';

/** 启动前必须就绪的客户端服务：
 *  - `slots`       : 渲染槽位注册表
 *  - `uiWorkspace` : 原生目录选择器（设置面板「选择保存路径」）
 */
export const inject = ['slots', 'uiWorkspace'] as const;

// ────────────────────────────────────────────────────────────────────────────
//  面板浮层：把三个已有面板塞进一个可切换的浮层
// ────────────────────────────────────────────────────────────────────────────

type TabKey = 'generator' | 'gallery' | 'settings';

interface PanelOverlayProps {
  services: { hunyuan: ReturnType<typeof createHunyuanClient>; gallery: ReturnType<typeof createGalleryClient> };
  config: ReturnType<ReturnType<typeof createConfigClient>['get']>;
  onConfigChange: ReturnType<typeof createConfigClient>['update'];
  bus: ReturnType<typeof createClientBus>;
  onClose: () => void;
}

/** 三个标签页共用的浮层容器；样式全部内联，继承宿主主题变量 */
function PanelOverlay(props: PanelOverlayProps): ReactNode {
  const { services, config, onConfigChange, bus, onClose } = props;
  const [tab, setTab] = useState<TabKey>('generator');

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * 监听子面板发出的 `slot:open`，切换本浮层的标签页。
   *
   * 背景：生成面板右上角的「图库」按钮、图库详情里的「再次生图」都通过
   * `bus.emit('slot:open', { id })` 表达「打开另一个面板」的意图。我们已把
   * 三个面板合并进同一个浮层（而不是三个独立的 DSH slot），所以必须在这里
   * 把 slot id 映射成标签页，否则点了没反应。
   */
  useEffect(() => {
    const off = bus.on('slot:open', (payload: { id?: string } | undefined) => {
      const id = payload?.id;
      if (id === 'hunyuan-gallery') setTab('gallery');
      else if (id === 'hunyuan-generator') setTab('generator');
      else if (id === 'hunyuan-settings') setTab('settings');
    });
    return off;
  }, [bus]);

  const tabBtn = (key: TabKey, text: string) =>
    createElement(
      'button',
      {
        key,
        type: 'button',
        onClick: () => setTab(key),
        'aria-pressed': tab === key,
        style: {
          padding: '6px 14px',
          fontSize: 13,
          cursor: 'pointer',
          borderRadius: 6,
          border: '1px solid var(--dsh-border, #3a3a3a)',
          background: tab === key ? 'var(--dsh-accent, #3b82f6)' : 'transparent',
          color: tab === key ? '#fff' : 'var(--dsh-text, #e0e0e0)',
        },
      },
      text,
    );

  let body: ReactNode;
  if (tab === 'generator') {
    body = createElement(GeneratorPanel as never, { services, config, onConfigChange, bus } as never);
  } else if (tab === 'gallery') {
    body = createElement(GalleryPanel as never, { services, config, onConfigChange, bus } as never);
  } else {
    body = createElement(SettingsPanel as never, { services, config, onConfigChange, bus, close: onClose } as never);
  }

  return createElement(
    'div',
    {
      // 覆盖整个视口的浮层
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      },
      onClick: (e: { target: unknown; currentTarget: unknown }) => {
        if (e.target === e.currentTarget) onClose();
      },
    },
    createElement(
      'div',
      {
        role: 'dialog',
        'aria-label': '腾讯混元生图',
        style: {
          width: 'min(920px, 92vw)',
          height: 'min(720px, 88vh)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--dsh-bg, #1a1a1a)',
          color: 'var(--dsh-text, #e0e0e0)',
          border: '1px solid var(--dsh-border, #3a3a3a)',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        },
      },
      // 头部：标签切换 + 关闭
      createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--dsh-border, #3a3a3a)',
          },
        },
        tabBtn('generator', '生成'),
        tabBtn('gallery', '图库'),
        tabBtn('settings', '设置'),
        createElement('div', { style: { flex: 1 } }),
        createElement(
          'button',
          {
            type: 'button',
            onClick: onClose,
            'aria-label': '关闭',
            style: {
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              borderRadius: 6,
              border: '1px solid var(--dsh-border, #3a3a3a)',
              background: 'transparent',
              color: 'inherit',
            },
          },
          '关闭',
        ),
      ),
      // 内容区
      createElement('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } }, body),
    ),
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Composer dock 入口按钮
// ────────────────────────────────────────────────────────────────────────────

function HunyuanDockButton(props: {
  services: PanelOverlayProps['services'];
  config: PanelOverlayProps['config'];
  onConfigChange: PanelOverlayProps['onConfigChange'];
  bus: PanelOverlayProps['bus'];
}): ReactNode {
  const [open, setOpen] = useState(false);

  const button = createElement(
    'button',
    {
      type: 'button',
      onClick: () => setOpen((v) => !v),
      'aria-expanded': open,
      title: '腾讯混元生图',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 12,
        cursor: 'pointer',
        borderRadius: 6,
        border: '1px solid var(--dsh-border, #3a3a3a)',
        background: 'transparent',
        color: 'var(--dsh-text-muted, #9aa0a6)',
      },
    },
    createElement('span', { 'aria-hidden': true }, '🖼'),
    createElement('span', null, '混元生图'),
  );

  if (!open) return button;

  return createElement(
    'div',
    null,
    button,
    createElement(PanelOverlay as never, {
      services: props.services,
      config: props.config,
      onConfigChange: props.onConfigChange,
      bus: props.bus,
      onClose: () => setOpen(false),
    } as never),
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  apply
// ────────────────────────────────────────────────────────────────────────────

export function apply(ctx: ClientCtx): () => void {
  const services = { hunyuan: createHunyuanClient(), gallery: createGalleryClient() };
  const configClient = createConfigClient();
  const bus = createClientBus(ctx);

  // props 工厂：每次 slots runtime 取 props 时重算，拿到最新 config 缓存
  const buildInject = (): Record<string, unknown> => ({
    services,
    config: configClient.get(),
    onConfigChange: configClient.update,
    bus,
  });

  const disposers: Array<() => void> = [];

  try {
    disposers.push(
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'hunyuan-image-dock',
            order: 40,
            label: () => '混元生图',
            inject: () => buildInject(),
          },
          HunyuanDockButton,
        ),
      ),
    );

    ctx.logger?.info?.('[hunyuan] client entry activated (composer dock registered)');
  } catch (error) {
    ctx.logger?.warn?.('[hunyuan] client entry registration failed', error);
    for (const d of disposers) {
      try {
        d();
      } catch {
        /* swallow */
      }
    }
    return () => {
      /* nothing left to dispose */
    };
  }

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        /* swallow */
      }
    }
  };
}
