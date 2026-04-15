/**
 * MorphemeIndex - 형태소 사전 관리 및 형태소 기반 임베딩 조회
 *
 * 작성자: 최진호
 * 작성일: 2026-03-10
 *
 * Gemini CLI로 텍스트를 형태소로 분리하고,
 * agent_memory.morpheme_dict 테이블에 형태소별 임베딩을 캐시한다.
 */

import { getPrimaryPool }                                          from "../tools/db.js";
import { generateEmbedding, vectorToSql, EMBEDDING_ENABLED }      from "../tools/embedding.js";
import { geminiCLIJson, isGeminiCLIAvailable }                    from "../gemini.js";
import { MEMORY_CONFIG }                                          from "../../config/memory.js";
import { logInfo, logWarn }                                       from "../logger.js";

const SCHEMA = "agent_memory";

export class MorphemeIndex {

  /**
   * 텍스트를 형태소 목록으로 분리
   *
   * LLM provider chain(gemini-cli → LLM_FALLBACKS)을 경유한다.
   * 모든 provider 실패 시 _fallbackTokenize로 graceful degrade.
   *
   * @param {string} text
   * @returns {Promise<string[]>} 형태소 목록 (기본형)
   */
  async tokenize(text) {
    if (!await isGeminiCLIAvailable()) return this._fallbackTokenize(text);

    const cfg     = MEMORY_CONFIG.morphemeIndex || {};
    const maxMorp = cfg.maxMorphemes || 10;

    /** System prompt — 외부 LLM이 JSON 배열만 출력하도록 엄격히 지시.
     *  OpenAI-compatible/Anthropic/Google/Ollama/Cohere provider는 system role로 분리 전달.
     *  gemini-cli는 prompt 앞에 prepend되어 동일 효과. */
    const systemPrompt =
      "You are a JSON array generator for morpheme extraction. " +
      "Your ONLY output MUST be a valid JSON array of strings. " +
      "Do NOT include markdown fences, explanations, reasoning, preambles, or ANY other text. " +
      "Output must be directly parseable by JSON.parse(). " +
      "Format: [\"item1\",\"item2\",\"item3\"]";

    /** User prompt — 작업 규칙 + few-shot 예시로 응답 품질 고정 */
    const userPrompt =
      `Extract base-form morphemes from the following text (Korean and/or English).\n` +
      `Include: nouns, verb roots, adjective roots\n` +
      `Exclude: particles (조사), endings (어미), conjunctions, pronouns, stopwords\n` +
      `Maximum ${maxMorp} items. Each item 1-20 characters.\n\n` +
      `Example 1:\n` +
      `Input: "나는 오늘 서울에서 커피를 마셨다"\n` +
      `Output: ["오늘","서울","커피","마시"]\n\n` +
      `Example 2:\n` +
      `Input: "The quick brown fox jumps over lazy dog"\n` +
      `Output: ["quick","brown","fox","jump","lazy","dog"]\n\n` +
      `Now process this input:\n` +
      `Input: "${text.replace(/"/g, '\\"')}"\n` +
      `Output:`;

    try {
      const result = await geminiCLIJson(userPrompt, {
        timeoutMs   : cfg.geminiTimeoutMs || 45_000,
        systemPrompt
      });
      if (!Array.isArray(result)) return this._fallbackTokenize(text);
      return result.filter(m => typeof m === "string" && m.trim().length > 0).slice(0, maxMorp);
    } catch (err) {
      logWarn(`[MorphemeIndex] tokenize failed: ${err.message}`);
      return this._fallbackTokenize(text);
    }
  }

  /**
   * Gemini 불가 시 단순 공백 분리 fallback
   */
  _fallbackTokenize(text) {
    const stopwords = new Set(["이", "그", "저", "것", "수", "등", "및", "를", "을", "에",
      "의", "가", "는", "은", "도", "로", "와", "과", "한", "하",
      "the", "a", "an", "is", "are", "was", "were"]);
    return text.toLowerCase()
      .replace(/[^\w\sㄱ-ㅎ가-힣]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopwords.has(w))
      .slice(0, 10);
  }

  /**
   * 형태소 목록의 임베딩을 사전에서 조회
   * 사전에 없는 형태소는 임베딩 API로 생성 후 등록
   *
   * @param {string[]} morphemes
   * @returns {Promise<number[][]>} 임베딩 벡터 목록
   */
  async getOrRegisterEmbeddings(morphemes) {
    if (!EMBEDDING_ENABLED || morphemes.length === 0) return [];

    const pool = getPrimaryPool();
    if (!pool) return [];

    const placeholders = morphemes.map((_, i) => `$${i + 1}`).join(", ");
    const existing = await pool.query(
      `SELECT morpheme, embedding::text FROM ${SCHEMA}.morpheme_dict
       WHERE morpheme = ANY(ARRAY[${placeholders}])`,
      morphemes
    );

    const found   = new Map(existing.rows.map(r => [r.morpheme, r.embedding]));
    const missing = morphemes.filter(m => !found.has(m));

    /** 신규 형태소 임베딩 생성 및 등록 (배치 병렬 처리) */
    const BATCH_SIZE = 10;
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (morpheme) => {
        try {
          const vec    = await generateEmbedding(morpheme);
          const vecStr = vectorToSql(vec);

          await pool.query(
            `INSERT INTO ${SCHEMA}.morpheme_dict (morpheme, embedding)
             VALUES ($1, $2::vector)
             ON CONFLICT (morpheme) DO NOTHING`,
            [morpheme, vecStr]
          );

          found.set(morpheme, vec);
          logInfo(`[MorphemeIndex] Registered morpheme: "${morpheme}"`);
        } catch (err) {
          logWarn(`[MorphemeIndex] embed failed for "${morpheme}": ${err.message}`);
        }
      }));
    }

    /** 조회 순서 유지하여 벡터 목록 반환 */
    const vectors = [];
    for (const m of morphemes) {
      const v = found.get(m);
      if (v) {
        vectors.push(typeof v === "string" ? JSON.parse(v) : v);
      }
    }

    return vectors;
  }

  /**
   * 벡터 목록의 평균 벡터 계산
   *
   * @param {number[][]} vectors
   * @returns {number[]|null}
   */
  averageVectors(vectors) {
    if (vectors.length === 0) return null;
    const dim = vectors[0].length;
    const sum = new Array(dim).fill(0);
    for (const v of vectors) {
      for (let i = 0; i < dim; i++) sum[i] += v[i];
    }
    return sum.map(x => x / vectors.length);
  }

  /**
   * 텍스트 → 형태소 분리 → 임베딩 평균 벡터 반환
   * remember() 시 비동기 형태소 등록에도 사용
   *
   * @param {string} text
   * @returns {Promise<number[]|null>}
   */
  async textToMorphemeVector(text) {
    const morphemes = await this.tokenize(text);
    if (morphemes.length === 0) return null;
    const vectors = await this.getOrRegisterEmbeddings(morphemes);
    return this.averageVectors(vectors);
  }
}
