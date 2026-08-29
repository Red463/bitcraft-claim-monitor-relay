import { Worker } from "node:worker_threads";

function workerTaskError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function executeWorkerTask(workerUrl, workerData, { WorkerClass, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const worker = new WorkerClass(workerUrl, { workerData });
    let settled = false;
    let timer = null;
    const abort = () => finish(reject, workerTaskError("Worker task was cancelled", "WORKER_TASK_CANCELLED"), true);
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.removeAllListeners();
    };
    const finish = (callback, value, terminate = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
      if (!terminate) return;
      try {
        void Promise.resolve(worker.terminate()).catch(() => {});
      } catch {
        // The task result is already settled; termination is best-effort cleanup.
      }
    };
    worker.once("message", (message) => {
      if (message?.error) {
        const error = workerTaskError(String(message.error.message ?? message.error), String(message.error.code ?? "WORKER_TASK_FAILED"));
        if (message.error.name) error.name = String(message.error.name);
        finish(reject, error, true);
      } else {
        finish(resolve, message?.result ?? message, true);
      }
    });
    worker.once("error", (error) => finish(reject, error, true));
    worker.once("exit", (code) => {
      const message = code === 0 ? "Worker stopped without returning a result" : `Worker stopped with exit code ${code}`;
      finish(reject, workerTaskError(message, code === 0 ? "WORKER_TASK_NO_RESULT" : "WORKER_TASK_EXIT"));
    });
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(reject, workerTaskError(`Worker task exceeded ${timeoutMs} ms`, "WORKER_TASK_TIMEOUT"), true), timeoutMs);
    timer.unref?.();
  });
}

export function createWorkerTaskRunner({
  maxConcurrent = 1,
  maxQueued = 8,
  timeoutMs = 60_000,
  WorkerClass = Worker,
} = {}) {
  const concurrency = Math.max(1, Math.floor(Number(maxConcurrent) || 1));
  const queueLimit = Math.max(0, Math.floor(Number(maxQueued) || 0));
  const deadline = Math.max(1, Math.floor(Number(timeoutMs) || 60_000));
  const queue = [];
  let active = 0;

  const pump = () => {
    while (active < concurrency && queue.length) {
      const task = queue.shift();
      task.signal?.removeEventListener("abort", task.abortQueued);
      if (task.signal?.aborted) {
        task.reject(workerTaskError("Worker task was cancelled", "WORKER_TASK_CANCELLED"));
        continue;
      }
      active += 1;
      executeWorkerTask(task.workerUrl, task.workerData, {
        WorkerClass,
        timeoutMs: task.timeoutMs ?? deadline,
        signal: task.signal,
      }).then(task.resolve, task.reject).finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  return {
    run(workerUrl, workerData, { signal, timeoutMs: taskTimeoutMs } = {}) {
      if (signal?.aborted) return Promise.reject(workerTaskError("Worker task was cancelled", "WORKER_TASK_CANCELLED"));
      if (active >= concurrency && queue.length >= queueLimit) {
        return Promise.reject(workerTaskError("Worker task queue is full", "WORKER_QUEUE_FULL"));
      }
      return new Promise((resolve, reject) => {
        const task = { workerUrl, workerData, signal, timeoutMs: taskTimeoutMs, resolve, reject, abortQueued: null };
        task.abortQueued = () => {
          const index = queue.indexOf(task);
          if (index < 0) return;
          queue.splice(index, 1);
          signal?.removeEventListener("abort", task.abortQueued);
          reject(workerTaskError("Worker task was cancelled", "WORKER_TASK_CANCELLED"));
          pump();
        };
        queue.push(task);
        signal?.addEventListener("abort", task.abortQueued, { once: true });
        pump();
      });
    },
    stats() {
      return { active, queued: queue.length, maxConcurrent: concurrency, maxQueued: queueLimit };
    },
  };
}

const defaultWorkerTaskRunner = createWorkerTaskRunner({
  maxConcurrent: Number(process.env.WORKER_TASK_CONCURRENCY ?? 1),
  maxQueued: Number(process.env.WORKER_TASK_QUEUE_LIMIT ?? 8),
  timeoutMs: Number(process.env.WORKER_TASK_TIMEOUT_MS ?? 60_000),
});

export function runWorkerTask(workerUrl, workerData, options) {
  return defaultWorkerTaskRunner.run(workerUrl, workerData, options);
}
