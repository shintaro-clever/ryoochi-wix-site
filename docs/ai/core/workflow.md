# Canonical Workflow (Figma × AI × GitHub)

## Purpose
This document defines the single, canonical workflow for this org.
The goal is: PR → Issue → Figma → Decision must always be traceable.

## Canonical Flow
1. Create a GitHub Issue
   - Must include: Figma URL, AI thread URL, Acceptance Criteria
2. AI planning / design
   - Use the Issue as the input source of truth
   - Final decisions must be written back to the Issue (Decision section)
3. Update Figma
   - Frame naming: `[#<issue>] <screen>/<state>`
   - Frame description must include the Issue URL
4. Implement in GitHub via PR
   - PR body must include:
     - `Fixes #<issue_number>`
     - Figma URL
     - Acceptance Criteria checklist (checkboxes)
5. Review & Merge
   - Review comments remain in PR
   - Merge only when Acceptance Criteria are satisfied

## Non-negotiables
- No work starts without an Issue
- No merge without PR Gate passing
- No “decisions only in chat”
  - Every decision must be reflected in the Issue

## Artifacts (where things live)
- Requirements / Acceptance Criteria: GitHub Issue
- Decisions: GitHub Issue (Decision section)
- Design source: Figma (linked to Issue)
- Implementation source: GitHub PR / code
- Review history: GitHub PR
- Phase2 enforcement design (RBAC / Vault / Audit): `docs/ai/core/phase2-integration-hub.md`

## ARCH-00 Phase Boundary (SoT)

### Current Phase (In Scope)
- Personal AI Settings: 既定AIを **1件のみ** 使用する。
- Project Settings: GitHub / Figma / Drive をプロジェクト単位で共有する。
- Thread Run Composition: Thread 実行時は以下を合成して Run を起動する。
  - 個人AI設定（既定AI 1件）
  - プロジェクト共有環境（GitHub/Figma/Drive）
  - 会話履歴（Thread messages）

### Phase2 External Operations (In Scope)
- 対象は以下に限定する。
  - GitHub / Figma の**読取**（read-only fetch / inspect）
  - GitHub / Figma への**制御付き書込**（明示的条件と承認を満たした操作のみ）
  - Run への参照 / 操作記録（何を読んだか・何を書いたかの trace）
  - Workspace からの承認付き実行（human-in-the-loop）
  - Figma再現度検証（期待デザインとの差分確認）

### Phase2 Execution Order (Fixed SoT)
- Phase2 の外部操作は必ず次の順序で進める。
  1. `read`
  2. `validation`（ここに Figma再現度検証を含める）
  3. `controlled write`
  4. `run/workspace integration`（Run記録とWorkspace承認実行を統合）

### Figma Read Baseline (FG-R-01 / FG-R-02 必須)
- `FG-R-01` / `FG-R-02` では「取れるだけ取得」は採用しない。
- Figma再現度（95%以上）を validation で扱うため、read 段階で最低限以下を取得し、Connection Context へ正規化して渡すことを必須とする。
  - page / frame / node の解決結果（どの page・frame・node を対象にしたか）
  - 親子関係（node tree の parent-child）
  - text content（テキストノードの内容）
  - component / instance の概要（component key, instance 参照関係）
  - auto layout に必要な主要情報（layout mode, axis, alignment, wrap など）
  - sizing / spacing 系の主要情報（幅高・min/max・padding・item spacing・constraints/resizing）
- 上記のいずれかが欠ける場合、`FG-VAL-*` へ進めず `validation_error` として扱う。
- `FG-VAL-*` の判定前提:
  - `connection_context.figma.status = ok` の Run のみ評価対象
  - `skipped` は未評価、`error` は失敗として扱う
  - 95%以上判定は `ok` のときのみ実施する
- `FG-VAL-01` の採点基準:
  - 4軸（対象一致/構造再現/視覚再現/安全性）で合計100点
  - 合計95点以上で合格
  - 足切り: 対象一致が100%未満、または安全性が95未満なら失格
- 詳細 shape は `docs/figma-read-context-contract.md` を正とする。
- 対象解決・優先順位・writable scope は `docs/figma-target-selection-rule.md` を正とする。
- 評価軸・配点・足切りは `docs/figma-validation-scoring.md` を正とする。

