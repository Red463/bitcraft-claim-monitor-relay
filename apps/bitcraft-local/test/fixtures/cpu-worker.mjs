import { parentPort, workerData } from "node:worker_threads";

const deadline = performance.now() + Number(workerData.durationMs ?? 0);
while (performance.now() < deadline) {
  // Exercise a real CPU-bound worker without blocking the test process event loop.
}
parentPort.postMessage(workerData.result ?? "complete");
