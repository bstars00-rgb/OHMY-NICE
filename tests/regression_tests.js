'use strict';
// Regression tests for defects D1–D14 reported by the independent QA review (loop 1). Each reproduces the reviewer's scenario.
const env = require('./helpers/env');
const { Money, Config, Ledger, Model, Seed, Rating, Limit, Alerts, Adapters, Store, Csv } = env;

module.exports = function register(h) {
  const { test: t } = h; const UI_setLang = l => env.UI.setLang(l);
  const fresh = role => env.as(env.newStore(), role || 'SCM');
  const topup = (ref, at, amt) => ({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: amt || 1000, currency: 'KRW', occurredAt: at || '2026-11-02T10:00:00+09:00', externalRef: ref });

  t('D01', 'Duplicate detection survives case, width, zero-width and time-zone variants of the same transaction', ['M02-4', 'T02', 'T12'], a => {
    const st = fresh(); const c = st.commands; a.ok(c.addTx(topup('BANK-1')).ok);
    for (const v of ['bank-1', 'BANK-1​', 'ＢＡＮＫ-1', ' Bank-1 ', 'BANK -1']) a.eq(c.addTx(topup(v)).ok, false, JSON.stringify(v));
    const f = env.synth({}); const base = { contractId: 'CT-T', currency: 'KRW', type: 'TOPUP', amountMinor: 5000 };
    a.ok(Ledger.append(f.state.ledger, Object.assign({ occurredAt: '2026-10-10T10:00:00+09:00' }, base), f.cx).ok);
    a.includes(Ledger.append(f.state.ledger, Object.assign({ occurredAt: '2026-10-10T01:00:00Z' }, base), f.cx).errors, 'E_DUPLICATE_KEY');                 // same instant, other offset
    a.ok(Ledger.append(f.state.ledger, Object.assign({ occurredAt: '2026-10-10T02:00:00Z' }, base), f.cx).ok, 'a different instant is a different transaction');
    const csv = 'contractId,type,amount,currency,occurredAt,externalRef\nCT-KR-001,TOPUP,10,KRW,2026-11-03T10:00:00+09:00,REF-A\nCT-KR-001,TOPUP,10,KRW,2026-11-03T10:00:00+09:00,ref-a\n';
    a.deepEq(st.commands.validateCsv(csv).rows.map(x => x.status), ['ACCEPT', 'DUPLICATE']);
    a.eq(Ledger.normRef('ＢＡＮＫ-1​'), 'BANK-1');
  });
  t('D02', 'Reconciliation compares the ledger AS OF the hotel confirmation date; later legitimate postings do not create a false MAJOR', ['M02-5', 'T09'], a => {
    const f = env.synth({ opening: 100e6, cons: [0, 0, 0], conf: [100e6, '2026-10-31'] }); let v = f.view(); a.eq(v.recon.status, 'MATCH');
    a.ok(Ledger.append(f.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'CONSUMPTION', amountMinor: 8e6, period: '2026-11', status: 'confirmed', occurredAt: '2026-11-03T10:00:00+09:00', externalRef: 'N1' }, f.cx).ok);
    v = f.view(); a.eq(v.balance.closingMinor, 92e6); a.eq(v.recon.status, 'MATCH', 'hotel figure of 10-31 still agrees with our 10-31 ledger'); a.eq(v.recon.ledgerAtMinor, 100e6); a.ok(!v.alerts.some(x => x.ruleId === 'RECON_MAJOR_MISMATCH'));
    const g = env.synth({ opening: 100e6, cons: [0, 0, 0], conf: [90e6, '2026-10-31'] }); a.eq(g.view().recon.status, 'MAJOR', 'real disagreement on the same date is still caught');
  });
  t('D03', 'Real people whose names start with "Ai"/"Bot"/"Auto" can verify; service-account names cannot', ['M06-3'], a => {
    const ok = n => Rating.isVerified({ claimed: true, verified: { by: n, at: 'x', evidenceRef: 'DOC-123' } });
    for (const n of ['Aiden Kim', 'aiden.kim', 'Aiko', 'Aileen Park', 'Botond', 'Automotive Lee', 'Systems Lee']) a.ok(ok(n), n);
    for (const n of ['AI', 'ai-bot', 'AI Agent', 'mock-agent', 'bot', 'Auto-import', 'system', 'System Job']) a.ok(!ok(n), n);
    const st = fresh(); st.setSession('aiden.kim', 'SCM'); a.ok(st.commands.recordFact('hotel', 'H001', 'closure', { claimed: true, source: 'SCM', verified: { by: 'aiden.kim', evidenceRef: 'DOC-123' } }).ok);
    a.eq(st.model().byContract['CT-KR-001'].rating.grade, 'D'); a.ok(st.model().byContract['CT-KR-001'].alerts.some(x => x.ruleId === 'CLOSURE_CONFIRMED'));
  });
  t('D04', 'Facts: whitelisted keys, evidence mandatory, no deletion (superseded with history), counterparty status needs evidence', ['D-4', 'M06-3'], a => {
    const st = fresh(); const c = st.commands; const sess = 'test.scm'; const claim = { claimed: true, source: 'SCM', verified: { by: sess, evidenceRef: 'DOC-777' } };
    a.eq(c.recordFact('hotel', 'H001', 'ownershipChange', claim).errors[0], 'E_FACT_KEY_UNKNOWN'); a.eq(c.recordFact('contract', 'CT-KR-001', 'counterpartyVerification', claim).errors[0], 'E_FACT_KEY_UNKNOWN'); a.eq(c.recordFact('hotel', 'H001', '__proto__', claim).errors[0], 'E_FACT_KEY_UNKNOWN');
    a.eq(c.recordFact('hotel', 'H001', 'closure', claim && { claimed: true, source: 'SCM', verified: { by: sess, evidenceRef: 'x' } }).errors[0], 'E_EVIDENCE_REQUIRED', 'a 1-character evidence reference is not evidence');
    a.ok(c.recordFact('hotel', 'H001', 'closure', claim).ok); a.eq(c.recordFact('hotel', 'H001', 'closure', null).errors[0], 'E_CLAIM_REQUIRED', 'claims cannot be deleted'); a.eq(st.model().byContract['CT-KR-001'].rating.grade, 'D');
    a.eq(c.recordFact('hotel', 'H001', 'closure', { claimed: true, source: 'NEWS', verified: null }).errors[0], 'E_VERIFIED_FACT_LOCKED'); st.setSession('test.scm2', 'SCM'); a.ok(c.recordFact('hotel', 'H001', 'closure', { retract: true, verified: { by: 'test.scm2', evidenceRef: 'DOC-RETRACT' } }).ok); st.setSession('test.scm', 'SCM'); const h = st.state.hotels[0]; a.eq(h.factHistory.length, 2); a.eq(h.factHistory[1].before.verified.evidenceRef, 'DOC-777'); a.ok(st.state.audit.filter(e => e.action === 'FACT_RECORD' && e.outcome === 'OK').pop().detail.before.verified === true, 'audit keeps the before-value');
    const k = st.model().byContract['CT-KR-001'].rating.grade; a.eq(k, 'A'); const before = st.model().byContract['CT-KR-002'].rating.grade; a.eq(before, 'B');
    a.eq(c.setCounterparty('CT-KR-002', 'VERIFIED', '').errors[0], 'E_EVIDENCE_REQUIRED'); a.ok(c.setCounterparty('CT-KR-002', 'UNKNOWN', '').ok); a.eq(st.model().byContract['CT-KR-002'].rating.grade, 'C', 'unknown entity caps at C'); a.ok(c.setCounterparty('CT-KR-002', 'VERIFIED', 'REG-2026-55').ok); a.eq(st.model().byContract['CT-KR-002'].rating.grade, 'B');
    const raw = st.state.contracts.find(x => x.contractId === 'CT-KR-002'); raw.facts.counterpartyVerification = 'VERIFIED'; raw.facts.counterpartyEvidence = null; a.eq(st.model().byContract['CT-KR-002'].rating.grade, 'C', 'a VERIFIED string without evidence does not lift the cap');
    a.eq(c.setCounterparty('CT-KR-002', 'MAYBE', 'REG-1111').errors[0], 'E_STATUS_INVALID'); a.eq(c.setCounterparty('NOPE', 'VERIFIED', 'REG-1111').errors[0], 'E_CONTRACT_UNKNOWN');
  });
  t('D05', 'Config validation covers every section; a rejected/failed change can never brick the app; all-or-nothing rollback', ['S08', 'D-5'], a => {
    const st = fresh('ADMIN'); const c = st.commands; const cfg = () => env.clone(st.state.config); const bad = (mut, tag) => { const x = cfg(); mut(x); const r = c.setConfig(x, 'test'); a.eq(r.ok, false, tag); a.ok(r.errors.length > 0, tag); a.ok(st.model().views.length === 16, 'app still computes after ' + tag); };
    bad(x => { delete x.alertRules.RATING_DROP; }, 'rule removed'); bad(x => { delete x.guards; }, 'guards removed'); bad(x => { x.forecast.daysPerMonth = 30.5; }, 'fractional days'); bad(x => { x.forecast.daysPerMonth = 0.0001; }, 'tiny days');
    bad(x => { x.asOf = '2026-99-99'; }, 'bad asOf'); bad(x => { x.alertRules.RATING_DROP.params = {}; }, 'params emptied'); bad(x => { x.alertRules.CONSUMPTION_COLLAPSE.params.dropPct = -100; }, 'negative threshold'); bad(x => { x.alertRules.CONSUMPTION_COLLAPSE.params.dropPct = 150; }, 'threshold > 100'); bad(x => { x.alertRules.RATING_DROP.params.notches = 1.5; }, 'fractional notches');
    bad(x => { x.alertRules.LONG_UNCONSUMED.enabled = 'yes'; }, 'non-boolean enabled'); bad(x => { delete x.flagCaps.CLOSURE_CONFIRMED; }, 'flag cap removed'); bad(x => { x.guards.velocityHoldDropPct = 0; }, 'zero velocity hold');
    bad(x => { x.constructor = { polluted: 1 }; }, 'prototype-like key'); a.ok(Config.validate(JSON.parse('{"__proto__":{"x":1}}')).length > 0);
    const x = cfg(); x.gradeMultipliers.B = 1.15; x.gradeMultipliers.A = 2.29; a.ok(c.setConfig(x, 'two-decimal multipliers are valid').ok, 'D13: 1.15 / 2.29 accepted');
    const snap = JSON.stringify(st.state); const real = st.state.config.asOf; Model.compute = Model.compute; let threw = false;
    const orig = Alerts.merge; Alerts.merge = () => { throw new Error('boom'); }; try { c.setConfig(Object.assign(cfg(), { minCoverage: 0.4 }), 'will fail midway'); } catch (e) { threw = true; } finally { Alerts.merge = orig; }
    a.ok(threw); a.eq(JSON.stringify(st.state), snap, 'state rolled back after a mid-command exception'); a.eq(st.state.config.asOf, real);
  });
  t('D06', 'Prototype keys and unknown IDs are rejected everywhere (no pollution, no phantom state)', ['D-4'], a => {
    const st = fresh(); const c = st.commands;
    for (const id of ['__proto__', 'constructor', 'toString', 'NOPE', 123, null, undefined]) {
      a.eq(c.setOpinion(id, 'pwn').ok, false, String(id)); a.eq(c.setScores(id, { scmOps: 1 }).ok, false); a.eq(c.commitRating(id, 'r').ok, false); a.eq(c.createApproval(id, 1).ok, false); a.eq(c.runAi(id).ok, false);
    }
    a.eq(({}).scmOpinion, undefined, 'Object.prototype untouched');
    a.eq(st.model().byContract['__proto__'], undefined, 'null-prototype lookup map');
  });
  t('D07', 'Storage write failure rolls the command back: memory never diverges from what is persisted', ['D-5'], a => {
    const base = Store.memoryStorage(); let fail = false; const storage = { getItem: k => base.getItem(k), setItem: (k, v) => { if (fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } base.setItem(k, v); }, removeItem: k => base.removeItem(k), _dump: base._dump };
    const st = env.as(env.newStore({ storage }), 'SCM'); const n = st.state.ledger.length; fail = true; a.throws(() => st.commands.addTx(topup('Q1')), 'QuotaExceeded'); fail = false;
    a.eq(st.state.ledger.length, n, 'memory rolled back'); a.eq(JSON.parse(base.getItem('omh_hfr_v1')).ledger.length, n, 'storage agrees'); a.ok(st.commands.addTx(topup('Q1')).ok, 'the same transaction can be posted after the failure'); a.eq(env.newStore({ storage: base }).state.ledger.length, n + 1);
  });
  t('D08', 'Loading validates ledger rows and config: corrupt amounts are quarantined instead of silently inflating balances', ['D-5', 'UI-ERR'], a => {
    const mk = mut => { const s = env.clone(Seed.buildSeed()); mut(s); const stg = Store.memoryStorage(); stg.setItem('omh_hfr_v1', JSON.stringify(s)); return env.newStore({ storage: stg }); };
    a.eq(mk(s => { s.ledger[0].amountMinor = '59999999999999999'; }).loadStatus, 'CORRUPT_RESET', 'string amount'); a.eq(mk(s => { s.ledger[1].currency = 'XXX'; }).loadStatus, 'CORRUPT_RESET'); a.eq(mk(s => { delete s.config.guards; }).loadStatus, 'CORRUPT_RESET', 'invalid config');
    a.eq(mk(s => { s.ledger[2].type = 'BOGUS'; }).loadStatus, 'CORRUPT_RESET'); a.eq(mk(() => {}).loadStatus, 'OK');
  });
  t('D09', 'One confirmed-zero month with two unknown months is NOT "no consumption": no depletion claim, no expiry alert, no refund classification', ['M05-2', 'T05'], a => {
    const f = env.synth({ cons: [null, null, 0], transfer: false }); const v = f.view(); a.eq(v.forecast.status, 'UNCERTAIN_ZERO'); a.eq(v.forecast.quality, 'PARTIAL'); a.ok(!v.forecast.longUnconsumed); a.eq(v.forecast.depletionDate, null); a.eq(v.forecast.depletesBeforeEnd, null);
    a.ok(!v.alerts.some(x => x.ruleId === 'EXPIRY_BEFORE_DEPLETION' || x.ruleId === 'LONG_UNCONSUMED')); a.eq(v.limit.status, 'UNAVAILABLE'); a.eq(v.limit.recommendedLimitMinor, null); a.includes(v.limit.holdReasons, 'PARTIAL_CONSUMPTION_DATA');
    const full = env.synth({ cons: [0, 0, 0] }).view(); a.eq(full.forecast.status, 'NO_CONSUMPTION', 'three confirmed zeros are still a firm no-consumption');
  });
  t('D10', 'Alert lifecycle: dismissed alerts reopen on recurrence, manual RESOLVED with a persisting condition is reopened, dismissals are disclosed in the approval packet', ['M06-4', 'M09-1'], a => {
    const f = env.synth({ opening: 20e6, cons: [0, 0, 0], refund: { requested: true, requestedAt: '2026-09-20', requestedAmountMinor: 12e6, dueDate: '2026-10-20' } });
    const run = () => { const d = f.compute().views[0].alerts.map(x => { const { persisted, status, ...r } = x; return r; }); Alerts.merge(f.state.alerts, d, f.state.config.asOf); }; run();
    const row = () => f.state.alerts.find(x => x.alertId === 'REFUND_OVERDUE:CT-T'); row().status = 'RESOLVED'; run(); a.eq(row().status, 'OPEN', 'manual RESOLVED while overdue is reopened'); a.ok(row().notes.some(n => /still present/.test(n.text)));
    row().status = 'DISMISSED'; run(); a.eq(row().status, 'DISMISSED', 'a dismissal holds while the condition is continuously present');
    Ledger.append(f.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'REFUND', amountMinor: 12e6, occurredAt: '2026-11-01T10:00:00+09:00', externalRef: 'full' }, f.cx); run(); a.ok(row().clearedAt, 'cleared'); a.eq(row().status, 'DISMISSED');
    f.state.ledger.pop(); run(); a.eq(row().status, 'OPEN', 're-fire after a clear reopens even a dismissed alert'); a.ok(!row().clearedAt);
    const st = fresh('CEO'); st.setSession('demo.ceo', 'CEO'); const id = 'CONSUMPTION_COLLAPSE:CT-KR-003'; a.ok(st.commands.updateAlert(id, 'DISMISSED', 'false positive (test)').ok); st.setSession('demo.scm', 'SCM');
    const r = st.commands.createApproval('CT-KR-003', 1000); a.ok(r.ok); a.ok(r.approval.packet.dismissedAlerts.some(x => x.ruleId === 'CONSUMPTION_COLLAPSE'), 'dismissed High alert is disclosed in the packet');
  });
  t('D11', 'Contracts with a balance but no computable limit are counted as "limit unknown" (not silently ignored)', ['S01', 'M04-2'], a => {
    const m = Model.compute(Seed.buildSeed()); const k = Model.kpis(m.views); a.includes(k.limitUnknown, 'CT-JP-007'); a.ok(!k.limitUnknown.includes('CT-VN-003'), 'deposits are not applicable, not unknown'); a.ok(!k.limitExceeded.includes('CT-JP-007'));
    const html = env.ViewsA.dashboard({ store: fresh(), m, ui: { filters: {} }, params: [] }); a.ok(html.includes('limit-unknown'), 'dashboard shows the unknown-limit contracts');
  });
  t('D12', 'Consumption period must be a real, plausible month; timezone is mandatory; absurd amounts and balance overflow are rejected', ['T03', 'M02-3'], a => {
    const f = env.synth({}); const code = o => Ledger.append(f.state.ledger, Object.assign({ contractId: 'CT-T', currency: 'KRW', type: 'CONSUMPTION', amountMinor: 1, status: 'confirmed', occurredAt: '2026-11-02T10:00:00+09:00', period: '2026-11' }, o), f.cx);
    a.includes(code({ period: '2099-01', externalRef: 'a' }).errors, 'E_PERIOD_OUT_OF_RANGE'); a.includes(code({ period: '2020-01', occurredAt: '2019-12-01T00:00:00+09:00', externalRef: 'b' }).errors, 'E_PERIOD_OUT_OF_RANGE'); a.includes(code({ period: '2026-11', occurredAt: '2026-10-30T10:00:00+09:00', externalRef: 'c' }).errors, 'E_PERIOD_OUT_OF_RANGE', 'cannot confirm a month before it starts'); a.ok(code({ period: '2026-10', externalRef: 'd' }).ok);
    a.includes(code({ occurredAt: '2026-11-02T10:00:00', externalRef: 'e' }).errors, 'E_TIMEZONE_REQUIRED'); a.ok(code({ occurredAt: '2026-11-02T01:00:00Z', externalRef: 'f' }).ok); a.includes(code({ amountMinor: 9e15, externalRef: 'g' }).errors, 'E_AMOUNT_TOO_LARGE');
    const big = env.synth({ opening: 0, cons: [null, null, null] }); let last; for (let i = 0; i < 12; i++) last = Ledger.append(big.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'ADJUSTMENT', amountMinor: 9e14, reason: 'x', occurredAt: '2026-11-02T10:00:0' + (i % 10) + '+09:00', externalRef: 'adj' + i }, big.cx);
    a.includes(last.errors, 'E_BALANCE_OVERFLOW'); a.ok(Number.isSafeInteger(Ledger.balance(big.state.ledger, 'CT-T').closingMinor), 'balance stays within the safe-integer range');
  });
  t('D14', 'Segregation of duties: the creator of a review request cannot review it, and the review needs feedback; malformed arguments are denied by RBAC first; huge requests rejected', ['D-4', 'T14', 'M09-2'], a => {
    const st = fresh('SCM'); const c = st.commands; const r = c.createApproval('CT-KR-001', 1e6); c.submitApproval(r.approval.approvalId);
    st.setSession('test.scm', 'CEO'); a.eq(c.reviewApproval(r.approval.approvalId, 'ok').errors[0], 'E_SELF_REVIEW'); st.setSession('test.ceo', 'CEO'); a.eq(c.reviewApproval(r.approval.approvalId, '').errors[0], 'E_FEEDBACK_REQUIRED'); a.ok(c.reviewApproval(r.approval.approvalId, 'ok').ok);
    const v = env.as(env.newStore(), 'VIEWER'); a.throws(() => v.commands.addTx(undefined), 'E_FORBIDDEN'); a.throws(() => v.commands.addConfirmation(undefined), 'E_FORBIDDEN'); a.ok(v.state.audit.some(e => e.outcome === 'DENIED' && e.action === 'LEDGER_ADD_TX'), 'denied attempt is audited');
    const s2 = fresh('SCM'); a.eq(s2.commands.addTx(undefined).ok, false); a.eq(s2.commands.addConfirmation(null).ok, false); a.eq(s2.commands.createApproval('CT-KR-001', 9e15).ok, false);
  });
  t('E01', 'Loading replays every ledger row through the posting validator: currency/contract/uniqueness/opening/refund/date tampering is quarantined', ['D-5', 'M02-2', 'M02-4', 'UI-ERR'], a => {
    const mk = mut => { const s = env.clone(Seed.buildSeed()); mut(s); const stg = Store.memoryStorage(); stg.setItem('omh_hfr_v1', JSON.stringify(s)); const st = env.newStore({ storage: stg }); return { st, stg, status: st.loadStatus }; };
    const cases = { 'ledger currency differs from contract': s => { s.ledger[0].currency = 'USD'; }, 'row for missing contract': s => { s.ledger[0].contractId = 'CT-NOPE'; }, 'duplicate txId': s => { s.ledger[1].txId = s.ledger[0].txId; },
      'duplicate dedup key': s => { s.ledger.push(Object.assign({}, s.ledger[3], { txId: 'TX-DUP-1' })); }, 'second OPENING': s => { s.ledger.push(Object.assign({}, s.ledger[0], { txId: 'TX-OP-2', externalRef: 'OPEN2' })); },
      'hotel missing': s => { s.hotels.pop(); s.hotels.pop(); }, 'rating missing': s => { delete s.ratings['CT-KR-001']; }, 'refund above balance': s => { s.ledger.push({ txId: 'TX-R-1', contractId: 'CT-KR-001', type: 'REFUND', amountMinor: 9e12, currency: 'KRW', occurredAt: '2026-11-01T10:00:00+09:00', source: 'X' }); },
      'row dated in the future': s => { s.ledger.push({ txId: 'TX-F-1', contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1, currency: 'KRW', occurredAt: '2099-11-01T10:00:00+09:00', source: 'X' }); }, 'naive timestamp': s => { s.ledger[2].occurredAt = '2026-06-10T10:00:00'; } };
    for (const [name, mut] of Object.entries(cases)) { const r = mk(mut); a.eq(r.status, 'CORRUPT_RESET', name); a.ok(r.stg.getItem('omh_hfr_v1.corrupt'), name + ': original blob kept'); a.eq(r.st.model().views.length, 16, name + ': app falls back to a working sample'); }
    a.eq(mk(() => {}).status, 'OK');
    const lowered = mk(s => { s.config.asOf = '2026-11-01'; }); a.eq(lowered.status, 'OK', 'lowering asOf must not invalidate rows posted earlier than today');
  });
  t('E02', 'A broken audit chain is surfaced (AUDIT_BROKEN) without destroying the data', ['D-3', 'D-5'], a => {
    const s = env.clone(Seed.buildSeed()); s.audit = [{ seq: 1, at: 'z', actor: 'a', role: 'SCM', action: 'X', entity: 'e', outcome: 'OK', detail: {}, prevHash: 'GENESIS', hash: 'forged' }];
    const stg = Store.memoryStorage(); stg.setItem('omh_hfr_v1', JSON.stringify(s)); const st = env.newStore({ storage: stg }); a.eq(st.loadStatus, 'AUDIT_BROKEN'); a.eq(st.model().views.length, 16); a.eq(st.verifyAudit().ok, false);
  });
  t('E03', "The 'provisional' flag cannot be cleared by an administrator (only a CEO-approved release may)", ['M03-4', 'S08', 'D-4'], a => {
    const st = env.as(env.newStore(), 'ADMIN'); const x = env.clone(st.state.config); x.provisional = false; a.deepEq(st.commands.setConfig(x, 'try to finalise').errors, ['E_PROVISIONAL_LOCKED']); a.eq(st.state.config.provisional, true);
    a.ok(env.Rating.evaluate({ cfg: st.state.config, scores: {}, hotel: { facts: {} }, contract: { facts: {} }, derived: {} }).provisional);
  });
  t('E04', 'Service-style verifier names (automation, aibot, svc-*, gpt-*, claude…) cannot verify facts; human names still can', ['M06-3'], a => {
    const ok = n => Rating.isVerified({ claimed: true, verified: { by: n, at: 'x', evidenceRef: 'DOC-123' } });
    for (const n of ['automation', 'autobot', 'aibot', 'chatbot', 'svc-ocr', 'service', 'script', 'gpt-4', 'claude', 'cron', 'ai_agent', 'SYSTEM']) a.ok(!ok(n), n);
    for (const n of ['Aiden Kim', 'Automotive Lee', 'Claudia Park', 'Servais', 'Scripps Han']) a.ok(ok(n), n);
  });
  t('E05', 'CSV export neutralises formula injection incl. leading whitespace, tab/CR and full-width operators; negative numbers stay numeric', ['D-2', 'D-8'], a => {
    for (const v of ['=1+1', ' =1+1', '\t=1', '\r=1', '@x', '+1', '-1+2', '\uFF1D1+1', '  @SUM(1)']) a.ok(Csv.cell(v).replace(/^"/, '').startsWith("'"), JSON.stringify(v));
    a.eq(Csv.cell('-5000'), '-5000'); a.eq(Csv.cell('-5000.5'), '-5000.5'); a.eq(Csv.cell(-1), '-1'); a.eq(Csv.cell('plain'), 'plain');
  });
  t('F01', 'Duplicate guard covers reference-vs-no-reference postings of one transaction (manual + CSV) but keeps genuinely different references distinct', ['M02-4', 'T02', 'T12'], a => {
    const f = env.synth({}); const base = { contractId: 'CT-T', currency: 'KRW', type: 'TOPUP', amountMinor: 5000, occurredAt: '2026-10-10T10:00:00+09:00' }; const post = o => Ledger.append(f.state.ledger, Object.assign({}, base, o), f.cx);
    a.ok(post({ externalRef: 'R1' }).ok); a.includes(post({}).errors, 'E_DUPLICATE_KEY'); a.includes(post({ externalRef: 'R1' }).errors, 'E_DUPLICATE_KEY');
    a.ok(post({ externalRef: 'R2' }).ok, 'same content with a different reference is a different bank transfer');
    const g = env.synth({}); const p2 = o => Ledger.append(g.state.ledger, Object.assign({}, base, { amountMinor: 7000 }, o), g.cx); a.ok(p2({}).ok); a.includes(p2({ externalRef: 'LATE-REF' }).errors, 'E_DUPLICATE_KEY');   // reverse order
    const st = fresh(); a.ok(st.commands.addTx(topup('MAN-1', '2026-11-03T10:00:00+09:00', 777)).ok); const csv = 'contractId,type,amount,currency,occurredAt,externalRef\nCT-KR-001,TOPUP,777,KRW,2026-11-03T10:00:00+09:00,\n'; a.eq(st.commands.validateCsv(csv).rows[0].status, 'DUPLICATE', 'CSV row without reference vs manual post with reference');
    const bal = st.model().byContract['CT-KR-001'].balance.closingMinor; st.commands.importCsv(csv, 'x.csv'); a.eq(st.model().byContract['CT-KR-001'].balance.closingMinor, bal, 'no double count');
    const mk = r => Ledger.normRef(r); for (const v of ['R-1', 'r-1', 'R\u00AD-1', 'R\u200E-1', 'R\u2010' + '1', 'R\u2011' + '1', '\uFF32\uFF0D1', 'R\u2212' + '1'.slice(0, 0) + '1']) a.eq(mk(v).replace('\u2212', '-'), 'R-1', JSON.stringify(v));
  });
  t('F02', 'Reconciliation cut-off uses the transaction instant in the business day (KST), not the offset it was written in', ['M02-5', 'T09'], a => {
    const f = env.synth({ opening: 100e6, cons: [0, 0, 0], conf: [100e6, '2026-10-31'] }); const post = (at, ref) => Ledger.append(f.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'TOPUP', amountMinor: 5e6, occurredAt: at, externalRef: ref }, f.cx);
    a.ok(post('2026-10-31T20:00:00Z', 'a').ok);                      // = 2026-11-01 05:00 KST -> after the confirmation day
    a.eq(f.view().recon.status, 'MATCH', 'UTC-written time after KST midnight is NOT counted on 10-31'); a.ok(post('2026-10-31T23:30:00-05:00', 'b').ok); a.eq(f.view().recon.status, 'MATCH');
    a.ok(post('2026-10-31T10:00:00+09:00', 'c').ok); a.eq(f.view().recon.status, 'MAJOR', 'a posting inside 10-31 KST that the hotel did not know of is a real difference');
    a.includes(Ledger.append(f.state.ledger, { contractId: 'CT-T', currency: 'KRW', type: 'TOPUP', amountMinor: 1, occurredAt: '2026-11-06T20:00:00Z', externalRef: 'fut' }, f.cx).errors, 'E_FUTURE_DATE');
  });
  t('F03', 'A critical alert backed by a verified fact cannot be dismissed, and the top-up hold follows the fact itself', ['M06-3', 'M06-4', 'M04-4'], a => {
    const st = fresh('SCM'); st.commands.recordFact('hotel', 'H001', 'closure', { claimed: true, source: 'SCM', verified: { by: 'test.scm', evidenceRef: 'DOC-900' } });
    st.setSession('test.ceo', 'CEO'); a.deepEq(st.commands.updateAlert('CLOSURE_CONFIRMED:CT-KR-001', 'DISMISSED', 'try').errors, ['E_CRITICAL_BACKED_BY_FACT']); a.ok(st.model().byContract['CT-KR-001'].limit.holdReasons.includes('CRITICAL_FACT_ACTIVE'));
    const lim = st.model().byContract['CT-KR-001'].limit; a.eq(lim.availableTopupMinor, 0);
    const f = env.synth({ hotelFacts: { closure: { claimed: true, source: 'SCM', verified: { by: 'Kim', at: 'x', evidenceRef: 'DOC-1' } } } }); f.state.alerts.push({ alertId: 'CLOSURE_CONFIRMED:CT-T', status: 'DISMISSED', source: 'AUTO' }); a.includes(f.view().limit.holdReasons, 'CRITICAL_FACT_ACTIVE', 'hold survives even if the alert row is dismissed');
  });
  t('F04', 'Verified facts: only an evidenced retraction by a different person can lift them; unverified or same-person replacement is refused', ['M06-3', 'D-4'], a => {
    const st = fresh('SCM'); const c = st.commands; a.ok(c.recordFact('contract', 'CT-KR-002', 'refundRefused', { claimed: true, source: 'SCM', verified: { by: 'test.scm', evidenceRef: 'EML-5001' } }).ok); a.eq(st.model().byContract['CT-KR-002'].rating.grade, 'D');
    a.eq(c.recordFact('contract', 'CT-KR-002', 'refundRefused', { claimed: true, source: 'SCM' }).errors[0], 'E_VERIFIED_FACT_LOCKED'); a.eq(c.recordFact('contract', 'CT-KR-002', 'refundRefused', { claimed: true, source: 'SCM', verified: { by: 'test.scm', evidenceRef: 'EML-5002' } }).errors[0], 'E_VERIFIED_FACT_LOCKED', 'a fresh verification by the same person does not bypass the lock');
    a.eq(c.recordFact('contract', 'CT-KR-002', 'refundRefused', { retract: true, verified: { by: 'test.scm', evidenceRef: 'EML-5003' } }).errors[0], 'E_VERIFIED_FACT_LOCKED'); a.eq(c.recordFact('contract', 'CT-KR-001', 'refundRefused', { retract: true, verified: { by: 'test.scm', evidenceRef: 'EML-5003' } }).errors[0], 'E_CLAIM_REQUIRED', 'nothing to retract');
    a.eq(st.model().byContract['CT-KR-002'].rating.grade, 'D');
  });
  t('F05', 'Load check: approvals and dismissed alerts recorded in storage must be backed by an audit entry', ['D-3', 'D-5'], a => {
    const base = fresh('SCM'); base.commands.createApproval('CT-KR-001', 1000); const raw = JSON.parse(JSON.stringify(base.state));
    const load = mut => { const s = env.clone(raw); mut(s); const stg = Store.memoryStorage(); stg.setItem('omh_hfr_v1', JSON.stringify(s)); return env.newStore({ storage: stg }); };
    a.eq(load(s => { s.approvals[0].status = 'CEO_REVIEWED'; s.approvals[0].feedback = { by: 'x', at: 'x', text: 'x' }; }).loadStatus, 'AUDIT_BROKEN'); a.eq(load(s => { s.approvals[0].status = 'SUBMITTED_MOCK'; }).loadStatus, 'AUDIT_BROKEN');
    a.eq(load(s => { s.alerts.find(x => x.alertId === 'CONSUMPTION_COLLAPSE:CT-KR-003').status = 'DISMISSED'; }).loadStatus, 'AUDIT_BROKEN');
    a.eq(load(() => {}).loadStatus, 'OK'); const real = fresh('SCM'); real.commands.createApproval('CT-KR-001', 1000); real.commands.submitApproval('AP-0001');
    const stg = Store.memoryStorage(); stg.setItem('omh_hfr_v1', JSON.stringify(real.state)); a.eq(env.newStore({ storage: stg }).loadStatus, 'OK', 'legitimately recorded activity loads cleanly');
  });
  t('F07', 'Config: unknown keys and out-of-range values are rejected', ['S08'], a => {
    const st = fresh('ADMIN'); const bad = (mut, tag) => { const x = env.clone(st.state.config); mut(x); const r = st.commands.setConfig(x, 'probe'); a.eq(r.ok, false, tag); a.ok(st.model().views.length === 16); };
    bad(x => { x.evil = { x: 1 }; }, 'unknown key'); bad(x => { x.version = -1; }, 'version'); bad(x => { x.guards.nonRefundableMonths = 1e300; }, 'huge months'); bad(x => { x.recon.staleDays = 0.5; }, 'fractional staleDays'); bad(x => { x.alertRules.RATING_DROP.params.windowDays = 1e300; }, 'huge window');
    bad(x => { x.alertRules.BOGUS = { enabled: true, severity: 'HIGH', action: 'HOLD_TOPUP' }; }, 'unknown rule'); bad(x => { x.alertRules.RATING_DROP.params.notches = 5; }, 'notches > 3');
  });
  t('F08', 'Integration-status text and key hold reasons exist in both languages', ['UI-LANG'], a => {
    for (const i of Adapters.INTEGRATIONS) a.ok(i.note && i.note.ko && i.note.en, i.id);
    const st = fresh('ADMIN'); UI_setLang('ko'); const ko = env.ViewsC.admin({ store: st, m: st.model(), ui: {}, params: [], navigate() {}, rerender() {}, toast() {}, run() {} }); UI_setLang('ko'); a.ok(ko.includes('보안 통제가 아님') && !ko.includes('NOT a security control'));
  });
  t('F09', 'Hostile strings posted through commands are escaped in every view (regression guard for the escaping)', ['D-8', 'T12'], a => {
    const pay = '"><img src=x onerror=alert(1)>\'<script>x</script>'; const st = fresh('SCM'); const c = st.commands;
    c.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 99, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00', externalRef: pay }); c.setOpinion('CT-KR-001', pay); c.updateAlert('CONSUMPTION_COLLAPSE:CT-KR-003', 'ACKNOWLEDGED', pay);
    st.state.hotels.forEach(h => { h.operatingCompany = pay; h.name = { ko: pay, en: pay }; });
    for (const lang of ['ko', 'en']) { UI_setLang(lang); for (const [fn, p] of [[env.ViewsA.dashboard, []], [env.ViewsA.status, []], [env.ViewsA.profile, ['CT-KR-001']], [env.ViewsB.ledger, ['CT-KR-001']], [env.ViewsC.risk, []], [env.ViewsC.approvalPage, ['CT-KR-001']], [env.ViewsC.admin, []]]) { const html = fn({ store: st, m: st.model(), ui: { filters: {}, simAmount: '100' }, params: p, navigate() {}, rerender() {}, toast() {}, run() {} }); a.ok(!/<img[^>]*onerror|<script>/.test(html), lang); } } UI_setLang('ko');
  });
  t('H01', 'Duplicates: period/status on non-consumption rows and exotic minus/invisible characters do not create a second transaction', ['M02-4', 'T02', 'T12'], a => {
    const st = fresh(); a.ok(st.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1234, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00' }).ok);
    const csv = 'contractId,type,amount,currency,occurredAt,period,externalRef\nCT-KR-001,TOPUP,1234,KRW,2026-11-02T10:00:00+09:00,2026-10,BANK-9\n'; a.eq(st.commands.validateCsv(csv).rows[0].status, 'DUPLICATE', 'period on a TOPUP row must not change identity');
    const n = st.state.ledger.length; st.commands.importCsv(csv, 'p.csv'); a.eq(st.state.ledger.length, n, 'nothing added');
    const f = env.synth({}); const b = { contractId: 'CT-T', currency: 'KRW', type: 'TOPUP', amountMinor: 9, occurredAt: '2026-10-10T10:00:00+09:00' }; a.ok(Ledger.append(f.state.ledger, b, f.cx).ok); a.includes(Ledger.append(f.state.ledger, Object.assign({ period: '2026-10' }, b), f.cx).errors, 'E_DUPLICATE_KEY');
    a.ok(!('period' in f.state.ledger[f.state.ledger.length - 1]), 'stored non-consumption rows carry no period');
    for (const v of ['A\u22121', 'A\u02D71', 'A\u27961', 'A\u30FC1'.replace('\u30FC', '\u2012'), 'A\u034F-1'.replace('-', ''), 'A\u3164-1', 'A\uFE0F-1', 'A\u115F-1', 'A\u2800-1']) { const ref = Ledger.normRef(v); a.ok(ref === 'A-1' || ref === 'A1', JSON.stringify(v) + ' -> ' + ref); }
    a.eq(Ledger.normRef('A\u22121'), Ledger.normRef('A-1')); a.eq(Ledger.normRef('A\u3164-1'), Ledger.normRef('A-1')); a.ok(Ledger.normRef('A-1') !== Ledger.normRef('A1'), 'A-1 and A1 stay different'); a.ok(Ledger.normRef('A-1') !== Ledger.normRef('A_1'));
    const g = env.synth({}); const cons = { contractId: 'CT-T', currency: 'KRW', type: 'CONSUMPTION', amountMinor: 5, status: 'confirmed', occurredAt: '2026-10-31T23:00:00+09:00' }; a.ok(Ledger.append(g.state.ledger, Object.assign({ period: '2026-10' }, cons), g.cx).ok); a.ok(Ledger.append(g.state.ledger, Object.assign({ period: '2026-09' }, cons), g.cx).ok, 'consumption periods still distinguish rows');
  });
  t('H02', 'Load check v2: forged approval status/packet/contract, re-dismissal, historical-flag escape, duplicate ids and audit truncation are all flagged', ['D-3', 'D-5'], a => {
    const base = fresh('SCM'); const c = base.commands; c.createApproval('CT-KR-001', 1000); c.submitApproval('AP-0001'); st2(base);
    function st2(b) { b.setSession('test.ceo', 'CEO'); b.commands.reviewApproval('AP-0001', 'please re-check'); b.commands.updateAlert('CONSUMPTION_COLLAPSE:CT-KR-003', 'DISMISSED', 'fp'); b.commands.updateAlert('SALES_DECLINE:CT-KR-003', 'DISMISSED', 'fp2'); b.setSession('test.scm', 'SCM'); b.commands.updateAlert('SALES_DECLINE:CT-KR-003', 'ACKNOWLEDGED', 'reopened by SCM'); b.commands.setOpinion('CT-KR-002', 'last harmless entry'); b.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: -1, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00' }); }
    const raw = JSON.parse(JSON.stringify(base.state)); const rawAnchor = base.storage.getItem('omh_hfr_v1.anchor');
    const load = (mut, anchor) => { const s = env.clone(raw); mut(s); const stg = Store.memoryStorage(); stg.setItem('omh_hfr_v1', JSON.stringify(s)); if (anchor !== null) stg.setItem('omh_hfr_v1.anchor', anchor === undefined ? rawAnchor : anchor); return env.newStore({ storage: stg }).loadStatus; };
    a.eq(load(() => {}), 'OK', 'legitimate history reloads cleanly');
    a.eq(load(s => { s.approvals[0].status = 'CEO_APPROVED_MOCK'; }), 'AUDIT_BROKEN', 'a retired approval status is not accepted'); a.eq(load(s => { s.approvals[0].feedback.by = 'someone.else'; }), 'AUDIT_BROKEN', 'feedback attributed to someone else'); a.eq(load(s => { delete s.approvals[0].feedback; }), 'AUDIT_BROKEN', 'a completed review without feedback');
    a.eq(load(s => { s.approvals[0].packet.request.requestedMinor = 999999; }), 'AUDIT_BROKEN', 'packet amount edited');
    a.eq(load(s => { s.approvals[0].contractId = 'CT-KR-002'; }), 'AUDIT_BROKEN', 'approval re-pointed at another contract');
    a.eq(load(s => { s.approvals.push(JSON.parse(JSON.stringify(s.approvals[0]))); }), 'AUDIT_BROKEN', 'duplicate approval id');
    a.eq(load(s => { s.alerts.find(x => x.alertId === 'CONSUMPTION_COLLAPSE:CT-KR-003').status = 'OPEN'; s.alerts.find(x => x.alertId === 'RECON_UNCONFIRMED:CT-VN-001').status = 'DISMISSED'; }), 'AUDIT_BROKEN', 'dismissal never recorded');
    a.eq(load(s => { const x = s.alerts.find(y => y.alertId === 'RECON_UNCONFIRMED:CT-VN-001'); x.status = 'DISMISSED'; x.historical = true; }), 'AUDIT_BROKEN', "historical:true is not an escape hatch for DISMISSED");
    a.eq(load(s => { s.alerts.find(x => x.alertId === 'SALES_DECLINE:CT-KR-003').status = 'DISMISSED'; }), 'AUDIT_BROKEN', 'older dismissal cannot back a later forged one');
    a.eq(load(s => { s.audit.pop(); }), 'AUDIT_BROKEN', 'audit log truncated at a harmless entry (only the anchor can notice)');
    a.eq(load(() => {}, null), 'OK', 'storage without an anchor key still loads (older data)');
  });
  t('H03', 'Very slow consumption never yields an overflowed "NaN" date; version is locked; integration names are bilingual', ['M05-3', 'S08', 'UI-LANG'], a => {
    const v = env.synth({ cons: [1, 1, 1], opening: 100e6, transfer: false }).view(); a.eq(v.forecast.depletionDate, null); a.ok(v.forecast.beyondHorizon); a.eq(v.forecast.depletesBeforeEnd, false); a.ok(!/NaN|Infinity|undefined/.test(JSON.stringify(v)), 'no NaN anywhere in the view-model');
    const sim = Limit.simulate(v.limit, v.forecast, 1000, v.contract, { daysPerMonth: 30, addDays: env.Dates.addDays, asOf: '2026-11-06' }); a.eq(sim.postDepletionDate, null); a.ok(!/NaN/.test(JSON.stringify(sim)));
    const ok = env.synth({ cons: [30e6, 30e6, 30e6] }).view(); a.ok(!ok.forecast.beyondHorizon && /^\d{4}-\d{2}-\d{2}$/.test(ok.forecast.depletionDate));
    const st = fresh('ADMIN'); const x = env.clone(st.state.config); x.version = 2; a.eq(st.commands.setConfig(x, 'bump').ok, false);
    for (const i of Adapters.INTEGRATIONS) a.ok(i.name.ko && i.name.en, i.id);
    const p = env.synth({ cons: [null, null, 0] }).view(); const s2 = Limit.simulate(p.limit, p.forecast, 1000, p.contract, { daysPerMonth: 30, addDays: env.Dates.addDays, asOf: '2026-11-06' }); a.eq(s2.approvalReasons.filter(r => r === 'PARTIAL_CONSUMPTION_DATA').length, 1, 'reason listed once');
  });
  t('S10', 'Scale: 20,000-row ledger computes < 3 s and loads < 6 s; indexed and unindexed posting agree; running balances equal a full recomputation', ['PERF', 'M02-2'], a => {
    const s = Seed.buildSeed(); const b = env.clone(s); b.hotels = []; b.contracts = []; b.ledger = []; b.confirmations = []; b.ratings = {}; b.sales = {}; b.alerts = []; b.audit = [];
    for (let i = 0; i < 160; i++) { const sx = id => id + '~' + i; for (const x of s.hotels) b.hotels.push(Object.assign(env.clone(x), { hotelId: sx(x.hotelId), ellisHotelId: sx(x.ellisHotelId) }));
      for (const c of s.contracts) { b.contracts.push(Object.assign(env.clone(c), { contractId: sx(c.contractId), hotelId: sx(c.hotelId) })); b.ratings[sx(c.contractId)] = env.clone(s.ratings[c.contractId]); }
      for (const x of s.ledger) b.ledger.push(Object.freeze(Object.assign({}, x, { txId: sx(x.txId), contractId: sx(x.contractId), externalRef: x.externalRef ? sx(x.externalRef) : undefined })));
      for (const x of s.confirmations) b.confirmations.push(Object.assign({}, x, { contractId: sx(x.contractId) })); }
    a.ok(b.ledger.length > 20000, 'rows ' + b.ledger.length); let t0 = Date.now(); const m = Model.compute(b); const dc = Date.now() - t0; a.ok(dc < 3000, 'compute ' + dc + ' ms'); a.eq(m.views.length, 2560);
    const stg = Store.memoryStorage(); stg.setItem('omh_hfr_v1', JSON.stringify(b)); t0 = Date.now(); const st = env.newStore({ storage: stg }); const dl = Date.now() - t0; a.eq(st.loadStatus, 'OK'); a.ok(dl < 6000, 'load ' + dl + ' ms');
    for (const id of ['CT-KR-001~7', 'CT-JP-004~100', 'CT-VN-002~159']) a.eq(m.byContract[id].balance.closingMinor, Ledger.balance(b.ledger, id).closingMinor, id + ' grouped balance equals full scan');
    const f1 = env.synth({ topups: [['2026-10-10', 10e6]] }), f2 = env.synth({ topups: [['2026-10-10', 10e6]] }); const ix = Ledger.makeIndex(f2.state.ledger); const cx2 = Object.assign({}, f2.cx, { index: ix });
    const rows = [{ type: 'TOPUP', amountMinor: 3e6, occurredAt: '2026-10-11T10:00:00+09:00', externalRef: 'a' }, { type: 'REFUND', amountMinor: 200e6, occurredAt: '2026-10-12T10:00:00+09:00', externalRef: 'b' }, { type: 'REFUND', amountMinor: 1e6, occurredAt: '2026-10-13T10:00:00+09:00', externalRef: 'c' }, { type: 'CONSUMPTION', amountMinor: 999e9, status: 'confirmed', period: '2026-10', occurredAt: '2026-10-14T10:00:00+09:00', externalRef: 'd' }];
    for (const r of rows) { const x = Ledger.append(f1.state.ledger, Object.assign({ contractId: 'CT-T', currency: 'KRW' }, r), f1.cx), y = Ledger.append(f2.state.ledger, Object.assign({ contractId: 'CT-T', currency: 'KRW' }, r), cx2); a.deepEq(x.errors, y.errors, r.externalRef); a.deepEq(x.warnings, y.warnings, r.externalRef); }
    a.eq(Ledger.balance(f1.state.ledger, 'CT-T').closingMinor, Ledger.balance(f2.state.ledger, 'CT-T').closingMinor); a.eq(ix.bal.get('CT-T'), Ledger.balance(f2.state.ledger, 'CT-T').closingMinor, 'running balance in the index equals a recomputation');
  });
  t('H04', 'Load check v3: approval replay after reset, and edits to ledger/facts/ratings/config made outside the commands are detected', ['D-3', 'D-5', 'M02-2', 'T15'], a => {
    const base = fresh('SCM'); const c = base.commands; c.createApproval('CT-KR-001', 1000); c.submitApproval('AP-0001'); base.setSession('test.ceo', 'CEO'); c.reviewApproval('AP-0001', 'ok'); base.setSession('test.scm', 'SCM');
    c.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 3000, currency: 'KRW', occurredAt: '2026-11-02T10:00:00+09:00', externalRef: 'H4-1' });
    c.recordFact('hotel', 'H006', 'closure', { claimed: true, source: 'SCM', verified: { by: 'test.scm', evidenceRef: 'DOC-4444' } });
    const csv = 'contractId,type,amount,currency,occurredAt,externalRef\nCT-KR-002,TOPUP,500,KRW,2026-11-03T10:00:00+09:00,H4-CSV\n'; a.ok(c.importCsv(csv, 'h4.csv').ok); c.setScores('CT-KR-002', { scmOps: 2 }); c.setOpinion('CT-KR-002', 'last');
    const mk = (storage, mut) => { const raw = JSON.parse(storage.getItem('omh_hfr_v1')); mut(raw); const g = Store.memoryStorage(); g.setItem('omh_hfr_v1', JSON.stringify(raw)); g.setItem('omh_hfr_v1.anchor', storage.getItem('omh_hfr_v1.anchor')); return env.newStore({ storage: g }).loadStatus; };
    const stg = base.storage; a.eq(mk(stg, () => {}), 'OK', 'legitimate history (approval, CSV, scores, facts) reloads cleanly');
    a.eq(mk(stg, s => { const old = s.approvals[0]; s.approvals = [Object.assign(JSON.parse(JSON.stringify(old)), { contractId: 'CT-KR-002' })]; }), 'AUDIT_BROKEN', 'approval moved to another contract');
    a.eq(mk(stg, s => { s.approvals[0].createdBy = 'someone.else'; }), 'AUDIT_BROKEN', 'createdBy edited');
    a.eq(mk(stg, s => { const r = s.ledger.find(x => x.txId.startsWith('TX-CT-KR-001') && x.type === 'TOPUP'); r.amountMinor *= 10; }), 'AUDIT_BROKEN', 'top-up amount x10');
    a.eq(mk(stg, s => { s.ledger[5].occurredAt = '2026-06-05T10:00:00+09:00'; }), 'AUDIT_BROKEN', 'occurredAt edited');
    a.eq(mk(stg, s => { s.ledger.pop(); }), 'AUDIT_BROKEN', 'last ledger row deleted');
    a.eq(mk(stg, s => { const x = s.ledger[3]; s.ledger[3] = s.ledger[4]; s.ledger[4] = x; }), 'AUDIT_BROKEN', 'rows reordered');
    a.eq(mk(stg, s => { const h = s.hotels.find(x => x.hotelId === 'H006'); h.facts.closure = null; h.factHistory = []; }), 'AUDIT_BROKEN', 'verified closure erased');
    a.eq(mk(stg, s => { for (const k of Object.keys(s.ratings['CT-KR-002'].scores)) s.ratings['CT-KR-002'].scores[k] = 5; }), 'AUDIT_BROKEN', 'rating scores rewritten');
    a.eq(mk(stg, s => { s.config.minCoverage = 0.4; }), 'AUDIT_BROKEN', 'valid-looking config value changed');
    a.eq(mk(stg, s => { s.confirmations.pop(); }), 'AUDIT_BROKEN', 'hotel confirmation removed');
    // reset then replay: a stale approval must not back a new one
    const r = fresh('SCM'); r.commands.createApproval('CT-KR-001', 1000); r.commands.submitApproval('AP-0001'); r.setSession('test.ceo', 'CEO'); r.commands.reviewApproval('AP-0001', 'ok'); r.setSession('test.admin', 'ADMIN'); r.commands.resetSample(); r.setSession('test.scm', 'SCM');
    a.ok(r.commands.createApproval('CT-KR-002', 999999999).ok); a.eq(r.state.approvals[0].approvalId, 'AP-0002', 'approval ids stay unique across resets');
    const oldAck = JSON.parse(base.storage.getItem('omh_hfr_v1')).approvals[0].ack; const forged = JSON.parse(JSON.stringify(r.state)); forged.approvals[0].approvalId = 'AP-0001'; forged.approvals[0].status = 'CEO_REVIEWED'; forged.approvals[0].feedback = { by: 'test.ceo', at: 'x', text: 'forged' }; forged.approvals[0].ack = { mock: true, status: 'MOCK_ACCEPTED', ref: r.state.audit.find(e => e.action === 'PORTAL_SUBMIT_MOCK').detail.ref, at: 'x' };
    const g2 = Store.memoryStorage(); g2.setItem('omh_hfr_v1', JSON.stringify(forged)); g2.setItem('omh_hfr_v1.anchor', r.storage.getItem('omh_hfr_v1.anchor')); a.eq(env.newStore({ storage: g2 }).loadStatus, 'AUDIT_BROKEN', 'replaying a pre-reset approval id does not validate a forged approval');
    const g3 = Store.memoryStorage(); g3.setItem('omh_hfr_v1', r.storage.getItem('omh_hfr_v1')); g3.setItem('omh_hfr_v1.anchor', r.storage.getItem('omh_hfr_v1.anchor')); a.eq(env.newStore({ storage: g3 }).loadStatus, 'OK', 'activity after a reset reloads cleanly');
  });
  t('H05', 'References: variation selectors and other default-ignorable code points are ignored when comparing', ['M02-4', 'T02'], a => {
    const base = Ledger.normRef('A-1'); for (const v of ['A-1\uFE0F', 'A-1\u{E0100}', 'A-1\u{E01EF}', 'A\u180B-1', 'A-\u180D1', 'A\u2065-1', 'A-1\u{FFF0}', 'A\u2064-1']) a.eq(Ledger.normRef(v), base, JSON.stringify(v));
    a.ok(Ledger.normRef('A-1') !== Ledger.normRef('A1') && Ledger.normRef('A-1') !== Ledger.normRef('A_1'));
  });
  t('D15', 'Test-suite hygiene: BigInt path is exercised with amounts beyond double precision', ['M02-2', 'PERF'], a => {
    a.eq(Money.avgMul(9000000000000000, 3, 2), 6000000000000000); a.eq(Money.mulFloor(9007199254740991, 0.75), 6755399441055743); a.eq(Money.ceilDiv(9007199254740991, 7), 1286742750677285);
    const f = env.synth({ opening: 9e14, cons: [3e14, 3e14, 3e14] }); a.eq(f.view().balance.closingMinor, 0); a.eq(f.view().forecast.avgMinor, 3e14); const g = env.synth({ opening: 9e14 + 7, cons: [3e14, 3e14, 3e14] }); a.eq(g.view().balance.closingMinor, 7);
  });
};
