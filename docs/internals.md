# Internals

## MemoryManager (조율 계층)

v2.5.2에서 MemoryManager는 1790줄에서 904줄로 경량화되어, 도구 핸들러와 하위 모듈 간의 조율(orchestration) 계층으로 기능한다. 각 연산의 핵심 로직은 전담 모듈로 위임되며, MemoryManager는 의존성 주입과 메서드 라우팅만 담당한다.

**분해된 모듈:**

| 모듈 | 위임 대상 | 역할 |
|------|----------|------|
| `ContextBuilder` | `context()` | Core/Working/Anchor Memory 조합, rankedInjection, 컨텍스트 힌트 생성 |
| `ReflectProcessor` | `reflect()` | summary/decisions/errors_resolved/new_procedures/open_questions 파편 변환·저장, episode 생성, Working Memory 정리 |
| `BatchRememberProcessor` | `batchRemember()` | Phase A(유효성 검증) → Phase B(트랜잭션 INSERT) → Phase C(후처리) 3단계 일괄 저장 |
| `QuotaChecker` | `remember()` 진입 시 | API 키별 파편 할당량(fragment_limit) 검사 |
| `RememberPostProcessor` | `remember()` 완료 후 | 임베딩 생성, 형태소 인덱싱, 자동 링크, assertion 검사, 시간 링크, 평가 큐 투입 파이프라인 |

**위임 패턴:** 각 모듈은 생성자에서 필요한 의존성(store, index, factory, 바인딩된 메서드 등)을 주입받는다. MemoryManager 생성자에서 `this.recall.bind(this)`, `this.remember.bind(this)` 형태로 자기 참조 메서드를 바인딩하여 전달하므로, 모듈이 MemoryManager를 역참조하지 않는다.

**reflect의 resolution_status 자동 세팅:** ReflectProcessor는 reflect 생성 파편에 resolution_status를 자동 부여한다. `errors_resolved` 항목은 `resolutionStatus: "resolved"`로, `open_questions` 항목은 `resolutionStatus: "open"`으로 설정된다. 또한 모든 reflect 생성 파편에 `sessionId`가 전파되어 세션 단위 추적이 가능하다.

---

## MemoryEvaluator

서버가 시작되면 MemoryEvaluator 워커가 백그라운드에서 구동된다. `getMemoryEvaluator().start()`로 시작되는 싱글턴이다. SIGTERM/SIGINT 수신 시 graceful shutdown 흐름에서 중지된다.

워커는 5초 간격으로 Redis 큐 `memory_evaluation`을 폴링한다. 큐가 비어 있으면 대기한다. 큐에서 잡(job)을 꺼내면 Gemini CLI(`geminiCLIJson`)를 호출하여 파편 내용의 합리성을 평가한다. 평가 결과는 fragments 테이블의 utility_score와 verified_at을 갱신하는 데 사용된다.

새 파편이 remember로 저장될 때 평가 큐에 투입된다. 단, fact, procedure, error 유형은 제외된다. 평가 대상은 decision, preference, relation 유형이다. 평가는 저장과 비동기로 분리되어 있으므로 remember 호출의 응답 시간에 영향을 주지 않는다.

Gemini CLI가 설치되지 않은 환경에서는 워커가 구동되지만 평가 작업을 건너뛴다.

---

## MemoryConsolidator

파편 저장 흐름: `remember()` 호출 시 ConflictResolver의 `autoLinkOnRemember`가 동일 topic 파편과 `related` 링크를 즉시 생성한다. 이후 `embedding_ready` 이벤트가 발행되면 GraphLinker가 semantic 유사도 기반 링크를 추가한다. MemoryConsolidator는 이 링크 망을 유지보수하는 별도의 주기적 파이프라인이다.

memory_consolidate 도구가 실행되거나 서버 내부 스케줄러(6시간 간격, CONSOLIDATE_INTERVAL_MS로 조정)가 트리거할 때 동작하는 18단계 유지보수 파이프라인이다.

