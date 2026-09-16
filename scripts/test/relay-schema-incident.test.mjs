import assert from "node:assert/strict";
import test from "node:test";
import { updateIncident } from "../relay-schema-incident.mjs";

test("incident stays quiet in an unchanged state and closes only on confirmed recovery", async () => {
  const calls = [];
  let issue;
  const options = { repository: "owner/repo", runUrl: "https://github.com/owner/repo/actions/runs/1", github: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET") return issue ? [issue] : [];
    if (method === "POST" && path.endsWith("/issues")) return issue = { ...body, number: 5 };
    if (method === "PATCH") Object.assign(issue, body);
    return {};
  } };
  await updateIncident("detected", options);
  const initial = calls.length;
  await updateIncident("detected", options);
  assert.equal(calls.length, initial + 1);
  await updateIncident("deploying", options);
  assert.notEqual(issue.state, "closed");
  await updateIncident("failed", options);
  assert.notEqual(issue.state, "closed");
  await updateIncident("recovered", options);
  assert.equal(issue.state, "closed");
  assert.equal(calls.filter(call => call.body?.state === "closed").length, 1);
});

test("recovery resumes an interrupted close and targets only its original incident", async () => {
  const issue = { number: 7, title: "Relay schema drift detected", body: "<!-- relay-schema-state:recovered -->", state: "open" };
  const calls = [];
  await updateIncident("recovered", { issueNumber: 7, repository: "owner/repo", runUrl: "https://example.test/run", github: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET") { assert.equal(path, "/repos/owner/repo/issues/7"); return issue; }
    return {};
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { state: "closed", state_reason: "completed" });
});
