/* Consumption forecast. Only CONFIRMED check-in-basis consumption drives depletion; booking-date sales are shown for trend only.
   A month with no confirmed record is MISSING (unknown) — it is never silently treated as zero.                                  */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Money: require('../core/money.js'), Dates: require('../core/dates.js') } : { Money: NS.Money, Dates: NS.Dates });
  NS.Forecast = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Money, Dates } = dep;

  /** Trailing n completed calendar months (before asOf's month). */
  function consumptionSeries(txs, contractId, asOf, n) {
    const months = Dates.prevMonths(asOf, n);
    return months.map(m => {
      let conf = 0, hasConf = false, pend = 0;
      for (const t of txs) {
        if (t.contractId !== contractId || t.type !== 'CONSUMPTION' || t.period !== m) continue;
        if (t.status === 'confirmed') { conf += t.amountMinor; hasConf = true; } else pend += t.amountMinor;
      }
      return { month: m, amountMinor: hasConf ? conf : null, pendingMinor: pend, status: hasConf ? 'CONFIRMED' : (pend > 0 ? 'PENDING_ONLY' : 'MISSING') };
    });
  }

  function averageMonthly(series) {
    const known = series.filter(s => s.amountMinor != null);
    const sum = known.reduce((a, s) => a + s.amountMinor, 0);
    const quality = known.length === 0 ? 'NONE' : known.length === series.length ? 'COMPLETE' : 'PARTIAL';
    return { avgMinor: known.length ? Number(BigInt(sum) / BigInt(known.length)) : null, sumMinor: sum, n: known.length, quality };
  }

  /** latest completed month vs mean of the two preceding months. null when any needed month is not confirmed or base is 0. */
  function velocity(series) {
    if (series.length < 3) return { pct: null, status: 'UNKNOWN' };
    const l = series[series.length - 1], a = series[series.length - 2], b = series[series.length - 3];
    if (l.amountMinor == null || a.amountMinor == null || b.amountMinor == null) return { pct: null, status: 'UNKNOWN' };
    const base = (a.amountMinor + b.amountMinor) / 2;
    if (base === 0) return { pct: null, status: 'NO_BASE' };
    const pct = (l.amountMinor - base) / base * 100;
    return { pct: Math.round(pct * 10) / 10, status: pct <= -0.0001 ? 'DOWN' : pct >= 0.0001 ? 'UP' : 'FLAT', latestMinor: l.amountMinor, baseMinor: base };
  }

  /** Booking-date sales trend (reference only — never used for depletion). sales: [{month, amountMinor}] */
  function salesTrend(sales, asOf, n) {
    const months = Dates.prevMonths(asOf, n || 3);
    const vals = months.map(m => { const s = (sales || []).find(x => x.month === m); return s ? s.amountMinor : null; });
    if (vals.length < 3 || vals.some(v => v == null)) return { pct: null, status: 'UNKNOWN', months, values: vals };
    const base = (vals[vals.length - 2] + vals[vals.length - 3]) / 2;
    if (base === 0) return { pct: null, status: 'NO_BASE', months, values: vals };
    const pct = (vals[vals.length - 1] - base) / base * 100;
    return { pct: Math.round(pct * 10) / 10, status: pct < 0 ? 'DOWN' : 'UP', months, values: vals };
  }

  /** input: { txs, contract, balanceMinor, sales, asOf, cfg } */
  function forecast(input) {
    const { txs, contract, balanceMinor, sales, asOf, cfg } = input;
    const dpm = cfg.forecast.daysPerMonth;
    const series = consumptionSeries(txs, contract.contractId, asOf, cfg.forecast.windowMonths);
    const avg = averageMonthly(series); const vel = velocity(series); const st = salesTrend(sales, asOf, 3);
    const out = { series, avgMinor: avg.avgMinor, quality: avg.quality, confirmedMonths: avg.n, velocity: vel, salesTrend: st, balanceMinor, currency: contract.currency,
      status: null, depletionDate: null, daysToDepletion: null, monthsOfCover: null, longUnconsumed: false,
      contractEnd: contract.endDate || null, daysToEnd: null, monthsToEnd: null, depletesBeforeEnd: null, estimatedUnusedAtEndMinor: null, expired: false };
    const end = contract.endDate;
    if (contract.prepaymentType === 'SECURITY_DEPOSIT' || contract.monthlySettlement === true) { out.status = 'NOT_APPLICABLE'; return out; }   // deposits are held, not consumed; a hard block paid and settled month by month has no balance to consume
    if (end) { out.daysToEnd = Dates.diffDays(asOf, end); out.expired = out.daysToEnd < 0; out.monthsToEnd = Math.max(0, Math.round(Dates.diffDays(asOf, end) / dpm * 10) / 10); }
    if (balanceMinor <= 0) { out.status = 'DEPLETED'; out.depletesBeforeEnd = true; out.estimatedUnusedAtEndMinor = 0; return out; }
    if (avg.quality === 'NONE') { out.status = 'NO_DATA'; return out; }               // 소진 실적 데이터 없음 — 예측 불가
    if (avg.avgMinor === 0 && avg.quality === 'PARTIAL') {                           // some months unknown: a firm "zero" cannot be asserted
      out.status = 'UNCERTAIN_ZERO'; return out;
    }
    if (avg.avgMinor === 0) {                                                        // 확정 소진 0 — 예측 불가 (임의 산출 금지)
      out.status = 'NO_CONSUMPTION'; out.longUnconsumed = true; out.depletesBeforeEnd = false; out.estimatedUnusedAtEndMinor = balanceMinor; return out;
    }
    out.status = avg.quality === 'PARTIAL' ? 'PARTIAL' : 'OK';
    const days = Money.ceilDiv(BigInt(balanceMinor) * BigInt(dpm), avg.avgMinor);    // ceil(balance / avg * dpm)
    out.daysToDepletion = days; out.beyondHorizon = days > 36500;                      // > 100 years: no date is shown (and no overflowed 'NaN' date)
    out.depletionDate = out.beyondHorizon ? null : Dates.addDays(asOf, days); out.monthsOfCover = Math.round(balanceMinor / avg.avgMinor * 10) / 10;
    out.longUnconsumed = out.monthsOfCover > cfg.forecast.longUnconsumedMonths;
    if (end) {
      out.depletesBeforeEnd = !out.expired && out.depletionDate !== null && Dates.cmp(out.depletionDate, end) <= 0;
      const dEnd = Math.max(0, Dates.diffDays(asOf, end));
      const consumable = Number((BigInt(avg.avgMinor) * BigInt(dEnd)) / BigInt(dpm));
      out.estimatedUnusedAtEndMinor = Math.max(0, balanceMinor - consumable);
    }
    return out;
  }

  return { consumptionSeries, averageMonthly, velocity, salesTrend, forecast };
});
