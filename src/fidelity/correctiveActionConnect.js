"use strict";

const { buildCorrectiveActionPlan } = require("./correctiveActionPlan");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeProvider(value) {
  const text = asText(value).toLowerCase();
  return text === "github" || text === "figma" ? text : "";
}

function resolveCorrectiveAction(payload, selectors = {}) {
  const source = asObject(payload);
  const plan =
    source.corrective_action_plan && typeof source.corrective_action_plan === "object"
      ? source.corrective_action_plan
      : buildCorrectiveActionPlan(source);
  const key = asText(selectors.action_key);
  const category = asText(selectors.category);
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const action =
    actions.find((item) => key && asText(item && item.key) === key) ||
    actions.find((item) => category && asText(item && item.category) === category) ||
    null;
  return { plan, action };
}

function validateCorrectiveActionConnection(payload, selectors = {}, providerInput = "") {
  const provider = normalizeProvider(providerInput);
  const { plan, action } = resolveCorrectiveAction(payload, selectors);
  if (!action) {
    return {
      ok: false,
      failure_code: "validation_error",
      reason: "corrective_action_not_found",
      message: "corrective action not found",
      plan,
      action: null,
    };
  }
  const eligibleProviders = Array.isArray(action.eligible_providers) ? action.eligible_providers : [];
  if (!provider) {
    return {
      ok: false,
      failure_code: "validation_error",
      reason: "provider_required",
      message: "provider is required",
      plan,
      action,
    };
  }
  if (!eligibleProviders.includes(provider)) {
    return {
      ok: false,
      failure_code: "validation_error",
      reason: "provider_not_allowed_for_action",
      message: "provider is not allowed for this corrective action",
      plan,
      action,
    };
  }
  return {
    ok: true,
    provider,
    plan,
    action,
  };
}

module.exports = {
  normalizeProvider,
  resolveCorrectiveAction,
  validateCorrectiveActionConnection,
};
