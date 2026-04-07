/**
 * Memento MCP Admin Console — ESM Entry Point
 *
 * 작성자: 최진호
 * 작성일: 2026-03-26
 * 수정일: 2026-04-07 (ESM 모듈 분리)
 */

import { state, registerView, renderView } from "./modules/state.js";
import { renderLogin } from "./modules/auth.js";
import { renderSidebar, renderCommandBar } from "./modules/layout.js";
import { renderOverview } from "./modules/overview.js";
import { renderKeys } from "./modules/keys.js";
import { renderGroups } from "./modules/groups.js";
import { renderSessions } from "./modules/sessions.js";
import { renderGraph } from "./modules/graph.js";
import { renderLogs } from "./modules/logs.js";
import { renderMemory } from "./modules/memory.js";
import { api } from "./modules/api.js";

/* ── View Registration ── */
registerView("overview", renderOverview);
registerView("keys",     renderKeys);
registerView("groups",   renderGroups);
registerView("sessions", renderSessions);
registerView("graph",    renderGraph);
registerView("logs",     renderLogs);
registerView("memory",   renderMemory);

/* ── Bootstrap ── */
function init() {
  const urlKey = new URLSearchParams(window.location.search).get("key");
  if (urlKey && !state.masterKey) {
    state.masterKey = urlKey;
    sessionStorage.setItem("adminKey", urlKey);
  }

  if (state.masterKey) {
    api("/auth", { method: "POST", body: { key: state.masterKey } })
      .then(res => {
        if (res.ok) {
          document.getElementById("login-root")?.classList.add("hidden");
          document.getElementById("app")?.classList.add("visible");
          renderSidebar();
          renderCommandBar();
          renderView();
        } else {
          state.masterKey = "";
          sessionStorage.removeItem("adminKey");
          renderLogin();
        }
      });
  } else {
    renderLogin();
  }
}

document.addEventListener("DOMContentLoaded", init);
