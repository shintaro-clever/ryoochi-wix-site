# Fidelity Hardening Operations Runbook (P4-OPSX-01)

## Purpose
- `localhost / staging / production` の三者比較を固定手順で実施し、Fidelity Hardening の一致確認を運用で再現可能にする。
- 比較時の期待値、失敗時の切り分け、ロールバック観点を一本化する。

## Scope
- Phase4 Fidelity Hardening の確認手順。
- 対象: capture, structure diff, visual diff, behavior diff, execution diff, final scoring, controlled write 後の再検証。
- 対象外: 完全自動復旧、confirm を省略した外部書込、無関係な UX 改修。

## Preconditions
1. 対象ブランチが `main` / `master` ではないことを確認する。
2. `localhost`, `staging`, `production` の URL と `target_environment` を Run 入力で確定する。
3. 比較条件を固定する。
   - viewport
   - theme
   - auth_state
   - fixture_data
4. VPS 反映確認が必要な場合は先に `bin/vps 'echo connected'` を実行する。
5. 外部操作を含む場合は `docs/runbooks/vps-external-operations-checklist.md` を併用する。

## Standard Comparison Flow

### 1. localhost baseline check
1. `localhost` で対象画面が起動し、比較対象 path / page / frame / node が解決できることを確認する。
2. capture を実行し、artifact path が `.ai-runs/` 配下に保存されることを確認する。
3. `structure_diff`, `visual_diff`, `behavior_diff`, `execution_diff` がすべて生成されることを確認する。

期待値:
- `failure_code = null`
- `context_used.fidelity_environment` が保存されている
- `inputs.fidelity_evidence` または `context_used.fidelity_evidence` が存在する

### 2. staging comparison
1. `target_environment=staging` で Run を作成する。
2. `compare_environments` に `localhost`, `staging`, `production` が含まれていることを確認する。
3. staging capture と diff を実行する。
4. `execution_diff.environment_only_mismatch` の有無を確認する。

期待値:
- `structure_diff.structural_reproduction.rate >= 0.95`
- `visual_diff.score >= 95`
- `behavior_diff.score >= 95`
- `execution_diff.score >= 95` または `status=passed_with_environment_mismatch`

### 3. production comparison
1. `production` の URL, auth_state, fixture_data が比較に適した値かを確認する。
2. production capture と diff を実行する。
3. staging と production の差分理由が `fidelity_reasons` に正規化されていることを確認する。

期待値:
- `phase4_score.final_score >= 95`
- `phase4_score.status` が `passed` または `passed_with_environment_mismatch`
- `fidelity_reasons.counts.total > 0` の場合は `reason_type` が分類済みである

### 4. controlled write after-check
1. corrective action または write plan 実行後に再度 capture / diff を実行する。
2. write 前後で `fidelity_evidence.updated_at` が更新されていることを確認する。
3. 改善前後で score が悪化していないことを確認する。

期待値:
- `final_score` が改善または維持される
- 95点未満率が悪化しない
- `environment_only_mismatch` 以外の失敗が増えていない

## Expected Outputs
- `inputs.fidelity_environment`
- `context_used.fidelity_environment`
- `inputs.fidelity_reasons`
- `context_used.fidelity_reasons`
- `inputs.fidelity_evidence`
- `context_used.fidelity_evidence`
- `phase4_score.final_score`
- Dashboard の `平均総合スコア`, `95点未満率`, `差分理由上位`, `環境別失敗率`, `コンポーネント別失敗率`

## Failure Triage

### A. localhost だけ失敗する
- dev server 未起動
- fixture_data 不一致
- auth_state 不一致
- viewport / theme の固定漏れ

確認点:
- `localhost` URL
- local seed data
- browser / font fallback

### B. staging だけ失敗する
- staging deploy 未反映
- feature flag 差異
- staging auth / dataset 差異

確認点:
- deploy revision
- shared environment 設定
- network / runtime status

### C. production だけ失敗する
- 本番 drift
- Figma SoT 更新漏れ
- GitHub code drift
- 本番だけの browser / CDN / font 差異

確認点:
- `execution_diff.mismatch_fields`
- `fidelity_reasons.counts.by_type`
- production only feature flags

### D. environment_only_mismatch が多い
- viewport, theme, data_state, browser, font fallback の比較条件が揃っていない可能性が高い。

優先アクション:
1. `fidelity_environment.conditions` を見直す。
2. 実行ブラウザを固定する。
3. fixture seed / auth state を揃える。

### E. component failure rate が高い
- 同一 component 名に失敗が集中している。

優先アクション:
1. component mapping / variant / slot 差分を確認する。
2. corrective action plan の `component_swap` または `layout_fix` を優先する。
3. 再検証後に dashboard の component failure rate を比較する。

## Rollback Viewpoints
1. GitHub write を行った場合:
   - feature branch 上の commit を revert する
   - default branch へ直接 push されていないことを再確認する
2. Figma write を行った場合:
   - 対象 page/frame/node を特定する
   - before/after evidence を参照して手動復旧または再適用を判断する
3. staging / production deploy 後に悪化した場合:
   - 直前 deploy revision へ rollback 可否を確認する
   - rollback 後に同条件で再 capture する

## Evidence to Record
- `run_id`
- `project_id`
- 比較対象 URL (`localhost`, `staging`, `production`)
- viewport / theme / auth_state / fixture_data
- `final_score` と各 axis score
- top reason types
- environment failure rate 変化
- component failure rate 上位
- rollback 判断と実施内容

## References
- Environment SoT: `docs/operations/fidelity-environments.md`
- VPS external ops: `docs/runbooks/vps-external-operations-checklist.md`
- Fidelity model: `docs/ai/core/fidelity-model.md`
