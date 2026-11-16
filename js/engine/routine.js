/* Regular management (정기 관리) — the CEO's settlement routine of 2026-11-13: a six-step settlement per contract and month, the monthly close on the first business day,
   settlement lag (정산 밀림), the hotel balance letter that must not stay unanswered for two months, and the reminder list with its recipients.
   PURE: numbers and dates in, status out. Nothing here writes the ledger or moves money; the program shows what is open and who has to act.                                      */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { Dates: require('../core/dates.js') } : { Dates: NS.Dates });
  NS.Routine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Dates } = dep; const B = (ko, en) => ({ ko, en });
  const pad = n => String(n).padStart(2, '0');
  /** Steps of the settlement, in the CEO's order. owner: who does it (SCM = assigned SCM, SUPPORT = finance support). */
  const STEPS = [
    { n: 1, owner: 'SCM', name: B('호텔 청구서(소진 내역) 받기', 'Receive the hotel invoice (usage statement)') },
    { n: 2, owner: 'SCM', name: B('ELLIS 체크아웃 예약과 대조(건수·박수·금액)', 'Compare with ELLIS check-out bookings (count, nights, amount)') },
    { n: 3, owner: 'SUPPORT', name: B('맞는 부분을 ELLIS에서 정산, 청구서 번호·정산일 기록', 'Settle the matching part in ELLIS, record invoice number and settlement date') },
    { n: 4, owner: 'SUPPORT', name: B('같은 금액을 선급금 내역에서 차감, 잔액 갱신', 'Deduct the same amount from the prepayment ledger, update the balance') },
    { n: 5, owner: 'SCM', name: B('안 맞는 부분은 호텔에 확인, 월말 호텔 잔액 확인서와 대사', 'Ask the hotel about the differences, match against the month-end balance letter') },
    { n: 6, owner: 'SUPPORT', name: B('매월 1영업일 마감: 지난달 분 확정, 정산 밀린 호텔 확인', 'Close on the first business day: confirm last month, check hotels that are behind') },
  ];

  function isWeekday(d) { const x = new Date(d + 'T00:00:00Z').getUTCDay(); return x !== 0 && x !== 6; }
  /** First business day (Monday to Friday) of a month. Public holidays are not known to the program. */
  function firstBusinessDay(monthKey) { let d = monthKey + '-01'; while (!isWeekday(d)) d = Dates.addDays(d, 1); return d; }
  /** The monthly close of a period falls on the first business day of the month after it. */
  function closeDate(period) { return firstBusinessDay(Dates.addMonths(period, 1)); }
  const lastMonthOf = asOf => Dates.prevMonths(asOf, 1)[0];
  const monthEnd = key => Dates.addDays(Dates.addMonths(key, 1) + '-01', -1);

  /** Whether this contract has a settlement routine: deposits, buyouts and monthly-settlement blocks keep no usage ledger. */
  function applicable(contract) { return !(contract.prepaymentType === 'SECURITY_DEPOSIT' || contract.prepaymentType === 'BUYOUT' || contract.monthlySettlement === true); }

  /**
   * Settlement lag: the last month with confirmed usage is before last month. Before the first usage record there is nothing to be behind on.
   * -> { lagging, lastConsMonth, monthsBehind }
   */
  function lag(consByMonth, asOf) {
    const used = Object.keys(consByMonth || {}).filter(k => consByMonth[k] > 0).sort(); const last = lastMonthOf(asOf);
    if (!used.length) return { lagging: false, lastConsMonth: null, monthsBehind: 0 };
    const lastUsed = used[used.length - 1]; let behind = 0; let k = lastUsed; while (k < last) { k = Dates.addMonths(k, 1); behind++; }
    return { lagging: lastUsed < last, lastConsMonth: lastUsed, monthsBehind: behind };
  }

  /** Hotel balance letter unanswered for two months: an old letter, or none at all two months after the start. */
  function letterOverdue(recon, startDate, hasBalance, asOf, cfg) {
    const days = cfg.review.routine.letterOverdueDays; if (!hasBalance) return false;
    if (recon && recon.status !== 'UNCONFIRMED' && recon.confirmedAt) return Dates.diffDays(recon.confirmedAt, asOf) > days;
    return !!startDate && Dates.diffDays(startDate, asOf) > days;
  }

  /**
   * The six steps of one contract and one month. rec = { invoice, ellis, settled } (what people recorded), consMinor = confirmed usage of the month in the ledger,
   * recon = the hotel letter state, closed = the month close record or null.
   * status: DONE | OPEN (it is this step's turn) | WAIT (an earlier step is missing) | ATTN (needs action: differences) | NA
   */
  function steps(input) {
    const { rec, consMinor, recon, period, closed } = input; const r = rec || {};
    const s = {}; const set = (n, status, detail) => { s[n] = { n, owner: STEPS[n - 1].owner, status, detail: detail || null }; };
    set(1, r.invoice ? 'DONE' : 'OPEN', r.invoice ? { no: r.invoice.no, at: r.invoice.receivedAt, amountMinor: r.invoice.amountMinor } : null);
    const e = r.ellis; set(2, !r.invoice ? 'WAIT' : e ? (e.result === 'MATCH' ? 'DONE' : 'ATTN') : 'OPEN', e ? { result: e.result, note: e.note || '', ellisMinor: e.ellisMinor == null ? null : e.ellisMinor } : null);
    set(3, r.settled ? 'DONE' : (e && e.result === 'MATCH') ? 'OPEN' : 'WAIT', r.settled ? { at: r.settled.settledAt } : null);
    const ledgerOk = consMinor != null && consMinor > 0; const same = r.invoice && ledgerOk && r.invoice.amountMinor === consMinor;
    set(4, ledgerOk ? 'DONE' : (r.settled ? 'OPEN' : 'WAIT'), { consMinor: consMinor || 0, invoiceMinor: r.invoice ? r.invoice.amountMinor : null, same: !!same });
    const diff = (e && e.result === 'DIFF') || (r.invoice && ledgerOk && !same);
    const letterAfter = recon && recon.status === 'MATCH' && recon.confirmedAt && recon.confirmedAt >= monthEnd(period);
    set(5, !diff ? 'NA' : letterAfter ? 'DONE' : 'ATTN', { letterAt: recon && recon.confirmedAt ? recon.confirmedAt : null });
    set(6, closed ? 'DONE' : 'WAIT', closed ? { at: closed.closedAt, by: closed.closedBy } : null);
    return STEPS.map(x => s[x.n]);
  }
  /** A month is settled for a contract when steps 1-4 are done and any difference is cleared. */
  const settled = st => [1, 2, 3, 4].every(i => st[i - 1].status === 'DONE') && (st[4].status === 'DONE' || st[4].status === 'NA');

  /**
   * The reminder list of the CEO (who gets which action) for one contract. Every row: { code, to: [roles], tone }.
   * input: { off, hasBalance, lag, letterOverdue, daysToEnd, signals, holds, riskFlags, notes }
   */
  function reminders(input) {
    const out = []; const add = (code, to, tone) => out.push({ code, to, tone }); const sg = input.signals || { sig: {}, reasons: [], color: 'na' };
    if (input.off) return out;
    if (sg.color === 'bad') add('SIGNAL_RED', ['CEO', 'SCM', 'SUPPORT'], 'bad'); else if (sg.color === 'warn') add('SIGNAL_YELLOW', ['SCM', 'SUPPORT'], 'warn');
    const s1 = sg.sig.S1; if ((s1 && (s1.c === 'warn' || s1.c === 'bad')) || (input.notes || []).includes('YEAR_END_UNUSED')) add('SLOW_USAGE', ['SCM', 'CEO'], 'warn');
    if (input.lag && input.lag.lagging) add('SETTLEMENT_LAG', ['SUPPORT'], 'warn');
    if ((input.holds || []).includes('OVER_HOTEL_MAX')) add('OVER_HOTEL_MAX', ['SCM', 'SUPPORT'], 'bad');
    if (sg.reasons.includes('GRADE_DROP_2') || sg.reasons.includes('CLOSED') || (input.riskFlags || []).some(x => x === 'C2' || x === 'C3')) add('DROP_OR_CLOSURE', ['CEO'], 'bad');
    if (input.letterOverdue) add('LETTER_OVERDUE', ['SUPPORT'], 'bad');
    if (input.daysToEnd != null && input.daysToEnd >= 0 && input.daysToEnd <= input.expiryNoticeDays) add('EXPIRY_SOON', ['SCM', 'CEO'], 'warn');
    return out;
  }
  const ACTIONS = {
    SIGNAL_RED: B('충전 기안 차단, 24시간 안 반환·이관 제안', 'Top-up request blocked; propose a refund or transfer within 24 hours'), SIGNAL_YELLOW: B('충전 보류, 1주 안 원인 확인', 'Top-up on hold; check the cause within one week'),
    SLOW_USAGE: B('충전 보류·판매 집중, 1개월 안에 나아지지 않으면 감액·반환 협의', 'Top-up on hold, push sales; if no improvement in a month, talk about reducing or refunding'),
    SETTLEMENT_LAG: B('청구서 대사·ELLIS 정산 확인', 'Match the invoice and check the ELLIS settlement'), OVER_HOTEL_MAX: B('충전 중단', 'Stop top-ups'),
    DROP_OR_CLOSURE: B('충전 중단, 반환 요청 제안', 'Stop top-ups, propose a refund request'), LETTER_OVERDUE: B('충전 정지(잔액 확인서 2개월 미회신)', 'Top-ups suspended (balance letter unanswered for two months)'),
    EXPIRY_SOON: B('소진·연장·반환 결정 요청', 'Ask for a decision: use up, extend or refund'),
  };
  const CONDITIONS = {
    SIGNAL_RED: B('주간 신호 빨강', 'Weekly signal red'), SIGNAL_YELLOW: B('주간 신호 노랑', 'Weekly signal yellow'), SLOW_USAGE: B('소진 부진(소진 개월 2 초과, 소진 0, 연말 미소진 예상)', 'Slow usage (over 2 months of cover, no usage, unused money at year end)'),
    SETTLEMENT_LAG: B('정산 밀림(마지막 소진 월이 지난달보다 앞)', 'Settlement lag (last usage month is before last month)'), OVER_HOTEL_MAX: B('호텔당 최대 초과', 'Over the per-hotel maximum'),
    DROP_OR_CLOSURE: B('등급 2단계 하락, 폐업·휴업·압류(C2·C3)', 'Grade fell two steps, closure, suspension or seizure (C2, C3)'), LETTER_OVERDUE: B('호텔 잔액 확인서 2개월 미회신', 'Hotel balance letter unanswered for two months'),
    EXPIRY_SOON: B('계약 만료 60일 전', 'Contract ends within 60 days'),
  };
  return { STEPS, ACTIONS, CONDITIONS, firstBusinessDay, closeDate, lastMonthOf, monthEnd, applicable, lag, letterOverdue, steps, settled, reminders };
});
