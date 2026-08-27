import assert from "node:assert/strict";
import test from "node:test";

import { discordAvatarUrl, publicAdminUser, publicAppUser } from "../src/server/publicUsers.mjs";

test("discordAvatarUrl builds Discord CDN URLs only when id and avatar are present", () => {
  assert.equal(discordAvatarUrl({ discord_id: "123456789012345", discord_avatar: "abc" }), "https://cdn.discordapp.com/avatars/123456789012345/abc.png?size=128");
  assert.equal(discordAvatarUrl({ discord_id: "123456789012345", discord_avatar: " " }), null);
  assert.equal(discordAvatarUrl({ discord_id: "", discord_avatar: "abc" }), null);
  assert.equal(discordAvatarUrl(null), null);
});

test("publicAdminUser exposes safe admin identity, role labels, and permissions", () => {
  assert.equal(publicAdminUser(null), null);
  assert.deepEqual(publicAdminUser({
    id: 7,
    username: "admin-user",
    discord_id: 123456789012345,
    discord_username: "AdminDiscord",
    discord_global_name: "Admin Global",
    discord_avatar: "avatar-hash",
    role: "moderator",
  }), {
    id: 7,
    username: "admin-user",
    discordId: "123456789012345",
    discordUsername: "AdminDiscord",
    discordGlobalName: "Admin Global",
    avatarUrl: "https://cdn.discordapp.com/avatars/123456789012345/avatar-hash.png?size=128",
    role: "moderator",
    roleLabel: "Moderator",
    permissions: ["status.view", "settings.view", "discord.view", "discord.moderate", "audit.view"],
  });
});

test("publicAppUser exposes linked account identity and falls back for invalid settings JSON", () => {
  assert.equal(publicAppUser(null), null);
  assert.deepEqual(publicAppUser({
    id: 9,
    discord_id: 234567890123456,
    discord_username: "AppDiscord",
    discord_global_name: "App Global",
    discord_avatar: "app-avatar",
    character_player_id: 42,
    character_name: "Bit Crafter",
    character_status: "approved",
    settings_json: "{not-json",
    created_at: "2026-06-29T10:00:00.000Z",
    last_login_at: "2026-06-29T11:00:00.000Z",
  }), {
    id: 9,
    discordId: "234567890123456",
    username: "AppDiscord",
    globalName: "App Global",
    avatarUrl: "https://cdn.discordapp.com/avatars/234567890123456/app-avatar.png?size=128",
    characterPlayerId: "42",
    characterName: "Bit Crafter",
    characterStatus: "approved",
    settings: {},
    createdAt: "2026-06-29T10:00:00.000Z",
    lastLoginAt: "2026-06-29T11:00:00.000Z",
  });

  assert.deepEqual(publicAppUser({ settings_json: "{\"theme\":\"dark\"}" })?.settings, { theme: "dark" });
});
