# figma-ai-github-workflow

Integration Hub で **プロジェクト（リポジトリ）を量産**するときに使う  
**標準テンプレート（運用レール / ガードレール / SoT）**です。

このリポジトリは、各プロジェクトで **Figma × AI × GitHub** を「壊れない運用」で回すための
**共通ルールとCIゲート**を提供します。

---

## 何が入っているか（このテンプレが配布するもの）
- Issue Form Template（AI Bootstrap）
- PR Template
- PR Gate（GitHub Actions）
- 運用SoT（workflow / decision policy / Phase2-min specs などの docs）

---

## 目的（Goal）
- Issue → PR → Decision を短時間でトレース可能にする
- “会話で決めたが消える” を防ぐ（意思決定は GitHub に残す）
- テンプレ＋CIでリンク欠落・ルール逸脱を物理的に防止する

---

## Canonical Workflow（正規ルート）
1. Issue作成（AI Bootstrapフォーム）
2. ブランチ作成（例: `issue-<number>-<slug>`）
3. 実装 → コミット
4. PR作成（PRテンプレ使用）
5. PR Gate が緑 → Merge
6. Decision（必要なら Issue コメントに残す）

---

## Rules（必須）
### Issue（案件のSoT）
- Figma URL / Default AI / AI thread URL(s) / Acceptance Criteria を必須入力

### PR（実装単位）
- `Fixes #<issue>` 必須
- AC（チェック済み）が最低1つ必須（PR Gateで検証）

---

## Included
- Issue Form Template: `.github/ISSUE_TEMPLATE/ai-bootstrap.yml`
- PR Template: `.github/PULL_REQUEST_TEMPLATE.md`
- PR Gate (Actions): `.github/workflows/pr-gate.yml`
- Docs (SoT): `docs/`

---

## ⚠️ 注意（このテンプレが提供しないもの）
- Integration Hub 本体（RBAC/Audit/UI/APIなどのサービス実装）
- 各プロジェクト固有のプロダクト実装コード

---

## Next Steps（運用開始）
1. このテンプレから新規リポジトリを作成（GitHub Template機能）
2. 必要なら Branch protection で status check を required に設定
3. 以後は Issue → PR → Gate の正規ルート以外を使わない
