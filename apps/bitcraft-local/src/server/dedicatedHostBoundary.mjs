function hostname(value) {
  const authority = String(Array.isArray(value) ? value[0] ?? "" : value ?? "").split(",")[0].trim();
  if (!authority || /[\s\\/@]/.test(authority)) return null;
  try {
    return new URL(`http://${authority}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLoopbackAddress(address) {
  const value = String(address ?? "").trim().toLowerCase();
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

export function isDedicatedRequestHost(request, {
  isProduction = false,
  allowDevelopmentHosts = !isProduction,
  allowDirectLoopbackHealthHost = false,
} = {}) {
  const directHost = hostname(request?.host);
  const hasForwardedHost = request?.forwardedHost !== undefined;
  const forwardedHost = isLoopbackAddress(request?.remoteAddress) ? hostname(request?.forwardedHost) : null;
  const resolvedHost = forwardedHost ?? directHost;

  if (resolvedHost === "app.timbersteeltrade.com") return true;
  if (
    allowDirectLoopbackHealthHost
    && !hasForwardedHost
    && isLoopbackAddress(request?.remoteAddress)
    && (directHost === "localhost" || directHost === "127.0.0.1")
  ) return true;
  if (!allowDevelopmentHosts) return false;
  return resolvedHost === "localhost" || resolvedHost === "127.0.0.1";
}
