const OPTIONAL_BATCH_SERVICE = /-map-(?:terrain|roads)(?:\.service)?$/;

function finiteNonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function serviceCpuPercent({ currentUsageNSec, previousUsageNSec, elapsedSeconds, cores = 1 }) {
  const current = finiteNonNegative(currentUsageNSec);
  const previous = finiteNonNegative(previousUsageNSec);
  const elapsed = finiteNonNegative(elapsedSeconds);
  const availableCores = Math.max(1, Math.floor(Number(cores) || 1));
  if (current == null || previous == null || elapsed == null || elapsed <= 0 || current < previous) return 0;
  return Math.min(availableCores * 100, Math.max(0, ((current - previous) / 1_000_000_000 / elapsed) * 100));
}

export function serviceIsRequired(name) {
  return !OPTIONAL_BATCH_SERVICE.test(String(name ?? ""));
}
