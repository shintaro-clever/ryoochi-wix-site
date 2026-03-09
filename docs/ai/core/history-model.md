# Phase3 Workspace History Model (SoT)

## Purpose
- Phase3 の `history` を単なる chat message の時系列ではなく、Workspace 上の実行・計画・承認・外部操作・監査投影を横断する運用履歴として定義する。
- `external_operations` と二重の正本を作らず、既存 Run / audit / external operation 記録を統合表示する前提を固定する。

## History Scope (Fixed)
- `history` は次の 4 系統を統合表示する。
  - `run`
  - `chat`
  - `operation`
  - `confirm`
- `history` は UI/API 上の表示モデルであり、外部操作の実行結果の正本は引き続き `run.external_operations` と `external_audit` に置く。

## Minimum Event Types (Required)
- `run.created`
- `run.status_changed`
- `read.plan_recorded`
- `write.plan_recorded`
- `confirm.executed`
- `external_operation.recorded`
- `audit.projected`

## Event Definitions

### 1. `run.created`
- 意味: Thread / Workspace 操作により Run が新規生成された。
- primary source:
  - `run.run_id`
  - `run.project_id`
  - `run.thread_id`
  - `run.job_type`
  - `run.run_mode`
  - `run.created_at`

### 2. `run.status_changed`
- 意味: Run の状態が遷移した。
- primary source:
  - `run.status`
  - `run.failure_code`
  - `run.updated_at`
- 最低限、`queued -> running -> succeeded/failed/cancelled` の差分が追えること。

### 3. `read.plan_recorded`
- 意味: 外部 read を行う前に、対象と意図が plan として記録された。
- primary source:
  - `external_audit.read.targets.github`
  - `external_audit.read.targets.figma`
  - `external_audit.read.plan_status`
  - `external_read_plan.read_targets`
- read 実行前の対象確認イベントとして扱い、actual read result とは分ける。

### 4. `write.plan_recorded`
- 意味: controlled write 前に write plan が記録された。
- primary source:
  - `external_audit.write_plan[]`
  - `planned_action`
  - `confirm_required`
- minimum fields:
  - `provider`
  - `operation_type`
  - `target`
  - `status`

### 5. `confirm.executed`
- 意味: human-in-the-loop の confirm が実際に実行され、write 実行条件が満たされた。
- primary source:
  - `planned_actions`
  - `confirm_required`
  - `confirmed_at`
  - `confirmed_by`
- confirm 未実行の plan は history 上で pending として区別できること。

### 6. `external_operation.recorded`
- 意味: 外部 read/write の actual result が記録された。
- primary source:
  - `external_operations[]`
  - `external_audit.write_actual[]`
- minimum fields:
  - `provider`
  - `operation_type`
  - `target`
  - `result.status`
  - `result.failure_code`
  - `recorded_at`
- `history` はこのイベントを投影するが、actual result の正本は `external_operations` に置く。

### 7. `audit.projected`
- 意味: Run / external operation / confirm の結果が監査・可観測性ビュー向けに投影された。
- primary source:
  - `external_audit.scope.*`
  - `external_audit.actor.*`
  - `external_audit.figma_fidelity.*`
- audit 系は履歴イベントとして見せてよいが、監査の SoT は `external_audit` を正とする。

## Event Envelope (Minimum Shape)
- `event_id`
- `event_type`
- `category`
  - `run` | `chat` | `operation` | `confirm`
- `project_id`
- `thread_id`
- `run_id`
- `occurred_at`
- `source_ref`
  - 例: `run.status`, `external_operations[3]`, `external_audit.write_plan[0]`
- `summary`
- `detail`
  - secret-like 値を含めない要約のみ

## Normalization Rules
1. 同一 Run 内の複数ソースを時系列で並べるが、正本は移さない。
2. `external_operations` と `external_audit` は削除・再定義せず、history は参照投影として構成する。
3. `chat` message は履歴の一部に含めてよいが、history 全体を message history に還元しない。
4. `confirm.executed` がない write actual は異常系として区別表示できること。
5. secret / token / confirm token / confirm token hash / credential raw value は history detail に出さない。
6. `failure_code` / `reason` に secret-like 値が混入する場合は `[redacted]` へ正規化してから履歴表示・export する。

## Relationship To Phase2 External Operations
- Phase2 の `external_operations` は actual execution record の SoT として維持する。
- Phase3 の `history` は `external_operations` を含む複数記録源を横断表示する timeline / feed モデルである。
- したがって `history` 追加は Phase2 の external read / validation / controlled write / run integration の固定順序を変更しない。
- `external_operation.recorded` は Phase2 で保存された actual result を Phase3 UI で再利用するだけであり、新たな write 実行権限や自動同期を導入しない。

## Out of Scope
- secret を含む生メッセージ全文の履歴化
- `history` 自体を新たな監査正本として扱うこと
- Phase2 対象外だった完全自動同期や複数AI routing の導入

## References
- Phase boundary SoT: `docs/ai/core/workflow.md`
- Search model SoT: `docs/ai/core/search-model.md`
- External audit minimum: `docs/external-audit-observability-minimum.md`
- VPS external operations checklist: `docs/runbooks/vps-external-operations-checklist.md`
