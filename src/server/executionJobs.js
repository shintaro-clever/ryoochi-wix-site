"use strict";

const { normalizeExecutionJob } = require("../types/executionJob");

function toExecutionJobApi(job) {
  return normalizeExecutionJob(job || {});
}

module.exports = {
  toExecutionJobApi,
};
