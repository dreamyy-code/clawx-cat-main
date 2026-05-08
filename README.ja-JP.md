﻿﻿﻿﻿﻿<p align="center">
  <img src="src/assets/logo.png" width="128" height="128" alt="ClawX-Cat Logo" />
</p>

<h1 align="center">ClawX-Cat</h1>

<p align="center">
  <strong>OpenClaw ワークフロー向けのデスクトップクライアント</strong>
</p>

<p align="center">
  <a href="#プロジェクト概要">プロジェクト概要</a> •
  <a href="#クイックスタート">クイックスタート</a> •
  <a href="#3つの起動パス">3つの起動パス</a> •
  <a href="#初回起動後の確認">初回確認</a> •
  <a href="#既定ポートとパス">既定ポート</a> •
  <a href="#windows">Windows</a> •
  <a href="#linux">Linux</a> •
  <a href="#ドキュメント案内">ドキュメント</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | 日本語
</p>

---

## プロジェクト概要

`ClawX-Cat` は、OpenClaw の実運用で必要になるセットアップ、プロバイダー設定、対話、チャネル管理、定期実行、日常運用を GUI で扱いやすくまとめたデスクトップクライアントです。CLI をそのまま置き換えるのではなく、日々使う操作を整理して扱いやすくすることを目的にしています。

このプロジェクトは `ClawX` のコードベースを引き継いでいますが、ここでは `ClawX-Cat` として独立した作品として扱います。以下の上流 URL は技術的な出自を示すためのものであり、このリポジトリの宣伝文としては使っていません。

- 上流プロジェクト: <https://github.com/ValueCell-ai/ClawX>

公開リポジトリや二次開発の観点では、Electron シェル、React UI、メインプロセスのルート、OpenClaw 連携、パッケージングスクリプトが既に揃っているベースプロジェクト、と考えるとわかりやすいです。

## このリポジトリが向いている用途

- OpenClaw ベースのデスクトップアプリを一般ユーザー向けに提供したい
- Windows または Linux 上で AI ワークベンチを素早く立ち上げたい
- 既存コードを土台にブランド変更や機能追加を進めたい
- チャネル、プロバイダー、スキル、社内連携を拡張したい

## 主な機能

- プロバイダー、API Key、プロキシ、実行設定の可視化管理
- チャット、チャネル、スキル、定期実行のデスクトップ入口
- Renderer からの直接呼び出しではなく、Host API を中心にした構成
- Electron によるマルチプラットフォーム向けパッケージング
- OpenClaw 互換の派生プロダクトを作るための実用的なベース

## ClawX-Cat が ClawX から広げている点

上流のデスクトップクライアントをそのまま使うのではなく、`ClawX-Cat` は「配備しやすいこと」「拡張しやすいこと」「その先の製品化につなげやすいこと」を強く意識した分岐になっています。

- **Linux を本番運用寄りに扱っている**: Linux / headless を前提にした運用導線が入り、`clawx-update.sh`、`start_clawx_headless.sh`、`set_clawx_bridge_token.sh`、`clawx-uninstall.sh` を成果物に含めやすくしています。
- **軽量起動によって遠隔ホスト配備がしやすい**: まずサービスと橋接レイヤーだけを安定して立ち上げたい運用に向いています。
- **版数変更と OpenClaw 更新がスクリプト化されている**: `set-version.cjs`、`set-version.bat`、`update-openclaw.bat`、`scripts/update-openclaw.ps1` が用意されています。
- **Linux パッケージングがアーキテクチャと track を前提に整理されている**: `scripts/build-linux-package.ps1` がアーキテクチャ、成果物形式、更新 track、OpenClaw track をまとめて制御します。
- **Windows 側も製品バリエーションを扱いやすい**: `scripts/build-win-variants.cjs` により複数の build profile や OpenClaw track を切り替えられます。
- **橋接は WebSocket だけでなく HTTP も使える**: `POST /api/bridge-http/command` と `GET /api/bridge-http/events` により APP や制約の多いクライアントが接続しやすくなっています。
- **APP 接続の話が実設計として進んでいる**: UniApp / 遠程制御まわりの設計文書があり、実装準備が進んでいます。
- **多人協調や多端末運用へ広げやすい**: Linux の軽量起動、二重橋接、APP 接続、多 Agent の土台がそろっています。
- **多 Agent を UI と運用の側へ引き上げている**: 専用 Agent ページ、`agent:` 会話 key、`@agent` ルーティング、多 Agent セッション処理がすでに入っています。
- **画面構成と操作導線がより日常利用向け**: ファイル管理、SkillHub、推奨セットアップ導線などにより使い始めやすさを高めています。

## クイックスタート

### 動作要件

- OS: Windows 10/11 x64、Linux x64/arm64
- Node.js: 22 以上、24 LTS 推奨
- Git: リポジトリの clone と更新に必要
- pnpm: `package.json` に固定されたバージョンを Corepack 経由で使用
- メモリ: 最低 4GB、推奨 8GB
- ディスク: 依存関係やビルドを考慮して 4GB 以上推奨

