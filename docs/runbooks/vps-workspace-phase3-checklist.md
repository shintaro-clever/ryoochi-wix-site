# VPS Workspace Phase3 Checklist (P3-OPSX-01)

## Purpose
- VPS反映後に、Phase3 Workspace 機能が運用導線として正常に使えることを確認する。
- 対象: `search` / `history` / `observability(metrics)` / `retry` / `export`
- 外部操作そのものの安全確認は `docs/runbooks/vps-external-operations-checklist.md` を正本とする。

## Preconditions
1. `bin/vps 'echo connected'` を先に実行する。
2. 接続失敗時は SSH を連打しない。`fail2ban` BAN を疑って停止する。
3. 反映後に `Project詳細 -> Workspace` へ到達できることを確認する。
4. 可能なら確認対象 project には以下が最低1件ずつ存在する状態にする。
   - thread
   - run
   - failed または skipped を含む history
   - metrics に現れる operation / fidelity / failure_code

## Required Verification Flow (Fixed Order)

### 1. Search
1. Workspace Search で `thread` / `run` / `external_operation` / `external_audit` を含む query を実行する。
2. `status` / `provider` / `time_from` / `time_to` のいずれか1つ以上で再検索する。
3. 検索結果から `thread 詳細`、`run 詳細`、`履歴へ` の導線を順に確認する。

期待結果:
- 検索結果が 0件時でも UI が崩れない。
- `provider/status/time range` の絞り込みが反映される。
- 結果カードから thread/run/history detail へ遷移できる。
- secret 実値ではなく redact 済み summary/snippet のみが見える。

失敗時確認点:
- `/api/workspace/search` の 4xx/5xx
- `scope` / `provider_filter` / `cursor` の入力不整合
- search index 未更新、project/thread/run 関連付け不整合
- snippet に token/secret/confirm_token が露出していないか

ロールバック観点:
- 検索結果が壊れても write 系機能を止める必要はないが、運用導線として致命なら前版に戻す。
- mask 不備がある場合は即時ロールバック対象とする。

### 2. History
1. Workspace History を project scope で開く。
2. `event_type` / `status` / `provider` / `scope` / `time range` を切り替えて再読込する。
3. 日次 group、run summary、event row、detail pane を順に確認する。
4. `confirm executed`、`failed`、`skipped` を含む event が視認できることを確認する。

期待結果:
- `run.created`、`run.status_changed`、`read.plan_recorded`、`write.plan_recorded`、`confirm.executed`、`external_operation.recorded`、`audit.projected` を統合表示できる。
- day group / run summary が表示され、大量イベントでも一覧が読める。
- selected event から run/thread/detail 導線が使える。
- failed/skipped/confirm 系が status badge で見分けられる。

失敗時確認点:
- `/api/history` の filter、cursor、time range
- `history_run_id` / `history_thread_id` の URL 反映
- `day_groups` / `run_summaries` が空になっていないか
- history detail に run_id が無い event が混ざっていないか

ロールバック観点:
- 単なる要約欠落なら暫定運用可だが、event 欠落や誤表示は前版復旧対象。
- confirm / failed / skipped の誤表示は運用判断を誤らせるためロールバック優先度を上げる。

### 3. Observability / Metrics
1. Workspace Observability を開く。
2. `24h` / `7d` / `30d` / `custom` を順に切り替える。
3. `project scope` と `active thread scope` を切り替える。
4. KPI、status distribution、provider counts、failure codes、fidelity、timeseries、anomaly strip を確認する。

期待結果:
- KPI に `run counts`、`confirm rate`、`operations`、`duration median/p95` が出る。
- status 分布に `queued/running/ok/failed/skipped` が出る。
- provider 別 operation 件数、failure_code 集計、figma fidelity 集計が表示される。
- anomaly がある場合は `warning/alert` 表示になる。
- 0件でも空 state の shape が崩れない。

失敗時確認点:
- `/api/metrics/workspace` の `project/thread/provider/start_at/end_at`
- anomaly thresholds が server 側で読めているか
- history volume / thread activity timeseries の日次集計
- custom range で invalid date が混入していないか

ロールバック観点:
- KPI 欠落や anomaly 誤報は運用影響が高い。原因切り分け不能なら前版へ戻す。
- fidelity 詳細だけのズレなら Phase4 責務との境界を確認して影響範囲を限定する。

### 4. Retry / Refresh
1. History detail で run 付き event を選択する。
2. `retry read-only` を実行し、新 run が生成されることを確認する。
3. failed run がある場合は `retry failed run` を実行する。
4. queue/running run や non-failed run に対して disabled reason が出ることを確認する。
5. metrics 側の `latest run retry` / `latest failed retry` も確認する。

期待結果:
- read-only retry と failed-run retry が区別される。
- confirm 必須だった write が無断再実行されない。
- 新 run に `retry_of_run_id` / `retry_kind` が紐づく。
- 実行不可時は理由が UI に表示される。

失敗時確認点:
- `/api/runs/:run_id/retry`
- source run status 判定
- retry child relation の保存
- planned action / confirm token / actual external operation を持ち越していないか

ロールバック観点:
- confirm 必須 write の無断再実行は即時ロールバック対象。
- read-only retry だけ壊れている場合も運用 UI が誤誘導するなら前版へ戻す。

### 5. Export
1. Search で `json` / `csv` export を実行する。
2. History で `json` / `csv` export を実行する。
3. History detail で `export detail` と `export audit` を実行する。
4. Metrics で `json` / `csv` export を実行する。
5. 保存ファイルの列順と shape を spot check する。

期待結果:
- `search` / `history` / `audit` / `metrics` を CSV/JSON で取得できる。
- attachment filename が kind ごとに安定している。
- CSV header 順と JSON shape が固定されている。
- secret 実値や confirm token は含まれない。

失敗時確認点:
- `/api/exports/workspace`
- `kind` / `format` / `limit` / filter payload
- browser 側 download 処理
- exported file に token/secret/password/api_key/confirm_token が残っていないか

ロールバック観点:
- export 失敗のみなら一時的な運用制限で凌げる場合がある。
- ただし mask 不備や監査 export の破損はロールバック優先。

## Evidence to Keep
- 確認日時
- 対象 VPS / branch / deploy revision
- `project_id`, `thread_id`, `run_id`
- 検索 query と適用 filter
- history で確認した event_type / status
- metrics range と anomaly の有無
- retry 前後の run_id
- export した file kind / format

## Rollback Trigger Summary
- secret 実値、confirm token、password、api_key が search/history/export に露出した
- retry が confirm 必須 write を無断再実行した
- history が event 欠落または誤った run/thread に紐付いた
- metrics/anomaly が明らかに誤って運用判断を誤らせる

## References
- Phase3 SoT: `docs/ai/core/workflow.md`
- Search model: `docs/ai/core/search-model.md`
- History model: `docs/ai/core/history-model.md`
- Observability model: `docs/ai/core/observability-model.md`
- Operability model: `docs/ai/core/operability-model.md`
- External operations checklist: `docs/runbooks/vps-external-operations-checklist.md`
