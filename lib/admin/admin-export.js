/**
 * 파편 임포트/엑스포트 핸들러
 *
 * 작성자: 최진호
 * 작성일: 2026-03-27
 */
import { getPrimaryPool } from "../tools/db.js";
import { readJsonBody }   from "../utils.js";
import { logError }       from "../logger.js";
/* ADMIN_BASE: admin-auth.js에서 사용 가능하나 현재 핸들러는 pathname.endsWith()로 라우팅 */

/**
 * GET /export?key_id=xxx&topic=xxx - JSON Lines 스트림
 */
export async function handleExport(req, res, url) {
  if (req.method !== "GET" || !url.pathname.endsWith("/export")) return false;

  try {
    const pool  = getPrimaryPool();
    const keyId = url.searchParams.get("key_id");
    const topic = url.searchParams.get("topic");

    let query = `SELECT id, content, topic, type, keywords, importance,
                        source, agent_id, key_id, is_anchor,
                        created_at, accessed_at, valid_from, valid_to
                   FROM agent_memory.fragments WHERE 1=1`;
    const params = [];

    if (keyId) {
      params.push(keyId);
      query += ` AND key_id = $${params.length}`;
    }
    if (topic) {
      params.push(topic);
      query += ` AND topic = $${params.length}`;
    }
    query += " ORDER BY created_at";

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=fragments.jsonl");

    const result = await pool.query(query, params);
    for (const row of result.rows) {
      res.write(JSON.stringify(row) + "\n");
    }
    res.end();
  } catch (err) {
    logError("[Admin] /export error:", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Internal error" }));
  }
  return true;
}

/**
 * POST /import - JSON body { fragments: [...] }
 */
export async function handleImport(req, res, url) {
  if (req.method !== "POST" || !url.pathname.endsWith("/import")) return false;

  try {
    const body = await readJsonBody(req, res);
    if (!body || !Array.isArray(body.fragments)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "body.fragments array required" }));
      return true;
    }

    const pool     = getPrimaryPool();
    const required = ["content", "topic", "type"];
    let imported   = 0;
    let skipped    = 0;

    for (const frag of body.fragments) {
      if (!required.every(f => f in frag)) {
        skipped++;
        continue;
      }

      await pool.query(`
        INSERT INTO agent_memory.fragments
          (id, content, topic, type, keywords, importance, source, agent_id, key_id, is_anchor)
        VALUES
          (COALESCE($1, gen_random_uuid()::text), $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `, [
        frag.id ?? null,
        frag.content,
        frag.topic,
        frag.type,
        frag.keywords ?? [],
        frag.importance ?? 0.5,
        frag.source ?? null,
        frag.agent_id ?? "default",
        frag.key_id ?? null,
        frag.is_anchor ?? false
      ]);
      imported++;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ imported, skipped }));
  } catch (err) {
    logError("[Admin] /import error:", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Internal error" }));
  }
  return true;
}