1. **TTL 계층 전환**: hot → warm → cold 강등. 접근 빈도와 경과 시간 기준. warm → permanent 승격은 importance≥0.8이고 `quality_verified IS DISTINCT FROM FALSE`인 파편만 대상 — Circuit Breaker 패턴으로 평가가 명시적으로 부정(FALSE)된 파편의 permanent 등급 진입을 차단한다(TRUE=정상, NULL+is_anchor=앵커 폴백, NULL+importance≥0.9=오프라인 폴백). permanent 계층 파편도 is_anchor=false + importance<0.5 + 180일 미접근 조건 충족 시 cold로 강등된다(parole)
2. **중요도 감쇠(decay)**: PostgreSQL `POWER()` 단일 SQL로 배치 처리. 공식: `importance × 2^(−Δt / halfLife)`. Δt는 `COALESCE(last_decay_at, accessed_at, created_at)` 기준. 적용 후 `last_decay_at = NOW()` 갱신(멱등성 보장). 유형별 반감기 — procedure:30일, fact:60일, decision:90일, error:45일, preference:120일, relation:90일, 나머지:60일. `is_anchor=true` 제외, 최솟값 0.05 보장
3. **만료 파편 삭제 (다차원 GC)**: 5가지 복합 조건으로 판정한다. (a) utility_score < 0.15 + 비활성 60일, (b) fact/decision 고립 파편(접근 0회, 링크 0개, 30일 경과, importance < 0.2), (c) 기존 하위 호환 조건(importance < 0.1, 90일), (d) 해결된 error 파편(`[해결됨]` 접두사 + 30일 경과 + importance < 0.3), (e) NULL type 파편(gracePeriod 경과 + importance < 0.2). gracePeriod 7일 이내 파편은 보호된다. 1회 최대 50건 삭제. `is_anchor=true`, `permanent` 계층 제외
4. **중복 병합**: content_hash가 동일한 파편들을 가장 중요한 것으로 병합. 링크와 접근 통계 통합
5. **누락 임베딩 보충**: embedding이 NULL인 파편에 대해 비동기 임베딩 생성
5.5. **소급 자동 링크**: GraphLinker.retroLink()로 임베딩은 있지만 링크가 없는 고립 파편을 최대 20건 처리하여 관계를 자동 생성
6. **utility_score 재계산**: `importance * (1 + ln(max(access_count, 1))) / age_months^0.3` 공식으로 갱신. 나이(개월)의 0.3제곱을 나누어 오래된 파편의 점수를 점진적으로 낮춘다(1개월÷1.00, 12개월÷2.29, 24개월÷2.88). 이후 ema_activation>0.3 AND importance<0.4인 파편을 MemoryEvaluator 재평가 큐에 등록한다
7. **앵커 자동 승격**: access_count >= 10 + importance >= 0.8인 파편을 `is_anchor=true`로 승격
8. **증분 모순 탐지 (3단계 하이브리드)**: 마지막 검사 이후 신규 파편에 대해 같은 topic의 기존 파편과 pgvector cosine similarity > 0.85인 쌍을 추출(Stage 1). NLI 분류기(mDeBERTa ONNX)로 entailment/contradiction/neutral을 판정(Stage 2) — 높은 신뢰도 모순(conf >= 0.8)은 Gemini 호출 없이 즉시 해소, 확실한 entailment는 즉시 통과. NLI가 불확실한 케이스(수치/도메인 모순)만 Gemini CLI로 에스컬레이션(Stage 3). 확인 시 `contradicts` 링크 + 시간 논리 기반 해소(구 파편 중요도 하향 + `superseded_by` 링크). 해결 결과는 `decision` 타입 파편으로 자동 기록(audit trail) — `recall(keywords=["contradiction","resolved"])`으로 추적 가능. CLI 불가 시 similarity > 0.92인 쌍을 Redis pending 큐에 적재
9. **보류 모순 후처리**: Gemini CLI가 가용해지면 pending 큐에서 최대 10건을 꺼내 재판정
10. **피드백 리포트 생성**: tool_feedback/task_feedback 데이터를 집계하여 도구별 유용성 리포트 생성
10.5. **피드백 적응형 importance 보정**: 최근 24시간 tool_feedback 데이터와 세션 회상 이력을 결합하여 importance를 점진 보정. `sufficient=true` 시 +5%, `sufficient=false` 시 −2.5%, `relevant=false` 시 −5%. 기준: session_id 일치 파편, 최대 20건/세션, lr=0.05, 클리핑 [0.05, 1.0]. is_anchor=true 파편 제외
11. **Redis 인덱스 정리 + stale 파편 수집**: 고아 키워드 인덱스 제거 및 검증 주기 초과 파편 목록 반환
12. **session_reflect 노이즈 정리**: topic='session_reflect' 파편 중 type별 최신 5개만 보존하고, 30일 경과 + importance < 0.3인 나머지를 삭제 (1회 최대 30건)
13. **supersession 배치 감지**: 같은 topic + type이면서 임베딩 유사도 0.7~0.85 구간의 파편 쌍을 Gemini CLI로 "대체 관계인가?" 판단. 확정 시 superseded_by 링크 + valid_to 설정 + importance 반감. GraphLinker의 0.85 이상 구간과 상보적으로 동작
14. **감쇠 적용 (EMA 동적 반감기)**: PostgreSQL `POWER()` 배치 SQL로 파편 전체에 지수 감쇠 적용. `ema_activation`이 높은 파편은 반감기가 최대 2배 연장(`computeDynamicHalfLife`). 공식: `importance × 2^(−Δt / (halfLife × clamp(1 + ema × 0.5, 1, 2)))`
15. **EMA 배치 감쇠**: 장기 미접근 파편의 ema_activation을 주기적으로 축소한다. 60일 이상 미접근 → ema_activation=0(리셋), 30~60일 미접근 → ema_activation×0.5(절반). is_anchor=true 파편 제외. 검색 노출 감소 없이 접근 기록이 없는 파편의 EMA가 과거 부스트 값을 유지하는 현상을 방지한다

