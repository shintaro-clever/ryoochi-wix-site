# Phase6 Backlog: Admin / Org Ops / Governance (SoT)

Status: Planned backlog (NEXT6-00).  
Phase6 は **社内活用向け管理画面 / 組織運用レイヤー専用フェーズ** として進め、Phase5 の単一運用者向け Workspace と責務分離する。

## Scope (Phase6)
- 社内管理画面
- 組織ユーザー管理
- RBAC
- 接続ライフサイクル管理
- AI利用管理
- FAQ知識源管理
- 多言語設定管理
- 監査ビュー

## Boundary Guardrail (SoT)
- Phase6 は管理責務を扱うフェーズであり、Phase5 の `Run / Workspace / Help / Help Admin` 中心の単一運用者向け補助導線と混線させない。
- 管理用の設定、権限、接続統制、知識源統制、監査閲覧は Phase6 側へ寄せる。
- Phase5 側には、組織運用判断や管理UIを逆流させない。

## Non-Scope (Deferred Beyond Phase6)
- 複数AI routing の高度化
- confirm なし自動実行
- 完全自律エージェント

## Candidate Tasks
1. 管理画面 IA と role 別導線定義
2. 組織ユーザー管理 / RBAC の最小モデル定義
3. 接続ライフサイクル管理 UI / API 方針定義
4. AI利用管理と利用制限ルール定義
5. FAQ 知識源管理画面と承認フロー定義
6. 多言語設定管理の範囲定義
7. 監査ビューの検索 / filter / export 要件定義

## Completion Criteria (NEXT6-01)
- 判定は `docs/ai/core/workflow.md` の `NEXT6-01 Phase6 Completion Criteria (SoT)` を正とする。
- Phase6 は次を満たしたときにのみ完了扱いとする。
  - 組織運用 / RBAC
  - 接続ライフサイクル管理
  - Admin Console / Ops Console / AI Admin / Knowledge Admin
  - members / invites / connections UI
  - AI 利用管理
  - FAQ 知識源管理
  - 多言語設定管理
  - 監査ビュー
  - B分類残差回収
  - selftest 統合
  - runbook
- `複数AI routing の高度化` `confirm なし自動実行` `完全自律エージェント` は完了条件に含めない。
