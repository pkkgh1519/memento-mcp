#!/usr/bin/env node
/**
 * 경량 DB 마이그레이션 러너
 * agent_memory.schema_migrations 테이블에 적용 이력을 기록하고
 * 미적용 migration-NNN-*.sql 파일만 순서대로 실행한다.
 */
import fs   from "node:fs";
import path from "node:path";
import pg   from "pg";

const DB_URL        = process.env.DATABASE_URL;
const MIGRATION_DIR = path.join(import.meta.dirname, "../lib/memory");

if (!DB_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

async function migrate() {
  const pool   = new pg.Pool({ connectionString: DB_URL });
  const client  = await pool.connect();

  const MIGRATE_LOCK_ID = 73657;
  await client.query(`SELECT pg_advisory_lock(${MIGRATE_LOCK_ID})`);
  console.log("Migration lock acquired");

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_memory.schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query(
      "SELECT filename FROM agent_memory.schema_migrations ORDER BY filename"
    );
    const applied = new Set(rows.map(r => r.filename));

    const files = fs.readdirSync(MIGRATION_DIR)
      .filter(f => f.startsWith("migration-") && f.endsWith(".sql"))
      .sort();

    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
      console.log("All migrations already applied.");
      return;
    }

    console.log(`${pending.length} pending migration(s):`);

    for (const file of pending) {
      console.log(`  Applying ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO agent_memory.schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`  done.`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  FAILED: ${err.message}`);
        throw err;
      }
    }

    console.log(`${pending.length} migration(s) applied successfully.`);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATE_LOCK_ID})`);
    console.log("Migration lock released");
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
