# Phase3 Workspace Search Model (SoT)

## Purpose
- Phase3 の `search` で何を検索対象にするかを先に固定し、API / UI / audit の前提を揃える。
- 検索対象外の秘匿値を明示し、運用で secret を検索面へ流出させない。

## Search Targets (Fixed)
- `project`
- `thread`
- `run`
- `message`
- `external_operation`
- `external_audit`

## Searchable Fields

### project
- `id`
- `name`
- `staging_url`
- `production_url`
- `created_at`
- `updated_at`

### thread
- `thread_id`
- `project_id`
- `title`
- `created_at`
- `updated_at`

### run
- `run_id`
- `project_id`
- `thread_id`
- `status`
- `job_type`
- `run_mode`
- `failure_code`
- `target_path`
- `created_at`
- `updated_at`

### message
- `message_id`
- `thread_id`
- `role`
- `content`
  - searchable 対象は secret-like 値を除去した summary か公開可能本文に限る
- `created_at`

### external_operation
- `provider`
- `operation_type`
- `target.repository`
- `target.branch`
- `target.path`
- `target.file_key`
- `result.status`
- `result.failure_code`
- `result.reason`
- `recorded_at`

### external_audit
- `actor.requested_by`
- `actor.ai_setting_id`
- `actor.thread_id`
- `scope.project_id`
- `scope.run_id`
- `scope.status`
- `read.plan_status`
- `read.targets.github`
- `read.targets.figma`
- `write_plan.provider`
- `write_plan.operation_type`
- `write_actual.result.status`
- `write_actual.result.failure_code`
- `figma_fidelity.status`

## Non-Searchable Fields

### Global exclusions
- secret-like 値
- `confirm_token`
- `confirm_token_hash`
- `secret_id` の生解決値
- raw credential / token / password / api_key
- hidden/private body

### project
- `.env`
- `auth.json`
- secret の実値

### thread / message
- secret-like raw body
- hidden/private 本文
- confirm にのみ使う token

### run
- secret payload
- secret 解決後の本文
- confirm token

### external_operation / external_audit
- `confirm_token`
- secret ref の解決結果
- credentials 本文
- 秘匿対象の生テキスト

## Search Safety Rules
1. 検索インデックスへ入れてよいのは公開可能な識別子・状態・要約のみ。
2. `secret_id` は参照文字列のままでも原則検索対象にしない。
3. `confirm_token` と `confirm_token_hash` は保存有無に関わらず検索対象外。
4. secret-like 値を含む `failure_code` / `reason` は検索前に `[redacted]` へ正規化する。
5. 秘匿本文を含む `message.content` は全文検索対象にしない。

## API Preparation Contract
- 最小 API shape として `GET /api/search/model` はこの SoT と同等の entity / field 定義を返してよい。
- 本格的な検索 API は Phase3 `search` 実装で追加する。
- 本文検索を導入する場合も、上記の検索対象外 fields を超えてはならない。

## References
- Phase boundary SoT: `docs/ai/core/workflow.md`
- External audit minimum: `docs/external-audit-observability-minimum.md`
