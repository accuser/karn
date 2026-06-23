import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpResult, matchPath, httpResultToResponse } from "../src/http.ts";
import type { JsonValue } from "../src/boundary.ts";

test("matchPath: captures and decodes params", () => {
  assert.deepEqual(matchPath("/orders/:id", "/orders/abc%20123"), { params: { id: "abc 123" } });
  assert.deepEqual(matchPath("/a/:x/b/:y", "/a/1/b/2"), { params: { x: "1", y: "2" } });
});

test("matchPath: returns null on literal or length mismatch", () => {
  assert.equal(matchPath("/orders/:id", "/customers/1"), null);
  assert.equal(matchPath("/orders/:id", "/orders/1/extra"), null);
});

const id = (v: number): JsonValue => v;

test("httpResultToResponse: status codes map per variant", async () => {
  assert.equal(httpResultToResponse(HttpResult.Ok(1), id).status, 200);
  assert.equal(httpResultToResponse(HttpResult.Created(1), id).status, 201);
  assert.equal(httpResultToResponse(HttpResult.NoContent, id).status, 204);
  assert.equal(httpResultToResponse(HttpResult.BadRequest("b"), id).status, 400);
  assert.equal(httpResultToResponse(HttpResult.Unauthorized, id).status, 401);
  assert.equal(httpResultToResponse(HttpResult.Forbidden, id).status, 403);
  assert.equal(httpResultToResponse(HttpResult.NotFound, id).status, 404);
  assert.equal(httpResultToResponse(HttpResult.Conflict("c"), id).status, 409);
  assert.equal(httpResultToResponse(HttpResult.UnprocessableEntity("u"), id).status, 422);
  assert.equal(httpResultToResponse(HttpResult.ServerError("s"), id).status, 500);
});

test("httpResultToResponse: Ok carries the serialised value; NoContent is empty", async () => {
  const ok = httpResultToResponse(HttpResult.Ok(42), id);
  assert.equal(await ok.json(), 42);
  const empty = httpResultToResponse(HttpResult.NoContent, id);
  assert.equal(await empty.text(), "");
});

test("httpResultToResponse: error variants carry an { error } body", async () => {
  const res = httpResultToResponse(HttpResult.BadRequest("bad input"), id);
  assert.deepEqual(await res.json(), { error: "bad input" });
});
