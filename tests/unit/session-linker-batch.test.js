/**
 * SessionLinker 배치 링크 생성 단위 테스트 (Phase 5)
 *
 * 작성자: 최진호
 * 작성일: 2026-04-27
 *
 * 검증 범위:
 * - errors=2, decisions=3 → caused_by 6건 → createLinks 1회 호출, createLink 0회
 * - cycle 발생 페어 1건 → cycle 포함 7건 중 6건만 INSERT (1건 제외)
 * - wouldCreateCycle Map 캐시: 동일 from→to 쌍은 1회만 DB 조회
 * - sortedKey 정렬: createLinks 호출 시 pairs가 sortedKey 오름차순
 * - rawPairs 없으면 createLinks 미호출
 * - createLinks 실패 시 단건 createLink fallback 수행
 * - wouldCreateCycle 시그니처 보존 (fromId, toId, agentId, keyId)
 */

import { describe, it, mock } from "node:test";
import assert                 from "node:assert/strict";

import { SessionLinker } from "../../lib/memory/SessionLinker.js";

/**
 * 테스트용 store mock 빌더.
 * createLinks / createLink 호출 인수를 기록한다.
 */
function makeStore({ createLinksShouldFail = false } = {}) {
  const createLinksCalls = [];
  const createLinkCalls  = [];

  const store = {
    createLinksCalls,
    createLinkCalls,
    async createLinks(pairs, agentId) {
      createLinksCalls.push({ pairs: pairs.map(p => ({ ...p })), agentId });
      if (createLinksShouldFail) throw new Error("batch insert failed");
      return pairs.map((_, i) => `link-id-${i}`);
    },
    async createLink(fromId, toId, relationType, agentId) {
      createLinkCalls.push({ fromId, toId, relationType, agentId });
    },
    async isReachable() { return false; }
  };
  return store;
}

/**
 * wouldCreateCycle을 직접 mock하는 SessionLinker 빌더.
 * cyclePairs: Set<"fromId->toId"> — 이 쌍은 cycle 있음으로 반환.
 */
function makeLinker(store, cyclePairs = new Set()) {
  const linker = new SessionLinker(store, null);
  linker.wouldCreateCycle = mock.fn(async (fromId, toId) => {
    return cyclePairs.has(`${fromId}->${toId}`);
  });
  return linker;
}

/** 파편 목록 헬퍼 */
function makeFragments(spec) {
  return spec.map(([id, type]) => ({ id, type }));
}

describe("SessionLinker.autoLinkSessionFragments — 기본 배치 경로", () => {

  it("errors=2, decisions=3 → caused_by 6쌍 전부 createLinks 1회로 삽입", async () => {
    const store  = makeStore();
    const linker = makeLinker(store);

    const fragments = makeFragments([
      ["e1", "error"], ["e2", "error"],
      ["d1", "decision"], ["d2", "decision"], ["d3", "decision"]
    ]);
    await linker.autoLinkSessionFragments(fragments, "agent-a", null);

    assert.equal(store.createLinksCalls.length, 1, "createLinks는 정확히 1회 호출");
    assert.equal(store.createLinkCalls.length, 0, "단건 createLink는 호출되지 않아야 함");

    const { pairs } = store.createLinksCalls[0];
    assert.equal(pairs.length, 6, "caused_by 페어 6건");

    const causedBy = pairs.filter(p => p.relationType === "caused_by");
    assert.equal(causedBy.length, 6);
  });

  it("procedures=2, errors=2 → resolved_by 4쌍 전부 createLinks 1회로 삽입", async () => {
    const store  = makeStore();
    const linker = makeLinker(store);

    const fragments = makeFragments([
      ["p1", "procedure"], ["p2", "procedure"],
      ["e1", "error"], ["e2", "error"]
    ]);
    await linker.autoLinkSessionFragments(fragments, "agent-b", null);

    assert.equal(store.createLinksCalls.length, 1);
    const { pairs } = store.createLinksCalls[0];
    assert.equal(pairs.length, 4);
    assert.ok(pairs.every(p => p.relationType === "resolved_by"));
  });

  it("errors=2, decisions=3, procedures=2 → caused_by 6 + resolved_by 4 = 10쌍 createLinks 1회", async () => {
    const store  = makeStore();
    const linker = makeLinker(store);

    const fragments = makeFragments([
      ["e1", "error"], ["e2", "error"],
      ["d1", "decision"], ["d2", "decision"], ["d3", "decision"],
      ["p1", "procedure"], ["p2", "procedure"]
    ]);
    await linker.autoLinkSessionFragments(fragments, "agent-c", null);

    assert.equal(store.createLinksCalls.length, 1);
    assert.equal(store.createLinksCalls[0].pairs.length, 10);
  });

});

