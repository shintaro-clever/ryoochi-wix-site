figma-ai-github-workflow

Integration Hub で プロジェクト（リポジトリ）を量産するときに使う
**標準テンプレート（運用レール / ガードレール / SoT）**です。

このリポジトリは、各プロジェクトで Figma × AI × GitHub を「壊れない運用」で回すための 共通ルールとCIゲートを提供します。

何が入っているか（このテンプレが配布するもの）

Issue Form Template（AI Bootstrap）

PR Template

PR Gate（GitHub Actions）

運用SoT（workflow / decision policy / Phase2-min specs などの docs）

目的（Goal）

Issue → PR → Decision を短時間でトレース可能にする

“会話で決めたが消える” を防ぐ（意思決定は GitHub に残す）

テンプレ＋CIでリンク欠落・ルール逸脱を物理的に防止する

Canonical Workflow（正規ルート）

Issue作成（AI Bootstrapフォーム）

ブランチ作成（例: issue-<number>-<slug>）

実装 → コミット

PR作成（PRテンプレ使用）

PR Gate が緑 → Merge

Decision（必要なら Issue コメントに残す）

Rules（必須）
Issue（案件のSoT）

Figma URL / Default AI / AI thread URL(s) / Acceptance Criteria を必須入力

PR（実装単位）

Fixes #<issue> 必須

AC（チェック済み）が最低1つ必須（PR Gateで検証）

Included

Issue Form Template: .github/ISSUE_TEMPLATE/ai-bootstrap.yml

PR Template: .github/PULL_REQUEST_TEMPLATE.md

PR Gate (Actions): .github/workflows/pr-gate.yml

Docs (SoT): docs/

⚠️ 注意（このテンプレが提供しないもの）

Integration Hub 本体（RBAC/Audit/UI/APIなどのサービス実装）

各プロジェクト固有のプロダクト実装コード

Next Steps（運用開始）

このテンプレから新規リポジトリを作成（GitHub Template機能）

必要なら Branch protection で status check を required に設定

以後は Issue → PR → Gate の正規ルート以外を使わない

📚 Docs（一次情報）

正規ルートと運用ルール: docs/ai/core/workflow.md

Decisionの残し方: docs/ai/core/decision-policy.md

🚀 Current Status（いま出来ていること）

PR Gate（Actions）：PR本文の必須要素チェック（Issue参照 / Figma / ACチェック）

Issue Form：Figma URL / AI thread URL(s) / Acceptance Criteria の入力

Phase1 Integration Hub Stub

./bin/dev — runs npm test first, then starts node server.js so you can open http://127.0.0.1:3000/jobs immediately after the selftest passes.

./bin/dev test — executes npm test only（selftest for phase2 samples）。

./bin/dev smoke — runs node scripts/run-job.js --job scripts/sample-job.mcp.offline.smoke.json --role operator（offline smoke最優先）。

./bin/dev repo-patch — runs node scripts/run-job.js --job scripts/sample-job.repo_patch.hub-static.json --role operator（repo_patch noop挙動の確認用）。

./bin/dev serve — starts the fallback server only（selftestをスキップしたい場合）。

node scripts/run-job.js --job scripts/sample-job.json --role operator — executes any job（local stub by default, MCP if specified）via the adapter without starting the server.
※ legacy scripts/runner-stub.js CLI is for direct local stub debugging only.

npm run vault:index — (re)generate vault/index.json from the contents in .ai-runs/. Run this whenever new evidence should be surfaced through /api/vault/index.

MCP sample jobs

GitHub MCP sample (scripts/sample-job.github.mcp.json):
export GITHUB_TOKEN=<read-only token>（任意）→
node scripts/run-job.js --job scripts/sample-job.github.mcp.json --role operator（または Hub UI）
成功すると .ai-runs/<run_id>/github_repo_meta.json が出力されます。

Figma MCP sample (scripts/sample-job.figma.mcp.json):
export FIGMA_TOKEN=<read-only figma personal access token> →
job JSON に figma_file_key（またはURL）を設定 →
node scripts/run-job.js --job scripts/sample-job.figma.mcp.json --role operator
成功すると .ai-runs/<run_id>/figma_file_meta.json が出力されます。

絶対ルール（先に offline smoke）

実際の指示（本番ジョブ）を流す前に、必ず offline smoke（local_stub） を先に通して接続/配線を確認してください。

成功: .ai-runs/<run_id>/run.json / audit.jsonl が揃う

失敗: run.json / audit.jsonl は必ず残り、run.json.checks / logs を見て切り分ける

OpenAI Exec Smoke（spawn + Codex CLI）

scripts/sample-job.openai_exec_smoke.json を使います。

OPENAI_API_KEY を設定し、npx --yes codex が動く環境で実行:
node scripts/run-job.js --job scripts/sample-job.openai_exec_smoke.json --role operator

Success: stdout preview に OK が出て status:"ok" になれば疎通完了

stderr に既知の警告が含まれる場合があるため、.ai-runs/<run_id>/ 配下の成果物で原文を確認してから判断してください（特定のファイル名には固定しません）。

Hub Jobs 最短ループ（手動確認フロー）

（任意）Diagnostics: /jobs で Diagnostics ジョブを生成・保存し、node scripts/run-job.js --job job.diagnostics.json --role operator を実行。CLI/環境変数を整えてから次へ。

Offline smoke: Offline smoke ジョブを保存して node scripts/run-job.js --job job.offline_smoke.json --role operator を実行し、接続チェックを通す。

Spawn smoke: Spawn smoke ジョブを保存→ node scripts/run-job.js --job job.spawn_smoke.json --role operator で shell なし実行を確認。

OpenAI exec smoke: OPENAI_API_KEY を設定し、node scripts/run-job.js --job job.openai_exec_smoke.json --role operator を実行（stderr に既知の警告が含まれる場合があるため、.ai-runs/<run_id>/ 配下の成果物で原文を確認してから判断）。

Docs update: Docs update ジョブを保存→ node scripts/run-job.js --job job.docs_update.json --role operator で1ファイル差分を確認。

Repo patch: Repo patch ジョブ（noop）を保存→ node scripts/run-job.js --job job.repo_patch.json --role operator で限定的な編集のみ通ることを確認。

最新の run_id は RID="$(ls -1 .ai-runs | tail -n 1)" で取得し、cat .ai-runs/$RID/run.json などで参照します。

Hub UI の表示言語は既定で日本語です。画面右上の Language セレクタで English に切り替えられ、選択内容は ?lang=ja|en と localStorage (hub.lang) に保存されます。

Offline smoke → Spawn smoke → OpenAI exec smoke → Docs Update → Repo Patch の順は SoT で固定されているため、この一本道を崩さずに段階導入してください。

Connections 設定UI（暫定）

node server.js でサーバを起動すると http://localhost:3000/connections から AI / GitHub / Figma の接続情報を入力・保存できます（保存先: apps/hub/data/connections.json）。再読込すると最新の値がフォームに復元されます。

本番環境では必ず Secrets 管理（Vault や CI Secrets）へ移行してください。ここでの保存はローカル検証用途のみです。
