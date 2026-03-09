# Workspace Phase3 Operations Notes

## Purpose
- Phase3 の Workspace 運用機能を、本番反映後にどの観点で確認するかを簡潔に固定する。
- 手順本体は `docs/runbooks/vps-workspace-phase3-checklist.md` を正本とする。

## Operator Focus
- `search`: 直近何が起きたかを探せるか
- `history`: confirm/write/failed/skipped を追跡できるか
- `observability`: run/failure/confirm/fidelity を即座に判断できるか
- `operability`: retry/refresh/export を安全に実行できるか

## Minimum Deploy Verification Set
1. Search で thread/run/operation/audit を引ける
2. History で day group / run summary / detail が見える
3. Metrics で KPI / status / provider / failure / fidelity / anomaly が見える
4. Retry で `read_only` と `failed_run` の制御差分が守られる
5. Export で `search/history/audit/metrics` を CSV/JSON で出せる
6. どの画面でも secret 実値が露出しない

## Escalation Rules
- secret 実値露出、confirm 必須 write の無断再実行、history の誤関連付けは即時停止・ロールバック判断に進む。
- metrics/anomaly の軽微な表示崩れは API 正常性を見たうえで影響範囲を限定する。

## References
- `docs/runbooks/vps-workspace-phase3-checklist.md`
- `docs/runbooks/vps-external-operations-checklist.md`
