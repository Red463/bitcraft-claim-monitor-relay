import jwt from "jsonwebtoken";

export function createFeaturebaseJwt({ secret, user } = {}) {
  const signingSecret = String(secret ?? "").trim();
  if (!signingSecret || !user?.id) return undefined;

  const payload = {
    userId: String(user.id),
    name: String(user.globalName || user.username || `User ${user.id}`),
  };
  if (user.avatarUrl) payload.profilePicture = String(user.avatarUrl);

  return jwt.sign(payload, signingSecret, { algorithm: "HS256" });
}