describe("SessionLinker.autoLinkSessionFragments — cycle 필터링", () => {

  it("cycle 발생 페어 1건 제외 → 6건 중 5건만 INSERT", async () => {
    const store  = makeStore();
    /** e1→d1 은 cycle */
    const linker = makeLinker(store, new Set(["e1->d1"]));

    const fragments = makeFragments([
      ["e1", "error"], ["e2", "error"],
      ["d1", "decision"], ["d2", "decision"], ["d3", "decision"]
    ]);
    await linker.autoLinkSessionFragments(fragments, "agent-d", null);

    assert.equal(store.createLinksCalls.length, 1);
    const { pairs } = store.createLinksCalls[0];
    assert.equal(pairs.length, 5, "cycle 1건 제외 → 5건");

    const hasCycledPair = pairs.some(p => p.fromId === "e1" && p.toId === "d1");
    assert.equal(hasCycledPair, false, "cycle 페어는 제외되어야 함");
  });

  it("모든 페어가 cycle이면 createLinks 미호출", async () => {
    const store  = makeStore();
    const linker = makeLinker(store, new Set(["e1->d1"]));

    const fragments = makeFragments([["e1", "error"], ["d1", "decision"]]);
    await linker.autoLinkSessionFragments(fragments, "agent-e", null);

    assert.equal(store.createLinksCalls.length, 0, "valid 페어 없으면 createLinks 호출 안 함");
  });

  it("errors/decisions/procedures 없으면 createLinks 미호출", async () => {
    const store  = makeStore();
    const linker = makeLinker(store);

    const fragments = makeFragments([["f1", "fact"], ["f2", "preference"]]);
    await linker.autoLinkSessionFragments(fragments, "agent-f", null);

    assert.equal(store.createLinksCalls.length, 0);
  });

});

describe("SessionLinker.autoLinkSessionFragments — cycleCache", () => {

  it("동일 from→to 쌍은 wouldCreateCycle을 1회만 호출 (캐시 재사용)", async () => {
    const store  = makeStore();
    const linker = makeLinker(store);

    /** e1→d1 페어만 존재 (1쌍) */
    const fragments = makeFragments([["e1", "error"], ["d1", "decision"]]);
    await linker.autoLinkSessionFragments(fragments, "agent-g", null);

    assert.equal(linker.wouldCreateCycle.mock.callCount(), 1,
      "단일 페어이므로 cycle 검사는 정확히 1회");
  });

  it("wouldCreateCycle은 (fromId, toId, agentId, keyId) 순서로 호출 (시그니처 보존)", async () => {
    const store  = makeStore();
    const linker = makeLinker(store);

    const fragments = makeFragments([["e1", "error"], ["d1", "decision"]]);
    await linker.autoLinkSessionFragments(fragments, "agent-h", "key-42");

    const call = linker.wouldCreateCycle.mock.calls[0];
    assert.equal(call.arguments[0], "e1");
    assert.equal(call.arguments[1], "d1");
    assert.equal(call.arguments[2], "agent-h");
    assert.equal(call.arguments[3], "key-42", "keyId는 4번째 인자로 전달되어야 함 (tenant 격리)");
  });

});

describe("SessionLinker.autoLinkSessionFragments — sortedKey 정렬", () => {

  it("createLinks에 전달된 pairs는 sortedKey 사전식 오름차순", async () => {
    const store  = makeStore();
    const linker = makeLinker(store);

    /** 다수 페어 생성 (e2>e1, d3>d1 등 역순 포함) */
    const fragments = makeFragments([
      ["e2", "error"], ["e1", "error"],
      ["d3", "decision"], ["d1", "decision"]
    ]);
    await linker.autoLinkSessionFragments(fragments, "agent-i", null);

    const { pairs } = store.createLinksCalls[0];

    for (let i = 1; i < pairs.length; i++) {
      const prev = pairs[i - 1];
      const curr = pairs[i];
      const prevKey = [prev.fromId < prev.toId ? prev.fromId : prev.toId,
                       prev.fromId < prev.toId ? prev.toId   : prev.fromId].join("|");
      const currKey = [curr.fromId < curr.toId ? curr.fromId : curr.toId,
                       curr.fromId < curr.toId ? curr.toId   : curr.fromId].join("|");
      assert.ok(prevKey <= currKey,
        `정렬 위반: pairs[${i-1}].sortedKey(${prevKey}) > pairs[${i}].sortedKey(${currKey})`);
    }
  });

});

describe("SessionLinker.autoLinkSessionFragments — fallback", () => {

  it("createLinks 실패 시 단건 createLink fallback 수행", async () => {
    const store  = makeStore({ createLinksShouldFail: true });
    const linker = makeLinker(store);

    const fragments = makeFragments([["e1", "error"], ["d1", "decision"]]);
    await linker.autoLinkSessionFragments(fragments, "agent-j", null);

    assert.equal(store.createLinksCalls.length, 1, "createLinks는 1회 시도됨");
    assert.equal(store.createLinkCalls.length, 1,  "fallback으로 createLink 1회 호출");
    assert.equal(store.createLinkCalls[0].fromId,      "e1");
    assert.equal(store.createLinkCalls[0].toId,        "d1");
    assert.equal(store.createLinkCalls[0].relationType,"caused_by");
  });

});
