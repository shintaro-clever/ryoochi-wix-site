"use strict";
const { annotateReasons, summarizeByType } = require("./reasonTaxonomy");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  const text = asText(value).toLowerCase();
  if (!text) return fallback;
  if (text === "true" || text === "visible" || text === "show") return true;
  if (text === "false" || text === "hidden" || text === "hide") return false;
  return fallback;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeVariant(value) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  for (const [key, raw] of Object.entries(source)) {
    const name = asText(key);
    const val = asText(raw);
    if (!name) continue;
    out[name] = val;
  }
  return out;
}

function normalizeTarget(target) {
  const source = target && typeof target === "object" ? target : {};
  return {
    page_id: asText(source.page?.id || source.page_id),
    page_name: asText(source.page?.name || source.page_name),
    frame_id: asText(source.frame?.id || source.frame_id),
    frame_name: asText(source.frame?.name || source.frame_name),
    node_ids: asArray(source.node_ids).map((item) => asText(item)).filter(Boolean),
  };
}

function normalizeNode(node) {
  const source = node && typeof node === "object" ? node : {};
  const component = source.component && typeof source.component === "object" ? source.component : {};
  const autoLayout = source.auto_layout && typeof source.auto_layout === "object" ? source.auto_layout : {};
  const slotObj = source.slot && typeof source.slot === "object" ? source.slot : {};
  const codeComponentObj = source.code_component && typeof source.code_component === "object" ? source.code_component : {};
  return {
    id: asText(source.id),
    type: asText(source.type),
    name: asText(source.name),
    parent_id: asText(source.parent_id),
    text: source.text === null || source.text === undefined ? null : String(source.text),
    visibility: asBoolean(source.visibility, true),
    slot: {
      name: asText(slotObj.name || source.slot_name || source.slot),
      role: asText(slotObj.role || source.slot_role),
    },
    code_component: {
      name: asText(codeComponentObj.name || source.code_component_name),
      slot: asText(codeComponentObj.slot || source.code_slot),
    },
    component: {
      kind: asText(component.kind),
      key: asText(component.key),
      ref_id: asText(component.ref_id),
      variant: normalizeVariant(component.variant),
    },
    auto_layout: {
      layout_mode: asText(autoLayout.layout_mode),
      primary_axis_sizing_mode: asText(autoLayout.primary_axis_sizing_mode),
      counter_axis_sizing_mode: asText(autoLayout.counter_axis_sizing_mode),
      primary_axis_align_items: asText(autoLayout.primary_axis_align_items),
      counter_axis_align_items: asText(autoLayout.counter_axis_align_items),
      layout_wrap: asText(autoLayout.layout_wrap),
      layout_positioning: asText(autoLayout.layout_positioning),
    },
  };
}

function listTargetMismatches(baseTarget, candTarget) {
  const out = [];
  const fields = ["page_id", "page_name", "frame_id", "frame_name"];
  for (const field of fields) {
    if ((baseTarget[field] || "") !== (candTarget[field] || "")) {
      out.push({
        kind: "target",
        field,
        baseline: baseTarget[field] || "",
        candidate: candTarget[field] || "",
      });
    }
  }
  const baseNodeIds = new Set(baseTarget.node_ids);
  const candNodeIds = new Set(candTarget.node_ids);
  for (const id of baseNodeIds) {
    if (!candNodeIds.has(id)) out.push({ kind: "target", field: "node_ids", baseline: id, candidate: "" });
  }
  for (const id of candNodeIds) {
    if (!baseNodeIds.has(id)) out.push({ kind: "target", field: "node_ids", baseline: "", candidate: id });
  }
  return out;
}

function indexNodes(nodes) {
  const map = new Map();
  for (const raw of asArray(nodes)) {
    const node = normalizeNode(raw);
    if (!node.id) continue;
    map.set(node.id, node);
  }
  return map;
}