### compressOldFragments (KNN 배치 병렬화)

`ConsolidatorGC.compressOldFragments()`는 장기 미접근·저중요도 파편을 topic별로 그룹핑한 뒤 KNN(cosine >= 0.80)으로 유사 그룹을 형성하여 대표 파편으로 압축한다. v2.5.2에서 KNN 이웃 조회가 순차 N+1 쿼리에서 `BATCH_SIZE=20` 단위 `Promise.all` 병렬로 전환되었다. 배치 내 각 파편의 pgvector KNN 쿼리가 동시에 실행되므로, 대상 파편이 많을수록 처리 시간이 선형 대비 크게 단축된다. 개별 쿼리 실패는 `.catch(() => ({ rows: [] }))`로 격리되어 배치 전체를 차단하지 않는다.

---

## 세션 및 인증 내부 동작

### updateTtlTier key_id 격리

`FragmentWriter.updateTtlTier`는 `keyId` 파라미터를 받아 UPDATE 쿼리에 `key_id` 조건을 추가한다. 다른 API 키가 소유한 파편의 TTL 계층을 변경하는 크로스 키 접근을 차단한다. keyId가 null이면 마스터 키 소유 파편(`key_id IS NULL`)만 대상으로 한다.

### workspace 필터 전파

`FragmentSearch._buildSearchQuery()`는 쿼리에서 `workspace` 값을 정규화하여 `sq.workspace`로 보관한다. `_executeSearch()`는 이를 L2(keyword/topic) 검색 options와 L3(semantic) searchBySemantic 8번째 인자로 전달한다.

`FragmentReader`의 `searchByKeywords`, `searchByTopic`, `searchBySemantic`, `searchByTimeRange`, `searchAsOf`, `searchBySource` 6개 메서드 모두 `(workspace = $N OR workspace IS NULL)` 조건을 지원한다. `_searchTemporal`도 `searchByTimeRange` 호출 시 `workspace: sq.workspace`를 전달한다.

`MemoryManager`의 workspace 해석 우선순위: `params.workspace ?? params._defaultWorkspace ?? null`. `_defaultWorkspace`는 인증 시 키의 `api_keys.default_workspace`에서 읽혀 세션에 저장되며, 도구 호출 시 `args._defaultWorkspace`로 주입된다.

### 세션 자동 복구

세션 스토어에서 "Session not found" 또는 "Session expired" 오류가 발생하면 서버가 재인증 흐름을 즉시 실행한다. 재인증 시 기존 세션의 `keyId`와 `groupKeyIds`를 복원하여 새 세션에 주입한다. 클라이언트 입장에서는 투명하게 연결이 유지되며, 재인증 이벤트는 audit 로그에 기록된다.

Legacy SSE 세션도 요청마다 `expiresAt`을 `now + SESSION_TTL_MS`로 갱신하는 슬라이딩 윈도우 방식을 적용한다.

### Redis TTL 동기화

