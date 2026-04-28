/**
 * SessionLinker — 세션 파편 통합, 자동 링크, 사이클 감지
 *
 * 작성자: 최진호
 * 작성일: 2026-03-12
 * 수정일: 2026-04-27 (Phase 5: autoLinkSessionFragments 배치 처리 — sortedKey 정렬 + cycleCache + createLinks 단일 호출)
 */

import { logWarn } from "../logger.js";

export class SessionLinker {
  /**
   * @param {import("./FragmentStore.js").FragmentStore}  store
   * @param {import("./FragmentIndex.js").FragmentIndex}  index
   */
  constructor(store, index) {
    this.store = store;
    this.index = index;
  }

  /**
   * 세션의 파편들을 수집하여 요약 구조를 반환한다.
   *
   * @param {string}      sessionId
   * @param {string}      agentId
   * @param {string|null} keyId
   * @returns {Promise<object|null>}
   */
  async consolidateSessionFragments(sessionId, agentId = "default", keyId = null) {
    const ids     = await this.index.getSessionFragments(sessionId);
    const wmItems = await this.index.getWorkingMemory(sessionId);

    const rows    = ids?.length > 0 ? await this.store.getByIds(ids, agentId, keyId) : [];
    const allRows = [
      ...(rows || []),
      ...(wmItems || []).map(w => ({
        content: w.content,
        type   : w.type || "fact"
      }))
    ];
    if (!allRows.length) return null;

    const decisions      = [];
    const errorsResolved = [];
    const procedures     = [];
    const openQuestions  = [];
    const summaryParts   = [];

    for (const r of allRows) {
      const content = (r.content || "").trim();
      if (!content) continue;

      switch (r.type) {
        case "decision":
          decisions.push(content.replace(/^\[해결됨\]\s*/i, "").trim());
          break;
        case "error":
          errorsResolved.push(content.replace(/^\[해결됨\]\s*/i, "").trim());
          break;
        case "procedure":
          procedures.push(content);
          break;
        case "fact":
          if (content.includes("[미해결]")) {
            openQuestions.push(content.replace(/^\[미해결\]\s*/i, "").trim());
          } else {
            summaryParts.push(content);
          }
          break;
        default:
          summaryParts.push(content);
      }
    }

    const summary = summaryParts.length > 0
      ? `세션 ${sessionId.substring(0, 8)}... 종합: ${summaryParts.join(" ")}`
      : (decisions.length || errorsResolved.length || procedures.length
        ? `세션 ${sessionId.substring(0, 8)}... 종합: 결정 ${decisions.length}건, 에러 해결 ${errorsResolved.length}건, 절차 ${procedures.length}건`
        : null);

    if (!summary && !decisions.length && !errorsResolved.length && !procedures.length && !openQuestions.length) {
      return null;
    }

    return {
      summary,
      decisions      : [...new Set(decisions)],
      errors_resolved: [...new Set(errorsResolved)],
      new_procedures : [...new Set(procedures)],
      open_questions : [...new Set(openQuestions)]
    };
  }

  /**
   * 세션 파편 간 규칙 기반 자동 link 생성 (Phase 5: 배치 처리)
   *
   * candidate 페어를 sortedKey 사전식 오름차순으로 정렬하여 데드락을 회피한다.
   * wouldCreateCycle 결과는 Map 캐시로 중복 호출을 방지하고,
   * cycle을 통과한 페어 전체를 createLinks 단일 호출로 삽입한다.
   *
   * @param {Array}       fragments - reflect에서 저장된 파편 목록 [{id, type, ...}]
   * @param {string}      agentId
   * @param {string|null} keyId     - API 키 격리 (null: 마스터). cycle 검증 시 cross-tenant 경로 차단
   */
  async autoLinkSessionFragments(fragments, agentId = "default", keyId = null) {
    const errors     = fragments.filter(f => f.type === "error");
    const decisions  = fragments.filter(f => f.type === "decision");
    const procedures = fragments.filter(f => f.type === "procedure");

    /**
     * 1단계: candidate 페어 빌드
     *   규칙 1: error → decision (caused_by)
     *   규칙 2: procedure → error (resolved_by)
     */
    const rawPairs = [];
    for (const err of errors) {
      for (const dec of decisions) {
        rawPairs.push({ fromId: err.id, toId: dec.id, relationType: "caused_by" });
      }
    }
    for (const proc of procedures) {
      for (const err of errors) {
        rawPairs.push({ fromId: proc.id, toId: err.id, relationType: "resolved_by" });
      }
    }

    if (rawPairs.length === 0) return;

    /**
     * 2단계: sortedKey 부여 → 사전식 오름차순 정렬.
     * 데드락 회피의 본질적 수단. lock_timeout은 안전망.
     */
    const withKey = rawPairs.map(p => {
      const minId  = p.fromId < p.toId ? p.fromId : p.toId;
      const maxId  = p.fromId < p.toId ? p.toId   : p.fromId;
      return { ...p, sortedKey: `${minId}|${maxId}` };
    });
    withKey.sort((a, b) => a.sortedKey < b.sortedKey ? -1 : a.sortedKey > b.sortedKey ? 1 : 0);

    /**
     * 3단계: wouldCreateCycle Map 캐시 적용.
     * 동일 (from, to) 쌍은 캐시에서 반환하여 DB 왕복 절감.
     */
    const cycleCache  = new Map();
    const validPairs  = [];

    for (const pair of withKey) {
      const cacheKey = `${pair.fromId}->${pair.toId}`;
      let   isCycle;
      if (cycleCache.has(cacheKey)) {
        isCycle = cycleCache.get(cacheKey);
      } else {
        isCycle = await this.wouldCreateCycle(pair.fromId, pair.toId, agentId, keyId);
        cycleCache.set(cacheKey, isCycle);
      }
      if (!isCycle) {
        validPairs.push({ fromId: pair.fromId, toId: pair.toId, relationType: pair.relationType });
      }
    }

    if (validPairs.length === 0) return;

    /**
     * 4단계: createLinks 단일 트랜잭션 호출.
     * 부분 실패 시 전체 롤백 후 단건 createLink fallback.
     */
    try {
      await this.store.createLinks(validPairs, agentId);
    } catch (batchErr) {
      logWarn(`[SessionLinker] batch link creation failed (${batchErr.message}), falling back to individual createLink`);
      for (const pair of validPairs) {
        await this.store.createLink(pair.fromId, pair.toId, pair.relationType, agentId).catch((e) => {
          logWarn(`[SessionLinker] fallback single link creation failed: ${e.message}`);
        });
      }
    }
  }

  /**
   * A → B 링크 생성 시 순환 참조 발생 여부 확인 (B → A 경로 존재 시 true)
   * 재귀 CTE 단일 쿼리로 판정 (최대 20홉)
   *
   * keyId가 제공되면 LinkStore.isReachable이 동일 테넌트(또는 master NULL)
   * 경로만 탐색한다. cross-tenant fragment를 경유한 cycle path가 탐지되어
   * 링크 생성이 차단되는 보안 결함을 방지한다.
   *
   * @param {string}      fromId
   * @param {string}      toId
   * @param {string}      agentId
   * @param {string|null} keyId  - API 키 격리 (null: master 전체 경로)
   * @returns {Promise<boolean>}
   */
  async wouldCreateCycle(fromId, toId, agentId = "default", keyId = null) {
    try {
      return await this.store.isReachable(toId, fromId, agentId, keyId);
    } catch (err) {
      logWarn(`[SessionLinker] Cycle detection failed: ${err.message}`);
      return false;
    }
  }
}
