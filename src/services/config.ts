/**
 * 插件配置服务：负责持久化 PluginConfig 到 <userData>/hunyuan-image-config.json。
 *
 * 设计要点：
 * 1. 配置写入采用「先写 .tmp，再 rename」的原子写，保证崩溃时不留半截文件。
 * 2. 路径里的 `~` 用 Node `path` + `os.homedir()` 在宿主侧展开，跨平台一致。
 * 3. 任何外部输入（initial、磁盘上的旧文件、update 调用）都按字段 merge，避免外部注入污染结构。
 */

import * as os from 'node:os';
import * as path from 'node:path';

// ──────────────────────────────────────────────────────────────
//  依赖接口（最小化，宿主适配器只暴露必要方法）
// ──────────────────────────────────────────────────────────────

/** 宿主文件系统适配器：只声明我们用到的方法，避免与 dsh-plugin-sdk 类型耦合 */
export interface FsAdapter {
  readFile(filePath: string, encoding: 'utf8'): Promise<string>;
  /** 写文件：可接受 utf8 字符串或二进制字节 */
  writeFile(filePath: string, data: string | Uint8Array, encoding?: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(dirPath: string, options: { recursive: boolean }): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  /** 列出目录文件；目录不存在时宿主应抛 ENOENT，由调用方决定如何处理 */
  readdir(dirPath: string): Promise<string[]>;
  /** 可选：原子写失败时清理临时文件用 */
  unlink?(filePath: string): Promise<void>;
}

/** 宿主路径助手：拿到 userData 根目录 */
export interface PathsAdapter {
  userData(): string;
}

/** 最小日志接口：debug/info/warn/error 四级足够覆盖本插件需要 */
export interface Logger {
  debug?(message: string, ...rest: unknown[]): void;
  info?(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

// ──────────────────────────────────────────────────────────────
//  内部常量
// ──────────────────────────────────────────────────────────────

import type { PluginConfig, ModelId, Orientation } from '../types.js';

/** 配置文件名（放在 <userData> 下） */
const CONFIG_FILE_NAME = 'hunyuan-image-config.json';
/** 原子写用的临时文件名后缀 */
const TMP_SUFFIX = '.tmp';
/** 字段级默认值：缺一不可，否则 UI / 后端会拿到 undefined 炸掉 */
const DEFAULT_CONFIG: PluginConfig = {
  apiKey: '',
  storagePath: path.join(os.homedir(), 'Pictures', 'DSH-Hunyuan-Image'),
  defaultModel: 'hy-image-v3.5-preview',
  defaultSize: '1024x1024',
  defaultOrientation: 'square',
  footnote: '',
};

/** 白名单字段：任何 merge / sanitize 都不能超出这个集合，防止外部塞入未知键 */
const CONFIG_KEYS = [
  'apiKey',
  'storagePath',
  'defaultModel',
  'defaultSize',
  'defaultOrientation',
  'footnote',
] as const satisfies ReadonlyArray<keyof PluginConfig>;

// ──────────────────────────────────────────────────────────────
//  工厂与对外类型
// ──────────────────────────────────────────────────────────────

export interface ConfigServiceDeps {
  fs: FsAdapter;
  paths: PathsAdapter;
  /** 来自 manifest.config 的初始值（首次启动时为空对象） */
  initial?: Record<string, unknown>;
  /** 可选宿主 logger；未传则降级到 console.warn */
  logger?: Logger;
}

export interface IConfigService {
  /** 加载磁盘配置（必须先调一次） */
  load(): Promise<void>;
  /** 取当前配置的不可变快照 */
  get(): Readonly<PluginConfig>;
  /** 局部更新并落盘；返回更新后的配置 */
  update(patch: Partial<PluginConfig>): Promise<Readonly<PluginConfig>>;
  /** 释放资源（目前没有句柄，仅作语义完整） */
  dispose(): Promise<void>;
}

/**
 * 创建配置服务实例。
 *
 * @param deps 宿主注入的文件系统 + 路径助手 + 初始配置
 */
export function createConfigService(deps: ConfigServiceDeps): IConfigService {
  const { fs, paths, initial = {}, logger } = deps;
  // 降级 logger：未传宿主 logger 时使用 console.warn，避免静默失败
  const log = {
    warn: (msg: string, ...rest: unknown[]) =>
      logger ? logger.warn(msg, ...rest) : console.warn(msg, ...rest),
    error: (msg: string, ...rest: unknown[]) =>
      logger ? logger.error(msg, ...rest) : console.error(msg, ...rest),
  };

  // 配置路径：<userData>/hunyuan-image-config.json
  const configPath = path.join(paths.userData(), CONFIG_FILE_NAME);

  // 内存中的当前配置；任何变更都先更新这里，再原子写到磁盘
  let current: PluginConfig = { ...DEFAULT_CONFIG };

  // ── 私有：把任意输入 sanitize 成合法 PluginConfig ──
  function sanitize(input: unknown): PluginConfig {
    // 非对象输入一律退回默认（防御性，不要因为坏数据导致服务崩溃）
    if (input === null || typeof input !== 'object') {
      return { ...DEFAULT_CONFIG };
    }
    const src = input as Record<string, unknown>;
    // 逐字段读取 + 校验类型，缺/坏就用默认值
    const next: PluginConfig = {
      apiKey: typeof src.apiKey === 'string' ? src.apiKey : DEFAULT_CONFIG.apiKey,
      storagePath:
        typeof src.storagePath === 'string' && src.storagePath.length > 0
          ? expandHome(src.storagePath)
          : DEFAULT_CONFIG.storagePath,
      defaultModel: isModelId(src.defaultModel)
        ? (src.defaultModel as ModelId)
        : DEFAULT_CONFIG.defaultModel,
      defaultSize:
        typeof src.defaultSize === 'string' && src.defaultSize.length > 0
          ? src.defaultSize
          : DEFAULT_CONFIG.defaultSize,
      defaultOrientation: isOrientation(src.defaultOrientation)
        ? (src.defaultOrientation as Orientation)
        : DEFAULT_CONFIG.defaultOrientation,
      footnote: typeof src.footnote === 'string' ? src.footnote.slice(0, 16) : DEFAULT_CONFIG.footnote,
    };
    return next;
  }

  // ── 私有：把字符串中的 ~ 展开为用户主目录 ──
  function expandHome(p: string): string {
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
      // path.join 会自动处理分隔符；只替换首个 ~，避免误伤路径中合法的 ~
      return path.join(os.homedir(), p.slice(1));
    }
    return p;
  }

  // ── 私有：原子写（先写 tmp，sync 后 rename；POSIX 上 rename 原子，Windows 上大致等价） ──
  async function atomicWrite(target: string, content: string): Promise<void> {
    await fs.writeFile(target + TMP_SUFFIX, content, 'utf8');
    try {
      await fs.rename(target + TMP_SUFFIX, target);
    } catch (err) {
      // rename 失败时清理 tmp，避免下次误读
      try {
        await fs.unlink?.(target + TMP_SUFFIX);
      } catch {
        /* swallow: tmp 可能已被某些 OS 自动清理 */
      }
      throw err;
    }
  }

  // ── 对外：load ──
  async function load(): Promise<void> {
    // 1. 先把 initial（manifest 默认值）合并到基线
    current = { ...DEFAULT_CONFIG, ...sanitize(initial) };

    // 2. 如果磁盘上有配置文件，磁盘优先于 initial
    let exists = false;
    try {
      exists = await fs.exists(configPath);
    } catch {
      exists = false;
    }
    if (exists) {
      try {
        const raw = await fs.readFile(configPath, 'utf8');
        // JSON 解析失败时保留基线，不让损坏的配置搞挂启动
        const parsed: unknown = JSON.parse(raw);
        current = sanitize({ ...current, ...sanitize(parsed) });
      } catch (err) {
        // 读取 / 解析失败：保留内存中的基线配置，并打日志
        // 故意不重抛——首启动场景下磁盘损坏不应阻塞插件激活
        log.warn('[config] 配置文件读取失败，使用默认值', err);
      }
    }
  }

  // ── 对外：get ──
  function get(): Readonly<PluginConfig> {
    // 返回冻结快照，避免 Slot 误改内部状态
    return Object.freeze({ ...current });
  }

  // ── 对外：update ──
  async function update(patch: Partial<PluginConfig>): Promise<Readonly<PluginConfig>> {
    // 仅白名单字段可被 patch，避免任何意外键进入磁盘
    const safePatch: Partial<PluginConfig> = {};
    for (const key of CONFIG_KEYS) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      // 单字段再走一次类型校验
      const single = sanitize({ [key]: value });
      (safePatch as Record<string, unknown>)[key] = single[key];
    }

    current = { ...current, ...safePatch };
    await atomicWrite(configPath, JSON.stringify(current, null, 2));
    return get();
  }

  // ── 对外：dispose ──
  async function dispose(): Promise<void> {
    // 当前实现无持久句柄（fs / path 都不持有），留位便于未来扩展
    // 例如加 LRU cache、定时 flush 之类时可在此释放
    current = { ...DEFAULT_CONFIG };
  }

  return { load, get, update, dispose };
}

// ──────────────────────────────────────────────────────────────
//  内部辅助：合法值校验（运行时收窄 unknown，避免 any）
// ──────────────────────────────────────────────────────────────

const MODEL_IDS = new Set<ModelId>(['hy-image-v3.5-preview', 'hy-image-v3']);
const ORIENTATIONS = new Set<Orientation>(['square', 'landscape', 'portrait', 'custom']);

/** 收窄 unknown 到 ModelId */
function isModelId(v: unknown): v is ModelId {
  return typeof v === 'string' && MODEL_IDS.has(v as ModelId);
}

/** 收窄 unknown 到 Orientation */
function isOrientation(v: unknown): v is Orientation {
  return typeof v === 'string' && ORIENTATIONS.has(v as Orientation);
}