`validateStreamableSession`은 세션 갱신 시 고정된 `CACHE_SESSION_TTL` 대신 Redis에서 읽은 실제 잔여 TTL을 사용한다. 세션이 만료에 가까워질수록 갱신 후에도 남은 시간이 정확히 보존된다.

### SSE 연결 해제

SSE 스트림이 닫히면(`res.on('close')`) 서버는 SSE 응답 객체만 제거하고 세션 자체는 유지한다. 세션은 Redis TTL이 소진될 때까지 살아있으며, 클라이언트가 재연결하면 동일 세션을 이어서 사용할 수 있다.

### OAuth refresh_token의 is_api_key 전파

`POST /token` 에서 `grant_type=refresh_token`으로 토큰을 갱신할 때, 원본 토큰의 `is_api_key` 플래그가 새로 발급되는 access_token과 refresh_token에 그대로 전파된다. API 키 기반 클라이언트가 갱신 후에도 동일한 격리 컨텍스트를 유지한다.

### SESSION_TTL 기본값 변경

`SESSION_TTL` 환경변수의 기본값이 240분에서 43200분(30일)으로 변경되었다. 슬라이딩 윈도우 방식으로 도구 사용 시마다 TTL이 갱신되므로, 30일 비활동 후에만 만료된다. 활발히 사용 중인 세션은 사실상 만료되지 않는다.

---

## EmbeddingCache (쿼리 임베딩 캐시)

`FragmentSearch._searchL3()`에서 쿼리 텍스트의 임베딩 벡터를 Redis에 캐싱하여 반복 검색 레이턴시를 감소시킨다.

**키 패턴:** `emb:q:{SHA-256 앞 16자}`. 동일 쿼리 텍스트는 항상 같은 키에 매핑된다.

**값 형식:** `Float32Array`를 `Buffer`로 바이너리 직렬화하여 저장. 조회 시 역직렬화하여 `number[]`로 반환.

**TTL:** 기본 3600초(1시간). 생성자 `ttlSeconds` 옵션으로 조정 가능.

**장애 격리:** 모든 Redis 호출은 try-catch로 감싸고, 실패 시 null/무시 반환. 캐시 장애가 검색 흐름을 차단하지 않는다. Redis 미설정(status === "stub") 시 항상 cache miss로 동작.

---

## Reranker (Cross-Encoder 재정렬)

RRF 병합 이후 상위 30건을 cross-encoder로 정밀 재정렬하여 검색 정확도를 높인다. 서버 시작 시 `preloadReranker()`를 비동기로 호출하여 첫 recall 요청 전에 모델을 준비한다.

**듀얼 모드:**
- `RERANKER_URL` 설정 시: 외부 HTTP 서비스 (`POST /rerank { query, documents[] } → { scores[] }`)
- 미설정 시: `@huggingface/transformers` + ONNX in-process

**In-Process 모델 선택 (`RERANKER_MODEL`):**

| 값 | 모델 | 크기 | 언어 | 권장 대상 |
|----|------|------|------|-----------|
| `minilm` (기본값) | Xenova/ms-marco-MiniLM-L-6-v2 | ~80MB | 영어 전용 | 영어 사용자 |
| `bge-m3` | onnx-community/bge-reranker-v2-m3-ONNX | ~280MB (q4) | 100+ 언어 (한국어 포함) | 비영어권 사용자 |

> **비영어권 사용자는 `RERANKER_MODEL=bge-m3` 사용을 권장한다.** ms-marco-MiniLM-L-6-v2는 영어 MS MARCO 데이터셋으로만 학습되어 한국어 등 비영어 쿼리-문서 쌍의 관련성 판단 능력이 없다. bge-m3는 동일한 ONNX in-process 방식으로 동작하며, 첫 실행 시 HuggingFace Hub에서 자동 다운로드된다.

**외부 서비스 장애 자동 전환:** 연속 3회 실패 시 inprocess 모드로 자동 전환. 외부 서비스가 복구되어도 재시작 전까지 inprocess 유지. 어느 모드든 scores 반환 실패 시 RRF 결과 그대로 반환(graceful degradation).

**최종 스코어:** `sigmoid(logit) * recency_boost`. recency_boost는 생성일 기준 365일 선형 감쇠 [0.9, 1.1] 범위.

---

## TemporalLinker (시간 기반 자동 링크)

`remember()` 호출 시 `MemoryManager._autoLinkOnRemember()` 체인에서 비동기로 실행된다. 동일 `topic` 내 ±24h 윈도우에 있는 기존 파편과 `temporal` 링크를 최대 5건 생성한다.

