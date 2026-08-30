import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Craft Planning page is registered in navigation, access control, and AppShell", () => {
  const appType = readFileSync(new URL("../src/types/app.ts", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../src/navigation.ts", import.meta.url), "utf8");
  const access = readFileSync(new URL("../src/access/accessControl.mjs", import.meta.url), "utf8");
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appType, /\| "planning"/);
  assert.match(navigation, /\["planning", "Craft Planning"/);
  assert.match(access, /\["planning", "Craft Planning"\]/);
  assert.match(appShell, /lazyRoute\(\(\) => import\("\.\/pages\/CraftPlanningPage"\)/);
  assert.match(appShell, /planning: <CraftPlanningPage/);
});

test("Craft Planning labels estimated active output as material-planning coverage", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");
  const cellBody = page.match(/function needCellNode[\s\S]+?function summaryStat/)?.[0] ?? "";

  assert.match(page, /EqualApproximately/);
  assert.match(cellBody, /aria-label="Approximate requirement"/);
  assert.match(cellBody, /cell\.available \+ cell\.guaranteedInProgress \+ cell\.estimatedInProgress/);
  assert.match(cellBody, /aria-label="Estimated craft output; counted for material planning"/);
  assert.match(cellBody, /craft-plan-cell-indicators/);
  assert.match(cellBody, /craft-plan-cell-indicator is-guaranteed[\s\S]*quantity\(cell\.guaranteedInProgress\)/);
  assert.match(cellBody, /craft-plan-cell-indicator is-estimated[\s\S]*quantity\(cell\.estimatedInProgress\)/);
  assert.doesNotMatch(cellBody, /craft-plan-estimated-marker/);
  assert.doesNotMatch(cellBody, />~<\/span>/);
  assert.match(page, />Approximate requirement<\/span>/);
  assert.match(page, />Covered for material planning<\/span>/);
  assert.match(page, />Estimated craft output; counted for material planning<\/span>/);
  assert.match(page, /Passive craft/);
  assert.match(page, /Location not reported by Relay/);
  assert.doesNotMatch(page, />Estimated active output; not counted<\/span>/);
});

test("needs board red state describes missing direct coverage without claiming a recipe error", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");

  assert.match(page, /No direct stock or craft coverage/);
  assert.doesNotMatch(page, /Recipe cannot start from counted stock/);
});

test("Craft Planning exposes a public probability workbook download with explicit gathering units", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");

  assert.match(server, /\/api\/local\/catalog\/probabilities\.xlsx/);
  assert.match(server, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(server, /getProbabilityWorkbookData/);
  assert.match(server, /Probability catalogue is not ready/);
  assert.match(page, /Download probabilities/);
  assert.match(page, /per node progress/);
  assert.match(page, /per full node/);
  assert.match(page, /node equivalents/);
  assert.match(page, /<summary>Show calculation<\/summary>/);
  assert.match(page, /No additional nodes needed/);
  assert.match(page, /Full-node estimates are unavailable for prospecting/);
  assert.doesNotMatch(page, /Expected per full resource/);
  assert.doesNotMatch(page, /full-resource equivalents/);
  assert.doesNotMatch(page, /per gathering action/);
});

test("Craft Planning makes the distinct-material shortage count explicit", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");

  assert.match(page, /"Materials still short"/);
  assert.match(page, /"different materials after stock and tracked crafts"/);
  assert.match(page, /<span>\{quantity\(totals\.missingItems\)\} materials still short<\/span>/);
  assert.doesNotMatch(page, /"Materials missing"/);
  assert.doesNotMatch(page, /<span>\{quantity\(totals\.missingItems\)\} missing items<\/span>/);
});

test("Craft Planning Needs Board keeps the balanced cell hierarchy readable", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");
  const cellBody = page.match(/function needCellNode[\s\S]+?function summaryStat/)?.[0] ?? "";

  assert.match(cellBody, /className="craft-plan-cell-needed-label"[^>]*>Needed now<\/span>/);
  assert.match(cellBody, /className="craft-plan-cell-plan-total"[^>]*>Plan \{quantity\(cell\.required\)\}<\/span>/);
  assert.match(cellBody, /className="craft-plan-cell-stock"[^>]*>Stock \{quantity\(cell\.available\)\}<\/span>/);
  assert.doesNotMatch(cellBody, /Stock \{quantity\(cell\.available\)\} · Guaranteed/);
});

