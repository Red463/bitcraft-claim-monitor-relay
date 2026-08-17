import assert from "node:assert/strict";
import test from "node:test";

import { isCurrentUserPlayerMarker, verifiedCharacterPlayerId } from "../src/map/playerMarkerIdentity.mjs";

test("only an approved valid linked character produces a canonical map identity", () => {
  assert.equal(verifiedCharacterPlayerId("approved", "18446744073709551615"), "18446744073709551615");
  assert.equal(verifiedCharacterPlayerId("approved", "00042"), "42");
  assert.equal(verifiedCharacterPlayerId("pending", "42"), null);
  assert.equal(verifiedCharacterPlayerId("rejected", "42"), null);
  assert.equal(verifiedCharacterPlayerId("approved", "player-42"), null);
  assert.equal(verifiedCharacterPlayerId("approved", "18446744073709551616"), null);
});

test("the ME treatment requires an exact canonical linked-player identity", () => {
  assert.equal(isCurrentUserPlayerMarker("42", "42"), true);
  assert.equal(isCurrentUserPlayerMarker("00042", "42"), true);
  assert.equal(isCurrentUserPlayerMarker("43", "42"), false);
  assert.equal(isCurrentUserPlayerMarker("42", null), false);
  assert.equal(isCurrentUserPlayerMarker("player-42", "42"), false);
});
