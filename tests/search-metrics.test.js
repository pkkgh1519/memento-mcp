/**
 * SearchMetrics 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-11
 */

import { SearchMetrics } from "../lib/memory/SearchMetrics.js";

describe("SearchMetrics", () => {
    describe("computePercentiles", () => {
        const metrics = new SearchMetrics(null);

        it("샘플이 없으면 null percentiles를 반환한다", () => {
            const stats = metrics.computePercentiles([]);
            expect(stats.p50).toBeNull();
            expect(stats.p90).toBeNull();
            expect(stats.p99).toBeNull();
            expect(stats.count).toBe(0);
        });

        it("단일 샘플이면 모든 percentile이 같다", () => {
            const stats = metrics.computePercentiles([42]);
            expect(stats.p50).toBe(42);
            expect(stats.p90).toBe(42);
            expect(stats.p99).toBe(42);
        });

        it("100개 배열에서 P90은 90번째 값이다", () => {
            const samples = Array.from({ length: 100 }, (_, i) => i + 1);
            const stats   = metrics.computePercentiles(samples);
            expect(stats.p90).toBe(90);
        });

        it("count는 입력 배열 길이를 반환한다", () => {
            const stats = metrics.computePercentiles([1, 2, 3]);
            expect(stats.count).toBe(3);
        });
    });

    describe("record (in-memory fallback)", () => {
        it("record 후 getStats에 샘플이 반영된다", async () => {
            const m = new SearchMetrics(null);
            await m.record("L1", 50);
            await m.record("L1", 100);
            const stats = await m.getStats();
            expect(stats.L1.count).toBe(2);
            expect(stats.L1.p50).toBeGreaterThan(0);
        });

        it("SAMPLE_LIMIT(100) 초과 시 오래된 샘플을 버린다", async () => {
            const m = new SearchMetrics(null);
            for (let i = 0; i < 110; i++) await m.record("L2", i);
            const stats = await m.getStats();
            expect(stats.L2.count).toBe(100);
        });
    });
});
