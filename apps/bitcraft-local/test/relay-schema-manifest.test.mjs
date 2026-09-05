import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  assertSchemaFingerprint,
  SchemaFingerprintMismatchError,
  schemaBindingsReady,
} from "../src/server/game-data/schemaManifest.ts";

const manifest = JSON.parse(readFileSync(
  new URL("../src/server/game-data/bindings/schema-manifest.json", import.meta.url),
  "utf8",
));

test("Relay schema manifest records independent global and regional fingerprints", () => {
  for (const kind of ["global", "regional"]) {
    const schema = manifest.schemas[kind];
    assert.match(schema.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(schema.fingerprint, schema.schemaSha256);
    assert.equal(assertSchemaFingerprint(manifest, kind, schema.fingerprint), schema.fingerprint);
  }
  assert.equal(schemaBindingsReady(manifest, "global"), true);
  assert.equal(schemaBindingsReady(manifest, "regional"), true);
  assert.equal(manifest.codegen.mode, "pinned-cli-module-def-v9");
  assert.equal(
    existsSync(new URL("../src/server/game-data/bindings/global/index.ts", import.meta.url)),
    true,
  );
  assert.equal(
    existsSync(new URL("../src/server/game-data/bindings/regional/index.ts", import.meta.url)),
    true,
  );
});

test("schema drift stops ingestion before a mixed generation can apply", () => {
  assert.throws(
    () => assertSchemaFingerprint(manifest, "regional", "different"),
    (error) => error instanceof SchemaFingerprintMismatchError
      && error.code === "RELAY_SCHEMA_FINGERPRINT_MISMATCH"
      && /schema fingerprint mismatch/.test(error.message),
  );
});
