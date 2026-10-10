/**
 * 图库服务：用纯 JavaScript 的 JSON 文件持久化 GeneratedImage。
 *
 * 为什么不用原生数据库模块：它属于原生扩展，在 macOS 上会因应用代码签名 /
 * 强化运行时（dlopen "different Team IDs"）加载失败，且无法满足「全平台通用」
 * （mac / win / linux）的要求；因此改为零依赖的 JSON 文件存储。
 *
 * 设计要点：
 * 1. 存储格式：单个 JSON 文件 `<userData>/hunyuan-image-gallery.json`，
 *    结构为 `{ version: 1, images: GeneratedImage[] }`；init() 全量读入内存 Map，
 *    之后的读取（list / get / count）全部走内存，不触碰磁盘。
 *    - 不做增量索引：图库量级（数百~数千条）下，全量过滤 + 排序的性能完全够用，
 *      换取的是「无原生依赖、无迁移、文件可直接肉眼检查」。
 * 2. 原子写盘：先写 `<file>.tmp`，再 `rename` 覆盖目标文件（与 config.ts 一致）。
 *    rename 在同一文件系统内是原子的，因此崩溃时目标文件要么是旧内容、要么是新内容，
 *    不会出现「写了一半的 JSON」。
 * 3. 写盘节流：同一批（同一事件循环内）的多次变更合并成一次写盘。实现方式是
 *    「共享同一个 pendingFlush Promise」：首个变更创建写盘任务，其余变更只把自己
 *    标记为 dirty 并复用同一个 Promise，因此 `deleteBatch` 之类的批量操作只写一次盘。
 * 4. 查询过滤全部在内存完成：keyword 是大小写不敏感的子串匹配，覆盖 prompt /
 *    revisedPrompt / searchKeywords 三个字段（不再依赖数据库全文索引分词）。
 * 5. 排序稳定性：主字段相同时用 id 做次级排序（与主排序同向），
 *    保证 limit / offset 分页翻页时不重复、不遗漏。
 * 6. onKeywordDetected 保持 EventEmitter 订阅模式，返回 unsubscribe 函数。
 * 7. 任何磁盘异常都不阻塞插件激活：文件缺失 / JSON 损坏 / 记录非法时
 *    从空集合启动并 logger.warn，绝不 throw。
 */

import { EventEmitter } from 'node:events';
import * as path from 'node:path';

import type { Logger, FsAdapter, PathsAdapter } from './config.js';
import type { IStorageService } from './storage.js';
import type {
  IGalleryService,
  GeneratedImage,
  GalleryQuery,
  AssembledMessage,
} from '../types.js';

/**
 * 内部扩展接口：包含 IGalleryService 公开契约 + init/dispose/insert 等生命周期 / 写入方法。
 * 外部消费方（tool / context-detector）可依赖此扩展类型。
 */
export interface IGalleryServiceInternal extends IGalleryService {
  init(): Promise<void>;
  dispose(): Promise<void>;
  /** 内部写入方法：tools / hunyuan service 在生成后立即入库 */
  insert(image: GeneratedImage): Promise<void>;
}

// ──────────────────────────────────────────────────────────────
//  常量与内部类型
// ──────────────────────────────────────────────────────────────

/** 图库 JSON 文件名（放在 <userData> 下） */
const GALLERY_FILE_NAME = 'hunyuan-image-gallery.json';

/** 原子写用的临时文件名后缀 */
const TMP_SUFFIX = '.tmp';

/** 当前文件格式版本；后续若改结构可据此做迁移 */
const STORAGE_VERSION = 1;

/** 合法排序字段白名单：禁止按任意字段排序 */
const ORDER_BY_WHITELIST = new Set<string>(['createdAt', 'model', 'size']);

/** 排序字段联合类型 */
type SortField = 'createdAt' | 'model' | 'size';

/** 排序方向联合类型 */
type SortDirection = 'asc' | 'desc';

