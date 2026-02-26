---
name: pr-workflow
description: /api/runs のPR作成運用（mainに無い場合は実装、main以外にある場合は差分取り込み）。PR時は `node scripts/pr-up.js` を必ずescalatedで実行し、PR後にローカルを最新化する。
---

# PR Workflow

## Purpose
`/api/runs` のPR作成運用を固定する。

## Inputs
- `/api/runs` の有無確認結果
- 作業ブランチ名
- PR作成の依頼
- PRマージ完了の報告

## Outputs
- `/api/runs` のPR作成済み
- PR後のローカル最新化完了

## Steps
1. `main` に `/api/runs` が無い場合:
   `/api/runs` を実装するPRを作る。
2. `main` 以外のブランチに `/api/runs` がある場合:
   その差分を `main` に取り込むPRを作る。
3. 作業ブランチ上であることを確認する（`main`/`master`禁止）。
4. `node scripts/pr-up.js` を **escalated** で実行する。
5. 出力された手順に従ってPR作成まで完了させる。
6. PRマージ完了後、ローカルを最新化する。
7. ローカル最新化の手順:
   `git checkout main`
   `git pull --ff-only origin main`
   `git branch -d <working-branch>`

## Constraints
- `node scripts/pr-up.js` は毎回escalatedで実行する。
- `/tmp/pr.md` を手動編集しない。

## DoD
- PR作成完了
- PR後のローカル最新化完了

## Failure
- 失敗時は失敗コマンドとstderr末尾をそのまま報告する。
