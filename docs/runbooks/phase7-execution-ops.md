# Phase7 Execution Ops Runbook

## Purpose
- Phase7 の `write-plan / execution plan / confirm付き変更実行補助 / execution job / audit / ops console` を一体運用する。
- `confirm待ち / 承認 / 却下 / 失敗 / rollback` を別々に扱わず、`write-plan -> execution plan -> confirm -> execution job -> audit` の流れで確認する。
- Hub は orchestration layer であり、成果物 SoT は GitHub / Figma / Drive 側に残る前提で運用する。

## Scope
- 対象 UI:
  - `/ui/write-plans.html`
  - `/ui/execution-plan-confirm.html`
  - `/ui/ops-console.html`
  - `/ui/run.html`
- 対象 API:
  - `write-plans`
  - `execution-plans`
  - `execution-jobs`
  - `admin/execution-overview`
- 対象外:
  - confirmなし自動実行
  - 完全自律エージェント
  - 複数AI routing の高度化
  - Phase5 Workspace への管理責務逆流
  - Phase6 Admin への自律実行混入

## Preconditions
1. Phase7 の境界は `docs/ai/core/workflow.md` と `backlog/phase7-execution-layer.md` を正とする。
2. `execution plan` は確認可能・監査可能な変更計画であり、重要変更は server-enforced confirm を通す。
3. `execution job` は `confirm_state=approved` の plan からのみ作成する。
4. UI の表示だけで実行可否を判断せず、`confirm_state / plan_version / confirm session / audit` をセットで確認する。
5. rollback 手順は `execution plan.rollback_plan` を正本とし、実成果物の戻し先は GitHub / Figma / Drive 側にある前提で扱う。

## Admin UI Map

### 1. Write Plan Console
- URL: `/ui/write-plans.html`
- 用途:
  - write-plan の一覧、詳細、承認待ち、却下済みの確認
  - corrective action 以外を含む共通 write-plan 下書きの確認
- 主な導線:
  - confirm 前の計画確認
  - related execution plan の確認
  - `/ui/execution-plan-confirm.html` への移動

### 2. Execution Confirm
- URL: `/ui/execution-plan-confirm.html`
- 用途:
  - `変更対象 / 影響範囲 / rollback / 根拠 / 承認者 / 期限` の確認
  - `approve / reject / expire / revoke` の状態遷移
- 確認項目:
  - `summary`
  - `target_refs`
  - `impact_scope`
  - `expected_changes`
  - `rollback_plan`
  - `evidence_refs`
  - `risk_level`

### 3. Ops Console
- URL: `/ui/ops-console.html`
- 用途:
  - `confirm待ち / rejected / running / failed` をまとめて監視
  - `execution plan / job` の状態監視と incident triage
- 確認項目:
  - `Confirm待ち Plan`
  - `失敗 Job`
  - `Execution Plan 一覧`
  - `Execution Job 一覧`
  - `Plan Status / Plan Confirm State / Job Status`

### 4. Run Detail
- URL: `/ui/run.html?id=<run_id>`
- 用途:
  - run と `write-plan / execution plan / execution job` の相互参照
  - 実行履歴と変更計画の追跡

## Standard Operations

### A. confirm待ち対応
対象:
- `confirm_state=pending`
- `confirm_state=expired`
- `confirm_state=revoked`

手順:
1. `/ui/ops-console.html` の `Execution Monitoring` で `Confirm待ち Plan` を確認する。
2. 対象 plan を `/ui/execution-plan-confirm.html?plan_id=<plan_id>` で開く。
3. 以下を確認する。
   - `変更対象`
   - `影響範囲`
   - `rollback`
   - `根拠`
   - `承認者`
   - `期限`
4. `confirm_session.expires_at` と `current_plan_version` を確認し、期限切れや stale plan でないことを確認する。
5. stale の場合は承認せず、最新 plan を再表示して差分を確認する。

確認点:
- `plan_id`
- `project_id`
- `target_refs`
- `impact_scope`
- `risk_level`
- `expires_at`
- `plan_version`

### B. 承認
前提:
- 重要変更では `confirm_required=true`
- `required_approvers` に合致する actor である
- 自己承認でない

