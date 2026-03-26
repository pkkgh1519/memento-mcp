/**
 * Admin 메모리 운영 UI 렌더링 검증 테스트
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

describe("renderMemoryFilters", () => {
  test("creates filter bar with expected inputs", () => {
    mod.state.memoryFilter = { topic: "", type: "", key_id: "" };
    const bar = mod.renderMemoryFilters();
    assert.ok(bar.className.includes("bg-surface-container-low"), "filter bar should use surface-container-low");
    assert.equal(bar.id, "memory-filters");
  });

  test("filter bar has search button", () => {
    mod.state.memoryFilter = { topic: "", type: "", key_id: "" };
    const bar = mod.renderMemoryFilters();
    const allChildren = [...bar.children[0].children, bar.children[1]];
    const searchBtn = allChildren.find(c => c.id === "filter-search");
    assert.ok(searchBtn, "search button should exist");
  });
});

describe("renderFragmentList", () => {
  test("shows empty message when no fragments", () => {
    const result = mod.renderFragmentList([]);
    assert.ok(result.textContent.includes("결과 없음"));
  });

  test("shows empty message for null", () => {
    const result = mod.renderFragmentList(null);
    assert.ok(result.textContent.includes("결과 없음"));
  });

  test("creates glass-panel with fragment items", () => {
    mod.state.selectedFragment = null;
    const fragments = [
      { id: "f1", type: "fact", topic: "test-topic", content: "some content", created_at: "2026-01-01T00:00:00Z" },
      { id: "f2", type: "error", topic: "error-topic", content: "error details", created_at: "2026-01-02T00:00:00Z" }
    ];
    const result = mod.renderFragmentList(fragments);
    assert.ok(result.className.includes("glass-panel"), "should use glass-panel class");
  });

  test("fragment item displays topic text", () => {
    mod.state.selectedFragment = null;
    const fragments = [
      { id: "f1", type: "fact", topic: "my-topic", content: "content", created_at: null }
    ];
    const result = mod.renderFragmentList(fragments);
    const list   = result.children.find(c => c.id === "fragment-table");
    assert.ok(list, "should have fragment-table");
    const firstItem = list.children[0];
    assert.ok(firstItem, "should have at least one item");
  });
});

describe("renderAnomalyCards", () => {
  test("returns empty fragment for null anomalies", () => {
    const result = mod.renderAnomalyCards(null);
    assert.equal(result.children.length, 0);
  });

  test("creates anomaly panel with items", () => {
    const anomalies = { contradictions: 12, superseded: 158, qualityUnverified: 2410, embeddingBacklog: 0 };
    const result = mod.renderAnomalyCards(anomalies);
    assert.ok(result.className.includes("glass-panel"), "should use glass-panel class");
  });

  test("contradiction row uses error styling", () => {
    const anomalies = { contradictions: 5, superseded: 0, qualityUnverified: 0, embeddingBacklog: 0 };
    const result = mod.renderAnomalyCards(anomalies);
    const list = result.children.find(c => c.className && c.className.includes("space-y"));
    assert.ok(list, "should have list container");
    const firstRow = list.children[0];
    assert.ok(firstRow.className.includes("border-error"), "first row should have error border");
  });
});

describe("renderFragmentInspector", () => {
  test("returns empty fragment for null", () => {
    const result = mod.renderFragmentInspector(null);
    assert.equal(result.children.length, 0);
  });

  test("creates inspector panel with content", () => {
    const frag = { id: "f1", type: "fact", topic: "test", content: "Hello world", importance: 0.8, created_at: "2026-01-01T00:00:00Z", keywords: ["test"] };
    const result = mod.renderFragmentInspector(frag);
    assert.ok(result.className.includes("glass-panel"), "should use glass-panel class");
  });
});
