/**
 * Admin overview 렌더링 함수 검증 테스트
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

describe("renderOverviewCards", () => {
  test("returns loading element when stats is null", () => {
    const result = mod.renderOverviewCards(null);
    assert.ok(result.hasClass("loading-spinner"), "loading spinner expected");
  });

  test("creates 6 KPI cards with correct structure", () => {
    const stats = {
      fragments: 123,
      sessions: 5,
      apiCallsToday: 42,
      activeKeys: 3,
      queues: { embeddingBacklog: 7, qualityPending: 2 }
    };
    const result = mod.renderOverviewCards(stats);
    assert.ok(result.className.includes("grid"), "should be a grid");
    assert.equal(result.children.length, 6, "should have 6 KPI cards");
  });

  test("KPI card uses Stitch bg-surface-container-low class", () => {
    const stats = {
      fragments: 100,
      sessions: 0,
      apiCallsToday: 0,
      activeKeys: 0,
      queues: {}
    };
    const result = mod.renderOverviewCards(stats);
    const firstCard = result.children[0];
    assert.ok(firstCard.className.includes("bg-surface-container-low"), "card should use bg-surface-container-low");
  });

  test("KPI value uses font-headline class", () => {
    const stats = {
      fragments: 1234,
      sessions: 0,
      apiCallsToday: 0,
      activeKeys: 0,
      queues: {}
    };
    const result = mod.renderOverviewCards(stats);
    const firstCard = result.children[0];
    const valueEl = firstCard.children.find(ch => ch.className && ch.className.includes("font-headline"));
    assert.ok(valueEl, "value element should use font-headline");
  });
});

describe("renderHealthPanel", () => {
  test("returns null when stats is null", () => {
    assert.equal(mod.renderHealthPanel(null), null);
  });

  test("creates panel with health bars", () => {
    const stats = { system: { cpu: 24, memory: 68, disk: 12 }, db: "connected", redis: "stub" };
    const panel = mod.renderHealthPanel(stats);
    assert.ok(panel, "panel should not be null");
    assert.ok(panel.className.includes("bg-surface-container-low"), "should use surface-container-low");
  });
});

describe("utility functions", () => {
  test("esc escapes HTML characters", () => {
    assert.equal(mod.esc('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    assert.equal(mod.esc(null), "");
  });

  test("fmt formats numbers", () => {
    assert.ok(mod.fmt(1234).length > 0);
    assert.equal(mod.fmt(null), "0");
  });

  test("fmtMs formats milliseconds", () => {
    assert.equal(mod.fmtMs(null), "-");
    assert.ok(mod.fmtMs(12.345).includes("12.3"));
  });

  test("fmtPct formats percentage", () => {
    assert.equal(mod.fmtPct(null), "-");
    assert.ok(mod.fmtPct(0.1234).includes("12.3"));
  });

  test("truncate shortens text", () => {
    assert.equal(mod.truncate("abcdef", 3), "abc...");
    assert.equal(mod.truncate("ab", 3), "ab");
    assert.equal(mod.truncate("", 3), "");
  });

  test("relativeTime returns human-readable time", () => {
    assert.equal(mod.relativeTime(Date.now()), "just now");
    assert.ok(mod.relativeTime(Date.now() - 120000).includes("m ago"));
  });
});
