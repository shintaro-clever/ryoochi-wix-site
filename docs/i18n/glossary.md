# Phase5 Multilingual Policy And Glossary (SoT)

## Purpose

Phase5 の多言語説明と翻訳AI導入前提で、変訳してはいけない構造語と管理語を固定する。

## Default Policy

- Phase5 の既定応答言語は日本語とする。
- ただし、プロダクト内では言語切替を許可する。
- 多言語化の対象は説明文、FAQ回答、補助AIの説明出力であり、構造語の意味を崩してはならない。
- OpenAI は翻訳や多言語説明を行えるが、構造語の勝手な言い換えや schema 変更は禁止する。

## Translation Boundary

- UI label や説明文は翻訳してよい。
- API response key、audit key、evidence key、run/workspace/thread/project の識別構造は翻訳しない。
- `snake_case` の構造語は、表示上の補助ラベルを別途付けてもよいが、元の管理語を維持する。
- 管理語に対応する日本語注記を付ける場合でも、元の英語構造語を併記する。

## Fixed Managed Terms

以下は Phase5 の固定管理語とし、変訳禁止または管理語として原文維持とする。

### API / State Terms

- `status`
- `failure_code`
- `action_type`
- `reason_type`
- `confirm_required`
- `confirm_required_reason`
- `evidence_refs`
- `metric_snapshot`
- `history_window`
- `manual`
- `runbook`
- `doc_source`

### Workspace / Entity Terms

- `project`
- `thread`
- `run`
- `project_id`
- `thread_id`
- `run_id`
- `ai_setting_id`
- `provider`
- `model`
- `use_case`

### Phase4 / Corrective Action Terms

- `corrective_action_plan`
- `corrective_action`
- `linked_reason_types`
- `target_file_or_component`
- `expected_impact`
- `confidence`
- `write_plan`
- `planned_action`
- `confirm_token`

## UI Rendering Rule

- UI では `status` のような構造語に対して `status / 状態` のような併記は許可する。
- ただし、submit payload や response payload の key 名は原文のまま扱う。
- `failure_code`、`reason_type`、`action_type` は分類軸であるため、表示文言だけをローカライズして key 自体は固定する。
- `confirm_required` は boolean 管理語として固定し、`要確認` のような自然言語だけに置換しない。
- `evidence_refs` は回答本文と分離された構造として固定し、`根拠` のみの曖昧語へ崩さない。

## Examples

- 許可:
  - `status / 状態`
  - `failure_code / 失敗コード`
  - `confirm_required / 確認必須`
- 不許可:
  - `status` を `状態値` に置換して API key を変える
  - `thread` を `会話` のみに統一して `thread_id` を隠す
  - `evidence_refs` を自由文の「参考情報」に崩す

## References

- `docs/ai/core/workflow.md`
- `docs/ai/core/openai-assist-model.md`
