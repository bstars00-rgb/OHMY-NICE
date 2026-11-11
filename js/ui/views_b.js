/* Screen 03 (Floating Ledger) and the top-up simulator panel that the hotel credit card (screen 02) embeds. */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(NS);
  NS.ViewsB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (NS) {
  'use strict';
  const U = NS.UI, { L, LF, esc, tt, lab, money, moneyMap, gradeBadge, chip, hotelName } = U;
  const RBAC = NS.RBAC, Ledger = NS.Ledger, Money = NS.Money, Csv = NS.Csv, Limit = NS.Limit, Dates = NS.Dates;

  const SAMPLE_CSV = 'txId,contractId,type,amount,currency,occurredAt,period,status,reason,externalRef\r\n' +
    ',CT-KR-001,TOPUP,10000000,KRW,2026-11-03T10:00:00+09:00,,,,SAMPLE-BANK-REF-1001\r\n' +
    ',CT-KR-001,CONSUMPTION,4000000,KRW,2026-11-04T23:00:00+09:00,2026-11,pending,,SAMPLE-ELLIS-2026-11-A\r\n' +
    ',CT-JP-001,TOPUP,-500000,JPY,2026-11-03T10:00:00+09:00,,,,SAMPLE-NEG-AMOUNT\r\n' +
    ',CT-JP-001,TOPUP,1000000,EUR,2026-11-03T10:00:00+09:00,,,,SAMPLE-BAD-CURRENCY\r\n' +
    ',CT-KR-001,TOPUP,10000000,KRW,2026-11-03T10:00:00+09:00,,,,SAMPLE-BANK-REF-1001\r\n';

  /* ============ Screen 03 — Floating Ledger ============ */
  function ledger(ctx) {
    const m = ctx.m, st = ctx.store.state; const sel = ctx.params[0] || ctx.ui.ledgerContract || m.views[0].contractId; const v = m.byContract[sel]; if (!v) return U.emptyState(L('계약을 찾을 수 없습니다.', 'Contract not found.'));
    const can = p => RBAC.can(ctx.store.session.role, p); const dis = p => (can(p) ? '' : 'disabled title="' + esc(L('권한 없음', 'No permission')) + '"');
    const b = v.balance; const idt = Ledger.verifyIdentity(st.ledger, sel);
    const picker = '<div class="toolbar"><label>' + esc(L('계약', 'Contract')) + ' <select id="lg-sel">' + m.views.map(x => '<option value="' + esc(x.contractId) + '" ' + (x.contractId === sel ? 'selected' : '') + '>' + esc(tt(x.hotel.name) + ' · ' + x.contractId + ' · ' + x.currency) + '</option>').join('') + '</select></label><span class="spacer"></span>' +
      '<button class="btn sm" data-act="export-csv" ' + dis('data.export') + '>' + esc(L('원장 CSV 내보내기', 'Export ledger CSV')) + '</button></div>';
    const eq = '<div class="panel"><h3>' + esc(L('잔액 산식 검증', 'Balance identity')) + ' — ' + esc(v.contractId) + ' (' + esc(v.currency) + ')</h3><div class="body">' +
      '<div class="eq"><span>' + money(b.openingMinor, v.currency, true) + '<small>' + esc(L('기초', 'Opening')) + '</small></span><b>+</b><span>' + money(b.topupsMinor, v.currency, true) + '<small>' + esc(L('충전', 'Top-ups')) + '</small></span><b>−</b><span>' + money(b.consumptionMinor, v.currency, true) + '<small>' + esc(L('소진(확정)', 'Consumption (confirmed)')) + '</small></span><b>−</b><span>' + money(b.refundsMinor, v.currency, true) + '<small>' + esc(L('반환', 'Refunds')) + '</small></span><b>−</b><span>' + money(b.offsetsMinor, v.currency, true) + '<small>' + esc(L('상계', 'Offsets')) + '</small></span><b>+</b><span>' + money(b.adjustmentsMinor, v.currency, true) + '<small>' + esc(L('조정', 'Adjustments')) + '</small></span><b>=</b><span class="res">' + money(b.closingMinor, v.currency) + '<small>' + esc(L('기말 잔액', 'Closing')) + ' ' + (idt.ok ? '✔' : '✖') + '</small></span></div>' +
      '<div class="muted small">' + esc(LF('대기(pending) 소진 {0}은 확정 전이므로 잔액에서 차감하지 않습니다. 정정은 덮어쓰기가 아니라 “조정” 거래로 남깁니다.', 'Pending consumption {0} is not deducted until confirmed. Corrections are ADJUSTMENT rows, never overwrites.', Money.format(b.pendingConsumptionMinor, v.currency))) + '</div></div></div>';
    const rows = Ledger.statement(st.ledger, sel);
    const cols = [
      { k: 'at', h: L('발생 일시', 'Occurred at'), v: t => esc(t.occurredAt), s: t => t.occurredAt },
      { k: 'type', h: L('유형', 'Type'), v: t => esc(lab('txType', t.type)), s: t => t.type },
      { k: 'amt', h: L('금액', 'Amount'), cls: 'num', v: t => (t.deltaMinor < 0 ? '−' : t.deltaMinor > 0 ? '+' : '') + money(Math.abs(t.amountMinor), t.currency), s: t => t.amountMinor },
      { k: 'ccy', h: L('통화', 'Ccy'), v: t => esc(t.currency), s: t => t.currency },
      { k: 'per', h: L('귀속월/상태', 'Period / status'), v: t => esc((t.period || '') + (t.status ? ' · ' + t.status : '')), s: t => (t.period || '') },
      { k: 'ref', h: L('참조/사유', 'Ref / reason'), v: t => esc((t.externalRef || '') + (t.reason ? ' · ' + t.reason : '')), s: t => t.externalRef || '' },
      { k: 'src', h: L('출처', 'Source'), v: t => esc(t.source || '') + (t.importBatchId ? ' <span class="muted small">' + esc(t.importBatchId) + '</span>' : ''), s: t => t.source || '' },
      { k: 'run', h: L('누적 잔액', 'Running balance'), cls: 'num', v: t => money(t.runningMinor, t.currency), s: t => t.runningMinor },
      { k: 'id', h: 'TX ID', v: t => '<span class="small muted">' + esc(t.txId) + '</span>', s: t => t.txId },
    ];
    const stmt = '<div class="panel"><h3>' + esc(L('거래 이력 (append-only)', 'Transaction history (append-only)')) + '</h3><div class="body">' + U.table('ledger', cols, rows, { sort: 'at' }) + '</div></div>';
    // currency balances across contracts + reconciliation
    const byCcy = Money.sumByCurrency(m.views.map(x => ({ currency: x.currency, minor: x.balance.closingMinor })));
    const rcols = [
      { k: 'h', h: L('호텔', 'Hotel'), v: x => '<a href="#/ledger/' + esc(x.contractId) + '">' + hotelName(x.hotel) + '</a>', s: x => tt(x.hotel.name), t: x => x.hotel.name.ko + ' ' + x.hotel.name.en },
      { k: 'c', h: L('계약', 'Contract'), v: x => esc(x.contractId), s: x => x.contractId },
      { k: 'l', h: L('OMH 원장(확인일 기준)', 'OMH ledger (as of confirmation)'), cls: 'num', v: x => money(x.recon.ledgerAtMinor, x.currency) + (x.recon.ledgerAtMinor !== x.balance.closingMinor ? '<div class="muted small">' + esc(L('현재 ', 'now ')) + money(x.balance.closingMinor, x.currency) + '</div>' : ''), s: x => x.recon.ledgerAtMinor },
      { k: 'hc', h: L('호텔 확인 잔액', 'Hotel confirmed'), cls: 'num', v: x => x.recon.confirmedMinor == null ? '—' : money(x.recon.confirmedMinor, x.currency), s: x => x.recon.confirmedMinor },
      { k: 'd', h: L('차이(원장−호텔)', 'Diff (ledger−hotel)'), cls: 'num', v: x => x.recon.diffMinor == null ? '—' : '<span class="' + (x.recon.status === 'MAJOR' ? 'bad' : '') + '">' + money(x.recon.diffMinor, x.currency) + '</span>', s: x => x.recon.diffMinor },
      { k: 's', h: L('상태', 'Status'), v: x => esc(lab('recon', x.recon.status)) + (x.recon.stale ? ' ' + chip(L('오래됨', 'stale'), 'warn') : ''), s: x => x.recon.status },
      { k: 'at', h: L('확인일', 'Confirmed on'), v: x => esc(x.recon.confirmedAt || '—'), s: x => x.recon.confirmedAt || '' },
    ];
    const recon = '<div class="panel"><h3>' + esc(L('통화별 잔액 · 호텔 확인 잔액 대사', 'Balances by currency · reconciliation with hotel')) + '</h3><div class="body"><div class="toolbar"><b>' + esc(L('통화별 합계', 'Totals by currency')) + '</b> ' + moneyMap(byCcy) + '</div>' + U.table('recon', rcols, m.views, { sort: 's' }) +
      '<div class="toolbar form-inline"><b>' + esc(L('호텔 확인 잔액 입력', 'Record hotel-confirmed balance')) + ' (' + esc(v.contractId) + ')</b><input id="cf-amt" placeholder="' + esc(LF('금액 ({0})', 'Amount ({0})', v.currency)) + '" ' + dis('confirmation.write') + '><input id="cf-date" aria-label="confirmed on" type="date" value="' + esc(m.asOf) + '" max="' + esc(m.asOf) + '" ' + dis('confirmation.write') + '><button class="btn" data-act="add-conf" ' + dis('confirmation.write') + '>' + esc(L('확인 잔액 기록', 'Record')) + '</button></div></div></div>';
    const txForm = '<div class="panel"><h3>' + esc(L('거래 수기 입력', 'Manual transaction entry')) + '</h3><div class="body"><div class="toolbar form-inline">' +
      '<select id="tx-type" aria-label="transaction type" ' + dis('ledger.write') + '>' + ['TOPUP', 'CONSUMPTION', 'REFUND', 'OFFSET', 'ADJUSTMENT'].map(t => '<option value="' + t + '">' + esc(lab('txType', t)) + '</option>').join('') + '</select>' +
      '<input id="tx-amt" placeholder="' + esc(LF('금액 ({0})', 'Amount ({0})', v.currency)) + '" ' + dis('ledger.write') + '><input id="tx-at" aria-label="occurred at" type="datetime-local" value="' + esc(m.asOf) + 'T09:00" ' + dis('ledger.write') + '>' +
      '<input id="tx-period" placeholder="' + esc(L('소진 귀속월 YYYY-MM', 'Period YYYY-MM')) + '" size="9" ' + dis('ledger.write') + '><select id="tx-status" aria-label="consumption status" ' + dis('ledger.write') + '><option value="confirmed">confirmed</option><option value="pending">pending</option></select>' +
      '<input id="tx-ref" placeholder="' + esc(L('외부 참조번호(중복방지 키)', 'External ref (dedup key)')) + '" ' + dis('ledger.write') + '><input id="tx-reason" placeholder="' + esc(L('조정·상계 사유', 'Adjustment / offset reason')) + '" ' + dis('ledger.write') + '>' +
      '<button class="btn primary" data-act="add-tx" ' + dis('ledger.write') + '>' + esc(L('거래 추가', 'Add transaction')) + '</button></div><div class="muted small">' + esc(LF('거래는 계약 통화({0})로만 입력됩니다. 조정은 부호 있는 금액(−허용)입니다.', 'Amounts are in the contract currency ({0}) only. Adjustments take a signed amount.', v.currency)) + '</div></div></div>';
    // CSV upload
    const up = ctx.ui.csv;
    const csvRows = up && up.result ? (up.result.fatal.length ? '<div class="note bad">' + up.result.fatal.map(x => esc(U.errText(x))).join(' · ') + '</div>' :
      '<div class="muted">' + esc(L('검증 결과', 'Validation')) + ': ' + chip('ACCEPT ' + up.result.summary.accept, 'ok') + ' ' + chip('DUPLICATE ' + up.result.summary.duplicate, 'warn') + ' ' + chip('REJECT ' + up.result.summary.reject, 'bad') + '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>' + esc(L('판정', 'Verdict')) + '</th><th>' + esc(L('계약', 'Contract')) + '</th><th>' + esc(L('유형', 'Type')) + '</th><th class="num">' + esc(L('금액', 'Amount')) + '</th><th>' + esc(L('사유', 'Reasons')) + '</th></tr></thead><tbody>' +
      up.result.rows.map(r => '<tr><td>' + r.line + '</td><td>' + chip(r.status, r.status === 'ACCEPT' ? 'ok' : r.status === 'DUPLICATE' ? 'warn' : 'bad') + '</td><td>' + esc(r.tx.contractId) + '</td><td>' + esc(r.tx.type) + '</td><td class="num">' + esc(Number.isNaN(r.tx.amountMinor) ? '—' : Money.isSupported(r.tx.currency) ? Money.format(r.tx.amountMinor, r.tx.currency) : r.tx.amountMinor + ' ' + r.tx.currency) + '</td><td class="small">' + r.errors.map(e => esc(U.errText(e))).join(', ') + '</td></tr>').join('') + '</tbody></table></div>') : '';
    const batches = st.importBatches.length ? '<div class="table-wrap"><table><thead><tr><th>Batch</th><th>' + esc(L('파일', 'File')) + '</th><th>' + esc(L('일시', 'At')) + '</th><th>' + esc(L('반영', 'Committed')) + '</th><th>' + esc(L('요약', 'Summary')) + '</th></tr></thead><tbody>' + st.importBatches.map(x => '<tr><td>' + esc(x.batchId) + '</td><td>' + esc(x.fileName) + (x.alreadyImported ? ' ' + chip(L('동일 파일 재업로드', 're-upload'), 'warn') : '') + '</td><td>' + esc(x.at) + '</td><td>' + x.committed + '</td><td class="small">A' + x.summary.accept + ' / D' + x.summary.duplicate + ' / R' + x.summary.reject + '</td></tr>').join('') + '</tbody></table></div>' : '';
    const csv = '<div class="panel"><h3>' + esc(L('CSV 업로드 · 검증 (2단계: 검증 → 반영)', 'CSV upload · validation (2 steps: validate → commit)')) + '</h3><div class="body">' +
      '<div class="muted small">' + esc(L('필수 열: ', 'Required columns: ')) + Csv.REQUIRED.join(', ') + ' · ' + esc(L('선택: ', 'optional: ')) + Csv.OPTIONAL.join(', ') + '</div>' +
      '<div class="toolbar"><input type="file" id="csv-file" aria-label="CSV file" accept=".csv,text/csv" ' + dis('ledger.import') + '><button class="btn sm" data-act="csv-sample">' + esc(L('샘플 CSV 불러오기', 'Load sample CSV')) + '</button></div>' +
      '<textarea id="csv-text" rows="5" placeholder="CSV…" ' + dis('ledger.import') + '>' + esc(up ? up.text : '') + '</textarea>' +
      '<div class="toolbar"><button class="btn" data-act="csv-validate" ' + dis('ledger.import') + '>' + esc(L('1) 검증(반영 안 함)', '1) Validate (no changes)')) + '</button><button class="btn primary" data-act="csv-commit" ' + dis('ledger.import') + '>' + esc(L('2) 승인된 행만 반영', '2) Commit accepted rows')) + '</button></div>' + csvRows + batches + '</div></div>';
    return picker + eq + stmt + recon + txForm + csv;
  }
  function download(name, text, type) { const blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0); }
  function ledgerBind(el, ctx) {
    const sel = ctx.params[0] || ctx.ui.ledgerContract || ctx.m.views[0].contractId; const v = ctx.m.byContract[sel]; const cmd = ctx.store.commands; const $ = s => el.querySelector(s);
    $('#lg-sel').addEventListener('change', e => { ctx.ui.ledgerContract = e.target.value; ctx.navigate('/ledger/' + e.target.value); });
    U.tableEvents(el, ctx.rerender);
    const on = (a, fn) => { const b = $('[data-act="' + a + '"]'); if (b) b.addEventListener('click', fn); };
    on('export-csv', () => { const rows = Ledger.statement(ctx.store.state.ledger, sel).map(t => ({ txId: t.txId, contractId: t.contractId, type: t.type, amount: Money.format(t.amountMinor, t.currency, { noCode: true }).replace(/,/g, ''), currency: t.currency, occurredAt: t.occurredAt, period: t.period || '', status: t.status || '', reason: t.reason || '', externalRef: t.externalRef || '' }));
      download('ledger_' + sel + '.csv', Csv.toCSV(['txId', 'contractId', 'type', 'amount', 'currency', 'occurredAt', 'period', 'status', 'reason', 'externalRef'], rows)); });
    on('add-conf', () => { const p = Money.parseAmount($('#cf-amt').value, v.currency); if (!p.ok) return ctx.toast(U.errText(p.error), 'bad'); ctx.run(() => cmd.addConfirmation({ contractId: sel, amountMinor: p.minor, currency: v.currency, confirmedAt: $('#cf-date').value }), L('확인 잔액을 기록했습니다.', 'Confirmation recorded.')); });
    on('add-tx', () => { const type = $('#tx-type').value; const p = Money.parseAmount($('#tx-amt').value, v.currency); if (!p.ok) return ctx.toast(U.errText(p.error), 'bad');
      const at = $('#tx-at').value; const tx = { contractId: sel, type, amountMinor: p.minor, currency: v.currency, occurredAt: at.length === 16 ? at + ':00+09:00' : at, externalRef: $('#tx-ref').value || undefined };
      if (type === 'CONSUMPTION') { tx.period = $('#tx-period').value; tx.status = $('#tx-status').value; } if (type === 'ADJUSTMENT' || type === 'OFFSET') tx.reason = $('#tx-reason').value;
      ctx.run(() => cmd.addTx(tx), L('거래를 추가했습니다.', 'Transaction added.')); });
    const setCsv = res => { ctx.ui.csv = { text: $('#csv-text').value, result: res }; ctx.rerender(); };
    $('#csv-file').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { ctx.ui.csv = { text: String(rd.result), result: null, fileName: f.name }; ctx.rerender(); }; rd.readAsText(f); });
    on('csv-sample', () => { ctx.ui.csv = { text: SAMPLE_CSV, result: null, fileName: 'sample_ledger.csv' }; ctx.rerender(); });
    on('csv-validate', () => { try { setCsv(ctx.store.commands.validateCsv($('#csv-text').value)); } catch (e) { ctx.toast(U.errText(e.code || 'E_FORBIDDEN'), 'bad'); } });
    on('csv-commit', () => { const text = $('#csv-text').value; ctx.run(() => { const r = cmd.importCsv(text, (ctx.ui.csv && ctx.ui.csv.fileName) || 'pasted.csv'); if (r.ok) ctx.ui.csv = { text, result: ctx.store.commands.validateCsv(text), fileName: ctx.ui.csv && ctx.ui.csv.fileName }; return r; },
      L('승인된 행을 반영했습니다(중복·오류 행 제외).', 'Accepted rows committed (duplicates / errors skipped).')); });
  }

  /* ============ Top-up simulator (panel inside the hotel credit card) ============ */
  function simulate(ctx, v, amountStr) {
    const p = Money.parseAmount(amountStr, v.currency); if (!p.ok) return { ok: false, errors: [p.error] };
    return Limit.simulate(v.limit, v.forecast, p.minor, v.contract, { daysPerMonth: ctx.store.state.config.forecast.daysPerMonth, addDays: Dates.addDays, asOf: ctx.m.asOf });
  }
  /** Result of one what-if top-up (HTML). Pure: reads the model, writes nothing. */
  function simResult(ctx, v, amt) {
    const id = v.contractId;
    let res = '';
    if (amt !== '') {
      const s = simulate(ctx, v, amt);
      if (!s.ok) res = '<div class="note bad">' + s.errors.map(e => esc(U.errText(e))).join(' · ') + '</div>';
      else res = '<div class="panel sim-res"><h3>' + esc(L('시뮬레이션 결과', 'Simulation result')) + ' ' + chip('SIMULATION', 'warn') + '</h3><div class="body"><div class="grid3">' +
        '<div><div class="k">' + esc(L('현재 잔액', 'Current balance')) + '</div><b>' + money(s.currentMinor, v.currency) + '</b></div><div><div class="k">' + esc(L('신청 충전액', 'Requested')) + '</div><b>' + money(s.requestedMinor, v.currency) + '</b></div>' +
        '<div><div class="k">' + esc(L('충전 후 잔액(총 노출)', 'Post-top-up exposure')) + '</div><b>' + money(s.projectedMinor, v.currency) + '</b></div>' +
        '<div><div class="k">' + esc(L('권장 한도', 'Recommended limit')) + '</div><b>' + (s.recommendedLimitMinor == null ? esc(L('산정 불가', 'n/a')) : money(s.recommendedLimitMinor, v.currency)) + '</b></div>' +
        '<div><div class="k">' + esc(L('초과 금액', 'Excess')) + '</div><b class="' + (s.excessMinor > 0 ? 'bad' : '') + '">' + (s.excessMinor == null ? '—' : money(s.excessMinor, v.currency)) + '</b></div>' +
        '<div><div class="k">' + esc(L('한도 초과 여부', 'Limit exceeded')) + '</div><b>' + (s.limitExceeded ? '<span class="bad">' + esc(L('초과', 'YES')) + '</span>' : esc(L('아니오', 'No'))) + '</b></div>' +
        '<div><div class="k">' + esc(L('충전 후 예상 소진일', 'Projected depletion after top-up')) + '</div><b>' + esc(s.postDepletionDate || L('예측 불가(소진 실적 없음)', 'n/a (no consumption)')) + '</b></div>' +
        '<div><div class="k">' + esc(L('위험도', 'Risk level')) + '</div><b>' + chip(lab('risk', s.risk), s.risk === 'LOW' ? 'ok' : s.risk === 'MEDIUM' ? 'warn' : 'bad') + '</b></div>' +
        '<div><div class="k">' + esc(L('대표 승인 필요', 'CEO approval required')) + '</div><b>' + (s.approvalRequired ? '<span class="bad">' + esc(L('필요', 'REQUIRED')) + '</span>' : esc(L('한도 내 — 일반 결재 절차', 'Within limit — normal approval flow'))) + '</b></div></div>' +
        (s.approvalReasons.length ? '<div class="note bad">' + s.approvalReasons.map(x => esc(lab('hold', x))).join(' · ') + '</div>' : '') +
        '<div class="toolbar"><a class="btn primary" href="#/approval/' + esc(id) + '" data-keep-amt="1">' + esc(L('이 시뮬레이션으로 선급 결재 자료 미리보기', 'Preview the prepayment approval packet from this simulation')) + '</a></div></div></div>';
    } else res = '<div class="muted">' + esc(L('충전 신청액을 입력하면 즉시 계산합니다.', 'Enter a requested amount to calculate instantly.')) + '</div>';
    return res;
  }
  /** The top-up simulator as a panel inside the hotel credit card (section 7). The amount is remembered per contract, never stored. */
  function simPanel(ctx, v) {
    const amt = ctx.ui.simAmount != null && (ctx.ui.simFor == null || ctx.ui.simFor === v.contractId) ? ctx.ui.simAmount : '';
    const banner = '<div class="note warn">' + esc(L('시뮬레이션 전용 — 원장·잔액·결재에 아무것도 반영되지 않습니다.', 'SIMULATION ONLY — nothing is written to the ledger, balances or any approval.')) + '</div>';
    const input = '<div class="toolbar"><label>' + esc(L('신청 충전액', 'Requested top-up')) + ' (' + esc(v.currency) + ') <input id="sim-amt" inputmode="decimal" value="' + esc(amt) + '" placeholder="0"></label></div>';
    return '<div class="panel" id="sim-panel"><h3>' + esc(L('충전 시뮬레이터', 'Top-up simulator')) + ' ' + chip('SIMULATION', 'warn') + '</h3><div class="body">' + banner + input + '<div id="sim-result">' + simResult(ctx, v, amt) + '</div></div></div>';
  }
  function simBind(el, ctx, v) {
    const inp = el.querySelector('#sim-amt'); const out = el.querySelector('#sim-result'); if (!inp || !out || !v) return;
    inp.addEventListener('input', () => { ctx.ui.simAmount = inp.value; ctx.ui.simFor = v.contractId; out.innerHTML = simResult(ctx, v, inp.value); });   // only the result box is redrawn, so focus and scroll stay
  }
  return { ledger, ledgerBind, simPanel, simBind, simResult, simulate, SAMPLE_CSV };
});
