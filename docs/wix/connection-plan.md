# Wix GitHub 連携 セットアップ手順

## 概要

Wix Studio サイトと GitHub を連携して、コード変更を自動でプレビューできる状態を構築する手順です。
**Wix Studio GitHub Integration で生成したリポジトリを起点**とし、そこに CI・ドキュメント・AI 管理ルールを移植する流れが主線です。

### なぜこの方針か（3 行要約）

1. **Wix CLI / Studio が期待する構造の正本は Wix 生成側にある** — `src/` や `wix.config.json` は Wix が生成・管理するものであり、手動作成や別リポジトリからのコピーでは CLI が起動しない。
2. **既存リポジトリに合わせようとするより破綻しにくい** — 既存リポジトリを母体にした場合、`wix preview --source remote` は Wix が認識しているリポジトリを参照するため、こちらの変更が Wix 側に届かない「静かな不整合」が起きる。
3. **障害切り分けがしやすい** — Wix 生成リポジトリを母体にすると、`src/` 関連は Wix 側・CI や Secrets はこちら側、と責任領域が分かれる。詳細は後述。

```
全体の流れ
  Step 1: Wix Studio GitHub Integration → リポジトリ生成（src/ が自動生成される）
  Step 2: 生成リポジトリに GitHub 運用資産を移植
  Step 3: CI 動作確認（main push → wix preview）
```

---

## Step 1：Wix Studio GitHub Integration でリポジトリを生成する

Wix Studio の GitHub Integration を使ってリポジトリを生成します。
Wix が `src/`（Velo ファイル構造）と `wix.config.json` を自動生成・プッシュします。

### 手順

1. Wix Studio エディターを開く
2. GitHub Integration（Git Integration）を開く
3. 新規リポジトリ名を入力して作成する（例: `my-site-1`）
4. Wix が GitHub にファイルをプッシュするまで待つ

### 生成後に確認するファイル

```
<生成リポジトリ>/
  wix.config.json          ← Wix が自動生成（siteId を含む）
  src/
    pages/
      masterPage.js        ← 必須
      Home.c1dmp.js        ← ページコード（名前は案件により異なる）
    backend/
      permissions.json
    styles/
      global.css
    public/
```

### wix.config.json の確認

Wix が生成した `wix.config.json` に `uiVersion` がない場合は追記する。

```json
{
  "siteId": "<自動生成された siteId>",
  "uiVersion": "6"
}
```

### なぜ Wix 生成リポジトリを起点にするか（詳細）

**理由 1：Wix CLI / Studio が期待する構造の正本が Wix 生成側にある**

Wix CLI は `src/pages/masterPage.js` を含む Velo コード構造を前提として動作します。この構造は Wix Studio GitHub Integration が自動生成するものです。手動で `src/` を作成したり、別リポジトリからファイルをコピーしたりすると、CLI が `ENOENT: no such file or directory, scandir '...src'` エラーを出して起動しません。`wix.config.json` に含まれる `siteId` も Wix が発行するものであり、こちら側で用意できる値ではありません。

**理由 2：既存リポジトリに合わせようとするより破綻しにくい**

`wix preview --source remote` は「Wix が GitHub Integration で認識しているリポジトリの `main` ブランチ」を参照します。既存リポジトリ（例: `ryoochi-wix-site`）を母体にした場合、Wix が認識しているのは自身が生成したリポジトリ（例: `my-site-1`）であるため、`ryoochi-wix-site` への変更は Wix 側に届きません。CI は成功するのにデザインが反映されないという、原因が見えない破綻が起きます。Wix 生成リポジトリを母体にすることで、この問題を構造的に排除します。

**理由 3：障害切り分けがしやすい**

| 症状 | 原因の所在 |
|---|---|
| `src/` 構造エラー・ページ未検出 | Wix 生成物の問題（触るべきでなかった） |
| CI 失敗・プレビューURL 未生成 | こちら側（Secrets・ワークフロー・package.json） |
| デザイン変更が反映されない | Wix の連携先リポジトリとのずれ（→ 母体が間違っている） |

Wix 生成リポジトリを母体にすると、上記 3 パターンのどれに当たるかが即座に判断できます。

---

## Step 2：生成リポジトリに GitHub 運用資産を移植する

Wix が生成したリポジトリはコードのみのシンプルな構成です。
ここに CI・ドキュメント・AI 管理ルールなどを追加します。

### 移植するもの

| 資産 | 内容 |
|---|---|
| `.github/workflows/wix-preview-on-push.yml` | main push → `wix preview --source remote` |
| `agents/` | AI エージェント行動規範（SoT） |
| `docs/` | Wix 連携ドキュメント・マニュアル |
| `scripts/` | PR 自動化スクリプト |
| `prototype/` | 静的 HTML 原型 |
| `AGENTS.md`, `CLAUDE.md` | AI 向けルールの入口 |
| `package.json` | `@wix/cli` devDependency を追加 |
| `.devcontainer/` | Codespaces 設定 |

### GitHub Secrets の設定

生成リポジトリの Settings → Secrets → Actions に追加する。

| シークレット名 | 内容 |
|---|---|
| `WIX_API_KEY` | Wix ダッシュボードで発行した API キー |

### CI ワークフロー（移植内容）

```yaml
# .github/workflows/wix-preview-on-push.yml（主要部分）
- name: Login to Wix CLI
  run: npx wix login --api-key "$WIX_API_KEY"

- name: Create Wix preview from main
  run: npx wix preview --source remote
```

`--source remote` = Wix が認識しているこのリポジトリの `main` ブランチを参照します。
Wix 生成リポジトリを使っているため、これが正しく機能します。

---

## Step 3：CI 動作確認

### ローカルで動作確認する（任意）

```bash
npx wix login --api-key <WIX_API_KEY>
npx wix dev
```

成功するとブラウザで Wix Studio ローカルエディターが開く。

### CI（GitHub Actions）で確認する

`main` ブランチへコミットをプッシュする。

```
main push
  → wix login --api-key
  → wix preview --source remote
  → ✔ Your preview deployment is now available at https://wix.to/xxxxx
```

Actions のログにプレビューURLが表示されれば連携完了。

---

## 注意事項

- `wix preview --source remote` は本番公開をしない（プレビューURLのみ生成）
- 本番公開（`wix publish`）はドメイン設定・課金が整った後に手動で行う
- `wix.config.json` はコミット対象（`.gitignore` には含めない）
- `.wix/` はコミット対象外（`.gitignore` で除外済み）
- Wix Studio 側でビジュアル編集した内容と、`src/` のコードは独立して管理される

---

## 別案件への流用

新規案件でも手順は同じ。

1. **Step 1**：Wix Studio GitHub Integration で案件ごとに新しいリポジトリを生成する
2. **Step 2**：前回の移植済みリポジトリをテンプレートとして運用資産をコピーする
3. **Step 3**：`WIX_API_KEY` を新リポジトリの Secrets に設定して CI 確認

> **非推奨（過去の試行）**：既存リポジトリに `src/` だけをコピーして連携しようとした手順は機能しません。
> Wix は自身が生成したリポジトリしか認識しないためです。この方法は採用しないでください。
