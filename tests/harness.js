/* Minimal test harness usable from Node and the browser. Each test carries requirement IDs for the traceability matrix. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else (root.OMH_TEST = api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  function create(suite) {
    const tests = [];
    const t = (id, name, reqs, fn) => tests.push({ id, name, reqs, fn });
    const assert = {
      ok(c, m) { if (!c) throw new Error('assert.ok failed' + (m ? ': ' + m : '')); },
      eq(a, b, m) { if (a !== b) throw new Error('expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a) + (m ? ' — ' + m : '')); },
      deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a) + (m ? ' — ' + m : '')); },
      near(a, b, eps, m) { if (Math.abs(a - b) > (eps || 1e-9)) throw new Error('expected ~' + b + ' got ' + a + (m ? ' — ' + m : '')); },
      throws(fn, code, m) { try { fn(); } catch (e) { if (code && e.code !== code && !String(e.message).includes(code)) throw new Error('threw ' + e.code + '/' + e.message + ' expected ' + code); return; } throw new Error('expected throw' + (m ? ': ' + m : '')); },
      skip(m) { const e = new Error('SKIP: ' + (m || '')); e.skip = true; throw e; },      // a test that cannot run in this checkout (for example the legacy module is not published)
      includes(arr, x, m) { if (!arr.includes(x)) throw new Error('expected ' + JSON.stringify(arr) + ' to include ' + JSON.stringify(x) + (m ? ' — ' + m : '')); },
    };
    async function run(onResult) {
      const out = []; const t0 = Date.now();
      for (const x of tests) {
        const s = Date.now(); let status = 'PASS', error = null;
        try { await x.fn(assert); } catch (e) { status = e && e.skip ? 'SKIP' : 'FAIL'; error = String(e && e.message || e) + (e && e.stack ? ' @ ' + e.stack.split('\n').slice(1, 3).map(x => x.trim().replace(/^at /, '')).join(' <- ') : ''); }
        out.push({ id: x.id, name: x.name, reqs: x.reqs, status, error, ms: Date.now() - s }); if (onResult) onResult(out[out.length - 1]);
      }
      return { suite, total: out.length, passed: out.filter(r => r.status === 'PASS').length, failed: out.filter(r => r.status === 'FAIL').length, skipped: out.filter(r => r.status === 'SKIP').length, ms: Date.now() - t0, results: out };
    }
    return { test: t, run, assert, tests };
  }
  return { create };
});
