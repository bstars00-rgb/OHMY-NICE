'use strict';
// Builds samples/ellis_snapshot_SYNTHETIC.json: a snapshot of invented ELLIS bookings for the 15 sample hotels, produced by the same collect() path
// a real MCP client would use. All values are synthetic; hotel codes 90001..90015 belong to the sample master and 99999 is an unknown hotel.
// Usage: node tools/make_ellis_sample.js
const fs = require('fs'), path = require('path');
const Seed = require('../js/data/seed.js'), Ellis = require('../js/adapters/ellis.js'), Money = require('../js/core/money.js');
const { createFixtureSource, row } = require('../tests/helpers/ellis_fixture.js');

let seed = 20261106; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const s = Seed.buildSeed(); const hotelOf = Object.fromEntries(s.hotels.map(h => [h.hotelId, h])); const cByid = Object.fromEntries(s.contracts.map(c => [c.contractId, c]));
// factor applied to the ledger's confirmed consumption to invent the ELLIS side (1 = same, other values create a visible difference)
const FACTOR = { 'CT-KR-002:2026-10': 0.5, 'CT-JP-003:2026-09': 1.12 };
const EXTRA = { 'CT-VN-004:2026-10': 15e6 /* hotel says nothing consumed, ELLIS shows bookings */, 'CT-VN-001:2026-09': 610e6 /* ledger has no confirmed September */ };
const rows = []; const tot = {}, cnt = {}; let n = 0; const FX = { KRW: 1, JPY: 9, VND: 0.054, USD: 1380, SGD: 1030 };   // KRW per 1 unit of each currency: invented booking-time rates
for (const t of s.ledger) {
  if (t.type !== 'CONSUMPTION' || t.status !== 'confirmed' || !['2026-08', '2026-09', '2026-10'].includes(t.period)) continue;
  const c = cByid[t.contractId]; const key = t.contractId + ':' + t.period;
  const total = Math.round(t.amountMinor * (FACTOR[key] == null ? 1 + (rnd() - 0.5) * 0.06 : FACTOR[key]));
  if (total <= 0) continue;
  split(c, t.period, total); tot[t.contractId] = (tot[t.contractId] || 0) + total; cnt[t.contractId] = (cnt[t.contractId] || 0) + 1;
  if (t.contractId === 'CT-VN-001') { const usdNet = Math.round(total * 0.08 * FX.VND / FX.USD * 100), usdBill = Math.round(usdNet / 0.92), code = Number(hotelOf[c.hotelId].ellisHotelId.replace('ELLIS-', ''));   // a few USD bookings at a VND hotel: they are converted for the comparison
    rows.push(row({ bookingItemCode: 'SYN-' + code + '-USD-' + t.period, hotelCode: code, checkInDate: t.period + '-15', checkOutDate: t.period + '-16', currency: 'USD', billing: usdBill / 100, revenue: (usdBill - usdNet) / 100, fxRate: FX.USD, roomNights: 2 })); }
}
for (const [key, minor] of Object.entries(EXTRA)) { const [cid, per] = key.split(':'); split(cByid[cid], per, minor); }
// stays already on the books for the current and the next month (invented): about 55 % of an average month for November, 20 % for December
for (const cid of Object.keys(tot)) { const avg = tot[cid] / cnt[cid]; split(cByid[cid], '2026-11', Math.round(avg * 0.55)); split(cByid[cid], '2026-12', Math.round(avg * 0.2)); }
function split(c, period, total) {
  const k = 3 + Math.floor(rnd() * 3), hotel = hotelOf[c.hotelId], code = Number(hotel.ellisHotelId.replace('ELLIS-', ''));
  let left = total;
  for (let i = 0; i < k; i++) {
    const part = i === k - 1 ? left : Math.floor(total / k); left -= part; const bMinor = Math.round(part / 0.92); const d = Money.decimals(c.currency);
    const day = String(1 + Math.floor(rnd() * 26)).padStart(2, '0'); const ci = period + '-' + day;
    rows.push(row({ bookingItemCode: 'SYN-' + code + '-' + c.currency + '-' + period + '-' + (++n), hotelCode: code, checkInDate: ci, checkOutDate: ci, roomNights: 1 + (i % 3), currency: c.currency, baseCurrencyCode: 'KRW',
      billing: bMinor / Math.pow(10, d), revenue: (bMinor - part) / Math.pow(10, d), fxRate: FX[c.currency] }));   // net (billing - revenue) = the ledger amount, so a normal booking matches on the default NET basis
  }
  rows.push(row({ bookingItemCode: 'SYN-' + code + '-CXL-' + period + '-' + (++n), hotelCode: code, checkInDate: period + '-10', checkOutDate: period + '-11', currency: c.currency, billing: 999999, revenue: 0, fxRate: FX[c.currency], bookingStatus: 'Cancelled', cancelDate: period + '-05' }));
}
rows.push(row({ bookingItemCode: 'SYN-99999-1', hotelCode: 99999, checkInDate: '2026-10-12', checkOutDate: '2026-10-13', currency: 'KRW', billing: 123000 }));   // a hotel that is not in our master
const codes = [...new Set([...s.hotels.map(h => Number(h.ellisHotelId.replace('ELLIS-', ''))), 99999])].sort((a, b) => a - b);   // every master hotel is requested, so a month without rows is a known zero
Ellis.collect({ source: createFixtureSource(rows), hotelCodes: codes, from: '2026-08-01', to: '2026-12-31', collector: 'FIXTURE', collectedBy: 'make_ellis_sample.js', collectedAt: '2026-11-06T08:30:00+09:00', synthetic: true }).then(({ snapshot }) => {
  const v = Ellis.validateSnapshot(snapshot); if (!v.ok) throw new Error('sample snapshot invalid: ' + v.errors);
  const out = path.join(__dirname, '../samples/ellis_snapshot_SYNTHETIC.json'); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 1));
  // the browser app cannot fetch() (CSP), so the same synthetic snapshot is also shipped as a script for the "Load synthetic sample" button
  fs.writeFileSync(path.join(__dirname, '../js/data/ellis_sample.js'), '/* SYNTHETIC ELLIS snapshot (invented values) generated by tools/make_ellis_sample.js — do not edit. */\n(function (root) { (root.OMH || (root.OMH = {})).EllisSample = ' + JSON.stringify(snapshot) + '; })(typeof self !== \'undefined\' ? self : globalThis);\n');
  console.log('wrote', out, '- hotels', snapshot.hotels.length, 'hash', snapshot.hash, 'warnings', v.warnings.join(','));
});
