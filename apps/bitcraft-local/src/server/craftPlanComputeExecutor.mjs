import { runWorkerTask } from "./workerTask.mjs";

const craftPlanComputeWorkerUrl = new URL("./craftPlanComputeWorker.mjs", import.meta.url);

export function computeCraftPlanOffThread(input) {
  return runWorkerTask(craftPlanComputeWorkerUrl, input);
}
