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
- `search` の対象モデル SoT は `docs/ai/core/search-model.md` を正とする。
- `history` の統合表示モデル SoT は `docs/ai/core/history-model.md` を正とする。
- `observability` の主要指標 SoT は `docs/ai/core/observability-model.md` を正とする。
- `operability` の許可アクション SoT は `docs/ai/core/operability-model.md` を正とする。
- フェーズ3の着手順は次の順序に固定する。
  1. `search`（Run / external operations / audit を横断検索できる最小要件）
  2. `history`（run / chat / operation / confirm を統合し、時系列の追跡と差分参照を安定化）
  3. `observability`（失敗分類・遅延・再試行判断に必要な可視化）
  4. `operability`（運用導線・手順・権限境界の改善）
- フェーズ3の `history` で最低限扱う event 種別は次に固定する。
  - `run.created`
  - `run.status_changed`
  - `read.plan_recorded`
  - `write.plan_recorded`
  - `confirm.executed`
  - `external_operation.recorded`
  - `audit.projected`
- `history` は単なる message history ではなく、Phase2 で保存された `external_operations` / `external_audit` / Run 状態 / confirm 状態を横断する統合表示モデルとする。
- `external_operations` は actual execution record の正本として維持し、`history` はその投影表示として扱う。
- フェーズ3の `observability` で最低限扱う主要指標は次に固定する。
  - `run counts`
  - `queued / running / ok / failed / skipped`
  - `confirm rate`
  - `provider 別 operation counts`
  - `failure_code distribution`
  - `figma fidelity distribution`
  - `duration median / p95`
- ただし `observability` の主軸は Workspace 運用指標とし、`figma fidelity distribution` は参照指標として扱う。
- fidelity score の詳細分析、reason taxonomy、before/after 差分深掘りは Phase4 の責務として `docs/ai/core/fidelity-model.md` 系へ委譲する。
- フェーズ3の対象外:
  - 複数AI接続・役割設定（role/profile/persona routing の拡張）
  - Figma / GitHub 高度操作の新規拡張
  - 完全自動同期（human approval を挟まない end-to-end 自動反映）
- 上記の対象外は Deferred Track または post-Phase3 の別フェーズへ分離し、フェーズ3へ責務を逆流させない。
- フェーズ3の詳細タスクは backlog で管理し、本節は順序と境界のみを SoT とする。

### NEXT3-01 Phase3 Completion Criteria (SoT)
Phase3 を完了とみなすための必須条件は次の 6 項目で固定する。いずれか 1 つでも未達なら完了扱いにしない。

1. Search 固定
- Workspace Search が `project/thread/run/message/external_operation/external_audit` を対象に動作すること。
- `project/thread/provider/status/time range` の絞り込み、result link、secret-like mask が有効であること。

2. History 固定
- Workspace History が `run/chat/operation/confirm` を統合表示できること。
- 最低 event 種別:
  - `run.created`
  - `run.status_changed`
  - `read.plan_recorded`
  - `write.plan_recorded`
  - `confirm.executed`
  - `external_operation.recorded`
  - `audit.projected`
- day grouping または run summary により長い履歴でも可読性を保てること。

3. Observability / Operability 固定
- Workspace Observability で最低限次を表示できること:
  - `run counts`
  - `queued/running/ok/failed/skipped`
  - `confirm rate`
  - `provider 別 operation counts`
  - `failure_code distribution`
  - `figma fidelity distribution`
  - `duration median/p95`
- Workspace Operability で最低限次を安全に実行できること:
  - `retry read-only`
  - `retry failed run`
  - `refresh`
  - `export`
- confirm 必須 write を operability から無断再実行しないこと。

4. Export / Mask 固定
- `search/history/audit/metrics` を CSV / JSON で export できること。
- 列順と shape が固定されていること。
- `confirm_token`, `confirm_token_hash`, `secret_id` 解決値、生 credential, secret-like 値が露出しないこと。

5. Selftest 固定
- Phase3 の主要ケースが selftest に登録され継続実行されること。
- 最低限の対象:
  - search
  - history
  - metrics
  - retry
  - export
  - mask
- Phase3 単独 runner で主要フローを通せること。

6. VPS / Runbook 固定
- VPS 反映後確認の手順が runbook 化されていること。
- `search -> history -> observability(metrics) -> retry -> export` の順で確認できること。
- 期待結果、失敗時確認点、ロールバック観点が文書化されていること。

