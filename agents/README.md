# agents/

AI運用の実体（SoT）を置くディレクトリです。
境界契約は `agents/contracts/sot.md` を参照してください。

- `rules/`: 絶対ルール
- `commands/`: frontmatter付きコマンド定義
- `skills/`: 実行物 + README

`commands` は目的/引数/参照/フローのみを保持します。詳細は `docs/ai/implementation-guides` または `agents/skills` に分離し、目安として 200 行を超えたら分割します。
