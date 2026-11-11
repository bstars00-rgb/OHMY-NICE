'use strict';
// System-level tests: RBAC, audit, persistence, approvals/no-execution, legacy regression, security scans, view rendering, performance.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const env = require('./helpers/env');
const { Money, Config, Ledger, Model, Seed, Adapters, Store, UI, ViewsA, ViewsB, ViewsC, RBAC, Rating, Csv } = env;
const { loadLegacy, legacyHash, readLegacy } = require('./helpers/legacy_loader');

function walk(dir, out) { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { if (!['node_modules', '.git'].includes(f.name)) walk(p, out); } else out.push(p); } return out; }

module.exports = function register(h) {
  const { test: t } = h;
  const fresh = (role) => env.as(env.newStore(), role || 'SCM');
  const lg = st => JSON.stringify(st.state.ledger);

  /* ---------------- RBAC / audit ---------------- */
  t('X01', 'RBAC: VIEWER cannot write anything; SCM/CEO/ADMIN limited to their permissions; denied attempts leave data unchanged and are audited', ['D-4', 'T14'], a => {
    const st = fresh('VIEWER'); const snap = JSON.stringify(Object.assign({}, st.state, { audit: null })); const c = st.commands;
    const attempts = [() => c.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1, currency: 'KRW', occurredAt: '2026-11-01T10:00:00+09:00' }), () => c.importCsv('a,b\n', 'x'), () => c.addConfirmation({ contractId: 'CT-KR-001', amountMinor: 1, currency: 'KRW', confirmedAt: '2026-11-01' }),
      () => c.setOwnership('H001', 'PENDING', 'EVD-0001'), () => c.commitRating('CT-KR-001', 'r'), () => c.setOpinion('CT-KR-001', 'x'), () => c.updateAlert('x', 'ACKNOWLEDGED', ''), () => c.createApproval('CT-KR-001', 1),
      () => c.submitApproval('AP-0001'), () => c.reviewApproval('AP-0001', 'ok'), () => c.runAi('CT-KR-001'), () => c.setConfig(env.clone(st.state.config), 'r'), () => c.resetSample(), () => c.exportJson(), () => c.recordFact('hotel', 'H001', 'closure', {}), () => c.validateCsv('a')];
    for (const f of attempts) a.throws(f, 'E_FORBIDDEN');
    a.eq(JSON.stringify(Object.assign({}, st.state, { audit: null })), snap, 'no data changed'); a.eq(st.state.audit.filter(e => e.outcome === 'DENIED').length, 14, 'every denied mutation is audited (export/validate are pre-checks)');
    env.as(st, 'SCM'); a.throws(() => c.setConfig(env.clone(st.state.config), 'r'), 'E_FORBIDDEN'); a.throws(() => c.resetSample(), 'E_FORBIDDEN'); a.throws(() => c.reviewApproval('AP-1', 'ok'), 'E_FORBIDDEN'); a.throws(() => c.updateAlert('SALES_DECLINE:CT-KR-003', 'DISMISSED', 'x'), 'E_FORBIDDEN');
    env.as(st, 'CEO'); a.throws(() => c.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1, currency: 'KRW', occurredAt: '2026-11-01T10:00:00+09:00' }), 'E_FORBIDDEN'); a.throws(() => c.setOwnership('H001', 'PENDING', 'EVD-0001'), 'E_FORBIDDEN');
    env.as(st, 'ADMIN'); a.throws(() => c.reviewApproval('AP-1', 'ok'), 'E_FORBIDDEN', 'ADMIN is deliberately not a reviewer'); a.ok(RBAC.can('CEO', 'approval.review') && !RBAC.can('ADMIN', 'approval.review') && !RBAC.can('SCM', 'approval.review'));
    a.ok(RBAC.can('ADMIN', 'config.edit') && !RBAC.can('CEO', 'config.edit') && !RBAC.can('VIEWER', 'audit.read') && RBAC.can('CEO', 'audit.read'));
  });
  t('X03', 'Audit log is hash-chained, records OK/REJECTED/DENIED, and detects tampering', ['D-3'], a => {
    const st = fresh('SCM'); st.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1000, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00', externalRef: 'AUD1' }); st.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: -1, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00' });
    env.as(st, 'VIEWER'); try { st.commands.setOwnership('H001', 'PENDING', 'EVD-0001'); } catch (e) { /* expected */ }
    const outcomes = st.state.audit.map(e => e.outcome); a.includes(outcomes, 'OK'); a.includes(outcomes, 'REJECTED'); a.includes(outcomes, 'DENIED'); a.eq(st.verifyAudit().ok, true);
    const last = st.state.audit[st.state.audit.length - 1]; a.ok(last.actor && last.role && last.at && last.action && last.hash && last.prevHash);
    const copy = env.clone(st.state.audit); st.state.audit[1].detail = { tampered: true }; const v = st.verifyAudit(); a.eq(v.ok, false); a.eq(v.brokenAt, 2); st.state.audit.splice(0, st.state.audit.length, ...copy); a.eq(st.verifyAudit().ok, true);
    st.state.audit.splice(1, 1); a.eq(st.verifyAudit().ok, false, 'deleting an entry breaks the chain');
  });

  /* ---------------- approval portal / no execution ---------------- */
  t('X02', 'approval packet and CEO review: complete packet, mock submit, CEO-only review with required feedback; ledger and balances never change; execution disabled', ['M09-1', 'M09-2', 'T14'], a => {
    const st = fresh('SCM'); const c = st.commands; const ledgerBefore = lg(st); const balBefore = st.model().byContract['CT-KR-001'].balance.closingMinor;
    const r = c.createApproval('CT-KR-001', 5e6); a.ok(r.ok); const p = r.approval.packet; a.eq(r.approval.status, 'DRAFT'); a.ok(p.mock && /PROTOTYPE/.test(p.disclaimer) && p.fingerprint && p.ceoStatus === 'PENDING');
    a.ok(p.hotel.name.ko && p.contract.omhEntity === 'OMH-KR' && p.contract.counterparty.legalName && p.rating.grade === 'B' && p.balance.currentMinor === 45e6 && p.avgMonthlyConsumptionMinor === 30e6 && p.recommendedLimitMinor === 30e6 && p.request.requestedMinor === 5e6 && p.request.projectedExposureMinor === 50e6 && p.request.limitExceeded === true && Array.isArray(p.alerts) && 'scmOpinion' in p && p.scmOpinion.text);
    a.throws(() => c.reviewApproval(r.approval.approvalId, 'ok'), 'E_FORBIDDEN', 'SCM cannot review');
    const s = c.submitApproval(r.approval.approvalId); a.ok(s.ok && s.ack.mock && /^MOCK-PORTAL-/.test(s.ack.ref)); a.eq(c.submitApproval(r.approval.approvalId).ok, false, 'cannot submit twice');
    env.as(st, 'CEO'); a.eq(c.reviewApproval(r.approval.approvalId, '   ').errors[0], 'E_FEEDBACK_REQUIRED', 'feedback for the person in charge is required'); const d = c.reviewApproval(r.approval.approvalId, 'Re-check the unused balance first'); a.ok(d.ok); a.eq(st.state.approvals[0].status, 'CEO_REVIEWED'); a.eq(st.state.approvals[0].feedback.text, 'Re-check the unused balance first'); a.ok(st.state.approvals[0].feedback.by); a.eq(c.reviewApproval(r.approval.approvalId, 'again').ok, false, 'a completed review is final');
    a.eq(lg(st), ledgerBefore, 'ledger byte-identical after approval'); a.eq(st.model().byContract['CT-KR-001'].balance.closingMinor, balBefore); a.eq(st.state.audit.filter(e => e.action === 'PORTAL_REVIEW' && e.outcome === 'OK').pop().detail.fundsMoved, false);
    a.throws(() => Adapters.Portal.execute(), 'E_EXECUTION_DISABLED'); a.eq(Adapters.Portal.realExecution, false); a.eq(Adapters.Portal.mode, 'MOCK');
    a.eq(env.as(st, 'SCM') && c.createApproval('CT-KR-001', 0).ok, false); const over = c.createApproval('CT-KR-001', 99e6); a.ok(over.ok && over.approval.packet.request.limitExceeded && over.approval.packet.request.approvalReasons.includes('LIMIT_EXCEEDED'));
    a.eq(c.createApproval('NOPE', 5).ok, false); a.eq(c.submitApproval('AP-9999').ok, false);
    env.as(st, 'CEO'); a.eq(c.reviewApproval(over.approval.approvalId, 'ok').ok, false, 'a DRAFT cannot be reviewed before it is requested');
  });
  t('X17', 'No code path can send data or run dynamic code: static scan of the prototype sources', ['G-1', 'D-6'], a => {
    const files = walk(path.join(env.root, 'js'), []).concat([path.join(env.root, 'index.html')]); const bad = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\beval\s*\(|new Function|document\.write|importScripts|navigator\.clipboard|window\.open/; const hits = [];
    for (const f of files) { const s = fs.readFileSync(f, 'utf8'); if (bad.test(s)) hits.push(path.basename(f)); if (/https?:\/\//.test(s.replace(/<\?xml[^>]*>/, ''))) hits.push('URL in ' + path.basename(f)); }
    a.deepEq(hits, []); const html = fs.readFileSync(path.join(env.root, 'index.html'), 'utf8'); a.ok(/connect-src 'none'/.test(html) && /script-src 'self'/.test(html) && /form-action 'none'/.test(html), 'CSP forbids network and inline scripts');
  });
  t('X06', 'No secrets / credentials / real-looking keys in the prototype tree', ['D-6', 'G-2'], a => {
    const files = walk(env.root, []).filter(f => !/[\\/]legacy[\\/]/.test(f) && !/[\\/]tests[\\/]results[\\/]/.test(f) && /\.(js|html|css|json|md|csv)$/.test(f)); a.ok(files.length > 20);
    const pats = [/(api[_-]?key|secret|passwd|password|token)\s*[:=]\s*['"][^'"\s]{6,}/i, /AKIA[0-9A-Z]{16}/, /sk-[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /Bearer\s+[A-Za-z0-9._-]{20,}/, /ghp_[A-Za-z0-9]{20,}/];
    const hits = [], marked = []; for (const f of files) { if (/tests[\\/]system_tests\.js$/.test(f)) continue; const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/); lines.forEach(l => { if (l.includes('PUBLIC-DEMO-VALUE')) marked.push(path.relative(env.root, f)); });
      const s = lines.filter(l => !l.includes('PUBLIC-DEMO-VALUE')).join('\n'); for (const p of pats) if (p.test(s)) hits.push(path.relative(env.root, f) + ' ' + p); }
    a.deepEq(hits, []); a.deepEq(marked.map(x => x.replace(/\\/g, '/')), ['js/core/auth.js'], 'the only allowed exception is the one public demo password line'); a.ok(!fs.existsSync(path.join(env.root, '.env')));
    const s = Seed.buildSeed(); a.ok(s.hotels.every(x => x.isSample && /SAMPLE|샘플|Sample/.test(JSON.stringify(x.name) + x.operatingCompany)), 'all hotels are labelled sample'); a.ok(s.contracts.every(x => /^SAMPLE-/.test(x.counterparty.bizRegNo)));
  });

  /* ---------------- Persistence / refresh ---------------- */
  t('X04', 'Reload consistency: state and every derived number are identical after a fresh load from storage', ['T15', 'D-5'], a => {
    const storage = Store.memoryStorage(); const s1 = env.newStore({ storage }); env.as(s1, 'SCM'); const c = s1.commands;
    a.ok(c.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 3e6, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00', externalRef: 'P1' }).ok); a.ok(c.addConfirmation({ contractId: 'CT-KR-001', amountMinor: 48e6, currency: 'KRW', confirmedAt: '2026-11-03' }).ok);
    a.ok(c.setOwnership('H001', 'NONE', 'EVD-0002').ok); a.ok(c.commitRating('CT-KR-001', 'persist test').ok); a.ok(c.updateAlert('CONSUMPTION_COLLAPSE:CT-KR-003', 'ACKNOWLEDGED', 'seen').ok); a.ok(c.createApproval('CT-KR-001', 1e6).ok);
    const s2 = env.newStore({ storage }); a.eq(s2.loadStatus, 'OK'); a.eq(JSON.stringify(s2.state), JSON.stringify(s1.state)); a.eq(JSON.stringify(s2.model()), JSON.stringify(s1.model()), 'derived values reproducible');
    a.eq(s2.model().byContract['CT-KR-001'].balance.closingMinor, 48e6); a.eq(s2.model().byContract['CT-KR-001'].recon.status, 'MATCH'); a.ok(Object.isFrozen(s2.state.ledger[0]), 'ledger rows re-frozen after load'); a.eq(s2.verifyAudit().ok, true);
    const a1 = env.newStore(), a2 = env.newStore(); a.eq(JSON.stringify(a1.model()), JSON.stringify(a2.model()), 'seed is deterministic');
  });
  t('X05', 'Corrupt / foreign storage is quarantined, never silently destroyed; legacy storage key is never touched', ['D-5', 'D-7', 'R-2'], a => {
    const storage = Store.memoryStorage(); storage.setItem('omh_hfr_v1', '{"schemaVersion":1,'); const s = env.newStore({ storage }); a.eq(s.loadStatus, 'CORRUPT_RESET'); a.eq(storage.getItem('omh_hfr_v1.corrupt'), '{"schemaVersion":1,'); a.ok(s.model().views.length === 20);
    const s3 = Store.memoryStorage(); s3.setItem('omh_hfr_v1', JSON.stringify({ schemaVersion: 2, hotels: [] })); a.eq(env.newStore({ storage: s3 }).loadStatus, 'CORRUPT_RESET');
    const s4 = Store.memoryStorage(); s4.setItem('omh_prg_v42', '{"legacy":"data"}'); const st = env.newStore({ storage: s4 }); env.as(st, 'SCM'); st.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00', externalRef: 'k' });
    a.eq(s4.getItem('omh_prg_v42'), '{"legacy":"data"}', 'legacy key byte-identical'); a.ok(st.key !== 'omh_prg_v42'); a.deepEq(Object.keys(s4._dump()).sort(), ['omh_hfr_v1', 'omh_hfr_v1.anchor', 'omh_prg_v42']);
  });
  t('X08', 'Stable unique IDs; every row ties to an existing hotel/contract; ledger rows carry currency + valid datetime', ['D-1', 'M01-1', 'M02-3'], a => {
    const s = Seed.buildSeed(); const uniq = arr => new Set(arr).size === arr.length;
    a.ok(uniq(s.hotels.map(x => x.hotelId)) && uniq(s.contracts.map(x => x.contractId)) && uniq(s.ledger.map(x => x.txId)) && uniq(s.hotels.map(x => x.ellisHotelId)));
    const hotels = new Set(s.hotels.map(x => x.hotelId)); const contracts = Object.fromEntries(s.contracts.map(x => [x.contractId, x]));
    a.ok(s.contracts.every(x => hotels.has(x.hotelId)) && Object.keys(s.ratings).every(k => contracts[k]) && s.contracts.every(x => s.ratings[x.contractId]));
    for (const x of s.ledger) { a.ok(contracts[x.contractId], x.txId); a.eq(x.currency, contracts[x.contractId].currency, x.txId); a.ok(env.Dates.isDateTime(x.occurredAt), x.txId); a.ok(/^[A-Z]+-[A-Z0-9-]+-\d{5}$/.test(x.txId) || x.txId, x.txId); }
    a.ok(s.contracts.length === 20 && s.hotels.length === 19);
  });
  t('X13', 'Hotel master & contract master carry every required field; owner unknown is explicit; brand ≠ legal counterparty', ['M01-1', 'M01-2', 'M02-6'], a => {
    const s = Seed.buildSeed(); const hk = ['hotelId', 'ellisHotelId', 'name', 'country', 'city', 'operatingCompany', 'owner', 'assignedScm', 'status', 'lastVerifiedDate', 'brand']; const ck = ['contractId', 'hotelId', 'omhEntity', 'counterparty', 'contractType', 'prepaymentType', 'currency', 'startDate', 'endDate', 'assignedScm', 'refund', 'transfer'];
    for (const x of s.hotels) for (const k of hk) a.ok(k in x, x.hotelId + '.' + k); for (const x of s.contracts) { for (const k of ck) a.ok(k in x, x.contractId + '.' + k); a.ok('legalName' in x.counterparty && 'bizRegNo' in x.counterparty); a.ok(env.Dates.isDate(x.startDate) && env.Dates.isDate(x.endDate) && x.startDate < x.endDate, x.contractId); }
    a.ok(s.hotels.every(x => x.owner === null), 'owner stored as null = Unknown, never invented'); a.ok(s.hotels.every(x => x.brand && x.brand.ko !== x.operatingCompany)); a.ok(s.contracts.some(c => c.counterparty.legalName !== s.hotels.find(x => x.hotelId === c.hotelId).brand.en));
  });

  /* ---------------- Config / admin ---------------- */
  t('X09', 'Configuration: validated, reason-required, audited with diff, recalculates grades; invalid sets rejected', ['M03-1', 'M04-1', 'M06-2', 'S08'], a => {
    const st = fresh('ADMIN'); const c = st.commands; const cfg = () => env.clone(st.state.config); const before = JSON.stringify(st.state.config);
    const bad = (mut, code) => { const x = cfg(); mut(x); const r = c.setConfig(x, 'test'); a.eq(r.ok, false); a.ok(r.errors.some(e => e.startsWith(code)), code + ' in ' + r.errors); a.eq(JSON.stringify(st.state.config), before, 'config unchanged'); };
    bad(x => { x.weights.legalEntity = 11; }, 'E_WEIGHT_SUM_NOT_100'); bad(x => { x.gradeMultipliers.D = 0.5; }, 'E_D_MUST_BE_ZERO'); bad(x => { x.gradeMultipliers.NR = 1; }, 'E_NR_MUST_BE_ZERO'); bad(x => { x.ratingThresholds.A = 60; }, 'E_THRESHOLD_ORDER'); bad(x => { x.gradeMultipliers.A = 0.5; x.gradeMultipliers.B = 1; }, 'E_MULTIPLIER_NOT_MONOTONE');
    bad(x => { x.alertRules.LONG_UNCONSUMED.severity = 'SEVERE'; }, 'E_SEVERITY'); bad(x => { x.minCoverage = 0.9; }, 'E_COVERAGE_RANGE'); bad(x => { x.recon.matchBp = 500; }, 'E_RECON_RANGE'); bad(x => { x.weights.legalEntity = -1; x.weights.scmOps = 17; }, 'E_WEIGHT_RANGE'); bad(x => { x.gradeMultipliers.A = 2.555; }, 'E_MULTIPLIER_RANGE');
    a.eq(c.setConfig(cfg(), 'no change').errors[0], 'E_NO_CHANGE'); const x = cfg(); x.ratingThresholds.C = 60; a.eq(c.setConfig(x, '').errors.includes('E_REASON_REQUIRED'), true);
    a.eq(st.model().byContract['CT-JP-005'].rating.grade, 'C'); a.ok(c.setConfig(x, 'raise the C bar (test)').ok); a.eq(st.model().byContract['CT-JP-005'].rating.grade, 'D', 'grade recalculated from new threshold'); a.eq(st.state.configHistory.length, 1); a.eq(st.model().byContract['CT-JP-005'].limit.multiplier, 0, 'D x0');
    const hh = st.state.configHistory[0]; a.ok(hh.by && hh.at && hh.reason && hh.changes[0].path === 'ratingThresholds.C' && hh.changes[0].from === 50 && hh.changes[0].to === 60);
    const y = cfg(); y.gradeMultipliers.B = 2; a.ok(c.setConfig(y, 'B = 2 months (test)').ok); const kv = st.model().byContract['CT-KR-001']; a.eq(kv.limit.baseLimitMinor, 60e6); a.eq(kv.limit.recommendedLimitMinor, 60e6); a.eq(st.state.configHistory.length, 2);
    env.as(st, 'SCM'); a.throws(() => c.setConfig(cfg(), 'x'), 'E_FORBIDDEN');
  });
  t('X15', 'AI is a labelled mock, cites source/date/confidence, cannot change amounts, grades or limits; contract extraction is heuristic', ['M07-1'], a => {
    const st = fresh('SCM'); const before = JSON.stringify(st.model()); const r = st.commands.runAi('CT-JP-006'); a.ok(r.ok && r.report.mock === true && r.report.label.ko.includes('모의') && r.report.label.en.includes('MOCK')); a.eq(r.report.canSetFacts, false);
    for (const f of r.report.riskFactors) a.ok(f.source && f.asOf && f.confidence && 'verified' in f); a.ok(r.report.riskFactors.some(f => f.verified === false)); a.eq(JSON.stringify(st.model()), before, 'model identical after AI run');
    const e = Adapters.AI.extractContractTerms('Hotel shall refund unused balance within 30 days of termination. 반환 조건은 별도.', '2026-11-06'); a.ok(e.mock && e.heuristic && e.hits.length >= 2 && e.hits.every(x => x.needsHumanConfirmation && x.confidence === 'LOW'));
    a.eq(Adapters.AI.extractContractTerms('', 'x').hits.length, 0); a.ok(Adapters.INTEGRATIONS.filter(i => i.id !== 'SCM_LEDGER').every(i => !i.verified), 'no integration is falsely marked verified');
    a.ok(Adapters.INTEGRATIONS.find(i => i.id === 'AUTH').mode === 'PROTOTYPE' && Adapters.INTEGRATIONS.find(i => i.id === 'ELLIS').mode === 'SNAPSHOT (MCP)');
  });
  t('X18', 'Recording a fact requires the verifier to be the signed-in user and an evidence reference', ['M06-3', 'D-4'], a => {
    const st = fresh('SCM'); const c = st.commands; const claim = (by, ev) => ({ claimed: true, source: 'SCM', verified: { by, at: '2026-11-06', evidenceRef: ev } });
    a.deepEq(c.recordFact('hotel', 'H001', 'closure', claim('someone.else', 'DOC1')).errors, ['E_VERIFIER_MUST_BE_ACTOR']); a.deepEq(c.recordFact('hotel', 'H001', 'closure', claim('test.scm', '  ')).errors, ['E_EVIDENCE_REQUIRED']);
    a.eq(st.model().byContract['CT-KR-001'].rating.grade, 'B'); a.ok(c.recordFact('hotel', 'H001', 'closure', claim('test.scm', 'DOC-77')).ok); const v = st.model().byContract['CT-KR-001']; a.eq(v.rating.grade, 'D'); a.ok(v.alerts.some(x => x.ruleId === 'CLOSURE_CONFIRMED' && x.severity === 'CRITICAL')); a.ok(v.limit.topupHold);
    a.deepEq(c.recordFact('hotel', 'H001', 'closure', { claimed: true, source: 'NEWS', note: 'rumour', verified: null }).errors, ['E_VERIFIED_FACT_LOCKED']); a.eq(st.model().byContract['CT-KR-001'].rating.grade, 'D', 'an unevidenced claim cannot replace a verified fact');
    a.deepEq(c.recordFact('hotel', 'H001', 'closure', { retract: true, verified: { by: 'test.scm', evidenceRef: 'DOC-RETRACT' } }).errors, ['E_VERIFIED_FACT_LOCKED'], 'the same person cannot retract own verification'); st.setSession('test.scm2', 'SCM'); a.ok(c.recordFact('hotel', 'H001', 'closure', { retract: true, note: 'court notice withdrawn', verified: { by: 'test.scm2', evidenceRef: 'DOC-RETRACT' } }).ok); a.eq(st.model().byContract['CT-KR-001'].rating.grade, 'B', 'an evidenced retraction by a different person lifts the cap'); st.setSession('test.scm', 'SCM'); a.eq(c.recordFact('hotel', 'NOPE', 'closure', { claimed: true, source: 'SCM' }).errors[0], 'E_TARGET_UNKNOWN');
  });

  /* ---------------- Legacy regression ---------------- */
  const refDir = path.join(env.root, '..', 'reference', 'OMH-NICE'); const lf = f => crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  t('X11', 'Regression: legacy OMH-NICE partner module is byte-identical to repo HEAD 9edba87 and computes the same 12 results', ['R-1', 'R-2', 'T13'], a => {
    if (!fs.existsSync(path.join(env.root, 'legacy', 'app.js'))) a.skip('the legacy partner module is not part of this repository');
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/legacy_baseline.json'), 'utf8')); a.eq(fx.sourceCommit, '9edba87'); a.eq(legacyHash(), fx.sha256_lf, 'app.js identical to HEAD');
    for (const f of ['app.js', 'index.html', 'styles.css']) { a.ok(fs.existsSync(path.join(env.root, 'legacy', f)), f); a.eq(lf(path.join(env.root, 'legacy', f)), fx.sha256_lf_files[f], f + ' identical to repo HEAD (fixture hash)'); if (fs.existsSync(refDir)) a.eq(lf(path.join(env.root, 'legacy', f)), lf(path.join(refDir, f)), f + ' identical to reference clone'); }
    const { api, store } = loadLegacy(); a.eq(api.STORE_KEY, 'omh_prg_v42'); a.eq(api.DEFAULT_WEIGHTS.length, 14); a.eq(api.DEFAULT_WEIGHTS.reduce((x, y) => x + y, 0), 110); a.deepEq(api.DEFAULT_THRESHOLDS, { A: 85, B: 70, C: 55, D: 40 }); a.deepEq(api.recommendTerms(80), { deposit: 10000, days: 14 });
    const D = api.getData(); a.eq(D.companies.length, 12); a.eq(fx.rows.length, 12);
    for (const row of fx.rows) { const c = D.companies.find(x => x.id === row.id); const r = api.compute(c); a.eq(r.weighted, row.weighted, row.id); a.eq(r.scoreGrade, row.scoreGrade, row.id); a.eq(r.finalGrade, row.finalGrade, row.id); a.eq(r.exposure, row.exposure); a.eq(r.dFlags.length, row.dFlags); a.eq(r.cFlags.length, row.cFlags); a.eq(r.recDeposit, row.recDeposit); }
    a.eq(Object.keys(store).length, 0, 'legacy load wrote nothing in this harness');
    const w = D.companies.find(x => x.id === 'C003'); a.eq(Math.round(api.compute(w).weighted * 10) / 10, 78.7); a.eq(api.compute(D.companies.find(x => x.id === 'C012')).finalGrade, 'D');
    const idx = fs.readFileSync(path.join(env.root, 'index.html'), 'utf8'); a.ok(idx.includes('legacy/index.html'), 'new shell links to the preserved partner module');
  });
  t('X19', 'Hotel grades and partner grades are separate scales; the new app never imports or writes legacy state', ['M03-4', 'D-7'], a => {
    const code = walk(path.join(env.root, 'js'), []).filter(f => !/store\.js$/.test(f)).map(f => fs.readFileSync(f, 'utf8')).join('\n'); a.ok(!code.includes("'omh_prg_v42'") && !code.includes('"omh_prg_v42"'), 'legacy key not referenced as a string literal');
    a.eq(Store.DEFAULT_KEY, 'omh_hfr_v1'); a.ok(!Config.GRADES.includes('E'));
  });

  /* ---------------- Screens (Node render smoke) ---------------- */
  const BAD = /undefined|NaN|\[object|Infinity|>null</;
  const VIEWS = { dashboard: ViewsA.dashboard, status: ViewsA.status, profile: ViewsA.profile, ledger: ViewsB.ledger, risk: ViewsC.risk, approval: ViewsC.approvalPage, admin: ViewsC.admin };
  const mkctx = (st, params, ui) => ({ store: st, m: st.model(), ui: ui || { filters: {}, riskFilter: {} }, params: params || [], navigate() {}, rerender() {}, toast() {}, run() {} });
  t('V01', 'All 7 screens render for every role in KO and EN without undefined/NaN/[object]/Infinity', ['S01', 'S02', 'S03', 'S04', 'S05', 'S07', 'S08', 'UI-LANG'], a => {
    let n = 0;
    for (const lang of ['ko', 'en']) { UI.setLang(lang); for (const role of RBAC.ROLES) { const st = fresh(role); for (const [name, fn] of Object.entries(VIEWS)) { const html = fn(mkctx(st, [], name === 'approval' || name === 'profile' ? { filters: {}, simAmount: '1000000' } : null)); n++; a.ok(typeof html === 'string' && html.length > 200, name); a.ok(!BAD.test(html), lang + '/' + role + '/' + name + ' -> ' + (html.match(BAD) || [''])[0] + ' ... ' + (html.slice(Math.max(0, html.search(BAD) - 60), html.search(BAD) + 40))); } } }
    UI.setLang('ko'); a.eq(n, 56);
  });
  t('V02', 'Per-contract screens (profile with its top-up simulator, ledger, approval packet) render for all 20 contracts incl. NR / D / deposit / no-data cases, KO and EN', ['S02', 'S03', 'S04', 'S07', 'UI-EMPTY'], a => {
    const st = fresh('SCM'); for (const lang of ['ko', 'en']) { UI.setLang(lang); for (const c of st.state.contracts) { for (const [name, fn] of [['profile', ViewsA.profile], ['ledger', ViewsB.ledger], ['approval', ViewsC.approvalPage]]) { const ui = { filters: {}, simAmount: '1000' + (c.currency === 'USD' || c.currency === 'SGD' ? '.50' : '') }; const html = fn(mkctx(st, [c.contractId], ui)); a.ok(!BAD.test(html), lang + ' ' + name + ' ' + c.contractId + ' ' + (html.match(BAD) || [''])[0]); a.ok(html.includes(c.contractId)); } } } UI.setLang('ko');
    const html = ViewsA.profile(mkctx(st, ['CT-NOPE'])); a.ok(html.includes('empty-state'), 'unknown contract -> empty state, not a crash');
  });
  t('V03', 'Dashboard filters (country/entity/currency/type) drive KPIs; empty filter combination yields empty state; control labels show currency & as-of date', ['S01', 'UI-FILTER', 'UI-EMPTY'], a => {
    const st = fresh('CEO'); UI.setLang('en'); const ui = { filters: { country: 'JP' } }; const h1 = ViewsA.dashboard(mkctx(st, [], ui)); a.ok(h1.includes('7 contracts · 6 hotels'), 'JP filter KPI text'); a.ok(ViewsA.status(mkctx(st, [], ui)).includes('sample-tag'), 'hotel names on the status board carry a SAMPLE tag');
    const k = Model.kpis(st.model().views, { country: 'JP' }); a.eq(k.count, 7); a.deepEq(Object.keys(k.exposure).sort(), ['JPY']); const k2 = Model.kpis(st.model().views, { country: 'KR', currency: 'JPY' }); a.eq(k2.count, 0); a.deepEq(k2.exposure, {});
    const h2 = ViewsA.status(mkctx(st, [], { filters: { country: 'KR', currency: 'JPY' } })); a.ok(h2.includes('No data to display')); a.ok(h2.includes('2026-11-06') && h2.includes('no FX conversion'));
    const k3 = Model.kpis(st.model().views, { entity: 'OMH-VN' }); a.eq(k3.count, 3); const kHq = Model.kpis(st.model().views, { entity: 'OMH-SG' }); a.eq(kHq.count, 7); a.deepEq(Object.keys(kHq.exposure).sort(), ['HKD', 'JPY', 'KRW', 'SGD', 'THB', 'TWD', 'VND'], 'the head office holds every currency'); a.eq(kHq.exposure.SGD, 6000000); const k4 = Model.kpis(st.model().views, { type: 'SECURITY_DEPOSIT' }); a.eq(k4.count, 1); a.eq(k4.estimatedUnused.VND, undefined, 'deposit has no consumption-based unused estimate'); a.eq(k4.estimatedUnusedUnknown, 1); UI.setLang('ko');
  });
  t('V03b', 'Grade distribution counts hotels, not contracts: a hotel with several contracts is counted once at its lowest grade', ['S01', 'UI-FILTER'], a => {
    const k = Model.kpis(fresh('SCM').model().views);                                                      // sample: 20 contracts in 19 hotels; only H004 has two contracts (both B)
    a.deepEq(k.grades, { A: 0, B: 13, C: 3, D: 2, NR: 2 }, 'contract counts are unchanged'); a.deepEq(k.hotelGrades, { A: 0, B: 12, C: 3, D: 2, NR: 2 });
    const st2 = fresh('SCM'); a.ok(st2.commands.recordFact('contract', 'CT-JP-001', 'refundRefused', { claimed: true, source: 'SCM', verified: { by: 'test.scm', evidenceRef: 'EML-9001' } }).ok);      // one of H004's two contracts drops to D
    const k2 = Model.kpis(st2.model().views); a.deepEq(k2.grades, { A: 0, B: 12, C: 3, D: 3, NR: 2 }); a.deepEq(k2.hotelGrades, { A: 0, B: 11, C: 3, D: 3, NR: 2 }, 'H004 is counted once, at its lowest grade (D)');
    a.eq(Object.values(k.hotelGrades).reduce((x, y) => x + y, 0), k.hotels, 'every hotel appears exactly once');
    const fake = (hotelId, grade) => ({ hotelId, hotel: { country: 'KR' }, contract: { omhEntity: 'OMH-KR', prepaymentType: 'FLOATING' }, currency: 'KRW', rating: { grade }, balance: { closingMinor: 0 }, limit: { overLimitMinor: 0, recommendedLimitMinor: 0 }, forecast: { status: 'OK', estimatedUnusedAtEndMinor: 0 }, derived: { refundPending: false }, liveAlerts: [], contractId: hotelId + grade });
    const g = Model.kpis([fake('X', 'C'), fake('X', 'NR'), fake('Y', 'NR'), fake('Y', 'D'), fake('Z', 'A'), fake('Z', 'A'), fake('W', 'B'), fake('W', 'A')]).hotelGrades;
    a.deepEq(g, { A: 1, B: 1, C: 0, D: 1, NR: 1 }, 'unrated is worse than C; D is worse than unrated; B is worse than A');
  });
  t('V03c', 'Country card: the prepayment balance is shown as a total split into prebuy, hard block and other, in the one currency of the country', ['S01', 'S02'], a => {
    const st = fresh('CEO'); UI.setLang('en'); const html = ViewsA.dashboard(mkctx(st, [], { filters: {} }));
    const card = c => { const i = html.indexOf('<div class="card ccard"><div class="ch"><b>' + c + '</b>'); const j = html.indexOf('<div class="card ccard">', i + 10); return html.slice(i, j < 0 ? html.length : j); };
    const kr = card('Korea'), jp = card('Japan'), vn = card('Vietnam');
    for (const s of ['128,200,000 KRW', '126,700,000 KRW', '1,500,000 KRW']) a.ok(kr.includes(s), 'Korea ' + s);           // 45+30+46+5.7 prebuy, 1.5 hard block (hand-added)
    a.ok(!/JPY|VND|USD|SGD/.test(kr.slice(0, kr.indexOf('High-risk'))), 'Korea balance is won only');
    for (const s of ['78,650,000 JPY', '47,000,000 JPY', '1,650,000 JPY', '30,000,000 JPY']) a.ok(jp.includes(s), 'Japan ' + s);     // 47M prebuy, 1.65M hard block, 30M buyout under "other"
    a.ok(jp.includes('Other (buyout') && !kr.includes('Other (buyout'), 'the "other" line appears only where something is in it'); a.ok(/Prebuy/.test(vn) && /Hard block/.test(vn));
    UI.setLang('ko');
  });
  t('V04', 'XSS: hostile text from CSV / notes / names is HTML-escaped everywhere it is rendered', ['D-8', 'T12'], a => {
    const evil = '<img src=x onerror=alert(1)>'; const st = fresh('SCM'); a.ok(st.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1000, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00', externalRef: evil }).ok);
    st.commands.setOpinion('CT-KR-001', evil); st.commands.updateAlert('CONSUMPTION_COLLAPSE:CT-KR-003', 'ACKNOWLEDGED', evil); st.state.hotels[0].name = { ko: evil, en: evil };
    for (const [name, fn, p, mustShow] of [['ledger', ViewsB.ledger, ['CT-KR-001'], true], ['profile', ViewsA.profile, ['CT-KR-001'], true], ['risk', ViewsC.risk, [], false], ['dashboard', ViewsA.dashboard, [], false], ['status', ViewsA.status, [], true], ['approval', ViewsC.approvalPage, ['CT-KR-001'], true]]) { const html = fn(mkctx(st, p, { filters: {}, simAmount: '100' })); a.ok(!html.includes('<img src=x'), name + ' leaked raw tag'); if (mustShow) a.ok(html.includes('&lt;img src=x'), name + ' shows the text escaped'); }
    a.eq(UI.esc('<a href="x" onclick=\'y\'>&'), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;'); a.eq(UI.esc(null), '');
  });
  t('V05', 'Read-only roles see disabled controls; writers see enabled ones', ['D-4', 'S03', 'S08'], a => {
    const dis = (role, fn, p) => { const html = fn(mkctx(fresh(role), p || [])); return (html.match(/<button[^>]*data-act="(add-tx|csv-commit|save-scores|cfg-save|add-conf)"[^>]*>/g) || []).map(b => /disabled/.test(b)); };
    a.ok(dis('VIEWER', ViewsB.ledger, ['CT-KR-001']).every(Boolean) && dis('VIEWER', ViewsB.ledger, ['CT-KR-001']).length >= 3); a.ok(dis('SCM', ViewsB.ledger, ['CT-KR-001']).every(x => !x)); a.ok(dis('CEO', ViewsB.ledger, ['CT-KR-001']).every(Boolean), 'CEO cannot post ledger rows');
    a.ok(dis('SCM', ViewsC.admin).every(Boolean) && dis('ADMIN', ViewsC.admin).every(x => !x)); a.ok(dis('SCM', ViewsA.profile, ['CT-KR-001']).every(x => !x) && dis('VIEWER', ViewsA.profile, ['CT-KR-001']).every(Boolean));
    UI.setLang('en'); const aud = r => ViewsC.admin(mkctx(fresh(r))).includes('chain intact'); a.ok(!aud('SCM') && !aud('VIEWER') && aud('CEO') && aud('ADMIN')); UI.setLang('ko');
  });

  /* ---------------- Performance ---------------- */
  t('P01', 'Performance: 208-contract portfolio computes < 2 s; 2,000-row CSV validates + commits < 3 s; no state growth on recompute', ['PERF'], a => {
    const s = Seed.buildSeed(); const big = env.clone(s); big.ledger = s.ledger.slice(); big.hotels = []; big.contracts = []; big.ledger = []; big.confirmations = []; big.ratings = {}; big.sales = {};
    for (let k = 0; k < 13; k++) { const sx = (id) => id + '~' + k; for (const x of s.hotels) big.hotels.push(Object.assign({}, env.clone(x), { hotelId: sx(x.hotelId), ellisHotelId: sx(x.ellisHotelId) })); for (const c of s.contracts) { big.contracts.push(Object.assign(env.clone(c), { contractId: sx(c.contractId), hotelId: sx(c.hotelId) })); big.ratings[sx(c.contractId)] = env.clone(s.ratings[c.contractId]); }
      for (const x of s.ledger) big.ledger.push(Object.freeze(Object.assign({}, x, { txId: sx(x.txId), contractId: sx(x.contractId) }))); for (const x of s.confirmations) big.confirmations.push(Object.assign({}, x, { contractId: sx(x.contractId) })); }
    big.alerts = []; const t0 = Date.now(); const m = Model.compute(big); const dt = Date.now() - t0; a.eq(m.views.length, 260); a.ok(dt < 2000, 'compute took ' + dt + 'ms'); const k0 = Date.now(); Model.kpis(m.views); a.ok(Date.now() - k0 < 500);
    const st = fresh('SCM'); let csv = 'contractId,type,amount,currency,occurredAt,externalRef\n'; for (let i = 0; i < 2000; i++) csv += 'CT-VN-001,TOPUP,' + (1000 + i) + ',VND,2026-11-0' + (1 + (i % 5)) + 'T10:00:00+09:00,BULK-' + i + '\n';
    const c0 = Date.now(); const r = st.commands.importCsv(csv, 'bulk.csv'); const cd = Date.now() - c0; a.ok(r.ok && r.committed === 2000, 'committed ' + r.committed); a.ok(cd < 3000, 'import took ' + cd + 'ms'); a.eq(st.model().byContract['CT-VN-001'].balance.topupsMinor, 600e6 * 3 + 300e6 + 2000 * 1000 + (1999 * 2000) / 2);
    const again = st.commands.importCsv(csv, 'bulk.csv'); a.eq(again.committed, 0); a.eq(again.summary.duplicate, 2000);
  });
  t('P02', 'Math robustness: BigInt-safe on very large amounts; no float drift on repeated postings', ['M02-2', 'PERF'], a => {
    const f = env.synth({ opening: 9e12, cons: [3e12, 3e12, 3e12] }); a.eq(f.view().balance.closingMinor, 0 + 9e12 - 9e12); const f2 = env.synth({ opening: 0, cons: [null, null, null] });
    for (let i = 0; i < 1000; i++) { Ledger.append(f2.state.ledger, { contractId: 'CT-T', currency: 'USD', type: 'TOPUP', amountMinor: 10, occurredAt: '2026-11-02T10:00:00+09:00', externalRef: 'u' + i }, f2.cx); }
    a.ok(f2.state.ledger.length === 1, 'USD tx rejected on KRW contract'); const f3 = env.synth({ ccy: 'USD', opening: 0, cons: [null, null, null] }); for (let i = 0; i < 1000; i++) Ledger.append(f3.state.ledger, { contractId: 'CT-T', currency: 'USD', type: 'TOPUP', amountMinor: 10, occurredAt: '2026-11-02T10:00:00+09:00', externalRef: 'u' + i }, f3.cx);
    a.eq(Ledger.balance(f3.state.ledger, 'CT-T').closingMinor, 10000, '1000 × $0.10 = $100.00 exactly'); a.eq(Money.format(10000, 'USD'), '100.00 USD');
  });
};
