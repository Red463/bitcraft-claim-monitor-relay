import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isExecutedMainModule(importMetaUrl, argvEntry = process.argv[1], resolveRealPath = realpathSync, fromFileUrl = fileURLToPath) {
  if (!argvEntry) return false;
  try {
    return resolveRealPath(argvEntry) === resolveRealPath(fromFileUrl(importMetaUrl));
  } catch {
    return false;
  }
}
