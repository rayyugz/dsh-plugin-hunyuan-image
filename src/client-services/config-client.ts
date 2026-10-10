/**
 * 客户端 Config 客户端。
 *
 * 与 hunyuan-client 同走 /hunyuan/api/config.get 与 hunyuan.updateConfig 端点，
 * 但提供一个**同步 get()**接口（slots 用的 props.config 是同步取值，且
 * IHunyuanService.getConfig 也是同步签名 —— 本包装必须匹配）。
 *
 * 实现策略：内部缓存 + 异步首拉 + update 时同步更新缓存。
 * 加载竞态：slots 第一次渲染时 cache 已是初始空配置；首拉完成后若用户
 * 还没交互，则 props.config 会随 client.ts 的 onConfigChange 触发而被
 * 外部注入器重新计算（参考 client.ts 的 effect 写法）。
 */

import type { PluginConfig } from '../types.js';
import { HunyuanRpcError, call } from './rpc.js';

export interface IConfigClient {
  /** 当前缓存（同步）。初始调用为 host 的 default；首拉后为真实值。 */
  get(): PluginConfig;
  /** 部分更新：POST 到 host，同步刷新本地缓存，返回最新值。 */
  update(patch: Partial<PluginConfig>): Promise<PluginConfig>;
}

function emptyConfig(): PluginConfig {
  return {
    apiKey: '',
    storagePath: '',
    defaultModel: 'hy-image-v3.5-preview',
    defaultSize: '1024x1024',
    defaultOrientation: 'square',
    footnote: '',
  };
}

export function createConfigClient(): IConfigClient {
  let cached: PluginConfig = emptyConfig();

  // 首拉（fire-and-forget，失败忽略 —— slots 通过 props.config 拿到的初始
  // 值是空配置；onConfigChange 触发的下一次 get 才是真实配置）
  void call<PluginConfig>('config.get', {})
    .then((c: PluginConfig) => {
      cached = c;
    })
    .catch((e: unknown) => {
      // 首拉失败：记到 console，但不让 client 启动失败
      // eslint-disable-next-line no-console
      console.warn('[hunyuan-client] config.get failed:', e);
    });

  return {
    get(): PluginConfig {
      return cached;
    },
    async update(patch: Partial<PluginConfig>): Promise<PluginConfig> {
      try {
        const next = await call<PluginConfig>('hunyuan.updateConfig', patch);
        cached = next;
        return next;
      } catch (e) {
        if (e instanceof HunyuanRpcError) throw e;
        throw e;
      }
    },
  };
}
