# Changelog

本项目的所有重要变更都会记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-10-10

首个正式版本。

### 新增

- **双模型支持**
  - `hy-image-v3.5-preview`：Chat/Messages 协议，支持多模态输入、多轮编辑、思维链改写，最高 4K（4096×4096）输出
  - `hy-image-v3`：经典文生图，支持 prompt 自动改写与 37 组预设尺寸
- **官方两段式尺寸选择**：分辨率档位（v3.5：1K/1.5K/2K/4K；v3.0：720P/1K）× 比例
  （v3.5：21:9 / 16:9 / 4:3 / 1:1 / 2:3 / 3:2 / 3:4 / 9:16；v3.0：1:1 / 3:4 / 4:3 / 9:16 / 16:9 / 3:5 / 5:3），
  自动换算为 API 所需的 `WxH`，并保证满足官方约束
- **批量生图**：一次可生成 1 / 2 / 4 张，并行发起，结果逐张展示并带序号角标
- **本地图库**
  - 生图成功即自动入库
  - 网格 / 列表两种视图，支持关键词搜索与按模型、时间筛选
  - 缩略图、详情侧栏、「再次生图」（自动回填提示词与参数）
  - 多选批量删除、单图导出、复制提示词
- **自定义保存路径**：默认 `~/Pictures/DSH-Hunyuan-Image`，可改为任意位置（建议非系统盘），
  修改后立即生效，无需重启插件
  - 按 `<保存路径>/<年-月>/` 月份分桶归档
- **官方高级参数**
  - 生成种子（`seed`）
  - 水印脚注（`footnote`，≤16 字符，生成在图片右下角）
  - 外部搜索增强（`use_search_tool`，仅 v3.5）
  - 参考图面积上限（`resize_max_pixels`，仅 v3.5，控制大图 token 消耗）
  - 提示词自动改写（`revise`，仅 v3.0）
- **模型可直调**：向 DSH 注册 `hunyuan_generate_image` 工具，对话中模型可自主调用生图
- **参考图输入**：支持本地上传（转 data URL）与公网 URL
- **零原生依赖**：图库使用 JSON 文件存储，macOS / Windows / Linux 全平台通用，
  不受代码签名或 Node ABI 影响

### 技术说明

- 采用 DSH 的 **Cordis 双 entry 架构**：
  - `dist/server.js` —— Host 半（Node.js），注册工具与 HTTP 端点
  - `dist/client.js` —— Client 半（浏览器），以 `window.__ModuleLoader__.load()` 格式加载
- 前后端通过 `/hunyuan/api/*` JSON-RPC 通信；图片经 `/hunyuan/file` 回送
  （仅允许读取当前保存目录内的文件，防路径穿越）
- 远程图片 URL 仅 12 小时有效，插件会在生成成功时**立刻下载到本地**

### 修复（开发过程中的问题）

- 修正 Host 半激活失败：误用了 DSH 不存在的 `ctx.http` / `ctx.paths` 服务，改为 Node 原生能力
- 修正保存路径不生效：`storage` 服务改为实时读取配置
- 修正图库空白：HTTP 路由未调用 `gallery.insert()`
- 修正图片破图：浏览器无法加载文件系统路径，改为经回送路由
- 修正图库按钮无响应：浮层未监听 `slot:open` 事件
- 修正 4K 尺寸偏小：面积回缩由粗糙的 0.98 连乘改为精确等比因子
  （现 4K 16:9 = `5461x3072`，与官方文档举例一致）

### 已移除

- 原基于 `better-sqlite3` 的图库实现——原生模块在 macOS 代码签名 / 强化运行时下
  无法加载，且不满足跨平台要求
- 「方向」控件——与「比例」下拉语义重复

[1.0.0]: https://github.com/rayyugz/dsh-plugin-hunyuan-image/releases/tag/v1.0.0
