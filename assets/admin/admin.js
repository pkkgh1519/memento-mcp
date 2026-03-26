/**
 * Memento MCP Admin Console -- Stitch Design Aligned SPA
 *
 * 작성자: 최진호
 * 작성일: 2026-03-26
 *
 * 보안 참고: 모든 동적 콘텐츠는 textContent를 통해 XSS 방어됨.
 * 이 콘솔은 마스터 키 인증 후에만 접근 가능한 내부 관리 도구임.
 */

/* ================================================================
   1. State Management
   ================================================================ */

const state = {
  masterKey:   sessionStorage.getItem("adminKey") || "",
  currentView: "overview",
  stats:       null,
  keys:        [],
  groups:      [],
  memoryData:  null,
  loading:     false,
  lastUpdated: null,

  selectedKeyId:   null,
  selectedGroupId: null,

  memoryFilter: { topic: "", type: "", key_id: "" },
  memoryPage:   1,
  memoryPages:  1,
  fragments:    [],
  selectedFragment: null,
  anomalies:    null,
  searchEvents: null
};

/* ================================================================
   2. API Client
   ================================================================ */

const API_BASE = "/v1/internal/model/nothing";

async function api(path, options = {}) {
  const url     = `${API_BASE}${path}`;
  const headers = { "Authorization": `Bearer ${state.masterKey}` };

  if (options.body && typeof options.body === "object") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  try {
    const resp = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    let data   = null;
    const ct   = resp.headers.get("content-type") || "";
    if (ct.includes("json") && resp.status !== 204) {
      data = await resp.json();
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

/* ================================================================
   3. Router
   ================================================================ */

function navigate(view) {
  state.currentView = view;
  renderSidebar();
  renderCommandBar();
  renderView();
}

function renderView() {
  const container = document.getElementById("view-container");
  if (!container) return;

  switch (state.currentView) {
    case "overview":  renderOverview(container);  break;
    case "keys":      renderKeys(container);      break;
    case "groups":    renderGroups(container);     break;
    case "memory":    renderMemory(container);     break;
    case "sessions":  renderScaffold(container, "sessions"); break;
    case "logs":      renderScaffold(container, "logs"); break;
    default:          renderOverview(container);
  }
}

function renderScaffold(container, viewId) {
  container.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "space-y-6";

  const scaffolds = {
    sessions: {
      title: "세션 관리",
      note:  "API 연동 대기 -- 현재 세션 수는 개요에서 확인 가능",
      sections: ["활성 세션 목록", "세션 상세", "만료된 세션 정리"]
    },
    logs: {
      title: "시스템 로그",
      note:  "API 연동 대기 -- Winston 로그 스트림 연동 예정",
      sections: ["로그 레벨 필터", "로그 목록", "로그 상세"]
    }
  };

  const cfg = scaffolds[viewId] ?? { title: viewId, note: "후속 구현 예정", sections: [] };

  const h = document.createElement("h2");
  h.className = "text-2xl font-headline font-bold tracking-tight";
  h.textContent = cfg.title;
  wrap.appendChild(h);

  const note = document.createElement("p");
  note.className = "text-sm text-slate-400 bg-surface-container-low p-4 border-l-2 border-secondary";
  note.textContent = cfg.note;
  wrap.appendChild(note);

  for (const label of cfg.sections) {
    const sec = document.createElement("div");
    sec.className = "bg-surface-container-low p-6 rounded-sm";
    const sh = document.createElement("h3");
    sh.className = "font-headline text-sm font-bold uppercase tracking-widest text-slate-400 mb-4";
    sh.textContent = label;
    sec.appendChild(sh);
    const ph = document.createElement("div");
    ph.className = "text-sm text-slate-600 text-center py-8 border border-dashed border-white/5";
    ph.textContent = "-- " + label + " --";
    sec.appendChild(ph);
    wrap.appendChild(sec);
  }

  container.appendChild(wrap);
}

/* ================================================================
   4. Toast System
   ================================================================ */

function showToast(message, type = "info") {
  const root = document.getElementById("toast-root");
  if (!root) return;

  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  root.appendChild(el);

  setTimeout(() => {
    el.classList.add("fade-out");
    el.addEventListener("animationend", () => el.remove());
  }, 3000);
}

/* ================================================================
   5. Modal System
   ================================================================ */

function showModal(title, bodyEl, actions) {
  const root = document.getElementById("modal-root");
  if (!root) return;

  root.textContent = "";

  const card = document.createElement("div");
  card.className = "modal-card";

  const titleEl = document.createElement("div");
  titleEl.className = "modal-title";
  titleEl.textContent = title;
  card.appendChild(titleEl);

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "modal-body";
  if (typeof bodyEl === "string") {
    bodyWrap.appendChild(buildSafeHtml(bodyEl));
  } else if (bodyEl instanceof Node) {
    bodyWrap.appendChild(bodyEl);
  }
  card.appendChild(bodyWrap);

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = "CANCEL";
  cancelBtn.addEventListener("click", closeModal);
  actionsWrap.appendChild(cancelBtn);

  if (actions && actions.length) {
    actions.forEach(a => {
      const btn = document.createElement("button");
      btn.className = "btn " + (a.cls || "");
      btn.textContent = a.label;
      if (a.handler) btn.addEventListener("click", a.handler);
      actionsWrap.appendChild(btn);
    });
  }

  card.appendChild(actionsWrap);
  root.appendChild(card);
  root.classList.add("visible");
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) {
    root.classList.remove("visible");
    root.textContent = "";
  }
}

function buildSafeHtml(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

/* ================================================================
   6. Login Screen
   ================================================================ */

function renderLogin() {
  const root = document.getElementById("login-root");
  if (!root) return;

  root.classList.remove("hidden");
  const app = document.getElementById("app");
  if (app) app.classList.remove("visible");

  root.textContent = "";
  const card = document.createElement("div");
  card.className = "login-card";

  const titleEl = document.createElement("div");
  titleEl.className = "login-title";
  titleEl.textContent = "MEMENTO MCP";
  card.appendChild(titleEl);

  const sub = document.createElement("div");
  sub.className = "login-sub";
  sub.textContent = "Operations Console Authentication Required";
  card.appendChild(sub);

  const input = document.createElement("input");
  input.type = "password";
  input.className = "login-input";
  input.id = "login-key";
  input.placeholder = "ACCESS_KEY";
  input.autocomplete = "off";
  card.appendChild(input);

  const errEl = document.createElement("div");
  errEl.className = "login-error";
  errEl.id = "login-error";
  errEl.textContent = "AUTHENTICATION FAILED";
  card.appendChild(errEl);

  const btn = document.createElement("button");
  btn.className = "login-btn";
  btn.id = "login-btn";
  btn.textContent = "AUTHENTICATE";
  card.appendChild(btn);

  root.appendChild(card);

  async function attemptLogin() {
    const key = input.value.trim();
    if (!key) return;

    btn.disabled = true;
    state.masterKey = key;

    const res = await api("/auth", { method: "POST", body: { key } });
    if (res.ok) {
      sessionStorage.setItem("adminKey", key);
      root.classList.add("hidden");
      const appEl = document.getElementById("app");
      if (appEl) appEl.classList.add("visible");
      navigate("overview");
    } else {
      errEl.classList.add("visible");
      state.masterKey = "";
      sessionStorage.removeItem("adminKey");
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", attemptLogin);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") attemptLogin(); });
}

function logout() {
  state.masterKey = "";
  sessionStorage.removeItem("adminKey");
  renderLogin();
}

/* ================================================================
   7. Sidebar (Stitch: #0c1326, Space Grotesk, Material Symbols)
   ================================================================ */

const NAV_ITEMS = [
  { id: "overview", label: "개요",       icon: "dashboard" },
  { id: "keys",     label: "API 키",     icon: "vpn_key" },
  { id: "groups",   label: "그룹",       icon: "group" },
  { id: "memory",   label: "메모리 운영", icon: "memory" },
  { id: "sessions", label: "세션",       icon: "settings_input_component", scaffold: true },
  { id: "logs",     label: "로그",       icon: "terminal", scaffold: true }
];

function renderSidebar() {
  const el = document.getElementById("sidebar");
  if (!el) return;

  el.textContent = "";

  /* Brand */
  const brand = document.createElement("div");
  brand.className = "px-6 mb-8";

  const brandTitle = document.createElement("div");
  brandTitle.className = "text-xl font-bold tracking-tighter text-cyan-400 font-headline";
  brandTitle.textContent = "MEMENTO MCP";
  brand.appendChild(brandTitle);

  const brandSub = document.createElement("div");
  brandSub.className = "text-[10px] text-slate-500 tracking-[0.2em] font-medium uppercase mt-1 font-label";
  brandSub.textContent = "OPERATIONS CONSOLE";
  brand.appendChild(brandSub);

  el.appendChild(brand);

  /* Nav */
  const nav = document.createElement("nav");
  nav.className = "flex-1 px-3 space-y-1";

  NAV_ITEMS.forEach(n => {
    const item = document.createElement("a");
    item.href = "#";
    const isActive = n.id === state.currentView;

    if (isActive) {
      item.className = "flex items-center gap-3 px-4 py-2.5 rounded-sm text-cyan-400 bg-cyan-400/10 border-l-2 border-cyan-400 transition-all duration-200";
    } else {
      item.className = "flex items-center gap-3 px-4 py-2.5 rounded-sm text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-all duration-200";
    }

    if (n.scaffold) {
      item.style.opacity = "0.4";
    }

    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-[20px]";
    icon.textContent = n.icon;
    item.appendChild(icon);

    const label = document.createElement("span");
    label.className = "text-sm font-medium";
    label.textContent = n.label;
    item.appendChild(label);

    if (!n.scaffold) {
      item.addEventListener("click", (e) => { e.preventDefault(); navigate(n.id); });
    } else {
      item.addEventListener("click", (e) => e.preventDefault());
    }
    nav.appendChild(item);
  });
  el.appendChild(nav);

  /* Bottom: Settings + Logout */
  const bottom = document.createElement("div");
  bottom.className = "px-3 py-4 border-t border-cyan-500/10 space-y-1 mt-auto";

  const logoutItem = document.createElement("a");
  logoutItem.href = "#";
  logoutItem.className = "flex items-center gap-3 px-4 py-2 text-slate-500 hover:text-red-400 transition-colors text-xs font-medium uppercase tracking-wider";
  const logoutIcon = document.createElement("span");
  logoutIcon.className = "material-symbols-outlined text-[18px]";
  logoutIcon.textContent = "logout";
  logoutItem.appendChild(logoutIcon);
  logoutItem.appendChild(document.createTextNode("LOGOUT"));
  logoutItem.addEventListener("click", (e) => { e.preventDefault(); logout(); });
  bottom.appendChild(logoutItem);

  el.appendChild(bottom);
}

/* ================================================================
   8. Command Bar (Stitch: bg-slate-950/60, PRODUCTION badge, status)
   ================================================================ */

const VIEW_TITLES = {
  overview: "Operations Overview",
  keys:     "API Key Management",
  groups:   "Group Management",
  memory:   "Memory Operations",
  sessions: "Session Management",
  logs:     "System Logs"
};

function renderCommandBar() {
  const el = document.getElementById("command-bar");
  if (!el) return;

  el.textContent = "";

  /* Left: Status badges */
  const left = document.createElement("div");
  left.className = "flex items-center gap-4";

  const envBadge = document.createElement("span");
  envBadge.className = "px-2 py-0.5 bg-cyan-400/10 text-cyan-400 border border-cyan-400/20 text-[10px] font-mono tracking-widest font-bold rounded-sm";
  envBadge.textContent = "PRODUCTION";
  left.appendChild(envBadge);

  const healthDot = document.createElement("div");
  healthDot.className = "flex items-center gap-2";
  const dot = document.createElement("div");
  dot.className = "w-1.5 h-1.5 bg-tertiary rounded-full pulsing-glow";
  dot.style.color = "#00fabf";
  healthDot.appendChild(dot);
  const healthText = document.createElement("span");
  healthText.className = "text-xs font-mono text-slate-400 uppercase tracking-tighter";
  healthText.textContent = "HEALTH: ONLINE";
  healthDot.appendChild(healthText);
  left.appendChild(healthDot);

  const sep = document.createElement("div");
  sep.className = "h-4 w-px bg-slate-800";
  left.appendChild(sep);

  const syncText = document.createElement("span");
  syncText.className = "text-[10px] font-mono text-slate-500 uppercase";
  syncText.textContent = "SYNCED: " + (state.lastUpdated ? relativeTime(state.lastUpdated) : "--");
  left.appendChild(syncText);

  el.appendChild(left);

  /* Right: actions */
  const right = document.createElement("div");
  right.className = "flex items-center gap-4";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "text-slate-400 hover:text-cyan-400 transition-all";
  const refreshIcon = document.createElement("span");
  refreshIcon.className = "material-symbols-outlined";
  refreshIcon.textContent = "refresh";
  refreshBtn.appendChild(refreshIcon);
  refreshBtn.addEventListener("click", () => renderView());
  right.appendChild(refreshBtn);

  const divider = document.createElement("div");
  divider.className = "h-8 w-px bg-white/10";
  right.appendChild(divider);

  const userInfo = document.createElement("div");
  userInfo.className = "flex items-center gap-3";
  const userText = document.createElement("div");
  userText.className = "text-right";
  const userName = document.createElement("div");
  userName.className = "text-xs font-bold text-slate-200 font-headline";
  userName.textContent = "ADMIN_ROOT";
  userText.appendChild(userName);
  const userLevel = document.createElement("div");
  userLevel.className = "text-[8px] font-mono text-slate-500";
  userLevel.textContent = "LVL 4 ACCESS";
  userText.appendChild(userLevel);
  userInfo.appendChild(userText);

  const userIcon = document.createElement("span");
  userIcon.className = "material-symbols-outlined text-slate-400 text-3xl";
  userIcon.textContent = "account_circle";
  userInfo.appendChild(userIcon);

  right.appendChild(userInfo);

  el.appendChild(right);
}

/* ================================================================
   9. Overview Dashboard (Stitch Screen 1)
   ================================================================ */

function renderOverviewCards(stats) {
  if (!stats) return loadingHtml();

  const queues = stats.queues ?? {};
  const cards  = [
    { label: "전체 파편",    value: fmt(stats.fragments),             color: "text-primary",   border: "bg-primary" },
    { label: "활성 세션",    value: fmt(stats.sessions),              color: "text-on-surface", border: "bg-cyan-500/50" },
    { label: "오늘 API 호출", value: fmt(stats.apiCallsToday),         color: "text-secondary",  border: "bg-secondary" },
    { label: "활성 키",      value: fmt(stats.activeKeys),            color: "text-on-surface", border: "bg-cyan-300" },
    { label: "임베딩 대기열", value: fmt(queues.embeddingBacklog ?? 0), color: "text-on-surface", border: "bg-slate-700" },
    { label: "품질 미검증",  value: fmt(queues.qualityPending ?? 0),  color: "text-tertiary",   border: "bg-tertiary" }
  ];

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8";

  cards.forEach(c => {
    const card = document.createElement("div");
    card.className = "bg-surface-container-low p-4 relative overflow-hidden group";
    card.dataset.kpi = c.label;

    const barEl = document.createElement("div");
    barEl.className = "absolute left-0 top-0 bottom-0 w-1 " + c.border;
    card.appendChild(barEl);

    const label = document.createElement("div");
    label.className = "text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1";
    label.textContent = c.label;
    card.appendChild(label);

    const val = document.createElement("div");
    val.className = "text-2xl font-bold font-headline " + c.color;
    val.textContent = c.value;
    card.appendChild(val);

    grid.appendChild(card);
  });
  return grid;
}

function renderHealthPanel(stats) {
  if (!stats) return null;
  const sys = stats.system ?? {};

  const panel = document.createElement("section");
  panel.className = "bg-surface-container-low p-6 rounded-sm shadow-xl";

  /* Header */
  const header = document.createElement("div");
  header.className = "flex justify-between items-center mb-6";
  const headerLeft = document.createElement("div");
  headerLeft.className = "flex items-center gap-3";
  const accent = document.createElement("div");
  accent.className = "w-1 h-5 bg-tertiary";
  headerLeft.appendChild(accent);
  const title = document.createElement("h2");
  title.className = "font-headline text-lg font-bold tracking-tight";
  title.textContent = "시스템 건전성";
  headerLeft.appendChild(title);
  header.appendChild(headerLeft);

  const badges = document.createElement("div");
  badges.className = "flex gap-2";
  const rtBadge = document.createElement("span");
  rtBadge.className = "px-2 py-1 bg-slate-900 text-[9px] font-mono text-slate-400";
  rtBadge.textContent = "REAL-TIME";
  badges.appendChild(rtBadge);
  const uptimeBadge = document.createElement("span");
  uptimeBadge.className = "px-2 py-1 bg-slate-900 text-[9px] font-mono text-slate-400";
  uptimeBadge.textContent = "UPTIME: " + (stats.uptime ?? "--");
  badges.appendChild(uptimeBadge);
  header.appendChild(badges);
  panel.appendChild(header);

  /* Bars */
  const barGrid = document.createElement("div");
  barGrid.className = "grid grid-cols-1 md:grid-cols-4 gap-6";

  function barColor(pct) {
    if (pct > 85) return "text-error";
    if (pct > 60) return "text-secondary";
    return "text-cyan-400";
  }

  function barBg(pct) {
    if (pct > 85) return "bg-error";
    if (pct > 60) return "bg-secondary";
    return "bg-cyan-400";
  }

  [
    { label: "CPU Usage",  pct: sys.cpu ?? 0 },
    { label: "Memory",     pct: sys.memory ?? 0 },
    { label: "Disk I/O",   pct: sys.disk ?? 0 },
    { label: "Queue",      pct: 0, custom: true }
  ].forEach(b => {
    const col = document.createElement("div");
    col.className = "space-y-2";

    const row = document.createElement("div");
    row.className = "flex justify-between text-[10px] font-mono text-slate-500 uppercase tracking-widest";

    const lbl = document.createElement("span");
    lbl.textContent = b.label;
    row.appendChild(lbl);

    const pctSpan = document.createElement("span");
    pctSpan.className = barColor(b.pct);
    pctSpan.textContent = b.pct + "%";
    row.appendChild(pctSpan);
    col.appendChild(row);

    const track = document.createElement("div");
    track.className = "h-1 bg-slate-900 w-full rounded-full overflow-hidden";
    const fill = document.createElement("div");
    fill.className = "h-full " + barBg(b.pct);
    fill.style.width = b.pct + "%";
    track.appendChild(fill);
    col.appendChild(track);

    barGrid.appendChild(col);
  });

  panel.appendChild(barGrid);

  /* Connection status */
  const connDiv = document.createElement("div");
  connDiv.className = "flex gap-6 mt-6 pt-4 border-t border-white/5";

  [
    { label: "PostgreSQL", status: stats.db },
    { label: "Redis",      status: stats.redis }
  ].forEach(c => {
    const item = document.createElement("div");
    item.className = "flex items-center gap-2";
    const cDot = document.createElement("div");
    const isOk = c.status === "connected";
    cDot.className = "w-1.5 h-1.5 rounded-full " + (isOk ? "bg-tertiary shadow-[0_0_8px_#00fabf]" : "bg-error shadow-[0_0_8px_#ffb4ab]");
    item.appendChild(cDot);
    const txt = document.createElement("span");
    txt.className = "text-[10px] font-mono text-slate-400 uppercase";
    txt.textContent = c.label + ": " + (c.status ?? "unknown");
    item.appendChild(txt);
    connDiv.appendChild(item);
  });

  panel.appendChild(connDiv);
  return panel;
}

function renderTimeline(activities) {
  const panel = document.createElement("section");
  panel.className = "bg-surface-container-low p-6 rounded-sm shadow-xl";

  const header = document.createElement("div");
  header.className = "flex justify-between items-center mb-6";
  const headerLeft = document.createElement("div");
  headerLeft.className = "flex items-center gap-3";
  const acc = document.createElement("div");
  acc.className = "w-1 h-5 bg-primary";
  headerLeft.appendChild(acc);
  const title = document.createElement("h2");
  title.className = "font-headline text-lg font-bold tracking-tight";
  title.textContent = "최근 메모리 활동";
  headerLeft.appendChild(title);
  header.appendChild(headerLeft);
  panel.appendChild(header);

  if (!activities || !activities.length) {
    const empty = document.createElement("div");
    empty.className = "text-sm text-slate-600 py-6 text-center";
    empty.textContent = "활동 없음";
    panel.appendChild(empty);
    return panel;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "overflow-hidden border border-cyan-500/5 rounded-sm";

  const table = document.createElement("table");
  table.className = "w-full text-left font-mono text-[11px]";

  const thead = document.createElement("thead");
  thead.className = "bg-slate-950/50 text-slate-500";
  const hRow = document.createElement("tr");
  ["Topic", "Type", "Agent", "Timestamp"].forEach(h => {
    const th = document.createElement("th");
    th.className = "px-4 py-3 font-medium uppercase tracking-widest";
    th.textContent = h;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.className = "divide-y divide-slate-900";

  activities.forEach(a => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-900/40 transition-colors";

    const td1 = document.createElement("td");
    td1.className = "px-4 py-4 text-cyan-200";
    td1.textContent = a.topic ?? "(무제)";
    tr.appendChild(td1);

    const td2 = document.createElement("td");
    td2.className = "px-4 py-4";
    const badge = document.createElement("span");
    badge.className = "px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm text-[10px] uppercase";
    badge.textContent = a.type ?? "?";
    td2.appendChild(badge);
    tr.appendChild(td2);

    const td3 = document.createElement("td");
    td3.className = "px-4 py-4 text-slate-400";
    td3.textContent = a.agent_id ?? a.key_name ?? "--";
    tr.appendChild(td3);

    const td4 = document.createElement("td");
    td4.className = "px-4 py-4 text-right text-slate-500";
    td4.textContent = a.created_at ? relativeTime(a.created_at) : "";
    tr.appendChild(td4);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  panel.appendChild(tableWrap);
  return panel;
}

function renderRiskPanel(stats) {
  const panel = document.createElement("section");
  panel.className = "bg-surface-container-low p-6 rounded-sm shadow-xl";

  const header = document.createElement("div");
  header.className = "flex items-center gap-3 mb-6";
  const acc = document.createElement("div");
  acc.className = "w-1 h-5 bg-error";
  header.appendChild(acc);
  const title = document.createElement("h2");
  title.className = "font-headline text-lg font-bold tracking-tight";
  title.textContent = "리스크 및 이상 징후";
  header.appendChild(title);
  panel.appendChild(header);

  const queues = stats?.queues ?? {};
  const risks = [
    { label: "Embedding Backlog", count: queues.embeddingBacklog ?? 0, icon: "hourglass_top", cls: "bg-secondary/10 border-secondary/20 text-secondary" },
    { label: "Low Quality Frags", count: queues.qualityPending ?? 0, icon: "low_priority", cls: "bg-slate-800 border-slate-700 text-slate-300" }
  ];

  const riskWrap = document.createElement("div");
  riskWrap.className = "flex flex-wrap gap-2";
  risks.forEach(r => {
    const chip = document.createElement("div");
    chip.className = "flex items-center gap-2 px-3 py-2 border rounded-sm " + r.cls;
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-sm";
    icon.textContent = r.icon;
    chip.appendChild(icon);
    const txt = document.createElement("span");
    txt.className = "text-[10px] font-mono font-bold uppercase";
    txt.textContent = r.label + (r.count > 0 ? " (" + r.count + ")" : "");
    chip.appendChild(txt);
    riskWrap.appendChild(chip);
  });
  panel.appendChild(riskWrap);

  return panel;
}

function renderQuickActions() {
  const panel = document.createElement("section");
  panel.className = "bg-surface-container-low p-6 rounded-sm shadow-xl";

  const header = document.createElement("div");
  header.className = "flex items-center gap-3 mb-6";
  const acc = document.createElement("div");
  acc.className = "w-1 h-5 bg-cyan-400";
  header.appendChild(acc);
  const title = document.createElement("h2");
  title.className = "font-headline text-lg font-bold tracking-tight";
  title.textContent = "빠른 작업";
  header.appendChild(title);
  panel.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-2 gap-3";

  [
    { icon: "vpn_key", label: "Create Key", view: "keys" },
    { icon: "group_add", label: "Create Group", view: "groups" },
    { icon: "build", label: "Run Maint", view: null },
    { icon: "history_edu", label: "Open Logs", view: "logs" }
  ].forEach(a => {
    const btn = document.createElement("button");
    btn.className = "flex flex-col items-center justify-center p-4 bg-slate-900/50 border border-cyan-500/10 hover:border-cyan-500/40 hover:bg-slate-800 transition-all group rounded-sm";

    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-cyan-400 mb-2";
    icon.textContent = a.icon;
    btn.appendChild(icon);

    const label = document.createElement("span");
    label.className = "text-[10px] font-bold text-slate-200 tracking-widest uppercase";
    label.textContent = a.label;
    btn.appendChild(label);

    if (a.view) {
      btn.addEventListener("click", () => navigate(a.view));
    }

    grid.appendChild(btn);
  });

  panel.appendChild(grid);
  return panel;
}

function renderSearchLatency(stats) {
  const sm = stats?.searchMetrics;

  const panel = document.createElement("div");
  panel.className = "bg-surface-container-low p-6 rounded-sm shadow-xl border-t border-primary/20";

  const title = document.createElement("div");
  title.className = "text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4";
  title.textContent = "검색 지연 시간";
  panel.appendChild(title);

  const items = document.createElement("div");
  items.className = "space-y-4";

  [
    { label: "L1 CACHE",    key: "l1", color: "text-tertiary" },
    { label: "L2 VECTOR",   key: "l2", color: "text-cyan-400" },
    { label: "L3 SEMANTIC", key: "l3", color: "text-secondary" }
  ].forEach(l => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between";
    const lbl = document.createElement("span");
    lbl.className = "text-[11px] font-mono text-slate-300";
    lbl.textContent = l.label;
    row.appendChild(lbl);
    const val = document.createElement("span");
    val.className = "text-sm font-bold " + l.color;
    val.textContent = sm?.[l.key]?.p50 != null ? fmtMs(sm[l.key].p50) : "--";
    row.appendChild(val);
    items.appendChild(row);
  });

  panel.appendChild(items);
  return panel;
}

async function renderOverview(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const [statsRes, activityRes] = await Promise.all([
    api("/stats"),
    api("/activity")
  ]);

  if (statsRes.ok) {
    state.stats = statsRes.data;
    state.lastUpdated = Date.now();
    renderCommandBar();
  }

  const activities = activityRes.ok ? activityRes.data : [];

  container.textContent = "";

  /* KPI Row */
  container.appendChild(renderOverviewCards(state.stats));

  /* Main Grid */
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-12 gap-6";

  /* Left Column */
  const leftCol = document.createElement("div");
  leftCol.className = "col-span-12 lg:col-span-8 space-y-6";

  const hp = renderHealthPanel(state.stats);
  if (hp) leftCol.appendChild(hp);
  leftCol.appendChild(renderTimeline(activities));
  grid.appendChild(leftCol);

  /* Right Column */
  const rightCol = document.createElement("div");
  rightCol.className = "col-span-12 lg:col-span-4 space-y-6";
  rightCol.appendChild(renderRiskPanel(state.stats));
  rightCol.appendChild(renderQuickActions());
  grid.appendChild(rightCol);

  container.appendChild(grid);

  /* Bottom: Search Latency */
  const bottomGrid = document.createElement("div");
  bottomGrid.className = "grid grid-cols-1 md:grid-cols-3 gap-6 mt-6";
  bottomGrid.appendChild(renderSearchLatency(state.stats));
  container.appendChild(bottomGrid);

  /* Backdrop accents */
  if (!document.querySelector(".backdrop-accent-primary")) {
    const bp = document.createElement("div");
    bp.className = "backdrop-accent-primary";
    document.body.appendChild(bp);
    const bs = document.createElement("div");
    bs.className = "backdrop-accent-secondary";
    document.body.appendChild(bs);
  }
}

/* ================================================================
   10. API Keys View (Stitch Screen 2)
   ================================================================ */

function renderKeyKpiRow(keys) {
  const total    = keys.length;
  const active   = keys.filter(k => k.status === "active").length;
  const inactive = total - active;
  const groups   = new Set(keys.flatMap(k => k.groups ?? [])).size;

  const cards = [
    { label: "ACTIVE KEYS",  value: active,   border: "bg-tertiary" },
    { label: "REVOKED KEYS", value: inactive,  border: "bg-error" },
    { label: "TOTAL GROUPS", value: groups,    border: "bg-secondary" },
    { label: "NO GROUP",     value: keys.filter(k => !k.groups?.length).length, border: "bg-primary" }
  ];

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-4 gap-4 mb-8";

  cards.forEach(c => {
    const card = document.createElement("div");
    card.className = "bg-surface-container-low p-4 relative overflow-hidden";

    const bar = document.createElement("div");
    bar.className = "absolute left-0 top-0 bottom-0 w-1 " + c.border;
    card.appendChild(bar);

    const label = document.createElement("p");
    label.className = "text-[10px] font-bold text-slate-500 tracking-widest uppercase mb-1 font-label";
    label.textContent = c.label;
    card.appendChild(label);

    const val = document.createElement("p");
    val.className = "text-3xl font-headline font-bold text-on-surface";
    val.textContent = fmt(c.value);
    card.appendChild(val);

    grid.appendChild(card);
  });

  return grid;
}

function renderKeyTable(keys) {
  const wrap = document.createElement("div");
  wrap.className = "bg-surface-container-low flex-1 flex flex-col min-h-0";

  const tableWrap = document.createElement("div");
  tableWrap.className = "overflow-x-auto";

  const table = document.createElement("table");
  table.className = "w-full text-left border-collapse";
  table.id = "keys-table";

  const thead = document.createElement("thead");
  const hRow = document.createElement("tr");
  hRow.className = "bg-white/5 border-b border-white/5";
  ["Name", "Prefix", "Status", "Groups", "Created", "Usage (24h)"].forEach(h => {
    const th = document.createElement("th");
    th.className = "px-6 py-4 text-[10px] font-bold text-slate-400 tracking-widest uppercase font-label";
    th.textContent = h;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.className = "divide-y divide-white/5";
  keys.forEach(k => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-white/5 transition-colors group cursor-pointer" + (k.id === state.selectedKeyId ? " bg-white/[0.02]" : "");
    tr.dataset.keyId = k.id;

    /* Name */
    const td1 = document.createElement("td");
    td1.className = "px-6 py-4";
    const nameWrap = document.createElement("div");
    nameWrap.className = "flex items-center gap-3";
    const statusDot = document.createElement("div");
    const isActive = k.status === "active";
    statusDot.className = "w-2 h-2 rounded-full " + (isActive ? "bg-tertiary shadow-[0_0_8px_rgba(0,250,191,0.5)]" : "bg-slate-600");
    nameWrap.appendChild(statusDot);
    const nameSpan = document.createElement("span");
    nameSpan.className = "text-sm font-medium " + (isActive ? "text-on-surface" : "text-slate-500");
    nameSpan.textContent = k.name ?? "";
    nameWrap.appendChild(nameSpan);
    td1.appendChild(nameWrap);
    tr.appendChild(td1);

    /* Prefix */
    const td2 = document.createElement("td");
    td2.className = "px-6 py-4 font-mono text-xs text-primary";
    td2.textContent = k.key_prefix ?? "";
    tr.appendChild(td2);

    /* Status toggle */
    const td3 = document.createElement("td");
    td3.className = "px-6 py-4";
    const toggle = document.createElement("div");
    toggle.className = "w-8 h-4 rounded-full relative p-0.5 cursor-pointer " + (isActive ? "bg-tertiary/20" : "bg-slate-800");
    const toggleDot = document.createElement("div");
    toggleDot.className = "absolute top-0.5 bottom-0.5 w-3 rounded-full " + (isActive ? "right-0.5 bg-tertiary" : "left-0.5 bg-slate-600");
    toggle.appendChild(toggleDot);
    td3.appendChild(toggle);
    tr.appendChild(td3);

    /* Groups */
    const td4 = document.createElement("td");
    td4.className = "px-6 py-4";
    const groupWrap = document.createElement("div");
    groupWrap.className = "flex gap-1";
    if (k.groups?.length) {
      k.groups.forEach(g => {
        const chip = document.createElement("span");
        chip.className = "px-2 py-0.5 bg-white/5 rounded-sm text-[10px] text-slate-400 border border-white/10 uppercase font-bold";
        chip.textContent = g;
        groupWrap.appendChild(chip);
      });
    } else {
      const noGroup = document.createElement("span");
      noGroup.className = "text-[10px] text-slate-600 italic";
      noGroup.textContent = "No groups";
      groupWrap.appendChild(noGroup);
    }
    td4.appendChild(groupWrap);
    tr.appendChild(td4);

    /* Created */
    const td5 = document.createElement("td");
    td5.className = "px-6 py-4 font-mono text-xs text-slate-500";
    td5.textContent = fmtDate(k.created_at);
    tr.appendChild(td5);

    /* Usage sparkline */
    const td6 = document.createElement("td");
    td6.className = "px-6 py-4";
    const usageWrap = document.createElement("div");
    usageWrap.className = "flex items-end gap-0.5 h-6";
    const usage = k.today_calls ?? 0;
    const heights = [2, 4, 3, 5, 6];
    heights.forEach((h, i) => {
      const bar = document.createElement("div");
      bar.className = "w-1 bg-primary/" + (20 + i * 20);
      bar.style.height = (usage > 0 ? h : 1) + "px";
      usageWrap.appendChild(bar);
    });
    const usageCount = document.createElement("span");
    usageCount.className = "ml-2 text-xs font-mono font-bold " + (usage > 0 ? "text-primary" : "text-slate-600");
    usageCount.textContent = fmt(usage);
    usageWrap.appendChild(usageCount);
    td6.appendChild(usageWrap);
    tr.appendChild(td6);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);
  return wrap;
}

function renderKeyInspector(key) {
  const panel = document.createElement("aside");
  panel.className = "w-96 bg-surface-container-high border-l border-white/5 flex flex-col p-6 gap-6 relative overflow-y-auto";
  panel.id = "key-inspector";

  if (!key) {
    const empty = document.createElement("div");
    empty.className = "flex flex-col items-center justify-center h-full text-slate-600";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-4xl mb-4";
    icon.textContent = "vpn_key";
    empty.appendChild(icon);
    const txt = document.createElement("div");
    txt.className = "text-xs uppercase tracking-widest";
    txt.textContent = "SELECT A KEY TO INSPECT";
    empty.appendChild(txt);
    panel.appendChild(empty);
    return panel;
  }

  /* Inspector Header */
  const headerDiv = document.createElement("div");
  headerDiv.className = "flex items-center justify-between";
  const headerLabel = document.createElement("h3");
  headerLabel.className = "text-xs font-bold text-slate-400 tracking-widest uppercase font-label flex items-center gap-2";
  const infoIcon = document.createElement("span");
  infoIcon.className = "material-symbols-outlined text-primary text-lg";
  infoIcon.textContent = "info";
  headerLabel.appendChild(infoIcon);
  headerLabel.appendChild(document.createTextNode("KEY INSPECTOR"));
  headerDiv.appendChild(headerLabel);
  panel.appendChild(headerDiv);

  /* Key Identity Card */
  const idCard = document.createElement("div");
  idCard.className = "bg-surface-container-highest p-4 rounded-sm border-l-2 border-primary";

  const idHeader = document.createElement("div");
  idHeader.className = "flex justify-between items-start mb-4";
  const idLeft = document.createElement("div");
  const idName = document.createElement("h4");
  idName.className = "text-on-surface font-bold text-lg leading-tight";
  idName.textContent = key.name ?? "";
  idLeft.appendChild(idName);
  const idPrefix = document.createElement("p");
  idPrefix.className = "text-xs font-mono text-primary mt-1";
  idPrefix.textContent = key.key_prefix ?? "";
  idLeft.appendChild(idPrefix);
  idHeader.appendChild(idLeft);
  const statusBadge = document.createElement("div");
  const isActive = key.status === "active";
  statusBadge.className = "px-2 py-1 text-[10px] font-bold rounded-sm border " + (isActive ? "bg-tertiary/10 text-tertiary border-tertiary/20" : "bg-slate-800 text-slate-500 border-slate-700");
  statusBadge.textContent = (key.status ?? "").toUpperCase();
  idHeader.appendChild(statusBadge);
  idCard.appendChild(idHeader);

  const idFields = document.createElement("div");
  idFields.className = "space-y-3";
  [
    { label: "Daily Limit", value: fmt(key.daily_limit ?? 0) + " req" },
    { label: "Today Usage", value: fmt(key.today_calls ?? 0) + " req" },
    { label: "Created", value: fmtDate(key.created_at) }
  ].forEach(f => {
    const row = document.createElement("div");
    row.className = "flex justify-between items-center";
    const lbl = document.createElement("span");
    lbl.className = "text-xs text-slate-400";
    lbl.textContent = f.label;
    row.appendChild(lbl);
    const val = document.createElement("span");
    val.className = "text-xs font-mono text-on-surface";
    val.textContent = f.value;
    row.appendChild(val);
    idFields.appendChild(row);
  });
  idCard.appendChild(idFields);
  panel.appendChild(idCard);

  /* Danger Zone */
  const danger = document.createElement("div");
  danger.className = "pt-6 border-t border-white/5 mt-auto";
  const dangerLabel = document.createElement("p");
  dangerLabel.className = "text-[10px] font-bold text-error tracking-widest uppercase mb-3 font-label";
  dangerLabel.textContent = "DANGER ZONE";
  danger.appendChild(dangerLabel);

  const dangerGrid = document.createElement("div");
  dangerGrid.className = "grid grid-cols-2 gap-3";

  const toggleStatus = isActive ? "inactive" : "active";
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "py-2 border border-error/30 text-error text-[10px] font-bold rounded-sm hover:bg-error/10 transition-all uppercase";
  toggleBtn.textContent = isActive ? "REVOKE KEY" : "ACTIVATE KEY";
  toggleBtn.dataset.keyAction = "toggle";
  toggleBtn.dataset.keyId     = key.id;
  toggleBtn.dataset.status    = toggleStatus;
  dangerGrid.appendChild(toggleBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "py-2 bg-error text-on-error text-[10px] font-bold rounded-sm hover:brightness-110 transition-all uppercase";
  delBtn.textContent = "DELETE PERMANENTLY";
  delBtn.dataset.keyAction = "delete";
  delBtn.dataset.keyId     = key.id;
  dangerGrid.appendChild(delBtn);

  danger.appendChild(dangerGrid);
  panel.appendChild(danger);

  return panel;
}

async function renderKeys(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const res = await api("/keys");
  if (res.ok) state.keys = res.data ?? [];

  const selectedKey = state.keys.find(k => k.id === state.selectedKeyId) ?? null;

  container.textContent = "";

  /* Header */
  const header = document.createElement("div");
  header.className = "flex justify-between items-end mb-8";
  const headerLeft = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.className = "text-2xl font-headline font-bold text-on-surface tracking-tight";
  h2.textContent = "API Key Management";
  headerLeft.appendChild(h2);
  const subtitle = document.createElement("p");
  subtitle.className = "text-sm text-slate-400 mt-1";
  subtitle.textContent = "Operational key cycles and group access control.";
  headerLeft.appendChild(subtitle);
  header.appendChild(headerLeft);

  const createBtn = document.createElement("button");
  createBtn.className = "px-5 py-2.5 bg-primary-container text-on-primary-fixed font-bold text-sm tracking-tight rounded-sm flex items-center gap-2 hover:shadow-[0_0_20px_rgba(0,210,255,0.3)] transition-all";
  createBtn.id = "create-key-btn";
  const addIcon = document.createElement("span");
  addIcon.className = "material-symbols-outlined text-lg";
  addIcon.textContent = "add";
  createBtn.appendChild(addIcon);
  createBtn.appendChild(document.createTextNode("CREATE API KEY"));
  header.appendChild(createBtn);
  container.appendChild(header);

  /* KPI Row */
  container.appendChild(renderKeyKpiRow(state.keys));

  /* Split layout */
  const split = document.createElement("div");
  split.className = "flex gap-0";
  split.style.minHeight = "400px";

  split.appendChild(renderKeyTable(state.keys));
  split.appendChild(renderKeyInspector(selectedKey));
  container.appendChild(split);

  /* Event: table row click */
  container.querySelectorAll("#keys-table tbody tr").forEach(tr => {
    tr.addEventListener("click", () => {
      state.selectedKeyId = tr.dataset.keyId;
      renderKeys(container);
    });
  });

  /* Event: create key */
  createBtn.addEventListener("click", () => {
    const form = document.createElement("div");

    const g1 = document.createElement("div");
    g1.className = "form-group";
    const l1 = document.createElement("label");
    l1.className = "form-label";
    l1.textContent = "KEY NAME / IDENTIFIER";
    g1.appendChild(l1);
    const nameInput = document.createElement("input");
    nameInput.className = "form-input";
    nameInput.id = "modal-key-name";
    nameInput.placeholder = "e.g. analytical-hub-prod";
    g1.appendChild(nameInput);
    form.appendChild(g1);

    const g2 = document.createElement("div");
    g2.className = "form-group";
    const l2 = document.createElement("label");
    l2.className = "form-label";
    l2.textContent = "DAILY RATE LIMIT";
    g2.appendChild(l2);
    const limitInput = document.createElement("input");
    limitInput.className = "form-input";
    limitInput.id = "modal-key-limit";
    limitInput.type = "number";
    limitInput.value = "10000";
    g2.appendChild(limitInput);
    form.appendChild(g2);

    showModal("Generate New API Credential", form, [
      { id: "create", label: "GENERATE AND VIEW SECRET", cls: "btn-primary", handler: async () => {
        const name        = document.getElementById("modal-key-name")?.value.trim();
        const daily_limit = parseInt(document.getElementById("modal-key-limit")?.value) || 10000;
        if (!name) { showToast("Name required", "warning"); return; }
        const res = await api("/keys", { method: "POST", body: { name, daily_limit } });
        closeModal();
        if (res.ok && res.data?.raw_key) {
          const keyDisplay = document.createElement("div");
          const note = document.createElement("p");
          note.className = "text-xs text-primary leading-relaxed mb-4";
          note.textContent = "This secret key will only be displayed once. Store it in a secure vault.";
          keyDisplay.appendChild(note);

          const copyWrap = document.createElement("div");
          copyWrap.className = "copy-wrap";
          const copyVal = document.createElement("span");
          copyVal.className = "copy-value";
          copyVal.textContent = res.data.raw_key;
          copyWrap.appendChild(copyVal);
          const copyBtn = document.createElement("button");
          copyBtn.className = "copy-btn";
          copyBtn.textContent = "COPY";
          copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(res.data.raw_key).then(() => showToast("Copied", "success"));
          });
          copyWrap.appendChild(copyBtn);
          keyDisplay.appendChild(copyWrap);

          showModal("Credential Generated", keyDisplay, [
            { id: "done", label: "DONE", cls: "btn-primary", handler: () => { closeModal(); renderKeys(container); } }
          ]);
        } else {
          showToast(res.data?.error ?? "Generation failed", "error");
          renderKeys(container);
        }
      }}
    ]);
  });

  /* Event: inspector actions */
  container.querySelectorAll("[data-key-action]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.keyAction;
      const keyId  = btn.dataset.keyId;

      if (action === "toggle") {
        const newStatus = btn.dataset.status;
        const msg = document.createElement("span");
        msg.className = "text-sm text-slate-300";
        msg.textContent = "Change this key to " + newStatus + " status?";
        showModal("Confirm Status Change", msg, [
          { id: "confirm", label: "CONFIRM", cls: "btn-primary", handler: async () => {
            await api("/keys/" + keyId, { method: "PUT", body: { status: newStatus } });
            closeModal();
            showToast("Status updated", "success");
            renderKeys(container);
          }}
        ]);
      }

      if (action === "delete") {
        const msg = document.createElement("span");
        msg.className = "text-sm text-error";
        msg.textContent = "This action is irreversible. Delete permanently?";
        showModal("Confirm Permanent Deletion", msg, [
          { id: "confirm", label: "DELETE", cls: "btn-danger", handler: async () => {
            await api("/keys/" + keyId, { method: "DELETE" });
            closeModal();
            state.selectedKeyId = null;
            showToast("Key deleted", "success");
            renderKeys(container);
          }}
        ]);
      }
    });
  });
}

/* ================================================================
   11. Groups View
   ================================================================ */

function renderGroupCards(groups) {
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "text-sm text-slate-600 py-8 text-center";
    empty.textContent = "그룹이 없습니다";
    return empty;
  }

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 md:grid-cols-3 gap-4 mb-8";

  groups.forEach(g => {
    const card = document.createElement("div");
    card.className = "bg-surface-container-low p-5 cursor-pointer border-l-2 transition-all hover:bg-surface-container-high " + (g.id === state.selectedGroupId ? "border-primary bg-primary/5" : "border-transparent");
    card.dataset.groupId = g.id;

    const nameRow = document.createElement("div");
    nameRow.className = "flex items-center gap-3 mb-2";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-lg text-secondary";
    icon.textContent = "shield";
    nameRow.appendChild(icon);
    const name = document.createElement("div");
    name.className = "text-sm font-bold text-on-surface";
    name.textContent = g.name;
    nameRow.appendChild(name);
    card.appendChild(nameRow);

    if (g.description) {
      const desc = document.createElement("div");
      desc.className = "text-xs text-slate-400 mb-2";
      desc.textContent = g.description;
      card.appendChild(desc);
    }

    const count = document.createElement("div");
    count.className = "text-[10px] text-slate-500 uppercase font-mono";
    count.textContent = fmt(g.member_count ?? 0) + " Members";
    card.appendChild(count);

    grid.appendChild(card);
  });

  return grid;
}

async function renderGroups(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const [gRes, kRes] = await Promise.all([
    api("/groups"),
    api("/keys")
  ]);
  if (gRes.ok) state.groups = gRes.data ?? [];
  if (kRes.ok) state.keys   = kRes.data ?? [];

  const selected = state.groups.find(g => g.id === state.selectedGroupId) ?? null;
  let members = [];
  if (selected) {
    const mRes = await api("/groups/" + selected.id + "/members");
    if (mRes.ok) members = mRes.data ?? [];
  }

  container.textContent = "";

  /* Header */
  const header = document.createElement("div");
  header.className = "flex justify-between items-end mb-8";
  const headerLeft = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.className = "text-2xl font-headline font-bold text-on-surface tracking-tight";
  h2.textContent = "Group Management";
  headerLeft.appendChild(h2);
  header.appendChild(headerLeft);

  const createBtn = document.createElement("button");
  createBtn.className = "px-5 py-2.5 bg-primary-container text-on-primary-fixed font-bold text-sm tracking-tight rounded-sm flex items-center gap-2 hover:shadow-[0_0_20px_rgba(0,210,255,0.3)] transition-all";
  const addIcon = document.createElement("span");
  addIcon.className = "material-symbols-outlined text-lg";
  addIcon.textContent = "add";
  createBtn.appendChild(addIcon);
  createBtn.appendChild(document.createTextNode("CREATE GROUP"));
  header.appendChild(createBtn);
  container.appendChild(header);

  container.appendChild(renderGroupCards(state.groups));

  /* Group detail */
  if (selected) {
    const detail = document.createElement("section");
    detail.className = "bg-surface-container-low p-6 rounded-sm shadow-xl";
    detail.id = "group-detail";

    const dHeader = document.createElement("div");
    dHeader.className = "flex justify-between items-center mb-6";
    const dLeft = document.createElement("div");
    dLeft.className = "flex items-center gap-3";
    const dAcc = document.createElement("div");
    dAcc.className = "w-1 h-5 bg-secondary";
    dLeft.appendChild(dAcc);
    const dTitle = document.createElement("h3");
    dTitle.className = "font-headline text-lg font-bold tracking-tight";
    dTitle.textContent = selected.name + " -- Members";
    dLeft.appendChild(dTitle);
    dHeader.appendChild(dLeft);

    const dBtns = document.createElement("div");
    dBtns.className = "flex gap-3";
    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-sm";
    addBtn.id = "add-member-btn";
    addBtn.textContent = "ADD MEMBER";
    dBtns.appendChild(addBtn);
    const delGrpBtn = document.createElement("button");
    delGrpBtn.className = "btn btn-sm btn-danger";
    delGrpBtn.id = "delete-group-btn";
    delGrpBtn.textContent = "DELETE GROUP";
    dBtns.appendChild(delGrpBtn);
    dHeader.appendChild(dBtns);
    detail.appendChild(dHeader);

    const tableWrap = document.createElement("div");
    tableWrap.className = "overflow-x-auto";
    const table = document.createElement("table");
    table.className = "w-full text-left border-collapse";
    const thead = document.createElement("thead");
    const hRow = document.createElement("tr");
    hRow.className = "bg-white/5 border-b border-white/5";
    ["Name", "Prefix", "Action"].forEach(h => {
      const th = document.createElement("th");
      th.className = "px-6 py-3 text-[10px] font-bold text-slate-400 tracking-widest uppercase font-label";
      th.textContent = h;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    tbody.className = "divide-y divide-white/5";
    if (members.length) {
      members.forEach(m => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-white/5 transition-colors";
        const td1 = document.createElement("td");
        td1.className = "px-6 py-3 text-sm text-on-surface";
        td1.textContent = m.name ?? "";
        tr.appendChild(td1);
        const td2 = document.createElement("td");
        td2.className = "px-6 py-3 font-mono text-xs text-primary";
        td2.textContent = m.key_prefix ?? "";
        tr.appendChild(td2);
        const td3 = document.createElement("td");
        td3.className = "px-6 py-3";
        const rmBtn = document.createElement("button");
        rmBtn.className = "btn btn-sm btn-danger";
        rmBtn.textContent = "REMOVE";
        rmBtn.dataset.removeMember = m.id;
        td3.appendChild(rmBtn);
        tr.appendChild(td3);
        tbody.appendChild(tr);
      });
    } else {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "px-6 py-6 text-center text-slate-600 text-sm";
      td.textContent = "No members";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    detail.appendChild(tableWrap);
    container.appendChild(detail);

    /* Event: add member */
    addBtn.addEventListener("click", () => {
      const form = document.createElement("div");
      const g1 = document.createElement("div");
      g1.className = "form-group";
      const l1 = document.createElement("label");
      l1.className = "form-label";
      l1.textContent = "SELECT API KEY";
      g1.appendChild(l1);
      const sel = document.createElement("select");
      sel.className = "form-select";
      sel.id = "modal-member-key";
      state.keys.forEach(k => {
        const opt = document.createElement("option");
        opt.value = k.id;
        opt.textContent = k.name + " (" + (k.key_prefix ?? "") + ")";
        sel.appendChild(opt);
      });
      g1.appendChild(sel);
      form.appendChild(g1);

      showModal("Add Member", form, [
        { id: "add", label: "ADD", cls: "btn-primary", handler: async () => {
          const keyId = document.getElementById("modal-member-key")?.value;
          if (!keyId) return;
          await api("/groups/" + state.selectedGroupId + "/members", { method: "POST", body: { key_id: keyId } });
          closeModal();
          showToast("Member added", "success");
          renderGroups(container);
        }}
      ]);
    });

    /* Event: remove member */
    container.querySelectorAll("[data-remove-member]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const keyId = btn.dataset.removeMember;
        await api("/groups/" + state.selectedGroupId + "/members/" + keyId, { method: "DELETE" });
        showToast("Member removed", "success");
        renderGroups(container);
      });
    });

    /* Event: delete group */
    delGrpBtn.addEventListener("click", () => {
      const msg = document.createElement("span");
      msg.className = "text-sm text-error";
      msg.textContent = "This action is irreversible. Delete this group?";
      showModal("Confirm Group Deletion", msg, [
        { id: "confirm", label: "DELETE", cls: "btn-danger", handler: async () => {
          await api("/groups/" + state.selectedGroupId, { method: "DELETE" });
          closeModal();
          state.selectedGroupId = null;
          showToast("Group deleted", "success");
          renderGroups(container);
        }}
      ]);
    });
  }

  /* Event: group card click */
  container.querySelectorAll("[data-group-id]").forEach(card => {
    card.addEventListener("click", () => {
      state.selectedGroupId = card.dataset.groupId;
      renderGroups(container);
    });
  });

  /* Event: create group */
  createBtn.addEventListener("click", () => {
    const form = document.createElement("div");

    const g1 = document.createElement("div");
    g1.className = "form-group";
    const l1 = document.createElement("label");
    l1.className = "form-label";
    l1.textContent = "GROUP NAME";
    g1.appendChild(l1);
    const nameInput = document.createElement("input");
    nameInput.className = "form-input";
    nameInput.id = "modal-group-name";
    nameInput.placeholder = "e.g. CORE_OPERATIONS";
    g1.appendChild(nameInput);
    form.appendChild(g1);

    const g2 = document.createElement("div");
    g2.className = "form-group";
    const l2 = document.createElement("label");
    l2.className = "form-label";
    l2.textContent = "DESCRIPTION";
    g2.appendChild(l2);
    const descInput = document.createElement("input");
    descInput.className = "form-input";
    descInput.id = "modal-group-desc";
    descInput.placeholder = "(optional)";
    g2.appendChild(descInput);
    form.appendChild(g2);

    showModal("Create New Group", form, [
      { id: "create", label: "CREATE", cls: "btn-primary", handler: async () => {
        const name = document.getElementById("modal-group-name")?.value.trim();
        const description = document.getElementById("modal-group-desc")?.value.trim() || null;
        if (!name) { showToast("Name required", "warning"); return; }
        const res = await api("/groups", { method: "POST", body: { name, description } });
        closeModal();
        if (res.ok) { showToast("Group created", "success"); renderGroups(container); }
        else showToast(res.data?.error ?? "Creation failed", "error");
      }}
    ]);
  });
}

/* ================================================================
   12. Memory Operations View (Stitch Screen 3)
   ================================================================ */

function renderMemoryFilters() {
  const types = ["", "fact", "error", "decision", "procedure", "preference"];

  const bar = document.createElement("div");
  bar.className = "flex items-center justify-between gap-4 bg-surface-container-low p-2 rounded-sm border-l-2 border-primary/40 mb-6";
  bar.id = "memory-filters";

  const leftChips = document.createElement("div");
  leftChips.className = "flex gap-2";

  /* Topic chip */
  const topicInput = document.createElement("input");
  topicInput.className = "px-3 py-1 bg-surface-variant text-[10px] font-bold text-primary rounded-sm border border-primary/10 placeholder:text-slate-500 w-32";
  topicInput.id = "filter-topic";
  topicInput.placeholder = "TOPIC: ALL";
  topicInput.value = state.memoryFilter.topic;
  leftChips.appendChild(topicInput);

  /* Type chip */
  const typeSelect = document.createElement("select");
  typeSelect.className = "px-3 py-1 bg-surface-variant text-[10px] font-bold text-slate-400 rounded-sm border-none";
  typeSelect.id = "filter-type";
  types.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t ? "TYPE: " + t.toUpperCase() : "TYPE: ALL";
    if (state.memoryFilter.type === t) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  leftChips.appendChild(typeSelect);

  /* Key chip */
  const keyInput = document.createElement("input");
  keyInput.className = "px-3 py-1 bg-surface-variant text-[10px] font-bold text-slate-400 rounded-sm border-none placeholder:text-slate-500 w-24";
  keyInput.id = "filter-key-id";
  keyInput.placeholder = "KEY: *";
  keyInput.value = state.memoryFilter.key_id;
  leftChips.appendChild(keyInput);

  bar.appendChild(leftChips);

  /* Search button */
  const searchBtn = document.createElement("button");
  searchBtn.className = "flex items-center gap-2 bg-transparent border border-outline-variant px-4 py-1.5 text-[10px] font-bold text-primary hover:bg-primary/5 transition-all";
  searchBtn.id = "filter-search";
  const searchIcon = document.createElement("span");
  searchIcon.className = "material-symbols-outlined text-[14px]";
  searchIcon.textContent = "search";
  searchBtn.appendChild(searchIcon);
  searchBtn.appendChild(document.createTextNode("SEARCH"));
  bar.appendChild(searchBtn);

  return bar;
}

function renderFragmentList(fragments) {
  if (!fragments || !fragments.length) {
    const empty = document.createElement("div");
    empty.className = "text-sm text-slate-600 py-8 text-center";
    empty.textContent = "결과 없음";
    return empty;
  }

  const panel = document.createElement("section");
  panel.className = "glass-panel rounded-sm p-6 shadow-2xl relative overflow-hidden";

  const title = document.createElement("h2");
  title.className = "font-headline text-lg font-bold text-cyan-100 flex items-center gap-3 mb-6 uppercase tracking-widest";
  const titleBar = document.createElement("span");
  titleBar.className = "w-1 h-4 bg-cyan-400";
  title.appendChild(titleBar);
  title.appendChild(document.createTextNode("Search Explorer"));
  panel.appendChild(title);

  const list = document.createElement("div");
  list.className = "space-y-3";
  list.id = "fragment-table";

  fragments.forEach(f => {
    const item = document.createElement("div");
    item.className = "bg-surface-container-low p-4 hover:bg-surface-container-high transition-all group border-l border-transparent hover:border-cyan-400/50 cursor-pointer" + (f.id === state.selectedFragment?.id ? " border-cyan-400/50 bg-surface-container-high" : "");
    item.dataset.fragId = f.id;

    /* Top row */
    const topRow = document.createElement("div");
    topRow.className = "flex justify-between items-start mb-2";
    const topLeft = document.createElement("div");
    topLeft.className = "flex items-center gap-3";
    const idBadge = document.createElement("span");
    idBadge.className = "text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5";
    idBadge.textContent = "#MEM_" + (f.id ?? "").toString().slice(-5).padStart(5, "0");
    topLeft.appendChild(idBadge);
    const topicSpan = document.createElement("span");
    topicSpan.className = "text-xs font-bold text-on-surface uppercase tracking-wider";
    topicSpan.textContent = f.topic ?? "(무제)";
    topLeft.appendChild(topicSpan);
    topRow.appendChild(topLeft);

    const topRight = document.createElement("div");
    topRight.className = "flex items-center gap-4 text-right";
    const scoreDiv = document.createElement("div");
    const scoreLbl = document.createElement("div");
    scoreLbl.className = "text-[9px] text-slate-500 font-mono";
    scoreLbl.textContent = "IMPORTANCE";
    scoreDiv.appendChild(scoreLbl);
    const scoreVal = document.createElement("div");
    scoreVal.className = "text-xs font-mono text-tertiary";
    scoreVal.textContent = String(f.importance ?? "-");
    scoreDiv.appendChild(scoreVal);
    topRight.appendChild(scoreDiv);
    topRow.appendChild(topRight);
    item.appendChild(topRow);

    /* Content preview */
    const preview = document.createElement("p");
    preview.className = "text-[11px] text-slate-400 line-clamp-2 font-body leading-relaxed mb-3 italic";
    preview.textContent = truncate(f.content ?? "", 200);
    item.appendChild(preview);

    /* Tags */
    const tagRow = document.createElement("div");
    tagRow.className = "flex justify-between items-center";
    const tags = document.createElement("div");
    tags.className = "flex gap-2";
    const topicTag = document.createElement("span");
    topicTag.className = "text-[9px] border border-outline-variant px-2 py-0.5 text-slate-500 uppercase";
    topicTag.textContent = "Topic: " + (f.topic ?? "?");
    tags.appendChild(topicTag);
    const typeTag = document.createElement("span");
    typeTag.className = "text-[9px] border border-outline-variant px-2 py-0.5 text-slate-500 uppercase";
    typeTag.textContent = "Type: " + (f.type ?? "?");
    tags.appendChild(typeTag);
    tagRow.appendChild(tags);

    const dateSpan = document.createElement("div");
    dateSpan.className = "text-[9px] font-mono text-slate-600 uppercase";
    dateSpan.textContent = fmtDate(f.created_at);
    tagRow.appendChild(dateSpan);
    item.appendChild(tagRow);

    list.appendChild(item);
  });

  panel.appendChild(list);
  return panel;
}

function renderAnomalyCards(anomalies) {
  if (!anomalies) return document.createDocumentFragment();

  const panel = document.createElement("section");
  panel.className = "glass-panel rounded-sm p-6 border-t border-error/20";

  const title = document.createElement("h2");
  title.className = "font-headline text-sm font-bold text-error flex items-center gap-3 mb-6 uppercase tracking-widest";
  title.textContent = "Anomaly Insights";
  panel.appendChild(title);

  const list = document.createElement("div");
  list.className = "space-y-3";

  const items = [
    { label: "Contradiction Queue",  key: "contradictions",     icon: "crisis_alert",         isCritical: true },
    { label: "Superseded Candidates", key: "superseded",         icon: "auto_awesome_motion",  isCritical: false },
    { label: "Low Quality Fragments", key: "qualityUnverified",  icon: "low_priority",         isCritical: false },
    { label: "Embedding Backlog",     key: "embeddingBacklog",   icon: "memory_alt",           isCritical: false }
  ];

  items.forEach(a => {
    const row = document.createElement("div");
    row.className = a.isCritical
      ? "flex items-center justify-between p-3 bg-error-container/10 border-l-2 border-error"
      : "flex items-center justify-between p-3 bg-surface-container-high";
    row.dataset.anomaly = a.key;

    const left = document.createElement("div");
    left.className = "flex items-center gap-3 " + (a.isCritical ? "" : "text-slate-400");
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-lg" + (a.isCritical ? " text-error" : "");
    icon.textContent = a.icon;
    left.appendChild(icon);
    const lbl = document.createElement("span");
    lbl.className = "text-[10px] font-bold uppercase";
    lbl.textContent = a.label;
    left.appendChild(lbl);
    row.appendChild(left);

    const val = document.createElement("span");
    val.className = "text-xs font-mono" + (a.isCritical ? " text-error font-bold" : "");
    val.textContent = fmt(anomalies[a.key] ?? 0);
    row.appendChild(val);

    list.appendChild(row);
  });

  panel.appendChild(list);
  return panel;
}

function renderFragmentInspector(fragment) {
  if (!fragment) return document.createDocumentFragment();

  const panel = document.createElement("section");
  panel.className = "glass-panel rounded-sm p-6 border-t border-primary/20";
  panel.id = "fragment-inspector";

  const title = document.createElement("h2");
  title.className = "font-headline text-sm font-bold text-cyan-100 flex items-center gap-3 mb-6 uppercase tracking-widest";
  title.textContent = "Fragment Detail";
  panel.appendChild(title);

  const content = document.createElement("div");
  content.className = "bg-surface-container-highest p-4 mb-4 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap border border-white/5";
  content.textContent = fragment.content ?? "";
  panel.appendChild(content);

  const meta = document.createElement("div");
  meta.className = "space-y-2";
  [
    { label: "ID",       value: fragment.id },
    { label: "Type",     value: fragment.type ?? "" },
    { label: "Importance", value: String(fragment.importance ?? "-") },
    { label: "Agent",    value: fragment.agent_id ?? "-" },
    { label: "Key",      value: fragment.key_id ?? "master" },
    { label: "Created",  value: fmtDate(fragment.created_at) },
    { label: "Keywords", value: JSON.stringify(fragment.keywords ?? []) }
  ].forEach(f => {
    const row = document.createElement("div");
    row.className = "flex justify-between text-[10px]";
    const lbl = document.createElement("span");
    lbl.className = "text-slate-500 uppercase font-mono";
    lbl.textContent = f.label;
    row.appendChild(lbl);
    const val = document.createElement("span");
    val.className = "text-slate-300 font-mono";
    val.textContent = f.value;
    row.appendChild(val);
    meta.appendChild(row);
  });

  panel.appendChild(meta);
  return panel;
}

function renderPagination() {
  if (state.memoryPages <= 1) return document.createDocumentFragment();

  const wrap = document.createElement("div");
  wrap.className = "flex gap-2 mt-4 justify-center";

  for (let i = 1; i <= state.memoryPages; i++) {
    const btn = document.createElement("button");
    btn.className = "p-1 hover:bg-white/5 rounded-sm px-3 text-xs " + (i === state.memoryPage ? "text-white border border-primary/20" : "text-slate-500");
    btn.dataset.page = i;
    btn.textContent = i;
    wrap.appendChild(btn);
  }

  return wrap;
}

async function renderMemory(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const params = new URLSearchParams();
  if (state.memoryFilter.topic)  params.set("topic", state.memoryFilter.topic);
  if (state.memoryFilter.type)   params.set("type", state.memoryFilter.type);
  if (state.memoryFilter.key_id) params.set("key_id", state.memoryFilter.key_id);
  params.set("page", state.memoryPage);

  const [fragRes, anomalyRes] = await Promise.all([
    api("/memory/fragments?" + params),
    api("/memory/anomalies")
  ]);

  if (fragRes.ok) {
    const data = fragRes.data ?? {};
    if (Array.isArray(fragRes.data)) {
      state.fragments   = fragRes.data;
      state.memoryPages = 1;
    } else {
      state.fragments   = data.fragments ?? [];
      state.memoryPages = data.pages ?? 1;
    }
  } else {
    state.fragments = [];
  }

  state.anomalies = anomalyRes.ok ? anomalyRes.data : null;

  container.textContent = "";

  /* Filter bar */
  container.appendChild(renderMemoryFilters());

  /* Grid: main + right */
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-12 gap-6";

  /* Left: fragments */
  const leftCol = document.createElement("div");
  leftCol.className = "col-span-12 lg:col-span-8 space-y-6";
  leftCol.appendChild(renderFragmentList(state.fragments));
  leftCol.appendChild(renderPagination());
  grid.appendChild(leftCol);

  /* Right: analytics + anomalies */
  const rightCol = document.createElement("div");
  rightCol.className = "col-span-12 lg:col-span-4 space-y-6";

  /* Fragment inspector */
  rightCol.appendChild(renderFragmentInspector(state.selectedFragment));
  rightCol.appendChild(renderAnomalyCards(state.anomalies));
  grid.appendChild(rightCol);

  container.appendChild(grid);

  /* Event: search */
  document.getElementById("filter-search")?.addEventListener("click", () => {
    state.memoryFilter.topic  = document.getElementById("filter-topic")?.value ?? "";
    state.memoryFilter.type   = document.getElementById("filter-type")?.value ?? "";
    state.memoryFilter.key_id = document.getElementById("filter-key-id")?.value ?? "";
    state.memoryPage = 1;
    renderMemory(container);
  });

  /* Event: pagination */
  container.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.memoryPage = parseInt(btn.dataset.page);
      renderMemory(container);
    });
  });

  /* Event: fragment click */
  container.querySelectorAll("[data-frag-id]").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedFragment = state.fragments.find(f => f.id === el.dataset.fragId) ?? null;
      renderMemory(container);
    });
  });
}

