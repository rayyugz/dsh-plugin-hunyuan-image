# Tencent Hunyuan 画像生成 · DSH ネイティブプラグイン

Languages: [English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · **日本語** · [한국어](README.ko.md) · [Português](README.pt.md) · [Español](README.es.md) · [Русский](README.ru.md)

> Tencent Hunyuan の **Hy-Image-3.5-preview** と **Hy-Image-3.0** を
> [DSH（DeepSeek Harness）](https://deepseek.com) に統合します — 生成パネル、ローカルギャラリー、
> 公式の2段階サイズ選択、バッチ生成を備えています。
> **ネイティブ依存ゼロ。macOS、Windows、Linux で動作します。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: ≥20](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![CI](https://github.com/rayyugz/dsh-plugin-hunyuan-image/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

---

## ✨ 機能

- **2つのモデル**
  - `hy-image-v3.5-preview` — Chat/Messages プロトコル。マルチモーダル入力、マルチターン編集、
    思考連鎖によるプロンプト書き換えに対応。最大 **4K（4096×4096）** 出力
  - `hy-image-v3` — 定番のテキストto画像。プロンプトの自動書き換えと公式の37種類のプリセットサイズに対応
- **公式の2段階サイズ選択** — **解像度ティア × アスペクト比**。Tencent TokenHub の Web コンソールと
  同じ操作感です。プラグインは選択内容を API が要求する `WxH` 文字列に変換し、公式の制約を
  満たすことを保証します
  （v3.5：各辺 [256, 8192]、面積 ≤ 16,777,216。v3.0：各辺 [512, 2048]、面積 ≤ 1,048,576）。
  UI には送信される正確なサイズが表示されます。
- **バッチ生成** — 1回のリクエストで **1 / 2 / 4 枚**を生成（並列で発行）。
  結果は `1/4` のインデックスバッジ付きで1枚ずつ表示されます。部分的な失敗は明示的に報告されます。
- **ローカルギャラリー**
  - 生成に成功した画像は**自動的に保存**されます（プレーン JS の JSON ストレージ — SQLite もネイティブモジュールも不要）
  - **サムネイルグリッド**とリスト表示
  - **キーワード検索**（プロンプトと書き換え後のプロンプトにマッチ）に加え、モデルと期間による絞り込み
  - **詳細ドロワー**：完全なプロンプト、モデル、サイズ、タイムスタンプ、ローカルパスを表示
  - **🔁 再生成** — 元のプロンプトとパラメータをワンクリックで再入力
  - 複数選択による**一括削除**（ローカルファイルも削除）、プロンプトのコピー、画像のコピー
- **出力フォルダをカスタマイズ可能** — デフォルトは `~/Pictures/DSH-Hunyuan-Image` ですが、任意の場所を
  指定できます（システムドライブ以外を推奨）。**「選択…」**をクリックすると OS ネイティブのフォルダピッカーが開きます。
  **変更は即座に反映され、プラグインの再起動は不要です。** ファイルは
  `<フォルダ>/<YYYY-MM>/` の下に月単位で振り分けられ、1つのディレクトリに数千のファイルが溜まるのを防ぎます。
- **公式の詳細パラメータ**（意図的にセッション限定 — [ロードマップ](#-既知の制限とロードマップ)を参照）

  | パラメータ | 対象 | 説明 |
  |---|---|---|
  | シード `seed` | 両方 | 同じ結果を再現 |
  | ウォーターマーク脚注 `footnote` | 両方 | ≤ 16 文字、右下隅に描画 |
  | 外部検索拡張 `use_search_tool` | v3.5 | 描画前にモデルに Web 検索させる |
  | 参照画像の面積上限 `resize_max_pixels` | v3.5 | 大きな（4K/6K）参照画像のトークンコストを制限 |
  | プロンプト自動書き換え `revise` | v3.0 | 約 11 秒追加。デフォルトで有効を推奨 |

- **参照画像** — ディスクからアップロード（data URL に変換）するか、公開 URL を渡します。
  v3.5 は最大 20 枚（各 ≤ 20 MB）、v3.0 は最大 3 枚（各 ≤ 10 MB）。
- **モデルから呼び出し可能** — プラグインは **`hunyuan_generate_image`** ツールを登録するので、
  会話で「猫を描いて」と言うだけでモデルがそれを呼び出します。
- **画像が永続化** — Tencent のリモート URL は **12 時間**で失効します。プラグインは生成された
  すべての画像を即座にディスクへダウンロードするため、ギャラリーの項目が壊れることはありません。

> 📌 未実装の機能は
> [既知の制限とロードマップ](#-既知の制限とロードマップ)に正直に記載しています。
> この README は現行バージョンが実際にできることだけを説明します。

---

## 📦 インストール

### 方法1 — リリースからインストール（推奨、ビルド不要）

1. [**Releases**](../../releases) ページから `dsh-plugin-hunyuan-image-1.0.0.tgz` をダウンロードします。
2. 永続的なフォルダ（例：`~/dsh-plugins/`）に展開します。

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   ```

3. DSH のチャットで、アシスタントに次のように伝えます。

   > `~/dsh-plugins/package` を DSH プラグインとしてインストールしてください（`plugin_manager` の `install_bundle` を使用）。

4. DSH を再起動します。

> 再インストール / 新しいマシンでの手順を1つずつ解説：[**INSTALL.md**](INSTALL.md)
> （[简体中文](INSTALL.zh-CN.md) もあります）。

### 方法2 — ソースからビルド（開発者向け）

**Node ≥ 20** と **pnpm** が必要です。

```bash
git clone https://github.com/rayyugz/dsh-plugin-hunyuan-image.git
cd dsh-plugin-hunyuan-image

pnpm install
pnpm build                        # host 側をコンパイル + client 側をバンドル
node scripts/smoke-activate.mjs   # スモークテスト — "全部通过" と表示されれば成功

# DSH プロファイルにリンク
# macOS / Linux:
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image
# Windows（PowerShell、管理者）:
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"
```

次に、プロファイルの `package.json` にプラグイン名を追加し（`dependencies` と
`dsh.profile.bundles` の両方）、DSH を再起動します。

---

## ⚙️ 設定

### 1. API Key を取得する

1. [Tencent Cloud](https://cloud.tencent.com) に登録 / ログインします
2. [TokenHub サービス](https://console.cloud.tencent.com/tokenhub) を有効化します
3. [API Key ページ](https://console.cloud.tencent.com/tokenhub/apikey) で Key を作成します — `sk-...` のような形式です
4. [オンライン推論 → ビジョンモデル](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION) で
   `hy-image-v3.5-preview` と `hy-image-v3` の**従量課金**を有効にします

### 2. プラグインの設定を入力する

プラグインパネル（コンポーザー下の **🖼 Hunyuan Image** ボタン）→ **設定** タブを開きます。

| 項目 | 説明 | デフォルト |
|---|---|---|
| **API Key** | 上記で作成した Key | — |
| **出力フォルダ** | 任意の場所。システムドライブ以外を推奨 | `~/Pictures/DSH-Hunyuan-Image` |
| **デフォルトモデル** | `hy-image-v3.5-preview` または `hy-image-v3` | v3.5-preview |
| **デフォルト解像度** | [サイズ](#-サイズ)を参照 | `1K` |
| **デフォルトのアスペクト比** | [サイズ](#-サイズ)を参照 | `1:1` |
| **ウォーターマーク脚注** | ≤ 16 文字、右下隅 | 空 |

**保存**をクリックし、次に **🔌 接続テスト** をクリックして Key が有効か確認します。

> ⚠️ **注意**：画像は **月のサブフォルダ**の下に保存されます。例：
> `AI-images/2026-10/1791629683045-xxxx.png` — フォルダのルート直下ではありません。

---

## 🖼 サイズ

プラグインは公式の TokenHub ピッカーを再現しています：**解像度ティア**と**アスペクト比**を選びます。

### Hy-Image-3.5-preview

| ティア | アスペクト比 | 備考 |
|---|---|---|
| `1K` / `1.5K` / `2K` | `21:9` `16:9` `4:3` `1:1` `2:3` `3:2` `3:4` `9:16` | 面積 ≈ 1M / 2.36M / 4.19M px |
| `4K` | 同上 | 面積 ≤ 16,777,216 px。例：16:9 → `5461x3072` |
| `Auto` | — | `size` は送信されず、モデルが決定します |

### Hy-Image-3.0

| ティア | アスペクト比 | 備考 |
|---|---|---|
| `720P` / `1K` | `1:1` `3:4` `4:3` `9:16` `16:9` `3:5` `5:3` | 各辺 ∈ [512, 2048]、面積 ≤ 1,048,576 を満たす必要あり |
| `Auto` | — | モデルが公式の37プリセットから選択します |

**サイズの目安**（実際に送信される値）：

```
v3.5  1K   16:9 = 1365x768      1:1 = 1024x1024
      2K   16:9 = 2731x1536     1:1 = 2048x2048
      4K   16:9 = 5461x3072     1:1 = 4096x4096
v3.0  720P 16:9 = 1280x720      1:1 = 960x960
      1K   16:9 = 1365x768      1:1 = 1024x1024
```

62 通りの組み合わせすべてが、公式の制約に対してプログラムで検証されます。

---

## 📚 ギャラリーの使い方

| 操作 | 方法 |
|---|---|
| **検索** | 上部の検索ボックス（300 ms デバウンス。プロンプト / 書き換え後プロンプト / キーワードにマッチ） |
| **絞り込み** | モデル別、および期間別 |
| **複数選択** | カード上のチェックボックス、またはホバーオーバーレイ |
| **一括削除** | 項目を選択すると、上部に一括操作バーが表示されます |
| **1枚を確認** | ホバーオーバーレイ、または詳細ドロワーを開く |
| **再生成** | 詳細ドロワーの 🔁 — 生成パネルに戻り、プロンプトとパラメータを再入力します |
| **プロンプトをコピー** | 詳細ドロワーの 📋 |
| **画像をコピー** | 詳細ドロワーの 🖼（ブラウザが `ClipboardItem` を持たない場合はローカルパスのコピーにフォールバック） |

---

## ⚠️ 既知の制限とロードマップ

### 制限（Tencent API または DSH ホストによるもの）

| 項目 | 詳細 |
|---|---|
| **リモート画像 URL の有効期限** | わずか 12 時間 — このプラグインはすべての画像を即座にディスクへダウンロードするため、ギャラリーの項目は永続します |
| **参照画像サイズ** | v3.5 は各 ≤ 20 MB、v3.0 は各 ≤ 10 MB |
| **参照画像の枚数** | v3.5 ≤ 20、v3.0 ≤ 3 |
| **ウォーターマーク脚注** | ≤ 16 UTF-8 文字 |
| **`generate_max_pixels` は 2K が上限** | より高い解像度は `size` を経由する必要があります（このプラグインは解像度ティアでそれを行います） |
| **マルチターン編集** | v3.5 のみ。プラグインはサーバーが返す `assembled_history` を保存しますが、マルチターン編集用の UI はまだありません |
| **詳細パラメータは永続化されません** | 外部検索、参照画像の面積上限、書き換えの各トグルは**現在のセッションにのみ**適用され、パネルを開き直すとリセットされます。これは意図的な設計で、後から診断しづらい隠れた状態を避けるためです |

### まだ実装されていないもの

| 機能 | 状況 | 理由 |
|---|---|---|
| **ギャラリーに言及したときの「ギャラリーを開く」ボタン自動表示** | ❌ | セッションメッセージイベントを監視してアクションボタンを注入する必要があり、v1.0 では未接続 |
| **エクスポート / 名前を付けて保存ダイアログ** | ⚠️ スタブ | DSH はまだプラグインに「名前を付けて保存」ダイアログを公開していません。呼び出しは黙って失敗せず、明示的な理由を返します |
| **WeChat / Feishu 共有** | ⚠️ スタブ | DSH はまだプラグインに IM 共有チャネルを公開していません |
| **画像を会話にドラッグ** | ❌ | DSH がドラッグイベントを公開することに依存 |
| **マルチターン編集 UI** | ❌ | データ層は準備済み（`assembledHistory`）。不足しているのは UI のみ |
| **DSH 公式プラグインマーケットプレイス** | ❌ | DSH チームによるレビューが必要 |
| **パネル UI の多言語化** | ❌ | パネル内の UI は現在**中国語のみ**です。プラグインのタイトルと説明はローカライズ済み（EN/ZH）ですが、パネル内のラベルは未対応です。この多言語 README は暫定対応です |

フィードバックとプルリクエストを歓迎します — [Issue](../../issues) を作成してください。

---

## 🛠 開発

### プロジェクト構成

```
dsh-plugin-hunyuan-image/
├── package.json              # プラグイン manifest（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml          # Cordis ローダー patch：host プラグイン行を宣言
├── icon.svg / locale/        # 表示メタデータ（アイコン + 英語/中国語のタイトルと説明）
├── scripts/
│   ├── build-client.mjs      # TS/TSX を DSH クライアントのモジュールテーブル形式にバンドル
│   └── smoke-activate.mjs    # アクティベーションのスモークテスト（DSH 再起動前に実行）
├── src/
│   ├── server.ts             # ★ Host 側：Cordis プラグインエントリ（apply + inject）
│   ├── client.ts             # ★ Client 側：composer dock + パネルオーバーレイを登録
│   ├── types.ts              # モジュール間のデータ契約
│   ├── size-presets.ts       # 解像度ティア + アスペクト比 → "WxH"（制約チェック付き）
│   ├── host/
│   │   └── routes.ts         # host HTTP エンドポイント：/hunyuan/api/* と /hunyuan/file
│   ├── client-services/
│   │   ├── rpc.ts            # client → host の fetch ラッパー
│   │   ├── config-client.ts  # 設定キャッシュ + 更新
│   │   ├── bus.ts            # イベントバス（フォルダピッカー、ファイルピッカー、…）
│   │   └── file-url.ts       # ローカル画像パス → 読み込み可能な URL
│   ├── services/
│   │   ├── config.ts         # 設定の永続化（JSON、アトミック書き込み）
│   │   ├── storage.ts        # ローカルファイル管理 + 画像ダウンロード（パスは設定にライブで追従）
│   │   ├── hunyuan.ts        # Hunyuan API ゲートウェイ（v3 + v3.5）
│   │   └── gallery.ts        # JSON ギャラリー（メモリ内インデックス + アトミック書き込み、ネイティブ依存なし）
│   └── slots/
│       ├── generator-panel.tsx   # 生成パネル（オーバーレイの「生成」タブ）
│       ├── gallery-panel.tsx     # ギャラリーパネル（オーバーレイの「ギャラリー」タブ）
│       └── settings-panel.tsx    # 設定パネル（オーバーレイの「設定」タブ）
├── README.md + 7 translations (.zh-CN · .zh-TW · .ja · .ko · .pt · .es · .ru)
├── INSTALL.md / INSTALL.zh-CN.md
└── LICENSE
```

### アーキテクチャの補足

- **2つのエントリ**：`dist/server.js` は Host 側（Node.js プロセス）、`dist/client.js` は
  Client 側（ブラウザ）です。後者は `window.__ModuleLoader__.load({id, factory})` 形式でなければならず、
  `scripts/build-client.mjs` が esbuild 経由で生成します。JSX は強制的に
  `React.createElement` へコンパイルされます。DSH のモジュールテーブルは `React` を提供しますが、
  `react/jsx-runtime` は提供**しません**。
- **UI のエントリポイント**：クライアントは `conversation.composer.dock` スロットを1つだけ登録します（ボタン）。
  クリックすると、生成 / ギャラリー / 設定の3つのタブを持つオーバーレイが開きます。
- **Client ↔ host**：クライアントは `fetch('/hunyuan/api/<method>')` を通じて host を呼び出します。画像は
  `/hunyuan/file?path=<absolute path>` を通じて返されます（パストラバーサルを防ぐため、
  設定された出力フォルダ内のファイルに限定）。
- **ネイティブ依存ゼロ**：ギャラリーは SQLite ではなく JSON ファイルなので、DSH アプリの
  macOS コード署名 / ハードンドランタイムの制限下でも問題なく読み込め、
  Windows や Linux での再ビルドも不要です。

### ローカルビルド

```bash
pnpm install
pnpm build         # tsc → dist/（host）、esbuild → dist/client.js（client）
pnpm typecheck     # tsc --noEmit
node scripts/smoke-activate.mjs
```

### デバッグモード

詳細なログを出力するには、`--plugin-debug=hunyuan-image` を付けて DSH を起動します。

---

## 🤝 コントリビューション

Issue とプルリクエストを歓迎します。

- 🐛 バグを見つけた → [バグレポートを作成](../../issues/new?template=bug.md)
- 💡 アイデアがある → [機能リクエストを作成](../../issues/new?template=feature.md)
- 🔧 コードを送る → fork、branch、PR

---

## 📄 ライセンス

MIT © [rayyugz](https://github.com/rayyugz)

---

## 🙏 謝辞

- API を提供してくれた Tencent Hunyuan チーム
- プラグイン基盤を提供してくれた DSH チーム
- Issue を報告し、このプラグインの改善に協力してくださるすべての方
