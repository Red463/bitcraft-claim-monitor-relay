import test from "node:test";
import assert from "node:assert/strict";

import {
  applyResourceLocate,
  newlyAddedResourceIds,
  resourceLayerStatus,
  resourceLocatePoint,
  scheduleResourceLocateVisible,
} from "../src/pages/map/resourceViewport.mjs";

const packed = (x, z) => ((z << 16) | x) >>> 0;
const partition = ({ key, regionId, resourceId, committed = [], provisional = [], generation = "1", status = "live" }) => ({
  key,
  regionId,
  resourceId,
  generation,
  committed: Uint32Array.from(committed),
  provisional: Uint32Array.from(provisional),
  pointCount: committed.length + provisional.length,
  freshness: status,
  status,
  warning: null,
});

test("only newly added resources create locate activations", () => {
  assert.deepEqual(newlyAddedResourceIds(["28"], ["28", "54"]), ["54"]);
  assert.deepEqual(newlyAddedResourceIds(["28", "54"], ["28"]), [], "removal does not activate");
  assert.deepEqual(newlyAddedResourceIds(["28"], ["28", "54"]), ["54"], "re-adding creates a new activation");
});

test("existing resource points cannot consume a different resource activation", () => {
  const partitions = new Map([
    ["19|resource:28", partition({ key: "19|resource:28", regionId: "19", resourceId: "28", committed: [packed(10, 20)] })],
    ["19|resource:54", partition({ key: "19|resource:54", regionId: "19", resourceId: "54", committed: [], status: "loading" })],
  ]);
  assert.equal(resourceLocatePoint({ resourceId: "54", partitions, preferredRegionId: "19", centre: { x: 0, z: 0 } }), null);
});

test("matching committed or provisional points are eligible while unrelated partitions load", () => {
  const committed = new Map([
    ["19|resource:28", partition({ key: "19|resource:28", regionId: "19", resourceId: "28", committed: [packed(10, 20)] })],
    ["24|resource:54", partition({ key: "24|resource:54", regionId: "24", resourceId: "54", committed: [packed(30, 40)] })],
    ["31|resource:77", partition({ key: "31|resource:77", regionId: "31", resourceId: "77", committed: [], status: "loading" })],
  ]);
  assert.deepEqual(resourceLocatePoint({ resourceId: "54", partitions: committed, preferredRegionId: "24", centre: { x: 0, z: 0 } }), {
    key: "24|resource:54", regionId: "24", resourceId: "54", x: 30, z: 40,
  });

  const provisional = new Map([
    ["19|resource:54", partition({ key: "19|resource:54", regionId: "19", resourceId: "54", generation: null, provisional: [packed(12, 14)], status: "loading" })],
    ["24|resource:28", partition({ key: "24|resource:28", regionId: "24", resourceId: "28", committed: [], status: "loading" })],
  ]);
  assert.deepEqual(resourceLocatePoint({ resourceId: "54", partitions: provisional, preferredRegionId: "19", centre: { x: 0, z: 0 } }), {
    key: "19|resource:54", regionId: "19", resourceId: "54", x: 12, z: 14,
  });
});

test("preferred-region points win, then distance and deterministic ties choose one target", () => {
  const partitions = new Map([
    ["19|resource:54", partition({ key: "19|resource:54", regionId: "19", resourceId: "54", committed: [packed(51, 50), packed(49, 50)] })],
    ["24|resource:54", partition({ key: "24|resource:54", regionId: "24", resourceId: "54", committed: [packed(1, 1)] })],
  ]);
  assert.deepEqual(resourceLocatePoint({ resourceId: "54", partitions, preferredRegionId: "19", centre: { x: 50, z: 50 } }), {
    key: "19|resource:54", regionId: "19", resourceId: "54", x: 49, z: 50,
  });
  assert.deepEqual(resourceLocatePoint({ resourceId: "54", partitions, preferredRegionId: "31", centre: { x: 0, z: 0 } }), {
    key: "24|resource:54", regionId: "24", resourceId: "54", x: 1, z: 1,
  });
});