test("Craft Planning page renders selectable plans with owner-aware management", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");

  assert.match(page, /\/craft-plans\/\$\{encodeURIComponent\(selectedPlanId\)\}\?claimId=/);
  assert.match(page, /<optgroup label="Shared plans">/);
  assert.match(page, /<optgroup label="My plans">/);
  assert.match(page, /canEditSelectedPlan/);
  assert.match(page, /\/admin\/me/);
  assert.match(page, /Manage Plan/);
  assert.match(page, /className="dashboard-top-meta"/);
  assert.doesNotMatch(page, /className="top-meta"/);
  assert.match(page, /className="craft-plan-targets-toggle"/);
  assert.match(page, /<Target size=\{17\} \/>\s*<span>Targets<\/span>/);
  assert.match(page, /<ItemIcon item=\{item\} \/>/);
  assert.doesNotMatch(page, /craft-plan-item-icon"><ItemIcon item=\{item\} \/>/);
  assert.match(page, /Needs Board/);
  assert.match(page, /newly built/);
  assert.match(page, /Tracking pending/);
  assert.match(page, /needed/);
  assert.match(page, /<strong>\{quantity\(cell\.missing\)\}/);
  assert.match(page, /craft-plan-cell-needed-label/);
  assert.match(page, /craft-plan-cell-plan-total/);
  assert.match(page, /craft-plan-cell-stock/);
  assert.match(page, /craft-plan-needs-board/);
  assert.match(page, /craft-plan-section-filters/);
  assert.match(page, /craft-plan-needs-search/);
  assert.match(page, /placeholder="Search items"/);
  assert.match(page, /filterNeedsBoard\(personalBoard\.board, selectedSections, shortagesOnly, needsSearch\)/);
  assert.match(page, /No matching items in the selected Needs Board filters/);
  assert.match(page, /Shortages only/);
  assert.match(page, /effortView\.confirmed\.sections\[group\.section\]/);
  assert.doesNotMatch(page, /craft-plan-effort-warning/);
  assert.doesNotMatch(page, /effortView\.warnings(?:\[0\]|\.join)/);
  assert.doesNotMatch(page, /effortView\.overall\.completion == null && effortView\.warnings\[0\]/);
  assert.match(page, /craft-plan-needs-section-row/);
  assert.match(page, /craft-plan-needs-legend/);
  assert.doesNotMatch(page, /planned secondary outputs|plannedOutput/);
  assert.match(page, /Stock \{quantity\(cell\.available\)\}/);
  assert.match(page, /Guaranteed craft output/);
  assert.match(page, /guaranteed/);
  assert.match(page, /estimated/);
  assert.match(page, /craft-plan-row-section-button/);
  assert.match(page, /sectionOverrides/);
  assert.match(page, /rowNameOverrides/);
  assert.match(page, /Row display name/);
  assert.match(page, /Planner default:/);
  assert.match(page, /Use planner defaults/);
  assert.doesNotMatch(page, /Use API defaults/);
  assert.match(page, /section:\s*row\.sectionOverride\s*\?\?\s*row\.plannerSection/);
  assert.doesNotMatch(page, /section:\s*row\.sectionOverride\s*\?\?\s*row\.apiSection/);
  assert.match(page, /Save row/);
  assert.match(page, /selectedNeed/);
  assert.match(page, /import \{ Dialog \} from "\.\.\/components\/main\/Dialog";/);
  assert.match(page, /<Dialog[\s\S]*craft-plan-need-detail/);
  assert.match(page, /craft-plan-need-detail/);
  assert.match(page, /How to get this/);
  assert.doesNotMatch(page, /<CraftPlanningRouteChooser/);
  assert.doesNotMatch(page, /routeSavePendingId/);
  assert.match(page, /craft-plan-route-readonly/);
  assert.match(page, /await openNeedDetail\(selectedNeedRef\.current, true\)/);
  assert.doesNotMatch(page, /Treat this cell as gathered/);
  assert.doesNotMatch(page, /cellItemKeys/);
  assert.doesNotMatch(page, /gatheredCellState/);
  assert.doesNotMatch(page, /setCellGathered/);
  assert.doesNotMatch(page, /craft-plan-gathered-control/);
  assert.doesNotMatch(page, /saveGatheredOverride/);
  assert.match(page, /x-csrf-token/);
  assert.doesNotMatch(page, /Open Map resource finder/);
  assert.match(page, /Craft output/);
  assert.match(page, /Craft byproduct/);
  assert.match(page, /Gathering output/);
  assert.match(page, /Gathering byproduct/);
  assert.match(page, /routeType\.startsWith\("gathering"\)/);
  assert.match(page, /routeType\.endsWith\("-byproduct"\)/);
  assert.doesNotMatch(page, /route\.routeType === "gathering-byproduct"/);
  assert.match(page, /Guaranteed output/);
  assert.match(page, /Expected yield/);
  assert.match(page, /per craft/);
  assert.match(page, /per node progress/);
  assert.match(page, /acquisitionRouteMetrics/);
  assert.match(page, /about 1 .* per .*node progress/i);
  assert.doesNotMatch(page, /per gathering action/);
  assert.match(page, /Craft inputs/);
  assert.match(page, /Used for/);
  assert.match(page, /Show \{usage\.entries\.length\} recipe demands/);
  assert.match(page, /selectedNeedSources/);
  assert.match(page, /selectedNeedSourceRoutes/);
  assert.match(page, /selectedNeedUsages/);
  assert.match(page, /groupNeedCellSources/);
  assert.match(page, /groupNeedCellSourceRoutes/);
  assert.match(page, /groupNeedCellRecipeUsages/);
  assert.match(page, /Needed for/);
  assert.doesNotMatch(page, /ItemLabel/);
  assert.match(page, /Stock locations/);
  assert.match(page, /selectedSections/);
  assert.match(page, /function toggleSection/);
  assert.match(page, /aria-pressed=\{selected\}/);
  assert.match(page, /setSelectedSections\(\[\]\)/);
  assert.match(page, /needsBoardRowCount/);
  assert.doesNotMatch(page, /All <span>\{needsBoard\.length\}<\/span>/);
  assert.doesNotMatch(page, /inferTierFromName/);
  assert.doesNotMatch(page, /inferTierFromItemId/);
  assert.doesNotMatch(page, /UNTIERED_MATERIAL_PATTERN/);
  assert.doesNotMatch(page, /TIER_NAME_PREFIXES/);
  assert.doesNotMatch(page, /craft-plan-need-icon/);
  assert.ok(page.indexOf("Targets") < page.indexOf("Needs Board"), "targets should render before the public needs board");
  assert.doesNotMatch(page, /<h3><Package size=\{17\} \/> Materials<\/h3>/);
  assert.doesNotMatch(page, /<DataTable rows=\{materials\}/);
  assert.doesNotMatch(page, /<h3><Route size=\{17\} \/> Recipe Routes<\/h3>/);
  assert.match(page, /Catalog diagnostics/);
  assert.match(page, /canEditSelectedPlan && warnings\.length/);
  assert.match(page, /<details className="[^"]*craft-plan-catalog-diagnostics[^"]*"/);
  assert.match(page, /Unavailable stock sources/);
  assert.match(page, /CraftPlanManagerDialog/);
});