### リポジトリを clone

```bash
git clone <your-repo-url>
cd <your-repo-directory>
```

### 依存関係の初期化

```bash
corepack enable
corepack prepare pnpm@10.31.0 --activate
pnpm --version
pnpm run init
```

補足:

- `pnpm run init` は依存関係のインストールと `uv` バイナリ取得をまとめて行います
- `pnpm dev` は `vite-plugin-electron` により Electron 開発宿主と renderer を一緒に起動します

## 3つの起動パス

### 1. ソースコードからの開発起動

```bash
pnpm dev
```

関連ドキュメント:

- [ClawX-Cat-从源码到跑通第一条消息.md](doc/ClawX-Cat-从源码到跑通第一条消息.md)
- [ClawX-Cat-Linux-Headless-快速手册.md](doc/ClawX-Cat-Linux-Headless-快速手册.md)

### 2. Linux Debian パッケージ起動

1. `build_linux_amd.bat` または `build_linux_arm.bat` で `.deb` を作成
2. 成果物を Linux ホストへコピー
3. 産物ディレクトリでインストーラスクリプトを実行

```bash
chmod +x install_debian_clawx.sh
./install_debian_clawx.sh ./ClawX-<version>-linux-amd64.deb
```

### 3. Linux Headless 常駐起動

```bash
chmod +x start_clawx_headless.sh
./start_clawx_headless.sh start-bg
./start_clawx_headless.sh status
```

長期稼働、環境ファイル、ログ管理については次を参照してください。

- [ClawX-Cat-Linux-Headless-快速手册.md](doc/ClawX-Cat-Linux-Headless-快速手册.md)

## 初回起動後の確認

初回は次の順で確認すると迷いにくいです。

1. GUI の主ウィンドウが出る、または headless プロセスが起動済みと確認できる
2. Gateway が利用可能になっている
3. 少なくとも 1 つのモデル / provider を設定する
4. チャットでテストメッセージを 1 件送る
5. リモート接続が必要なら Bridge を有効化して port と token を控える

最短の橋接確認には次を参照してください。

- [ClawX-Bridge-接入说明.md](doc/ClawX-Bridge-接入说明.md)
- [ClawX-Cat-HTTP-Bridge-接口文档.md](doc/ClawX-Cat-HTTP-Bridge-接口文档.md)
- [ClawX-Cat-WebSocket-Bridge-接口文档.md](doc/ClawX-Cat-WebSocket-Bridge-接口文档.md)
- [ClawX-Cat-Bridge-命令类型清单.md](doc/ClawX-Cat-Bridge-命令类型清单.md)

## 既定ポートとパス

| 項目 | 既定値 | 説明 |
|------|--------|------|
| Host API | `127.0.0.1:13210` | ローカル専用 |
| OpenClaw Gateway | `18789` | ローカル Gateway の既定ポート |
| WebSocket Bridge | `18989` | 既定では無効 |
| Bridge Discovery | `18990` | LAN 検出ポート |
| HTTP Bridge | `18991` | 既定では無効 |
| Linux install state | `/etc/clawx/install-state.json` | track / version / package source を記録 |
| Headless env file | `/etc/clawx/clawx.env` | headless 起動時に読み込む |
| Headless log file | `/var/log/clawx/clawx-headless.log` | バックグラウンド既定ログ |

補足:

- 既定では `bridgeEnabled=false`、`bridgeHttpEnabled=false`、`bridgeAllowRemote=false`
- 外部クライアントは Host API ではなく Bridge を使う前提で考える方が安全です

## Bridge と Relay の違い

- `Bridge` は同一 LAN やローカルスクリプト、APP 直結向けの機器側入口です
- `Cloud Relay` はクロスネットワークやアカウント連携用の任意サービスです
- まずローカルで起動確認するだけなら Relay は不要です

参照先:

- [ClawX-Bridge-接入说明.md](doc/ClawX-Bridge-接入说明.md)
- [Cloud Relay Service README.md](services/cloud-relay/README.md)

## Windows

### 推奨環境

- `Git for Windows`
- `Node.js 24 LTS`
- `PowerShell 7` または Windows PowerShell 5.1+
- 固定 pnpm を有効化した `corepack`

### 一式のセットアップコマンド

```powershell
git clone <your-repo-url>
cd <your-repo-directory>
corepack enable
corepack prepare pnpm@10.31.0 --activate
pnpm run init
pnpm dev
```

### Windows パッケージ作成

```powershell
.\build.bat
```

補足:

 - `build.bat` は Windows 向け公開ビルドの入口スクリプトです
 - `.\build.bat 1.2.3` のように版数を渡せます
 - 版数指定時は先に `node set-version.cjs <version>` を実行し、その後 `pnpm run package:win:variants` を呼び出します

## Linux

### 推奨環境

