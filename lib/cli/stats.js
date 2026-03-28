/**
 * CLI stats 서브커맨드 - 파편 통계 조회
 *
 * 작성자: 최진호
 * 작성일: 2026-03-28
 */
import pg from 'pg';
import { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } from '../config.js';

const SCHEMA = 'agent_memory';

export default async function stats(opts) {
  const pool = new pg.Pool({
    host:     DB_HOST,
    port:     DB_PORT,
    database: DB_NAME,
    user:     DB_USER,
    password: DB_PASSWORD,
    max:      2,
  });

  try {
    const [countsRes, topicCountRes, avgUtilRes, noiseRes, topTopicsRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int                                          AS total,
          COUNT(*) FILTER (WHERE is_anchor = TRUE)::int         AS anchors,
          COUNT(*) FILTER (WHERE valid_to IS NULL)::int         AS active,
          COUNT(*) FILTER (WHERE valid_to IS NOT NULL)::int     AS expired
        FROM ${SCHEMA}.fragments
      `),
      pool.query(`
        SELECT COUNT(DISTINCT topic)::int AS cnt
        FROM ${SCHEMA}.fragments
      `),
      pool.query(`
        SELECT COALESCE(ROUND(AVG(utility_score)::numeric, 2), 0) AS avg
        FROM ${SCHEMA}.fragments
        WHERE valid_to IS NULL
      `),
      pool.query(`
        SELECT COUNT(*)::int AS cnt
        FROM ${SCHEMA}.fragments
        WHERE LENGTH(content) < 10
      `),
      pool.query(`
        SELECT topic, COUNT(*)::int AS cnt
        FROM ${SCHEMA}.fragments
        GROUP BY topic
        ORDER BY cnt DESC
        LIMIT 5
      `),
    ]);

    const counts    = countsRes.rows[0];
    const topics    = topicCountRes.rows[0].cnt;
    const avgUtil   = Number(avgUtilRes.rows[0].avg);
    const noiseCount = noiseRes.rows[0].cnt;
    const total     = counts.total || 1;
    const noiseRatio = ((noiseCount / total) * 100).toFixed(1);
    const topTopics = topTopicsRes.rows;

    if (opts.json) {
      const data = {
        fragments: counts.total,
        anchors:   counts.anchors,
        active:    counts.active,
        expired:   counts.expired,
        topics,
        avgUtility: avgUtil,
        noiseEstimate: { count: noiseCount, ratio: Number(noiseRatio) },
        topTopics: topTopics.map(r => ({ topic: r.topic, fragments: r.cnt })),
      };
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const pad = (label, val, indent = 0) => {
      const prefix = ' '.repeat(indent);
      return `${prefix}${label.padEnd(14 - indent)}${String(val).padStart(6)}`;
    };

    const lines = [
      'Memento MCP Statistics',
      '======================',
      pad('Fragments:', counts.total.toLocaleString()),
      pad('Anchors:',   counts.anchors.toLocaleString(), 2),
      pad('Active:',    counts.active.toLocaleString(), 2) + '  (valid_to IS NULL)',
      pad('Expired:',   counts.expired.toLocaleString(), 2),
      pad('Topics:',    topics.toLocaleString()),
      pad('Avg utility:', avgUtil),
      pad('Noise ratio:', `${noiseRatio}%`) + '  (est.)',
      '',
      'Top 5 topics:',
    ];

    for (const row of topTopics) {
      lines.push(`  ${row.topic.padEnd(18)} ${String(row.cnt).padStart(5)} fragments`);
    }

    console.log(lines.join('\n'));
  } finally {
    await pool.end();
  }
}
