/**
 * Admin 인증/세션 관리
 *
 * 작성자: 최진호
 * 작성일: 2026-03-27
 */

import crypto from "node:crypto";

import { ACCESS_KEY, ADMIN_ALLOWED_ORIGINS } from "../config.js";
import { validateMasterKey }                 from "../auth.js";

export const ADMIN_BASE = "/v1/internal/model/nothing";

/** 클라이언트에 안전한 에러 메시지만 반환 (DB 내부 정보 노출 방지) */
const SAFE_ERRORS = new Set(["Key not found", "Group not found", "name is required", "key_id is required"]);
export function safeErrorMessage(err) {
  if (SAFE_ERRORS.has(err.message)) return err.message;
  if (err.message.includes("unique")) return "Duplicate entry";
  if (err.message.includes("violates")) return "Constraint violation";
  return "Internal error";
}

/**
 * Admin 로그인 페이지 HTML
 */
const ADMIN_LOGIN_PAGE = `<!DOCTYPE html>
<html><head><title>Admin Login</title>
<style>body{background:#050a18;color:#e8edf8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
form{background:#0c1530;padding:2rem;border-radius:8px;border:1px solid rgba(255,255,255,0.07)}
input{background:#080f23;color:#e8edf8;border:1px solid rgba(255,255,255,0.07);padding:8px 12px;border-radius:4px;width:300px;margin:8px 0}
button{background:linear-gradient(135deg,#5b8ef0,#8b5cf6);color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer}</style>
</head><body><form onsubmit="fetch(location.pathname+'/auth',{method:'POST',headers:{'Authorization':'Bearer '+document.getElementById('k').value}}).then(r=>{if(r.ok)location.reload();else alert('Invalid key')});return false">
<div>Admin Access Key</div><input id="k" type="password" placeholder="Master Key" autofocus /><br/>
<button type="submit">Login</button></form></body></html>`;

/** Admin 세션: 토큰 -> 만료시각 */
const adminSessions     = new Map();
const ADMIN_SESSION_TTL = 24 * 60 * 60 * 1000;

function createAdminSession() {
  const token = crypto.randomUUID();
  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL);
  return token;
}

function isValidAdminSession(token) {
  const expiresAt = adminSessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function parseCookies(cookieHeader) {
  const result = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...vals] = pair.trim().split("=");
    if (key) result[key.trim()] = vals.join("=").trim();
  }
  return result;
}

/**
 * Admin 액세스 검증
 * Authorization 헤더 또는 세션 쿠키로 인증
 */
export function validateAdminAccess(req) {
  if (!ACCESS_KEY) return false;
  if (validateMasterKey(req)) return true;

  const cookies      = parseCookies(req.headers.cookie || "");
  const sessionToken = cookies["mmcp_session"];
  if (sessionToken && isValidAdminSession(sessionToken)) return true;

  return false;
}

/**
 * Admin 엔드포인트 Origin 검증
 * ADMIN_ALLOWED_ORIGINS 미설정(빈 Set) 시 모든 Origin 허용
 */
export function validateAdminOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin || ADMIN_ALLOWED_ORIGINS.size === 0) return true;
  if (!ADMIN_ALLOWED_ORIGINS.has(String(origin))) {
    res.statusCode = 403;
    res.end("Forbidden (Admin origin not allowed)");
    return false;
  }
  return true;
}

/** POST /auth 핸들러 */
export function handleAuth(req, res) {
  if (validateMasterKey(req)) {
    const token = createAdminSession();
    const isSecure   = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted;
    const securePart = isSecure ? " Secure;" : "";
    res.setHeader("Set-Cookie",
      `mmcp_session=${token}; HttpOnly; SameSite=Strict;${securePart} Path=${ADMIN_BASE}; Max-Age=86400`);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Invalid admin key" }));
  }
}

export { ADMIN_LOGIN_PAGE };
