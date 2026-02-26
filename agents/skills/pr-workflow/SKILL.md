---
name: pr-workflow
description: PR作成時に `node scripts/pr-up.js` を必ずescalatedで実行し、PR後にローカルを最新化する運用手順。
---

# PR Workflow

## Purpose
PR作成時の必須フローを固定する。

## Inputs
- 作業ブランチ名
- PR作成の依頼
- PRマージ完了の報告

## Outputs
- PR作成済み
- PR後のローカル最新化完了

## Steps
1. 作業ブランチ上であることを確認する（`main`/`master`禁止）。
2. `node scripts/pr-up.js` を **escalated** で実行する。
3. 出力された手順に従ってPR作成まで完了させる。
4. PRマージ完了後、ローカルを最新化する。
5. ローカル最新化の手順:
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
