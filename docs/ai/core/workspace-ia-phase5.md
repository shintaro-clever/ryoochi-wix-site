# Workspace IA Phase5 (SoT)

この文書は Phase5 における Workspace 情報設計の一次情報です。  
P5-ARCH-00 / P5-UI-00 / P5-UI-01 の判断基準として扱い、以後の UI 実装は本方針に従います。

## Goal

- 現状の Thread 中心の見え方から、**AI Workspace 中心** の見え方へ寄せる。
- 未実装導線や暫定導線に引きずられず、目標UIを基準に段階的に実装する。
- `/ui/` 配下の新UIを正本とし、旧HTML直配信ルートへ戻らない。

## Comparison Baseline

- 1枚目は **現状UI**。
  - 棚卸し対象として扱う。
  - 未実装UI、仮導線、誤導線を見つけるための基準面とする。
- 2枚目は **目標UI**。
  - Phase5 の Workspace IA SoT として扱う。
  - 実装判断、命名、導線整理、優先順位づけは 2枚目基準で行う。

## Target Structure

目標UIの基本構成は次の 3 面で固定する。

1. 左: 横断ナビ
- Workspace / Project / Runs / Settings などの横断導線を置く。
- 一覧選択や移動の役割に限定し、主作業面を侵食しない。
- Thread 一覧が存在しても、それは AI Workspace を補助する選択導線として扱う。

2. 中央: AI作業面
- 会話、実行、検索、履歴確認、FAQ、説明、次アクションを集約する。
- Phase5 ではこの中央面を最重要面として扱う。
- 「Thread を見る場所」ではなく、「AI と作業を進める場所」として命名と説明を揃える。

3. 右: 補助コンテキスト面
- 接続済みリソース
- roadmap
- recent files
- 上記を中心に、作業判断の補助情報を集約する。
- 中央作業面の代替ではなく、参照面として扱う。

## Design Guardrails

- 現状UIに残る Thread 中心の用語や構造を、そのまま目標UIの正解として扱わない。
- 「会話一覧が主、作業は従」という構図を避け、AI作業面を中心に再編する。
- 右カラムは接続状態や最近扱った資料の参照導線に寄せ、管理画面化しない。
- 社内管理画面、組織ユーザー管理、RBAC、複数AI routing、confirmなし自動実行、完全自律エージェントは Phase5 に混入させない。

## Implementation Policy

- `apps/hub/static/ui/project-workspace.html` は目標UIへ寄せる主対象ページとする。
- `apps/hub/static/ui/dashboard.html` は AI Workspace への入口ページとして整理する。
- 現時点で実装が未完でも、文言・見出し・導線は目標UIに整合するように先に寄せる。
- 旧ルートや旧HTMLが残っていても、配信導線と SoT は `/ui/` に統一する。
