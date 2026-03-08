# VPS External Operations Checklist (OPSX-01)

## Purpose
- VPS反映後に、外部操作フェーズ（GitHub/Figma read/write）が安全に動作することを確認する。
- 対象: Workspace / chat orchestration / Run / external integrations。

## Preconditions
1. `bin/vps 'echo connected'` で接続確認する。
2. 接続失敗時は SSH 連打を止める（`fail2ban` BAN を疑って停止）。
3. 反映後に対象環境へアクセスできることを確認する。

## Required Verification Flow (Fixed Order)

### 1. Read-only verification
1. Workspace で read 対象を明示して chat 実行する。
2. Run で `external_read_plan.read_targets` が表示されることを確認する。
3. GitHub: `repository/branch/path` が追えること。
4. Figma: `file/page/frame/node` が追えること。

### 2. Dry-run / plan verification
1. Workspace の plan 作成導線で write plan を生成する。
2. `planned_action` と `confirm_required` が表示されることを確認する。
3. confirm 前に external write の actual result が `success` になっていないことを確認する。

### 3. Confirm execution verification
1. 明示 confirm を実行する。
2. Run の `planned_actions` が confirm 済みに更新されることを確認する。
3. Run の `external_operations` に actual result が追加されることを確認する。

### 4. GitHub write verification
1. default branch へ直接 push されていないことを確認する。
2. 作成された branch / commit（必要なら PR）を確認する。
3. Run / Workspace で `commit_sha`, `branch`, `pr_url` が追えることを確認する。

### 5. Figma write verification
1. 更新対象 page/frame/node が意図通りであることを確認する。
2. 変更後 Figma で対象ノード更新を確認する。
3. Run の `figma_before_after` が保存されていることを確認する。

### 6. Figma fidelity verification
1. Run の `fg_validation` を確認する。
2. 合格条件:
   - `target_match = 100%`
   - `safety >= 95`
   - `score_total >= 95`
3. いずれか未達の場合は不合格として運用投入を止める。

### 7. Failure handling (rollback / retry)
1. 失敗時は failure_code / reason を Run で確認する。
2. GitHub:
   - 不正 branch/commit は revert または無効化方針を決定して記録する。
3. Figma:
   - 不正更新は手動復旧 or 再適用（target再指定）方針を決定して記録する。
4. retry 時は曖昧対象を解消してから再実行する（confirm必須）。

## Evidence to Keep
- `run_id`, `project_id`, 実施者（user / ai setting）
- read target
- write plan / confirm evidence
- actual result（success/failed + artifacts）
- Figma fidelity result

## Secret Safety
- token/secret/password/api_key を Run や運用報告に記録しない。
- secret reference (`env://...`, `vault://...`) のみ記録する。
