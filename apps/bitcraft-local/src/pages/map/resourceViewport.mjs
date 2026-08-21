function decimalIds(values) {
  return [...new Set((values ?? []).flatMap((value) => {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) return [];
    return [BigInt(text).toString()];
  }))].sort((left, right) => left.length - right.length || left.localeCompare(right));
}

export function newlyAddedResourceIds(previousResourceIds = [], nextResourceIds = []) {
  const previous = new Set(decimalIds(previousResourceIds));
  return decimalIds(nextResourceIds).filter((resourceId) => !previous.has(resourceId));
}

function targetOrder(left, right) {
  return left.priority - right.priority
    || left.distance - right.distance
    || left.key.localeCompare(right.key, undefined, { numeric: true })
    || left.x - right.x
    || left.z - right.z;
}

export function resourceLocatePoint({ resourceId, partitions, preferredRegionId = "", centre = { x: 0, z: 0 } }) {
  const canonicalResourceId = decimalIds([resourceId])[0];
  if (!canonicalResourceId) return null;
  const centreX = Number.isFinite(centre?.x) ? Number(centre.x) : 0;
  const centreZ = Number.isFinite(centre?.z) ? Number(centre.z) : 0;
  let best = null;
  for (const partition of partitions?.values?.() ?? []) {
    if (String(partition?.resourceId) !== canonicalResourceId) continue;
    for (const coordinates of [partition.committed, partition.provisional]) {
      if (!(coordinates instanceof Uint32Array)) continue;
      for (const packed of coordinates) {
        const x = packed & 0xffff;
        const z = packed >>> 16;
        const candidate = {
          key: String(partition.key),
          regionId: String(partition.regionId),
          resourceId: canonicalResourceId,
          x,
          z,
          priority: String(partition.regionId) === String(preferredRegionId) ? 0 : 1,
          distance: (x - centreX) ** 2 + (z - centreZ) ** 2,
        };
        if (!best || targetOrder(candidate, best) < 0) best = candidate;
      }
    }
  }
  if (!best) return null;
  return { key: best.key, regionId: best.regionId, resourceId: best.resourceId, x: best.x, z: best.z };
}

export function applyResourceLocate(input) {
  const activation = input.activation;
  if (!activation || activation.id === input.consumedActivationId) return input.consumedActivationId;
  const target = resourceLocatePoint({
    resourceId: activation.resourceId,
    partitions: input.partitions,
    preferredRegionId: input.preferredRegionId,
    centre: input.centre,
  });
  if (!target) return input.consumedActivationId;
  input.highlight(target);
  if (!input.isVisible(target)) input.locate(target);
  return activation.id;
}

export function scheduleResourceLocateVisible({ isVisible, onMoveEnd, requestFrame, onVisible }) {
  let active = true;
  let removeMoveEnd = null;
  let cancelFrame = null;
  const removeMovementListener = () => {
    removeMoveEnd?.();
    removeMoveEnd = null;
  };
  const afterPaint = () => {
    cancelFrame = requestFrame(() => {
      cancelFrame = null;
      if (!active) return;
      active = false;
      removeMovementListener();
      if (isVisible()) onVisible();
    });
  };
  if (isVisible()) afterPaint();
  else {
    removeMoveEnd = onMoveEnd(() => {
      removeMovementListener();
      if (!active) return;
      if (isVisible()) afterPaint();
      else active = false;
    });
  }
  return () => {
    active = false;
    removeMovementListener();
    cancelFrame?.();
    cancelFrame = null;
  };
}

export function resourceLayerStatus({ selectionKey, snapshotSelectionKey, available, status, pending, reason, visible, freshness }) {
  if (selectionKey && selectionKey !== snapshotSelectionKey) return "loading";
  if (status === "loading" || (status === "partial" && pending !== false)) return "loading";
  if (status == null && selectionKey && selectionKey === snapshotSelectionKey && available === false && reason === "Live resource positions are unavailable.") return "loading";
  if (available === false) return "unavailable";
  return visible ? (status ?? freshness) : "hidden";
}
