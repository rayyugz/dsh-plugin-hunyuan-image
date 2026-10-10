/**
 * 本地存储服务：负责把腾讯混元返回的远程图片 URL（12 小时有效）立刻下载到本地持久化。
 *
 * 设计要点：
 * 1. 目录结构按月份分桶（<basePath>/YYYY-MM/），单目录文件数可控，方便回溯。
 * 2. 文件名用 `<时间戳>-<uuid>.<ext>`：人眼可排序 + 全局唯一。
 * 3. 下载使用 fetch + 流式写入（Node 18+ 的 Response.body 是 Web ReadableStream），
 *    中途 AbortSignal 触发时立即停止并删除半截文件。
 * 4. 所有 IO 异步化，错误向上抛（hunyuan service 决定怎么降级）。
 */

import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Logger, FsAdapter } from './config.js';

// ──────────────────────────────────────────────────────────────
//  内部常量
// ──────────────────────────────────────────────────────────────

/** 分桶目录的时间格式 */
const MONTH_FORMATTER = (date: Date): string => {
  // 直接格式化避免依赖额外 locale；YYYY-MM
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

/** 默认下载 / 读取超时（毫秒）：超过即抛错；下载受 AbortSignal 优先控制 */
const DOWNLOAD_TIMEOUT_MS = 60_000;

// ──────────────────────────────────────────────────────────────
//  工厂与对外类型
// ──────────────────────────────────────────────────────────────

export interface StorageServiceDeps {
  fs: FsAdapter;
  /**
   * 持久化根目录（来自 PluginConfig.storagePath）。
   *
   * 支持两种形态：
   *   - `string`     固定目录（旧用法）
   *   - `() => string` **推荐**：每次使用时实时读取配置。
   *     这样用户在设置面板改了保存路径后立即生效，无需重启插件。
   */
  basePath: string | (() => string);
  logger: Logger;
}

/**
 * 暴露给 hunyuan service 的最小接口：避免下层依赖整个 config service 类型。
 */
export interface IStorageService {
  /** 确保 basePath 存在；多级目录递归创建 */
  ensureDir(): Promise<void>;
  /**
   * 生成本地保存路径（仅计算路径，不实际创建文件）。
   * @param model 模型 ID，仅用于日志/调试；当前实现不参与路径
   * @param ext 文件扩展名（不含点），如 'png'
   */
  generateLocalPath(model: string, ext: string): string;
  /**
   * 从远程 URL 下载图片并落盘到 localPath。
   * 中途 AbortSignal 触发会抛 AbortError，且会清理半截文件。
   * @returns 落盘文件的绝对路径
   */
  downloadFromUrl(url: string, localPath: string, signal?: AbortSignal): Promise<string>;
  /** 删除单个本地文件；文件不存在时静默忽略 */
  deleteLocal(p: string): Promise<void>;
  /** 列出目录下的文件名（不递归）；目录不存在返回空数组 */
  listLocal(dir?: string): Promise<string[]>;
  /** 释放资源（当前无句柄；保留语义） */
  dispose(): Promise<void>;
}

/**
 * 创建存储服务实例。
 *
 * @param deps 宿主文件系统 + 持久化根目录 + logger
 */
export function createStorageService(deps: StorageServiceDeps): IStorageService {
  const { fs, basePath, logger } = deps;

  /** 实时解析当前根目录：支持 getter 形态，让设置里的路径改动立即生效 */
  function currentBasePath(): string {
    return typeof basePath === 'function' ? basePath() : basePath;
  }

  // ── 私有：把 basePath + 月份桶 + 文件名拼成绝对路径 ──
  function buildLocalPath(ext: string, now: Date): string {
    const monthBucket = MONTH_FORMATTER(now);
    const dir = path.join(currentBasePath(), monthBucket);
    // 时间戳（毫秒）+ uuid：人眼排序 + 全局唯一（同一毫秒多图也不冲突）
    const name = `${now.getTime()}-${randomUUID()}.${ext}`;
    return path.join(dir, name);
  }

  // ── 私有：组合用户 signal 与超时 signal（任一触发即取消） ──
  function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
    // 过滤掉 undefined，剩下的 0/1/2 个分别处理
    const alive = signals.filter((s): s is AbortSignal => s !== undefined);
    if (alive.length === 0) {
      // 没有任何 signal：构造一个永不被中止的 controller，纯用于超时
      const ctrl = new AbortController();
      return ctrl.signal;
    }
    if (alive.length === 1) {
      return alive[0]!;
    }
    // 多个 signal：任一中止即合并中止
    const merged = new AbortController();
    const onAbort = (): void => {
      // 找出已中止的那个的 reason（DOMException）
      const aborted = alive.find((s) => s.aborted);
      merged.abort(aborted?.reason);
    };
    for (const s of alive) {
      if (s.aborted) {
        // 已经中止：立即转发
        onAbort();
        return merged.signal;
      }
      s.addEventListener('abort', onAbort, { once: true });
    }
    return merged.signal;
  }

  // ── 对外：ensureDir ──
  async function ensureDir(): Promise<void> {
    // 用户改 storagePath 后目录可能不存在，必须先建好
    await fs.mkdir(currentBasePath(), { recursive: true });
  }

  // ── 对外：generateLocalPath ──
  function generateLocalPath(_model: string, ext: string): string {
    // 注意：这里只生成路径，不创建目录；调用方实际写盘时会因父目录缺失失败
    // 调用方典型顺序：ensureDir() → generateLocalPath() → downloadFromUrl(..., localPath)
    return buildLocalPath(ext, new Date());
  }

  // ── 对外：downloadFromUrl ──
  async function downloadFromUrl(url: string, localPath: string, signal?: AbortSignal): Promise<string> {
    // 1. 合并用户 signal 与超时 signal
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(new Error('download timeout')), DOWNLOAD_TIMEOUT_MS);
    const combined = combineSignals([signal, timeoutCtrl.signal]);

    // 2. 提前确保父目录存在（避免流式写到一半才报错）
    const parentDir = path.dirname(localPath);
    await fs.mkdir(parentDir, { recursive: true });

    // 3. 发起请求
    let response: Response;
    try {
      response = await fetch(url, { signal: combined });
    } catch (err) {
      clearTimeout(timer);
      // 用户主动中止：抛出标准 AbortError
      if (signal?.aborted || timeoutCtrl.signal.aborted) {
        throw signal?.aborted
          ? (signal.reason instanceof Error ? signal.reason : new Error('aborted'))
          : new Error('download timeout');
      }
      throw err;
    }

    if (!response.ok) {
      clearTimeout(timer);
      throw new Error(`下载失败: HTTP ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      clearTimeout(timer);
      throw new Error('下载失败: 响应无 body');
    }

    // 4. 流式写盘：用 Node 18+ 的 ReadableStream 转可写流
    //    - 本服务不依赖额外 IO 库，直接用 fs.writeFile（覆盖式）
    //    - 写入失败的清理策略：捕获异常后 unlink 半截文件
    try {
      const arrayBuffer = await response.arrayBuffer();
      // 直接把 Uint8Array 交给宿主 fs.writeFile（宿主实现可用 Buffer.write 或 fs.createWriteStream）
      const bytes = new Uint8Array(arrayBuffer);
      await fs.writeFile(localPath, bytes);
    } catch (err) {
      // 写盘失败 / 用户中止：尝试清理半截文件
      clearTimeout(timer);
      try {
        await fs.unlink?.(localPath);
      } catch {
        /* ignore: 可能文件没创建 */
      }
      // 用户主动中止 → 透传 AbortError
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
      }
      throw err;
    }

    clearTimeout(timer);
    logger.info?.(`[storage] 图片已下载: ${localPath}`);
    return localPath;
  }

  // ── 对外：deleteLocal ──
  async function deleteLocal(p: string): Promise<void> {
    try {
      await fs.unlink?.(p);
    } catch (err) {
      // 文件不存在：ENOENT；按"幂等删除"语义忽略
      // 其他错误（权限、跨设备链接）需要向上抛
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  // ── 对外：listLocal ──
  async function listLocal(dir?: string): Promise<string[]> {
    const target = dir ?? currentBasePath();
    try {
      return await fs.readdir(target);
    } catch (err) {
      // 目录不存在视为空，不抛错
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      throw err;
    }
  }

  // ── 对外：dispose ──
  async function dispose(): Promise<void> {
    // 当前实现不持有任何长生命周期资源；
    // 保留语义便于未来加 LRU 缓存 / 文件锁等时统一释放。
  }

  return {
    ensureDir,
    generateLocalPath,
    downloadFromUrl,
    deleteLocal,
    listLocal,
    dispose,
  };
}
