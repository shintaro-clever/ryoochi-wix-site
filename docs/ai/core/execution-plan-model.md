# Execution Plan Model (Phase7 SoT)

この文書は Phase7 の execution plan model を定義する一次情報です。  
execution plan は proposal ではなく、**確認可能で監査可能な変更計画**として扱います。

## Positioning

- proposal は候補・提案・補正案の層であり、そのまま実行前提にしない。
- write-plan は proposal を実行可能形へ寄せる準備層であり、まだ confirm / audit の正本ではない。
- execution plan は server 保存を前提にした実行計画であり、confirm と audit の対象になる。
- Hubは成果物SoTではない。Hub は orchestration layer として plan を保持できるが、成果物の正本は GitHub / Figma / Drive 側に残す。

## Proposal vs Write-Plan vs Execution Plan

### proposal

- 目的: 次に何を変えるべきかの候補を出す
- 生成元:
  - Phase4 corrective action
  - Phase5 AI提案 / 補正案 / 要約起点の提案
  - Phase6 統制・ポリシー判断起点の変更要求
- 特徴:
  - 複数候補を持てる
  - 未整理の仮説を含んでよい
  - confirm / rollback / audit をまだ満たしていなくてよい

### write-plan

- 目的: proposal を変更準備用の単一案に寄せ、対象、前提条件、差分意図、期待結果を整理する
- 特徴:
  - 候補を絞り込む
  - target / precondition / expected change を明示する
  - corrective action 専用 shape に閉じず、Workspace / Admin / Run detail から同じ shape で作れる
  - execution plan の入力になる
  - まだ confirm 済みとは扱わない
  - audit の確定レコードとは扱わない

### execution plan

- 目的: 何を、誰が、何を見て、どの条件で承認し、どこへ反映するかを固定する
- 特徴:
  - server 保存前提
  - confirm 可能
  - audit 可能
  - rollback 前提を持つ
  - 将来 execution job へ変換しやすい

## Common Change Model

proposal / write-plan / execution plan は別物だが、次の共通 primitive を共有できる。

- `source_type`
- `source_ref`
- `plan_type`
- `target_kind`
- `target_refs`
- `summary`
- `expected_changes`
- `evidence_refs`
- `impact_scope`
- `risk_level`

この共通 primitive は `src/types/changePlan.js` を正とし、execution plan はその上に confirm / rollback / review lifecycle を追加する。

## Connection To Phase4 / Phase5 / Phase6

- Phase4 corrective action:
  - fidelity 差分や corrective action を proposal source として execution plan に接続する
  - `source_type=phase4_corrective_action` を使い、compare result や run artifact を `evidence_refs` に残す
- Phase5 AI提案:
  - AI の提案・補正案は execution plan そのものではない
  - AI が proposal を補助しても、execution plan では `proposed_by_ai` と `confirm_policy` を分離する
- Phase6 統制:
  - 組織統制・接続統制・知識源統制などの判断を source に持てる
  - ただし統制判断をそのまま自律実行へ流さず、execution plan と confirm を必須にする

## Canonical Schema

execution plan は最低限次を保持できる shape に固定する。

- `plan_id`
- `tenant_id`
- `project_id`
- `thread_id`
- `run_id`
- `source_type`
- `source_ref`
- `plan_type`
- `target_kind`
- `target_refs`
- `requested_by`
- `proposed_by_ai`
- `summary`
- `expected_changes`
- `evidence_refs`
- `impact_scope`
- `risk_level`
- `confirm_required`
- `plan_version`
- `confirm_state`
- `confirm_policy`
- `confirm_session`
- `rollback_plan`
- `status`
- `rejection_reason`
- `approved_by`
- `approved_at`
- `created_at`
- `updated_at`

write-plan は execution plan の前段だが、少なくとも次の共通項目を持てること。

- `write_plan_id`
- `tenant_id`
- `project_id`
- `thread_id`
- `run_id`
- `source_type`
- `source_ref`
- `target_kind`
- `target_refs`
- `target_files`
- `summary`
- `expected_changes`
- `evidence_refs`
- `confirm_required`
- `status`
- `created_by`
- `created_at`
- `updated_at`

