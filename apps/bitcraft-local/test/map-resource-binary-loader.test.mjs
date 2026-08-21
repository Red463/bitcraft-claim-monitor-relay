import assert from "node:assert/strict";
import test from "node:test";

import { encodeResourcePartition, packResourceCoordinate } from "../src/map/resourcePartitionCodec.mjs";
import { createMapResourceBinaryLoader } from "../src/pages/map/mapResourceBinaryLoader.mjs";

const bush = { key: "19|resource:2", regionId: "19", resourceId: "2" };
const ferns = { key: "19|resource:125", regionId: "19", resourceId: "125" };

function partition(regionId, resourceId) {
  return { key: `${regionId}|resource:${resourceId}`, regionId: String(regionId), resourceId: String(resourceId) };
}

function bytes(partition, generation, coordinate) {
  return encodeResourcePartition({
    regionId: partition.regionId,
    resourceId: partition.resourceId,
    dimension: "1",
    generation,
    coordinates: Uint32Array.of(coordinate),
  }).buffer;
}

function connections() {
  const opened = [];
  return {
    opened,
    connectEvents(url, onEvent, onError) {
      const connection = { url, onEvent, onError, closeCount: 0, close() { this.closeCount += 1; } };
      opened.push(connection);
      return connection;
    },
  };
}

