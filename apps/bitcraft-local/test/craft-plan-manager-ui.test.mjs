import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import React from "react";
import { createServer as createViteServer } from "vite";

function findElements(node, predicate, matches = []) {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, matches);
    return matches;
  }
  if (!React.isValidElement(node)) return matches;
  if (predicate(node)) matches.push(node);
  findElements(node.props.children, predicate, matches);
  return matches;
}

function elementText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  return React.isValidElement(node) ? elementText(node.props.children) : "";
}

function dependenciesChanged(previous, next) {
  if (!previous || !next || previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}

function installHookHarness() {
  const originals = Object.fromEntries(["useCallback", "useEffect", "useMemo", "useRef", "useState"].map((key) => [key, React[key]]));
  const hooks = [];
  let cursor = 0;
  let effects = [];
  React.useCallback = (callback, dependencies) => {
    const index = cursor++;
    if (!hooks[index] || dependenciesChanged(hooks[index].dependencies, dependencies)) hooks[index] = { value: callback, dependencies };
    return hooks[index].value;
  };
  React.useMemo = (calculate, dependencies) => {
    const index = cursor++;
    if (!hooks[index] || dependenciesChanged(hooks[index].dependencies, dependencies)) hooks[index] = { value: calculate(), dependencies };
    return hooks[index].value;
  };
  React.useRef = (initial) => {
    const index = cursor++;
    if (!hooks[index]) hooks[index] = { value: { current: initial } };
    return hooks[index].value;
  };
  React.useState = (initial) => {
    const index = cursor++;
    if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
    return [hooks[index].value, (update) => { hooks[index].value = typeof update === "function" ? update(hooks[index].value) : update; }];
  };
  React.useEffect = (effect, dependencies) => {
    const index = cursor++;
    if (!hooks[index] || dependenciesChanged(hooks[index].dependencies, dependencies)) {
      hooks[index] = { dependencies };
      effects.push(effect);
    }
  };
  return {
    async render(Component, props) {
      cursor = 0;
      effects = [];
      const tree = Component(props);
      for (const effect of effects) effect();
      await new Promise((resolve) => setImmediate(resolve));
      return tree;
    },
    restore() { Object.assign(React, originals); },
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body, blob: async () => new Blob() };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function auditResult(groupId) {
  return {
    status: { retentionDays: 30 },
    events: [],
    pagination: { page: 1, totalPages: 1, total: 1, hasPrevious: false, hasNext: false },
    causalGroups: [{
      groupId,
      span: { from: "2026-08-28T10:00:00.000Z", to: "2026-08-28T11:00:00.000Z" },
      observedTriggers: [{ category: "stock_movement", type: "stock_delta", materialKey: "items:7" }],
      derivedEffects: [{ category: "demand_change", type: "requirement_delta", materialKey: "items:7", before: 1, after: 3, delta: 2 }],
      dependencyPaths: [{ materialKey: "items:7", paths: [["items:9", "items:7"]] }],
      unresolvedRelationships: [
        { triggerType: "stock_delta", effectType: "requirement_delta", materialKey: "items:7", relationship: "prior_success_checkpoint", reason: "Evidence timing is incomplete" },
        { triggerType: "craft_removed", effectType: "progress_delta", materialKey: "items:7" },
      ],
    }],
  };
}

function configHistory(planId = "plan-a") {
  return [{
    id: 91,
    planId,
    actor: { type: "admin", id: "5", displayName: "Operator Alice" },
    occurredAt: "2026-08-29T12:00:00.000Z",
    previousRevision: 4,
    newRevision: 5,
    action: "update",
    changes: { patch: [
      { path: "/config/targets", before: [{ id: "7", quantity: 1 }], after: [{ id: "7", quantity: 3 }] },
      { path: "/config/routeOverrides/items:7", before: "risky", after: "safe" },
      { path: "/config/multipliers/items:7", before: null, after: { multiplier: 1.25 } },
      { path: "/config/sourceRules/storageContainerIds", before: [], after: ["storage-a"] },
      { path: "/config/enabled", before: false, after: true },
    ] },
  }];
}

function loadedPlan({ personal = false, config = {} } = {}) {
  return {
    planRecord: { id: "plan-a", revision: 4, scope: personal ? "personal" : "shared" },
    config: { enabled: true, name: "Saved plan", targets: [], sourceRules: {}, ...config },
    plan: { materials: [], steps: [] },
    sources: {
      storage: [{ sourceId: "storage-a", label: "Town Store", items: [] }],
      players: [{ playerId: "owner", label: "Owner" }, { playerId: "other", label: "Other" }],
      deployables: [{ sourceId: "owner:wagon", playerId: "owner", label: "Owner wagon", items: [] }],
      tierPresets: [], workstationPresets: [],
    },
  };
}

const preview = {
  scope: "shared",
  configurationRevision: 4,
  fingerprint: "preview",
  validation: { valid: true, errors: [] },
  materials: [{ key: "items:7", kind: "items", id: "7", missingNow: 4, planRequired: 12, requiredNow: 8 }],
  routeReviews: [
    { outputKey: "items:9", outputName: "Wooden Peg", ambiguous: false, confirmed: true, selectedRouteId: "only", preselectedRouteId: "only", fingerprint: "one", alternatives: [{ id: "only", label: "Only route", probabilityStatus: "guaranteed", inputs: [] }] },
    { outputKey: "items:7", outputName: "Iron Ingot", ambiguous: true, confirmed: false, selectedRouteId: "risky", preselectedRouteId: "safe", fingerprint: "ambiguous", alternatives: [
      { id: "risky", label: "Risky forge", probabilityStatus: "expected", isProbabilistic: true, inputs: [{ key: "items:2", name: "Iron Ore", quantity: 3 }] },
      { id: "safe", label: "Safe forge", probabilityStatus: "guaranteed", isProbabilistic: false, expectedYield: 5, expectedPerCraft: 5, expectedPerProgress: 0.5, expectedPerResource: 50, resourceHealth: 100, dropChance: 0.25, dropQuantity: 2, actionsRequired: 4, gatheringMode: "ordinary", gatheringSource: { label: "Forest node" }, producer: { name: "Timber bundle" }, producerRecipe: { name: "Forest extraction", buildingName: "Lumber station", skillName: "Forestry" }, inputs: [{ key: "cargo:2", quantity: 2 }] },
    ] },
  ],
};

test("manager renders four authorized workspaces, one Save action, and an explicitly confirmed source suggestion", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => { requests.push({ url: String(url), options }); return jsonResponse(loadedPlan()); };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["audit.view", "data.export"] };
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    const nav = findElements(tree, (element) => element.type === "nav" && element.props["aria-label"] === "Craft plan workspaces")[0];
    assert.deepEqual(findElements(nav, (element) => element.type === "button").map((button) => elementText(button).trim()), ["Goals", "Counted Sources", "Recipe Review", "Audit"]);
    assert.equal(findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan").length, 1);

    findElements(nav, (element) => element.type === "button" && elementText(element).trim() === "Counted Sources")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Settlement storage suggestion/);
    assert.match(elementText(tree), /Town Store/);
    assert.deepEqual(
      findElements(tree, (element) => element.type === "input" && String(element.props["aria-label"] ?? "").startsWith("Search "))
        .map((input) => input.props["aria-label"]),
      ["Search counted sources"],
      "the shared source search must cover banks without a second disconnected search",
    );
    assert.equal(requests.filter(({ options }) => options.method === "PUT").length, 0);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Review suggestion")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Apply suggested counted sources\?/);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Apply suggestion")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    const storageToggle = findElements(tree, (element) => element.type === "input" && element.props.type === "checkbox" && element.props.checked === true)[0];
    assert.ok(storageToggle, "suggestion confirmation should change only the staged source draft");
    assert.equal(requests.filter(({ options }) => options.method === "PUT").length, 0);
    assert.match(elementText(tree), /Crafts, banks, and deployables stay opt-in/);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("recipe review is ambiguous-first, keyboard-selectable, staged, previewed, and saved once", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/preview")) return jsonResponse(preview);
    if (options.method === "PUT") return jsonResponse({ planRecord: { id: "plan-a", revision: 5 } });
    return jsonResponse(loadedPlan());
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: [] };
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Recipe Review")[0].props.onClick();
    await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.ok(requests.some(({ url, options }) => url.endsWith("/preview") && options.method === "POST"));
    const reviews = findElements(tree, (element) => element.type === "article" && String(element.props.className).includes("craft-plan-review-entry"));
    assert.match(elementText(reviews[0]), /items:7/);
    const routeInputs = findElements(reviews[0], (element) => element.type === "input" && element.props.type === "radio");
    assert.equal(routeInputs.length, 2);
    assert.equal(routeInputs[1].props.checked, true, "server safest preselection should be selected");
    assert.match(String(routeInputs[0].props["aria-label"]), /Risky forge/);
    assert.match(elementText(reviews[0]), /Expected yield 5/);
    assert.match(elementText(reviews[0]), /Per progress 0.5/);
    assert.match(elementText(reviews[0]), /Per resource 50/);
    assert.match(elementText(reviews[0]), /Drop 25%.*quantity 2/s);
    assert.match(elementText(reviews[0]), /Actions 4.*Resource health 100/s);
    assert.match(elementText(reviews[0]), /Forest node.*Timber bundle.*Forest extraction.*Lumber station.*Forestry/s);
    routeInputs[0].props.onChange();
    tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    const buffer = findElements(tree, (element) => element.type === "input" && element.props["aria-label"] === "Material buffer for items:7")[0];
    buffer.props.onChange({ target: { value: "25" } });
    tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Confirm review")[0].props.onClick();
    assert.equal(requests.filter(({ options }) => options.method === "PUT").length, 0);
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Needed now 4/);
    assert.match(elementText(tree), /Plan total 12/);

    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const put = requests.filter(({ options }) => options.method === "PUT")[0];
    const body = JSON.parse(put.options.body);
    assert.equal(body.config.routeOverrides["items:7"], "risky");
    assert.equal(body.config.multipliers["items:7"].multiplier, 1.25);
    assert.deepEqual(body.routeReviewConfirmations, [{ outputKey: "items:7", fingerprint: "ambiguous", selectedRouteId: "risky" }]);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("recipe review exposes the complete plan route inventory with search, status filters, and a non-route deep-link notice", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const focusedRouteIds = [];
  const routePreview = {
    ...preview,
    routeEvidence: "last_good",
    routeReviews: [
      ...preview.routeReviews,
      { outputKey: "cargo:7", outputName: "Iron Ore Cargo", ambiguous: true, confirmed: true, selectedRouteId: "crusher", preselectedRouteId: "crusher", fingerprint: "cargo", alternatives: [{ id: "crusher", label: "Crush cargo", buildingName: "Crusher", probabilityStatus: "unavailable", inputs: [] }] },
    ],
  };
  globalThis.fetch = async (url) => String(url).endsWith("/preview") ? jsonResponse(routePreview) : jsonResponse(loadedPlan({ config: { targets: [{ id: "1020003", kind: "items", name: "Codex", quantity: 1 }] } }));
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: [], initialWorkspace: "recipes", initialOutputKey: "items:1020003" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);

    assert.match(elementText(tree), /No selectable production route is available for items:1020003/);
    assert.match(elementText(tree), /Iron Ingot/);
    assert.match(elementText(tree), /Iron Ore \(items:2\)/);
    assert.match(elementText(tree), /Iron Ore Cargo/);
    assert.match(elementText(tree), /Probability data unavailable/);
    assert.match(elementText(tree), /Wooden Peg/);
    assert.match(elementText(tree), /Showing selectable routes from the last complete plan calculation/);
    assert.equal(findElements(tree, (element) => element.type === "article" && String(element.props.className).includes("craft-plan-review-entry")).length, 3);

    const search = findElements(tree, (element) => element.type === "input" && element.props["aria-label"] === "Search recipe routes")[0];
    assert.ok(search);
    search.props.onChange({ target: { value: "wooden peg" } });
    tree = await harness.render(CraftPlanManagerDialog, props);
    const searched = findElements(tree, (element) => element.type === "article" && String(element.props.className).includes("craft-plan-review-entry"));
    assert.equal(searched.length, 1);
    assert.match(elementText(searched[0]), /Wooden Peg/);

    search.props.onChange({ target: { value: "" } });
    tree = await harness.render(CraftPlanManagerDialog, props);
    const filters = findElements(tree, (element) => element.type === "div" && element.props["aria-label"] === "Filter recipe routes")[0];
    const needsReview = findElements(filters, (element) => element.type === "button" && /^Needs review/.test(elementText(element).trim()))[0];
    assert.ok(needsReview);
    needsReview.props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    const needsReviewEntries = findElements(tree, (element) => element.type === "article" && String(element.props.className).includes("craft-plan-review-entry"));
    assert.equal(needsReviewEntries.length, 1);
    assert.match(elementText(needsReviewEntries[0]), /Iron Ingot/);

    const cargoProps = { ...props, initialOutputKey: "cargo:7" };
    globalThis.document = { getElementById: (id) => ({ focus: () => focusedRouteIds.push(id) }) };
    await harness.render(CraftPlanManagerDialog, cargoProps);
    focusedRouteIds.length = 0;
    tree = await harness.render(CraftPlanManagerDialog, cargoProps);
    assert.equal(findElements(tree, (element) => element.type === "article" && String(element.props.className).includes("craft-plan-review-entry")).length, 3, "a deep link must clear filters that hide its target");
    assert.deepEqual(focusedRouteIds, ["craft-plan-review-cargo%3A7"], "focus must rerun after the deep-link filter reset reveals the target");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) Reflect.deleteProperty(globalThis, "document");
    else globalThis.document = originalDocument;
    harness.restore();
    await vite.close();
  }
});