### NEXT3-02 Phase3 Non-Completion Items (SoT)
- 次の項目は Phase3 完了条件に含めない。
  - 複数AI接続
  - role/profile/persona routing などの役割設定拡張
  - 新たな Figma / GitHub 高度操作の追加拡張
  - human approval を挟まない完全自動同期
- これらは Deferred Track または post-Phase3 の別フェーズへ分離し、Phase3 完了判定へ逆流させない。

### NEXT4-00 Phase4 Fidelity Hardening Entry (SoT)
- Phase4 は **Phase3 完了後にのみ** 着手する。
- Phase4 は Fidelity Hardening 専用フェーズとして固定し、目的を **Figma / コード / 本番環境の三者一致率の強化** に限定する。
- Phase4 では、既存実装と運用導線の再現度向上・差分縮小・検証精度向上を扱う。
- 一致判定は 4軸（`構造差分` / `視覚差分` / `挙動差分` / `実行差分`）で固定し、最低必須項目は `docs/ai/core/fidelity-model.md` を SoT とする。
- Design Token の SoT（`color` / `spacing` / `radius` / `shadow` / `typography` / `breakpoint`）は `docs/design-system/tokens.md` を正とし、Figma変数名とコード側token名の対応および未対応tokenの可視化を必須とする。
- Phase4 の実施順は次に固定する（比較器先行で判定/修正導線が後追いになることを防ぐため）。
  1. 判定モデル固定（4軸の最低必須項目、配点、合格閾値、失格条件）
  2. 証跡入力固定（Figma target / 環境条件 / capture条件を Run に固定保存）
  3. 差分算出（構造/視覚/挙動/実行）
  4. 総合判定（最終スコア、pass/fail、failure_code、主要理由分類）
  5. 修正導線生成（どの軸のどの項目を直すかを actionable に返す）
- Phase4 の対象外:
  - 複数AI役割設計の再拡張（role/profile/persona routing の再設計）
  - Fidelity Hardening と無関係な新機能追加
  - 大規模UX刷新（全面的な情報設計・画面構成の作り直し）
- Phase4 の詳細タスクは backlog (`backlog/phase4-fidelity-hardening.md`) で管理し、本節は目的・着手条件・対象外のみを SoT とする。

### NEXT4-01 Phase4 Completion Criteria (SoT)
Phase4 を完了とみなすための必須条件は次の 8 項目で固定する。いずれか 1 つでも未達なら完了扱いにしない。

1. SoT 固定
- 判定モデル、理由分類、環境比較、運用手順の SoT が文書化され、相互参照できること。
- 最低限の参照先:
  - `docs/ai/core/fidelity-model.md`
  - `docs/ai/core/fidelity-reasons.md`
  - `docs/ai/core/fidelity-scoring-phase4.md`
  - `docs/operations/fidelity-environments.md`
  - `docs/runbooks/fidelity-hardening-operations.md`

2. 比較固定
- `localhost / staging / production` の比較手順が固定され、Run に比較条件を保存できること。
- `inputs.fidelity_environment` と `context_used.fidelity_environment` の両方に保存されること。

3. スコア固定
- 4軸（構造 / 視覚 / 挙動 / 実行）と最終スコアが算出されること。
- `phase4_score.final_score` と `fidelity_score` のどちらから見ても最終判定が追えること。
- 完了条件として、標準運用の受け入れラインは `final_score >= 95` を基準値とする。

4. 理由分類固定
- 差分理由が taxonomy に沿って `reason_type` へ分類されること。
- `fidelity_reasons.counts.by_type` を集計可能であること。

5. Run 証跡固定
- Run に次が保存されること:
  - target
  - environment
  - capture
  - diff
  - score
  - reasons
  - before/after または比較 artifact
- 最低限 `inputs.*` と `context_used.*` の双方から追跡できること。

6. UI 固定
- operator UI で最低限次を表示できること:
  - 平均総合スコア
  - 95点未満率
  - 差分理由上位
  - 環境別失敗率
  - コンポーネント別失敗率
  - 最近の失敗
  - before / after 比較導線

7. selftest 固定
- Phase4 の主要ケースが `scripts/selftest.js` に登録され、継続実行されること。
- 最低限の対象:
  - 構造差分
  - 視覚差分
  - 挙動差分
  - 実行差分
  - 理由分類
  - Run 保存
  - 主要 UI 表示

