/**
 * CLI: inspect - 파편 상세 + 1-hop 링크 조회
 *
 * MemoryManager 없이 DB 직접 쿼리 (경량).
 *
 * 작성자: 최진호
 * 작성일: 2026-03-28
 */

import { getPrimaryPool, shutdownPool } from "../tools/db.js";

export default async function inspect(args) {
  const id = args._[0];
  if (!id) {
    console.error("Usage: memento inspect <fragment-id> [--json]");
    process.exit(1);
  }

  const pool = getPrimaryPool();

  try {
    const fragResult = await pool.query(
      `SELECT id, content, topic, type, importance, utility_score,
              ema_score, access_count, created_at, last_accessed_at,
              is_anchor, ttl_tier, valid_from, valid_to, key_id,
              agent_id, source, keywords, metadata
       FROM agent_memory.fragments
       WHERE id = $1`,
      [id]
    );

    if (fragResult.rows.length === 0) {
      console.error(`Fragment not found: ${id}`);
      process.exit(1);
    }

    const frag = fragResult.rows[0];

    const outLinks = await pool.query(
      `SELECT fl.to_id, fl.relation_type, fl.weight, LEFT(f.content, 60) AS preview
       FROM agent_memory.fragment_links fl
       JOIN agent_memory.fragments f ON f.id = fl.to_id
       WHERE fl.from_id = $1
       ORDER BY fl.weight DESC`,
      [id]
    );

    const inLinks = await pool.query(
      `SELECT fl.from_id, fl.relation_type, fl.weight, LEFT(f.content, 60) AS preview
       FROM agent_memory.fragment_links fl
       JOIN agent_memory.fragments f ON f.id = fl.from_id
       WHERE fl.to_id = $1
       ORDER BY fl.weight DESC`,
      [id]
    );

    if (args.json) {
      console.log(JSON.stringify({
        fragment  : frag,
        outLinks  : outLinks.rows,
        inLinks   : inLinks.rows,
      }, null, 2));
      return;
    }

    console.log(`Fragment: ${frag.id}`);
    console.log("=".repeat(30));
    console.log(`Content:    ${(frag.content || "").slice(0, 200)}`);
    console.log(`Topic:      ${frag.topic || "--"}`);
    console.log(`Type:       ${frag.type || "--"}`);
    console.log(`Importance: ${frag.importance ?? "--"}`);
    console.log(`Utility:    ${frag.utility_score ?? "--"}`);
    console.log(`EMA:        ${frag.ema_score ?? "--"}`);
    console.log(`Access:     ${frag.access_count ?? 0}`);
    console.log(`Created:    ${frag.created_at ? new Date(frag.created_at).toISOString() : "--"}`);
    console.log(`Accessed:   ${frag.last_accessed_at ? new Date(frag.last_accessed_at).toISOString() : "--"}`);
    console.log(`Anchor:     ${frag.is_anchor ? "Yes" : "No"}`);
    console.log(`TTL tier:   ${frag.ttl_tier || "--"}`);
    console.log(`Valid from: ${frag.valid_from ? new Date(frag.valid_from).toISOString() : "--"}`);
    console.log(`Valid to:   ${frag.valid_to ? new Date(frag.valid_to).toISOString() : "--"}`);

    if (frag.key_id)   console.log(`Key ID:     ${frag.key_id}`);
    if (frag.agent_id) console.log(`Agent ID:   ${frag.agent_id}`);
    if (frag.source)   console.log(`Source:     ${frag.source}`);

    if (frag.keywords && frag.keywords.length > 0) {
      console.log(`Keywords:   ${Array.isArray(frag.keywords) ? frag.keywords.join(", ") : frag.keywords}`);
    }

    const totalLinks = outLinks.rows.length + inLinks.rows.length;
    if (totalLinks > 0) {
      console.log(`\nLinks (${totalLinks}):`);
      for (const l of outLinks.rows) {
        console.log(`  -> ${l.to_id} (${l.relation_type}, weight: ${l.weight ?? "--"}) "${l.preview || ""}"`);
      }
      for (const l of inLinks.rows) {
        console.log(`  <- ${l.from_id} (${l.relation_type}, weight: ${l.weight ?? "--"}) "${l.preview || ""}"`);
      }
    } else {
      console.log("\nLinks: (none)");
    }
  } finally {
    await shutdownPool();
  }
}
