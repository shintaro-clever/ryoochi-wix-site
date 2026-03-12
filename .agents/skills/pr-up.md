# name: pr-up
# description: PRをテンプレ準拠で作成/更新する（pr-up.jsを実行）

実行:
- `node scripts/pr-up.js`

補足:
- GitHub 反映は git credential store のトークンを正として push / PR 更新まで行う。
- PR 更新は GitHub REST API を使い、本文ファイルの内容をそのまま反映する。
