const STORAGE_KEY = "ui_lang";
const SUPPORTED = new Set(["ja", "en"]);
const dictCache = new Map();
const PREFIXED_ID_PATTERNS = Object.freeze({
  project: /^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  thread: /^thread_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  run: /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  ai_setting: /^ai_setting_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
});

function detectLang() {
  try {
    const fromStorage = (localStorage.getItem(STORAGE_KEY) || "").trim().toLowerCase();
    if (SUPPORTED.has(fromStorage)) return fromStorage;
  } catch (_) {}
  const nav = (navigator.language || "").toLowerCase();
  return nav.startsWith("ja") ? "ja" : "en";
}

function normalizeApiPath(path) {
  if (!path) return "/api";
  if (path.startsWith("/api/") || path === "/api") return path;
  if (path.startsWith("/")) return `/api${path}`;
  return `/api/${path}`;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    payload = null;
  }
  if (!res.ok) {
    const error = new Error(
      (payload && (payload.message || payload.error)) || `HTTP ${res.status}`
    );
    error.status = res.status;
    error.code = payload && payload.code ? payload.code : "";
    error.details = payload && payload.details ? payload.details : null;
    error.payload = payload;
    throw error;
  }
  if (payload === null) {
    throw new Error("Invalid JSON");
  }
  return payload;
}

async function loadDict(lang) {
  if (dictCache.has(lang)) return dictCache.get(lang);
  try {
    const dict = await fetchJson(`/ui/i18n/${lang}.json`);
    dictCache.set(lang, dict);
    return dict;
  } catch (_) {
    const empty = {};
    dictCache.set(lang, empty);
    return empty;
  }
}

export async function apiGet(path) {
  const url = normalizeApiPath(path);
  return fetchJson(url);
}

export async function apiPost(path, payload = {}) {
  const url = normalizeApiPath(path);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
  let result = null;
  try {
    result = await res.json();
  } catch (_) {
    result = null;
  }
  if (!res.ok) {
    const error = new Error(
      (result && (result.message || result.error)) || `HTTP ${res.status}`
    );
    error.status = res.status;
    error.code = result && result.code ? result.code : "";
    error.details = result && result.details ? result.details : null;
    error.payload = result;
    throw error;
  }
  if (result === null) throw new Error("Invalid JSON");
  return result;
}

export async function apiPostDownload(path, payload = {}) {
  const url = normalizeApiPath(path);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/csv",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    let result = null;
    try {
      result = await res.json();
    } catch (_) {
      result = null;
    }
    const error = new Error(
      (result && (result.message || result.error)) || `HTTP ${res.status}`
    );
    error.status = res.status;
    error.code = result && result.code ? result.code : "";
    error.details = result && result.details ? result.details : null;
    error.payload = result;
    throw error;
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
  return {
    blob,
    filename: match && match[1] ? match[1] : "export.dat",
    contentType: res.headers.get("content-type") || "",
  };
}

export async function apiPut(path, payload = {}) {
  const url = normalizeApiPath(path);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
  let result = null;
  try {
    result = await res.json();
  } catch (_) {
    result = null;
  }
  if (!res.ok) {
    const error = new Error(
      (result && (result.message || result.error)) || `HTTP ${res.status}`
    );
    error.status = res.status;
    error.code = result && result.code ? result.code : "";
    error.details = result && result.details ? result.details : null;
    error.payload = result;
    throw error;
  }
  if (result === null) throw new Error("Invalid JSON");
  return result;
}

export async function apiPatch(path, payload = {}) {
  const url = normalizeApiPath(path);
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
  let result = null;
  try {
    result = await res.json();
  } catch (_) {
    result = null;
  }
  if (!res.ok) {
    const error = new Error(
      (result && (result.message || result.error)) || `HTTP ${res.status}`
    );
    error.status = res.status;
    error.code = result && result.code ? result.code : "";
    error.details = result && result.details ? result.details : null;
    error.payload = result;
    throw error;
  }
  if (result === null) throw new Error("Invalid JSON");
  return result;
}

export async function apiDelete(path) {
  const url = normalizeApiPath(path);
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
    },
  });
  if (res.status === 204) {
    return { ok: true };
  }
  let result = null;
  try {
    result = await res.json();
  } catch (_) {
    result = null;
  }
  if (!res.ok) {
    const error = new Error(
      (result && (result.message || result.error)) || `HTTP ${res.status}`
    );
    error.status = res.status;
    error.code = result && result.code ? result.code : "";
    error.details = result && result.details ? result.details : null;
    error.payload = result;
    throw error;
  }
  return result;
}

export function isPrefixedId(kind, value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return false;
  const re = PREFIXED_ID_PATTERNS[kind];
  return Boolean(re && re.test(text));
}

export async function t(key) {
  const lang = detectLang();
  const current = await loadDict(lang);
  if (typeof current[key] === "string") return current[key];
  const ja = await loadDict("ja");
  if (typeof ja[key] === "string") return ja[key];
  return key;
}

export async function setText(el, keyOrText, isKey = true) {
  if (!el) return;
  if (!isKey) {
    el.textContent = keyOrText || "";
    return;
  }
  const key = (keyOrText || "").trim();
  if (!key) return;
  el.setAttribute("data-i18n", key);
  el.textContent = await t(key);
}
