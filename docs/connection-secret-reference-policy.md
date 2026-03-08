# Connection Secret Reference Policy (N2-CONN-02)

## Scope
- GitHub token / Figma token は Project Settings へ平文保存しない。
- Project Settings では `secret_id` のみを保持する。

## Project Settings Contract
- GitHub:
  - `github_repository`
  - `github_default_branch`
  - `github_installation_ref` (optional)
  - `github_secret_id` (token の参照ID)
  - `github_writable_scope`
- Figma:
  - `figma_file`
  - `figma_file_key`
  - `figma_secret_id` (token の参照ID)
  - `figma_page_scope`
  - `figma_frame_scope`
  - `figma_writable_scope`

## Secret Resolution Order
1. `*_secret_id` が設定されていればそれを使用する。
2. 未設定の場合のみ環境変数を使用する。
   - GitHub: `GITHUB_TOKEN`
   - Figma: `FIGMA_TOKEN`

## Validation Rule
- `github_repository` が設定されているのに `github_secret_id` も `GITHUB_TOKEN` も無い場合は `validation_error`。
- `figma_file` または `figma_file_key` が設定されているのに `figma_secret_id` も `FIGMA_TOKEN` も無い場合は `validation_error`。

## Response / Snapshot Safety
- API レスポンスに token 本体を含めない。
- Run snapshot (`inputs.shared_environment`, `context_used.shared_environment`) には secret の実値を含めない。
- `secret_id` のみを含める。
