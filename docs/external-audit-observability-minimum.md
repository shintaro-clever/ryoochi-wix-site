# OPSX-02 External Audit / Observability Minimum

## Scope
- 対象: GitHub/Figma の external read / external write。
- 保持先: Run (`/api/runs`, `/api/projects/:id/runs`) を正本とする。

## Minimum Audit Questions
- 誰が実行したか:
  - `external_audit.actor.requested_by`
  - `external_audit.actor.ai_setting_id`
  - `external_audit.actor.thread_id`
- どの project / run か:
  - `external_audit.scope.project_id`
  - `external_audit.scope.run_id`
  - `external_audit.scope.status`
- 何を読んだか:
  - `external_audit.read.targets.github`
  - `external_audit.read.targets.figma`
  - `external_audit.read.confirm_required`, `confirm_required_reason`
- 何を書こうとしたか:
  - `external_audit.write_plan[]` (`provider`, `operation_type`, `target`, `status`)
- 実際どうなったか:
  - `external_audit.write_actual[]` (`result.status`, `failure_code`, `reason`, `artifacts`)

## Figma Fidelity Tracking
- Figma write の場合、次を追跡対象に含める:
  - `external_audit.figma_fidelity.status`
  - `external_audit.figma_fidelity.score_total`
  - `external_audit.figma_fidelity.passed`
  - `external_audit.figma_fidelity.hard_fail_reasons`
  - `external_audit.figma_before_after`

## Secret Handling Rule
- API 応答・Run snapshot・監査ビューに秘密値を保存しない。
- `token` / `secret` / `password` / `api_key` を含む文字列は監査表示で `"[redacted]"` とする。
- 設定は secret reference (`env://...`, `vault://...`) のみを扱う。

## Operational Guard
- confirm が必要な write は、confirm 完了前に実行しない。
- chat 応答だけでなく Run の `external_audit` と `external_operations` で最終判定する。
