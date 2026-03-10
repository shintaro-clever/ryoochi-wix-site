# Phase6 Admin / Org Ops Runbook

## Purpose
- Phase6 の `社内管理画面 / 組織運用 / RBAC / 接続ライフサイクル / AI利用管理 / FAQ知識源管理 / 多言語設定管理 / 監査ビュー` を一体運用する。
- 権限事故、誤招待、接続停止、AI管理、監査確認、知識源管理、多言語設定管理を別々に扱わず、Admin Console / Ops Console / AI Admin / Knowledge Admin の導線に沿って運用する。
- `connections registry` と `project audit bridge` を read-only の参照面として位置づけ、実操作画面と混線させない。

## Scope
- 対象 UI:
  - `/ui/admin-console.html`
  - `/ui/ops-console.html`
  - `/ui/ai-admin.html`
  - `/ui/knowledge-admin.html`
  - `/ui/project-members.html`
  - `/ui/project-invites.html`
  - `/ui/settings-connections.html`
  - `/ui/project-connections.html`
  - `/ui/connection.html`
  - `/ui/connections.html`
  - `/ui/project-audit.html`
- 対象 API:
  - `members / invites / roles`
  - `connection lifecycle`
  - `admin ai overview`
  - `knowledge sources`
  - `organization i18n policy`
  - `admin audit overview`
- 対象外:
  - Phase5 Workspace の個人作業
  - 複数AI routing の高度化
  - confirm なし自動実行
  - 完全自律エージェント

## Preconditions
1. `/ui/` を UI 正本として扱う。
2. Phase6 の境界は `docs/ai/core/workflow.md`、IA は `docs/admin/admin-ia.md`、組織モデルは `docs/admin/org-model.md` を正とする。
3. 組織運用の変更は audit を前提にし、権限変更・招待・接続変更・language policy 変更・knowledge source policy 変更は監査に残る前提で実施する。
4. `connections registry` と `project audit bridge` は read-only 参照であり、変更操作の入口にしない。

## Admin UI Map

### 1. Admin Console
- 用途:
  - organization / member / role / invite の状況確認
  - 次にどの管理画面へ進むかを決める入口
- 主な導線:
  - members 実操作: `/ui/project-members.html`
  - invites 実操作: `/ui/project-invites.html`
  - audit / lifecycle: `/ui/ops-console.html`

### 2. Ops Console
- 用途:
  - `org.* / connection.lifecycle.* / ai.* / faq.*` を横断監査する
  - 権限事故、接続停止、AI運用異常の相関確認
- 主な導線:
  - members / invites 再確認: `/ui/admin-console.html`
  - AI 利用確認: `/ui/ai-admin.html`
  - 知識源 / glossary 確認: `/ui/knowledge-admin.html`

### 3. AI Admin
- 用途:
  - AI Usage Metrics
  - FAQ 利用状況
  - 主要 AI audit event
  - organization-level language policy

### 4. Knowledge Admin
- 用途:
  - FAQ knowledge source の `enable / disable / priority / audience / public_scope` 管理
  - runbook / glossary / source の正本運用

## Standard Operations

### A. 権限事故対応
例:
- role 誤付与
- member status 誤変更
- auditor 権限が欠落

手順:
1. `/ui/ops-console.html` で `Domain=org` に絞り、`org.member.role_update` `org.member.create` `org.role.upsert` を確認する。
2. `organization_id` と `actor` を特定する。
3. `/ui/admin-console.html` で対象 organization を選び、member / role 状態を確認する。
4. 実修正が必要なら `/ui/project-members.html` で対象 member の `assigned roles / status` を更新する。
5. 修正後、再度 `/ui/ops-console.html` で新しい audit event を確認する。

確認点:
- 変更前後の role 差分
- `actor_id`
- 影響 organization
- 再発防止のため custom role が必要か

### B. 誤招待対応
例:
- 誤った email へ招待
- role の提案内容が過剰
- 期限切れ invite の残存

手順:
1. `/ui/ops-console.html` で `Domain=org` に絞り、`org.invite.create` `org.invite.revoke` を確認する。
2. `/ui/admin-console.html` で invite 状態を確認する。
3. `/ui/project-invites.html` で対象 invite を revoke する。
4. 必要なら正しい `email / proposed_roles` で再招待する。
5. 再発防止のため、標準 role セットと招待テンプレを見直す。

確認点:
- `email`
- `proposed_roles`
- `status=pending/revoked`
- `expires_at`

### C. 接続停止 / 接続異常対応
対象:
- `reauth_required`
- `disabled`
- 誤 policy
- 誤削除

手順:
1. `/ui/connections.html` で対象 scope を特定する。
2. scope 別に正しい画面へ進む。
   - account: `/ui/settings-connections.html`
   - project: `/ui/project-connections.html`
   - organization: `/ui/connection.html`
