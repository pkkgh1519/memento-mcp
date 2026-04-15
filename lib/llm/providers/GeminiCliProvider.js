/**
 * Gemini CLI Provider (기존 lib/gemini.js 래핑 shim)
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 *
 * 기존 lib/gemini.js의 geminiCLIJson / isGeminiCLIAvailable을 LlmProvider
 * 인터페이스로 감싸는 얇은 어댑터.
 *
 * gemini-cli는 CLI를 통해 JSON만 반환하므로:
 *   - callJson() : 정상 동작 (CLI JSON 응답 그대로 반환)
 *   - callText() : 미구현 — "use callJson" 에러 throw
 *
 * lib/gemini.js는 이 파일에서 수정하지 않는다. public API만 import해서 wrap.
 * (gemini.js 수정은 Task 10, Wave 2 담당)
 */

import { LlmProvider }                               from "../LlmProvider.js";
import { geminiCLIJson, isGeminiCLIAvailable }       from "../../gemini.js";

export class GeminiCliProvider extends LlmProvider {
  constructor(config = {}) {
    super({ ...config, name: "gemini-cli" });
  }

  /**
   * Gemini CLI 설치 여부로 가용성을 판단한다 (`which gemini` 확인).
   * config.model, apiKey 검사 없음 — CLI는 자체 인증 사용.
   *
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return await isGeminiCLIAvailable();
  }

  /**
   * gemini-cli는 JSON 전용이므로 callText는 미구현.
   *
   * @throws {Error} 항상 throw
   */
  async callText(_prompt, _options = {}) {
    throw new Error("gemini-cli: use callJson (CLI returns parsed JSON)");
  }

  /**
   * 기존 geminiCLIJson을 호출하여 JSON 응답을 반환한다.
   * Circuit breaker 연동 포함.
   *
   * @param {string}  prompt
   * @param {object}  [options={}]
   * @param {number}  [options.timeoutMs=30000]
   * @param {string}  [options.model]          - geminiCLIJson에 전달
   * @returns {Promise<*>} 파싱된 JSON
   */
  async callJson(prompt, options = {}) {
    if (this.isCircuitOpen()) {
      throw new Error("gemini-cli: circuit breaker open");
    }

    try {
      const result = await geminiCLIJson(prompt, {
        timeoutMs: options.timeoutMs || 30000,
        model    : options.model
      });
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}
