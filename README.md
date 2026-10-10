# Tencent Hunyuan Image Generation · Native DSH Plugin

Languages: **English** · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português](README.pt.md) · [Español](README.es.md) · [Русский](README.ru.md)

> Bring Tencent Hunyuan's **Hy-Image-3.5-preview** and **Hy-Image-3.0** into
> [DSH (DeepSeek Harness)](https://deepseek.com) — with a generation panel, local gallery,
> the official two-step size picker and batch generation.
> **Zero native dependencies. Runs on macOS, Windows and Linux.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: ≥20](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![CI](https://github.com/rayyugz/dsh-plugin-hunyuan-image/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

---

## ✨ Features

- **Two models**
  - `hy-image-v3.5-preview` — Chat/Messages protocol; multimodal input, multi-turn editing,
    chain-of-thought rewriting; up to **4K (4096×4096)** output
  - `hy-image-v3` — classic text-to-image; prompt rewriting and the official 37 preset sizes
- **Official two-step size picker** — **resolution tier × aspect ratio**, the same interaction as
  the Tencent TokenHub web console. The plugin converts your choice into the `WxH` string the API
  expects and guarantees it satisfies the official constraints
  (v3.5: edges in [256, 8192], area ≤ 16,777,216; v3.0: edges in [512, 2048], area ≤ 1,048,576).
  The UI shows the exact size that will be sent.
- **Batch generation** — generate **1 / 2 / 4 images** in one request (issued in parallel);
  results are shown one by one with a `1/4` index badge. Partial failures are reported explicitly.
- **Local gallery**
  - Every successful generation is **stored automatically** (plain-JS JSON storage — no SQLite, no native module)
  - **Thumbnail grid** and list views
  - **Keyword search** (matches the prompt and the rewritten prompt) plus filtering by model and time range
  - **Detail drawer** with the full prompt, model, size, timestamp and local path
  - **🔁 Generate again** — refills the original prompt and parameters in one click
  - Multi-select **batch delete** (also removes the local files), copy prompt, copy image
- **Customisable output folder** — defaults to `~/Pictures/DSH-Hunyuan-Image`, but you can point it
  anywhere (a non-system drive is recommended). Clicking **"Choose…"** opens the native OS folder picker.
  **Changes take effect immediately, no plugin restart needed.** Files are bucketed by month under
  `<folder>/<YYYY-MM>/` to avoid piling thousands of files into one directory.
- **Official advanced parameters** (session-scoped on purpose — see [Roadmap](#️-known-limitations--roadmap))

  | Parameter | Applies to | Description |
  |---|---|---|
  | Seed `seed` | both | Reproduce the same result |
  | Watermark footnote `footnote` | both | ≤ 16 characters, rendered in the bottom-right corner |
  | External search augmentation `use_search_tool` | v3.5 | Let the model search the web before drawing |
  | Reference-image area cap `resize_max_pixels` | v3.5 | Caps the token cost of large (4K/6K) reference images |
  | Automatic prompt rewriting `revise` | v3.0 | Adds ~11 s; recommended on by default |

- **Reference images** — upload from disk (converted to a data URL) or pass a public URL.
  v3.5 accepts up to 20 (≤ 20 MB each); v3.0 up to 3 (≤ 10 MB each).
- **Callable by the model** — the plugin registers a **`hunyuan_generate_image`** tool, so you can
  just say "draw a cat" in a conversation and the model will call it.
- **Durable images** — Tencent's remote URLs expire after **12 hours**; the plugin downloads every
  generated image to disk immediately, so gallery entries never break.

> 📌 Unimplemented features are listed honestly in
> [Known limitations & roadmap](#️-known-limitations--roadmap).
> This README only describes what the current version actually does.

---

## 📦 Installation

### Option 1 — Install from the Release (recommended, no build step)

1. Download `dsh-plugin-hunyuan-image-1.0.0.tgz` from the [**Releases**](../../releases) page.
2. Extract it into a permanent folder, e.g. `~/dsh-plugins/`:

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   ```

3. In the DSH chat, tell the assistant:

   > Please install `~/dsh-plugins/package` as a DSH plugin (use `plugin_manager` with `install_bundle`).

4. Restart DSH.

> Step-by-step reinstall / new-machine instructions: [**INSTALL.md**](INSTALL.md)
> (also available in [简体中文](INSTALL.zh-CN.md)).

### Option 2 — Build from source (developers)

Requires **Node ≥ 20** and **pnpm**.

```bash
git clone https://github.com/rayyugz/dsh-plugin-hunyuan-image.git
cd dsh-plugin-hunyuan-image

pnpm install
pnpm build                        # compile the host half + bundle the client half
node scripts/smoke-activate.mjs   # smoke test — should print "全部通过"

# Link into the DSH profile
# macOS / Linux:
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image
# Windows (PowerShell, administrator):
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"
```

Then add the plugin name to the profile's `package.json` (in both `dependencies` and
`dsh.profile.bundles`) and restart DSH.

---

## ⚙️ Configuration

### 1. Get an API Key

1. Sign up / log in at [Tencent Cloud](https://cloud.tencent.com)
2. Activate the [TokenHub service](https://console.cloud.tencent.com/tokenhub)
3. Create a Key on the [API Key page](https://console.cloud.tencent.com/tokenhub/apikey) — it looks like `sk-...`
4. Enable **pay-as-you-go** for `hy-image-v3.5-preview` and `hy-image-v3` under
   [Online inference → Vision models](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION)

### 2. Fill in the plugin settings

Open the plugin panel (**🖼 Hunyuan Image** button under the composer) → **Settings** tab:

| Field | Description | Default |
|---|---|---|
| **API Key** | The Key created above | — |
| **Output folder** | Anywhere you like; a non-system drive is recommended | `~/Pictures/DSH-Hunyuan-Image` |
| **Default model** | `hy-image-v3.5-preview` or `hy-image-v3` | v3.5-preview |
| **Default resolution** | See [Sizes](#-sizes) | `1K` |
| **Default aspect ratio** | See [Sizes](#-sizes) | `1:1` |
| **Watermark footnote** | ≤ 16 characters, bottom-right corner | empty |

Click **Save**, then **🔌 Test connection** to verify the Key works.

> ⚠️ **Note**: images are stored under a **month sub-folder**, e.g.
> `AI-images/2026-10/1791629683045-xxxx.png` — not directly in the folder root.

---

## 🖼 Sizes

The plugin mirrors the official TokenHub picker: pick a **resolution tier** and an **aspect ratio**.

### Hy-Image-3.5-preview

| Tier | Aspect ratios | Notes |
|---|---|---|
| `1K` / `1.5K` / `2K` | `21:9` `16:9` `4:3` `1:1` `2:3` `3:2` `3:4` `9:16` | Area ≈ 1M / 2.36M / 4.19M px |
| `4K` | same | Area ≤ 16,777,216 px; e.g. 16:9 → `5461x3072` |
| `Auto` | — | No `size` is sent; the model decides |

### Hy-Image-3.0

| Tier | Aspect ratios | Notes |
|---|---|---|
| `720P` / `1K` | `1:1` `3:4` `4:3` `9:16` `16:9` `3:5` `5:3` | Must satisfy edges ∈ [512, 2048] and area ≤ 1,048,576 |
| `Auto` | — | The model picks from the official 37 presets |

**Rough size reference** (what actually gets sent):

```
v3.5  1K   16:9 = 1365x768      1:1 = 1024x1024
      2K   16:9 = 2731x1536     1:1 = 2048x2048
      4K   16:9 = 5461x3072     1:1 = 4096x4096
v3.0  720P 16:9 = 1280x720      1:1 = 960x960
      1K   16:9 = 1365x768      1:1 = 1024x1024
```

All 62 combinations are validated programmatically against the official constraints.

---

## 📚 Using the gallery

| Action | How |
|---|---|
| **Search** | Search box at the top (300 ms debounce; matches prompt / rewritten prompt / keywords) |
| **Filter** | By model, and by time range |
| **Multi-select** | Checkbox on the card, or via the hover overlay |
| **Batch delete** | Select items → the batch action bar appears at the top |
| **Inspect one image** | Hover overlay, or open the detail drawer |
| **Generate again** | 🔁 in the detail drawer — switches back to the generator and refills the prompt and parameters |
| **Copy prompt** | 📋 in the detail drawer |
| **Copy image** | 🖼 in the detail drawer (falls back to copying the local path when the browser lacks `ClipboardItem`) |

---

## ⚠️ Known limitations & roadmap

### Limitations (imposed by the Tencent API or the DSH host)

| Item | Detail |
|---|---|
| **Remote image URL lifetime** | Only 12 hours — this plugin downloads every image to disk immediately, so gallery entries are permanent |
| **Reference image size** | v3.5 ≤ 20 MB each; v3.0 ≤ 10 MB each |
| **Reference image count** | v3.5 ≤ 20; v3.0 ≤ 3 |
| **Watermark footnote** | ≤ 16 UTF-8 characters |
| **`generate_max_pixels` caps at 2K** | Higher resolutions must go through `size` (this plugin does that via the resolution tier) |
| **Multi-turn editing** | v3.5 only. The plugin stores the server-returned `assembled_history`, but there is no UI for multi-turn editing yet |
| **Advanced parameters are not persisted** | The external-search, reference-area-cap and rewrite toggles apply to the **current session only** and reset when the panel is reopened. This is deliberate — it avoids hidden state that is hard to diagnose later |

### Not implemented yet

| Feature | Status | Why |
|---|---|---|
| **Auto "open gallery" button when you mention the gallery** | ❌ | Requires listening to session message events and injecting an action button; not wired up in v1.0 |
| **Export / Save-as dialog** | ⚠️ stub | DSH does not expose a "save as" dialog to plugins yet; the call returns an explicit reason rather than failing silently |
| **WeChat / Feishu sharing** | ⚠️ stub | DSH does not expose an IM sharing channel to plugins yet |
| **Drag an image into the conversation** | ❌ | Depends on DSH exposing drag events |
| **Multi-turn editing UI** | ❌ | The data layer is ready (`assembledHistory`); only the UI is missing |
| **DSH official plugin marketplace** | ❌ | Requires review by the DSH team |
| **Localised panel UI** | ❌ | The in-panel UI is currently **Chinese-only**; only the plugin title and description are localised (EN/ZH). These translated READMEs are a stopgap |

Feedback and pull requests are very welcome — please open an [Issue](../../issues).

---

## 🛠 Development

### Project layout

```
dsh-plugin-hunyuan-image/
├── package.json              # plugin manifest (dsh.bundle.patch + dsh.client)
├── cordis.patch.yml          # Cordis loader patch: declares the host plugin row
├── icon.svg / locale/        # display metadata (icon + EN/ZH title & description)
├── scripts/
│   ├── build-client.mjs      # bundles TS/TSX into the DSH client module-table format
│   └── smoke-activate.mjs    # activation smoke test (run before restarting DSH)
├── src/
│   ├── server.ts             # ★ Host half: Cordis plugin entry (apply + inject)
│   ├── client.ts             # ★ Client half: registers the composer dock + panel overlay
│   ├── types.ts              # cross-module data contracts
│   ├── size-presets.ts       # resolution tier + aspect ratio → "WxH" (with constraint checks)
│   ├── host/
│   │   └── routes.ts         # host HTTP endpoints: /hunyuan/api/* and /hunyuan/file
│   ├── client-services/
│   │   ├── rpc.ts            # client → host fetch wrapper
│   │   ├── config-client.ts  # config cache + updates
│   │   ├── bus.ts            # event bus (folder picker, file picker, …)
│   │   └── file-url.ts       # local image path → loadable URL
│   ├── services/
│   │   ├── config.ts         # config persistence (JSON, atomic write)
│   │   ├── storage.ts        # local file management + image download (path follows config live)
│   │   ├── hunyuan.ts        # Hunyuan API gateway (v3 + v3.5)
│   │   └── gallery.ts        # JSON gallery (in-memory index + atomic write, no native deps)
│   └── slots/
│       ├── generator-panel.tsx   # generator panel (overlay "Generate" tab)
│       ├── gallery-panel.tsx     # gallery panel (overlay "Gallery" tab)
│       └── settings-panel.tsx    # settings panel (overlay "Settings" tab)
├── README.md + 7 translations (.zh-CN · .zh-TW · .ja · .ko · .pt · .es · .ru)
├── INSTALL.md / INSTALL.zh-CN.md
└── LICENSE
```

### Architecture notes

- **Two entries**: `dist/server.js` is the Host half (Node.js process) and `dist/client.js` is the
  Client half (browser). The latter must be in `window.__ModuleLoader__.load({id, factory})` format,
  produced by `scripts/build-client.mjs` via esbuild; JSX is force-compiled to
  `React.createElement` because the DSH module table provides `React` but **not** `react/jsx-runtime`.
- **UI entry point**: the client registers a single `conversation.composer.dock` slot (a button).
  Clicking it opens an overlay with three tabs: Generate / Gallery / Settings.
- **Client ↔ host**: the client calls the host through `fetch('/hunyuan/api/<method>')`; images are
  served back through `/hunyuan/file?path=<absolute path>` (restricted to files inside the
  configured output folder, to prevent path traversal).
- **Zero native dependencies**: the gallery is a JSON file rather than SQLite, so it loads fine under
  the macOS code-signing / hardened-runtime restrictions of the DSH app, and needs no rebuild on
  Windows or Linux.

### Local build

```bash
pnpm install
pnpm build         # tsc → dist/ (host), esbuild → dist/client.js (client)
pnpm typecheck     # tsc --noEmit
node scripts/smoke-activate.mjs
```

### Debug mode

Start DSH with `--plugin-debug=hunyuan-image` for verbose logging.

---

## 🤝 Contributing

Issues and pull requests are welcome.

- 🐛 Found a bug → [open a bug report](../../issues/new?template=bug.md)
- 💡 Have an idea → [open a feature request](../../issues/new?template=feature.md)
- 🔧 Sending code → fork, branch, PR

---

## 📄 License

MIT © [rayyugz](https://github.com/rayyugz)

---

## 🙏 Acknowledgements

- The Tencent Hunyuan team for the API
- The DSH team for the plugin platform
- Everyone who files issues and helps improve this plugin
