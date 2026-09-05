export type BindingSchemaKind = "global" | "regional";

type BindingSchemaEntry = {
  fingerprint?: unknown;
  bindingsGenerated?: unknown;
};

type BindingSchemaManifest = {
  schemas?: Partial<Record<BindingSchemaKind, BindingSchemaEntry>>;
};

function normalizedFingerprint(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export class SchemaFingerprintMismatchError extends Error {
  readonly code = "RELAY_SCHEMA_FINGERPRINT_MISMATCH";

  constructor(kind: BindingSchemaKind, expected: string, observed: string) {
    super(`Relay ${kind} schema fingerprint mismatch: expected ${expected || "unconfigured"}, observed ${observed || "missing"}`);
    this.name = "SchemaFingerprintMismatchError";
  }
}

export function assertSchemaFingerprint(
  manifest: BindingSchemaManifest,
  kind: BindingSchemaKind,
  observedFingerprint: string,
): string {
  const expected = normalizedFingerprint(manifest.schemas?.[kind]?.fingerprint);
  const observed = normalizedFingerprint(observedFingerprint);
  if (!expected || !observed || expected !== observed) {
    throw new SchemaFingerprintMismatchError(kind, expected, observed);
  }
  return observed;
}

export function schemaBindingsReady(
  manifest: BindingSchemaManifest,
  kind: BindingSchemaKind,
): boolean {
  return manifest.schemas?.[kind]?.bindingsGenerated === true;
}
