Phase1 Integration Hub Stub（検証器：/jobs）
テスト行（PR動作確認用）

/jobs は本体UIではなく、Phase2 の「ジョブ生成→実行→結果取り込み→次アクション」を回すための検証用UIです。

このリポジトリは、各プロジェクトで **Figma × AI × GitHub** を「壊れない運用」で回すための
**共通ルール・CIゲート・一次情報（SoT）**を提供します。

## Goal（このテンプレの目的）

- Issue → PR → Decision を短時間でトレース可能にする
- “会話で決めたが消える” を防ぐ（意思決定は GitHub に残す）
- テンプレ＋CIでリンク欠落・ルール逸脱を物理的に防止する

## This Repo Provides（配布物）

- Issue Form Template（AI Bootstrap）
- PR Template
- PR Gate（GitHub Actions）
- Docs（SoT: workflow / decision policy / Phase2-min specs など）

---

## Canonical Workflow（正規ルート）

1. Issue作成（AI Bootstrapフォーム）
2. ブランチ作成（例: `issue-<number>-<slug>`）
3. 実装 → コミット
4. PR作成（PRテンプレ使用）
5. PR Gate が緑 → Merge
6. Decision（必要なら Issue コメントに残す）

## Rules（必須）

### Issue（案件のSoT）

- `Figma URL / Default AI / AI thread URL(s) / Acceptance Criteria` を必須入力

## Product UI（本体UIの構成）

`/ui/` 配下の新UIを本体UIの正本とする。旧HTML直配信問題は修正済みであり、今後の UI 仕様・導線定義は `/ui/` を基準に扱う。
Phase5 の Workspace IA は `docs/ai/core/workspace-ia-phase5.md` を正とし、現状UIではなく目標UIへ寄せる。

本体プロダクトは以下の導線を想定します。

1. **Connectors（一覧）**: 対応ツール（コネクタ）を一覧表示し、検索/フィルタで選択する
2. **Connector詳細（設定）**: ツールごとの接続情報（Token/OAuth/権限）を設定し、状態（未設定/接続OK/権限不足/エラー等）を表示する
3. **Account（アカウント設定）**: ワークスペース・権限・保存方針（Secrets移行など）を管理する
4. **Chat（操作入口）**: チャット画面から、Figma / GitHub / AI を横断して作業を進める

Phase5 の目標UI構成:
- 左: 横断ナビ
- 中央: AI作業面
- 右: 接続済みリソース / roadmap / recent files
Phase5 の OpenAI は補助AIに限定し、役割は `要約` `分析` `提案` `翻訳` `FAQ回答` のみとする。GitHub / Figma への無確認実行や組織管理判断は対象外とする。
Phase5 の完了条件は `docs/ai/core/workflow.md` の `NEXT5-01` を正とし、SoT、OpenAI接続、要約 / 分析 / 翻訳 / FAQ、監査、秘匿境界、metrics、selftest、runbook を含む運用可能状態までを対象にする。
Phase6 の管理画面 IA は `docs/admin/admin-ia.md` を正とし、`Admin Console / Ops Console / AI Admin / Knowledge Admin` に責務分割する。一般 Workspace と同じ見え方にはせず、管理責務を別導線で扱う。
Phase6 の組織運用モデルは `docs/admin/org-model.md` を正とし、`organization / member / invite / role / permission` と `account / project / organization` の境界を固定する。
Phase6 の完了条件は `docs/ai/core/workflow.md` の `NEXT6-01` を正とし、組織運用、RBAC、接続管理、AI管理、知識源管理、多言語設定、監査、B分類回収、selftest、runbook を含む統制運用成立までを対象にする。
Phase7 は SoT 上 `作成・変更実行レイヤー` として固定し、対象を `write-plan` `execution plan` `confirm付き変更実行補助` `Figma / GitHub / AI / Run の変更連携` の 4 領域に限定する。Hubは成果物SoTではない。Hub は orchestration layer として `thread / run / plan / audit` を保持し、成果物は GitHub / Figma / Drive 側に残す。
Phase7 の主要成果物は `execution plan` `confirm flow` `execution job` `audit` `ops console` `selftest` `runbook` とする。`confirmなし自動実行` `完全自律エージェント` `複数AI routing の高度化` `Phase5 Workspaceへの管理責務逆流` `Phase6 Adminへの自律実行混入` は対象外とし、Phase7 の UI / API / orchestration / 運用判断へ混入させない。
Phase7 の完了条件は `docs/ai/core/workflow.md` の `NEXT7-01` を正とし、`execution plan` `confirm flow` `execution job` `Run integration` `audit` `selftest` `runbook` `ops console` を含む confirm付き実行運用成立までを対象にする。