test("Craft Planning keeps a settled load error visible while background retries run", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");
  const errorGuard = page.indexOf("if (error)");
  const loadingGuard = page.indexOf("if (loading && !plan)");

  assert.ok(errorGuard > 0);
  assert.ok(loadingGuard > 0);
  assert.ok(errorGuard < loadingGuard, "the error state must render before the retry loading state");
  assert.match(page, /Retry/);
});

test("Craft Planning acquisition routes use accessible comparable cards", () => {
  const chooser = readFileSync(new URL("../src/pages/CraftPlanningRouteChooser.tsx", import.meta.url), "utf8");

  assert.match(chooser, /<fieldset className="craft-plan-route-options"/);
  assert.match(chooser, /<legend>Choose acquisition route<\/legend>/);
  assert.match(chooser, /type="radio"/);
  assert.match(chooser, /checked=\{selected\}/);
  assert.match(chooser, /disabled=\{!canManage \|\| pendingRecipeId !== null/);
  assert.match(chooser, /aria-busy=\{pending\}/);
  assert.match(chooser, /acquisitionRouteLabel/);
  assert.match(chooser, /acquisitionRouteMetrics/);
  assert.match(chooser, /No additional nodes needed/);
  assert.match(chooser, /Yield calculation unavailable/);
  assert.match(chooser, /processing routes available/);
  assert.match(chooser, /choose the source material you plan to use/);
});

test("Craft Planning keeps the preferred fishing route browser-local", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles/craft-planning.css", import.meta.url), "utf8");

  assert.match(page, /usePersistedState<FishingRoutePreference>\("planning\.fishingRoute", "ocean"\)/);
  assert.match(page, /normalizeFishingRoutePreference\(fishingRoute\)/);
  assert.match(page, /applyPersonalFishingView\(needsBoard, plan\?\.personalViews\?\.fishing, normalizedFishingRoute\)/);
  assert.match(page, /personalBoard\.board/);
  assert.match(page, /aria-label="Preferred fishing route"/);
  assert.match(page, />Ocean<\/button>/);
  assert.match(page, />Lake<\/button>/);
  assert.match(page, /group\.section === "Fishing" \? <div className="craft-plan-fishing-route"/);
  assert.doesNotMatch(page, /craft-plan-section-filters[\s\S]{0,1800}aria-label="Preferred fishing route"/);
  assert.match(page, /personalBoard\.reason/);
  assert.match(page, /role="status"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(styles, /\.craft-plan-section-filters\s*>\s*button\s*>\s*span/);
  assert.doesNotMatch(styles, /\.craft-plan-section-filters span\s*\{/);
  assert.doesNotMatch(page.match(/async function saveRowOverride[\s\S]*?\n  }\n  async function saveRouteOverride/)?.[0] ?? "", /setFishingRoute/);
  assert.doesNotMatch(page.match(/async function saveRouteOverride[\s\S]*?\n  }\n\n  if \(loading/)?.[0] ?? "", /setFishingRoute/);
});

test("Craft Planning manager consolidates editing into four staged workspaces", () => {
  const manager = readFileSync(new URL("../src/pages/CraftPlanManagerDialog.tsx", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/components/admin/AdminCraftPlanSection.tsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles/craft-planning.css", import.meta.url), "utf8");

  assert.match(admin, /Open Manager/);
  assert.match(admin, /page=planning/);
  assert.match(manager, /\/admin\/craft-plan/);
  assert.match(manager, /Tier upgrade presets/);
  assert.match(manager, /Workstation presets/);
  assert.match(manager, /workstationPresets/);
  assert.match(manager, /addWorkstationPreset/);
  assert.match(manager, /\/admin\/craft-plan\/workstation-preset\?tier=/);
  assert.match(manager, /Loaded from live settlement research/);
  assert.match(manager, /Live settlement research has no tier upgrade materials available yet/);
  assert.match(manager, /tierPresets/);
  assert.match(manager, /Target items/);
  assert.doesNotMatch(manager, /craft-plan-item-icon"><ItemIcon item=\{target\} \/><\/span><ItemLabel item=\{target\} \/>/);
  assert.match(manager, /aria-label="Craft plan workspaces"/);
  assert.match(manager, /craftPlanManagerWorkspaces\(\{ canViewAudit, canEdit \}\)/);
  assert.match(manager, /All edits remain staged until Save Plan/);
  assert.match(manager, /Save Plan/);
  assert.match(manager, /Counted Sources/);
  assert.match(manager, /Recipe Review/);
  assert.match(manager, /Settlement storage/);
  assert.match(manager, /Player inventory and crafts/);
  assert.match(manager, /bankPlayerIds/);
  assert.match(manager, /bankContainerIds/);
  assert.match(manager, /\/admin\/craft-plan\/player-banks\?playerId=/);
  assert.match(manager, /BANK_LOAD_CONCURRENCY\s*=\s*3/);
  assert.match(manager, /Tracked only/);
  assert.match(manager, /Empty — tracked/);
  assert.match(manager, /Unavailable — tracked/);
  assert.doesNotMatch(manager, />Banks<\/span>/);
  assert.match(manager, /craft-plan-player-source-card/);
  assert.match(styles, /\.craft-plan-player-source-toggles\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(100px,\s*1fr\)\)/s);
  assert.match(styles, /\.craft-plan-player-source-card\s+header\s*\{[^}]*display:\s*grid/s);
  assert.match(styles, /\.craft-plan-player-source-toggles\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /@media[^}]*max-width:\s*640px[^}]*\{[\s\S]*?\.craft-plan-player-source-toggles\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(manager, /groupDeployablesByPlayer/);
  assert.match(manager, /craft-plan-deployable-group/);
  assert.match(manager, /function itemTypeLabel/);
  assert.match(manager, /meta=\{itemTypeLabel\(item\)\}/);
  assert.match(manager, /Material buffer \(% extra\)/);
  assert.match(manager, /Production route for \{review\.outputKey\}/);
  assert.match(manager, /Confirm review/);
  assert.match(manager, /Loading plan data/);
  assert.match(manager, /Saving plan/);
  assert.match(manager, /Refreshing plan data/);
  assert.match(manager, /aria-live="polite"/);
  assert.match(manager, /LoaderCircle/);
  assert.match(manager, /mergeTargets/);
  assert.match(manager, /buildingProgress/);
  assert.match(manager, /delete nextProgress\[itemKey\(target\)\]/);
  assert.match(server, /reconcileCraftPlanBuildingProgress/);
  assert.match(server, /currentClaimBuildingsProjection\(claimId\)/);
  assert.doesNotMatch(server, /fetchBitjita\(`\/claims\/\$\{encodeURIComponent\(claimId\)\}\/buildings/);
  assert.match(server, /\/api\/local\/admin\/craft-plan\/workstation-preset/);
  assert.match(server, /\/api\/local\/admin\/craft-plan\/player-banks/);
  assert.match(server, /providerCatalogRepository\.listDescriptions\("building"\)/);
  assert.match(server, /providerCatalogRepository\.listDescriptions\("construction_recipe"\)/);
  assert.match(server, /normalizeCatalogWorkstationTarget/);
  assert.doesNotMatch(server, /fetchBitjita\(`\/buildings\/\$\{encodeURIComponent\(workstation\.id\)\}`/);
});

test("Craft Planning reads current members and inventories from Relay-owned services", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const adminStart = server.indexOf("async function craftPlanAdminResponse");
  const adminEnd = server.indexOf("function craftPlanAuditLabels", adminStart);
  const adminResponse = adminStart >= 0 && adminEnd > adminStart ? server.slice(adminStart, adminEnd) : "";
  const liveStart = server.indexOf("async function computedCraftPlanResponseFresh");
  const liveEnd = server.indexOf("async function craftPlanDiscordReport", liveStart);
  const liveResponse = liveStart >= 0 && liveEnd > liveStart ? server.slice(liveStart, liveEnd) : "";

  assert.match(server, /function currentMembersProjection/);
  assert.match(server, /function currentInventoryProjection/);
  assert.match(server, /const storage = currentLiveStorageOverlay\(claimId\);[\s\S]*mergeClaimInventoryWithLiveStorages\(\s*current\.data,\s*storage\.data/);
  assert.match(server, /readSubscriptionHealth\(snapshot\.provenance\.sourceKey, "inventory-storages"\)/);
  assert.match(adminResponse, /currentMembersProjection\(claimId\)/);
  assert.match(adminResponse, /currentInventoryProjection\(claimId\)/);
  assert.match(adminResponse, /relayPlayerDataService\.inventory/);
  assert.match(liveResponse, /currentMembersProjection\(claimId\)/);
  assert.match(liveResponse, /currentInventoryProjection\(claimId\)/);
  assert.match(liveResponse, /relayPlayerDataService\.inventory/);
  assert.doesNotMatch(adminResponse, /fetchBitjita\(`\/claims\/\$\{encodeURIComponent\(claimId\)\}\/(?:members|inventories)/);
  assert.doesNotMatch(adminResponse, /fetchBitjita\(`\/players\/\$\{encodeURIComponent\(playerId\)\}\/inventories/);
  assert.doesNotMatch(liveResponse, /fetchBitjita\(`\/claims\/\$\{encodeURIComponent\(claimId\)\}\/(?:members|inventories)/);
  assert.doesNotMatch(liveResponse, /fetchBitjita\(`\/players\/\$\{encodeURIComponent\(playerId\)\}\/inventories/);
});

test("Craft Planning manager exposes permission-gated causal audit tooling", () => {
  const manager = readFileSync(new URL("../src/pages/CraftPlanManagerDialog.tsx", import.meta.url), "utf8");

  assert.match(manager, /permissions\.includes\("audit\.view"\)/);
  assert.match(manager, /craftPlanManagerWorkspaces\(\{ canViewAudit, canEdit \}\)/);
  assert.match(manager, /<History size=\{15\} \/>/);
  assert.match(manager, /\/admin\/craft-plan\/progress-audit/);
  assert.match(manager, /<h5>Observed<\/h5>/);
  assert.match(manager, /<h5>Derived<\/h5>/);
  assert.match(manager, /Unresolved details/);
  assert.match(manager, /Dependency paths/);
  assert.match(manager, /Compare checkpoints/);
  assert.match(manager, /\/admin\/craft-plan\/progress-audit\/compare/);
  assert.match(manager, /permissions\.includes\("data\.export"\)/);
  assert.match(manager, /progress-audit\/export\?range=/);
  assert.match(manager, /URL\.createObjectURL/);
  assert.match(manager, /URL\.revokeObjectURL/);
  assert.match(manager, />Previous<\/button>/);
  assert.match(manager, />Next<\/button>/);
  assert.match(manager, /No causal groups match/);
  assert.match(manager, /Retry audit/);
});

test("Craft Planning manager renders presets as compact tier-only controls", () => {
  const manager = readFileSync(new URL("../src/pages/CraftPlanManagerDialog.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles/craft-planning.css", import.meta.url), "utf8");

  assert.match(manager, /className="craft-plan-preset-tier"/);
  assert.match(manager, /aria-label={`Add upgrade materials for \${preset\.label}`}/);
  assert.match(manager, /aria-label={`Add workstation targets for \${preset\.label}`}/);
  assert.doesNotMatch(manager, /\{presetSummary\(preset\)\}/);
  assert.doesNotMatch(manager, /\{formatNumber\(preset\.workstations\?\.length \?\? 0, 0\)\} workstations/);
  assert.match(styles, /\.craft-plan-preset-grid\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /\.craft-plan-preset-tier\s*\{[^}]*min-height:\s*38px;/s);
});


test("Craft Planning manager does not expose the retired scheduled catalog refresh", () => {
  const manager = readFileSync(new URL("../src/pages/CraftPlanManagerDialog.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles/craft-planning.css", import.meta.url), "utf8");

  assert.doesNotMatch(manager, /\/admin\/craft-plan\/catalog-refresh/);
  assert.doesNotMatch(manager, /Refresh planner catalog/);
  assert.doesNotMatch(manager, /CATALOG_REFRESH_POLL_MS|catalogPollingActive|catalogContinuing/);
  assert.doesNotMatch(styles, /\.craft-plan-catalog-band|\.craft-plan-catalog-stats|\.craft-plan-catalog-stat/);
  assert.match(styles, /\.craft-plan-manager-backdrop \{ position: fixed; inset: 0;/);
});

test("Craft Calculator and Craft Plan target search use the provider-neutral local catalog", () => {
  const calculator = readFileSync(new URL("../src/pages/CraftCalculatorPage.tsx", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../src/pages/CraftPlanManagerDialog.tsx", import.meta.url), "utf8");

  for (const source of [calculator, manager]) {
    assert.match(source, /\/catalog\/search\?q=/);
    assert.doesNotMatch(source, /\/api\/bitjita|BITJITA_API|market\?q=|market\?search=/);
  }
  assert.doesNotMatch(calculator, /findOutputAliasDetail|augmentDetailWithOutputAlias/);
  assert.doesNotMatch(calculator, /BitJita/);
  assert.doesNotMatch(manager, /Search BitJita items/);
});
test("Dashboard shows Gather Next instead of Recent Activity", () => {
  const dashboard = readFileSync(new URL("../src/pages/DashboardPage.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /\/api\/local\/craft-plan|LOCAL_API\}\/craft-plan/);
  assert.match(dashboard, /Gather Next/);
  assert.match(dashboard, /onNavigate\("planning"\)/);
  assert.doesNotMatch(dashboard, /DashboardCardHeader title="Recent Activity"/);
});

test("Craft Planning reads the continuously projected Relay catalog without a scheduled ingestion job", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

  assert.match(server, /createGameCatalogRepository/);
  assert.doesNotMatch(server, /runRecipeCatalogRefreshJob|recipe_catalog_refresh|game_catalog_refresh_runs|game_catalog_refresh_targets/);
  assert.doesNotMatch(server, /\/api\/local\/admin\/craft-plan\/catalog-refresh/);
  assert.doesNotMatch(server, /fetchGameDataProbabilitySnapshot|GAME_CATALOG_REFRESH_/);

  const computedCraftPlan = server.match(/async function computedCraftPlanResponse[\s\S]*?async function craftPlanDiscordReport/)?.[0] ?? "";
  assert.match(computedCraftPlan, /const catalogTargets = craftPlanCatalogTargets\(config\)/);
  assert.match(computedCraftPlan, /collectLocalCatalogCraftPlanDetails\([\s\S]*?gameCatalogRepository,[\s\S]*?catalogTargets,[\s\S]*?config\.routeOverrides,[\s\S]*?64,[\s\S]*?\[\],[\s\S]*?requireValidatedProbabilities: true/);
  assert.match(computedCraftPlan, /enrichCraftPlanSourcesFromLocalCatalog\(gameCatalogRepository, sources\.inventory, catalogWarnings\)/);
  assert.match(computedCraftPlan, /currentInventoryProjection\(claimId\)/);
  assert.match(computedCraftPlan, /currentMembersProjection\(claimId\)/);
  assert.match(computedCraftPlan, /memberNames/);
  assert.match(computedCraftPlan, /currentCraftPlanProjection\(claimId\)/);
  assert.match(computedCraftPlan, /craftPlanCurrentSourceRevision\(normalizedClaimId\)/);
  assert.match(computedCraftPlan, /\["members", "inventories", "inventory-storages", "crafts", "construction", "catalogs"\]/);
  assert.match(computedCraftPlan, /cached\.sourceRevision === sourceRevision/);
  assert.match(computedCraftPlan, /existing\?\.sourceRevision === sourceRevision/);
  assert.match(computedCraftPlan, /domains:\s*\["inventories",\s*"crafts"\]/);
  assert.match(computedCraftPlan, /config\.sourceRules\.craftPlayerIds/);
  assert.match(computedCraftPlan, /selectedPlayerInventoryIds\(config\.sourceRules\)/);
  assert.match(computedCraftPlan, /config\.sourceRules\.bankPlayerIds/);
  assert.match(computedCraftPlan, /filterSelectedPlayerBankSources\(config\.sourceRules, sources\.banks\)/);
  assert.match(computedCraftPlan, /sources\.banks/);
  assert.match(computedCraftPlan, /bankSources/);
  assert.match(computedCraftPlan, /trackedRelayCraftPlanOutputs\(\s*craftsPayload,\s*detailsByKey,\s*claimId,\s*config\.sourceRules\.craftPlayerIds/);
  assert.doesNotMatch(computedCraftPlan, /fetchBitjita\([^)]*(?:\/crafts|passive-crafts)/);
  assert.doesNotMatch(computedCraftPlan, /\/players\/\$\{encodeURIComponent\(playerId\)\}\/crafts\?completed=all/);
  assert.doesNotMatch(computedCraftPlan, /passive-crafts\?status=all/);
  assert.match(computedCraftPlan, /craftPlanEffortBaselineKey/);
  assert.match(computedCraftPlan, /craftPlanEffortBaselineCache\.getOrCreate/);
  assert.match(computedCraftPlan, /const computedBaseline = await computeCraftPlanOffThread/);
  assert.match(computedCraftPlan, /compactCraftPlanEffortInput\(computedBaseline/);
  assert.match(computedCraftPlan, /routeInventory: buildCraftPlanRouteInventory\(computedBaseline\)/);
  assert.match(computedCraftPlan, /const livePlan = await computeCraftPlanOffThread/);
  assert.match(computedCraftPlan, /calculateCraftPlanEffortProgress/);
  assert.match(computedCraftPlan, /effortProgress/);
  const playerInventoryLoop = computedCraftPlan.match(/for \(const playerId of selectedPlayerInventoryIds\(config\.sourceRules\)\)[\s\S]*?const livePlan/)?.[0] ?? "";
  assert.equal((playerInventoryLoop.match(/relayPlayerDataService\.inventory/g) ?? []).length, 1);
  assert.match(playerInventoryLoop, /inventoryPlayerIds\.has\(playerId\)/);
  assert.match(playerInventoryLoop, /filterSelectedPlayerBankSources/);
  assert.doesNotMatch(computedCraftPlan, /recipeDetailFromCatalogOrFetch|addCraftPlanItemOutputDetails|addCraftPlanCargoDerivationDetails|collectRecipeDetails|enrichCraftPlanSourceItems|fetchCraftPlanItemDetail/);
});

test("Craft Planning serves a compact live board and lazy item drilldowns", async () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");
  const gameDataLoader = readFileSync(new URL("../src/api/gameDataLoader.ts", import.meta.url), "utf8");
  const { pageDomains, pageGenerationDomains } = await import(new URL("../src/api/pageDomains.ts", import.meta.url).href);

  assert.match(server, /computedCompactCraftPlanResponse/);
  assert.match(server, /createCraftPlanResponseWorkspace/);
  assert.match(server, /\/api\/local\/craft-plan\/detail/);
  assert.match(server, /craftPlanDetailResponse\(await computedCraftPlanResponse/);
  assert.match(server, /craftPlanResponseCache/);
  assert.match(server, /craftPlanResponseInflight/);
  assert.match(page, /\/craft-plans\/\$\{encodeURIComponent\(selectedPlanId\)\}\/detail\?claimId=/);
  assert.match(page, /detailLoading/);
  assert.match(page, /groupNeedCellSourceRoutes\(selectedNeed, detailSteps\)/);
  assert.match(page, /item\.hasSourceRoutes/);
  assert.match(page, /selectCraftPlanningEffortView/);
  assert.match(page, /Confirmed progress/);
  assert.match(page, /Projected after active crafts/);
  assert.match(page, /Confirmed stock and guaranteed active crafts/);
  assert.match(page, /Effort progress unavailable/);
  assert.doesNotMatch(page, /needsBoardCompletion/);
  assert.deepEqual(pageDomains("planning"), []);
  assert.deepEqual(pageGenerationDomains("planning"), [
    "members",
    "inventories",
    "crafts",
    "construction",
    "catalogs",
  ]);
  assert.match(gameDataLoader, /const domains = pageDomains\(activePanel\)/);
  assert.doesNotMatch(gameDataLoader, /legacyPageEndpoint|\/api\/bitjita/);
});

test("Craft Planning explains unavailable producer yields and labels logistics routes", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");
  const presentation = readFileSync(new URL("../src/pages/craftPlanningRoutePresentation.mjs", import.meta.url), "utf8");

  assert.match(page, /probabilityStatus\s*===\s*["']unavailable["']/);
  assert.match(page, /Validated output rate unavailable/);
  assert.match(page, /route is known, but required completions and inputs cannot be calculated/i);
  assert.match(presentation, /isTransportRoute[\s\S]*?Logistics/);
});

test("Craft Planning item details deep-link to staged Recipe Review editing", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");

  assert.match(page, /craftPlanRecipeReviewHref\(\{ planId: selectedPlanId, outputKey \}\)/);
  assert.match(page, /Open in Recipe Review/);
  assert.match(page, /Route selection is read-only here\. Authorized editors can compare and stage changes in Recipe Review\./);
  assert.match(page, /Buffer changes are staged in Recipe Review and persist only through Save Plan\./);
  assert.doesNotMatch(page, /ItemDetailFeedback/);
  assert.doesNotMatch(page, /saveRouteOverride/);
  assert.doesNotMatch(page, /saveMultiplier/);
});

test("Craft Planning keeps a failed plan visible while an automatic retry is running", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");
  const loadEffect = page.match(/React\.useEffect\(\(\) => \{\s*let stale = false;[\s\S]*?\}, \[claimId, managerRefreshToken, refreshToken, request\?\.sequence, selectedPlanId, trackPromise\]\);/)?.[0] ?? "";

  assert.notEqual(loadEffect, "");
  assert.doesNotMatch(loadEffect, /setLoading\(true\);\s*setError\(null\);/);
  assert.match(loadEffect, /if \(stale\) return;\s*setPlan\(body\);\s*setError\(null\);/);
});