write-plan は少なくとも `target_files / expected_changes / evidence_refs / confirm_required / source_ref` を保持し、入口が corrective action / Workspace / Admin で違っても API shape を揃える。

ただし write-plan は `confirm_policy` `rollback_plan` `approved_by` `approved_at` を execution plan と同等の確定状態として扱わない。

## Field Semantics

### Identity / Tenant Boundary

- `plan_id`: execution plan の識別子
- `tenant_id`: tenant 境界
- `project_id`: project 境界
- `thread_id`: 会話起点
- `run_id`: run 起点。proposal と evidence を追跡するために保持する

### Source

- `source_type`: plan の発生源
- `source_ref`: source の参照情報。単一 source を表す object に固定する

`source_type` は最低限次を表現できること。

- `phase4_corrective_action`
- `phase5_ai_proposal`
- `phase6_governance_request`
- `manual_request`
- `run_artifact`
- `doc_change_request`

`source_ref` は最低限次を表現できること。

- `system`
- `ref_kind`
- `ref_id`
- `path`
- `label`
- `version`
- `metadata`

## Target

- `plan_type`: 変更の型
- `target_kind`: 主対象の種別。単一 target に閉じない場合は `mixed` を使える
- `target_refs`: 複数対象を保持する配列

`target_kind` は最低限次を表現できること。

- `github`
- `figma`
- `doc`
- `drive`
- `mixed`

`target_refs` の各要素は最低限次を表現できること。

- `system`
- `target_type`
- `id`
- `path`
- `name`
- `scope`
- `writable`
- `metadata`

これにより Figma / GitHub / Doc 等の対象を複数配列で持てる。

Figma target は少なくとも次の粒度を `target_refs` で明示できること。

- `page`
- `frame`
- `component`
- `node`

GitHub target は少なくとも次の粒度を `target_refs` で明示できること。

- `repo`
- `branch`
- `file`

## Expected Changes

- `summary`: 一行要約
- `expected_changes`: 実行後に何が変わるかの構造化一覧

`expected_changes` の各要素は最低限次を表現できること。

- `change_type`
- `target_ref`
- `summary`
- `before_ref`
- `after_ref`
- `patch_hint`

## Evidence Refs

`evidence_refs` は execution plan の根拠参照であり、最低限次を保持できる shape に固定する。

- `run_artifacts`
- `compare_results`
- `ai_summaries`
- `source_documents`
- `other_refs`

例:

- run artifact
- compare result
- ai summary
- source document
- runbook / policy / SoT

## Impact Scope

`impact_scope` は boolean や単純文字列で済ませず、**enum + details** に固定する。

- `scope`: 主たる影響粒度
- `details`: 追加の粒度や対象詳細

`scope` は最低限次を表現できること。

- `account`
- `project`
- `org`
- `repo`
- `file`
- `frame`
- `component`
- `thread`
- `run`
- `document`
- `mixed`

`details` は最低限次を表現できること。

- `kind`
- `ref`
- `summary`

## Confirm Model

- `confirm_required`: confirm が必要か
- `plan_version`: plan の現在版。confirm token / session と execution job 作成の整合性判定に使う
- `confirm_state`: `pending | approved | rejected | expired | revoked | not_required`
- `confirm_policy`: confirm の詳細 policy
- `confirm_session`: server 発行の confirm token/session 束縛情報

`confirm_required` は boolean だが、execution plan は `confirm_policy` も別に持つ。  
`confirm_policy` は最低限次を表現できること。

- `mode`
- `required_approvers`
- `required_views`
- `approval_conditions`
- `notes`

`required_approvers` は最低限次を表現できること。

- `type`
- `actor_id`
- `role`
- `label`

`required_views` は最低限次を表現できること。

- `view_id`
- `label`
- `required`

`approval_conditions` は最低限次を表現できること。

- `condition_id`
- `summary`
- `check_type`
- `details`

これにより「誰が」「何を見て」「どの条件で承認できるか」を execution plan に固定する。

