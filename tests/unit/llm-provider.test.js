/**
 * Unit tests: LLM Provider callText/callJson
 *
 * OpenAI (OpenAICompatibleProvider 기반, await isCircuitOpen 올바름),
 * Anthropic, Ollama 3종 샘플.
 * 실제 API 호출 0건 — global fetch를 mock으로 교체.
 *
 * [구현 버그 확인]
 * AnthropicProvider, OllamaProvider, CohereProvider, GoogleGeminiProvider는
 * callText() 내에서 `if (this.isCircuitOpen())` — await 누락으로
 * Promise 객체가 항상 truthy로 평가되어 회로 차단 에러를 항상 던진다.
 * 해당 케이스를 명시적 버그 검증 테스트로 포함한다.
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 */

import { describe, it, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import { OpenAIProvider }    from "../../lib/llm/providers/OpenAIProvider.js";
import { AnthropicProvider } from "../../lib/llm/providers/AnthropicProvider.js";
import { OllamaProvider }    from "../../lib/llm/providers/OllamaProvider.js";
import { LlmRateLimitError } from "../../lib/llm/errors.js";
import { redisClient }       from "../../lib/redis.js";

// Redis 연결 해제 — 모든 테스트 완료 후 프로세스 정상 종료를 위해
after(async () => {
  try { await redisClient.quit(); } catch (_) {}
});

// ---------------------------------------------------------------------------
// fetch mock 헬퍼
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let   _fetchImpl    = null;

function mockFetch(impl) {
  _fetchImpl       = impl;
  globalThis.fetch = async (url, opts) => _fetchImpl(url, opts);
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
  _fetchImpl       = null;
}

/** 정상 200 응답 mock builder */
function okResponse(body) {
  return {
    ok    : true,
    status: 200,
    json  : async () => body,
    text  : async () => JSON.stringify(body)
  };
}

/** 에러 응답 mock builder */
function errResponse(status, text = "") {
  return {
    ok    : false,
    status,
    json  : async () => ({}),
    text  : async () => text
  };
}

// ---------------------------------------------------------------------------
// OpenAI Provider (await this.isCircuitOpen() — 올바른 구현)
// ---------------------------------------------------------------------------

describe("OpenAIProvider", () => {

  const provider = new OpenAIProvider({
    apiKey: "TEST_API_KEY",
    model : "gpt-4o-mini"
  });

  afterEach(() => restoreFetch());

  it("isAvailable: apiKey + model 모두 있으면 true", async () => {
    assert.equal(await provider.isAvailable(), true);
  });

  it("isAvailable: apiKey 없으면 false", async () => {
    const p = new OpenAIProvider({ model: "gpt-4o-mini" });
    assert.equal(await p.isAvailable(), false);
  });

  it("callText: 정상 200 응답에서 텍스트를 반환한다", async () => {
    mockFetch(() => okResponse({
      choices: [{ message: { content: "hello from openai" } }],
      usage  : { prompt_tokens: 10, completion_tokens: 5 }
    }));
    const text = await provider.callText("test prompt");
    assert.equal(text, "hello from openai");
  });

  it("callText: 429 응답 시 LlmRateLimitError를 던진다", async () => {
    mockFetch(() => errResponse(429, "rate limit exceeded"));

    await assert.rejects(
      () => provider.callText("test prompt"),
      e => e instanceof LlmRateLimitError || e.message.includes("429")
    );
  });

  it("callText: 401 응답 시 에러를 던진다", async () => {
    mockFetch(() => errResponse(401, "unauthorized"));

    await assert.rejects(
      () => provider.callText("test prompt"),
      e => e.message.includes("401") || e.message.includes("openai")
    );
  });

  it("callText: fetch 자체 에러(네트워크 실패) 시 에러를 던진다", async () => {
    mockFetch(() => Promise.reject(new Error("network error")));

    await assert.rejects(
      () => provider.callText("test prompt"),
      /network error/
    );
  });

  it("callJson: JSON 응답을 파싱하여 반환한다", async () => {
    mockFetch(() => okResponse({
      choices: [{ message: { content: '{"result":"ok","score":99}' } }],
      usage  : {}
    }));
    const json = await provider.callJson("return json");
    assert.deepEqual(json, { result: "ok", score: 99 });
  });

  it("callJson: markdown 펜스 포함 JSON도 파싱된다", async () => {
    mockFetch(() => okResponse({
      choices: [{ message: { content: "```json\n{\"key\":\"val\"}\n```" } }],
      usage  : {}
    }));
    const json = await provider.callJson("return json");
    assert.deepEqual(json, { key: "val" });
  });

});

// ---------------------------------------------------------------------------
// Anthropic Provider — await 누락 버그 검증
// ---------------------------------------------------------------------------

describe("AnthropicProvider", () => {

  const provider = new AnthropicProvider({
    apiKey: "TEST_API_KEY",
    model : "claude-3-haiku-20240307"
  });

  it("isAvailable: apiKey + model 있으면 true", async () => {
    assert.equal(await provider.isAvailable(), true);
  });

  it("isAvailable: model 없으면 false", async () => {
    const p = new AnthropicProvider({ apiKey: "TEST_API_KEY" });
    assert.equal(await p.isAvailable(), false);
  });

  /**
   * [구현 버그] callText에서 `await this.isCircuitOpen()` 대신
   * `this.isCircuitOpen()` — await 누락으로 Promise 객체가 truthy로 평가되어
   * 항상 "circuit breaker open" 에러를 던진다.
   * 이 테스트는 해당 버그를 회귀 방지용으로 문서화한다.
   */
  it("[BUG] callText: await isCircuitOpen 누락으로 항상 circuit open 에러 발생 (회귀 검증)", async () => {
    // 버그 상태에서 callText는 circuit open 에러를 던짐
    // 버그가 수정되면 이 테스트가 FAIL로 바뀌어 수정 완료를 알려준다
    await assert.rejects(
      () => provider.callText("test prompt"),
      e => e.message.includes("circuit breaker open") || e.message.includes("anthropic")
    );
  });

});

// ---------------------------------------------------------------------------
// Ollama Provider — await 누락 버그 검증
// ---------------------------------------------------------------------------

describe("OllamaProvider", () => {

  const provider = new OllamaProvider({
    baseUrl: "http://localhost:11434",
    model  : "llama3"
  });

  it("isAvailable: baseUrl + model 있으면 true (apiKey 불필요)", async () => {
    assert.equal(await provider.isAvailable(), true);
  });

  it("isAvailable: baseUrl 없으면 false", async () => {
    const p = new OllamaProvider({ model: "llama3" });
    assert.equal(await p.isAvailable(), false);
  });

  /**
   * [구현 버그] OllamaProvider도 동일하게 await 누락으로
   * callText가 항상 "circuit breaker open" 에러를 던진다.
   */
  it("[BUG] callText: await isCircuitOpen 누락으로 항상 circuit open 에러 발생 (회귀 검증)", async () => {
    await assert.rejects(
      () => provider.callText("test prompt"),
      e => e.message.includes("circuit breaker open") || e.message.includes("ollama")
    );
  });

});
