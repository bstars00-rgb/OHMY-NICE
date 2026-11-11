'use strict';
// Engine-level tests: ledger, forecast, rating, limit, alerts, CSV. Expected values are hand-computed, not copied from engine output.
const env = require('./helpers/env');
const { Money, Dates, Config, Ledger, Forecast, Rating, Limit, Alerts, Csv, Model, Seed, Weighted, Adapters } = env;

module.exports = function register(h) {
  const { test: t } = h;
  const seedState = () => Seed.buildSeed();
  const view = (state, id) => Model.compute(state).byContract[id];
  const tx = (st, o) => Object.assign({ source: 'TEST' }, o);
  const VER = { counterpartyVerification: 'VERIFIED', counterpartyEvidence: { by: 'Kim', at: '2026-10-01', evidenceRef: 'REG-0001' } };

  /* ---------------- LEDGER ---------------- */
  t('L01', 'Ledger identity holds for all seeded contracts; KR-001 closing = 45,000,000 KRW', ['M02-2', 'T01'], a => {
    const s = seedState();
    for (const c of s.contracts) { const b = Ledger.balance(s.ledger, c.contractId); a.eq(b.closingMinor, b.openingMinor + b.topupsMinor - b.consumptionMinor - b.refundsMinor - b.offsetsMinor + b.adjustmentsMinor, c.contractId); a.ok(Ledger.verifyIdentity(s.ledger, c.contractId).ok, 'running == closing ' + c.contractId); }
    const b = Ledger.balance(s.ledger, 'CT-KR-001');
    a.eq(b.openingMinor, 60e6); a.eq(b.topupsMinor, 135e6); a.eq(b.consumptionMinor, 150e6); a.eq(b.closingMinor, 45e6);
    a.eq(b.pendingConsumptionMinor, 5e6, 'pending Nov consumption is reported but not deducted');
  });
  t('L02', 'Duplicate top-up (same content / same external ref / same txId) is rejected and balance is unchanged', ['M02-4', 'T02'], a => {
    const f = env.synth({ topups: [['2026-10-10', 10e6]] }); const before = Ledger.balance(f.state.ledger, 'CT-T').closingMinor;
    const dup = { contractId: 'CT-T', type: 'TOPUP', amountMinor: 10e6, currency: 'KRW', occurredAt: '2026-10-12T10:00:00+09:00' };       // no reference: content is the key
    a.ok(Ledger.append(f.state.ledger, dup, f.cx).ok, 'first content-keyed row is accepted');
    const r2 = Ledger.append(f.state.ledger, dup, f.cx); a.ok(!r2.ok); a.includes(r2.errors, 'E_DUPLICATE_KEY');
    const byRef = Ledger.append(f.state.ledger, { contractId: 'CT-T', type: 'TOPUP', amountMinor: 99, currency: 'KRW', occurredAt: '2026-10-11T10:00:00+09:00', externalRef: 'T0' }, f.cx);
    a.ok(!byRef.ok); a.includes(byRef.errors, 'E_DUPLICATE_KEY');            // same external ref, different amount -> still duplicate
    const first = f.state.ledger[f.state.ledger.length - 1];
    const byId = Ledger.append(f.state.ledger, { contractId: 'CT-T', type: 'TOPUP', amountMinor: 5, currency: 'KRW', occurredAt: '2026-10-12T10:00:00+09:00', txId: first.txId }, f.cx);
    a.ok(!byId.ok); a.includes(byId.errors, 'E_DUPLICATE_ID');
    a.eq(Ledger.balance(f.state.ledger, 'CT-T').closingMinor, before + 10e6, 'only the single accepted duplicate-candidate counted once');
  });
  t('L03', 'Negative, zero, NaN, wrong-currency, unsupported-currency and over-precise amounts are rejected', ['M02-3', 'T03'], a => {
    const f = env.synth({}); const base = { contractId: 'CT-T', type: 'TOPUP', currency: 'KRW', occurredAt: '2026-11-01T10:00:00+09:00' };
    const code = (o) => Ledger.append(f.state.ledger, Object.assign({}, base, o), f.cx);
    a.includes(code({ amountMinor: -5, externalRef: 'a' }).errors, 'E_AMOUNT_NEGATIVE');
    a.includes(code({ amountMinor: 0, externalRef: 'b' }).errors, 'E_AMOUNT_INVALID');
    a.includes(code({ amountMinor: NaN, externalRef: 'c' }).errors, 'E_AMOUNT_INVALID');
    a.includes(code({ amountMinor: 1.5, externalRef: 'd' }).errors, 'E_AMOUNT_INVALID');
    a.includes(code({ amountMinor: 100, currency: 'EUR', externalRef: 'e' }).errors, 'E_CURRENCY_UNSUPPORTED');
    a.includes(code({ amountMinor: 100, currency: 'USD', externalRef: 'f' }).errors, 'E_CURRENCY_MISMATCH');
    a.includes(code({ amountMinor: 100, type: 'BOGUS', externalRef: 'g' }).errors, 'E_TYPE_INVALID');
    a.eq(Money.parseAmount('12.5', 'JPY').error, 'E_AMOUNT_PRECISION'); a.eq(Money.parseAmount('1,000', 'KRW').error, 'E_AMOUNT_INVALID'); a.eq(Money.parseAmount('abc', 'USD').error, 'E_AMOUNT_INVALID'); a.eq(Money.parseAmount('1.234', 'USD').error, 'E_AMOUNT_PRECISION');
    a.includes(code({ type: 'OPENING', amountMinor: -1, externalRef: 'h' }).errors, 'E_AMOUNT_NEGATIVE', 'negative opening rejected');
    a.includes(code({ type: 'REFUND', amountMinor: -1, externalRef: 'i' }).errors, 'E_AMOUNT_NEGATIVE');
    a.eq(f.state.ledger.length, 4, 'nothing was appended by any rejected row');
  });
  t('L04', 'Ledger is append-only: rows are frozen and corrections require a reasoned ADJUSTMENT', ['M02-3'], a => {
    const f = env.synth({}); const row = f.state.ledger[0];
    a.ok(Object.isFrozen(row)); let threw = false; try { 'use strict'; (function () { 'use strict'; row.amountMinor = 1; })(); } catch (e) { threw = true; } a.ok(threw, 'mutation throws in strict mode');
    a.includes(Ledger.append(f.state.ledger, { contractId: 'CT-T', type: 'ADJUSTMENT', amountMinor: -1000, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00' }, f.cx).errors, 'E_ADJUSTMENT_REASON_REQUIRED');
    const ok = Ledger.append(f.state.ledger, { contractId: 'CT-T', type: 'ADJUSTMENT', amountMinor: -1000, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00', reason: 'bank fee correction' }, f.cx); a.ok(ok.ok);
    a.eq(Ledger.balance(f.state.ledger, 'CT-T').adjustmentsMinor, -1000); a.eq(f.state.ledger[0].amountMinor, 100e6, 'opening untouched');
  });
  t('L05', 'Reconciliation: MATCH / MINOR / MAJOR / UNCONFIRMED / CURRENCY_MISMATCH / stale', ['M02-5', 'T09'], a => {
    const cfg = Config.defaults(); const R = (led, conf) => Ledger.reconcile(led, 'JPY', conf, cfg, '2026-11-06');
    a.eq(R(8e6, { amountMinor: 8e6, currency: 'JPY', confirmedAt: '2026-10-31' }).status, 'MATCH');
    a.eq(R(8e6, { amountMinor: 6.5e6, currency: 'JPY', confirmedAt: '2026-10-28' }).status, 'MAJOR'); a.eq(R(8e6, { amountMinor: 6.5e6, currency: 'JPY', confirmedAt: '2026-10-28' }).pctBp, 1875);
    a.eq(R(8e6, { amountMinor: 8e6 - 8000, currency: 'JPY', confirmedAt: '2026-10-31' }).status, 'MATCH', '10bp tolerance is inclusive');
    a.eq(R(8e6, { amountMinor: 8e6 - 8001, currency: 'JPY', confirmedAt: '2026-10-31' }).status, 'MINOR');
    a.eq(R(10e6, { amountMinor: 9.8e6, currency: 'JPY', confirmedAt: '2026-10-31' }).status, 'MINOR', '200bp inclusive'); a.eq(R(10e6, { amountMinor: 9.79e6, currency: 'JPY', confirmedAt: '2026-10-31' }).status, 'MAJOR');
    a.eq(R(8e6, null).status, 'UNCONFIRMED'); a.eq(R(8e6, { amountMinor: 8e6, currency: 'USD', confirmedAt: '2026-10-31' }).status, 'CURRENCY_MISMATCH');
    a.ok(!R(8e6, { amountMinor: 8e6, currency: 'JPY', confirmedAt: '2026-09-22' }).stale, '45 days is not stale'); a.ok(R(8e6, { amountMinor: 8e6, currency: 'JPY', confirmedAt: '2026-09-21' }).stale, '46 days is stale');
    const s = seedState(); a.eq(view(s, 'CT-JP-003').recon.status, 'MAJOR'); a.eq(view(s, 'CT-JP-003').recon.diffMinor, 1.5e6); a.eq(view(s, 'CT-JP-002').recon.status, 'MINOR'); a.eq(view(s, 'CT-KR-001').recon.status, 'MATCH');
  });
  t('L06', 'All five prepayment types exist in sample data and are ledger-capable', ['M02-1'], a => {
    const s = seedState(); const types = new Set(s.contracts.map(c => c.prepaymentType));
    for (const x of ['FLOATING', 'PREPAYMENT', 'BUYOUT', 'HARD_BLOCK_ADV', 'SECURITY_DEPOSIT']) a.ok(types.has(x), x);
    for (const c of s.contracts) a.ok(Ledger.balance(s.ledger, c.contractId).count > 0, c.contractId);
  });
  t('L07', 'Refund > balance, future-dated, malformed date, consumption without period; confirmed-zero allowed only for consumption', ['M02-3', 'T03'], a => {
    const f = env.synth({ opening: 10e6, cons: [null, null, null] }); const code = o => Ledger.append(f.state.ledger, Object.assign({ contractId: 'CT-T', currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00' }, o), f.cx);
    a.includes(code({ type: 'REFUND', amountMinor: 10e6 + 1, externalRef: 'r1' }).errors, 'E_REFUND_EXCEEDS_BALANCE'); a.ok(code({ type: 'REFUND', amountMinor: 10e6, externalRef: 'r2' }).ok, 'full refund of balance allowed');
    a.includes(code({ type: 'TOPUP', amountMinor: 5, occurredAt: '2026-11-07T00:00:00+09:00', externalRef: 'f' }).errors, 'E_FUTURE_DATE');
    a.includes(code({ type: 'TOPUP', amountMinor: 5, occurredAt: '2026-13-40', externalRef: 'bad' }).errors, 'E_DATETIME_INVALID');
    a.includes(code({ type: 'CONSUMPTION', amountMinor: 5, status: 'confirmed', externalRef: 'np' }).errors, 'E_PERIOD_REQUIRED');
    a.ok(code({ type: 'CONSUMPTION', amountMinor: 0, status: 'confirmed', period: '2026-10', externalRef: 'z' }).ok, 'explicit confirmed zero consumption');
    a.includes(code({ type: 'CONSUMPTION', amountMinor: 0, status: 'pending', period: '2026-10', externalRef: 'z2' }).errors, 'E_AMOUNT_INVALID');
    a.includes(code({ type: 'OPENING', amountMinor: 1, externalRef: 'o2' }).errors, 'E_OPENING_EXISTS');
  });
  t('L08', 'Data separation by hotel / contract / entity / currency; cross-currency posting rejected', ['M01-3', 'T11'], a => {
    const s = seedState(); const h4 = s.contracts.filter(c => c.hotelId === 'H004'); a.eq(h4.length, 2); a.ok(h4[0].currency === h4[1].currency && h4[0].omhEntity !== h4[1].omhEntity, 'one hotel, one currency, two contracting entities');
    const h2 = s.contracts.filter(c => c.hotelId === 'H002'); a.eq(h2.length, 1);
    const before = Object.fromEntries(s.contracts.map(c => [c.contractId, Ledger.balance(s.ledger, c.contractId).closingMinor]));
    const cx = { contractsById: Object.fromEntries(s.contracts.map(c => [c.contractId, c])), asOf: s.config.asOf };
    a.ok(Ledger.append(s.ledger, { contractId: 'CT-JP-001', type: 'TOPUP', amountMinor: 1e6, currency: 'JPY', occurredAt: '2026-11-04T10:00:00+09:00', externalRef: 'sep1' }, cx).ok);
    for (const c of s.contracts) a.eq(Ledger.balance(s.ledger, c.contractId).closingMinor, before[c.contractId] + (c.contractId === 'CT-JP-001' ? 1e6 : 0), c.contractId);
    a.includes(Ledger.append(s.ledger, { contractId: 'CT-JP-002', type: 'TOPUP', amountMinor: 100, currency: 'USD', occurredAt: '2026-11-04T10:00:00+09:00', externalRef: 'x' }, cx).errors, 'E_CURRENCY_MISMATCH');
  });
  t('L09', 'KPI exposure is grouped per currency and never summed across currencies', ['M04-3'], a => {
    const s = seedState(); const m = Model.compute(s); const k = Model.kpis(m.views);
    const manual = {}; for (const c of s.contracts) { const b = Ledger.balance(s.ledger, c.contractId).closingMinor; manual[c.currency] = (manual[c.currency] || 0) + b; }
    a.deepEq(k.exposure, manual); a.deepEq(Object.keys(k.exposure).sort(), ['JPY', 'KRW', 'VND'], 'one currency per country'); a.eq(k.exposure.KRW, 45e6 + 30e6 + 46e6 + 5.7e6 + 1.5e6);
    a.throws(() => Money.assertSame('KRW', 'JPY'), 'E_CURRENCY_MISMATCH');
    const kr = Model.kpis(m.views, { country: 'KR' }); a.deepEq(Object.keys(kr.exposure).sort(), ['KRW'], 'Korean hotels hold Korean won only');
  });

  /* ---------------- FORECAST ---------------- */
  t('F01', 'Average monthly consumption = mean of the last 3 CONFIRMED completed months', ['M05-1'], a => {
    const s = seedState(); a.eq(view(s, 'CT-KR-001').forecast.avgMinor, 30e6); a.eq(view(s, 'CT-KR-003').forecast.avgMinor, 18e6, '(24+22+8)/3');
    a.eq(view(s, 'CT-KR-004').forecast.avgMinor, 9766666, 'floor((10M+9.5M+9.8M)/3)'); a.deepEq(view(s, 'CT-KR-001').forecast.series.map(x => x.month), ['2026-08', '2026-09', '2026-10'], 'current partial month excluded');
  });
  t('F02', 'Zero consumption → "no consumption", no depletion date, no NaN/Infinity anywhere', ['M05-2', 'T04'], a => {
    const f = env.synth({ cons: [0, 0, 0] }); const v = f.view(); a.eq(v.forecast.status, 'NO_CONSUMPTION'); a.eq(v.forecast.depletionDate, null); a.eq(v.forecast.daysToDepletion, null); a.eq(v.forecast.avgMinor, 0);
    a.eq(v.limit.recommendedLimitMinor, 0); a.ok(v.forecast.longUnconsumed); a.eq(v.forecast.estimatedUnusedAtEndMinor, v.balance.closingMinor);
    const json = JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? '#BAD' : x)); a.ok(!json.includes('#BAD'), 'no NaN/Infinity'); a.ok(!/NaN|Infinity/.test(JSON.stringify(v)));
    const sim = Limit.simulate(v.limit, v.forecast, 1e6, v.contract, { daysPerMonth: 30, addDays: Dates.addDays, asOf: '2026-11-06' }); a.eq(sim.postDepletionDate, null); a.ok(sim.approvalRequired);
  });
  t('F03', 'Missing months are MISSING (not zero): partial → average of known months; none → NO_DATA & limit unavailable', ['M05-1', 'T05'], a => {
    const p = env.synth({ cons: [30e6, null, 20e6] }).view(); a.eq(p.forecast.quality, 'PARTIAL'); a.eq(p.forecast.avgMinor, 25e6); a.eq(p.forecast.series[1].status, 'MISSING'); a.eq(p.forecast.series[1].amountMinor, null); a.eq(p.forecast.confirmedMonths, 2);
    a.eq(p.forecast.velocity.status, 'UNKNOWN', 'velocity not guessed from incomplete months'); a.includes(p.limit.notes, 'PARTIAL_CONSUMPTION_DATA');
    const sim = Limit.simulate(p.limit, p.forecast, 1e6, p.contract, { daysPerMonth: 30, addDays: Dates.addDays, asOf: '2026-11-06' }); a.includes(sim.approvalReasons, 'PARTIAL_CONSUMPTION_DATA'); a.ok(sim.approvalRequired);
    const n = env.synth({ cons: [null, null, null] }).view(); a.eq(n.forecast.status, 'NO_DATA'); a.eq(n.forecast.quality, 'NONE'); a.eq(n.limit.status, 'UNAVAILABLE'); a.eq(n.limit.recommendedLimitMinor, null);
    const s = seedState(); a.eq(view(s, 'CT-VN-001').forecast.avgMinor, 610e6); a.eq(view(s, 'CT-VN-001').forecast.quality, 'PARTIAL');
  });
  t('F04', 'Depletion date and velocity arithmetic (hand-computed)', ['M05-3'], a => {
    const v = view(seedState(), 'CT-KR-001'); a.eq(v.forecast.daysToDepletion, 45); a.eq(v.forecast.depletionDate, '2026-12-21'); a.eq(v.forecast.monthsOfCover, 1.5);
    const c = view(seedState(), 'CT-KR-003'); a.eq(c.forecast.velocity.pct, -65.2); a.eq(c.forecast.velocity.status, 'DOWN');
    const up = env.synth({ cons: [10e6, 10e6, 20e6] }).view(); a.eq(up.forecast.velocity.pct, 100); const flat = env.synth({ cons: [10e6, 10e6, 10e6] }).view(); a.eq(flat.forecast.velocity.status, 'FLAT');
    const nb = env.synth({ cons: [0, 0, 5e6] }).view(); a.eq(nb.forecast.velocity.status, 'NO_BASE');
    const ceil = env.synth({ opening: 30, cons: [7, 7, 7] }).view(); a.eq(ceil.balance.closingMinor, 9); a.eq(ceil.forecast.daysToDepletion, 39, 'ceil(9*30/7)=ceil(38.57)');
  });
  t('F05', 'Contract-expiry feasibility and estimated unused balance at expiry', ['M05-3'], a => {
    const v = view(seedState(), 'CT-VN-002'); a.eq(v.forecast.depletesBeforeEnd, false); a.eq(v.forecast.estimatedUnusedAtEndMinor, 1500e6 - Math.floor(400e6 * 55 / 30)); a.eq(v.forecast.estimatedUnusedAtEndMinor, 766666667);
    const ok = view(seedState(), 'CT-KR-001'); a.eq(ok.forecast.depletesBeforeEnd, true); a.eq(ok.forecast.estimatedUnusedAtEndMinor, 0);
    const ex = env.synth({ endDate: '2026-10-31' }).view(); a.ok(ex.forecast.expired); a.eq(ex.forecast.depletesBeforeEnd, false);
  });
  t('F06', 'Booking-date sales and PENDING consumption never drive the forecast; basis is explicit', ['M05-4'], a => {
    const f = env.synth({}); const before = f.view().forecast.avgMinor;
    f.state.sales['CT-T'] = ['2026-08', '2026-09', '2026-10'].map(m => ({ month: m, amountMinor: 999e6, basis: 'BOOKING_DATE' })); a.eq(f.view().forecast.avgMinor, before, 'sales ignored for average');
    a.ok(Ledger.append(f.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'CONSUMPTION', amountMinor: 77e6, period: '2026-10', status: 'pending', occurredAt: '2026-11-02T10:00:00+09:00', externalRef: 'P' }, f.cx).ok);
    a.eq(f.view().forecast.avgMinor, before, 'pending consumption ignored'); a.eq(f.view().forecast.series[2].pendingMinor, 77e6); a.eq(f.view().forecast.series[2].status, 'CONFIRMED');
    const only = env.synth({ cons: [30e6, 30e6, null] }); Ledger.append(only.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'CONSUMPTION', amountMinor: 30e6, period: '2026-10', status: 'pending', occurredAt: '2026-11-02T10:00:00+09:00', externalRef: 'P2' }, only.cx);
    a.eq(only.view().forecast.series[2].status, 'PENDING_ONLY'); a.eq(only.view().forecast.quality, 'PARTIAL'); a.eq(f.view().forecast.salesTrend.basis, undefined);
  });
  t('F07', 'Security deposits are NOT_APPLICABLE for consumption forecast / limit', ['M05-3', 'M02-1'], a => {
    const v = view(seedState(), 'CT-VN-003'); a.eq(v.forecast.status, 'NOT_APPLICABLE'); a.eq(v.limit.status, 'UNAVAILABLE'); a.includes(v.limit.holdReasons, 'NOT_APPLICABLE_DEPOSIT'); a.eq(v.forecast.depletionDate, null);
  });
  t('F08', 'Long-unconsumed detection (> 6 months of cover) and booking-sales trend', ['M05-3', 'M06-1'], a => {
    const big = env.synth({ opening: 400e6, cons: [30e6, 30e6, 30e6] }).view(); a.ok(big.forecast.monthsOfCover > 6); a.ok(big.forecast.longUnconsumed);
    const small = env.synth({}).view(); a.ok(!small.forecast.longUnconsumed);
    const st = Forecast.salesTrend([{ month: '2026-08', amountMinor: 12e6 }, { month: '2026-09', amountMinor: 12e6 }, { month: '2026-10', amountMinor: 8e6 }], '2026-11-06', 3); a.near(st.pct, -33.3, 0.05); a.eq(st.status, 'DOWN');
    a.eq(Forecast.salesTrend([], '2026-11-06', 3).status, 'UNKNOWN');
  });

  /* ---------------- RATING ---------------- */
  t('R01', '12 criteria, weights sum to 100, each with a rationale (KO+EN)', ['M03-1'], a => {
    a.eq(Rating.CRITERIA.length, 12); const cfg = Config.defaults(); a.eq(Object.values(cfg.weights).reduce((x, y) => x + y, 0), 100);
    for (const c of Rating.CRITERIA) { a.ok(c.why.ko && c.why.en && c.name.ko && c.name.en, c.id); a.ok(c.id === 'scmOps' ? cfg.weights[c.id] === 0 : cfg.weights[c.id] > 0, c.id); }
    a.eq(Rating.CRITERIA.length, Config.CRITERIA_IDS.length); a.ok(cfg.provisional === true, 'provisional flag set');
  });
  t('R02', 'Unknown is excluded (not mid-scored): score unchanged, confidence reduced, unknown listed', ['M03-2'], a => {
    const cfg = Config.defaults(); const all4 = Object.fromEntries(Rating.CRITERIA_IDS.map(i => [i, 4]));
    const full = Rating.evaluate({ scores: all4, cfg, hotel: { facts: {} }, contract: { facts: VER }, derived: {} }); a.eq(full.score, 80); a.eq(full.confidence.pct, 100);
    const part = Object.assign({}, all4, { financialHealth: null, continuity: undefined, scmOps: null }); const r = Rating.evaluate({ scores: part, cfg, hotel: { facts: {} }, contract: { facts: VER }, derived: {} });
    a.eq(r.score, 80, 'unknowns do not drag the score toward 3'); a.eq(r.confidence.pct, 86); a.deepEq(r.confidence.unknownIds.sort(), ['continuity', 'financialHealth'], 'scmOps has weight 0 and is not listed'); a.eq(r.confidence.level, 'HIGH');
    const mid = Object.assign({}, all4, { financialHealth: 3, continuity: 3, scmOps: 3 }); a.ok(Rating.evaluate({ scores: mid, cfg, hotel: { facts: {} }, contract: { facts: VER }, derived: {} }).score < 80, 'treating unknown as 3 would differ');
  });
  t('R03', 'Grade boundaries: exactly-at-threshold is inclusive; just below drops a grade', ['M03-4', 'T06'], a => {
    const base = { hotel: { facts: {} }, contract: { facts: VER }, derived: {} };
    const mk = (cfg, scores) => Rating.evaluate(Object.assign({ cfg, scores }, base));
    const all4 = Object.fromEntries(Rating.CRITERIA_IDS.map(i => [i, 4])); const cfg = Config.defaults();
    a.eq(mk(cfg, all4).grade, 'A', '80.0 -> A'); a.eq(mk(cfg, Object.assign({}, all4, { reconAccuracy: 3 })).score, 78.2); a.eq(mk(cfg, Object.assign({}, all4, { reconAccuracy: 3 })).grade, 'B');
    const b68 = Object.fromEntries(Rating.CRITERIA_IDS.map(i => [i, 3])); b68.legalEntity = 4; b68.settlementHistory = 4; b68.consumptionVsPrepay = 5; const raw = Weighted.weightedScore(Rating.CRITERIA_IDS.map(i => ({ score: b68[i], weight: cfg.weights[i] })), 5).score;
    for (const g of ['A', 'B', 'C']) { const c2 = Config.defaults(); c2.ratingThresholds = { A: 99, B: 98, C: 97 }; c2.ratingThresholds[g] = raw; if (g === 'A') { c2.ratingThresholds.B = raw - 1; c2.ratingThresholds.C = raw - 2; } if (g === 'B') { c2.ratingThresholds.A = raw + 5; c2.ratingThresholds.C = raw - 1; } if (g === 'C') { c2.ratingThresholds.A = raw + 6; c2.ratingThresholds.B = raw + 5; }
      a.eq(mk(c2, b68).scoreGrade, g, 'threshold == score -> ' + g); const c3 = JSON.parse(JSON.stringify(c2)); c3.ratingThresholds[g] = raw + 1e-6; a.ok(Rating.ORDER.indexOf(mk(c3, b68).scoreGrade) > Rating.ORDER.indexOf(g), 'score just below ' + g); }
    const d = mk(cfg, Object.fromEntries(Rating.CRITERIA_IDS.map(i => [i, 2]))); a.eq(d.score, 40); a.eq(d.grade, 'D'); a.ok(!['E'].includes(d.grade), 'hotel scale has no E');
  });
  t('R04', 'Red flags cap the grade regardless of score (score stays visible)', ['M03-3', 'T07'], a => {
    const closed = env.synth({ hotelFacts: { closure: { claimed: true, source: 'SCM', verified: { by: 'Kim', at: '2026-10-01', evidenceRef: 'DOC-1' } } } }).view(); a.ok(closed.rating.score >= 80); a.eq(closed.rating.scoreGrade, 'A'); a.eq(closed.rating.grade, 'D'); a.ok(closed.rating.capped);
    a.eq(env.synth({ facts: { counterpartyVerification: 'FAILED' } }).view().rating.grade, 'D');
    a.eq(env.synth({ facts: { refundRefused: { claimed: true, source: 'SCM', verified: { by: 'Lee', at: '2026-10-01', evidenceRef: 'EML-1' } } } }).view().rating.grade, 'D');
    a.eq(env.synth({ hotelFacts: { ownershipChange: 'PENDING' } }).view().rating.grade, 'C'); a.eq(env.synth({ hotelFacts: { ownershipChange: 'COMPLETED_RESOLVED' } }).view().rating.grade, 'A');
    a.eq(env.synth({ facts: { counterpartyVerification: 'UNKNOWN' } }).view().rating.grade, 'C', 'unverified entity -> C cap');
    a.eq(env.synth({ conf: [90e6, '2026-10-31'], opening: 100e6, cons: [0, 0, 0] }).view().rating.flags.some(f => f.id === 'RECON_MAJOR_MISMATCH'), true, '10% diff is major'); a.eq(env.synth({ conf: [50e6, '2026-10-31'] }).view().rating.grade, 'C');
    a.eq(env.synth({ cons: [30e6, 30e6, 10e6] }).view().rating.grade, 'B', 'collapse (-50%) caps at B');
    const s = seedState(); a.eq(view(s, 'CT-JP-003').rating.scoreGrade, 'B'); a.eq(view(s, 'CT-JP-003').rating.grade, 'C'); a.eq(view(s, 'CT-KR-001').rating.grade, 'B', 'no sample hotel reaches A while the outside information is missing'); a.ok(view(s, 'CT-KR-001').rating.flags.some(f => f.id === 'LOW_CONFIDENCE'));
  });
  t('R05', 'Low evidence: coverage < 50% → NR (despite a high raw score); 50–70% → capped at B', ['M03-2', 'M03-4'], a => {
    const cfg = Config.defaults(); const base = { cfg, hotel: { facts: {} }, contract: { facts: VER }, derived: {} };
    const s5 = Object.fromEntries(Rating.CRITERIA_IDS.map(i => [i, 5])); const nr = Object.assign({}, s5); ['financialHealth', 'ownershipChange', 'settlementHistory', 'consumptionVsPrepay', 'collateral', 'continuity'].forEach(k => { nr[k] = null; });
    const r1 = Rating.evaluate(Object.assign({ scores: nr }, base)); a.eq(r1.confidence.pct, 45); a.eq(r1.score, 100); a.eq(r1.grade, 'NR'); a.eq(r1.confidence.level, 'LOW');
    const cap = Object.assign({}, s5); ['financialHealth', 'ownershipChange', 'continuity', 'scmOps', 'reconAccuracy'].forEach(k => { cap[k] = null; }); const r2 = Rating.evaluate(Object.assign({ scores: cap }, base)); a.eq(r2.confidence.pct, 69); a.eq(r2.scoreGrade, 'A'); a.eq(r2.grade, 'B'); a.ok(r2.flags.some(f => f.id === 'LOW_CONFIDENCE'));
    const none = Rating.evaluate(Object.assign({ scores: {} }, base)); a.eq(none.grade, 'NR'); a.eq(none.score, null); a.eq(view(seedState(), 'CT-JP-007').rating.grade, 'NR');
    const critical = Rating.evaluate({ cfg, scores: {}, hotel: { facts: {} }, contract: { facts: Object.assign({}, VER, { counterpartyVerification: 'FAILED' }) }, derived: {} }); a.eq(critical.grade, 'D', 'a known critical flag beats NR');
  });
  t('R06', 'Unverified closure / news / AI claims never confirm a closure or cap the grade', ['M06-3', 'M03-3'], a => {
    const claims = [{ claimed: true, source: 'NEWS/AI', verified: null }, { claimed: true, source: 'SCM', verified: { by: 'Kim', at: '2026-10-01', evidenceRef: '' } }, { claimed: true, source: 'AI', verified: { by: 'AI-bot', at: '2026-10-01', evidenceRef: 'URL' } },
      { claimed: true, source: 'SCM', verified: { by: '', at: '2026-10-01', evidenceRef: 'D' } }, { claimed: true, source: 'SCM', verified: { by: 'mock-agent', at: '2026-10-01', evidenceRef: 'D' } }];
    for (const c of claims) { const f = env.synth({ hotelFacts: { closure: c } }); const v = f.view(); a.eq(v.rating.grade, 'A', JSON.stringify(c)); a.ok(!v.alerts.some(x => x.ruleId === 'CLOSURE_CONFIRMED')); a.ok(v.alerts.some(x => x.ruleId === 'UNVERIFIED_SIGNAL' && x.severity === 'MEDIUM')); a.eq(v.rating.unverifiedSignals.length, 1); }
    const v = view(seedState(), 'CT-JP-006'); a.eq(v.rating.grade, 'B'); a.ok(!v.liveAlerts.some(x => x.severity === 'CRITICAL')); a.ok(v.liveAlerts.some(x => x.ruleId === 'UNVERIFIED_SIGNAL'));
    a.ok(Rating.isVerified({ claimed: true, verified: { by: 'Kim', at: 'x', evidenceRef: 'DOC-1' } }));
  });
  t('R07', 'Recoverability is a separate axis from credit grade', ['M03-5'], a => {
    const nonref = env.synth({ refundable: false }).view(); a.eq(nonref.rating.grade, 'B', 'no refund clause lowers the score by itself'); a.eq(nonref.recoverability.tier, 'LOW');
    const unk = env.synth({ refundable: null }).view(); a.eq(unk.recoverability.tier, 'UNKNOWN'); const med = env.synth({}).view(); a.eq(med.recoverability.tier, 'MEDIUM'); a.eq(med.recoverability.unsecuredMinor, med.balance.closingMinor);
    const coll = env.synth({ collateral: 500e6 }).view(); a.eq(coll.recoverability.tier, 'HIGH'); a.eq(coll.recoverability.unsecuredMinor, 0);
    const part = env.synth({ collateral: 5e6 }).view(); a.eq(part.recoverability.unsecuredMinor, part.balance.closingMinor - 5e6);
    const diffCcy = env.synth({ ccy: 'JPY', collateral: 5e6 }); diffCcy.contract.collateral.currency = 'KRW'; a.eq(diffCcy.view().recoverability.collateralMinor, 0, 'collateral in another currency is not netted');
  });
  t('R08', 'Rating history is preserved (append-only snapshots with reason and scores)', ['M03-6'], a => {
    const st = env.as(env.newStore(), 'SCM'); const before = st.state.ratings['CT-KR-002'].history.length; const first = JSON.stringify(st.state.ratings['CT-KR-002'].history);
    a.eq(st.commands.commitRating('CT-KR-002', '').ok, false, 'reason required'); a.ok(st.commands.commitRating('CT-KR-002', 'Q4 review').ok);
    a.ok(st.commands.setOwnership('H002', 'PENDING', 'EVD-2001').ok); a.ok(st.commands.commitRating('CT-KR-002', 'ownership change recorded').ok);
    const h = st.state.ratings['CT-KR-002'].history; a.eq(h.length, before + 2); a.eq(JSON.stringify(h.slice(0, before)), first, 'earlier entries untouched'); a.ok(h[h.length - 1].reason && h[h.length - 1].by && h[h.length - 1].scores.ownershipChange === 2 && h[h.length - 2].scores.ownershipChange !== 2, 'each snapshot keeps the computed scores it was based on');
  });
  t('R09', 'Hotel scale is A–D (+NR) and distinct from partner A–E; D/NR multipliers are zero', ['M03-4'], a => {
    a.deepEq(Config.GRADES, ['A', 'B', 'C', 'D']); const cfg = Config.defaults(); a.eq(cfg.gradeMultipliers.D, 0); a.eq(cfg.gradeMultipliers.NR, 0); a.ok(cfg.provisional);
    const m = Model.compute(seedState()); for (const v of m.views) a.ok(['A', 'B', 'C', 'D', 'NR'].includes(v.rating.grade), v.contractId); a.ok(!Object.keys(cfg.flagCaps).some(k => cfg.flagCaps[k] === 'E'));
  });

  /* ---------------- LIMIT ---------------- */
  const sim = (v, amt) => Limit.simulate(v.limit, v.forecast, amt, v.contract, { daysPerMonth: 30, addDays: Dates.addDays, asOf: '2026-11-06' });
  t('M01', 'Grade multipliers A×2, B×1, C×0.5, D×0 on the 3-month average', ['M04-1'], a => {
    const cases = { A: 60e6, B: 30e6, C: 15e6, D: 0 };
    for (const g of Object.keys(cases)) { const f = env.synth({}); const v = f.view(); const L = Limit.compute({ grade: g, forecast: v.forecast, outstandingMinor: v.balance.closingMinor, contract: v.contract, recoverability: { tier: 'MEDIUM' }, alerts: [], cfg: f.cfg }); a.eq(L.baseLimitMinor, cases[g], g); a.eq(L.recommendedLimitMinor, cases[g], g + ' (no guard binds)'); }
    a.eq(Limit.multiplier('NR', Config.defaults()), 0);
  });
  t('M02', 'Available top-up, projected exposure and exceed flag at the exact boundary', ['M04-2', 'T08'], a => {
    const v = env.synth({ opening: 135e6 }).view(); a.eq(v.rating.grade, 'A'); a.eq(v.balance.closingMinor, 45e6); a.eq(v.limit.recommendedLimitMinor, 60e6); a.eq(v.limit.availableTopupMinor, 15e6);
    const ok = sim(v, 15e6); a.eq(ok.projectedMinor, 60e6); a.ok(!ok.limitExceeded); a.eq(ok.excessMinor, 0); a.ok(!ok.approvalRequired);
    const over = sim(v, 15e6 + 1); a.ok(over.limitExceeded); a.eq(over.excessMinor, 1); a.ok(over.approvalRequired); a.includes(over.approvalReasons, 'LIMIT_EXCEEDED'); a.eq(over.risk, 'HIGH');
    const near = sim(v, 12e6); a.eq(near.risk, 'MEDIUM', '>=90% of limit'); a.eq(sim(v, 1e6).risk, 'LOW');
  });
  t('M03', 'Already over limit: available 0, over-limit amount reported; any top-up requires approval', ['M04-2', 'T08'], a => {
    const v = view(seedState(), 'CT-KR-002'); a.eq(v.limit.recommendedLimitMinor, 20e6); a.eq(v.balance.closingMinor, 30e6); a.eq(v.limit.availableTopupMinor, 0); a.eq(v.limit.overLimitMinor, 10e6);
    const s = sim(v, 1); a.ok(s.limitExceeded && s.approvalRequired); a.eq(s.excessMinor, 10e6 + 1, '(30M+1) - 20M'); a.ok(Model.kpis(Model.compute(seedState()).views).limitExceeded.includes('CT-KR-002'));
  });
  t('M04', 'Extra safeguards: contract end, non-refundable, refund unknown, low recoverability', ['M04-4'], a => {
    const mk = (o) => { const f = env.synth(o); const v = f.view(); return Limit.compute({ grade: 'A', forecast: v.forecast, outstandingMinor: v.balance.closingMinor, contract: v.contract, recoverability: o.recov || { tier: 'MEDIUM' }, alerts: o.alerts || [], cfg: f.cfg }); };
    const end = mk({ endDate: '2026-11-26' }); a.eq(end.recommendedLimitMinor, 20e6, '20 days x 30M / 30'); a.ok(end.guards.find(g => g.id === 'G_CONTRACT_END').binding);
    a.eq(mk({ endDate: '2026-11-01' }).recommendedLimitMinor, 0, 'expired -> 0'); a.eq(mk({ refundable: false }).recommendedLimitMinor, 30e6); a.eq(mk({ refundable: null }).recommendedLimitMinor, 30e6);
    a.eq(mk({ recov: { tier: 'LOW' } }).recommendedLimitMinor, 15e6); a.eq(mk({ refundable: false, recov: { tier: 'LOW' } }).recommendedLimitMinor, 15e6, 'tightest cap wins'); a.eq(mk({}).recommendedLimitMinor, 60e6);
  });
  t('M05', 'Holds: grade D/NR, critical/high alerts and consumption collapse zero the available top-up', ['M04-4', 'M06-1'], a => {
    const s = seedState(); const d = view(s, 'CT-JP-004'); a.eq(d.rating.grade, 'D'); a.eq(d.limit.recommendedLimitMinor, 0); a.ok(d.limit.topupHold); a.includes(d.limit.holdReasons, 'GRADE_D_NO_PREPAY'); a.includes(d.limit.holdReasons, 'CRITICAL_ALERT_OPEN'); a.eq(d.limit.availableTopupMinor, 0);
    const c = view(s, 'CT-KR-003'); a.includes(c.limit.holdReasons, 'CONSUMPTION_COLLAPSE'); a.eq(c.limit.availableTopupMinor, 0); const nr = view(s, 'CT-JP-007'); a.eq(nr.rating.grade, 'NR'); a.ok(nr.limit.topupHold);
    const r = sim(d, 1e6); a.eq(r.risk, 'CRITICAL'); a.ok(r.approvalRequired);
  });
  t('M06', 'Limit unavailable (no data / deposit) → simulation flags approval; never a number', ['M04-4', 'T05'], a => {
    const nr = view(seedState(), 'CT-JP-007'); const r = sim(nr, 1e6); a.eq(r.recommendedLimitMinor, null); a.ok(r.limitExceeded && r.approvalRequired); a.includes(r.approvalReasons, 'LIMIT_UNAVAILABLE'); a.eq(r.excessMinor, null);
  });
  t('M07', 'Exact integer arithmetic for limits (floor, BigInt) incl. very large VND', ['M04-1', 'T01'], a => {
    a.eq(Money.avgMul(29300000, 3, 1), 9766666); a.eq(Money.mulFloor(1001, 0.75), 750); a.eq(Money.avgMul(3000000000000, 3, 2), 2000000000000); a.eq(Money.ceilDiv(100, 3), 34); a.eq(Money.avgMul(1, 3, 0.5), 0);
    a.eq(Money.format(1234567, 'KRW'), '1,234,567 KRW'); a.eq(Money.format(123456, 'USD'), '1,234.56 USD'); a.eq(Money.format(-5, 'USD'), '-0.05 USD'); a.eq(Money.format(null, 'KRW'), '—');
    const rt = Money.parseAmount('1234.56', 'USD'); a.eq(Money.format(rt.minor, 'USD', { noCode: true }), '1,234.56');
  });
  t('M08', 'Simulation is pure: no state mutation, writesLedger=false', ['M04-2', 'T14'], a => {
    const st = env.as(env.newStore(), 'SCM'); const snap = JSON.stringify(st.state); const v = st.model().byContract['CT-KR-001']; const r = sim(v, 5e6); a.eq(r.writesLedger, false); a.eq(JSON.stringify(st.state), snap);
  });
  t('M09', 'Simulator rejects zero, negative, fractional and NaN requests', ['M04-2', 'T03'], a => {
    const v = view(seedState(), 'CT-KR-001'); for (const x of [0, -1, 1.5, NaN, Infinity, '5']) a.eq(sim(v, x).ok, false, String(x)); a.eq(sim(v, 1).ok, true);
  });

  /* ---------------- ALERTS ---------------- */
  t('A01', 'Seed produces the expected Critical / High / Medium alerts', ['M06-1'], a => {
    const s = seedState(); const ids = id => view(s, id).alerts.map(x => x.ruleId + ':' + x.severity[0]);
    const k = ids('CT-JP-004'); for (const x of ['CLOSURE_CONFIRMED:C', 'RATING_DROP:H', 'REFUND_OVERDUE:H', 'EXPIRY_BEFORE_DEPLETION:H', 'LONG_UNCONSUMED:M']) a.includes(k, x);
    a.includes(ids('CT-VN-004'), 'REFUND_REFUSED:C'); a.includes(ids('CT-VN-004'), 'CONSUMPTION_COLLAPSE:H'); a.includes(ids('CT-JP-003'), 'RECON_MAJOR_MISMATCH:H'); a.includes(ids('CT-VN-002'), 'EXPIRY_BEFORE_DEPLETION:H'); a.includes(ids('CT-VN-002'), 'RENEWAL_DELAY:M');
    a.includes(ids('CT-VN-003'), 'RECON_UNCONFIRMED:M'); a.includes(ids('CT-KR-004'), 'SALES_DECLINE:M'); a.includes(ids('CT-JP-007'), 'ENTITY_UNKNOWN:M'); a.eq(ids('CT-KR-001').length, 0, 'healthy contract has none');
    const sev = Model.kpis(Model.compute(s).views).activeAlerts; a.ok(sev.CRITICAL >= 2 && sev.HIGH >= 5 && sev.MEDIUM >= 5);
  });
  t('A02', 'Refund-overdue: past due & unpaid → alert; paid in full or not yet due → none; partial payment keeps it', ['M06-1', 'T10'], a => {
    const mk = () => env.synth({ opening: 20e6, cons: [0, 0, 0], refund: { requested: true, requestedAt: '2026-09-20', requestedAmountMinor: 12e6, dueDate: '2026-10-20' } });
    const f = mk(); let v = f.view(); a.ok(v.derived.refundOverdue); a.eq(v.derived.refundOutstandingMinor, 12e6); const al = v.alerts.find(x => x.ruleId === 'REFUND_OVERDUE'); a.ok(al && al.severity === 'HIGH'); a.ok(v.rating.flags.some(x => x.id === 'REFUND_OVERDUE'));
    a.ok(Ledger.append(f.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'REFUND', amountMinor: 5e6, occurredAt: '2026-10-25T10:00:00+09:00', externalRef: 'rf1' }, f.cx).ok); v = f.view(); a.ok(v.derived.refundOverdue); a.eq(v.derived.refundOutstandingMinor, 7e6);
    a.ok(Ledger.append(f.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'REFUND', amountMinor: 7e6, occurredAt: '2026-10-30T10:00:00+09:00', externalRef: 'rf2' }, f.cx).ok); v = f.view(); a.ok(!v.derived.refundOverdue); a.ok(!v.alerts.some(x => x.ruleId === 'REFUND_OVERDUE'));
    const early = mk(); early.state.config.asOf = '2026-10-20'; a.ok(!early.view().derived.refundOverdue, 'due date itself is not overdue'); early.state.config.asOf = '2026-10-21'; a.ok(early.view().derived.refundOverdue, 'day after due is overdue');
  });
  t('A03', 'Consumption collapse triggers at exactly −50% and not at −49.9%', ['M06-1'], a => {
    const ids = c => env.synth({ cons: c }).view().alerts.map(x => x.ruleId);
    a.includes(ids([20e6, 20e6, 10e6]), 'CONSUMPTION_COLLAPSE'); a.ok(!ids([20e6, 20e6, 10.1e6]).includes('CONSUMPTION_COLLAPSE')); a.ok(ids([20e6, 20e6, 0]).includes('CONSUMPTION_COLLAPSE'));
  });
  t('A04', 'Alert severity/enable are configuration-driven', ['M06-2'], a => {
    const f = env.synth({ opening: 400e6 }); a.eq(f.view().alerts.find(x => x.ruleId === 'LONG_UNCONSUMED').severity, 'MEDIUM');
    f.state.config.alertRules.LONG_UNCONSUMED.severity = 'CRITICAL'; a.eq(f.view().alerts.find(x => x.ruleId === 'LONG_UNCONSUMED').severity, 'CRITICAL'); a.includes(f.view().limit.holdReasons, 'CRITICAL_ALERT_OPEN');
    f.state.config.alertRules.LONG_UNCONSUMED.enabled = false; a.ok(!f.view().alerts.some(x => x.ruleId === 'LONG_UNCONSUMED'));
    const g = env.synth({ cons: [20e6, 20e6, 15e6] }); a.ok(!g.view().alerts.some(x => x.ruleId === 'CONSUMPTION_COLLAPSE')); g.state.config.alertRules.CONSUMPTION_COLLAPSE.params.dropPct = 20; a.ok(g.view().alerts.some(x => x.ruleId === 'CONSUMPTION_COLLAPSE'), 'threshold is a parameter');
  });
  t('A05', 'Every alert carries hotel, title, detection date, evidence, action, SCM owner and status', ['M06-4'], a => {
    const m = Model.compute(seedState()); let n = 0;
    for (const v of m.views) for (const al of v.alerts) { n++; a.ok(al.hotelId && al.contractId && al.title.ko && al.title.en && al.detectedAt === '2026-11-06' && al.evidence.length > 0 && Config.ACTIONS.includes(al.action) && al.assignedScm && Alerts.STATUSES.includes(al.status) && Config.SEVERITIES.includes(al.severity), al.alertId); }
    a.ok(n >= 20);
  });
  t('A06', 'Alert persistence: stable IDs, status survives re-detection, auto-clear keeps history, recurrence reopens', ['M06-4', 'M06-1'], a => {
    const f = env.synth({ opening: 20e6, cons: [0, 0, 0], refund: { requested: true, requestedAt: '2026-09-20', requestedAmountMinor: 12e6, dueDate: '2026-10-20' } });
    const run = () => { const d = f.compute().views[0].alerts.map(x => { const { persisted, status, ...r } = x; return r; }); Alerts.merge(f.state.alerts, d, '2026-11-06'); };
    run(); const n1 = f.state.alerts.length; run(); a.eq(f.state.alerts.length, n1, 'idempotent / no duplicates');
    const row = f.state.alerts.find(x => x.alertId === 'REFUND_OVERDUE:CT-T'); row.status = 'IN_PROGRESS'; row.notes = [{ text: 'called hotel' }]; run(); a.eq(f.state.alerts.find(x => x.alertId === 'REFUND_OVERDUE:CT-T').status, 'IN_PROGRESS');
    Ledger.append(f.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'REFUND', amountMinor: 12e6, occurredAt: '2026-11-01T10:00:00+09:00', externalRef: 'full' }, f.cx); run();
    const cleared = f.state.alerts.find(x => x.alertId === 'REFUND_OVERDUE:CT-T'); a.ok(cleared.clearedAt && cleared.autoCleared && cleared.status === 'RESOLVED'); a.eq(cleared.notes.length, 1, 'history kept');
    a.ok(!Alerts.isActive(cleared)); a.ok(Alerts.isActive({ status: 'OPEN', clearedAt: null }));
  });
  t('A07', 'Rating drop ≥ 2 notches within 90 days raises a High alert; older history is ignored', ['M06-1'], a => {
    const v = view(seedState(), 'CT-JP-004'); a.eq(v.ratingDrop, 2); a.ok(v.alerts.some(x => x.ruleId === 'RATING_DROP' && x.severity === 'HIGH'));
    const one = view(seedState(), 'CT-KR-003'); a.eq(one.ratingDrop, 1); a.ok(!one.alerts.some(x => x.ruleId === 'RATING_DROP'));
    const old = env.synth({ facts: { counterpartyVerification: 'FAILED' }, history: [{ at: '2026-07-01', grade: 'A', score: 90 }] }).view(); a.eq(old.ratingDrop, 0, '128 days old -> ignored'); const fresh = env.synth({ facts: { counterpartyVerification: 'FAILED' }, history: [{ at: '2026-08-10', grade: 'A', score: 90 }] }).view(); a.eq(fresh.ratingDrop, 3); a.eq(Rating.dropNotches([{ at: '2026-08-08', grade: 'A' }], 'D', '2026-11-06', 90, Dates), 3);
  });
  t('A08', 'Balance-confirmation Medium alerts: never confirmed or stale', ['M06-1'], a => {
    a.ok(env.synth({}).view().alerts.some(x => x.ruleId === 'RECON_UNCONFIRMED')); a.ok(!env.synth({ conf: [100e6 - 90e6, '2026-10-31'] }).view().alerts.some(x => x.ruleId === 'RECON_UNCONFIRMED'));
    a.ok(env.synth({ conf: [10e6, '2026-09-21'] }).view().alerts.some(x => x.ruleId === 'RECON_UNCONFIRMED'), 'stale (46d)'); a.ok(!env.synth({ conf: [10e6, '2026-09-22'] }).view().alerts.some(x => x.ruleId === 'RECON_UNCONFIRMED'));
  });
  t('A09', 'Renewal delay (≤60 days to end, no renewal) and negative-balance High alert', ['M06-1'], a => {
    a.ok(env.synth({ endDate: '2027-01-05' }).view().alerts.some(x => x.ruleId === 'RENEWAL_DELAY')); a.ok(!env.synth({ endDate: '2027-01-06' }).view().alerts.some(x => x.ruleId === 'RENEWAL_DELAY'), '61 days');
    a.ok(!env.synth({ endDate: '2027-01-05', renewal: { newEnd: '2028-01-05' } }).view().alerts.some(x => x.ruleId === 'RENEWAL_DELAY'));
    const f = env.synth({ opening: 10e6, cons: [null, null, null] }); const r = Ledger.append(f.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'CONSUMPTION', amountMinor: 15e6, period: '2026-10', status: 'confirmed', occurredAt: '2026-10-31T23:00:00+09:00', externalRef: 'neg' }, f.cx);
    a.ok(r.ok); a.includes(r.warnings, 'W_NEGATIVE_BALANCE'); a.ok(f.view().alerts.some(x => x.ruleId === 'NEGATIVE_BALANCE' && x.severity === 'HIGH'));
  });

  /* ---------------- CSV ---------------- */
  const ctxOf = s => ({ contractsById: Object.fromEntries(s.contracts.map(c => [c.contractId, c])), txs: s.ledger, asOf: s.config.asOf });
  t('CS01', 'CSV parser: quotes, escaped quotes, embedded commas/newlines, CRLF, BOM; unterminated quote errors', ['D-2', 'T12'], a => {
    const g = Csv.parse('﻿a,b,c\r\n1,"x,y","he said ""hi"""\r\n"multi\nline",2,3\r\n'); a.deepEq(g, [['a', 'b', 'c'], ['1', 'x,y', 'he said "hi"'], ['multi\nline', '2', '3']]); a.throws(() => Csv.parse('a,b\n"oops,1'), 'E_CSV_QUOTE');
    a.deepEq(Csv.parse('a\n\n\nb'), [['a'], ['b']], 'blank lines skipped'); a.eq(Csv.cell('=1+1'), "'=1+1"); a.eq(Csv.cell('-5000'), '-5000'); a.eq(Csv.cell(-5000), '-5000'); a.eq(Csv.cell('@x'), "'@x"); a.eq(Csv.cell('a,b'), '"a,b"');
  });
  t('CS02', 'CSV validation: bad header, field count, currency, date, negative, unknown contract, long text, thousands separators', ['D-2', 'T12', 'T03'], a => {
    const s = seedState(); const V = txt => Csv.validateLedgerCsv(txt, ctxOf(s));
    a.includes(V('contractId,type,amount\nX,TOPUP,1').fatal[0].split(':')[0], 'E_CSV_HEADER_MISSING'); a.deepEq(V('').fatal, ['E_CSV_EMPTY']); a.includes(V('contractId,type\n').fatal[0], 'E_CSV_HEADER_MISSING');
    const H = 'contractId,type,amount,currency,occurredAt,period,status,reason,externalRef\n'; const row = (c, ty, am, cu, at, ref) => [c, ty, am, cu, at, '', '', '', ref].join(',') + '\n';
    const r = V(H + row('CT-KR-001', 'TOPUP', '1000', 'KRW', '2026-11-03T10:00:00+09:00', 'ok1') + row('CT-KR-001', 'TOPUP', '-1', 'KRW', '2026-11-03T10:00:00+09:00', 'neg') + row('CT-KR-001', 'TOPUP', '1', 'EUR', '2026-11-03T10:00:00+09:00', 'eur') + row('CT-KR-001', 'TOPUP', '1', 'KRW', 'yesterday', 'dt') +
      row('NOPE', 'TOPUP', '1', 'KRW', '2026-11-03T10:00:00+09:00', 'uc') + row('CT-JP-001', 'TOPUP', '1.5', 'JPY', '2026-11-03T10:00:00+09:00', 'dec') + row('CT-KR-001', 'TOPUP', '"1,000"', 'KRW', '2026-11-03T10:00:00+09:00', 'sep') + 'CT-KR-001,TOPUP,1\n' + row('CT-KR-001', 'TOPUP', '5', 'KRW', '2026-11-03T10:00:00+09:00', 'x'.repeat(300)));
    a.deepEq(r.rows.map(x => x.status), ['ACCEPT', 'REJECT', 'REJECT', 'REJECT', 'REJECT', 'REJECT', 'REJECT', 'REJECT', 'REJECT']);
    a.includes(r.rows[1].errors, 'E_AMOUNT_NEGATIVE'); a.includes(r.rows[2].errors, 'E_CURRENCY_UNSUPPORTED'); a.includes(r.rows[3].errors, 'E_DATETIME_INVALID'); a.includes(r.rows[4].errors, 'E_CONTRACT_UNKNOWN'); a.includes(r.rows[5].errors, 'E_AMOUNT_PRECISION'); a.includes(r.rows[6].errors, 'E_AMOUNT_INVALID'); a.includes(r.rows[7].errors, 'E_CSV_FIELD_COUNT'); a.ok(r.rows[8].errors.some(e => e.startsWith('E_FIELD_TOO_LONG')));
    a.deepEq(r.summary, { total: 9, accept: 1, reject: 8, duplicate: 0 }); a.eq(s.ledger.length, seedState().ledger.length, 'validation (dry-run) changed nothing');
  });
  t('CS03', 'Duplicates inside one file and re-uploading the same file are caught; nothing is double-counted', ['D-2', 'M02-4', 'T12', 'T02'], a => {
    const st = env.as(env.newStore(), 'SCM'); const csv = 'contractId,type,amount,currency,occurredAt,externalRef\nCT-KR-001,TOPUP,1000000,KRW,2026-11-03T10:00:00+09:00,R-1\nCT-KR-001,TOPUP,1000000,KRW,2026-11-03T10:00:00+09:00,R-1\nCT-KR-001,TOPUP,2000000,KRW,2026-11-03T11:00:00+09:00,R-2\n';
    const v = st.commands.validateCsv(csv); a.deepEq(v.rows.map(x => x.status), ['ACCEPT', 'DUPLICATE', 'ACCEPT']); const n0 = st.state.ledger.length; const bal0 = Model.compute(st.state).byContract['CT-KR-001'].balance.closingMinor;
    const r1 = st.commands.importCsv(csv, 'a.csv'); a.ok(r1.ok); a.eq(r1.committed, 2); a.eq(st.state.ledger.length, n0 + 2); a.eq(st.model().byContract['CT-KR-001'].balance.closingMinor, bal0 + 3e6);
    const r2 = st.commands.importCsv(csv, 'a-again.csv'); a.eq(r2.committed, 0); a.ok(r2.alreadyImported); a.eq(r2.summary.duplicate, 3); a.eq(st.state.ledger.length, n0 + 2); a.eq(st.model().byContract['CT-KR-001'].balance.closingMinor, bal0 + 3e6, 'second upload added nothing');
    const r3 = st.commands.importCsv(csv.replace('R-2', 'R-2 '), 'b.csv'); a.ok(r3.ok); a.eq(r3.committed, 0, 'trailing-space variant is trimmed and still duplicate');
    a.eq(st.state.importBatches.length, 3); a.ok(st.state.ledger.slice(-2).every(x => x.importBatchId === 'BATCH-0001' && x.source === 'CSV'));
  });
  t('CS04', 'CSV import: fatal errors leave ledger untouched; partial-bad files commit only valid rows', ['D-2', 'T12'], a => {
    const st = env.as(env.newStore(), 'SCM'); const n0 = st.state.ledger.length;
    const bad = st.commands.importCsv('foo,bar\n1,2\n', 'x.csv'); a.eq(bad.ok, false); a.eq(st.state.ledger.length, n0);
    const mixed = 'contractId,type,amount,currency,occurredAt,externalRef\nCT-KR-001,TOPUP,5,KRW,2026-11-03T10:00:00+09:00,M1\nCT-KR-001,TOPUP,-5,KRW,2026-11-03T10:00:00+09:00,M2\n'; const r = st.commands.importCsv(mixed, 'm.csv'); a.eq(r.committed, 1); a.eq(r.summary.reject, 1); a.eq(st.state.ledger.length, n0 + 1);
    env.as(st, 'VIEWER'); a.throws(() => st.commands.importCsv(mixed, 'v.csv'), 'E_FORBIDDEN'); a.throws(() => st.commands.validateCsv(mixed), 'E_FORBIDDEN');
  });
  t('CS05', 'CSV export neutralises spreadsheet formulas; sample ledger CSV round-trips through the validator', ['D-2'], a => {
    const out = Csv.toCSV(['a', 'b'], [{ a: '=HYPERLINK("x")', b: '+cmd' }, { a: 'plain', b: -12 }]); a.ok(out.includes("'=HYPERLINK") && out.includes("'+cmd") && out.includes(',-12'));
    const s = seedState(); const rows = Ledger.statement(s.ledger, 'CT-KR-001').map(t2 => ({ txId: '', contractId: t2.contractId, type: t2.type, amount: t2.amountMinor, currency: t2.currency, occurredAt: t2.occurredAt, period: t2.period || '', status: t2.status || '', reason: '', externalRef: t2.externalRef + '-rt' }));
    const csv = Csv.toCSV(['txId', 'contractId', 'type', 'amount', 'currency', 'occurredAt', 'period', 'status', 'reason', 'externalRef'], rows.filter(r => r.type !== 'OPENING')); const v = Csv.validateLedgerCsv(csv, ctxOf(s)); a.eq(v.summary.reject, 0); a.eq(v.summary.accept, rows.length - 1);
  });

  /* ---------------- COMMON ENGINE PARITY ---------------- */
  t('X12', 'Common weighted engine reproduces legacy compute() score and grade bit-for-bit on all 12 partners', ['R-3', 'T13'], a => {
    if (!require('fs').existsSync(require('path').join(env.root, 'legacy', 'app.js'))) a.skip('the legacy partner module is not part of this repository');
    const { loadLegacy } = require('./helpers/legacy_loader'); const { api } = loadLegacy(); const D = api.getData(); a.eq(D.companies.length, 12);
    for (const c of D.companies) { const r = api.compute(c); const items = c.scores.map((sc, i) => ({ score: sc, weight: D.settings.weights[i] })); const w = Weighted.weightedScore(items, 5);
      a.eq(w.score, r.weighted, c.id); const th = [['A', 85], ['B', 70], ['C', 55], ['D', 40]]; a.eq(Weighted.gradeFor(w.score, th, 'E'), r.scoreGrade, c.id); }
  });
};
