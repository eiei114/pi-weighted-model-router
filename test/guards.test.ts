import assert from "node:assert/strict";
import test from "node:test";
import { isRecord } from "../src/guards.js";

test("isRecord accepts plain objects and rejects non-records", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ version: 1 }), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord(undefined), false);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord("text"), false);
  assert.equal(isRecord(0), false);
});
