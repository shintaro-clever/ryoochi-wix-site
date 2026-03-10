# Organization / User Model (Phase6 SoT)

この文書は Phase6 の組織運用モデルを定義する一次情報です。  
Phase5 の単一運用者前提から Phase6 の組織運用へ上げるため、`organization / member / invite / role / permission` の責務と関係、および `account / project / organization` の境界を固定します。

## Principle

- `account` は個人の主体を表す。
- `organization` は管理と統制の主体を表す。
- `project` は作業対象を表し、組織配下で管理される。
- Phase5 の個人運用では `tenant=internal` を暫定境界として使っているが、Phase6 では組織モデルを明示して責務を分離する。

## Core Entities

### account

責務:
- 個人ユーザーの本人性を表す最小単位
- ログイン主体
- 個人表示設定や個人 AI 設定の所有者

持つもの:
- identity
- profile
- personal preferences
- personal AI settings

持たないもの:
- 組織全体の権限決定
- 組織全体の接続統制
- FAQ 知識源統制

### organization

責務:
- 組織運用と管理責務の境界
- 組織単位の権限、接続、監査、AI 利用、知識源ポリシーの所有者
- 管理画面の最上位スコープ

持つもの:
- organization profile
- member 集合
- role / permission policy
- project 集合
- connection lifecycle policy
- audit visibility policy

### project

責務:
- 実際の作業対象
- thread / run / workspace / artifact の所属単位
- 組織配下で運用される作業面

持つもの:
- project metadata
- shared environment
- threads / runs / artifacts

持たないもの:
- 組織全体の権限 policy
- 組織全体の AI 利用上限
- 組織全体の knowledge source policy

## Relationship Model

### organization -> member

- `organization` は複数の `member` を持つ。
- `member` は `account` と `organization` の所属関係を表す。
- 1つの account は複数 organization に所属できる。

### member -> role

- `member` は 1つ以上の `role` を持てる。
- role は管理責務のまとまりを表す。
- 実効権限は member に付与された role の合成で決まる。

### role -> permission

- `role` は permission の bundle として定義する。
- permission は最小の許可単位とし、画面表示、操作可否、管理対象範囲を決める。

### organization -> invite

- `invite` は organization への未所属 account 追加フローを表す。
- invite は member 作成前の一時状態であり、承認・受諾・期限切れの状態を持つ。

## Entity Definitions

### member

責務:
- account の organization 所属を表す
- 組織内の表示名、状態、role 割当状態を保持する

最低属性:
- `organization_id`
- `account_id`
- `status`
  - `active`
  - `invited`
  - `suspended`
  - `removed`
- `assigned_roles`

### invite

責務:
- organization への参加招待
- 未参加状態のトラッキング
- invite 受諾前の role 付与候補保持

最低属性:
- `organization_id`
- `email` または `account_id`
- `invited_by`
- `proposed_roles`
- `status`
  - `pending`
  - `accepted`
  - `expired`
  - `revoked`

### role

責務:
- 管理責務のまとまり
- member に対する permission bundle

最低分類:
- `org_owner`
- `org_admin`
- `ops_admin`
- `ai_admin`
- `knowledge_admin`
- `project_operator`
- `auditor`

### permission

責務:
- 最小の許可単位
- 画面表示、設定変更、接続操作、監査閲覧、知識源管理の可否を決める

代表カテゴリ:
- `organization.manage`
- `member.manage`
- `invite.manage`
- `role.assign`
- `project.view_all`
- `project.manage`
- `connection.manage`
- `ai_usage.manage`
- `language_policy.manage`
- `knowledge_source.manage`
- `audit.view`
- `audit.export`

## Boundary: account / project / organization

### account boundary

- 個人設定と本人性の境界
- 個人 AI 設定、表示設定、個人プロフィールを持つ
- account 単体では組織管理権限を持たない

### project boundary

- 実務上の作業単位
- thread / run / workspace の境界
- project は organization の配下にぶら下がる
- project operator は project を操作できるが、organization policy 自体は変更しない

### organization boundary

- 管理と統制の境界
- 複数 project を束ねる
- role / permission / connection lifecycle / AI policy / knowledge policy / audit visibility を持つ

## Phase Transition Note

- 現在の SQLite schema では多くのテーブルが `tenant_id='internal'` を前提にしている。
- Phase6 では `organization` を明示モデルとして導入し、`tenant` 相当の境界を organization へ寄せる。
- ただし Phase5 の単一運用者向け Workspace を壊さないため、移行は管理面から先に行い、Run / Workspace 側へ直接混入させない。

## Admin Responsibility Mapping

- Admin Console
  - organization
  - member
  - invite
  - role
  - permission
- Ops Console
  - project 横断の接続 / 監査 / 運用状態
- AI Admin
  - AI 利用 policy
  - language policy
- Knowledge Admin
  - FAQ knowledge source
  - glossary

## Out Of Scope

- 複数AI routing の高度化
- confirm なし自動実行
- 完全自律エージェント

## References

- Phase Boundary SoT: `docs/ai/core/workflow.md`
- Admin IA SoT: `docs/admin/admin-ia.md`
- Current data baseline: `src/db/schema.sql`
- Legacy data model notes: `docs/schema.md`
