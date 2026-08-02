import type {
  DomainEvent,
  DomainKey,
  DomainSnapshotBatch,
  ProviderSink,
  ProviderHealth,
  StoredDomainSnapshot,
} from "./contracts.ts";
import { addDecimal, canonicalNonNegativeDecimal } from "./exactDecimal.ts";

type Statement = {
  all(...values: unknown[]): Record<string, unknown>[];
  get(...values: unknown[]): Record<string, unknown> | undefined;
  run(...values: unknown[]): { changes: number | bigint };
};

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
};

type ProviderTransition = {
  transitionKey: string;
  claimId: string;
  domain: DomainKey;
  observedAt: string;
  payload: unknown;
};

type StoredProviderTransition = ProviderTransition & {
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export function createCurrentStateRepository(
  db: SqliteDatabase,
  options: {
    onCommit?: (event: {
      claimId: string;
      generation: number;
      generatedAt: string;
      changedDomains: DomainKey[];
    }) => void;
  } = {},
): ProviderSink & {
  read(claimId: string, domain: DomainKey): StoredDomainSnapshot | null;
  readHealth(): ProviderHealth | null;
  recordSubscriptionHealth(health: {
    sourceKey: string;
    domain: DomainKey;
    generation: number;
    connected: boolean;
    applyDurationMs?: number | null;
    lagMs?: number | null;
    reconnects?: number;
    malformedRows?: number;
    lastError?: string | null;
  }, observedAt: string): Promise<void>;
  readSubscriptionHealth(sourceKey: string, domain: DomainKey): {
    sourceKey: string;
    domain: DomainKey;
    generation: number;
    connected: boolean;
    applyDurationMs: number | null;
    lagMs: number | null;
    reconnects: number;
    malformedRows: number;
    lastError: string | null;
    updatedAt: string;
  } | null;
  nextGeneration(claimId: string): number;
  commitGenerationWithTransition(
    batch: DomainSnapshotBatch,
    transition: ProviderTransition,
  ): Promise<void>;
  listPendingTransitions(claimId: string, domain: DomainKey): StoredProviderTransition[];
  recordTransitionError(
    transitionKey: string,
    error: string,
    updatedAt: string,
  ): Promise<void>;
  ackTransition(transitionKey: string): Promise<void>;
} {
  const upsert = db.prepare(`
    INSERT INTO domain_payload_current (
      claim_id, domain, data_json, collected_at, last_attempt_at, last_success_at,
      last_error, updated_at, provider, source_key, region_id, database_name,
      schema_fingerprint, source_observed_at, received_at, freshness, confidence,
      generation, warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(claim_id, domain) DO UPDATE SET
      data_json = excluded.data_json,
      collected_at = excluded.collected_at,
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = excluded.last_success_at,
      last_error = NULL,
      updated_at = excluded.updated_at,
      provider = excluded.provider,
      source_key = excluded.source_key,
      region_id = excluded.region_id,
      database_name = excluded.database_name,
      schema_fingerprint = excluded.schema_fingerprint,
      source_observed_at = excluded.source_observed_at,
      received_at = excluded.received_at,
      freshness = excluded.freshness,
      confidence = excluded.confidence,
      generation = excluded.generation,
      warnings_json = excluded.warnings_json
    WHERE excluded.generation >= domain_payload_current.generation
  `);
  const read = db.prepare(
    "SELECT * FROM domain_payload_current WHERE claim_id = ? AND domain = ? AND provider = 'relay'",
  );
  const markError = db.prepare(`
    UPDATE domain_payload_current
    SET last_attempt_at = ?, last_error = ?, updated_at = ?
    WHERE claim_id = ? AND domain = ?
  `);
  const maxGeneration = db.prepare("SELECT MAX(generation) AS generation FROM domain_payload_current WHERE claim_id = ?");
  const upsertHealth = db.prepare(`
    INSERT INTO provider_source_health (
      provider, source_key, ready, database_name, schema_fingerprint,
      last_observed_at, last_error, details_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, source_key) DO UPDATE SET
      ready = excluded.ready,
      database_name = excluded.database_name,
      schema_fingerprint = excluded.schema_fingerprint,
      last_observed_at = excluded.last_observed_at,
      last_error = excluded.last_error,
      details_json = excluded.details_json,
      updated_at = excluded.updated_at
  `);
  const readHealth = db.prepare("SELECT * FROM provider_source_health WHERE provider = ? ORDER BY source_key");
  const upsertSubscriptionHealth = db.prepare(`
    INSERT INTO provider_subscription_health (
      provider, source_key, domain, generation, connected, apply_duration_ms,
      lag_ms, reconnects, malformed_rows, last_error, updated_at
    ) VALUES ('relay', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, source_key, domain) DO UPDATE SET
      generation = excluded.generation,
      connected = excluded.connected,
      apply_duration_ms = excluded.apply_duration_ms,
      lag_ms = excluded.lag_ms,
      reconnects = excluded.reconnects,
      malformed_rows = excluded.malformed_rows,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `);
  const readSubscriptionHealth = db.prepare(`
    SELECT * FROM provider_subscription_health
    WHERE provider = 'relay' AND source_key = ? AND domain = ?
  `);
  const insertTransition = db.prepare(`
    INSERT INTO provider_transition_outbox (
      transition_key, claim_id, domain, observed_at, payload_json,
      attempts, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
    ON CONFLICT(transition_key) DO NOTHING
  `);
  const listPendingTransitions = db.prepare(`
    SELECT *
    FROM provider_transition_outbox
    WHERE claim_id = ? AND domain = ?
    ORDER BY rowid
  `);
  const recordTransitionError = db.prepare(`
    UPDATE provider_transition_outbox
    SET attempts = attempts + 1, last_error = ?, updated_at = ?
    WHERE transition_key = ?
  `);
  const ackTransition = db.prepare(
    "DELETE FROM provider_transition_outbox WHERE transition_key = ?",
  );
  const insertSourcedActivity = db.prepare(`
    INSERT OR IGNORE INTO activity_events (
      claim_id, event_type, summary, occurred_at, metadata_json, source_key
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertContributionEvent = db.prepare(`
    INSERT OR IGNORE INTO production_contribution_events (
      source_key, claim_id, region_id, craft_entity_id, contributor_entity_id,
      attribution_confidence, contributed_progress, contributed_xp, occurred_at,
      received_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const readContribution = db.prepare(`
    SELECT contributed_progress, contributed_xp, contribution_count, first_seen
    FROM production_contributions
    WHERE contribution_key = ?
  `);
  const upsertContribution = db.prepare(`
    INSERT INTO production_contributions (
      contribution_key, claim_id, craft_entity_id, contributor_entity_id,
      contributor_name, attribution_confidence, profession, craft_label,
      structure_name, item_tier, contributed_progress, contributed_xp,
      contribution_count, first_contributed_at, last_contributed_at, first_seen,
      updated_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(contribution_key) DO UPDATE SET
      contributor_name = excluded.contributor_name,
      attribution_confidence = excluded.attribution_confidence,
      profession = excluded.profession,
      craft_label = excluded.craft_label,
      structure_name = excluded.structure_name,
      item_tier = excluded.item_tier,
      contributed_progress = excluded.contributed_progress,
      contributed_xp = excluded.contributed_xp,
      contribution_count = excluded.contribution_count,
      last_contributed_at = excluded.last_contributed_at,
      updated_at = excluded.updated_at,
      raw_json = excluded.raw_json
  `);

  const commitBatch = (
    batch: DomainSnapshotBatch,
    transition: ProviderTransition | null,
  ) => {
      const changedDomains: DomainKey[] = [];
      let generatedAt = "";
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const [domain, snapshot] of Object.entries(batch.domains)) {
          if (!snapshot) continue;
          const receivedAt = snapshot.provenance.receivedAt;
          const result = upsert.run(
            batch.claimId,
            domain,
            JSON.stringify(snapshot.data),
            receivedAt,
            receivedAt,
            receivedAt,
            receivedAt,
            snapshot.provenance.provider,
            snapshot.provenance.sourceKey,
            snapshot.provenance.regionId,
            snapshot.provenance.database,
            snapshot.provenance.schemaFingerprint,
            snapshot.provenance.sourceObservedAt,
            receivedAt,
            "fresh",
            snapshot.confidence,
            batch.generation,
            JSON.stringify(snapshot.warnings),
          );
          if (Number(result.changes) > 0) {
            changedDomains.push(domain as DomainKey);
            if (!generatedAt || receivedAt > generatedAt) generatedAt = receivedAt;
          }
        }
        if (transition) {
          if (
            transition.claimId !== batch.claimId
            || !batch.domains[transition.domain]
          ) {
            throw new TypeError(
              "Provider transition must match a domain in the committed generation",
            );
          }
          insertTransition.run(
            transition.transitionKey,
            transition.claimId,
            transition.domain,
            transition.observedAt,
            JSON.stringify(transition.payload),
            transition.observedAt,
            transition.observedAt,
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      if (changedDomains.length) {
        options.onCommit?.({
          claimId: batch.claimId,
          generation: batch.generation,
          generatedAt,
          changedDomains,
        });
      }
  };

  return {
    async commitGeneration(batch: DomainSnapshotBatch) {
      commitBatch(batch, null);
    },
    async commitGenerationWithTransition(batch, transition) {
      commitBatch(batch, transition);
    },
    listPendingTransitions(claimId, domain) {
      return listPendingTransitions.all(claimId, domain).map((row) => ({
        transitionKey: String(row.transition_key),
        claimId: String(row.claim_id),
        domain: String(row.domain) as DomainKey,
        observedAt: String(row.observed_at),
        payload: JSON.parse(String(row.payload_json)),
        attempts: Number(row.attempts ?? 0),
        lastError: row.last_error == null ? null : String(row.last_error),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    },
    async recordTransitionError(transitionKey, error, updatedAt) {
      recordTransitionError.run(error, updatedAt, transitionKey);
    },
    async ackTransition(transitionKey) {
      ackTransition.run(transitionKey);
    },
    async appendEvents(events: DomainEvent[]) {
      if (!events.length) return;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const event of events) {
          const data = event.data;
          if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new TypeError("Domain event data must be an object");
          }
          const payload = data as Record<string, unknown>;
          if (event.domain === "inventories" && payload.eventType === "storage") {
            if (typeof payload.summary !== "string" || !payload.summary.trim()) {
              throw new TypeError("Durable storage event summary is required");
            }
            const metadata = payload.metadata;
            if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
              throw new TypeError("Durable storage event metadata must be an object");
            }
            insertSourcedActivity.run(
              event.claimId,
              "storage",
              payload.summary,
              event.occurredAt,
              JSON.stringify(metadata),
              event.sourceKey,
            );
            continue;
          }
          if (event.domain === "contributions" && payload.eventType === "craft_contribution") {
            const requiredDecimal = (key: string) => {
              const value = String(payload[key] ?? "").trim();
              if (!/^\d+$/.test(value)) {
                throw new TypeError(`Durable craft contribution ${key} must be a decimal integer`);
              }
              return value;
            };
            const requiredText = (key: string) => {
              const value = String(payload[key] ?? "").trim();
              if (!value) throw new TypeError(`Durable craft contribution ${key} is required`);
              return value;
            };
            const craftId = requiredDecimal("craftEntityId");
            const progress = requiredDecimal("contributedProgress");
            const xp = canonicalNonNegativeDecimal(
              payload.contributedXp,
              "Durable craft contribution contributed XP",
            );
            const count = requiredDecimal("contributionCount");
            const attributionConfidence = requiredText("attributionConfidence");
            if (!["authoritative", "joined", "unknown"].includes(attributionConfidence)) {
              throw new TypeError("Durable craft contribution attribution confidence is invalid");
            }
            const contributorId = attributionConfidence === "unknown"
              ? null
              : requiredDecimal("contributorEntityId");
            if (attributionConfidence === "unknown" && payload.contributorEntityId != null) {
              throw new TypeError("Unknown durable craft contributions cannot identify a contributor");
            }
            if (BigInt(progress) <= 0n || BigInt(count) <= 0n) {
              throw new TypeError("Durable craft contribution deltas must be positive");
            }
            const receivedAt = new Date().toISOString();
            const inserted = insertContributionEvent.run(
              event.sourceKey,
              event.claimId,
              requiredDecimal("regionId"),
              craftId,
              contributorId,
              attributionConfidence,
              progress,
              xp,
              event.occurredAt,
              receivedAt,
              JSON.stringify(payload),
            );
            if (Number(inserted.changes) === 0) continue;
            const contributionKey = `${event.claimId}:${craftId}:${
              contributorId ?? "unknown"
            }`;
            const previous = readContribution.get(contributionKey);
            const totalProgress = (
              BigInt(String(previous?.contributed_progress ?? "0")) + BigInt(progress)
            ).toString();
            const totalXp = addDecimal(
              String(previous?.contributed_xp ?? "0"),
              xp,
            );
            const totalCount = (
              BigInt(String(previous?.contribution_count ?? "0")) + BigInt(count)
            ).toString();
            upsertContribution.run(
              contributionKey,
              event.claimId,
              craftId,
              contributorId,
              requiredText("contributorName"),
              attributionConfidence,
              String(payload.profession ?? "").trim() || null,
              requiredText("craftLabel"),
              requiredText("structureName"),
              String(payload.itemTier ?? "").trim() || null,
              totalProgress,
              totalXp,
              totalCount,
              event.occurredAt,
              event.occurredAt,
              String(previous?.first_seen ?? receivedAt),
              receivedAt,
              JSON.stringify(payload),
            );
            continue;
          }
          throw new TypeError(`Unsupported durable domain event: ${event.domain}`);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async markError(claimId, domain, error, attemptedAt) {
      markError.run(attemptedAt, error, attemptedAt, claimId, domain);
    },
    async recordHealth(health, observedAt) {
      const details = {
        running: health.running,
        topologyReady: health.topologyReady,
        cacheReady: health.cacheReady,
        generation: health.generation,
        lastRefreshAt: health.lastRefreshAt,
      };
      db.exec("BEGIN IMMEDIATE");
      try {
        upsertHealth.run(
          health.provider,
          "relay-cache",
          health.cacheReady ? 1 : 0,
          null,
          null,
          health.lastRefreshAt,
          health.lastError,
          JSON.stringify(details),
          observedAt,
        );
        for (const [sourceKey, source] of Object.entries(health.sources)) {
          upsertHealth.run(
            health.provider,
            sourceKey,
            source.ready ? 1 : 0,
            source.database,
            source.schemaFingerprint,
            health.lastRefreshAt,
            health.lastError,
            "{}",
            observedAt,
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    readHealth() {
      const rows = readHealth.all("relay");
      const cache = rows.find((row) => row.source_key === "relay-cache");
      if (!cache) return null;
      const details = JSON.parse(String(cache.details_json ?? "{}")) as Record<string, unknown>;
      const sources: ProviderHealth["sources"] = {};
      for (const row of rows) {
        const sourceKey = String(row.source_key);
        if (sourceKey === "relay-cache") continue;
        sources[sourceKey] = {
          ready: Number(row.ready) === 1,
          database: row.database_name == null ? null : String(row.database_name),
          schemaFingerprint: row.schema_fingerprint == null ? null : String(row.schema_fingerprint),
        };
      }
      return {
        provider: "relay",
        running: details.running === true,
        topologyReady: details.topologyReady === true,
        cacheReady: details.cacheReady === true,
        generation: Number(details.generation ?? 0),
        lastRefreshAt: details.lastRefreshAt == null ? null : String(details.lastRefreshAt),
        lastError: cache.last_error == null ? null : String(cache.last_error),
        sources,
      };
    },
    async recordSubscriptionHealth(health, observedAt) {
      upsertSubscriptionHealth.run(
        health.sourceKey,
        health.domain,
        health.generation,
        health.connected ? 1 : 0,
        health.applyDurationMs ?? null,
        health.lagMs ?? null,
        health.reconnects ?? 0,
        health.malformedRows ?? 0,
        health.lastError ?? null,
        observedAt,
      );
    },
    readSubscriptionHealth(sourceKey, domain) {
      const row = readSubscriptionHealth.get(sourceKey, domain);
      if (!row) return null;
      return {
        sourceKey: String(row.source_key),
        domain: String(row.domain) as DomainKey,
        generation: Number(row.generation ?? 0),
        connected: Number(row.connected) === 1,
        applyDurationMs: row.apply_duration_ms == null ? null : Number(row.apply_duration_ms),
        lagMs: row.lag_ms == null ? null : Number(row.lag_ms),
        reconnects: Number(row.reconnects ?? 0),
        malformedRows: Number(row.malformed_rows ?? 0),
        lastError: row.last_error == null ? null : String(row.last_error),
        updatedAt: String(row.updated_at),
      };
    },
    nextGeneration(claimId) {
      return Number(maxGeneration.get(claimId)?.generation ?? 0) + 1;
    },
    read(claimId, domain) {
      const row = read.get(claimId, domain);
      if (!row) return null;
      return {
        data: JSON.parse(String(row.data_json)),
        confidence: String(row.confidence ?? "unknown") as StoredDomainSnapshot["confidence"],
        generation: Number(row.generation ?? 0),
        lastError: row.last_error == null ? null : String(row.last_error),
        provenance: {
          provider: "relay",
          sourceKey: String(row.source_key ?? "relay-cache") as StoredDomainSnapshot["provenance"]["sourceKey"],
          regionId: row.region_id == null ? null : String(row.region_id),
          database: row.database_name == null ? null : String(row.database_name),
          schemaFingerprint: row.schema_fingerprint == null ? null : String(row.schema_fingerprint),
          sourceObservedAt: row.source_observed_at == null ? null : String(row.source_observed_at),
          receivedAt: String(row.received_at ?? row.last_success_at),
        },
        warnings: JSON.parse(String(row.warnings_json ?? "[]")),
      };
    },
  };
}
