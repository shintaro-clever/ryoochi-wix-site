# AI Evidence Model (Phase5 SoT)

この文書は Phase5 の AI evidence model を定義する一次情報です。  
AI 応答は本文だけで完結させず、`evidence_refs` を別構造で返し、後続の要約 / 分析 / FAQ / 翻訳でも同じ shape を使います。

## Principle

- AI 応答は感想ベースではなく、参照した根拠の所在を `evidence_refs` として保持する。
- `evidence_refs` は回答本文と分離し、本文側へ生の根拠一覧を埋め込んで SoT 代替にしない。
- OpenAI 送信時も `evidence_refs` は `src/ai/openaiClient.js` を共通入口として正規化し、送信境界を適用する。

## Common Shape

`evidence_refs` は最低限次を保持できる shape に固定する。

- `run_id`
- `thread_id`
- `metric_snapshot`
- `history_window`
- `manual`
- `runbook`
- `doc_source`

### Required Semantics

- `run_id`: 回答根拠になった Run の識別子
- `thread_id`: 回答根拠になった Thread の識別子
- `metric_snapshot`: 回答時点で参照した主要指標の snapshot
- `history_window`: どの履歴範囲を参照したかの window
- `manual`: 手動メモ / 運用メモ / 補足資料
- `runbook`: 手順書 / 運用 runbook
- `doc_source`: SoT 文書 / 説明文書 / FAQ元資料

## Boundary Rule

- `evidence_refs` に secret-like 値、`confirm_token`、生の secret 解決値、過度な個人情報本文、秘匿監査生文を含めてはならない。
- OpenAI に送るときは `evidence_refs` を正規化し、必要最小限の summary に変換して使う。
- audit には `evidence_refs` の全文ではなく summary のみを残す。

## Implementation SoT

- 共通 model helper: `src/ai/aiEvidenceModel.js`
- 共通 OpenAI wrapper: `src/ai/openaiClient.js`
- 送信境界: `src/ai/openaiDataBoundary.js`

## Relation To Other SoT

- OpenAI Assist Model: `docs/ai/core/openai-assist-model.md`
- OpenAI Data Boundary: `docs/ai/core/openai-data-boundary.md`
- Phase5 Boundary: `docs/ai/core/workflow.md`