手順:
1. `/ui/execution-plan-confirm.html` で plan の要点と rollback を確認する。
2. `evidence_refs` から根拠不足がないことを確認する。
3. `approve` を実行する。
4. API では `confirm_state=approved` になっていることを確認する。
5. 承認後に `POST /api/execution-jobs` が通ることを確認する。
6. `/ui/ops-console.html` で plan が `confirm待ち` から外れたことを確認する。

確認点:
- `approved_by`
- `approved_at`
- `confirm_state=approved`
- `plan.approved` audit
- `job.created` draft

### C. 却下
前提:
- 却下理由を必ず残す

手順:
1. `/ui/execution-plan-confirm.html` で不足点を特定する。
2. `reject` を選び、`reason` を入力する。
3. `rejection_reason` が plan に保存されたことを確認する。
4. `/ui/write-plans.html` の `却下済み` と `/ui/ops-console.html` の `rejected` に反映されたことを確認する。
5. 再提案時は `reproposal_diff` を確認し、旧 session を再利用しない。

確認点:
- `rejection_reason`
- `confirm_state=rejected`
- `plan.rejected` audit
- `reproposal_diff`

### D. 失敗 job 対応
対象:
- `status=failed`
- `status=cancelled`

手順:
1. `/ui/ops-console.html` の `失敗 Job` から対象 job を確認する。
2. `job_type / target_scope / safety_level / confirm_state / plan_ref / run_ref` を確認する。
3. `/ui/run.html?id=<run_id>` で関連 run と plan/job trace を確認する。
4. failure の影響範囲を `plan.target_refs` と `job.target_scope` で確定する。
5. rollback が必要なら、関連 plan の `rollback_plan` を正として復旧に進む。
6. `job.finished` と audit draft の commit 状態を確認する。

確認点:
- `execution_job_id`
- `status`
- `plan_ref.plan_id`
- `run_ref.run_id`
- `failure summary`
- `job.finished` audit

### E. rollback
前提:
- rollback は execution plan に紐づく
- Hub 自体を正本として戻さない

手順:
1. 失敗 job か承認後取り消しが必要な plan を特定する。
2. `/ui/execution-plan-confirm.html` または API で `rollback_plan` を確認する。
3. 戻し先の正本で rollback を実施する。
   - GitHub: revert / restore / branch rollback
   - Figma: frame / component / page の手動復旧
   - Drive / docs: previous version restore
4. rollback 後に関連 run と Ops Console の状態を確認する。
5. 必要なら新しい write-plan / execution plan を作り直し、旧 confirm session は使わない。

確認点:
- `rollback_type`
- `rollback_steps`
- `target_refs`
- `impact_scope`
- `job.finished` 後の committed audit

## Incident Routing

### confirm待ちが滞留している
1. Ops Console
2. Execution Confirm
3. 承認 or 却下
4. Audit 確認

### 却下後に再提案が必要
1. Write Plan Console
2. Execution Confirm
3. `reproposal_diff` 確認
4. 新 session で再承認

### job 失敗
1. Ops Console
2. Run Detail
3. Execution Confirm で rollback 確認
4. 正本側で rollback
5. Audit 確認

## Audit Check
- `plan.created`
- `plan.approved`
- `plan.rejected`
- `job.created`
- `job.started`
- `job.finished`
- `job.created` draft -> committed

確認項目:
- `draft_state`
- `commit_condition`
- `rejection_reason`
- `approved_by`
- `approved_at`

## Evidence to Record
- `write_plan_id`
- `plan_id`
- `execution_job_id`
- `run_id`
- `target_refs`
- `impact_scope`
- `expected_changes`
- `rollback_plan`
- `evidence_refs`
- `risk_level`
- `confirm_state`
- `rejection_reason`

## References
- Phase7 Boundary SoT: `docs/ai/core/workflow.md`
- Phase7 backlog / SoT: `backlog/phase7-execution-layer.md`
- Execution Plan Model: `docs/ai/core/execution-plan-model.md`
- Execution Job Model: `docs/ai/core/execution-job-model.md`
- Phase6 Admin Ops Runbook: `docs/runbooks/phase6-admin-ops.md`
- External Ops Checklist: `docs/runbooks/vps-external-operations-checklist.md`