test("recipe review explains when a configured plan has no selectable production routes", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const plan = loadedPlan({ config: { targets: [{ id: "7", kind: "items", name: "Raw Material", quantity: 1 }] } });
  globalThis.fetch = async (url) => String(url).endsWith("/preview")
    ? jsonResponse({ ...preview, routeReviews: [], materials: [], validation: { valid: true, errors: [] } })
    : jsonResponse(plan);
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: [], initialWorkspace: "recipes", initialOutputKey: "items:7" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    const tree = await harness.render(CraftPlanManagerDialog, props);

    assert.match(elementText(tree), /No selectable recipe routes in this plan/);
    assert.match(elementText(tree), /No selectable production route is available for items:7/);
    assert.match(elementText(tree), /Raw, vendor-only, and outputs without a selectable production recipe do not require a route choice/);
    assert.doesNotMatch(elementText(tree), /Add goals, then refresh the preview/);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("recipe review exposes calculation validation failures instead of a blank route list", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const plan = loadedPlan({ config: { targets: [{ id: "7", kind: "items", name: "Broken Route", quantity: 1 }] } });
  globalThis.fetch = async (url) => String(url).endsWith("/preview")
    ? jsonResponse({
        ...preview,
        routeReviews: [],
        materials: [],
        validation: { valid: false, errors: [{ code: "invalid_selected_route", message: "The selected route is no longer valid." }] },
      })
    : jsonResponse(plan);
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: [], initialWorkspace: "recipes" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    const tree = await harness.render(CraftPlanManagerDialog, props);

    assert.match(elementText(tree), /Recipe preview validation failed/);
    assert.match(elementText(tree), /The selected route is no longer valid/);
    assert.doesNotMatch(elementText(tree), /No recipe routes to review/);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("a failed automatic preview stays failed until an explicit retry", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  let previewRequests = 0;
  const failedPreview = deferred();
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/preview")) {
      previewRequests += 1;
      if (previewRequests === 1) return failedPreview.promise;
      return jsonResponse({ error: "Preview unavailable" }, { ok: false, status: 503 });
    }
    return jsonResponse(loadedPlan());
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["settings.manage"], initialWorkspace: "recipes" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    failedPreview.resolve(jsonResponse({ error: "Preview unavailable" }, { ok: false, status: 503 }));
    await new Promise((resolve) => setImmediate(resolve));
    let tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.equal(previewRequests, 1, "the failed draft signature must not auto-loop");
    assert.match(elementText(tree), /Recipe preview could not be loaded: Preview unavailable/);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Refresh preview")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(previewRequests, 2, "explicit Refresh may retry the same failed draft");
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("publication gate keeps exactly one Save action", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => options.method === "PUT"
    ? jsonResponse({ error: "Confirm routes", code: "craft_plan_route_review_required", unconfirmedRoutes: [{ outputKey: "items:7", fingerprint: "ambiguous", preselectedRouteId: "safe" }] }, { ok: false, status: 409 })
    : String(url).endsWith("/preview") ? jsonResponse(preview) : jsonResponse(loadedPlan());
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["settings.manage"] };
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    const saveActions = findElements(tree, (element) => element.type === "button" && /Save Plan/.test(elementText(element)));
    assert.equal(saveActions.length, 1);
    assert.equal(elementText(saveActions[0]).trim(), "Confirm routes and Save Plan");
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("T7 preset can confirm newly ambiguous routes and save on the retry", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const putBodies = [];
  const previewBodies = [];
  const plan = loadedPlan();
  plan.sources.tierPresets = [{ key: "tier-7", label: "T7", tier: 7, items: [{ id: "2080555135", kind: "items", itemType: 0, name: "Comprehensive Codex", quantity: "30" }] }];
  const codexReview = {
    outputKey: "items:2080555135",
    ambiguous: true,
    confirmed: false,
    selectedRouteId: "codex-risky",
    preselectedRouteId: "codex-safe",
    fingerprint: "codex-fingerprint",
    alternatives: [
      { id: "codex-risky", label: "Expected Codex route", probabilityStatus: "expected", isProbabilistic: true, inputs: [] },
      { id: "codex-safe", label: "Guaranteed Codex route", probabilityStatus: "guaranteed", isProbabilistic: false, inputs: [] },
    ],
  };
  const nestedReview = {
    outputKey: "items:300",
    ambiguous: true,
    confirmed: false,
    selectedRouteId: "plant-upgrade",
    preselectedRouteId: "plant-seed",
    fingerprint: "plant-fingerprint",
    alternatives: [
      { id: "plant-upgrade", label: "Upgrade plants", probabilityStatus: "guaranteed", isProbabilistic: false, inputs: [] },
      { id: "plant-seed", label: "Grow from seed", probabilityStatus: "guaranteed", isProbabilistic: false, inputs: [] },
    ],
  };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/preview")) {
      const body = JSON.parse(options.body);
      previewBodies.push(body);
      const codexRouteStaged = body.config?.routeOverrides?.[codexReview.outputKey] === codexReview.preselectedRouteId;
      return jsonResponse({ ...preview, routeReviews: codexRouteStaged ? [codexReview, nestedReview] : [codexReview] });
    }
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      putBodies.push(body);
      if (putBodies.length === 1) {
        return jsonResponse({ error: "Confirm routes", code: "craft_plan_route_review_required", unconfirmedRoutes: [{ outputKey: codexReview.outputKey, fingerprint: codexReview.fingerprint, preselectedRouteId: codexReview.preselectedRouteId }] }, { ok: false, status: 409 });
      }
      return jsonResponse({ planRecord: { id: "plan-a", revision: 5 } });
    }
    return jsonResponse(plan);
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["settings.manage"] };
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && element.props["aria-label"] === "Add upgrade materials for T7")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Confirm routes and Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(putBodies.length, 2);
    assert.deepEqual(putBodies[1].config.targets.map(({ id, kind, quantity }) => ({ id, kind, quantity })), [{ id: "2080555135", kind: "items", quantity: 30 }]);
    assert.equal(putBodies[1].config.routeOverrides[codexReview.outputKey], "codex-safe");
    assert.equal(putBodies[1].config.routeOverrides[nestedReview.outputKey], "plant-seed");
    assert.equal(previewBodies.some((body) => body.config?.routeOverrides?.[codexReview.outputKey] === "codex-safe" && body.config?.routeOverrides?.[nestedReview.outputKey] == null), true);
    assert.equal(previewBodies.some((body) => body.config?.routeOverrides?.[codexReview.outputKey] === "codex-safe" && body.config?.routeOverrides?.[nestedReview.outputKey] === "plant-seed"), true);
    assert.deepEqual(putBodies[1].routeReviewConfirmations, [
      { outputKey: codexReview.outputKey, fingerprint: codexReview.fingerprint, selectedRouteId: "codex-safe" },
      { outputKey: nestedReview.outputKey, fingerprint: nestedReview.fingerprint, selectedRouteId: "plant-seed" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("public ambiguity and revision conflicts preserve the draft and expose explicit recovery", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const putBodies = [];
  const plan = loadedPlan({ config: { targets: [{ id: "1", kind: "items", name: "Stone", quantity: 1 }] } });
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/preview")) return jsonResponse(preview);
    if (options.method === "PUT") {
      putBodies.push(JSON.parse(options.body));
      if (putBodies.length === 1) return jsonResponse({ error: "Changed elsewhere", code: "craft_plan_revision_conflict", conflict: { currentRevision: 5, plan: { id: "plan-a", name: "Saved plan", scope: "shared", updatedAt: "2026-08-29T12:00:00.000Z" }, config: { enabled: true, name: "Saved plan", targets: [{ id: "1", kind: "items", name: "Stone", quantity: 9 }], sourceRules: { storageContainerIds: ["storage-a"] } } } }, { ok: false, status: 409 });
      return jsonResponse({ planRecord: { id: "plan-a", revision: 6 } });
    }
    return jsonResponse(plan);
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: [] };
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Recipe Review")[0].props.onClick();
    await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    const review = findElements(tree, (element) => element.type === "article" && String(element.props.className).includes("craft-plan-review-entry"))[0];
    findElements(review, (element) => element.type === "input" && element.props.type === "radio")[0].props.onChange();
    findElements(review, (element) => element.type === "input" && element.props["aria-label"] === "Material buffer for items:7")[0].props.onChange({ target: { value: "25" } });
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Plan changed elsewhere/);
    assert.match(elementText(tree), /Reload latest/);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Reload latest")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /server changes.*draft changes were preserved/i);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(putBodies[1].expectedRevision, 5);
    assert.equal(putBodies[1].config.name, "Saved plan");
    assert.equal(putBodies[1].config.targets[0].quantity, 9);
    assert.deepEqual(putBodies[1].config.sourceRules.storageContainerIds, ["storage-a"]);
    assert.equal(putBodies[1].config.routeOverrides["items:7"], "risky");
    assert.equal(putBodies[1].config.multipliers["items:7"].multiplier, 1.25);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("overlapping conflict paths remain explicit and block saving", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const putBodies = [];
  const plan = loadedPlan({ config: { routeOverrides: { "items:7": "safe" } } });
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/preview")) return jsonResponse(preview);
    if (options.method === "PUT") {
      putBodies.push(JSON.parse(options.body));
      return jsonResponse({ error: "Changed elsewhere", code: "craft_plan_revision_conflict", conflict: { currentRevision: 5, plan: { id: "plan-a", name: "Saved plan", scope: "shared" }, config: { ...plan.config, routeOverrides: { "items:7": "server-route" } } } }, { ok: false, status: 409 });
    }
    return jsonResponse(plan);
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: [], initialWorkspace: "recipes" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    const review = findElements(tree, (element) => element.type === "article" && /items:7/.test(elementText(element)))[0];
    findElements(review, (element) => element.type === "input" && element.props.type === "radio" && /Risky forge/.test(String(element.props["aria-label"])))[0].props.onChange();
    tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Reload latest")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Conflicting changes need resolution.*\/routeOverrides\/items:7.*server-route.*risky/s);
    const saveButton = findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0];
    assert.equal(saveButton.props.disabled, true);
    saveButton.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(putBodies.length, 1, "unresolved overlap must not issue another save");
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("audit-only access is read-only and stale filtered responses cannot replace the latest causal contract", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const oldRequest = deferred();
  const newRequest = deferred();
  let progressRequests = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/progress-audit?")) {
      progressRequests += 1;
      if (progressRequests === 1) return jsonResponse(auditResult("initial-group"));
      if (progressRequests === 2) return oldRequest.promise;
      return newRequest.promise;
    }
    if (target.includes("/craft-plan/audit?")) return jsonResponse({ configHistory: configHistory() });
    return jsonResponse(loadedPlan());
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["audit.view"], canEdit: false, initialWorkspace: "audit" };
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);

    const nav = findElements(tree, (element) => element.type === "nav" && element.props["aria-label"] === "Craft plan workspaces")[0];
    assert.deepEqual(findElements(nav, (element) => element.type === "button").map((button) => elementText(button).trim()), ["Audit"]);
    assert.equal(findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan").length, 0);

    const triggerFilter = findElements(tree, (element) => element.type === "input" && element.props.placeholder === "e.g. stock_movement")[0];
    triggerFilter.props.onChange({ target: { value: "old" } });
    await harness.render(CraftPlanManagerDialog, props);
    triggerFilter.props.onChange({ target: { value: "new" } });
    await harness.render(CraftPlanManagerDialog, props);
    assert.equal(progressRequests, 3, "changing a filter during an in-flight request must start the latest query");

    newRequest.resolve(jsonResponse(auditResult("new-group")));
    await new Promise((resolve) => setImmediate(resolve));
    oldRequest.resolve(jsonResponse(auditResult("old-group")));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);

    const causalEntry = findElements(tree, (element) => element.type === "article" && String(element.props.className).includes("craft-plan-causal-entry"))[0];
    assert.equal(causalEntry.key, "new-group");
    assert.deepEqual(findElements(causalEntry, (element) => element.type === "time").map((time) => time.props.dateTime), ["2026-08-28T10:00:00.000Z", "2026-08-28T11:00:00.000Z"]);
    assert.match(elementText(causalEntry), /Before 1.*After 3.*Delta 2/s);
    assert.match(elementText(causalEntry), /Stock Delta.*items:7/s);
    assert.match(elementText(causalEntry), /items:9.*items:7/s);
    assert.match(elementText(causalEntry), /Evidence timing is incomplete/);
    assert.match(elementText(causalEntry), /Evidence timing is incomplete.*Stock Delta.*Requirement Delta.*items:7.*prior_success_checkpoint/s);
    assert.match(elementText(causalEntry), /Craft Removed.*Progress Delta.*items:7/s);
    assert.match(elementText(tree), /Operator Alice.*Admin.*Update.*Revision 4 → 5/s);
    assert.match(elementText(tree), /\/config\/targets.*"quantity":1.*"quantity":3/s);
    assert.match(elementText(tree), /\/config\/routeOverrides\/items:7.*"risky".*"safe"/s);
    assert.match(elementText(tree), /\/config\/multipliers\/items:7.*null.*"multiplier":1.25/s);
    assert.match(elementText(tree), /\/config\/sourceRules\/storageContainerIds.*\[\].*\["storage-a"\]/s);
    assert.match(elementText(tree), /\/config\/enabled.*false.*true/s);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("Audit time controls send preset and exact bounded ranges while resetting pagination", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const progressUrls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/progress-audit?")) {
      progressUrls.push(target);
      return jsonResponse(auditResult(`range-${progressUrls.length}`));
    }
    if (target.includes("/craft-plan/audit?")) return jsonResponse({ configHistory: [] });
    return jsonResponse(loadedPlan());
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["audit.view"], canEdit: false, initialWorkspace: "audit" };
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);

    const range = findElements(tree, (element) => element.type === "select" && element.props["aria-label"] === "Audit time range")[0];
    assert.ok(range);
    range.props.onChange({ target: { value: "30d" } });
    await harness.render(CraftPlanManagerDialog, props);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(progressUrls.at(-1), /[?&]range=30d(?:&|$)/);
    assert.match(progressUrls.at(-1), /[?&]page=1(?:&|$)/);

    tree = await harness.render(CraftPlanManagerDialog, props);
    const since = findElements(tree, (element) => element.type === "input" && element.props["aria-label"] === "Audit since")[0];
    const until = findElements(tree, (element) => element.type === "input" && element.props["aria-label"] === "Audit until")[0];
    since.props.onChange({ target: { value: "2026-08-10T09:30" } });
    await harness.render(CraftPlanManagerDialog, props);
    until.props.onChange({ target: { value: "2026-08-20T18:45" } });
    await harness.render(CraftPlanManagerDialog, props);
    await new Promise((resolve) => setImmediate(resolve));
    const exactUrl = new URL(progressUrls.at(-1), "http://localhost");
    const sinceInstant = exactUrl.searchParams.get("since");
    const untilInstant = exactUrl.searchParams.get("until");
    assert.match(sinceInstant, /^2026-08-10T\d{2}:\d{2}:00\.000Z$/);
    assert.match(untilInstant, /^2026-08-20T\d{2}:\d{2}:00\.000Z$/);
    assert.equal(new Date(sinceInstant).getTime(), new Date("2026-08-10T09:30").getTime());
    assert.equal(new Date(untilInstant).getTime(), new Date("2026-08-20T18:45").getTime());
    assert.equal(exactUrl.searchParams.get("page"), "1");
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("recipe review can stage calculated-route reset and remove saved buffers absent from preview", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const requests = [];
  const plan = loadedPlan({ config: { routeOverrides: { "items:7": "risky" }, multipliers: { "items:99": { multiplier: 1.2, note: "saved" } } } });
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/preview")) return jsonResponse(preview);
    if (options.method === "PUT") return jsonResponse({ planRecord: { id: "plan-a", revision: 5 } });
    return jsonResponse(plan);
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["settings.manage"], initialWorkspace: "recipes" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);

    const reset = findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Use calculated route")[0];
    const removeBuffer = findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Remove saved buffer")[0];
    assert.ok(reset);
    assert.match(elementText(tree), /items:99.*20%/s);
    assert.ok(removeBuffer);
    reset.props.onClick();
    removeBuffer.props.onClick();
    assert.equal(requests.filter(({ options }) => options.method === "PUT").length, 0);

    tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    const resetReview = findElements(tree, (element) => element.type === "article" && String(element.props.className).includes("craft-plan-review-entry") && /items:7/.test(elementText(element)))[0];
    const selectedRoutes = findElements(resetReview, (element) => element.type === "input" && element.props.type === "radio" && element.props.checked);
    assert.equal(selectedRoutes.length, 1);
    assert.match(String(selectedRoutes[0].props["aria-label"]), /Risky forge/);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Confirm review")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const body = JSON.parse(requests.find(({ options }) => options.method === "PUT").options.body);
    assert.equal(Object.hasOwn(body.config.routeOverrides, "items:7"), false);
    assert.equal(Object.hasOwn(body.config.multipliers, "items:99"), false);
    assert.deepEqual(body.routeReviewConfirmations, [{ outputKey: "items:7", fingerprint: "ambiguous", selectedRouteId: "risky" }]);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("choosing the safe route after reset stages and confirms an explicit override", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const requests = [];
  const plan = loadedPlan({ config: { routeOverrides: { "items:7": "risky" } } });
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/preview")) return jsonResponse(preview);
    if (options.method === "PUT") return jsonResponse({ planRecord: { id: "plan-a", revision: 5 } });
    return jsonResponse(plan);
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["settings.manage"], initialWorkspace: "recipes" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Use calculated route")[0].props.onClick();
    await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    let review = findElements(tree, (element) => element.type === "article" && /items:7/.test(elementText(element)))[0];
    const safeRoute = findElements(review, (element) => element.type === "input" && element.props.type === "radio" && /Safe forge/.test(String(element.props["aria-label"])))[0];
    assert.equal(safeRoute.props.checked, false);
    safeRoute.props.onChange();
    await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    review = findElements(tree, (element) => element.type === "article" && /items:7/.test(elementText(element)))[0];
    assert.equal(findElements(review, (element) => element.type === "input" && /Safe forge/.test(String(element.props["aria-label"])))[0].props.checked, true);
    findElements(review, (element) => element.type === "button" && elementText(element).trim() === "Confirm review")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const body = JSON.parse(requests.find(({ options }) => options.method === "PUT").options.body);
    assert.equal(body.config.routeOverrides["items:7"], "safe");
    assert.deepEqual(body.routeReviewConfirmations, [{ outputKey: "items:7", fingerprint: "ambiguous", selectedRouteId: "safe" }]);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("preview responses are bound to the open lifecycle and selected plan", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const stalePreview = deferred();
  const freshPreview = deferred();
  const freshPlan = deferred();
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/plan-a/preview")) return stalePreview.promise;
    if (target.endsWith("/plan-b/preview")) return freshPreview.promise;
    if (target.endsWith("/plan-b")) return freshPlan.promise;
    const plan = loadedPlan();
    plan.planRecord.id = "plan-a";
    return jsonResponse(plan);
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const base = { onClose() {}, csrfToken: "csrf", onSaved() {}, permissions: ["settings.manage"], initialWorkspace: "recipes" };
    const propsA = { ...base, open: true, planId: "plan-a" };
    await harness.render(CraftPlanManagerDialog, propsA);
    await harness.render(CraftPlanManagerDialog, propsA);
    await harness.render(CraftPlanManagerDialog, { ...propsA, open: false });
    stalePreview.resolve(jsonResponse({ ...preview, routeReviews: [{ outputKey: "items:7", ambiguous: false, selectedRouteId: "stale", preselectedRouteId: "stale", fingerprint: "stale", alternatives: [{ id: "stale", label: "Stale A route", inputs: [] }] }] }));
    await new Promise((resolve) => setImmediate(resolve));
    const propsB = { ...base, open: true, planId: "plan-b" };
    let tree = await harness.render(CraftPlanManagerDialog, propsB);
    assert.doesNotMatch(elementText(tree), /Stale A route/, "a closed plan's preview must not reappear while the next plan loads");
    const planB = loadedPlan();
    planB.planRecord.id = "plan-b";
    freshPlan.resolve(jsonResponse(planB));
    await new Promise((resolve) => setImmediate(resolve));
    await harness.render(CraftPlanManagerDialog, propsB);

    freshPreview.resolve(jsonResponse({ ...preview, routeReviews: [{ outputKey: "items:7", ambiguous: false, selectedRouteId: "fresh", preselectedRouteId: "fresh", fingerprint: "fresh", alternatives: [{ id: "fresh", label: "Fresh B route", inputs: [] }] }] }));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, propsB);
    tree = await harness.render(CraftPlanManagerDialog, propsB);
    assert.match(elementText(tree), /Fresh B route/);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("an in-flight preview cannot apply after the staged draft changes", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const previewA = deferred();
  const previewB = deferred();
  const previewBodies = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/preview")) {
      previewBodies.push(JSON.parse(options.body));
      return previewBodies.length === 1 ? previewA.promise : previewB.promise;
    }
    return jsonResponse(loadedPlan());
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["settings.manage"], initialWorkspace: "recipes" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Goals")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "input" && element.props.value === "Saved plan")[0].props.onChange({ target: { value: "Draft B" } });
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Recipe Review")[0].props.onClick();

    previewA.resolve(jsonResponse({ ...preview, routeReviews: [{ outputKey: "items:7", ambiguous: false, selectedRouteId: "stale", preselectedRouteId: "stale", fingerprint: "stale", alternatives: [{ id: "stale", label: "Stale A route", inputs: [] }] }] }));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.equal(previewBodies.length, 2, "settling A must trigger the queued Draft B preview");
    assert.equal(previewBodies[1].config.name, "Draft B");
    assert.doesNotMatch(elementText(tree), /Stale A route/);

    previewB.resolve(jsonResponse({ ...preview, routeReviews: [{ outputKey: "items:7", ambiguous: false, selectedRouteId: "fresh", preselectedRouteId: "fresh", fingerprint: "fresh", alternatives: [{ id: "fresh", label: "Fresh B route", inputs: [] }] }] }));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Fresh B route/);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("recommendation staging and later buffer edits queue previews for the exact draft", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const previewA = deferred();
  const previewB = deferred();
  const previewC = deferred();
  const previewBodies = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/preview")) {
      previewBodies.push(JSON.parse(options.body));
      return [previewA.promise, previewB.promise, previewC.promise][previewBodies.length - 1];
    }
    return jsonResponse(loadedPlan());
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["settings.manage"], initialWorkspace: "recipes" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);

    previewA.resolve(jsonResponse({ ...preview, materials: [{ key: "items:7", missingNow: 10, planRequired: 10 }] }));
    await new Promise((resolve) => setImmediate(resolve));
    let tree = await harness.render(CraftPlanManagerDialog, props);
    assert.equal(previewBodies.length, 2, "staging the safe recommendation must queue a preview for derived draft B");
    assert.equal(previewBodies[1].config.routeOverrides["items:7"], "safe");
    assert.doesNotMatch(elementText(tree), /Needed now 10/, "preview A must not render after it changes the draft");

    previewB.resolve(jsonResponse({ ...preview, materials: [{ key: "items:7", missingNow: 20, planRequired: 20 }] }));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Needed now 20/);
    findElements(tree, (element) => element.type === "input" && element.props["aria-label"] === "Material buffer for items:7")[0].props.onChange({ target: { value: "25" } });
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.equal(previewBodies.length, 3, "the buffer mutation must queue preview C");
    assert.equal(previewBodies[2].config.multipliers["items:7"].multiplier, 1.25);
    assert.doesNotMatch(elementText(tree), /Needed now 20/, "the old material impact must be hidden while C is pending");

    previewC.resolve(jsonResponse({ ...preview, materials: [{ key: "items:7", missingNow: 30, planRequired: 30 }] }));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Needed now 30/);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("checkpoint comparisons clear on edit and ignore out-of-order results", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/progress-audit/compare?")) {
      const request = deferred();
      requests.push(request);
      return request.promise;
    }
    if (target.includes("/progress-audit?")) return jsonResponse(auditResult("comparison-group"));
    if (target.includes("/craft-plan/audit?")) return jsonResponse({ auditLog: [] });
    return jsonResponse(loadedPlan());
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: ["audit.view"], canEdit: false, initialWorkspace: "audit" };
    await harness.render(CraftPlanManagerDialog, props);
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    let [from, to] = findElements(tree, (element) => element.type === "input" && String(element.props["aria-label"] ?? "").startsWith("Comparison "));
    from.props.onChange({ target: { value: "initial-from" } });
    to.props.onChange({ target: { value: "initial-to" } });
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Compare checkpoints")[0].props.onClick();
    requests[0].resolve(jsonResponse({ ok: true, differences: { initial_only: { changed: true } } }));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Initial Only/);
    [from, to] = findElements(tree, (element) => element.type === "input" && String(element.props["aria-label"] ?? "").startsWith("Comparison "));
    from.props.onChange({ target: { value: "old-from" } });
    to.props.onChange({ target: { value: "old-to" } });
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.doesNotMatch(elementText(tree), /Initial Only/, "editing either checkpoint must clear the result for the prior input pair");
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Compare checkpoints")[0].props.onClick();
    tree = await harness.render(CraftPlanManagerDialog, props);
    [from, to] = findElements(tree, (element) => element.type === "input" && String(element.props["aria-label"] ?? "").startsWith("Comparison "));
    from.props.onChange({ target: { value: "new-from" } });
    to.props.onChange({ target: { value: "new-to" } });
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.doesNotMatch(elementText(tree), /Old Only/);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Compare checkpoints")[0].props.onClick();

    requests[2].resolve(jsonResponse({ ok: true, differences: { new_only: { changed: true } } }));
    await new Promise((resolve) => setImmediate(resolve));
    requests[1].resolve(jsonResponse({ ok: true, differences: { old_only: { changed: true } } }));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /New Only/);
    assert.doesNotMatch(elementText(tree), /Old Only/);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});

test("an admin owner of a personal plan can edit and view Audit", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("/progress-audit?")
    ? jsonResponse(auditResult("personal-owner"))
    : String(url).includes("/craft-plan/audit?") ? jsonResponse({ configHistory: configHistory("plan-a") }) : jsonResponse(loadedPlan({ personal: true }));
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", personal: true, ownerManaged: true, permissions: ["settings.manage", "audit.view"], canEdit: true };
    await harness.render(CraftPlanManagerDialog, props);
    const tree = await harness.render(CraftPlanManagerDialog, props);
    const nav = findElements(tree, (element) => element.type === "nav" && element.props["aria-label"] === "Craft plan workspaces")[0];
    assert.deepEqual(findElements(nav, (element) => element.type === "button").map((button) => elementText(button).trim()), ["Goals", "Counted Sources", "Recipe Review", "Audit"]);
    assert.equal(findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan").length, 1);
    findElements(nav, (element) => element.type === "button" && elementText(element).trim() === "Audit")[0].props.onClick();
    await harness.render(CraftPlanManagerDialog, props);
    const auditTree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(auditTree), /Operator Alice.*Revision 4 → 5/s);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});
