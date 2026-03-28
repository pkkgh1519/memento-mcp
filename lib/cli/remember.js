/**
 * CLI: remember - 터미널에서 파편 저장
 *
 * 작성자: 최진호
 * 작성일: 2026-03-28
 */

import { MemoryManager }  from "../memory/MemoryManager.js";
import { shutdownPool }   from "../tools/db.js";

const VALID_TYPES = new Set(["fact", "decision", "error", "preference", "procedure", "relation"]);

export default async function remember(args) {
  const content = args._.join(" ");
  if (!content || !args.topic) {
    console.error("Usage: memento remember <content> --topic x [--type fact] [--importance 0.7] [--json]");
    process.exit(1);
  }

  const type = args.type || "fact";
  if (!VALID_TYPES.has(type)) {
    console.error(`Invalid type: ${type}. Valid: ${[...VALID_TYPES].join(", ")}`);
    process.exit(1);
  }

  const mgr    = MemoryManager.create();
  const params = {
    content,
    topic      : args.topic,
    type,
    importance : args.importance ? parseFloat(args.importance) : undefined,
    keywords   : args.keywords  ? args.keywords.split(",").map(k => k.trim()) : undefined,
    source     : args.source    || "cli",
  };

  try {
    const result = await mgr.remember(params);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log("Fragment stored");
    console.log("===============");
    console.log(`ID:       ${result.id}`);
    console.log(`Keywords: ${(result.keywords || []).join(", ")}`);
    console.log(`TTL tier: ${result.ttl_tier}`);
    console.log(`Scope:    ${result.scope}`);

    if (result.conflicts && result.conflicts.length > 0) {
      console.log(`\nConflicts detected (${result.conflicts.length}):`);
      for (const c of result.conflicts) {
        console.log(`  - ${c.id?.slice(0, 16)}... similarity: ${c.similarity?.toFixed(2) ?? "--"}`);
      }
    }

    if (result.low_importance_warning) {
      console.log(`\nWarning: ${result.low_importance_warning}`);
    }
  } finally {
    await shutdownPool();
  }
}
