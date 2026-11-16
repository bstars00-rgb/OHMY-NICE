'use strict';
// The CEO's 100-point credit review (2026-11-13): items, scoring, two reviewers, knock-outs, grades and the submit line. The cases of the HARE guideline are checked one by one.
const env = require('./helpers/env');
const { Review, Config } = env;

module.exports = function register(h) {
  const { test: t } = h; const cfg = () => Config.defaults().review;
  const ans = (o) => { const out = {}; for (const id of Review.ITEM_IDS) out[id] = 'GOOD'; for (const [v, ids] of Object.entries(o || {})) for (const id of ids) out[id] = v; return out; };   // everything GOOD except what is listed
  const side = (reviewer, o) => ({ reviewer, answers: ans(o) });
  const U = ids => ({ UNCHECKED: ids });

  t('RV01', 'Review items: five areas of 100 points in total with 16 scored items, three knock-out items without points, every item named in Korean and English', ['REV-1'], a => {
    a.deepEq(Review.AREAS.map(x => x.id), ['LEGAL', 'FIN', 'OWN', 'HIST', 'REP', 'KO']); a.eq(Review.ITEMS.length, 19); a.eq(Review.ITEMS.filter(i => i.w > 0).length, 16); a.eq(Review.ITEMS.reduce((s, i) => s + i.w, 0), 100);
    const per = Object.fromEntries(Review.AREAS.map(x => [x.id, x.items.reduce((s, i) => s + i.w, 0)])); a.deepEq(per, { LEGAL: 20, FIN: 25, OWN: 15, HIST: 25, REP: 15, KO: 0 }); a.eq(new Set(Review.ITEM_IDS).size, 19);
    a.deepEq(Review.ITEMS.map(i => i.w), [8, 6, 6, 12, 8, 5, 6, 6, 3, 7, 6, 6, 6, 5, 5, 5, 0, 0, 0]); for (const i of Review.ITEMS) a.ok(i.name.ko && i.name.en && i.src.ko && i.src.en, i.id);
  });
  t('RV02', 'Scoring: GOOD 1, CAUTION 0.5, ISSUE 0, UNCHECKED 0 (an item nobody answered scores 0); grade bands A 80, B 70, C 50 with exact boundaries', ['REV-1'], a => {
    const sc = o => Review.sideScore(ans(o), cfg()); a.eq(sc().score, 100); a.eq(sc().grade, 'A'); a.eq(Review.sideScore({}, cfg()).score, 0, 'nothing answered'); a.eq(Review.sideScore(undefined, cfg()).unchecked, 19);
    a.eq(sc({ CAUTION: ['F1'] }).score, 94); a.eq(sc({ CAUTION: ['F1', 'F2', 'O3'] }).score, 100 - 6 - 4 - 1.5); a.eq(sc({ ISSUE: ['F1'] }).score, 88); a.eq(sc({ UNCHECKED: ['F1'] }).score, 88);
    a.eq(sc({ UNCHECKED: ['F1', 'F2'] }).score, 80); a.eq(sc({ UNCHECKED: ['F1', 'F2'] }).grade, 'A', '80 is A'); a.eq(sc({ UNCHECKED: ['F1', 'F2'], CAUTION: ['O3'] }).score, 78.5); a.eq(sc({ UNCHECKED: ['F1', 'F2'], CAUTION: ['O3'] }).grade, 'B', '78.5 is B');
    a.eq(sc({ UNCHECKED: ['F1', 'F2', 'H1'] }).score, 73); a.eq(sc({ UNCHECKED: ['F1', 'F2', 'L1', 'L2'] }).score, 66); a.eq(sc({ UNCHECKED: ['F1', 'F2', 'L1', 'L2'] }).grade, 'C');
    a.eq(sc({ UNCHECKED: ['F1', 'F2', 'L1'], CAUTION: ['L2'] }).score, 69, '100-12-8-8-3'); a.eq(sc({ UNCHECKED: ['F1', 'F2', 'L1'], CAUTION: ['L2'] }).grade, 'C', '69 is C'); a.eq(sc({ UNCHECKED: ['F1', 'F2', 'L1', 'H1', 'H2'] }).score, 59);
    a.eq(sc({ UNCHECKED: ['F1', 'F2', 'L1', 'L2', 'H1', 'H2', 'H3', 'H4'] }).score, 100 - 12 - 8 - 8 - 6 - 7 - 6 - 6 - 6); a.eq(sc({ UNCHECKED: ['F1', 'F2', 'L1', 'L2', 'H1', 'H2', 'H3', 'H4'] }).grade, 'D', '41 is D');
    a.eq(Review.gradeOf(80, false, cfg()), 'A'); a.eq(Review.gradeOf(79.9, false, cfg()), 'B'); a.eq(Review.gradeOf(70, false, cfg()), 'B'); a.eq(Review.gradeOf(69.9, false, cfg()), 'C'); a.eq(Review.gradeOf(50, false, cfg()), 'C'); a.eq(Review.gradeOf(49.9, false, cfg()), 'D'); a.eq(Review.gradeOf(100, true, cfg()), 'D', 'a knock-out is D at any score');
  });
  t('RV03', 'The CEO guideline cases: 85+85 A and submitted; 73+72 B and submitted; 67+67 C rejected; 85+60 rejected (the lower counts); a knock-out with score 90 is D and rejected; the same person twice gives no judgement', ['REV-2', 'REV-3'], a => {
    const dec = (s, f) => Review.decide({ sales: s, support: f }, cfg());
    let r = dec(side('Kim', U(['F1', 'O3'])), side('Lee', U(['F1', 'O3']))); a.eq(r.sales.score, 85); a.eq(r.lowerScore, 85); a.eq(r.grade, 'A'); a.ok(r.submit); a.eq(r.status, 'DECIDED');
    r = dec(side('Kim', U(['F1', 'F2', 'H1'])), side('Lee', U(['F1', 'F2', 'L1']))); a.eq(r.sales.score, 73); a.eq(r.support.score, 72); a.eq(r.lowerScore, 72); a.eq(r.lowerSide, 'SUPPORT'); a.eq(r.grade, 'B'); a.ok(r.submit);
    r = dec(side('Kim', U(['F1', 'F2', 'H1', 'L2'])), side('Lee', U(['F1', 'F2', 'H1', 'L2']))); a.eq(r.lowerScore, 67); a.eq(r.grade, 'C'); a.ok(!r.submit); a.deepEq(r.reasons, ['BELOW_SUBMIT_MIN']);
    r = dec(side('Kim', U(['F3', 'R1'])), side('Lee', U(['F1', 'F2', 'L1', 'H1', 'F3']))); a.eq(r.sales.score, 90); a.eq(r.support.score, 60); a.eq(r.lowerScore, 60); a.ok(!r.submit, 'the lower side decides'); a.eq(r.grade, 'C');
    r = dec(side('Kim', Object.assign(U(['F3', 'R1']), { ISSUE: ['K1'] })), side('Lee', U(['F3', 'R1']))); a.eq(r.sales.score, 90); a.ok(r.knockout); a.eq(r.grade, 'D'); a.ok(!r.submit); a.deepEq(r.reasons, ['KNOCKOUT']);
    r = dec(side('Kim', {}), side('kim', {})); a.eq(r.status, 'SAME_REVIEWER'); a.eq(r.grade, 'NR'); a.eq(r.lowerScore, null); a.ok(!r.submit); r = dec(side('Kim', {}), side('  KIM ', {})); a.eq(r.status, 'SAME_REVIEWER', 'case and spaces do not make another person');
    r = dec(side('Kim', {}), side('Kim Lee', {})); a.eq(r.status, 'DECIDED', 'two different names');
  });
  t('RV04', 'Review states: nothing done, one side only, a missing reviewer name; submit needs a lower score of exactly the line or more; each knock-out item makes D, other items never do', ['REV-2', 'REV-3'], a => {
    let r = Review.decide(undefined, cfg()); a.eq(r.status, 'NOT_STARTED'); a.eq(r.grade, 'NR'); a.ok(!r.submit); r = Review.decide({}, cfg()); a.eq(r.status, 'NOT_STARTED');
    r = Review.decide({ sales: side('Kim', {}) }, cfg()); a.eq(r.status, 'WAITING'); a.eq(r.grade, 'NR'); a.ok(r.sales && !r.support); r = Review.decide({ support: side('Lee', {}) }, cfg()); a.eq(r.status, 'WAITING');
    r = Review.decide({ sales: side('', {}), support: side('Lee', {}) }, cfg()); a.eq(r.status, 'REVIEWER_MISSING'); a.eq(r.grade, 'NR'); a.ok(!r.submit);
    const two = (u) => Review.decide({ sales: side('Kim', U(u)), support: side('Lee', U(u)) }, cfg()); const c2 = cfg(); c2.submitMin = 73; const at73 = Review.decide({ sales: side('Kim', U(['F1', 'F2', 'H1'])), support: side('Lee', U(['F1', 'F2', 'H1'])) }, c2); a.ok(at73.submit, 'exactly the line passes'); c2.submitMin = 73.5; a.ok(!Review.decide({ sales: side('Kim', U(['F1', 'F2', 'H1'])), support: side('Lee', U(['F1', 'F2', 'H1'])) }, c2).submit, 'just below does not');
    a.ok(two(['F1', 'F2', 'H1']).submit && !two(['F1', 'F2', 'L1', 'L2']).submit); a.eq(two(['F1', 'F2', 'H1']).lowerScore, 73);
    for (const id of ['K1', 'K2', 'K3']) a.eq(Review.sideScore(ans({ ISSUE: [id] }), cfg()).knockout, true, id); for (const id of Review.ITEM_IDS.filter(i => !i.startsWith('K'))) a.eq(Review.sideScore(ans({ ISSUE: [id] }), cfg()).knockout, false, id + ' is not a knock-out here');
    const c3 = cfg(); c3.knockout = ['K1', 'K2', 'K3', 'L1']; a.eq(Review.sideScore(ans({ ISSUE: ['L1'] }), c3).knockout, true, 'the list of knock-out items is a setting'); a.eq(Review.sideScore(ans({ CAUTION: ['K1'] }), cfg()).knockout, false, 'a caution is not a knock-out');
  });
  t('RV05', 'Answer checks: unknown items and values are refused', ['REV-1'], a => {
    a.deepEq(Review.validateAnswers(ans()), []); a.deepEq(Review.validateAnswers({}), []); a.deepEq(Review.validateAnswers({ X9: 'GOOD' }), ['E_REVIEW_ITEM_UNKNOWN:X9']); a.deepEq(Review.validateAnswers({ F1: 'FINE' }), ['E_REVIEW_ANSWER_INVALID:F1']); a.deepEq(Review.validateAnswers({ F1: 1 }), ['E_REVIEW_ANSWER_INVALID:F1']);
    a.deepEq(Review.validateAnswers(null), ['E_ARGUMENT']); a.deepEq(Review.validateAnswers([]), ['E_ARGUMENT']); a.deepEq(Review.validateAnswers('GOOD'), ['E_ARGUMENT']); a.eq(Review.validateAnswers({ constructor: 'GOOD' }).length, 1);
  });
  t('RV06', 'Review settings: the values the CEO confirmed are in place and approved; every section is validated', ['REV-4'], a => {
    const rv = cfg(); a.deepEq(rv.gradeBands, { A: 80, B: 70, C: 50 }); a.eq(rv.submitMin, 70); a.deepEq(rv.hotelMax, { KRW: 100000000, JPY: 10000000 }); a.deepEq(Config.defaults().gradeMultipliers, { A: 2, B: 1, C: 0, D: 0, NR: 0 }); a.eq(rv.approvedBy, 'CEO Jackie'); a.eq(rv.approvedAt, '2026-11-13'); a.eq(rv.shortHistoryMonths, 3); a.eq(rv.shortHistoryFactor, 0.5); a.eq(rv.revenueShare, 0.1); a.eq(rv.firstDepositShare, 0.5);
    a.deepEq(rv.roomCaps, [[50, 20000000], [150, 50000000], [300, 100000000]]); a.deepEq(rv.answerFactor, { GOOD: 1, CAUTION: 0.5, ISSUE: 0, UNCHECKED: 0 }); a.ok(!('VND' in rv.hotelMax) && !('SGD' in rv.hotelMax) && !('THB' in rv.hotelMax), 'VN, TH and SG are still undecided');
    a.deepEq(Config.validate(Config.defaults()), []); const bad = (mut, tag) => { const c = Config.defaults(); mut(c); a.ok(Config.validate(c).some(x => x.startsWith('E_RANGE:review') || x === 'E_CONFIG_SECTION:review'), tag); };
    bad(c => { delete c.review; }, 'section removed'); bad(c => { c.review.submitMin = 0; }, 'submitMin 0'); bad(c => { c.review.submitMin = 101; }, 'submitMin 101'); bad(c => { c.review.gradeBands = { A: 70, B: 80, C: 50 }; }, 'bands order'); bad(c => { c.review.gradeBands.C = 0; }, 'band C 0');
    bad(c => { c.review.answerFactor.CAUTION = 1.5; }, 'factor above 1'); bad(c => { c.review.answerFactor = { GOOD: 0.5, CAUTION: 1, ISSUE: 0, UNCHECKED: 0 }; }, 'factor order'); bad(c => { c.review.knockout = 'K1'; }, 'knockout not a list'); { const c2 = env.clone(Config.defaults()); c2.gradeMultipliers = { A: 1, B: 2, C: 0, D: 0, NR: 0 }; a.ok(Config.validate(c2).includes('E_MULTIPLIER_NOT_MONOTONE'), 'months order'); } { const c3 = env.clone(Config.defaults()); c3.gradeMultipliers.D = -1; a.ok(Config.validate(c3).some(e => /E_MULTIPLIER_RANGE:D/.test(e)), 'negative months'); }
    bad(c => { c.review.shortHistoryMonths = 0; }, 'short history 0'); bad(c => { c.review.shortHistoryFactor = 2; }, 'short factor'); bad(c => { c.review.revenueShare = 0; }, 'revenue share 0'); bad(c => { c.review.firstDepositShare = 1.2; }, 'first deposit share');
    bad(c => { c.review.roomCaps = [[150, 1], [50, 2]]; }, 'room caps order'); bad(c => { c.review.roomCaps = [[50, 0]]; }, 'room cap amount'); bad(c => { c.review.hotelMax.KRW = -5; }, 'negative hotel max'); bad(c => { c.review.hotelMax.won = 1; }, 'bad currency key'); bad(c => { c.review.hotelMax.JPY = 1.5; }, 'fractional hotel max');
    bad(c => { c.review.signals.S1 = [4, 2]; }, 'S1 order'); bad(c => { c.review.signals.S2 = [0.5, 0.7]; }, 'S2 order'); bad(c => { c.review.signals.confirmFreshDays = 70; }, 'confirmation days order'); bad(c => { c.review.signals.confirmGapDays = 0; }, 'gap days'); bad(c => { c.review.approvedBy = ''; }, 'approver'); bad(c => { c.review.approvedAt = 'yesterday'; }, 'approval date');
  });
};
