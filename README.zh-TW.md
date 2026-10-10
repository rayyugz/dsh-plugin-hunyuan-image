# 騰訊混元圖像生成 · DSH 原生外掛

Languages: [English](README.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português](README.pt.md) · [Español](README.es.md) · [Русский](README.ru.md)

> 把騰訊混元的 **Hy-Image-3.5-preview** 與 **Hy-Image-3.0** 帶進
> [DSH（DeepSeek Harness）](https://deepseek.com) —— 提供生成面板、本機圖庫、
> 官方兩段式尺寸選擇器與批次生成。
> **零原生相依性，macOS、Windows 與 Linux 皆可執行。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: ≥20](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![CI](https://github.com/rayyugz/dsh-plugin-hunyuan-image/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

---

## ✨ 功能

- **雙模型**
  - `hy-image-v3.5-preview` —— Chat/Messages 協定；支援多模態輸入、多輪編輯、
    思維鏈改寫；最高可輸出 **4K（4096×4096）**
  - `hy-image-v3` —— 經典文生圖；支援提示詞改寫與官方 37 組預設尺寸
- **官方兩段式尺寸選擇器** —— **解析度等級 × 長寬比**，與騰訊 TokenHub 網頁主控台
  完全相同的操作方式。外掛會把你的選擇轉換成 API 所需的 `WxH` 字串，並保證它符合官方
  限制條件（v3.5：邊長落在 [256, 8192]、面積 ≤ 16,777,216；v3.0：邊長落在
  [512, 2048]、面積 ≤ 1,048,576）。介面上會顯示實際送出的尺寸。
- **批次生成** —— 一次請求生成 **1 / 2 / 4 張圖片**（並行發出）；
  結果會逐張顯示，並附上 `1/4` 序號標記。部分失敗會明確回報。
- **本機圖庫**
  - 每次生成成功都會**自動入庫**（純 JS 的 JSON 儲存 —— 不使用 SQLite，也沒有原生模組）
  - **縮圖格狀檢視**與清單檢視
  - **關鍵字搜尋**（比對提示詞與改寫後的提示詞），並可依模型與時間範圍篩選
  - **詳細資訊抽屜**，顯示完整提示詞、模型、尺寸、時間戳記與本機路徑
  - **🔁 再次生成** —— 一鍵回填原始提示詞與參數
  - 多選**批次刪除**（同時移除本機檔案）、複製提示詞、複製圖片
- **可自訂的輸出資料夾** —— 預設為 `~/Pictures/DSH-Hunyuan-Image`，但可指向任何位置
  （建議使用非系統碟）。點選 **「選擇…」** 會開啟作業系統原生的資料夾選擇器。
  **變更立即生效，不需重新啟動外掛。** 檔案會依月份分桶存放於
  `<folder>/<YYYY-MM>/` 之下，避免數千個檔案全部擠在同一個目錄裡。
- **官方進階參數**（刻意限定為單一工作階段 —— 詳見[發展藍圖](#-已知限制與發展藍圖)）

  | 參數 | 適用範圍 | 說明 |
  |---|---|---|
  | 種子 `seed` | 兩者皆可 | 重現相同的結果 |
  | 浮水印註腳 `footnote` | 兩者皆可 | ≤ 16 個字元，會繪製在右下角 |
  | 外部搜尋增強 `use_search_tool` | v3.5 | 讓模型在繪圖前先搜尋網路 |
  | 參考圖面積上限 `resize_max_pixels` | v3.5 | 限制大型（4K/6K）參考圖的 token 成本 |
  | 提示詞自動改寫 `revise` | v3.0 | 約增加 11 秒；建議預設開啟 |

- **參考圖** —— 可從磁碟上傳（會轉成 data URL），或傳入公開 URL。
  v3.5 最多接受 20 張（每張 ≤ 20 MB）；v3.0 最多 3 張（每張 ≤ 10 MB）。
- **模型可直接呼叫** —— 此外掛註冊了 **`hunyuan_generate_image`** 工具，所以你只要在對話中
  說「畫一隻貓」，模型就會呼叫它。
- **圖片永久保存** —— 騰訊的遠端 URL 在 **12 小時**後失效；此外掛會立刻把每張生成的圖片
  下載到磁碟，因此圖庫項目永遠不會失效。

> 📌 尚未實作的功能都誠實列在
> [已知限制與發展藍圖](#-已知限制與發展藍圖)。
> 本 README 只描述目前版本實際具備的能力。

---

## 📦 安裝

### 方式一 —— 從 Release 安裝（推薦，不需建置）

1. 從 [**Releases**](../../releases) 頁面下載 `dsh-plugin-hunyuan-image-1.0.0.tgz`。
2. 解壓縮到一個固定資料夾，例如 `~/dsh-plugins/`：

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   ```

3. 在 DSH 對話中告訴助理：

   > 請把 `~/dsh-plugins/package` 安裝為 DSH 外掛（使用 `plugin_manager` 的 `install_bundle`）。

4. 重新啟動 DSH。

> 逐步重裝 / 換新機的說明：[**INSTALL.md**](INSTALL.md)
> （另有[簡體中文](INSTALL.zh-CN.md)版）。

### 方式二 —— 從原始碼建置（開發者）

需要 **Node ≥ 20** 與 **pnpm**。

```bash
git clone https://github.com/rayyugz/dsh-plugin-hunyuan-image.git
cd dsh-plugin-hunyuan-image

pnpm install
pnpm build                        # 編譯 host 半部 + 打包 client 半部
node scripts/smoke-activate.mjs   # 冒煙測試 —— 應輸出「全部通過」

# 連結到 DSH profile
# macOS / Linux:
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image
# Windows（PowerShell，系統管理員）:
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"
```

接著把外掛名稱加入 profile 的 `package.json`（`dependencies` 與
`dsh.profile.bundles` 兩處），然後重新啟動 DSH。

---

## ⚙️ 設定

### 1. 取得 API Key

1. 在[騰訊雲](https://cloud.tencent.com)註冊 / 登入
2. 開通 [TokenHub 服務](https://console.cloud.tencent.com/tokenhub)
3. 在 [API Key 頁面](https://console.cloud.tencent.com/tokenhub/apikey)建立一組 Key —— 格式類似 `sk-...`
4. 在[線上推論 → 視覺模型](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION)
   底下為 `hy-image-v3.5-preview` 與 `hy-image-v3` 啟用**隨用隨付**

### 2. 填寫外掛設定

開啟外掛面板（輸入區下方的 **🖼 混元生圖** 按鈕）→ **設定**分頁：

| 欄位 | 說明 | 預設 |
|---|---|---|
| **API Key** | 上面建立的 Key | — |
| **輸出資料夾** | 任何你喜歡的位置；建議使用非系統碟 | `~/Pictures/DSH-Hunyuan-Image` |
| **預設模型** | `hy-image-v3.5-preview` 或 `hy-image-v3` | v3.5-preview |
| **預設解析度** | 見[尺寸](#-尺寸) | `1K` |
| **預設長寬比** | 見[尺寸](#-尺寸) | `1:1` |
| **浮水印註腳** | ≤ 16 個字元，位於右下角 | 空 |

點選 **儲存**，再點選 **🔌 測試連線** 驗證 Key 可正常運作。

> ⚠️ **注意**：圖片會存放在**月份子資料夾**底下，例如
> `AI-images/2026-10/1791629683045-xxxx.png` —— 而不是直接放在資料夾根目錄。

---

## 🖼 尺寸

此外掛完整對應官方 TokenHub 選擇器：先選**解析度等級**，再選**長寬比**。

### Hy-Image-3.5-preview

| 等級 | 長寬比 | 備註 |
|---|---|---|
| `1K` / `1.5K` / `2K` | `21:9` `16:9` `4:3` `1:1` `2:3` `3:2` `3:4` `9:16` | 面積約 1M / 2.36M / 4.19M px |
| `4K` | 同上 | 面積 ≤ 16,777,216 px；例如 16:9 → `5461x3072` |
| `Auto` | — | 不送出 `size`；由模型自行決定 |

### Hy-Image-3.0

| 等級 | 長寬比 | 備註 |
|---|---|---|
| `720P` / `1K` | `1:1` `3:4` `4:3` `9:16` `16:9` `3:5` `5:3` | 必須符合邊長 ∈ [512, 2048] 且面積 ≤ 1,048,576 |
| `Auto` | — | 由模型從官方 37 組預設中挑選 |

**尺寸粗略對照**（實際送出的值）：

```
v3.5  1K   16:9 = 1365x768      1:1 = 1024x1024
      2K   16:9 = 2731x1536     1:1 = 2048x2048
      4K   16:9 = 5461x3072     1:1 = 4096x4096
v3.0  720P 16:9 = 1280x720      1:1 = 960x960
      1K   16:9 = 1365x768      1:1 = 1024x1024
```

全部 62 種組合都以程式化方式驗證過，符合官方限制條件。

---

## 📚 使用圖庫

| 操作 | 方式 |
|---|---|
| **搜尋** | 頂端的搜尋框（debounce 300 ms；比對提示詞 / 改寫後提示詞 / 關鍵字） |
| **篩選** | 依模型與時間範圍 |
| **多選** | 卡片上的核取方塊，或透過滑鼠移入覆蓋層 |
| **批次刪除** | 選取項目後，頂端會出現批次操作列 |
| **檢視單張圖片** | 滑鼠移入覆蓋層，或開啟詳細資訊抽屜 |
| **再次生成** | 詳細資訊抽屜中的 🔁 —— 會切回生成器並回填提示詞與參數 |
| **複製提示詞** | 詳細資訊抽屜中的 📋 |
| **複製圖片** | 詳細資訊抽屜中的 🖼（瀏覽器不支援 `ClipboardItem` 時，會退回複製本機路徑） |

---

## ⚠️ 已知限制與發展藍圖

### 限制（騰訊 API 或 DSH 宿主本身的限制）

| 項目 | 說明 |
|---|---|
| **遠端圖片 URL 有效期** | 僅 12 小時 —— 此外掛會立刻把每張圖片下載到磁碟，因此圖庫項目是永久的 |
| **參考圖大小** | v3.5 每張 ≤ 20 MB；v3.0 每張 ≤ 10 MB |
| **參考圖數量** | v3.5 ≤ 20 張；v3.0 ≤ 3 張 |
| **浮水印註腳** | ≤ 16 個 UTF-8 字元 |
| **`generate_max_pixels` 上限為 2K** | 更高解析度必須透過 `size` 指定（此外掛以解析度等級的方式達成） |
| **多輪編輯** | 僅 v3.5 支援。此外掛會儲存伺服器回傳的 `assembled_history`，但目前還沒有多輪編輯的介面 |
| **進階參數不會持久化** | 外部搜尋、參考圖面積上限與改寫開關**僅在目前工作階段有效**，重新開啟面板就會重設。這是刻意的設計 —— 避免留下日後難以診斷的隱藏狀態 |

### 尚未實作

| 功能 | 狀態 | 原因 |
|---|---|---|
| **提到圖庫時自動出現「開啟圖庫」按鈕** | ❌ | 需要監聽工作階段訊息事件並注入動作按鈕；v1.0 尚未接上 |
| **匯出 / 另存新檔對話框** | ⚠️ 佔位 | DSH 目前尚未對外掛開放「另存新檔」對話框；呼叫會回傳明確原因，而不是靜默失敗 |
| **微信 / 飛書分享** | ⚠️ 佔位 | DSH 目前尚未對外掛開放 IM 分享管道 |
| **將圖片拖曳進對話** | ❌ | 取決於 DSH 是否開放拖曳事件 |
| **多輪編輯介面** | ❌ | 資料層已就緒（`assembledHistory`），只缺介面 |
| **DSH 官方外掛市集** | ❌ | 需要 DSH 團隊審核 |
| **面板介面多語言** | ❌ | 面板內的介面目前**只有中文**；外掛的標題／描述已在地化（中／英），但面板內的控件文字尚未國際化。本倉庫的多語言 README 只是過渡方案 |

非常歡迎意見回饋與 pull request —— 請開一個 [Issue](../../issues)。

---

## 🛠 開發

### 專案結構

```
dsh-plugin-hunyuan-image/
├── package.json              # 外掛 manifest（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml          # Cordis 載入器 patch：宣告 host 外掛資料列
├── icon.svg / locale/        # 顯示中繼資料（圖示 + 英文/中文標題與說明）
├── scripts/
│   ├── build-client.mjs      # 把 TS/TSX 打包成 DSH 用戶端模組表格式
│   └── smoke-activate.mjs    # 啟用冒煙測試（重新啟動 DSH 前先跑一遍）
├── src/
│   ├── server.ts             # ★ Host 半部：Cordis 外掛進入點（apply + inject）
│   ├── client.ts             # ★ Client 半部：註冊 composer dock + 面板覆蓋層
│   ├── types.ts              # 跨模組資料契約
│   ├── size-presets.ts       # 解析度等級 + 長寬比 → "WxH"（含限制條件檢查）
│   ├── host/
│   │   └── routes.ts         # host HTTP 端點：/hunyuan/api/* 與 /hunyuan/file
│   ├── client-services/
│   │   ├── rpc.ts            # client → host 的 fetch 封裝
│   │   ├── config-client.ts  # 設定快取 + 更新
│   │   ├── bus.ts            # 事件匯流排（資料夾選擇器、檔案選擇器……）
│   │   └── file-url.ts       # 本機圖片路徑 → 可載入的 URL
│   ├── services/
│   │   ├── config.ts         # 設定持久化（JSON，原子寫入）
│   │   ├── storage.ts        # 本機檔案管理 + 圖片下載（路徑即時跟隨設定）
│   │   ├── hunyuan.ts        # 混元 API 閘道（v3 + v3.5）
│   │   └── gallery.ts        # JSON 圖庫（記憶體內索引 + 原子寫入，無原生相依性）
│   └── slots/
│       ├── generator-panel.tsx   # 生成面板（覆蓋層「生成」分頁）
│       ├── gallery-panel.tsx     # 圖庫面板（覆蓋層「圖庫」分頁）
│       └── settings-panel.tsx    # 設定面板（覆蓋層「設定」分頁）
├── README.md + 7 translations (.zh-CN · .zh-TW · .ja · .ko · .pt · .es · .ru)
├── INSTALL.md / INSTALL.zh-CN.md
└── LICENSE
```

### 架構重點

- **雙進入點**：`dist/server.js` 是 Host 半部（Node.js 程序），`dist/client.js` 是
  Client 半部（瀏覽器）。後者必須是 `window.__ModuleLoader__.load({id, factory})` 格式，
  由 `scripts/build-client.mjs` 透過 esbuild 產生；JSX 會強制編譯成
  `React.createElement`，因為 DSH 模組表提供 `React`，但**不提供** `react/jsx-runtime`。
- **UI 進入點**：用戶端只註冊一個 `conversation.composer.dock` 插槽（一顆按鈕）。
  點選後會開啟含三個分頁的覆蓋層：生成 / 圖庫 / 設定。
- **Client ↔ host**：client 透過 `fetch('/hunyuan/api/<method>')` 呼叫 host；圖片則經由
  `/hunyuan/file?path=<絕對路徑>` 回送（僅限設定的輸出資料夾內的檔案，以防止路徑穿越）。
- **零原生相依性**：圖庫是 JSON 檔案而非 SQLite，因此可在 DSH 應用程式的
  macOS 程式碼簽章 / 強化執行階段限制下正常載入，且 Windows 或 Linux 上不需重新建置。

### 本機建置

```bash
pnpm install
pnpm build         # tsc → dist/（host），esbuild → dist/client.js（client）
pnpm typecheck     # tsc --noEmit
node scripts/smoke-activate.mjs
```

### 除錯模式

啟動 DSH 時加上 `--plugin-debug=hunyuan-image` 即可輸出詳細日誌。

---

## 🤝 貢獻

歡迎開 Issue 與 pull request。

- 🐛 發現 bug → [開一個 bug report](../../issues/new?template=bug.md)
- 💡 有想法 → [開一個 feature request](../../issues/new?template=feature.md)
- 🔧 想送程式碼 → fork、開分支、送 PR

---

## 📄 授權條款

MIT © [rayyugz](https://github.com/rayyugz)

---

## 🙏 致謝

- 騰訊混元團隊提供 API
- DSH 團隊提供外掛平台
- 所有開 issue 並協助改進此外掛的人
