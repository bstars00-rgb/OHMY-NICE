'use strict';
// Hotel credit card sections 7 and 8 (how fast must the next top-up be made, should the cooperation go on), the next check date, and the ELLIS booking outlook.
const env = require('./helpers/env');
const { Model, Outlook, Ellis, Seed } = env;
const { createFixtureSource, row } = require('./helpers/ellis_fixture');

module.exports = function (h) {
  const { test: t } = h;
  const META = { collector: 'FIXTURE', collectedBy: 'test', collectedAt: '2026-11-06T08:30:00+09:00', synthetic: true };
  const mk = (month, i, billing, o) => row(Object.assign({ bookingItemCode: 'O-' + month + '-' + i, hotelCode: 777, checkInDate: month + '-' + String(1 + (i % 27)).padStart(2, '0'), checkOutDate: month + '-28', billing, revenue: 0 }, o || {}));
  const withEllis = async (sy, rows, from, to) => { sy.hotel.ellisHotelId = 'ELLIS-777'; sy.state.ellis = { snapshot: (await Ellis.collect({ source: createFixtureSource(rows), hotelCodes: [777], from, to, ...META })).snapshot, batches: [] }; return sy; };

  t('OU01', 'next check date: the 1st of next month; a D / NR grade or a live critical / high alert is looked at again within 7 days', ['OUT-1'], a => {
    const nc = Model.nextCheck;
    a.deepEq(nc('A', [], '2026-11-06'), { date: '2026-12-01', kind: 'MONTHLY' }); a.deepEq(nc('B', [{ severity: 'MEDIUM' }], '2026-11-06'), { date: '2026-12-01', kind: 'MONTHLY' }, 'a medium alert alone does not shorten it');
    a.deepEq(nc('D', [], '2026-11-06'), { date: '2026-11-13', kind: 'WATCH' }); a.deepEq(nc('NR', [], '2026-11-06'), { date: '2026-11-13', kind: 'WATCH' }); a.deepEq(nc('B', [{ severity: 'HIGH' }], '2026-11-06'), { date: '2026-11-13', kind: 'WATCH' }); a.deepEq(nc('C', [{ severity: 'CRITICAL' }], '2026-11-06'), { date: '2026-11-13', kind: 'WATCH' });
    a.deepEq(nc('D', [], '2026-11-24'), { date: '2026-12-01', kind: 'MONTHLY' }, 'when both dates fall on the same day it is just the regular check'); a.deepEq(nc('D', [], '2026-11-23'), { date: '2026-11-30', kind: 'WATCH' }); a.deepEq(nc('D', [], '2026-11-28'), { date: '2026-12-01', kind: 'MONTHLY' }, 'the regular check comes first when it is earlier than 7 days'); a.deepEq(nc('B', [], '2026-12-31'), { date: '2027-01-01', kind: 'MONTHLY' }, 'year change');
    const v = env.synth({}).view(); a.eq(v.nextCheck.kind, 'MONTHLY'); a.eq(v.nextCheck.date, '2026-12-01');
  });

  t('OU02', 'top-up timing: depletion date minus the lead time, urgency, hold, and the cases without a date', ['OUT-2'], a => {
    const plan = o => { const sy = env.synth(o); const v = sy.view(); return v.topupPlan; };
    let p = plan({ opening: 190e6 });                                  // balance 100M, 30M a month -> 100 days
    a.eq(p.status, 'PLAN'); a.eq(p.speedSource, 'LEDGER'); a.eq(p.monthlyMinor, 30e6); a.eq(p.depletionDate, '2027-02-14'); a.eq(p.topUpByDate, '2027-02-07', '7 days of lead time'); a.eq(p.daysUntilTopUp, 93); a.eq(p.urgency, 'LATER'); a.eq(p.leadDays, 7);
    p = plan({ opening: 100e6 });                                      // balance 10M -> 10 days -> top up by 3 days from now
    a.eq(p.depletionDate, '2026-11-16'); a.eq(p.topUpByDate, '2026-11-09'); a.eq(p.daysUntilTopUp, 3); a.eq(p.urgency, 'SOON');
    p = plan({ opening: 97e6 }); a.eq(p.daysUntilTopUp, 0); a.eq(p.urgency, 'NOW', 'today is already too late to wait');
    p = plan({ opening: 111e6 }); a.eq(p.daysUntilTopUp, 14); a.eq(p.urgency, 'SOON', 'exactly two weeks ahead'); p = plan({ opening: 112e6 }); a.eq(p.daysUntilTopUp, 15); a.eq(p.urgency, 'LATER');
    p = plan({ opening: 190e6, endDate: '2027-02-14' }); a.eq(p.status, 'PLAN', 'depleting exactly on the contract end day is still inside the contract');
    p = plan({ opening: 92e6 }); a.eq(p.daysUntilTopUp, -5, 'balance 2M is 2 days of cover, the request date has passed'); a.eq(p.urgency, 'NOW');
    p = plan({ opening: 90e6 }); a.eq(p.status, 'DEPLETED'); a.eq(p.urgency, 'NOW'); a.eq(p.topUpByDate, '2026-11-06');
    p = plan({ opening: 190e6, facts: { counterpartyVerification: 'FAILED' } }); a.eq(p.status, 'HOLD', 'a D grade holds further top-ups, but the date is still shown'); a.ok(p.holdReasons.includes('GRADE_D_NO_PREPAY')); a.eq(p.depletionDate, '2027-02-14');
    p = plan({ opening: 190e6, endDate: '2026-12-31' }); a.eq(p.status, 'NOT_NEEDED'); a.deepEq(p.reasons, ['BEYOND_CONTRACT_END']);
    p = plan({ opening: 190e6, cons: [0, 0, 0] }); a.eq(p.status, 'NO_CONSUMPTION'); a.eq(p.topUpByDate, null);
    p = plan({ opening: 190e6, cons: [null, null, null] }); a.eq(p.status, 'NO_DATA', 'no ledger and no ELLIS: nothing to calculate from');
    p = plan({ opening: 190e6, type: 'SECURITY_DEPOSIT' }); a.eq(p.status, 'NOT_APPLICABLE');
    p = plan({ opening: 190e6, cons: [20e6, 30e6, 40e6] }); a.eq(p.monthlyMinor, 30e6, 'average of the confirmed months');
  });

  t('OU03', 'the speed comes from ELLIS when the ledger has none, and both speeds are shown with their gap', ['OUT-2', 'ELLIS-6'], async a => {
    const months = ['2026-08', '2026-09', '2026-10'];
    // ledger confirmed 30M a month; ELLIS bookings say 36M a month (net)
    let sy = await withEllis(env.synth({ opening: 190e6 }), months.flatMap(m => [mk(m, 0, 18e6), mk(m, 1, 18e6)]), '2026-08-01', '2026-10-31'); let p = sy.view().topupPlan;
    a.eq(p.speedSource, 'LEDGER'); a.eq(p.monthlyMinor, 30e6, 'the confirmed ledger speed is the one used, not the higher ELLIS one'); a.eq(p.ledgerMonthlyMinor, 30e6); a.eq(p.ellisMonthlyMinor, 36e6); a.eq(p.speedGapPct, 20, 'ELLIS is 20 % above the ledger'); a.eq(sy.view().ellisOutlook.complete, true);
    // no confirmed consumption in the ledger: ELLIS gives the speed and the card says so
    sy = await withEllis(env.synth({ opening: 190e6, cons: [null, null, null] }), months.flatMap(m => [mk(m, 0, 18e6), mk(m, 1, 18e6)]), '2026-08-01', '2026-10-31'); p = sy.view().topupPlan;
    a.eq(p.speedSource, 'ELLIS'); a.eq(p.monthlyMinor, 36e6); a.eq(p.status, 'HOLD', 'without a confirmed ledger speed the limit logic holds top-ups, but a date can still be given from the bookings'); a.ok(p.holdReasons.includes('NO_CONSUMPTION_DATA')); a.ok(p.depletionDate);
  });

  t('OU04', 'ELLIS outlook: last completed months as compared, plus the stays already on the books for this and later months', ['ELLIS-6', 'OUT-2'], async a => {
    const rows = [...['2026-08', '2026-09', '2026-10'].map(m => mk(m, 0, 30e6)), mk('2026-11', 0, 12e6), mk('2026-11', 1, 6e6), mk('2026-12', 0, 5e6)];
    const sy = await withEllis(env.synth({ opening: 190e6 }), rows, '2026-08-01', '2026-12-31'); const o = sy.view().ellisOutlook;
    a.eq(o.available, true); a.eq(o.dateBasis, 'CHECK_IN_DATE'); a.eq(o.avgMinor, 30e6); a.eq(o.avgMonths, 3); a.eq(o.past.length, 3); a.deepEq(o.past.map(x => x.status), ['MATCH', 'MATCH', 'MATCH']);
    a.deepEq(o.upcoming.map(x => [x.month, x.netMinor, x.bookings, x.current, x.status]), [['2026-11', 18e6, 2, true, 'OK'], ['2026-12', 5e6, 1, false, 'OK']], 'this month and the next, net of revenue');
    // a month whose revenue is hidden cannot be used on the net basis: the average then covers fewer months and says so
    const hid = await withEllis(env.synth({ opening: 190e6 }), [mk('2026-08', 0, 30e6), mk('2026-09', 0, 30e6, { revenue: null }), mk('2026-10', 0, 30e6)], '2026-08-01', '2026-10-31'); const oh = hid.view().ellisOutlook; a.eq(oh.avgMonths, 2); a.eq(oh.complete, false); a.eq(oh.avgMinor, 30e6);
    // a month the snapshot did not collect completely is not guessed
    const part = await withEllis(env.synth({ opening: 190e6 }), rows, '2026-08-01', '2026-11-15'); a.deepEq(part.view().ellisOutlook.upcoming.map(x => x.status), ['NOT_COVERED']);
    // no snapshot: nothing is invented
    const none = env.synth({ opening: 190e6 }).view().ellisOutlook; a.eq(none.available, false); a.eq(none.avgMinor, null); a.deepEq(none.upcoming, []);
    // the contract ends before the month: not counted
    sy.contract.endDate = '2026-11-30'; a.deepEq(sy.view().ellisOutlook.upcoming.map(x => x.status), ['OK', 'AFTER_CONTRACT']);
  });

  t('OU05', 'cooperation recommendation: continue, continue with conditions, undecided, wind down, with the reasons that fired', ['OUT-3'], a => {
    const rel = o => env.synth(o).view().relationship; const codes = r => r.reasons.map(x => x.code + (x.reason ? ':' + x.reason : ''));
    let r = rel({ opening: 150e6 }); a.eq(r.verdict, 'CONTINUE'); a.deepEq(r.reasons, []);
    r = rel({ opening: 150e6, hotelFacts: { ownershipChange: 'PENDING' } }); a.eq(r.verdict, 'CONDITIONS'); a.ok(codes(r).includes('GRADE_C'), codes(r) + '');
    r = rel({ opening: 150e6, facts: { counterpartyVerification: 'FAILED' } }); a.eq(r.verdict, 'WIND_DOWN'); a.ok(codes(r).includes('GRADE_D'));
    r = rel({ opening: 150e6, facts: { counterpartyVerification: 'UNKNOWN', counterpartyEvidence: null }, hotelFacts: { ownershipChange: 'UNKNOWN' }, strictCoverage: true }); a.eq(r.verdict, 'REVIEW'); a.ok(codes(r).includes('NOT_RATED'));
    r = rel({ opening: 150e6, hotelFacts: { closure: { claimed: true, source: 'SCM', note: '', verified: { by: 'Kim', at: '2026-11-01', evidenceRef: 'DOC-1' } } } }); a.eq(r.verdict, 'WIND_DOWN'); a.ok(r.reasons.some(x => x.code === 'CRITICAL_FACT' && x.flag === 'CLOSURE_CONFIRMED'));
    r = rel({ opening: 150e6, refund: { requested: true, requestedAmountMinor: 50e6, requestedAt: '2026-09-01', dueDate: '2026-10-15' } }); a.eq(r.verdict, 'WIND_DOWN'); a.ok(codes(r).includes('REFUND_OVERDUE'));
    r = rel({ opening: 150e6, refund: { requested: true, requestedAmountMinor: 50e6, requestedAt: '2026-10-20', dueDate: '2026-12-15' } }); a.eq(r.verdict, 'WIND_DOWN'); a.ok(codes(r).includes('REFUND_IN_PROGRESS'), 'a refund that is on its way is also a wind-down, but not an overdue one');
    r = rel({ opening: 150e6, cons: [30e6, 30e6, 6e6] }); a.eq(r.verdict, 'CONDITIONS'); a.ok(codes(r).includes('HOLD:CONSUMPTION_COLLAPSE'), 'consumption fell by more than 50 %: ' + codes(r));
    r = rel({ opening: 150e6, endDate: '2026-10-31' }); a.eq(r.verdict, 'WIND_DOWN'); a.ok(codes(r).includes('EXPIRED_WITH_BALANCE'), 'ended contract with a balance: ' + codes(r));
    r = rel({ opening: 400e6 }); a.eq(r.verdict, 'CONDITIONS'); a.ok(codes(r).includes('OVER_LIMIT'), 'balance above the recommended limit');
    a.ok(Outlook.LEAD_DAYS === 7 && Outlook.SOON_DAYS === 14);
  });

  t('OU06', 'every sample contract gets a plan and an opinion; nothing is written to the ledger', ['OUT-1', 'OUT-2', 'OUT-3', 'D-1'], a => {
    const s = Seed.buildSeed(); require('../js/data/ellis_sample.js'); const snap = globalThis.OMH.EllisSample; s.ellis = { snapshot: Ellis.restrictToMaster(snap, s.hotels).snapshot, batches: [] };
    const n0 = s.ledger.length, before = JSON.stringify(s.ledger); const m = Model.compute(s);
    for (const v of m.views) { a.ok(['PLAN', 'HOLD', 'NOT_NEEDED', 'NO_CONSUMPTION', 'NO_DATA', 'DEPLETED', 'NOT_APPLICABLE'].includes(v.topupPlan.status), v.contractId + ' ' + v.topupPlan.status); a.ok(['CONTINUE', 'CONDITIONS', 'REVIEW', 'WIND_DOWN'].includes(v.relationship.verdict), v.contractId); a.ok(/^\d{4}-\d{2}-\d{2}$/.test(v.nextCheck.date)); a.ok(!/NaN|undefined/.test(JSON.stringify(v.topupPlan) + JSON.stringify(v.relationship) + JSON.stringify(v.ellisOutlook))); }
    a.eq(s.ledger.length, n0); a.eq(JSON.stringify(s.ledger), before, 'the ledger is untouched');
    const kr1 = m.byContract['CT-KR-001']; a.eq(kr1.ellisOutlook.upcoming.length, 2, 'the sample carries November and December bookings'); a.ok(kr1.ellisOutlook.avgMinor > 0);
    a.eq(m.byContract['CT-JP-004'].relationship.verdict, 'WIND_DOWN', 'the hotel with a verified closure');
  });
};
