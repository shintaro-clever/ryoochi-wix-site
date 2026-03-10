# Admin IA (Phase6 SoT)

この文書は Phase6 の社内活用向け管理画面 IA を定義する一次情報です。  
Phase5 の単一運用者向け Workspace と混線させず、管理責務を `Admin Console / Ops Console / AI Admin / Knowledge Admin` に分離します。

## Principle

- Phase6 の管理画面は、一般利用者や単一運用者が日常作業を行う Workspace と同じ見え方にしない。
- Phase5 は `作業面`、Phase6 は `統制面` として責務分離する。
- 管理画面では、組織設定、権限、接続統制、AI 利用統制、知識源管理、監査閲覧を扱う。
- Phase5 の `Run / Workspace / Help / Help Admin` は作業導線として維持し、Phase6 の管理 UI に吸収しない。

## IA Layers

### 1. Admin Console

役割:
- 組織管理の入口
- 組織ユーザー管理
- RBAC
- 管理対象全体の方針確認

主要画面:
- Organization Overview
- Users
- Roles / Permissions
- Workspace Access Policy
- Admin Settings

扱う判断:
- 誰が何を見られるか
- 組織単位の権限モデル
- 管理者向け設定の公開範囲

### 2. Ops Console

役割:
- 接続ライフサイクル管理
- 運用状態監視
- 監査ビュー
- 障害時の組織運用面確認

主要画面:
- Connections Lifecycle
- Environment / Provider Status
- AI Usage Overview
- Audit Explorer
- Incident / Escalation Queue

扱う判断:
- 接続の有効 / 無効 / 更新 / 失効
- 運用上の異常傾向確認
- 監査ログの検索と追跡

### 3. AI Admin

役割:
- AI 利用管理
- モデル / provider 利用ポリシー
- レート制限 / 利用上限 / use_case 管理
- 多言語設定管理

主要画面:
- AI Policy
- Model / Provider Catalog
- Usage Limits
- Language Policy
- Guardrail Policy

扱う判断:
- どの AI 機能を組織で許可するか
- どの言語を許可 / 既定化するか
- guardrail の適用範囲

### 4. Knowledge Admin

役割:
- FAQ 知識源管理
- SoT / manual / runbook / SRS の参照統制
- FAQ 回答元の棚卸しと更新

主要画面:
- Knowledge Source Registry
- Runbook Registry
- FAQ Coverage
- Translation Glossary Management
- Knowledge Change Review

扱う判断:
- FAQ が参照できる正本の範囲
- どの runbook / manual を FAQ に公開するか
- glossary / knowledge source の更新統制

## Left Navigation (Phase6)

Phase6 の左ナビは管理責務ごとに固定し、Workspace 左ナビとは別系統にする。

1. Admin Console
- Organization Overview
- Users
- Roles / Permissions
- Admin Settings

2. Ops Console
- Connections Lifecycle
- AI Usage Overview
- Audit Explorer
- Incident / Escalation Queue

3. AI Admin
- AI Policy
- Model / Provider Catalog
- Usage Limits
- Language Policy
- Guardrail Policy

4. Knowledge Admin
- Knowledge Source Registry
- Runbook Registry
- FAQ Coverage
- Glossary Management

## Cross-Screen Flow

### Admin Console -> Ops Console
- 組織や権限の変更後に、Ops Console で接続状態や監査影響を確認する。

### Ops Console -> AI Admin
- AI 利用異常や rate limit 増加を見た場合、AI Admin で use_case / limit / policy を見直す。

### AI Admin -> Knowledge Admin
- FAQ / translation / guardrail の品質問題を見た場合、Knowledge Admin で知識源や glossary を確認する。

### Knowledge Admin -> Ops Console
- 知識源更新後に、FAQ 利用状況や監査を Ops Console で追う。

## Separation From Workspace

- Workspace は `project / thread / run / summary / analysis / faq` を使う作業面であり、管理設定画面を主導線に置かない。
- Admin Console / Ops Console / AI Admin / Knowledge Admin は、組織全体を俯瞰する管理面であり、個別 run の日常作業を主目的にしない。
- Phase5 の `AI作業面` と Phase6 の `管理面` は URL、左ナビ、用語、責務を分離する。

## Page Naming Direction

- Phase6 管理画面の page 名は `/ui/admin-*.html` を基本とする。
- 例:
  - `/ui/admin-console.html`
  - `/ui/admin-users.html`
  - `/ui/ops-console.html`
  - `/ui/ai-admin.html`
  - `/ui/knowledge-admin.html`

## Out Of Scope

- 一般 Workspace の会話 / run 操作を Phase6 管理画面へ吸収すること
- 複数AI routing の高度化
- confirm なし自動実行
- 完全自律エージェント

## References

- Phase Boundary SoT: `docs/ai/core/workflow.md`
- Phase5 Workspace IA SoT: `docs/ai/core/workspace-ia-phase5.md`
- UI Pages SoT: `docs/ui/pages.md`
