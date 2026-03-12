# Template Backport Review

## 目的
- `ryoochi-wix-site` で行った Wix Studio 最小検証の成果物を棚卸しし、テンプレ用リポジトリへ戻す対象を整理する
- テンプレ用リポジトリを次案件でも再利用できる標準土台として保つ
- この段階では整理のみを行い、まだテンプレ側へは反映しない

## 分類ルール
- `A`: そのまま戻せる
- `B`: 一般化すれば戻せる
- `C`: 戻さない

## 棚卸し結果

| ファイル | 分類 | 理由 |
| --- | --- | --- |
| `docs/wix/README.md` | A | Wix 関連文書の置き場と役割を示す汎用説明で、案件固有名詞への依存が薄い |
| `docs/wix/editability-checklist.md` | A | 最小検証後の編集性確認観点として汎用利用できる |
| `docs/wix/go-no-go.md` | A | 最小検証後の判定基準として次案件でも再利用しやすい |
| `docs/wix/import-runbook.md` | A | 静的原型から Wix Studio へ持ち込む作業の骨子として汎用化済み |
| `docs/wix/minimum-validation-spec.md` | A | 本番全体へ行かず最小単位で検証する方針はテンプレ向き |
| `docs/wix/role-boundary.md` | A | AI / repo / Wix Studio の責務整理は案件横断で使える |
| `docs/manuals/startup-manual-scope.md` | A | 非エンジニア向け立ち上げ文書の位置づけとして汎用利用できる |
| `docs/manuals/wix-startup-manual.md` | A | 専門用語を避けた開始手順として次案件でも使い回しやすい |
| `docs/manuals/wix-startup-checklist.md` | A | 開始時の抜け漏れ防止チェックとして汎用利用できる |
| `docs/manuals/wix-glossary.md` | A | この運用で頻出する用語の簡易説明として再利用しやすい |
| `docs/manuals/who-does-what.md` | A | 非エンジニア向けの役割分担表として案件横断で使える |
| `docs/manuals/troubleshooting-for-nonengineers.md` | A | 危険な自己判断を避けるための初動整理として汎用利用できる |
| `docs/manuals/index.md` | A | 非エンジニア向け資料への索引として汎用利用できる |
| `.gitignore` | B | `.wix/` の ignore 自体は戻せるが、他案件の運用方針と衝突しないか確認が必要 |
| `package.json` | B | `wix:help` と `wix:version` は汎用だが、テンプレ側の script 方針に合わせて要調整 |
| `prototype/minimum-page/index.html` | B | 最小静的原型は有用だが、文言や構成はテンプレ向けの中立表現に追加一般化したい |
| `prototype/minimum-page/styles.css` | B | 原型用スタイルとして戻せるが、テンプレ共通の見本として扱う前提に整理したい |
| `docs/wix/connection-plan.md` | C | `ryoochi-wix-site` 前提の接続経緯と現状判断を含み、案件固有メモの性格が強い |
| `docs/wix/artifact-index.md` | C | この案件で作成した成果物の索引であり、テンプレ戻しの対象そのものではない |
| `docs/wix/template-backport-review.md` | C | この案件の仕分け結果を残すための文書で、テンプレには不要 |
| `README.md` | C | `ryoochi-wix-site` 固有の説明、導線、案件文脈を含むため、そのまま戻さない |

## 判定メモ
- `A` は標準土台に置いても案件固有情報の逆流が起きにくいもの
- `B` は価値はあるが、そのまま戻すとテンプレ側の文脈不足や運用差分が出やすいもの
- `C` は案件固有名詞、案件内の成果物索引、今回限りの整理メモを含むため戻さない

## 次段階で見ること
- `A` のみを先に候補として抽出する
- `B` はテンプレ向けの中立表現へ直してから再判定する
- `C` は `ryoochi-wix-site` 側に残し、テンプレへ混ぜない