test("one activation is consumed once without waiting for empty partitions", () => {
  const targets = [];
  const empty = new Map([
    ["19|resource:54", partition({ key: "19|resource:54", regionId: "19", resourceId: "54", committed: [], status: "loading" })],
  ]);
  const input = {
    activation: { id: 7, resourceId: "54" },
    consumedActivationId: null,
    partitions: empty,
    preferredRegionId: "19",
    centre: { x: 0, z: 0 },
    isVisible: () => false,
    highlight: (target) => targets.push(["highlight", target]),
    locate: (target) => targets.push(["locate", target]),
  };
  assert.equal(applyResourceLocate(input), null, "an empty partition leaves the activation pending");

  const ready = new Map([
    ["19|resource:54", partition({ key: "19|resource:54", regionId: "19", resourceId: "54", committed: [packed(10, 20)] })],
  ]);
  const consumed = applyResourceLocate({ ...input, partitions: ready });
  assert.equal(consumed, 7);
  assert.deepEqual(targets.map(([action]) => action), ["highlight", "locate"]);
  assert.equal(applyResourceLocate({ ...input, partitions: ready, consumedActivationId: consumed }), 7);
  assert.deepEqual(targets.map(([action]) => action), ["highlight", "locate"], "later updates preserve the user's pan and zoom");
});

test("a visible target consumes the activation without moving the viewport", () => {
  const actions = [];
  const partitions = new Map([
    ["19|resource:54", partition({ key: "19|resource:54", regionId: "19", resourceId: "54", committed: [packed(10, 20)] })],
  ]);
  assert.equal(applyResourceLocate({
    activation: { id: 8, resourceId: "54" }, consumedActivationId: null, partitions,
    preferredRegionId: "19", centre: { x: 0, z: 0 }, isVisible: () => true,
    highlight: () => actions.push("highlight"), locate: () => actions.push("locate"),
  }), 8);
  assert.deepEqual(actions, ["highlight"]);
});

test("an animated locate completes visibility measurement only after move completion and paint", () => {
  let visible = false;
  let moveEnd = null;
  let paint = null;
  let listenerRemoved = 0;
  let completed = 0;
  const cancel = scheduleResourceLocateVisible({
    isVisible: () => visible,
    onMoveEnd: (callback) => {
      moveEnd = callback;
      return () => { listenerRemoved += 1; };
    },
    requestFrame: (callback) => {
      paint = callback;
      return () => {};
    },
    onVisible: () => { completed += 1; },
  });

  assert.equal(completed, 0);
  assert.equal(paint, null, "off-screen targets must wait for Leaflet movement completion");
  visible = true;
  moveEnd();
  assert.equal(completed, 0, "move completion alone is not proof that the target has painted");
  assert.equal(typeof paint, "function");
  paint();
  assert.equal(completed, 1);
  assert.equal(listenerRemoved, 1);
  cancel();
  assert.equal(completed, 1, "the activation completes at most once");
});

test("cancelling an unfinished visibility measurement removes its movement listener", () => {
  let moveEnd = null;
  let listenerRemoved = 0;
  let completed = 0;
  const cancel = scheduleResourceLocateVisible({
    isVisible: () => false,
    onMoveEnd: (callback) => {
      moveEnd = callback;
      return () => { listenerRemoved += 1; };
    },
    requestFrame: () => () => {},
    onVisible: () => { completed += 1; },
  });
  cancel();
  moveEnd();
  assert.equal(listenerRemoved, 1);
  assert.equal(completed, 0);
});

test("resource layer status still reports progressive loading and availability", () => {
  assert.equal(resourceLayerStatus({
    selectionKey: "28", snapshotSelectionKey: "28", available: false,
    reason: "Live resource positions are unavailable.", visible: true, freshness: "partial",
  }), "loading");
  assert.equal(resourceLayerStatus({
    selectionKey: "28,54", snapshotSelectionKey: "28,54", available: true,
    status: "partial", pending: false, reason: "Some selected resource positions are unavailable.",
    visible: true, freshness: "partial",
  }), "partial");
});

test("explicit resource availability states retain precedence over legacy reason text", () => {
  assert.equal(resourceLayerStatus({
    selectionKey: "28", snapshotSelectionKey: "28", available: false, status: "loading",
    reason: "A different unavailable reason.", visible: true, freshness: "partial",
  }), "loading");
  assert.equal(resourceLayerStatus({
    selectionKey: "28", snapshotSelectionKey: "28", available: false, status: "unavailable",
    reason: "Live resource positions are unavailable.", visible: true, freshness: "partial",
  }), "unavailable");
});

test("resource layer status stays live independently from unrelated partial layers", () => {
  assert.equal(resourceLayerStatus({
    selectionKey: "28,54", snapshotSelectionKey: "28,54", available: true,
    status: "live", pending: false, reason: null, visible: true, freshness: "partial",
  }), "live");
  assert.equal(resourceLayerStatus({
    selectionKey: "28", snapshotSelectionKey: "54", available: true,
    status: "ready", reason: null, visible: true, freshness: "live",
  }), "loading");
});
