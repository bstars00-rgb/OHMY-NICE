'use strict';
const { createStore } = require('../js/store.js'); const Money = require('../js/core/money.js');
const st = createStore({}); const m = st.model();
for (const v of m.views) {
  const f = v.forecast, L = v.limit;
  console.log([v.contractId, v.rating.grade, v.rating.score, v.rating.confidence.pct + '%', Money.format(v.balance.closingMinor, v.currency), 'avg=' + (f.avgMinor == null ? '-' : Money.format(f.avgMinor, v.currency)), f.status, f.depletionDate || '-',
    'lim=' + (L.recommendedLimitMinor == null ? 'NA' : Money.format(L.recommendedLimitMinor, v.currency)), 'avail=' + Money.format(L.availableTopupMinor, v.currency), 'hold=' + L.holdReasons.join('/'), 'rec=' + v.recon.status,
    v.recoverability.tier, '|', v.liveAlerts.map(a => a.severity[0] + ':' + a.ruleId).join(',')].join('  '));
}
console.log(JSON.stringify(require('../js/engine/model.js').kpis(m.views).grades), st.verifyAudit());
