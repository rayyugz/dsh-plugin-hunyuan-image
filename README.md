# 腾讯混元生图 · DSH 原生插件

> 把腾讯混元的 **Hy-Image-3.5-preview** 与 **Hy-Image-3.0** 接入 [DSH（DeepSeek Harness）](https://deepseek.com)，
> 提供生成面板、本地图库、官方两段式尺寸选择与批量生图。**零原生依赖，macOS / Windows / Linux 通用。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: ≥20](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)

---

## ✨ 功能

- **双模型**
  - `hy-image-v3.5-preview`：Chat/Messages 协议，支持多模态输入、多轮编辑、思维链改写，最高 **4K（4096×4096）** 输出
  - `hy-image-v3`：经典文生图，支持提示词自动改写与官方 37 组预设尺寸
- **官方两段式尺寸选择**：**分辨率档位 × 比例**（与腾讯 TokenHub 网页端一致的交互），
  插件自动换算为 API 所需的 `WxH`，并保证落在官方约束内（v3.5 边长 [256,8192]、面积 ≤ 16777216；v3.0 边长 [512,2048]、面积 ≤ 1048576）
- **批量生图**：一次生成 **1 / 2 / 4 张**，并行发起，结果逐张展示并带 `1/4` 序号角标
- **本地图库**
  - 生图成功**自动入库**（纯 JS 的 JSON 存储，零原生依赖）
  - 网格 / 列表两种视图，支持关键词搜索与按模型、时间范围筛选
  - 缩略图 + 详情侧栏（提示词 / 模型 / 尺寸 / 时间 / 本地路径）
  - **再次生图**：一键回填原提示词与参数
  - 多选批量删除、删除时同步清理本地文件
- **自定义图片保存路径**：默认 `~/Pictures/DSH-Hunyuan-Image`，可改为任意位置（建议非系统盘），
  **改完立即生效、无需重启插件**；按 `<保存路径>/<年-月>/` 月份分桶归档，避免单目录堆积
- **官方高级参数**（本次会话内有效，不做持久化）
  - 生成种子 `seed`
  - 水印脚注 `footnote`（≤16 字符，生成在图片右下角）
  - 外部搜索增强 `use_search_tool`（仅 v3.5）
  - 参考图面积上限 `resize_max_pixels`（仅 v3.5，控制大图带来的 token 消耗）
  - 提示词自动改写 `revise`（仅 v3.0）
- **参考图输入**：支持本地上传（自动转 data URL）与公网 URL
- **模型可直调**：向 DSH 注册 `hunyuan_generate_image` 工具，对话中模型可自主调用生图
- **图片永久保存**：腾讯返回的远程 URL 仅 12 小时有效，插件在生成成功时**立刻下载到本地**