8. VPS / 本番確認固定
- VPS 反映と本番比較の確認手順が runbook 化されていること。
- `docs/runbooks/vps-external-operations-checklist.md` と `docs/runbooks/fidelity-hardening-operations.md` に従って確認できること。

### NEXT5-00 Phase5 OpenAI Assist / FAQ / Workspace IA Entry (SoT)
- Phase5 は **Phase4 完了後にのみ** 着手する。
- Phase5 は **単一運用者前提** の運用補助フェーズとして固定し、対象を次の 4 領域に限定する。
  1. OpenAI運用補助AI
  2. 多言語説明
  3. FAQボット
  4. Workspace IA再編
- UI の正本は今後 `/ui/` 配下の新UIとし、旧HTML直配信の問題は修正済みとして扱う。
- 以後の画面導線・情報設計・運用補助導線の追加は、`/ui/` を基準に定義し、旧ページ直配信を SoT に戻さない。
- Phase5 の対象は次に固定する。
  - OpenAI API / ChatGPT 運用を補助する single-operator 向け UI / 導線 / 説明整備
  - 同一機能の多言語説明と、運用上重要な制約・手順・失敗時案内の多言語提供
  - FAQボットによる自己解決導線の整備
  - Workspace の IA 再編（情報構造、導線、命名、配置の再整理）
- OpenAI 補助AIの利用モデルは `docs/ai/core/openai-assist-model.md` を SoT とし、役割を `要約` `分析` `提案` `翻訳` `FAQ回答` に限定する。
- AI 回答の根拠モデルは `docs/ai/core/ai-evidence-model.md` を SoT とし、本文とは別に `evidence_refs` を返す。
- FAQ ボットの知識源モデルは `docs/ai/core/faq-model.md` を SoT とし、参照元を SoT / workflow / manual / runbook / SRS の正本に限定する。
- OpenAI は Hub の最終 SoT を自律的に書き換える主体として扱わない。
- OpenAI の対象外は次に固定する。
  - GitHub / Figma への無確認実行
  - 組織管理判断
  - 権限設計判断
  - confirm なし自動実行
  - 完全自律エージェント動作
- Workspace IA再編の方針は次に固定する。
  - 1枚目は **現状UI** の棚卸し対象として扱い、未実装UI・仮導線・誤導線を可視化するための基準面とする
  - 2枚目は **目標UI** の SoT として扱い、Phase5 の IA 再編はこの構成に寄せる
  - 左カラムは横断ナビゲーションに固定し、プロジェクト/Workspace を横断する主要導線のみを置く
  - 中央カラムは AI 作業面に固定し、会話、実行、説明、FAQ など運用者が主作業を行う面として扱う
  - 右カラムは補助コンテキスト面に固定し、接続済みリソース、roadmap、recent files を集約する
  - 上記 3 面構成は `/ui/` 配下の新UIを正本として定義し、旧HTML直配信ルートを再設計の基準にしない
- Phase5 の対象外は次に固定する。
  - 社内管理画面
  - 組織ユーザー管理
  - RBAC強化
  - 複数AI routing
  - confirm なし自動実行
  - 完全自律エージェント
- 上記の対象外は Phase6 以降の責務として分離し、Phase5 の完了条件や実装判断へ混入させない。
- Phase5 の詳細タスクは backlog (`backlog/phase5-openai-assist-faq.md`) で管理し、本節は境界と対象のみを SoT とする。

### NEXT5-01 Phase5 Completion Criteria (SoT)
Phase5 は、単に OpenAI 接続できるだけではなく、**運用可能状態** に到達したときのみ完了扱いにする。

1. SoT 固定
- Phase5 の境界、OpenAI 利用モデル、送信境界、evidence model、FAQ model、多言語用語集、Workspace IA 方針が SoT として固定されていること。
- 最低限、次を一次情報として参照できること。
  - `docs/ai/core/workflow.md`
  - `docs/ai/core/openai-assist-model.md`
  - `docs/ai/core/openai-data-boundary.md`
  - `docs/ai/core/ai-evidence-model.md`
  - `docs/ai/core/faq-model.md`
  - `docs/ai/core/workspace-ia-phase5.md`
  - `docs/i18n/glossary.md`

2. OpenAI 接続固定
- OpenAI connection 設定を安全に保存できること。
- `secret_ref / secret_id` 参照を使い、生の secret を保存しないこと。
- verify API により `provider / model / status / error / failure_code` を確認できること。
- 共通 wrapper が OpenAI 呼び出しの単一入口として使われていること。

