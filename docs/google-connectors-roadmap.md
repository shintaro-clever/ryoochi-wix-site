# Google Connectors Roadmap (Deferred)

Google系連携（Drive/Docs/Sheets/GitHub以外のGoogle API）は本フェーズでは実装しない。

## Scope (Now)
- Figma ↔ Hub ↔ AI ↔ GitHub PR の往復成立を優先する。
- Google系は「接続枠の検討」のみを残し、実コードは追加しない。

## Deferred Tasks
1. Google connector schema draft (provider_key, config schema)
2. OAuth/token management design
3. Read-only verification endpoint design
4. Ingest integration with allowed_paths policy

## Start Condition
次の条件を満たしたら着手する。
- Figma ingest to PR flow が selftest で安定 green
- Traceability (Figma input -> Run -> PR) が UI/API で確認可能
