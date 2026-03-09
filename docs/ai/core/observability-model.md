# Phase3 Workspace Observability Model (SoT)

## Purpose
- Phase3 の `observability` で何を主要指標として扱うかを先に固定し、UI / API / 集計実装のブレを防ぐ。
- Phase3 は Workspace 運用指標を主軸とし、Phase4 の fidelity hardening 指標と責務を混線させない。

## Scope
- 対象: Workspace operator が日々の運用で確認する `run` / `confirm` / `external operation` / `search` / `history` / `thread` の健全性。
- 保持元: `runs`, `external_operations`, `external_audit`, `history`, `search audit`, `thread messages`。

## Primary Metrics (Required)

### 1. Run Counts
- `run_counts.total`
- `run_counts.by_project`
- `run_counts.by_thread`
- `run_counts.by_job_type`

### 2. Run Status Distribution
- 最低限次を固定する:
  - `queued`
  - `running`
  - `ok`
  - `failed`
  - `skipped`
- 表示上 `ok` は `succeeded` / `completed` を正規化した運用指標として扱ってよい。

### 3. Confirm Rate
- `confirm_rate.total`
- `confirm_rate.by_provider`
- `confirm_rate.by_operation_type`
- 定義:
  - 分母: `write.plan_recorded`
  - 分子: `confirm.executed`
- confirm 未実行で止まっている plan 数を別途追えること。

### 4. Provider Operation Counts
- 対象 provider は最低限:
  - `github`
  - `figma`
- 集計軸:
  - `operation_counts.by_provider`
  - `operation_counts.by_provider_and_status`
  - `operation_counts.by_operation_type`

### 5. Failure Code Distribution
- `failure_code_distribution.total`
- `failure_code_distribution.by_run`
- `failure_code_distribution.by_provider`
- run failure と external operation failure の両方を追えること。

### 6. Search Count
- `search_count.total`
- `search_count.by_project`
- `search_count.by_actor`
- `search_count.by_scope`

### 7. History Event Volume
- `history_event_volume.total`
- `history_event_volume.by_event_type`
- `history_event_volume.by_day`
- `history_event_volume.by_run`

### 8. Retry / Corrective Write-Plan Generation Count
- `retry_count.total`
- `corrective_write_plan_count.total`
- `corrective_write_plan_count.by_provider`
- Phase3 では「どれだけ corrective flow が必要になったか」を見る。

### 9. Thread Activity
- `thread_activity.total_threads`
- `thread_activity.messages_per_thread`
- `thread_activity.active_threads_per_day`
- `thread_activity.runs_per_thread`

### 10. Duration
- `duration.median_ms`
- `duration.p95_ms`
- 最低限、run duration を対象に集計する。
- 必要なら provider 別 operation duration を派生指標として持ってよい。

### 11. Figma Fidelity Distribution
- `figma_fidelity_distribution.by_status`
- `figma_fidelity_distribution.score_bands`
  - 例: `<80`, `80-94.99`, `>=95`
- これは Phase3 で最低限参照してよい補助指標だが、詳細な score explanation / reason taxonomy / corrective diagnosis は Phase4 の責務とする。

## Anomaly Detection (Required)
- `anomalies.items[]` を observability API / UI の固定出力に含める。
- severity は最低限 `warning` / `alert` を持つ。
- summary は件数・比率・連続回数のみを簡潔に述べ、原因解釈を盛り込まない。

### 1. Failed Ratio Surge
- 目的: `failed` 比率の急増を即座に検知する。
- 比較方式:
  - 直近 window と、その直前の baseline window を比較する。
- 閾値:
  - `warning`: recent failed rate `>= 30%` かつ baseline 比 `+20pt` 以上
  - `alert`: recent failed rate `>= 50%` かつ baseline 比 `+30pt` 以上

### 2. Fidelity < 95 Streak
- 目的: `fidelity score < 95` が連続している状態を検知する。
- 閾値:
  - `warning`: 直近 2 run 連続
  - `alert`: 直近 3 run 連続
- Phase3 では score の連続低下のみを扱い、reason taxonomy 深掘りは Phase4 に委譲する。

### 3. Confirm-After Failure Rate Spike
- 目的: confirm 実行後の run failure 増加を検知する。
- 対象:
  - `confirm.executed` を持つ run のみ
- 比較方式:
  - 直近 window と、その直前の baseline window を比較する。
- 閾値:
  - `warning`: recent failed rate `>= 25%` かつ baseline 比 `+15pt` 以上
  - `alert`: recent failed rate `>= 40%` かつ baseline 比 `+25pt` 以上

## Responsibility Boundary
1. Phase3 observability の主軸は Workspace 運用指標である。
2. `figma fidelity distribution` は参照指標として持ってよいが、詳細分析の正本は Phase4 に置く。
3. Phase3 で扱うのは「どこで失敗/停滞/再試行が起きているか」の可視化であり、「なぜ fidelity が崩れたか」の深掘りは Phase4 に委譲する。

## Normalization Rules
1. status は運用表示用に正規化してよい。
   - `succeeded` / `completed` → `ok`
2. confirm rate は write 実行可否ではなく confirm 完了率として定義する。
3. skipped は failed と混ぜず独立の指標として扱う。
4. duration の percentile は同一期間・同一母集団に対して算出する。
5. summary 文は件数・状態・比率のみを扱い、理由の解釈を盛り込まない。
6. anomaly threshold はハードコードの散在を避け、SoT と config の双方で管理する。
7. observability / export に含める文字列は secret-like 値、`confirm_token`、`confirm_token_hash`、`secret_id` 解決値、生 credential を含めてはならない。
8. `failure_code_distribution` や actor 集計で secret-like 値が混入した場合は `[redacted]` へ正規化してから集計する。

## Out of Scope
- Phase4 の reason taxonomy 深掘り
- 4軸 fidelity score の詳細診断
- before / after 差分の詳細比較 UI
- multi-AI routing の observability

## References
- Phase boundary SoT: `docs/ai/core/workflow.md`
- Search model SoT: `docs/ai/core/search-model.md`
- History model SoT: `docs/ai/core/history-model.md`
- Phase4 fidelity model SoT: `docs/ai/core/fidelity-model.md`
- Phase4 reason taxonomy SoT: `docs/ai/core/fidelity-reasons.md`
