import React from "react";
import { RefreshCw } from "lucide-react";

import type { PublicRoute } from "./routes.mjs";
import type { PublicSnapshotController } from "./usePublicSnapshot";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];

const DOMAIN_SETS: Record<string, string[]> = {
  dashboard: ["claim"],
  members: ["claim", "members", "citizens"],
  professions: ["claim", "members", "citizens"],
  inventory: ["claim", "inventories"],
  crafts: ["claim", "crafts"],
};

export function publicDomainsForRoute(routeId: string): string[] {
  return DOMAIN_SETS[routeId] ? [...DOMAIN_SETS[routeId]] : [];
}

function number(value: unknown) {
  const text = String(value ?? "0");
  try { return /^\d+$/.test(text) ? BigInt(text).toLocaleString() : text; } catch { return text; }
}

function Freshness({ controller }: { controller: PublicSnapshotController }) {
  if (!controller.snapshot) return null;
  const seconds = Math.max(0, Math.round(controller.snapshot.ageMs / 1000));
  return <span className={`public-freshness ${controller.snapshot.stale ? "is-stale" : ""}`}>{controller.refreshing ? "Refreshing…" : controller.snapshot.stale ? `Stale · ${seconds}s old` : `Live · ${seconds}s old`}</span>;
}

function Overview({ claim }: { claim: Row }) {
  const metrics: Array<[string, unknown]> = [["Tier", claim.tier], ["Supplies", claim.supplies], ["Treasury", claim.treasury], ["Tiles", claim.numTiles]];
  return <section className="public-metric-grid">{metrics.map(([label, value]) => <article className="public-panel" key={label}><span>{label}</span><strong>{value == null ? "Unavailable" : number(value)}</strong></article>)}</section>;
}

function Members({ members }: { members: Row }) {
  return (
    <section className="public-panel">
      <h2>Current claim roster</h2>
      {!members.data ? <p>Member data is temporarily unavailable.</p> : (
        <div className="public-table">{rows(members.data).map((member) => (
          <article key={String(member.entityId)}>
            <strong>{String(member.userName || "Unknown member")}</strong>
            <span>{String(member.status ?? member.membershipStatus ?? "Current member")}</span>
          </article>
        ))}</div>
      )}
    </section>
  );
}

function Professions({ members, citizens }: { members: Row; citizens: Row }) {
  const memberRows = rows(members.data);
  const professionRows = rows(citizens.data).flatMap((citizen) => {
    const member = memberRows.find((entry) => String(entry.playerEntityId) === String(citizen.playerEntityId));
    const skills = row(citizen.skills);
    const names = row(citizen.skillNames);
    return Object.entries(skills).map(([skillId, value]) => ({
      skillId,
      profession: String(names[skillId] ?? `Profession ${skillId}`),
      level: Number.isFinite(Number(value)) ? Number(value) : 0,
      member: String(member?.userName ?? "Unknown member"),
    }));
  }).sort((left, right) => left.profession.localeCompare(right.profession) || right.level - left.level || left.member.localeCompare(right.member));

  return (
    <section className="public-panel">
      <h2>Claim professions</h2>
      {!citizens.data ? <p>Profession data is temporarily unavailable.</p> : professionRows.length === 0 ? <p>No professions are currently reported.</p> : (
        <div className="public-table">{professionRows.map((entry) => (
          <article key={`${entry.skillId}:${entry.member}`}><strong>{entry.profession}</strong><span>{entry.member} · {entry.level}</span></article>
        ))}</div>
      )}
    </section>
  );
}

function TypedStack({ stack }: { stack: Row }) {
  const catalogKey = String(stack.catalogKey ?? `${stack.itemType === "cargo" ? "cargo" : "items"}:${stack.itemId ?? ""}`);
  return <li className="public-stack"><span>{catalogKey.startsWith("cargo:") ? "Cargo" : "Item"} · #{String(stack.itemId ?? "—")}</span><strong>{number(stack.amount ?? stack.quantity)}</strong></li>;
}

function Inventory({ inventory }: { inventory: Row }) {
  const data = row(inventory.data);
  const buildings = rows(data.buildings);
  return <section className="public-panel"><h2>Shared inventory</h2>{!inventory.data ? <p>Inventory data is temporarily unavailable.</p> : buildings.length === 0 ? <p>No shared inventory is currently reported.</p> : <div className="public-inventory-grid">{buildings.map((building) => <article key={String(building.entityId)}><h3>{String(building.nickname || building.name || "Building")}</h3><ul>{rows(building.items).map((stack, index) => <TypedStack key={`${String(stack.catalogKey)}-${index}`} stack={stack} />)}</ul></article>)}</div>}</section>;
}

function Crafts({ crafts }: { crafts: Row }) {
  const results = rows(row(crafts.data).craftResults);
  return <section className="public-panel"><h2>Current and completed crafts</h2>{!crafts.data ? <p>Craft data is temporarily unavailable.</p> : results.length === 0 ? <p>No crafts are currently reported.</p> : <div className="public-table">{results.map((craft) => <article key={String(craft.entityId)}><strong>{String(craft.buildingName || "Claim craft")}</strong><span>{craft.completed === true ? "Completed" : `In progress · ${number(craft.progress)} / ${number(craft.totalActionsRequired)}`} · {rows(craft.craftedItem).map((stack) => String(stack.catalogKey ?? "item")).join(", ") || "No output listed"}</span></article>)}</div>}</section>;
}

export function PublicClaimPages({ route, controller }: { route: PublicRoute; controller: PublicSnapshotController }) {
  if (controller.loading && !controller.snapshot) return <section className="public-state" role="status">Loading current claim state…</section>;
  if (controller.error && !controller.snapshot) return <section className="public-state is-error" role="alert">{controller.error}</section>;
  if (!controller.claimId || !controller.snapshot) return null;
  return (
    <>
      <header className="public-page-heading">
        <div><p>Claim #{controller.claimId}</p><h1>{String(controller.claim.name ?? "Claim")}</h1><span>Region {String(controller.snapshot.regionId ?? "—")}</span></div>
        <div className="public-heading-actions"><Freshness controller={controller} /><button className="toolbar-button" onClick={() => void controller.refresh()} disabled={controller.refreshing}><RefreshCw size={16} /> Refresh</button></div>
      </header>
      {controller.warnings.length > 0 ? <section className="public-warning" role="status">{controller.warnings.join(" ")}</section> : null}
      {controller.error ? <section className="public-warning" role="alert">Refresh failed; showing the last received data. {controller.error}</section> : null}
      {route.id === "dashboard" ? <Overview claim={controller.claim} /> : null}
      {route.id === "members" ? <Members members={row(controller.snapshot.domains.members)} /> : null}
      {route.id === "professions" ? <Professions members={row(controller.snapshot.domains.members)} citizens={row(controller.snapshot.domains.citizens)} /> : null}
      {route.id === "inventory" ? <Inventory inventory={row(controller.snapshot.domains.inventories)} /> : null}
      {route.id === "crafts" ? <Crafts crafts={row(controller.snapshot.domains.crafts)} /> : null}
    </>
  );
}
