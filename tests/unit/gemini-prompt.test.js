/**
 * _buildGeminiPrompt 순수 함수 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-04-09
 *
 * _buildGeminiPrompt가 세션 메타데이터를 받아 자기완결성 5원칙이 주입된
 * 프롬프트 문자열을 반환하는지 검증한다.
 */

import { describe, test } from "node:test";
import assert             from "node:assert/strict";

import { _buildGeminiPrompt } from "../../lib/memory/AutoReflect.js";

const sampleActivity = {
  startedAt:    "2026-04-09T10:00:00Z",
  lastActivity: "2026-04-09T11:37:00Z",
  toolCalls:    { remember: 3, recall: 5 },
  keywords:     ["인증", "JWT", "세션"],
  fragments:    []
};

describe("_buildGeminiPrompt", () => {

  test("세션 ID를 프롬프트에 포함", () => {
    const prompt = _buildGeminiPrompt("abc-123", sampleActivity);
    assert.ok(prompt.includes("abc-123"), "sessionId should appear in prompt");
  });

  test("도구 사용 카운트를 '툴: N회' 형식으로 포함", () => {
    const prompt = _buildGeminiPrompt("abc-123", sampleActivity);
    assert.ok(prompt.includes("remember: 3회"));
    assert.ok(prompt.includes("recall: 5회"));
  });

  test("JSON 스키마 6개 필드 힌트 포함", () => {
    const prompt = _buildGeminiPrompt("abc-123", sampleActivity);
    assert.ok(prompt.includes("summary"));
    assert.ok(prompt.includes("decisions"));
    assert.ok(prompt.includes("errors_resolved"));
    assert.ok(prompt.includes("new_procedures"));
    assert.ok(prompt.includes("open_questions"));
    assert.ok(prompt.includes("narrative_summary"));
  });

  test("자기완결성 5원칙 키워드 모두 포함", () => {
    const prompt = _buildGeminiPrompt("abc-123", sampleActivity);
    assert.ok(prompt.includes("대명사"),                                 "원칙 1: 대명사 해소");
    assert.ok(prompt.includes("구체 엔티티") || prompt.includes("고유명"), "원칙 2: 구체 엔티티");
    assert.ok(prompt.includes("메타") && prompt.includes("자기참조"),      "원칙 3: 메타·자기참조 금지");
    assert.ok(prompt.includes("원자"),                                   "원칙 4: 원자성");
    assert.ok(prompt.includes("인과"),                                   "원칙 5: 인과 결합 예외");
  });

  test("6개월 후 판단 테스트 문구 포함", () => {
    const prompt = _buildGeminiPrompt("abc-123", sampleActivity);
    assert.ok(prompt.includes("6개월") && prompt.includes("다른 AI"));
  });

  test("BAD 예시(메타 문자열) 중 하나 이상 명시적 언급", () => {
    const prompt = _buildGeminiPrompt("abc-123", sampleActivity);
    const hasBadExample = prompt.includes("세션 요약")
                          || prompt.includes("자동 요약")
                          || prompt.includes("이번 대화")
                          || prompt.includes("도구 N회");
    assert.ok(hasBadExample, "at least one BAD example keyword should appear");
  });

  test("빈 keywords 배열을 '없음'으로 표시", () => {
    const activity = { ...sampleActivity, keywords: [] };
    const prompt = _buildGeminiPrompt("abc-123", activity);
    assert.ok(prompt.includes("검색 키워드: 없음"));
  });

  test("빈 toolCalls 객체를 '없음'으로 표시", () => {
    const activity = { ...sampleActivity, toolCalls: {} };
    const prompt = _buildGeminiPrompt("abc-123", activity);
    assert.ok(prompt.includes("도구 사용: 없음"));
  });
});
