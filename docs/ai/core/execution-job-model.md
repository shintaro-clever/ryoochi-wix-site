# Execution Job Model (Phase7 SoT)

この文書は Phase7 の execution job model を定義する一次情報です。  
execution job は write-plan や execution plan そのものではなく、**承認済み変更計画を実行系へ落とした共通ジョブ shape** として扱います。

## Positioning

- write-plan は変更計画の下書きであり、実行ジョブではない。
- execution plan は confirm と audit の対象になる変更計画であり、まだ job ではない。
- execution job は approved plan を queue / run / result 管理する実行単位である。
- execution job は成果物 SoT ではない。Hub は orchestration record を保持し、成果物の正本は GitHub / Figma / Drive 側に残す。

## Canonical Schema

execution job は最低限次を保持できる shape に固定する。

- `execution_job_id`
- `tenant_id`
- `project_id`
- `created_by`
- `status`
- `job_type`
- `target_scope`
- `inputs`
- `safety_level`
- `confirm_state`
- `plan_ref`
- `run_ref`
- `audit_draft`
- `created_at`
- `updated_at`

## Field Semantics

### Identity / Lifecycle

- `execution_job_id`: execution job の識別子
- `tenant_id`: tenant 境界
- `project_id`: project 境界
- `created_by`: job 化を行った actor
- `status`: `queued | running | succeeded | failed | cancelled`

### Job Classification

- `job_type`: plan をどの実行クラスへ落としたかを示す
  - 例: `docs_update_job`
  - 例: `connector_change_job`
  - 例: `planned_change_execution`
- `safety_level`: 実行時の安全性レベル
  - `guarded`
  - `elevated`
  - `critical`

### Target / Inputs

- `target_scope`: 実行対象のまとまり
  - `target_kind`
  - `impact_scope`
  - `target_refs`

Figma job では `target_refs` に `page / frame / component / node` を残し、どの design target へ作用する job かを明示する。

GitHub job では `target_refs` に `repo / branch / file` を残し、どの repository target へ作用する job かを明示する。
- `inputs`: 実行時に必要な plan 派生入力
  - `summary`
  - `expected_changes`
  - `rollback_plan`
  - `evidence_refs`

### Confirm / Traceability

- `confirm_state`: job 作成時点の confirm state。未承認 plan からは job を作らない
- `plan_ref`: execution plan 参照
  - `plan_id`
  - `current_plan_version`
  - `confirm_state`
  - `source_type`
  - `source_ref`
- `run_ref`: run / thread / project 参照
  - `run_id`
  - `thread_id`
  - `project_id`

### Audit Draft

- `audit_draft`: job 化時点での監査イベント下書き
- audit draft は committed event ではない
- 実行結果が確定するまでは draft のまま保持する
- `job.created` は draft を残し、terminal state 到達時に committed へ進める
- `job.started` と `job.finished` は committed event として即時記録する

## Audit Events

- `plan.created`
- `plan.approved`
- `plan.rejected`
- `job.created`
- `job.started`
- `job.finished`

## Conversion Rule

execution job は approved execution plan からのみ生成する。

- `job_type`: `plan_type` から導出する
- `target_scope`: `target_kind + impact_scope + target_refs` を継承する
- `inputs`: `summary + expected_changes + rollback_plan + evidence_refs` を継承する
- `safety_level`: `risk_level` から導出する
- `confirm_state`: plan の `confirm_state` を継承する
- `plan_ref`: `plan_id + plan_version + source` を束縛する
- `run_ref`: `run_id + thread_id + project_id` を束縛する

## DB Shape vs API Shape

- DB shape は `*_json` 列へ保存してよい
  - `target_scope_json`
  - `inputs_json`
  - `plan_ref_json`
  - `run_ref_json`
  - `audit_draft_json`
- API shape は展開済み object を返す
- DB 列名と API shape を混同しない
