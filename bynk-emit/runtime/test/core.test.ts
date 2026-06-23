import { test } from "node:test";
import assert from "node:assert/strict";
import { Ok, Err, Some, None } from "../src/result.ts";
import { QueueResult } from "../src/queue.ts";
import { InMemoryStorage, makeTestState } from "../src/storage.ts";

test("Result/Option constructors carry the tag discriminant", () => {
  assert.deepEqual(Ok(1), { tag: "Ok", value: 1 });
  assert.deepEqual(Err("e"), { tag: "Err", error: "e" });
  assert.deepEqual(Some(1), { tag: "Some", value: 1 });
  assert.deepEqual(None, { tag: "None" });
});

test("QueueResult: Ack is a singleton verdict, Retry carries a reason", () => {
  assert.deepEqual(QueueResult.Ack, { tag: "Ack" });
  assert.deepEqual(QueueResult.Retry("backoff"), { tag: "Retry", reason: "backoff" });
});

test("InMemoryStorage: get/put/delete and prefix list", async () => {
  const s = new InMemoryStorage();
  await s.put("user:1", { n: "a" });
  await s.put("user:2", { n: "b" });
  await s.put("order:1", { n: "c" });
  assert.deepEqual(await s.get("user:1"), { n: "a" });
  const users = await s.list({ prefix: "user:" });
  assert.equal(users.size, 2);
  assert.equal(await s.delete("user:1"), true);
  assert.equal(await s.get("user:1"), undefined);
});

test("makeTestState: names the state and gives it fresh storage", async () => {
  const st = makeTestState("agent-7");
  assert.equal(st.id.name, "agent-7");
  await st.storage.put("k", 1);
  assert.equal(await st.storage.get("k"), 1);
});
