function boundedImageConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return 1;
  return Math.max(1, Math.min(2, parsed));
}

export function configureMapGenerationConcurrency(sharpModule, environment = process.env) {
  if (!sharpModule || typeof sharpModule.concurrency !== "function") {
    throw new TypeError("Map generation requires a Sharp concurrency controller");
  }
  const concurrency = boundedImageConcurrency(environment?.BITCRAFT_MAP_IMAGE_CONCURRENCY);
  sharpModule.concurrency(concurrency);
  return concurrency;
}