- `git`
- `Node.js 24 LTS`
- `corepack`
- 一般的なデスクトップライブラリ
- ヘッドレス検証用の `xvfb`

Debian / Ubuntu 系での一例:

```bash
sudo apt update
sudo apt install -y git curl build-essential libgtk-3-0 libnotify4 libxss1 libxtst6 libnss3 libasound2 xvfb
```

### 一式のセットアップコマンド

```bash
git clone <your-repo-url>
cd <your-repo-directory>
corepack enable
corepack prepare pnpm@10.31.0 --activate
pnpm run init
pnpm dev
```

### Linux パッケージ作成

```powershell
.\build_linux_amd.bat
.\build_linux_arm.bat
.\build_linux_generic_amd.bat
```

版数更新付きの例:

```powershell
.\build_linux_amd.bat 1.2.3
.\build_linux_arm.bat 1.2.3
.\build_linux_generic_amd.bat 1.2.3
```

## よくある質問

### `pnpm dev` はフロントエンドだけですか？

いいえ。現在の開発構成では Electron の main / preload も一緒に起動します。

### 外部端末は Host API に直接つなぐべきですか？

いいえ。Host API は `127.0.0.1` で待ち受ける設計なので、外部接続は Bridge を優先してください。

### Linux に GUI がなくても動きますか？

動きます。`start_clawx_headless.sh` を使い、必要に応じて headless 用の手引きを参照してください。

### Cloud Relay は必須ですか？

必須ではありません。ローカル開発や同一 LAN の APP 接続では Bridge だけで十分です。

## ドキュメント案内

### 起動と運用

- [ClawX-Cat-从源码到跑通第一条消息.md](doc/ClawX-Cat-从源码到跑通第一条消息.md)
- [ClawX-Cat-Linux-Headless-快速手册.md](doc/ClawX-Cat-Linux-Headless-快速手册.md)
- [Cloud Relay Service README.md](services/cloud-relay/README.md)

### 橋接ドキュメント

- [ClawX-Bridge-接入说明.md](doc/ClawX-Bridge-接入说明.md)
- [ClawX-Cat-HTTP-Bridge-接口文档.md](doc/ClawX-Cat-HTTP-Bridge-接口文档.md)
- [ClawX-Cat-WebSocket-Bridge-接口文档.md](doc/ClawX-Cat-WebSocket-Bridge-接口文档.md)
- [ClawX-Cat-Bridge-命令类型清单.md](doc/ClawX-Cat-Bridge-命令类型清单.md)

### 設計資料

- [ClawX-UniApp-远程控制设计手册.md](doc/ClawX-UniApp-远程控制设计手册.md)
- [ClawX-Linux-无GUI服务化远程控制实施方案.md](doc/ClawX-Linux-无GUI服务化远程控制实施方案.md)
- [ClawX-Linux-更新与自动更新方案.md](doc/ClawX-Linux-更新与自动更新方案.md)

## よく使うコマンド

| 用途 | コマンド |
|------|----------|
| 初期化 | `pnpm run init` |
| 開発起動 | `pnpm dev` |
| ESLint 実行 | `pnpm run lint` |
| 型チェック | `pnpm run typecheck` |
| 単体テスト | `pnpm test` |
| E2E テスト | `pnpm run test:e2e` |
| Windows dual-track ビルド | `.\build.bat` |
| Linux AMD64 Debian ビルド | `.\build_linux_amd.bat` |
| Linux ARM64 Debian ビルド | `.\build_linux_arm.bat` |
| Linux AMD64 generic ビルド | `.\build_linux_generic_amd.bat` |
| OpenClaw 更新 | `.\update-openclaw.bat 2026.4.14` |
| アプリ版数設定 | `.\set-version.bat 1.2.3` |
| Cloud Relay 起動 | `pnpm run relay:service` |

## リポジトリ構成

```text
ClawX-Cat/
├── electron/                # Electron メインプロセス、Host API、ゲートウェイ連携
├── src/                     # React Renderer のページとコンポーネント
├── tests/                   # 単体テストと Electron E2E
├── resources/               # アイコン、スクリーンショットなどの静的資産
├── scripts/                 # ビルド、ダウンロード、パッケージ補助スクリプト
├── build/                   # 同梱資産と OpenClaw 関連のビルド成果物
├── doc/                     # 操作手順、橋接ドキュメント、設計資料
└── README*.md               # 多言語ドキュメント
```

## 開発メモ

- Renderer から後段機能を呼ぶときは `host-api` / `api-client` を優先してください
- ページ内部に裸の `ipcRenderer.invoke(...)` を増やさない方針が安全です
- 公開用のパッケージを作る前に、`package.json` と `.github/workflows` をセットで確認してください
- 挙動変更時は 3 つの README を同じコミットで更新し、多言語の差分拡大を防いでください

## ライセンス

このリポジトリは [MIT License](LICENSE) を使用しています。再配布や拡張時には、追加した依存関係や同梱資産のライセンスもあわせて確認してください。
