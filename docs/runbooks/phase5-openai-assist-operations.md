# Phase5 OpenAI Assist Operations Runbook

## Purpose
- Phase5 の `要約 / 分析 / 翻訳 / FAQ / metrics / audit` を単一運用者向けに一体運用する。
- OpenAI 接続確認、レート制限時対応、FAQ 誤回答時エスカレーション、guardrail 発火時対応、翻訳誤り修正、AI Usage Metrics 確認、監査確認を同じ手順系で扱う。
- `general FAQ -> operator FAQ / runbook nav` の昇格導線を運用手順として固定する。

## Scope
- Phase5 の `OpenAI運用補助AI` `多言語説明` `FAQボット` `Workspace IA再編` に関する日常運用。
- 対象 API/UI:
  - Run Summary
  - History Summary
  - Observability Summary
  - Observability Analysis
  - AI Translate
  - FAQ query
  - AI Usage Metrics
  - AI audit logs
- 対象外:
  - GitHub / Figma への無確認実行
  - 組織管理判断
  - RBAC / 組織ユーザー管理
  - confirm なし自動実行
  - 完全自律エージェント

## Preconditions
1. `/ui/` 配下を UI 正本として扱う。
2. 既定 AI 設定で `provider=openai` が有効である。
3. FAQ の知識源は `docs/ai/core/*.md` と `docs/runbooks/*.md` の正本に限定される前提を理解している。
4. 機密値、生の secret 解決値、監査生文は OpenAI へ送られない方針を維持する。
5. 外部操作を伴う確認は必要に応じて `docs/runbooks/vps-external-operations-checklist.md` を併用する。

## Standard Flow

### 1. OpenAI 接続確認
1. `/ui/settings-ai.html` で対象モデルと `secret_ref` を確認する。
2. `OpenAI接続を確認` を実行する。
3. `provider=openai` `model` `status` `error` を確認する。

期待値:
- `status=ok`
- `failure_code=null`
- secret 生値は UI / DB / audit に出ない

失敗時:
- `unauthorized`: `secret_ref` と環境変数参照を見直す
- `rate_limit`: 下記のレート制限手順へ進む
- `connection_failed` / `timeout`: 一時障害として時間を置いて再確認する

### 2. 要約 / 分析の一次運用
1. Run 詳細から Run Summary を確認する。
2. Workspace から History Summary / Observability Summary / Alert Analysis を確認する。
3. 断定診断ではなく、`evidence_refs` に沿った補助説明として扱う。

確認点:
- `overview` `main_failure_reasons` `priority_actions` が返る
- Analysis は `candidate_causes` `impact_scope` `additional_checks` を返す
- `evidence_refs` が本文と分離されている

### 3. FAQ 一次対応
1. 一般利用者は `/ui/help.html` から `general FAQ` を使う。
2. 知識源不足、曖昧回答、運用判断が必要な場合は `/ui/help-admin.html` へ昇格する。
3. 運用者は `operator FAQ / Runbook Nav` から runbook evidence に沿って切り分ける。

昇格条件:
- 回答が `confidence=low`
- `escalation_hint` が返る
- `guardrail_code` が返る
- 本番障害、権限変更、請求判断など FAQ 対象外に触れている

### 4. 翻訳運用
1. 翻訳対象は `Run Summary / History Summary / Observability Summary / Observability Analysis / FAQ` に限定する。
2. `AI表示言語` の変更後、構造語が維持されていることを確認する。
3. `status` `failure_code` `action_type` `reason_type` `confirm_required` `project` `thread` `run` `evidence_refs` は変訳しない。

## Incident Playbooks

### A. レート制限時対応
1. `failure_code=rate_limit` を確認する。
2. 同一操作の連打を止める。
3. AI Usage Metrics で `ai_failures` と `translation_requests` / `summary_requests` / `analysis_requests` を確認する。
4. 短時間での集中利用が原因なら時間を空けて再試行する。
5. 継続する場合はモデル見直しまたは問い合わせ判断を行う。

