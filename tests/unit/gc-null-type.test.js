import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("GC null type handling", () => {
  test("deleteExpired SQL에 NULL type 조건이 포함되어 있다", async () => {
    const { FragmentStore } = await import("../../lib/memory/FragmentStore.js");
    const store = new FragmentStore();
    const src = store.deleteExpired.toString();
    assert.ok(src.includes("type IS NULL"), "NULL type 파편 GC 조건 필수");
  });
});