function compareNodePairs(baseMap, candMap) {
  const out = {
    missing_in_candidate: [],
    extra_in_candidate: [],
    parent_mismatches: [],
    text_mismatches: [],
    auto_layout_mismatches: [],
    component_mismatches: [],
    hierarchy_mismatches: [],
    component_mapping_mismatches: [],
    slot_mismatches: [],
    visibility_mismatches: [],
    instance_variant_mismatches: [],
    reason_classification: {
      hierarchy: [],
      component_mapping: [],
      slot: [],
      visibility: [],
      instance_variant: [],
    },
  };

  function pushReason(category, reason) {
    out.reason_classification[category].push(reason);
  }

  for (const [id, baseNode] of baseMap.entries()) {
    const candNode = candMap.get(id);
    if (!candNode) {
      out.missing_in_candidate.push(id);
      const reason = { category: "hierarchy", reason_code: "missing_node", node_id: id };
      out.hierarchy_mismatches.push(reason);
      pushReason("hierarchy", reason);
      continue;
    }

    if ((baseNode.parent_id || "") !== (candNode.parent_id || "")) {
      const detail = { node_id: id, baseline: baseNode.parent_id || "", candidate: candNode.parent_id || "" };
      out.parent_mismatches.push(detail);
      const reason = { category: "hierarchy", reason_code: "parent_changed", ...detail };
      out.hierarchy_mismatches.push(reason);
      pushReason("hierarchy", reason);
    }

    if (baseNode.type === "TEXT" && baseNode.text !== candNode.text) {
      out.text_mismatches.push({ node_id: id, baseline: baseNode.text || "", candidate: candNode.text || "" });
    }

    const autoFields = [
      "layout_mode",
      "primary_axis_sizing_mode",
      "counter_axis_sizing_mode",
      "primary_axis_align_items",
      "counter_axis_align_items",
      "layout_wrap",
      "layout_positioning",
    ];
    const changedAutoFields = autoFields.filter((field) => (baseNode.auto_layout[field] || "") !== (candNode.auto_layout[field] || ""));
    if (changedAutoFields.length > 0) {
      out.auto_layout_mismatches.push({ node_id: id, fields: changedAutoFields });
    }

    const componentChanged =
      (baseNode.component.kind || "") !== (candNode.component.kind || "") ||
      (baseNode.component.key || "") !== (candNode.component.key || "");
    if (componentChanged) {
      const detail = {
        node_id: id,
        baseline: { kind: baseNode.component.kind || "", key: baseNode.component.key || "" },
        candidate: { kind: candNode.component.kind || "", key: candNode.component.key || "" },
      };
      out.component_mismatches.push(detail);
      const reason = { category: "component_mapping", reason_code: "component_key_changed", ...detail };
      out.component_mapping_mismatches.push(reason);
      pushReason("component_mapping", reason);
    }

    if (
      (baseNode.code_component.name || "") !== (candNode.code_component.name || "") ||
      (baseNode.code_component.slot || "") !== (candNode.code_component.slot || "")
    ) {
      const reason = {
        category: "component_mapping",
        reason_code: "code_component_mapping_changed",
        node_id: id,
        baseline: baseNode.code_component,
        candidate: candNode.code_component,
      };
      out.component_mapping_mismatches.push(reason);
      pushReason("component_mapping", reason);
    }

    if ((baseNode.slot.name || "") !== (candNode.slot.name || "") || (baseNode.slot.role || "") !== (candNode.slot.role || "")) {
      const reason = {
        category: "slot",
        reason_code: "slot_changed",
        node_id: id,
        baseline: baseNode.slot,
        candidate: candNode.slot,
      };
      out.slot_mismatches.push(reason);
      pushReason("slot", reason);
    }

    if (baseNode.visibility !== candNode.visibility) {
      const reason = {
        category: "visibility",
        reason_code: "visibility_changed",
        node_id: id,
        baseline: baseNode.visibility,
        candidate: candNode.visibility,
      };
      out.visibility_mismatches.push(reason);
      pushReason("visibility", reason);
    }

    if (baseNode.component.kind === "instance" || candNode.component.kind === "instance") {
      const baseVariant = stableStringify(baseNode.component.variant);
      const candVariant = stableStringify(candNode.component.variant);
      if (
        baseVariant !== candVariant ||
        (baseNode.component.ref_id || "") !== (candNode.component.ref_id || "")
      ) {
        const reason = {
          category: "instance_variant",
          reason_code: "instance_variant_changed",
          node_id: id,
          baseline: {
            ref_id: baseNode.component.ref_id || "",
            variant: baseNode.component.variant,
          },
          candidate: {
            ref_id: candNode.component.ref_id || "",
            variant: candNode.component.variant,
          },
        };
        out.instance_variant_mismatches.push(reason);
        pushReason("instance_variant", reason);
      }
    }
  }

  for (const [id] of candMap.entries()) {
    if (baseMap.has(id)) continue;
    out.extra_in_candidate.push(id);
    const reason = { category: "hierarchy", reason_code: "extra_node", node_id: id };
    out.hierarchy_mismatches.push(reason);
    pushReason("hierarchy", reason);
  }

  return out;
}

