/**
 * Gemini CLI Client (memento-mcp 전용)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-13
 * 수정일: 2026-03-28 (docs-mcp 위키 데드코드 제거)
 *
 * 메모리 서버 내부에서 Gemini CLI를 호출하여 JSON 응답을 얻는 유틸리티.
 * 사용처: MemoryEvaluator, MorphemeIndex, ContradictionDetector,
 *         ConsolidatorGC, AutoReflect
 */

import { spawn } from "child_process";

/**
 * Gemini CLI 설치 여부 확인
 *
 * @returns {Promise<boolean>}
 */
let _geminiCLICached = null;

export async function isGeminiCLIAvailable() {
  if (_geminiCLICached !== null) return _geminiCLICached;
  try {
    const { execSync } = await import("child_process");
    execSync("which gemini", { stdio: "ignore", timeout: 5000 });
    _geminiCLICached = true;
  } catch {
    _geminiCLICached = false;
  }
  return _geminiCLICached;
}

/**
 * Gemini CLI로 짧은 JSON 응답 생성
 *
 * 모순 탐지, 품질 평가, 자동 요약 등 "프롬프트 -> JSON 응답" 패턴에 사용.
 * runGeminiCLI를 호출한 뒤 JSON 파싱까지 처리한다.
 *
 * @param {string} prompt   - JSON 응답을 요구하는 프롬프트
 * @param {Object} options  - { timeoutMs, model }
 * @returns {Promise<Object>} 파싱된 JSON 객체
 */
export async function geminiCLIJson(prompt, options = {}) {
  const timeoutMs = options.timeoutMs || 30_000;
  const raw       = await runGeminiCLI("", prompt, {
    timeoutMs,
    model: options.model
  });
  const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Gemini CLI로 텍스트 생성 (stdin 컨텍스트 + -p 프롬프트)
 *
 * @param {string} stdinContent - stdin으로 전달할 컨텍스트
 * @param {string} prompt       - -p 옵션으로 전달할 지시 프롬프트
 * @param {Object} options      - 옵션 (timeoutMs)
 * @returns {Promise<string>} Gemini CLI 출력 텍스트
 */
export async function runGeminiCLI(stdinContent, prompt, options = {}) {
  const timeoutMs = options.timeoutMs || 360_000;

  return new Promise((resolve, reject) => {
    const args  = ["-p", prompt, "--output-format", "text", "-y"];
    const model = options.model;
    if (model) args.push("--model", model);

    const proc = spawn("gemini", args, {
      env:   { ...process.env },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout  = "";
    let stderr  = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`Gemini CLI timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`Gemini CLI spawn error: ${err.message}`));
      }
    });

    if (stdinContent) {
      proc.stdin.write(stdinContent, "utf8");
    }
    proc.stdin.end();
  });
}