## Not Included（このテンプレが提供しないもの）

- Integration Hub 本体（RBAC/Audit/UI/APIなどのサービス実装）
- 各プロジェクト固有のプロダクト実装コード

---

## 次のステップ（運用開始）

1. このテンプレから新規リポジトリを作成（GitHub Template機能）
2. 必要なら Branch protection で status check を required に設定
3. 以後は Issue → PR → Gate の正規ルート以外を使わない

---

## Docs（一次情報）

- 正規ルートと運用ルール: `docs/ai/core/workflow.md`
- OpenAI Assist Model SoT: `docs/ai/core/openai-assist-model.md`
- FAQ Knowledge Source Model SoT: `docs/ai/core/faq-model.md`
- 多言語方針 / 用語集 SoT: `docs/i18n/glossary.md`
- AI Evidence Model SoT: `docs/ai/core/ai-evidence-model.md`
- Workspace IA Phase5 SoT: `docs/ai/core/workspace-ia-phase5.md`
- Workspace 検索対象モデル SoT: `docs/ai/core/search-model.md`
- Workspace 履歴モデル SoT: `docs/ai/core/history-model.md`
- Workspace 観測指標モデル SoT: `docs/ai/core/observability-model.md`
- Workspace 運用操作モデル SoT: `docs/ai/core/operability-model.md`
- Workspace Phase3 VPS確認メモ: `docs/operations/workspace-phase3-operations.md`
- Decisionの残し方: `docs/ai/core/decision-policy.md`
- Connectors/Connections APIスキーマSoT: `docs/connectors-connections-schema.md`
- Secret参照方針（GitHub/Figma）: `docs/connection-secret-reference-policy.md`
- GitHub対象選択ルール（branch/path優先順位）: `docs/github-target-selection-rule.md`
- Figma読取コンテキスト契約（FG-R-01/02）: `docs/figma-read-context-contract.md`
- Figma対象選択ルール（page/frame/node, writable scope）: `docs/figma-target-selection-rule.md`
- Figma再現度評価軸（FG-VAL-01）: `docs/figma-validation-scoring.md`
- 外部操作の監査/可観測性最小要件（OPSX-02）: `docs/external-audit-observability-minimum.md`
- VPS反映チェックリスト（外部操作フェーズ, OPSX-01）: `docs/runbooks/vps-external-operations-checklist.md`
- VPS反映チェックリスト（Workspace Phase3: search/history/metrics/retry/export, P3-OPSX-01）: `docs/runbooks/vps-workspace-phase3-checklist.md`
- Fidelity Hardening 運用手順（localhost/staging/production 比較, P4-OPSX-01）: `docs/runbooks/fidelity-hardening-operations.md`
- Phase5 OpenAI運用 runbook（summary/analysis/translate/faq/metrics/audit, P5-TEST-01）: `docs/runbooks/phase5-openai-assist-operations.md`
- Phase6 Admin運用 runbook（RBAC/connection lifecycle/AI admin/knowledge admin/i18n/audit, P6-OPSX-01）: `docs/runbooks/phase6-admin-ops.md`
- Phase7 Execution運用 runbook（confirm pending/approve/reject/failure/rollback, P7-OPSX-01）: `docs/runbooks/phase7-execution-ops.md`
- Phase5 完了条件 SoT（P5-REL-01）: `docs/ai/core/workflow.md`
- Phase6 完了条件 SoT（P6-REL-01）: `docs/ai/core/workflow.md`
- Phase7 実行レイヤー backlog / SoT（P7-ARCH-00）: `backlog/phase7-execution-layer.md`
- Phase6 管理画面 IA SoT（P6-ADMIN-01）: `docs/admin/admin-ia.md`
- Phase6 組織・ユーザーモデル SoT（P6-ORG-01）: `docs/admin/org-model.md`
- Phase4 完了条件 SoT（P4-REL-01）: `docs/ai/core/workflow.md`

