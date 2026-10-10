# 腾讯混元生图 · DSH 原生插件

Languages: [English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português](README.pt.md) · [Español](README.es.md) · [Русский](README.ru.md)

> 把腾讯混元的 **Hy-Image-3.5-preview** 与 **Hy-Image-3.0** 接入
> [DSH（DeepSeek Harness）](https://deepseek.com) —— 提供生成面板、本地图库、
> 官方两段式尺寸选择与批量生图。
> **零原生依赖，macOS / Windows / Linux 通用。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: ≥20](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![CI](https://github.com/rayyugz/dsh-plugin-hunyuan-image/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

---

## ✨ 功能

- **双模型**
  - `hy-image-v3.5-preview` —— Chat/Messages 协议；多模态输入、多轮编辑、
    思维链改写；最高支持 **4K（4096×4096）** 输出
  - `hy-image-v3` —— 经典文生图；提示词自动改写与官方 37 组预设尺寸
- **官方两段式尺寸选择** —— **分辨率档位 × 比例**，与腾讯 TokenHub 网页端一致的交互。
  插件会把你的选择换算成 API 所需的 `WxH` 字符串，
  并保证它满足官方约束
  （v3.5：边长 ∈ [256, 8192]，面积 ≤ 16,777,216；v3.0：边长 ∈ [512, 2048]，面积 ≤ 1,048,576）。
  界面上会显示实际将发送的精确尺寸。
- **批量生图** —— 一次请求生成 **1 / 2 / 4 张**（并行发起）；
  结果逐张展示并带 `1/4` 序号角标，部分失败会明确说明。
- **本地图库**
  - 每次生成成功都**自动入库**（纯 JS 的 JSON 存储 —— 无 SQLite，无原生模块）
  - **缩略图网格**与列表两种视图
  - **关键词搜索**（匹配提示词与改写后提示词），并可按模型、时间范围筛选
  - **详情侧栏**，展示完整提示词、模型、尺寸、时间戳与本地路径
  - **🔁 再次生图** —— 一键回填原提示词与参数
  - 多选**批量删除**（同时清理本地文件）、复制提示词、复制图片
- **自定义输出文件夹** —— 默认为 `~/Pictures/DSH-Hunyuan-Image`，也可以指向
  任意位置（建议使用非系统盘）。点 **「选择…」** 会打开系统原生文件夹选择器。
  **改完立即生效，无需重启插件。** 文件按月份分桶存放在
  `<文件夹>/<YYYY-MM>/` 下，避免单目录堆积上千个文件。
- **官方高级参数**（刻意限定为会话级 —— 见 [已知限制与路线图](#️-已知限制与路线图)）

  | 参数 | 适用模型 | 说明 |
  |---|---|---|
  | 随机种子 `seed` | 两者 | 复现同一结果 |
  | 水印脚注 `footnote` | 两者 | ≤ 16 字符，渲染在右下角 |
  | 外部搜索增强 `use_search_tool` | v3.5 | 让模型先联网搜索再作画 |
  | 参考图面积上限 `resize_max_pixels` | v3.5 | 限制大尺寸（4K/6K）参考图的 token 消耗 |
  | 提示词自动改写 `revise` | v3.0 | 会增加约 11 秒；建议默认开启 |

- **参考图** —— 支持从磁盘上传（自动转为 data URL）或直接传公网 URL。
  v3.5 最多 20 张（每张 ≤ 20 MB）；v3.0 最多 3 张（每张 ≤ 10 MB）。
- **模型可直调** —— 插件注册了 **`hunyuan_generate_image`** 工具，你只要
  在对话里说「画一只猫」，模型就会调用它。
- **图片永久有效** —— 腾讯的远程 URL **12 小时**后过期；插件会在生成后立即把
  每张图片下载到本地，因此图库条目永远不会失效。

> 📌 尚未实现的功能已如实列在
> [已知限制与路线图](#️-已知限制与路线图)。
> 本 README 只描述当前版本实际具备的能力。

---

## 📦 安装

### 方式一 —— 从 Release 安装（推荐，无需构建）

1. 从 [**Releases**](../../releases) 页面下载 `dsh-plugin-hunyuan-image-1.0.0.tgz`。
2. 解压到一个固定目录，例如 `~/dsh-plugins/`：

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   ```

3. 在 DSH 对话里对助手说：

   > 请把 `~/dsh-plugins/package` 安装为 DSH 插件（用 `plugin_manager` 的 `install_bundle`）。

4. 重启 DSH。

> 重装 / 换机的分步说明见 [**INSTALL.md**](INSTALL.md)
> （另有 [简体中文](INSTALL.zh-CN.md) 版本）。

### 方式二 —— 从源码构建（开发者）

需要 **Node ≥ 20** 与 **pnpm**。

```bash
git clone https://github.com/rayyugz/dsh-plugin-hunyuan-image.git
cd dsh-plugin-hunyuan-image

pnpm install
pnpm build                        # 编译 host 半 + 打包 client 半
node scripts/smoke-activate.mjs   # 冒烟测试 —— 应输出 "全部通过"

# 链接到 DSH profile
# macOS / Linux:
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image
# Windows（PowerShell，管理员）:
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"
```

然后把插件名加进该 profile 的 `package.json`（`dependencies` 与
`dsh.profile.bundles` 两处），并重启 DSH。

---

## ⚙️ 配置

### 1. 获取 API Key

1. 在 [腾讯云](https://cloud.tencent.com) 注册 / 登录
2. 开通 [TokenHub 服务](https://console.cloud.tencent.com/tokenhub)
3. 在 [API Key 页面](https://console.cloud.tencent.com/tokenhub/apikey) 创建一个 Key —— 形如 `sk-...`
4. 在
   [在线推理 → 视觉模型](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION) 下为 `hy-image-v3.5-preview` 与 `hy-image-v3` 开启**后付费**

### 2. 填写插件设置

打开插件面板（composer 下方的 **🖼 Hunyuan Image** 按钮）→ **设置** 标签：

| 字段 | 说明 | 默认 |
|---|---|---|
| **API Key** | 上面创建的 Key | — |
| **输出文件夹** | 任意位置均可；建议使用非系统盘 | `~/Pictures/DSH-Hunyuan-Image` |
| **默认模型** | `hy-image-v3.5-preview` 或 `hy-image-v3` | v3.5-preview |
| **默认分辨率** | 见 [尺寸](#-尺寸) | `1K` |
| **默认比例** | 见 [尺寸](#-尺寸) | `1:1` |
| **水印脚注** | ≤ 16 字符，位于右下角 | 空 |

点 **保存**，再点 **🔌 测试连接** 验证 Key 是否可用。

> ⚠️ **注意**：图片存放在**月份子文件夹**下，例如
> `AI-images/2026-10/1791629683045-xxxx.png` —— 而不是直接放在文件夹根目录。

---

## 🖼 尺寸

插件复刻了官方 TokenHub 选择器：先选一个**分辨率档位**，再选一个**比例**。

### Hy-Image-3.5-preview

| 档位 | 比例 | 说明 |
|---|---|---|
| `1K` / `1.5K` / `2K` | `21:9` `16:9` `4:3` `1:1` `2:3` `3:2` `3:4` `9:16` | 面积约 1M / 2.36M / 4.19M px |
| `4K` | 同上 | 面积 ≤ 16,777,216 px；例如 16:9 → `5461x3072` |
| `Auto` | — | 不传 `size`，由模型自行决定 |

### Hy-Image-3.0

| 档位 | 比例 | 说明 |
|---|---|---|
| `720P` / `1K` | `1:1` `3:4` `4:3` `9:16` `16:9` `3:5` `5:3` | 必须满足边长 ∈ [512, 2048] 且面积 ≤ 1,048,576 |
| `Auto` | — | 模型从官方 37 组预设中挑选 |

**尺寸速查**（实际发送的内容）：

```
v3.5  1K   16:9 = 1365x768      1:1 = 1024x1024
      2K   16:9 = 2731x1536     1:1 = 2048x2048
      4K   16:9 = 5461x3072     1:1 = 4096x4096
v3.0  720P 16:9 = 1280x720      1:1 = 960x960
      1K   16:9 = 1365x768      1:1 = 1024x1024
```

全部 62 种组合都会按官方约束做程序化校验。

---

## 📚 图库使用

| 操作 | 怎么用 |
|---|---|
| **搜索** | 顶部搜索框（300 ms 防抖；匹配提示词 / 改写后提示词 / 关键词） |
| **筛选** | 按模型、按时间范围 |
| **多选** | 卡片上的复选框，或通过 hover 浮层 |
| **批量删除** | 选中条目后，顶部会出现批量操作条 |
| **单图查看** | hover 浮层，或打开详情侧栏 |
| **再次生图** | 详情侧栏的 🔁 —— 切回生成面板并回填提示词与参数 |
| **复制提示词** | 详情侧栏的 📋 |
| **复制图片** | 详情侧栏的 🖼（浏览器不支持 `ClipboardItem` 时降级为复制本地路径） |

---

## ⚠️ 已知限制与路线图

### 限制（来自腾讯 API 或 DSH 宿主）

| 项 | 说明 |
|---|---|
| **远程图片 URL 有效期** | 仅 12 小时 —— 本插件会立即把每张图片下载到本地，因此图库条目是永久的 |
| **参考图大小** | v3.5 每张 ≤ 20 MB；v3.0 每张 ≤ 10 MB |
| **参考图数量** | v3.5 ≤ 20；v3.0 ≤ 3 |
| **水印脚注** | ≤ 16 个 UTF-8 字符 |
| **`generate_max_pixels` 最高只到 2K** | 更高分辨率必须走 `size`（本插件通过分辨率档位实现） |
| **多轮编辑** | 仅 v3.5 支持。插件会保存服务端返回的 `assembled_history`，但尚无多轮编辑的界面 |
| **高级参数不做持久化** | 外部搜索、参考图面积上限与自动改写这三个开关**仅在本次会话内有效**，重新打开面板即恢复默认。这是刻意设计 —— 避免留下日后难以排查的隐藏状态 |

### 尚未实现

| 功能 | 现状 | 原因 |
|---|---|---|
| **提到图库时自动弹出「打开图库」按钮** | ❌ | 需要监听会话消息事件并注入操作按钮；v1.0 未接入 |
| **导出 / 另存为对话框** | ⚠️ 占位 | DSH 尚未向插件暴露「另存为」对话框；调用会返回明确原因，而不是静默失败 |
| **微信 / 飞书分享** | ⚠️ 占位 | DSH 尚未向插件暴露 IM 分享通道 |
| **把图片拖进对话** | ❌ | 依赖 DSH 暴露拖拽事件 |
| **多轮编辑界面** | ❌ | 数据层已就绪（`assembledHistory`），只缺 UI |
| **DSH 官方插件市场** | ❌ | 需要 DSH 团队审核 |
| **面板界面多语言** | ❌ | 面板内的界面目前**只有中文**；插件的标题/描述已本地化（中/英），但面板里的控件文字尚未国际化。本仓库的多语言 README 只是过渡方案 |

非常欢迎反馈与 PR —— 请开一个 [Issue](../../issues)。

---

## 🛠 开发

### 项目结构

```
dsh-plugin-hunyuan-image/
├── package.json              # 插件 manifest（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml          # Cordis 加载器 patch：声明 host 插件行
├── icon.svg / locale/        # 显示元数据（图标 + 中英标题与描述）
├── scripts/
│   ├── build-client.mjs      # 把 TS/TSX 打包成 DSH 客户端模块表格式
│   └── smoke-activate.mjs    # 激活冒烟测试（重启 DSH 前先跑一遍）
├── src/
│   ├── server.ts             # ★ Host 半：Cordis 插件入口（apply + inject）
│   ├── client.ts             # ★ Client 半：注册 composer dock + 面板浮层
│   ├── types.ts              # 跨模块数据契约
│   ├── size-presets.ts       # 分辨率档位 + 比例 → "WxH"（含约束校验）
│   ├── host/
│   │   └── routes.ts         # Host HTTP 端点：/hunyuan/api/* 与 /hunyuan/file
│   ├── client-services/
│   │   ├── rpc.ts            # Client → Host 的 fetch 封装
│   │   ├── config-client.ts  # 配置缓存 + 更新
│   │   ├── bus.ts            # 事件总线（文件夹选择、文件选择……）
│   │   └── file-url.ts       # 本地图片路径 → 可加载 URL
│   ├── services/
│   │   ├── config.ts         # 配置持久化（JSON，原子写）
│   │   ├── storage.ts        # 本地文件管理 + 图片下载（路径实时跟随配置）
│   │   ├── hunyuan.ts        # 混元 API 网关（v3 + v3.5）
│   │   └── gallery.ts        # JSON 图库（内存索引 + 原子写，无原生依赖）
│   └── slots/
│       ├── generator-panel.tsx   # 生成面板（浮层「生成」标签）
│       ├── gallery-panel.tsx     # 图库面板（浮层「图库」标签）
│       └── settings-panel.tsx    # 设置面板（浮层「设置」标签）
├── README.md + 7 translations (.zh-CN · .zh-TW · .ja · .ko · .pt · .es · .ru)
├── INSTALL.md / INSTALL.zh-CN.md
└── LICENSE
```

### 架构要点

- **双 entry**：`dist/server.js` 是 Host 半（Node.js 进程），`dist/client.js` 是
  Client 半（浏览器）。后者必须是 `window.__ModuleLoader__.load({id, factory})` 格式，
  由 `scripts/build-client.mjs` 通过 esbuild 生成；JSX 会被强制编译为
  `React.createElement`，因为 DSH 模块表提供 `React`，但**不提供** `react/jsx-runtime`。
- **UI 入口**：客户端只注册一个 `conversation.composer.dock` 槽位（一个按钮）。
  点击它会打开一个含三个标签的浮层：生成 / 图库 / 设置。
- **Client ↔ Host**：客户端通过 `fetch('/hunyuan/api/<method>')` 调用宿主；图片
  通过 `/hunyuan/file?path=<绝对路径>` 回送（仅限配置的输出文件夹内的文件，
  以防路径穿越）。
- **零原生依赖**：图库是 JSON 文件而非 SQLite，因此在 DSH 应用的 macOS
  代码签名 / 强化运行时限制下也能正常加载，并且
  在 Windows 或 Linux 上无需重新构建。

### 本地构建

```bash
pnpm install
pnpm build         # tsc → dist/（host），esbuild → dist/client.js（client）
pnpm typecheck     # tsc --noEmit
node scripts/smoke-activate.mjs
```

### 调试模式

用 `--plugin-debug=hunyuan-image` 启动 DSH 即可获得详细日志。

---

## 🤝 贡献

欢迎提交 issue 和 pull request。

- 🐛 发现 bug → [提交 bug 报告](../../issues/new?template=bug.md)
- 💡 有想法 → [提交功能请求](../../issues/new?template=feature.md)
- 🔧 提交代码 → fork、开分支、PR

---

## 📄 许可证

MIT © [rayyugz](https://github.com/rayyugz)

---

## 🙏 致谢

- 腾讯混元团队提供 API
- DSH 团队提供插件平台
- 所有提交 issue、帮助改进本插件的人
