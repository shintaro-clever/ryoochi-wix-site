# Phase4 Fidelity Hardening Backlog

## Scope Definition (SoT aligned)
- Phase4 is a dedicated Fidelity Hardening phase.
- Start only after Phase3 is completed.
- Primary objective: strengthen fidelity across Figma, code, and production so the three stay aligned.

## In Scope
- Improve reproducibility from Figma specs to implemented code.
- Reduce drift between intended design and production behavior.
- Harden validation quality for fidelity checks and regression detection.

## Out of Scope
- Re-expansion of multi-AI role architecture (role/profile/persona routing redesign).
- New features unrelated to Fidelity Hardening.
- Large-scale UX overhaul (full information architecture or screen structure redesign).

## Operating Note
- Detailed tasks are managed here as backlog items, while boundary decisions remain in `docs/ai/core/workflow.md`.
- Completion criteria SoT is fixed in `docs/ai/core/workflow.md` (`NEXT4-01 Phase4 Completion Criteria`).

## Implementation Order (Safety Guard)
Apply backlog items in this order to avoid diff-engine-first drift:
1. Judgment contract first: scoring, threshold, failure_code taxonomy, remediation output contract.
2. Evidence contract second: target/environment/capture conditions must be stored in Run.
3. Diff engines third: structure, visual, behavior, execution.
4. Gate integration fourth: final score + pass/fail + reason summary in one place.
5. UX/reporting fifth: operator-facing "why failed / how to fix" output.

## Exit Checklist
- SoT documents are present and mutually linked.
- `localhost / staging / production` comparison flow is documented and reproducible.
- 4-axis score and final score are persisted in Run evidence.
- Reason taxonomy is persisted and aggregateable.
- Run evidence includes target / environment / capture / diff / score / reasons / artifacts.
- Fidelity dashboard exposes average score, below-95 rate, top reasons, environment failure rate, component failure rate.
- Phase4 selftests stay registered in `scripts/selftest.js`.
- VPS / production verification follows:
  - `docs/runbooks/vps-external-operations-checklist.md`
  - `docs/runbooks/fidelity-hardening-operations.md`
