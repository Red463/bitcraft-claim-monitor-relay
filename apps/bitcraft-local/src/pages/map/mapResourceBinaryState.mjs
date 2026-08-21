import {
  mergePackedCoordinateDelta,
  normalizePackedCoordinates,
} from "../../map/resourcePartitionCodec.mjs";

function partition(input) {
  return {
    key: String(input.key),
    regionId: String(input.regionId),
    resourceId: String(input.resourceId),
    generation: null,
    committed: new Uint32Array(),
    provisional: new Uint32Array(),
    pointCount: 0,
    freshness: "loading",
    status: "loading",
    warning: null,
  };
}

function replace(state, key, next) {
  const output = new Map(state);
  output.set(key, next);
  return output;
}

function isOlderDecimalGeneration(candidate, committed) {
  return /^\d+$/.test(candidate) && /^\d+$/.test(committed) && BigInt(candidate) < BigInt(committed);
}

export function createMapResourceBinaryState(scope = []) {
  return new Map(scope.map((input) => [String(input.key), partition(input)]));
}

export function reconcileMapResourceBinaryScope(state, scope = []) {
  const wanted = new Map(scope.map((input) => [String(input.key), input]));
  let changed = state.size !== wanted.size;
  const output = new Map();
  for (const [key, input] of wanted) {
    const current = state.get(key);
    if (current && current.regionId === String(input.regionId) && current.resourceId === String(input.resourceId)) {
      output.set(key, current);
    } else {
      output.set(key, partition(input));
      changed = true;
    }
  }
  if (!changed) {
    let index = 0;
    for (const key of state.keys()) {
      if ([...wanted.keys()][index] !== key) { changed = true; break; }
      index += 1;
    }
  }
  return changed ? output : state;
}

export function applyMapResourceBinaryCommitted(state, key, decoded, metadata = {}) {
  const current = state.get(key);
  if (!current) return state;
  if (decoded.regionId !== current.regionId || decoded.resourceId !== current.resourceId || decoded.dimension !== "1") {
    throw new TypeError("Decoded resource partition scope does not match its selection");
  }
  if (!(decoded.coordinates instanceof Uint32Array) || decoded.pointCount !== decoded.coordinates.length) {
    throw new TypeError("Decoded resource partition coordinates are invalid");
  }
  return replace(state, key, {
    ...current,
    generation: decoded.generation,
    committed: decoded.coordinates,
    provisional: new Uint32Array(),
    pointCount: decoded.pointCount,
    freshness: String(metadata.freshness ?? "live"),
    status: metadata.freshness === "stale" ? "stale" : "live",
    warning: metadata.warning == null ? null : String(metadata.warning),
  });
}

export function applyMapResourceBinaryEvent(state, event) {
  const key = String(event?.key ?? "");
  const current = state.get(key);
  if (!current) return { partitions: state, requiresFetch: false };
  if (event.type === "partition-ready") {
    const generation = String(event.generation);
    if (current.generation != null && isOlderDecimalGeneration(generation, current.generation)) {
      return { partitions: state, requiresFetch: false };
    }
    const freshness = String(event.freshness ?? current.freshness);
    return {
      partitions: replace(state, key, {
        ...current,
        freshness,
        status: current.generation == null ? "loading" : freshness === "stale" ? "stale" : "live",
        warning: event.warning == null ? null : String(event.warning),
      }),
      requiresFetch: current.generation !== generation,
    };
  }
  if (event.type === "partition-loading") {
    return {
      partitions: replace(state, key, {
        ...current,
        status: current.generation == null ? "loading" : current.status,
      }),
      requiresFetch: false,
    };
  }
  if (event.type === "partition-provisional") {
    if (current.generation != null) return { partitions: state, requiresFetch: false };
    const additions = normalizePackedCoordinates(event.additions ?? []);
    const provisional = mergePackedCoordinateDelta(current.provisional, additions, new Uint32Array());
    return {
      partitions: replace(state, key, {
        ...current,
        provisional,
        pointCount: provisional.length,
        status: "loading",
      }),
      requiresFetch: false,
    };
  }
  if (event.type === "partition-delta") {
    if (current.generation !== String(event.baseGeneration)) {
      return { partitions: state, requiresFetch: true };
    }
    const additions = normalizePackedCoordinates(event.additions ?? []);
    const removals = normalizePackedCoordinates(event.removals ?? []);
    const committed = mergePackedCoordinateDelta(current.committed, additions, removals);
    return {
      partitions: replace(state, key, {
        ...current,
        generation: String(event.generation),
        committed,
        provisional: new Uint32Array(),
        pointCount: committed.length,
        freshness: "live",
        status: "live",
        warning: null,
      }),
      requiresFetch: false,
    };
  }
  if (event.type === "partition-stale") {
    return {
      partitions: replace(state, key, {
        ...current,
        freshness: "stale",
        status: current.generation == null ? "unavailable" : "stale",
        warning: String(event.warning ?? "Resource partition is stale"),
      }),
      requiresFetch: false,
    };
  }
  if (event.type === "partition-unavailable") {
    return {
      partitions: replace(state, key, {
        ...current,
        freshness: current.generation == null ? "unavailable" : "stale",
        status: current.generation == null ? "unavailable" : "stale",
        warning: String(event.warning ?? "Resource partition is unavailable"),
      }),
      requiresFetch: false,
    };
  }
  return { partitions: state, requiresFetch: false };
}
