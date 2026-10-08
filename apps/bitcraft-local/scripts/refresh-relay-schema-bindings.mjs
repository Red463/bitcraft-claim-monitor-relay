import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { relaySchemaUrl } from "./check-relay-schema-drift.mjs";

const bindingsRoot = fileURLToPath(new URL("../src/server/game-data/bindings/", import.meta.url));
const manifestPath = path.join(bindingsRoot, "schema-manifest.json");

export function assertPlayerVoteAnswerShape(schema) {
  const named = schema.types?.find((entry) => entry?.name?.name === "PlayerVoteAnswer");
  const variants = named && schema.typespace?.types?.[named.ty]?.Sum?.variants;
  const actual = variants?.map((variant) => ({
    name: variant?.name?.some,
    unit: Array.isArray(variant?.algebraic_type?.Product?.elements) && variant.algebraic_type.Product.elements.length === 0,
  }));
  // Relay now publishes lowercase variant names. The pinned generator maps
  // both audited spellings to the same TypeScript variants and wire ordinals.
  const auditedNames = [["None", "No", "Yes"], ["none", "no", "yes"]];
  if (!auditedNames.some((names) => JSON.stringify(actual) === JSON.stringify(names.map((name) => ({ name, unit: true }))))) {
    throw new Error("Relay schema PlayerVoteAnswer no longer matches the audited None/No/Yes or none/no/yes unit enum");
  }
}

export function applyPlayerVoteAnswerRepair(source) {
  if (/export const PlayerVoteAnswer = __t\.enum/.test(source)) return source;
  const marker = "export const PlayerVoteAnswerRequest";
  if (!source.includes(marker)) throw new Error("Pinned generator output no longer contains PlayerVoteAnswerRequest repair marker");
  const repair = `// Codegen repair: RawModuleDef V9 exposes PlayerVoteAnswer as a named enum but
// SpacetimeDB CLI 2.7.0 omits its declaration while still referencing it.
export const PlayerVoteAnswer = __t.enum("PlayerVoteAnswer", {
  None: __t.unit(),
  No: __t.unit(),
  Yes: __t.unit(),
});
export type PlayerVoteAnswer = __Infer<typeof PlayerVoteAnswer>;

`;
  return source.replace(marker, `${repair}${marker}`);
}

async function countFiles(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    count += entry.isDirectory() ? await countFiles(path.join(directory, entry.name)) : 1;
  }
  return count;
}

async function installPreparedBindings(prepared, manifest, originalManifestText) {
  const swaps = prepared.map(({ kind, generatedDirectory }) => ({
    generatedDirectory,
    target: path.join(bindingsRoot, kind),
    next: path.join(bindingsRoot, `.refresh-next-${kind}`),
    backup: path.join(bindingsRoot, `.refresh-backup-${kind}`),
    backedUp: false,
    installed: false,
  }));
  try {
    for (const swap of swaps) {
      await rm(swap.next, { recursive: true, force: true });
      await rm(swap.backup, { recursive: true, force: true });
      await cp(swap.generatedDirectory, swap.next, { recursive: true });
    }
    for (const swap of swaps) {
      await rename(swap.target, swap.backup);
      swap.backedUp = true;
    }
    for (const swap of swaps) {
      await rename(swap.next, swap.target);
      swap.installed = true;
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    await writeFile(manifestPath, originalManifestText).catch(() => {});
    for (const swap of [...swaps].reverse()) {
      if (swap.installed) await rm(swap.target, { recursive: true, force: true }).catch(() => {});
      if (swap.backedUp) await rename(swap.backup, swap.target).catch(() => {});
      await rm(swap.next, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
  await Promise.allSettled(swaps.map((swap) => rm(swap.backup, { recursive: true, force: true })));
}

export async function refreshRelaySchemaBindings({ cliPath, kinds = ["global", "regional"], schemaOrigin } = {}) {
  if (!cliPath) throw new Error("--cli is required");
  cliPath = path.resolve(cliPath);
  const version = spawnSync(cliPath, ["--version"], { encoding: "utf8" });
  const versionOutput = `${version.stdout ?? ""}${version.stderr ?? ""}`;
  if (version.status !== 0 || !versionOutput.includes("spacetimedb tool version 2.7.0;") || !versionOutput.includes("d220349adb7af7eefa810eb08a185609356b83f6")) {
    throw new Error("Binding refresh requires the manifest-pinned SpacetimeDB 2.7.0 CLI commit");
  }

  const originalManifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(originalManifestText);
  const stagingRoot = await mkdtemp(path.join(tmpdir(), "relay-bindings-"));
  const refreshed = [];
  const prepared = [];
  try {
    await mkdir(path.join(stagingRoot, "spacetimedb"));
    for (const kind of kinds) {
      const schemaManifest = manifest.schemas?.[kind];
      if (!schemaManifest) throw new Error(`Schema manifest is missing ${kind}`);
      const response = await fetch(relaySchemaUrl(manifest, schemaManifest, schemaOrigin), { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Relay schema request failed (${response.status}) for ${kind}`);
      const body = await response.text();
      const fingerprint = createHash("sha256").update(body).digest("hex");
      if (fingerprint === schemaManifest.schemaSha256) continue;
      const schema = JSON.parse(body);
      assertPlayerVoteAnswerShape(schema);
      const wrappedPath = path.join(stagingRoot, `${kind}-wrapped.json`);
      const generatedDirectory = path.join(stagingRoot, kind);
      await writeFile(wrappedPath, JSON.stringify({ V9: schema }));
      const generation = spawnSync(cliPath, [
        "generate", "--lang", "typescript", "--module-def", wrappedPath,
        "--out-dir", generatedDirectory, "--yes", "--no-config",
      ], { cwd: stagingRoot, encoding: "utf8" });
      if (generation.status !== 0) throw new Error(`Pinned binding generation failed for ${kind}: ${generation.error?.message || generation.stderr || generation.stdout || `exit ${generation.status}`}`);
      const typesPath = path.join(generatedDirectory, "types.ts");
      await writeFile(typesPath, `${applyPlayerVoteAnswerRepair(await readFile(typesPath, "utf8")).trimEnd()}\n`);
      const generatedFileCount = await countFiles(generatedDirectory);
      Object.assign(schemaManifest, { fingerprint, schemaSha256: fingerprint, bindingsGenerated: true, generatedFileCount });
      refreshed.push({ kind, fingerprint, generatedFileCount });
      prepared.push({ kind, generatedDirectory });
    }
    if (refreshed.length) {
      manifest.capturedAt = new Date().toISOString();
      await installPreparedBindings(prepared, manifest, originalManifestText);
    }
    return { refreshed };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const kind = optionValue(args, "--kind");
  const report = await refreshRelaySchemaBindings({
    cliPath: optionValue(args, "--cli"),
    kinds: kind ? [kind] : ["global", "regional"],
    schemaOrigin: optionValue(args, "--schema-origin"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Relay binding refresh failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