3. `/ui/ops-console.html` で `Domain=connection` に絞り、`connection.lifecycle.*` を確認する。
4. `reauth / disable / policy / delete` のどれが起点かを特定する。
5. 正常化する。
   - secret 更新: `reauth`
   - 一時停止維持: `disable`
   - 制限誤り: `policy`
   - 削除誤り: 再追加
6. 正常化後、同じ画面と Ops Console の両方で status を再確認する。

### D. AI設定確認
1. `/ui/ai-admin.html` で `AI Usage Metrics` を確認する。
2. `ai_requests / ai_failures / ai_latency / ai_token_usage / summary_requests / analysis_requests / translation_requests` を見る。
3. FAQ 利用状況も同一画面で確認する。
4. 異常がある場合は `/ui/ops-console.html` に移って `ai.* / faq.*` 監査を確認する。

見るべき異常:
- `ai_failures` 急増
- `failure_code` の偏り
- `faq guardrail` 急増
- 特定言語だけ利用が偏る

### E. 監査確認
1. `/ui/ops-console.html` を開く。
2. `Domain` を切り替えて横断確認する。
   - `org`
   - `connection`
   - `ai`
   - `faq`
3. 必要に応じて `Organization / Actor / Limit` で絞り込む。
4. `Recent Events` と `By Group / Actor / Organization / Connection Scope` を確認する。
5. project 起点で見たい場合だけ `/ui/project-audit.html` を使う。

監査で確認する action:
- `org.member.create`
- `org.member.role_update`
- `org.invite.create`
- `org.invite.revoke`
- `org.role.upsert`
- `connection.lifecycle.add`
- `connection.lifecycle.reauth`
- `connection.lifecycle.disable`
- `connection.lifecycle.delete`
- `connection.policy.update`
- `ai.requested`
- `ai.completed`
- `ai.failed`
- `summary.generated`
- `analysis.generated`
- `translation.generated`
- `faq.queried`
- `faq.answered`
- `faq.escalated`
- `faq.guardrail_applied`
- `knowledge.source.policy.update`
- `language.policy.update`

### F. FAQ知識源管理
1. `/ui/knowledge-admin.html` を開く。
2. source ごとの `enabled / priority / audiences / public_scope` を確認する。
3. 誤回答や過剰公開が起きた場合は対象 source を `disable` または `priority` 調整する。
4. audience が `general` と `operator` で適切か確認する。
5. 変更後、FAQ 回答側の evidence に不要 source が出なくなることを確認する。

### G. 多言語設定管理
1. `/ui/ai-admin.html` の `Organization Language Policy` を開く。
2. `default_language / supported_languages / glossary_mode` を確認する。
3. glossary 管理語そのものの編集責務は `/ui/knowledge-admin.html` ではなく、正本 `docs/i18n/glossary.md` にあることを確認する。
4. language policy 変更後、AI Admin の運用状態表示で反映を確認する。
5. 必要なら Ops Console で `language.policy.update` を確認する。

## Read-Only Surfaces

### Connections Registry
- URL: `/ui/connections.html`
- 役割:
  - account / project / organization の接続を横断一覧で見る
  - 実操作は scope 別正式画面へ進む
- 禁止:
  - registry 上で直接変更判断を完結させない

### Project Audit Bridge
- URL: `/ui/project-audit.html`
- 役割:
  - project 起点で `connection / ai / faq` の監査だけを絞って見る
  - 組織横断の最終判断は `/ui/ops-console.html` に戻す
- 禁止:
  - organization 権限事故の判断を project view だけで完結させない

## Incident Routing

### 権限事故
1. Ops Console
2. Admin Console
3. Members / Invites 実操作
4. Ops Console で audit 確認

### 接続停止
1. Connections Registry
2. Scope 別接続管理画面
3. Ops Console で lifecycle 確認

### AI / FAQ 運用異常
1. AI Admin
2. Ops Console
3. Knowledge Admin または Language Policy

## Evidence to Record
- `organization_id`
- `project_id`
- `actor_id`
- `member_id / invite_id / role_id`
- `connection_id / provider_key / scope_type / scope_id`
- `status`
- `failure_code`
- `guardrail_code`
- `default_language / supported_languages / glossary_mode`
- `source_path / audience / public_scope`

## References
- Phase6 Boundary SoT: `docs/ai/core/workflow.md`
- Admin IA SoT: `docs/admin/admin-ia.md`
- Org Model SoT: `docs/admin/org-model.md`
- Multilingual Glossary SoT: `docs/i18n/glossary.md`
- Phase5 OpenAI Operations Runbook: `docs/runbooks/phase5-openai-assist-operations.md`
