const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_TENANT = "internal";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getDbPath() {
  const root = process.cwd();
  const dir = path.join(root, ".hub");
  ensureDir(dir);
  return path.join(dir, "hub.sqlite");
}

function openDb() {
  const dbPath = getDbPath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.existsSync(schemaPath)
    ? fs.readFileSync(schemaPath, "utf8")
    : "";
  if (schemaSql.trim()) {
    db.exec(schemaSql);
  }
  ensureConnectionColumns(db);
  ensureRunColumns(db);
  ensureJobTemplates(db);
  return db;
}

function ensureConnectionColumns(db) {
  const columns = db.prepare("PRAGMA table_info(connections)").all().map((row) => row.name);
  if (!columns.includes("provider_key")) {
    db.exec("ALTER TABLE connections ADD COLUMN provider_key TEXT");
  }
  if (!columns.includes("config_json")) {
    db.exec("ALTER TABLE connections ADD COLUMN config_json TEXT");
  }
}

function ensureRunColumns(db) {
  const columns = db.prepare("PRAGMA table_info(runs)").all().map((row) => row.name);
  if (!columns.includes("failure_code")) {
    db.exec("ALTER TABLE runs ADD COLUMN failure_code TEXT");
  }
  if (!columns.includes("job_type")) {
    db.exec("ALTER TABLE runs ADD COLUMN job_type TEXT");
  }
  if (!columns.includes("target_path")) {
    db.exec("ALTER TABLE runs ADD COLUMN target_path TEXT");
  }
  if (!columns.includes("run_mode")) {
    db.exec("ALTER TABLE runs ADD COLUMN run_mode TEXT");
  }
  if (!columns.includes("figma_file_key")) {
    db.exec("ALTER TABLE runs ADD COLUMN figma_file_key TEXT");
  }
  if (!columns.includes("ingest_artifact_path")) {
    db.exec("ALTER TABLE runs ADD COLUMN ingest_artifact_path TEXT");
  }
  if (!columns.includes("github_pr_url")) {
    db.exec("ALTER TABLE runs ADD COLUMN github_pr_url TEXT");
  }
  if (!columns.includes("github_pr_number")) {
    db.exec("ALTER TABLE runs ADD COLUMN github_pr_number INTEGER");
  }
}

function ensureJobTemplates(db) {
  const hasTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='job_templates'")
    .get();
  if (!hasTable) {
    return;
  }
  const existing = db.prepare("SELECT name FROM job_templates").all().map((row) => row.name);
  const existingSet = new Set(existing);
  const templates = [
    {
      name: "figma_read",
      direction: "inbound",
      required_mode: "remote",
      required_capabilities: ["read"],
      required_inputs: [],
      description: "Figma read",
    },
    {
      name: "figma_plan",
      direction: "inbound",
      required_mode: "remote",
      required_capabilities: ["read"],
      required_inputs: [],
      description: "Figma plan",
    },
    {
      name: "figma_apply",
      direction: "inbound",
      required_mode: "remote",
      required_capabilities: ["read", "apply"],
      required_inputs: [],
      description: "Figma apply",
    },
    {
      name: "figma_verify",
      direction: "inbound",
      required_mode: "remote",
      required_capabilities: ["read", "verify"],
      required_inputs: [],
      description: "Figma verify",
    },
  ];
  const insert = db.prepare(
    "INSERT INTO job_templates(name,direction,required_mode,required_capabilities,required_inputs,description) VALUES(?,?,?,?,?,?)"
  );
  templates.forEach((tpl) => {
    if (existingSet.has(tpl.name)) {
      return;
    }
    insert.run(
      tpl.name,
      tpl.direction,
      tpl.required_mode,
      JSON.stringify(tpl.required_capabilities),
      JSON.stringify(tpl.required_inputs),
      tpl.description
    );
  });
}

module.exports = { openDb, DEFAULT_TENANT };
