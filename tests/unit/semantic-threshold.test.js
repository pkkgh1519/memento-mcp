import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MEMORY_CONFIG } from "../../config/memory.js";

describe("semanticSearch config", () => {
  test("minSimilarity가 0.3 미만으로 설정되어 있다", () => {
    assert.ok(MEMORY_CONFIG.semanticSearch, "semanticSearch 설정 필수");
    assert.ok(MEMORY_CONFIG.semanticSearch.minSimilarity < 0.3,
      "recall 확보를 위해 0.3 미만 필요");
  });
});
