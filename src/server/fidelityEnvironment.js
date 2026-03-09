"use strict";

function validationError(message) {
  const err = new Error(message || "validation failed");
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  err.failure_code = "validation_error";
  return err;
}

const ALLOWED_ENVIRONMENTS = new Set(["localhost", "staging", "production"]);
const ALLOWED_THEMES = new Set(["light", "dark", "system"]);
const ALLOWED_AUTH_STATES = new Set(["anonymous", "member", "admin"]);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeEnvironmentName(value, fallback = "staging") {
  const text = asText(value).toLowerCase();
  if (!text) return fallback;
  if (!ALLOWED_ENVIRONMENTS.has(text)) {
    throw validationError("comparison environment must be localhost|staging|production");
  }
  return text;
}

function normalizeEnvironmentList(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const env = normalizeEnvironmentName(item, "");
    if (!env || seen.has(env)) continue;
    seen.add(env);
    out.push(env);
  }
  return out.length > 0 ? out : ["localhost", "staging", "production"];
}

function normalizeTheme(value) {
  const text = asText(value).toLowerCase();
  if (!text) return "light";
  if (!ALLOWED_THEMES.has(text)) {
    throw validationError("theme must be light|dark|system");
  }
  return text;
}

function normalizeAuthState(value, fallback = "anonymous") {
  const text = asText(value).toLowerCase();
  if (!text) return fallback;
  if (!ALLOWED_AUTH_STATES.has(text)) {
    throw validationError("auth_state must be anonymous|member|admin");
  }
  return text;
}

function normalizeViewport(value) {
  const source = asObject(value);
  const preset = asText(source.preset || source.name).toLowerCase();
  const widthRaw = Number(source.width);
  const heightRaw = Number(source.height);
  const width = Number.isFinite(widthRaw) ? Math.round(widthRaw) : 0;
  const height = Number.isFinite(heightRaw) ? Math.round(heightRaw) : 0;
  if ((width > 0 && height <= 0) || (height > 0 && width <= 0)) {
    throw validationError("viewport width/height must be provided together");
  }
  if (width > 0 && height > 0) {
    return {
      preset: preset || "custom",
      width,
      height,
    };
  }
  if (preset === "mobile") return { preset: "mobile", width: 390, height: 844 };
  if (preset === "tablet") return { preset: "tablet", width: 768, height: 1024 };
  if (preset === "desktop" || !preset) return { preset: "desktop", width: 1440, height: 900 };
  throw validationError("viewport preset must be desktop|tablet|mobile or custom width/height");
}

function normalizeFixtureData(value) {
  const source = asObject(value);
  const flags = source.flags && typeof source.flags === "object" && !Array.isArray(source.flags) ? source.flags : {};
  return {
    mode: asText(source.mode || "seeded") || "seeded",
    dataset_id: asText(source.dataset_id || source.dataset || "baseline") || "baseline",
    snapshot_id: asText(source.snapshot_id || "latest") || "latest",
    seed: asText(source.seed || "default") || "default",
    flags,
  };
}

function resolveEnvUrl(sharedEnvironment, envName, envBody) {
  const bodyObj = asObject(envBody);
  const explicit =
    asText(bodyObj.url) ||
    asText(bodyObj.base_url);
  if (explicit) return explicit;

  const shared = asObject(sharedEnvironment);
  if (envName === "localhost") {
    return (
      asText(shared.localhost_base_url) ||
      asText(shared.local_base_url) ||
      "http://127.0.0.1:3000"
    );
  }
  if (envName === "staging") {
    return asText(shared.staging_base_url) || asText(shared.staging_url) || "";
  }
  return asText(shared.production_base_url) || asText(shared.production_url) || "";
}

function normalizeEnvironmentEntry(sharedEnvironment, envName, envBody, authDefault) {
  const bodyObj = asObject(envBody);
  return {
    name: envName,
    url: resolveEnvUrl(sharedEnvironment, envName, bodyObj),
    theme: normalizeTheme(bodyObj.theme),
    auth_state: normalizeAuthState(bodyObj.auth_state, authDefault),
  };
}

function buildFidelityEnvironmentContext({
  body = {},
  inputs = {},
  sharedEnvironment = {},
} = {}) {
  const bodyObj = asObject(body);
  const inputsObj = asObject(inputs);
  const fidelityBody = asObject(bodyObj.fidelity_environment);
  const fidelityInputs = asObject(inputsObj.fidelity_environment);
  const merged = {
    ...fidelityInputs,
    ...fidelityBody,
  };

  const environmentsSource = asObject(merged.environments);
  const localhost = normalizeEnvironmentEntry(sharedEnvironment, "localhost", environmentsSource.localhost, "admin");
  const staging = normalizeEnvironmentEntry(sharedEnvironment, "staging", environmentsSource.staging, "admin");
  const production = normalizeEnvironmentEntry(sharedEnvironment, "production", environmentsSource.production, "anonymous");

  const compareInput = merged.compare_environments || bodyObj.compare_environments || inputsObj.compare_environments;
  let compareEnvironments = normalizeEnvironmentList(compareInput);
  if (!Array.isArray(compareInput)) {
    compareEnvironments = ["localhost"];
    if (staging.url) compareEnvironments.push("staging");
    if (production.url) compareEnvironments.push("production");
  }

  const requestedTargetEnvironment = normalizeEnvironmentName(
    merged.target_environment || bodyObj.comparison_environment || inputsObj.comparison_environment || "",
    ""
  );
  const targetEnvironment =
    requestedTargetEnvironment ||
    (compareEnvironments.includes("staging")
      ? "staging"
      : compareEnvironments.includes("production")
        ? "production"
        : "localhost");
  if (!compareEnvironments.includes(targetEnvironment)) {
    throw validationError("target_environment must be included in compare_environments");
  }

  for (const envName of compareEnvironments) {
    const url = envName === "localhost" ? localhost.url : envName === "staging" ? staging.url : production.url;
    if (!url) {
      throw validationError(`${envName} url is required for fidelity comparison`);
    }
  }

  const conditions = asObject(merged.conditions);
  const viewport = normalizeViewport(conditions.viewport || bodyObj.viewport || inputsObj.viewport);
  const theme = normalizeTheme(conditions.theme || bodyObj.theme || inputsObj.theme);
  const authStateByEnvironment = {
    localhost: normalizeAuthState(
      conditions.auth_state?.localhost || localhost.auth_state,
      localhost.auth_state
    ),
    staging: normalizeAuthState(
      conditions.auth_state?.staging || staging.auth_state,
      staging.auth_state
    ),
    production: normalizeAuthState(
      conditions.auth_state?.production || production.auth_state,
      production.auth_state
    ),
  };
  const fixtureData = normalizeFixtureData(conditions.fixture_data || bodyObj.fixture_data || inputsObj.fixture_data);

  return {
    version: "p4-env-01",
    target_environment: targetEnvironment,
    compare_environments: compareEnvironments,
    environments: {
      localhost,
      staging,
      production,
    },
    conditions: {
      viewport,
      theme,
      auth_state: authStateByEnvironment,
      fixture_data: fixtureData,
    },
  };
}

module.exports = {
  buildFidelityEnvironmentContext,
  normalizeEnvironmentName,
  validationError,
};
