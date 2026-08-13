import assert from "node:assert/strict";
import test from "node:test";

import { sendBinary, sendJson, sendText } from "../src/server/httpResponses.mjs";

function fakeResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

test("sendJson writes JSON with shared security headers and explicit response headers", () => {
  const res = fakeResponse();

  sendJson(res, 201, { ok: true }, { "set-cookie": "session=abc" });

  assert.equal(res.status, 201);
  assert.equal(res.headers["content-type"], "application/json");
  assert.equal(res.headers["content-length"], Buffer.byteLength(JSON.stringify({ ok: true })));
  assert.equal(res.headers["set-cookie"], "session=abc");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(res.body, JSON.stringify({ ok: true }));
});

test("sendText and sendBinary preserve cache policy and payload body", () => {
  const text = fakeResponse();
  sendText(text, 200, "a,b\n1,2", "text/csv; charset=utf-8");
  assert.equal(text.status, 200);
  assert.equal(text.headers["content-type"], "text/csv; charset=utf-8");
  assert.equal(text.headers["cache-control"], "no-store");
  assert.equal(text.body, "a,b\n1,2");

  const binary = fakeResponse();
  const payload = Buffer.from([1, 2, 3]);
  sendBinary(binary, 200, payload, "image/png", { etag: "abc" });
  assert.equal(binary.status, 200);
  assert.equal(binary.headers["content-type"], "image/png");
  assert.equal(binary.headers["cache-control"], "no-cache");
  assert.equal(binary.headers.etag, "abc");
  assert.equal(binary.body, payload);
});

test("sendJson emits no body or content length for a 204 response", () => {
  const response = fakeResponse();
  sendJson(response, 204, {});
  assert.equal(response.headers["content-length"], undefined);
  assert.equal(response.body, undefined);
});
