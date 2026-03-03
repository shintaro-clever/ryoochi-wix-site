const { db } = require('../db');
const { validateTargetPath } = require('./targetPath');

const selectConnectionStmt = db.prepare(
  'SELECT id FROM connections WHERE tenant_id = ? AND id = ? LIMIT 1'
);

const hasRunningRunStmt = db.prepare(
  `SELECT 1 FROM runs WHERE tenant_id = ? AND project_id = ? AND status = 'running' LIMIT 1`
);
const selectProjectStmt = db.prepare(
  'SELECT id, drive_folder_id FROM projects WHERE tenant_id = ? AND id = ? LIMIT 1'
);

function notFound() {
  return {
    valid: false,
    failure_code: 'not_found',
    error: 'CONNECTION_NOT_FOUND'
  };
}

function concurrentRun() {
  return {
    valid: false,
    failure_code: 'concurrent_run_limit',
    status: 409,
    error: 'RUN_ALREADY_IN_PROGRESS'
  };
}

function manualRuleError(error, details = {}) {
  return {
    valid: false,
    failure_code: 'validation_error',
    status: 400,
    error,
    details
  };
}

function normalizeGoogleNativeType(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return '';
  if (text === 'docs' || text === 'doc') return 'docs';
  if (text === 'slides' || text === 'slide') return 'slides';
  if (text === 'sheets' || text === 'sheet') return 'sheets';
  return '';
}

function buildTimestampForName(date = new Date()) {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function normalizeThreadTitle(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120).trim();
}

function isGoogleDriveExportRequested(payload = {}) {
  const provider = typeof payload.export_provider === 'string' ? payload.export_provider.trim().toLowerCase() : '';
  if (provider === 'google_drive' || provider === 'google-drive') {
    return true;
  }
  return Boolean(payload.google_native_type);
}

function applyManualDriveRules(tenantId, payload = {}) {
  if (!isGoogleDriveExportRequested(payload)) {
    return { ok: true, normalized: {} };
  }
  const projectId = typeof payload.project_id === 'string' ? payload.project_id.trim() : '';
  if (!projectId) {
    return manualRuleError('PROJECT_REQUIRED_FOR_DRIVE_EXPORT');
  }
  const project = selectProjectStmt.get(tenantId, projectId);
  if (!project) {
    return notFound();
  }
  const folderId = typeof project.drive_folder_id === 'string' ? project.drive_folder_id.trim() : '';
  if (!folderId) {
    return manualRuleError('DRIVE_FOLDER_NOT_CONFIGURED');
  }
  const nativeType = normalizeGoogleNativeType(payload.google_native_type);
  if (!nativeType) {
    return manualRuleError('GOOGLE_NATIVE_TYPE_REQUIRED', { allowed: ['docs', 'slides', 'sheets'] });
  }
  const threadTitle = normalizeThreadTitle(payload.thread_title);
  if (!threadTitle) {
    return manualRuleError('THREAD_TITLE_REQUIRED');
  }
  return {
    ok: true,
    normalized: {
      export_provider: 'google_drive',
      google_native_type: nativeType,
      drive_folder_id: folderId,
      create_new_file: true,
      output_name: `${threadTitle}-${buildTimestampForName()}`
    }
  };
}

function validateRunInputs(tenantId, inputs = {}) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }
  const payload = typeof inputs === 'object' && inputs !== null ? inputs : {};

  const connectionId = payload.connection_id || null;
  if (connectionId) {
    const connectionRow = selectConnectionStmt.get(tenantId, connectionId);
    if (!connectionRow) {
      return notFound();
    }
  }

  const targetResult = validateTargetPath(payload.target_path ?? null);
  if (!targetResult.valid) {
    return targetResult;
  }

  const projectId = payload.project_id || null;
  if (projectId) {
    const runningExists = hasRunningRunStmt.get(tenantId, projectId);
    if (runningExists) {
      return concurrentRun();
    }
  }

  const manualRules = applyManualDriveRules(tenantId, payload);
  if (!manualRules.ok) {
    return manualRules;
  }

  return {
    valid: true,
    normalized: {
      connection_id: connectionId,
      project_id: projectId,
      target_path: targetResult.normalized,
      ...manualRules.normalized
    }
  };
}

module.exports = {
  validateRunInputs
};
