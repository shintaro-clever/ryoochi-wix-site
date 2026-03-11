"use strict";

const crypto = require("crypto");
const { db, DEFAULT_TENANT } = require("./index");
const { withRetry } = require("./retry");

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value || {});
}

function fromJson(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    audit_event_draft_id: row.id,
    tenant_id: row.tenant_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    event_type: row.event_type,
    draft_state: row.draft_state,
    commit_condition: row.commit_condition,
    meta: fromJson(row.meta_json, {}),
    committed_at: row.committed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createAuditEventDraft({
  tenantId = DEFAULT_TENANT,
  entityType,
  entityId,
  eventType,
  draftState = "draft",
  commitCondition,
  meta = {},
  committedAt = null,
  dbConn = db,
} = {}) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  withRetry(() =>
    dbConn.prepare(
      `INSERT INTO audit_event_drafts(
        tenant_id,id,entity_type,entity_id,event_type,draft_state,commit_condition,meta_json,committed_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      tenantId,
      id,
      entityType,
      entityId,
      eventType,
      draftState,
      commitCondition,
      toJson(meta),
      committedAt,
      ts,
      ts
    )
  );
  return getAuditEventDraft({ tenantId, auditEventDraftId: id, dbConn });
}

function getAuditEventDraft({
  tenantId = DEFAULT_TENANT,
  auditEventDraftId,
  dbConn = db,
} = {}) {
  const row = withRetry(() =>
    dbConn.prepare(
      `SELECT tenant_id,id,entity_type,entity_id,event_type,draft_state,commit_condition,meta_json,committed_at,created_at,updated_at
       FROM audit_event_drafts
       WHERE tenant_id=? AND id=?
       LIMIT 1`
    ).get(tenantId, auditEventDraftId)
  );
  return mapRow(row);
}

function listAuditEventDraftsByEntity({
  tenantId = DEFAULT_TENANT,
  entityType,
  entityId,
  dbConn = db,
} = {}) {
  const rows = withRetry(() =>
    dbConn.prepare(
      `SELECT tenant_id,id,entity_type,entity_id,event_type,draft_state,commit_condition,meta_json,committed_at,created_at,updated_at
       FROM audit_event_drafts
       WHERE tenant_id=? AND entity_type=? AND entity_id=?
       ORDER BY created_at ASC`
    ).all(tenantId, entityType, entityId)
  );
  return rows.map(mapRow).filter(Boolean);
}

function commitLatestAuditDraft({
  tenantId = DEFAULT_TENANT,
  entityType,
  entityId,
  eventType,
  dbConn = db,
} = {}) {
  const current = withRetry(() =>
    dbConn.prepare(
      `SELECT id
       FROM audit_event_drafts
       WHERE tenant_id=? AND entity_type=? AND entity_id=? AND event_type=? AND draft_state='draft'
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(tenantId, entityType, entityId, eventType)
  );
  if (!current) return null;
  const committedAt = nowIso();
  withRetry(() =>
    dbConn.prepare(
      `UPDATE audit_event_drafts
       SET draft_state='committed', committed_at=?, updated_at=?
       WHERE tenant_id=? AND id=?`
    ).run(committedAt, committedAt, tenantId, current.id)
  );
  return getAuditEventDraft({ tenantId, auditEventDraftId: current.id, dbConn });
}

module.exports = {
  createAuditEventDraft,
  getAuditEventDraft,
  listAuditEventDraftsByEntity,
  commitLatestAuditDraft,
};
