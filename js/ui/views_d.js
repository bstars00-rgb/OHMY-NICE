/* Screen 09 — Regular management (정기 관리): reminder list, check schedule, the six settlement steps, settlement lag and the monthly close (CEO standard of 2026-11-13). */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(NS);
  NS.ViewsD = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (NS) {
  'use strict';
  const U = NS.UI, { L, LF, esc, tt, money, chip, hotelName } = U; const RBAC = NS.RBAC, Money = NS.Money, Routine = NS.Routine;
  const ROLE = r => r === 'SCM' ? L('담당 SCM', 'Assigned SCM') : r === 'SUPPORT' ? L('경영지원', 'Finance support') : L('대표', 'CEO');
  const SIG = c => c === 'bad' ? L('위험(빨강)', 'Red') : c === 'warn' ? L('주의(노랑)', 'Yellow') : c === 'ok' ? L('정상(초록)', 'Green') : c === 'off' ? L('해당 없음', 'Not applicable') : L('자료 대기', 'Waiting for data');
  const stText = s => s === 'DONE' ? L('완료', 'Done') : s === 'OPEN' ? L('지금 할 차례', 'Your turn') : s === 'WAIT' ? L('앞 단계 대기', 'Waiting for an earlier step') : s === 'ATTN' ? L('확인 필요', 'Needs action') : L('해당 없음', 'Not needed');
  const stTone = s => s === 'DONE' ? 'ok' : s === 'ATTN' ? 'bad' : s === 'OPEN' ? 'warn' : '';

  function routine(ctx) {
    const m = ctx.m, st = ctx.store.state; const role = ctx.store.session.role; const can = p => RBAC.can(role, p); const dis = p => (can(p) ? '' : 'disabled title="' + esc(L('권한 없음', 'No permission')) + '"');
    const applic = m.views.filter(v => v.routine.applicable); const period = Routine.lastMonthOf(m.asOf); const closeAt = Routine.closeDate(period); const closed = (st.monthCloses || {})[period];
    const id = ctx.params[0] || ctx.ui.routineContract || (applic[0] || {}).contractId; const v = m.byContract[id] && m.byContract[id].routine.applicable ? m.byContract[id] : applic[0];
    if (!v) return U.emptyState(L('정산 절차를 쓰는 계약이 없습니다.', 'No contract with a settlement routine.'));
    // ---- header: the month and its close ----
    const settledN = applic.filter(x => x.routine.settled).length; const canClose = !closed && m.asOf >= closeAt;
    const head = '<div class="panel"><div class="body"><div class="grid3">' +
      '<div><div class="k">' + esc(L('정산 월', 'Settlement month')) + '</div><div class="v2"><b>' + esc(period) + '</b></div><div class="small muted">' + esc(L('기준일', 'As of')) + ' ' + esc(m.asOf) + '</div></div>' +
      '<div><div class="k">' + esc(L('월 마감(매월 1영업일)', 'Monthly close (first business day)')) + '</div><div class="v2"><b>' + esc(closeAt) + '</b></div><div class="small">' + (closed ? chip(L('마감 완료', 'Closed'), 'ok') + ' ' + esc(closed.closedBy + ' · ' + closed.closedAt) : m.asOf < closeAt ? chip(L('아직 마감일 전', 'Before the close date'), 'warn') : chip(L('마감 가능', 'Ready to close'), 'warn')) + '</div></div>' +
      '<div><div class="k">' + esc(L('정산 끝난 계약', 'Contracts settled')) + '</div><div class="v2"><b>' + settledN + '</b> / ' + applic.length + '</div><div class="small muted">' + esc(L('1~4단계 완료, 차이는 해소', 'Steps 1-4 done, differences cleared')) + '</div></div></div>' +
      '<div class="toolbar"><button class="btn primary" data-act="rt-close" ' + (dis('settle.process') || (!canClose ? 'disabled title="' + esc(closed ? L('이미 마감했습니다', 'Already closed') : L('마감은 1영업일부터 할 수 있습니다', 'The close opens on the first business day')) + '"' : '')) + '>' + esc(LF('{0} 월 마감하기', 'Close {0}', period)) + '</button>' +
      '<span class="muted small">' + esc(L('마감은 정산이 끝난 계약과 남은 계약을 기록할 뿐 원장을 바꾸지 않습니다. 공휴일은 알지 못해 월~금만 영업일로 셉니다.', 'The close only records which contracts are settled and which are open; it never changes the ledger. Public holidays are not known, so only Monday to Friday count as business days.')) + '</span></div></div></div>';
    // ---- reminder list ----
    const rows = []; for (const x of m.views) for (const r of x.routine.reminders) rows.push({ v: x, r }); const f = ctx.ui.routineTo || ''; const shown = rows.filter(o => !f || o.r.to.includes(f)).sort((p, q) => (q.r.tone === 'bad') - (p.r.tone === 'bad') || p.v.contractId.localeCompare(q.v.contractId));
    const filt = '<div class="toolbar"><label>' + esc(L('받는 사람', 'Recipient')) + ' <select id="rt-to"><option value="">' + esc(L('전체', 'All')) + '</option>' + ['SCM', 'SUPPORT', 'CEO'].map(r => '<option value="' + r + '" ' + (f === r ? 'selected' : '') + '>' + esc(ROLE(r)) + '</option>').join('') + '</select></label><span class="spacer"></span><span class="muted small">' + esc(LF('알림 {0}건', '{0} reminders', shown.length)) + '</span></div>';
    const remTbl = shown.length ? '<div class="table-wrap"><table><thead><tr><th>' + esc(L('호텔·계약', 'Hotel and contract')) + '</th><th>' + esc(L('조건', 'Condition')) + '</th><th>' + esc(L('조치', 'Action')) + '</th><th>' + esc(L('받는 사람', 'Recipients')) + '</th></tr></thead><tbody>' +
      shown.map(o => '<tr><td><a href="#/profile/' + esc(o.v.contractId) + '">' + hotelName(o.v.hotel) + '</a> <span class="muted small">' + esc(o.v.contractId) + '</span></td><td>' + chip(tt(Routine.CONDITIONS[o.r.code]), o.r.tone) + '</td><td class="small">' + esc(tt(Routine.ACTIONS[o.r.code])) + '</td><td class="small">' + esc(o.r.to.map(ROLE).join(' · ')) + '</td></tr>').join('') + '</tbody></table></div>' : U.emptyState(L('지금 보낼 알림이 없습니다.', 'No reminders now.'));
    const remSec = '<div class="panel"><h3>' + esc(L('알림 목록 (조건 · 조치 · 받는 사람)', 'Reminders (condition, action, recipients)')) + '</h3><div class="body">' + filt + remTbl + '<div class="muted small">' + esc(L('이 화면은 알림을 보내지 않고 대상만 보여 줍니다. 조건과 받는 사람은 대표 확정 표를 따릅니다.', 'This screen sends nothing; it shows who would be told. Conditions and recipients follow the CEO table.')) + '</div></div></div>';
    // ---- check schedule ----
    const cols = [
      { k: 'hotel', h: L('호텔', 'Hotel'), v: x => '<a href="#/profile/' + esc(x.contractId) + '">' + hotelName(x.hotel) + '</a> <span class="muted small">' + esc(x.contractId) + '</span>', s: x => tt(x.hotel.name), t: x => x.hotel.name.ko + ' ' + x.hotel.name.en },
      { k: 'grade', h: L('등급', 'Grade'), cls: 'ctr', v: x => U.gradeBadge(x.rating.grade), s: x => x.rating.grade },
      { k: 'sig', h: L('주간 신호', 'Weekly signal'), cls: 'ctr', v: x => chip(SIG(x.signals.color), x.signals.color === 'bad' ? 'bad' : x.signals.color === 'warn' ? 'warn' : x.signals.color === 'ok' ? 'ok' : ''), s: x => ({ bad: 3, warn: 2, ok: 1, na: 0.5, off: 0 })[x.signals.color] },
      { k: 'next', h: L('다음 점검일', 'Next check'), v: x => esc(x.nextCheck.date) + ' ' + chip(x.nextCheck.kind === 'WATCH' ? L('위험 관찰', 'watch') : L('월 정기', 'monthly'), x.nextCheck.kind === 'WATCH' ? 'bad' : ''), s: x => x.nextCheck.date },
      { k: 'letter', h: L('호텔 잔액 확인서', 'Hotel balance letter'), v: x => x.recon.confirmedAt ? esc(x.recon.confirmedAt) + (x.routine.letterOverdue ? ' ' + chip(L('2개월 초과', 'over 2 months'), 'bad') : '') : (x.routine.letterOverdue ? chip(L('미회신', 'no answer'), 'bad') : '<span class="muted">—</span>'), s: x => x.recon.confirmedAt || '' },
      { k: 'end', h: L('계약 만료', 'Contract end'), v: x => esc(x.contract.endDate || '—') + (x.routine.daysToEnd != null && x.routine.daysToEnd >= 0 && x.routine.daysToEnd <= st.config.review.routine.expiryNoticeDays ? ' ' + chip(LF('{0}일 남음', '{0} days left', x.routine.daysToEnd), 'warn') : ''), s: x => x.contract.endDate || '' },
    ];
    const checkSec = '<div class="panel"><h3>' + esc(L('점검 주기표', 'Check schedule')) + '</h3><div class="body">' + U.table('rt-check', cols, applic, { sort: 'next' }) + '<div class="muted small">' + esc(L('점검 시점: 선급 기안 · 충전 요청 · 매월 · 매일 가벼운 점검. 위험 관찰 중인 호텔은 매주 봅니다.', 'Checked at: prepayment draft, top-up request, monthly, light daily check. Hotels under watch are checked weekly.')) + '</div></div></div>';
    // ---- the six steps of one contract ----
    const sel = '<div class="toolbar"><label>' + esc(L('계약', 'Contract')) + ' <select id="rt-sel">' + applic.map(x => '<option value="' + esc(x.contractId) + '" ' + (x.contractId === v.contractId ? 'selected' : '') + '>' + esc(tt(x.hotel.name) + ' · ' + x.contractId + ' · ' + x.currency) + '</option>').join('') + '</select></label><span class="muted small">' + esc(LF('{0} 분 정산', 'Settlement of {0}', period)) + '</span></div>';
    const S = v.routine.steps; const rec = ((st.settlements || {})[v.contractId] || {})[period] || {}; const ell = v.ellisOutlook && v.ellisOutlook.past ? v.ellisOutlook.past.find(x => x.month === period) : null; const locked = !!(closed || (rec.settled));
    const ins = (idv, ph, size, perm) => '<input id="' + idv + '" size="' + size + '" aria-label="' + esc(ph) + '" placeholder="' + esc(ph) + '" ' + dis(perm) + (locked ? ' disabled' : '') + '>';
    const btn = (act, txt, perm) => '<button class="btn sm" data-act="' + act + '" ' + (dis(perm) || (locked ? 'disabled' : '')) + '>' + esc(txt) + '</button>';
    const d = n => S[n - 1].detail || {};
    const cell = {
      1: S[0].status === 'DONE' ? esc(LF('청구서 {0} · 받은 날 {1} · {2}', 'Invoice {0} · received {1} · {2}', d(1).no, d(1).at, Money.format(d(1).amountMinor, v.currency))) : '',
      2: (S[1].detail ? esc((d(2).result === 'MATCH' ? L('일치', 'Match') : L('차이', 'Difference')) + (d(2).note ? ' · ' + d(2).note : '') + (d(2).ellisMinor != null ? ' · ELLIS ' + Money.format(d(2).ellisMinor, v.currency) : '')) : '') + (ell && ell.ellisMinor != null ? '<div class="small muted">' + esc(LF('참고: ELLIS 예약 순액 {0} (체크아웃 기준)', 'Reference: ELLIS net bookings {0} (check-out basis)', Money.format(ell.ellisMinor, v.currency))) + '</div>' : ''),
      3: S[2].status === 'DONE' ? esc(LF('ELLIS 정산일 {0}', 'Settled in ELLIS on {0}', d(3).at)) : '',
      4: esc(LF('원장 확정 소진 {0}', 'Ledger confirmed usage {0}', Money.format(d(4).consMinor, v.currency))) + (d(4).invoiceMinor != null ? ' · ' + esc(d(4).same ? L('청구서와 같음', 'equals the invoice') : LF('청구서 {0}와 다름', 'differs from the invoice {0}', Money.format(d(4).invoiceMinor, v.currency))) : ''),
      5: S[4].status === 'NA' ? '' : esc(d(5).letterAt ? LF('최근 호텔 확인서 {0}', 'Latest hotel letter {0}', d(5).letterAt) : L('월말 이후 호텔 확인서 없음', 'No hotel letter dated after the month end')),
      6: S[5].status === 'DONE' ? esc(LF('{0} 마감 · {1}', 'Closed {0} by {1}', d(6).at, d(6).by)) : esc(LF('마감일 {0}', 'Close date {0}', closeAt)),
    };
    const input = {
      1: ins('rt-inv-no', L('청구서 번호', 'Invoice no.'), 12, 'settle.invoice') + ins('rt-inv-date', L('받은 날 YYYY-MM-DD', 'Received YYYY-MM-DD'), 12, 'settle.invoice') + ins('rt-inv-amt', LF('금액 ({0})', 'Amount ({0})', v.currency), 12, 'settle.invoice') + btn('rt-invoice', L('청구서 기록', 'Record invoice'), 'settle.invoice'),
      2: '<select id="rt-ck-res" aria-label="comparison result" ' + dis('settle.invoice') + (locked ? ' disabled' : '') + '><option value="MATCH">' + esc(L('일치', 'Match')) + '</option><option value="DIFF">' + esc(L('차이 있음', 'Difference')) + '</option></select>' + ins('rt-ck-amt', LF('ELLIS 금액 ({0}) 선택', 'ELLIS amount ({0}) optional', v.currency), 12, 'settle.invoice') + ins('rt-ck-note', L('차이 내용(차이일 때 필수)', 'Note (required for a difference)'), 22, 'settle.invoice') + btn('rt-check', L('대조 결과 기록', 'Record comparison'), 'settle.invoice'),
      3: ins('rt-set-date', L('ELLIS 정산일 YYYY-MM-DD', 'ELLIS settled YYYY-MM-DD'), 14, 'settle.process') + btn('rt-settle', L('정산일 기록', 'Record settlement date'), 'settle.process'),
      4: '<a class="btn sm" href="#/ledger/' + esc(v.contractId) + '">' + esc(L('원장에서 소진 기록하기', 'Record usage in the ledger')) + '</a>',
      5: '<a class="btn sm" href="#/ledger/' + esc(v.contractId) + '">' + esc(L('호텔 확인 잔액 기록하기', 'Record a hotel confirmation')) + '</a>',
      6: '',
    };
    const stepRows = Routine.STEPS.map(sp => '<tr><td class="ctr"><b>' + sp.n + '</b></td><td>' + esc(tt(sp.name)) + '<div class="muted small">' + esc(ROLE(sp.owner)) + '</div></td><td>' + chip(stText(S[sp.n - 1].status), stTone(S[sp.n - 1].status)) + '</td><td class="small">' + cell[sp.n] + '</td><td class="rt-in">' + (sp.n >= 4 || S[sp.n - 1].status !== 'WAIT' ? input[sp.n] : '') + '</td></tr>').join('');
    const stepSec = '<div class="panel"><h3>' + esc(L('정산 절차 ①~⑥ (계약별)', 'Settlement steps 1-6 (per contract)')) + '</h3><div class="body">' + sel + '<div class="table-wrap"><table class="rt-table"><thead><tr><th></th><th>' + esc(L('단계와 담당', 'Step and owner')) + '</th><th>' + esc(L('상태', 'Status')) + '</th><th>' + esc(L('기록', 'Record')) + '</th><th>' + esc(L('입력', 'Input')) + '</th></tr></thead><tbody>' + stepRows + '</tbody></table></div>' +
      '<div class="muted small">' + esc(L('청구서를 받을 때와 매월 1영업일, 한 달에 한 번 이상 정산합니다. 실제 정산과 차감은 ELLIS와 원장에서 하고, 여기에는 번호·날짜·결과만 기록합니다. 계좌번호는 저장하지 않습니다. 정산이 끝난 달은 바꿀 수 없습니다.', 'Settle when an invoice arrives and on the first business day of every month, at least once a month. The real settlement and deduction happen in ELLIS and the ledger; this screen records numbers, dates and results only. Account numbers are never stored. A settled month cannot be changed.')) + '</div></div></div>';
    // ---- lag and closes ----
    const lagRows = applic.filter(x => x.routine.lag.lagging).sort((p, q) => q.routine.lag.monthsBehind - p.routine.lag.monthsBehind);
    const lagSec = '<div class="panel"><h3>' + esc(L('정산 밀림 (마지막 소진 월이 지난달보다 앞)', 'Settlement lag (last usage month is before last month)')) + '</h3><div class="body">' + (lagRows.length ? '<div class="table-wrap"><table><thead><tr><th>' + esc(L('호텔·계약', 'Hotel and contract')) + '</th><th>' + esc(L('마지막 소진 월', 'Last usage month')) + '</th><th class="num">' + esc(L('밀린 달', 'Months behind')) + '</th><th>' + esc(L('담당 SCM', 'Assigned SCM')) + '</th></tr></thead><tbody>' +
      lagRows.map(x => '<tr><td><a href="#/profile/' + esc(x.contractId) + '">' + hotelName(x.hotel) + '</a> <span class="muted small">' + esc(x.contractId) + '</span></td><td>' + esc(x.routine.lag.lastConsMonth) + '</td><td class="num">' + x.routine.lag.monthsBehind + '</td><td>' + esc(x.contract.assignedScm || '—') + '</td></tr>').join('') + '</tbody></table></div><div class="muted small">' + esc(L('조치: 청구서 대사와 ELLIS 정산 확인(경영지원).', 'Action: match the invoice and check the ELLIS settlement (finance support).')) + '</div>' : '<span class="muted">' + esc(L('밀린 계약이 없습니다.', 'No contract is behind.')) + '</span>') + '</div></div>';
    const closes = Object.keys(st.monthCloses || {}).sort().reverse();
    const closeSec = '<div class="panel"><h3>' + esc(L('월 마감 이력', 'Monthly close history')) + '</h3><div class="body">' + (closes.length ? '<div class="table-wrap"><table><thead><tr><th>' + esc(L('월', 'Month')) + '</th><th>' + esc(L('마감한 사람', 'Closed by')) + '</th><th>' + esc(L('마감일', 'Closed on')) + '</th><th class="num">' + esc(L('정산 끝난 계약', 'Settled')) + '</th><th>' + esc(L('남아 있던 계약', 'Still open')) + '</th></tr></thead><tbody>' + closes.map(p => { const c = st.monthCloses[p]; return '<tr><td>' + esc(p) + '</td><td>' + esc(c.closedBy) + '</td><td>' + esc(c.closedAt) + '</td><td class="num">' + c.settledCount + '</td><td class="small">' + (c.openContracts.length ? esc(c.openContracts.join(', ')) : '<span class="muted">—</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>' : U.emptyState(L('아직 마감한 달이 없습니다.', 'No month has been closed yet.'))) + '</div></div>';
    return head + remSec + stepSec + lagSec + checkSec + closeSec;
  }

  function bind(el, ctx) {
    const cmd = ctx.store.commands; const m = ctx.m; const period = Routine.lastMonthOf(m.asOf); const cid = () => el.querySelector('#rt-sel').value; const cur = () => m.byContract[cid()];
    const val = idv => { const x = el.querySelector(idv); return x ? x.value.trim() : ''; }; const on = (act, fn) => { const b = el.querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener('click', fn); };
    const sel = el.querySelector('#rt-sel'); if (sel) sel.addEventListener('change', () => { ctx.ui.routineContract = sel.value; ctx.navigate('/routine/' + sel.value); });
    const to = el.querySelector('#rt-to'); if (to) to.addEventListener('change', () => { ctx.ui.routineTo = to.value; ctx.rerender(); });
    U.tableEvents(el, ctx.rerender);
    on('rt-invoice', () => { const p = Money.parseAmount(val('#rt-inv-amt'), cur().currency); if (!p.ok) return ctx.run(() => ({ ok: false, errors: [p.error] })); ctx.run(() => cmd.recordInvoice(cid(), period, { no: val('#rt-inv-no'), receivedAt: val('#rt-inv-date'), amountMinor: p.minor }), L('청구서를 기록했습니다.', 'Invoice recorded.')); });
    on('rt-check', () => { const raw = val('#rt-ck-amt'); let ellisMinor = null; if (raw !== '') { const p = Money.parseAmount(raw, cur().currency); if (!p.ok) return ctx.run(() => ({ ok: false, errors: [p.error] })); ellisMinor = p.minor; } ctx.run(() => cmd.recordEllisCheck(cid(), period, { result: val('#rt-ck-res'), note: val('#rt-ck-note'), ellisMinor }), L('ELLIS 대조 결과를 기록했습니다.', 'Comparison recorded.')); });
    on('rt-settle', () => ctx.run(() => cmd.recordSettlement(cid(), period, val('#rt-set-date')), L('정산일을 기록했습니다.', 'Settlement date recorded.')));
    on('rt-close', () => ctx.run(() => cmd.closeMonth(period), LF('{0} 월을 마감했습니다.', '{0} closed.', period)));
  }
  return { routine, routineBind: bind };
});
