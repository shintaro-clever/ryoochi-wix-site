# Phase7 Backlog: Execution Layer / Confirmed Change Execution (SoT)

Status: Planned backlog (NEXT7-00).  
Phase7 は SoT 上 **作成・変更実行レイヤー** として固定し、Phase5 の利用支援責務と Phase6 の管理統制責務に実行責務を逆流させない。

## Scope (Phase7)
- write-plan: 変更要求を plan 化し、対象、前提条件、差分意図、期待結果を定義する。
- execution plan: confirm 条件、対象システム、実行順序、記録先を含む実行計画を定義する。
- confirm付き変更実行補助: operator confirm を経て変更を実行し、無確認実行にしない。
- Figma / GitHub / AI / Run の変更連携: 実行 job と audit を通じて、各外部系への変更を追跡する。
- 対象は上記 4 領域のみに限定し、Phase7 の backlog はこの境界を越えて拡張しない。
- Hub の位置づけ: Hubは成果物SoTではない。Hub は orchestration layer として `thread / run / plan / audit` を保持し、成果物は GitHub / Figma / Drive 側に残す。

## Major Deliverables
- execution plan
- confirm flow
- execution job
- audit
- ops console
- selftest
- runbook

## Boundary Guardrail (SoT)
- Phase7 は実行責務を扱うが、Phase5 の Workspace 補助面を管理画面や自律実行面へ書き換えない。
- Phase6 の Admin / Org Ops に自律実行判断や confirm 省略前提を混入させない。
- plan / job / audit は Hub 側で保持してよいが、成果物の正本は GitHub / Figma / Drive 側に残す。
- Hub 内の thread / run / plan / audit を成果物 SoT と誤認させない。
- `confirmなし自動実行` `完全自律エージェント` `複数AI routing の高度化` を Phase7 の近道として導入しない。

## Non-Scope (Deferred Beyond Phase7)
- confirmなし自動実行
- 完全自律エージェント
- 複数AI routing の高度化
- Phase5 Workspace への管理責務逆流
- Phase6 Admin への自律実行混入
- 上記の対象外は Phase7 の UI / API / orchestration / 運用判断へ混入させない。

## Candidate Tasks
1. write-plan / execution plan の最小 schema 定義
2. confirm flow の state machine と UI 導線定義
3. execution job の target binding と failure_code 方針定義
4. GitHub / Figma / AI / Run を横断する audit event 設計
5. ops console の一覧 / filter / detail 要件整理
6. selftest 対象ケース定義
7. runbook と rollback / retry 境界整理

## Completion Criteria (NEXT7-01)
- 判定は `docs/ai/core/workflow.md` の `NEXT7-01 Phase7 Completion Criteria (SoT)` を正とする。
- Phase7 は次を満たしたときにのみ完了扱いとする。
  - execution plan
  - confirm flow
  - execution job
  - Run integration
  - audit
  - selftest
  - runbook
  - ops console
- `confirmなし自動実行` `完全自律エージェント` `複数AI routing の高度化` は完了条件に含めない。
