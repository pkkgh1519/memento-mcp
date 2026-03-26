/**
 * Admin 키/그룹 UI 렌더링 검증 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-26
 */

import { test, describe, before } from "node:test";
import assert                     from "node:assert/strict";
import { loadAdminModule }        from "./admin-dom-shim.js";

let mod;

before(() => {
  mod = loadAdminModule();
});

describe("renderKeyTable", () => {
  test("creates table with correct structure", () => {
    mod.state.selectedKeyId = null;
    const keys = [
      { id: "k1", name: "test-key", status: "active", key_prefix: "mmcp_abc", daily_limit: 10000, today_calls: 5, created_at: "2026-01-01T00:00:00Z" }
    ];
    const result = mod.renderKeyTable(keys);
    assert.ok(result.className.includes("bg-surface-container-low"), "wrapper should use bg-surface-container-low");

    const tableWrap = result.children[0];
    assert.ok(tableWrap, "should have overflow wrapper");
    const table = tableWrap.children[0];
    assert.ok(table);
    assert.equal(table.id, "keys-table");
  });

  test("creates row for each key", () => {
    mod.state.selectedKeyId = null;
    const keys = [
      { id: "k1", name: "key-a", status: "active", key_prefix: "mmcp_a", daily_limit: 1000, created_at: null },
      { id: "k2", name: "key-b", status: "inactive", key_prefix: "mmcp_b", daily_limit: 500, created_at: null }
    ];
    const result = mod.renderKeyTable(keys);
    const table  = result.children[0].children[0];
    const tbody  = table.children[1];
    assert.equal(tbody.children.length, 2, "should have 2 data rows");
  });

  test("key row includes prefix in mono font", () => {
    mod.state.selectedKeyId = null;
    const keys = [
      { id: "k1", name: "key-a", status: "active", key_prefix: "mmcp_test", daily_limit: 1000 }
    ];
    const result = mod.renderKeyTable(keys);
    const table  = result.children[0].children[0];
    const tbody  = table.children[1];
    const row    = tbody.children[0];
    const prefixTd = row.children[1];
    assert.ok(prefixTd.className.includes("font-mono"), "prefix should use mono font");
    assert.equal(prefixTd.textContent, "mmcp_test");
  });
});

describe("renderKeyKpiRow", () => {
  test("creates 4 KPI cards", () => {
    const keys = [
      { id: "k1", status: "active", groups: ["CORE"] },
      { id: "k2", status: "inactive", groups: [] },
      { id: "k3", status: "active", groups: ["API"] }
    ];
    const result = mod.renderKeyKpiRow(keys);
    assert.ok(result.className.includes("grid-cols-4"), "should be 4-column grid");
    assert.equal(result.children.length, 4, "should have 4 KPI cards");
  });
});

describe("renderGroupCards", () => {
  test("shows empty message when no groups", () => {
    mod.state.selectedGroupId = null;
    const result = mod.renderGroupCards([]);
    assert.ok(result.textContent.includes("그룹이 없습니다"));
  });

  test("creates card for each group", () => {
    mod.state.selectedGroupId = null;
    const groups = [
      { id: "g1", name: "team-a", description: "Alpha team", member_count: 3 },
      { id: "g2", name: "team-b", description: null, member_count: 0 }
    ];
    const result = mod.renderGroupCards(groups);
    assert.ok(result.className.includes("grid"), "should be a grid");
    assert.equal(result.children.length, 2, "should have 2 group cards");
  });

  test("group card displays name", () => {
    mod.state.selectedGroupId = null;
    const groups = [
      { id: "g1", name: "team-alpha", description: "Test", member_count: 5 }
    ];
    const result = mod.renderGroupCards(groups);
    const card   = result.children[0];
    const nameRow = card.children[0];
    const nameEl  = nameRow.children.find(c => c.className && c.className.includes("font-bold"));
    assert.equal(nameEl.textContent, "team-alpha");
  });

  test("marks selected group card with border-primary", () => {
    mod.state.selectedGroupId = "g2";
    const groups = [
      { id: "g1", name: "team-a" },
      { id: "g2", name: "team-b" }
    ];
    const result = mod.renderGroupCards(groups);
    const card2  = result.children[1];
    assert.ok(card2.className.includes("border-primary"));
    mod.state.selectedGroupId = null;
  });
});