> 📌 **尚未实现的功能**见下方 [已知限制与路线图](#-已知限制与路线图)。
> 本 README 只描述**当前版本实际可用**的能力。

---

## 📦 安装

### 方式一：从 Release 安装（推荐，不需要编译）

1. 到本仓库的 [**Releases**](../../releases) 页面下载 `dsh-plugin-hunyuan-image-1.0.0.tgz`
2. 解压到一个固定目录，例如 `~/dsh-plugins/`：

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   ```

3. 在 DSH 的对话框里对 AI 说：

   > 请把 `~/dsh-plugins/package` 安装为 DSH 插件（用 plugin_manager 的 install_bundle）

4. 重启 DSH

> 更详细的重装 / 换机步骤见 [**INSTALL.md**](INSTALL.md)。

### 方式二：从源码构建（开发者）

需要 **Node ≥ 20** 与 **pnpm**。

```bash
git clone https://github.com/rayyugz/dsh-plugin-hunyuan-image.git
cd dsh-plugin-hunyuan-image

pnpm install
pnpm build                        # 编译 host 半 + 打包 client 半
node scripts/smoke-activate.mjs   # 冒烟测试，应输出「全部通过」

# 链接到 DSH profile
# macOS / Linux:
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image
# Windows（PowerShell，管理员）:
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"
```

然后把插件名加进 profile 的 `package.json`（`dependencies` 与 `dsh.profile.bundles` 两处），重启 DSH。

---

## ⚙️ 配置

### 1. 获取 API Key

1. 注册/登录 [腾讯云](https://cloud.tencent.com)
2. 开通 [TokenHub 服务](https://console.cloud.tencent.com/tokenhub)
3. 在 [API Key 管理页](https://console.cloud.tencent.com/tokenhub/apikey) 新建一个 Key
4. 在 [在线推理-视觉模型](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION) 开启 `hy-image-v3.5-preview` 与 `hy-image-v3` 的后付费

### 2. 在 DSH 里填配置

打开 DSH → 右侧「混元生图」面板 → 右上角「⚙ 设置」：

| 字段 | 说明 | 默认 |
|---|---|---|
| **API Key** | 上面获取的 Key | — |
| **图片保存路径** | 用户自定义，建议非系统盘 | `~/Pictures/DSH-Hunyuan-Image` |
| **默认模型** | `hy-image-v3.5-preview` 或 `hy-image-v3` | v3.5-preview |
| **默认尺寸** | 见下方"尺寸说明" | `1024x1024` |
| **默认方向** | 方形 / 横版 / 竖版 / 自定义 | 方形 |
| **水印脚注** | ≤16 字符，生成在图片右下角 | 空 |

填完点「保存」→ 再点「🔌 测试连接」验证 Key 有效（会调 `listModels()`）。

---

## 🖼 尺寸说明

### Hy-Image-3.5-preview（推荐）

| 档位 | 范围 | 说明 |
|---|---|---|
| 宽 × 高 | [256, 8192] | 任意尺寸 |
| 面积 | ≤ 16,777,216（4K = 4096×4096）| 最高 4K 输出 |
| 常用预设 | `1024x1024` / `2048x1024` / `1024x2048` / `4096x4096` | — |
| 不传 size | 由模型按 prompt 语义自主决定（默认 1.5K 档） | — |
| 面积档位（`generateMaxPixels`）| 1K (1048576) / 1.5K (2359296) / 2K (4194304) | 最高 2K；要 4K 必须传 `size` |

### Hy-Image-3.0

| 档位 | 范围 | 说明 |
|---|---|---|
| 宽 × 高 | [512, 2048] | 37 组预设可选 |
| 面积 | ≤ 1024×1024 | 不可超过 |

---

## 📚 图库使用

| 操作 | 怎么用 |
|---|---|
| **搜索** | 顶部搜索框（debounce 300ms，匹配 prompt / 改写后提示词 / 关键词） |
| **筛选** | 按模型、时间范围筛选 |
| **多选** | 卡片左上角 checkbox，或 hover 浮层 |
| **批量删除** | 选中后顶部出现批量操作条 |
| **单图查看** | 卡片 hover 浮层，或点开详情侧栏 |
| **再次生图** | 详情侧栏的 🔁 按钮，自动切回生成面板并回填提示词与参数 |
| **复制提示词** | 详情侧栏的 📋 按钮，写入剪贴板 |
| **复制图片** | 详情侧栏的 🖼 按钮，写入剪贴板（浏览器不支持 `ClipboardItem` 时降级为复制本地路径） |

---

## ⚠️ 已知限制与路线图

### 限制（受腾讯 API 或 DSH 宿主能力约束）

| 项 | 说明 |
|---|---|
| **远程图片 URL 有效期** | 仅 12 小时——本插件已**在生成成功时立刻下载到本地**，图库中的图片是永久的 |
| **参考图大小** | v3.5 ≤ 20MB/张；v3.0 ≤ 10MB/张 |
| **参考图数量** | v3.5 ≤ 20 张；v3.0 ≤ 3 张 |
| **水印脚注** | ≤ 16 个 utf8 字符 |
| **`generate_max_pixels` 最高 2K** | 要出更高分辨率必须用 `size` 精确指定（本插件通过「分辨率」档位实现） |
| **多轮编辑** | 仅 v3.5 支持；本插件会保存服务端返回的 `assembled_history`，但尚未提供多轮编辑的界面入口 |
| **高级参数不持久化** | 种子 / 水印以外的三个高级参数（外部搜索、参考图上限、自动改写）**仅在本次会话内有效**，重新打开面板会回到默认值。这是刻意设计，避免留下难以排查的隐藏状态 |

### 尚未实现（路线图）

| 功能 | 现状 | 原因 |
|---|---|---|
| **对话中提到「图库」自动弹按钮** | ❌ 未实现 | 需要监听会话消息事件并在消息旁注入 Action Button，v1.0 未接入 |
| **导出 / 另存为对话框** | ⚠️ 占位 | DSH 尚未向插件暴露「另存为」对话框；调用会返回明确原因而非静默失败 |
| **微信 / 飞书分享** | ⚠️ 占位 | DSH 尚未向插件暴露 IM 分享通道；同上 |
| **拖拽图片到对话** | ❌ 未实现 | 依赖 DSH 暴露拖拽事件 |
| **多轮编辑界面** | ❌ 未实现 | 数据层已就绪（`assembledHistory`），缺 UI |
| **DSH 官方插件市场** | ❌ 未发布 | 需 DSH 团队审核接入 |

欢迎通过 [Issue](../../issues) 反馈或提交 PR 一起完善。

---

## 🛠 开发

### 项目结构

```
dsh-plugin-hunyuan-image/
├── package.json              # 插件 manifest（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml          # Cordis 加载器 patch：声明 host 插件行
├── icon.svg / locale/        # 显示元数据（图标 + 中英标题/描述）
├── scripts/
│   ├── build-client.mjs      # 把 TS/TSX 打包成 DSH 客户端模块表格式
│   └── smoke-activate.mjs    # 激活冒烟测试（重启前先跑一遍）
├── src/
│   ├── server.ts             # ★ Host 半：Cordis 插件入口（apply + inject）
│   ├── client.ts             # ★ Client 半：注册 composer dock + 面板浮层
│   ├── types.ts              # 跨模块数据结构契约
│   ├── size-presets.ts       # 分辨率档位 + 比例 → "WxH" 换算（含约束校验）
│   ├── host/
│   │   └── routes.ts         # Host HTTP 端点：/hunyuan/api/* 与 /hunyuan/file
│   ├── client-services/
│   │   ├── rpc.ts            # 前端 → host 的 fetch 封装
│   │   ├── config-client.ts  # 配置缓存 + 更新
│   │   ├── bus.ts            # 事件总线（目录选择、文件选择等真实接线）
│   │   └── file-url.ts       # 本地图片 → 可加载 URL
│   ├── services/
│   │   ├── config.ts         # 配置持久化（JSON，原子写）
│   │   ├── storage.ts        # 本地文件管理 + 图片下载（路径实时跟随配置）
│   │   ├── hunyuan.ts        # 混元 API 网关（v3 + v3.5）
│   │   └── gallery.ts        # JSON 图库（内存索引 + 原子写盘，无原生依赖）
│   └── slots/
│       ├── generator-panel.tsx   # 生成面板（浮层「生成」标签）
│       ├── gallery-panel.tsx     # 图库面板（浮层「图库」标签）
│       └── settings-panel.tsx    # 设置面板（浮层「设置」标签）
├── README.md
└── LICENSE
```

### 架构要点

- **双 entry**：`dist/server.js` 是 Host 半（Node.js 进程），`dist/client.js` 是
  Client 半（浏览器）。后者必须是 `window.__ModuleLoader__.load({id, factory})`
  格式，由 `scripts/build-client.mjs` 用 esbuild 生成，并强制把 JSX 编译成
  `React.createElement`（DSH 模块表只提供 `React`，不提供 `react/jsx-runtime`）。
- **UI 入口**：客户端只注册一个 `conversation.composer.dock` 槽位（按钮），
  点击后弹出包含「生成 / 图库 / 设置」三个标签的浮层。
- **前后端通信**：Client 通过 `fetch('/hunyuan/api/<method>')` 调用 Host；
  图片通过 `/hunyuan/file?path=<绝对路径>` 回送（只允许读取保存目录内的文件）。
- **零原生依赖**：图库用 JSON 文件而非 SQLite，因此在 macOS 代码签名/强化运行时
  下也能加载，并且 Windows / Linux 无需重新编译。

### 本地构建

```bash
pnpm install
pnpm build         # tsc → dist/
pnpm test          # vitest
pnpm lint          # tsc --noEmit
```

### 调试模式

在 DSH 启动命令加 `--plugin-debug=hunyuan-image` 即可看到详细日志。

---

## 🤝 贡献

欢迎 issue 和 PR！

- 🐛 发现 bug → [提 issue](https://github.com/rayyugz/dsh-plugin-hunyuan-image/issues/new?template=bug.md)
- 💡 有新想法 → [提 feature request](https://github.com/rayyugz/dsh-plugin-hunyuan-image/issues/new?template=feature.md)
- 🔧 修代码 → fork → PR

### Roadmap

- [ ] 多轮编辑可视化（v3.5 session 链路 UI）
- [ ] 标签系统（用户自定义标签 + 自动从 prompt 提取）
- [ ] 云端图库备份（可选 OSS/COS）
- [ ] 接入其他腾讯系模型（如 hunyuan-vision）

---

## 📄 许可证

MIT © [rayyugz](https://github.com/rayyugz)

---

## 🙏 致谢

- 腾讯混元团队提供 API
- DSH 团队提供插件平台
- 所有 issue 反馈者
