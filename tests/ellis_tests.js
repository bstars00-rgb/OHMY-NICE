'use strict';
// ELLIS MCP integration (snapshot adapter, import command, comparison). All data is synthetic; no MCP server is called.
const fs = require('fs'), path = require('path');
const env = require('./helpers/env');
const { createFixtureSource, row } = require('./helpers/ellis_fixture');
const { Ellis, Store, Money } = env;

const META = { collector: 'FIXTURE', collectedBy: 'test', collectedAt: '2026-11-06T08:30:00+09:00', synthetic: true };
const snapOf = async (rows, codes, from, to, meta, srcOpts) => (await Ellis.collect({ source: createFixtureSource(rows, srcOpts), hotelCodes: codes, from: from || '2026-08-01', to: to || '2026-10-31', ...Object.assign({}, META, meta || {}) })).snapshot;
const mk = (code, month, i, o) => row(Object.assign({ bookingItemCode: 'T-' + code + '-' + month + '-' + i, hotelCode: code, checkInDate: month + '-' + String(1 + (i % 27)).padStart(2, '0'), checkOutDate: month + '-28' }, o || {}));
const monthRows = (code, month, totalMinor, n, o) => { const out = []; let left = totalMinor; for (let i = 0; i < n; i++) { const p = i === n - 1 ? left : Math.floor(totalMinor / n); left -= p; out.push(mk(code, month, i, Object.assign({ billing: p, revenue: 0 }, o || {}))); } return out; };
const freshStore = (o) => env.as(env.newStore(o), 'SCM');
const sampleSnap = () => JSON.parse(fs.readFileSync(path.join(env.root, 'samples/ellis_snapshot_SYNTHETIC.json'), 'utf8'));
const retag = (snap, f) => { const c = JSON.parse(JSON.stringify(snap)); f(c); c.hash = Ellis.hashOf(c); return c; };

