function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNodeIds(value) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    const id = normalizeText(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeChangeType(value) {
  const text = normalizeText(value).toLowerCase();
  if (text === "create" || text === "update" || text === "delete") {
    return text;
  }
  if (text === "text_update" || text === "text update" || text === "text") return "text_update";
  if (text === "node_create" || text === "node create") return "node_create";
  if (text === "simple_property_update" || text === "simple property update" || text === "property_update") {
    return "simple_property_update";
  }
  if (text === "layout_update" || text === "layout update") return "layout_update";
  if (text === "structure" || text === "style" || text === "component") {
    return "update";
  }
  return "update";
}

function normalizeImpactLevel(value, fallback = "medium") {
  const text = normalizeText(value).toLowerCase();
  if (text === "low" || text === "medium" || text === "high") return text;
  return fallback;
}

function normalizeChanges(body, targetNodeIds) {
  const list = Array.isArray(body?.changes) ? body.changes : [];
  if (list.length > 0) {
    return list
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const nodeId = normalizeText(entry.node_id);
        return {
          change_type: normalizeChangeType(entry.change_type || entry.action),
          node_id: nodeId,
          component_id: normalizeText(entry.component_id),
          component_name: normalizeText(entry.component_name),
          component_key: normalizeText(entry.component_key),
          component_set_id: normalizeText(entry.component_set_id),
          component_set_name: normalizeText(entry.component_set_name),
          summary: normalizeText(entry.summary),
          structure_impact: normalizeImpactLevel(entry.structure_impact, "medium"),
          visual_impact: normalizeImpactLevel(entry.visual_impact, "medium"),
        };
      })
      .filter(Boolean)
      .slice(0, 200);
  }
  const changeType = normalizeChangeType(body?.change_type);
  if (targetNodeIds.length === 0) {
    return [
      {
        change_type: changeType,
        node_id: "",
        component_id: normalizeText(body?.component_id),
        component_name: normalizeText(body?.component_name),
        component_key: normalizeText(body?.component_key),
        component_set_id: normalizeText(body?.component_set_id),
        component_set_name: normalizeText(body?.component_set_name),
        summary: "",
        structure_impact: normalizeImpactLevel(body?.structure_impact, "medium"),
        visual_impact: normalizeImpactLevel(body?.visual_impact, "medium"),
      },
    ];
  }
  return targetNodeIds.slice(0, 200).map((nodeId) => ({
    change_type: changeType,
    node_id: nodeId,
    component_id: normalizeText(body?.component_id),
    component_name: normalizeText(body?.component_name),
    component_key: normalizeText(body?.component_key),
    component_set_id: normalizeText(body?.component_set_id),
    component_set_name: normalizeText(body?.component_set_name),
    summary: "",
    structure_impact: normalizeImpactLevel(body?.structure_impact, "medium"),
    visual_impact: normalizeImpactLevel(body?.visual_impact, "medium"),
  }));
}

function collectImpact(changes, key) {
  const levels = new Set();
  for (const item of changes) {
    levels.add(item && typeof item === "object" ? item[key] : "");
  }
  if (levels.has("high")) return "high";
  if (levels.has("medium")) return "medium";
  return "low";
}

function buildFigmaWritePlan({ body = {}, run = {} } = {}) {
  const shared = run.inputs?.shared_environment && typeof run.inputs.shared_environment === "object"
    ? run.inputs.shared_environment
    : {};
  const figmaCtx = run.inputs?.connection_context?.figma && typeof run.inputs.connection_context.figma === "object"
    ? run.inputs.connection_context.figma
    : {};
  const target = figmaCtx.target && typeof figmaCtx.target === "object" ? figmaCtx.target : {};
  const pageId = normalizeText(body.page_id) || normalizeText(target.page_id);
  const pageName = normalizeText(body.page_name) || normalizeText(target.page_name);
  const frameId = normalizeText(body.frame_id) || normalizeText(target.frame_id);
  const frameName = normalizeText(body.frame_name) || normalizeText(target.frame_name);
  const nodeIds = normalizeNodeIds(body.node_ids);
  const nodeIdSingle = normalizeText(body.node_id);
  const resolvedNodeIds =
    nodeIds.length > 0
      ? nodeIds
      : nodeIdSingle
        ? [nodeIdSingle]
        : normalizeNodeIds(target.node_ids);
  const fileKey =
    normalizeText(body.figma_file_key) ||
    normalizeText(figmaCtx.file_key) ||
    normalizeText(shared.figma_file_key);
  const changes = normalizeChanges(body, resolvedNodeIds);
  return {
    operation_type: "figma.apply_changes",
    file_key: fileKey,
    target: {
      page_id: pageId,
      page_name: pageName,
      frame_id: frameId,
      frame_name: frameName,
      node_ids: resolvedNodeIds,
      component_id: normalizeText(body.component_id),
      component_name: normalizeText(body.component_name),
      component_key: normalizeText(body.component_key),
      component_set_id: normalizeText(body.component_set_id),
      component_set_name: normalizeText(body.component_set_name),
    },
    change_type: changes[0]?.change_type || "update",
    changes,
    structure_impact: {
      level: collectImpact(changes, "structure_impact"),
      summary: `structure impact ${collectImpact(changes, "structure_impact")}`,
    },
    visual_impact: {
      level: collectImpact(changes, "visual_impact"),
      summary: `visual impact ${collectImpact(changes, "visual_impact")}`,
    },
    expected_artifacts: {
      updated_targets: resolvedNodeIds,
      before_after: "recorded",
      fidelity_result: "recorded",
    },
    confirm_required_reason: "external figma write requires explicit confirmation",
    write_guard: figmaCtx.write_guard && typeof figmaCtx.write_guard === "object"
      ? {
          writable_scope: normalizeText(figmaCtx.write_guard.writable_scope),
          requires_confirmation: Boolean(figmaCtx.write_guard.requires_confirmation),
          reason: normalizeText(figmaCtx.write_guard.reason) || null,
        }
      : { writable_scope: "", requires_confirmation: true, reason: "missing_write_guard" },
  };
}

module.exports = {
  buildFigmaWritePlan,
};
