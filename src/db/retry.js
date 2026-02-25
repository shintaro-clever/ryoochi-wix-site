const MAX_RETRIES = 3;
const RETRY_WAIT_MS = 100;

const RETRYABLE_CODES = new Set([
  "SQLITE_BUSY",
  "SQLITE_BUSY_RECOVERY",
  "SQLITE_BUSY_SNAPSHOT",
]);

function sleep(ms) {
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, ms);
}

function isBusyError(error) {
  return Boolean(error && RETRYABLE_CODES.has(error.code));
}

function toServiceUnavailableError(lastError) {
  const error = new Error("database is busy");
  error.status = 503;
  error.failure_code = "service_unavailable";
  error.code = "SQLITE_BUSY";
  error.cause = lastError;
  return error;
}

function withRetry(fn) {
  let lastBusyError = null;

  for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
    try {
      return fn();
    } catch (error) {
      if (!isBusyError(error)) {
        throw error;
      }
      lastBusyError = error;
      if (retry === MAX_RETRIES) {
        throw toServiceUnavailableError(lastBusyError);
      }
      sleep(RETRY_WAIT_MS);
    }
  }

  throw toServiceUnavailableError(lastBusyError);
}

module.exports = {
  withRetry,
};
