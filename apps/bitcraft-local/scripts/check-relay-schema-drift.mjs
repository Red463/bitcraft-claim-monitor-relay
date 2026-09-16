import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const defaultManifestUrl = new URL("../src/server/game-data/bindings/schema-manifest.json", import.meta.url);

function schemaPort(database) {
  if (database === "bitcraft-live-global") return 3000;
  const match = database.match(/^bitcraft-live-(\d+)$/);
  if (!match) throw new Error(`Cannot derive Relay schema port for ${database}`);
  return 3000 + Number(match[1]);
}

export function relaySchemaUrl(manifest, schema, schemaOrigin) {
  const database = schema.databaseObserved;
  if (!database) throw new Error("Schema manifest is missing databaseObserved");
  const origin = schemaOrigin
    ? new URL(schemaOrigin)
    : new URL(manifest.relayOrigin);
  if (!schemaOrigin) origin.port = String(schema.port ?? schemaPort(database));
  return new URL(`/v1/database/${encodeURIComponent(database)}/schema?version=9`, origin);
}

export async function checkRelaySchemaDrift(manifest, options = {}) {
  const schemas = [];
  let targets = ["global", "regional"].map(kind => ({ kind, schema: manifest.schemas?.[kind] }));
  if (options.allRegions) {
    const health = await (options.fetchHealth ?? (async () => {
      const response = await fetch(new URL("/health", manifest.relayOrigin), { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Relay topology request failed (${response.status})`);
      return response.json();
    }))();
    targets = [];
    for (const source of Object.values(health.sources ?? {})) {
      const database = source.database ?? source.metrics?.mirror_database;
      const kind = database === "bitcraft-live-global" ? "global" : /^bitcraft-live-\d+$/.test(database ?? "") ? "regional" : null;
      if (!kind) continue;
      const legacyReady = source.metrics?.upstream?.state === "up" && source.metrics?.initial_subscribe_complete === true;
      const tablesLive = Number(source.tables_live), tablesTotal = Number(source.tables_total);
      const liveReady = source.connectivity === "live" && Number.isInteger(tablesLive) && Number.isInteger(tablesTotal)
        && tablesTotal > 0 && tablesLive === tablesTotal;
      if (source.schema_cached !== true || (!liveReady && !legacyReady)) throw new Error(`Relay source ${database} is not ready`);
      const port = Number(source.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid Relay port for ${database}`);
      targets.push({ kind, schema: { ...manifest.schemas?.[kind], databaseObserved: database, port } });
    }
    const required = [manifest.schemas?.global?.databaseObserved, manifest.schemas?.regional?.databaseObserved,
      ...(options.regionIds ?? []).map(id => {
        if (!/^\d+$/.test(String(id))) throw new Error("Expected decimal region IDs");
        return `bitcraft-live-${id}`;
      })];
    for (const database of required) {
      if (!database || !targets.some(target => target.schema.databaseObserved === database)) throw new Error(`Required Relay source is missing: ${database}`);
    }
  }
  const fetchSchema = options.fetchSchema ?? (async (schema) => {
    const url = relaySchemaUrl(manifest, schema, options.schemaOrigin);
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Relay schema request failed (${response.status}) for ${schema.databaseObserved}`);
    return response.text();
  });

  for (const { kind, schema } of targets) {
    if (!schema) throw new Error(`Schema manifest is missing ${kind}`);
    if (schema.fingerprint !== schema.schemaSha256) throw new Error(`Schema manifest ${kind} fingerprint and schemaSha256 disagree`);
    const body = await fetchSchema(schema, kind);
    const observed = createHash("sha256").update(body).digest("hex");
    schemas.push({
      kind,
      database: schema.databaseObserved,
      expected: schema.schemaSha256,
      observed,
      status: observed === schema.schemaSha256 ? "compatible" : "drift",
    });
  }

  return {
    status: schemas.every((schema) => schema.status === "compatible") ? "compatible" : "drift",
    checkedAt: new Date().toISOString(),
    schemas,
  };
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const manifestPath = optionValue(args, "--manifest");
  const manifest = JSON.parse(await readFile(manifestPath ?? defaultManifestUrl, "utf8"));
  const report = await checkRelaySchemaDrift(manifest, {
    schemaOrigin: optionValue(args, "--schema-origin"), allRegions: args.includes("--all-regions"),
    regionIds: String(process.env.SCHEMA_REGION_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "drift") process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Relay schema check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
