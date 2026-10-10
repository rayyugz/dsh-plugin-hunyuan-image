# Installation / Reinstall Guide

Languages: **English** · [简体中文](INSTALL.zh-CN.md)

> Tencent Hunyuan Image Generation — DSH plugin v1.0.0
> This guide targets the "I reinstalled DSH, how do I get my plugin back" scenario,
> and works equally well for moving to a new machine.

---

## 1. You should have these files

| File | Purpose | Notes |
|---|---|---|
| `dsh-plugin-hunyuan-image-1.0.0.tgz` | **Install package** (~140 KB) | Use this to install. Already compiled — no Node or build tools required |
| `dsh-plugin-hunyuan-image-1.0.0-src.tar.gz` | Source backup | Only needed if you want to modify the code later |

**Keep these somewhere you won't lose them** (a non-system drive, cloud storage, or a private Git repo).
Suggested location: `/Volumes/Fangxiang S5000pro 2T/DSH插件备份/`

> Both files are also attached to the
> [GitHub Release](https://github.com/rayyugz/dsh-plugin-hunyuan-image/releases), so the repository
> itself is a backup.

---

## 2. Before you start

### 2.1 Make sure DSH is installed and launches

### 2.2 Get a TokenHub API Key

1. Sign up / log in at [Tencent Cloud](https://cloud.tencent.com)
2. Activate the [TokenHub service](https://console.cloud.tencent.com/tokenhub)
3. Create a Key on the [API Key page](https://console.cloud.tencent.com/tokenhub/apikey) — it looks like `sk-xxxxxxxx`
4. Enable **pay-as-you-go** for `hy-image-v3.5-preview` and `hy-image-v3` under
   [Online inference → Vision models](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION)

---

## 3. Install (pick any one of the three methods)

### Method A — Let the DSH assistant do it (easiest, recommended)

1. Extract the tarball into a permanent folder, e.g.:

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   # produces ~/dsh-plugins/package/
   ```

2. Open DSH and tell the assistant:

   > Please install the directory `/Users/<your-name>/dsh-plugins/package` as a DSH plugin
   > (use `plugin_manager` with `install_bundle`).

3. The assistant calls `plugin_manager`, then **restart DSH**.

### Method B — Manual command line

If you have a terminal and the DSH profile is in its default location:

```bash
# 1) Extract into a permanent folder
mkdir -p ~/dsh-plugins
tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins

# 2) Install dependencies (only one: @deepseek-ai/dsh-tools)
cd ~/dsh-plugins/package
pnpm install --ignore-scripts    # or: npm install

# 3) Link into the DSH profile (macOS / Linux)
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image

# Windows (PowerShell, administrator):
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"

# 4) Register the plugin in the profile's package.json
#    Edit ~/.dsh/profiles/desktop/package.json:
#    - add to "dependencies":   "dsh-plugin-hunyuan-image": "link:<absolute path from step 3>"
#    - add to "dsh.profile.bundles":   "dsh-plugin-hunyuan-image"

# 5) Restart DSH
```

### Method C — Plain file copy (last resort)

If neither of the above works, copy the extracted `package/` directory to:

```
~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image/
```

Then register it in the profile's `package.json` as in Method B step 4, and restart DSH.

---

## 4. First-time configuration

After restarting DSH:

1. Find the **🖼 Hunyuan Image** button under the composer and click it
2. Switch to the **Settings** tab:
   - **API Key** — paste your `sk-...`
   - **Output folder** — **strongly recommended to move this off the system drive**, e.g.
     `/Volumes/Fangxiang S5000pro 2T/AI-images/`
     (the default is `~/Pictures/DSH-Hunyuan-Image`, which fills up your system disk)
     Click **"📂 Choose…"** to open the native OS folder picker
   - Default model / resolution / aspect ratio / watermark footnote as desired
3. Click **Save**, then **🔌 Test connection** to verify the Key

> ⚠️ **Important**: images are stored under a **month sub-folder**, e.g.
> `AI-images/2026-10/1791629683045-xxxx.png` — not directly in the folder root.

---

## 5. Verify the installation

| Check | Expected |
|---|---|
| Settings → Plugins | "Tencent Hunyuan Image" appears, with no red error badge |
| Under the composer | A "🖼 Hunyuan Image" button exists |
| Click the button | An overlay opens with Generate / Gallery / Settings tabs |
| Generate tab (bottom row) | A pill row: model / resolution / aspect ratio / count |
| With a valid Key, generate | An image appears in ~10–30 s and is displayed inline |
| Output folder | `<folder>/<YYYY-MM>/xxxx.png` appears |
| Gallery tab | The image you just generated is listed as a thumbnail |
| Say "open the gallery" in chat | (Not implemented in v1.0 — see the README roadmap) |

---

## 6. Uninstall

1. Settings → Plugins → find "Tencent Hunyuan Image" → toggle it off
2. Or ask the DSH assistant to run `plugin_manager` with `remove_bundle`
3. Optional manual cleanup:

```bash
# Plugin data (config + gallery index)
rm -rf ~/.dsh/hunyuan-image

# Generated images (be careful not to delete unrelated files)
# rm -rf "/Volumes/.../AI-images/2026-10"
```

---

## 7. Rebuild from source (developers only)

Only needed if you want to change the code. Requires **Node ≥ 20** and **pnpm**.

```bash
tar -xzf dsh-plugin-hunyuan-image-1.0.0-src.tar.gz
cd dsh-plugin-hunyuan-image

pnpm install                      # install dev dependencies
pnpm build                        # compile the host half + bundle the client half
node scripts/smoke-activate.mjs   # smoke test — should print "全部通过"
```

Outputs in `dist/`:
- `dist/server.js` — Host half (Node.js process)
- `dist/client.js` — Client half (browser, `__ModuleLoader__` format)

### Project layout at a glance

```
src/
├── server.ts             # Host entry: Cordis plugin (apply + inject)
├── client.ts             # Client entry: composer dock button + overlay
├── size-presets.ts       # resolution tier + aspect ratio → "WxH"
├── host/routes.ts        # /hunyuan/api/* and /hunyuan/file routes
├── services/             # config / storage / hunyuan API / gallery (JSON)
├── client-services/      # rpc / config-client / bus / file-url
└── slots/                # the three panel components
```

---

## 8. FAQ

### "I changed the output folder but images still go to the old one"
Fixed in v1.0. The path is read live from the config, so the **next** generation after saving
uses the new folder — no plugin restart needed.

### "Images show as broken"
Fixed in v1.0. Browsers cannot load filesystem paths, so the plugin serves them back through the
`/hunyuan/file` route.

### "The gallery is empty"
Fixed in v1.0. A successful generation is written to the gallery index immediately
(`~/.dsh/hunyuan-image/hunyuan-image-gallery.json`).

### "The plugin page shows an error"
1. Make sure dependencies are installed: `cd <plugin dir> && pnpm install`
2. Make sure `dist/` exists and is not empty
3. Copy the red error text from DSH and investigate from there

### "API Key test fails / generation returns 401"
1. Does the Key start with `sk-`? Any stray whitespace?
2. Have you enabled **pay-as-you-go** for that model in the TokenHub console?
3. Has the Key been disabled?

### Do the image links expire?
Tencent's remote URLs expire after **12 hours**, but this plugin downloads every image to disk the
moment it is generated — so gallery images are permanent as long as you keep the local files.

---

## 9. License

MIT. Free to use, modify and redistribute.
