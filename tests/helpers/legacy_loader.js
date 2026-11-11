'use strict';
// Loads the UNMODIFIED legacy OMH-NICE app.js in a Node vm sandbox (no DOM) so its compute() can be
// used as a regression oracle. The trailing boot call render() is removed in memory only.
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
function readLegacy(file) { return fs.readFileSync(file || path.join(__dirname, '../../legacy/app.js'), 'utf8').replace(/\r\n/g, '\n'); }
function legacyHash(file) { return crypto.createHash('sha256').update(readLegacy(file)).digest('hex'); }
function loadLegacy(file) {
  const store = {};
  const noop = () => {};
  const mkEl = () => new Proxy(function(){}, { get: (t, k) => (k === 'style' || k === 'dataset' || k === 'classList') ? mkEl() : (k === 'querySelectorAll' ? (() => []) : (k === Symbol.toPrimitive ? () => '' : noop)), set: () => true });
  const sandbox = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { getElementById: (id) => (id === 'manual-btn' || id === 'manual-close' || id === 'manual-modal') ? null : mkEl(), addEventListener: noop, querySelectorAll: () => [], documentElement: {} },
    window: {}, confirm: () => true, alert: noop, console, Blob: function () {}, URL: {}, navigator: {},
  };
  sandbox.globalThis = sandbox;
  let src = readLegacy(file);
  const idx = src.lastIndexOf('render();');
  if (idx < 0) throw new Error('legacy boot call not found');
  src = src.slice(0, idx) + '\n;globalThis.__legacy={compute,seed,getData:()=>DATA,DEFAULT_WEIGHTS,DEFAULT_THRESHOLDS,TERM_TIERS,STORE_KEY,recommendTerms,RANK,normalizeCompany};';
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'legacy/app.js' });
  return { api: sandbox.__legacy, store };
}
module.exports = { loadLegacy, legacyHash, readLegacy };
