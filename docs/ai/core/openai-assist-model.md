# OpenAI Assist Model (Phase5 SoT)

この文書は Phase5 における OpenAI 接続の利用モデルを定義する一次情報です。  
OpenAI は **運用補助AI** として扱い、Hub の最終 SoT を自律的に書き換える主体として扱いません。

## Positioning

- OpenAI の役割は、単一運用者を補助することに限定する。
- OpenAI は判断材料を返す補助層であり、最終的な仕様決定、運用決定、SoT 更新決定は人間側で行う。
- OpenAI の応答は提案・説明・整理として扱い、そのまま正本化しない。

## In Scope

Phase5 で OpenAI に許可する役割は次の 5 つに固定する。

1. 要約
- 会話、Run、履歴、仕様、差分、運用メモの要約

2. 分析
- 問題の切り分け
- ログや履歴の読み解き
- 選択肢比較のための整理

3. 提案
- 次のアクション候補
- UI 改善案
- 文言改善案
- FAQ 候補や導線改善案

4. 翻訳
- 多言語説明
- 運用手順や注意事項の翻訳

5. FAQ回答
- 既知情報に基づく FAQ への回答
- 自己解決のための案内

## Out Of Scope

Phase5 の OpenAI は次を行わない。

- GitHub への無確認実行
- Figma への無確認実行
- human confirm を伴わない write 実行
- 組織管理判断
- 権限設計判断
- RBAC 方針決定
- 社内管理画面の運用決定
- 複数AI routing の自律判断
- confirm なし自動実行
- 完全自律エージェント動作
- Hub の最終 SoT を自律的に更新すること

## Guardrails

- OpenAI が返す内容は、要約・分析・提案・翻訳・FAQ回答の範囲に留める。
- GitHub / Figma の変更実行は、既存の human-in-the-loop と confirm 境界を越えない。
- OpenAI の出力は、仕様・運用・権限・監査の最終決定として扱わない。
- SoT 文書の更新は、人間が文書責任を持って実施する。

## Multilingual Policy

- Phase5 の既定応答言語は日本語とする。
- ただし、プロダクト内では言語切替を許可する。
- 翻訳や多言語説明を行う場合でも、`status` `failure_code` `action_type` `reason_type` `confirm_required` `project` `thread` `run` `evidence_refs` などの構造語は固定管理語として扱う。
- 詳細な固定語彙は `docs/i18n/glossary.md` を正とする。

## Relation To Other SoT

- Phase5 境界 SoT: `docs/ai/core/workflow.md`
- Workspace IA Phase5 SoT: `docs/ai/core/workspace-ia-phase5.md`
- 多言語方針 / 用語集 SoT: `docs/i18n/glossary.md`