function computeStructuralRate(baseNodeCount, pairDiff) {
  const denominator = Math.max(baseNodeCount, 1);
  const weightedMismatch =
    pairDiff.missing_in_candidate.length * 4 +
    pairDiff.extra_in_candidate.length * 2 +
    pairDiff.parent_mismatches.length * 2 +
    pairDiff.auto_layout_mismatches.length +
    pairDiff.text_mismatches.length +
    pairDiff.component_mismatches.length +
    pairDiff.slot_mismatches.length +
    pairDiff.visibility_mismatches.length +
    pairDiff.instance_variant_mismatches.length;
  const raw = 1 - weightedMismatch / (denominator * 5);
  return Math.max(0, Math.min(1, raw));
}

function compareFigmaStructure(baseline, candidate, { threshold = 0.95 } = {}) {
  const baseTarget = normalizeTarget(baseline?.target_resolution || baseline?.target || {});
  const candTarget = normalizeTarget(candidate?.target_resolution || candidate?.target || {});
  const target_mismatches = listTargetMismatches(baseTarget, candTarget);

  const baseMap = indexNodes(baseline?.nodes);
  const candMap = indexNodes(candidate?.nodes);
  const pairDiff = compareNodePairs(baseMap, candMap);

  const structure_rate = computeStructuralRate(baseMap.size, pairDiff);
  const major_diff_detected =
    target_mismatches.length > 0 ||
    pairDiff.reason_classification.hierarchy.length > 0 ||
    pairDiff.reason_classification.component_mapping.length > 0;
  const pass = !major_diff_detected && structure_rate >= threshold;
  const classifiedReasons = annotateReasons(
    [
      ...pairDiff.reason_classification.hierarchy,
      ...pairDiff.reason_classification.component_mapping,
      ...pairDiff.reason_classification.slot,
      ...pairDiff.reason_classification.visibility,
      ...pairDiff.reason_classification.instance_variant,
    ],
    "structure"
  );

  return {
    threshold,
    major_diff_detected,
    structural_reproduction: {
      rate: structure_rate,
      pass,
      status: pass ? "good" : "bad",
    },
    diffs: {
      target_mismatches,
      missing_in_candidate: pairDiff.missing_in_candidate,
      extra_in_candidate: pairDiff.extra_in_candidate,
      parent_mismatches: pairDiff.parent_mismatches,
      auto_layout_mismatches: pairDiff.auto_layout_mismatches,
      text_mismatches: pairDiff.text_mismatches,
      component_mismatches: pairDiff.component_mismatches,
      hierarchy_mismatches: pairDiff.hierarchy_mismatches,
      component_mapping_mismatches: pairDiff.component_mapping_mismatches,
      slot_mismatches: pairDiff.slot_mismatches,
      visibility_mismatches: pairDiff.visibility_mismatches,
      instance_variant_mismatches: pairDiff.instance_variant_mismatches,
      reason_classification: pairDiff.reason_classification,
      reasons: classifiedReasons,
    },
    counts: {
      baseline_nodes: baseMap.size,
      candidate_nodes: candMap.size,
      target_mismatches: target_mismatches.length,
      missing_in_candidate: pairDiff.missing_in_candidate.length,
      extra_in_candidate: pairDiff.extra_in_candidate.length,
      parent_mismatches: pairDiff.parent_mismatches.length,
      auto_layout_mismatches: pairDiff.auto_layout_mismatches.length,
      text_mismatches: pairDiff.text_mismatches.length,
      component_mismatches: pairDiff.component_mismatches.length,
      hierarchy_mismatches: pairDiff.hierarchy_mismatches.length,
      component_mapping_mismatches: pairDiff.component_mapping_mismatches.length,
      slot_mismatches: pairDiff.slot_mismatches.length,
      visibility_mismatches: pairDiff.visibility_mismatches.length,
      instance_variant_mismatches: pairDiff.instance_variant_mismatches.length,
      reason_hierarchy: pairDiff.reason_classification.hierarchy.length,
      reason_component_mapping: pairDiff.reason_classification.component_mapping.length,
      reason_slot: pairDiff.reason_classification.slot.length,
      reason_visibility: pairDiff.reason_classification.visibility.length,
      reason_instance_variant: pairDiff.reason_classification.instance_variant.length,
      reason_types: summarizeByType(classifiedReasons),
    },
  };
}

module.exports = {
  compareFigmaStructure,
};
