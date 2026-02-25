---
description: "コマンドの概要を1行で記載"
arguments:
  - name: "arg1"
    description: "引数の説明"
    required: false
mode: "workspace-write"
output_language: "ja"
---

# Command Template

## Purpose
- このコマンドの目的を短く記載します。

## Output Language
- Japanese (default)

## References
- `@.github/PULL_REQUEST_TEMPLATE.md`
- `@docs/ai/README.md`

## Notes
- 章立てだけ先に定義し、詳細手順は必要時に追記します。
- commands は目的/引数/参照/フローのみを記述します。
- 詳細は `@docs/ai/implementation-guides` または `@agents/skills` に分離します。
- 目安として 200 行を超えたら分割します。
