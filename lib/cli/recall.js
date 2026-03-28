/**
 * CLI: recall - 터미널에서 파편 검색
 *
 * 작성자: 최진호
 * 작성일: 2026-03-28
 */

import { MemoryManager }  from "../memory/MemoryManager.js";
import { shutdownPool }   from "../tools/db.js";

export default async function recall(args) {
  const query = args._.join(" ");
  if (!query) {
    console.error("Usage: memento recall <query> [--topic x] [--limit n] [--time-range from,to] [--json]");
    process.exit(1);
  }

  const mgr   = MemoryManager.create();
  const limit = args.limit ? parseInt(args.limit, 10) : 10;

  const params = {
    text        : query,
    keywords    : query.split(/\s+/),
    topic       : args.topic || undefined,
    type        : args.type  || undefined,
    tokenBudget : limit * 200,
    pageSize    : limit,
  };

  if (args["time-range"]) {
    const [from, to] = args["time-range"].split(",");
    params.timeRange = { from: from.trim(), to: to ? to.trim() : undefined };
  }

  try {
    const result = await mgr.recall(params);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const topicLabel = params.topic ? `, topic: ${params.topic}` : "";
    console.log(`Recall: "${query}" (limit: ${limit}${topicLabel})`);
    console.log("=".repeat(40));

    if (!result.fragments || result.fragments.length === 0) {
      console.log("(no results)");
      return;
    }

    for (let i = 0; i < result.fragments.length; i++) {
      const f       = result.fragments[i];
      const idShort = (f.id || "").slice(0, 16) + "...";
      const conf    = f.similarity !== undefined ? f.similarity.toFixed(2) : "--";
      const created = f.created_at ? new Date(f.created_at).toISOString().slice(0, 10) : "--";
      const ageDays = f.created_at
        ? Math.floor((Date.now() - new Date(f.created_at).getTime()) / 86400000)
        : "?";
      const access  = f.access_count ?? 0;

      console.log(`\n[${i + 1}] ${idShort} (confidence: ${conf}, age: ${ageDays}d, access: ${access})`);
      console.log(`    ${(f.content || "").slice(0, 120)} (${created})`);

      if (f.links && f.links.length > 0) {
        const linkStr = f.links
          .map(l => `${(l.to_id || l.from_id || "").slice(0, 12)} (${l.relation_type})`)
          .join(", ");
        console.log(`    linked: ${linkStr}`);
      }
    }

    if (result.hasMore) {
      console.log(`\n... ${result.totalCount - result.count} more results (total: ${result.totalCount})`);
    }
  } finally {
    await shutdownPool();
  }
}
