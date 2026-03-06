# CLAUDE.md

このリポジトリで Claude Code を使う場合、運用ルールの SoT は `AGENTS.md` と `agents/*` に置く。
このファイルは Claude 向けの入口のみを定義し、詳細手順は SoT 参照に統一する。

## Priority

1. `AGENTS.md`
2. `agents/contracts/response-language.md`
3. `agents/rules/*`
4. `agents/commands/*`
5. `agents/skills/*`

## Absolute Rules

- `main` / `master` で作業しない。必ず feature ブランチで作業する。
- `--dangerously-bypass-approvals-and-sandbox` を使わない。
- `--sandbox=danger-full-access` を使わない。
- 破壊的コマンド（例: `rm -rf`）を安易に実行しない。
- `.env` / `auth.json` の中身を出力しない。
- シークレット（API キー・トークン）を出力しない。
- `/tmp/pr.md` を手動編集しない。
- `.github/PULL_REQUEST_TEMPLATE.md` のプレースホルダー文字列を変更しない。

## Branch / PR Workflow

- ブランチ名は `issue-<number>-<slug>`。
- 「PR あげてください」系の完了処理は必ず `node scripts/pr-up.js` を実行する。
- `pr-up.js` 失敗時は `AGENTS.md` の Failure Reporting Rules に従う。

## Language

- 返答本文は日本語を使う（英語明示指示がある場合のみ英語可）。
- コード/ログ/機械可読出力は原文のままでよい。
