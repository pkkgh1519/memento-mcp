import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../../lib/rate-limiter.js";

describe("RateLimiter", () => {
  let limiter;

  beforeEach(() => {
    limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
  });

  it("allows requests within limit", () => {
    assert.ok(limiter.allow("1.2.3.4"));
    assert.ok(limiter.allow("1.2.3.4"));
    assert.ok(limiter.allow("1.2.3.4"));
  });

  it("blocks requests exceeding limit", () => {
    limiter.allow("1.2.3.4");
    limiter.allow("1.2.3.4");
    limiter.allow("1.2.3.4");
    assert.strictEqual(limiter.allow("1.2.3.4"), false);
  });

  it("isolates different IPs", () => {
    limiter.allow("1.2.3.4");
    limiter.allow("1.2.3.4");
    limiter.allow("1.2.3.4");
    assert.ok(limiter.allow("5.6.7.8"));
  });

  it("resets after window expires", async () => {
    limiter = new RateLimiter({ windowMs: 50, maxRequests: 1 });
    limiter.allow("1.2.3.4");
    assert.strictEqual(limiter.allow("1.2.3.4"), false);
    await new Promise(r => setTimeout(r, 60));
    assert.ok(limiter.allow("1.2.3.4"));
  });

  it("cleanup removes expired entries", async () => {
    limiter = new RateLimiter({ windowMs: 50, maxRequests: 10 });
    limiter.allow("1.2.3.4");
    await new Promise(r => setTimeout(r, 60));
    limiter.cleanup();
    assert.strictEqual(limiter.size, 0);
  });
});