**가중치 공식:** `max(0.3, 1.0 - hours/24)` — 시간 차 0h=1.0, 12h=0.5, 24h=0.3.

**API 키 격리:** `options.keyId`를 쿼리에 `key_id = ANY($n)`으로 전달하여 타 API 키 소유 파편을 temporal 링크 대상에서 제외한다.

fragment_links.weight 컬럼은 migration-023에서 integer→real로 변경되어 float 가중치를 지원한다.

---

## CaseEventStore

case_events 테이블에 semantic milestone을 기록하고 조회하는 전담 스토어다. `MemoryManager`에 주입되어 `reconstructHistory()` 경로에서 사용된다.

**주요 메서드:**

| 메서드 | 설명 |
|--------|------|
| `append(caseId, sessionId, eventType, summary, keyId)` | 신규 이벤트 기록. sequence_no에 `FOR UPDATE` 잠금으로 동시성 제어 |
| `addEdge(fromId, toId, edgeType, confidence)` | 이벤트 간 DAG 엣지 추가 |
| `addEvidence(fragmentId, eventId, kind)` | 파편-이벤트 증거 조인 기록 |
| `getByCase(caseId, opts)` | 케이스 범위 이벤트 목록 조회 (occurred_at 오름차순) |
| `getBySession(sessionId, opts)` | 세션 범위 이벤트 목록 조회 |
| `getEdgesByEvents(eventIds)` | 이벤트 ID 목록에 해당하는 모든 엣지 일괄 조회 |

**event_type 8종:**

- `milestone_reached` — 목표 이정표 도달
- `hypothesis_proposed` — 가설 제안
- `hypothesis_rejected` — 가설 기각
- `decision_committed` — 의사결정 확정
- `error_observed` — 에러 관측
- `fix_attempted` — 수정 시도
- `verification_passed` — 검증 통과
- `verification_failed` — 검증 실패

**동시성:** `append()` 내부에서 `SELECT sequence_no FROM case_events WHERE case_id = $1 FOR UPDATE`로 배타적 행 잠금을 획득한 뒤 INSERT를 수행한다. 동일 케이스에 이벤트가 동시 삽입될 때 sequence_no 중복을 방지한다.

---

## HistoryReconstructor

`case_id` 또는 `entity` 키워드를 기준으로 파편과 이벤트를 수집하여 시간순 서사를 재구성한다. `MemoryManager.reconstructHistory()`에서 호출된다.

**`reconstruct(params)` 반환 구조:**

| 필드 | 설명 |
|------|------|
| `ordered_timeline` | 파편 목록 (created_at 오름차순) |
| `causal_chains` | BFS로 투영된 인과 체인 배열 |
| `unresolved_branches` | 미해결 브랜치 목록 |
| `supporting_fragments` | 인과 체인의 근거 파편 목록 |
| `case_events` | 해당 케이스/세션의 이벤트 목록 |
| `event_dag` | case_event_edges DAG 표현 |
| `summary` | 서사 요약 텍스트 |

**BFS 인과 체인 알고리즘:**

`fragment_links`의 `caused_by` / `resolved_by` 엣지와 `case_event_edges`의 동일 타입 엣지를 통합하여 단일 그래프를 구성한다. 시작 노드에서 BFS를 수행하여 도달 가능한 모든 인과 체인을 추출한다. 사이클은 방문 집합(visited set)으로 차단한다.

**미해결 브랜치 탐지:**

다음 두 조건을 OR로 수집한다.
- `fragments.resolution_status = 'open'`인 파편
- `case_events.event_type = 'error_observed'`이면서 해당 이벤트에서 출발하는 `resolved_by` 엣지가 없는 이벤트

---

## ReconsolidationEngine (링크 동적 갱신)

`lib/memory/ReconsolidationEngine.js`는 fragment_links의 weight와 confidence를 동적으로 갱신하고 변경 이력을 link_reconsolidations 테이블에 기록한다.

**reconsolidate(linkId, action, opts) — 5가지 action:**

| action | weight 변화 | confidence 변화 | 추가 효과 |
|--------|------------|----------------|---------|
| reinforce | +0.2 | +0.05 | |
| decay | -0.15 | -0.1 | |
| quarantine | -0.3 | -0.1 | quarantine_state = 'soft' |
| restore | +0.3 | +0.05 | quarantine_state = 'released' |
| soft_delete | 0 | 0 | deleted_at = NOW() |

