import assert from "node:assert/strict";
import test from "node:test";

import { dedicatedMapHref, isDedicatedMapView } from "../src/navigation/routeState.ts";

test("dedicated map mode requires both the map page and fullscreen map view", () => {
  assert.equal(isDedicatedMapView("?page=map&mapView=fullscreen"), true);
  assert.equal(isDedicatedMapView("?page=dashboard&mapView=fullscreen"), false);
  assert.equal(isDedicatedMapView("?page=map"), false);
  assert.equal(isDedicatedMapView("?page=map&mapView=embedded"), false);
});

test("dedicated map links preserve the current map query and hash", () => {
  assert.equal(
    dedicatedMapHref("https://claims.test/?page=map&mapLayers=resource%3A42&label=Forge#selected"),
    "https://claims.test/?page=map&mapLayers=resource%3A42&label=Forge&mapView=fullscreen#selected",
  );
});

test("dedicated map links replace another active page without losing its query", () => {
  assert.equal(
    dedicatedMapHref("https://claims.test/?page=market&tab=browse&region=12"),
    "https://claims.test/?page=map&tab=browse&region=12&mapView=fullscreen",
  );
});
