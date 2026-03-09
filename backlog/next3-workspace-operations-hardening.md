# Next3 Backlog: Workspace Operations Hardening (SoT Entry)

Status: Entry backlog only.  
Phase2 completion criteria remain unchanged.

## Scope (Phase3 Entry)
- Workspace search hardening for run/external context/audit traces.
- Workspace history hardening for timeline and before/after traceability.
- Workspace observability hardening for failure visibility and retry decisions.
- Workspace operability hardening for daily operation flow improvements.

## Non-Scope (Fixed)
- Multi-AI connections or role/profile/persona routing expansion.
- New advanced Figma/GitHub operation expansion beyond the fixed Phase2 external-operations scope.
- Fully automated sync without human approval.

## Non-Scope (Phase2)
- Do not add these items to Phase2 Done criteria.
- Do not reorder Phase2 fixed sequence (`read -> validation -> controlled write -> run/workspace integration`).

## Start Order (Fixed)
1. Search
2. History
3. Observability
4. Operability

## Done Criteria (Phase3 Fixed)
Phase3 は次の 6 条件をすべて満たした場合のみ完了扱いにする。

1. Search
- search API / UI が運用導線として機能し、filter と mask が有効であること。

2. History
- history API / UI が統合 event と grouping/summary を提供できること。

3. Observability / Operability
- metrics/anomaly と retry/refresh/export が安全条件付きで機能すること。

4. Export / Mask
- `search/history/audit/metrics` の CSV/JSON export が固定 shape で動作し、secret-like 値を露出しないこと。

5. Selftest
- search/history/metrics/retry/export/mask の主要ケースが selftest で通ること。

6. VPS Verification
- `docs/runbooks/vps-workspace-phase3-checklist.md` に従って VPS 確認できること。

## Explicitly Not In Done Criteria
- Multi-AI connections
- role/profile/persona routing expansion
- 新たな Figma/GitHub 高度操作拡張
- 完全自動同期
