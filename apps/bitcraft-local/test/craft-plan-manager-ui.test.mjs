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

function loadedPlan({ personal = false } = {}) {
  return {
    planRecord: { id: "plan-a", revision: 4, scope: personal ? "personal" : "shared" },
    config: { enabled: true, name: "Saved plan", targets: [], sourceRules: {} },
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
    { outputKey: "items:9", ambiguous: false, confirmed: true, selectedRouteId: "only", preselectedRouteId: "only", fingerprint: "one", alternatives: [{ id: "only", label: "Only route", probabilityStatus: "guaranteed", inputs: [] }] },
    { outputKey: "items:7", ambiguous: true, confirmed: false, selectedRouteId: "risky", preselectedRouteId: "safe", fingerprint: "ambiguous", alternatives: [
      { id: "risky", label: "Risky forge", probabilityStatus: "expected", isProbabilistic: true, inputs: [{ key: "items:2", quantity: 3 }] },
      { id: "safe", label: "Safe forge", probabilityStatus: "guaranteed", isProbabilistic: false, inputs: [{ key: "cargo:2", quantity: 2 }] },
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
    assert.ok(requests.some(({ url, options }) => url.endsWith("/preview") && options.method === "POST"));
    const reviews = findElements(tree, (element) => element.type === "article" && String(element.props.className).includes("craft-plan-review-entry"));
    assert.match(elementText(reviews[0]), /items:7/);
    const routeInputs = findElements(reviews[0], (element) => element.type === "input" && element.props.type === "radio");
    assert.equal(routeInputs.length, 2);
    assert.equal(routeInputs[1].props.checked, true, "server safest preselection should be selected");
    assert.match(String(routeInputs[0].props["aria-label"]), /Risky forge/);
    routeInputs[0].props.onChange();
    tree = await harness.render(CraftPlanManagerDialog, props);
    const buffer = findElements(tree, (element) => element.type === "input" && element.props["aria-label"] === "Material buffer for items:7")[0];
    buffer.props.onChange({ target: { value: "25" } });
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

test("public ambiguity and revision conflicts preserve the draft and expose explicit recovery", async () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const harness = installHookHarness();
  const originalFetch = globalThis.fetch;
  let putCount = 0;
  const putBodies = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/preview")) return jsonResponse(preview);
    if (options.method === "PUT") {
      putCount += 1;
      putBodies.push(JSON.parse(options.body));
      if (putCount === 1) return jsonResponse({ error: "Confirm routes", code: "craft_plan_route_review_required", unconfirmedRoutes: [{ outputKey: "items:7", fingerprint: "ambiguous", preselectedRouteId: "safe" }] }, { ok: false, status: 409 });
      return jsonResponse({ error: "Changed elsewhere", code: "craft_plan_revision_conflict", conflict: { currentRevision: 5, config: { name: "Server plan" } } }, { ok: false, status: 409 });
    }
    return jsonResponse(loadedPlan());
  };
  try {
    const { CraftPlanManagerDialog } = await vite.ssrLoadModule("/src/pages/CraftPlanManagerDialog.tsx");
    const props = { open: true, onClose() {}, csrfToken: "csrf", onSaved() {}, planId: "plan-a", permissions: [] };
    await harness.render(CraftPlanManagerDialog, props);
    let tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "input" && element.props.value === "Saved plan")[0].props.onChange({ target: { value: "Unsaved plan" } });
    tree = await harness.render(CraftPlanManagerDialog, props);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.match(elementText(tree), /Public route review required/);
    assert.ok(findElements(tree, (element) => element.type === "input" && element.props.value === "Unsaved plan")[0]);
    findElements(tree, (element) => element.type === "button" && elementText(element).trim() === "Confirm routes and Save Plan")[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(CraftPlanManagerDialog, props);
    assert.equal(putBodies[1].config.routeOverrides["items:7"], "safe", "public confirmation should stage the safest server recommendation");
    assert.match(elementText(tree), /Plan changed elsewhere/);
    assert.match(elementText(tree), /Reload latest/);
    assert.ok(findElements(tree, (element) => element.type === "input" && element.props.value === "Unsaved plan")[0], "409 must keep the unsaved draft");
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
    await vite.close();
  }
});
