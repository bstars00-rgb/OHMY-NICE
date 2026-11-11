/* Common weighted-scoring engine, shared by partner (legacy A–E) and hotel (A–D) assessments.
   Math is intentionally identical to legacy compute(): acc += s/max*w ; score = acc/Σw*100  (parity-tested). */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory();
  NS.Weighted = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  /** items: [{score:number|null, weight:number}] — null/undefined score = Unknown: excluded from numerator AND denominator. */
  function weightedScore(items, max) {
    max = max || 5; let acc = 0, wsum = 0, total = 0;
    for (const it of items) {
      const w = Number(it.weight) || 0; total += w;
      if (it.score == null || it.score === '') continue;
      acc += (Number(it.score) || 0) / max * w; wsum += w;
    }
    return { score: wsum > 0 ? acc / wsum * 100 : null, knownWeight: wsum, totalWeight: total, coverage: total > 0 ? wsum / total : 0 };
  }
  /** thresholds: [[grade,min],...] descending; below the last -> fallback */
  function gradeFor(score, thresholds, fallback) { if (score == null) return null; for (const [g, min] of thresholds) if (score >= min) return g; return fallback; }
  /** worse (later in order) of two grades */
  function worse(a, b, order) { return order.indexOf(a) >= order.indexOf(b) ? a : b; }
  return { weightedScore, gradeFor, worse };
});
