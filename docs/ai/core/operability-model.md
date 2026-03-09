# Phase3 Workspace Operability Model (SoT)

## Purpose
- Phase3 の `operability` で許可する運用操作の範囲を先に固定し、UI / API / 実装のブレを防ぐ。
- 安全な再試行・再読込・エクスポートの範囲を明示し、危険操作・Phase2 境界超過操作は明確に対象外とする。

## Scope
- 対象: Workspace operator が日々の運用の中で **人手で開始する** 軽量な運用操作。
- 前提: operability 操作は **read-only / 再参照 / 補助出力** を基本とし、Phase2 の write 操作を単独で起動しない。

---

## Permitted Operations (Required)

### 1. Retry Read-Only Operation
- 操作: 失敗した外部 read 操作（GitHub fetch / Figma fetch）を再実行する。
- 条件:
  - 直前の run の `external_operation.result.status` が `failed` であること。
  - 操作対象の `operation_type` が read 系（`github.read`, `figma.read` 相当）であること。
- 禁止: write / confirm_required を伴う操作の単独再実行は Phase2 の controlled write フローに委ねる。
- 副作用: 読取結果のみ更新し、Figma / GitHub への書き戻しは行わない。

### 2. Retry Failed Run
- 操作: `failed` または `skipped` の run を再実行キューに投入する。
- 条件:
  - run の最終 status が `failed` または `skipped` であること。
  - 再実行は新しい run_id で作成し、元の run を上書きしない。
- 禁止: `ok` / `running` / `queued` 状態の run への強制再実行は対象外。
- 副作用: 再実行 run は通常の run フロー（read → validation → controlled write → run/workspace integration）に従う。

### 3. Reopen Thread View
- 操作: thread の表示を最新状態に再読込し、履歴の最新 event を反映させる。
- 条件: 特に制限なし（いつでも実行可能）。
- 副作用: サーバーへの副作用なし（UI 側の fetch 再実行のみ）。

### 4. Refresh Metrics
- 操作: workspace metrics（`/api/metrics/workspace`）を再取得し、observability ダッシュボードを最新状態に更新する。
- 条件: 特に制限なし（いつでも実行可能）。
- 副作用: サーバーへの副作用なし（read-only API 呼び出しのみ）。

### 5. Export Audit / Search Result
- 操作: audit log または workspace search の結果を CSV / JSON 形式でダウンロードする。
- 条件:
  - エクスポート対象は既に API から取得済みのデータのみ。
  - 新規の外部操作を伴わない。
- 秘匿制約:
  - `confirm_token`, `confirm_token_hash`, `secret_id` 解決値、生 credential は export に含めない。
  - `failure_code` / `reason` に secret-like 値が含まれる場合は `[redacted]` に正規化する。
- 副作用: サーバーへの副作用なし（クライアント側でのファイル生成のみ）。

---

## Out of Scope (Explicit Exclusions)

### 危険操作（完全対象外）
- Run / Thread / Project の削除・アーカイブ・一括消去。
- audit_logs / external_operations の改ざん・削除。
- DB 直接操作・migration 手動実行。

### Phase2 境界超過操作（対象外）
- confirm を伴う write 操作の単独起動（Phase2 controlled write フロー外での GitHub/Figma 書き込み）。
- Figma デザインの直接更新（Phase2 の `FG-W-*` フロー外でのノード書き込み）。
- GitHub への直接コミット・PR 作成（Phase2 の controlled write フロー外での操作）。

### 自動化・拡張（対象外）
- 人間の承認を挟まない end-to-end 自動再試行ループ。
- 複数 run の一括強制再実行（scheduling / batch retry）。
- Phase3 operability 範囲外の新機能追加（multi-AI routing 等）。

---

## Safety Constraints

1. **冪等性**: Retry 操作は新しい run_id を発行し、元の run レコードを変更しない。
2. **read-only 優先**: Refresh / Export / Reopen は副作用なし。
3. **境界確認**: write 系操作が必要な場合は Phase2 フロー（run → confirm → execute）に委譲し、operability 操作で迂回しない。
4. **監査可視性**: Retry Failed Run の再実行も通常の audit_log に記録する。

---

## Responsibility Boundary
1. Phase3 operability は「運用を安全に続けるための補助操作」に限定する。
2. 「なぜ失敗したか」の原因分析は observability の責務とし、operability は「再試行できるか」の判断に集中する。
3. Phase4 の fidelity hardening 操作（corrective write plan の生成・適用）は Phase4 の責務とし、Phase3 operability に含めない。

---

## References
- Phase boundary SoT: `docs/ai/core/workflow.md`
- Search model SoT: `docs/ai/core/search-model.md`
- History model SoT: `docs/ai/core/history-model.md`
- Observability model SoT: `docs/ai/core/observability-model.md`
- Phase4 fidelity model SoT: `docs/ai/core/fidelity-model.md`
