const { db } = require('../db');
const { validateTargetPath } = require('./targetPath');

const selectConnectionStmt = db.prepare(
  'SELECT id FROM connections WHERE tenant_id = ? AND id = ? LIMIT 1'
);

const hasRunningRunStmt = db.prepare(
  `SELECT 1 FROM runs WHERE tenant_id = ? AND project_id = ? AND status = 'running' LIMIT 1`
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

  return {
    valid: true,
    normalized: {
      connection_id: connectionId,
      project_id: projectId,
      target_path: targetResult.normalized
    }
  };
}

module.exports = {
  validateRunInputs
};
