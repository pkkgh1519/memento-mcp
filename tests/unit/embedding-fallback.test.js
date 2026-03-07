import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("embedding fallback path", () => {
  test("FragmentStore.generateMissingEmbeddings가 함수이다", async () => {
    const { FragmentStore } = await import("../../lib/memory/FragmentStore.js");
    const store = new FragmentStore();
    assert.strictEqual(typeof store.generateMissingEmbeddings, "function");
  });
});
