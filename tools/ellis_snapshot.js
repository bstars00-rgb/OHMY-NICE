'use strict';
// Command-line helper around js/adapters/ellis.js.
//   node tools/ellis_snapshot.js build <calls.json> <out.json> --collector CLAUDE_MCP --by "<name>" [--at <ISO time>] [--synthetic] [--partial-from <hotelCode>=<YYYY-MM-DD>[,<hotelCode>=<date>...]]
//   node tools/ellis_snapshot.js check <snapshot.json>
// --partial-from adds, for that hotel, the aggregate of the cut-off month from the given day on (a contract that starts mid-month). The date basis (check-in or check-out) is the one used in the calls' dateBasis.
// <calls.json> is an array of { tool: "get_hotel_bookings", args: {...the arguments you sent...}, response: {...the tool output...} | null, error?: "..." }.
// A snapshot built from real ELLIS data is refused if its output path is inside this project, so it cannot end up in a public repository by accident.
const fs = require('fs'), path = require('path');
const Ellis = require('../js/adapters/ellis.js');
const PROJECT = path.resolve(__dirname, '../..');

const [cmd, ...rest] = process.argv.slice(2); const flags = {}; const pos = [];
for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) { const k = rest[i].slice(2); flags[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } else pos.push(rest[i]); }
const fail = (m, code) => { console.error(m); process.exit(code || 1); };
const show = (s) => {
  const v = Ellis.validateSnapshot(s); const months = s.hotels.reduce((n, h) => n + h.months.length, 0);
  console.log('hotels ' + s.hotels.length + ' · hotel-months ' + months + ' · window ' + s.window.from + '..' + s.window.to + ' · collector ' + s.provenance.collector + ' · synthetic ' + s.provenance.synthetic + ' · hash ' + s.hash);
  console.log('rows seen ' + s.provenance.rowStats.rows + ' · duplicates ' + s.provenance.rowStats.duplicates + ' · rejected ' + JSON.stringify(s.provenance.rowStats.rejected));
  if (v.warnings.length) console.log('warnings: ' + v.warnings.join(', '));
  if (!v.ok) console.error('INVALID: ' + v.errors.join(', '));
  return v;
};

if (cmd === 'build') {
  if (pos.length < 2) fail('usage: build <calls.json> <out.json> --collector CLAUDE_MCP --by "<name>"');
  const calls = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
  const collector = flags.collector || 'CLAUDE_MCP'; const synthetic = !!flags.synthetic;
  const out = path.resolve(pos[1]);
  if (!synthetic && out.toLowerCase().startsWith(PROJECT.toLowerCase()) && !flags['allow-in-repo']) fail('refused: a snapshot of real ELLIS data must be written outside ' + PROJECT + ' (use --synthetic for invented data)');
  const partialFrom = {}; if (typeof flags['partial-from'] === 'string') for (const kv of flags['partial-from'].split(',')) { const [k, d] = kv.split('='); partialFrom[(k || '').trim()] = (d || '').trim(); }
  const snap = Ellis.buildFromCalls(calls, { collector, collectedBy: flags.by || '', collectedAt: flags.at || new Date().toISOString(), synthetic, partialFrom });
  const v = show(snap); if (!v.ok) fail('not written', 2);
  fs.writeFileSync(out, JSON.stringify(snap, null, 1)); console.log('wrote ' + out);
} else if (cmd === 'check') {
  if (!pos[0]) fail('usage: check <snapshot.json>'); const v = show(JSON.parse(fs.readFileSync(pos[0], 'utf8'))); process.exit(v.ok ? 0 : 2);
} else fail('usage: build | check (see the header of this file)');
