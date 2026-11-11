'use strict';
// Loads every prototype module (Node) and provides fixtures for the tests.
const path = require('path');
const R = p => require(path.join(__dirname, '../../js', p));
const env = {};
env.Dates = R('core/dates.js'); env.Money = R('core/money.js'); env.Config = R('core/config.js'); env.RBAC = R('core/rbac.js'); env.Auth = R('core/auth.js');
env.Weighted = R('engine/weighted.js'); env.Rating = R('engine/rating.js'); env.Ledger = R('engine/ledger.js'); env.Forecast = R('engine/forecast.js');
env.Limit = R('engine/limit.js'); env.Alerts = R('engine/alerts.js'); env.Csv = R('engine/csv.js'); env.Model = R('engine/model.js'); env.Outlook = R('engine/outlook.js');
env.Tracker = R('engine/tracker.js'); env.Adapters = R('adapters/adapters.js'); env.Ellis = R('adapters/ellis.js'); env.Seed = R('data/seed.js'); env.Store = R('store.js');
env.I18N_ja = R('i18n/ja.js'); env.I18N_vi = R('i18n/vi.js'); env.UI = R('ui/common.js'); env.ViewsA = R('ui/views_a.js'); env.ViewsB = R('ui/views_b.js'); env.ViewsC = R('ui/views_c.js'); env.ViewsAuth = R('ui/views_auth.js');
env.root = path.join(__dirname, '../..');

const clone = o => JSON.parse(JSON.stringify(o));
env.clone = clone;
env.newStore = (opts) => env.Store.createStore(Object.assign({ storage: env.Store.memoryStorage(), now: () => '2026-11-06T09:00:00.000Z' }, opts || {}));
env.as = (st, role) => { st.setSession('test.' + role.toLowerCase(), role); return st; };

/** Single synthetic contract state for boundary tests. cons = [Aug, Sep, Oct] confirmed (null = no record). */
env.synth = function (o) {
  o = Object.assign({ ccy: 'KRW', cons: [30e6, 30e6, 30e6], opening: 100e6, topups: [], endDate: '2030-12-31', refundable: true, transfer: false, collateral: 0, strictCoverage: false,
    asOf: '2026-11-06', facts: {}, hotelFacts: {}, conf: null, type: 'FLOATING', entity: 'OMH-KR', history: [], refund: null, renewal: null }, o || {});
  const { Config, Ledger, Rating, Model } = env; const cfg = Config.defaults(); cfg.asOf = o.asOf;
  if (!o.strictCoverage) { cfg.minCoverage = 0.3; cfg.lowConfidenceCoverage = 0.4; }      // the synthetic contract has no outside information; the coverage rules are tested on their own (R05)
  const hotel = { hotelId: 'HT', ellisHotelId: 'E-T', name: { ko: '테스트', en: 'Test' }, country: 'KR', city: { ko: '서울', en: 'Seoul' }, operatingCompany: 'T Co', owner: null, status: 'ACTIVE', assignedScm: 'SCM-T', lastVerifiedDate: '2026-10-01', facts: Object.assign({ closure: null, ownershipChange: 'NONE' }, o.hotelFacts), isSample: true };
  const contract = { contractId: 'CT-T', hotelId: 'HT', omhEntity: o.entity, counterparty: { legalName: 'T Co', bizRegNo: 'X' }, prepaymentType: o.type, currency: o.ccy, startDate: '2025-01-01', endDate: o.endDate, assignedScm: 'SCM-T',
    refund: Object.assign({ refundable: o.refundable, requested: false }, o.refund || {}), transfer: { eligible: o.transfer }, collateral: o.collateral ? { type: 'BG', amountMinor: o.collateral, currency: o.ccy, verified: true } : null,
    renewal: o.renewal, facts: Object.assign({ counterpartyVerification: 'VERIFIED', counterpartyEvidence: { by: 'Kim', at: '2026-10-01', evidenceRef: 'REG-0001' }, refundRefused: null, legalRecoveryCritical: null }, o.facts) };
  const state = { schemaVersion: 1, isSample: true, config: cfg, hotels: [hotel], contracts: [contract], ledger: [], confirmations: [], sales: {}, ratings: { 'CT-T': { evidence: {}, history: o.history, scmOpinion: null } },
    alerts: [], approvals: [], aiReports: {}, audit: [], configHistory: [], importBatches: [] };
  const cx = { contractsById: { 'CT-T': contract }, asOf: o.asOf };
  const add = tx => { const r = Ledger.append(state.ledger, Object.assign({ contractId: 'CT-T', currency: o.ccy }, tx), cx); if (!r.ok) throw new Error('synth ledger: ' + r.errors); };
  add({ type: 'OPENING', amountMinor: o.opening, occurredAt: '2026-06-01T09:00:00+09:00', externalRef: 'O' });
  o.topups.forEach(([d, a], i) => add({ type: 'TOPUP', amountMinor: a, occurredAt: d + 'T10:00:00+09:00', externalRef: 'T' + i }));
  ['2026-08', '2026-09', '2026-10'].forEach((m, i) => { if (o.cons[i] != null) add({ type: 'CONSUMPTION', amountMinor: o.cons[i], period: m, status: 'confirmed', occurredAt: m + '-28T23:00:00+09:00', externalRef: 'C' + m }); });
  if (o.conf) state.confirmations.push({ contractId: 'CT-T', amountMinor: o.conf[0], currency: o.ccy, confirmedAt: o.conf[1] });
  const compute = () => Model.compute(state);
  return { state, cfg, contract, hotel, add, compute, view: () => compute().views[0], cx };
};

module.exports = env;
