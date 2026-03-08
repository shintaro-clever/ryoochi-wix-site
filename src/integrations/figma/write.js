const {
  requestFigma,
  resolveFigmaToken,
  parseFigmaFileKey,
  integrationError,
  validationError,
} = require("./client");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNodeIdList(value) {
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
  if (!text) return "simple_property_update";
  if (text === "text_update" || text === "text update") return "text_update";
  if (text === "node_create" || text === "node create" || text === "create") return "node_create";
  if (text === "simple_property_update" || text === "property_update" || text === "simple property update" || text === "update") {
    return "simple_property_update";
  }
  if (text === "layout_update" || text === "layout update") return "layout_update";
  return "";
}

function normalizeWriteChanges(changesInput = [], fallback = {}) {
  const list = Array.isArray(changesInput) ? changesInput : [];
  const normalized = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const changeType = normalizeChangeType(raw.change_type || raw.action);
    if (!changeType) {
      throw validationError("unsupported change_type");
    }
    const nodeId = normalizeText(raw.node_id);
    const parentNodeId = normalizeText(raw.parent_node_id);
    if (changeType === "text_update") {
      if (!nodeId) throw validationError("text_update requires node_id");
      const textValue =
        typeof raw.text === "string"
          ? raw.text
          : raw.payload && typeof raw.payload === "object" && typeof raw.payload.text === "string"
            ? raw.payload.text
            : null;
      if (typeof textValue !== "string") throw validationError("text_update requires text");
      normalized.push({
        change_type: changeType,
        node_id: nodeId,
        payload: { text: textValue },
      });
      continue;
    }
    if (changeType === "node_create") {
      if (!parentNodeId) throw validationError("node_create requires parent_node_id");
      const nodeType = normalizeText(raw.node_type || "TEXT");
      normalized.push({
        change_type: changeType,
        parent_node_id: parentNodeId,
        payload: {
          node_type: nodeType || "TEXT",
          name: normalizeText(raw.name) || "New Node",
          text:
            typeof raw.text === "string"
              ? raw.text
              : raw.payload && typeof raw.payload === "object" && typeof raw.payload.text === "string"
                ? raw.payload.text
                : "",
          properties:
            raw.properties && typeof raw.properties === "object"
              ? raw.properties
              : raw.payload && typeof raw.payload === "object" && raw.payload.properties && typeof raw.payload.properties === "object"
                ? raw.payload.properties
                : {},
          layout:
            raw.layout && typeof raw.layout === "object"
              ? raw.layout
              : raw.payload && typeof raw.payload === "object" && raw.payload.layout && typeof raw.payload.layout === "object"
                ? raw.payload.layout
                : {},
        },
      });
      continue;
    }
    if (changeType === "simple_property_update") {
      if (!nodeId) throw validationError("simple_property_update requires node_id");
      const properties =
        raw.properties && typeof raw.properties === "object"
          ? raw.properties
          : raw.payload && typeof raw.payload === "object" && raw.payload.properties && typeof raw.payload.properties === "object"
            ? raw.payload.properties
            : {};
      normalized.push({
        change_type: changeType,
        node_id: nodeId,
        payload: { properties },
      });
      continue;
    }
    if (changeType === "layout_update") {
      if (!nodeId) throw validationError("layout_update requires node_id");
      const layout =
        raw.layout && typeof raw.layout === "object"
          ? raw.layout
          : raw.payload && typeof raw.payload === "object" && raw.payload.layout && typeof raw.payload.layout === "object"
            ? raw.payload.layout
            : {};
      normalized.push({
        change_type: changeType,
        node_id: nodeId,
        payload: { layout },
      });
    }
  }
  if (normalized.length > 0) {
    return normalized.slice(0, 200);
  }
  const fallbackType = normalizeChangeType(fallback.change_type);
  if (!fallbackType) {
    throw validationError("change_type or changes is required");
  }
  if (fallbackType === "node_create") {
    const parentNodeId = normalizeText(fallback.parent_node_id);
    if (!parentNodeId) throw validationError("node_create requires parent_node_id");
    return [
      {
        change_type: fallbackType,
        parent_node_id: parentNodeId,
        payload: {
          node_type: normalizeText(fallback.node_type || "TEXT") || "TEXT",
          name: normalizeText(fallback.name) || "New Node",
          text: typeof fallback.text === "string" ? fallback.text : "",
          properties: fallback.properties && typeof fallback.properties === "object" ? fallback.properties : {},
          layout: fallback.layout && typeof fallback.layout === "object" ? fallback.layout : {},
        },
      },
    ];
  }
  const nodeId = normalizeText(fallback.node_id);
  if (!nodeId) {
    throw validationError(`${fallbackType} requires node_id`);
  }
  if (fallbackType === "text_update") {
    if (typeof fallback.text !== "string") throw validationError("text_update requires text");
    return [{ change_type: fallbackType, node_id: nodeId, payload: { text: fallback.text } }];
  }
  if (fallbackType === "layout_update") {
    return [{ change_type: fallbackType, node_id: nodeId, payload: { layout: fallback.layout && typeof fallback.layout === "object" ? fallback.layout : {} } }];
  }
  return [{ change_type: fallbackType, node_id: nodeId, payload: { properties: fallback.properties && typeof fallback.properties === "object" ? fallback.properties : {} } }];
}

