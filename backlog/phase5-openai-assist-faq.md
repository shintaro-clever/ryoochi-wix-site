# Phase5 Backlog: OpenAI Assist / Multilingual Help / FAQ / Workspace IA (SoT)

Status: Planned backlog (NEXT5-00).  
Phase5 は **単一運用者前提** で進め、UI の正本は `/ui/` 配下の新UIとする。

## Scope (Phase5)
- OpenAI運用補助AI: OpenAI API / ChatGPT 運用を補助する導線、説明、設定補助、失敗時ガイドを整備する。
- 多言語説明: 同一機能について、最低限の操作説明・制約・注意点・失敗時案内を多言語で提供する。
- FAQボット: よくある質問への自己解決導線を整備し、運用者の反復負荷を減らす。
- Workspace IA再編: Workspace の情報構造、名称、ナビゲーション、導線配置を単一運用者向けに再編する。
- Workspace IA再編の基準面: 1枚目を現状UI、2枚目を目標UIとして扱い、再編判断は目標UI基準で行う。
- Workspace IA再編の目標構成: 左は横断ナビ、中央はAI作業面、右は接続済みリソース / roadmap / recent files を置く。
- UI正本: 旧HTML直配信問題は修正済みとし、今後の UI 変更は `/ui/` を正本として扱う。

## Non-Scope (Reserved For Phase6+)
- 社内管理画面
- 組織ユーザー管理
- RBAC強化
- 複数AI routing
- confirm なし自動実行
- 完全自律エージェント

## Boundary Guardrail (SoT)
- Phase5 の要求に Phase6 責務を混入させない。
- `/ui/` を正本とし、旧ページ直配信を設計基準に戻さない。
- 単一運用者前提を崩す組織運用機能は別フェーズへ分離する。

## Candidate Tasks
1. OpenAI運用補助AIの導線定義と主要ユースケース整理
2. 多言語説明コンテンツの最小セット定義
3. FAQボットの対象質問、回答ソース、エスカレーション条件定義
4. Workspace IA再編案のサイトマップ / ナビゲーション見直し
5. `/ui/` 正本前提の画面移行チェックリスト整備

## Completion Criteria (NEXT5-01)
- Phase5 完了条件は `docs/ai/core/workflow.md` の `NEXT5-01 Phase5 Completion Criteria (SoT)` を正とする。
- 完了条件は単なる接続完了ではなく、次を含む運用可能状態で判定する。
  - SoT 固定
  - OpenAI 接続 / verify / wrapper 固定
  - boundary / evidence 固定
  - 要約 / 分析 / 翻訳 / FAQ の運用成立
  - FAQ guardrails
  - general / operator FAQ UI
  - runbook nav
  - AI Usage Metrics
  - audit event
  - selftest 統合
  - Phase5 runbook
