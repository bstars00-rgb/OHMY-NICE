'use strict';
// Runs every Node test, prints a summary and writes tests/results/node_results.json (consumed by tools/gen_reports.js).
const fs = require('fs'), path = require('path');
const H = require('./harness');
(async () => {
  const h = H.create('node');
  require('./engine_tests')(h); require('./system_tests')(h); require('./regression_tests')(h); require('./i18n_tests')(h); require('./ellis_tests')(h); require('./auth_tests')(h); require('./tracker_tests')(h); require('./outlook_tests')(h); require('./ledger_offset_tests')(h);
  const res = await h.run();
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results/node_results.json'), JSON.stringify(Object.assign({ ranAt: new Date().toISOString(), node: process.version }, res), null, 2));
  for (const r of res.results) if (r.status === 'FAIL') console.log('FAIL ' + r.id + ' ' + r.name + '\n     ' + r.error);
  console.log('node tests: ' + res.passed + '/' + res.total + ' passed, ' + res.failed + ' failed' + (res.skipped ? ', ' + res.skipped + ' skipped' : '') + ' (' + res.ms + ' ms)');
  process.exit(res.failed ? 1 : 0);
})();