async function drain(steps = 12) {
  for (let index = 0; index < steps; index += 1) await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function ready(entry, generation, url = `/${entry.resourceId}/${generation}`) {
  return { type: "partition-ready", key: entry.key, generation: String(generation), freshness: "live", url };
}

test("limits fetch, arrayBuffer, decode, validation, and publication to four active slots", async () => {
  const scope = [2, 3, 4, 5, 6].map((resourceId) => partition("19", resourceId));
  const events = connections();
  const bodies = new Map();
  const started = [];
  const loader = createMapResourceBinaryLoader({
    maxConcurrentLoads: 100,
    fetchBinary: async (url) => {
      started.push(url);
      const body = deferred();
      bodies.set(url, body);
      return { status: 200, arrayBuffer: () => body.promise };
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope(scope, "/events?scope=five");
  for (const entry of scope) events.opened[0].onEvent(ready(entry, "7"));
  await drain();

  assert.deepEqual(started, ["/2/7", "/3/7", "/4/7", "/5/7"]);
  bodies.get("/2/7").resolve(bytes(scope[0], "7", packResourceCoordinate(2, 7)));
  await drain();
  assert.deepEqual(started, ["/2/7", "/3/7", "/4/7", "/5/7", "/6/7"]);

  for (const entry of scope.slice(1)) {
    bodies.get(`/${entry.resourceId}/7`).resolve(bytes(entry, "7", packResourceCoordinate(Number(entry.resourceId), 7)));
  }
  await drain();
  assert.equal([...loader.state().values()].every((entry) => entry.generation === "7"), true);
  loader.stop();
});

test("caps an oversized cache entry option at eight decoded partitions", async () => {
  const scope = Array.from({ length: 9 }, (_, index) => partition("19", index + 2));
  const events = connections();
  const loader = createMapResourceBinaryLoader({
    cacheMaxEntries: 100,
    cacheMaxBytes: Number.MAX_SAFE_INTEGER,
    fetchBinary: async (url) => {
      const resourceId = url.slice(1);
      const entry = scope.find((candidate) => candidate.resourceId === resourceId);
      return bytes(entry, "7", packResourceCoordinate(Number(resourceId), 7));
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope(scope, "/events?scope=hard-entry-cap");
  for (const entry of scope) events.opened.at(-1).onEvent(ready(entry, "7", `/${entry.resourceId}`));
  await drain(24);
  assert.equal([...loader.state().values()].every((entry) => entry.generation === "7"), true);

  loader.setScope([], "/events?scope=hard-entry-empty");
  loader.setScope(scope, "/events?scope=hard-entry-reselected");
  assert.equal(loader.state().get(scope[0].key).generation, null);
  assert.equal(scope.slice(1).every((entry) => loader.state().get(entry.key).generation === "7"), true);
  loader.stop();
});

test("caps an oversized cache byte option at sixteen decoded MiB", async () => {
  const events = connections();
  const coordinates = new Uint32Array((16 * 1024 * 1024 / Uint32Array.BYTES_PER_ELEMENT) + 1);
  for (let index = 0; index < coordinates.length; index += 1) {
    coordinates[index] = packResourceCoordinate(index % 38_401, Math.floor(index / 38_401));
  }
  const encoded = encodeResourcePartition({
    regionId: bush.regionId,
    resourceId: bush.resourceId,
    dimension: "1",
    generation: "7",
    coordinates,
  }).buffer;
  const loader = createMapResourceBinaryLoader({
    cacheMaxBytes: Number.MAX_SAFE_INTEGER,
    fetchBinary: async () => encoded,
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=hard-byte-cap");
  events.opened.at(-1).onEvent(ready(bush, "7", "/oversized"));
  await drain();
  assert.equal(loader.state().get(bush.key).committed.byteLength, coordinates.byteLength);

  loader.setScope([], "/events?scope=hard-byte-empty");
  loader.setScope([bush], "/events?scope=hard-byte-reselected");
  assert.equal(loader.state().get(bush.key).generation, null);
  loader.stop();
});

test("coalesces duplicate queued work and replaces obsolete queued and active generations", async () => {
  const events = connections();
  const requests = [];
  const completions = new Map();
  const loader = createMapResourceBinaryLoader({
    maxConcurrentLoads: 1,
    fetchBinary: (url, signal) => {
      requests.push({ url, signal });
      const completion = deferred();
      completions.set(url, completion);
      return completion.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush, ferns], "/events?scope=queue");
  const stream = events.opened[0];
  stream.onEvent(ready(bush, "7", "/bush-7"));
  stream.onEvent(ready(ferns, "8", "/ferns-8"));
  stream.onEvent(ready(ferns, "8", "/ferns-8-duplicate"));
  stream.onEvent(ready(ferns, "9", "/ferns-9"));
  stream.onEvent(ready(bush, "8", "/bush-8"));
  stream.onEvent(ready(bush, "8", "/bush-8-duplicate"));
  await drain();

  assert.equal(requests[0].url, "/bush-7");
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests.length, 1);

  completions.get("/bush-7").resolve(bytes(bush, "7", packResourceCoordinate(7, 7)));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, null);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "/bush-8");

  completions.get("/bush-8").resolve(bytes(bush, "8", packResourceCoordinate(8, 8)));
  await drain();
  assert.equal(requests.length, 3);
  assert.equal(requests[2].url, "/ferns-9");
  completions.get("/ferns-9").resolve(bytes(ferns, "9", packResourceCoordinate(9, 9)));
  await drain();
  assert.equal(requests.length, 3);
  assert.equal(loader.state().get(ferns.key).generation, "9");
  assert.equal(loader.state().get(bush.key).generation, "8");
  loader.stop();
});

test("starts the newly prioritized scope entry before older pending work", async () => {
  const a1 = partition("19", "2");
  const a2 = partition("24", "2");
  const b = partition("19", "125");
  const events = connections();
  const requests = [];
  const completions = new Map();
  const loader = createMapResourceBinaryLoader({
    maxConcurrentLoads: 1,
    fetchBinary: (url) => {
      requests.push(url);
      const completion = deferred();
      completions.set(url, completion);
      return completion.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });

  loader.setScope([a1, a2], "/events?scope=a");
  events.opened.at(-1).onEvent(ready(a1, "7", "/a1"));
  events.opened.at(-1).onEvent(ready(a2, "7", "/a2"));
  await drain();
  assert.deepEqual(requests, ["/a1"]);

  loader.setScope([b, a1, a2], "/events?scope=b-first");
  events.opened.at(-1).onEvent(ready(b, "7", "/b"));
  completions.get("/a1").resolve(bytes(a1, "7", packResourceCoordinate(1, 1)));
  await drain();
  assert.deepEqual(requests, ["/a1", "/b"]);

  completions.get("/b").resolve(bytes(b, "7", packResourceCoordinate(2, 2)));
  await drain();
  assert.deepEqual(requests, ["/a1", "/b", "/a2"]);
  completions.get("/a2").resolve(bytes(a2, "7", packResourceCoordinate(3, 3)));
  await drain();
  loader.stop();
});

test("fetches independent ready partitions concurrently and coalesces duplicate generations", async () => {
  const events = connections();
  const requests = [];
  const changes = [];
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async (url, signal) => {
      requests.push({ url, signal });
      const parsed = new URL(url, "http://localhost");
      const partition = parsed.searchParams.get("resourceId") === "2" ? bush : ferns;
      return bytes(partition, parsed.searchParams.get("generation"), packResourceCoordinate(Number(partition.resourceId), 1));
    },
    connectEvents: events.connectEvents,
    onChange: (state) => changes.push(state),
    onError() {},
  });
  loader.setScope([bush, ferns], "/api/local/map/resource-events?regions=19&resourceIds=2%2C125");
  const stream = events.opened[0];
  stream.onEvent({ type: "partition-ready", key: bush.key, generation: "7", pointCount: 1, encodedBytes: 48, freshness: "live", url: "/api/local/map/resource-partition?regionId=19&resourceId=2&generation=7" });
  stream.onEvent({ type: "partition-ready", key: ferns.key, generation: "8", pointCount: 1, encodedBytes: 48, freshness: "live", url: "/api/local/map/resource-partition?regionId=19&resourceId=125&generation=8" });
  stream.onEvent({ type: "partition-ready", key: bush.key, generation: "7", pointCount: 1, encodedBytes: 48, freshness: "live", url: "/duplicate" });
  await drain();

  assert.equal(requests.length, 2);
  const state = changes.at(-1);
  assert.equal(state.get(bush.key).generation, "7");
  assert.equal(state.get(ferns.key).generation, "8");
  assert.deepEqual([...state.get(bush.key).committed], [packResourceCoordinate(2, 1)]);
  loader.stop();
});

test("rejects a response identity mismatch without clearing another committed partition", async () => {
  const events = connections();
  const errors = [];
  const changes = [];
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async (url) => url.includes("resourceId=2")
      ? bytes(bush, "7", packResourceCoordinate(1, 1))
      : bytes(bush, "8", packResourceCoordinate(2, 2)),
    connectEvents: events.connectEvents,
    onChange: (state) => changes.push(state),
    onError: (message) => errors.push(message),
  });
  loader.setScope([bush, ferns], "/events");
  events.opened[0].onEvent({ type: "partition-ready", key: bush.key, generation: "7", freshness: "live", url: "/partition?resourceId=2" });
  await drain();
  events.opened[0].onEvent({ type: "partition-ready", key: ferns.key, generation: "8", freshness: "live", url: "/partition?resourceId=125" });
  await drain();

  const state = changes.at(-1);
  assert.equal(state.get(bush.key).generation, "7");
  assert.equal(state.get(ferns.key).status, "unavailable");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].includes("19"), false);
  loader.stop();
});

test("recovers one expired generation through the canonical latest URL", async () => {
  const events = connections();
  const requests = [];
  const changes = [];
  const loader = createMapResourceBinaryLoader({
    maxConcurrentLoads: 1,
    fetchBinary: async (url) => {
      requests.push(url);
      if (requests.length === 1) return { status: 409, json: { currentGeneration: "8", url: "/latest" } };
      if (url === "/latest") return bytes(bush, "8", packResourceCoordinate(8, 8));
      return bytes(ferns, "9", packResourceCoordinate(9, 9));
    },
    connectEvents: events.connectEvents,
    onChange: (state) => changes.push(state),
    onError() {},
  });
  loader.setScope([bush, ferns], "/events");
  events.opened[0].onEvent({ type: "partition-ready", key: bush.key, generation: "7", freshness: "live", url: "/expired" });
  events.opened[0].onEvent({ type: "partition-ready", key: ferns.key, generation: "9", freshness: "live", url: "/queued" });
  await drain();

  assert.deepEqual(requests, ["/expired", "/latest", "/queued"]);
  assert.equal(changes.at(-1).get(bush.key).generation, "8");
  loader.stop();
});

test("awaits a Response-style 409 body inside the active slot", async () => {
  const events = connections();
  const recovery = deferred();
  const requests = [];
  let jsonCalls = 0;
  const loader = createMapResourceBinaryLoader({
    maxConcurrentLoads: 1,
    fetchBinary: async (url) => {
      requests.push(url);
      if (url === "/expired-response") {
        return {
          status: 409,
          async json() {
            jsonCalls += 1;
            return recovery.promise;
          },
        };
      }
      if (url === "/latest-response") return bytes(bush, "8", packResourceCoordinate(8, 8));
      return bytes(ferns, "9", packResourceCoordinate(9, 9));
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush, ferns], "/events?scope=response-409");
  events.opened.at(-1).onEvent(ready(bush, "7", "/expired-response"));
  events.opened.at(-1).onEvent(ready(ferns, "9", "/queued-response"));
  await drain();

  assert.equal(jsonCalls, 1);
  assert.deepEqual(requests, ["/expired-response"]);
  recovery.resolve({ currentGeneration: "8", url: "/latest-response" });
  await drain();
  assert.deepEqual(requests, ["/expired-response", "/latest-response", "/queued-response"]);
  assert.equal(loader.state().get(bush.key).generation, "8");
  loader.stop();
});

test("commits a cold stale-ready generation as stale and excludes it from the decoded cache", async () => {
  const events = connections();
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async () => bytes(bush, "7", packResourceCoordinate(7, 7)),
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=cold-stale");
  events.opened.at(-1).onEvent({
    ...ready(bush, "7", "/cold-stale"),
    freshness: "stale",
    warning: "Serving the last complete generation",
  });
  await drain();

  const committed = loader.state().get(bush.key);
  assert.equal(committed.generation, "7");
  assert.equal(committed.freshness, "stale");
  assert.equal(committed.status, "stale");
  assert.equal(committed.warning, "Serving the last complete generation");
  loader.setScope([], "/events?scope=cold-stale-empty");
  loader.setScope([bush], "/events?scope=cold-stale-reselected");
  assert.equal(loader.state().get(bush.key).generation, null);
  loader.stop();
});

test("keeps stale last-good metadata while a newer live generation fetches and does not cache the old bytes", async () => {
  const events = connections();
  const generationEight = [deferred(), deferred()];
  let generationEightCalls = 0;
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async (url) => {
      if (url === "/generation-7-stale") return bytes(bush, "7", packResourceCoordinate(7, 7));
      const completion = generationEight[generationEightCalls];
      generationEightCalls += 1;
      return completion.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=stale-old-generation");
  let stream = events.opened.at(-1);
  stream.onEvent({
    ...ready(bush, "7", "/generation-7-stale"),
    freshness: "stale",
    warning: "Generation 7 is last-good",
  });
  await drain();
  stream.onEvent(ready(bush, "8", "/generation-8-live"));
  await drain();

  let current = loader.state().get(bush.key);
  assert.equal(current.generation, "7");
  assert.equal(current.freshness, "stale");
  assert.equal(current.status, "stale");
  assert.equal(current.warning, "Generation 7 is last-good");
  assert.equal(generationEightCalls, 1);

  loader.setScope([], "/events?scope=stale-old-empty");
  loader.setScope([bush], "/events?scope=stale-old-reselected");
  assert.equal(loader.state().get(bush.key).generation, null);
  stream = events.opened.at(-1);
  stream.onEvent(ready(bush, "8", "/generation-8-live"));
  await drain();
  assert.equal(generationEightCalls, 1);

  generationEight[0].resolve(bytes(bush, "8", packResourceCoordinate(8, 8)));
  await drain();
  assert.equal(generationEightCalls, 2);
  assert.equal(loader.state().get(bush.key).generation, null);
  generationEight[1].resolve(bytes(bush, "8", packResourceCoordinate(8, 8)));
  await drain();

  current = loader.state().get(bush.key);
  assert.equal(current.generation, "8");
  assert.equal(current.freshness, "live");
  assert.equal(current.status, "live");
  assert.equal(current.warning, null);
  loader.stop();
});

test("keeps stale and unavailable events authoritative when an active fetch completes", async () => {
  for (const type of ["partition-stale", "partition-unavailable"]) {
    const events = connections();
    const completion = deferred();
    const loader = createMapResourceBinaryLoader({
      fetchBinary: async () => completion.promise,
      connectEvents: events.connectEvents,
      onError() {},
    });
    loader.setScope([bush], `/events?scope=${type}`);
    const stream = events.opened.at(-1);
    stream.onEvent(ready(bush, "7", `/${type}`));
    await drain();
    stream.onEvent({ type, key: bush.key, warning: `${type} warning` });
    completion.resolve(bytes(bush, "7", packResourceCoordinate(7, 7)));
    await drain();

    const committed = loader.state().get(bush.key);
    assert.equal(committed.generation, "7");
    assert.equal(committed.freshness, "stale");
    assert.equal(committed.status, "stale");
    assert.equal(committed.warning, `${type} warning`);
    loader.setScope([], `/events?scope=${type}-empty`);
    loader.setScope([bush], `/events?scope=${type}-reselected`);
    assert.equal(loader.state().get(bush.key).generation, null);
    loader.stop();
  }
});

test("does not roll back a newer committed delta when an older active fetch completes", async () => {
  const events = connections();
  const generationEight = deferred();
  const coordinateSeven = packResourceCoordinate(7, 7);
  const coordinateNine = packResourceCoordinate(9, 9);
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async (url) => url === "/generation-7"
      ? bytes(bush, "7", coordinateSeven)
      : generationEight.promise,
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=fetch-delta-race");
  const stream = events.opened.at(-1);
  stream.onEvent(ready(bush, "7", "/generation-7"));
  await drain();
  stream.onEvent(ready(bush, "8", "/generation-8"));
  await drain();
  stream.onEvent({
    type: "partition-delta",
    key: bush.key,
    baseGeneration: "7",
    generation: "9",
    additions: [coordinateNine],
    removals: [coordinateSeven],
  });
  assert.equal(loader.state().get(bush.key).generation, "9");

  generationEight.resolve(bytes(bush, "8", packResourceCoordinate(8, 8)));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "9");
  assert.deepEqual([...loader.state().get(bush.key).committed], [coordinateNine]);
  loader.stop();
});

test("ignores event and error callbacks from a closed connection when the partition remains selected", async () => {
  const events = connections();
  const requests = [];
  const errors = [];
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async (url) => {
      requests.push(url);
      const generation = url.split("-").at(-1);
      return bytes(bush, generation, packResourceCoordinate(Number(generation), 1));
    },
    connectEvents: events.connectEvents,
    onError: (message) => errors.push(message),
  });
  loader.setScope([bush], "/events?connection=old");
  const oldConnection = events.opened.at(-1);
  loader.setScope([bush], "/events?connection=new");
  const newConnection = events.opened.at(-1);
  assert.equal(oldConnection.closeCount, 1);

  oldConnection.onEvent(ready(bush, "99", "/generation-99"));
  oldConnection.onError(new Error("old connection"));
  await drain();
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  assert.equal(loader.state().get(bush.key).generation, null);

  newConnection.onEvent(ready(bush, "7", "/generation-7"));
  await drain();
  assert.deepEqual(requests, ["/generation-7"]);
  assert.equal(loader.state().get(bush.key).generation, "7");
  loader.stop();
});

test("pause prunes queued work, aborts active work, and rejects late publication", async () => {
  const events = connections();
  const active = deferred();
  const requests = [];
  const loader = createMapResourceBinaryLoader({
    maxConcurrentLoads: 1,
    fetchBinary: (url, signal) => {
      requests.push({ url, signal });
      return active.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush, ferns], "/events?scope=pause");
  events.opened[0].onEvent(ready(bush, "7", "/active"));
  events.opened[0].onEvent(ready(ferns, "8", "/queued"));
  await drain();
  loader.pause();
  assert.equal(requests[0].signal.aborted, true);
  active.resolve(bytes(bush, "7", packResourceCoordinate(7, 7)));
  await drain();
  assert.deepEqual(requests.map((request) => request.url), ["/active"]);
  assert.equal(loader.state().get(bush.key).generation, null);
  loader.stop();
});

test("scope removal and stop prune queued work, abort active work, and reject late publication", async () => {
  for (const action of ["remove", "stop"]) {
    const events = connections();
    const active = deferred();
    const requests = [];
    const loader = createMapResourceBinaryLoader({
      maxConcurrentLoads: 1,
      fetchBinary: (url, signal) => {
        requests.push({ url, signal });
        return active.promise;
      },
      connectEvents: events.connectEvents,
      onError() {},
    });
    loader.setScope([bush, ferns], `/events?scope=${action}`);
    events.opened[0].onEvent(ready(bush, "7", "/active"));
    events.opened[0].onEvent(ready(ferns, "8", "/queued"));
    await drain();
    if (action === "remove") loader.setScope([], "/events?scope=removed");
    else loader.stop();
    assert.equal(requests[0].signal.aborted, true);
    active.resolve(bytes(bush, "7", packResourceCoordinate(7, 7)));
    await drain();
    assert.deepEqual(requests.map((request) => request.url), ["/active"]);
    assert.equal(loader.state().get(bush.key)?.generation ?? null, null);
    loader.stop();
  }
});

test("hydrates a fresh deselected partition before SSE and confirms an exact generation without fetching", async () => {
  const events = connections();
  const requests = [];
  let loader;
  let stateAtConnect;
  loader = createMapResourceBinaryLoader({
    fetchBinary: async (url) => {
      requests.push(url);
      const generation = new URL(url, "http://localhost").searchParams.get("generation") ?? url.split("-").at(-1);
      return bytes(bush, generation, packResourceCoordinate(Number(generation), 1));
    },
    connectEvents(url, onEvent, onError) {
      stateAtConnect = loader.state().get(bush.key);
      return events.connectEvents(url, onEvent, onError);
    },
    onError() {},
  });
  loader.setScope([bush], "/events?scope=cold");
  events.opened.at(-1).onEvent(ready(bush, "7", "/partition?generation=7"));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "7");

  loader.setScope([], "/events?scope=empty");
  loader.setScope([bush], "/events?scope=warm");
  assert.equal(stateAtConnect.generation, "7");
  assert.equal(stateAtConnect.freshness, "awaiting-confirmation");
  assert.equal(requests.length, 1);
  events.opened.at(-1).onEvent(ready(bush, "7", "/unchanged"));
  await drain();
  assert.equal(loader.state().get(bush.key).freshness, "live");
  assert.equal(requests.length, 1);

  loader.setScope([], "/events?scope=empty-again");
  loader.setScope([bush], "/events?scope=changed");
  events.opened.at(-1).onEvent(ready(bush, "8", "/partition?generation=8"));
  await drain();
  assert.equal(requests.length, 2);
  assert.equal(loader.state().get(bush.key).generation, "8");
  loader.stop();
});

test("fetches and commits an authoritative lower generation after warm-cache hydration", async () => {
  const events = connections();
  const generationNine = deferred();
  const requests = [];
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async (url) => {
      requests.push(url);
      if (url === "/generation-10") return bytes(bush, "10", packResourceCoordinate(10, 10));
      return generationNine.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=generation-reset-cold");
  events.opened.at(-1).onEvent(ready(bush, "10", "/generation-10"));
  await drain();
  loader.setScope([], "/events?scope=generation-reset-empty");
  loader.setScope([bush], "/events?scope=generation-reset-warm");
  assert.equal(loader.state().get(bush.key).generation, "10");
  assert.equal(loader.state().get(bush.key).freshness, "awaiting-confirmation");

  events.opened.at(-1).onEvent(ready(bush, "9", "/generation-9"));
  await drain();
  assert.deepEqual(requests, ["/generation-10", "/generation-9"]);
  assert.equal(loader.state().get(bush.key).generation, "10");
  assert.equal(loader.state().get(bush.key).freshness, "awaiting-confirmation");

  generationNine.resolve(bytes(bush, "9", packResourceCoordinate(9, 9)));
  await drain();
  assert.deepEqual(requests, ["/generation-10", "/generation-9"]);
  assert.equal(loader.state().get(bush.key).generation, "9");
  assert.equal(loader.state().get(bush.key).freshness, "live");
  assert.deepEqual([...loader.state().get(bush.key).committed], [packResourceCoordinate(9, 9)]);
  loader.stop();
});

test("accepts an authoritative lower generation after a restarted active stream", async () => {
  const events = connections();
  const generationOne = deferred();
  const requests = [];
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async (url) => {
      requests.push(url);
      if (url === "/generation-10") return bytes(bush, "10", packResourceCoordinate(10, 10));
      return generationOne.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=active-generation-reset");
  const stream = events.opened.at(-1);
  stream.onEvent(ready(bush, "10", "/generation-10"));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "10");

  stream.onEvent({ type: "stream-ready" });
  assert.equal(loader.state().get(bush.key).freshness, "awaiting-confirmation");
  stream.onEvent(ready(bush, "1", "/generation-1"));
  await drain();
  assert.deepEqual(requests, ["/generation-10", "/generation-1"]);
  assert.equal(loader.state().get(bush.key).generation, "10", "old committed bytes remain while the reset fetch is pending");

  generationOne.resolve(bytes(bush, "1", packResourceCoordinate(1, 1)));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "1");
  assert.equal(loader.state().get(bush.key).freshness, "live");
  assert.deepEqual([...loader.state().get(bush.key).committed], [packResourceCoordinate(1, 1)]);
  loader.stop();
});

test("authoritative stream reset supersedes an active old-stream generation", async () => {
  const events = connections();
  const requests = [];
  const signals = new Map();
  const completions = new Map();
  const loader = createMapResourceBinaryLoader({
    maxConcurrentLoads: 1,
    fetchBinary: async (url, signal) => {
      requests.push(url);
      signals.set(url, signal);
      if (url === "/generation-10") return bytes(bush, "10", packResourceCoordinate(10, 10));
      const completion = deferred();
      completions.set(url, completion);
      return completion.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=active-old-stream");
  const stream = events.opened.at(-1);
  stream.onEvent(ready(bush, "10", "/generation-10"));
  await drain();
  stream.onEvent(ready(bush, "11", "/generation-11"));
  await drain();

  stream.onEvent({ type: "stream-ready" });
  stream.onEvent(ready(bush, "1", "/generation-1"));
  await drain();
  assert.equal(signals.get("/generation-11").aborted, true, "authoritative lower work aborts the old-stream request");

  completions.get("/generation-11").resolve(bytes(bush, "11", packResourceCoordinate(11, 11)));
  await drain();
  assert.deepEqual(requests, ["/generation-10", "/generation-11", "/generation-1"]);
  assert.equal(loader.state().get(bush.key).generation, "10", "late old-stream bytes cannot publish");

  completions.get("/generation-1").resolve(bytes(bush, "1", packResourceCoordinate(1, 1)));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "1");
  loader.stop();
});

test("authoritative stream reset replaces queued old-stream generation", async () => {
  const events = connections();
  const requests = [];
  const completions = new Map();
  const loader = createMapResourceBinaryLoader({
    maxConcurrentLoads: 1,
    fetchBinary: async (url) => {
      requests.push(url);
      if (url === "/generation-10") return bytes(bush, "10", packResourceCoordinate(10, 10));
      const completion = deferred();
      completions.set(url, completion);
      return completion.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=queued-old-stream");
  const stream = events.opened.at(-1);
  stream.onEvent(ready(bush, "10", "/generation-10"));
  await drain();
  stream.onEvent(ready(bush, "11", "/generation-11"));
  stream.onEvent(ready(bush, "12", "/generation-12"));
  await drain();

  stream.onEvent({ type: "stream-ready" });
  stream.onEvent(ready(bush, "1", "/generation-1"));
  completions.get("/generation-11").resolve(bytes(bush, "11", packResourceCoordinate(11, 11)));
  await drain();
  assert.deepEqual(requests, ["/generation-10", "/generation-11", "/generation-1"], "authoritative lower work replaces the queued higher generation");
  assert.equal(loader.state().get(bush.key).generation, "10", "late old-stream bytes cannot publish");

  completions.get("/generation-1").resolve(bytes(bush, "1", packResourceCoordinate(1, 1)));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "1");
  loader.stop();
});

test("stream-ready invalidates old-stream work before exact confirmation", async () => {
  const events = connections();
  const requests = [];
  const signals = new Map();
  const completions = new Map();
  const loader = createMapResourceBinaryLoader({
    maxConcurrentLoads: 1,
    fetchBinary: async (url, signal) => {
      requests.push(url);
      signals.set(url, signal);
      if (url === "/bush-10") return bytes(bush, "10", packResourceCoordinate(10, 10));
      if (url === "/ferns-10") return bytes(ferns, "10", packResourceCoordinate(10, 10));
      const completion = deferred();
      completions.set(url, completion);
      return completion.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush, ferns], "/events?scope=stream-boundary");
  const stream = events.opened.at(-1);
  stream.onEvent(ready(bush, "10", "/bush-10"));
  await drain();
  stream.onEvent(ready(ferns, "10", "/ferns-10"));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "10");
  assert.equal(loader.state().get(ferns.key).generation, "10");

  stream.onEvent(ready(bush, "11", "/bush-11"));
  stream.onEvent(ready(ferns, "11", "/ferns-11"));
  await drain();
  assert.deepEqual(requests, ["/bush-10", "/ferns-10", "/bush-11"]);

  stream.onEvent({ type: "stream-ready" });
  stream.onEvent(ready(bush, "10", "/bush-10-confirmation"));
  stream.onEvent(ready(ferns, "10", "/ferns-10-confirmation"));
  await drain();
  assert.equal(loader.state().get(bush.key).freshness, "live");
  assert.equal(loader.state().get(ferns.key).freshness, "live");

  completions.get("/bush-11").resolve(bytes(bush, "11", packResourceCoordinate(11, 11)));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "10", "late old-stream bytes cannot publish after exact confirmation");
  assert.equal(loader.state().get(ferns.key).generation, "10");
  assert.equal(signals.get("/bush-11").aborted, true);
  assert.deepEqual(requests, ["/bush-10", "/ferns-10", "/bush-11"], "old pending work is discarded at the stream boundary");

  stream.onEvent(ready(bush, "12", "/bush-12"));
  await drain();
  assert.deepEqual(requests, ["/bush-10", "/ferns-10", "/bush-11", "/bush-12"]);
  completions.get("/bush-12").resolve(bytes(bush, "12", packResourceCoordinate(12, 12)));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "12");
  assert.equal(loader.state().get(bush.key).freshness, "live");
  loader.stop();
});

test("keeps ordinary generation fencing and restores it after exact stream confirmation", async () => {
  const events = connections();
  const requests = [];
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async (url) => {
      requests.push(url);
      return bytes(bush, "10", packResourceCoordinate(10, 10));
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=active-generation-fence");
  const stream = events.opened.at(-1);
  stream.onEvent(ready(bush, "10", "/generation-10"));
  await drain();

  stream.onEvent(ready(bush, "9", "/generation-9"));
  await drain();
  assert.deepEqual(requests, ["/generation-10"], "an existing stream cannot roll back a confirmed partition");

  stream.onEvent({ type: "stream-ready" });
  assert.equal(loader.state().get(bush.key).freshness, "awaiting-confirmation");
  stream.onEvent(ready(bush, "10", "/unchanged"));
  await drain();
  assert.equal(loader.state().get(bush.key).freshness, "live");
  assert.deepEqual(requests, ["/generation-10"], "an exact stream confirmation does not refetch");

  stream.onEvent(ready(bush, "8", "/generation-8"));
  await drain();
  assert.deepEqual(requests, ["/generation-10"], "exact confirmation restores the lower-generation fence");
  assert.equal(loader.state().get(bush.key).generation, "10");
  loader.stop();
});

test("does not cache provisional, stale, unavailable, or oversized partitions", async () => {
  const scope = [bush, ferns, partition("19", "126"), partition("19", "127")];
  const [freshThenStale, unavailable, provisional, oversized] = scope;
  const events = connections();
  const loader = createMapResourceBinaryLoader({
    cacheMaxBytes: 8,
    fetchBinary: async (url) => {
      if (url === "/stale") return bytes(freshThenStale, "7", packResourceCoordinate(7, 7));
      if (url === "/oversized") {
        return encodeResourcePartition({
          regionId: oversized.regionId,
          resourceId: oversized.resourceId,
          dimension: "1",
          generation: "8",
          coordinates: Uint32Array.of(1, 2, 3),
        }).buffer;
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope(scope, "/events?scope=uncacheable");
  const stream = events.opened.at(-1);
  stream.onEvent(ready(freshThenStale, "7", "/stale"));
  stream.onEvent({ type: "partition-unavailable", key: unavailable.key, warning: "Unavailable" });
  stream.onEvent({ type: "partition-provisional", key: provisional.key, additions: [packResourceCoordinate(1, 1)] });
  stream.onEvent(ready(oversized, "8", "/oversized"));
  await drain();
  stream.onEvent({ type: "partition-stale", key: freshThenStale.key, warning: "Stale" });
  loader.setScope([], "/events?scope=empty");
  loader.setScope(scope, "/events?scope=reselected");

  for (const entry of scope) assert.equal(loader.state().get(entry.key).generation, null);
  loader.stop();
});

test("evicts decoded cache entries deterministically by insertion order and entry count", async () => {
  const entries = [2, 3, 4].map((resourceId) => partition("19", resourceId));
  const events = connections();
  const loader = createMapResourceBinaryLoader({
    cacheMaxEntries: 2,
    cacheMaxBytes: 100,
    fetchBinary: async (url) => {
      const resourceId = url.slice(1);
      const entry = entries.find((candidate) => candidate.resourceId === resourceId);
      return bytes(entry, "7", packResourceCoordinate(Number(resourceId), 7));
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope(entries, "/events?scope=eviction");
  for (const entry of entries) events.opened.at(-1).onEvent(ready(entry, "7", `/${entry.resourceId}`));
  await drain();
  loader.setScope([], "/events?scope=empty");
  loader.setScope(entries, "/events?scope=reselected");

  assert.equal(loader.state().get(entries[0].key).generation, null);
  assert.equal(loader.state().get(entries[1].key).generation, "7");
  assert.equal(loader.state().get(entries[2].key).generation, "7");
  loader.stop();
});

test("accounts for decoded coordinate bytes and evicts the least-recently inserted entry", async () => {
  const events = connections();
  const loader = createMapResourceBinaryLoader({
    cacheMaxEntries: 8,
    cacheMaxBytes: 8,
    fetchBinary: async (url) => encodeResourcePartition({
      regionId: "19",
      resourceId: url === "/bush" ? "2" : "125",
      dimension: "1",
      generation: "7",
      coordinates: url === "/bush"
        ? Uint32Array.of(packResourceCoordinate(2, 7))
        : Uint32Array.of(packResourceCoordinate(125, 7), packResourceCoordinate(125, 8)),
    }).buffer,
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush, ferns], "/events?scope=byte-eviction");
  events.opened.at(-1).onEvent(ready(bush, "7", "/bush"));
  events.opened.at(-1).onEvent(ready(ferns, "7", "/ferns"));
  await drain();
  loader.setScope([], "/events?scope=byte-empty");
  loader.setScope([bush, ferns], "/events?scope=byte-reselected");

  assert.equal(loader.state().get(bush.key).generation, null);
  assert.equal(loader.state().get(ferns.key).generation, "7");
  loader.stop();
});

test("refreshes LRU recency when a cached partition is selected and committed again", async () => {
  const entries = [bush, ferns, partition("19", "126")];
  const events = connections();
  const loader = createMapResourceBinaryLoader({
    cacheMaxEntries: 2,
    fetchBinary: async (url) => {
      const resourceId = url.slice(1);
      const entry = entries.find((candidate) => candidate.resourceId === resourceId);
      return bytes(entry, "7", packResourceCoordinate(Number(resourceId), 7));
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope(entries.slice(0, 2), "/events?scope=lru-initial");
  for (const entry of entries.slice(0, 2)) events.opened.at(-1).onEvent(ready(entry, "7", `/${entry.resourceId}`));
  await drain();
  loader.setScope([], "/events?scope=lru-empty");

  loader.setScope([bush], "/events?scope=lru-touch");
  events.opened.at(-1).onEvent(ready(bush, "7", "/unchanged"));
  loader.setScope([], "/events?scope=lru-retain");
  loader.setScope([entries[2]], "/events?scope=lru-new");
  events.opened.at(-1).onEvent(ready(entries[2], "7", "/126"));
  await drain();
  loader.setScope([], "/events?scope=lru-final-empty");
  loader.setScope(entries, "/events?scope=lru-final");

  assert.equal(loader.state().get(bush.key).generation, "7");
  assert.equal(loader.state().get(ferns.key).generation, null);
  assert.equal(loader.state().get(entries[2].key).generation, "7");
  loader.stop();
});

test("does not apply a delta to an unconfirmed cached base", async () => {
  const events = connections();
  const requests = [];
  const pending = deferred();
  const loader = createMapResourceBinaryLoader({
    fetchBinary: async (url) => {
      requests.push(url);
      if (requests.length === 1) return bytes(bush, "7", packResourceCoordinate(7, 7));
      return pending.promise;
    },
    connectEvents: events.connectEvents,
    onError() {},
  });
  loader.setScope([bush], "/events?scope=cold-delta");
  events.opened.at(-1).onEvent(ready(bush, "7", "/generation-7"));
  await drain();
  loader.setScope([], "/events?scope=empty-delta");
  loader.setScope([bush], "/events?scope=warm-delta");
  events.opened.at(-1).onEvent({
    type: "partition-delta",
    key: bush.key,
    baseGeneration: "7",
    generation: "8",
    additions: [packResourceCoordinate(8, 8)],
    removals: [],
  });
  await drain();

  assert.equal(requests.length, 2);
  assert.match(requests[1], /generation=8/);
  assert.equal(loader.state().get(bush.key).generation, "7");
  pending.resolve(bytes(bush, "8", packResourceCoordinate(8, 8)));
  await drain();
  assert.equal(loader.state().get(bush.key).generation, "8");
  loader.stop();
});

test("pause, resume, scope removal, and stop clean up each owned resource once", async () => {
  const events = connections();
  const signals = [];
  const changes = [];
  const loader = createMapResourceBinaryLoader({
    fetchBinary: (_url, signal) => {
      signals.push(signal);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    },
    connectEvents: events.connectEvents,
    onChange: (state) => changes.push(state),
    onError() {},
  });
  loader.setScope([bush, ferns], "/events");
  events.opened[0].onEvent({ type: "partition-ready", key: bush.key, generation: "7", freshness: "live", url: "/bush" });
  events.opened[0].onEvent({ type: "partition-ready", key: ferns.key, generation: "8", freshness: "live", url: "/ferns" });
  await drain();
  loader.pause();
  assert.equal(events.opened[0].closeCount, 1);
  assert.equal(signals.every((signal) => signal.aborted), true);

  loader.resume();
  assert.match(events.opened[1].url, /generations=/);
  loader.setScope([ferns], "/events");
  assert.deepEqual([...changes.at(-1).keys()], [ferns.key]);
  loader.stop();
  loader.stop();
  assert.equal(events.opened.at(-1).closeCount, 1);
});
