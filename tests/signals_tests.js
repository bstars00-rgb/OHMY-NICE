'use strict';
// The CEO's weekly signals S1-S8 (2026-11-13): every threshold from both sides, the hotel colour, the cases without signals, and what a colour does to the top-up request.
const env = require('./helpers/env');
const { Signals, Config } = env;

module.exports = function register(h) {
  const { test: t } = h; const cfg = Config.defaults();
  // a healthy contract: 60M left, 30M a month for ten months, plan 30M a month, hotel letter 11 days old, limit 100M, no risk codes
  const by = () => { const o = {}; for (const k of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) o[k] = 30e6; return o; };
  const base = o => Object.assign({ off: false, hasData: true, closed: false, balanceMinor: 60e6, depositTotalMinor: 400e6, avgMinor: 30e6, consByMonth: by(), firstMonth: '2026-01', startDate: '2026-01-01', planFrom: '2026-01-01', endDate: '2027-06-30', planMonthlyMinor: 30e6,
    recon: { status: 'MATCH', confirmedAt: '2026-11-05', diffMinor: 0 }, limitMinor: 100e6, riskFlags: [], grade: 'B', prevGrade: 'B', asOf: '2026-11-16', cfg }, o || {});
  const c = (o, k) => Signals.compute(base(o)).sig[k].c;

  t('SG01', 'Signals S1-S8: each line of the CEO sits exactly where the standard puts it (boundary values stay in the lower colour)', ['SIG-1'], a => {
    a.eq(Signals.compute(base()).color, 'ok'); a.deepEq(Object.keys(Signals.compute(base()).sig), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']); a.eq(Signals.compute(base()).naCount, 0);
    // S1 months of cover: more than 2 yellow, more than 4 red
    a.eq(c({ balanceMinor: 60e6 }, 'S1'), 'ok'); a.eq(c({ balanceMinor: 60.3e6 }, 'S1'), 'warn'); a.eq(c({ balanceMinor: 120e6 }, 'S1'), 'warn'); a.eq(c({ balanceMinor: 121e6 }, 'S1'), 'bad'); a.eq(c({ balanceMinor: 0 }, 'S1'), 'ok'); a.eq(c({ avgMinor: null }, 'S1'), 'na'); a.eq(c({ avgMinor: 0 }, 'S1'), 'bad', 'money left and nothing used');
    // S2 last month against the three before: under 0.7 yellow, under 0.5 red
    const lastMonth = v => { const o = by(); o['2026-10'] = v; return { consByMonth: o }; };
    a.eq(c(lastMonth(21e6), 'S2'), 'ok'); a.eq(c(lastMonth(20.9e6), 'S2'), 'warn'); a.eq(c(lastMonth(15e6), 'S2'), 'warn'); a.eq(c(lastMonth(14.9e6), 'S2'), 'bad'); a.eq(c({ consByMonth: { '2026-10': 30e6 }, firstMonth: '2026-10' }, 'S2'), 'na', 'no earlier months to compare with');
    // S3 usage so far against the plan: under 0.8 yellow, under 0.5 red
    const scaled = f => { const o = by(); for (const k of Object.keys(o)) o[k] = Math.round(o[k] * f); return { consByMonth: o }; };
    a.eq(c(scaled(0.85), 'S3'), 'ok'); a.eq(c(scaled(0.75), 'S3'), 'warn'); a.eq(c(scaled(0.45), 'S3'), 'bad'); a.eq(c({ planMonthlyMinor: null }, 'S3'), 'na', 'no plan, no judgement');
    // S4 days since the last usage: over 14 yellow, over 30 red; a month with usage counts as fresh until it is over
    a.eq(c({}, 'S4'), 'ok'); const gap = o => Signals.compute(base(o)).sig.S4; a.eq(gap({ consByMonth: {}, startDate: '2026-11-10' }).c, 'ok'); a.eq(gap({ consByMonth: {}, startDate: '2026-11-10' }).v, 6); a.eq(gap({ consByMonth: {}, startDate: '2026-11-02' }).c, 'ok', '14 days'); a.eq(gap({ consByMonth: {}, startDate: '2026-11-01' }).c, 'warn', '15 days'); a.eq(gap({ consByMonth: {}, startDate: '2026-10-17' }).c, 'warn', '30 days'); a.eq(gap({ consByMonth: {}, startDate: '2026-10-16' }).c, 'bad', '31 days'); a.eq(gap({ consByMonth: { '2026-09': 30e6 } }).v, 47, 'Sep was the last month with usage');
    // S5 what is left at the end of the contract as a share of everything deposited: above 0 yellow, 0.3 and over red
    a.eq(c({}, 'S5'), 'ok'); a.eq(c({ balanceMinor: 300e6, depositTotalMinor: 400e6 }, 'S5'), 'warn'); a.eq(c({ balanceMinor: 500e6, depositTotalMinor: 600e6 }, 'S5'), 'bad'); a.eq(c({ endDate: '2026-11-16', balanceMinor: 120e6, depositTotalMinor: 400e6 }, 'S5'), 'bad', 'exactly 0.3 is red'); a.eq(c({ endDate: '2026-11-16', balanceMinor: 119e6, depositTotalMinor: 400e6 }, 'S5'), 'warn'); a.eq(c({ endDate: null }, 'S5'), 'na'); a.eq(c({ avgMinor: null }, 'S5'), 'na');
    // S6 the hotel's balance letter: matching and 31 days old at most is green, 32-62 yellow, older red; a difference older than 30 days is red
    a.eq(c({}, 'S6'), 'ok'); a.eq(c({ recon: { status: 'MATCH', confirmedAt: '2026-10-16', diffMinor: 0 } }, 'S6'), 'ok', '31 days old is still fresh');
    a.eq(c({ recon: { status: 'MATCH', confirmedAt: '2026-10-15', diffMinor: 0 } }, 'S6'), 'warn'); a.eq(c({ recon: { status: 'MATCH', confirmedAt: '2026-09-15', diffMinor: 0 } }, 'S6'), 'warn'); a.eq(c({ recon: { status: 'MATCH', confirmedAt: '2026-09-14', diffMinor: 0 } }, 'S6'), 'bad');
    a.eq(c({ recon: { status: 'MINOR', confirmedAt: '2026-11-01', diffMinor: -1e6 } }, 'S6'), 'warn'); a.eq(c({ recon: { status: 'MAJOR', confirmedAt: '2026-10-17', diffMinor: -9e6 } }, 'S6'), 'warn'); a.eq(c({ recon: { status: 'MAJOR', confirmedAt: '2026-10-16', diffMinor: -9e6 } }, 'S6'), 'bad'); a.eq(c({ recon: { status: 'UNCONFIRMED', confirmedAt: null, diffMinor: null } }, 'S6'), 'na'); a.eq(c({ recon: null }, 'S6'), 'na');
    // S7 balance against the limit: over 1 yellow, over 1.5 red
    a.eq(c({ balanceMinor: 100e6 }, 'S7'), 'ok'); a.eq(c({ balanceMinor: 100.5e6 }, 'S7'), 'warn'); a.eq(c({ balanceMinor: 150e6 }, 'S7'), 'warn'); a.eq(c({ balanceMinor: 151e6 }, 'S7'), 'bad'); a.eq(c({ limitMinor: 0 }, 'S7'), 'na'); a.eq(c({ limitMinor: null }, 'S7'), 'na');
    // S8 risk codes: one or two general codes yellow, a severe code or three general codes red; an unknown code counts for nothing
    a.eq(c({ riskFlags: [] }, 'S8'), 'ok'); a.eq(c({ riskFlags: ['G1'] }, 'S8'), 'warn'); a.eq(c({ riskFlags: ['G1', 'G2'] }, 'S8'), 'warn'); a.eq(c({ riskFlags: ['G1', 'G2', 'G3'] }, 'S8'), 'bad'); a.eq(c({ riskFlags: ['C3'] }, 'S8'), 'bad'); a.eq(c({ riskFlags: ['C5', 'G8'] }, 'S8'), 'bad'); a.eq(c({ riskFlags: ['Z9'] }, 'S8'), 'ok');
  });

  t('SG02', 'Hotel colour: the worst signal wins, waiting-for-data never turns green, deposits/buyouts/monthly blocks have no signals, a closed hotel or a drop of two grades is red, a negative balance at least yellow', ['SIG-2'], a => {
    const col = o => Signals.compute(base(o)).color; a.eq(col(), 'ok'); a.eq(col({ riskFlags: ['G1'] }), 'warn'); a.eq(col({ riskFlags: ['G1'], balanceMinor: 160e6 }), 'bad', 'one red among yellows');
    const none = Signals.compute(base({ hasData: false })); a.eq(none.color, 'na'); a.eq(none.naCount, 8); a.ok(Object.values(none.sig).every(s => s.c === 'na'), 'no data is not a good result');
    const part = Signals.compute(base({ recon: null, planMonthlyMinor: null, endDate: null })); a.eq(part.color, 'ok', 'signals that can be judged are all green'); a.eq(part.naCount, 3, 'but three are still waiting'); a.ok(Signals.worst(['na', 'na']) === 'na' && Signals.worst(['na', 'ok']) === 'ok');
    const off = Signals.compute(base({ off: true })); a.eq(off.color, 'off'); a.eq(off.off, true); a.deepEq(off.sig, {});
    const cl = Signals.compute(base({ closed: true })); a.eq(cl.color, 'bad'); a.ok(cl.reasons.includes('CLOSED'));
    const drop2 = Signals.compute(base({ grade: 'D', prevGrade: 'B' })); a.eq(drop2.color, 'bad'); a.ok(drop2.reasons.includes('GRADE_DROP_2')); a.eq(col({ grade: 'C', prevGrade: 'B' }), 'ok', 'one grade down alone is not a signal'); a.eq(col({ grade: 'A', prevGrade: 'D' }), 'ok', 'an upgrade is not a signal'); a.eq(col({ grade: 'NR', prevGrade: 'A' }), 'ok', 'an unrated hotel has no drop');
    const neg = Signals.compute(base({ balanceMinor: -1e6 })); a.eq(neg.color, 'warn'); a.ok(neg.reasons.includes('NEGATIVE_BALANCE')); a.eq(Signals.compute(base({ balanceMinor: -1e6, riskFlags: ['C1'] })).color, 'bad', 'red stays red'); const zero = Signals.compute(base({ balanceMinor: 0 })); a.eq(zero.color, 'ok', 'a balance of exactly zero is not negative'); a.ok(!zero.reasons.includes('NEGATIVE_BALANCE'));
    a.ok(Object.keys(Signals.FLAGS).length === 13 && Object.keys(Signals.FLAGS).filter(k => Signals.FLAGS[k].sev === 'C').length === 5 && Object.keys(Signals.FLAGS).filter(k => Signals.FLAGS[k].sev === 'G').length === 8, 'five severe and eight general codes'); for (const [k, f] of Object.entries(Signals.FLAGS)) a.ok(f.name.ko && f.name.en, k);
    for (const k of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']) a.ok(Signals.NAMES[k].ko && Signals.NAMES[k].en, k);
  });

  t('SG03', 'Signals in the model: red blocks the top-up request and zeroes the available top-up, yellow holds it, deposits and buyouts show no signal, and the portfolio counts add up', ['SIG-3', 'SIG-4'], a => {
    const st = env.as(env.newStore(), 'SCM'); const m = st.model(); const v = id => m.byContract[id];
    const jp4 = v('CT-JP-004'); a.eq(jp4.signals.color, 'bad'); a.ok(jp4.limit.holdReasons.includes('RED_SIGNAL')); a.ok(jp4.limit.topupHold); a.eq(jp4.limit.availableTopupMinor, 0); a.eq(jp4.signals.sig.S8.c, 'bad');
    const jp3 = v('CT-JP-003'); a.eq(jp3.signals.color, 'warn'); a.ok(jp3.limit.holdReasons.includes('YELLOW_SIGNAL') && !jp3.limit.holdReasons.includes('RED_SIGNAL'));
    for (const id of ['CT-VN-001', 'CT-KR-004', 'CT-TW-001']) { a.eq(v(id).signals.color, 'ok', id); a.ok(!v(id).limit.holdReasons.some(x => /SIGNAL/.test(x)), id); }
    for (const id of ['CT-VN-003', 'CT-JP-008', 'CT-JP-005']) { a.eq(v(id).signals.color, 'off', id); a.ok(!v(id).limit.holdReasons.some(x => /SIGNAL/.test(x)), id + ' deposits and buyouts have no signal'); }
    const k = env.Model.kpis(m.views); const n = k.signalCounts; a.eq(Object.values(n).reduce((x, y) => x + y, 0), k.count, 'every contract has one colour'); a.ok(n.bad > 0 && n.warn > 0 && n.ok > 0 && n.off === 3);
    const rb = st.commands.createApproval('CT-JP-004', 1000); a.eq(rb.ok, false); const hl = env.Limit.applyHolds({ holdReasons: [], topupHold: false, availableTopupMinor: 5e6 }, ['RED_SIGNAL', 'RED_SIGNAL']); a.deepEq(hl.holdReasons, ['RED_SIGNAL']); a.ok(hl.topupHold); a.eq(hl.availableTopupMinor, 0, 'a hold zeroes the available top-up'); const ok2 = env.Limit.applyHolds({ holdReasons: [], topupHold: false, availableTopupMinor: 5e6 }, []); a.ok(!ok2.topupHold); a.eq(ok2.availableTopupMinor, 5e6);
  });

  t('SG04', 'Risk codes are entered by the SCM or finance, checked against the list, kept in a history, and move signal S8 and the hotel colour', ['SIG-5', 'D-4'], a => {
    const st = env.as(env.newStore(), 'SCM'); const c = st.commands; const v = () => st.model().byContract['CT-VN-001']; const ledger = JSON.stringify(st.state.ledger);
    a.eq(v().signals.color, 'ok'); a.eq(c.setRiskFlags('NOPE', ['G1']).errors[0], 'E_CONTRACT_UNKNOWN'); a.eq(c.setRiskFlags('CT-VN-001', 'G1').errors[0], 'E_ARGUMENT'); a.eq(c.setRiskFlags('CT-VN-001', ['Z9']).errors[0], 'E_RISK_FLAG_UNKNOWN:Z9'); a.eq(c.setRiskFlags('CT-VN-001', []).errors[0], 'E_NO_CHANGE');
    a.ok(c.setRiskFlags('CT-VN-001', ['G2', 'G1', 'G1']).ok); a.deepEq(st.state.contracts.find(x => x.contractId === 'CT-VN-001').riskFlags, ['G1', 'G2'], 'sorted and without duplicates'); a.eq(v().signals.sig.S8.c, 'warn'); a.eq(v().signals.color, 'warn'); a.ok(v().limit.holdReasons.includes('YELLOW_SIGNAL'));
    a.ok(c.setRiskFlags('CT-VN-001', ['C3']).ok); a.eq(v().signals.color, 'bad'); a.ok(v().limit.holdReasons.includes('RED_SIGNAL')); a.eq(st.state.contracts.find(x => x.contractId === 'CT-VN-001').riskFlagHistory.length, 2, 'the earlier lists stay in the history');
    for (const role of ['SUPPORT']) { env.as(st, role); a.ok(c.setRiskFlags('CT-VN-001', []).ok, role + ' can clear the codes'); } a.eq(v().signals.color, 'ok');
    for (const role of ['VIEWER', 'CEO']) { env.as(st, role); a.throws(() => c.setRiskFlags('CT-VN-001', ['G1']), 'E_FORBIDDEN', role); }
    a.eq(JSON.stringify(st.state.ledger), ledger, 'risk codes never write the ledger');
  });

  t('SG06', 'Limit basis (rooms, monthly room revenue): entered with a source, checked, kept in a history, and the limit follows; the gates in front of the request show for red signals and the December block', ['LIM-5', 'D-4'], a => {
    const st = env.as(env.newStore(), 'SCM'); const c = st.commands; const ct = st.state.contracts.find(x => x.contractId === 'CT-KR-004'); const hid = ct.hotelId; const lim = () => st.model().byContract['CT-KR-004'].limit; const ledger = JSON.stringify(st.state.ledger);
    a.eq(c.setHotelBasis('NOPE', { rooms: 10 }, 'DOC-1').errors[0], 'E_TARGET_UNKNOWN'); a.eq(c.setHotelBasis(hid, null, 'DOC-1').errors[0], 'E_ARGUMENT'); a.eq(c.setHotelBasis(hid, { rooms: 40 }, '').errors[0], 'E_EVIDENCE_REQUIRED'); a.eq(c.setHotelBasis(hid, { rooms: 0 }, 'DOC-1').errors[0], 'E_ROOMS_INVALID'); a.eq(c.setHotelBasis(hid, { rooms: 1.5 }, 'DOC-1').errors[0], 'E_ROOMS_INVALID'); a.eq(c.setHotelBasis(hid, { rooms: 5001 }, 'DOC-1').errors[0], 'E_ROOMS_INVALID'); a.eq(c.setHotelBasis(hid, { monthlyRoomRevenueMinor: -5 }, 'DOC-1').errors[0], 'E_AMOUNT_INVALID'); a.eq(c.setHotelBasis(hid, { monthlyRoomRevenueMinor: 1.5 }, 'DOC-1').errors[0], 'E_AMOUNT_INVALID');
    a.ok(c.setHotelBasis(hid, { rooms: 40, monthlyRoomRevenueMinor: 60e6 }, 'DOC-2').ok); const h = st.state.hotels.find(x => x.hotelId === hid); a.eq(h.rooms, 40); a.eq(h.monthlyRoomRevenueMinor, 60e6); a.eq(h.limitBasisHistory.length, 1); a.eq(c.setHotelBasis(hid, { rooms: 40 }, 'DOC-2').errors[0], 'E_NO_CHANGE');
    const g = lim().guards.map(x => x.id); a.ok(g.includes('L2_ROOMS') && g.includes('L3_REVENUE'), 'both caps are computed now'); a.ok(lim().recommendedLimitMinor <= 6e6, '10% of 60M is 6M, and 40 rooms allow 20M');
    a.ok(c.setHotelBasis(hid, { rooms: null, monthlyRoomRevenueMinor: null }, 'DOC-3').ok); a.ok(!lim().guards.some(x => x.id === 'L2_ROOMS' || x.id === 'L3_REVENUE')); a.eq(h.limitBasisHistory.length, 2);
    for (const role of ['VIEWER', 'CEO']) { env.as(st, role); a.throws(() => c.setHotelBasis(hid, { rooms: 10 }, 'DOC-4'), 'E_FORBIDDEN', role); }
    env.as(st, 'SUPPORT'); a.ok(c.setHotelBasis(hid, { rooms: 55 }, 'DOC-5').ok); a.eq(JSON.stringify(st.state.ledger), ledger, 'a limit basis never writes the ledger');
    env.as(st, 'SCM'); a.eq(c.createApproval('CT-KR-003', 1000).errors[0], 'E_SIGNAL_RED'); const ye = env.newStore(); env.as(ye, 'SCM'); ye.state.config.asOf = '2026-12-10'; a.eq(ye.commands.createApproval('CT-KR-001', 1000).errors[0], 'E_YEAR_END_BLOCK', 'December: no new or top-up request');
  });
  t('SG05', 'Year-end rule of 2026: December blocks new and top-up requests, the warning starts on 30 October, and the dates are settings the CEO can change', ['SIG-6', 'CFG-1'], a => {
    const ye = cfg.review.yearEnd; a.deepEq(ye, { blockFrom: '2026-12-01', blockTo: '2026-12-31', warnFrom: '2026-10-30', endDate: '2026-12-31' });
    const hold = asOf => { const st = env.as(env.newStore(), 'SCM'); st.state.config.asOf = asOf; return st.model().byContract['CT-VN-001'].limit.holdReasons; };
    a.ok(!hold('2026-11-30').includes('YEAR_END_BLOCK')); a.ok(hold('2026-12-01').includes('YEAR_END_BLOCK')); a.ok(hold('2026-12-31').includes('YEAR_END_BLOCK')); a.ok(!hold('2027-01-01').includes('YEAR_END_BLOCK'));
    const bad = mut => { const c2 = env.clone(cfg); mut(c2.review.yearEnd); return Config.validate(c2); };
    a.ok(bad(y => { y.blockFrom = '2026-13-01'; }).some(e => /yearEnd/.test(e))); a.ok(bad(y => { y.blockFrom = '2027-01-05'; }).some(e => /yearEnd/.test(e))); a.ok(bad(y => { y.warnFrom = '2026-12-15'; }).some(e => /yearEnd/.test(e)), 'the warning cannot start after the block');
  });
};
