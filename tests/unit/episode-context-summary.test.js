import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryManager } from "../../lib/memory/MemoryManager.js";

describe("_buildEpisodeContext", () => {
  it("summarizes fragment types and keywords", () => {
    const mm        = MemoryManager.create({});
    const fragments = [
      { type: "fact",     keywords: ["HNSW", "튜닝"] },
      { type: "fact",     keywords: ["L1",   "캐시"] },
      { type: "decision", keywords: ["HNSW", "ef_search"] },
    ];
    const ctx = mm._buildEpisodeContext({}, fragments);
    assert.ok(ctx.includes("fact 2건"));
    assert.ok(ctx.includes("decision 1건"));
    assert.ok(ctx.includes("3건 저장"));
  });

  it("handles empty fragments", () => {
    const mm  = MemoryManager.create({});
    const ctx = mm._buildEpisodeContext({}, []);
    assert.ok(ctx.includes("0건 저장"));
  });

  it("limits keywords to 5", () => {
    const mm        = MemoryManager.create({});
    const fragments = [
      { type: "fact", keywords: ["a", "b", "c", "d", "e", "f", "g"] },
    ];
    const ctx   = mm._buildEpisodeContext({}, fragments);
    const match = ctx.match(/주요 키워드: (.+)\./);
    assert.ok(match);
    const kws = match[1].split(", ");
    assert.ok(kws.length <= 5);
  });
});
