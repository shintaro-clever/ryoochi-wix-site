# GitHub Target Selection Rule (GH-R-03)

## Scope
- 対象: GitHub Read (`/api/github/read`) と Run/Workspace の `connection_context.github` 生成。
- 目的: branch/path の選択順序を固定し、曖昧な指定で実行しない。

## Priority (Branch)
1. Run override: `github_ref`（または `/api/github/read` の `ref`）
2. Project default: `github_default_branch`
3. Repository default branch（GitHub API で解決）

## Priority (Path)
### Run / Workspace (`connection_context.github.file_paths`)
1. Run override: `github_file_paths`（配列）
2. Project default: `github_default_path`（単一path）
3. 未指定（空配列）

### `/api/github/read`
1. Run override: `file_path` または `tree_path`
2. Project default path は read API の path 解決には使わない（`target_selection.source.path` で `project_default` は示すが、明示指定を優先）

## Ambiguous / Invalid Target Handling
- `file_path` と `tree_path` の同時指定は拒否（`validation_error`）。
- 無効な `ref`（空白含む、`..`、不正文字）は拒否（`validation_error`）。
- 無効な path（`..`, `*`, `?` を含む）は拒否（`validation_error`）。

## Normalized Shape
- Run / chat で参照する正規化 shape:
  - `inputs.connection_context.github`
  - `context_used.connection_context.github`
- 主要フィールド:
  - `provider`, `status`
  - `branch`, `latest_commit_sha`
  - `file_paths`
  - `repository_metadata`
  - `selection_source` (`branch`, `path`)

## GH-W-01 Plan / Confirm Safety Check (Required)
- GitHub write フェーズ（GH-W-01）の plan 表示・confirm 表示では、次を必ず表示する。
  - read 対象 path（`connection_context.github.file_paths`）
  - write 対象 path（今回の書込候補）
  - 差分判定（`match` / `mismatch`）
- `mismatch` の場合は、そのまま書き込まない。
  - 原則: confirm で明示承認を要求するか、`validation_error` として中断する。
- これにより「読んだ path」と「書く path」の不一致による誤更新を防ぐ。
