const { assert } = require("./_helpers");
const { buildCorrectiveActionPlan } = require("../../src/fidelity/correctiveActionPlan");

async function run() {
  const plan = buildCorrectiveActionPlan({
    structure_diff: {
      diffs: {
        reasons: [
          { axis: "structure", reason_code: "instance_variant_changed" },
          { axis: "structure", reason_code: "slot_changed" },
        ],
      },
    },
    visual_diff: {
      reasons: [
        { axis: "visual", reason_code: "color_changed" },
        { axis: "visual", reason_code: "text_overflow" },
      ],
    },
    behavior_diff: {
      reasons: [
        { axis: "behavior", reason_code: "missing_state_candidate", state: "loading" },
      ],
    },
    execution_diff: {
      reasons: [
        { axis: "execution", reason_code: "environment_only_mismatch" },
        { axis: "execution", reason_code: "runtime_status_mismatch" },
      ],
    },
  });

  assert(plan.status === "ok", "plan status should be ok");
  assert(plan.summary.total_reasons >= 6, "reason count should be aggregated");
  assert(Array.isArray(plan.actions) && plan.actions.length >= 5, "actions should be grouped by category");
  assert(plan.actions.some((item) => item.category === "token_fix"), "token_fix should be generated");
  assert(plan.actions.some((item) => item.category === "layout_fix"), "layout_fix should be generated");
  assert(plan.actions.some((item) => item.category === "component_swap"), "component_swap should be generated");
  assert(plan.actions.some((item) => item.category === "state_addition"), "state_addition should be generated");
  assert(
    plan.actions.some((item) => item.category === "environment_alignment"),
    "environment_alignment should be generated"
  );
  assert(plan.actions.some((item) => item.category === "code_update"), "code_update should be generated");
}

module.exports = { run };
