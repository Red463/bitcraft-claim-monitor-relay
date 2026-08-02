export type ContributionTarget = {
  craftEntityId: string;
  buildingEntityId: string;
  recipeId: string;
};

export type MemberIdentity = {
  entityId: string;
  name: string;
  identityHex: string;
};

export type ContributionAttribution =
  | {
      confidence: "authoritative" | "joined";
      contributorEntityId: string;
      contributorName: string;
      evidenceKey: string;
    }
  | {
      confidence: "unknown";
      contributorEntityId: null;
      contributorName: "Unknown contributor";
      evidenceKey: string;
    };

type RecordValue = Record<string, unknown>;

const DEFAULT_FALLBACK_WINDOW_MS = 5_000;

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" ? value as RecordValue : null;
}

function normalizedEnumTag(value: unknown): string | null {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[_-]/g, "")
    : null;
}

function decimalString(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new TypeError(`${label} must be a decimal string`);
  }
  return BigInt(value).toString();
}

function bindingDecimal(value: unknown): string | null {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value).toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

function bindingTimestamp(value: unknown): bigint | null {
  const decimal = bindingDecimal(value);
  return decimal === null ? null : BigInt(decimal);
}

function identityHex(value: unknown): string | null {
  const identity = asRecord(value);
  if (!identity) return null;
  if (typeof identity.toHexString === "function") {
    try {
      const hex = identity.toHexString();
      if (typeof hex === "string" && hex.trim()) return hex.trim();
    } catch {
      // Fall through to the generated identity's canonical representation.
    }
  }
  const canonical = identity.__identity__;
  return typeof canonical === "string" && canonical.trim() ? canonical.trim() : null;
}

function unknown(evidenceKey: string): ContributionAttribution {
  return {
    confidence: "unknown",
    contributorEntityId: null,
    contributorName: "Unknown contributor",
    evidenceKey,
  };
}

function knownMembers(members: readonly MemberIdentity[]): Map<string, MemberIdentity> {
  const known = new Map<string, MemberIdentity>();
  for (const member of members) {
    known.set(decimalString(member.entityId, "Member entity id"), member);
  }
  return known;
}

function reducerAttribution(
  event: RecordValue,
  target: ContributionTarget,
  members: readonly MemberIdentity[],
): ContributionAttribution {
  const value = asRecord(event.value);
  const reducer = value && asRecord(value.reducer);
  const reducerValue = reducer && asRecord(reducer.value);
  const request = reducerValue && asRecord(reducerValue.request);
  const reducerTag = normalizedEnumTag(reducer?.tag);
  if (!request || (reducerTag !== "craftcontinue" && reducerTag !== "craftcontinuestart")) {
    return unknown("unknown:no-match");
  }
  if (bindingDecimal(request.progressiveActionEntityId) !== target.craftEntityId) {
    return unknown("unknown:no-match");
  }
  const callerIdentity = identityHex(value?.callerIdentity);
  if (!callerIdentity) return unknown("unknown:unresolved-identity");
  const member = members.find((candidate) => candidate.identityHex === callerIdentity);
  return member
    ? {
        confidence: "authoritative",
        contributorEntityId: decimalString(member.entityId, "Member entity id"),
        contributorName: member.name,
        evidenceKey: `reducer:${callerIdentity}`,
      }
    : unknown("unknown:no-match");
}

function rowHasTag(row: RecordValue, field: string, tag: string): boolean {
  return normalizedEnumTag(asRecord(row[field])?.tag) === tag;
}

function eligibleActionMember(
  rowValue: unknown,
  target: ContributionTarget,
  members: ReadonlyMap<string, MemberIdentity>,
  observedAt: bigint,
  fallbackWindow: bigint,
): { member: MemberIdentity; autoId: string } | null {
  const row = asRecord(rowValue);
  if (!row || row.clientCancel !== false || row.wasConsumed !== false) return null;
  if (!rowHasTag(row, "actionType", "craft") || !rowHasTag(row, "lastActionResult", "success")) {
    return null;
  }
  const entityId = bindingDecimal(row.entityId);
  const buildingId = bindingDecimal(row.target);
  const recipeId = bindingDecimal(row.recipeId);
  const autoId = bindingDecimal(row.autoId);
  const startTime = bindingTimestamp(row.startTime);
  const duration = bindingTimestamp(row.duration);
  if (!entityId || buildingId !== target.buildingEntityId || recipeId !== target.recipeId
    || !autoId || startTime === null || duration === null || duration < 0n) {
    return null;
  }
  if (observedAt < startTime || observedAt > startTime + duration + fallbackWindow) return null;
  const member = members.get(entityId);
  return member ? { member, autoId } : null;
}

function joinedAttribution(
  actionRows: readonly unknown[],
  target: ContributionTarget,
  members: readonly MemberIdentity[],
  observedAtMs: number,
  fallbackWindowMs: number,
): ContributionAttribution {
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) {
    throw new TypeError("Observed time must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(fallbackWindowMs) || fallbackWindowMs < 0) {
    throw new TypeError("Fallback window must be a non-negative safe integer");
  }
  const known = knownMembers(members);
  const observedAt = BigInt(observedAtMs);
  const fallbackWindow = BigInt(fallbackWindowMs);
  const matches = actionRows
    .map((row) => eligibleActionMember(
      row,
      target,
      known,
      observedAt,
      fallbackWindow,
    ))
    .filter((match): match is { member: MemberIdentity; autoId: string } => match !== null);
  if (matches.length === 0) return unknown("unknown:no-match");
  if (matches.length > 1) return unknown("unknown:ambiguous");
  const [{ member, autoId }] = matches;
  return {
    confidence: "joined",
    contributorEntityId: decimalString(member.entityId, "Member entity id"),
    contributorName: member.name,
    evidenceKey: `action:${autoId}`,
  };
}

export function resolveCraftContributionAttribution(input: {
  event: unknown;
  target: ContributionTarget;
  members: readonly MemberIdentity[];
  actionRows: readonly unknown[];
  observedAtMs: number;
  fallbackWindowMs?: number;
}): ContributionAttribution {
  const target = {
    craftEntityId: decimalString(input.target.craftEntityId, "Craft entity id"),
    buildingEntityId: decimalString(input.target.buildingEntityId, "Building entity id"),
    recipeId: decimalString(input.target.recipeId, "Recipe id"),
  };
  const event = asRecord(input.event);
  if (!event) return unknown("unknown:no-match");
  if (normalizedEnumTag(event.tag) === "reducer") {
    return reducerAttribution(event, target, input.members);
  }
  if (normalizedEnumTag(event.tag) !== "transaction") return unknown("unknown:no-match");
  return joinedAttribution(
    input.actionRows,
    target,
    input.members,
    input.observedAtMs,
    input.fallbackWindowMs ?? DEFAULT_FALLBACK_WINDOW_MS,
  );
}
