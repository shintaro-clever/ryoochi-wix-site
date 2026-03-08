# Figma Read Context Contract (FG-R-01 / FG-R-02)

## Purpose
- Figma再現度検証（95%以上）の前提として、read 段階で不足なく情報を取得するための最小契約を固定する。
- 対象: `FG-R-01`（Figma読取） / `FG-R-02`（Connection Context統合）。

## Required Resolution
- `page` 解決: 対象 page の id/name。
- `frame` 解決: 対象 frame の id/name。
- `nodes` 解決: 解析対象 node id の配列（空配列不可）。

## Required Node Coverage
- 親子関係: 各 node に `id`, `type`, `parent_id`（root は `null`）を保持する。
- text content: `TEXT` ノードの文字列を保持する（空文字は許容、未取得は不可）。
- component/instance 概要:
  - `COMPONENT` / `COMPONENT_SET`: component key/name。
  - `INSTANCE`: 参照先 component key/id、variant 情報（取得可能範囲）。
- auto layout 主要情報:
  - `layoutMode`, `primaryAxisSizingMode`, `counterAxisSizingMode`
  - `primaryAxisAlignItems`, `counterAxisAlignItems`
  - `layoutWrap`, `layoutPositioning`
- sizing/spacing 主要情報:
  - `absoluteBoundingBox` または width/height の同等情報
  - `minWidth`, `maxWidth`, `minHeight`, `maxHeight`（存在する場合）
  - `paddingLeft`, `paddingRight`, `paddingTop`, `paddingBottom`
  - `itemSpacing`, `counterAxisSpacing`
  - `constraints` / resizing 関連情報

## Normalized Shape (Connection Context)
- Run / chat で参照する正規化 shape は次を最低限満たす。

```json
{
  "figma": {
    "provider": "figma",
    "status": "ok",
    "target": {
      "page_id": "string",
      "page_name": "string",
      "frame_id": "string",
      "frame_name": "string",
      "node_ids": ["string"]
    },
    "node_summaries": [
      {
        "id": "string",
        "type": "string",
        "name": "string",
        "parent_id": "string|null",
        "text": "string|null",
        "component": {
          "kind": "component|component_set|instance|none",
          "key": "string|null",
          "ref_id": "string|null",
          "variant": "object|null"
        },
        "layout": {
          "layout_mode": "string|null",
          "primary_axis_sizing_mode": "string|null",
          "counter_axis_sizing_mode": "string|null",
          "primary_axis_align_items": "string|null",
          "counter_axis_align_items": "string|null",
          "layout_wrap": "string|null",
          "layout_positioning": "string|null"
        },
        "sizing_spacing": {
          "width": "number|null",
          "height": "number|null",
          "min_width": "number|null",
          "max_width": "number|null",
          "min_height": "number|null",
          "max_height": "number|null",
          "padding": {
            "left": "number|null",
            "right": "number|null",
            "top": "number|null",
            "bottom": "number|null"
          },
          "item_spacing": "number|null",
          "counter_axis_spacing": "number|null",
          "constraints": "object|null"
        }
      }
    ],
    "layout_summary": {
      "node_count": "number",
      "text_node_count": "number",
      "component_node_count": "number",
      "instance_node_count": "number",
      "auto_layout_node_count": "number"
    }
  }
}
```

## FG-R-02 Minimal Run/Chat Shape
- 現フェーズの Run / chat では、上記詳細のうち最低限次を `connection_context.figma` に保持する。
  - `file_key`
  - `target.page_id` / `target.frame_id`
  - `target_selection_source`
  - `node_summaries`（構造把握に必要な最小情報）
  - `layout_summary`
  - `last_modified`
  - `writable_scope` / `write_guard`

## Gate Rule for FG-VAL-*
- 評価対象 Run では `connection_context.figma.status = "ok"` を必須とする。
- `status = "skipped"` は「未評価」として扱い、95%以上判定を実施しない。
- `status = "error"` は「失敗」として扱い、95%以上判定を実施しない。
- 95%以上判定は `status = "ok"` のときのみ実施する。
- 以下を 1 つでも満たさない場合、`FG-VAL-*` へ進めない。
  - `target.page_id` / `target.frame_id` / `target.node_ids` が解決済み
  - `node_summaries[].parent_id` で親子関係を辿れる
  - `TEXT` ノードの text が欠落していない
  - component / instance の概要が欠落していない
  - auto layout 主要情報が欠落していない
  - sizing / spacing 主要情報が欠落していない
- 失敗時は `validation_error` を返し、何が不足したかを `details.missing_fields` で列挙する。
