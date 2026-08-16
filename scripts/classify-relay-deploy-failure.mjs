import process from "node:process";

let output = "";
for await (const chunk of process.stdin) output += chunk;

const category = (() => {
  if (/Rollback: failed|Rollback incomplete/i.test(output)) return "rollback";
  if (/heap out of memory|oom-kill|Killed process/i.test(output)) return "out-of-memory";
  if (/ERR_MODULE_NOT_FOUND|Cannot find module/i.test(output)) return "startup-module";
  if (/Waiting for web service[.\s]*failed/i.test(output)) return "web-service";
  if (/Waiting for worker service[.\s]*failed/i.test(output)) return "worker-service";
  if (/Candidate Public: check failed|Public: check failed/i.test(output)) return "public-check";
  if (/Candidate Health: not checked|Waiting for web health[.\s]*failed/i.test(output)) return "health-timeout";
  if (/Ordinary deployments require --build-artifact-sha256|Unknown or mixed build artifact mode/i.test(output)) return "artifact-capability";
  if (/Another deployment is already running/i.test(output)) return "busy";
  if (/Installing dependencies failed|Building app failed|Installing verified CI build failed|Relay build archive|Expected Relay build archive|Validating .* failed/i.test(output)) return "prepare";
  return "other";
})();

process.stdout.write(`${category}\n`);
