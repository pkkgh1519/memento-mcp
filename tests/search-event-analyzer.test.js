/**
 * SearchEventAnalyzer 단위 테스트
 *
 * 순수 함수(computeL1MissRate, computeFilterDistribution)만 검증.
 * getSearchObservability는 DB 연결이 필요하므로 제외.
 *
 * 작성자: 최진호
 * 작성일: 2026-03-25
 */

import { computeL1MissRate, computeFilterDistribution } from "../lib/memory/SearchEventAnalyzer.js";

/* ─────────────────────────────────────────────────────────────────────────── */
/*  computeL1MissRate                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

describe("computeL1MissRate", () => {
  it("빈 배열이면 null을 반환한다", () => {
    expect(computeL1MissRate([])).toBeNull();
  });

  it("null/undefined 입력이면 null을 반환한다", () => {
    expect(computeL1MissRate(null)).toBeNull();
    expect(computeL1MissRate(undefined)).toBeNull();
  });

  it("모든 행이 fallback이면 1을 반환한다", () => {
    const rows = [
      { l1_is_fallback: true },
      { l1_is_fallback: true },
      { l1_is_fallback: true }
    ];
    expect(computeL1MissRate(rows)).toBe(1.0);
  });

  it("모든 행이 fallback 아니면 0을 반환한다", () => {
    const rows = [
      { l1_is_fallback: false },
      { l1_is_fallback: false }
    ];
    expect(computeL1MissRate(rows)).toBe(0);
  });

  it("혼합 케이스: 2/4 fallback → 0.5 반환", () => {
    const rows = [
      { l1_is_fallback: true  },
      { l1_is_fallback: false },
      { l1_is_fallback: true  },
      { l1_is_fallback: false }
    ];
    expect(computeL1MissRate(rows)).toBe(0.5);
  });

  it("반환값이 4자리 소수점 이하로 정규화된다", () => {
    const rows = [
      { l1_is_fallback: true  },
      { l1_is_fallback: false },
      { l1_is_fallback: false }
    ];
    const rate = computeL1MissRate(rows);
    // 1/3 = 0.3333...  → 4자리 이하
    expect(rate).toBe(parseFloat((1 / 3).toFixed(4)));
  });

  it("l1_is_fallback이 true가 아닌 값(falsy)은 miss로 카운트하지 않는다", () => {
    const rows = [
      { l1_is_fallback: 1     },  // truthy지만 true가 아님
      { l1_is_fallback: null  },
      { l1_is_fallback: false }
    ];
    // strict === true 비교 — 모두 0
    expect(computeL1MissRate(rows)).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  computeFilterDistribution                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

describe("computeFilterDistribution", () => {
  it("빈 배열이면 빈 객체를 반환한다", () => {
    expect(computeFilterDistribution([])).toEqual({});
  });

  it("null/undefined 입력이면 빈 객체를 반환한다", () => {
    expect(computeFilterDistribution(null)).toEqual({});
    expect(computeFilterDistribution(undefined)).toEqual({});
  });

  it("filter_keys가 null인 행은 무시한다", () => {
    const rows = [
      { filter_keys: null },
      { filter_keys: null }
    ];
    expect(computeFilterDistribution(rows)).toEqual({});
  });

  it("filter_keys가 빈 배열인 행은 무시한다", () => {
    const rows = [
      { filter_keys: [] },
      { filter_keys: [] }
    ];
    expect(computeFilterDistribution(rows)).toEqual({});
  });

  it("단일 키가 여러 행에 걸쳐 집계된다", () => {
    const rows = [
      { filter_keys: ["type"] },
      { filter_keys: ["type"] },
      { filter_keys: ["type"] }
    ];
    expect(computeFilterDistribution(rows)).toEqual({ type: 3 });
  });

  it("여러 키가 각각 올바르게 집계된다", () => {
    const rows = [
      { filter_keys: ["type", "importance"] },
      { filter_keys: ["type"]               },
      { filter_keys: ["importance", "topic"] }
    ];
    const dist = computeFilterDistribution(rows);
    expect(dist.type).toBe(2);
    expect(dist.importance).toBe(2);
    expect(dist.topic).toBe(1);
  });

  it("filter_keys 프로퍼티가 없는 행은 무시한다", () => {
    const rows = [
      { filter_keys: ["type"] },
      {                       },  // filter_keys 없음
      { filter_keys: ["type"] }
    ];
    expect(computeFilterDistribution(rows)).toEqual({ type: 2 });
  });

  it("빈 문자열 키는 집계에서 제외된다", () => {
    const rows = [
      { filter_keys: ["", "type", ""] }
    ];
    expect(computeFilterDistribution(rows)).toEqual({ type: 1 });
  });
});
