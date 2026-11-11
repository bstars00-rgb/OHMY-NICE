/* Screens 01 (Executive Dashboard) and 02 (Hotel Credit Profile). */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(NS);
  NS.ViewsA = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (NS) {
  'use strict';
  const U = NS.UI, { L, LF, esc, tt, lab, money, moneyMap, gradeBadge, sevBadge, chip, hotelName } = U;
  const Model = NS.Model, Rating = NS.Rating, RBAC = NS.RBAC, Alerts = NS.Alerts, Money = NS.Money;

  /* ============ Screen 01 — Executive Dashboard: one card per country; every line of a card opens the screen where that number is worked on ============ */
  const COUNTRY_ORDER = ['KR', 'JP', 'VN', 'SG'];
  /** The balance of one country split the way the country files split it: prebuy (floating / prepayment), hard block, and anything else (buyout, deposit). */
  function balanceGroups(byType) {
    const sum = types => { const out = {}; for (const t of types) for (const [cur, minor] of Object.entries((byType || {})[t] || {})) out[cur] = (out[cur] || 0) + minor; return out; };
    const prebuy = sum(['FLOATING', 'PREPAYMENT']), hard = sum(['HARD_BLOCK_ADV']), other = sum(['BUYOUT', 'SECURITY_DEPOSIT']);
    return { prebuy, hard, other, hasOther: Object.keys(other).length > 0 };
  }
  function dashboard(ctx) {
    const m = ctx.m;                                                                                      // the dashboard shows every country; filtering belongs to the status board
    const caption = '<div class="muted dash-cap">' + esc(L('기준일', 'As of')) + ' <b>' + esc(m.asOf) + '</b> · ' + esc(L('통화별 합계 — 환율 환산 없음', 'Totals per currency — no FX conversion')) + ' · <a href="#/status" data-country="">' + esc(L('플로팅 현황판 열기', 'Open floating status board')) + '</a></div>';
    const countries = [...new Set(m.views.map(v => v.hotel.country))].sort((x, y) => { const ix = COUNTRY_ORDER.indexOf(x), iy = COUNTRY_ORDER.indexOf(y); return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || String(x).localeCompare(String(y)); });
    if (!countries.length) return caption + U.emptyState(L('표시할 데이터가 없습니다.', 'No data to display.'));
    const contractOfHotel = id => { const v = m.views.find(x => x.hotelId === id); return v ? v.contractId : null; };
    const short = ids => { const nm = ids.slice(0, 2).map(id => { const v = m.byContract[id] || m.views.find(x => x.hotelId === id); return v ? tt(v.hotel.name) : ''; }).filter(Boolean); return nm.join(', ') + (ids.length > 2 ? ' ' + LF('외 {0}', '+{0} more', ids.length - 2) : ''); };
    const prof = id => id ? '#/profile/' + encodeURIComponent(id) : '#/profile';
    const row = (href, country, label, value, sub) => '<a class="crow" href="' + href + '" data-country="' + esc(country) + '"><div class="crow-k">' + esc(label) + '</div><div class="crow-v">' + value + (sub ? '<div class="small">' + sub + '</div>' : '') + '</div></a>';
    const card = c => {
      const k = Model.kpis(m.views, { country: c }); const hi = k.highRiskHotels.map(contractOfHotel).filter(Boolean); const alertsN = k.activeAlerts.CRITICAL + k.activeAlerts.HIGH + k.activeAlerts.MEDIUM;
      const none = '<span class="muted">—</span>';
      return '<div class="card ccard"><div class="ch"><b>' + esc(lab('country', c)) + '</b><span class="muted small">' + esc(k.count + L('개 계약 · ', ' contracts · ') + k.hotels + L('개 호텔', ' hotels')) + '</span></div>' +
        row('#/status', c, L('선급금 잔액', 'Prepayment balance'), moneyMap(k.exposure), (() => { const g = balanceGroups(k.byType); const line = (label, map) => '<div class="grp"><span class="muted">' + esc(label) + '</span> ' + moneyMap(map) + '</div>'; return line(L('프리바이', 'Prebuy'), g.prebuy) + line(L('하드블럭', 'Hard block'), g.hard) + (g.hasOther ? line(L('기타(買取·보증금)', 'Other (buyout · deposit)'), g.other) : ''); })()) +
        row('#/status', c, L('등급별 호텔 수', 'Hotels by grade'), '<div class="gbar" role="img" aria-label="hotels by grade">' + (['A', 'B', 'C', 'D', 'NR'].map(g => k.hotelGrades[g] ? '<div class="gseg g-' + g + '" style="flex:' + k.hotelGrades[g] + '">' + g + ' ' + k.hotelGrades[g] + '</div>' : '').join('') || '—') + '</div>') +
        row(prof(hi[0]), c, L('고위험 호텔', 'High-risk hotels'), '<b class="cnum">' + k.highRiskHotels.length + '</b>', esc(short(hi)) || none) +
        row(prof(k.limitExceeded[0]), c, L('한도 초과 계약', 'Limit-exceeded contracts'), '<b class="cnum">' + k.limitExceeded.length + '</b>', (esc(short(k.limitExceeded)) || none) + (k.limitUnknown.length ? '<div class="limit-unknown bad">' + esc(LF('한도 산정 불가 {0}건(잔액 있음)', '{0} with balance but no computable limit', k.limitUnknown.length)) + '</div>' : '')) +
        row(prof(k.refundPending[0]), c, L('반환 대기', 'Refund pending'), '<b class="cnum">' + k.refundPending.length + '</b>', k.refundPending.length ? moneyMap(k.refundPendingAmount) : none) +
        row('#/risk', c, L('활성 경보', 'Active alerts'), '<b class="cnum">' + alertsN + '</b>', sevBadge('CRITICAL') + ' ' + k.activeAlerts.CRITICAL + ' · ' + sevBadge('HIGH') + ' ' + k.activeAlerts.HIGH + ' · ' + sevBadge('MEDIUM') + ' ' + k.activeAlerts.MEDIUM) + '</div>';
    };
    const notes = '<div class="muted small dash-note">' + esc(L('선급금 잔액', 'Prepayment balance')) + ': ' + esc(L('호텔에 미리 낸 돈 중 아직 쓰지 않은 금액', 'Money paid to hotels in advance and not yet used')) + ' · ' + esc(L('계약이 여러 개면 가장 낮은 등급 · NR = 평가 근거 부족', 'Lowest grade if a hotel has several contracts · NR = not rated (insufficient evidence)')) + '</div>';
    return caption + '<div class="ccards">' + countries.map(card).join('') + '</div>' + notes;
  }
  /** A line of a country card opens its screen with that country already chosen (status board filter, hotel credit card list). */
  function dashboardBind(el, ctx) {
    el.querySelectorAll('a[data-country]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault(); const c = a.getAttribute('data-country'); const path = a.getAttribute('href').slice(1);
      ctx.ui.filters = c ? { country: c } : {}; ctx.ui.profileCountry = c || ''; ctx.navigate(path);
    }));
  }

  /* ============ Floating status board (플로팅 현황판): totals by entity and country, grade distribution, high-risk list, contract table ============ */
  function status(ctx) {
    const m = ctx.m, f = ctx.ui.filters || {}; const k = Model.kpis(m.views, f);
    const opt = (list, cur, labelFn) => '<option value="">' + esc(L('전체', 'All')) + '</option>' + list.map(x => '<option value="' + esc(x) + '" ' + (x === cur ? 'selected' : '') + '>' + esc(labelFn ? labelFn(x) : x) + '</option>').join('');
    const uniq = fn => [...new Set(m.views.map(fn))].sort();
    const filters = '<div class="toolbar filters">' +
      '<label>' + esc(L('국가', 'Country')) + ' <select data-f="country">' + opt(uniq(v => v.hotel.country), f.country, c => lab('country', c)) + '</select></label>' +
      '<label>' + esc(L('계약 법인', 'Legal entity')) + ' <select data-f="entity">' + opt(uniq(v => v.contract.omhEntity), f.entity) + '</select></label>' +
      '<label>' + esc(L('통화', 'Currency')) + ' <select data-f="currency">' + opt(uniq(v => v.currency), f.currency) + '</select></label>' +
      '<label>' + esc(L('선급금 유형', 'Prepayment type')) + ' <select data-f="type">' + opt(uniq(v => v.contract.prepaymentType), f.type, t => lab('ptype', t)) + '</select></label>' +
      '<button class="btn sm" data-act="clear-filters">' + esc(L('필터 초기화', 'Clear filters')) + '</button><span class="spacer"></span>' +
      '<span class="muted">' + esc(L('기준일', 'As of')) + ' <b>' + esc(m.asOf) + '</b> · ' + esc(L('통화별 합계 — 환율 환산 없음', 'Totals per currency — no FX conversion')) + '</span></div>';
    const gradeBar = ['A', 'B', 'C', 'D', 'NR'].map(g => k.hotelGrades[g] ? '<div class="gseg g-' + g + '" style="flex:' + k.hotelGrades[g] + '" title="' + g + ': ' + k.hotelGrades[g] + '">' + g + ' ' + k.hotelGrades[g] + '</div>' : '').join('');
    const mapList = (obj, labelFn) => Object.keys(obj).sort().map(key => '<div class="kv"><span>' + esc(labelFn ? labelFn(key) : key) + '</span><span>' + moneyMap(obj[key]) + '</span></div>').join('') || '<span class="muted">—</span>';
    const hiRisk = k.highRiskHotels.map(h => m.views.find(x => x.hotelId === h)).filter(Boolean);
    const hiList = hiRisk.length ? '<div class="table-wrap"><table><thead><tr><th>' + esc(L('호텔', 'Hotel')) + '</th><th class="ctr">' + esc(L('등급', 'Grade')) + '</th><th class="num">' + esc(L('현재 잔액', 'Balance')) + '</th><th>' + esc(L('경보', 'Alerts')) + '</th></tr></thead><tbody>' + hiRisk.map(v => '<tr><td><a href="#/profile/' + esc(v.contractId) + '">' + hotelName(v.hotel) + '</a> <span class="muted small">' + esc(v.contractId) + '</span></td><td class="ctr">' + gradeBadge(v.rating.grade) + '</td><td class="num">' + money(v.balance.closingMinor, v.currency) + '</td><td>' + v.liveAlerts.slice(0, 3).map(a => sevBadge(a.severity)).join(' ') + '</td></tr>').join('') + '</tbody></table></div>' : '<span class="muted">—</span>';
    const row2 = '<div class="grid2">' +
      '<div class="panel"><h3>' + esc(L('등급별 호텔 수 (계약이 여러 개면 가장 낮은 등급, 잠정 A~D·NR)', 'Hotels by grade (lowest grade among a hotel\'s contracts, provisional A–D · NR)')) + '</h3><div class="body"><div class="gbar" role="img" aria-label="hotels by grade">' + (gradeBar || '—') + '</div><div class="muted small">' + esc(L('NR = 평가 근거 부족으로 미평가. 파트너 A~E 등급과 별개 척도입니다.', 'NR = not rated (insufficient evidence). Separate scale from partner A–E grades.')) + '</div></div></div>' +
      '<div class="panel"><h3>' + esc(L('고위험 호텔 목록', 'High-risk hotel list')) + '</h3><div class="body">' + hiList + '</div></div>' +
      '<div class="panel"><h3>' + esc(L('국가별 선급금 잔액', 'Prepayment balance by country')) + '</h3><div class="body">' + mapList(k.byCountry, c => lab('country', c)) + '</div></div>' +
      '<div class="panel"><h3>' + esc(L('계약 법인별 선급금 잔액', 'Prepayment balance by legal entity')) + '</h3><div class="body">' + mapList(k.byEntity) + '</div></div>' +
      '<div class="panel"><h3>' + esc(L('선급금 유형별 잔액', 'Balance by prepayment type')) + '</h3><div class="body">' + mapList(k.byType, t => lab('ptype', t)) + '</div></div></div>';
    const vs = m.views.filter(v => (!f.country || v.hotel.country === f.country) && (!f.entity || v.contract.omhEntity === f.entity) && (!f.currency || v.currency === f.currency) && (!f.type || v.contract.prepaymentType === f.type));
    const cols = [
      { k: 'hotel', h: L('호텔', 'Hotel'), v: v => '<a href="#/profile/' + esc(v.contractId) + '">' + hotelName(v.hotel) + '</a>', s: v => tt(v.hotel.name), t: v => v.hotel.name.ko + ' ' + v.hotel.name.en },
      { k: 'contract', h: L('계약', 'Contract'), v: v => esc(v.contractId), s: v => v.contractId },
      { k: 'entity', h: L('법인', 'Entity'), v: v => esc(v.contract.omhEntity), s: v => v.contract.omhEntity },
      { k: 'type', h: L('유형', 'Type'), v: v => esc(lab('ptype', v.contract.prepaymentType)), s: v => v.contract.prepaymentType },
      { k: 'bal', h: L('현재 잔액', 'Balance'), cls: 'num', v: v => money(v.balance.closingMinor, v.currency), s: v => v.balance.closingMinor },
      { k: 'grade', h: L('등급', 'Grade'), cls: 'ctr', v: v => gradeBadge(v.rating.grade) + ' <span class="muted small">' + (v.rating.score == null ? '—' : v.rating.score) + '</span>', s: v => Rating.gradeIndex(v.rating.grade) + (v.rating.grade === 'NR' ? 0.5 : 0) },
      { k: 'conf', h: L('신뢰도', 'Confidence'), cls: 'ctr', v: v => esc(v.rating.confidence.pct + '%'), s: v => v.rating.confidence.pct },
      { k: 'lim', h: L('권장 한도', 'Rec. limit'), cls: 'num', v: v => v.limit.recommendedLimitMinor == null ? '<span class="muted">' + esc(L('산정 불가', 'n/a')) + '</span>' : money(v.limit.recommendedLimitMinor, v.currency), s: v => v.limit.recommendedLimitMinor },
      { k: 'over', h: L('초과', 'Over'), cls: 'num', v: v => v.limit.overLimitMinor > 0 ? '<span class="bad">' + money(v.limit.overLimitMinor, v.currency) + '</span>' : '<span class="muted">—</span>', s: v => v.limit.overLimitMinor || 0 },
      { k: 'alerts', h: L('경보', 'Alerts'), v: v => v.liveAlerts.slice(0, 3).map(a => sevBadge(a.severity)).join(' ') + (v.liveAlerts.length > 3 ? ' +' + (v.liveAlerts.length - 3) : ''), s: v => v.liveAlerts.length, t: v => v.liveAlerts.map(a => a.ruleId).join(' ') },
    ];
    return filters + row2 + '<div class="panel"><h3>' + esc(L('계약별 현황', 'Contract overview')) + '</h3><div class="body">' + U.table('dash', cols, vs, { sort: 'grade' }) + '</div></div>';
  }
  function statusBind(el, ctx) {
    el.querySelectorAll('[data-f]').forEach(s => s.addEventListener('change', () => { ctx.ui.filters[s.getAttribute('data-f')] = s.value; ctx.rerender(); }));
    const c = el.querySelector('[data-act="clear-filters"]'); if (c) c.addEventListener('click', () => { ctx.ui.filters = {}; ctx.rerender(); });
    U.tableEvents(el, ctx.rerender);
  }

  /* ============ Screen 02 — Hotel Credit Profile ============ */
  function ceoSummary(v) {
    const lim = v.limit, f = v.forecast; const parts = [];
    parts.push(LF('{0} ({1}) 등급 {2}{3}, 평가 신뢰도 {4}%.', '{0} ({1}) grade {2}{3}, confidence {4}%.', tt(v.hotel.name), v.contractId, v.rating.grade, v.rating.score != null ? LF(' / {0}점', ' / {0} pts', v.rating.score) : '', v.rating.confidence.pct));
    parts.push(LF('잔액 {0}, 월평균 소진 {1}, 권장 한도 {2}.', 'Balance {0}, avg monthly consumption {1}, recommended limit {2}.', Money.format(v.balance.closingMinor, v.currency), f.avgMinor == null ? L('산정 불가', 'n/a') : Money.format(f.avgMinor, v.currency), lim.recommendedLimitMinor == null ? L('산정 불가', 'n/a') : Money.format(lim.recommendedLimitMinor, v.currency)));
    if (lim.overLimitMinor > 0) parts.push(LF('현재 잔액이 권장 한도를 {0} 초과합니다.', 'Balance exceeds the recommended limit by {0}.', Money.format(lim.overLimitMinor, v.currency)));
    if (lim.topupHold) parts.push(LF('추가 충전 보류 사유: {0}.', 'Top-up hold: {0}.', lim.holdReasons.map(h => lab('hold', h)).join(', ')));
    const crit = v.liveAlerts.filter(a => a.severity !== 'MEDIUM');
    if (crit.length) parts.push(LF('주요 경보: {0}.', 'Key alerts: {0}.', crit.map(a => tt(a.title)).join(', ')));
    parts.push(LF('회수 가능성(등급과 별도): {0}, 무담보 노출 {1}.', 'Recoverability (separate from grade): {0}, unsecured exposure {1}.', lab('recov', v.recoverability.tier), Money.format(v.recoverability.unsecuredMinor, v.currency)));
    if (v.rating.provisional) parts.push(L('※ 등급 구간·한도 배수는 잠정값이며 대표 승인 전 확정값이 아닙니다.', '※ Grade bands and multipliers are provisional pending CEO approval.'));
    return parts;
  }

  function profile(ctx) {
    const m = ctx.m; const id = ctx.params[0] || m.views[0].contractId; const v = m.byContract[id];
    if (!v) return U.emptyState(L('계약을 찾을 수 없습니다.', 'Contract not found.'), id);
    const can = p => RBAC.can(ctx.store.session.role, p); const dis = p => (can(p) ? '' : 'disabled title="' + esc(L('권한 없음', 'No permission')) + '"');
    const h = v.hotel, c = v.contract, f = v.forecast, lim = v.limit, r = v.rating, rec = v.ratingRecord;
    const countries = [...new Set(m.views.map(x => x.hotel.country))].sort(); const cty = ctx.ui.profileCountry && v.hotel.country === ctx.ui.profileCountry ? ctx.ui.profileCountry : '';   // a filter that does not match the opened contract is ignored
    const shown = m.views.filter(x => !cty || x.hotel.country === cty);
    const sel = '<div class="toolbar"><label>' + esc(L('국가', 'Country')) + ' <select id="pf-country"><option value="">' + esc(L('전체', 'All')) + '</option>' + countries.map(c => '<option value="' + esc(c) + '" ' + (c === cty ? 'selected' : '') + '>' + esc(lab('country', c)) + '</option>').join('') + '</select></label>' +
      '<label>' + esc(L('계약 선택', 'Select contract')) + ' <select id="pf-sel">' + shown.map(x => '<option value="' + esc(x.contractId) + '" ' + (x.contractId === id ? 'selected' : '') + '>' + esc(tt(x.hotel.name) + ' · ' + x.contractId + ' · ' + x.currency) + '</option>').join('') + '</select></label>' +
      '<span class="spacer"></span><span class="muted">' + esc(L('평가 단위: 계약(호텔 × 계약법인 × 통화)', 'Rating unit: contract (hotel × entity × currency)')) + '</span></div>';
    const head = '<div class="panel prof-head"><div class="body"><div class="ph-left"><h2>' + hotelName(h) + '</h2><div class="muted">' + esc(h.hotelId + ' · ' + h.ellisHotelId + ' · ' + lab('country', h.country) + ' / ' + tt(h.city)) + '</div>' +
      '<div class="muted">' + esc(L('계약 법인', 'Contracting entity')) + ': <b>' + esc(c.omhEntity) + '</b> · ' + esc(L('상대방', 'Counterparty')) + ': ' + esc(c.counterparty.legalName) + '</div></div>' +
      '<div class="ph-right"><div class="biggrade g-' + esc(r.grade) + '">' + esc(r.grade) + '</div><div><div>' + esc(L('점수', 'Score')) + ' <b>' + (r.score == null ? '—' : r.score) + '</b> ' + (r.provisional ? chip(L('잠정', 'PROVISIONAL'), 'warn') : '') + '</div>' +
      '<div>' + esc(L('평가 신뢰도', 'Confidence')) + ' <b>' + r.confidence.pct + '%</b> (' + esc(r.confidence.level) + ')</div><div class="next-check">' + esc(L('다음 점검일', 'Next check')) + ' <b>' + esc(v.nextCheck.date) + '</b> ' + chip(v.nextCheck.kind === 'WATCH' ? L('위험 관찰', 'watch') : L('월 정기', 'monthly'), v.nextCheck.kind === 'WATCH' ? 'bad' : '') + '<div class="muted small">' + esc(L('점검 시점: 선급 기안 · 충전 요청 · 매월 · 매일 가벼운 점검', 'Checked at: prepayment draft · top-up request · monthly · light daily check')) + '</div></div><div>' + esc(L('회수 가능성', 'Recoverability')) + ' <b>' + esc(lab('recov', v.recoverability.tier)) + '</b> ' + chip(L('등급과 별도', 'separate axis')) + '</div></div></div></div></div>';
    const master = '<div class="panel"><h3>' + esc(L('호텔·계약 마스터', 'Hotel & contract master')) + '</h3><div class="body kvgrid">' +
      [[L('호텔 ID / ELLIS ID', 'Hotel ID / ELLIS ID'), h.hotelId + ' / ' + h.ellisHotelId], [L('운영사', 'Operating company'), h.operatingCompany], [L('소유주', 'Owner'), L('미확인 (Unknown)', 'Unknown')], [L('사업자등록번호', 'Business reg. no.'), c.counterparty.bizRegNo || L('미확인', 'Unknown')],
        [L('계약 유형', 'Contract type'), c.contractType], [L('선급금 유형', 'Prepayment type'), lab('ptype', c.prepaymentType)], [L('통화', 'Currency'), c.currency], [L('계약 기간', 'Term'), c.startDate + ' ~ ' + c.endDate],
        [L('담당 SCM', 'Assigned SCM'), c.assignedScm || '—'], [L('호텔 상태', 'Hotel status'), h.status], [L('최종 확인일', 'Last verified'), h.lastVerifiedDate],
        [L('반환 가능', 'Refundable'), c.refund.refundable == null ? L('미확인', 'Unknown') : c.refund.refundable ? L('가능', 'Yes') : L('불가', 'No')], [L('이관 가능', 'Transferable'), c.transfer.eligible == null ? L('미확인', 'Unknown') : c.transfer.eligible ? L('가능', 'Yes') : L('불가', 'No')],
        [L('담보', 'Collateral'), c.collateral ? Money.format(c.collateral.amountMinor, c.collateral.currency) : L('없음', 'None')],
        [L('충전 조건', 'Top-up condition'), c.topUp && c.topUp.conditionText ? c.topUp.conditionText : '—'], [L('최소 충전액', 'Minimum top-up'), c.topUp && c.topUp.minAmountMinor ? Money.format(c.topUp.minAmountMinor, c.currency) : '—'], [L('객실 할당', 'Allotment'), c.allotment || '—'],
        [L('예정 충전', 'Planned top-up'), c.plannedTopUp ? Money.format(c.plannedTopUp.amountMinor, c.currency) + (c.plannedTopUp.date ? ' · ' + c.plannedTopUp.date : '') + (v.plannedSim && v.plannedSim.ok ? ' · ' + (v.plannedSim.approvalRequired ? L('한도 초과 → 대표 승인 필요', 'Limit check: CEO approval required') : L('권장 한도 이내', 'Within recommended limit')) : '') : '—']]
        .map(([k, val]) => '<div class="kv"><span class="muted">' + esc(k) + '</span><span>' + esc(val) + '</span></div>').join('') + '</div></div>';
    // rating table (editable)
    const scoreSel = (cid, val, nm) => '<select data-score="' + esc(cid) + '" aria-label="' + esc(nm) + '" ' + dis('rating.edit') + '><option value="">' + esc(L('Unknown(미확인)', 'Unknown')) + '</option>' + [1, 2, 3, 4, 5].map(n => '<option value="' + n + '" ' + (val === n ? 'selected' : '') + '>' + n + '</option>').join('') + '</select>';
    const crit = Rating.CRITERIA.map(cr => { const w = ctx.store.state.config.weights[cr.id]; const sc = rec.scores[cr.id];
      return '<tr class="' + (sc == null ? 'unk' : '') + '"><td>' + esc(tt(cr.name)) + '</td><td class="num">' + w + '</td><td class="ctr">' + scoreSel(cr.id, sc == null ? null : sc, tt(cr.name)) + '</td><td class="muted small">' + esc(tt(cr.why)) + '</td></tr>'; }).join('');
    const ratingTbl = '<div class="panel"><h3>' + esc(L('신용평가 12개 항목 (미확인은 점수에서 제외 · 신뢰도 하락)', '12 criteria (Unknown excluded from score · lowers confidence)')) + '</h3><div class="body"><div class="table-wrap"><table><thead><tr><th>' + esc(L('항목', 'Criterion')) + '</th><th class="num">' + esc(L('가중치', 'Weight')) + '</th><th class="ctr">' + esc(L('점수(1~5)', 'Score (1–5)')) + '</th><th>' + esc(L('근거', 'Why it matters')) + '</th></tr></thead><tbody>' + crit + '</tbody></table></div>' +
      '<div class="toolbar"><button class="btn primary" data-act="save-scores" ' + dis('rating.edit') + '>' + esc(L('점수 저장', 'Save scores')) + '</button><input id="commit-reason" placeholder="' + esc(L('등급 확정 사유', 'Reason for rating snapshot')) + '" ' + dis('rating.commit') + '><button class="btn" data-act="commit-rating" ' + dis('rating.commit') + '>' + esc(L('평가 이력에 확정', 'Commit snapshot to history')) + '</button></div>' +
      '<div class="muted small">' + esc(LF('점수 {0} → 점수등급 {1} → 최종 {2}{3}. 미확인 항목: {4}', 'Score {0} → score grade {1} → final {2}{3}. Unknown: {4}', r.rawScore == null ? '—' : r.rawScore.toFixed(1), r.scoreGrade || '—', r.grade, r.capped ? L(' (레드플래그로 제한됨)', ' (capped by red flag)') : '', r.confidence.unknownIds.length ? r.confidence.unknownIds.map(i => tt(Rating.CRITERIA.find(c2 => c2.id === i).name)).join(', ') : L('없음', 'none'))) + '</div></div></div>';
    const flags = '<div class="panel"><h3>' + esc(L('위험 신호 · 등급 제한', 'Risk signals · grade caps')) + '</h3><div class="body">' +
      (r.flags.length ? r.flags.map(fl => '<div class="flagrow">' + chip(fl.cap ? LF('상한 {0}', 'cap {0}', fl.cap) : '—', 'bad') + ' ' + esc(tt(Rating.FLAG_META[fl.id])) + '</div>').join('') : '<span class="muted">' + esc(L('활성 레드플래그 없음', 'No active red flags')) + '</span>') +
      (r.unverifiedSignals.length ? '<div class="note warn">' + esc(L('미검증 신호(등급·한도에 반영 안 함): ', 'Unverified signals (NOT applied to grade/limit): ')) + r.unverifiedSignals.map(s => esc(s.id + ' [' + s.source + ']')).join(', ') + '</div>' : '') + '</div></div>';
    // ---- 3. top-ups and refunds ----
    const own = ctx.store.state.ledger.filter(x => x.contractId === v.contractId); const tops = own.filter(x => x.type === 'TOPUP').sort((p, q) => String(q.occurredAt).localeCompare(String(p.occurredAt)));
    const rfd = c.refund || {}; const bal = v.balance;
    const secH = (n, txt) => '<h2 class="sec"><span class="secn">' + n + '</span> ' + esc(txt) + '</h2>';
    const kvBox = (k, val, sub) => '<div><div class="k">' + esc(k) + '</div><div class="v2">' + val + '</div>' + (sub ? '<div class="small">' + sub + '</div>' : '') + '</div>';
    const moves = '<div class="panel"><div class="body"><div class="grid3">' +
      kvBox(L('누적 충전', 'Total top-ups'), money(bal.topupsMinor, v.currency), esc(LF('{0}건', '{0} entries', tops.length))) +
      kvBox(L('누적 반환', 'Total refunds'), money(bal.refundsMinor, v.currency), rfd.requested ? esc(LF('반환 요청 {0} · 미수 {1}', 'Requested {0} · outstanding {1}', Money.format(rfd.requestedAmountMinor || 0, v.currency), Money.format(v.derived.refundOutstandingMinor, v.currency))) + (v.derived.refundOverdue ? ' ' + chip(L('기한 경과', 'overdue'), 'bad') : '') : esc(L('반환 요청 없음', 'No refund request'))) +
      kvBox(L('마지막 충전', 'Last top-up'), tops.length ? money(tops[0].amountMinor, v.currency) : '—', tops.length ? esc(String(tops[0].occurredAt).slice(0, 10)) : '') + '</div>' +
      (tops.length ? '<div class="table-wrap"><table><thead><tr><th>' + esc(L('충전일', 'Date')) + '</th><th class="num">' + esc(L('금액', 'Amount')) + '</th><th>' + esc(L('참조', 'Reference')) + '</th></tr></thead><tbody>' + tops.slice(0, 5).map(x => '<tr><td>' + esc(String(x.occurredAt).slice(0, 10)) + '</td><td class="num">' + money(x.amountMinor, v.currency) + '</td><td class="muted small">' + esc(x.externalRef || '') + '</td></tr>').join('') + '</tbody></table></div>' : '') +
      '<div class="muted small">' + esc(L('충전 조건', 'Top-up condition')) + ': ' + esc(c.topUp && c.topUp.conditionText ? c.topUp.conditionText : '—') + (c.plannedTopUp ? ' · ' + esc(L('예정 충전', 'Planned top-up')) + ' ' + esc(Money.format(c.plannedTopUp.amountMinor, v.currency) + (c.plannedTopUp.date ? ' · ' + c.plannedTopUp.date : '')) : '') + '</div>' +
      '<a class="btn sm" href="#/ledger/' + esc(id) + '">' + esc(L('플로팅 원장에서 충전·반환 기록하기', 'Record top-ups and refunds in the ledger')) + '</a></div></div>';
    // ---- 4. consumption: the confirmed ledger next to what the ELLIS bookings say ----
    const ell = v.ellisOutlook, tp = v.topupPlan, srcLab = s => (s === 'LEDGER' ? L('원장 확정 소진', 'confirmed ledger') : s === 'ELLIS' ? L('ELLIS 예약', 'ELLIS bookings') : '—');
    const ellRow = mo => ell.past.find(x => x.month === mo);
    const consRows = f.series.map(s => { const e = ellRow(s.month); return '<tr><td>' + esc(s.month) + '</td><td class="num">' + (s.amountMinor == null ? '<span class="bad">' + esc(L('미확정', 'MISSING')) + '</span>' : money(s.amountMinor, v.currency)) + '</td><td class="num">' + (e && e.ellisMinor != null ? (e.converted ? '≈' : '') + money(e.ellisMinor, v.currency) : '<span class="muted">—</span>') + '</td><td class="num">' + (e && e.ratioPct != null ? e.ratioPct + '%' : '—') + '</td><td>' + (e ? chip(lab('ellisMo', e.status), e.status === 'MATCH' ? 'ok' : e.status === 'DIVERGENT' ? 'bad' : 'warn') + (e.sinceDate ? ' <span class="muted small">' + esc(LF('{0}부터', 'from {0}', e.sinceDate.slice(5))) + '</span>' : '') : '') + '</td></tr>'; }).join('');
    const upRows = ell.upcoming.map(e => '<tr><td>' + esc(e.month) + (e.current ? ' <span class="muted small">' + esc(L('이번 달', 'this month')) + '</span>' : '') + '</td><td class="num">' + (e.netMinor == null ? '<span class="muted">—</span>' : (e.converted ? '≈' : '') + money(e.netMinor, v.currency)) + '</td><td class="num">' + (e.bookings == null ? '—' : e.bookings) + '</td><td>' + (e.status === 'OK' ? chip(L('예약 반영', 'on the books'), 'ok') : chip(lab('ellisMo', e.status), 'warn')) + '</td></tr>').join('');
    const consume = '<div class="panel"><div class="body">' +
      (ell.available ? '<div class="small">' + chip(ell.synthetic ? L('합성 데이터', 'Synthetic data') : L('실데이터', 'Real data'), ell.synthetic ? 'warn' : 'ok') + ' ' + chip(ell.dateBasis === 'CHECK_OUT_DATE' ? L('체크아웃 월 기준', 'Check-out month basis') : L('체크인 월 기준', 'Check-in month basis'), 'warn') + (ell.stale ? ' ' + chip(L('오래됨', 'Stale'), 'bad') : '') + ' <span class="muted">' + esc(LF('ELLIS 수집 {0}', 'ELLIS collected {0}', ell.collectedAt)) + '</span></div>'
        : '<div class="note warn">' + esc(L('이 계약에 쓸 수 있는 ELLIS 스냅샷이 없습니다. ELLIS MCP 예약을 가져오면 예약 기반 소진 속도가 여기에 표시됩니다(관리 화면).', 'No usable ELLIS snapshot for this contract. Import ELLIS MCP bookings (Administration) to see the booking-based consumption speed here.')) + '</div>') +
      '<div class="table-wrap"><table><thead><tr><th>' + esc(L('월', 'Month')) + '</th><th class="num">' + esc(L('원장 확정 소진', 'Confirmed (ledger)')) + '</th><th class="num">' + esc(L('ELLIS 예약 순액', 'ELLIS bookings (net)')) + '</th><th class="num">' + esc(L('비율', 'Ratio')) + '</th><th>' + esc(L('판정', 'Result')) + '</th></tr></thead><tbody>' + consRows + '</tbody></table></div>' +
      '<div class="grid3">' + kvBox(L('월평균 소진 — 원장 확정', 'Monthly average — confirmed ledger'), f.avgMinor == null ? '—' : money(f.avgMinor, v.currency), esc(lab('quality', f.quality))) +
      kvBox(L('월평균 소진 — ELLIS 예약', 'Monthly average — ELLIS bookings'), ell.avgMinor == null ? '—' : money(ell.avgMinor, v.currency), ell.avgMonths ? esc(LF('{0}개월 평균', '{0}-month average', ell.avgMonths)) + (ell.complete ? '' : ' · ' + esc(L('일부 월 제외', 'some months left out'))) : '') +
      kvBox(L('소진 속도 변화(최근월 vs 직전 2개월 평균)', 'Velocity (latest vs prior-2 avg)'), esc(f.velocity.pct == null ? L('산정 불가', 'n/a') : U.pct(f.velocity.pct)), tp.speedGapPct == null ? '' : esc(LF('ELLIS는 원장보다 {0}%', 'ELLIS is {0}% vs ledger', (tp.speedGapPct > 0 ? '+' : '') + tp.speedGapPct))) + '</div>' +
      (ell.upcoming.length ? '<h4 class="subh">' + esc(L('이미 ELLIS에 잡힌 예약(이번 달 이후)', 'Stays already on the ELLIS books (this month on)')) + '</h4><div class="table-wrap"><table><thead><tr><th>' + esc(L('월', 'Month')) + '</th><th class="num">' + esc(L('예약 순액', 'Booked (net)')) + '</th><th class="num">' + esc(L('건수', 'Bookings')) + '</th><th></th></tr></thead><tbody>' + upRows + '</tbody></table></div><div class="muted small">' + esc(L('아직 체크인·체크아웃 전이라 취소되거나 늘 수 있는 예약분입니다. 이번 달은 진행 중이라 월 전체가 아닙니다.', 'Not yet checked in / out, so these can still be cancelled or grow. The current month is still running, so it is not a full month.')) + '</div>' : '') +
      '<div class="muted small">' + esc(L('ELLIS 금액은 취소를 뺀 순액(청구액−수익)입니다. 호텔이 실제로 차감하는 금액과 같은지는 확인 중이라 한도·경보는 원장 확정 소진을 기준으로 하고, ELLIS는 속도 검증과 충전 시점 계산에 함께 씁니다.', 'ELLIS amounts are net (billing minus revenue), cancelled stays excluded. Whether that equals what the hotel deducts is still being confirmed, so limits and alerts use the confirmed ledger; ELLIS is used to check the speed and to time the next top-up.')) + '</div></div></div>';
    // ---- 5. balance ----
    const balanceSec = '<div class="panel"><div class="body"><div class="grid3">' + kvBox(L('원장 잔액', 'Ledger balance'), money(bal.closingMinor, v.currency), esc(LF('대기(pending) 소진 {0}은 미반영', 'Pending consumption {0} not deducted', Money.format(bal.pendingConsumptionMinor, v.currency)))) +
      kvBox(L('예상 소진일', 'Projected depletion date'), esc(f.depletionDate || (f.beyondHorizon ? L('100년 초과(사실상 소진 없음)', 'beyond 100 years') : L('예측 불가', 'n/a'))), f.monthsOfCover != null ? esc(f.monthsOfCover + L('개월분', ' months cover')) : esc(lab('fstatus', f.status))) +
      kvBox(L('계약 만기', 'Contract end'), esc(f.contractEnd || '—'), f.depletesBeforeEnd == null ? '' : f.depletesBeforeEnd ? esc(L('만기 전 소진 가능', 'Depletes before end')) : '<span class="bad">' + esc(L('만기 전 소진 불가', 'Does not deplete before end')) + '</span>') + '</div>' +
      '<div class="grid3">' + kvBox(L('만기 시 예상 미소진', 'Est. unused at end'), f.estimatedUnusedAtEndMinor == null ? '—' : money(f.estimatedUnusedAtEndMinor, v.currency), '') + kvBox(L('누적 소진(확정)', 'Confirmed consumption'), money(bal.consumptionMinor, v.currency), '') + kvBox(L('기초 잔액', 'Opening balance'), money(bal.openingMinor, v.currency), '') + '</div></div></div>';
    // ---- 6. balance against the hotel ----
    const reconSec = '<div class="panel"><div class="body"><div class="grid3">' + kvBox(L('우리 원장(확인일 기준)', 'Our ledger (as of the confirmation)'), v.recon.ledgerAtMinor == null ? '—' : money(v.recon.ledgerAtMinor, v.currency), '') +
      kvBox(L('호텔 확인 잔액', 'Hotel-confirmed'), v.recon.confirmedMinor == null ? '—' : money(v.recon.confirmedMinor, v.currency), esc(lab('recon', v.recon.status)) + (v.recon.stale ? ' · ' + esc(L('확인 오래됨', 'stale')) : '')) +
      kvBox(L('차이', 'Difference'), v.recon.diffMinor ? '<span class="' + (v.derived.reconMajor ? 'bad' : '') + '">' + esc(Money.format(v.recon.diffMinor, v.currency)) + '</span>' : (v.recon.confirmedMinor == null ? '—' : esc(L('없음', 'none'))), '') + '</div>' +
      '<a class="btn sm" href="#/ledger/' + esc(id) + '">' + esc(L('호텔 확인 잔액 기록하기', 'Record a hotel confirmation')) + '</a></div></div>';
    // ---- 7. how fast must the next top-up be made ----
    const reqs = ctx.store.state.approvals.filter(x => x.contractId === v.contractId);          // review requests sent to the CEO for this contract, with the feedback that came back
    const reviewSec = reqs.length ? '<div class="panel"><h3>' + esc(L('충전 검토 요청과 대표 검토 의견', 'Top-up review requests and CEO feedback')) + '</h3><div class="body"><div class="table-wrap"><table><thead><tr><th>ID</th><th class="num">' + esc(L('요청액', 'Requested')) + '</th><th>' + esc(L('상태', 'Status')) + '</th><th>' + esc(L('대표 검토 의견', 'CEO feedback')) + '</th></tr></thead><tbody>' +
      reqs.map(x => '<tr><td>' + esc(x.approvalId) + '</td><td class="num">' + money(x.packet.request.requestedMinor, v.currency) + '</td><td>' + chip(lab('apStatus', x.status), x.status === 'CEO_REVIEWED' ? 'ok' : '') + '</td><td class="small">' + (x.feedback ? esc(x.feedback.text) + '<div class="muted">' + esc(x.feedback.by + ' · ' + x.feedback.at) + '</div>' : '<span class="muted">—</span>') + '</td></tr>').join('') +
      '</tbody></table></div><a class="btn sm" href="#/approval/' + esc(id) + '">' + esc(L('선급 결재 자료·대표 검토 열기', 'Open prepayment approval packet and CEO review')) + '</a></div></div>' : '';
    const urgTone = { NOW: 'bad', SOON: 'warn', LATER: 'ok' };
    const planHead = tp.depletionDate ? '<p class="plan-head">' + esc(LF('소진 예상일 {0} → 늦어도 {1}까지 충전을 신청해야 합니다({2}일 전).', 'Projected depletion {0} → request the top-up by {1} at the latest ({2} days ahead).', tp.depletionDate, tp.topUpByDate, tp.leadDays)) + ' ' + chip(lab('urgency', tp.urgency), urgTone[tp.urgency] || '') + '</p>' : '';
    const first = ell.upcoming.find(e => e.netMinor != null && e.current);
    const planSec = '<div class="panel"><div class="body"><div>' + chip(lab('plan', tp.status), tp.status === 'PLAN' ? 'ok' : tp.status === 'HOLD' || tp.status === 'DEPLETED' ? 'bad' : 'warn') + '</div>' + planHead +
      '<div class="grid3">' + kvBox(L('소진 속도(월)', 'Consumption speed (month)'), tp.monthlyMinor == null ? '—' : money(tp.monthlyMinor, v.currency), esc(LF('출처: {0}', 'Source: {0}', srcLab(tp.speedSource)))) +
      kvBox(L('충전 가능 최대(한도 여유)', 'Room under the limit'), money(tp.availableMinor, v.currency), tp.minTopUpMinor ? esc(LF('최소 충전액 {0}', 'Minimum top-up {0}', Money.format(tp.minTopUpMinor, v.currency))) : '') +
      kvBox(L('이번 달 ELLIS 예약분', 'ELLIS bookings this month'), first ? money(first.netMinor, v.currency) : '—', first && tp.monthlyMinor ? esc(LF('월평균의 {0}%', '{0}% of the monthly speed', Math.round(first.netMinor / tp.monthlyMinor * 100))) : '') + '</div>' +
      (tp.status === 'HOLD' ? '<div class="note bad">' + esc(L('충전이 필요해지더라도 아래 사유로 추가 충전은 보류 상태입니다: ', 'Even when a top-up becomes due, further top-ups are on hold because of: ')) + tp.holdReasons.map(x => esc(lab('hold', x))).join(' · ') + '</div>' : '') +
      (tp.reasons.includes('BEYOND_CONTRACT_END') ? '<div class="note">' + esc(L('잔액이 계약 만기 이후까지 남아 추가 충전이 필요 없습니다.', 'The balance outlasts the contract; no further top-up is needed.')) + '</div>' : '') +
      '<div class="muted small">' + esc(LF('충전 신청부터 호텔 입금까지 {0}일(잠정)을 뺀 날짜입니다. 충전 승인과 금액은 대표가 결정합니다(결재 포털).', 'Counts {0} days (provisional) from request to the money reaching the hotel. The CEO decides the top-up and its amount (approval portal).', tp.leadDays)) + '</div>' +
      '</div></div>' + NS.ViewsB.simPanel(ctx, v) + reviewSec;
    // ---- 8. go on with this hotel? ----
    const rl = v.relationship; const relTone = { CONTINUE: 'ok', CONDITIONS: 'warn', REVIEW: 'warn', WIND_DOWN: 'bad' };
    const relSec = '<div class="panel"><div class="body"><div class="rel-head">' + chip(lab('rel', rl.verdict), relTone[rl.verdict]) + '</div>' +
      (rl.reasons.length ? '<ul class="rel-why">' + rl.reasons.map(x => '<li>' + esc(x.code === 'HOLD' ? lab('hold', x.reason) : x.code === 'CRITICAL_FACT' ? lab('relWhy', 'CRITICAL_FACT') + ' — ' + tt(Rating.FLAG_META[x.flag]) : lab('relWhy', x.code)) + '</li>').join('') + '</ul>' : '<div class="muted">' + esc(L('걸리는 사유가 없습니다.', 'Nothing speaks against it.')) + '</div>') +
      '<div class="muted small">' + esc(L('규칙으로 만든 참고 의견입니다. 협업 지속·중단은 대표가 결정합니다. 기준은 잠정값입니다.', 'A rule-based opinion for reference. The CEO decides whether to continue or stop. The rules are provisional.')) + '</div></div></div>';
    const guards = lim.guards.map(g => '<tr><td>' + esc(lab('guard', g.id)) + '</td><td class="num">' + money(g.capMinor, v.currency) + '</td><td>' + (g.binding ? chip(L('적용됨', 'binding'), 'bad') : chip(L('여유', 'not binding'))) + '</td></tr>').join('');
    const limitBox = '<div class="panel"><h3>' + esc(L('권장 선급 한도', 'Recommended prepayment limit')) + '</h3><div class="body"><div class="muted small">' + esc(L('대표 제안: 한도 = 등급별 개월 수 × 월평균 소진액 (A 2개월 · B 1개월 · C 2주 · D 0). 기준 확정은 대표가 합니다.', 'CEO proposal: limit = months by grade × average monthly consumption (A 2 mo · B 1 mo · C 2 weeks · D 0). The CEO confirms the standard.')) + '</div><div class="grid3">' +
      '<div><div class="k">' + esc(L('등급 배수', 'Grade multiplier')) + '</div><b>' + esc(r.grade) + ' × ' + lim.multiplier + L('개월', ' mo')+ '</b> ' + chip(L('잠정', 'provisional'), 'warn') + '</div>' +
      '<div><div class="k">' + esc(L('기초 한도 (평균 × 배수)', 'Base limit (avg × multiplier)')) + '</div><b>' + (lim.baseLimitMinor == null ? L('산정 불가', 'n/a') : money(lim.baseLimitMinor, v.currency)) + '</b></div>' +
      '<div><div class="k">' + esc(L('최종 권장 한도(안전장치 적용)', 'Final recommended limit (after safeguards)')) + '</div><b>' + (lim.recommendedLimitMinor == null ? L('산정 불가', 'n/a') : money(lim.recommendedLimitMinor, v.currency)) + '</b></div></div>' +
      '<div class="grid3"><div><div class="k">' + esc(L('추가 충전 가능액', 'Available top-up')) + '</div><b>' + money(lim.availableTopupMinor, v.currency) + '</b></div><div><div class="k">' + esc(L('한도 초과액', 'Over limit')) + '</div><b class="' + (lim.overLimitMinor > 0 ? 'bad' : '') + '">' + (lim.overLimitMinor == null ? '—' : money(lim.overLimitMinor, v.currency)) + '</b></div>' +
      '<div><div class="k">' + esc(L('추가 충전 보류', 'Top-up hold')) + '</div><b>' + (lim.topupHold ? '<span class="bad">' + esc(L('보류', 'HOLD')) + '</span>' : esc(L('없음', 'No'))) + '</b></div></div>' +
      (lim.holdReasons.length ? '<div class="note bad">' + lim.holdReasons.map(x => esc(lab('hold', x))).join(' · ') + '</div>' : '') +
      (guards ? '<div class="table-wrap"><table><thead><tr><th>' + esc(L('안전장치', 'Safeguard')) + '</th><th class="num">' + esc(L('상한', 'Cap')) + '</th><th></th></tr></thead><tbody>' + guards + '</tbody></table></div>' : '') +
      '</div></div>';
    const urgent = v.liveAlerts.some(a => a.severity === 'CRITICAL' || a.severity === 'HIGH');
    const notify = urgent ? '<div class="note warn notify"><b>' + esc(L('알림 대상', 'Notify')) + '</b>: ' + esc(L('대표', 'CEO')) + ' · ' + esc(L('에이든(주관)', 'Aiden (owner)')) + ' · ' + esc(LF('{0} 경영지원', '{0} business support', c.omhEntity)) + '<br>' + esc(L('제안: 추가 충전 중단 · 반환 요청 검토', 'Proposal: stop further top-ups · review a refund request')) + '<br><span class="muted small">' + esc(L('이 화면은 알림을 보내지 않고 대상만 보여 줍니다.', 'This screen sends nothing; it only shows who would be notified.')) + '</span></div>' : '';
    const alerts = '<div class="panel"><h3>' + esc(L('활성 위험 경보', 'Active risk alerts')) + '</h3><div class="body">' + notify + (v.alerts.length ? v.alerts.map(a => '<div class="alertrow">' + sevBadge(a.severity) + ' <b>' + esc(tt(a.title)) + '</b> <span class="muted small">→ ' + esc(lab('action', a.action)) + ' · ' + esc(lab('alertStatus', a.status)) + '</span></div>').join('') : '<span class="muted">' + esc(L('활성 경보 없음', 'No active alerts')) + '</span>') + '</div></div>';
    const opinion = '<div class="panel"><h3>' + esc(L('SCM 의견', 'SCM opinion')) + '</h3><div class="body"><textarea id="scm-op" rows="3" aria-label="SCM opinion" ' + dis('opinion.write') + '>' + esc(rec.scmOpinion ? rec.scmOpinion.text : '') + '</textarea><div class="toolbar"><button class="btn" data-act="save-opinion" ' + dis('opinion.write') + '>' + esc(L('의견 저장', 'Save opinion')) + '</button><span class="muted small">' + esc(rec.scmOpinion ? rec.scmOpinion.by + ' · ' + rec.scmOpinion.at : '') + '</span></div></div></div>';
    const ceo = '<div class="panel ceo"><h3>' + esc(L('대표 검토용 요약 (규칙엔진 값으로 자동 생성)', 'CEO review summary (auto-generated from rule-engine values)')) + '</h3><div class="body">' + ceoSummary(v).map(p => '<p>' + esc(p) + '</p>').join('') + '</div></div>';
    const ai = ctx.store.state.aiReports[id];
    const aiBox = '<div class="panel"><h3>' + esc(L('AI 위험 분석', 'AI risk analysis')) + ' ' + chip('MOCK', 'warn') + '</h3><div class="body"><div class="note warn">' + esc(L('모의 결과입니다. 실제 AI·외부 데이터를 호출하지 않았고, 금액·한도·등급은 AI가 정하지 않습니다.', 'MOCK output. No real AI or external data was called; amounts, limits and grades are never set by AI.')) + '</div>' +
      (ai ? '<p>' + esc(LF(ai.summary.ko, ai.summary.en, ...(ai.summary.args || []))) + '</p>' + (ai.riskFactors.length ? '<table><thead><tr><th>' + esc(L('위험 요인', 'Risk factor')) + '</th><th>' + esc(L('출처', 'Source')) + '</th><th>' + esc(L('기준일', 'As of')) + '</th><th>' + esc(L('확신', 'Confidence')) + '</th><th>' + esc(L('검증', 'Verified')) + '</th></tr></thead><tbody>' + ai.riskFactors.map(x => '<tr><td>' + esc(LF(x.ko, x.en, ...(x.args || []))) + '</td><td>' + esc(x.source) + '</td><td>' + esc(x.asOf) + '</td><td>' + esc(x.confidence) + '</td><td>' + (x.verified ? '✔' : '✖') + '</td></tr>').join('') + '</tbody></table>' : '') : '') +
      '<button class="btn" data-act="run-ai" ' + dis('ai.run') + '>' + esc(L('모의 AI 분석 실행', 'Run mock AI analysis')) + '</button></div></div>';
    const hist = '<div class="panel"><h3>' + esc(L('평가 변경 이력', 'Rating history')) + '</h3><div class="body">' + (rec.history.length ? '<div class="table-wrap"><table><thead><tr><th>' + esc(L('일자', 'Date')) + '</th><th>' + esc(L('등급', 'Grade')) + '</th><th class="num">' + esc(L('점수', 'Score')) + '</th><th>' + esc(L('작성', 'By')) + '</th><th>' + esc(L('사유', 'Reason')) + '</th></tr></thead><tbody>' + rec.history.slice().reverse().map(x => '<tr><td>' + esc(x.at) + '</td><td>' + gradeBadge(x.grade) + '</td><td class="num">' + esc(x.score == null ? '—' : x.score) + '</td><td>' + esc(x.by) + '</td><td>' + esc(x.reason) + '</td></tr>').join('') + '</tbody></table></div>' : U.emptyState(L('확정된 평가 이력이 없습니다.', 'No committed rating history.'))) + '</div></div>';
    const factForm = '<div class="panel"><h3>' + esc(L('사실 확인 기록 (검증된 사실만 등급을 제한)', 'Record a fact (only verified facts cap the grade)')) + '</h3><div class="body"><div class="toolbar">' +
      '<select id="fact-key" aria-label="fact type" ' + dis('rating.edit') + '><option value="hotel:closure">' + esc(L('호텔 휴·폐업·압류·부도', 'Hotel suspension / closure / seizure / insolvency')) + '</option><option value="contract:refundRefused">' + esc(L('반환 거절', 'Refund refused')) + '</option><option value="contract:legalRecoveryCritical">' + esc(L('중대한 법적 회수 위험', 'Critical legal recovery risk')) + '</option></select>' +
      '<input id="fact-ev" placeholder="' + esc(L('증빙 문서/메일 번호 (필수)', 'Evidence reference (required)')) + '" ' + dis('rating.edit') + '><button class="btn" data-act="fact-verified" ' + dis('rating.edit') + '>' + esc(L('검증 완료로 기록', 'Record as verified')) + '</button><button class="btn" data-act="fact-unverified" ' + dis('rating.edit') + '>' + esc(L('미검증 제보로 기록', 'Record as unverified report')) + '</button></div>' +
      '<div class="muted small">' + esc(L('검증자는 로그인한 본인이어야 하며 증빙이 없으면 거부됩니다. AI·뉴스·SNS 단독 제보는 폐업 확정으로 처리되지 않습니다.', 'The verifier must be the signed-in user and evidence is mandatory. AI / news / social-media reports alone never confirm a closure.')) + '</div></div></div>';
    return sel + head + ceo + secH(1, L('호텔 정보', 'Hotel information')) + master + secH(2, L('한도 (대표 제안)', 'Limit (CEO proposal)')) + limitBox + secH(3, L('충전 및 반환', 'Top-ups and refunds')) + moves + secH(4, L('소진 (원장 확정 · ELLIS 예약)', 'Consumption (confirmed ledger · ELLIS bookings)')) + consume + secH(5, L('잔액', 'Balance')) + balanceSec + secH(6, L('호텔과의 잔액 비교', 'Balance against the hotel')) + reconSec + secH(7, L('앞으로 충전은 얼마나 빨리 해야 하나', 'How fast must the next top-up be made')) + planSec + secH(8, L('앞으로 이 호텔과 계속 협업해야 하나', 'Should the cooperation with this hotel go on')) + relSec + secH(9, L('이 호텔은 문제가 없나 — 신용평가', 'Is there a problem with this hotel — credit rating')) + ratingTbl + '<div class="grid2">' + flags + alerts + '</div><div class="grid2">' + opinion + aiBox + '</div>' + factForm + hist;
  }
  function profileBind(el, ctx) {
    const id = ctx.params[0] || ctx.m.views[0].contractId; const cmd = ctx.store.commands;
    const sel = el.querySelector('#pf-sel'); if (sel) sel.addEventListener('change', () => ctx.navigate('/profile/' + sel.value));
    NS.ViewsB.simBind(el, ctx, ctx.m.byContract[id]);
    const pc = el.querySelector('#pf-country'); if (pc) pc.addEventListener('change', () => { ctx.ui.profileCountry = pc.value; const cur = ctx.m.byContract[id]; const first = cur && (!pc.value || cur.hotel.country === pc.value) ? cur : ctx.m.views.find(x => !pc.value || x.hotel.country === pc.value); ctx.navigate('/profile/' + (first ? first.contractId : id)); });
    const on = (act, fn) => { const b = el.querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener('click', fn); };
    on('save-scores', () => { const scores = {}; el.querySelectorAll('[data-score]').forEach(s => { scores[s.getAttribute('data-score')] = s.value === '' ? null : Number(s.value); }); ctx.run(() => cmd.setScores(id, scores), L('점수를 저장했습니다.', 'Scores saved.')); });
    on('commit-rating', () => ctx.run(() => cmd.commitRating(id, el.querySelector('#commit-reason').value), L('평가 이력에 확정했습니다.', 'Snapshot committed.')));
    on('save-opinion', () => ctx.run(() => cmd.setOpinion(id, el.querySelector('#scm-op').value), L('의견을 저장했습니다.', 'Opinion saved.')));
    on('run-ai', () => ctx.run(() => cmd.runAi(id), L('모의 AI 분석 완료', 'Mock AI analysis done')));
    const fact = verified => ctx.run(() => { const [target, key] = el.querySelector('#fact-key').value.split(':'); const sess = ctx.store.session; const ev = el.querySelector('#fact-ev').value;
      const claim = { claimed: true, source: 'SCM', note: '', verified: verified ? { by: sess.actor, at: ctx.m.asOf, evidenceRef: ev } : null };
      return cmd.recordFact(target, target === 'hotel' ? ctx.m.byContract[id].hotelId : id, key, claim); }, L('사실 확인을 기록했습니다.', 'Fact recorded.'));
    on('fact-verified', () => fact(true)); on('fact-unverified', () => fact(false));
  }
  return { dashboard, dashboardBind, status, statusBind, profile, profileBind, ceoSummary };
});