/* ================================================================
   13. Utilities
   ================================================================ */

function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  if (n == null) return "0";
  return Number(n).toLocaleString("ko-KR");
}

function fmtMs(ms) {
  if (ms == null) return "-";
  return Number(ms).toFixed(1) + "ms";
}

function fmtPct(val) {
  if (val == null) return "-";
  return (Number(val) * 100).toFixed(1) + "%";
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR") + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function truncate(str, len) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function relativeTime(iso) {
  const ts   = typeof iso === "number" ? iso : new Date(iso).getTime();
  const diff = Date.now() - ts;
  const min  = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const day = Math.floor(hr / 24);
  return day + "d ago";
}

function loadingHtml() {
  const div = document.createElement("div");
  div.className = "loading-spinner";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "spinner-dot";
    div.appendChild(dot);
  }
  return div;
}

/* ================================================================
   14. Init
   ================================================================ */

function init() {
  if (state.masterKey) {
    document.getElementById("login-root")?.classList.add("hidden");
    document.getElementById("app")?.classList.add("visible");
    navigate("overview");
  } else {
    renderLogin();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

/* ================================================================
   15. Exports for testing (Node.js environment detection)
   ================================================================ */

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    renderOverviewCards,
    renderHealthPanel,
    renderKeyTable,
    renderKeyKpiRow,
    renderGroupCards,
    renderMemoryFilters,
    renderFragmentList,
    renderAnomalyCards,
    renderFragmentInspector,
    renderPagination,
    esc,
    fmt,
    fmtMs,
    fmtPct,
    fmtDate,
    truncate,
    relativeTime,
    state
  };
}
