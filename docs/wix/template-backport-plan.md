# Template Backport Plan

## 目的
- `docs/wix/template-backport-review.md` の A/B 分類をもとに、テンプレ向けに戻す内容を汎用化する
- この段階ではテンプレ用リポジトリへ直接反映せず、戻す前提の整理だけを行う

## A分類の扱い
- `A` はそのまま戻せる前提で確認した
- 追加の書き換えは行わず、テンプレ側へ戻す候補として維持する

## B分類の汎用化方針

| ファイル | 今回の扱い | 消したもの / 一般化したもの |
| --- | --- | --- |
| `.gitignore` | 汎用化済み | `.wix/` を「local Wix workspace artifacts」として扱い、案件固有の ignore ではない形にした |
| `package.json` | 差分のみ backport 対象 | `name` など repo 固有情報は対象外とし、`wix:help` と `wix:version` の補助 script だけを戻す前提に整理した |
| `prototype/minimum-page/index.html` | 汎用化済み | 固有案件文脈を避け、`外部 AI 制作物` を `外部制作物` に整理し、文言をテンプレ向けの中立表現へ寄せた |
| `prototype/minimum-page/styles.css` | 汎用化済み | 案件依存のスタイル説明は持たせず、最小検証原型として再利用できる汎用スタイルのまま整理した |

## A分類の対象
- `docs/wix/README.md`
- `docs/wix/editability-checklist.md`
- `docs/wix/go-no-go.md`
- `docs/wix/import-runbook.md`
- `docs/wix/minimum-validation-spec.md`
- `docs/wix/role-boundary.md`
- `docs/manuals/startup-manual-scope.md`
- `docs/manuals/wix-startup-manual.md`
- `docs/manuals/wix-startup-checklist.md`
- `docs/manuals/wix-glossary.md`
- `docs/manuals/who-does-what.md`
- `docs/manuals/troubleshooting-for-nonengineers.md`
- `docs/manuals/index.md`

## B分類の対象
- `.gitignore`
- `package.json`
- `prototype/minimum-page/index.html`
- `prototype/minimum-page/styles.css`

## テンプレへ戻すときの注意
- `package.json` はファイル全体を置き換えず、Wix 補助 script の差分だけを反映する
- `prototype/minimum-page/` は「案件固有の見本」ではなく「最小検証用の共通見本」として扱う
- `C` 分類はテンプレ側へ混ぜない
