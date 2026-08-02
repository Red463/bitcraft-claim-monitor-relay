import { canonicalNonNegativeDecimal } from "../../dist-server/game-data/exactDecimal.js";

function exactUnsigned(value, label) {
  const normalized = String(value ?? "").trim();
  const match = /^(\d+)(?:\.0+)?$/.exec(normalized);
  if (!match) {
    throw new TypeError(`${label} must be an unsigned decimal integer`);
  }
  return match[1];
}

function contributorId(value) {
  return value == null ? null : exactUnsigned(value, "Contributor entity id");
}

function attributionConfidence(value) {
  const confidence = String(value ?? "unknown");
  if (!new Set(["authoritative", "joined", "unknown"]).has(confidence)) {
    throw new TypeError("Attribution confidence must be authoritative, joined, or unknown");
  }
  return confidence;
}

function validObservedAt(value) {
  if (value == null) return null;
  const observedAt = String(value);
  return Number.isFinite(Date.parse(observedAt)) ? observedAt : null;
}

export function projectCraftContributions(rows) {
  const byCraft = {};
  for (const row of rows) {
    const craftEntityId = exactUnsigned(row.craft_entity_id, "Craft entity id");
    const contributorEntityId = contributorId(row.contributor_entity_id);
    const confidence = attributionConfidence(row.attribution_confidence);
    (byCraft[craftEntityId] ??= []).push({
      contributorEntityId,
      contributorUsername: String(row.contributor_name ?? contributorEntityId ?? "Unknown contributor"),
      totalProgressContributed: exactUnsigned(
        row.contributed_progress,
        "Contributed progress",
      ),
      totalXpContributed: canonicalNonNegativeDecimal(row.contributed_xp, "Contributed XP"),
      contributionCount: exactUnsigned(
        row.contribution_count,
        "Contribution count",
      ),
      attributionConfidence: confidence,
      firstContributedAt: row.first_contributed_at == null
        ? null
        : String(row.first_contributed_at),
      lastContributedAt: row.last_contributed_at == null
        ? null
        : String(row.last_contributed_at),
    });
  }
  for (const contributors of Object.values(byCraft)) {
    contributors.sort((left, right) => (
      String(right.lastContributedAt ?? "").localeCompare(String(left.lastContributedAt ?? ""))
      || left.contributorUsername.localeCompare(right.contributorUsername)
    ));
  }
  return byCraft;
}

export function projectCraftContributionEnvelope(rows) {
  const byCraft = {};
  const warnings = [];
  const observedTimes = [];
  rows.forEach((row, index) => {
    try {
      const projected = projectCraftContributions([row]);
      for (const [craftEntityId, contributors] of Object.entries(projected)) {
        (byCraft[craftEntityId] ??= []).push(...contributors);
      }
      const observedAt = validObservedAt(row.first_contributed_at);
      if (observedAt) observedTimes.push(observedAt);
    } catch (error) {
      warnings.push(
        `Durable craft contribution row ${index} is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
  for (const contributors of Object.values(byCraft)) {
    contributors.sort((left, right) => (
      String(right.lastContributedAt ?? "").localeCompare(String(left.lastContributedAt ?? ""))
      || left.contributorUsername.localeCompare(right.contributorUsername)
    ));
  }
  observedTimes.sort((left, right) => Date.parse(left) - Date.parse(right));
  return {
    data: {
      byCraft,
      observedSince: observedTimes[0] ?? null,
    },
    warnings,
  };
}