3. 境界 / 秘匿固定
- OpenAI 送信境界が wrapper 層で共通適用されていること。
- `secret-like` 値、`confirm_token`、生の secret 解決値、過度な個人情報本文、秘匿監査生文を OpenAI へ送らないこと。
- audit に raw evidence や raw secret を残さず、summary のみを残すこと。

4. Evidence 固定
- 要約、分析、翻訳、FAQ が共通の `evidence_refs` shape を使うこと。
- 最低限 `run_id` `thread_id` `metric_snapshot` `history_window` `manual` `runbook` `doc_source` を保持できること。
- evidence は本文と分離された構造として返されること。

5. 要約 / 分析固定
- Run Summary が `overview / main_failure_reasons / priority_actions / evidence_refs` を返せること。
- History Summary と Observability Summary が同一 response / evidence shape で返せること。
- Observability Analysis が断定診断ではなく `candidate_causes / impact_scope / additional_checks / evidence_refs` を返せること。

6. 多言語固定
- 翻訳 API が `Run Summary / History Summary / Observability Summary / Observability Analysis / FAQ` を対象に動作すること。
- glossary 管理語を壊さず、AI 表示言語切替で `ja / en` の表示ができること。
- 多言語表示 UI は未実装の外観設定保存 UI と責務分離されていること。

7. FAQ 固定
- FAQ query API が `question / audience / language` を受けて `answer / confidence / evidence_refs / escalation_hint` を返せること。
- `general FAQ` と `operator FAQ` の UI が分離され、operator 側は runbook nav と自然接続していること。
- FAQ guardrails により、危険操作、権限変更断定、請求判断、本番障害断定診断を禁止できること。
- `general FAQ -> operator FAQ / runbook nav` の昇格導線が `/ui/` 正本上で機能すること。

8. Metrics 固定
- 既存 metrics ベースに AI 利用メトリクスが統合されていること。
- 最低限、次を集計できること。
  - `ai_requests`
  - `ai_failures`
  - `ai_latency`
  - `ai_token_usage`
  - `summary_requests`
  - `analysis_requests`
  - `translation_requests`
  - `faq_queries`
  - `faq_resolution_rate`
  - `language_distribution`
- FAQ は `general / operator` audience 別、guardrail 発火件数、escalation 率を追えること。
- Workspace UI で `AI Usage Metrics` を確認できること。

9. Audit 固定
- 監査証跡として最低限、次の event が残ること。
  - `ai.requested`
  - `ai.completed`
  - `ai.failed`
  - `summary.generated`
  - `analysis.generated`
  - `translation.generated`
  - `faq.queried`
  - `faq.answered`
  - `faq.escalated`
  - `faq.guardrail_applied`
- 既存の wrapper 監査方針と矛盾せず、summary のみを監査に残すこと。

10. UI / IA 固定
- `/ui/` を正本として、Run / Workspace / Help / Help Admin が Phase5 の主要運用導線として成立していること。
- Workspace IA は `左=横断ナビ` `中央=AI作業面` `右=接続済みリソース / roadmap / recent files` の目標構成に寄せていること。
- 旧ページ直配信を設計基準に戻さないこと。

11. selftest 固定
- Phase5 の主要ケースが `scripts/selftest.js` に統合登録され、継続実行されること。
- 最低限、次を selftest で確認できること。
  - verify
  - wrapper
  - boundary
  - evidence
  - summary
  - analysis
  - i18n
  - faq
  - metrics
  - audit
  - FAQ guardrails
  - general / operator FAQ UI
  - FAQ 翻訳経路
  - AI Usage Metrics UI

12. Runbook 固定
- Phase5 の運用 runbook が存在し、OpenAI 接続確認、レート制限時対応、FAQ 誤回答時エスカレーション、guardrail 発火時対応、翻訳誤り修正、AI Usage Metrics 確認、監査確認を文書化していること。
- `docs/runbooks/phase5-openai-assist-operations.md` を operator FAQ / runbook nav から到達できること。

### NEXT6-00 Phase6 Reserved Boundary (SoT)
- Phase6 は Phase5 の対象外として列挙した拡張責務を扱うための将来フェーズとして予約し、Phase5 へ先行混入させない。
- 最低限、次の責務は Phase5 ではなく Phase6 以降に分離する。
  - 社内管理画面
  - 組織ユーザー管理
  - RBAC
  - 複数AI routing
  - confirm なし自動実行
  - 完全自律エージェント

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
