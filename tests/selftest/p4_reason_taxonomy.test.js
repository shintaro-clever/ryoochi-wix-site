const { assert } = require("./_helpers");
const {
  REASON_TYPES,
  collectClassifiedReasons,
} = require("../../src/fidelity/reasonTaxonomy");
const { compareVisualDiff } = require("../../src/fidelity/visualDiff");
const { compareFigmaStructure } = require("../../src/fidelity/structureDiff");
const { compareBehaviorDiff } = require("../../src/fidelity/behaviorDiff");
const { compareExecutionDiff } = require("../../src/fidelity/executionDiff");
const { normalizeFidelityReasonSnapshot } = require("../../src/db/fidelityReasons");

async function run() {
  const required = [
    "token_mismatch",
    "layout_constraint_mismatch",
    "component_variant_mismatch",
    "missing_state",
    "content_overflow",
    "font_rendering_mismatch",
    "breakpoint_mismatch",
    "environment_only_mismatch",
    "manual_design_drift",
    "code_drift_from_approved_design",
  ];
  for (const item of required) {
    assert(REASON_TYPES.includes(item), `reason type must include ${item}`);
  }

  const visual = compareVisualDiff(
    { nodes: [{ id: "n1", color: { text: "#111", background: "#fff", fill: "#fff" } }] },
    { nodes: [{ id: "n1", color: { text: "#000", background: "#fff", fill: "#fff" } }] }
  );
  assert(visual.reasons.some((r) => r.reason_type === "token_mismatch"), "visual reason should classify token mismatch");

  const structure = compareFigmaStructure(
    {
      target_resolution: { page: { id: "1", name: "P" }, frame: { id: "2", name: "F" }, node_ids: ["a"] },
      nodes: [{ id: "a", component: { kind: "instance", ref_id: "x", variant: { size: "sm" } }, parent_id: "2" }],
    },
    {
      target_resolution: { page: { id: "1", name: "P" }, frame: { id: "2", name: "F" }, node_ids: ["a"] },
      nodes: [{ id: "a", component: { kind: "instance", ref_id: "y", variant: { size: "lg" } }, parent_id: "3" }],
    }
  );
  assert(
    structure.diffs.reasons.some((r) => r.reason_type === "component_variant_mismatch"),
    "structure should classify component variant mismatch"
  );
  assert(
    structure.diffs.reasons.some((r) => r.reason_type === "layout_constraint_mismatch"),
    "structure should classify layout constraint mismatch"
  );

  const behavior = compareBehaviorDiff(
    [{ state: "hover", attributes: { visible: true, enabled: true, loading: false, modal_open: false, text: "A" } }],
    []
  );
  assert(behavior.reasons.some((r) => r.reason_type === "missing_state"), "behavior should classify missing state");

  const execution = compareExecutionDiff(
    {
      font_fallback: ["A"],
      viewport: { width: 1440, height: 900 },
      theme: "light",
      data_state: "v1",
      browser: { name: "chromium", version: "1", engine: "blink" },
      runtime_status: "ok",
      network_contract_status: "ok",
      performance_guardrail_status: "ok",
    },
    {
      font_fallback: ["B"],
      viewport: { width: 1280, height: 720 },
      theme: "dark",
      data_state: "v2",
      browser: { name: "firefox", version: "2", engine: "gecko" },
      runtime_status: "ok",
      network_contract_status: "ok",
      performance_guardrail_status: "ok",
    }
  );
  assert(
    execution.reasons.some((r) => r.reason_type === "font_rendering_mismatch"),
    "execution should classify font/rendering mismatch"
  );
  assert(
    execution.reasons.some((r) => r.reason_type === "breakpoint_mismatch"),
    "execution should classify breakpoint mismatch"
  );
  assert(
    execution.reasons.some((r) => r.reason_type === "environment_only_mismatch"),
    "execution should classify environment-only mismatch"
  );

  const collected = collectClassifiedReasons(
    {
      structure_diff: structure,
      visual_diff: visual,
      behavior_diff: behavior,
      execution_diff: execution,
    },
    {
      manual_design_drift: true,
      code_drift_from_approved_design: true,
    }
  );
  const snapshot = normalizeFidelityReasonSnapshot(collected);

  assert(snapshot.counts.total > 0, "reason snapshot should contain reasons");
  assert(snapshot.counts.by_type.manual_design_drift >= 1, "manual design drift should be recorded");
  assert(
    snapshot.counts.by_type.code_drift_from_approved_design >= 1,
    "code drift from approved design should be recorded"
  );
}

module.exports = { run };
