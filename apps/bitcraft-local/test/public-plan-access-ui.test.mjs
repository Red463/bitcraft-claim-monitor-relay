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

function capturePlanSecret(window, fragment) {
  window.location.hash = fragment;
  return import("../src/public/planSecrets.mjs").then(({ capturePublicPlanFragmentSecret }) => {
    assert.equal(capturePublicPlanFragmentSecret({
      location: window.location,
      history: window.history,
      sessionStorage: window.sessionStorage,
    }), true);
  });
}

test("the mounted shared-plan route renders bearer-redacted aggregate computation without source details", async () => {
  const token = "mounted-reusable-share-secret";
  const dom = installDom("http://localhost/shared-plans/plan-7");
  await capturePlanSecret(dom.window, `#share=${token}`);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    calls.push([String(input), init]);
    if (String(input).endsWith("/computation")) return json(200, {
      computation: {
        available: true,
        plan: {
          materials: [{ key: "items:7", name: "Timber", required: 10, available: 4, inProgress: 1, missing: 5, sources: [{ storageId: "must-not-render" }] }],
          totals: { missingItems: 1 },
        },
      },
    });
    return json(200, { plan: {
        id: "plan-7",
        title: "Shared bridge plan",
        claimId: "42",
        role: "bearer",
        document: { targets: [{ catalogKey: "items:7", quantity: "1" }, { catalogKey: "cargo:8", quantity: "2" }] },
      } });
  };
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, { route: { id: "shared-plan", params: { id: "plan-7" } }, features: collaborationFeatures }));
    await dom.flush();

    const sharedCalls = calls.filter(([path]) => path.startsWith("/api/public/shared-plans/"));
    assert.equal(sharedCalls.length, 2);
    assert.equal(sharedCalls[0][0], "/api/public/shared-plans/plan-7");
    assert.equal(sharedCalls[1][0], "/api/public/shared-plans/plan-7/computation");
    assert.doesNotMatch(sharedCalls[0][0], /[?#]|mounted-reusable-share-secret/);
    assert.equal(sharedCalls[0][1].headers.authorization, `Bearer ${token}`);
    assert.match(document.body.textContent, /Shared bridge plan/);
    assert.match(document.body.textContent, /Claim #42/);
    assert.match(document.body.textContent, /2 targets/);
    assert.match(document.body.textContent, /Timber/);
    assert.match(document.body.textContent, /Required 10/);
    assert.match(document.body.textContent, /Available 4/);
    assert.match(document.body.textContent, /Remaining 5/);
    assert.doesNotMatch(document.body.textContent, /must-not-render|storageId|sources/i);
    assert.doesNotMatch(document.body.textContent, new RegExp(token));
    assert.doesNotMatch(document.title, new RegExp(token));
    assert.equal(window.location.hash, "");
  } finally {
    if (view) await view.unmount();
    await vite.close();
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});

test("the mounted shared-plan route shows an explicit unavailable computation state", async () => {
  const dom = installDom("http://localhost/shared-plans/plan-unavailable");
  await capturePlanSecret(dom.window, "#share=unavailable-share-secret");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).endsWith("/computation")
    ? json(200, { computation: { available: false, warning: "Current claim data could not be loaded." } })
    : json(200, { plan: { id: "plan-unavailable", title: "Offline plan", claimId: "42", role: "bearer", document: { targets: [] } } });
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, { route: { id: "shared-plan", params: { id: "plan-unavailable" } }, features: collaborationFeatures }));
    await dom.flush();
    assert.match(document.body.textContent, /Current claim data could not be loaded/);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});

test("the mounted invite route never posts before an explicit accept action", async () => {
  const token = "mounted-one-time-invite-secret";
  const dom = installDom("http://localhost/invites/invite-8");
  await capturePlanSecret(dom.window, `#token=${token}`);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const path = String(input);
    calls.push([path, init]);
    if (path === "/api/public/auth/session") {
      return json(200, {
        user: { id: 8, discordId: "8", username: "invitee", globalName: "Invitee", avatarUrl: null, settings: {}, createdAt: "2026-08-25T00:00:00.000Z", lastLoginAt: null },
        csrfToken: "public-csrf",
        discordLoginEnabled: true,
        legal: { version: "2026-08-25", termsDigest: "terms", privacyDigest: "privacy", acceptedAt: "2026-08-25T09:00:00.000Z", requiresAcceptance: false },
      });
    }
    const posts = calls.filter(([, request]) => request.method === "POST").length;
    if (posts === 1) return json(428, { code: "revision_required", currentRevisions: { access: 7 } });
    return json(200, { plan: { id: "plan-8", title: "Accepted bridge plan", claimId: "42", document: { targets: [] } } });
  };
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, { route: { id: "invite", params: { id: "invite-8" } }, features: collaborationFeatures }));
    await dom.flush();

    assert.ok(calls.length >= 1);
    assert.ok(calls.every(([path, init]) => path === "/api/public/auth/session" && (init.method ?? "GET") === "GET"));
    const accept = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Accept invitation"));
    assert.ok(accept && !accept.disabled);

    await act(async () => accept.click());
    await dom.flush();
    const mutations = calls.filter(([, init]) => init.method === "POST");
    assert.equal(mutations.length, 2);
    assert.equal(mutations[0][0], "/api/public/invites/invite-8/accept");
    assert.equal("if-match" in mutations[0][1].headers, false);
    assert.equal(mutations[1][1].headers["if-match"], '"access:7"');
    assert.match(document.body.textContent, /Accepted bridge plan/);
    assert.doesNotMatch(document.body.textContent, new RegExp(token));
    assert.doesNotMatch(document.title, new RegExp(token));
    assert.ok(calls.every(([path]) => !/[?#]/.test(path) && !path.includes(token)));
  } finally {
    if (view) await view.unmount();
    await vite.close();
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});
