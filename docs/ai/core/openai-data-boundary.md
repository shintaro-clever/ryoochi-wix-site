# OpenAI Data Boundary (Phase5 SoT)

この文書は Phase5 の OpenAI 送信境界を定義する一次情報です。  
OpenAI へ送る情報は `src/ai/openaiClient.js` を共通入口とし、本境界を必ず適用します。

## Allowed

- 要約、分析、提案、翻訳、FAQ回答に必要な最小限の prompt
- 実行判断に不要な秘匿値を除いた evidence summary
- 既に公開可能な説明文、UI 文言、非秘匿の要約テキスト

## Prohibited

OpenAI へ次を送ってはいけない。

- secret-like 値
- `confirm_token`
- `confirm_token_hash`
- 生の secret 解決値
- `secret_id` の生解決値
- API key / token / password / secret の本文
- 過度な個人情報本文
- 秘匿監査の生文

## Normalization Rule

- `env://...` / `vault://...` は `[redacted]` に置換する。
- token / secret / api_key / password / confirm token 系は `[redacted]` に置換または全文 redact する。
- email / phone / SSN などの個人情報は `[redacted_pii]` に置換し、過多な場合は本文全体を `[redacted_pii]` とする。
- raw audit event / audit jsonl / 秘匿監査生文は `[redacted_audit]` とする。
- 上記の規則は verify / 要約 / 分析 / 翻訳 / FAQ の全 OpenAI 経路に共通適用する。

## Implementation SoT

- 共通入口: `src/ai/openaiClient.js`
- 境界実装: `src/ai/openaiDataBoundary.js`
- 秘匿整合: `src/api/runs.js` の `safeAuditText` と同等以上の redact を適用する
