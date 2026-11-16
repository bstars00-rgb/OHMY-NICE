'use strict';
// The CEO's credit review inside the store: roles, history, the decision, the gate in front of the approval request, and protection of the stored data.
const env = require('./helpers/env');
const { Review, Store } = env;

module.exports = function register(h) {
  const { test: t } = h; const fresh = role => env.as(env.newStore(), role || 'SCM');
  const full = (o) => { const out = {}; for (const id of Review.ITEM_IDS) out[id] = 'GOOD'; for (const [v, ids] of Object.entries(o || {})) for (const id of ids) out[id] = v; return out; };

  t('RV07', 'Credit review in the store: each side is scored by its own role, the reviewer is the signed-in person, earlier answers stay in the history, the decision follows when both sides are in, and nothing touches the ledger', ['REV-2', 'REV-6', 'D-4'], a => {
    const st = fresh('SCM'); const c = st.commands; const ledger = JSON.stringify(st.state.ledger); const v = () => st.model().byContract['CT-JP-007'];
    a.eq(v().rating.grade, 'NR'); a.eq(v().rating.review.status, 'NOT_STARTED'); a.eq(c.submitCreditReview('NOPE', 'SALES', full()).errors[0], 'E_CONTRACT_UNKNOWN'); a.eq(c.submitCreditReview('CT-JP-007', 'BOTH', full()).errors[0], 'E_REVIEW_SIDE_INVALID');
    a.deepEq(c.submitCreditReview('CT-JP-007', 'SALES', { X9: 'GOOD' }).errors, ['E_REVIEW_ITEM_UNKNOWN:X9']); a.deepEq(c.submitCreditReview('CT-JP-007', 'SALES', { F1: 'FINE' }).errors, ['E_REVIEW_ANSWER_INVALID:F1']); a.eq(c.submitCreditReview('CT-JP-007', 'SALES', null).errors[0], 'E_ARGUMENT');
    a.throws(() => c.submitCreditReview('CT-JP-007', 'SUPPORT', full()), 'E_FORBIDDEN', 'the SCM cannot score the finance side');
    const r1 = c.submitCreditReview('CT-JP-007', 'SALES', full({ UNCHECKED: ['F1', 'F3'] })); a.ok(r1.ok); a.eq(r1.decision.status, 'WAITING'); a.eq(v().rating.review.status, 'WAITING'); a.eq(v().rating.grade, 'NR', 'one side is not a judgement'); a.eq(st.state.reviews['CT-JP-007'].sales.reviewer, 'test.scm');
    env.as(st, 'SUPPORT'); a.throws(() => c.submitCreditReview('CT-JP-007', 'SALES', full()), 'E_FORBIDDEN', 'finance cannot score the sales side'); const r2 = c.submitCreditReview('CT-JP-007', 'SUPPORT', full({ UNCHECKED: ['F1', 'F3', 'O3'] })); a.ok(r2.ok); a.eq(r2.decision.status, 'DECIDED'); a.eq(v().rating.grade, 'A'); a.eq(v().rating.score, 80); a.eq(st.state.reviews['CT-JP-007'].support.reviewer, 'test.support');
    a.ok(v().rating.review.submit); a.eq(v().rating.confidence.pct, 80, 'known share of the weaker side');
    env.as(st, 'SCM'); a.ok(c.submitCreditReview('CT-JP-007', 'SALES', full({ UNCHECKED: ['F1', 'F2', 'F3', 'L1', 'L2'] })).ok); a.eq(st.state.reviews['CT-JP-007'].history.length, 1, 'the earlier sales answers are kept'); a.eq(st.state.reviews['CT-JP-007'].history[0].side, 'SALES'); a.eq(v().rating.review.sales.score, 61); a.eq(v().rating.review.lowerScore, 61); a.eq(v().rating.grade, 'C');
    for (const role of ['VIEWER', 'CEO']) { env.as(st, role); a.throws(() => c.submitCreditReview('CT-JP-007', 'SALES', full()), 'E_FORBIDDEN', role); a.throws(() => c.submitCreditReview('CT-JP-007', 'SUPPORT', full()), 'E_FORBIDDEN', role); }
    env.as(st, 'ADMIN'); a.ok(c.submitCreditReview('CT-JP-007', 'SALES', full()).ok); a.ok(c.submitCreditReview('CT-JP-007', 'SUPPORT', full()).ok, 'an administrator may score either side'); a.eq(v().rating.review.status, 'SAME_REVIEWER', 'but not both sides for one decision'); a.eq(v().rating.grade, 'NR'); a.ok(!v().rating.review.submit);
    a.eq(JSON.stringify(st.state.ledger), ledger, 'a review never writes the ledger'); const au = st.state.audit.filter(e => e.action === 'REVIEW_SUBMIT'); a.ok(au.some(e => e.outcome === 'OK' && e.detail.side === 'SALES') && au.some(e => e.outcome === 'DENIED') && au.some(e => e.outcome === 'REJECTED'));
  });
  t('RV08', 'The grade comes from the review, not from the data-driven score: the reference score is kept next to it, a verified critical fact still forces D, no review means NR', ['REV-2', 'REV-6'], a => {
    const st = fresh('SCM'); const m = st.model(); const ka = m.byContract['CT-KR-001']; a.eq(ka.rating.grade, 'A'); a.eq(ka.rating.source, 'REVIEW'); a.ok(ka.rating.auto && ka.rating.auto.grade && ka.rating.auto.score != null, 'the data-driven reference is still there'); a.eq(ka.rating.score, 83); a.eq(ka.rating.review.sales.score, 88); a.eq(ka.rating.review.support.score, 83);
    for (const [id, g] of [['CT-JP-003', 'C'], ['CT-JP-004', 'D'], ['CT-VN-004', 'D'], ['CT-JP-007', 'NR'], ['CT-JP-008', 'NR'], ['CT-VN-003', 'NR']]) a.eq(m.byContract[id].rating.grade, g, id); a.eq(m.byContract['CT-JP-004'].rating.review.knockout, true);
    const f = env.synth({ review: 'A', hotelFacts: { closure: { claimed: true, source: 'SCM', verified: { by: 'Kim', at: '2026-10-01', evidenceRef: 'DOC-1' } } } }).view(); a.eq(f.rating.review.grade, 'A'); a.eq(f.rating.grade, 'D', 'a verified closure beats any review'); a.ok(f.rating.capped);
    for (const [rv, g] of [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['NONE', 'NR']]) a.eq(env.synth({ review: rv }).view().rating.grade, g, rv); a.eq(env.synth({ review: 'NONE' }).view().rating.confidence.pct, 0); a.eq(env.synth({ review: 'B' }).view().rating.confidence.pct, 75);
    const none = env.synth({ review: 'NONE' }).view(); a.eq(none.limit.recommendedLimitMinor, 0); a.ok(none.limit.holdReasons.includes('NOT_RATED'));
  });
  t('RV09', 'Only a passed review lets a request be drafted: the lower score must reach the submit line with no knock-out; a request for a C, D, unreviewed or same-reviewer contract is refused and nothing is stored', ['REV-3', 'REV-6', 'M09-1'], a => {
    const st = fresh('SCM'); const c = st.commands; const n0 = st.state.approvals.length;
    for (const id of ['CT-JP-003', 'CT-JP-004', 'CT-VN-004', 'CT-JP-007', 'CT-VN-002']) { const r = c.createApproval(id, 1000); a.eq(r.ok, false, id); a.eq(r.errors[0], 'E_REVIEW_NOT_PASSED', id); } a.eq(st.state.approvals.length, n0, 'nothing is stored');
    const ok = c.createApproval('CT-KR-001', 5e6); a.ok(ok.ok); a.eq(ok.approval.packet.rating.grade, 'A'); const b = c.createApproval('CT-KR-002', 1e6); a.ok(b.ok, 'a B grade passes');
    a.ok(c.submitCreditReview('CT-JP-007', 'SALES', full({ UNCHECKED: ['F1', 'F3'] })).ok); env.as(st, 'SUPPORT'); a.ok(c.submitCreditReview('CT-JP-007', 'SUPPORT', full({ UNCHECKED: ['F1', 'F3'] })).ok); a.ok(st.model().byContract['CT-JP-007'].rating.review.submit); a.ok(c.createApproval('CT-JP-007', 1000).ok, 'a reviewed contract can be drafted'); a.ok(c.submitCreditReview('CT-JP-007', 'SUPPORT', full({ UNCHECKED: ['F1', 'F2', 'F3', 'L1', 'L2'] })).ok); a.eq(c.createApproval('CT-JP-007', 1000).errors[0], 'E_REVIEW_NOT_PASSED', 'a lower score closes the door again');
  });
  t('RV10', 'Review data is protected like the rest: a stored review edited by hand is caught on load, and a reload gives the same decisions', ['REV-6', 'D-3', 'D-5'], a => {
    const stg = Store.memoryStorage(); const st = env.as(env.newStore({ storage: stg }), 'SCM'); a.ok(st.commands.submitCreditReview('CT-JP-007', 'SALES', full({ UNCHECKED: ['F1'] })).ok); const sum = s => JSON.stringify(s.model().views.map(v => [v.contractId, v.rating.grade, v.rating.score])); const before = sum(st);
    const back = env.newStore({ storage: stg }); a.eq(back.loadStatus, 'OK'); a.eq(sum(back), before, 'identical after a reload');
    const raw = JSON.parse(stg.getItem('omh_hfr_v1')); const load = mut => { const s = env.clone(raw); mut(s); const g = Store.memoryStorage(); g.setItem('omh_hfr_v1', JSON.stringify(s)); return env.newStore({ storage: g }).loadStatus; };
    a.eq(load(() => {}), 'OK'); a.eq(load(s => { s.reviews['CT-KR-001'].support.answers.F1 = 'GOOD'; }), 'AUDIT_BROKEN', 'an answer changed by hand'); a.eq(load(s => { s.reviews['CT-KR-001'].support.reviewer = 'someone.else'; }), 'AUDIT_BROKEN', 'a reviewer name changed'); a.eq(load(s => { delete s.reviews['CT-KR-001']; }), 'AUDIT_BROKEN', 'a review removed'); a.eq(load(s => { s.reviews['CT-JP-007'].sales.answers.L1 = 'ISSUE'; }), 'AUDIT_BROKEN', 'an answer of a stored review changed');
  });
};
