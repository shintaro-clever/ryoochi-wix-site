# FAQ Knowledge Source Model (Phase5 SoT)

この文書は Phase5 の FAQ ボットが参照してよい知識源と、その参照単位を定義する一次情報です。  
FAQ ボットは自由知識ベースではなく、Hub の正本文書だけを根拠に回答し、本文とは別に `evidence_refs` を返します。

## Principle

- FAQ ボットの知識源は `SoT / workflow / manual / runbook / SRS` などの正本文書に限定する。
- FAQ 回答は一般知識の生成ではなく、正本文書の所在を示す `evidence_refs` ベースで返す。
- FAQ 回答本文に正本そのものを埋め込まず、参照単位は本文と分離した構造で返す。
- 翻訳表示を行っても、参照単位の `path` `section` `source_type` は変訳しない。

## Allowed Sources

FAQ ボットが参照できる source of truth は次に限定する。

- `docs/ai/core/workflow.md`
  - フェーズ境界、対象範囲、運用制約、SoT の親文書
- `docs/ai/core/*.md`
  - OpenAI 利用モデル、送信境界、evidence model、observability model などのコア仕様
- `docs/runbooks/*.md`
  - 運用手順、障害対応手順、反映確認手順
- `docs/ai/core/MANUAL_*.md`
  - 運用者向けの manual / 補助手順
- `docs/**/*.md` のうち SoT / manual / runbook / SRS として明示された文書
  - SRS, specification, operations 文書など、リポジトリ内で正本として扱うもの

## Disallowed Sources

FAQ ボットは次を知識源にしてはならない。

- チャット履歴だけを根拠にした回答
- 一時メモ、作業中の断片、未承認の下書き
- 実行ログや監査ログの生文
- OpenAI の自由生成だけに依存した説明
- 外部サイトや一般Web情報を SoT 代替として使う回答

## Audience Split

FAQ は `一般FAQ` と `運用者FAQ` に分け、参照粒度を固定する。

### 一般FAQ

一般FAQ は「何ができるか」「どこを見ればよいか」「どう使うか」の説明を対象にし、参照粒度は粗く保つ。

- 主知識源
  - `workflow`
  - `SoT core docs`
  - `SRS / product specification`
- 推奨参照粒度
  - 文書単位
  - 節単位
  - FAQ 項目単位
- 例
  - `Phase5 では何が対象か`
  - `OpenAI は何に使うのか`
  - `Workspace では何が見られるのか`

### 運用者FAQ

運用者FAQ は「失敗時にどう切り分けるか」「反映後に何を確認するか」「どの順で操作するか」の説明を対象にし、参照粒度を細かく保つ。

- 主知識源
  - `runbook`
  - `manual`
  - `workflow`
  - `operability / observability / evidence model`
- 推奨参照粒度
  - 節単位
  - 手順単位
  - チェックリスト項目単位
- 例
  - `VPS 反映後に何を確認するか`
  - `confirm_required のとき何をすべきか`
  - `fidelity hardening の確認順序は何か`

## Evidence Ref Unit

FAQ 用の参照単位は、翻訳表示でも壊れない次の shape に固定する。

- `source_type`
  - `sot`
  - `workflow`
  - `manual`
  - `runbook`
  - `srs`
- `title`
  - 文書名または節名
- `path`
  - リポジトリ相対 path
- `section`
  - 節名または手順名
- `ref_kind`
  - `document`
  - `section`
  - `checklist_item`
  - `faq_item`
- `audience`
  - `general`
  - `operator`

## Mapping To `evidence_refs`

FAQ 回答では、上記参照単位を既存 `evidence_refs` shape に次のように落とし込む。

- `doc_source`
  - `source_type` が `sot / workflow / srs` の参照
- `manual`
  - `source_type` が `manual` の参照
- `runbook`
  - `source_type` が `runbook` の参照

`run_id` `thread_id` `metric_snapshot` `history_window` は FAQ の種類に応じて任意だが、FAQ 回答の主根拠は常に `manual / runbook / doc_source` に置く。

## Translation Rule

- FAQ 本文は翻訳対象にしてよい。
- `source_type` `path` `section` `ref_kind` `audience` は固定管理語として扱い、翻訳しない。
- `status` `failure_code` `action_type` `reason_type` `confirm_required` `project` `thread` `run` `evidence_refs` などの構造語は `docs/i18n/glossary.md` に従って固定する。

## Relation To Other SoT

- Phase5 Boundary: `docs/ai/core/workflow.md`
- OpenAI Assist Model: `docs/ai/core/openai-assist-model.md`
- AI Evidence Model: `docs/ai/core/ai-evidence-model.md`
- Multilingual Glossary: `docs/i18n/glossary.md`
