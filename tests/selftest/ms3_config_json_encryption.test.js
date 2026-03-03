const crypto = require("crypto");
const { db, DEFAULT_TENANT } = require("../../src/db");
const { migrateConnectionConfigJsonEncryption } = require("../../src/db/sqlite");
const { createConnection, listConnections } = require("../../src/connectors/store");
const { decrypt } = require("../../src/crypto/secrets");
const { assert } = require("./_helpers");

async function run() {
  const prevSecretKey = process.env.SECRET_KEY;
  process.env.SECRET_KEY = "1".repeat(64);

  const legacyId = `legacy-${crypto.randomUUID()}`;
  const plainConfig = JSON.stringify({ figma_token: "plain-token" });

  try {
    db.prepare(
      "INSERT INTO connections(tenant_id,id,provider,provider_key,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
    ).run(DEFAULT_TENANT, legacyId, "figma", "figma", plainConfig, new Date().toISOString(), new Date().toISOString());

    migrateConnectionConfigJsonEncryption(db);

    const migratedRow = db
      .prepare("SELECT config_json FROM connections WHERE tenant_id=? AND id=?")
      .get(DEFAULT_TENANT, legacyId);
    assert(migratedRow && typeof migratedRow.config_json === "string", "migrated connection should exist");
    assert(migratedRow.config_json !== plainConfig, "legacy plain config_json should be encrypted on migration");
    const migratedDecoded = JSON.parse(decrypt(migratedRow.config_json));
    assert(migratedDecoded.figma_token === "plain-token", "migrated encrypted payload should decrypt to original config");

    const listed = listConnections(db, { tenantId: DEFAULT_TENANT, providerKey: "figma" });
    const listedLegacy = listed.find((row) => row.id === legacyId);
    assert(listedLegacy, "migrated legacy connection should be returned by listConnections");
    assert(listedLegacy.config_json.figma_token === "plain-token", "listConnections should return decrypted legacy config");

    const created = createConnection(db, {
      tenantId: DEFAULT_TENANT,
      providerKey: "figma",
      config: { figma_token: "new-token" },
    });
    const createdRow = db
      .prepare("SELECT config_json FROM connections WHERE tenant_id=? AND id=?")
      .get(DEFAULT_TENANT, created.id);
    assert(createdRow && typeof createdRow.config_json === "string", "created connection should persist config_json");
    assert(
      createdRow.config_json !== JSON.stringify({ figma_token: "new-token" }),
      "newly saved config_json should be encrypted"
    );
    const createdDecoded = JSON.parse(decrypt(createdRow.config_json));
    assert(createdDecoded.figma_token === "new-token", "new encrypted config_json should decrypt correctly");

    db.prepare("DELETE FROM connections WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, created.id);
    db.prepare("DELETE FROM connections WHERE tenant_id=? AND id=?").run(DEFAULT_TENANT, legacyId);
  } finally {
    if (prevSecretKey === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = prevSecretKey;
  }
}

module.exports = { run };