function mapToProviderOperation(change) {
  const base = { op: change.change_type };
  if (change.node_id) base.node_id = change.node_id;
  if (change.parent_node_id) base.parent_node_id = change.parent_node_id;
  return { ...base, ...(change.payload && typeof change.payload === "object" ? change.payload : {}) };
}

async function readFileMeta({ fileKey, token }) {
  const fileRes = await requestFigma({
    method: "GET",
    path: `/v1/files/${encodeURIComponent(fileKey)}`,
    token,
  });
  return {
    version: typeof fileRes.json?.version === "string" ? fileRes.json.version : "",
    last_modified: typeof fileRes.json?.lastModified === "string" ? fileRes.json.lastModified : "",
  };
}

async function applyFigmaControlledWrite({
  figmaFile = "",
  figmaFileKey = "",
  secretId = "",
  changes = [],
  fallback = {},
  dryRun = false,
} = {}) {
  const token = resolveFigmaToken(secretId);
  const fileKey = parseFigmaFileKey({ figmaFileKey, figmaFile });
  const normalizedChanges = normalizeWriteChanges(changes, fallback);
  const targetNodeIds = normalizeNodeIdList(
    normalizedChanges.map((item) => item.node_id || item.parent_node_id || "")
  );
  if (dryRun) {
    return {
      dry_run: true,
      file_key: fileKey,
      applied_changes: normalizedChanges,
      updated_node_ids: targetNodeIds,
      before: null,
      after: null,
    };
  }
  const before = await readFileMeta({ fileKey, token });
  const writeRes = await requestFigma({
    method: "POST",
    path: `/v1/files/${encodeURIComponent(fileKey)}/nodes:batch_update`,
    token,
    body: {
      operations: normalizedChanges.map(mapToProviderOperation),
    },
  }).catch((error) => {
    if (error && error.code) throw error;
    throw integrationError("figma write failed", { status: 502, reason: "service_unavailable" });
  });
  const after = await readFileMeta({ fileKey, token });
  const updatedNodeIds = normalizeNodeIdList(
    Array.isArray(writeRes.json?.updated_node_ids)
      ? writeRes.json.updated_node_ids
      : targetNodeIds
  );
  return {
    dry_run: false,
    file_key: fileKey,
    applied_changes: normalizedChanges,
    updated_node_ids: updatedNodeIds,
    before,
    after: {
      version: typeof writeRes.json?.version === "string" ? writeRes.json.version : after.version,
      last_modified:
        typeof writeRes.json?.lastModified === "string" ? writeRes.json.lastModified : after.last_modified,
    },
  };
}

module.exports = {
  applyFigmaControlledWrite,
  normalizeWriteChanges,
};