confirm は UI ボタン押下ではなく、**server-enforced な状態遷移**として扱う。  
重要変更では server が `risk_level` / `impact_scope` から `confirm_required=true` を強制し、client が false に書き換えても通さない。

`confirm_session` は最低限次を束縛できること。

- `plan_id`
- `tenant_id`
- `project_id`
- `actor_id`
- `issued_at`
- `expires_at`
- `confirm_hash`
- `current_plan_version`

これにより再利用防止、期限切れ、版ずれ検知を server 側で扱える。

## Rollback Plan

`rollback_plan` は自由文ではなく、最低限次を持つ構造に固定する。

- `rollback_type`
- `rollback_steps`
- `rollback_preconditions`

`rollback_steps` の各要素は最低限次を表現できること。

- `step`
- `target_ref`
- `notes`

`rollback_preconditions` の各要素は最低限次を表現できること。

- `summary`
- `required`

## Risk / Review State

- `risk_level`: `low | medium | high | critical`
- `status`: execution plan の状態
- `confirm_state`: `approve / reject / expire / revoke` の結果状態
- `rejection_reason`: reject 時の理由
- `approved_by`
- `approved_at`

execution job 作成 API は `confirm_state=approved` の plan のみ通す。  
未承認 plan から job を作らないことを server 側で固定する。

## Approval Boundary

- confirm session の存在だけでは approve できない
- approve 時は `confirm_policy.required_approvers` を server で評価する
- `actor_id` または `role` が一致しない actor は approve できない
- `requested_by` と同一 actor による自己承認は既定で禁止する
- project / tenant 境界は plan 本体と confirm session の束縛でまたがれないようにする

## Audit Draft Lifecycle

- execution job 作成時は audit event を即 commit せず、まず `audit draft` を保存する
- draft は `confirmed_ready` の下書きであり、確定イベントではない
- draft から committed event へ進める条件は execution job の実行結果確定後とする
- したがって `queued/running` の間は draft のまま保持し、`succeeded/failed/cancelled` のいずれかで committed event を確定する

## Status Transition

execution plan の状態遷移は最低限次を想定する。

1. `draft`
- server 内部で plan を構築中

2. `confirm_pending`
- 保存済みで review / confirm 待ち

3. `approved`
- confirm 条件を満たし、execution job へ変換可能

4. `rejected`
- 明示的に却下

5. `cancelled`
- 実行前に不要化

6. `superseded`
- 後続 plan に置換

7. `converted_to_job`
- execution job 作成済み

禁止:

- proposal のまま `approved` 扱いにすること
- `confirm_pending` を経ずに自動で `converted_to_job` へ進めること

## DB Shape vs API Shape

execution plan は **DB 保存 shape** と **API response shape** を分ける。

### DB Shape

- nested data は JSON column で保持する
- 内部メタは `internal_meta_json` に保持できる
- `confirm_required` は integer で保持できる
- `approved_by` `approved_at` `rejection_reason` は review lifecycle として保持する

DB 保存 shape の目的:

- audit と将来 job 変換に必要な情報を欠落させない
- server 側だけが持つ内部メタを client に直接漏らさない

### API Response Shape

- public field のみ返す
- `internal_meta_json` や server-only metadata は返さない
- client-only object として成立させず、保存済み plan を返す

write-plan / proposal を将来 API で返す場合も、DB shape と API shape を混同せず、保存済み server record と UI 一時構造を分離する。

## Execution Job Readiness

- execution plan は将来 `execution_job` へ変換しやすいよう、target / confirm / rollback / evidence を分離して保持する
- ただしこの段階では execution job model を確定しすぎない
- Phase7 では `plan -> confirm -> execution_job` の変換余地を持つことを優先する

## Implementation SoT

- 文書 SoT: `docs/ai/core/execution-plan-model.md`
- type / normalize helper: `src/types/executionPlan.js`
- DB 保存 shape: `src/db/executionPlans.js`
- API response shape: `src/server/executionPlans.js`

## Relation To Other SoT

- Phase4 / Phase5 / Phase6 / Phase7 boundary: `docs/ai/core/workflow.md`
- AI evidence model: `docs/ai/core/ai-evidence-model.md`
