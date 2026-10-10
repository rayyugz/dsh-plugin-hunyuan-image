/**
 * 客户端 Bus 适配器。
 *
 * 职责：把 slots 期望的 `BusLike`（emit/on）形状组装出来，并把其中
 * **需要真实宿主能力**的事件真正接通（不再只是空壳）：
 *
 *   emit('slot:open', {id, context})    → 本地事件（同一 client context 内面板互跳）
 *   emit('folder:pick', {replyTo})      → ctx.uiWorkspace.pickDirectory() → on('folder:picked')
 *   emit('file:pick', {accept, replyTo})→ 浏览器 <input type=file>      → on('file:picked')
 *   emit('fs:stat', {paths, replyTo})   → host /hunyuan/api/fs.stat     → on('fs:stat:result')
 *   emit('file:export', {path, id})     → host /hunyuan/api/file.export（尽力）
 *   emit('share', {url, prompt, target})→ host /hunyuan/api/share（尽力）
 *
 * 设计：`emit` 先算**本地**结果（folder / file 两类），本地无法处理的再
 * 异步投给 host。所有 host 调用都是 fire-and-forget，失败不影响 UI。
 */

import type { BusLike } from '../slots/generator-panel.js';

const API_PREFIX = '/hunyuan/api';

interface BusListener {
  (payload: any): void;
}

/** 客户端 ctx 中本文件用到的服务子集 */
export interface BusClientCtx {
  /** DSH 客户端工作区服务：提供原生目录选择器 */
  uiWorkspace?: {
    pickDirectory(): Promise<string | null>;
  };
  logger?: { info?: (m: string, ...r: unknown[]) => void; warn?: (m: string, ...r: unknown[]) => void };
}

/**
 * 从浏览器文件选择器取一个 data URL（Hunyuan API 接受 `data:image/...;base64,...`）。
 * 用户取消时 resolve(null)。
 */
function pickFileAsDataUrl(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || 'image/*';
    input.style.display = 'none';

    // 用户取消：focus 回到窗口后短时间内没有 change 事件 → 视作取消
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => finish(null);
      reader.readAsDataURL(file);
    });

    document.body.appendChild(input);
    input.click();

    // 取消兜底：窗口重新获得焦点后 1.2s 仍无选择 → 判定取消
    const onFocus = () => {
      window.setTimeout(() => finish(null), 1200);
      window.removeEventListener('focus', onFocus);
    };
    window.addEventListener('focus', onFocus);
  });
}

export function createClientBus(ctx?: BusClientCtx): BusLike {
  const target = new EventTarget();
  const log = ctx?.logger;

  function emitLocal(event: string, payload?: unknown): void {
    try {
      target.dispatchEvent(new CustomEvent(event, { detail: payload }));
    } catch {
      /* EventTarget 异常环境下不可用，忽略 */
    }
  }

  function postToHost(method: string, args: unknown): Promise<unknown | null> {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(`${API_PREFIX}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args }),
    })
      .then((r) => r.json())
      .then((env: { ok?: boolean; value?: unknown } | null) =>
        env && env.ok ? (env.value ?? null) : null,
      )
      .catch(() => null);
  }

  function emit(event: string, payload?: unknown): void {
    const p = (payload ?? {}) as Record<string, unknown>;

    // ── 1. 目录选择：用 DSH 原生 picker ────────────────────────
    if (event === 'folder:pick') {
      const replyTo = p.replyTo;
      const picker = ctx?.uiWorkspace;
      if (picker && typeof picker.pickDirectory === 'function') {
        void picker
          .pickDirectory()
          .then((dir) => {
            if (dir) emitLocal('folder:picked', { replyTo, path: dir });
          })
          .catch((e) => log?.warn?.('[hunyuan] pickDirectory failed', e));
      } else {
        log?.warn?.('[hunyuan] uiWorkspace.pickDirectory 不可用，无法打开目录选择器');
      }
      return;
    }

    // ── 2. 文件选择：浏览器 input（参考图）────────────────────
    if (event === 'file:pick') {
      const replyTo = p.replyTo;
      const accept = typeof p.accept === 'string' ? p.accept : 'image/*';
      void pickFileAsDataUrl(accept).then((url) => {
        if (url) emitLocal('file:picked', { replyTo, url });
      });
      return;
    }

    // ── 3. 其余事件：本地广播 + 尽力通知 host ──────────────────
    emitLocal(event, payload);

    switch (event) {
      case 'fs:stat': {
        // 本地无法读盘，交给 host 统计后把结果回推给等在那里的 UI
        const replyTo = p.replyTo;
        void postToHost('fs.stat', p).then((value) => {
          const sizes = (value as { sizes?: Record<string, number> } | null)?.sizes;
          if (sizes) emitLocal('fs:stat:result', { replyTo, sizes });
        });
        break;
      }
      case 'file:export':
        void postToHost('file.export', p);
        break;
      case 'share':
        void postToHost('share', p);
        break;
      default:
        // slot:open 等纯客户端事件不需要 host
        break;
    }
  }

  function on(event: string, handler: BusListener): () => void {
    const listener = (e: Event): void => {
      handler((e as CustomEvent).detail);
    };
    target.addEventListener(event, listener);
    return () => {
      target.removeEventListener(event, listener);
    };
  }

  return { emit, on };
}
