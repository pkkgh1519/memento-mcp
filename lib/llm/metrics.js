/**
 * LLM Provider Prometheus 메트릭
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 *
 * Provider 호출 건수, 레이턴시, 폴백 발동 횟수, 토큰 사용량 4종을
 * memento-mcp 공용 레지스트리(lib/metrics.js)에 등록한다.
 */

import promClient  from "prom-client";
import { register } from "../metrics.js";

/** Provider별 호출 건수 (outcome: attempt | success | failure) */
export const llmProviderCallsTotal = new promClient.Counter({
  name      : "memento_llm_provider_calls_total",
  help      : "LLM provider 호출 건수",
  labelNames: ["provider", "outcome"],
  registers : [register]
});

/** Provider별 호출 레이턴시 (ms) */
export const llmProviderLatencyMs = new promClient.Histogram({
  name      : "memento_llm_provider_latency_ms",
  help      : "LLM provider 호출 레이턴시 (ms)",
  labelNames: ["provider"],
  buckets   : [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
  registers : [register]
});

/** Fallback 체인 발동 건수 */
export const llmFallbackTriggeredTotal = new promClient.Counter({
  name      : "memento_llm_fallback_triggered_total",
  help      : "Fallback 체인 발동 건수",
  labelNames: ["primary", "fallback"],
  registers : [register]
});

/** Provider별 토큰 사용량 (direction: input | output) */
export const llmTokenUsageTotal = new promClient.Counter({
  name      : "memento_llm_token_usage_total",
  help      : "Provider별 토큰 사용량",
  labelNames: ["provider", "direction"],
  registers : [register]
});
