/**
 * Admin HTTP 라우트 핸들러 — UI, 이미지, REST API
 *
 * 작성자: 최진호
 * 작성일: 2026-03-15
 */

import fs   from "node:fs";
import path from "node:path";
import os   from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/** 클라이언트에 안전한 에러 메시지만 반환 (DB 내부 정보 노출 방지) */
const SAFE_ERRORS = new Set(["Key not found", "Group not found", "name is required", "key_id is required"]);
function safeErrorMessage(err) {
  if (SAFE_ERRORS.has(err.message)) return err.message;
  if (err.message.includes("unique")) return "Duplicate entry";
  if (err.message.includes("violates")) return "Constraint violation";
  return "Internal error";
}

import { ACCESS_KEY, ADMIN_ALLOWED_ORIGINS, LOG_DIR } from "../config.js";
import { validateMasterKey, safeCompare }     from "../auth.js";
import { readJsonBody }                        from "../utils.js";
import { getSessionCounts }                    from "../sessions.js";
import { getPrimaryPool }                      from "../tools/db.js";
import { redisClient }                         from "../redis.js";
import {
  listApiKeys,
  createApiKey,
  updateApiKeyStatus,
  deleteApiKey,
  listKeyGroups,
  createKeyGroup,
  deleteKeyGroup,
  addKeyToGroup,
  removeKeyFromGroup,
  getGroupMembers
} from "./ApiKeyStore.js";
import { logError } from "../logger.js";

const ADMIN_BASE = "/v1/internal/model/nothing";

/**
 * Admin 로그인 페이지 HTML
 */
const ADMIN_LOGIN_PAGE = `<!DOCTYPE html>
<html><head><title>Admin Login</title>
<style>body{background:#050a18;color:#e8edf8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
form{background:#0c1530;padding:2rem;border-radius:8px;border:1px solid rgba(255,255,255,0.07)}
input{background:#080f23;color:#e8edf8;border:1px solid rgba(255,255,255,0.07);padding:8px 12px;border-radius:4px;width:300px;margin:8px 0}
button{background:linear-gradient(135deg,#5b8ef0,#8b5cf6);color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer}</style>
</head><body><form onsubmit="location.href=location.pathname+'?key='+document.getElementById('k').value;return false">
<div>Admin Access Key</div><input id="k" type="password" placeholder="Master Key" autofocus /><br/>
<button type="submit">Login</button></form></body></html>`;

/**
 * Admin 액세스 검증
 * 마스터 키 또는 쿼리스트링 key 파라미터로 인증
 */
function validateAdminAccess(req) {
  if (!ACCESS_KEY) return true;
  if (validateMasterKey(req)) return true;
  const url = new URL(req.url || "/", "http://localhost");
  const key = url.searchParams.get("key");
  if (key && safeCompare(key, ACCESS_KEY)) return true;
  return false;
}

/**
 * Admin 엔드포인트 Origin 검증
 * ADMIN_ALLOWED_ORIGINS 미설정(빈 Set) 시 모든 Origin 허용
 */
function validateAdminOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin || ADMIN_ALLOWED_ORIGINS.size === 0) return true;
  if (!ADMIN_ALLOWED_ORIGINS.has(String(origin))) {
    res.statusCode = 403;
    res.end("Forbidden (Admin origin not allowed)");
    return false;
  }
  return true;
}

/**
 * GET /v1/internal/model/nothing (Admin UI)
 */
export function handleAdminUi(req, res) {
  if (!validateAdminAccess(req)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(ADMIN_LOGIN_PAGE);
    return;
  }
  const htmlPath = path.join(__dirname, "..", "..", "assets", "admin", "index.html");
  fs.readFile(htmlPath, (err, data) => {
    if (err) { res.statusCode = 404; res.end("Admin UI not found"); return; }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(data);
  });
}

/**
 * GET /v1/internal/model/nothing/images/:file (Admin 이미지)
 */
export function handleAdminImage(req, res) {
  if (!validateAdminAccess(req)) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return;
  }
  const url      = new URL(req.url || "/", "http://localhost");
  const filename = path.basename(url.pathname);
  const imgPath  = path.join(__dirname, "..", "..", "assets", "images", filename);
  fs.readFile(imgPath, (err, data) => {
    if (err) { res.statusCode = 404; res.end("Image not found"); return; }
    const ext  = path.extname(filename).toLowerCase();
    const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(data);
  });
}