weight는 [0, 2] 범위로 클램핑되며, confidence는 [0, 1] 범위로 클램핑된다.

**rate-limit:** decay/quarantine 계열 action은 동일 link_id에 대해 60초 내 재실행이 차단된다(in-memory Map, lastDecayAt).

**quarantineAdjacentLinks(fromId, toId, keyId):** contradicts 충돌 감지 시 ConflictResolver가 호출한다. 해당 두 파편 간에 존재하는 related/temporal 관계 링크를 모두 soft quarantine한다.

**ENABLE_RECONSOLIDATION 환경변수:** `true`로 설정해야 활성화된다(기본값: false). 비활성 시 tool_feedback과 ConflictResolver 모두 reconsolidate를 호출하지 않는다.

---

## EpisodeContinuityService (에피소드 연속성)

`lib/memory/EpisodeContinuityService.js`는 reflect() 호출 시 episode 파편에 case_events milestone을 삽입하고 이전 에피소드와 preceded_by 엣지로 연결한다.

**linkEpisodeMilestone(episodeFragmentId, agentId, keyId, sessionId):**

1. fragment 내용 첫 200자를 요약으로 조회
2. milestone_reached 이벤트를 case_events에 삽입 (ON CONFLICT idempotency_key DO NOTHING — 중복 방지)
3. 동일 agentId의 직전 milestone eventId가 캐시에 있으면 preceded_by 엣지 삽입
4. lastEventByAgent Map에 현재 eventId 저장

**idempotency_key 형식:** `milestone:{agentId}:{sessionId}:{fragmentId}` — 서버 재시작 후 동일 호출이 재발생해도 중복 이벤트가 생성되지 않는다.

MemoryManager.reflect() 완료 후 fire-and-forget으로 호출된다. 실패해도 reflect 결과에 영향을 주지 않는다.

---

## SpreadingActivation (확산 활성화)

`lib/memory/SpreadingActivation.js`는 현재 대화 맥락(contextText)에서 관련 파편을 선제적으로 활성화한다. ACT-R Spreading Activation 모델 기반.

**activateByContext(contextText, agentId, keyId, sessionId):**

1. FragmentFactory.extractKeywords()로 contextText에서 키워드 최대 8개 추출
2. keywords GIN 인덱스로 seed 파편 최대 10건 조회 (valid_to IS NULL, key_id 격리 적용)
3. fetchGraphNeighbors()로 1-hop 그래프 확산 (최대 10건)
4. 활성화된 파편 IDs를 activationQueue에 적재 → drainQueue()에서 activation_score +0.1, accessed_at/access_count 갱신

**캐시:** `{agentId}:{keyId}:{sessionId}` 키로 10분 TTL. 동일 세션 내 이미 활성화된 파편을 중복 처리하지 않는다.

MemoryManager.recall()에서 fire-and-forget으로 호출된다. `ENABLE_SPREADING_ACTIVATION=true`일 때만 활성화(기본값: false).

---

## 모순 탐지 파이프라인

3단계 하이브리드 구조로 O(N²) LLM 비교 비용을 억제하면서 정밀도를 유지한다.

```
신규 파편 저장 시
       ↓
pgvector cosine similarity > 0.85 후보 필터
       ↓
mDeBERTa NLI (in-process ONNX / 외부 HTTP 서비스)
  ├── contradiction ≥ 0.8  → 즉시 해결 (superseded_by 링크 + valid_to 갱신)
  ├── entailment   ≥ 0.6   → 무관 확정 (링크 미생성)
  └── 그 외 (모호)          → Gemini CLI 에스컬레이션
       ↓
시간축(valid_from/valid_to, superseded_by)으로 기존 데이터 보존
```

- **비용 효율**: 99% 후보를 NLI로 처리, LLM 호출은 수치·도메인 모순에만 발생
- **데이터 무손실**: 파편 삭제 대신 temporal 컬럼으로 버전 관리
- **구현 파일**: `lib/memory/NLIClassifier.js`, `lib/memory/MemoryConsolidator.js`
- **환경변수**: `NLI_SERVICE_URL` 미설정 시 ONNX in-process 자동 사용 (~280MB, 최초 실행 시 다운로드)
