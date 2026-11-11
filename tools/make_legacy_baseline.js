'use strict';
// One-off: snapshot the ORIGINAL repo HEAD (reference/OMH-NICE) compute() results as a golden fixture.
const path = require('path'), fs = require('fs');
const { loadLegacy, legacyHash } = require('../tests/helpers/legacy_loader');
const orig = path.join(__dirname, '../../reference/OMH-NICE/app.js');
const { api } = loadLegacy(orig);
const D = api.getData();
const rows = D.companies.map(c => { const r = api.compute(c); return { id: c.id, weighted: r.weighted, scoreGrade: r.scoreGrade, finalGrade: r.finalGrade, exposure: r.exposure, coverage: r.coverage, dFlags: r.dFlags.length, cFlags: r.cFlags.length, recDeposit: r.recDeposit, recDays: r.recDays }; });
fs.writeFileSync(path.join(__dirname, '../tests/fixtures/legacy_baseline.json'), JSON.stringify({ sourceCommit: '9edba87', storeKey: api.STORE_KEY, sha256_lf: legacyHash(orig), weights: api.DEFAULT_WEIGHTS, thresholds: api.DEFAULT_THRESHOLDS, rows }, null, 2));
console.log(rows.map(r => `${r.id} ${r.weighted.toFixed(1)} ${r.scoreGrade}->${r.finalGrade}`).join('\n'));
