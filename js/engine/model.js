/* Derived view-model assembly. PURE: state in -> numbers out. Nothing derived is ever stored, so reload/refresh is reproducible. */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const dep = typeof require === 'function'
    ? { Money: require('../core/money.js'), Dates: require('../core/dates.js'), Ledger: require('./ledger.js'), Forecast: require('./forecast.js'), Rating: require('./rating.js'), Limit: require('./limit.js'), Alerts: require('./alerts.js'), Ellis: require('../adapters/ellis.js'), Outlook: require('./outlook.js') }
    : { Money: NS.Money, Dates: NS.Dates, Ledger: NS.Ledger, Forecast: NS.Forecast, Rating: NS.Rating, Limit: NS.Limit, Alerts: NS.Alerts, Ellis: NS.Ellis, Outlook: NS.Outlook };
  const api = factory(dep);
  NS.Model = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Money, Dates, Ledger, Forecast, Rating, Limit, Alerts, Ellis, Outlook } = dep;

  function latestConfirmation(state, contractId) {
    let best = null;
    for (const c of state.confirmations || []) if (c.contractId === contractId && (!best || c.confirmedAt >= best.confirmedAt)) best = c;
    return best;
  }

  /** Next scheduled credit check (CEO request: monthly, plus a light daily check). Regular check = the 1st of next month; a D / NR grade or a live CRITICAL / HIGH alert is looked at again within 7 days.
   *  Provisional: the intervals are not CEO-approved. Pure: the date follows from the as-of date, the grade and the live alerts only. */
  const WATCH_DAYS = 7;
  function nextCheck(grade, liveAlerts, asOf) {
    const regular = Dates.addMonths(Dates.monthKey(asOf), 1) + '-01';
    const watch = grade === 'D' || grade === 'NR' || (liveAlerts || []).some(a => a.severity === 'CRITICAL' || a.severity === 'HIGH');
    const soon = Dates.addDays(asOf, WATCH_DAYS);
    return watch && Dates.cmp(soon, regular) < 0 ? { date: soon, kind: 'WATCH' } : { date: regular, kind: 'MONTHLY' };
  }

  function contractView(state, contract, pre) {
    const cfg = state.config, asOf = cfg.asOf; const hotel = pre.hotelsById[contract.hotelId];
    const own = pre.txsBy ? (pre.txsBy.get(contract.contractId) || []) : state.ledger;            // this contract's rows only
    const balance = Ledger.balance(own, contract.contractId);
    const conf = latestConfirmation(state, contract.contractId);
    // Compare like with like: our ledger AS OF the hotel's confirmation date, not today's balance (later postings are legitimate).
    const ledgerAt = conf ? Ledger.balance(own, contract.contractId, conf.confirmedAt).closingMinor : balance.closingMinor;
    const recon = Ledger.reconcile(ledgerAt, contract.currency, conf, cfg, asOf); recon.ledgerAtMinor = ledgerAt;
    const f = Forecast.forecast({ txs: own, contract, balanceMinor: balance.closingMinor, sales: (state.sales || {})[contract.contractId], asOf, cfg });
    // refund tracking (received amount is derived from REFUND ledger rows on/after the request date)
    const rf = contract.refund || {}; let refundReceived = 0;
    if (rf.requested) for (const t of own) if (t.type === 'REFUND' && Dates.cmp(t.occurredAt, rf.requestedAt) >= 0) refundReceived += t.amountMinor;
    const refundOutstanding = rf.requested ? Math.max(0, (rf.requestedAmountMinor || 0) - refundReceived) : 0;
    const refundOverdue = !!(rf.requested && refundOutstanding > 0 && rf.dueDate && Dates.cmp(rf.dueDate, asOf) < 0);
    const ccRule = cfg.alertRules.CONSUMPTION_COLLAPSE;
    const derived = {
      refundOverdue, refundOutstandingMinor: refundOutstanding, refundPending: !!(rf.requested && refundOutstanding > 0),
      reconMajor: recon.status === 'MAJOR' || recon.status === 'CURRENCY_MISMATCH',
      consumptionCollapse: !!(f.velocity && f.velocity.pct != null && f.velocity.pct <= -(ccRule && ccRule.params ? ccRule.params.dropPct : 50)),
      expiryBeforeDepletion: f.depletesBeforeEnd === false && balance.closingMinor > 0 && !!contract.endDate,
    };
    const rec = (state.ratings || {})[contract.contractId] || { history: [] };
    const auto = Rating.autoScores({ contract, hotel, balance, forecast: f, recon, derived, cfg });                  // nobody enters these: they follow from the data
    const rating = Rating.evaluate({ scores: auto.scores, hotel, contract, derived, cfg });
    const ratingDrop = Rating.dropNotches(rec.history, rating.grade, asOf, (cfg.alertRules.RATING_DROP.params || {}).windowDays || 90, Dates);
    const recov = Rating.recoverability(contract, balance.closingMinor, rating, auto.scores);
    const detected = Alerts.detect({ hotel, contract, balance, recon, forecast: f, rating, derived, ratingDrop, asOf, cfg });
    const persisted = {}; for (const p of state.alerts || []) persisted[p.alertId] = p;
    const alerts = detected.map(d => Object.assign({}, d, { status: persisted[d.alertId] ? persisted[d.alertId].status : 'OPEN', persisted: persisted[d.alertId] || null }));
    const live = alerts.filter(a => a.status !== 'DISMISSED');
    const limit = Limit.compute({ grade: rating.grade, forecast: f, outstandingMinor: balance.closingMinor, contract, recoverability: recov, alerts: live, cfg, ratingFlags: rating.flags.map(x => x.id) });
    const pt = contract.plannedTopUp; const plannedSim = pt && Number.isSafeInteger(pt.amountMinor) && pt.amountMinor > 0 ? Limit.simulate(limit, f, pt.amountMinor, contract, { daysPerMonth: cfg.forecast.daysPerMonth, addDays: Dates.addDays, asOf }) : null;   // the tracker's planned top-up, checked against the limit
    const ellisOutlook = Ellis.outlook(state, contract.contractId, { cmp: pre.ellisCmp });                                  // what the ELLIS bookings say about the consumption speed (indicator, never written to the ledger)
    const topupPlan = Outlook.topupPlan({ forecast: f, limit, contract, balance }, ellisOutlook, cfg, asOf);              // section 7: when the next top-up has to be requested
    const relationship = Outlook.relationship({ rating, forecast: f, limit, contract, balance, derived });               // section 8: should the cooperation go on (a recommendation for the CEO)
    return { contractId: contract.contractId, hotelId: contract.hotelId, hotel, contract, balance, recon, forecast: f, derived, rating, ratingScores: auto.scores, ratingBasis: auto.basis, ratingRecord: rec, ratingDrop, recoverability: recov,
      alerts, liveAlerts: live, limit, plannedSim, nextCheck: nextCheck(rating.grade, live, asOf), ellisOutlook, topupPlan, relationship, currency: contract.currency };
  }

  /** Compute every contract view. */
  function compute(state) {
    const pre = { hotelsById: {}, txsBy: new Map(), ellisCmp: Ellis.compare(state) }; for (const h of state.hotels) pre.hotelsById[h.hotelId] = h;   // one ELLIS comparison for all contracts
    for (const t of state.ledger) { let a = pre.txsBy.get(t.contractId); if (!a) pre.txsBy.set(t.contractId, a = []); a.push(t); }
    const views = state.contracts.map(c => contractView(state, c, pre));
    const byContract = Object.create(null); for (const v of views) byContract[v.contractId] = v;      // null prototype: '__proto__' etc. can never resolve
    return { asOf: state.config.asOf, views, byContract, hotelsById: pre.hotelsById };
  }

  const SEV_ACTIVE = ['CRITICAL', 'HIGH'];
  function isHighRisk(v) { return v.rating.grade === 'D' || v.rating.grade === 'NR' || v.liveAlerts.some(a => SEV_ACTIVE.includes(a.severity)); }

  /** Portfolio KPIs. filter: {country, entity, currency, type}. Amounts are grouped per currency — NEVER summed across currencies. */
  function kpis(views, filter) {
    const f = filter || {};
    const vs = views.filter(v => (!f.country || v.hotel.country === f.country) && (!f.entity || v.contract.omhEntity === f.entity) &&
      (!f.currency || v.currency === f.currency) && (!f.type || v.contract.prepaymentType === f.type));
    const sumBy = (keyFn, valFn) => { const o = {}; for (const v of vs) { const val = valFn(v); if (val == null) continue; const k = keyFn(v); o[k] = o[k] || {}; o[k][v.currency] = (o[k][v.currency] || 0) + val; } return o; };
    const grades = { A: 0, B: 0, C: 0, D: 0, NR: 0 }; for (const v of vs) grades[v.rating.grade]++;
    const hotelsHigh = new Set(vs.filter(isHighRisk).map(v => v.hotelId));
    const GRADE_RANK = { A: 0, B: 1, C: 2, NR: 3, D: 4 };                                       // a hotel is counted once, at the lowest grade among its contracts (unrated counts as worse than C)
    const worst = new Map(); for (const v of vs) { const cur = worst.get(v.hotelId); if (cur === undefined || GRADE_RANK[v.rating.grade] > GRADE_RANK[cur]) worst.set(v.hotelId, v.rating.grade); }
    const hotelGrades = { A: 0, B: 0, C: 0, D: 0, NR: 0 }; for (const g of worst.values()) hotelGrades[g]++;
    const unusedKnown = vs.filter(v => v.forecast.estimatedUnusedAtEndMinor != null);
    return {
      count: vs.length, hotels: new Set(vs.map(v => v.hotelId)).size,
      exposure: Money.sumByCurrency(vs.map(v => ({ currency: v.currency, minor: v.balance.closingMinor }))),
      byCountry: sumBy(v => v.hotel.country, v => v.balance.closingMinor), byEntity: sumBy(v => v.contract.omhEntity, v => v.balance.closingMinor),
      byType: sumBy(v => v.contract.prepaymentType, v => v.balance.closingMinor),
      grades, hotelGrades, highRiskHotels: [...hotelsHigh], limitExceeded: vs.filter(v => v.limit.overLimitMinor > 0).map(v => v.contractId),
      limitUnknown: vs.filter(v => v.limit.recommendedLimitMinor == null && v.balance.closingMinor > 0 && v.forecast.status !== 'NOT_APPLICABLE').map(v => v.contractId),
      refundPending: vs.filter(v => v.derived.refundPending).map(v => v.contractId),
      refundPendingAmount: Money.sumByCurrency(vs.filter(v => v.derived.refundPending).map(v => ({ currency: v.currency, minor: v.derived.refundOutstandingMinor }))),
      estimatedUnused: Money.sumByCurrency(unusedKnown.map(v => ({ currency: v.currency, minor: v.forecast.estimatedUnusedAtEndMinor }))),
      estimatedUnusedUnknown: vs.filter(v => v.forecast.estimatedUnusedAtEndMinor == null && v.balance.closingMinor > 0).length,
      activeAlerts: { CRITICAL: vs.reduce((a, v) => a + v.liveAlerts.filter(x => x.severity === 'CRITICAL').length, 0), HIGH: vs.reduce((a, v) => a + v.liveAlerts.filter(x => x.severity === 'HIGH').length, 0),
        MEDIUM: vs.reduce((a, v) => a + v.liveAlerts.filter(x => x.severity === 'MEDIUM').length, 0) },
    };
  }
  return { latestConfirmation, contractView, compute, kpis, isHighRisk, nextCheck, WATCH_DAYS };
});