### Phase2 Out of Scope
- 完全自動同期（human approval を挟まない end-to-end 自動反映）
- 複数AI役割設定（role/profile/persona 分岐、role別AI自動選択）

この境界を越える仕様追加は、次フェーズ文書へ分離して管理する。

### NEXT3-00 Next Phase Entry (SoT)
- Phase2 完了後の次フェーズ3は、Workspace の実運用強化（検索 / 履歴 / 可観測性 / 運用性改善）を対象とする。
- これはフェーズ3の入口定義であり、フェーズ2の完了条件には含めない。
- フェーズ3の着手順は次の順序に固定する。
  1. `search`（Run / external operations / audit を横断検索できる最小要件）
  2. `history`（時系列の追跡と差分参照を安定化）
  3. `observability`（失敗分類・遅延・再試行判断に必要な可視化）
  4. `operability`（運用導線・手順・権限境界の改善）
- フェーズ3の詳細タスクは backlog で管理し、本節は順序と境界のみを SoT とする。

### NEXT1-00 Deferred Track (SoT)
- 複数AI接続と役割設定（AI routing 高度化）は、次フェーズ1の後順位トラックとして維持する。
- 現フェーズ2（外部操作）および次フェーズ3（Workspace 実運用強化）では、責務分離を崩さない。
  - フェーズ2/3で multi-AI routing 実装へ拡張しない
  - 既定AI 1件前提の運用境界を維持する
- 本トラックの詳細は backlog (`backlog/next-phase-multi-ai-roles.md`) で管理する。

## PR Up（「PRあげてください」運用）

### 目的
ユーザー入力を「PRあげてください」に統一し、Codexが `node scripts/pr-up.js` を実行するだけで  
PR作成までの運用レール（自動完走 or フォールバック案内）に到達できる状態に固定する。

### pr-up.js が実行するステップ（標準フロー）
`node scripts/pr-up.js` は以下を順番に実行する。

1. ブランチガード：`main/master` 直上での実行を拒否（事故防止）
2. `npm test`
3. PR本文生成：`node scripts/gen-pr-body.js` → `/tmp/pr.md`
4. PR本文検証：`node scripts/pr-body-verify.js /tmp/pr.md`
5. `git push -u origin <branch>`
6. `curl -I https://api.github.com` によるAPI到達性判定
7. （到達可）`gh pr create/edit --body-file /tmp/pr.md` により PR 作成/更新  
   （到達不可）`cat /tmp/pr.md` を出力し、Web UI貼り付けで完了

### git push 失敗時のフォールバック（必ず案内して終了）
この環境は DNS 解決できない場合があるため、`git push` が失敗した場合は以後の処理に進まず、
以下を必ず案内して終了する。

- `/tmp/pr.md` は生成済み（`cat /tmp/pr.md` で取得可能）
- 次に実行すべきコマンド（例）：
  - `git push -u origin <branch>`（ネットワーク可環境で再実行）
  - 可能なら `node scripts/pr-up.js` をネットワーク可環境で再実行

### 2レーン運用（環境制約に合わせて停止しない）
- レーンA（ネットワーク可環境）
  - `node scripts/pr-up.js` だけで push → PR作成/更新まで完走
- レーンB（ネットワーク不可環境）
  - `node scripts/pr-up.js` は push 失敗時にフォールバックを表示
  - 指示に従い、ネットワーク可環境で `git push -u origin <branch>` を実行し、その後 `node scripts/pr-up.js`
    （または `gh pr create/edit --body-file /tmp/pr.md`）でPRまで完了
- 代替（Web UI）
  - CLI 実行が難しい場合は `cat /tmp/pr.md` の内容を GitHub Web UI に貼り付けて PR本文とする

### 初回の最終確認（ネットワーク可環境で一度だけ）
運用開始前に、ネットワーク可環境で以下を一度だけ満たすことを確認する。

- `node scripts/pr-up.js` が push → PR作成/更新まで完走する
- PR本文が `.github/PULL_REQUEST_TEMPLATE.md` 準拠で、関連Issueチェックが1つ、ACが最低1つチェック済み
- PR Gate が緑になる

以後は「PRあげてください」の一言で、上記運用レールに従って処理できる。