---

## Current Status（いま出来ていること）

- PR Gate（Actions）: PR本文の必須要素チェック（Issue参照 / Figma / ACチェック）
- Issue Form: Figma URL / AI thread URL(s) / Acceptance Criteria の入力
- Phase1 Integration Hub Stub（検証器としての `/jobs`）
- Connections 設定UI（暫定）

## ARCH-00 現フェーズ境界（SoT）

現フェーズの対象:
- 個人設定は既定AIを1件のみ使う
- プロジェクト設定で GitHub / Figma / Drive を共有する
- Thread は「個人AI設定 + プロジェクト共有環境 + 会話履歴」を合成して Run を起動する

次フェーズ2（外部操作フェーズ）の対象:
- GitHub / Figma の読取
- GitHub / Figma への制御付き書込（条件・承認付き）
- Run への参照 / 操作記録
- Workspace からの承認付き実行
- Figma再現度検証（validation段階で実施）

次フェーズ2の固定順序（SoT）:
1. `read`
2. `validation`（Figma再現度検証を含む）
3. `controlled write`
4. `run/workspace integration`

次フェーズ2の対象外:
- 完全自動同期
- 複数AI役割設定（role/profile/persona など）

次フェーズ3（NEXT3-00: 実運用強化）の入口:
- 対象は Workspace の検索・履歴・可観測性・運用性改善
- フェーズ2完了条件には含めず、着手順のみを固定
- 着手順: `search` → `history` → `observability` → `operability`
- `history` は message 一覧ではなく、`run created/status changed`、`read plan`、`write plan`、`confirm executed`、`external operation recorded`、`audit projected` を統合表示する
- `external_operations` は actual result の正本として維持し、`history` は Run / audit / confirm を横断する表示モデルとして追加する
- `observability` の主要指標は `run counts`、`queued/running/ok/failed/skipped`、`confirm rate`、`provider 別 operation counts`、`failure_code distribution`、`figma fidelity distribution`、`duration median/p95` を最低要件とする
- ただし Phase3 observability の主軸は Workspace 運用指標であり、fidelity の詳細分析や reason taxonomy は Phase4 の責務とする
- 対象外:
  - 複数AI接続・役割設定
  - Figma / GitHub 高度操作の追加拡張
  - 完全自動同期

Phase3 完了条件（NEXT3-01）:
- `search`
- `history`
- `observability`
- `operability`
- `selftest`
- `VPS確認`
- 上記 6 条件をすべて満たした場合のみ完了扱いにする
- `複数AI接続・役割設定` や `新たな Figma/GitHub 拡張` は完了条件に含めない

次フェーズ4（NEXT4-00: Fidelity Hardening）の入口:
- フェーズ3完了後にのみ着手する
- 目的は Figma・コード・本番環境の三者一致率の強化に限定する
- 対象は再現度向上・差分縮小・検証精度向上
- 対象外は次の3点:
  - 複数AI役割設計の再拡張（role/profile/persona routing の再設計）
  - Fidelity Hardening と無関係な新機能追加
  - 大規模UX刷新（全面的な情報設計・画面構成の作り直し）

次フェーズ5（NEXT5-00: OpenAI運用補助AI / 多言語説明 / FAQ / Workspace IA）の入口:
- フェーズ4完了後にのみ着手する
- 単一運用者前提で、対象は `OpenAI運用補助AI`、`多言語説明`、`FAQボット`、`Workspace IA再編` のみ
- `/ui/` 配下の新UIを正本とし、旧ページ直配信を設計基準に戻さない
- OpenAI の役割は `要約` `分析` `提案` `翻訳` `FAQ回答` に限定し、Hub の最終 SoT を自律的に書き換える主体として扱わない
- FAQ ボットの知識源は `docs/ai/core/faq-model.md` を正とし、参照元は SoT / workflow / manual / runbook / SRS などの正本に限定する
- FAQ は `一般FAQ` と `運用者FAQ` に分け、一般FAQは文書/節単位、運用者FAQは手順/チェックリスト項目単位で根拠を返す
- FAQ の根拠参照は翻訳表示でも壊れない `source_type / title / path / section / ref_kind / audience` 単位で固定し、`evidence_refs.manual / runbook / doc_source` に落とし込む
- 多言語方針は `docs/i18n/glossary.md` を正とし、既定応答言語は日本語、プロダクト内言語切替は許可、`status` `failure_code` `action_type` `reason_type` `confirm_required` `project` `thread` `run` `evidence_refs` などの構造語は固定管理語として変訳しない
- Workspace IA再編は `1枚目=現状UI`、`2枚目=目標UI` として扱い、目標UIでは `左=横断ナビ` `中央=AI作業面` `右=接続済みリソース / roadmap / recent files` に再編する
- 対象外:
  - 社内管理画面
  - 組織ユーザー管理
  - RBAC強化
  - 複数AI routing
  - confirmなし自動実行
  - 完全自律エージェント
