/* SAMPLE DATA — 100% fictional hotels, names, registration numbers and amounts. Not OMH operating data.
   Designed so every engine path (grades, caps, guards, alerts) has at least one example.   */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const dep = typeof require === 'function' ? { Config: require('../core/config.js'), Ledger: require('../engine/ledger.js') } : { Config: NS.Config, Ledger: NS.Ledger };
  const api = factory(dep);
  NS.Seed = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Config, Ledger } = dep;
  const B = (ko, en) => ({ ko, en });
  const ENTITIES = {
    'OMH-KR': 'OHMYHOTEL Korea (sample entity)', 'OMH-JP': 'OHMYHOTEL Japan (sample entity)', 'OMH-VN': 'OHMYHOTEL Vietnam (sample entity)',
  };
  const ORDER = ['legalEntity', 'operatingStability', 'financialHealth', 'ownershipChange', 'settlementHistory', 'consumptionVsPrepay', 'refundability', 'collateral', 'reconAccuracy', 'continuity', 'scmOps', 'countryLegal'];
  const N = null;
  const MON = { Jun: '2026-06', Jul: '2026-07', Aug: '2026-08', Sep: '2026-09', Oct: '2026-10', Nov: '2026-11' };
  const eom = m => ({ '2026-06': '2026-06-30', '2026-07': '2026-07-31', '2026-08': '2026-08-31', '2026-09': '2026-09-30', '2026-10': '2026-10-31', '2026-11': '2026-11-05' }[m]);

  const HOTELS = [
    ['H001', 'ELLIS-90001', B('샘플 서울 강남 호텔', 'Sample Seoul Gangnam Hotel'), 'KR', B('서울', 'Seoul'), 'SAMPLE Gangnam Hospitality Co.', 'SCM-KR-01', {}],
    ['H002', 'ELLIS-90002', B('샘플 부산 해운대 리조트', 'Sample Busan Haeundae Resort'), 'KR', B('부산', 'Busan'), 'SAMPLE Haeundae Resort Inc.', 'SCM-KR-01', {}],
    ['H003', 'ELLIS-90003', B('샘플 제주 오션 호텔', 'Sample Jeju Ocean Hotel'), 'KR', B('제주', 'Jeju'), 'SAMPLE Jeju Ocean Ltd.', 'SCM-KR-02', {}],
    ['H004', 'ELLIS-90004', B('샘플 도쿄 신주쿠 호텔', 'Sample Tokyo Shinjuku Hotel'), 'JP', B('도쿄', 'Tokyo'), 'SAMPLE Shinjuku KK', 'SCM-JP-01', {}],
    ['H005', 'ELLIS-90005', B('샘플 오사카 난바 호텔', 'Sample Osaka Namba Hotel'), 'JP', B('오사카', 'Osaka'), 'SAMPLE Namba Hotels KK', 'SCM-JP-01', {}],
    ['H006', 'ELLIS-90006', B('샘플 교토 기온 인', 'Sample Kyoto Gion Inn'), 'JP', B('교토', 'Kyoto'), 'SAMPLE Gion Inn KK', 'SCM-JP-02', { closure: { claimed: true, source: 'SCM', note: 'court notice', verified: { by: 'SCM-JP-02 (sample)', at: '2026-09-18', evidenceRef: 'DOC-JP-2026-0914' } } }],
    ['H007', 'ELLIS-90007', B('샘플 오키나와 비치 리조트', 'Sample Okinawa Beach Resort'), 'JP', B('나하', 'Naha'), 'SAMPLE Okinawa Resort KK', 'SCM-JP-02', {}],
    ['H008', 'ELLIS-90008', B('샘플 하노이 올드쿼터 호텔', 'Sample Hanoi Old Quarter Hotel'), 'VN', B('하노이', 'Hanoi'), 'SAMPLE Old Quarter JSC', 'SCM-VN-01', {}],
    ['H009', 'ELLIS-90009', B('샘플 다낭 리버사이드', 'Sample Danang Riverside'), 'VN', B('다낭', 'Da Nang'), 'SAMPLE Riverside Co. Ltd.', 'SCM-VN-01', { ownershipChange: 'PENDING' }],
    ['H010', 'ELLIS-90010', B('샘플 호치민 센트럴 호텔', 'Sample HCMC Central Hotel'), 'VN', B('호치민', 'Ho Chi Minh City'), 'SAMPLE Central Saigon JSC', 'SCM-VN-02', {}],
    ['H011', 'ELLIS-90011', B('샘플 나고야 스테이션 호텔', 'Sample Nagoya Station Hotel'), 'JP', B('나고야', 'Nagoya'), 'SAMPLE Nagoya Station KK', 'SCM-JP-01', { closure: { claimed: true, source: 'NEWS/AI', note: 'SNS rumour, no document', verified: null } }],
    ['H012', 'ELLIS-90012', B('샘플 후쿠오카 하카타 호텔', 'Sample Fukuoka Hakata Hotel'), 'JP', B('후쿠오카', 'Fukuoka'), 'SAMPLE Hakata KK', 'SCM-JP-02', {}],
    ['H013', 'ELLIS-90013', B('샘플 대구 호텔', 'Sample Daegu Hotel'), 'KR', B('대구', 'Daegu'), 'SAMPLE Daegu Stay Co.', 'SCM-KR-02', {}],
    ['H014', 'ELLIS-90014', B('샘플 냐짱 베이 호텔', 'Sample Nha Trang Bay Hotel'), 'VN', B('냐짱', 'Nha Trang'), 'SAMPLE Bay Hotel JSC', 'SCM-VN-02', {}],
    ['H015', 'ELLIS-90015', B('샘플 광주 호텔', 'Sample Gwangju Hotel'), 'KR', B('광주', 'Gwangju'), 'SAMPLE Gwangju Stay Co.', 'SCM-KR-02', {}],
  ].map(([hotelId, ellisHotelId, name, country, city, operatingCompany, scm, facts], i) => ({
    hotelId, ellisHotelId, name, brand: B('(브랜드 미상)', '(brand n/a)'), country, city, operatingCompany, owner: null /* Unknown */, status: 'ACTIVE',
    assignedScm: scm, lastVerifiedDate: '2026-10-15', facts: Object.assign({ closure: null, ownershipChange: 'UNKNOWN' }, facts), isSample: true,
  }));
  // hotel-level status follows verified facts only
  HOTELS.find(h => h.hotelId === 'H006').status = 'CLOSED_CONFIRMED';

  const K = m => m * 1e6;  // KRW helper (millions)
  // spec: [contractId, hotelId, entity, type, ccy, start, end, refundable, transferEligible, collateralMinor, opening, topups, cons, conf, sales, hist, extra]
  const C = (id, hotelId, entity, type, ccy, start, end, refundable, transfer, collateral, opening, topups, cons, conf, sales, hist, extra) =>
    ({ id, hotelId, entity, type, ccy, start, end, refundable, transfer, collateral, opening, topups, cons, conf, sales, hist, extra: extra || {} });
  const SPECS = [
    C('CT-KR-001', 'H001', 'OMH-KR', 'FLOATING', 'KRW', '2025-07-01', '2027-06-30', true, true, K(20), K(60), [['06-15', K(30)], ['07-15', K(30)], ['08-15', K(30)], ['09-15', K(30)], ['10-15', K(15)]],
      { Jun: K(29), Jul: K(31), Aug: K(30), Sep: K(30), Oct: K(30) }, [K(45), '2026-10-31'], [K(33), K(34), K(35)], [['2026-08-01', 'A', 87.2]], { pendingNov: K(5) }),
    C('CT-KR-002', 'H002', 'OMH-KR', 'FLOATING', 'KRW', '2025-04-01', '2027-03-31', true, false, 0, K(30), [['06-10', K(20)], ['07-10', K(20)], ['08-10', K(20)], ['09-10', K(20)], ['10-10', K(20)]],
      { Jun: K(19), Jul: K(21), Aug: K(20), Sep: K(20), Oct: K(20) }, [K(30), '2026-10-31'], [K(22), K(22), K(23)], [['2026-08-01', 'B', 68.8]]),
    C('CT-KR-003', 'H003', 'OMH-KR', 'PREPAYMENT', 'KRW', '2025-09-01', '2027-08-31', true, false, 0, K(80), [['06-05', K(25)], ['07-05', K(25)], ['08-05', K(20)]],
      { Jun: K(25), Jul: K(25), Aug: K(24), Sep: K(22), Oct: K(8) }, [K(46), '2026-10-31'], [K(26), K(24), K(12)], [['2026-09-01', 'A', 82.4]]),
    C('CT-JP-001', 'H004', 'OMH-JP', 'FLOATING', 'JPY', '2025-10-01', '2027-09-30', true, true, 5e6, 10e6, [['06-10', 5e6], ['07-10', 5e6], ['08-10', 5e6], ['09-10', 5e6], ['10-10', 5e6]],
      { Jun: 4.8e6, Jul: 5.2e6, Aug: 5e6, Sep: 5e6, Oct: 5e6 }, [10e6, '2026-10-31'], [5.5e6, 5.6e6, 5.7e6], [['2026-08-01', 'A', 90.4]]),
    C('CT-JP-002', 'H004', 'OMH-KR', 'HARD_BLOCK_ADV', 'JPY', '2026-01-01', '2027-03-31', true, null, 0, 4000000, [['08-01', 800000], ['09-01', 800000]],
      { Jun: 750000, Jul: 800000, Aug: 800000, Sep: 820000, Oct: 780000 }, [1640000, '2026-10-31'], [8200, 8300, 8100].map(x => x * 100), [['2026-08-01', 'B', 70.4]]),
    C('CT-JP-003', 'H005', 'OMH-JP', 'FLOATING', 'JPY', '2025-12-01', '2027-11-30', true, false, 0, 8e6, [['06-10', 4e6], ['07-10', 4e6], ['08-10', 4e6], ['09-10', 4e6], ['10-10', 4e6]],
      { Jun: 4e6, Jul: 4e6, Aug: 4e6, Sep: 4e6, Oct: 4e6 }, [6.5e6, '2026-10-31'], [4.1e6, 4.0e6, 3.9e6], [['2026-09-01', 'B', 65.6]]),
    C('CT-JP-004', 'H006', 'OMH-JP', 'PREPAYMENT', 'JPY', '2025-06-01', '2027-05-31', true, false, 0, 15e6, [],
      { Jun: 2e6, Jul: 1e6, Aug: 0, Sep: 0, Oct: 0 }, [12e6, '2026-09-30'], [0, 0, 0], [['2026-08-15', 'B', 66.0], ['2026-09-20', 'C', 55.0]],
      { refund: { requested: true, requestedAt: '2026-09-20', requestedAmountMinor: 12e6, dueDate: '2026-10-20' } }),
    C('CT-JP-005', 'H007', 'OMH-JP', 'BUYOUT', 'JPY', '2026-04-01', '2027-03-31', false, false, 0, 30e6, [],
      { Aug: 0, Sep: 0, Oct: 0 }, [30e6, '2026-10-31'], [0, 0, 0], [['2026-08-01', 'C', 52.4]]),
    C('CT-VN-001', 'H008', 'OMH-VN', 'FLOATING', 'VND', '2025-11-01', '2027-10-31', true, false, 0, 900e6, [['06-10', 600e6], ['07-10', 600e6], ['08-10', 600e6], ['10-10', 300e6]],
      { Jun: 580e6, Jul: 610e6, Aug: 600e6, Oct: 620e6 }, null, [610e6, 600e6, 630e6], [['2026-08-01', 'B', 67.7]]),
    C('CT-VN-002', 'H009', 'OMH-VN', 'PREPAYMENT', 'VND', '2025-01-01', '2026-12-31', true, false, 0, 1500e6, [['06-01', 400e6], ['07-01', 400e6], ['08-01', 400e6], ['09-01', 400e6], ['10-01', 400e6]],
      { Jun: 380e6, Jul: 420e6, Aug: 400e6, Sep: 400e6, Oct: 400e6 }, [1500e6, '2026-10-31'], [410e6, 405e6, 395e6], [['2026-08-01', 'C', 59.6]]),
    C('CT-VN-003', 'H010', 'OMH-VN', 'SECURITY_DEPOSIT', 'VND', '2026-03-01', '2028-02-29', true, true, 0, 500e6, [], {}, [500e6, '2026-09-15'], null, [['2026-08-01', 'B', 68.6]]),
    C('CT-JP-006', 'H011', 'OMH-JP', 'FLOATING', 'JPY', '2026-02-01', '2027-01-31', true, true, 0, 12e6, [['06-05', 6e6], ['07-05', 6e6], ['08-05', 6e6], ['09-05', 6e6], ['10-05', 6e6]],
      { Jun: 6e6, Jul: 6e6, Aug: 6e6, Sep: 6e6, Oct: 6e6 }, [12e6, '2026-10-31'], [6.2e6, 6.0e6, 6.1e6], [['2026-08-01', 'B', 68.8]]),
    C('CT-JP-007', 'H012', 'OMH-JP', 'FLOATING', 'JPY', '2026-10-20', '2027-10-19', true, null, 0, 5e6, [], {}, null, null, [], { counterpartyVerification: 'UNKNOWN' }),
    C('CT-KR-004', 'H013', 'OMH-KR', 'FLOATING', 'KRW', '2025-12-16', '2026-12-15', true, false, 0, K(10), [['06-10', K(10)], ['07-10', K(10)], ['08-10', K(10)], ['09-10', K(10)], ['10-10', K(5)]],
      { Jun: K(10), Jul: K(10), Aug: K(10), Sep: 9.5e6, Oct: 9.8e6 }, [5.7e6, '2026-10-31'], [K(12), K(12), K(8)], [['2026-08-01', 'B', 67.2]]),
    C('CT-VN-004', 'H014', 'OMH-VN', 'FLOATING', 'VND', '2025-08-01', '2027-07-31', true, false, 0, 1000e6, [],
      { Jun: 100e6, Jul: 100e6, Aug: 90e6, Sep: 60e6, Oct: 0 }, [650e6, '2026-10-15'], [80e6, 55e6, 0], [['2026-08-01', 'C', 55.0]],
      { refund: { requested: true, requestedAt: '2026-08-30', requestedAmountMinor: 650e6, dueDate: '2026-09-30' }, refundRefused: { claimed: true, source: 'SCM', note: 'written refusal received', verified: { by: 'SCM-VN-02 (sample)', at: '2026-10-02', evidenceRef: 'EML-VN-2026-1002' } } }),
    C('CT-KR-005', 'H015', 'OMH-KR', 'HARD_BLOCK_ADV', 'KRW', '2026-05-01', '2027-04-30', true, true, 0, 4000000, [],
      { Jun: 500000, Jul: 500000, Aug: 500000, Sep: 500000, Oct: 500000 }, [1500000, '2026-10-31'], [5200, 5100, 5300].map(x => x * 100), [['2026-08-01', 'B', 76.0]]),
  ];

  // Top-up terms as a PIC would type them (free text). Sample values only.
  const TOPUP_INFO = {
    'CT-KR-001': { topUp: { conditionText: 'Top up when balance < 1 month of usage', minAmountMinor: 10e6 }, allotment: '10 rooms/night' },
    'CT-KR-003': { topUp: { conditionText: 'Top up 20M when balance < 10M', minAmountMinor: 20e6 }, plannedTopUp: { amountMinor: 30e6, date: '2026-11-20' } },
    'CT-JP-001': { topUp: { conditionText: 'Top up when balance < 5M JPY', minAmountMinor: 5e6 } },
    'CT-VN-001': { topUp: { conditionText: 'Top up when balance < 100M VND', minAmountMinor: 100e6 }, plannedTopUp: { amountMinor: 300e6, date: '2026-11-25' }, allotment: '12 rooms/night' },
    'CT-VN-002': { topUp: { conditionText: 'Payments follow the contract schedule regardless of balance', minAmountMinor: 400e6 } },
  };

  function buildSeed() {
    const config = Config.defaults();
    const hotels = JSON.parse(JSON.stringify(HOTELS));
    const contracts = [], ledger = [], confirmations = [], sales = {}, ratings = {};
    const ctxBase = { contractsById: {}, asOf: config.asOf };
    for (const s of SPECS) {
      const hotel = hotels.find(h => h.hotelId === s.hotelId);
      const x = s.extra;
      const refund = Object.assign({ refundable: s.refundable, requested: false }, x.refund || {});
      const cvs = x.counterpartyVerification || 'VERIFIED';
      const facts = { counterpartyVerification: cvs, counterpartyEvidence: cvs === 'UNKNOWN' ? null : { by: hotel.assignedScm + ' (sample)', at: '2026-10-15', evidenceRef: 'SAMPLE-REG-' + s.id }, refundRefused: x.refundRefused || null, legalRecoveryCritical: null };
      const c = {
        contractId: s.id, hotelId: s.hotelId, omhEntity: s.entity, omhEntityName: ENTITIES[s.entity], counterparty: { legalName: hotel.operatingCompany, bizRegNo: 'SAMPLE-' + s.id.replace(/\D/g, '') },
        contractType: s.type === 'SECURITY_DEPOSIT' ? 'DEPOSIT_AGREEMENT' : 'ALLOTMENT_PREPAY', prepaymentType: s.type, currency: s.ccy, startDate: s.start, endDate: s.end, assignedScm: hotel.assignedScm,
        refund, transfer: { eligible: s.transfer }, collateral: s.collateral ? { type: 'BANK_GUARANTEE', amountMinor: s.collateral, currency: s.ccy, verified: true } : null,
        renewal: null, facts, isSample: true, topUp: (TOPUP_INFO[s.id] || {}).topUp || null, plannedTopUp: (TOPUP_INFO[s.id] || {}).plannedTopUp || null, allotment: (TOPUP_INFO[s.id] || {}).allotment || null,
      };
      contracts.push(c); ctxBase.contractsById[c.contractId] = c;
      const add = (tx) => { const r = Ledger.append(ledger, Object.assign({ contractId: s.id, currency: s.ccy, source: 'SEED' }, tx), ctxBase); if (!r.ok) throw new Error('seed ledger invalid ' + s.id + ' ' + JSON.stringify(tx) + ' ' + r.errors); };
      add({ type: 'OPENING', amountMinor: Math.round(s.opening), occurredAt: '2026-06-01T09:00:00+09:00', externalRef: 'OPEN-' + s.id });
      for (const [md, amt] of s.topups) add({ type: 'TOPUP', amountMinor: Math.round(amt), occurredAt: '2026-' + md + 'T10:00:00+09:00', externalRef: 'TOPUP-' + s.id + '-' + md });
      for (const k of Object.keys(s.cons)) add({ type: 'CONSUMPTION', amountMinor: Math.round(s.cons[k]), period: MON[k], status: 'confirmed', occurredAt: eom(MON[k]) + 'T23:00:00+09:00', externalRef: 'CONS-' + s.id + '-' + MON[k] });
      if (x.pendingNov) add({ type: 'CONSUMPTION', amountMinor: x.pendingNov, period: '2026-11', status: 'pending', occurredAt: '2026-11-05T23:00:00+09:00', externalRef: 'CONS-' + s.id + '-2026-11' });
      if (s.conf) confirmations.push({ contractId: s.id, amountMinor: Math.round(s.conf[0]), currency: s.ccy, confirmedAt: s.conf[1], by: 'hotel-contact (sample)' });
      if (s.sales) sales[s.id] = ['2026-08', '2026-09', '2026-10'].map((m, i) => ({ month: m, amountMinor: Math.round(s.sales[i]), basis: 'BOOKING_DATE' }));
      ratings[s.id] = { evidence: {}, history: s.hist.map(([at, grade, score]) => ({ at, grade, score, by: 'SCM (sample seed)', reason: 'initial sample snapshot' })), scmOpinion: null };
    }
    ratings['CT-KR-001'].scmOpinion = { text: '소진·대사 모두 안정적. 정기 모니터링 유지. (샘플 의견)', by: 'SCM-KR-01 (sample)', at: '2026-10-31' };
    ratings['CT-JP-004'].scmOpinion = { text: '폐업 확인. 반환 청구 중, 회수 방안(법무 검토) 필요. (샘플 의견)', by: 'SCM-JP-02 (sample)', at: '2026-10-25' };
    const alerts = [
      { alertId: 'SALES_DECLINE:CT-KR-002', ruleId: 'SALES_DECLINE', hotelId: 'H002', contractId: 'CT-KR-002', severity: 'MEDIUM', action: 'HOLD_TOPUP', status: 'RESOLVED', source: 'AUTO', title: B('판매 감소 추세', 'Sales decline trend'), evidence: [{ k: 'changePct', v: -22 }], detectedAt: '2026-07-01', firstDetectedAt: '2026-07-01', lastDetectedAt: '2026-07-15', clearedAt: '2026-07-20', notes: [{ at: '2026-07-20', by: 'SCM-KR-01 (sample)', text: '성수기 반등 확인' }], assignedScm: 'SCM-KR-01', historical: true },
      { alertId: 'RECON_UNCONFIRMED:CT-JP-001', ruleId: 'RECON_UNCONFIRMED', hotelId: 'H004', contractId: 'CT-JP-001', severity: 'MEDIUM', action: 'RECONFIRM_BALANCE', status: 'RESOLVED', source: 'AUTO', title: B('잔액 확인 미완료', 'Balance confirmation incomplete'), evidence: [{ k: 'status', v: 'UNCONFIRMED' }], detectedAt: '2026-08-10', firstDetectedAt: '2026-08-10', lastDetectedAt: '2026-08-20', clearedAt: '2026-09-02', notes: [], assignedScm: 'SCM-JP-01', historical: true },
    ];
    return {
      schemaVersion: 1, isSample: true, config, hotels, contracts, ledger, confirmations, sales, ratings, alerts, approvals: [], aiReports: {}, audit: [], configHistory: [], importBatches: [], entities: ENTITIES,
    };
  }
  return { buildSeed, ENTITIES, ORDER };
});
