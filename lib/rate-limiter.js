/**
 * IP 기반 Sliding Window Rate Limiter (in-process)
 *
 * 작성자: 최진호
 * 작성일: 2026-03-08
 */

export class RateLimiter {
  /**
   * @param {{ windowMs: number, maxRequests: number }} opts
   */
  constructor({ windowMs = 60_000, maxRequests = 120 } = {}) {
    this.windowMs    = windowMs;
    this.maxRequests = maxRequests;
    this._buckets    = new Map();
  }

  /**
   * @param {string} ip
   * @returns {boolean}
   */
  allow(ip) {
    const now    = Date.now();
    const cutoff = now - this.windowMs;
    let   hits   = this._buckets.get(ip);

    if (!hits) {
      hits       = [];
      this._buckets.set(ip, hits);
    }

    while (hits.length > 0 && hits[0] <= cutoff) {
      hits.shift();
    }

    if (hits.length >= this.maxRequests) {
      return false;
    }

    hits.push(now);
    return true;
  }

  cleanup() {
    const cutoff = Date.now() - this.windowMs;
    for (const [ip, hits] of this._buckets) {
      while (hits.length > 0 && hits[0] <= cutoff) {
        hits.shift();
      }
      if (hits.length === 0) {
        this._buckets.delete(ip);
      }
    }
  }

  get size() {
    return this._buckets.size;
  }

  destroy() {
    this._buckets.clear();
  }
}
