import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace("export default defineConfig(", "globalThis.config = (");
const context = { process: { env: {} }, react: () => ({}) };
runInNewContext(source, context);

test("React scheduler stays in the React chunk to prevent circular vendor initialization", () => {
  const manualChunks = context.config.build.rollupOptions.output.manualChunks;

  assert.equal(manualChunks("/workspace/node_modules/react/index.js"), "vendor-react");
  assert.equal(manualChunks("/workspace/node_modules/scheduler/index.js"), "vendor-react");
  assert.equal(manualChunks("/workspace/node_modules/featurebase-js/dist/react.js"), "vendor");
});
