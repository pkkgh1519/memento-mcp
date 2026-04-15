/**
 * Unit tests: parseJsonResponse heuristic
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseJsonResponse } from "../../lib/llm/util/parse-json.js";

describe("parseJsonResponse — heuristic JSON 파싱", () => {

  it("pure JSON 문자열을 직접 파싱한다", () => {
    const result = parseJsonResponse('{"a":1,"b":"hello"}');
    assert.deepEqual(result, { a: 1, b: "hello" });
  });

  it("markdown json 펜스를 제거하고 파싱한다", () => {
    const input  = "```json\n{\"key\":\"value\"}\n```";
    const result = parseJsonResponse(input);
    assert.deepEqual(result, { key: "value" });
  });

  it("앞뒤 설명 텍스트에서 객체를 추출해 파싱한다", () => {
    const input  = 'Sure, here is the result: {"score":42} Hope that helps.';
    const result = parseJsonResponse(input);
    assert.deepEqual(result, { score: 42 });
  });

  it("배열 응답을 파싱한다", () => {
    const result = parseJsonResponse("[1,2,3]");
    assert.deepEqual(result, [1, 2, 3]);
  });

  it("앞뒤 텍스트에서 배열을 추출해 파싱한다", () => {
    const input  = 'The answer is [4, 5, 6] as requested.';
    const result = parseJsonResponse(input);
    assert.deepEqual(result, [4, 5, 6]);
  });

  it("malformed 텍스트에 대해 Error를 던진다", () => {
    assert.throws(
      () => parseJsonResponse("not json at all"),
      /failed to parse JSON/
    );
  });

  it("빈 문자열에 대해 Error를 던진다", () => {
    assert.throws(
      () => parseJsonResponse(""),
      /empty LLM response/
    );
  });

  it("null에 대해 Error를 던진다", () => {
    assert.throws(
      () => parseJsonResponse(null),
      /empty LLM response/
    );
  });

  it("중첩 객체를 파싱한다", () => {
    const input  = '{"outer":{"inner":true}}';
    const result = parseJsonResponse(input);
    assert.deepEqual(result, { outer: { inner: true } });
  });

  it("markdown 펜스 언어 태그 없이도 파싱한다 (```만 있는 경우)", () => {
    const input  = "```\n{\"x\":99}\n```";
    const result = parseJsonResponse(input);
    assert.deepEqual(result, { x: 99 });
  });

});
