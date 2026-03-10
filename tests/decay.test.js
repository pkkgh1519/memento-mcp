/**
 * decay.js EMA 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-11
 */

import { updateEmaActivation, computeEmaRankBoost } from "../lib/memory/decay.js";

describe("EMA activation", () => {
    it("초기 접근 시 양수 활성화 값을 반환한다", () => {
        const now    = new Date();
        const result = updateEmaActivation(null, null, now);
        expect(result).toBeGreaterThan(0);
    });

    it("최근 접근은 원거리 접근보다 높은 활성화를 준다", () => {
        const now          = new Date();
        const recentAccess = updateEmaActivation(0, new Date(now.getTime() - 1000),          now);
        const oldAccess    = updateEmaActivation(0, new Date(now.getTime() - 86400_000 * 30), now);
        expect(recentAccess).toBeGreaterThan(oldAccess);
    });

    it("deltaMs=0 이어도 NaN/Infinity 없음", () => {
        const now    = new Date();
        const result = updateEmaActivation(0.5, now, now);
        expect(Number.isFinite(result)).toBe(true);
    });

    it("computeEmaRankBoost는 [0, 0.3] 범위를 벗어나지 않는다", () => {
        const boost = computeEmaRankBoost(999);
        expect(boost).toBeGreaterThanOrEqual(0);
        expect(boost).toBeLessThanOrEqual(0.3);
    });
});
