import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// One issue per incident; comment only when its state changes. No Discord delivery.
export async function updateIncident(state, { github, repository, runUrl, issueNumber }) {
  const messages = {
    detected: "Relay schema drift detected. Preparing a pinned regeneration and verified update.",
    review: "Generated bindings or release metadata need manual review. Automatic deployment was withheld.",
    deploying: "The verified fingerprint-only refresh was merged and deployment was dispatched. Awaiting fresh production data.",
    failed: "Schema recovery needs attention. Verification, release or production recovery failed; inspect the workflow run. Last-good data remains protected by the runtime schema guard.",
    recovered: "Production recovery confirmed: the expected revision is serving fresh settlement generations and a live map snapshot.",
  };
  if (!messages[state]) throw new Error("Unknown schema incident state");
  if (issueNumber != null && !/^\d+$/.test(String(issueNumber))) throw new Error("Invalid schema incident number");
  const issues = issueNumber
    ? [await github("GET", `/repos/${repository}/issues/${issueNumber}`)]
    : await github("GET", `/repos/${repository}/issues?state=open&labels=relay-schema-incident&per_page=100`);
  const issue = issues.find(row => !row.pull_request && row.title === "Relay schema drift detected");
  if (issueNumber && !issue) throw new Error("Requested issue is not the schema incident");
  if (issue?.state === "closed") return issue.number;
  if (!issue && state === "recovered") return null;
  if (issue && state === "detected") return issue.number;
  const marker = `<!-- relay-schema-state:${state} -->`;
  if (issue?.body?.includes(marker)) {
    // A previous run may have stopped after updating the marker, before closing.
    if (state === "recovered") await github("PATCH", `/repos/${repository}/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
    return issue.number;
  }
  const body = `${marker}\n\n${messages[state]}\n\n[Workflow details](${runUrl})`;
  if (!issue) {
    const result = await github("POST", `/repos/${repository}/issues`, { title: "Relay schema drift detected", body, labels: ["relay-schema-incident"] });
    return result.number;
  }
  await github("PATCH", `/repos/${repository}/issues/${issue.number}`, { body });
  await github("POST", `/repos/${repository}/issues/${issue.number}/comments`, { body });
  if (state === "recovered") await github("PATCH", `/repos/${repository}/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
  return issue.number;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const github = async (method, path, body) => JSON.parse(execFileSync("gh", ["api", path, "--method", method, ...(body ? ["--input", "-"] : [])], { input: body ? JSON.stringify(body) : undefined, encoding: "utf8" }));
  // Idempotent label creation; do not mask authentication or transport errors.
  const labels = await github("GET", `/repos/${repository}/labels?per_page=100`);
  if (!labels.some(label => label.name === "relay-schema-incident")) await github("POST", `/repos/${repository}/labels`, { name: "relay-schema-incident", color: "d4a72c" });
  const number = await updateIncident(process.argv[2], { github, repository, issueNumber: process.env.SCHEMA_ISSUE_NUMBER || undefined, runUrl: `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` });
  if (number && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `number=${number}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
