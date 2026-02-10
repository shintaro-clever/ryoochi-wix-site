# TODO（Figma）

## 概要（AI）
- Issue #12 の運用検証（TODO→PR→削除→ログ化）を1本のPRで通す

## 変更内容（AIが埋める）
- todo/TODO-figma.md を運用キューとして追加（または更新）
- PR作成後に TODO を削除し、PRにログとして残す運用を検証
- 影響範囲：ドキュメント
- リスク：なし（運用検証のみ）

## 関連Issue
Fixes #12

## 完了条件（最低1つチェック）
- [x] AC: PR本文に Fixes # が入っている
- [ ] AC: PR本文に - [x] AC が最低1つあり、PR Gate が緑になる
- [ ] AC: PR作成後に todo/TODO-figma.md が削除コミットされ、PRに残る

## 判断・決定（任意）
- 固定情報（Figma/AIスレッド）はIssueに集約、PRは実装ログのみ

## 補足（任意）
- 参照は Issue #12 に集約
