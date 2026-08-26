import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";

import { React, act, installDom, mount } from "./react-dom-test-harness.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const collaborationFeatures = {
  publicProfileEnabled: true,
  publicCollaborationEnabled: true,
  publicLegalConfigurationConfirmed: true,
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function session() {
  return {
    user: { id: 8, discordId: "8", username: "planner", globalName: "Planner", avatarUrl: null, settings: {}, createdAt: "2026-08-25T00:00:00.000Z", lastLoginAt: "2026-08-25T09:00:00.000Z" },
    csrfToken: "public-csrf",
    discordLoginEnabled: true,
    legal: { version: "2026-08-25", termsDigest: "terms", privacyDigest: "privacy", acceptedAt: "2026-08-25T09:00:00.000Z", requiresAcceptance: false },
  };
}

const serverPlan = {
  id: "plan-7",
  title: "North wall",
  claimId: "42",
  status: "active",
  role: "owner",
  revisions: { document: 4, access: 7 },
  document: { schemaVersion: 1, targets: [], routeOverrides: {}, multipliers: {}, sectionOverrides: {}, rowNameOverrides: {} },
  access: { members: [], invites: [], shareLinks: [] },
};

test("plan editor keeps an unsaved draft on conflict and offers reload and copy recovery", async () => {
  const dom = installDom("http://localhost/plans/plan-7");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const path = String(input);
    calls.push([path, init]);
    if (path === "/api/public/auth/session") return json(200, session());
    if (path === "/api/public/plans/plan-7/events") return json(200, { events: [] });
    if (path === "/api/public/plans/plan-7" && !init.method) return json(200, { plan: serverPlan });
    if (path === "/api/public/plans/plan-7/document") {
      return json(409, { code: "revision_conflict", currentRevisions: { document: 5, access: 8 } });
    }
    throw new Error(`Unexpected request ${path}`);
  };
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, { route: { id: "plan", params: { id: "plan-7" } }, features: collaborationFeatures }));
    await dom.flush();

    const editor = document.querySelector("textarea[aria-label='Plan document JSON']");
    assert.ok(editor);
    const unsaved = JSON.stringify({ ...serverPlan.document, targets: [{ catalogKey: "items:7", quantity: "12" }] }, null, 2);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(editor, unsaved);
      editor.dispatchEvent(new window.Event("input", { bubbles: true }));
      editor.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Save plan"));
    assert.ok(save);
    await act(async () => save.click());
    await dom.flush();

    assert.equal(editor.value, unsaved, "the server conflict must not replace the local draft");
    assert.match(document.body.textContent, /unsaved draft has been kept/i);
    assert.ok([...document.querySelectorAll("button")].some((button) => button.textContent.includes("Reload server version")));
    assert.ok([...document.querySelectorAll("button")].some((button) => button.textContent.includes("Copy unsaved draft")));
    assert.equal(calls.filter(([path]) => path === "/api/public/plans/plan-7/document").length, 1);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});

test("my plans renders owned and shared roles and exposes creation", async () => {
  const dom = installDom("http://localhost/plans");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input) === "/api/public/auth/session"
    ? json(200, session())
    : json(200, { plans: [serverPlan, { ...serverPlan, id: "plan-8", title: "Shared forge", role: "viewer" }] });
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, { route: { id: "plans", params: {} }, features: collaborationFeatures }));
    await dom.flush();
    assert.match(document.body.textContent, /My plans/);
    assert.match(document.body.textContent, /North wall/);
    assert.match(document.body.textContent, /Shared forge/);
    assert.match(document.body.textContent, /Claim #42/);
    assert.doesNotMatch(document.body.textContent, /Settlement #42/);
    assert.match(document.body.textContent, /Owner/);
    assert.match(document.body.textContent, /Viewer/);
    assert.ok(document.querySelector("a[href='/plans/new']"));
  } finally {
    if (view) await view.unmount();
    await vite.close();
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});

test("cloning navigates to the returned plan instead of editing it under the source URL", async () => {
  const dom = installDom("http://localhost/plans/plan-7");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/public/auth/session") return json(200, session());
    if (path === "/api/public/plans/plan-7/events") return json(200, { events: [] });
    if (path === "/api/public/plans/plan-7" && !init.method) return json(200, { plan: serverPlan });
    if (path === "/api/public/plans/plan-7/clone") return json(201, { plan: { ...serverPlan, id: "plan-copy", title: "North wall copy" } });
    throw new Error(`Unexpected request ${path}`);
  };
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, { route: { id: "plan", params: { id: "plan-7" } }, features: collaborationFeatures }));
    await dom.flush();
    const clone = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Clone"));
    assert.ok(clone);
    await act(async () => clone.click());
    await dom.flush();
    assert.equal(window.location.pathname, "/plans/plan-copy");
  } finally {
    if (view) await view.unmount();
    await vite.close();
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});

