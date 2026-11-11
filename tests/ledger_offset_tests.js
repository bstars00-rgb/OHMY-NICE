'use strict';
// Offset ledger type (money deducted against the hotel's invoices) and the top-up terms carried on a contract (condition, minimum, planned top-up, allotment).
const env = require('./helpers/env');
const { Ledger, Forecast, Csv, Model, Adapters } = env;

module.exports = function (h) {
  const { test: t } = h;
  const off = (o) => Object.assign({ contractId: 'CT-T', currency: 'KRW', type: 'OFFSET', amountMinor: 10e6, occurredAt: '2026-11-02T10:00:00+09:00', reason: 'against the October invoice', externalRef: 'INV-1' }, o || {});

  t('LO01', 'an offset reduces the balance, needs a reason, cannot exceed the balance, and keeps the identity', ['LEDGER-OFFSET'], a => {
    const f = env.synth({ opening: 200e6 }); const b0 = Ledger.balance(f.state.ledger, 'CT-T').closingMinor;
    const r = Ledger.append(f.state.ledger, off(), f.cx); a.ok(r.ok, String(r.errors)); const b = Ledger.balance(f.state.ledger, 'CT-T');
    a.eq(b.offsetsMinor, 10e6); a.eq(b.refundsMinor, 0, 'not a refund'); a.eq(b.closingMinor, b0 - 10e6); a.eq(b.closingMinor, b.openingMinor + b.topupsMinor - b.consumptionMinor - b.refundsMinor - b.offsetsMinor + b.adjustmentsMinor);
    a.ok(Ledger.verifyIdentity(f.state.ledger, 'CT-T').ok); const st = Ledger.statement(f.state.ledger, 'CT-T'); const row = st.find(x => x.type === 'OFFSET'); a.eq(row.deltaMinor, -10e6); a.eq(st[st.length - 1].runningMinor, b.closingMinor);
    const f2 = env.synth(); for (const [label, tx, code] of [['no reason', off({ reason: '' }), 'E_OFFSET_REASON_REQUIRED'], ['blank reason', off({ reason: '   ' }), 'E_OFFSET_REASON_REQUIRED'], ['zero', off({ amountMinor: 0 }), 'E_AMOUNT_INVALID'], ['negative', off({ amountMinor: -5 }), 'E_AMOUNT_NEGATIVE'],
      ['above the balance', off({ amountMinor: 1e12, externalRef: 'X' }), 'E_OFFSET_EXCEEDS_BALANCE'], ['wrong currency', off({ currency: 'JPY' }), 'E_CURRENCY_MISMATCH'], ['future', off({ occurredAt: '2027-01-01T10:00:00+09:00' }), 'E_FUTURE_DATE']]) {
      const x = Ledger.append(f2.state.ledger, tx, f2.cx); a.ok(!x.ok && x.errors.includes(code), label + ' ' + x.errors);
    }
    a.eq(Ledger.balance(f2.state.ledger, 'CT-T').offsetsMinor, 0, 'nothing was posted by the refused rows');
    const dup = Ledger.append(f.state.ledger, off(), f.cx); a.ok(!dup.ok && dup.errors.includes('E_DUPLICATE_KEY'), 'the same offset twice is a duplicate'); a.ok(Ledger.append(f.state.ledger, off({ externalRef: 'INV-2' }), f.cx).ok, 'a different reference is a different offset');
    a.ok(Ledger.TYPES.includes('OFFSET'));
  });

  t('LO02', 'an offset is not consumption: forecast, average usage and refund tracking ignore it', ['LEDGER-OFFSET'], a => {
    const f = env.synth({ cons: [30e6, 30e6, 30e6], opening: 200e6 }); const before = Model.compute(f.state).views[0]; a.ok(Ledger.append(f.state.ledger, off({ amountMinor: 20e6 }), f.cx).ok); const after = Model.compute(f.state).views[0];
    a.eq(after.forecast.avgMinor, before.forecast.avgMinor, 'average consumption unchanged'); a.deepEq(Forecast.consumptionSeries(f.state.ledger, 'CT-T', f.cfg.asOf, 3).map(x => x.amountMinor), [30e6, 30e6, 30e6]);
    a.eq(after.balance.closingMinor, before.balance.closingMinor - 20e6); a.eq(after.derived.refundOutstandingMinor, before.derived.refundOutstandingMinor); a.ok(after.forecast.daysToDepletion < before.forecast.daysToDepletion, 'less balance, earlier depletion');
    const g = env.synth({ refund: { requested: true, requestedAt: '2026-10-01', requestedAmountMinor: 50e6, dueDate: '2026-12-01' } }); Ledger.append(g.state.ledger, off({ amountMinor: 50e6, occurredAt: '2026-10-15T10:00:00+09:00' }), g.cx);
    a.eq(Model.compute(g.state).views[0].derived.refundOutstandingMinor, 50e6, 'an offset does not count as the refund that was requested');
  });

  t('LO03', 'CSV import and the store accept offsets with the same rules, and permissions are those of ledger entry', ['LEDGER-OFFSET', 'D-4'], a => {
    const f = env.synth(); const csv = 'contractId,type,amount,currency,occurredAt,reason,externalRef\r\nCT-T,OFFSET,5000000,KRW,2026-11-01T10:00:00+09:00,against invoice,INV-9\r\nCT-T,OFFSET,5000000,KRW,2026-11-01T10:00:00+09:00,,INV-10\r\nCT-T,OFFSET,5000000,KRW,2026-11-01T10:00:00+09:00,against invoice,INV-9\r\n';
    const v = Csv.validateLedgerCsv(csv, { contractsById: { 'CT-T': f.contract }, txs: f.state.ledger, asOf: '2026-11-06' }); a.deepEq(v.rows.map(x => x.status), ['ACCEPT', 'REJECT', 'DUPLICATE']); a.includes(v.rows[1].errors, 'E_OFFSET_REASON_REQUIRED');
    // the running balance used for a whole file includes offsets: a second offset after one that used the whole balance is refused
    const g = env.synth(); const bal = Ledger.balance(g.state.ledger, 'CT-T').closingMinor; const NL = '\r\n'; const head = 'contractId,type,amount,currency,occurredAt,reason,externalRef' + NL;
    const v2 = Csv.validateLedgerCsv(head + 'CT-T,OFFSET,' + bal + ',KRW,2026-11-01T10:00:00+09:00,all of it,A1' + NL + 'CT-T,OFFSET,1,KRW,2026-11-01T11:00:00+09:00,one more,A2' + NL + 'CT-T,REFUND,1,KRW,2026-11-01T12:00:00+09:00,,A3' + NL,
      { contractsById: { 'CT-T': g.contract }, txs: g.state.ledger, asOf: '2026-11-06' });
    a.deepEq(v2.rows.map(x => x.status), ['ACCEPT', 'REJECT', 'REJECT']); a.includes(v2.rows[1].errors, 'E_OFFSET_EXCEEDS_BALANCE'); a.includes(v2.rows[2].errors, 'E_REFUND_EXCEEDS_BALANCE', 'a refund after the offset sees the reduced balance');
    const st = env.as(env.newStore(), 'SCM'); const r = st.commands.addTx({ contractId: 'CT-KR-001', type: 'OFFSET', amountMinor: 1e6, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00', reason: 'against invoice', externalRef: 'T-OFF' }); a.ok(r.ok);
    a.eq(st.model().byContract['CT-KR-001'].balance.offsetsMinor, 1e6); st.reload(); a.eq(st.loadStatus, 'OK', 'a stored state with an offset reloads cleanly');
    for (const role of ['VIEWER', 'CEO']) a.throws(() => env.as(env.newStore(), role).commands.addTx({ contractId: 'CT-KR-001', type: 'OFFSET', amountMinor: 1e6, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00', reason: 'x' }), 'E_FORBIDDEN');
  });

  t('LO04', 'planned top-up: checked against the limit on the view, carried into the approval packet, never written to the ledger', ['TOPUP-TERMS', 'M04-2'], a => {
    const f = env.synth({ cons: [30e6, 30e6, 30e6], opening: 100e6 }); const c = f.contract;
    c.topUp = { conditionText: 'Top up when balance < 1 month of usage', minAmountMinor: 10e6 }; c.allotment = '10 rooms/night';
    c.plannedTopUp = { amountMinor: 1e6, date: '2026-11-20' }; let v = Model.compute(f.state).views[0]; a.ok(v.plannedSim.ok); a.eq(v.plannedSim.requestedMinor, 1e6); a.eq(v.plannedSim.projectedMinor, v.balance.closingMinor + 1e6);
    c.plannedTopUp = { amountMinor: 900e6, date: '2026-11-20' }; v = Model.compute(f.state).views[0]; a.ok(v.plannedSim.limitExceeded && v.plannedSim.approvalRequired, 'a large planned top-up needs approval');
    for (const bad of [null, undefined, { amountMinor: 0 }, { amountMinor: -5 }, { amountMinor: '5' }, { amountMinor: 1.5 }, {}]) { c.plannedTopUp = bad; a.eq(Model.compute(f.state).views[0].plannedSim, null, JSON.stringify(bad)); }
    c.plannedTopUp = { amountMinor: 5e6, date: '2026-11-20' }; const ledgerBefore = JSON.stringify(f.state.ledger); v = Model.compute(f.state).views[0]; a.eq(JSON.stringify(f.state.ledger), ledgerBefore, 'no ledger row from a plan');
    const sim = require(env.root + '/js/engine/limit.js').simulate(v.limit, v.forecast, 5e6, c, { daysPerMonth: 30, addDays: env.Dates.addDays, asOf: f.cfg.asOf }); const pk = Adapters.Portal.buildPacket(v, sim, { asOf: f.cfg.asOf });
    a.eq(pk.contract.topUpCondition, 'Top up when balance < 1 month of usage'); a.eq(pk.contract.minTopUpMinor, 10e6); a.deepEq(pk.contract.plannedTopUp, { amountMinor: 5e6, date: '2026-11-20' }); a.eq(pk.contract.allotment, '10 rooms/night');
    delete c.topUp; delete c.plannedTopUp; delete c.allotment; const pk2 = Adapters.Portal.buildPacket(Model.compute(f.state).views[0], sim, { asOf: f.cfg.asOf }); a.eq(pk2.contract.topUpCondition, null); a.eq(pk2.contract.plannedTopUp, null); a.ok(pk2.fingerprint !== pk.fingerprint);
    const seed = env.newStore().state; const vn1 = seed.contracts.find(x => x.contractId === 'CT-VN-001'); a.ok(vn1.topUp && vn1.plannedTopUp && vn1.allotment, 'the sample carries top-up terms'); a.ok(seed.contracts.filter(x => x.topUp).length >= 4);
  });
};
