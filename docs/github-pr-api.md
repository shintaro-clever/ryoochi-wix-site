# GitHub PR API (Minimal)

## Endpoint
- `POST /api/github/pr`

## Request (minimal)
```json
{
  "run_id": "<optional-run-id>",
  "owner": "org-or-user",
  "repo": "repo-name",
  "title": "PR title",
  "body": "optional body",
  "base_branch": "main",
  "head_branch": "hub/feature-123",
  "github_token": "<required when dry_run=false>",
  "dry_run": true
}
```

## Behavior
- `dry_run=true`: branch/push/PR は実行せず、計画のみ返す。
- `dry_run=false`: GitHub API で `branch create -> commit push -> PR create` を実行する。
- ネットワーク不可時は `503` + `failure_code=service_unavailable` を返す。

## Traceability
- `run_id` 指定かつ PR 作成成功時、`runs.github_pr_url` と `runs.github_pr_number` を更新する。
