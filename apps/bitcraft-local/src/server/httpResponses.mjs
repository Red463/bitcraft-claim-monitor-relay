import { securityHeaders } from "./httpRoutes.mjs";

export function sendJson(res, status, body, headers = {}) {
  if (status === 204 || status === 304 || (status >= 100 && status < 200)) {
    res.writeHead(status, securityHeaders(headers));
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, securityHeaders({
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
    ...headers,
  }));
  res.end(json);
}

export function sendText(res, status, text, contentType, headers = {}) {
  res.writeHead(status, securityHeaders({ "content-type": contentType, "cache-control": "no-store", ...headers }));
  res.end(text);
}

export function sendBinary(res, status, content, contentType, headers = {}) {
  res.writeHead(status, securityHeaders({ "content-type": contentType, "cache-control": "no-cache", ...headers }));
  res.end(content);
}