/** 磁盘 JSON 文件的顶层结构 */
interface GalleryFile {
  /** 格式版本 */
  version: number;
  /** 全量图片记录 */
  images: GeneratedImage[];
}

// ──────────────────────────────────────────────────────────────
//  工厂与对外类型
// ──────────────────────────────────────────────────────────────

export interface GalleryServiceDeps {
  fs: FsAdapter;
  paths: PathsAdapter;
  logger: Logger;
  /** 可选：传入 storage 以便 delete 时同步删本地文件 */
  storage?: IStorageService;
}

/**
 * 创建图库服务实例。
 *
 * @param deps 宿主文件系统 + 路径助手 + logger + 可选 storage
 */
export function createGalleryService(deps: GalleryServiceDeps): IGalleryServiceInternal {
  const { fs, paths, logger, storage } = deps;

  // 图库文件路径：<userData>/hunyuan-image-gallery.json
  const galleryPath = path.join(paths.userData(), GALLERY_FILE_NAME);

  // 内部 EventEmitter：onKeywordDetected 复用它
  const emitter = new EventEmitter();
  // 设置大监听上限：UI / context-detector 可能多订阅
  emitter.setMaxListeners(50);

  // 内存主存储：id → GeneratedImage；init() 时全量填充
  const images = new Map<string, GeneratedImage>();

  // init() 是否已执行：所有对外方法都要求先 init（与原实现抛错行为一致）
  let initialized = false;

  // 是否存在「尚未落盘」的内存变更
  let dirty = false;

  // 进行中 / 待执行的写盘任务；同一批变更共用同一个 Promise，实现写盘合并
  let pendingFlush: Promise<void> | null = null;

  // ── 私有：未 init 前置校验（与原实现同样的错误信息） ──
  function assertInitialized(): void {
    if (!initialized) throw new Error('gallery not initialized');
  }

  // ── 私有：复制一条记录，避免调用方拿到内部对象后误改内存状态 ──
  // 原 SQLite 实现每次查询都会重新构造对象，这里保持同样的隔离语义。
  function cloneImage(image: GeneratedImage): GeneratedImage {
    const copy: GeneratedImage = { ...image };
    if (image.assembledHistory) {
      try {
        copy.assembledHistory = JSON.parse(
          JSON.stringify(image.assembledHistory),
        ) as AssembledMessage[];
      } catch {
        // 理论上不会发生（多轮历史一定是 JSON 数据）；兜底保留浅拷贝引用即可
      }
    }
    return copy;
  }

  // ── 私有：把磁盘上的一条记录收窄成 GeneratedImage；无法识别时返回 null ──
  // 只校验定位所必需的两个字段（id / createdAt），其余字段视为可信
  // —— 文件由本插件自己写出，缺字段时 UI 侧各有兜底。
  function normalizeImage(raw: unknown): GeneratedImage | null {
    if (raw === null || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id !== 'string' || obj.id.length === 0) return null;
    if (typeof obj.createdAt !== 'number' || !Number.isFinite(obj.createdAt)) return null;
    return obj as unknown as GeneratedImage;
  }

  // ── 私有：把内存集合序列化成文件内容 ──
  // 使用 2 空格缩进：文件体积可接受，换来「人可读、可 diff、可手工修」。
  function serialize(): string {
    const payload: GalleryFile = {
      version: STORAGE_VERSION,
      images: Array.from(images.values()),
    };
    return JSON.stringify(payload, null, 2);
  }

  // ── 私有：原子写盘（先写 .tmp，再 rename 覆盖） ──
  async function atomicWrite(content: string): Promise<void> {
    const tmpPath = galleryPath + TMP_SUFFIX;
    await fs.writeFile(tmpPath, content, 'utf8');
    try {
      await fs.rename(tmpPath, galleryPath);
    } catch (err) {
      // rename 失败时清理 tmp，避免残留半截文件影响下次排查
      try {
        await fs.unlink?.(tmpPath);
      } catch {
        /* swallow：tmp 可能根本没创建成功 */
      }
      throw err;
    }
  }

  // ── 私有：请求写盘，并把同一批变更合并成一次落盘 ──
  //
  // 合并策略：
  // - pendingFlush 非空时说明本批已有写盘任务，此时只置 dirty 并复用同一个 Promise，
  //   调用方 await 到的仍是「这一批变更已全部落盘」的结果；
  // - 写盘循环结束后（dirty 为 false）才清空 pendingFlush；若写盘期间又发生变更，
  //   循环条件会在下一轮把最新状态再写一次。
  //
  // @returns 本批变更全部落盘后 resolve 的 Promise；写盘失败时 reject
  function scheduleFlush(): Promise<void> {
    dirty = true;
    if (pendingFlush) return pendingFlush;

    pendingFlush = (async () => {
      try {
        // 让出一次事件循环：同一 tick 内的多次变更因此被合并进同一次写盘
        await new Promise<void>((resolve) => setImmediate(resolve));
        while (dirty) {
          dirty = false;
          await atomicWrite(serialize());
        }
      } catch (err) {
        // 写盘失败不静默：记录日志后仍然向上抛，由调用方决定降级方式；
        // 内存状态保持最新，下次成功的写盘会连同这次失败的变更一起补上。
        logger.error(`[gallery] 图库写盘失败：${galleryPath}`, err);
        throw err;
      } finally {
        // 此处与 while 判断之间没有 await，不存在「新变更被漏掉」的窗口
        pendingFlush = null;
      }
    })();

    // 防止调用方未 await 时触发 unhandledRejection；错误仍会传递给 await 的调用方
    pendingFlush.catch(() => {
      /* 忽略：真正的错误处理在调用方 */
    });

    return pendingFlush;
  }

  // ── 私有：解析磁盘内容并填充内存集合（任何异常都不外抛） ──
  function loadFromParsed(parsed: unknown): void {
    if (parsed === null || typeof parsed !== 'object') {
      logger.warn('[gallery] 图库文件内容不是对象，按空图库启动');
      return;
    }
    const obj = parsed as Record<string, unknown>;

    if (obj.version !== STORAGE_VERSION) {
      // 版本不一致：不阻塞启动，按当前格式尽力读取（新版本字段会被忽略）
      logger.warn(
        `[gallery] 图库文件版本 ${String(obj.version)} 与当前版本 ${STORAGE_VERSION} 不一致，按当前格式尽力读取`,
      );
    }

    const list = obj.images;
    if (!Array.isArray(list)) {
      logger.warn('[gallery] 图库文件缺少 images 数组，按空图库启动');
      return;
    }

    let skipped = 0;
    for (const item of list) {
      const image = normalizeImage(item);
      if (image) {
        // 同一 id 出现多次时后者覆盖前者（文件损坏场景下的确定性行为）
        images.set(image.id, image);
      } else {
        skipped += 1;
      }
    }
    if (skipped > 0) {
      logger.warn(`[gallery] 已跳过 ${skipped} 条无法识别的图库记录`);
    }
  }

  // ── 对外：init（建目录 + 全量读入内存） ──
  async function init(): Promise<void> {
    // 确保 userData 目录存在（首次启动时可能还没有）
    await fs.mkdir(paths.userData(), { recursive: true });

    // 重置内存状态：init 可被重复调用（例如服务重建）
    images.clear();
    dirty = false;

    try {
      let exists = false;
      try {
        exists = await fs.exists(galleryPath);
      } catch {
        exists = false;
      }

      if (exists) {
        const raw = await fs.readFile(galleryPath, 'utf8');
        // JSON.parse 失败会抛错，由外层 catch 统一降级为空图库
        loadFromParsed(JSON.parse(raw) as unknown);
      }
    } catch (err) {
      // 读取 / 解析失败：从空集合开始，绝不阻塞插件激活
      logger.warn('[gallery] 图库文件读取或解析失败，按空图库启动', err);
      images.clear();
    }

    initialized = true;
    logger.info?.(`[gallery] 图库已就绪：${galleryPath}（${images.size} 张）`);
  }

  // ── 私有：关键词匹配（大小写不敏感子串，覆盖三个字段） ──
  function matchesKeyword(image: GeneratedImage, lowerKeyword: string): boolean {
    const inPrompt = image.prompt?.toLowerCase().includes(lowerKeyword);
    const inRevised = image.revisedPrompt?.toLowerCase().includes(lowerKeyword);
    const inKeywords = image.searchKeywords?.toLowerCase().includes(lowerKeyword);
    return Boolean(inPrompt || inRevised || inKeywords);
  }

  // ── 私有：字符串比较（按 UTF-16 码元，等价于 SQLite 的 BINARY 排序） ──
  function compareString(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  // ── 私有：按排序字段比较两条记录 ──
  function compareField(a: GeneratedImage, b: GeneratedImage, field: SortField): number {
    if (field === 'createdAt') {
      if (a.createdAt === b.createdAt) return 0;
      return a.createdAt < b.createdAt ? -1 : 1;
    }
    if (field === 'model') return compareString(a.model, b.model);
    return compareString(a.size, b.size);
  }

  // ── 私有：完整比较器（主字段 + id 次级排序，保证分页稳定） ──
  function compareImages(
    a: GeneratedImage,
    b: GeneratedImage,
    field: SortField,
    dir: SortDirection,
  ): number {
    const sign = dir === 'asc' ? 1 : -1;
    const primary = compareField(a, b, field);
    if (primary !== 0) return primary * sign;
    // 主字段相同：用 id 做次级排序（与主排序同向），使排序结果全局确定
    return compareString(a.id, b.id) * sign;
  }

  // ── 私有：归一化 limit（未指定 → 返回全部） ──
  // 注意：对外契约要求「不传 limit 时返回全部」，因此这里不做 500 条上限截断；
  // 调用方需要分页时自行传 limit（如 UI 的 PAGE_SIZE）。
  function normalizeLimit(limit: unknown): number | undefined {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) return undefined;
    return Math.max(0, Math.floor(limit));
  }

  // ── 私有：归一化 offset（负数 / 非法值一律按 0 处理） ──
  function normalizeOffset(offset: unknown): number {
    if (typeof offset !== 'number' || !Number.isFinite(offset)) return 0;
    return Math.max(0, Math.floor(offset));
  }

  // ── 对外：list（内存过滤 + 稳定排序 + 分页） ──
  async function list(query: GalleryQuery): Promise<GeneratedImage[]> {
    assertInitialized();

    // 关键词：空串 / 纯空白视为不过滤；匹配前统一转小写
    const keywordRaw = query.keyword;
    const lowerKeyword =
      typeof keywordRaw === 'string' && keywordRaw.trim().length > 0
        ? keywordRaw.trim().toLowerCase()
        : undefined;

    // 排序参数：白名单校验 + 默认值（与原实现一致，非法值直接抛错）
    const orderBy: SortField = query.orderBy ?? 'createdAt';
    if (!ORDER_BY_WHITELIST.has(orderBy)) {
      throw new Error(`非法 orderBy: ${String(orderBy)}`);
    }
    const orderDir: SortDirection = query.orderDir ?? 'desc';
    if (orderDir !== 'asc' && orderDir !== 'desc') {
      throw new Error(`非法 orderDir: ${String(orderDir)}`);
    }

    // 1. 过滤
    const matched: GeneratedImage[] = [];
    for (const image of images.values()) {
      if (lowerKeyword !== undefined && !matchesKeyword(image, lowerKeyword)) continue;
      if (query.model !== undefined && image.model !== query.model) continue;
      if (query.since !== undefined && image.createdAt < query.since) continue;
      if (query.until !== undefined && image.createdAt > query.until) continue;
      matched.push(image);
    }

    // 2. 排序（Array.prototype.sort 稳定，配合 id 次级排序即可保证分页确定性）
    matched.sort((a, b) => compareImages(a, b, orderBy, orderDir));

    // 3. 分页：limit 未指定时返回剩余全部
    const offset = normalizeOffset(query.offset);
    const limit = normalizeLimit(query.limit);
    const page = limit === undefined ? matched.slice(offset) : matched.slice(offset, offset + limit);

    // 4. 返回副本，隔离内存状态
    return page.map(cloneImage);
  }

  // ── 对外：get（按 id 查单张） ──
  async function get(id: string): Promise<GeneratedImage | null> {
    assertInitialized();
    const image = images.get(id);
    return image ? cloneImage(image) : null;
  }

  // ── 对外：insert（内部用；外部通常走 storage→hunyuan→gallery 路径） ──
  async function insert(image: GeneratedImage): Promise<void> {
    assertInitialized();
    // 与原 SQLite 主键约束保持一致：同一 id 重复入库视为调用方错误
    if (images.has(image.id)) {
      throw new Error(`图片已存在：${image.id}`);
    }
    // 存入副本：外部后续改动入参对象不应影响图库
    images.set(image.id, cloneImage(image));
    await scheduleFlush();
  }

  // ── 私有：删除单条（内存 + 落盘 + 尽力删本地文件） ──
  async function deleteOne(id: string): Promise<void> {
    assertInitialized();
    const image = images.get(id);
    if (!image) return; // 幂等：不存在就不报错（与原实现一致）
    // 1. 删内存条目并原子写盘
    images.delete(id);
    await scheduleFlush();
    // 2. 尽力删本地图片文件：失败只 warn，不影响图库记录已删除的事实
    if (storage) {
      try {
        await storage.deleteLocal(image.localPath);
      } catch (err) {
        logger.warn(`[gallery] 删除本地文件失败 ${image.localPath}`, err);
      }
    }
  }

  // ── 对外：delete（暴露的删除方法；delete 是保留字，所以用别名定义） ──
  async function deleteImage(id: string): Promise<void> {
    await deleteOne(id);
  }

  // ── 对外：deleteBatch（一次写盘 + 尽力删本地文件） ──
  async function deleteBatch(ids: string[]): Promise<void> {
    assertInitialized();
    if (ids.length === 0) return;

    // 1. 先在内存里删完（不存在的 id 静默跳过），再统一写一次盘
    const removed: GeneratedImage[] = [];
    for (const id of ids) {
      const image = images.get(id);
      if (!image) continue;
      images.delete(id);
      removed.push(image);
    }
    if (removed.length === 0) return;
    await scheduleFlush();

    // 2. 尽力删本地文件：逐个 try/catch，单个失败不影响其余文件
    if (storage) {
      for (const image of removed) {
        try {
          await storage.deleteLocal(image.localPath);
        } catch (err) {
          logger.warn(`[gallery] 删除本地文件失败 ${image.localPath}`, err);
        }
      }
    }
  }

  // ── 对外：count（UI 角标用） ──
  async function count(): Promise<number> {
    assertInitialized();
    return images.size;
  }

  // ── 对外：onKeywordDetected（EventEmitter 订阅模式） ──
  function onKeywordDetected(
    handler: (context: { keyword: string; messageId: string }) => void,
  ): () => void {
    // 监听器签名：handler({ keyword, messageId })
    emitter.on('keyword', handler);
    // 返回 unsubscribe
    return () => emitter.off('keyword', handler);
  }

  // ── 对外：dispose（清监听器 + 释放内存集合） ──
  async function dispose(): Promise<void> {
    // 先等待进行中的写盘结束：否则清空内存集合后，待执行的 flush 会把空图库写上磁盘
    if (pendingFlush) {
      try {
        await pendingFlush;
      } catch (err) {
        logger.warn('[gallery] dispose 等待写盘失败', err);
      }
    }
    emitter.removeAllListeners();
    images.clear();
    dirty = false;
    initialized = false;
  }

  // delete 是 JS 保留字；用属性名显式映射到内部函数
  return {
    init,
    insert, // 内部用：tool 调用完成后同步入库
    list,
    get,
    delete: deleteImage,
    deleteBatch,
    count,
    onKeywordDetected,
    dispose,
  };
}
