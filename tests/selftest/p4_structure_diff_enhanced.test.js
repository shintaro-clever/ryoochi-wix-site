const { assert } = require("./_helpers");
const { compareFigmaStructure } = require("../../src/fidelity/structureDiff");

async function run() {
  const baseline = {
    target_resolution: {
      page: { id: "1:1", name: "Landing" },
      frame: { id: "10:1", name: "Hero" },
      node_ids: ["10:1", "10:2", "10:3"],
    },
    nodes: [
      {
        id: "10:1",
        type: "FRAME",
        name: "Hero",
        parent_id: "1:1",
        visibility: true,
        slot: { name: "content", role: "container" },
        code_component: { name: "AppShell", slot: "content" },
        component: { kind: "none", key: null, ref_id: null },
        auto_layout: { layout_mode: "VERTICAL" },
      },
      {
        id: "10:2",
        type: "INSTANCE",
        name: "PrimaryButton",
        parent_id: "10:1",
        visibility: true,
        slot: { name: "actions", role: "primary_cta" },
        code_component: { name: "Button", slot: "actions" },
        component: {
          kind: "instance",
          key: "button-primary",
          ref_id: "50:1",
          variant: { size: "md", tone: "primary" },
        },
        auto_layout: { layout_mode: "NONE" },
      },
      {
        id: "10:3",
        type: "TEXT",
        name: "Title",
        parent_id: "10:1",
        text: "Welcome",
        visibility: true,
        slot: { name: "heading", role: "title" },
        code_component: { name: "Heading", slot: "heading" },
        component: { kind: "none", key: null, ref_id: null },
        auto_layout: { layout_mode: "NONE" },
      },
    ],
  };

  const candidate = {
    target_resolution: {
      page: { id: "1:1", name: "Landing" },
      frame: { id: "10:1", name: "Hero" },
      node_ids: ["10:1", "10:2", "10:3"],
    },
    nodes: [
      {
        id: "10:1",
        type: "FRAME",
        name: "Hero",
        parent_id: "1:1",
        visibility: true,
        slot: { name: "main_content", role: "container" },
        code_component: { name: "AppShell", slot: "main_content" },
        component: { kind: "none", key: null, ref_id: null },
        auto_layout: { layout_mode: "VERTICAL" },
      },
      {
        id: "10:2",
        type: "INSTANCE",
        name: "PrimaryButton",
        parent_id: "10:3",
        visibility: false,
        slot: { name: "actions", role: "primary_cta" },
        code_component: { name: "Button", slot: "actions" },
        component: {
          kind: "instance",
          key: "button-primary",
          ref_id: "50:2",
          variant: { size: "lg", tone: "primary" },
        },
        auto_layout: { layout_mode: "NONE" },
      },
      {
        id: "10:3",
        type: "TEXT",
        name: "Title",
        parent_id: "10:1",
        text: "Welcome",
        visibility: true,
        slot: { name: "heading", role: "title" },
        code_component: { name: "Heading", slot: "heading" },
        component: { kind: "none", key: null, ref_id: null },
        auto_layout: { layout_mode: "NONE" },
      },
    ],
  };

  const result = compareFigmaStructure(baseline, candidate, { threshold: 0.95 });
  assert(result.major_diff_detected === true, "enhanced diff should detect major diff");
  assert(result.structural_reproduction.pass === false, "enhanced diff should fail");
  assert(result.diffs.hierarchy_mismatches.length >= 1, "hierarchy mismatches should be detected");
  assert(result.diffs.component_mapping_mismatches.length >= 1, "component mapping mismatches should be detected");
  assert(result.diffs.slot_mismatches.length >= 1, "slot mismatches should be detected");
  assert(result.diffs.visibility_mismatches.length >= 1, "visibility mismatches should be detected");
  assert(result.diffs.instance_variant_mismatches.length >= 1, "instance/variant mismatches should be detected");
  assert(result.counts.reason_hierarchy >= 1, "reason_hierarchy count should be present");
  assert(result.counts.reason_component_mapping >= 1, "reason_component_mapping count should be present");
  assert(result.counts.reason_slot >= 1, "reason_slot count should be present");
  assert(result.counts.reason_visibility >= 1, "reason_visibility count should be present");
  assert(result.counts.reason_instance_variant >= 1, "reason_instance_variant count should be present");
}

module.exports = { run };
