# Fidelity Model (Figma / Code / Production)

## Purpose
This document defines the canonical fidelity judgment model for Phase4.
The objective is to reduce evaluation drift by fixing judgment axes and minimum required checks.

## Scope
- Applies to Phase4 Fidelity Hardening only.
- Start and use this model only after Phase3 completion.
- Comparison target is always the triad: Figma, code, production environment.

## Judgment Axes (Fixed)
All four axes are mandatory. A run is not eligible for final judgment if any axis is missing.

## Judgment Pipeline (Fixed Order)
Phase4 judgments must follow this order:
1. Validate and persist comparison evidence (target + environment + capture conditions).
2. Compute all four axis diffs (`structure_diff`, `visual_diff`, `behavior_diff`, `execution_diff`).
3. Compute final score and threshold decision.
4. Classify failure reasons with fixed reason codes.
5. Generate remediation hints mapped to failing axes/fields.

### 1) Structural Diff (`structure_diff`)
Minimum required items:
- Target mapping is explicit (`page/frame/node` in Figma, corresponding component/template in code, corresponding rendered area in production).
- Hierarchy consistency is checked (parent-child structure and major container boundaries).
- Required elements existence is checked (critical nodes/components are present, no missing mandatory block).
- Naming/reference consistency is checked (component identity or stable selector mapping is resolvable).
- Component contract conformance is checked against `docs/design-system/components.md` (`variant`, `state`, `slot`, `allowed overrides`).

### 2) Visual Diff (`visual_diff`)
Minimum required items:
- Layout alignment is checked (positioning flow, spacing, alignment direction).
- Sizing consistency is checked (width/height behavior including min/max constraints where defined).
- Typography consistency is checked (text content, font size/weight, line-height or equivalent rendering intent).
- Style token consistency is checked (color/background/border/radius/shadow or equivalent design token output).
- Token conformance is checked against `docs/design-system/tokens.md` for `color`, `spacing`, `radius`, `shadow`, `typography`, and `breakpoint`.

### 3) Behavior Diff (`behavior_diff`)
Minimum required items:
- Primary user flows execute as designed (core path steps complete without divergence).
- Interactive state transitions are consistent (hover/focus/active/disabled/loading/error as applicable).
- Form/input behavior is consistent (validation rule, error display, submit gating).
- Navigation/action outcome is consistent (correct route transition, modal behavior, or action side effect).

### 4) Execution Diff (`execution_diff`)
Minimum required items:
- Runtime status is healthy (no critical runtime error in console/server logs during target flow).
- Network/API contract alignment is checked (required request/response shape and status behavior are consistent).
- Performance guardrail is checked (no severe regression against defined baseline/SLO for target flow).
- Environment parity is checked (config/feature-flag/dependency conditions used for validation are recorded and reproducible).
- Environment-dependent mismatch is explicitly separable as `environment_only_mismatch`.
- At minimum, these environment evidence fields are recorded for baseline/candidate:
  - `font_fallback`
  - `viewport`
  - `theme`
  - `data_state`
  - `browser`

## Evaluation Preconditions
- Input triad is available: Figma reference, implementation code reference, production validation target.
- Validation run must persist evidence links/artifacts for all four axes.
- If any minimum required item is unverified, result must be marked `incomplete` (not pass/fail).
- Comparison environment (`localhost`/`staging`/`production`) and fixed conditions (URL/viewport/theme/auth state/fixture data) must be persisted in Run context.
- Run must persist consolidated fidelity evidence under:
  - `inputs.fidelity_evidence`
  - `context_used.fidelity_evidence`
  - Evidence minimum fields: `figma_target`, `environment`, `capture`, `diff_scores`, `diff_reasons`, `artifacts`.

## Final Scoring and Pass/Fail
- Final score is 0-100 and must be persisted as `fidelity_score`.
- Default pass threshold is `95`.
- If any axis result is missing, final result is `incomplete` regardless of score.
- If threshold is not met, result is `failed` with axis-level reason codes.
- If only environment-dependent differences exist in `execution_diff`, classify as `environment_only_mismatch` and separate from implementation mismatch.

## Failure and Remediation Output (Required)
- Every failed/incomplete run must persist:
  - `failure_code` (fixed string)
  - `reasons[]` (reason_code + axis + field)
  - `remediations[]` (actionable fix guidance linked to reason_code)
- Remediation must answer:
  - what is different
  - why it failed threshold/gate
  - what to change first (highest impact first)

## Figma Target Normalization (Phase4 Required)
- Comparison target resolution order is fixed: `node` > `frame` > `page` > `file`.
- Target input must be unambiguous; the following are rejected as `validation_error`:
  - `page_id` and `page_name` specified together
  - `frame_id` and `frame_name` specified together
  - `node_id` and `node_ids` specified together
  - `frame_name` without page scope
  - `node_ids` that do not belong to the resolved page/frame, or span multiple pages without explicit page scope
- Resolved comparison target IDs must be persisted in Run artifacts:
  - `inputs.connection_context.figma.comparison_target`
  - `context_used.connection_context.figma.comparison_target`

## Out of Scope
- Multi-AI role architecture redesign (role/profile/persona expansion).
- Unrelated feature delivery.
- Large-scale UX redesign not aimed at fidelity hardening.

## SoT Link
- Phase boundary and phase entry order: `docs/ai/core/workflow.md`
- Phase4 scoring SoT: `docs/ai/core/fidelity-scoring-phase4.md`
- Reason taxonomy SoT: `docs/ai/core/fidelity-reasons.md`
- Design token SoT and mapping: `docs/design-system/tokens.md`
- Component contract SoT and mapping: `docs/design-system/components.md`
- Environment comparison SoT: `docs/operations/fidelity-environments.md`
