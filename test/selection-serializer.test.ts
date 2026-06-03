import assert from "node:assert/strict";
import test from "node:test";
import { runSerialized } from "../src/selection-serializer.js";

test("runSerialized runs tasks in FIFO order", async () => {
  const order: number[] = [];

  const first = runSerialized(async () => {
    order.push(1);
    await delay(20);
    order.push(2);
    return "first";
  });

  const second = runSerialized(async () => {
    order.push(3);
    return "second";
  });

  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, "first");
  assert.equal(b, "second");
  assert.deepEqual(order, [1, 2, 3]);
});

test("runSerialized propagates rejection without breaking the queue", async () => {
  const order: number[] = [];

  const failing = runSerialized(async () => {
    order.push(1);
    throw new Error("boom");
  });

  const next = runSerialized(async () => {
    order.push(2);
    return "ok";
  });

  await assert.rejects(failing, /boom/);
  assert.equal(await next, "ok");
  assert.deepEqual(order, [1, 2]);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