- 加えて、GitHub / Figma への無確認実行や組織管理判断は OpenAI の対象外とする
- これらの対象外は Phase6 以降へ分離し、Phase5 に混入させない

次フェーズ6（NEXT6-00: Admin / Org Ops）の入口:
- Phase6 は社内活用向けの `管理画面 / 組織運用レイヤー` 専用フェーズとする
- 対象は `社内管理画面` `組織ユーザー管理` `RBAC` `接続ライフサイクル管理` `AI利用管理` `FAQ知識源管理` `多言語設定管理` `監査ビュー`
- Phase5 の単一運用者向け Workspace とは責務分離し、管理責務を Phase5 側へ混入させない
- `複数AI routing の高度化` と `完全自律エージェント` は Phase6 の対象外とし、さらに後続へ分離する

次フェーズ7（NEXT7-00: Execution Layer）の入口:
- Phase7 は SoT 上 `作成・変更実行レイヤー` として固定する
- 対象は `write-plan` `execution plan` `confirm付き変更実行補助` `Figma / GitHub / AI / Run の変更連携` の 4 領域に限定する
- Hubは成果物SoTではない。Hub は orchestration layer として `thread / run / plan / audit` を保持し、成果物は GitHub / Figma / Drive 側に残す
- 主要成果物は `execution plan` `confirm flow` `execution job` `audit` `ops console` `selftest` `runbook`
- 対象外:
  - confirmなし自動実行
  - 完全自律エージェント
  - 複数AI routing の高度化
  - Phase5 Workspaceへの管理責務逆流
  - Phase6 Adminへの自律実行混入
- 上記の対象外は Phase7 の UI / API / orchestration / 運用判断へ混入させない

次フェーズ1（NEXT1-00: 複数AI/役割設定）は後順位:
- 複数AI接続・role/profile/persona routing 高度化は後続トラックで扱う
- フェーズ2/3では責務分離を維持し、既定AI 1件前提を崩さない

## API Notes（P2-01 最小）

- `GET /api/connectors`: `id/key/name`, `enabled/connected`, `last_checked_at`, `notes` を返します。
- `GET /api/connections`: `items[]` に同一shape（`id/key/name/enabled/connected/last_checked_at/notes`）を返します。
- Secrets値は返しません。`notes` には presence/LEN のみを含めます。

---

## Quickstart（ローカル起動）

```bash
volta run npm test
./bin/dev
# open:
# http://127.0.0.1:3000/jobs
```

Node は Volta で固定します（`package.json` の `volta.node=22.22.0`）。
`better-sqlite3` の ABI 不一致を避けるため、テストは `volta run npm test` を使用してください。

## Hub Jobs 最短ループ（手動確認フロー）

（任意）Diagnostics: `/jobs` で Diagnostics ジョブを生成・保存し、実行

```bash
# 1) Offline smoke
node scripts/run-job.js --job job.offline_smoke.json --role operator

# 2) Spawn smoke
node scripts/run-job.js --job job.spawn_smoke.json --role operator

# 3) OpenAI exec smoke
# OPENAI_API_KEY を設定してから実行
node scripts/run-job.js --job job.openai_exec_smoke.json --role operator

# 4) Docs update
node scripts/run-job.js --job job.docs_update.json --role operator

# 5) Repo patch（noop）
node scripts/run-job.js --job job.repo_patch.json --role operator

# 最新 run_id
RID="$(ls -1 .ai-runs | tail -n 1)"
```

stderr に既知の警告が含まれる場合があるため、`.ai-runs/<run_id>/` 配下の成果物で原文を確認してから判断してください。

PR test line: one-line README update to verify PR creation flow.