/**
 * Admin REST API 라우터
 * 마스터 키 인증 후 /keys, /stats, /activity 등을 처리
 */
export async function handleAdminApi(req, res) {
  if (!validateAdminOrigin(req, res)) return;

  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const url            = new URL(req.url || "/", "http://localhost");
  const isAuthEndpoint = req.method === "POST" && url.pathname === `${ADMIN_BASE}/auth`;

  if (!isAuthEndpoint && !validateMasterKey(req)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  /** POST /auth */
  if (req.method === "POST" && url.pathname === `${ADMIN_BASE}/auth`) {
    if (validateMasterKey(req)) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Invalid admin key" }));
    }
    return;
  }

  /** GET /stats */
  if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/stats`) {
    try {
      const pool = getPrimaryPool();

      const [fragR, callR, keyR] = await Promise.all([
        pool.query("SELECT COUNT(*) AS total FROM agent_memory.fragments"),
        pool.query(`SELECT COALESCE(SUM(call_count),0) AS total
                      FROM agent_memory.api_key_usage
                     WHERE usage_date = CURRENT_DATE`),
        pool.query("SELECT COUNT(*) AS total FROM agent_memory.api_keys WHERE status='active'"),
      ]);

      const cpus   = os.cpus();
      const cpuPct = Math.min(100, Math.round((os.loadavg()[0] / cpus.length) * 100));
      const memPct = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);

      let diskPct = 0;
      try {
        const d = fs.statfsSync("/");
        diskPct = Math.round(((d.blocks - d.bfree) / d.blocks) * 100);
      } catch { /* non-posix */ }

      let dbSizeBytes = 0;
      try {
        const { rows: [sr] } = await pool.query(
          "SELECT pg_database_size(current_database()) AS bytes"
        );
        dbSizeBytes = parseInt(sr.bytes);
      } catch { /* ignore */ }

      const redisStat = (redisClient && redisClient.status === "ready")
        ? "connected" : "disconnected";

      res.statusCode = 200;
      res.end(JSON.stringify({
        fragments:     parseInt(fragR.rows[0].total),
        sessions:      getSessionCounts().total,
        apiCallsToday: parseInt(callR.rows[0].total),
        activeKeys:    parseInt(keyR.rows[0].total),
        uptime:        Math.floor(process.uptime()),
        nodeVersion:   process.version,
        system:        { cpu: cpuPct, memory: memPct, disk: diskPct, dbSizeBytes },
        db:            "connected",
        redis:         redisStat,
      }));
    } catch (err) {
      logError("[Admin] /stats error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** GET /activity */
  if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/activity`) {
    try {
      const pool      = getPrimaryPool();
      const { rows }  = await pool.query(`
        SELECT f.id, f.topic, f.type, f.agent_id, f.key_id, f.created_at,
               LEFT(f.content, 80) AS preview,
               k.name              AS key_name,
               k.key_prefix
        FROM  agent_memory.fragments f
        LEFT JOIN agent_memory.api_keys k ON k.id = f.key_id
        ORDER BY f.created_at DESC
        LIMIT 10
      `);
      res.statusCode = 200;
      res.end(JSON.stringify(rows));
    } catch (err) {
      logError("[Admin] /activity error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** GET /keys */
  if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/keys`) {
    try {
      const keys = await listApiKeys();
      res.statusCode = 200;
      res.end(JSON.stringify(keys));
    } catch (err) {
      logError("[Admin] listApiKeys error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** POST /keys */
  if (req.method === "POST" && url.pathname === `${ADMIN_BASE}/keys`) {
    try {
      const body = await readJsonBody(req);
      if (!body.name || typeof body.name !== "string") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "name is required" }));
        return;
      }
      const key = await createApiKey({
        name:        body.name.trim(),
        permissions: Array.isArray(body.permissions) ? body.permissions : ["read"],
        daily_limit: Number(body.daily_limit) || 10000
      });
      res.statusCode = 201;
      res.end(JSON.stringify(key));
    } catch (err) {
      if (err.statusCode === 413) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Payload too large" }));
        return;
      }
      logError("[Admin] createApiKey error:", err);
      res.statusCode = err.message.includes("unique") ? 409 : 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** PUT /keys/:id */
  const putMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/keys\/([^/]+)$/);
  if (req.method === "PUT" && putMatch) {
    try {
      const body   = await readJsonBody(req);
      const result = await updateApiKeyStatus(putMatch[1], body.status);
      res.statusCode = 200;
      res.end(JSON.stringify(result));
    } catch (err) {
      if (err.statusCode === 413) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Payload too large" }));
        return;
      }
      logError("[Admin] updateApiKeyStatus error:", err);
      res.statusCode = err.message === "Key not found" ? 404 : 400;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** DELETE /keys/:id */
  const delMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/keys\/([^/]+)$/);
  if (req.method === "DELETE" && delMatch) {
    try {
      await deleteApiKey(delMatch[1]);
      res.statusCode = 204;
      res.end();
    } catch (err) {
      logError("[Admin] deleteApiKey error:", err);
      res.statusCode = err.message === "Key not found" ? 404 : 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** ─── 그룹 라우트 ─────────────────────────────────────── */

  /** GET /groups */
  if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/groups`) {
    try {
      const groups = await listKeyGroups();
      res.statusCode = 200;
      res.end(JSON.stringify(groups));
    } catch (err) {
      logError("[Admin] listKeyGroups error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** POST /groups */
  if (req.method === "POST" && url.pathname === `${ADMIN_BASE}/groups`) {
    try {
      const body = await readJsonBody(req);
      if (!body.name || typeof body.name !== "string") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "name is required" }));
        return;
      }
      const group = await createKeyGroup({
        name       : body.name.trim(),
        description: body.description || null
      });
      res.statusCode = 201;
      res.end(JSON.stringify(group));
    } catch (err) {
      logError("[Admin] createKeyGroup error:", err);
      res.statusCode = err.message.includes("unique") ? 409 : 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** /groups/:id/members 라우트 */
  const membersMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/groups\/([^/]+)\/members$/);
  if (membersMatch) {
    /** GET /groups/:id/members */
    if (req.method === "GET") {
      try {
        const members = await getGroupMembers(membersMatch[1]);
        res.statusCode = 200;
        res.end(JSON.stringify(members));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: safeErrorMessage(err) }));
      }
      return;
    }

    /** POST /groups/:id/members */
    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        if (!body.key_id) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "key_id is required" }));
          return;
        }
        const result = await addKeyToGroup(body.key_id, membersMatch[1]);
        res.statusCode = 200;
        res.end(JSON.stringify(result));
      } catch (err) {
        res.statusCode = err.message.includes("violates") ? 404 : 500;
        res.end(JSON.stringify({ error: safeErrorMessage(err) }));
      }
      return;
    }
  }

  /** DELETE /groups/:groupId/members/:keyId */
  const removeMemberMatch = url.pathname.match(
    /^\/v1\/internal\/model\/nothing\/groups\/([^/]+)\/members\/([^/]+)$/
  );
  if (req.method === "DELETE" && removeMemberMatch) {
    try {
      const result = await removeKeyFromGroup(removeMemberMatch[2], removeMemberMatch[1]);
      res.statusCode = 200;
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** DELETE /groups/:id */
  const delGroupMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/groups\/([^/]+)$/);
  if (req.method === "DELETE" && delGroupMatch) {
    try {
      await deleteKeyGroup(delGroupMatch[1]);
      res.statusCode = 200;
      res.end(JSON.stringify({ deleted: true }));
    } catch (err) {
      logError("[Admin] deleteKeyGroup error:", err);
      res.statusCode = err.message === "Group not found" ? 404 : 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return;
  }

  /** ─── 로그 뷰어 라우트 ─────────────────────────────────── */

  const LOG_FILE_RE = /^(\w+)-(\d{4}-\d{2}-\d{2})\.log$/;
  const LOG_LINE_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\]: (.*)$/;
  const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB

  /** GET /logs/files */
  if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/logs/files`) {
    try {
      const resolvedLogDir = path.resolve(LOG_DIR);
      const entries        = fs.readdirSync(resolvedLogDir);
      const files          = [];
      let   totalSize      = 0;

      for (const name of entries) {
        if (!name.endsWith(".log")) continue;
        const m = name.match(LOG_FILE_RE);
        if (!m) continue;
        const stat = fs.statSync(path.join(resolvedLogDir, name));
        files.push({ name, type: m[1], date: m[2], size: stat.size });
        totalSize += stat.size;
      }

      files.sort((a, b) => b.date.localeCompare(a.date));

      res.statusCode = 200;
      res.end(JSON.stringify({ files, totalSize, logDir: LOG_DIR }));
    } catch (err) {
      logError("[Admin] /logs/files error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Internal error" }));
    }
    return;
  }

  /** GET /logs/read?file=...&tail=200&level=...&search=... */
  if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/logs/read`) {
    try {
      const fileParam = url.searchParams.get("file");
      if (!fileParam) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "file parameter is required" }));
        return;
      }

      const basename    = path.basename(fileParam);
      const resolvedDir = path.resolve(LOG_DIR);
      const filePath    = path.join(resolvedDir, basename);

      if (!filePath.startsWith(resolvedDir + path.sep) && filePath !== resolvedDir) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }
      if (!basename.endsWith(".log")) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "Only .log files allowed" }));
        return;
      }

      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "File not found" }));
        return;
      }
      if (stat.size > MAX_LOG_SIZE) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "File exceeds 50MB limit" }));
        return;
      }

      const rawTail    = parseInt(url.searchParams.get("tail") ?? "200", 10);
      const tail       = Math.min(1000, Math.max(1, Number.isNaN(rawTail) ? 200 : rawTail));
      const levelParam = url.searchParams.get("level")?.toLowerCase() ?? null;
      const search     = url.searchParams.get("search") ?? null;

      const content  = fs.readFileSync(filePath, "utf-8");
      const rawLines = content.split("\n").filter(l => l.length > 0);
      const tailLines = rawLines.slice(-tail);

      /** 파싱: 정규식 비매칭 줄은 이전 항목의 message에 이어붙임 */
      const parsed = [];
      for (const line of tailLines) {
        const m = line.match(LOG_LINE_RE);
        if (m) {
          parsed.push({ timestamp: m[1], level: m[2], message: m[3] });
        } else if (parsed.length > 0) {
          parsed[parsed.length - 1].message += "\n" + line;
        }
      }

      const total = parsed.length;
      let filtered = parsed;

      if (levelParam) {
        filtered = filtered.filter(e => e.level === levelParam);
      }
      if (search) {
        const lower = search.toLowerCase();
        filtered = filtered.filter(e => e.message.toLowerCase().includes(lower));
      }

      res.statusCode = 200;
      res.end(JSON.stringify({
        file:     basename,
        lines:    filtered,
        total,
        filtered: filtered.length
      }));
    } catch (err) {
      logError("[Admin] /logs/read error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Internal error" }));
    }
    return;
  }

  /** GET /logs/stats */
  if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/logs/stats`) {
    try {
      const resolvedLogDir = path.resolve(LOG_DIR);
      const entries        = fs.readdirSync(resolvedLogDir);
      const logFiles       = entries.filter(n => n.endsWith(".log") && LOG_FILE_RE.test(n));

      let fileCount      = logFiles.length;
      let totalSizeBytes = 0;
      const dates        = [];

      for (const name of logFiles) {
        const stat = fs.statSync(path.join(resolvedLogDir, name));
        totalSizeBytes += stat.size;
        const m = name.match(LOG_FILE_RE);
        if (m) dates.push(m[2]);
      }

      dates.sort();
      const oldestFile = dates[0] ?? null;
      const newestFile = dates[dates.length - 1] ?? null;

      /** 오늘 날짜의 combined 로그에서 레벨별 카운트 */
      const today         = new Date().toISOString().slice(0, 10);
      const todayCombined = path.join(resolvedLogDir, `combined-${today}.log`);
      const todayCounts   = { info: 0, warn: 0, error: 0, debug: 0 };

      if (fs.existsSync(todayCombined)) {
        const lines = fs.readFileSync(todayCombined, "utf-8").split("\n");
        for (const line of lines) {
          const m = line.match(LOG_LINE_RE);
          if (m && todayCounts[m[2]] !== undefined) {
            todayCounts[m[2]]++;
          }
        }
      }

      /** 오늘 에러 로그에서 최근 10건 */
      const todayError    = path.join(resolvedLogDir, `error-${today}.log`);
      const recentErrors  = [];

      if (fs.existsSync(todayError)) {
        const lines = fs.readFileSync(todayError, "utf-8").split("\n").filter(l => l.length > 0);
        const last10 = lines.slice(-10);
        for (const line of last10) {
          const m = line.match(LOG_LINE_RE);
          if (m) {
            recentErrors.push({ timestamp: m[1], message: m[3] });
          }
        }
      }

      res.statusCode = 200;
      res.end(JSON.stringify({
        today:          todayCounts,
        recentErrors,
        fileCount,
        totalSizeBytes,
        oldestFile,
        newestFile
      }));
    } catch (err) {
      logError("[Admin] /logs/stats error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Internal error" }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
}
