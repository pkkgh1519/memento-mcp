#!/usr/bin/env node
/**
 * 기존 노이즈 파편 정리 스크립트
 *
 * 사용법:
 *   node scripts/cleanup-noise.js --dry-run      # 삭제 대상 미리보기 (기본값)
 *   node scripts/cleanup-noise.js --execute       # 실제 삭제
 *   node scripts/cleanup-noise.js --include-nli   # NLI 재귀 쓰레기 포함
 *
 * 삭제 대상 (보수적 AND 조건):
 *   1. 초단문 (<10자, access_count<=1, 앵커 아님)
 *   2. 빈 세션 요약 ("파편 0개 처리" 포함, importance<0.3)
 *   3. NLI 재귀 쓰레기 (--include-nli 시에만, "[모순 해결]" 접두사, access_count<=1, importance<0.3)
 */
import pg from "pg";

const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const args       = process.argv.slice(2);
const execute    = args.includes("--execute");
const includeNli = args.includes("--include-nli");

const CATEGORIES = [
  {
    name:  "Short fragments (<10 chars)",
    where: "length(content) < 10 AND access_count <= 1 AND is_anchor IS NOT TRUE",
    always: true,
  },
  {
    name:  "Empty session summaries",
    where: "type = 'fact' AND content LIKE '%파편 0개 처리%' AND importance < 0.3",
    always: true,
  },
  {
    name:  "NLI recursion garbage",
    where: "content LIKE '[모순 해결]%' AND access_count <= 1 AND importance < 0.3",
    always: false,
  },
];

async function run() {
  const pool   = new pg.Pool({ connectionString: DB_URL });
  const client = await pool.connect();

  try {
    const mode = execute ? "Execute mode" : "Dry run mode (use --execute to delete)";
    console.log(`[cleanup-noise] ${mode}\n`);

    let totalCount = 0;

    for (let i = 0; i < CATEGORIES.length; i++) {
      const cat = CATEGORIES[i];

      if (!cat.always && !includeNli) continue;

      const label = `Category ${i + 1}: ${cat.name}`;

      const selectSql = `
        SELECT id, LEFT(content, 50) AS preview, type, importance, access_count
        FROM agent_memory.fragments
        WHERE ${cat.where}
      `;

      const { rows } = await client.query(selectSql);
      console.log(label);
      console.log(`  Found: ${rows.length} fragments`);

      for (const row of rows.slice(0, 5)) {
        const preview = row.preview.replace(/\n/g, " ");
        console.log(
          `  Sample: [${row.id}] "${preview}" (${row.type}, imp=${row.importance}, access=${row.access_count})`
        );
      }

      if (rows.length > 5) {
        console.log(`  ... and ${rows.length - 5} more`);
      }

      console.log();
      totalCount += rows.length;

      if (execute && rows.length > 0) {
        const deleteSql = `DELETE FROM agent_memory.fragments WHERE ${cat.where}`;
        const result    = await client.query(deleteSql);
        console.log(`  Deleted: ${result.rowCount} fragments\n`);
      }
    }

    if (execute) {
      console.log(`Total: ${totalCount} fragments deleted`);
    } else {
      console.log(`Total: ${totalCount} fragments would be deleted`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error("[cleanup-noise] Failed:", err.message);
  process.exit(1);
});
