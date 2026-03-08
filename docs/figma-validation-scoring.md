# Figma Validation Scoring (FG-VAL-01)

## Purpose
- Figma再現度評価を定量化し、`FG-VAL-*` の判定を一貫させる。

## Gate Before Scoring
- 評価対象 Run は `connection_context.figma.status = "ok"` を必須とする。
- `status = "skipped"` は「未評価」扱い（採点しない）。
- `status = "error"` は「失敗」扱い（採点しない）。

## Axes and Weights (Total 100)
- `対象一致`: 30点
  - page/frame/node が意図した対象と一致しているか。
- `構造再現`: 30点
  - 親子関係、component/instance、auto layout 構造の再現度。
- `視覚再現`: 30点
  - spacing/sizing、主要テキスト、レイアウト外観の再現度。
- `安全性`: 10点
  - writable scope 整合、対象誤認防止、危険な更新回避。

## Pass Criteria
- 合計 100点中 `95点以上` を合格とする。

## Hard Fail (Cutoff)
- 次のいずれかを満たす場合は合計点に関わらず失格。
  - `対象一致 < 100%`（完全一致でない）
  - `安全性 < 95`

## Output Shape (Minimum)
- `fg_validation` の最小出力:
  - `status`: `ok | skipped | error | failed`
  - `score_total`: number (0-100)
  - `axes`:
    - `target_match` (0-30, plus `match_rate`)
    - `structural_fidelity` (0-30)
    - `visual_fidelity` (0-30)
    - `safety` (0-10, plus `safety_rate`)
  - `passed`: boolean
  - `hard_fail_reasons`: string[]

## FG-VAL-02 Structural Diff Coverage
- 構造差分検証では最低限次を比較対象にする。
  - page/frame/node の対応（target 解決差分）
  - 親子関係（parent-child）
  - 主要 auto layout 情報
  - text content
  - 主要 component 使用状況（kind/key）
- 大きな構造差分（target mismatch / parent mismatch / node欠落など）は `major_diff_detected=true` として検出する。

## FG-VAL-03 Visual Fidelity Acceptance
- 視覚再現（`visual_fidelity`）は最低限次の一致度を評価対象にする。
  - 位置（position）
  - 余白（spacing / padding）
  - サイズ（width / height）
  - 文字（text / font / weight / line-height）
  - 色（fill / text / stroke）
  - 境界（border / radius）
  - 主要スタイル（effect / opacity / blend / component style token）

### Visual Pass Condition
- `visual_fidelity` は 30点満点の評価軸として、95%以上相当であることを必須とする。
- 運用判定としては「実務上の修正が最小限で済むレベル」を合格ラインとし、
  大きな人手修正（レイアウト全面修正、主要色/文字/境界の再調整が多数必要）を要する結果は不合格とする。

### Operational Rule
- `score_total >= 95` かつ hard fail 非該当でも、視覚再現の差分レビューで
  「人手修正が大きい」と判断される場合は `visual_fidelity_failed` として不合格にできる。

## FG-VAL-04 Before/After View (Minimum)
- Workspace または Run 画面から、Figma の before/after を追えることを必須とする。
- 最小表示項目:
  - 対象 page/frame/node（before と after）
  - 主要変更点
  - 構造差分サマリ
  - 視覚差分の要点
- UI は `run.figma_before_after` を参照し、未設定時は `-` 表示で欠損を明示する。
