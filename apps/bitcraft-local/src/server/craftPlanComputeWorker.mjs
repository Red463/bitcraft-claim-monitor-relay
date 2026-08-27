import { parentPort, workerData } from "node:worker_threads";
import { computeCraftPlan } from "./craftPlanning.mjs";

try {
  parentPort.postMessage({ result: computeCraftPlan(workerData) });
} catch (error) {
  parentPort.postMessage({ error: {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    code: typeof error?.code === "string" ? error.code : "CRAFT_PLAN_COMPUTE_FAILED",
  } });
}
