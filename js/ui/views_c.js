/* Screens 05 (Risk Monitoring), 07 (Prepayment Approval Packet and CEO Review), 08 (Administration). */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(NS);
  NS.ViewsC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (NS) {
  'use strict';
  const U = NS.UI, { L, LF, esc, tt, lab, money, moneyMap, gradeBadge, sevBadge, chip, hotelName } = U;
  const RBAC = NS.RBAC, Money = NS.Money, Alerts = NS.Alerts, Rating = NS.Rating, Config = NS.Config, Adapters = NS.Adapters, Dates = NS.Dates, Limit = NS.Limit;

  const evStr = a => (a.evidence || []).map(e => { const val = typeof e.v === 'number' && /Minor|diff|ledger|hotelConfirmed|balance|unused|outstanding/i.test(e.k) ? e.v.toLocaleString('en-US') : e.v; return esc(e.k + '=' + val); }).join(' · ');

  /* ============ Screen 05 — Risk Monitoring Center ============ */
  function risk(ctx) {
    const m = ctx.m, st = ctx.store.state, f = ctx.ui.riskFilter || {};
    const can = p => RBAC.can(ctx.store.session.role, p);
    const all = []; for (const v of m.views) for (const a of v.alerts) all.push({ a, v });
    const act = all.filter(x => (!f.sev || x.a.severity === f.sev) && (!f.status || x.a.status === f.status)).sort((x, y) => Alerts.SEV_RANK[x.a.severity] - Alerts.SEV_RANK[y.a.severity]);
    const filt = '<div class="toolbar filters"><label>' + esc(L('심각도', 'Severity')) + ' <select data-rf="sev"><option value="">' + esc(L('전체', 'All')) + '</option>' + ['CRITICAL', 'HIGH', 'MEDIUM'].map(s => '<option value="' + s + '" ' + (f.sev === s ? 'selected' : '') + '>' + esc(lab('sev', s)) + '</option>').join('') + '</select></label>' +
      '<label>' + esc(L('처리 상태', 'Status')) + ' <select data-rf="status"><option value="">' + esc(L('전체', 'All')) + '</option>' + Alerts.STATUSES.map(s => '<option value="' + s + '" ' + (f.status === s ? 'selected' : '') + '>' + esc(lab('alertStatus', s)) + '</option>').join('') + '</select></label>' +
      '<span class="spacer"></span><span class="muted">' + esc(L('기준일 ', 'As of ')) + esc(m.asOf) + '</span></div>';
    const cols = [
      { k: 'sev', h: L('심각도', 'Severity'), v: x => sevBadge(x.a.severity), s: x => Alerts.SEV_RANK[x.a.severity] },
      { k: 'hotel', h: L('위험 발생 호텔', 'Hotel'), v: x => '<a href="#/profile/' + esc(x.v.contractId) + '">' + hotelName(x.v.hotel) + '</a><div class="muted small">' + esc(x.v.contractId) + '</div>', s: x => tt(x.v.hotel.name), t: x => x.v.hotel.name.ko + ' ' + x.v.hotel.name.en },
      { k: 'risk', h: L('위험 내용', 'Risk'), v: x => '<b>' + esc(tt(x.a.title)) + '</b>', s: x => tt(x.a.title) },
      { k: 'ev', h: L('근거 데이터', 'Evidence'), v: x => '<span class="small">' + evStr(x.a) + '</span>', s: x => x.a.evidence.length, t: x => evStr(x.a) },
      { k: 'at', h: L('감지 일시', 'Detected'), v: x => esc((x.a.persisted && x.a.persisted.firstDetectedAt) || x.a.detectedAt), s: x => x.a.detectedAt },
      { k: 'act', h: L('권고 조치', 'Recommended action'), v: x => esc(lab('action', x.a.action)), s: x => x.a.action },
      { k: 'scm', h: L('담당 SCM', 'Assigned SCM'), v: x => esc(x.a.assignedScm || '—'), s: x => x.a.assignedScm },
      { k: 'st', h: L('처리 상태', 'Status'), v: x => '<span class="chip">' + esc(lab('alertStatus', x.a.status)) + '</span>', s: x => x.a.status },
      { k: 'op', h: L('조치', 'Update'), v: x => '' },
    ];
    cols[cols.length - 1].v = x => '<select data-al="' + esc(x.a.alertId) + '" aria-label="status" ' + (can('alert.update') ? '' : 'disabled') + '>' + Alerts.STATUSES.map(s => '<option value="' + s + '" ' + (s === x.a.status ? 'selected' : '') + '>' + esc(lab('alertStatus', s)) + '</option>').join('') + '</select> <input data-aln="' + esc(x.a.alertId) + '" placeholder="' + esc(L('메모', 'note')) + '" size="10" ' + (can('alert.update') ? '' : 'disabled') + '> <button class="btn sm" data-alsave="' + esc(x.a.alertId) + '" ' + (can('alert.update') ? '' : 'disabled') + '>OK</button>';
    const hotelRisk = m.views.filter(Model_isHigh).map(v => '<a class="chip bad" href="#/profile/' + esc(v.contractId) + '">' + esc(tt(v.hotel.name)) + ' ' + esc(v.rating.grade) + '</a>').join(' ') || '<span class="muted">—</span>';
    const hist = st.alerts.filter(a => a.clearedAt || a.status === 'RESOLVED' || a.status === 'DISMISSED').sort((a, b) => (b.clearedAt || '').localeCompare(a.clearedAt || ''));
    const hcols = [
      { k: 'sev', h: L('심각도', 'Severity'), v: a => sevBadge(a.severity), s: a => Alerts.SEV_RANK[a.severity] },
      { k: 'h', h: L('호텔/계약', 'Hotel / contract'), v: a => esc(a.contractId), s: a => a.contractId },
      { k: 't', h: L('위험', 'Risk'), v: a => esc(tt(a.title)), s: a => tt(a.title) },
      { k: 'f', h: L('최초 감지', 'First detected'), v: a => esc(a.firstDetectedAt || a.detectedAt), s: a => a.firstDetectedAt },
      { k: 'c', h: L('해소', 'Cleared'), v: a => esc(a.clearedAt || '—'), s: a => a.clearedAt || '' },
      { k: 's', h: L('상태', 'Status'), v: a => esc(lab('alertStatus', a.status)) + (a.autoCleared ? ' ' + chip(L('자동 해소', 'auto-cleared')) : ''), s: a => a.status },
      { k: 'n', h: L('조치 메모', 'Notes'), v: a => '<span class="small">' + (a.notes || []).map(n => esc(n.at + ' ' + n.by + ': ' + n.text)).join('<br>') + '</span>', s: a => (a.notes || []).length },
    ];
    return filt + '<div class="panel"><h3>' + esc(L('위험 호텔 (D·NR 등급 또는 치명/높음 경보)', 'High-risk hotels (grade D/NR or Critical/High alert)')) + '</h3><div class="body">' + hotelRisk + '</div></div>' +
      '<div class="panel"><h3>' + esc(L('활성 위험 경보', 'Active alerts')) + '</h3><div class="body">' + U.table('risk', cols, act, { sort: 'sev', empty: L('조건에 맞는 경보가 없습니다.', 'No alerts match the filter.') }) +
      '<div class="muted small">' + esc(L('“해결·기각” 처리에는 메모가 필요하며, 기각은 대표/관리자만 가능합니다. 기각은 조건이 계속되는 동안 유지되고, 해소된 뒤 다시 발생하면 재개됩니다. 검증된 사실이 근거인 치명 경보는 사실을 먼저 철회해야 합니다.', 'Resolve/Dismiss need a note; dismissal is CEO/Admin only. A dismissal holds while the condition persists and reopens if it recurs after clearing. A critical alert backed by a verified fact cannot be dismissed — retract the fact first.')) + '</div></div></div>' +
      '<div class="panel"><h3>' + esc(L('과거 위험 이력', 'Alert history')) + '</h3><div class="body">' + U.table('rhist', hcols, hist, { sort: 'c', empty: L('이력이 없습니다.', 'No history.') }) + '</div></div>';
  }
  function Model_isHigh(v) { return NS.Model.isHighRisk(v); }
  function riskBind(el, ctx) {
    el.querySelectorAll('[data-rf]').forEach(s => s.addEventListener('change', () => { ctx.ui.riskFilter = Object.assign({}, ctx.ui.riskFilter, { [s.getAttribute('data-rf')]: s.value }); ctx.rerender(); }));
    U.tableEvents(el, ctx.rerender);
    el.querySelectorAll('[data-alsave]').forEach(b => b.addEventListener('click', () => { const id = b.getAttribute('data-alsave'); const st = el.querySelector('[data-al="' + id + '"]').value; const note = el.querySelector('[data-aln="' + id + '"]').value; ctx.run(() => ctx.store.commands.updateAlert(id, st, note), L('경보 상태를 변경했습니다.', 'Alert updated.')); }));
  }

  /* ============ Screen 07 — Prepayment Approval Packet and CEO Review (route approval) ============ */
  function approvalPage(ctx) {
    const m = ctx.m, st = ctx.store.state; const id = ctx.params[0] || ctx.ui.approvalContract || m.views[0].contractId; const v = m.byContract[id]; if (!v) return U.emptyState(L('계약을 찾을 수 없습니다.', 'Contract not found.'));
    const role = ctx.store.session.role; const can = p => RBAC.can(role, p); const dis = p => (can(p) ? '' : 'disabled title="' + esc(L('권한 없음', 'No permission')) + '"');
    const amt = ctx.ui.simAmount != null ? ctx.ui.simAmount : '';
    const picker = '<div class="toolbar no-print"><label>' + esc(L('계약', 'Contract')) + ' <select id="portal-sel">' + m.views.map(x => '<option value="' + esc(x.contractId) + '" ' + (x.contractId === id ? 'selected' : '') + '>' + esc(tt(x.hotel.name) + ' · ' + x.contractId + ' · ' + x.currency) + '</option>').join('') + '</select></label>' +
      '<label>' + esc(L('요청 충전액', 'Requested top-up')) + ' (' + esc(v.currency) + ') <input id="portal-amt" value="' + esc(amt) + '" inputmode="decimal"></label></div>';
    const p = amt === '' ? null : Money.parseAmount(amt, v.currency);
    const sim = p && p.ok ? Limit.simulate(v.limit, v.forecast, p.minor, v.contract, { daysPerMonth: st.config.forecast.daysPerMonth, addDays: Dates.addDays, asOf: m.asOf }) : null;
    let report = '';
    if (!sim || !sim.ok) report = '<div class="muted no-print">' + esc(amt === '' ? L('요청 충전액을 입력하면 승인 보고서 미리보기가 생성됩니다.', 'Enter a requested amount to generate the approval preview.') : (p && !p.ok ? U.errText(p.error) : '')) + '</div>';
    else {
      const opinion = st.ratings[id].scmOpinion; const f = v.forecast;
      const row = (k, val) => '<tr><th>' + esc(k) + '</th><td>' + val + '</td></tr>';
      report = '<div class="report" id="portal-report"><div class="mockstamp">' + esc(L('모의 · 실제 결재/송금 아님', 'MOCK · not a real approval / payment')) + '</div><h2>' + esc(L('■ 호텔 선급 결재 요청서 (미리보기)', '■ Hotel Prepayment Approval Request (preview)')) + '</h2>' +
        '<div class="rmeta">' + esc(L('기준일 ', 'As of ')) + esc(m.asOf) + ' · ' + esc(L('샘플 데이터', 'SAMPLE data')) + ' · ' + esc(L('등급은 잠정(대표 승인 전)', 'Grade provisional pending CEO approval')) + '</div><table>' +
        row(L('호텔명 / 계약 법인', 'Hotel / contracting entity'), esc(tt(v.hotel.name)) + ' (' + esc(v.hotelId) + ') / ' + esc(v.contract.omhEntity) + ' ↔ ' + esc(v.contract.counterparty.legalName)) +
        row(L('계약 / 선급금 유형 / 통화', 'Contract / type / currency'), esc(v.contractId + ' / ' + lab('ptype', v.contract.prepaymentType) + ' / ' + v.currency)) +
        row(L('신용등급', 'Credit grade'), gradeBadge(v.rating.grade) + ' ' + esc(L('점수 ', 'score ') + (v.rating.score == null ? '—' : v.rating.score) + ' · ' + L('신뢰도 ', 'confidence ') + v.rating.confidence.pct + '%')) +
        row(L('평가 근거', 'Rating basis'), esc(v.rating.flags.length ? v.rating.flags.map(x => tt(Rating.FLAG_META[x.id])).join(' · ') : L('레드플래그 없음', 'no red flags')) + (v.rating.confidence.unknownIds.length ? '<br><span class="muted small">' + esc(LF('미확인 항목 {0}개', '{0} criteria unknown', v.rating.confidence.unknownIds.length)) + '</span>' : '')) +
        row(L('기존 선급 잔액', 'Existing prepaid balance'), money(sim.currentMinor, v.currency)) +
        row(L('평균 소진액(최근 3개월 확정)', 'Avg monthly consumption (last 3 confirmed)'), f.avgMinor == null ? esc(L('산정 불가', 'n/a')) : money(f.avgMinor, v.currency) + ' <span class="muted small">(' + esc(lab('quality', f.quality)) + ')</span>') +
        row(L('권장 선급 한도', 'Recommended limit'), sim.recommendedLimitMinor == null ? esc(L('산정 불가', 'n/a')) : money(sim.recommendedLimitMinor, v.currency)) +
        row(L('요청 충전액', 'Requested top-up'), '<b>' + money(sim.requestedMinor, v.currency) + '</b>') +
        row(L('충전 후 총 노출액', 'Post-top-up exposure'), money(sim.projectedMinor, v.currency)) +
        row(L('한도 초과 여부', 'Limit exceeded'), sim.limitExceeded ? '<b class="bad">' + esc(L('초과', 'YES')) + '</b> ' + (sim.excessMinor == null ? '' : money(sim.excessMinor, v.currency)) : esc(L('아니오', 'No'))) +
        row(L('대표 승인 필요 사유', 'CEO approval reasons'), sim.approvalReasons.length ? sim.approvalReasons.map(x => esc(lab('hold', x))).join(' · ') : esc(L('없음(한도 내)', 'none (within limit)'))) +
        row(L('주요 위험 알림', 'Key risk alerts'), v.liveAlerts.filter(a => a.severity !== 'MEDIUM').map(a => sevBadge(a.severity) + ' ' + esc(tt(a.title))).join('<br>') || esc(L('치명/높음 경보 없음', 'no Critical/High alerts'))) +
        row(L('회수 가능성(등급과 별도)', 'Recoverability (separate)'), esc(lab('recov', v.recoverability.tier)) + ' · ' + esc(L('무담보 노출 ', 'unsecured ')) + money(v.recoverability.unsecuredMinor, v.currency)) +
        row(L('SCM 검토 의견', 'SCM review opinion'), opinion ? esc(opinion.text) + ' <span class="muted small">— ' + esc(opinion.by) + '</span>' : '<span class="bad">' + esc(L('의견 미작성', 'not written')) + '</span>') +
        row(L('대표 검토 상태', 'CEO review status'), (() => { const la = st.approvals.filter(x => x.contractId === id).pop(); return la ? esc(lab('apStatus', la.status)) + (la.feedback ? '<br><span class="small">' + esc(la.feedback.text) + ' — ' + esc(la.feedback.by) + '</span>' : '') : esc(L('요청 기록 없음 (실제 결재는 결재 포털에서 이루어집니다)', 'No request yet (the real approval happens in the approval portal)')); })()) +
        '</table><div class="sign">' + esc(L('검토  SCM □   대표이사 □  (검토 완료 · 담당자에게 의견 전달)', 'Review  SCM □   CEO □  (review done · feedback to the person in charge)')) + '</div></div>';
    }
    const aps = st.approvals.filter(a => a.contractId === id);
    const apRows = aps.map(a => {
      const btns = (a.status === 'DRAFT' ? '<button class="btn sm" data-apsubmit="' + esc(a.approvalId) + '" ' + dis('approval.submit') + '>' + esc(L('대표에게 검토 요청(모의)', 'Request CEO review (mock)')) + '</button>' : '') +
        (a.status === 'SUBMITTED_MOCK' ? '<input data-apfb="' + esc(a.approvalId) + '" placeholder="' + esc(L('담당자에게 전달할 검토 의견(필수)', 'Feedback for the person in charge (required)')) + '" size="30" aria-label="feedback" ' + dis('approval.review') + '> <button class="btn sm primary" data-apreview="' + esc(a.approvalId) + '" ' + dis('approval.review') + '>' + esc(L('검토 완료 · 의견 전달', 'Review done · send feedback')) + '</button>' : '');
      return '<tr><td>' + esc(a.approvalId) + '</td><td>' + esc(a.createdAt) + ' ' + esc(a.createdBy) + '</td><td class="num">' + money(a.packet.request.requestedMinor, v.currency) + '</td><td>' + chip(lab('apStatus', a.status), a.status === 'CEO_REVIEWED' ? 'ok' : '') + '</td><td class="small">' + (a.feedback ? esc(a.feedback.text) + '<div class="muted">' + esc(a.feedback.by + ' · ' + a.feedback.at) + '</div>' : '<span class="muted">—</span>') + '</td><td class="small">' + esc(a.packet.fingerprint) + (a.ack ? ' · ' + esc(a.ack.ref) : '') + '</td><td>' + btns + '</td></tr>'; }).join('');
    const apList = '<div class="panel no-print"><h3>' + esc(L('이 계약의 검토 요청 기록 (모의)', 'Review requests for this contract (mock)')) + '</h3><div class="body">' + (aps.length ? '<div class="table-wrap"><table><thead><tr><th>ID</th><th>' + esc(L('작성', 'Created')) + '</th><th class="num">' + esc(L('요청액', 'Requested')) + '</th><th>' + esc(L('상태', 'Status')) + '</th><th>' + esc(L('대표 검토 의견', 'CEO feedback')) + '</th><th>' + esc(L('지문/참조', 'Fingerprint / ref')) + '</th><th></th></tr></thead><tbody>' + apRows + '</tbody></table></div>' : U.emptyState(L('검토 요청 기록이 없습니다.', 'No review requests yet.'))) +
      '<div class="muted small">' + esc(L('대표는 요청서를 검토하고 담당자에게 의견을 전달합니다. 이 화면은 승인하지 않으며 자금 이동·실제 결재·원장 변경도 일으키지 않습니다. 실제 결재는 결재 포털에서 이루어지고, 검토 의견 기록은 CEO 역할만 할 수 있습니다.', 'The CEO reviews the request and sends feedback to the person in charge. This screen approves nothing and moves no funds, issues no real approval and changes no ledger. The real approval happens in the approval portal; only the CEO role can record the review feedback.')) + '</div></div></div>';
    const tools = sim && sim.ok ? '<div class="toolbar no-print"><button class="btn primary" data-act="ap-create" ' + dis('approval.create') + '>' + esc(L('검토 요청서 초안 저장', 'Save review-request draft')) + '</button><button class="btn" data-act="print">' + esc(L('인쇄 / PDF 저장', 'Print / Save PDF')) + '</button><button class="btn" data-act="dl-json">' + esc(L('JSON 파일 출력', 'Download JSON')) + '</button></div>' : '';
    return picker + tools + report + apList;
  }
  function approvalPageBind(el, ctx) {
    const id = ctx.params[0] || ctx.ui.approvalContract || ctx.m.views[0].contractId; const v = ctx.m.byContract[id]; const cmd = ctx.store.commands;
    el.querySelector('#portal-sel').addEventListener('change', e => { ctx.ui.approvalContract = e.target.value; ctx.navigate('/approval/' + e.target.value); });
    const inp = el.querySelector('#portal-amt'); inp.addEventListener('change', () => { ctx.ui.simAmount = inp.value; ctx.rerender(); });
    const on = (a, fn) => { const b = el.querySelector('[data-act="' + a + '"]'); if (b) b.addEventListener('click', fn); };
    on('print', () => window.print());
    on('dl-json', () => { const p = Money.parseAmount(ctx.ui.simAmount, v.currency); const sim = Limit.simulate(v.limit, v.forecast, p.minor, v.contract, { daysPerMonth: ctx.store.state.config.forecast.daysPerMonth, addDays: Dates.addDays, asOf: ctx.m.asOf });
      const packet = Adapters.Portal.buildPacket(v, sim, { asOf: ctx.m.asOf, scmOpinion: ctx.store.state.ratings[id].scmOpinion }); const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'approval_packet_' + id + '.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0); });
    on('ap-create', () => { const p = Money.parseAmount(ctx.ui.simAmount, v.currency); if (!p.ok) return ctx.toast(U.errText(p.error), 'bad'); ctx.run(() => cmd.createApproval(id, p.minor), L('검토 요청서 초안을 저장했습니다(모의).', 'Review-request draft saved (mock).')); });
    el.querySelectorAll('[data-apsubmit]').forEach(b => b.addEventListener('click', () => ctx.run(() => cmd.submitApproval(b.getAttribute('data-apsubmit')), L('대표에게 검토를 요청했습니다(모의).', 'Review requested from the CEO (mock).'))));
    el.querySelectorAll('[data-apreview]').forEach(b => b.addEventListener('click', () => { const ap = b.getAttribute('data-apreview'); const fb = el.querySelector('[data-apfb="' + ap + '"]'); ctx.run(() => cmd.reviewApproval(ap, fb ? fb.value : ''), L('검토 의견을 담당자에게 전달했습니다(모의, 자금 이동 없음).', 'Feedback recorded for the person in charge (mock, no funds moved).')); }));
  }

  /* ============ Screen 08 — Administration ============ */
  function admin(ctx) {
    const st = ctx.store.state, cfg = ctx.ui.cfgDraft || (ctx.ui.cfgDraft = JSON.parse(JSON.stringify(st.config)));
    const can = RBAC.can(ctx.store.session.role, 'config.edit'); const dis = can ? '' : 'disabled';
    const wsum = Object.values(cfg.weights).reduce((a, b) => a + (Number(b) || 0), 0);
    const w = '<div class="panel"><h3>' + esc(L('평가 항목 및 가중치 (합계 100)', 'Criteria & weights (must sum to 100)')) + ' <span class="' + (Math.abs(wsum - 100) < 1e-9 ? 'ok' : 'bad') + '">Σ=' + wsum + '</span></h3><div class="body"><div class="table-wrap"><table><thead><tr><th>' + esc(L('항목', 'Criterion')) + '</th><th class="num">' + esc(L('가중치', 'Weight')) + '</th><th>' + esc(L('근거', 'Rationale')) + '</th></tr></thead><tbody>' +
      Rating.CRITERIA.map(c => '<tr><td>' + esc(tt(c.name)) + '</td><td class="num"><input type="number" min="0" max="100" step="1" aria-label="' + esc(tt(c.name)) + '" data-cw="' + esc(c.id) + '" value="' + esc(cfg.weights[c.id]) + '" ' + dis + ' style="width:70px"></td><td class="small muted">' + esc(tt(c.why)) + '</td></tr>').join('') + '</tbody></table></div></div></div>';
    const th = '<div class="panel"><h3>' + esc(L('신용등급 임계값 · 신뢰도 기준 (잠정)', 'Grade thresholds · confidence rules (provisional)')) + '</h3><div class="body form-inline">' +
      ['A', 'B', 'C'].map(g => '<label>' + g + ' ≥ <input type="number" data-th="' + g + '" value="' + esc(cfg.ratingThresholds[g]) + '" ' + dis + ' style="width:70px"></label>').join(' ') + ' <span class="muted">D &lt; C</span><br>' +
      '<label>' + esc(L('NR 기준(알려진 가중치 비율 미만)', 'NR if known-weight share below')) + ' <input type="number" step="0.05" data-cv="minCoverage" value="' + esc(cfg.minCoverage) + '" ' + dis + ' style="width:70px"></label> ' +
      '<label>' + esc(L('낮은 신뢰도 상한 B 기준', 'Cap at B if share below')) + ' <input type="number" step="0.05" data-cv="lowConfidenceCoverage" value="' + esc(cfg.lowConfidenceCoverage) + '" ' + dis + ' style="width:70px"></label></div></div>';
    const mu = '<div class="panel"><h3>' + esc(L('등급별 선급금 한도 배수 (평균 소진액 × 개월)', 'Grade limit multipliers (avg consumption × months)')) + '</h3><div class="body form-inline">' +
      ['A', 'B', 'C', 'D', 'NR'].map(g => '<label>' + g + ' × <input type="number" step="0.05" min="0" data-mu="' + g + '" value="' + esc(cfg.gradeMultipliers[g]) + '" ' + (g === 'D' || g === 'NR' ? 'disabled title="' + esc(L('선급 금지 고정', 'fixed: no prepayment')) + '"' : dis) + ' style="width:70px"></label>').join(' ') + '<span class="muted small">' + esc(L('D·NR은 대표 지시(선급 금지)에 따라 0 고정', 'D and NR are fixed at 0 per CEO instruction')) + '</span></div></div>';
    const gd = '<div class="panel"><h3>' + esc(L('한도 안전장치 · 대사 기준', 'Limit safeguards · reconciliation')) + '</h3><div class="body form-inline">' +
      [['nonRefundableMonths', L('반환 불가 상한(개월)', 'Non-refundable cap (months)')], ['unknownRefundMonths', L('반환조건 미확인 상한(개월)', 'Refund-unknown cap (months)')], ['lowRecoveryMonths', L('낮은 회수 가능성 상한(개월)', 'Low-recovery cap (months)')], ['velocityHoldDropPct', L('소진 급감 보류 기준(%)', 'Velocity-drop hold (%)')]]
        .map(([k, lbl]) => '<label>' + esc(lbl) + ' <input type="number" step="0.1" data-gd="' + k + '" value="' + esc(cfg.guards[k]) + '" ' + dis + ' style="width:70px"></label>').join(' ') + '<br>' +
      [['matchBp', L('일치 허용(bp)', 'Match tol. (bp)')], ['minorBp', L('경미 허용(bp)', 'Minor tol. (bp)')], ['staleDays', L('확인 만료(일)', 'Stale after (days)')]].map(([k, lbl]) => '<label>' + esc(lbl) + ' <input type="number" data-rc="' + k + '" value="' + esc(cfg.recon[k]) + '" ' + dis + ' style="width:70px"></label>').join(' ') +
      '<label>' + esc(L('기준일(prototype 고정)', 'As-of date (prototype fixed)')) + ' <input type="date" data-asof value="' + esc(cfg.asOf) + '" ' + dis + '></label></div></div>';
    const scc = cfg.scoring; const inp = (attr, val, st) => '<input type="number" step="' + (st || 1) + '" min="0" ' + attr + ' value="' + esc(val) + '" ' + dis + ' style="width:64px">';
    const sc = '<div class="panel"><h3>' + esc(L('신용평가 점수 계산 기준 (잠정)', 'How the data-driven scores are read (provisional)')) + '</h3><div class="body form-inline">' +
      '<div class="muted small">' + esc(L('점수는 사람이 입력하지 않고 자료에서 계산합니다. 구간 값은 대표가 확정하며, 바꾸면 모든 호텔의 점수가 다시 계산됩니다.', 'Scores are computed from the data, not typed in. The CEO fixes these cut-offs; changing them recalculates every hotel.')) + '</div>' +
      '<div>' + esc(L('잔액이 월평균 소진의 몇 개월분 이하면 5·4·3·2점(넘으면 1점)', 'Balance up to this many months of consumption gives 5 · 4 · 3 · 2 points (more gives 1)')) + ' ' + scc.coverMonths.map((x, i) => inp('data-sc="cover|' + i + '" aria-label="cover months ' + (i + 1) + '"', x, 0.5)).join(' ') +
      ' <label>' + esc(L('만기 전 소진 불가 감점', 'Penalty when it cannot be used up before the end')) + ' ' + inp('data-sc="pen" aria-label="penalty"', scc.endShortfallPenalty) + '</label></div>' +
      '<div>' + esc(L('담보가 잔액의 몇 배 이상이면 5·4·3점(조금이라도 있으면 2점, 없으면 1점)', 'Collateral share of the balance at least this gives 5 · 4 · 3 points (some gives 2, none 1)')) + ' ' + scc.collateralRatios.map((x, i) => inp('data-sc="col|' + i + '" aria-label="collateral ratio ' + (i + 1) + '"', x, 0.05)).join(' ') + '</div>' +
      '<div>' + esc(L('호텔 확인 잔액 대사 점수', 'Reconciliation scores')) + ' ' + ['MATCH', 'MINOR', 'MAJOR'].map(k => '<label>' + esc(lab('recon', k)) + ' ' + inp('data-sc="recon|' + k + '" aria-label="recon ' + k + '"', scc.reconScores[k]) + '</label>').join(' ') + '</div>' +
      '<div>' + esc(L('국가·법적 회수 위험 점수표(1~5)', 'Country / legal recovery table (1–5)')) + ' ' + Object.keys(scc.countryLegal).map(k => '<label>' + esc(lab('country', k)) + ' ' + inp('data-sc="cty|' + k + '" aria-label="country ' + k + '"', scc.countryLegal[k]) + '</label>').join(' ') + '</div></div></div>';
    const ar = '<div class="panel"><h3>' + esc(L('위험 경보 기준 (심각도·사용 여부 설정)', 'Risk alert rules (severity / enabled)')) + '</h3><div class="body"><div class="table-wrap"><table><thead><tr><th>' + esc(L('규칙', 'Rule')) + '</th><th>' + esc(L('사용', 'On')) + '</th><th>' + esc(L('심각도', 'Severity')) + '</th><th>' + esc(L('권고 조치', 'Action')) + '</th><th>' + esc(L('기준값', 'Params')) + '</th></tr></thead><tbody>' +
      Object.keys(cfg.alertRules).map(k => { const r = cfg.alertRules[k]; return '<tr><td>' + esc(tt(Alerts.RULE_TEXT[k])) + '<div class="muted small">' + esc(k) + '</div></td><td><input type="checkbox" aria-label="enabled" data-ae="' + esc(k) + '" ' + (r.enabled ? 'checked' : '') + ' ' + dis + '></td>' +
        '<td><select data-as="' + esc(k) + '" aria-label="severity" ' + dis + '>' + Config.SEVERITIES.map(s => '<option ' + (s === r.severity ? 'selected' : '') + ' value="' + s + '">' + esc(lab('sev', s)) + '</option>').join('') + '</select></td>' +
        '<td><select data-aa="' + esc(k) + '" aria-label="action" ' + dis + '>' + Config.ACTIONS.map(s => '<option ' + (s === r.action ? 'selected' : '') + ' value="' + s + '">' + esc(lab('action', s)) + '</option>').join('') + '</select></td><td class="small">' + (r.params ? Object.keys(r.params).map(pk => esc(pk) + ' <input type="number" aria-label="' + esc(k + ' ' + pk) + '" data-ap="' + esc(k + '|' + pk) + '" value="' + esc(r.params[pk]) + '" ' + dis + ' style="width:60px">').join(' ') : '—') + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>';
    const save = '<div class="panel"><h3>' + esc(L('변경 저장', 'Save changes')) + '</h3><div class="body"><div id="cfg-errs"></div><div class="toolbar"><input id="cfg-reason" placeholder="' + esc(L('변경 사유 (필수)', 'Reason for change (required)')) + '" size="40" ' + dis + '><button class="btn primary" data-act="cfg-save" ' + dis + '>' + esc(L('저장 (검증 후)', 'Validate & save')) + '</button><button class="btn" data-act="cfg-reset" ' + dis + '>' + esc(L('편집 취소', 'Discard edits')) + '</button></div>' +
      (can ? '' : '<div class="note warn">' + esc(L('관리자(ADMIN) 역할만 수정할 수 있습니다.', 'Only the ADMIN role can edit.')) + '</div>') + '<div class="note warn">' + esc(L('모든 값은 잠정이며 대표 승인 전 확정값이 아닙니다.', 'All values are provisional until CEO approval.')) + '</div></div></div>';
    const hist = '<div class="panel"><h3>' + esc(L('설정 변경 이력', 'Change history')) + '</h3><div class="body">' + (st.configHistory.length ? '<div class="table-wrap"><table><thead><tr><th>' + esc(L('일시', 'At')) + '</th><th>' + esc(L('작성', 'By')) + '</th><th>' + esc(L('사유', 'Reason')) + '</th><th>' + esc(L('변경', 'Changes')) + '</th></tr></thead><tbody>' + st.configHistory.slice().reverse().map(h => '<tr><td>' + esc(h.at) + '</td><td>' + esc(h.by) + '</td><td>' + esc(h.reason) + '</td><td class="small">' + h.changes.map(c => esc(c.path + ': ' + JSON.stringify(c.from) + ' → ' + JSON.stringify(c.to))).join('<br>') + '</td></tr>').join('') + '</tbody></table></div>' : U.emptyState(L('변경 이력이 없습니다.', 'No changes yet.'))) + '</div></div>';
    const integ = '<div class="panel"><h3>' + esc(L('데이터 연동 상태', 'Data integration status')) + '</h3><div class="body"><div class="table-wrap"><table><thead><tr><th>' + esc(L('연동', 'Integration')) + '</th><th>' + esc(L('모드', 'Mode')) + '</th><th>' + esc(L('비고', 'Note')) + '</th><th>' + esc(L('실검증', 'Live-verified')) + '</th></tr></thead><tbody>' +
      Adapters.INTEGRATIONS.map(i => '<tr><td>' + esc(tt(i.name)) + '</td><td>' + chip(i.mode, i.mode === 'FILE (CSV)' ? 'ok' : 'warn') + '</td><td class="small">' + esc(tt(i.note)) + '</td><td>' + (i.verified ? '✔' : esc(L('미검증', 'not verified'))) + '</td></tr>').join('') + '</tbody></table></div></div></div>';
    const aud = RBAC.can(ctx.store.session.role, 'audit.read') ? (function () { const ver = ctx.store.verifyAudit(); return '<div class="panel"><h3>' + esc(L('감사 로그', 'Audit log')) + ' ' + chip(ver.ok ? L('체인 무결성 정상', 'chain intact') : LF('체인 손상 #{0}', 'chain BROKEN #{0}', ver.brokenAt), ver.ok ? 'ok' : 'bad') + '</h3><div class="body"><div class="table-wrap"><table><thead><tr><th>#</th><th>' + esc(L('일시', 'At')) + '</th><th>' + esc(L('사용자(역할)', 'Actor (role)')) + '</th><th>' + esc(L('행위', 'Action')) + '</th><th>' + esc(L('대상', 'Entity')) + '</th><th>' + esc(L('결과', 'Outcome')) + '</th></tr></thead><tbody>' +
      st.audit.slice().reverse().slice(0, 60).map(e => '<tr><td>' + e.seq + '</td><td class="small">' + esc(e.at) + '</td><td>' + esc(e.actor + ' (' + e.role + ')') + '</td><td>' + esc(e.action) + '</td><td class="small">' + esc(e.entity) + '</td><td>' + chip(e.outcome, e.outcome === 'OK' ? 'ok' : 'bad') + '</td></tr>').join('') + '</tbody></table></div><div class="muted small">' + esc(L('프로토타입 수준의 변조 탐지(해시 체인, 비암호학적)이며 서버측 불변 저장소가 필요합니다.', 'Prototype-grade tamper evidence (non-cryptographic hash chain); a server-side immutable store is required for production.')) + '</div></div></div>'; })() :
      '<div class="panel"><h3>' + esc(L('감사 로그', 'Audit log')) + '</h3><div class="body muted">' + esc(L('CEO·관리자만 열람할 수 있습니다.', 'Visible to CEO / Admin only.')) + '</div></div>';
    const reset = RBAC.can(ctx.store.session.role, 'data.reset') ? '<div class="panel"><h3>' + esc(L('샘플 데이터', 'Sample data')) + '</h3><div class="body"><button class="btn danger" data-act="reset">' + esc(L('샘플 데이터로 초기화(감사 로그는 보존)', 'Reset to sample data (audit log preserved)')) + '</button> <button class="btn" data-act="export-json">' + esc(L('상태 JSON 내보내기', 'Export state JSON')) + '</button></div></div>' : '';
    return w + '<div class="grid2">' + th + mu + '</div>' + gd + sc + ar + save + hist + integ + ellisPanel(ctx) + trackerPanel(ctx) + permPanel(ctx) + aud + reset;
  }

  /* ---- PIC tracker check + conversion (preview only: nothing is stored, real hotel data cannot enter the sample state anyway) ---- */
  function trackerPanel(ctx) {
    const can = RBAC.can(ctx.store.session.role, 'ledger.import'); const dis = can ? '' : 'disabled'; const s = ctx.ui.trk || {}, r = s.result;
    const area = (id, label, val) => '<div class="trk-f"><label for="' + id + '">' + esc(label) + '</label><textarea id="' + id + '" rows="3" placeholder="CSV…" ' + dis + '>' + esc(val || '') + '</textarea><input type="file" data-trkfile="' + id + '" aria-label="' + esc(label) + ' file" accept=".csv,text/csv" ' + dis + '></div>';
    const sevCls = x => (x === 'ERROR' ? 'bad' : x === 'WARN' ? 'warn' : '');
    let res = '';
    if (r && r.ok === false) res = '<div class="note bad">' + r.errors.map(e => esc(U.errText(e))).join(' · ') + '</div>';
    else if (r) {
      const sm = r.summary; const shown = r.issues.slice().sort((a, b) => ({ ERROR: 0, WARN: 1, INFO: 2 })[a.severity] - ({ ERROR: 0, WARN: 1, INFO: 2 })[b.severity]).slice(0, 300);
      res = '<div>' + chip(LF('{0}행 읽음', '{0} rows read', sm.rows), '') + ' ' + chip(LF('{0}건 변환', '{0} converted', sm.converted), 'ok') + ' ' + chip(LF('원장 {0}행', '{0} ledger rows', sm.ledgerRows), '') + ' ' + chip(lab('trkSev', 'ERROR') + ' ' + sm.errors, sm.errors ? 'bad' : '') + ' ' + chip(lab('trkSev', 'WARN') + ' ' + sm.warnings, sm.warnings ? 'warn' : '') + ' ' + chip(lab('trkSev', 'INFO') + ' ' + sm.info, '') + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>' + esc(L('구분', 'Level')) + '</th><th>' + esc(L('행', 'Row')) + '</th><th>' + esc(L('호텔', 'Hotel')) + '</th><th>' + esc(L('점검 항목', 'Check')) + '</th><th>' + esc(L('값', 'Detail')) + '</th></tr></thead><tbody>' +
        (shown.length ? shown.map(i => '<tr><td>' + chip(lab('trkSev', i.severity), sevCls(i.severity)) + '</td><td class="small">' + esc((i.sheet ? i.sheet + ' ' : '') + (i.rowNo == null ? '—' : i.rowNo)) + '</td><td class="small">' + esc((i.hotelId || '—') + (i.hotelName ? ' · ' + i.hotelName : '')) + '</td><td class="small">' + esc(lab('trk', i.code)) + '</td><td class="small">' + esc(i.detail == null ? '' : i.detail) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">' + esc(L('점검에서 걸린 항목이 없습니다.', 'No findings.')) + '</td></tr>') + '</tbody></table></div>' +
        (r.issues.length > shown.length ? '<div class="muted small">' + esc(LF('앞의 {0}건만 표시합니다. 전체는 issues.csv로 내려받으세요.', 'First {0} shown. Download issues.csv for all.', shown.length)) + '</div>' : '') +
        '<div class="toolbar">' + ['contracts.csv', 'ledger.csv', 'confirmations.csv', 'issues.csv'].map(n => '<button class="btn sm" data-trkdl="' + n + '">' + esc(n) + '</button>').join(' ') + '</div>';
    }
    return '<div class="panel"><h3>' + esc(L('PIC 트래커 점검·변환 (저장 안 함)', 'PIC tracker check & conversion (nothing stored)')) + '</h3><div class="body">' +
      '<div class="note">' + esc(L('트래커의 Existing·Top-up Log·Risk Register 시트를 CSV(UTF-8)로 저장해 붙여 넣으면, 입력 점검 목록과 통합 형식(계약·원장·호텔 확인 잔액) 파일을 만듭니다. 이 브라우저 안에서만 처리하고 저장하지 않으며, 실제 호텔 자료는 샘플 상태에 가져올 수 없습니다.', 'Save the tracker sheets Existing, Top-up Log and Risk Register as CSV (UTF-8) and paste them here to get an input check list and files in the unified format (contracts, ledger, hotel-confirmed balances). Everything stays in this browser and nothing is stored; real hotel data cannot be imported into the sample state.')) + '</div>' +
      '<div class="toolbar"><button class="btn sm" data-act="trk-sample" ' + dis + '>' + esc(L('합성 샘플 불러오기', 'Load synthetic sample')) + '</button></div>' +
      area('trk-existing', 'Existing', s.existing) + area('trk-topup', 'Top-up Log', s.topUp) + area('trk-risk', 'Risk Register', s.risk) +
      '<div class="toolbar"><button class="btn primary" data-act="trk-run" ' + dis + '>' + esc(L('점검 실행(저장 안 함)', 'Run check (no changes)')) + '</button></div>' + (can ? '' : '<div class="note warn">' + esc(L('SCM 담당 또는 관리자만 사용할 수 있습니다.', 'Only SCM or Admin can use this.')) + '</div>') + res + '</div></div>';
  }
  function trackerBind(el, ctx) {
    const $ = x => el.querySelector(x); if (!$('#trk-existing')) return;
    const keep = r => { ctx.ui.trk = { existing: $('#trk-existing').value, topUp: $('#trk-topup').value, risk: $('#trk-risk').value, result: r === undefined ? (ctx.ui.trk && ctx.ui.trk.result) : r }; };
    ['trk-existing', 'trk-topup', 'trk-risk'].forEach(id => $('#' + id).addEventListener('input', () => keep()));
    el.querySelectorAll('[data-trkfile]').forEach(i => i.addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { keep(); const id = i.getAttribute('data-trkfile'); const key = { 'trk-existing': 'existing', 'trk-topup': 'topUp', 'trk-risk': 'risk' }[id]; ctx.ui.trk[key] = String(rd.result); ctx.ui.trk.result = null; ctx.rerender(); }; rd.readAsText(f); }));
    const on = (a, fn) => { const b = $('[data-act="' + a + '"]'); if (b) b.addEventListener('click', fn); };
    on('trk-sample', () => { const S = NS.TrackerSample; ctx.ui.trk = { existing: S.existing, topUp: S.topUp, risk: S.risk, result: null }; ctx.rerender(); });
    on('trk-run', () => { keep(null); try { const r = ctx.store.commands.previewTracker({ existing: ctx.ui.trk.existing, topUpLog: ctx.ui.trk.topUp, risk: ctx.ui.trk.risk }); ctx.ui.trk.result = r; ctx.rerender(); } catch (e) { ctx.toast(U.errText(e.code || e.message), 'bad'); } });
    el.querySelectorAll('[data-trkdl]').forEach(b => b.addEventListener('click', () => { const r = ctx.ui.trk && ctx.ui.trk.result; if (!r || !r.ok) return; const name = b.getAttribute('data-trkdl'); const text = NS.Tracker.unifiedCsv(r)[name]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0); }));
  }

  /* ---- role x permission table (read-only; the table itself lives in js/core/rbac.js) ---- */
  function permPanel(ctx) {
    const me = ctx.store.session.role, roles = RBAC.ROLES, mx = RBAC.matrix();
    const head = '<tr><th>' + esc(L('권한', 'Permission')) + '</th>' + roles.map(r => '<th class="' + (r === me ? 'me' : '') + '" style="text-align:center">' + esc(lab('role', r)) + '</th>').join('') + '</tr>';
    const body = mx.map(x => '<tr><td>' + esc(lab('perm', x.perm)) + '<div class="muted small">' + esc(x.perm) + '</div></td>' + roles.map(r => '<td class="' + (x.roles[r] ? 'yes' : 'no') + (r === me ? ' me' : '') + '">' + (x.roles[r] ? '✔' : '—') + '</td>').join('') + '</tr>').join('');
    return '<div class="panel"><h3>' + esc(L('역할별 권한', 'Permissions by role')) + '</h3><div class="body">' +
      '<div class="note">' + esc(LF('현재 로그인: {0} ({1}). 역할은 계정에 정해져 있고 화면에서 바꿀 수 없습니다. 대표 검토 의견 기록은 대표이사 역할만 할 수 있고 관리자도 못 합니다.', 'Signed in as {0} ({1}). The role is set by the account and cannot be changed on screen. Only the CEO role can record the review feedback; Admin cannot.', ctx.store.session.actor || '-', lab('role', me))) + '</div>' +
      '<div class="table-wrap"><table class="permtbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div></div>';
  }

  /* ---- ELLIS MCP snapshot import + comparison (read-only; never writes the ledger) ---- */
  function ellisPanel(ctx) {
    const st = ctx.store.state, Ellis = NS.Ellis, ev = ctx.ui.ellis || {}; const can = RBAC.can(ctx.store.session.role, 'ellis.import'); const dis = can ? '' : 'disabled';
    const cur = st.ellis ? st.ellis.snapshot : null, scope = ctx.ui.ellisScope === 'HOTEL' ? 'HOTEL' : 'CONTRACT', cmp = ctx.store.ellisCompare({ scope });
    const status = cur ? chip(cur.provenance.synthetic ? L('합성 데이터', 'Synthetic data') : L('실데이터', 'Real data'), cur.provenance.synthetic ? 'warn' : 'ok') + (cmp.stale ? ' ' + chip(L('오래됨', 'Stale'), 'bad') : '') + ' ' + chip(cur.window.basis === 'CHECK_OUT_DATE' ? L('체크아웃 월 기준', 'Check-out month basis') : L('체크인 월 기준', 'Check-in month basis'), 'warn') + ' <span class="small">' + esc(LF('수집 {0} · 수집기 {1} · 기간 {2} ~ {3} · 호텔 {4}개 · 가져오기 {5}회', 'Collected {0} · collector {1} · window {2} ~ {3} · {4} hotels · {5} imports', cur.provenance.collectedAt, cur.provenance.collector, cur.window.from, cur.window.to, cur.hotels.length, st.ellis.batches.length)) + '</span>'
      : '<span class="muted">' + esc(L('가져온 스냅샷 없음', 'No snapshot imported')) + '</span>';
    const pv = ev.preview;
    const pvHtml = !pv ? '' : pv.ok === false ? '<div class="note bad">' + pv.errors.map(e => esc(U.errText(e))).join(' · ') + '</div>' :
      '<div class="note">' + esc(LF('호텔 {0}개 연결 · 무시 {1}개 · 데이터 없는 마스터 호텔 {2}개', 'Hotels matched {0} · ignored {1} · master hotels without data {2}', pv.match.matched.length, pv.match.unmatched.length, pv.match.unmapped.length)) + (pv.warnings.length ? '<br>' + pv.warnings.map(w => esc(U.errText(w))).join(' · ') : '') + '</div>';
    const names = Object.fromEntries(ctx.m.views.map(v => [v.contractId, tt(v.hotel.name)]));
    const cells = c => c.months.length ? c.months.map(m => '<td class="small">' + esc(m.month.slice(5)) + ' ' + (m.ratioPct != null || m.ellisMinor != null ? money(m.ledgerMinor, c.currency, true) + ' / ' + (m.converted ? '≈' : '') + money(m.ellisMinor, c.currency, true) + (m.ratioPct != null ? ' (' + m.ratioPct + '%)' : '') + ' ' : '') + chip(lab('ellisMo', m.status), m.status === 'MATCH' ? 'ok' : m.status === 'DIVERGENT' ? 'bad' : 'warn') + (m.sinceDate ? ' <span class="muted">' + esc(LF('{0}부터', 'from {0}', m.sinceDate.slice(5))) + '</span>' : '') + '</td>').join('') : '<td class="muted small" colspan="3">—</td>';
    const rows = ctx.m.views.map(v => { const c = cmp.byContract[v.contractId]; return '<tr><td>' + esc(v.contractId) + '<div class="muted small">' + esc(names[v.contractId]) + '</div></td><td>' + esc(c.currency) + '</td><td>' + chip(lab('ellisSt', c.status), c.status === 'OK' ? 'ok' : c.status === 'DIVERGENT' ? 'bad' : 'warn') + '</td>' + cells(c) + '</tr>'; }).join('');
    const batches = st.ellis ? '<div class="table-wrap"><table><thead><tr><th>Batch</th><th>' + esc(L('일시', 'At')) + '</th><th>' + esc(L('작성', 'By')) + '</th><th>' + esc(L('수집 시각', 'Collected at')) + '</th><th>' + esc(L('수집기', 'Collector')) + '</th><th>' + esc(L('호텔', 'Hotels')) + '</th></tr></thead><tbody>' +
      st.ellis.batches.map(b => '<tr><td>' + esc(b.batchId) + '</td><td class="small">' + esc(b.at) + '</td><td>' + esc(b.by) + '</td><td class="small">' + esc(b.collectedAt) + '</td><td>' + esc(b.collector) + (b.synthetic ? ' · ' + esc(L('합성', 'synthetic')) : '') + '</td><td>' + b.hotels + '</td></tr>').join('') + '</tbody></table></div>' : '';
    return '<div class="panel"><h3>' + esc(L('ELLIS 연동 (MCP 스냅샷)', 'ELLIS integration (MCP snapshot)')) + '</h3><div class="body">' +
      '<div class="note">' + esc(L('브라우저는 ELLIS MCP를 직접 호출하지 않습니다. Claude 또는 서버가 만든 스냅샷 파일(JSON)을 가져와 원장과 비교합니다. 원장은 바뀌지 않고 호텔별 집계만 저장됩니다.', 'The browser never calls the ELLIS MCP. A snapshot file (JSON) built by Claude or a server is imported and compared with the ledger. The ledger is not changed; only hotel-level aggregates are stored.')) + '</div>' +
      '<div>' + status + '</div>' +
      '<div class="toolbar"><input type="file" id="ellis-file" aria-label="ELLIS snapshot file" accept=".json,application/json" ' + dis + '><button class="btn sm" data-act="ellis-sample" ' + dis + '>' + esc(L('합성 샘플 불러오기', 'Load synthetic sample')) + '</button></div>' +
      '<textarea id="ellis-text" rows="4" placeholder="JSON…" ' + dis + '>' + esc(ev.text || '') + '</textarea>' +
      '<div class="toolbar"><button class="btn" data-act="ellis-preview" ' + dis + '>' + esc(L('1) 검증·미리보기(저장 안 함)', '1) Validate & preview (no changes)')) + '</button><button class="btn primary" data-act="ellis-import" ' + dis + '>' + esc(L('2) 가져오기', '2) Import')) + '</button></div>' +
      (can ? '' : '<div class="note warn">' + esc(L('SCM 담당 또는 관리자만 가져올 수 있습니다.', 'Only SCM or Admin can import.')) + '</div>') + pvHtml +
      '<div class="toolbar"><label class="small" for="ellis-scope">' + esc(L('비교 기준', 'Comparison scope')) + '</label><select id="ellis-scope" aria-label="' + esc(L('비교 기준', 'Comparison scope')) + '"><option value="CONTRACT"' + (scope === 'CONTRACT' ? ' selected' : '') + '>' + esc(L('계약 기간·계약별 (실제 차감 계산용)', 'By contract and period (for actual deduction)')) + '</option><option value="HOTEL"' + (scope === 'HOTEL' ? ' selected' : '') + '>' + esc(L('호텔 전체·기간 제한 없음 (트래커 기준)', 'Whole hotel, no period limit (tracker basis)')) + '</option></select></div>' +
      '<div class="table-wrap"><table><thead><tr><th>' + esc(L('계약', 'Contract')) + '</th><th>' + esc(L('통화', 'Currency')) + '</th><th>' + esc(L('상태', 'Status')) + '</th><th colspan="3">' + esc(L('월별 원장 / ELLIS (비율)', 'Monthly ledger / ELLIS (ratio)')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="muted small">' + esc(LF('ELLIS 금액은 {1} 순액(청구액−수익)입니다. 계약 통화와 다른 통화의 예약은 예약 시점 환율로 환산해 ≈로 표시합니다. 호텔 선급 소진액과 같다는 확인이 아직 없어 참고 지표로만 쓰고, 차이가 {0}%를 넘으면 "차이 큼"으로 표시합니다. 계약이 달 중간에 시작하는 달은 스냅샷에 그 시작일 이후 집계가 있을 때만 비교합니다.', 'ELLIS amounts use the {1} and are net (billing minus revenue). Bookings in a currency other than the contract currency are converted at the booking-time rate and marked ≈. It is not yet confirmed to equal prepaid consumption, so it is a reference indicator only; a difference over {0}% is marked divergent. A month in which a contract starts is compared only when the snapshot holds the aggregate from that start date.', Ellis.TOLERANCE_PCT, cmp.dateBasis === 'CHECK_OUT_DATE' ? L('체크아웃 월 기준', 'Check-out month basis') : L('체크인 월 기준', 'Check-in month basis'))) + '</div>' + batches + '</div></div>';
  }
  function ellisBind(el, ctx) {
    const cmd = ctx.store.commands; const $ = s => el.querySelector(s); const ta = $('#ellis-text'); if (!ta) return;
    const keep = (extra) => { ctx.ui.ellis = Object.assign({ text: ta.value, fileName: (ctx.ui.ellis && ctx.ui.ellis.fileName) || '', preview: null }, extra || {}); };
    ta.addEventListener('input', () => { keep({ preview: ctx.ui.ellis && ctx.ui.ellis.preview }); });
    $('#ellis-file').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { ctx.ui.ellis = { text: String(rd.result), fileName: f.name, preview: null }; ctx.rerender(); }; rd.readAsText(f); });
    const on = (a, fn) => { const b = $('[data-act="' + a + '"]'); if (b) b.addEventListener('click', fn); };
    const sc = $('#ellis-scope'); if (sc) sc.addEventListener('change', () => { ctx.ui.ellisScope = sc.value; ctx.rerender(); });
    on('ellis-sample', () => { ctx.ui.ellis = { text: JSON.stringify(NS.EllisSample), fileName: 'ellis_snapshot_SYNTHETIC.json', preview: null }; ctx.rerender(); });
    on('ellis-preview', () => { try { const p = cmd.previewEllisSnapshot(ta.value); keep({ preview: p }); ctx.rerender(); } catch (e) { ctx.toast(U.errText(e.code || 'E_FORBIDDEN'), 'bad'); } });
    on('ellis-import', () => { const text = ta.value; ctx.run(() => { const r = cmd.importEllisSnapshot(text); ctx.ui.ellis = { text, fileName: ctx.ui.ellis && ctx.ui.ellis.fileName, preview: r.ok === false ? r : null }; return r; }, L('ELLIS 스냅샷을 가져왔습니다. 원장은 바뀌지 않았습니다.', 'ELLIS snapshot imported. The ledger was not changed.')); });
  }
  function adminBind(el, ctx) {
    ellisBind(el, ctx); trackerBind(el, ctx);
    const cfg = ctx.ui.cfgDraft; const num = e => (e.value === '' ? NaN : Number(e.value));
    el.querySelectorAll('[data-cw]').forEach(i => i.addEventListener('input', () => { cfg.weights[i.getAttribute('data-cw')] = num(i); const s = Object.values(cfg.weights).reduce((a, b) => a + (Number(b) || 0), 0); const h = i.closest('.panel').querySelector('h3 span'); h.textContent = 'Σ=' + s; h.className = Math.abs(s - 100) < 1e-9 ? 'ok' : 'bad'; }));
    el.querySelectorAll('[data-th]').forEach(i => i.addEventListener('input', () => { cfg.ratingThresholds[i.getAttribute('data-th')] = num(i); }));
    el.querySelectorAll('[data-cv]').forEach(i => i.addEventListener('input', () => { cfg[i.getAttribute('data-cv')] = num(i); }));
    el.querySelectorAll('[data-mu]').forEach(i => i.addEventListener('input', () => { cfg.gradeMultipliers[i.getAttribute('data-mu')] = num(i); }));
    el.querySelectorAll('[data-gd]').forEach(i => i.addEventListener('input', () => { cfg.guards[i.getAttribute('data-gd')] = num(i); }));
    el.querySelectorAll('[data-sc]').forEach(i => i.addEventListener('input', () => { const [k, x] = i.getAttribute('data-sc').split('|'); const s = cfg.scoring;
      if (k === 'cover') s.coverMonths[Number(x)] = num(i); else if (k === 'pen') s.endShortfallPenalty = num(i); else if (k === 'col') s.collateralRatios[Number(x)] = num(i); else if (k === 'recon') s.reconScores[x] = num(i); else if (k === 'cty') s.countryLegal[x] = num(i); }));
    el.querySelectorAll('[data-rc]').forEach(i => i.addEventListener('input', () => { cfg.recon[i.getAttribute('data-rc')] = num(i); }));
    const ao = el.querySelector('[data-asof]'); if (ao) ao.addEventListener('input', () => { cfg.asOf = ao.value; });
    el.querySelectorAll('[data-ae]').forEach(i => i.addEventListener('change', () => { cfg.alertRules[i.getAttribute('data-ae')].enabled = i.checked; }));
    el.querySelectorAll('[data-as]').forEach(i => i.addEventListener('change', () => { cfg.alertRules[i.getAttribute('data-as')].severity = i.value; }));
    el.querySelectorAll('[data-aa]').forEach(i => i.addEventListener('change', () => { cfg.alertRules[i.getAttribute('data-aa')].action = i.value; }));
    el.querySelectorAll('[data-ap]').forEach(i => i.addEventListener('input', () => { const [k, p] = i.getAttribute('data-ap').split('|'); cfg.alertRules[k].params[p] = num(i); }));
    const on = (a, fn) => { const b = el.querySelector('[data-act="' + a + '"]'); if (b) b.addEventListener('click', fn); };
    on('cfg-save', () => { const r = ctx.store.commands.setConfig(cfg, el.querySelector('#cfg-reason').value); if (r.ok === false) { el.querySelector('#cfg-errs').innerHTML = '<div class="note bad">' + r.errors.map(e => esc(U.errText(e))).join(' · ') + '</div>'; return; } ctx.ui.cfgDraft = null; ctx.toast(L('설정을 저장했습니다.', 'Configuration saved.')); ctx.rerender(); });
    on('cfg-reset', () => { ctx.ui.cfgDraft = null; ctx.rerender(); });
    on('reset', () => { if (confirm(L('샘플 데이터로 초기화할까요?', 'Reset to sample data?'))) ctx.run(() => ctx.store.commands.resetSample(), L('초기화했습니다.', 'Reset done.')); });
    on('export-json', () => { try { const t = ctx.store.commands.exportJson(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'application/json' })); a.download = 'omh_hfr_sample_state.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0); } catch (e) { ctx.toast(U.errText(e.code || 'E_FORBIDDEN'), 'bad'); } });
  }
  return { risk, riskBind, approvalPage, approvalPageBind, admin, adminBind };
});
