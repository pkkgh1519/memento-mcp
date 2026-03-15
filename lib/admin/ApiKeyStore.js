/**
 * Admin: API 키 저장소
 *
 * 작성자: 최진호
 * 작성일: 2026-03-03
 *
 * 보안 원칙:
 * - 원시 키(raw key)는 생성 시 단 1회만 반환, DB에는 SHA-256 해시만 저장
 * - key_prefix(앞 14자)는 UI 표시 전용
 * - incrementUsage는 fire-and-forget (인증 경로 지연 최소화)
 */

import { createHash, randomBytes } from "node:crypto";
import { getPrimaryPool }          from "../tools/db.js";

/** SHA-256 해시 */
function hashKey(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * 새 원시 키 생성
 * 형식: mmcp_<8자 슬러그>_<32 hex chars>
 */
function generateRawKey(name) {
  const slug   = name.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "key";
  const random = randomBytes(16).toString("hex");
  return `mmcp_${slug}_${random}`;
}

/** ─── 공개 API ────────────────────────────────────────── */

/**
 * 전체 API 키 목록 조회 (원시 키 미포함)
 * @returns {Promise<Array>}
 */
export async function listApiKeys() {
  const pool        = getPrimaryPool();
  const { rows }    = await pool.query(`
    SELECT
      k.id,
      k.name,
      k.key_prefix,
      k.permissions,
      k.status,
      k.daily_limit,
      k.last_used_at,
      k.created_at,
      COALESCE(u.call_count, 0) AS usage_today,
      COALESCE(
        (SELECT json_agg(json_build_object('id', g.id, 'name', g.name))
         FROM agent_memory.api_key_group_members m
         JOIN agent_memory.api_key_groups g ON g.id = m.group_id
         WHERE m.key_id = k.id),
        '[]'::json
      ) AS groups
    FROM  agent_memory.api_keys k
    LEFT JOIN agent_memory.api_key_usage u
      ON  u.key_id = k.id
      AND u.usage_date = CURRENT_DATE
    ORDER BY k.created_at DESC
  `);
  return rows;
}

/**
 * API 키 생성
 * raw_key 는 이 응답에서만 반환 — 이후 재조회 불가
 *
 * @param {{ name: string, permissions?: string[], daily_limit?: number }} opts
 * @returns {Promise<{ id, name, key_prefix, permissions, status, daily_limit, created_at, raw_key }>}
 */
export async function createApiKey({ name, permissions = ["read"], daily_limit = 10000 }) {
  const pool          = getPrimaryPool();
  const rawKey        = generateRawKey(name);
  const hash          = hashKey(rawKey);
  const prefix        = rawKey.slice(0, 14);

  const { rows }      = await pool.query(`
    INSERT INTO agent_memory.api_keys
      (name, key_hash, key_prefix, permissions, daily_limit)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, key_prefix, permissions, status, daily_limit, created_at
  `, [name, hash, prefix, permissions, daily_limit]);

  return { ...rows[0], raw_key: rawKey };
}

/**
 * API 키 상태 변경 (active ↔ inactive)
 *
 * @param {string} id
 * @param {'active'|'inactive'} status
 */
export async function updateApiKeyStatus(id, status) {
  if (!["active", "inactive"].includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const pool        = getPrimaryPool();
  const { rows }    = await pool.query(`
    UPDATE agent_memory.api_keys
    SET    status = $2
    WHERE  id     = $1
    RETURNING id, name, status
  `, [id, status]);

  if (!rows.length) throw new Error("Key not found");
  return rows[0];
}

/**
 * API 키 삭제 (+ cascade로 usage 행 삭제)
 *
 * @param {string} id
 */
export async function deleteApiKey(id) {
  const pool          = getPrimaryPool();
  const { rowCount }  = await pool.query(
    "DELETE FROM agent_memory.api_keys WHERE id = $1",
    [id]
  );
  if (!rowCount) throw new Error("Key not found");
}

/**
 * 원시 키로 DB 인증 검증 (MCP 요청 인증 fallback용)
 *
 * @param {string} rawKey
 * @returns {Promise<{ valid: boolean, keyId?: string, permissions?: string[], reason?: string }>}
 */
export async function validateApiKeyFromDB(rawKey) {
  const pool        = getPrimaryPool();
  const hash        = hashKey(rawKey);

  const { rows }    = await pool.query(`
    SELECT
      k.id,
      k.permissions,
      k.status,
      k.daily_limit,
      COALESCE(u.call_count, 0) AS usage_today
    FROM  agent_memory.api_keys k
    LEFT JOIN agent_memory.api_key_usage u
      ON  u.key_id = k.id
      AND u.usage_date = CURRENT_DATE
    WHERE k.key_hash = $1
  `, [hash]);

  if (!rows.length)                           return { valid: false };

  const key = rows[0];
  if (key.status !== "active")                return { valid: false, reason: "inactive" };
  if (key.usage_today >= key.daily_limit)     return { valid: false, reason: "limit_exceeded" };

  /** 그룹 소속 키 조회: 같은 그룹의 모든 key_id를 수집 */
  const { rows: groupRows } = await pool.query(`
    SELECT DISTINCT m2.key_id
    FROM   agent_memory.api_key_group_members m1
    JOIN   agent_memory.api_key_group_members m2 ON m1.group_id = m2.group_id
    WHERE  m1.key_id = $1
  `, [key.id]);

  const groupKeyIds = groupRows.length > 0
    ? groupRows.map(r => r.key_id)
    : [key.id];

  return { valid: true, keyId: key.id, groupKeyIds, permissions: key.permissions };
}

/**
 * 사용량 증가 — fire-and-forget (인증 경로 지연 방지)
 *
 * @param {string} keyId
 */
export function incrementUsage(keyId) {
  const pool = getPrimaryPool();

  pool.query(`
    INSERT INTO agent_memory.api_key_usage (key_id, usage_date, call_count)
    VALUES ($1, CURRENT_DATE, 1)
    ON CONFLICT (key_id, usage_date)
    DO UPDATE SET call_count = api_key_usage.call_count + 1
  `, [keyId]).catch(err =>
    console.error("[ApiKey] increment usage error:", err.message)
  );

  pool.query(
    "UPDATE agent_memory.api_keys SET last_used_at = NOW() WHERE id = $1",
    [keyId]
  ).catch(err =>
    console.error("[ApiKey] last_used_at update error:", err.message)
  );
}

/** ─── 그룹 API ────────────────────────────────────────── */

export async function listKeyGroups() {
  const pool     = getPrimaryPool();
  const { rows } = await pool.query(`
    SELECT g.id, g.name, g.description, g.created_at,
           COUNT(m.key_id)::int AS key_count
    FROM   agent_memory.api_key_groups g
    LEFT JOIN agent_memory.api_key_group_members m ON m.group_id = g.id
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `);
  return rows;
}

export async function createKeyGroup({ name, description = null }) {
  const pool     = getPrimaryPool();
  const { rows } = await pool.query(`
    INSERT INTO agent_memory.api_key_groups (name, description)
    VALUES ($1, $2)
    RETURNING id, name, description, created_at
  `, [name, description]);
  return rows[0];
}

export async function deleteKeyGroup(id) {
  const pool         = getPrimaryPool();
  const { rowCount } = await pool.query(
    "DELETE FROM agent_memory.api_key_groups WHERE id = $1",
    [id]
  );
  if (!rowCount) throw new Error("Group not found");
}

export async function addKeyToGroup(keyId, groupId) {
  const pool = getPrimaryPool();
  await pool.query(`
    INSERT INTO agent_memory.api_key_group_members (group_id, key_id)
    VALUES ($1, $2)
    ON CONFLICT (group_id, key_id) DO NOTHING
  `, [groupId, keyId]);
  return { keyId, groupId, added: true };
}

export async function removeKeyFromGroup(keyId, groupId) {
  const pool         = getPrimaryPool();
  const { rowCount } = await pool.query(`
    DELETE FROM agent_memory.api_key_group_members
    WHERE group_id = $1 AND key_id = $2
  `, [groupId, keyId]);
  return { keyId, groupId, removed: rowCount > 0 };
}

export async function getGroupMembers(groupId) {
  const pool     = getPrimaryPool();
  const { rows } = await pool.query(`
    SELECT k.id, k.name, k.key_prefix, k.status, m.joined_at
    FROM   agent_memory.api_key_group_members m
    JOIN   agent_memory.api_keys k ON k.id = m.key_id
    WHERE  m.group_id = $1
    ORDER BY m.joined_at ASC
  `, [groupId]);
  return rows;
}
