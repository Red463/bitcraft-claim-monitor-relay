import type { AnyRecord } from "../main-app-data";
import { plannerRowOrder, plannerTaxonomyFor, PLANNER_SECTION_ORDER } from "./craftPlanningTaxonomy.ts";
import { plannerOverrideKeyFor } from "./craftPlanningTaxonomyData.mjs";

export const NEED_COLUMNS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "Materials"];

export const NEED_SECTIONS: string[] = [...PLANNER_SECTION_ORDER];

export type NeedCell = {
  item: AnyRecord;
  items: AnyRecord[];
  name: string;
  missing: number;
  required: number;
  available: number;
  inProgress: number;
  guaranteedInProgress: number;
  estimatedInProgress: number;
};

export type NeedRow = {
  name: string;
  apiName: string;
  overrideKey: string;
  apiSection: string;
  plannerSection: string;
  sectionOverride: string | null;
  rowNameOverride: string | null;
  maxMissing: number;
  cells: Map<string, NeedCell>;
};

export type NeedGroup = {
  section: string;
  rows: NeedRow[];
  required: number;
  covered: number;
  completion: number;
};

export function needsBoardCompletion(board: NeedGroup[]) {
  const required = board.reduce((sum, group) => sum + group.required, 0);
  const covered = board.reduce((sum, group) => sum + group.covered, 0);
  return { required, covered, completion: required > 0 ? Math.round((covered / required) * 1000) / 10 : 100 };
}

export function filterNeedsBoard(board: NeedGroup[], selectedSections: string[], shortagesOnly: boolean, query: string): NeedGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return board
    .filter((group) => selectedSections.length === 0 || selectedSections.includes(group.section))
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => {
        if (shortagesOnly && ![...row.cells.values()].some((cell) => cell.missing > 0)) return false;
        if (!normalizedQuery) return true;
        return row.name.toLocaleLowerCase().includes(normalizedQuery) || row.apiName.toLocaleLowerCase().includes(normalizedQuery);
      }),
    }))
    .filter((group) => group.rows.length > 0);
}

export function itemKey(item: AnyRecord) {
  const id = item.key ?? item.itemKey ?? item.id ?? item.itemId ?? item.entityId ?? item.name ?? item.label;
  const kind = item.kind ?? item.itemKind ?? item.itemType ?? "item";
  return String(item.key ?? `${kind}:${id}`);
}

export function itemName(item: AnyRecord) {
  return String(item.name ?? item.label ?? item.itemName ?? item.key ?? "Unknown item");
}

function itemTier(item: AnyRecord) {
  const value = Number(item.tier ?? item.itemTier ?? item.tierLevel);
  return Number.isFinite(value) && value >= 1 && value <= 10 ? value : null;
}

function rowNameForNeed(item: AnyRecord) {
  return plannerTaxonomyFor(item).row;
}

function rowOverrideKeyForNeed(item: AnyRecord) {
  return plannerOverrideKeyFor(item, itemKey(item));
}

function columnForNeed(item: AnyRecord) {
  const tier = itemTier(item);
  return tier ? `T${tier}` : "Materials";
}

function sortSectionName(a: string, b: string) {
  const ai = NEED_SECTIONS.indexOf(a);
  const bi = NEED_SECTIONS.indexOf(b);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  return a.localeCompare(b);
}

export function buildNeedsBoard(materials: AnyRecord[], targets: AnyRecord[]): NeedGroup[] {
  const targetKeys = new Set(targets.map(itemKey));
  const groups = new Map<string, Map<string, NeedRow>>();

  for (const material of materials) {
    const taxonomy = plannerTaxonomyFor(material);
    if (taxonomy.hidden) continue;
    const missing = Number(material.missingNow ?? material.missing) || 0;
    const required = Number(material.planRequired ?? material.bufferedRequired ?? material.requiredNow ?? material.required) || 0;
    const hasRecipeUsages = Boolean(material.hasRecipeUsages || (Array.isArray(material.recipeUsages) && material.recipeUsages.length > 0));
    if (material.isTarget || targetKeys.has(itemKey(material))) continue;
    if (required <= 0 || (missing <= 0 && !hasRecipeUsages)) continue;
    const apiName = rowNameForNeed(material);
    const rowOverrideKey = rowOverrideKeyForNeed(material);
    const suppliedOverrideKey = material.sectionOverrideKey == null ? null : String(material.sectionOverrideKey);
    const overrideMatchesFamily = suppliedOverrideKey == null || suppliedOverrideKey === rowOverrideKey;
    const sectionOverride = overrideMatchesFamily && material.sectionOverride != null ? String(material.sectionOverride) : null;
    const plannerSection = taxonomy.section || String(material.section ?? "Other");
    const section = sectionOverride || plannerSection;
    const rowNameOverride = overrideMatchesFamily && material.rowNameOverride != null ? String(material.rowNameOverride).trim() || null : null;
    const rowName = rowNameOverride || apiName;
    const apiSection = String(material.apiSection ?? material.section ?? "Other");
    const column = columnForNeed(material);
    if (!groups.has(section)) groups.set(section, new Map());
    const rows = groups.get(section)!;
    if (!rows.has(rowOverrideKey)) rows.set(rowOverrideKey, { name: rowName, apiName, overrideKey: rowOverrideKey, apiSection, plannerSection, sectionOverride, rowNameOverride, maxMissing: 0, cells: new Map() });
    const row = rows.get(rowOverrideKey)!;
    const existing = row.cells.get(column);
    const available = Number(material.available) || 0;
    const inProgress = Number(material.inProgress) || 0;
    const estimatedInProgress = Number(material.estimatedInProgress) || 0;
    const guaranteedInProgress = material.guaranteedInProgress != null
      ? Number(material.guaranteedInProgress) || 0
      : estimatedInProgress > 0 ? 0 : inProgress;
    if (existing) {
      existing.items.push(material);
      existing.missing += missing;
      existing.required += required;
      existing.available += available;
      existing.inProgress += inProgress;
      existing.guaranteedInProgress += guaranteedInProgress;
      existing.estimatedInProgress += estimatedInProgress;
    } else {
      row.cells.set(column, { item: material, items: [material], name: itemName(material), missing, required, available, inProgress, guaranteedInProgress, estimatedInProgress });
    }
    row.maxMissing = Math.max(row.maxMissing, missing > 0 ? missing : required);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => sortSectionName(a, b))
    .map(([section, rows]) => {
      const sortedRows = [...rows.values()].sort((a, b) => plannerRowOrder(section, a.name) - plannerRowOrder(section, b.name) || a.name.localeCompare(b.name));
      const cells = sortedRows.flatMap((row) => [...row.cells.values()]);
      const required = cells.reduce((sum, cell) => sum + cell.required, 0);
      const covered = cells.reduce((sum, cell) => sum + Math.min(cell.required, cell.available + cell.guaranteedInProgress), 0);
      return { section, rows: sortedRows, required, covered, completion: required > 0 ? Math.round((covered / required) * 1000) / 10 : 100 };
    });
}
