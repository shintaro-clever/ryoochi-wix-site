# Phase4 Fidelity Scoring (SoT)

## Purpose
Define a single final scoring contract for Phase4 so pass/fail, reasons, and remediation are consistent across Figma, code, and production comparisons.

## Inputs
All four axis outputs are required:
- `structure_diff`
- `visual_diff`
- `behavior_diff`
- `execution_diff`

If any axis is missing, result is `incomplete` with `failure_code=axis_missing`.

## Axis Scores (0-100)
- `structure_score = structure_diff.structural_reproduction.rate * 100`
- `visual_score = visual_diff.score`
- `behavior_score = behavior_diff.score`
- `execution_score = execution_diff.score`

Execution special handling:
- If `execution_diff.environment_only_mismatch=true`, execution effective score is treated as `100` for final scoring.
- Raw execution score is still recorded.

## Default Weights
- structure: `0.35`
- visual: `0.35`
- behavior: `0.15`
- execution: `0.15`

Final score:
- `final_score = structure*0.35 + visual*0.35 + behavior*0.15 + execution_effective*0.15`

## Thresholds
- Final threshold: `95`
- Axis minimum thresholds:
  - structure: `95`
  - visual: `95`
  - behavior: `95`
  - execution: `95` (unless environment-only mismatch)

## Hard Gates (Foot-Gun Prevention)
The following hard gates are evaluated separately from weighted score.

1. `target_alignment_100` (hard fail)
- Must satisfy all:
  - target id mismatch count = 0
  - missing nodes = 0
  - extra nodes = 0
- This is the explicit `対象一致100%` gate.

2. `structure_major_diff_forbidden` (hard fail)
- `structure_diff.major_diff_detected` must be `false`.

3. `visual_axis_min` (hard fail)
- visual score must be >= threshold.

4. `behavior_axis_min` (hard fail)
- behavior score must be >= threshold.

5. `execution_axis_min` (hard fail, or info)
- If `environment_only_mismatch=false`, execution score must be >= threshold.
- If `environment_only_mismatch=true`, this gate is informational (not hard fail).

6. `final_score_threshold` (hard fail)
- final score must be >= final threshold.

## Status Model
- `incomplete`: missing axis data
- `failed`: one or more hard gates failed
- `passed`: all hard gates pass
- `passed_with_environment_mismatch`: all hard gates pass and execution mismatch is environment-only

## Required Output Contract
The scorer must output:
- `status`, `pass`, `failure_code`
- `final_score`, `threshold`, `weights`
- `axis_results[]`
- `hard_gates[]`
- `reasons[]` (fixed `reason_code` with axis and detail)
- `remediations[]` (actionable fixes, prioritized)
- `target_alignment` summary
- `diff_reasons` (taxonomy summary from `docs/ai/core/fidelity-reasons.md`)

## Reference Implementation
- `src/fidelity/phase4Scoring.js`
