'use strict';
// Converts the PIC tracker sheets (saved as CSV UTF-8) into the unified import files and an input-check list. Nothing is uploaded or stored by this tool.
//   node tools/tracker_import.js --existing <existing.csv> [--topup <topup.csv>] [--risk <risk.csv>] --as-of YYYY-MM-DD --out <folder> [--country VN] [--entity OMH-VN] [--currency VND] [--synthetic]
// Writes contracts.csv, ledger.csv, confirmations.csv and issues.csv into <folder>. Real tracker data must be written OUTSIDE this project (the tool refuses otherwise); use --synthetic for invented data.
const fs = require('fs'), path = require('path');
const Tracker = require('../js/engine/tracker.js');
const PROJECT = path.resolve(__dirname, '../..');

const args = process.argv.slice(2), f = {};
for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) { const k = args[i].slice(2); f[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; }
const die = (m, c) => { console.error(m); process.exit(c || 1); };
if (!f.existing || !f['as-of'] || !f.out) die('usage: node tools/tracker_import.js --existing <csv> [--topup <csv>] [--risk <csv>] --as-of YYYY-MM-DD --out <folder> [--synthetic]');
const out = path.resolve(f.out);
if (!f.synthetic && out.toLowerCase().startsWith(PROJECT.toLowerCase())) die('refused: tracker data of real hotels must be written outside ' + PROJECT + ' (use --synthetic for invented data)');
const read = p => fs.readFileSync(p, 'utf8');
const o = { asOf: f['as-of'] }; for (const k of ['country', 'entity', 'currency']) if (typeof f[k] === 'string') o[k] = f[k];
const r = Tracker.convert({ existing: read(f.existing), topUpLog: f.topup ? read(f.topup) : '', risk: f.risk ? read(f.risk) : '' }, o);
fs.mkdirSync(out, { recursive: true });
for (const [name, text] of Object.entries(Tracker.unifiedCsv(r))) fs.writeFileSync(path.join(out, name), text);
console.log('rows ' + r.summary.rows + ' · converted ' + r.summary.converted + ' · ledger rows ' + r.summary.ledgerRows + ' · errors ' + r.summary.errors + ' · warnings ' + r.summary.warnings + ' · info ' + r.summary.info);
for (const i of r.issues.filter(x => x.severity !== 'INFO').slice(0, 40)) console.log('  ' + i.severity.padEnd(5) + ' row ' + String(i.rowNo == null ? '-' : i.rowNo).padEnd(4) + (i.hotelId || '-').padEnd(10) + i.code + (i.detail ? '  ' + i.detail : ''));
console.log('wrote ' + out);
process.exit(r.summary.errors ? 2 : 0);
