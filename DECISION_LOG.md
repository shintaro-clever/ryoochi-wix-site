# DECISION_LOG — template-wix-test

## 2026-04-10: 共通ファイルを _shared/ からのシンボリックリンクに切り替え

### 何を判断したか
scripts/（check-structure.js, check-sot-dup.js, pr-up.js, pr-body-verify.js）、agents/rules/（6ファイル）、workflows/agents-structure.yml、AI_DEV_POLICY.md を `/srv/_shared/` へのシンボリックリンクに差し替えた。

### なぜその判断をしたか
- 他リポジトリと完全に同一のファイルがコピーとして存在していた
- 共通ルールの変更時に各リポジトリへの反映が漏れるリスクがあった

### 却下した選択肢
- **コピーのまま運用**: 同期漏れのリスク
- **git submodule**: 更新忘れ・コンフリクトのリスク

### 影響
- npm test（check:structure + check:sot-dup）に影響なし
- pr-up.js が figma-ai-github-workflow 版に統一された

---

## 2026-04-10: AGENTS.md に共通ルール参照宣言を追加

### 何を判断したか
AGENTS.md の先頭に `/srv/ai-rules/AGENTS.common.md` への参照宣言を追加した。

### なぜその判断をしたか
- template-wix-test だけ共通ルール参照が一切なく、他3リポジトリと不統一だった
- ai-rules/ が共通ルールの定義元として確立されたため、参照を追加した

### 却下した選択肢
- **参照なしのまま放置**: AI が共通ルールを参照できない状態が続く

### 影響
- AI が作業開始時に共通ルールを自動参照するようになった
