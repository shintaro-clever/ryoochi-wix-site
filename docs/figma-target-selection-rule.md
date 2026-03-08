# Figma Target Selection Rule (FG-R-03)

## Scope
- 対象: Figma Read（`/api/figma/read`）と Run/Workspace の `connection_context.figma` 生成。
- 目的: page/frame/node と writable scope の優先順位を固定し、対象誤認のまま write に進まない。

## Priority (Target)
1. Run override
   - `figma_page_scope` / `figma_frame_scope` / `figma_node_ids`
   - `/api/figma/read` では `page_id|page_name`, `frame_id|frame_name`, `node_id|node_ids`
2. Project default
   - `figma_page_scope` / `figma_frame_scope`（Project Settings）
3. 未指定

## Priority (Writable Scope)
1. Run override: `figma_writable_scope`
2. Project default: `figma_writable_scope`
3. 未指定（`read_only` として扱う）

## Ambiguous Target Handling
- 次は `validation_error` で拒否する。
  - `page_id` と `page_name` の同時指定
  - `frame_id` と `frame_name` の同時指定
  - `node_id` と `node_ids` の同時指定
  - `frame_name` のみ指定（`page` 未指定）
  - `figma_frame_scope` だけ指定（`figma_page_scope` 未指定）

## Writable Scope Definition
- `read_only`: 書込不可。confirm 必須。
- `file`: ファイル全体への書込許可。
- `page`: 対象 page 解決済み時のみ書込候補。
- `frame`: 対象 frame 解決済み時のみ書込候補。
- `node`: 対象 node 解決済み時のみ書込候補。
- 不明な scope は confirm 必須。

## Write Guard (Run/Chat)
- `connection_context.figma.write_guard` を必須で保持する。
  - `writable_scope`
  - `requires_confirmation`（true/false）
  - `reason`（不足ターゲットや不明scopeの理由）
- `requires_confirmation=true` の場合、write は即実行せず、confirm 要求または中断する。

## Normalized Shape
- Run / chat 参照形:
  - `inputs.connection_context.figma`
  - `context_used.connection_context.figma`
- 主要フィールド:
  - `target` (`page_id`, `frame_id`, `node_ids`)
  - `target_selection_source` (`page`, `frame`, `nodes`, `writable_scope`)
  - `writable_scope`
  - `write_guard`