記録するもの:
- 発生時刻
- use_case
- model
- `failure_code`
- `ai.failed` と `openai.assist.call` の監査 event

### B. FAQ 誤回答時エスカレーション
1. `answer` と `evidence_refs` を比較し、正本根拠が薄いか確認する。
2. `general FAQ` であれば `/ui/help-admin.html` に昇格する。
3. 関連 `runbook` `manual` `doc_source` を開いて正本確認する。
4. 誤回答の原因を分類する。
   - 知識源不足
   - 曖昧質問
   - 翻訳誤り
   - guardrail 対象
5. 必要なら SoT / runbook 追記を backlog 化する。

### C. guardrail 発火時対応
対象:
- `dangerous_operation`
- `permission_change`
- `billing_judgment`
- `production_incident_diagnosis`

手順:
1. `guardrail_code` を確認する。
2. FAQ ボットでは判断せず、人間判断へ切り替える。
3. `operator FAQ / Runbook Nav` で関連 runbook へ移動する。
4. 必要なら運用責任者、組織管理者、請求窓口へエスカレーションする。

禁止:
- FAQ 回答をそのまま実行判断に使うこと
- guardrail を回避する再質問で断定判断を引き出すこと

### D. 翻訳誤り修正
1. 元の `ja` 表示と翻訳表示を比較する。
2. glossary 固定語が壊れていないか確認する。
3. 誤りが本文だけなら glossary / prompt / source sentence を見直す。
4. 根拠参照まで壊れている場合は `evidence_refs` shape を優先して修正する。
5. 再発する場合は glossary 追記または SoT 文言修正を検討する。

## AI Usage Metrics Check
Workspace の `AI Usage Metrics` で次を確認する。

### Daily Check
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

### FAQ Check
- `general / operator` audience 別件数
- `guardrail_triggered`
- `guardrail_by_code`
- `escalation_rate_pct`

見るべき異常:
- `ai_failures` 急増
- `rate_limit` 偏在
- `faq_resolution_rate` 低下
- `guardrail_triggered` 急増
- 特定言語だけ誤訳が増える傾向

## Audit Check
監査は本文フルテキストではなく summary のみを見る。

確認対象 event:
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
- 互換イベントとして `openai.assist.call`

確認点:
- `prompt_summary`
- `evidence_summary`
- `evidence_refs_summary`
- `response_summary`
- `failure_code`
- `token_usage`

禁止:
- 生の secret 値や confirm token を監査に残すこと
- `evidence_refs` の生本文を監査証跡として扱うこと

## Escalation Routing

### general FAQ から operator FAQ / runbook nav へ
1. `general FAQ` で `confidence=low` または `escalation_hint` を確認する。
2. `/ui/help-admin.html` へ移動する。
3. evidence の `runbook` ボタンから該当 runbook card へジャンプする。
4. 必要なら Workspace に戻って summary / analysis / metrics を照合する。

### operator FAQ から runbook へ
1. `FAQ Evidence` の `runbook` を確認する。
2. `Runbook Navigator` の該当 card へジャンプする。
3. Phase3 / Phase4 / Phase5 のどの運用面かを確定して手順に従う。

## Evidence to Record
- `question`
- `audience`
- `language`
- `use_case`
- `failure_code`
- `guardrail_code`
- `escalation_hint`
- `run_id` / `thread_id`
- metrics snapshot
- 該当 runbook / manual / doc_source path

## References
- Phase5 Boundary SoT: `docs/ai/core/workflow.md`
- OpenAI Assist Model: `docs/ai/core/openai-assist-model.md`
- OpenAI Data Boundary: `docs/ai/core/openai-data-boundary.md`
- AI Evidence Model: `docs/ai/core/ai-evidence-model.md`
- FAQ Model: `docs/ai/core/faq-model.md`
- Multilingual Glossary: `docs/i18n/glossary.md`
- Phase3 Runbook: `docs/runbooks/vps-workspace-phase3-checklist.md`
- Phase4 Runbook: `docs/runbooks/fidelity-hardening-operations.md`
- External Ops Runbook: `docs/runbooks/vps-external-operations-checklist.md`
