const path = require('path');

function invalidResponse() {
  return {
    valid: false,
    failure_code: 'validation_error',
    error: 'INVALID_PATH'
  };
}

function validateTargetPath(raw) {
  if (raw === null || raw === undefined) {
    return { valid: true, normalized: null };
  }
  if (typeof raw !== 'string') {
    return invalidResponse();
  }

  const normalized = path.normalize(raw);

  if (normalized.includes('..')) {
    return invalidResponse();
  }

  if (path.isAbsolute(normalized)) {
    return invalidResponse();
  }

  return {
    valid: true,
    normalized
  };
}

module.exports = {
  validateTargetPath
};
