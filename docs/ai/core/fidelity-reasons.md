# Fidelity Reason Taxonomy (SoT)

## Purpose
Fix reason classification so every mismatch is stored at recurrence-prevention granularity and can be aggregated consistently.

## Scope
Applies to Phase4 fidelity diffs and final scoring outputs.

## Canonical Reason Types (Fixed)
The following `reason_type` set is fixed:
- `token_mismatch`
- `layout_constraint_mismatch`
- `component_variant_mismatch`
- `missing_state`
- `content_overflow`
- `font_rendering_mismatch`
- `breakpoint_mismatch`
- `environment_only_mismatch`
- `manual_design_drift`
- `code_drift_from_approved_design`

`unknown` may exist only as fallback for unmapped legacy reason codes.

## Mapping Rules (Minimum)
- `token_mismatch`
  - visual token drift (color/spacing/radius/border/typography)
- `layout_constraint_mismatch`
  - hierarchy/slot/visibility/size constraint drift
- `component_variant_mismatch`
  - component key/ref/variant mapping drift
- `missing_state`
  - required behavior state missing (baseline/candidate/both)
- `content_overflow`
  - text/content overflow-related mismatch
- `font_rendering_mismatch`
  - font fallback / rendering engine / browser rendering mismatch
- `breakpoint_mismatch`
  - viewport-driven responsive mismatch
- `environment_only_mismatch`
  - mismatch isolated to environment conditions only
- `manual_design_drift`
  - intentional/unintentional manual design edit drift from approved baseline
- `code_drift_from_approved_design`
  - implementation drift from approved design contract

## Storage Contract
Every reason entry must store:
- `axis`
- `reason_code`
- `reason_type`
- optional details (`node_id`, fields, baseline/candidate, etc.)

Run persistence requirements:
- `inputs.fidelity_reasons`
- `context_used.fidelity_reasons`

Snapshot shape:
- `version`
- `reasons[]`
- `counts.total`
- `counts.by_type`
- `updated_at`

## References
- Classifier: `src/fidelity/reasonTaxonomy.js`
- DB snapshot normalizer: `src/db/fidelityReasons.js`
- Scoring integration: `src/fidelity/phase4Scoring.js`