module.exports = function (h) {
  const { test: t } = h;

  t('M01', 'hotel code normalisation and decimal-to-minor conversion', ['ELLIS-3', 'ELLIS-4'], a => {
    a.eq(Ellis.hotelKey(453378), '453378'); a.eq(Ellis.hotelKey(' ELLIS-90001 '), '90001'); a.eq(Ellis.hotelKey('ellis-7'), '7');
    for (const bad of [0, -3, 1.5, '', 'abc', 'ELLIS-', '007', null, undefined, {}, 1e15, '1234567890123']) a.eq(Ellis.hotelKey(bad), null, String(bad));
    a.eq(Ellis.toMinor(27000, 'JPY'), 27000); a.eq(Ellis.toMinor(12.34, 'USD'), 1234); a.eq(Ellis.toMinor(0.1 + 0.2, 'USD'), 30);
    a.eq(Ellis.toMinor(100.5, 'KRW'), null, 'fractional KRW cannot be represented'); a.eq(Ellis.toMinor(1.005, 'USD'), null, 'sub-cent precision refused');
    a.eq(Ellis.toMinor(NaN, 'KRW'), null); a.eq(Ellis.toMinor(Infinity, 'KRW'), null); a.eq(Ellis.toMinor('5', 'KRW'), null); a.eq(Ellis.toMinor(5, 'CNY'), null); a.eq(Ellis.toMinor(1e20, 'KRW'), null);
  });

  t('M02', 'month windows respect the 30-day limit and the fixture enforces the same rules as the tool', ['ELLIS-2'], async a => {
    const w = Ellis.monthWindows('2026-01-15', '2026-03-10'); a.deepEq(w.map(x => x.from + '/' + x.to), ['2026-01-15/2026-01-31', '2026-02-01/2026-02-28', '2026-03-01/2026-03-10']);
    for (const x of Ellis.monthWindows('2025-12-01', '2027-02-28')) a.ok(env.Dates.diffDays(x.from, x.to) <= 30, x.from);
    const src = createFixtureSource([]);
    let threw = 0; for (const args of [{ dateBasis: 'CHECK_IN_DATE', fromDate: '2026-10-01', toDate: '2026-11-05' }, { dateBasis: 'WRONG', fromDate: '2026-10-01', toDate: '2026-10-02' }, { dateBasis: 'CHECK_IN_DATE', fromDate: '2026-10-05', toDate: '2026-10-01' }]) { try { await src.getBookings(args); } catch (e) { threw++; } }
    a.eq(threw, 3);
  });

  t('M03', 'collect pages through more than one page and totals match the source exactly', ['ELLIS-2', 'ELLIS-3'], async a => {
    const rows = monthRows(555, '2026-10', 2300 * 10, 2300);                         // 2300 rows in one hotel-month -> 3 pages of <=1000
    const src = createFixtureSource(rows); const r = await Ellis.collect({ source: src, hotelCodes: [555], from: '2026-10-01', to: '2026-10-31', ...META });
    a.eq(src.calls.length, 3); a.deepEq(src.calls.map(c => c.offset), [0, 1000, 2000]); a.ok(src.calls.every(c => c.limit <= 1000 && env.Dates.diffDays(c.fromDate, c.toDate) <= 30));
    const s = r.snapshot, cur = s.hotels[0].months[0].byCurrency[0];
    a.eq(s.provenance.truncated, false); a.eq(cur.bookings, 2300); a.eq(cur.billingMinor, 23000); a.deepEq(s.hotels[0].coveredMonths, ['2026-10']);
    a.ok(Ellis.validateSnapshot(s).ok);
  });

  t('M04', 'an incompletely paged result is flagged truncated and refused, never totalled', ['ELLIS-1', 'ELLIS-2'], async a => {
    const rows = monthRows(555, '2026-10', 150000, 150);
    const cut = await snapOf(rows, [555], '2026-10-01', '2026-10-31', null, { cap: 100 });                       // server returns 100 of 150
    a.eq(cut.provenance.truncated, true); a.ok(cut.provenance.warnings.includes('INCOMPLETE_PAGING')); a.deepEq(cut.hotels[0].coveredMonths, [], 'a truncated month is not "covered"');
    a.ok(Ellis.validateSnapshot(cut).errors.includes('E_ELLIS_TRUNCATED'));
    const st = freshStore(); const sample = sampleSnap();
    const bad = retag(sample, c => { c.provenance.truncated = true; });
    const r = st.commands.importEllisSnapshot(bad); a.ok(!r.ok && r.errors.includes('E_ELLIS_TRUNCATED'));
    // gap, failed call and an explicit tool warning
    const page = (offset, n, total) => ({ tool: 'get_hotel_bookings', args: { dateBasis: 'CHECK_IN_DATE', fromDate: '2026-10-01', toDate: '2026-10-31', hotelCode: 555, limit: 2, offset }, response: { list: rows.slice(offset, offset + n), totalCount: total, limit: 2, offset } });
    a.eq(Ellis.buildFromCalls([page(0, 2, 4), page(2, 2, 4)], META).provenance.truncated, false);
    a.eq(Ellis.buildFromCalls([page(0, 2, 4), page(4, 2, 6)], META).provenance.truncated, true, 'offset gap');
    a.eq(Ellis.buildFromCalls([page(0, 2, 4)], META).provenance.truncated, true, 'second page never fetched');
    a.eq(Ellis.buildFromCalls([page(0, 2, 4), Object.assign(page(2, 2, 4), { response: null, error: 'timeout' })], META).provenance.truncated, true, 'failed call');
    const warn = page(0, 2, 2); warn.response.warnings = [{ code: 'ROWS_TRUNCATED' }];
    a.eq(Ellis.buildFromCalls([warn], META).provenance.truncated, true, 'tool warning ROWS_TRUNCATED');
    const moved = [page(0, 2, 4), page(2, 2, 5)]; a.eq(Ellis.buildFromCalls(moved, META).provenance.truncated, true, 'totalCount changed between pages');
  });

  t('M05', 'call validation: wrong basis, long window, bad hotel code and non-booking tools are refused', ['ELLIS-2'], a => {
    const base = { tool: 'get_hotel_bookings', args: { dateBasis: 'CHECK_IN_DATE', fromDate: '2026-10-01', toDate: '2026-10-31', hotelCode: 1, limit: 1000, offset: 0 }, response: { list: [], totalCount: 0 } };
    const mut = f => { const c = JSON.parse(JSON.stringify(base)); f(c); return [c]; };
    a.throws(() => Ellis.buildFromCalls(mut(c => { c.args.dateBasis = 'BOOKING_DATE'; }), META), 'E_ELLIS_BASIS');
    a.throws(() => Ellis.buildFromCalls(mut(c => { c.args.toDate = '2026-11-05'; }), META), 'E_ELLIS_WINDOW_TOO_LONG');
    a.throws(() => Ellis.buildFromCalls(mut(c => { c.args.toDate = '2026-09-30'; }), META), 'E_ELLIS_WINDOW');
    a.throws(() => Ellis.buildFromCalls(mut(c => { c.args.hotelCode = 'x'; }), META), 'E_ELLIS_HOTEL_CODE');
    a.throws(() => Ellis.buildFromCalls(mut(c => { c.tool = 'get_settlement'; }), META), 'E_ELLIS_CALL_SHAPE');
    a.throws(() => Ellis.buildFromCalls([], META), 'E_ELLIS_NO_CALLS');
    a.eq(Ellis.buildFromCalls(mut(() => { }), META).provenance.truncated, false);
  });

  t('M06', 'duplicates, rows without ids, rows outside the window and wrong-hotel rows are not counted', ['ELLIS-2', 'ELLIS-3'], async a => {
    const good = monthRows(555, '2026-10', 3000, 3);
    const rows = [...good, good[0] /* same bookingItemCode */, mk(555, '2026-10', 9, { bookingItemCode: undefined }), mk(555, '2026-10', 10, { bookingItemCode: 'T-NOCHECKIN', checkInDate: null }), mk(556, '2026-10', 11, { bookingItemCode: 'T-OTHER-HOTEL' })];
    const src = createFixtureSource(rows); const call = { dateBasis: 'CHECK_IN_DATE', fromDate: '2026-10-01', toDate: '2026-10-31', hotelCode: 555, limit: 1000, offset: 0 };
    // the fixture filters by hotel, so hand-build a response that includes the awkward rows to exercise the aggregator
    const resp = { list: [...rows, mk(555, '2026-09', 12, { bookingItemCode: 'T-OUTSIDE', checkInDate: '2026-09-30' })], totalCount: rows.length + 1, limit: 1000, offset: 0 };
    const s = Ellis.buildFromCalls([{ tool: 'get_hotel_bookings', args: call, response: resp }], META);
    const cur = s.hotels[0].months[0].byCurrency[0];
    a.eq(s.hotels.length, 1); a.eq(cur.bookings, 3); a.eq(cur.billingMinor, 3000);
    a.eq(s.provenance.rowStats.duplicates, 1); a.eq(s.provenance.rowStats.rejected.NO_ROW_ID, 1); a.eq(s.provenance.rowStats.rejected.NO_CHECKIN, 1); a.eq(s.provenance.rowStats.rejected.HOTEL_FILTER_MISMATCH, 1); a.eq(s.provenance.rowStats.rejected.OUT_OF_WINDOW, 1);
    void src;
  });

  t('M07', 'currencies stay separate; decimals, cancelled rows, restricted and unusable amounts are handled without guessing', ['ELLIS-3'], async a => {
    const rows = [
      mk(555, '2026-10', 1, { currency: 'KRW', billing: 1000, revenue: 100, roomNights: 2 }), mk(555, '2026-10', 2, { currency: 'KRW', billing: 500, revenue: 50, roomNights: 1 }),
      mk(555, '2026-10', 3, { currency: 'USD', billing: 12.34, revenue: 1.1, roomNights: 1 }), mk(555, '2026-10', 4, { currency: 'USD', billing: 0.66, revenue: 0, roomNights: 1 }),
      mk(555, '2026-10', 5, { currency: 'KRW', billing: 999999, bookingStatus: 'Cancelled', cancelDate: '2026-10-02' }),
      mk(555, '2026-10', 6, { currency: 'KRW', billing: null, revenue: null }),                                   // finance-scoped nulling
      mk(555, '2026-10', 7, { currency: 'KRW', billing: 100.5 }),                                                  // cannot be represented
      mk(555, '2026-10', 8, { currency: 'CNY', billing: 70 }),                                                     // unsupported currency
    ];
    const s = await snapOf(rows, [555], '2026-10-01', '2026-10-31'); const m = s.hotels[0].months[0];
    const krw = m.byCurrency.find(x => x.currency === 'KRW'), usd = m.byCurrency.find(x => x.currency === 'USD');
    a.deepEq(m.byCurrency.map(x => x.currency), ['KRW', 'USD']);
    a.eq(krw.billingMinor, 1500); a.eq(krw.revenueMinor, 150); a.eq(krw.bookings, 2); a.eq(krw.roomNights, 3); a.eq(krw.cancelledBookings, 1);
    a.eq(usd.billingMinor, 1300); a.eq(usd.revenueMinor, 110);
    a.eq(m.skippedRows, 3, 'restricted + unrepresentable + unsupported currency');
    a.eq(s.provenance.rowStats.rejected.BILLING_RESTRICTED, 1); a.eq(s.provenance.rowStats.rejected.AMOUNT_UNUSABLE, 1); a.eq(s.provenance.rowStats.rejected.CURRENCY_UNSUPPORTED, 1);
    const r2 = await snapOf([mk(555, '2026-10', 1, { billing: 1000, revenue: null })], [555], '2026-10-01', '2026-10-31');       // revenue hidden, billing visible
    a.eq(r2.hotels[0].months[0].byCurrency[0].revenueMinor, null);
  });

  t('M08', 'the snapshot keeps aggregates only: no guest, booking or seller references', ['ELLIS-1', 'ELLIS-3'], async a => {
    const rows = monthRows(555, '2026-10', 5000, 5, { guestName: 'K***', hotelName: 'Real Looking Hotel Name', sellerName: 'Seller X', sellerBookingCode: 'SELLER^123', cmsName: 'CMS-X' });
    const s = await snapOf(rows, [555], '2026-10-01', '2026-10-31'); const json = JSON.stringify(s);
    for (const word of ['guestName', 'K***', 'Real Looking', 'Seller X', 'SELLER^', 'CMS-X', 'bookingItemCode', 'T-555']) a.ok(!json.includes(word), word);
    a.ok(Ellis.validateSnapshot(s).ok);
    for (const k of ['guestName', 'bookingItemCode', 'sellerBookingCode', 'cmsName', 'email', 'phone']) {
      const bad = retag(s, c => { c.hotels[0][k] = 'x'; }); const v = Ellis.validateSnapshot(bad); a.ok(!v.ok && v.errors.some(e => e.startsWith('E_ELLIS_PII_FIELD')), k);
    }
  });

  t('M09', 'snapshot validation rejects tampering and malformed content', ['ELLIS-1'], async a => {
    const s = sampleSnap(); a.ok(Ellis.validateSnapshot(s).ok);
    const bad = (f, code) => { const c = JSON.parse(JSON.stringify(s)); f(c); const v = Ellis.validateSnapshot(c, { now: '2026-11-06' }); a.ok(!v.ok && v.errors.includes(code), code + ' got ' + v.errors); };
    const bad2 = (f, code) => { const c = retag(s, f); const v = Ellis.validateSnapshot(c, { now: '2026-11-06' }); a.ok(!v.ok && v.errors.some(e => e === code || e.startsWith(code + ':')), code + ' got ' + v.errors); };
    bad(c => { c.hotels[0].months[0].byCurrency[0].billingMinor += 1; }, 'E_ELLIS_HASH');                  // edited after the fact
    bad2(c => { c.schema = 'other'; }, 'E_ELLIS_SCHEMA'); bad2(c => { c.version = 4; }, 'E_ELLIS_VERSION');
    bad2(c => { c.provenance.source = 'MANUAL'; }, 'E_ELLIS_SOURCE'); bad2(c => { c.provenance.collector = 'HUMAN'; }, 'E_ELLIS_COLLECTOR');
    bad2(c => { c.provenance.collectedAt = 'yesterday'; }, 'E_ELLIS_COLLECTED_AT'); bad2(c => { c.provenance.collectedAt = '2027-01-01T00:00:00Z'; }, 'E_ELLIS_FUTURE');
    bad2(c => { c.provenance.collector = 'CLAUDE_MCP'; c.provenance.collectedBy = ' '; }, 'E_ELLIS_COLLECTED_BY'); bad2(c => { delete c.provenance.synthetic; }, 'E_ELLIS_SYNTHETIC_FLAG');
    bad2(c => { c.provenance.tools[0].complete = false; }, 'E_ELLIS_TRUNCATED');
    bad2(c => { c.window.basis = 'BOOKING_DATE'; }, 'E_ELLIS_WINDOW'); bad2(c => { c.window.from = '2027-01-01'; }, 'E_ELLIS_WINDOW');
    bad2(c => { c.hotels.push(JSON.parse(JSON.stringify(c.hotels[0]))); }, 'E_ELLIS_HOTEL_DUPLICATE'); bad2(c => { c.hotels[0].hotelCode = '0123'; }, 'E_ELLIS_HOTEL_CODE');
    const withMonths = c => c.hotels.find(x => x.months.length);
    bad2(c => { withMonths(c).months[0].byCurrency[0].billingMinor = -1; }, 'E_ELLIS_AMOUNT'); bad2(c => { withMonths(c).months[0].byCurrency[0].billingMinor = 1.5; }, 'E_ELLIS_AMOUNT');
    bad2(c => { withMonths(c).months[0].byCurrency[0].billingMinor = '5'; }, 'E_ELLIS_AMOUNT'); bad2(c => { withMonths(c).months[0].byCurrency[0].currency = 'CNY'; }, 'E_ELLIS_CURRENCY');
    bad2(c => { withMonths(c).months[0].byCurrency.push(JSON.parse(JSON.stringify(withMonths(c).months[0].byCurrency[0]))); }, 'E_ELLIS_CURRENCY');
    bad2(c => { withMonths(c).months[0].month = '2025-01'; }, 'E_ELLIS_MONTH_OUTSIDE_WINDOW'); bad2(c => { withMonths(c).months.push(JSON.parse(JSON.stringify(withMonths(c).months[0]))); }, 'E_ELLIS_MONTH');
    bad2(c => { withMonths(c).coveredMonths = ['2026-13']; }, 'E_ELLIS_COVERED');
    for (const junk of [null, 5, 'x', [], {}]) a.ok(!Ellis.validateSnapshot(junk).ok);
    a.ok(!Ellis.validateSnapshot({ ...s, hotels: 'x' }).ok);
    a.ok(Ellis.validateSnapshot(s).warnings.includes('W_ELLIS_SYNTHETIC'));
  });

  t('M10', 'covered months: adjacent windows merge, partial months do not count, empty covered month means zero', ['ELLIS-2', 'ELLIS-6'], async a => {
    a.deepEq(Ellis.coveredMonths([{ from: '2026-08-01', to: '2026-08-15' }, { from: '2026-08-16', to: '2026-09-30' }]), ['2026-08', '2026-09']);
    a.deepEq(Ellis.coveredMonths([{ from: '2026-08-02', to: '2026-09-15' }]), [], 'neither month is fully inside');
    a.deepEq(Ellis.coveredMonths([{ from: '2026-08-01', to: '2026-08-14' }, { from: '2026-08-16', to: '2026-08-31' }]), [], 'one-day hole');
    const s = await snapOf(monthRows(555, '2026-09', 1000, 2), [555, 556], '2026-08-01', '2026-10-31');
    a.deepEq(s.hotels.map(x => x.hotelCode), ['555', '556']); a.deepEq(s.hotels[1].coveredMonths, ['2026-08', '2026-09', '2026-10']); a.eq(s.hotels[1].months.length, 0, 'no bookings, still covered');
  });

  t('M11', 'hotel mapping: ELLIS-<code> and plain codes match, duplicates and missing ids are reported, unknown hotels are dropped', ['ELLIS-4'], a => {
    const snap = sampleSnap(); const hotels = Store.createStore({ storage: Store.memoryStorage() }).state.hotels;
    const m = Ellis.matchHotels(snap, hotels); a.eq(m.matched.length, 15); a.deepEq(m.unmatched, ['99999']); a.eq(m.unmapped.length, 0);
    const dup = hotels.map(x => ({ ...x })); dup[1].ellisHotelId = dup[0].ellisHotelId; dup[2].ellisHotelId = ''; dup[3].ellisHotelId = '4040404';
    const m2 = Ellis.matchHotels(snap, dup); a.ok(m2.conflicts.includes('90001')); a.ok(!m2.matched.some(x => x.hotelCode === '90001'), 'an ambiguous id is never matched');
    const why = Object.fromEntries(m2.unmapped.map(x => [x.hotelId, x.reason])); a.eq(why.H001, 'DUPLICATE_ELLIS_ID'); a.eq(why.H002, 'DUPLICATE_ELLIS_ID'); a.eq(why.H003, 'NO_ELLIS_ID'); a.eq(why.H004, 'NOT_IN_SNAPSHOT');
    const r = Ellis.restrictToMaster(snap, hotels); a.ok(!r.snapshot.hotels.some(x => x.hotelCode === '99999')); a.ok(Ellis.validateSnapshot(r.snapshot).ok); a.ok(r.snapshot.hash !== snap.hash);
  });

  t('M12', 'import command: permission, audit, only matched hotels stored, ledger and balances untouched', ['ELLIS-5', 'ELLIS-7'], a => {
    const snap = sampleSnap();
    for (const role of ['VIEWER', 'CEO']) {
      const st = env.as(env.newStore(), role); const before = JSON.stringify(st.state);
      a.throws(() => st.commands.importEllisSnapshot(snap), 'E_FORBIDDEN'); a.throws(() => st.commands.previewEllisSnapshot(snap), 'E_FORBIDDEN');
      a.ok(st.state.audit.some(e => e.action === 'ELLIS_IMPORT_SNAPSHOT' && e.outcome === 'DENIED'), role); a.ok(!st.state.ellis);
      a.eq(JSON.stringify(st.state.ledger), JSON.stringify(JSON.parse(before).ledger));
    }
    const st = freshStore(); const ledger0 = JSON.stringify(st.state.ledger), views0 = JSON.stringify(st.model().views.map(v => [v.contractId, v.balance, v.limit, v.rating.grade, v.forecast.avgMinor]));
    const r = st.commands.importEllisSnapshot(snap); a.ok(r.ok, JSON.stringify(r.errors));
    a.eq(st.state.ellis.snapshot.hotels.length, 15); a.ok(!st.state.ellis.snapshot.hotels.some(x => x.hotelCode === '99999'), 'unknown hotel is not stored'); a.eq(st.state.ellis.batches.length, 1);
    a.eq(JSON.stringify(st.state.ledger), ledger0, 'ledger identical'); a.eq(JSON.stringify(st.model().views.map(v => [v.contractId, v.balance, v.limit, v.rating.grade, v.forecast.avgMinor])), views0, 'balances, limits, grades unchanged');
    const e = st.state.audit[st.state.audit.length - 1]; a.eq(e.action, 'ELLIS_IMPORT_SNAPSHOT'); a.eq(e.outcome, 'OK'); a.eq(e.detail.hash, st.state.ellis.snapshot.hash); a.eq(e.detail.ledgerRowsAdded, 0); a.eq(e.detail.ignoredHotels, 1);
    a.ok(st.verifyAudit().ok); st.reload(); a.eq(st.loadStatus, 'OK', 'state with ELLIS data reloads cleanly');
  });

  t('M13', 'preview is a dry run: same rules, no state change, no audit row', ['ELLIS-5'], a => {
    const st = freshStore(); const snap = sampleSnap(); const before = JSON.stringify(st.state), n = st.state.audit.length;
    const p = st.commands.previewEllisSnapshot(snap); a.ok(p.ok); a.eq(p.match.matched.length, 15); a.eq(p.compare.byContract['CT-KR-002'].status, 'DIVERGENT'); a.eq(p.synthetic, true);
    a.eq(JSON.stringify(st.state), before); a.eq(st.state.audit.length, n);
    const bad = st.commands.previewEllisSnapshot(retag(snap, c => { c.provenance.truncated = true; })); a.ok(!bad.ok && bad.errors.includes('E_ELLIS_TRUNCATED'));
    a.ok(!st.commands.previewEllisSnapshot('{not json').ok && st.commands.previewEllisSnapshot('{not json').errors[0] === 'E_ELLIS_JSON');
    const viaString = st.commands.previewEllisSnapshot(JSON.stringify(snap)); a.ok(viaString.ok, 'file text is accepted');
  });

  t('M14', 'import rejects a repeat, an older snapshot and a snapshot with no known hotel; a newer one replaces the older', ['ELLIS-5'], async a => {
    const st = freshStore(); const snap = sampleSnap(); a.ok(st.commands.importEllisSnapshot(snap).ok);
    a.ok(st.commands.importEllisSnapshot(snap).errors.includes('E_ELLIS_ALREADY_IMPORTED'));
    const older = retag(snap, c => { c.provenance.collectedAt = '2026-11-05T08:30:00+09:00'; }); a.ok(st.commands.importEllisSnapshot(older).errors.includes('E_ELLIS_STALE'));
    const newer = retag(snap, c => { c.provenance.collectedAt = '2026-11-06T09:30:00+09:00'; }); const r = st.commands.importEllisSnapshot(newer); a.ok(r.ok, JSON.stringify(r.errors));
    a.eq(st.state.ellis.batches.length, 2); a.deepEq(st.state.ellis.batches.map(b => b.batchId), ['ELLIS-0001', 'ELLIS-0002']);
    const other = await snapOf(monthRows(31337, '2026-10', 1000, 2), [31337]); a.ok(st.commands.importEllisSnapshot(other).errors.includes('E_ELLIS_NO_MATCH'));
    const rejected = st.state.audit.filter(e => e.action === 'ELLIS_IMPORT_SNAPSHOT' && e.outcome === 'REJECTED'); a.ok(rejected.length >= 3);
  });

  t('M15', 'real ELLIS data never enters the sample state and sample data never enters a real one', ['ELLIS-5'], async a => {
    const real = await snapOf(monthRows(90001, '2026-10', 1000, 2), [90001], '2026-08-01', '2026-10-31', { collector: 'CLAUDE_MCP', collectedBy: 'someone', synthetic: false });
    a.ok(Ellis.validateSnapshot(real).ok);
    const st = freshStore(); a.eq(st.state.isSample, true);
    a.ok(st.commands.importEllisSnapshot(real).errors.includes('E_ELLIS_REAL_DATA_INTO_SAMPLE')); a.ok(!st.state.ellis);
    st.state.isSample = false;                                                                                     // a future non-sample master
    a.ok(st.commands.importEllisSnapshot(sampleSnap()).errors.includes('E_ELLIS_SYNTHETIC_INTO_REAL'));
    a.ok(st.commands.importEllisSnapshot(real).ok, 'real data into a real state is allowed');
  });

  t('M16', 'comparison statuses: match, tolerance edge, zero cases, missing months, currency mismatch, stale, deposits', ['ELLIS-6'], async a => {
    const mkState = async (rowsFor, o) => {
      const sy = env.synth(Object.assign({ cons: [30e6, 30e6, 30e6] }, o || {})); sy.hotel.ellisHotelId = 'ELLIS-777';
      const snap = await snapOf(rowsFor, [777], '2026-08-01', '2026-10-31'); sy.state.ellis = { snapshot: snap, batches: [] }; return sy;
    };
    const cmp = (sy, o) => Ellis.compare(sy.state, o).byContract['CT-T'];
    const sy = await mkState([...monthRows(777, '2026-08', 30e6, 3), ...monthRows(777, '2026-09', 39e6, 3), ...monthRows(777, '2026-10', 39.03e6, 3)]);
    let c = cmp(sy); a.eq(c.status, 'DIVERGENT'); a.deepEq(c.months.map(m => m.status), ['MATCH', 'MATCH', 'DIVERGENT']); a.eq(c.months[1].ratioPct, 130, '+30.0% is inside the tolerance'); a.eq(c.months[2].ratioPct, 130.1); a.eq(c.divergent, 1);
    a.eq(cmp(sy, { tolerancePct: 50 }).status, 'OK');
    // revenue changes the NET basis only
    const sn = await mkState([...monthRows(777, '2026-08', 30e6, 3, { revenue: 1e6 }), ...monthRows(777, '2026-09', 30e6, 3), ...monthRows(777, '2026-10', 30e6, 3)]);
    a.eq(cmp(sn).months[0].ratioPct, 90.0, 'NET (billing minus revenue) is the default basis'); a.eq(cmp(sn, { basis: 'BILLING' }).months[0].ratioPct, 100); a.eq(cmp(sn).months[0].ellisNetMinor, 30e6 - 3e6); a.eq(Ellis.compare(sn.state).basis, 'NET');
    // ledger confirmed zero versus ELLIS bookings, and both zero
    const z = await mkState([...monthRows(777, '2026-10', 5e6, 2)], { cons: [0, 0, 0] }); c = cmp(z); a.deepEq(c.months.map(m => m.status), ['MATCH', 'MATCH', 'DIVERGENT']); a.eq(c.months[0].ellisBillingMinor, 0, 'covered month without rows = zero');
    // ledger month missing (no confirmed record)
    const lm = await mkState([...monthRows(777, '2026-08', 30e6, 2), ...monthRows(777, '2026-09', 30e6, 2), ...monthRows(777, '2026-10', 30e6, 2)], { cons: [30e6, null, 30e6] }); a.eq(cmp(lm).months[1].status, 'LEDGER_MISSING');
    // currency mismatch: contract is JPY, ELLIS bookings are KRW
    const cm = await mkState([...monthRows(777, '2026-08', 30e6, 2), ...monthRows(777, '2026-09', 30e6, 2), ...monthRows(777, '2026-10', 30e6, 2)], { ccy: 'JPY', cons: [3e6, 3e6, 3e6], opening: 10e6 });
    c = cmp(cm); a.eq(c.status, 'CURRENCY_MISMATCH'); a.eq(c.months[0].status, 'CURRENCY_MISMATCH'); a.deepEq(c.months[0].otherCurrencies, ['KRW']);
    // incomplete ELLIS month (restricted amounts) is never compared
    const inc = await mkState([...monthRows(777, '2026-08', 30e6, 2), mk(777, '2026-08', 90, { billing: null }), ...monthRows(777, '2026-09', 30e6, 2), ...monthRows(777, '2026-10', 30e6, 2)]); a.eq(cmp(inc).months[0].status, 'ELLIS_INCOMPLETE');
    // not covered months, not in snapshot, not mapped, no snapshot, deposits, stale
    const nc = env.synth({}); nc.hotel.ellisHotelId = 'ELLIS-777'; nc.state.ellis = { snapshot: await snapOf(monthRows(777, '2026-10', 30e6, 2), [777], '2026-10-01', '2026-10-31'), batches: [] };
    c = cmp(nc); a.deepEq(c.months.map(m => m.status), ['NOT_COVERED', 'NOT_COVERED', 'MATCH']);
    const nis = env.synth({}); nis.hotel.ellisHotelId = 'ELLIS-123'; nis.state.ellis = nc.state.ellis; a.eq(cmp(nis).status, 'NOT_IN_SNAPSHOT');
    const nm = env.synth({}); nm.hotel.ellisHotelId = ''; nm.state.ellis = nc.state.ellis; a.eq(cmp(nm).status, 'NOT_MAPPED');
    const ns = env.synth({}); ns.hotel.ellisHotelId = 'ELLIS-777'; a.eq(cmp(ns).status, 'NO_SNAPSHOT');
    const dep = await mkState([], { type: 'SECURITY_DEPOSIT' }); a.eq(cmp(dep).status, 'NOT_APPLICABLE');
    a.eq(cmp(sy).stale, false); sy.state.config.asOf = '2026-11-20'; a.eq(cmp(sy).stale, true, 'snapshot older than 7 days');
  });

  t('M17', 'stored ELLIS data is integrity-checked on load: edited amounts, forged imports and malformed sections are caught', ['ELLIS-7'], a => {
    const mkSaved = () => { const storage = Store.memoryStorage(); const st = env.as(env.newStore({ storage }), 'SCM'); a.ok(st.commands.importEllisSnapshot(sampleSnap()).ok); return storage; };
    let storage = mkSaved(); let blob = JSON.parse(storage.getItem(Store.DEFAULT_KEY)); a.eq(env.newStore({ storage }).loadStatus, 'OK');
    blob.ellis.snapshot.hotels[0].months[0] = blob.ellis.snapshot.hotels.find(x => x.months.length).months[0]; const h = blob.ellis.snapshot.hotels.find(x => x.months.length); h.months[0].byCurrency[0].billingMinor += 1;
    storage.setItem(Store.DEFAULT_KEY, JSON.stringify(blob)); a.eq(env.newStore({ storage }).loadStatus, 'CORRUPT_RESET', 'edited amount without a matching hash');
    storage = mkSaved(); blob = JSON.parse(storage.getItem(Store.DEFAULT_KEY));                                                      // re-hashed edit: hash is valid, but the audit trail no longer matches
    const hh = blob.ellis.snapshot.hotels.find(x => x.months.length); hh.months[0].byCurrency[0].billingMinor += 1; blob.ellis.snapshot.hash = Ellis.hashOf(blob.ellis.snapshot);
    storage.setItem(Store.DEFAULT_KEY, JSON.stringify(blob)); a.eq(env.newStore({ storage }).loadStatus, 'CORRUPT_RESET', 'new hash, but the import history still names the old one');
    // thorough forgery: edit the snapshot, fix its hash, and rebuild the audit chain, the state hash in the import entry and the anchor so every generic check passes
    storage = mkSaved(); blob = JSON.parse(storage.getItem(Store.DEFAULT_KEY));
    const hx = blob.ellis.snapshot.hotels.find(x => x.months.length); hx.months[0].byCurrency[0].billingMinor += 1; hx.months[0].byCurrency[0].krwBillingMinor += 1; blob.ellis.snapshot.hash = Ellis.hashOf(blob.ellis.snapshot); blob.ellis.batches[blob.ellis.batches.length - 1].hash = blob.ellis.snapshot.hash;
    const parts = [blob.ledger, blob.hotels, blob.contracts, blob.ratings, blob.confirmations, blob.config, blob.sales, blob.ellis]; const last = blob.audit[blob.audit.length - 1]; a.eq(last.action, 'ELLIS_IMPORT_SNAPSHOT');
    last.detail.coreHash = env.Adapters.hash53(JSON.stringify(parts)); last.hash = env.Adapters.hash53(last.prevHash + JSON.stringify([last.seq, last.at, last.actor, last.role, last.action, last.entity, last.outcome, last.detail]));
    storage.setItem(Store.DEFAULT_KEY, JSON.stringify(blob)); storage.setItem(Store.DEFAULT_KEY + '.anchor', JSON.stringify({ seq: last.seq, hash: last.hash }));
    a.eq(env.newStore({ storage }).loadStatus, 'AUDIT_BROKEN', 'snapshot differs from the one named in the recorded import');
    storage = mkSaved(); blob = JSON.parse(storage.getItem(Store.DEFAULT_KEY)); blob.ellis = { snapshot: blob.ellis.snapshot, batches: 'x' }; storage.setItem(Store.DEFAULT_KEY, JSON.stringify(blob)); a.eq(env.newStore({ storage }).loadStatus, 'CORRUPT_RESET');
    storage = mkSaved(); blob = JSON.parse(storage.getItem(Store.DEFAULT_KEY)); blob.ellis = 5; storage.setItem(Store.DEFAULT_KEY, JSON.stringify(blob)); a.eq(env.newStore({ storage }).loadStatus, 'CORRUPT_RESET');
    const plain = Store.memoryStorage(); env.newStore({ storage: plain }); a.eq(env.newStore({ storage: plain }).loadStatus, 'OK', 'states saved before ELLIS existed still load');
    storage = Store.memoryStorage(); const s2 = env.newStore({ storage }); const blob2 = JSON.parse(storage.getItem(Store.DEFAULT_KEY)); const sn2 = sampleSnap(); blob2.ellis = { snapshot: sn2, batches: [{ batchId: 'ELLIS-0001', sourceHash: sn2.hash, hash: sn2.hash }] };
    storage.setItem(Store.DEFAULT_KEY, JSON.stringify(blob2)); a.eq(env.newStore({ storage }).loadStatus, 'AUDIT_BROKEN', 'ELLIS section with no recorded import'); void s2;
  });

  t('M18', 'the synthetic sample is valid, fully synthetic, and shows each comparison case it is meant to demonstrate', ['ELLIS-1', 'ELLIS-6', 'ELLIS-8'], a => {
    const s = sampleSnap(); const v = Ellis.validateSnapshot(s); a.ok(v.ok, v.errors.join()); a.eq(s.provenance.synthetic, true); a.eq(s.provenance.collector, 'FIXTURE');
    const st = freshStore(); a.ok(st.commands.importEllisSnapshot(s).ok); const c = st.ellisCompare().byContract;
    a.eq(c['CT-KR-002'].status, 'DIVERGENT'); a.eq(c['CT-VN-004'].status, 'DIVERGENT'); a.eq(c['CT-VN-001'].months[1].status, 'LEDGER_MISSING'); a.eq(c['CT-VN-003'].status, 'NOT_APPLICABLE');
    a.eq(c['CT-JP-004'].status, 'OK'); a.eq(c['CT-KR-001'].status, 'OK'); a.eq(c['CT-KR-005'].status, 'OK');
    a.ok(st.state.contracts.every(x => c[x.contractId]), 'every contract has a comparison row');
  });

  t('M19', 'the integration panel reports the snapshot adapter honestly and the tool contract lists only what is implemented', ['ELLIS-8', 'X-ELLIS'], a => {
    const i = env.Adapters.INTEGRATIONS.find(x => x.id === 'ELLIS'); a.eq(i.mode, 'SNAPSHOT (MCP)'); a.eq(i.verified, false, 'no live MCP call is verified inside the prototype');
    a.deepEq(Ellis.TOOL_CONTRACT.filter(x => x.status === 'IMPLEMENTED').map(x => x.tool), ['get_hotel_bookings']);
    for (const x of Ellis.TOOL_CONTRACT) a.ok(['IMPLEMENTED', 'PLANNED'].includes(x.status) && x.limits.length > 3);
    a.ok(!Object.keys(env.Adapters).some(k => /fetch|http|request/i.test(k)), 'no network function in the adapters');
    const src = fs.readFileSync(path.join(env.root, 'js/adapters/ellis.js'), 'utf8'); a.ok(!/\b(fetch|XMLHttpRequest|WebSocket|require\(['"](?:http|https|net)['"]\))/.test(src), 'ellis.js performs no I/O');
    a.ok(fs.readFileSync(path.join(env.root, 'index.html'), 'utf8').includes("connect-src 'none'"), 'CSP still blocks the browser from any network call');
  });

  t('M20', 'a large snapshot (50 hotels x 36 months) validates, imports and compares quickly', ['ELLIS-5', 'ELLIS-6'], async a => {
    const rows = []; for (let hc = 1000; hc < 1050; hc++) for (let m = 0; m < 36; m++) rows.push(...monthRows(hc, env.Dates.addMonths('2024-01', m), 1e6, 4));
    const t0 = Date.now(); const s = await snapOf(rows, Array.from({ length: 50 }, (_, i) => 1000 + i), '2024-01-01', '2026-12-31');
    a.eq(s.hotels.length, 50); a.ok(Ellis.validateSnapshot(s).ok); a.ok(Date.now() - t0 < 8000, 'built in ' + (Date.now() - t0) + ' ms');
    void Money;
  });

  /* ---- regression tests for the defects an independent review found in the first version ---- */
  const mkState = async (rows, from, to, o) => {
    const sy = env.synth(Object.assign({ cons: [30e6, 30e6, 30e6] }, o || {})); sy.hotel.ellisHotelId = 'ELLIS-777';
    sy.state.ellis = { snapshot: await snapOf(rows, [777], from || '2026-08-01', to || '2026-10-31'), batches: [] }; return sy;
  };
  const cmp = sy => Ellis.compare(sy.state).byContract['CT-T'];
  const withDay = (code, month, i, day, o) => mk(code, month, i, Object.assign({ checkInDate: month + '-' + day }, o || {}));

  t('M21', 'a month that was only partly collected is "not collected", never a false divergence', ['ELLIS-6', 'ELLIS-2'], async a => {
    const rows = [withDay(777, '2026-09', 1, '20', { billing: 15e6, revenue: 0 }), ...monthRows(777, '2026-10', 30e6, 3)];
    const sy = await mkState(rows, '2026-09-15', '2026-10-31'); a.deepEq(sy.state.ellis.snapshot.hotels[0].coveredMonths, ['2026-10']);
    a.deepEq(cmp(sy).months.map(m => m.status), ['NOT_COVERED', 'NOT_COVERED', 'MATCH'], 'August: nothing collected; September: half a month');
  });

  t('M22', 'unknown fields are refused wherever they appear; nothing outside the schema is stored', ['ELLIS-1', 'ELLIS-4'], async a => {
    const snap = sampleSnap(); const bad = (f, label) => { const c = retag(snap, f); const v = Ellis.validateSnapshot(c); a.ok(!v.ok && v.errors.some(e => e.startsWith('E_ELLIS_UNKNOWN_FIELD')), label + ' ' + v.errors); const st = freshStore(); a.ok(!st.commands.importEllisSnapshot(c).ok && !st.state.ellis, label + ' import'); };
    bad(c => { c.guests = [{ GuestName: 'KIM', booking_code: 'S26081111024H01', mail: 'k@example.com' }]; }, 'top-level guests');
    bad(c => { c.hotels[0].bookingRefs = ['S26081111024H01']; }, 'hotel refs'); bad(c => { c.provenance.note = 'x'; }, 'provenance'); bad(c => { c.provenance.tools[0].sellerRef = 'x'; }, 'tool entry');
    bad(c => { c.hotels.find(x => x.months.length).months[0].memo = 'x'; }, 'month'); bad(c => { c.hotels.find(x => x.months.length).months[0].byCurrency[0].guestRef = 'x'; }, 'currency row'); bad(c => { c.window.extra = 1; }, 'window');
    const viaJson = JSON.parse(JSON.stringify(snap).replace(/^\{/, '{"__proto__":{"x":1},')); const v = Ellis.validateSnapshot(viaJson); a.ok(!v.ok && v.errors.includes('E_ELLIS_UNKNOWN_FIELD:__proto__'), String(v.errors));
    const st = freshStore(); a.ok(st.commands.importEllisSnapshot(snap).ok); const s = st.state.ellis.snapshot, codes = new Set(st.state.hotels.map(h => Ellis.hotelKey(h.ellisHotelId)));
    a.ok(s.provenance.tools.every(x => x.hotelCode !== null && codes.has(x.hotelCode)), 'no pull of an unknown hotel is kept'); a.eq(s.provenance.rowStats.rows, s.provenance.tools.reduce((n, x) => n + x.rows, 0)); a.eq(s.provenance.restrictedFrom, snap.hash); a.ok(Ellis.validateSnapshot(s).ok);
  });

  t('M23', 'time stamps must be real and carry a zone; equal or unreadable times never count as newer', ['ELLIS-5', 'ELLIS-1'], a => {
    const D = env.Dates; for (const ok of ['2026-11-06T08:30:00+09:00', '2026-11-06T08:30:59Z', '2026-11-06T08:30+14:00', '2026-11-06T08:30:00-0330']) a.ok(D.isDateTime(ok), ok);
    for (const bad of ['2020-01-01T00:00:99Z', '2020-01-01T00:00:61Z', '2020-01-01T00:00:00+99:99', '2020-01-01T00:00:00+0960', '2020-01-01T00:00:00+15:00', '2020-02-30T00:00:00Z', '2020-01-01T24:00:00Z']) a.ok(!D.isDateTime(bad), bad);
    const snap = sampleSnap(); const nz = retag(snap, c => { c.provenance.collectedAt = '2026-11-06T08:30:00'; }); a.ok(Ellis.validateSnapshot(nz).errors.includes('E_ELLIS_COLLECTED_AT'), 'no zone');
    const st = freshStore(); a.ok(st.commands.importEllisSnapshot(snap).ok);
    const junk = retag(snap, c => { c.provenance.collectedAt = '2020-01-01T00:00:99Z'; }); a.ok(st.commands.importEllisSnapshot(junk).errors.includes('E_ELLIS_COLLECTED_AT'));
    const same = retag(snap, c => { c.provenance.collectedBy = 'someone else'; }); a.ok(st.commands.importEllisSnapshot(same).errors.includes('E_ELLIS_STALE'), 'same time, different content');
    const sameInstant = retag(snap, c => { c.provenance.collectedAt = '2026-11-05T23:30:00Z'; }); a.ok(st.commands.importEllisSnapshot(sameInstant).errors.includes('E_ELLIS_STALE'), 'same instant written in another zone');
  });

  t('M24', 'a window in which rows were dropped before their month was known is not "covered"', ['ELLIS-2', 'ELLIS-6'], async a => {
    const rows = [...monthRows(777, '2026-08', 30e6, 3, { bookingItemCode: undefined }), ...monthRows(777, '2026-09', 30e6, 3), ...monthRows(777, '2026-10', 30e6, 3)];
    const sy = await mkState(rows); const h = sy.state.ellis.snapshot.hotels[0];
    a.deepEq(h.coveredMonths, ['2026-09', '2026-10']); a.ok(sy.state.ellis.snapshot.provenance.warnings.includes('ROWS_REJECTED')); a.eq(sy.state.ellis.snapshot.provenance.rowStats.rejected.NO_ROW_ID, 3);
    a.eq(cmp(sy).months[0].status, 'NOT_COVERED', 'not reported as an ELLIS zero');
  });

  t('M25', 'covered months must be provable from complete hotel-level pulls inside the window', ['ELLIS-1'], async a => {
    const s = await snapOf(monthRows(777, '2026-10', 1000, 2), [777], '2026-10-01', '2026-10-31'); a.ok(Ellis.validateSnapshot(s).ok);
    for (const [label, months] of [['outside window', ['2026-10', '1999-01']], ['never pulled', ['2026-09', '2026-10']], ['duplicate', ['2026-10', '2026-10']]]) {
      const c = retag(s, x => { x.hotels[0].coveredMonths = months; }); a.ok(Ellis.validateSnapshot(c).errors.some(e => e.startsWith('E_ELLIS_COVERED')), label);
    }
    const country = retag(s, x => { x.provenance.tools[0].hotelCode = null; x.provenance.tools[0].countryCode = 'JP'; }); a.ok(Ellis.validateSnapshot(country).errors.some(e => e.startsWith('E_ELLIS_COVERED')), 'a country-level pull proves nothing about one hotel');
  });

  t('M26', 'the fingerprint does not depend on key order, so a re-ordered copy is recognised as the same snapshot', ['ELLIS-5', 'ELLIS-1'], a => {
    const snap = sampleSnap(); const rev = o => (Array.isArray(o) ? o.map(rev) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).reverse().map(k => [k, rev(o[k])])) : o);
    const copy = rev(snap); a.ok(JSON.stringify(copy) !== JSON.stringify(snap)); a.eq(Ellis.hashOf(copy), snap.hash); a.ok(Ellis.validateSnapshot(copy).ok);
    const st = freshStore(); a.ok(st.commands.importEllisSnapshot(snap).ok); a.ok(st.commands.importEllisSnapshot(copy).errors.some(e => e === 'E_ELLIS_ALREADY_IMPORTED' || e === 'E_ELLIS_STALE')); a.eq(st.state.ellis.batches.length, 1);
  });

  t('M27', 'negative amounts (refunds, adjustments) are skipped and flagged, never netted into a month', ['ELLIS-3'], async a => {
    const rows = [...monthRows(777, '2026-08', 20e6, 2), mk(777, '2026-08', 9, { billing: -30e6, revenue: 0 }), ...monthRows(777, '2026-09', 30e6, 3, { revenue: -5 }), ...monthRows(777, '2026-10', 30e6, 3)];
    const sy = await mkState(rows); const s = sy.state.ellis.snapshot; a.ok(Ellis.validateSnapshot(s).ok, 'the snapshot stays valid');
    const aug = s.hotels[0].months.find(m => m.month === '2026-08'); a.eq(aug.skippedRows, 1); a.eq(aug.byCurrency[0].billingMinor, 20e6); a.eq(s.provenance.rowStats.rejected.AMOUNT_NEGATIVE, 1);
    a.eq(s.hotels[0].months.find(m => m.month === '2026-09').byCurrency[0].revenueMinor, -15, 'a negative revenue (negative margin) is a real value, summed as it is');
    a.eq(cmp(sy).months[0].status, 'ELLIS_INCOMPLETE');
  });

  t('M28', 'cancel detection is anchored; stored ELLIS data must match the state kind and its import history', ['ELLIS-3', 'ELLIS-7'], async a => {
    const rows = [mk(555, '2026-10', 1, { bookingStatus: 'Cancelled' }), mk(555, '2026-10', 2, { bookingStatus: 'Canceled' }), mk(555, '2026-10', 3, { bookingStatus: 'Not Cancelled', billing: 700 }), mk(555, '2026-10', 4, { bookingStatus: 'Reserved', billing: 300 }), mk(555, '2026-10', 5, { bookingStatus: 'Cancellable', billing: 100 })];
    const s = await snapOf(rows, [555], '2026-10-01', '2026-10-31'); const c = s.hotels[0].months[0].byCurrency[0]; a.eq(c.cancelledBookings, 2); a.eq(c.billingMinor, 1100); a.eq(c.bookings, 3);
    const mkSaved = () => { const storage = Store.memoryStorage(); const x = env.as(env.newStore({ storage }), 'SCM'); a.ok(x.commands.importEllisSnapshot(sampleSnap()).ok); return storage; };
    let storage = mkSaved(); let blob = JSON.parse(storage.getItem(Store.DEFAULT_KEY)); blob.isSample = false; storage.setItem(Store.DEFAULT_KEY, JSON.stringify(blob)); a.eq(env.newStore({ storage }).loadStatus, 'CORRUPT_RESET', 'synthetic data inside a non-sample state');
    storage = mkSaved(); blob = JSON.parse(storage.getItem(Store.DEFAULT_KEY)); blob.ellis.batches = []; storage.setItem(Store.DEFAULT_KEY, JSON.stringify(blob)); a.eq(env.newStore({ storage }).loadStatus, 'CORRUPT_RESET', 'no import history');
    storage = mkSaved(); blob = JSON.parse(storage.getItem(Store.DEFAULT_KEY)); blob.ellis.batches[0].hash = 'ffffffffffffff'; storage.setItem(Store.DEFAULT_KEY, JSON.stringify(blob)); a.eq(env.newStore({ storage }).loadStatus, 'CORRUPT_RESET', 'history names another snapshot');
  });

  /* ---- tracker reconciliation follow-ups: NET basis, currency conversion, contract period, shared hotels ---- */
  const vnd = (code, month, net, o) => monthRows(code, month, Math.round(net / 0.9), 3, Object.assign({ currency: 'VND', fxRate: 0.05 }, o || {})).map((r, i, all) => Object.assign(r, { revenue: Math.round(r.billing * 0.1) }));
  const usd = (code, month, o) => [mk(code, month, 50, Object.assign({ currency: 'USD', billing: 2000, revenue: 200, fxRate: 1300 }, o || {}))];
  const months3 = ['2026-08', '2026-09', '2026-10'];
  const cmpAll = (sy, o) => Ellis.compare(sy.state, o).byContract['CT-T'];

  t('M29', 'bookings in other currencies are converted through the booking-time KRW rate and marked as converted', ['ELLIS-6', 'ELLIS-3'], async a => {
    // a VND contract: 90M VND (net) in VND bookings plus 2,000 USD billing (net 1,800 USD = 2.34M KRW = 46.8M VND at 0.05)
    const rows = months3.flatMap(m => [...vnd(777, m, 90e6), ...usd(777, m)]);
    const sy = await mkState(rows, '2026-08-01', '2026-10-31', { ccy: 'VND', cons: [136.8e6, 136.8e6, 136.8e6], opening: 2e9 });
    let c = cmpAll(sy); a.deepEq(c.months.map(m => m.status), ['MATCH', 'MATCH', 'MATCH']); a.eq(c.months[0].ratioPct, 100); a.ok(Math.abs(c.months[0].ellisMinor - 136.8e6) <= 5, "net in VND within rounding of the split rows: " + c.months[0].ellisMinor); a.ok(c.months[0].converted); a.eq(c.months[0].convertedPct, 34.2);
    a.eq(cmpAll(sy, { basis: 'BILLING' }).months[0].ellisMinor, 100e6 + 52e6, 'gross: 100M VND + 2,000 USD x 1300 / 0.05 = 52M');
    // no VND booking at this hotel in the month: the rate comes from the other hotels of the snapshot
    const only = months3.flatMap(m => usd(777, m)); const others = months3.flatMap(m => vnd(888, m, 90e6));
    const sy2 = env.synth({ ccy: 'VND', cons: [46.8e6, 46.8e6, 46.8e6], opening: 2e9 }); sy2.hotel.ellisHotelId = 'ELLIS-777';
    sy2.state.ellis = { snapshot: (await Ellis.collect({ source: createFixtureSource([...only, ...others]), hotelCodes: [777, 888], from: '2026-08-01', to: '2026-10-31', ...META })).snapshot, batches: [] };
    c = cmpAll(sy2); a.deepEq(c.months.map(m => m.status), ['MATCH', 'MATCH', 'MATCH']); a.eq(c.months[0].convertedPct, 100);
    // no VND rate anywhere in the snapshot: no guess
    const sy3 = await mkState(months3.flatMap(m => usd(777, m)), '2026-08-01', '2026-10-31', { ccy: 'VND', cons: [46.8e6, 46.8e6, 46.8e6], opening: 2e9 });
    c = cmpAll(sy3); a.eq(c.status, 'CURRENCY_MISMATCH'); a.ok(c.months.every(m => m.status === 'CURRENCY_MISMATCH'));
    // a KRW contract: USD bookings convert straight through their own KRW amount
    const sy4 = await mkState(months3.flatMap(m => [...monthRows(777, m, 30e6, 3), ...usd(777, m, { billing: 1000, revenue: 0, fxRate: 1400 })]), '2026-08-01', '2026-10-31', { cons: [31.4e6, 31.4e6, 31.4e6] });
    c = cmpAll(sy4); a.eq(c.months[0].ellisMinor, 31.4e6); a.eq(c.months[0].ratioPct, 100); a.ok(c.months[0].converted);
  });

  t('M30', 'months outside the contract period are not compared; a month holding the start or end cannot be split', ['ELLIS-6'], async a => {
    const rows = months3.flatMap(m => monthRows(777, m, 30e6, 3));
    const sy = await mkState(rows); const st = o => { Object.assign(sy.contract, { startDate: '2025-01-01', endDate: '2030-12-31' }, o); return cmpAll(sy).months.map(m => m.status); };
    a.deepEq(st({}), ['MATCH', 'MATCH', 'MATCH']);
    a.deepEq(st({ startDate: '2026-09-15' }), ['BEFORE_CONTRACT', 'CONTRACT_STARTS_IN_MONTH', 'MATCH']);
    a.deepEq(st({ startDate: '2026-09-01' }), ['BEFORE_CONTRACT', 'MATCH', 'MATCH'], 'a start on the 1st leaves that month whole');
    a.deepEq(st({ startDate: '2025-01-01', endDate: '2026-10-20' }), ['MATCH', 'MATCH', 'CONTRACT_ENDS_IN_MONTH']);
    a.deepEq(st({ endDate: '2026-10-31' }), ['MATCH', 'MATCH', 'MATCH'], 'an end on the last day leaves the month whole');
    a.deepEq(st({ endDate: '2026-07-31' }), ['AFTER_CONTRACT', 'AFTER_CONTRACT', 'AFTER_CONTRACT']); a.eq(cmpAll(sy).status, 'OUT_OF_CONTRACT');
    st({ startDate: '2026-09-15', endDate: '2030-12-31' }); const c = cmpAll(sy); a.eq(c.divergent, 0); a.ok(c.months.slice(0, 2).every(m => m.ellisMinor == null && m.ratioPct == null), 'clipped months carry no ELLIS amount');
    delete sy.contract.startDate; delete sy.contract.endDate; a.deepEq(cmpAll(sy).months.map(m => m.status), ['MATCH', 'MATCH', 'MATCH'], 'no dates, no clipping');
  });

  t('M31', 'two contracts at one hotel: same currency is shared (not compared), different currencies never take each other\'s bookings', ['ELLIS-6'], async a => {
    const rows = months3.flatMap(m => [...monthRows(777, m, 30e6, 3), ...usd(777, m, { billing: 100, revenue: 0, fxRate: 1300 })]);
    const sy = await mkState(rows, '2026-08-01', '2026-10-31', { cons: [30e6, 30e6, 30e6] });
    const second = Object.assign(JSON.parse(JSON.stringify(sy.contract)), { contractId: 'CT-T2', currency: 'USD' }); sy.state.contracts.push(second); sy.state.ratings['CT-T2'] = sy.state.ratings['CT-T'];
    let all = Ellis.compare(sy.state).byContract;
    a.eq(all['CT-T'].months[0].ellisMinor, 30e6, 'the KRW contract sees only the KRW bookings'); a.ok(!all['CT-T'].months[0].converted); a.eq(all['CT-T'].status, 'OK');
    a.eq(all['CT-T2'].months[0].ellisMinor, 10000, 'the USD contract sees only the USD bookings (100.00 USD)'); a.ok(!all['CT-T2'].months[0].converted);
    second.currency = 'KRW'; all = Ellis.compare(sy.state).byContract; a.eq(all['CT-T'].status, 'SHARED_HOTEL'); a.eq(all['CT-T2'].status, 'SHARED_HOTEL'); a.deepEq(all['CT-T'].months.map(m => m.status), ['SHARED_HOTEL', 'SHARED_HOTEL', 'SHARED_HOTEL']); a.ok(all['CT-T'].months.every(m => m.ellisMinor == null), 'nothing is compared');
    second.prepaymentType = 'SECURITY_DEPOSIT'; all = Ellis.compare(sy.state).byContract; a.eq(all['CT-T'].status, 'OK', 'a deposit at the same hotel does not share consumption');
  });

  t('M32', 'NET needs the revenue; when it is hidden the default basis reports incomplete and BILLING still works', ['ELLIS-6', 'ELLIS-3'], async a => {
    const rows = months3.flatMap(m => monthRows(777, m, 30e6, 3, { revenue: null }));
    const sy = await mkState(rows); let c = cmpAll(sy); a.deepEq(c.months.map(m => m.status), ['ELLIS_INCOMPLETE', 'ELLIS_INCOMPLETE', 'ELLIS_INCOMPLETE']); a.eq(c.months[0].ellisBillingMinor, 30e6);
    a.eq(c.status, 'ELLIS_INCOMPLETE', 'no month could be judged, so the contract is not reported OK');
    c = cmpAll(sy, { basis: 'BILLING' }); a.deepEq(c.months.map(m => m.status), ['MATCH', 'MATCH', 'MATCH']); a.eq(c.status, 'OK');
  });

  t('M34', 'review regressions in the comparison: shared hotels are decided per month, unjudged contracts are not OK, same-currency mode counts only own bookings, the tolerance is exact', ['ELLIS-6'], async a => {
    // a sibling contract in the same currency that ended in August shares only August
    const rows = months3.flatMap(m => monthRows(777, m, 30e6, 3));
    let sy = await mkState(rows, '2026-08-01', '2026-10-31'); const sib = Object.assign(JSON.parse(JSON.stringify(sy.contract)), { contractId: 'CT-T2', startDate: '2025-01-01', endDate: '2026-08-31' }); sy.state.contracts.push(sib); sy.state.ratings['CT-T2'] = sy.state.ratings['CT-T'];
    let c = cmpAll(sy); a.deepEq(c.months.map(m => m.status), ['SHARED_HOTEL', 'MATCH', 'MATCH'], 'only the month in which both are active is shared'); a.eq(c.status, 'OK');
    a.eq(Ellis.compare(sy.state).byContract['CT-T2'].status, 'SHARED_HOTEL', 'a contract whose every month is shared is reported shared');
    // a sibling in another currency: the covered month with no booking of the contract currency is zero, not a currency mismatch, and the other currency is not counted
    sy = await mkState(months3.flatMap(m => usd(777, m)), '2026-08-01', '2026-10-31'); sy.state.contracts.push(Object.assign(JSON.parse(JSON.stringify(sy.contract)), { contractId: 'CT-T2', currency: 'USD' })); sy.state.ratings['CT-T2'] = sy.state.ratings['CT-T'];
    c = cmpAll(sy); a.deepEq(c.months.map(m => m.status), ['DIVERGENT', 'DIVERGENT', 'DIVERGENT']); a.ok(c.months.every(m => m.ellisMinor === 0 && m.ellisBookings === 0), 'no KRW booking, and the USD booking is not counted');
    // all ledger months missing: not OK
    sy = await mkState(months3.flatMap(m => monthRows(777, m, 30e6, 3)), '2026-08-01', '2026-10-31', { cons: [null, null, null] }); c = cmpAll(sy); a.deepEq(c.months.map(m => m.status), ['LEDGER_MISSING', 'LEDGER_MISSING', 'LEDGER_MISSING']); a.eq(c.status, 'LEDGER_MISSING');
    // 39.012M against 30M is 30.04 % above: outside a 30 % tolerance even though the ratio is shown as 130.0
    sy = await mkState(months3.flatMap(m => monthRows(777, m, 39012000, 3)), '2026-08-01', '2026-10-31'); c = cmpAll(sy); a.deepEq(c.months.map(m => m.status), ['DIVERGENT', 'DIVERGENT', 'DIVERGENT']); a.eq(c.months[0].ratioPct, 130);
    sy = await mkState(months3.flatMap(m => monthRows(777, m, 39000000, 3)), '2026-08-01', '2026-10-31'); a.deepEq(cmpAll(sy).months.map(m => m.status), ['MATCH', 'MATCH', 'MATCH'], 'exactly 30 % is inside');  });

  t('M35', 'a snapshot whose KRW figures disagree with the original-currency figures is refused', ['ELLIS-1', 'ELLIS-3'], async a => {
    const rows = [mk(555, '2026-10', 1, { currency: 'USD', billing: 100, revenue: 10, fxRate: 1300 }), mk(555, '2026-10', 4, { currency: 'KRW', billing: 1000, revenue: 100, fxRate: undefined })];
    const s = await snapOf(rows, [555], '2026-10-01', '2026-10-31'); a.ok(Ellis.validateSnapshot(s).ok);
    const usdE = x => x.hotels[0].months[0].byCurrency.find(e => e.currency === 'USD'), krwE = x => x.hotels[0].months[0].byCurrency.find(e => e.currency === 'KRW');
    for (const [label, f] of [['USD billing with no KRW equivalent', x => { usdE(x).krwBillingMinor = 0; usdE(x).krwRevenueMinor = 0; }], ['absurd rate', x => { usdE(x).krwBillingMinor = 1e12; }], ['KRW equivalent differs from KRW billing', x => { krwE(x).krwBillingMinor += 1; }], ['KRW revenue equivalent differs', x => { krwE(x).krwRevenueMinor += 1; }], ['zero billing with a KRW equivalent', x => { usdE(x).billingMinor = 0; }]]) {
      const v = Ellis.validateSnapshot(retag(s, f)); a.ok(!v.ok && v.errors.some(e => e.startsWith('E_ELLIS_FX')), label + ' ' + v.errors);
    }
  });

  t('M36', 'second review: the KRW equivalent of revenue is checked too, tiny amounts may round to 0 KRW, and the tolerance option is validated', ['ELLIS-1', 'ELLIS-6'], async a => {
    const rows = [mk(555, '2026-10', 1, { currency: 'USD', billing: 100, revenue: 10, fxRate: 1300 }), mk(555, '2026-10', 2, { currency: 'VND', billing: 9, revenue: 0, fxRate: 0.055 })];
    const s = await snapOf(rows, [555], '2026-10-01', '2026-10-31'); const v0 = Ellis.validateSnapshot(s); a.ok(v0.ok, 'a 9 dong booking that rounds to 0 KRW is accepted: ' + v0.errors);
    const usdE = x => x.hotels[0].months[0].byCurrency.find(e => e.currency === 'USD');
    for (const [label, f] of [['revenue with the wrong sign in KRW', x => { usdE(x).krwRevenueMinor = -13000; }], ['revenue in KRW far too large', x => { usdE(x).krwRevenueMinor = 5e9; }], ['revenue 0 in KRW but not in USD', x => { usdE(x).krwRevenueMinor = 0; }]]) {
      const v = Ellis.validateSnapshot(retag(s, f)); a.ok(!v.ok && v.errors.some(e => e.startsWith('E_ELLIS_FX')), label + ' ' + v.errors);
    }
    a.ok(Ellis.validateSnapshot(retag(s, x => { usdE(x).revenueMinor = -1000; usdE(x).krwRevenueMinor = -13000; })).ok, 'a negative revenue with a matching negative KRW figure is real data and stays accepted');
    // tolerance option: only a finite number >= 0; fine resolution
    const sy = await mkState(months3.flatMap(m => monthRows(777, m, 33703680, 3)), '2026-08-01', '2026-10-31');
    for (const bad of [NaN, Infinity, 'abc', -5, null, undefined]) { const c = Ellis.compare(sy.state, { tolerancePct: bad }); a.eq(c.tolerancePct, 30, String(bad) + ' falls back to the default'); }
    a.deepEq(cmpAll(sy, { tolerancePct: 12.3456 }).months.map(m => m.status), ['MATCH', 'MATCH', 'MATCH'], 'exactly at the limit'); a.deepEq(cmpAll(await mkState(months3.flatMap(m => monthRows(777, m, 33703681, 3)), '2026-08-01', '2026-10-31'), { tolerancePct: 12.3456 }).months.map(m => m.status), ['DIVERGENT', 'DIVERGENT', 'DIVERGENT'], 'one unit above');
    a.deepEq(cmpAll(sy, { tolerancePct: 0 }).months.map(m => m.status), ['DIVERGENT', 'DIVERGENT', 'DIVERGENT'], '0 % tolerance is allowed');
  });

  t('M37', 'hotel scope (the tracker definition): no clipping to the contract period, no shared-hotel skipping, every currency converted; contract scope stays the default', ['ELLIS-6'], async a => {
    const rows = months3.flatMap(m => [...monthRows(777, m, 30e6, 3), ...usd(777, m, { billing: 100, revenue: 0, fxRate: 1300 })]);
    const sy = await mkState(months3.flatMap(m => monthRows(777, m, 30e6, 3)), '2026-08-01', '2026-10-31'); sy.contract.startDate = '2026-09-15';
    a.deepEq(cmpAll(sy).months.map(m => m.status), ['BEFORE_CONTRACT', 'CONTRACT_STARTS_IN_MONTH', 'MATCH'], 'default = by contract'); a.eq(cmpAll(sy).scope, 'CONTRACT');
    const h = cmpAll(sy, { scope: 'HOTEL' }); a.deepEq(h.months.map(m => m.status), ['MATCH', 'MATCH', 'MATCH'], 'the tracker counts months before the contract too'); a.eq(h.scope, 'HOTEL'); a.eq(h.status, 'OK');
    a.eq(cmpAll(sy, { scope: 'nonsense' }).scope, 'CONTRACT', 'an unknown value is the default');
    // two same-currency contracts: shared in contract scope, each compared against the hotel total in hotel scope
    const s2 = await mkState(months3.flatMap(m => monthRows(777, m, 30e6, 3)), '2026-08-01', '2026-10-31'); const second = Object.assign(JSON.parse(JSON.stringify(s2.contract)), { contractId: 'CT-T2' }); s2.state.contracts.push(second); s2.state.ratings['CT-T2'] = s2.state.ratings['CT-T'];
    a.eq(Ellis.compare(s2.state).byContract['CT-T'].status, 'SHARED_HOTEL'); const hs = Ellis.compare(s2.state, { scope: 'HOTEL' }).byContract; a.eq(hs['CT-T'].status, 'OK'); a.deepEq(hs['CT-T2'].months.map(m => m.status), ['LEDGER_MISSING', 'LEDGER_MISSING', 'LEDGER_MISSING'], 'the second contract has no ledger of its own, which is a different finding');
    // another currency is converted even when a sibling contract in that currency exists
    const s3 = await mkState(rows, '2026-08-01', '2026-10-31'); s3.state.contracts.push(Object.assign(JSON.parse(JSON.stringify(s3.contract)), { contractId: 'CT-T3', currency: 'USD' })); s3.state.ratings['CT-T3'] = s3.state.ratings['CT-T'];
    a.ok(!Ellis.compare(s3.state).byContract['CT-T'].months[0].converted, 'contract scope keeps the currencies apart'); a.ok(Ellis.compare(s3.state, { scope: 'HOTEL' }).byContract['CT-T'].months[0].converted, 'hotel scope counts every booking of the hotel');
  });

  /* ---- snapshot v3: check-out month basis and the since-contract-start aggregate (Korean SCM file reconciliation) ---- */
  const OUT = { dateBasis: 'CHECK_OUT_DATE' };
  const stay = (code, i, inDay, outDay, o) => mk(code, outDay.slice(0, 7), i, Object.assign({ checkInDate: inDay, checkOutDate: outDay }, o || {}));
  const mkOut = async (rows, meta, o) => {
    const sy = env.synth(Object.assign({ cons: [30e6, 30e6, 30e6] }, o || {})); sy.hotel.ellisHotelId = 'ELLIS-777';
    sy.state.ellis = { snapshot: await snapOf(rows, [777], '2026-08-01', '2026-10-31', Object.assign({}, OUT, meta || {})), batches: [] }; return sy;
  };
  // September of a hotel whose contract starts on 15 Sep: the stays that check out on the 5th, 10th and 14th are before the start, those on the 15th and 25th are from the start
  const sepRows = () => [stay(777, 1, '2026-09-04', '2026-09-05', { billing: 10e6, revenue: 0 }), stay(777, 2, '2026-09-09', '2026-09-10', { billing: 10e6, revenue: 0 }), stay(777, 3, '2026-09-13', '2026-09-14', { billing: 5e6, revenue: 0 }),
    stay(777, 4, '2026-09-14', '2026-09-15', { billing: 12e6, revenue: 0 }), stay(777, 5, '2026-09-24', '2026-09-25', { billing: 18e6, revenue: 0 })];

  t('M38', 'check-out basis: bookings go to the month they check out in, the pull uses CHECK_OUT_DATE, and one snapshot never mixes bases', ['ELLIS-2', 'ELLIS-6'], async a => {
    // a stay 30 Aug -> 2 Sep belongs to September on the check-out basis and to August on the check-in basis
    const rows = [stay(555, 1, '2026-08-30', '2026-09-02', { billing: 3000, revenue: 0 }), stay(555, 2, '2026-09-10', '2026-09-11', { billing: 500, revenue: 0 })];
    const out = await snapOf(rows, [555], '2026-08-01', '2026-09-30', OUT); const inn = await snapOf(rows, [555], '2026-08-01', '2026-09-30');
    const tot = (s, m) => { const x = s.hotels[0].months.find(y => y.month === m); return x ? x.byCurrency.reduce((n, c) => n + c.billingMinor, 0) : 0; };
    a.eq(out.window.basis, 'CHECK_OUT_DATE'); a.ok(out.provenance.tools.every(x => x.dateBasis === 'CHECK_OUT_DATE')); a.eq(tot(out, '2026-08'), 0); a.eq(tot(out, '2026-09'), 3500, 'both stays check out in September');
    a.eq(inn.window.basis, 'CHECK_IN_DATE'); a.eq(tot(inn, '2026-08'), 3000, 'on the check-in basis the long stay is August'); a.eq(tot(inn, '2026-09'), 500);
    a.ok(Ellis.validateSnapshot(out).ok && Ellis.validateSnapshot(inn).ok);
    // the pull itself must have asked ELLIS for the check-out date
    const src = createFixtureSource(rows); await Ellis.collect({ source: src, hotelCodes: [555], from: '2026-09-01', to: '2026-09-30', ...META, ...OUT }); a.ok(src.calls.length && src.calls.every(c => c.dateBasis === 'CHECK_OUT_DATE'));
    // refused: another basis, mixed bases, a tool entry that claims a different basis than the window
    const call = (b, from, to) => ({ tool: 'get_hotel_bookings', args: { dateBasis: b, fromDate: from, toDate: to, hotelCode: 555, limit: 1000, offset: 0 }, response: { list: [], totalCount: 0 } });
    const code = f => { try { f(); return null; } catch (e) { return e.code; } };
    a.eq(code(() => Ellis.buildFromCalls([call('BOOKING_DATE', '2026-09-01', '2026-09-30')], META)), 'E_ELLIS_BASIS');
    a.eq(code(() => Ellis.buildFromCalls([call('CHECK_IN_DATE', '2026-09-01', '2026-09-30'), call('CHECK_OUT_DATE', '2026-10-01', '2026-10-31')], META)), 'E_ELLIS_BASIS_MIXED');
    let threw = null; try { await Ellis.collect({ source: createFixtureSource([]), hotelCodes: [555], from: '2026-09-01', to: '2026-09-30', ...META, dateBasis: 'BOOKING_DATE' }); } catch (e) { threw = e.code; } a.eq(threw, 'E_ELLIS_BASIS');
    const v = Ellis.validateSnapshot(retag(out, x => { x.provenance.tools[0].dateBasis = 'CHECK_IN_DATE'; })); a.ok(!v.ok && v.errors.includes('E_ELLIS_BASIS'), v.errors + '');
    a.ok(!Ellis.validateSnapshot(retag(out, x => { x.window.basis = 'BOOKING_DATE'; })).ok, 'a basis that is neither check-in nor check-out is refused');
    // a row without a check-out date is dropped and counted under its own reason
    const bad = Ellis.buildFromCalls([{ tool: 'get_hotel_bookings', args: { dateBasis: 'CHECK_OUT_DATE', fromDate: '2026-09-01', toDate: '2026-09-30', hotelCode: 555, limit: 1000, offset: 0 }, response: { list: [stay(555, 3, '2026-09-20', '2026-09-21', { checkOutDate: null }), rows[1]], totalCount: 2 } }], META); a.eq(bad.provenance.rowStats.rejected.NO_CHECKOUT, 1); a.eq(tot(bad, '2026-09'), 500, 'the usable row is still counted'); a.ok(Ellis.validateSnapshot(bad).ok);
    // v2 files stay valid, but cannot carry v3 fields
    const v2 = retag(inn, x => { x.version = 2; x.provenance.tools.forEach(y => delete y.dateBasis); }); a.ok(Ellis.validateSnapshot(v2).ok, 'an old check-in snapshot still validates');
    a.ok(!Ellis.validateSnapshot(retag(v2, x => { x.window.basis = 'CHECK_OUT_DATE'; })).ok, 'v2 is check-in only'); a.ok(!Ellis.validateSnapshot(retag(v2, x => { x.provenance.tools[0].dateBasis = 'CHECK_IN_DATE'; })).ok, 'v2 has no dateBasis field');
    // the comparison reports the basis it was run on
    const sy = await mkOut(months3.flatMap(m => monthRows(777, m, 30e6, 3))); const c = Ellis.compare(sy.state); a.eq(c.dateBasis, 'CHECK_OUT_DATE'); a.eq(c.byContract['CT-T'].dateBasis, 'CHECK_OUT_DATE'); a.eq(c.byContract['CT-T'].status, 'OK');
  });

  t('M39', 'a contract that starts mid-month is compared on the since-start aggregate of that month, and only then', ['ELLIS-6', 'ELLIS-3'], async a => {
    const rows = [...monthRows(777, '2026-08', 30e6, 3), ...sepRows(), ...monthRows(777, '2026-10', 30e6, 3)];
    const sy = await mkOut(rows, { partialFrom: { 777: '2026-09-15' } }); sy.contract.startDate = '2026-09-15';
    const sep = sy.state.ellis.snapshot.hotels[0].months.find(m => m.month === '2026-09'); a.eq(sep.partial.from, '2026-09-15'); a.eq(sep.byCurrency[0].billingMinor, 55e6, 'the whole month is still there'); a.eq(sep.partial.byCurrency[0].billingMinor, 30e6, '15 Sep (the cut-off day itself) and 25 Sep, not 14 Sep');
    a.ok(!('partial' in sy.state.ellis.snapshot.hotels[0].months.find(m => m.month === '2026-08')), 'only the month of the cut-off carries the aggregate'); a.ok(Ellis.validateSnapshot(sy.state.ellis.snapshot).ok);
    const c = cmpAll(sy); a.deepEq(c.months.map(m => m.status), ['BEFORE_CONTRACT', 'MATCH', 'MATCH']); a.eq(c.months[1].sinceDate, '2026-09-15'); a.eq(c.months[1].ellisMinor, 30e6); a.eq(c.months[1].ratioPct, 100); a.eq(c.months[2].sinceDate, null); a.eq(c.status, 'OK');
    // hotel scope is the whole month and ignores the aggregate
    const h = cmpAll(sy, { scope: 'HOTEL' }); a.eq(h.months[1].ellisMinor, 55e6); a.eq(h.months[1].sinceDate, null); a.eq(h.months[1].status, 'DIVERGENT', '55M against 30M is outside 30 %');
    // the contract start must be exactly the cut-off date; otherwise the month stays unsplit
    sy.contract.startDate = '2026-09-16'; a.eq(cmpAll(sy).months[1].status, 'CONTRACT_STARTS_IN_MONTH'); sy.contract.startDate = '2026-09-15';
    // no aggregate was collected: unchanged behaviour
    const plain = await mkOut(rows); plain.contract.startDate = '2026-09-15'; a.eq(cmpAll(plain).months[1].status, 'CONTRACT_STARTS_IN_MONTH');
    // a contract that also ends inside that month cannot be split twice
    sy.contract.endDate = '2026-09-20'; a.eq(cmpAll(sy).months[1].status, 'CONTRACT_STARTS_IN_MONTH'); delete sy.contract.endDate;
    // an unusable row before the cut-off does not make the since-start amount incomplete; one after it does
    const early = await mkOut([...rows, stay(777, 9, '2026-09-01', '2026-09-02', { currency: 'USD', billing: 100, revenue: 0, fxRate: null })], { partialFrom: { 777: '2026-09-15' } }); early.contract.startDate = '2026-09-15';
    a.eq(cmpAll(early).months[1].status, 'MATCH', 'the skipped booking checked out before the start'); a.eq(cmpAll(early, { scope: 'HOTEL' }).months[1].status, 'ELLIS_INCOMPLETE', 'but it makes the whole month incomplete');
    const late = await mkOut([...rows, stay(777, 9, '2026-09-20', '2026-09-21', { currency: 'USD', billing: 100, revenue: 0, fxRate: null })], { partialFrom: { 777: '2026-09-15' } }); late.contract.startDate = '2026-09-15'; a.eq(cmpAll(late).months[1].status, 'ELLIS_INCOMPLETE');
    // a month with bookings but none from the cut-off on is a real zero
    const none = await mkOut([...monthRows(777, '2026-08', 30e6, 3), stay(777, 1, '2026-09-04', '2026-09-05', { billing: 10e6, revenue: 0 }), ...monthRows(777, '2026-10', 30e6, 3)], { partialFrom: { 777: '2026-09-15' } }); none.contract.startDate = '2026-09-15';
    a.eq(none.state.ellis.snapshot.hotels[0].months[1].partial.byCurrency.length, 0); a.eq(cmpAll(none).months[1].ellisMinor, 0); a.eq(cmpAll(none).months[1].status, 'DIVERGENT', '0 in ELLIS against 30M in the ledger');
    // another currency inside the since-start aggregate is converted like in a whole month
    const cur = await mkOut([...rows, stay(777, 9, '2026-09-20', '2026-09-21', { currency: 'USD', billing: 1000, revenue: 0, fxRate: 1300 })], { partialFrom: { 777: '2026-09-15' } }); cur.contract.startDate = '2026-09-15'; a.eq(cmpAll(cur).months[1].ellisMinor, 30e6 + 1.3e6); a.ok(cmpAll(cur).months[1].converted);
    // a cut-off on the 1st adds nothing; bad input is refused
    const first = await mkOut(rows, { partialFrom: { 777: '2026-09-01' } }); a.ok(first.state.ellis.snapshot.hotels[0].months.every(m => !('partial' in m)), 'a cut-off on the 1st is just the whole month');
    for (const bad of [{ 777: 'x' }, { abc: '2026-09-15' }, { 777: '2026-13-40' }]) { let e = null; try { Ellis.buildFromCalls([{ tool: 'get_hotel_bookings', args: { dateBasis: 'CHECK_OUT_DATE', fromDate: '2026-09-01', toDate: '2026-09-30', hotelCode: 777, limit: 1000, offset: 0 }, response: { list: [], totalCount: 0 } }], Object.assign({}, META, { partialFrom: bad })); } catch (x) { e = x.code; } a.eq(e, 'E_ELLIS_PARTIAL', JSON.stringify(bad)); }
  });

  t('M40', 'a forged or inconsistent since-start aggregate is refused', ['ELLIS-1', 'ELLIS-3'], async a => {
    const s = (await mkOut([...monthRows(777, '2026-08', 30e6, 3), ...sepRows()], { partialFrom: { 777: '2026-09-15' } })).state.ellis.snapshot; a.ok(Ellis.validateSnapshot(s).ok);
    const sep = x => x.hotels[0].months.find(m => m.month === '2026-09');
    const cases = [['larger than the month', x => { sep(x).partial.byCurrency[0].billingMinor = 56e6; sep(x).partial.byCurrency[0].krwBillingMinor = 56e6; }], ['more bookings than the month', x => { sep(x).partial.byCurrency[0].bookings = 99; }],
      ['a currency the month does not have', x => { sep(x).partial.byCurrency[0].currency = 'USD'; }], ['cut-off in another month', x => { sep(x).partial.from = '2026-10-15'; }], ['cut-off on the 1st', x => { sep(x).partial.from = '2026-09-01'; }], ['not a date', x => { sep(x).partial.from = 'soon'; }],
      ['more skipped rows than the month', x => { sep(x).partial.skippedRows = 5; }], ['unknown field inside', x => { sep(x).partial.guestName = 'x'; }], ['not an object', x => { sep(x).partial = 5; }], ['inconsistent KRW figure', x => { sep(x).partial.byCurrency[0].krwBillingMinor = 1; }]];
    for (const [label, f] of cases) { const v = Ellis.validateSnapshot(retag(s, f)); a.ok(!v.ok, label + ' must be refused'); }
    const v = Ellis.validateSnapshot(retag(s, x => { x.version = 2; x.provenance.tools.forEach(y => delete y.dateBasis); x.window.basis = 'CHECK_IN_DATE'; })); a.ok(!v.ok, 'v2 cannot carry the aggregate: ' + v.errors);
  });

  t('M33', 'the snapshot keeps KRW equivalents; a non-KRW booking without a rate is skipped and flagged; the new fields are validated', ['ELLIS-1', 'ELLIS-3'], async a => {
    const rows = [mk(555, '2026-10', 1, { currency: 'USD', billing: 100, revenue: 10, fxRate: 1300 }), mk(555, '2026-10', 2, { currency: 'USD', billing: 50, revenue: 5, fxRate: 1300 }), mk(555, '2026-10', 3, { currency: 'USD', billing: 70, revenue: 7, fxRate: null }),
      mk(555, '2026-10', 4, { currency: 'KRW', billing: 1000, revenue: 100, fxRate: undefined })];
    const s = await snapOf(rows, [555], '2026-10-01', '2026-10-31'); const m = s.hotels[0].months[0]; const u = m.byCurrency.find(x => x.currency === 'USD'), k = m.byCurrency.find(x => x.currency === 'KRW');
    a.eq(u.billingMinor, 15000); a.eq(u.krwBillingMinor, 195000, '150.00 USD x 1300'); a.eq(u.krwRevenueMinor, 19500); a.eq(m.skippedRows, 1); a.eq(s.provenance.rowStats.rejected.FX_MISSING, 1); a.eq(k.krwBillingMinor, 1000, 'KRW needs no rate'); a.eq(s.version, 3);
    a.ok(Ellis.validateSnapshot(s).ok);
    for (const [label, f] of [['negative krw billing', x => { x.hotels[0].months[0].byCurrency[0].krwBillingMinor = -1; }], ['fractional krw', x => { x.hotels[0].months[0].byCurrency[0].krwBillingMinor = 1.5; }], ['revenue null but krw revenue set', x => { x.hotels[0].months[0].byCurrency[0].revenueMinor = null; }], ['missing krw field', x => { delete x.hotels[0].months[0].byCurrency[0].krwBillingMinor; }]]) {
      const v = Ellis.validateSnapshot(retag(s, f)); a.ok(!v.ok && v.errors.some(e => e.startsWith('E_ELLIS_AMOUNT')), label + ' ' + v.errors);
    }
  });

};

