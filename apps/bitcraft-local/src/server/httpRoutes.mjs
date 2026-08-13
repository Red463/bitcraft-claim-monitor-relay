import path from "node:path";

export function securityHeaders(headers = {}) {
  return {
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self' https://do.featurebase.app",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://do.featurebase.app",
      "img-src 'self' data: https://cdn.discordapp.com https://*.featurebase.app https://*.featurebase-attachments.com https://fb-usercontent.fra1.cdn.digitaloceanspaces.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.featurebase.app wss://*.featurebase.app",
      "frame-src https://bitcraftsync.app https://bccodex.com https://*.featurebase.app",
      "media-src https://*.featurebase.app https://*.featurebase-attachments.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; "),
    "cross-origin-opener-policy": "same-origin",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    ...headers,
  };
}

export function mimeType(filePath) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function staticCacheControl(filePath) {
  return String(filePath).endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable";
}
export function shouldFallbackToFrontend(pathname) {
  return !String(pathname).startsWith("/game-icons/");
}
export function routeGroup(pathname) {
  if (pathname.startsWith("/api/local/admin")) return "admin";
  if (pathname.startsWith("/api/local/auth") || pathname.startsWith("/api/local/user")) return "auth";
  if (pathname.startsWith("/api/discord")) return "discord";
  if (pathname.startsWith("/api/local")) return "local-api";
  if (pathname.startsWith("/assets/") || pathname.startsWith("/game-icons/") || pathname === "/favicon.svg" || pathname === "/favicon.ico") return "static";
  return "app";
}

export function shouldLogVisitor(pathname) {
  return routeGroup(pathname) !== "static";
}
