import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { checkRelaySchemaDrift } from "../scripts/check-relay-schema-drift.mjs";
import { applyPlayerVoteAnswerRepair, assertPlayerVoteAnswerShape } from "../scripts/refresh-relay-schema-bindings.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("topology-wide checks reject mixed rollouts and unavailable or missing expected regions", async () => {
  const manifest = { relayOrigin: "https://relay.example", schemas: {
    global: { databaseObserved: "bitcraft-live-global", fingerprint: sha256("global"), schemaSha256: sha256("global") },
    regional: { databaseObserved: "bitcraft-live-19", fingerprint: sha256("regional"), schemaSha256: sha256("regional") },
  } };
  const health = { sources: Object.fromEntries(["global", "19", "7"].map(id => [id, {
    database: id === "global" ? "bitcraft-live-global" : `bitcraft-live-${id}`, port: id === "global" ? 3000 : 3000 + Number(id), schema_cached: true, connectivity: "live", tables_live: 100, tables_total: 100,
  }])) };
  const options = { allRegions: true, regionIds: ["7", "19"], fetchHealth: async () => health, fetchSchema: async (schema, kind) => kind === "global" ? "global" : schema.databaseObserved.endsWith("-7") ? "old regional" : "regional" };
  const report = await checkRelaySchemaDrift(manifest, options);
  assert.equal(report.status, "drift");
  assert.equal(report.schemas.length, 3);
  assert.equal(report.schemas.find(s => s.database === "bitcraft-live-7").status, "drift");
  options.fetchSchema = async (_, kind) => kind === "global" ? "global" : "regional";
  assert.equal((await checkRelaySchemaDrift(manifest, options)).status, "compatible");
  health.sources["7"].tables_live = 1;
  await assert.rejects(checkRelaySchemaDrift(manifest, options), /ready/);
  health.sources["7"].tables_live = 100;
  health.sources["7"].connectivity = "down";
  await assert.rejects(checkRelaySchemaDrift(manifest, options), /ready/);
  delete health.sources["7"];
  await assert.rejects(checkRelaySchemaDrift(manifest, options), /missing/i);
  options.fetchHealth = async () => { throw new Error("HTTP 503"); };
  await assert.rejects(checkRelaySchemaDrift(manifest, options), /HTTP 503/);
});

test("schema drift check exits cleanly only when both exact schemas match", async () => {
  const schemas = { "global-db": "{\"global\":true}", "regional-db": "{\"regional\":true}" };
  const manifest = {
    relayOrigin: "https://unused.example",
    schemas: {
      global: { databaseObserved: "global-db", fingerprint: sha256(schemas["global-db"]), schemaSha256: sha256(schemas["global-db"]) },
      regional: { databaseObserved: "regional-db", fingerprint: sha256(schemas["regional-db"]), schemaSha256: sha256(schemas["regional-db"]) },
    },
  };

  const report = await checkRelaySchemaDrift(manifest, {
    fetchSchema: async (_schema, kind) => schemas[kind === "global" ? "global-db" : "regional-db"],
  });
  assert.equal(report.status, "compatible");
  assert.deepEqual(report.schemas.map(({ kind, status }) => [kind, status]), [["global", "compatible"], ["regional", "compatible"]]);
});

test("binding refresh accepts only the audited PlayerVoteAnswer enum and repairs the pinned generator omission", () => {
  const schema = {
    types: [{ name: { name: "PlayerVoteAnswer" }, ty: 0 }],
    typespace: { types: [{ Sum: { variants: ["None", "No", "Yes"].map((name) => ({ name: { some: name }, algebraic_type: { Product: { elements: [] } } })) } }] },
  };
  assert.doesNotThrow(() => assertPlayerVoteAnswerShape(schema));
  assert.throws(() => assertPlayerVoteAnswerShape({ ...schema, typespace: { types: [] } }), /PlayerVoteAnswer/);

  const generated = "export type PlayerUsernameState = unknown;\n\nexport const PlayerVoteAnswerRequest = unknown;\n";
  const repaired = applyPlayerVoteAnswerRepair(generated);
  assert.match(repaired, /export const PlayerVoteAnswer = __t\.enum/);
  assert.match(repaired, /None: __t\.unit\(\)[\s\S]*No: __t\.unit\(\)[\s\S]*Yes: __t\.unit\(\)/);
});

test("schema drift check returns a distinct drift exit code and never accepts a changed body", async () => {
  const schemas = { "global-db": "{\"global\":\"changed\"}", "regional-db": "{\"regional\":true}" };
  const manifest = {
    relayOrigin: "https://unused.example",
    schemas: {
      global: { databaseObserved: "global-db", fingerprint: "a".repeat(64), schemaSha256: "a".repeat(64) },
      regional: { databaseObserved: "regional-db", fingerprint: sha256(schemas["regional-db"]), schemaSha256: sha256(schemas["regional-db"]) },
    },
  };

  const report = await checkRelaySchemaDrift(manifest, {
    fetchSchema: async (_schema, kind) => schemas[kind === "global" ? "global-db" : "regional-db"],
  });
  assert.equal(report.status, "drift");
  assert.equal(report.schemas[0].status, "drift");
  assert.equal(report.schemas[0].observed, sha256(schemas["global-db"]));
});
