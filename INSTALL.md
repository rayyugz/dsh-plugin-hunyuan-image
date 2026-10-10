# 安装 / 重装指南

> 腾讯混元生图 DSH 插件 v1.0.0
> 本文档面向「重装 DSH 后如何把插件装回来」的场景，也适用于换机器安装。

---

## 一、你手上应该有这两个文件

| 文件 | 用途 | 说明 |
|---|---|---|
| `dsh-plugin-hunyuan-image-1.0.0.tgz` | **安装包**（约 140 KB） | 装插件用这个，已编译好，不需要 Node/编译环境 |
| `dsh-plugin-hunyuan-image-1.0.0-src.tar.gz` | 源码备份 | 将来想改代码时才需要 |

**请把这两个文件保存在不易丢失的地方**（例如非系统盘、网盘、GitHub 私有仓库）。
推荐放在：`/Volumes/Fangxiang S5000pro 2T/DSH插件备份/`

---

## 二、安装前准备

### 1. 确认 DSH 已装好并能启动

### 2. 准备一个 TokenHub API Key

1. 登录 [腾讯云](https://cloud.tencent.com)
2. 开通 [TokenHub 服务](https://console.cloud.tencent.com/tokenhub)
3. 在 [API Key 管理页](https://console.cloud.tencent.com/tokenhub/apikey) 新建 Key，形如 `sk-xxxxxxxx`
4. 在 [在线推理-视觉模型](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION)
   开启 `hy-image-v3.5-preview` 与 `hy-image-v3` 的**后付费**

---

## 三、安装（三种方式，任选其一）

### 方式 A：让 DSH 里的 AI 助手装（最省事，推荐）

1. 把 `dsh-plugin-hunyuan-image-1.0.0.tgz` **解压**到一个固定目录，例如：

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   # 得到 ~/dsh-plugins/package/
   ```

2. 打开 DSH，在对话框里对 AI 说：

   > 请把 `/Users/你的用户名/dsh-plugins/package` 这个目录安装为 DSH 插件（用 plugin_manager 的 install_bundle）

3. AI 会调用 `plugin_manager` 完成安装，装完**重启 DSH**。

### 方式 B：命令行手动安装

如果你能打开终端，且 DSH 的 profile 在默认位置：

```bash
# 1) 解压到一个固定目录
mkdir -p ~/dsh-plugins
tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins

# 2) 装依赖（只装一个：@deepseek-ai/dsh-tools）
cd ~/dsh-plugins/package
pnpm install --ignore-scripts    # 或 npm install

# 3) 链接进 DSH profile（macOS / Linux）
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image

# Windows（PowerShell，管理员）：
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"

# 4) 把插件登记进 profile 的 package.json
#    编辑 ~/.dsh/profiles/desktop/package.json：
#    - dependencies 里加：  "dsh-plugin-hunyuan-image": "link:<上一步的绝对路径>"
#    - dsh.profile.bundles 数组里加：  "dsh-plugin-hunyuan-image"

# 5) 重启 DSH
```

### 方式 C：只复制文件（最保底）

如果上面都不行，直接把解压后的 `package/` 整个目录拷到：

```
~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image/
```

然后在 profile 的 `package.json` 里按方式 B 的第 4 步登记，重启 DSH。

---

## 四、首次配置

重启 DSH 后：

1. 对话框输入框下方找到 **「🖼 混元生图」** 按钮，点开浮层
2. 切到 **「设置」** 标签：
   - **API Key**：粘贴你的 `sk-...`
   - **图片保存路径**：**强烈建议改到非系统盘**，例如
     `/Volumes/Fangxiang S5000pro 2T/AI生图视频/`
     （默认是 `~/Pictures/DSH-Hunyuan-Image`，占系统盘）
   - 点 **「📂 选择...」** 会弹出系统原生的目录选择框
   - 默认模型 / 分辨率 / 比例 / 水印脚注按需设置
3. 点 **「保存」**，再点 **「🔌 测试连接」** 验证 Key 有效

> ⚠️ **重要**：图片保存在 `<保存路径>/<年-月>/` 的月份子目录里，例如
> `AI生图视频/2026-10/1791629683045-xxxx.png`，不是直接放在根目录下。

---

## 五、验证安装成功

| 检查项 | 期望结果 |
|---|---|
| 设置 → 插件 | 看到「腾讯混元生图」，无红色「异常」标记 |
| 输入框下方 | 有「🖼 混元生图」按钮 |
| 点按钮 | 弹出「生成 / 图库 / 设置」三标签浮层 |
| 生成标签下方 | 胶囊一行：模型 / 分辨率 / 比例 / 数量 |
| 填好 Key 后生成 | 约 10-30 秒出图，图片直接显示 |
| 保存路径 | 出现 `<路径>/<年-月>/xxxx.png` |
| 图库标签 | 能看到刚生成的缩略图 |
| 对话里说「打开图库」 | 消息下方出现「📁 打开图库」按钮 |

---

## 六、卸载

1. 设置 → 插件 → 找到「腾讯混元生图」→ 卸载开关
2. 或让 DSH 的 AI 助手执行 `plugin_manager` 的 `remove_bundle`
3. 手动清理残留（可选）：

```bash
# 插件数据（配置 + 图库索引）
rm -rf ~/.dsh/hunyuan-image

# 生成的图片（按需，注意别误删别的文件）
# rm -rf "/Volumes/.../AI生图视频/2026-10"
```

---

## 七、从源码重新构建（仅开发时需要）

只有想改代码才需要这一步。需要 **Node ≥ 20** 与 **pnpm**。

```bash
tar -xzf dsh-plugin-hunyuan-image-1.0.0-src.tar.gz
cd dsh-plugin-hunyuan-image

pnpm install                      # 装开发依赖
pnpm build                        # 编译 host 半 + 打包 client 半
node scripts/smoke-activate.mjs   # 冒烟测试（应输出「全部通过」）
```

产物在 `dist/`：
- `dist/server.js` —— Host 半（Node.js 进程）
- `dist/client.js` —— Client 半（浏览器，`__ModuleLoader__` 格式）

### 项目结构速览

```
src/
├── server.ts             # Host 入口：Cordis 插件（apply + inject）
├── client.ts             # Client 入口：composer dock 按钮 + 浮层
├── size-presets.ts       # 分辨率档位 + 比例 → "WxH" 换算
├── host/routes.ts        # /hunyuan/api/* 与 /hunyuan/file 路由
├── services/             # config / storage / hunyuan API / gallery(JSON)
├── client-services/      # rpc / config-client / bus / file-url
└── slots/                # 三个面板组件
```

---

## 八、常见问题

### 「保存路径改了但图片还是进旧目录」
已修复（v1.0）。路径是实时读取配置的，改完保存后**下一次生成**即生效，无需重启插件。

### 「图片显示破图」
已修复（v1.0）。浏览器不能加载文件系统路径，插件通过 `/hunyuan/file` 路由回送。

### 「图库空白」
已修复（v1.0）。生图成功后会立刻写入图库索引
（`~/.dsh/hunyuan-image/hunyuan-image-gallery.json`）。

### 「插件页显示异常」
1. 确认已装依赖：`cd <插件目录> && pnpm install`
2. 确认 `dist/` 存在且非空
3. 把 DSH 里的红色错误文字抄下来排查

### 「API Key 测试失败 / 生成报 401」
1. Key 是否以 `sk-` 开头、是否有多余空格
2. 是否已在 TokenHub 控制台**开通对应模型的后付费**
3. Key 是否被禁用

### 图片链接会过期吗？
腾讯返回的远程 URL **12 小时失效**，但本插件会在生成成功时**立刻下载到本地**，
所以图库里的图是永久的（只要你不删本地文件）。

---

## 九、许可

MIT。可自由使用、修改、分发。