test("access mutations reload full plan details instead of replacing them with a summary", async () => {
  const dom = installDom("http://localhost/plans/plan-7");
  const originalFetch = globalThis.fetch;
  let planReads = 0;
  const detailed = { ...serverPlan, access: { ...serverPlan.access, members: [{ userId: 9, username: "editor", globalName: "Forge Editor", role: "editor" }] } };
  globalThis.fetch = async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/public/auth/session") return json(200, session());
    if (path === "/api/public/plans/plan-7/events") return json(200, { events: [] });
    if (path === "/api/public/plans/plan-7" && !init.method) { planReads += 1; return json(200, { plan: { ...detailed, status: planReads > 1 ? "archived" : "active", revisions: { document: 4, access: planReads > 1 ? 8 : 7 } } }); }
    if (path === "/api/public/plans/plan-7/status") return json(200, { plan: { ...serverPlan, status: "archived", access: undefined, revisions: { document: 4, access: 8 } } });
    throw new Error(`Unexpected request ${path}`);
  };
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, { route: { id: "plan", params: { id: "plan-7" } }, features: collaborationFeatures }));
    await dom.flush();
    assert.match(document.body.textContent, /Forge Editor/);
    const archive = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Archive"));
    assert.ok(archive);
    await act(async () => archive.click());
    await dom.flush();
    assert.equal(planReads, 2);
    assert.match(document.body.textContent, /Forge Editor/);
    assert.match(document.body.textContent, /Unarchive/);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});

test("access refresh does not rebase an unsaved draft onto a newer server document revision", async () => {
  const dom = installDom("http://localhost/plans/plan-7");
  const originalFetch = globalThis.fetch;
  let planReads = 0;
  const documentSaves = [];
  globalThis.fetch = async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/public/auth/session") return json(200, session());
    if (path === "/api/public/plans/plan-7/events") return json(200, { events: [] });
    if (path === "/api/public/plans/plan-7" && !init.method) {
      planReads += 1;
      return json(200, { plan: planReads === 1 ? serverPlan : {
        ...serverPlan,
        status: "archived",
        revisions: { document: 5, access: 8 },
        document: { ...serverPlan.document, targets: [{ catalogKey: "items:99", quantity: "5" }] },
      } });
    }
    if (path === "/api/public/plans/plan-7/status") return json(200, { plan: { ...serverPlan, status: "archived", revisions: { document: 5, access: 8 } } });
    if (path === "/api/public/plans/plan-7/document") {
      documentSaves.push(init);
      return json(409, { code: "revision_conflict", currentRevisions: { document: 5, access: 8 } });
    }
    throw new Error(`Unexpected request ${path}`);
  };
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, { route: { id: "plan", params: { id: "plan-7" } }, features: collaborationFeatures }));
    await dom.flush();

    const editor = document.querySelector("textarea[aria-label='Plan document JSON']");
    const unsaved = JSON.stringify({ ...serverPlan.document, targets: [{ catalogKey: "items:7", quantity: "12" }] }, null, 2);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(editor, unsaved);
      editor.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const archive = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Archive"));
    await act(async () => archive.click());
    await dom.flush();
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Save plan"));
    await act(async () => save.click());
    await dom.flush();

    assert.equal(planReads, 2);
    assert.equal(documentSaves.length, 1);
    assert.equal(documentSaves[0].headers["if-match"], '"document:4"', "save must use the revision on which the retained draft was based");
    assert.equal(editor.value, unsaved);
    assert.match(document.body.textContent, /unsaved draft has been kept/i);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});

test("Public service Admin UI keeps lookup and restore controls above moderator authority", async () => {
  const dom = installDom("https://app.timbersteeltrade.com/admin?section=public-service");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  const onRequest = async () => ({ totals: { accounts: 2, plans: 3, suspendedAccounts: 0, suspendedPlans: 0 } });
  let view;
  try {
    const { PublicServiceAdminSection } = await vite.ssrLoadModule("/src/components/admin/PublicServiceAdminSection.tsx");

    view = await mount(React.createElement(PublicServiceAdminSection, {
      canInspect: false,
      canModerate: true,
      canRestore: false,
      canProcessPrivacy: false,
      onRequest,
    }));
    await dom.flush();
    assert.match(document.body.textContent, /Exact moderation actions/);
    assert.match(document.body.textContent, /Suspend account/);
    assert.match(document.body.textContent, /Revoke invitation/);
    assert.doesNotMatch(document.body.textContent, /Exact account lookup|Exact plan lookup|Restore account|Restore plan|privacy deletion/i);

    await view.unmount();
    view = await mount(React.createElement(PublicServiceAdminSection, {
      canInspect: false,
      canModerate: false,
      canRestore: false,
      canProcessPrivacy: false,
      onRequest,
    }));
    await dom.flush();
    assert.match(document.body.textContent, /view health only/i);
    assert.doesNotMatch(document.body.textContent, /Exact moderation actions|Suspend account|Revoke invitation|Exact account lookup/);

    await view.unmount();
    view = await mount(React.createElement(PublicServiceAdminSection, {
      canInspect: true,
      canModerate: true,
      canRestore: true,
      canProcessPrivacy: true,
      onRequest,
    }));
    await dom.flush();
    assert.match(document.body.textContent, /Exact account lookup/);
    assert.match(document.body.textContent, /Exact plan lookup/);
    assert.doesNotMatch(document.body.textContent, /Exact moderation actions/);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});
