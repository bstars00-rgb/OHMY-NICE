/* 「SG 전환」 탭: 재무·SCM 엑셀 양식(①지급목록, ②프리바이목록)을 대표님 대시보드 안에서 보여 준다.
   대표님 대시보드의 변수·함수(T, LANG, CORP, DATA, evalHotel, parseCSV, toast, copyText)를 그대로 쓰고, 계산은 calc.js(CALC), 파일 읽기는 sg_import.js(SGIMPORT)가 한다.
   이 스크립트는 대표님 스크립트보다 먼저 실려 함수만 정의하고, 대표님 쪽 renderAll()이 renderSG()를 부른다. */
let SGDATA = /*__SGDATA__*/null || { meta: { synthetic: true, today: '', sources: [], parseIssues: [], config: {} }, payments: [], prebuy: [] };
const SGDATA0 = JSON.parse(JSON.stringify(SGDATA));
const SGS = { view: 'pay', f: { pay: {}, pre: {} }, page: { pay: 0, pre: 0, miss: 0, iss: 0 }, open: null, picks: new Set(), msg: '', focus: null, sev: '' };
const SGPICK_KEY = 'omh_sg_picks:' + (SGDATA.meta.synthetic ? 's' : 'r');
try { JSON.parse(localStorage.getItem(SGPICK_KEY) || '[]').forEach(x => SGS.picks.add(x)); } catch (e) { /* 저장소를 못 쓰는 환경 */ }
let SGC = null;

const sgE = v => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sgTx = (k, p) => { const d = (typeof LANG !== 'undefined' && LANG === 'ko') ? SGTEXT.ko : SGTEXT.en; let s = d[k] || SGTEXT.ko[k] || k; if (p) for (const x of Object.keys(p)) s = s.split('{' + x + '}').join(p[x]); return s; };
const sgNum = (n, ccy) => (n === null || n === undefined || Number.isNaN(n)) ? '—' : Math.round(n).toLocaleString('ko-KR') + (ccy ? ' ' + ccy : '');
const sgPct = (n, d) => (n === null || n === undefined) ? '—' : (Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)) + '%';
const sgPill = (cls, text) => '<span class="pill ' + sgE(cls) + '">' + sgE(text) + '</span>';
const SGCLS_TONE = { A1: 'ok', A2: 'ok', EXC: 'warn', TBD: 'na', PRE: 'na', B1: 'ok', B2_USE: 'ok', B2_REFUND: 'warn', B2_TALK: 'bad' };
const sgClsText = c => sgTx(c);
const sgSig = c => '<span class="dot ' + c + '"></span> ' + sgE(sgTx({ ok: 'sigOk', warn: 'sigWarn', bad: 'sigBad', na: 'sigNa', off: 'sigNa' }[c] || 'sigNa'));
const sgYN = v => v === 'O' ? T('가능', 'Yes') : v === 'X' ? T('불가', 'No') : v === '미확인' ? T('미확인', 'Unknown') : '—';
const sgDleft = n => n === null || n === undefined ? '' : n > 0 ? sgTx('dLeft', { n }) : n === 0 ? sgTx('dToday') : sgTx('dPast', { n: -n });

function sgCfg() { return CALC.cfgOf(SGDATA); }
function sgScoped() { const keep = r => !CORP || r.country === CORP; return { payments: SGDATA.payments.filter(keep), prebuy: SGDATA.prebuy.filter(keep) }; }
function sgCompute() {
  const sc = sgScoped(); const data = { meta: SGDATA.meta, payments: sc.payments, prebuy: sc.prebuy }; const cfg = sgCfg(); const today = TODAY_S;
  const pay = CALC.paymentStats(data.payments); pay.rows.forEach((r, i) => { r.id = 'p' + r.sourceRow + '-' + i; });
  const pre = CALC.prebuyStats(data.prebuy, cfg); pre.rows.forEach((r, i) => { r.id = 'h' + r.sourceRow + '-' + i; const ev = sgCeoMatch(r); r.ceo = ev ? ev.color : null; r.ceoBal = ev && ev.hasData ? ev.bal : null; });
  SGC = { data, cfg, pay, pre, prog: CALC.progress(data, today), issues: CALC.validate(data), packet: CALC.approvalPacket(data) };
}
/** 같은 ELLIS 호텔코드가 대표님 현황판에도 있으면 그 호텔의 신호(보드와 같은 계산)를 붙인다. */
const sgNorm = v => String(v === null || v === undefined ? '' : v).toLowerCase().replace(/[^a-z0-9぀-ヿ㐀-鿿가-힣]/g, '');
function sgCeoMatch(r) { if (typeof DATA === 'undefined') return null; let h = r.code ? DATA.hotels.find(x => String(x.code) === String(r.code)) : null; if (!h && r.hotel) { const n = sgNorm(r.hotel); h = DATA.hotels.find(x => sgNorm(x.name) === n && !/保証金|보증금/.test(x.type || '')); } if (!h) return null; try { return evalHotel(h); } catch (e) { return null; } }
function sgCeoSignal(r) { const ev = sgCeoMatch(r); return ev ? ev.color : null; }

function sgTiles() {
  const pay = SGC.pay.total, due = pay.n - pay.PRE, pre = SGC.pre, pr = SGC.prog; const sev = { error: 0, warn: 0 }; SGC.issues.forEach(i => { if (sev[i.sev] !== undefined) sev[i.sev]++; });
  const tile = (cls, k, v, s) => '<div class="tile ' + cls + '"><div class="k">' + sgE(k) + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
  const ccyLines = Object.keys(pre.byCcy).sort().map(c => sgE(sgNum(pre.byCcy[c].ledger, c))).join('<br>') || '—';
  const payPct = pr.payments.due ? Math.round((pr.payments.done + pr.payments.unknown) / pr.payments.due * 100) : 0, scmPct = pr.prebuy.n ? Math.round(pr.prebuy.scmAnswered / pr.prebuy.n * 100) : 0;
  return '<div class="tiles">' +
    tile(pay.TBD ? 'warn' : 'ok', sgTx('boardPayTitle'), due.toLocaleString('ko-KR'), 'A1 ' + pay.A1 + ' · A2 ' + pay.A2 + ' · ' + sgE(sgTx('EXC')) + ' ' + pay.EXC + ' · ' + sgE(sgTx('TBD')) + ' ' + pay.TBD) +
    tile((pre.byClass.TBD || { n: 0 }).n ? 'warn' : 'ok', sgTx('boardPreTitle'), pre.count + ' ' + sgE(sgTx('hotels')), ['B1', 'B2_USE', 'B2_REFUND', 'B2_TALK', 'TBD'].map(c => sgE(sgClsText(c)) + ' ' + ((pre.byClass[c] || { n: 0 }).n)).join(' · ')) +
    tile('na', sgTx('ledger'), '<span style="font-size:14px">' + ccyLines + '</span>', sgE(sgTx('perCurrencyNote'))) +
    tile(payPct < 100 || scmPct < 100 ? 'warn' : 'ok', sgTx('boardCollectTitle'), payPct + '% · ' + scmPct + '%', sgE(sgTx('colPay')) + ' · ' + sgE(sgTx('colPreScm'))) +
    tile(sev.error ? 'bad' : sev.warn ? 'warn' : 'ok', sgTx('boardIssues'), sev.error + ' / ' + sev.warn, sgE(sgTx('sevError')) + ' / ' + sgE(sgTx('sevWarn'))) + '</div>';
}
function sgHeadNote() {
  const dl = SGC.prog.deadlines; const d = (k, key) => sgE(sgTx(key)) + ' ' + sgE(dl[k].date.slice(5)) + ' · ' + sgE(sgDleft(dl[k].daysLeft));
  const m = SGDATA.meta; const syn = m.synthetic ? sgTx('syntheticNote') : sgTx('internalNote');
  return '<p class="note"><b>' + sgE(m.synthetic ? sgTx('synthetic') : sgTx('internal')) + '</b> · ' + sgE(syn) + '<br>' + d('finance', 'deadlineFinance') + ' · ' + d('scm', 'deadlineScm') + ' · ' + d('approval', 'deadlineApproval') + ' · ' + sgE(sgTx('asOf')) + ' ' + sgE(m.asOfMin === m.asOfMax ? (m.asOfMax || '—') : (m.asOfMin || '—') + ' ~ ' + (m.asOfMax || '—')) + '</p>';
}
function sgSubnav() {
  const b = (id, label) => '<button type="button" data-sg="view" data-v="' + id + '" aria-pressed="' + (SGS.view === id) + '">' + sgE(label) + '</button>';
  return '<div class="modes">' + b('pay', T('후불 지급(A1·A2)', 'Post-paid (A1·A2)')) + b('pre', T('프리바이 처리(B1·B2)', 'Prebuy handling (B1·B2)')) + b('ap', T('결재 준비 11/20', 'Approval prep 11/20')) + b('col', T('수집·점검', 'Collection & checks')) + '</div>';
}
function sgSel(scope, key, label, options, cur) { return '<label><span>' + sgE(label) + '</span> <select data-sgf="' + scope + '.' + key + '"><option value="">' + sgE(sgTx('all')) + '</option>' + options.map(o => '<option value="' + sgE(o.v) + '"' + (String(cur) === String(o.v) ? ' selected' : '') + '>' + sgE(o.t) + '</option>').join('') + '</select></label>'; }
const sgUniq = (rows, f) => [...new Set(rows.map(f).filter(v => v !== null && v !== undefined && v !== ''))].sort();
function sgPager(key, n, size) { const pages = Math.max(1, Math.ceil(n / size)); if (SGS.page[key] >= pages) SGS.page[key] = pages - 1; if (pages <= 1) return ''; const p = SGS.page[key]; return '<div class="filters" style="justify-content:flex-end"><span class="muted">' + sgE(sgTx('rowsOf', { from: p * size + 1, to: Math.min((p + 1) * size, n), n })) + '</span><button type="button" data-sg="page" data-k="' + key + '" data-d="-1"' + (p === 0 ? ' disabled' : '') + '>' + sgE(sgTx('prev')) + '</button><button type="button" data-sg="page" data-k="' + key + '" data-d="1"' + (p >= pages - 1 ? ' disabled' : '') + '>' + sgE(sgTx('next')) + '</button></div>'; }
const sgBar = (parts, total) => '<div style="display:flex;height:14px;border-radius:5px;overflow:hidden;background:var(--na-bg);margin:4px 0">' + parts.filter(p => p.n > 0).map(p => '<i style="display:block;height:100%;width:' + (total ? p.n / total * 100 : 0) + '%;background:var(--' + p.tone + ')" title="' + sgE(p.label + ' ' + p.n) + '"></i>').join('') + '</div>';
const sgProg = (label, done, total) => '<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:12px"><span>' + sgE(label) + '</span><span class="muted">' + done + ' / ' + total + ' · ' + (total ? Math.round(done / total * 100) : 0) + '%</span></div>' + sgBar([{ n: done, tone: 'ok', label }], total) + '</div>';

/* ---------- 후불 ---------- */
function sgPayRows() {
  const f = SGS.f.pay, q = (f.q || '').toLowerCase();
  return SGC.pay.rows.filter(r => r.cls !== 'NONE' && r.cls !== 'PRE' && (!f.country || r.country === f.country) && (!f.cls || r.cls === f.cls) && (!f.method || r.method === f.method) && (!f.fill || r.fill === f.fill) && (!q || String(r.hotel).toLowerCase().includes(q) || String(r.code || '').toLowerCase().includes(q)));
}
function sgViewPay() {
  const f = SGS.f.pay; const base = SGC.pay.rows.filter(r => r.cls !== 'NONE' && r.cls !== 'PRE'); const rows = sgPayRows().sort((a, b) => (b.avg || -1) - (a.avg || -1));
  const legend = '<div class="legend">' + ['A1', 'A2', 'EXC', 'TBD'].map(c => '<span><button type="button" class="pill ' + SGCLS_TONE[c] + '" data-sg="flt" data-scope="pay" data-key="cls" data-val="' + c + '" aria-pressed="' + (f.cls === c) + '" style="' + (f.cls === c ? 'outline:2px solid var(--accent)' : '') + '">' + sgE(sgClsText(c)) + ' ' + base.filter(r => r.cls === c).length + '</button></span>').join('') + '</div><p class="muted">' + sgE(sgTx(f.cls ? f.cls + 'd' : 'A1d')) + (f.cls ? '' : ' · ' + sgE(sgTx('A2d'))) + '</p>';
  const filters = '<div class="filters">' + sgSel('pay', 'country', sgTx('country'), sgUniq(base, r => r.country).map(v => ({ v, t: v })), f.country) + sgSel('pay', 'method', sgTx('method'), sgUniq(base, r => r.method).map(v => ({ v, t: v })), f.method) + sgSel('pay', 'fill', sgTx('fill'), ['DONE', 'UNKNOWN', 'PARTIAL', 'EMPTY'].map(v => ({ v, t: sgTx('fill' + v) })), f.fill) +
    '<input id="sgq-pay" data-sgf="pay.q" type="search" value="' + sgE(f.q || '') + '" placeholder="' + sgE(sgTx('search')) + '" aria-label="search"><button type="button" data-sg="reset" data-scope="pay">' + sgE(sgTx('reset')) + '</button><span class="muted">' + sgE(sgTx('payCount', { n: rows.length })) + '</span></div>';
  const size = 40; const page = rows.slice(SGS.page.pay * size, SGS.page.pay * size + size);
  const body = page.map(r => '<tr><td>' + sgE(r.country) + '</td><td>' + sgE(r.code || '—') + '</td><td><b>' + sgE(r.hotel) + '</b></td><td>' + sgE(r.entity || '—') + '</td><td>' + sgE(r.method || '—') + '</td><td>' + sgE(r.ccy || '—') + '</td><td class="r">' + sgE(sgNum(r.avg)) + '</td><td>' + (r.card === 'O' ? T('수용', 'Yes') : r.card === 'X' ? T('미수용', 'No') : r.card === '미확인' ? T('미확인', 'Unknown') : '—') + '</td><td>' + sgE(r.account || '—') + '</td><td>' + sgPill(SGCLS_TONE[r.cls], sgClsText(r.cls)) + '</td><td class="muted">' + sgE((r.note || '').slice(0, 90)) + '</td><td>' + ((r.cls === 'A1' || r.cls === 'A2') ? '<input type="checkbox" data-sg="pick" data-id="' + sgE(r.id) + '"' + (SGS.picks.has(r.id) ? ' checked' : '') + ' aria-label="pick">' : '') + '</td></tr>').join('');
  const head = ['colCountry', 'colCode', 'colHotel', 'colEntity', 'colMethod', 'colCcy', 'colAvgPay', 'colCard', 'colAccount', 'colClass', 'colNote', 'colPick'].map((k, i) => '<th' + (i === 6 ? ' class="r"' : '') + '>' + sgE(sgTx(k)) + '</th>').join('');
  const cand = CALC.testCandidates(base, f.country, 12);
  const candHtml = cand.length ? '<div class="tablewrap"><table style="min-width:420px"><tbody>' + cand.map(r => '<tr><td>' + sgE(r.country) + '</td><td>' + sgE(r.hotel) + '</td><td>' + sgPill(SGCLS_TONE[r.cls], sgClsText(r.cls)) + '</td><td class="r">' + sgE(sgNum(r.avg, r.ccy)) + '</td><td><input type="checkbox" data-sg="pick" data-id="' + sgE(r.id) + '"' + (SGS.picks.has(r.id) ? ' checked' : '') + ' aria-label="pick"></td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">' + sgE(sgTx('payCandEmpty')) + '</p>';
  const picked = SGC.pay.rows.filter(r => SGS.picks.has(r.id));
  const pickHtml = '<h3>' + sgE(sgTx('pickList')) + ' (' + picked.length + ')</h3>' + (picked.length ? '<div class="muted">' + picked.map(r => sgE(r.country + ' · ' + r.hotel)).join('<br>') + '</div><div class="filters" style="margin-top:8px"><button type="button" data-sg="pickcopy">' + sgE(sgTx('pickCopy')) + '</button><button type="button" data-sg="pickcsv">' + sgE(sgTx('pickCsv')) + '</button><button type="button" data-sg="pickclear">' + sgE(sgTx('pickClear')) + '</button></div>' : '<p class="muted">' + sgE(sgTx('pickNone')) + '</p>') + '<p class="muted">' + sgE(sgTx('pickSaved')) + '</p>';
  return '<h2>' + sgE(sgTx('payTitle')) + '</h2>' + legend + filters + '<div class="tablewrap"><table style="min-width:1100px"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' + sgPager('pay', rows.length, size) +
    '<h2>' + sgE(sgTx('payCand')) + '</h2><p class="muted">' + sgE(sgTx('payCandNote')) + '</p><div class="dgrid"><div>' + candHtml + '</div><div class="card">' + pickHtml + '</div></div>';
}

/* ---------- 프리바이 ---------- */
function sgPreRows() { const f = SGS.f.pre, q = (f.q || '').toLowerCase(); return SGC.pre.rows.filter(r => (!f.country || r.country === f.country) && (!f.type || r.type === f.type) && (!f.cls || r.cls === f.cls) && (!f.sig || r.sig.color === f.sig) && (!q || String(r.hotel).toLowerCase().includes(q) || String(r.code || '').toLowerCase().includes(q))); }
function sgPreDetail(r) {
  const cfg = SGC.cfg; const lines = [];
  if (r.cover !== null) lines.push(sgTx('calcCover', { ledger: sgNum(r.ledger, r.ccy), avg: sgNum(r.avg, r.ccy), months: r.cover })); else lines.push(sgTx(r.ledger === null || r.avg === null ? 'calcNoData' : 'calcNoAvg'));
  if (r.daysLeft !== null && r.ledger !== null && r.avg !== null) { lines.push(sgTx('calcDays', { days: r.daysLeft, asOf: r.asOf, yearEnd: cfg.yearEnd })); lines.push(sgTx('calcEst', { use: sgNum(r.avg * r.daysLeft / 30, r.ccy), est: sgNum(r.est, r.ccy) })); lines.push(sgTx('calcCanUse', { r: r.canUse === '가능' ? sgTx('canUseYes') : sgTx('canUseNo') })); }
  const iss = SGC.issues.filter(i => i.sheet === 'pre' && i.row === r.sourceRow);
  const act = { B1: 'actTRANSFER', B2_USE: 'actCONSUME', B2_REFUND: 'actREFUND', B2_TALK: 'actNEGOTIATE', TBD: 'actCONFIRM' }[r.cls];
  return '<tr class="detail"><td colspan="17"><div class="dgrid"><div class="card"><h3>' + sgE(r.hotel) + ' <span class="muted">' + sgE(r.country + ' · ' + (r.type || '') + ' · ' + r.ccy) + '</span></h3>' + sgPill(SGCLS_TONE[r.cls], sgClsText(r.cls)) + ' ' + sgSig(r.sig.color) + (r.ceo ? '<p class="muted">' + sgE(T('대표님 현황판', 'CEO board')) + ': ' + sgSig(r.ceo) + (r.ceoBal !== null ? ' · ' + sgE(T('원장 합계 잔액 ', 'ledger balance ')) + sgE(sgNum(r.ceoBal, r.ccy)) + (r.ledger ? ' (' + sgE(T('양식 대장 잔액과 ', 'vs form ledger ')) + sgPct(Math.abs(r.ceoBal - r.ledger) / Math.abs(r.ledger) * 100, 1) + ' ' + sgE(T('차이', 'apart')) + ')' : '') : '') + '</p>' : '') + (act ? '<p>' + sgE(sgTx(act)) + '</p>' : '') +
    '<h3>' + sgE(sgTx('calcTitle')) + '</h3><ul>' + lines.map(l => '<li>' + sgE(l) + '</li>').join('') + '</ul><p class="muted">' + sgE(sgTx('recon' + r.recon)) + (r.gapPct !== null ? ' · ' + sgPct(r.gapPct, 1) : '') + '</p></div>' +
    '<div class="card">' + (r.note ? '<h3>' + sgE(sgTx('noteLabel')) + '</h3><p>' + sgE(r.note) + '</p>' : '') + (r.transferNote ? '<h3>' + sgE(sgTx('transferNote')) + '</h3><p>' + sgE(r.transferNote) + '</p>' : '') + (r.refundNote ? '<h3>' + sgE(sgTx('refundNote')) + '</h3><p>' + sgE(r.refundNote) + '</p>' : '') + (r.owner ? '<p class="muted">' + sgE(sgTx('ownerLabel')) + ': ' + sgE(r.owner) + '</p>' : '') +
    (iss.length ? '<h3>' + sgE(sgTx('colIssues')) + '</h3><ul>' + iss.map(i => '<li>' + sgPill(i.sev === 'error' ? 'bad' : i.sev === 'warn' ? 'warn' : 'na', sgTx(i.sev === 'error' ? 'sevError' : i.sev === 'warn' ? 'sevWarn' : 'sevInfo')) + ' ' + sgE(sgTx(i.code, i.params)) + '</li>').join('') + '</ul>' : '') + '</div></div></td></tr>';
}
function sgViewPre() {
  const f = SGS.f.pre; const rows = sgPreRows().sort((a, b) => (b.ledger || 0) - (a.ledger || 0));
  const legend = '<div class="legend">' + ['B1', 'B2_USE', 'B2_REFUND', 'B2_TALK', 'TBD'].map(c => '<span><button type="button" class="pill ' + SGCLS_TONE[c] + '" data-sg="flt" data-scope="pre" data-key="cls" data-val="' + c + '" aria-pressed="' + (f.cls === c) + '" style="' + (f.cls === c ? 'outline:2px solid var(--accent)' : '') + '">' + sgE(sgClsText(c)) + ' ' + SGC.pre.rows.filter(r => r.cls === c).length + '</button></span>').join('') + '</div><p class="muted">' + sgE(f.cls ? sgTx(f.cls + 'd') : '') + '</p>';
  const filters = '<div class="filters">' + sgSel('pre', 'country', sgTx('country'), sgUniq(SGC.pre.rows, r => r.country).map(v => ({ v, t: v })), f.country) + sgSel('pre', 'type', sgTx('preType'), sgUniq(SGC.pre.rows, r => r.type).map(v => ({ v, t: v })), f.type) + sgSel('pre', 'sig', sgTx('preSignal'), ['bad', 'warn', 'ok', 'na'].map(v => ({ v, t: sgTx({ ok: 'sigOk', warn: 'sigWarn', bad: 'sigBad', na: 'sigNa' }[v]) })), f.sig) +
    '<input id="sgq-pre" data-sgf="pre.q" type="search" value="' + sgE(f.q || '') + '" placeholder="' + sgE(sgTx('search')) + '" aria-label="search"><button type="button" data-sg="reset" data-scope="pre">' + sgE(sgTx('reset')) + '</button><span class="muted">' + sgE(sgTx('payCount', { n: rows.length })) + '</span></div>';
  const size = 30; const page = rows.slice(SGS.page.pre * size, SGS.page.pre * size + size);
  const body = page.map(r => '<tr class="hrow" data-sg="detail" data-id="' + sgE(r.id) + '"><td>' + sgE(r.country) + '</td><td><b>' + sgE(r.hotel) + '</b></td><td>' + sgE(r.type || '—') + '</td><td>' + sgE(r.ccy) + '</td><td class="r">' + sgE(sgNum(r.ledger)) + '</td><td class="r">' + sgE(sgNum(r.hotelBal)) + '</td><td class="r">' + (r.gap === null ? '—' : sgE(sgNum(r.gap)) + (r.recon === 'MAJOR' ? ' ' + sgPill('bad', sgPct(r.gapPct, 1)) : r.recon === 'MINOR' ? ' ' + sgPill('warn', sgPct(r.gapPct, 1)) : '')) + '</td><td class="r">' + sgE(sgNum(r.avg)) + '</td><td class="r">' + (r.cover === null ? '—' : r.cover) + '</td><td>' + (r.canUse === '가능' ? sgE(sgTx('canUseYes')) : r.canUse === '불가' ? sgE(sgTx('canUseNo')) : '—') + '</td><td class="r">' + sgE(sgNum(r.est)) + '</td><td>' + sgE(sgYN(r.transfer)) + '</td><td>' + sgE(sgYN(r.refund)) + '</td><td>' + sgPill(SGCLS_TONE[r.cls], sgClsText(r.cls)) + '</td><td>' + sgSig(r.sig.color) + '</td><td>' + (r.ceo ? sgSig(r.ceo) : '<span class="muted">—</span>') + '</td><td class="muted">' + sgE(r.asOf || '—') + '</td></tr>' + (SGS.open === r.id ? sgPreDetail(r) : '')).join('');
  const head = ['colEntityPre', 'colHotel', 'colType', 'colCcy', 'colLedger', 'colHotelBal', 'colGap', 'colAvgUse', 'colCover', 'colCanUse', 'colEst', 'colTransfer', 'colRefund', 'colClass', 'colSignal', 'colCeoSignal', 'colAsOf'].map((k, i) => '<th' + ([4, 5, 6, 7, 8, 10].includes(i) ? ' class="r"' : '') + '>' + sgE(sgTx(k)) + '</th>').join('');
  return '<h2>' + sgE(sgTx('preTitle')) + '</h2>' + legend + filters + '<div class="tablewrap"><table style="min-width:1300px"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' + sgPager('pre', rows.length, size) + '<p class="muted">' + sgE(sgTx('perCurrencyNote')) + '</p>';
}

/* ---------- 결재 준비 ---------- */
function sgApText() {
  const pre = SGC.pre, pay = SGC.pay.total, due = pay.n - pay.PRE; const asOf = SGDATA.meta.asOfMax || TODAY_S; const lines = [];
  lines.push(T('[프리바이·SG 지급 처리 안 초안] 기준일 ' + asOf, '[Prebuy and SG payment proposal, draft] as of ' + asOf));
  lines.push(T('■ 프리바이 ' + pre.count + '곳', '■ Prebuy: ' + pre.count + ' hotels'));
  for (const cls of ['B1', 'B2_USE', 'B2_REFUND', 'B2_TALK', 'TBD']) {
    const c = pre.byClass[cls]; if (!c) continue; const ks = Object.keys(c.byCcy).sort(); const amt = ks.map(k => sgNum(c.byCcy[k].ledger, k)).join(', ');
    const est = (cls === 'B2_REFUND' || cls === 'B2_USE') ? ' / ' + sgTx('est1231') + ' ' + ks.filter(k => c.byCcy[k].estKnown).map(k => sgNum(c.byCcy[k].est, k)).join(', ') : '';
    lines.push('- ' + sgClsText(cls) + ': ' + c.n + T('곳', ' hotels') + ' (' + amt + ')' + est + ' → ' + sgTx('act' + CALC.ACTION[cls]));
  }
  lines.push(T('■ 후불 지급 ' + due + '곳: A1 ' + pay.A1 + ', A2 ' + pay.A2 + ', 예외 검토 ' + pay.EXC + ', 확인 필요 ' + pay.TBD, '■ Post-paid: ' + due + ' hotels: A1 ' + pay.A1 + ', A2 ' + pay.A2 + ', exception review ' + pay.EXC + ', to confirm ' + pay.TBD));
  lines.push(T('※ 금액은 통화 그대로입니다(환산 없음). 이관·소진·반환·협의는 대표 결재(C02)에서 정합니다.', '※ Amounts are in their own currencies (no conversion). Transfer, use-up, refund and talks are decided at the CEO approval (C02).'));
  return lines.join('\n');
}
function sgViewAp() {
  const pp = SGC.prog.payments, pr = SGC.prog.prebuy, pre = SGC.pre; const err = SGC.issues.filter(i => i.sev === 'error').length; const tbd = (pre.byClass.TBD || { n: 0 }).n;
  const chk = (ok, label, detail) => '<div style="display:flex;gap:8px;padding:3px 0"><b style="color:var(--' + (ok ? 'ok' : 'bad') + ')">' + (ok ? '✓' : '✗') + '</b><span>' + sgE(label) + '</span><span class="muted">' + sgE(detail) + '</span></div>';
  const ready = '<div class="card">' + chk(pr.finance === pr.n, sgTx('apReadyFinance'), pr.finance + ' / ' + pr.n) + chk(pr.scm === pr.n, sgTx('apReadyScm'), pr.scm + ' / ' + pr.n) + chk(pp.done === pp.due, sgTx('apReadyPay'), pp.done + ' / ' + pp.due) + chk(err === 0, sgTx('apReadyIssues'), String(err)) + chk(tbd === 0, sgTx('apReadyClass'), String(tbd)) + '</div>';
  const rows = SGC.packet.lines.map(l => '<tr><td>' + sgPill(SGCLS_TONE[l.cls], sgClsText(l.cls)) + '</td><td>' + sgE(l.ccy) + '</td><td class="r">' + l.n + '</td><td class="r">' + sgE(sgNum(l.ledger)) + '</td><td class="r">' + (l.estKnown ? sgE(sgNum(l.est)) : '—') + '</td><td class="muted">' + sgE(sgTx('act' + CALC.ACTION[l.cls])) + '</td></tr>').join('');
  const packet = '<div class="tablewrap"><table style="min-width:640px"><thead><tr><th>' + sgE(sgTx('cls')) + '</th><th>' + sgE(sgTx('colCcy')) + '</th><th class="r">' + sgE(sgTx('count')) + '</th><th class="r">' + sgE(sgTx('ledger')) + '</th><th class="r">' + sgE(sgTx('est1231')) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="muted">' + sgE(sgTx('perCurrencyNote')) + '</p>';
  const need = [];
  for (const r of pre.rows) { const why = []; if (r.cls === 'B2_TALK') why.push(sgTx('apTalkWhy')); if (r.cls === 'TBD') { const m = []; if (r.ledger === null) m.push(sgTx('fldLedger')); if (!r.asOf) m.push(sgTx('fldAsOf')); if (r.avg === null) m.push(sgTx('fldAvg')); if (r.hotelBal === null) m.push(sgTx('fldHotelBal')); if (!r.transfer || r.transfer === '미확인') m.push(sgTx('fldTransfer')); if (m.length) why.push(sgTx('apMissing', { f: m.join(', ') })); } if (r.recon === 'MAJOR') why.push(sgTx('apGapWhy', { pct: CALC.round1(r.gapPct) })); if (r.sig.critical) why.push(sgTx('apCritWhy')); if (why.length) need.push({ r, why }); }
  const needHtml = need.length ? '<div class="tablewrap"><table style="min-width:640px"><tbody>' + need.map(x => '<tr class="hrow" data-sg="openpre" data-id="' + sgE(x.r.id) + '"><td>' + sgE(x.r.country) + '</td><td><b>' + sgE(x.r.hotel) + '</b></td><td>' + sgPill(SGCLS_TONE[x.r.cls], sgClsText(x.r.cls)) + '</td><td class="r">' + sgE(sgNum(x.r.ledger, x.r.ccy)) + '</td><td class="muted">' + x.why.map(sgE).join('<br>') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">' + sgE(sgTx('apDecideNone')) + '</p>';
  return '<h2>' + sgE(sgTx('apTitle')) + '</h2><p class="muted">' + sgE(sgTx('apNote')) + '</p><div class="dgrid"><div><h3>' + sgE(sgTx('apReady')) + '</h3>' + ready + '</div><div><h3>' + sgE(sgTx('apText')) + '</h3><pre id="sgaptext" style="white-space:pre-wrap;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:inherit;font-size:13px">' + sgE(sgApText()) + '</pre><button type="button" class="primary" data-sg="apcopy">' + sgE(sgTx('apCopy')) + '</button></div></div>' +
    '<h2>' + sgE(sgTx('apPacket')) + '</h2>' + packet + '<h2>' + sgE(sgTx('apDecide')) + ' (' + need.length + ')</h2>' + needHtml;
}

/* ---------- 수집·점검 ---------- */
function sgMissingRows() {
  const out = [];
  for (const r of SGC.pay.rows) { if (r.cls === 'NONE' || r.cls === 'PRE' || r.fill === 'DONE') continue; out.push({ sheet: 'pay', row: r.sourceRow, country: r.country, hotel: r.hotel, what: r.fill === 'EMPTY' ? sgTx('colCard') : r.fill === 'PARTIAL' ? sgTx('colAccount') : sgTx('unknown') }); }
  for (const h of SGC.data.prebuy) { if (!h.hotel) continue; const m = []; if (h.ledger === null) m.push(sgTx('fldLedger')); if (!h.asOf) m.push(sgTx('fldAsOf')); if (h.avg === null) m.push(sgTx('fldAvg')); const s = CALC.scmFill(h); s.missing.forEach(k => m.push(sgTx({ hotelBal: 'fldHotelBal', transfer: 'fldTransfer', refund: 'fldRefund' }[k]))); s.unknown.forEach(k => m.push(sgTx(k === 'transfer' ? 'fldTransfer' : 'fldRefund') + ' (' + sgTx('unknown') + ')')); if (m.length) out.push({ sheet: 'pre', row: h.sourceRow, country: h.country, hotel: h.hotel, what: m.join(', ') }); }
  return out;
}
function sgViewCol() {
  const pp = SGC.prog.payments, pr = SGC.prog.prebuy;
  const payBars = Object.keys(pp.byCountry).sort().map(c => { const x = pp.byCountry[c]; return sgProg(c, x.done + x.unknown, x.due); }).join('');
  const preBars = Object.keys(pr.byCountry).sort().map(c => { const x = pr.byCountry[c]; return sgProg(c + ' · ' + sgTx('colPreFin'), x.finance, x.n) + sgProg(c + ' · ' + sgTx('colPreScm'), x.scmAnswered, x.n); }).join('');
  const miss = sgMissingRows(); const size = 25; const mpage = miss.slice(SGS.page.miss * size, SGS.page.miss * size + size);
  const missHtml = miss.length ? '<div class="tablewrap"><table style="min-width:640px"><thead><tr><th>' + sgE(sgTx('colSheet')) + '</th><th>' + sgE(sgTx('colCountry')) + '</th><th class="r">' + sgE(sgTx('colRow')) + '</th><th>' + sgE(sgTx('colHotel')) + '</th><th>' + sgE(sgTx('colMissing')) + '</th></tr></thead><tbody>' + mpage.map(m => '<tr><td>' + sgE(m.sheet === 'pay' ? sgTx('sheetPay') : sgTx('sheetPre')) + '</td><td>' + sgE(m.country) + '</td><td class="r">' + m.row + '</td><td>' + sgE(m.hotel) + '</td><td>' + sgE(m.what) + '</td></tr>').join('') + '</tbody></table></div>' + sgPager('miss', miss.length, size) : '<p class="muted">' + sgE(sgTx('colMissingNone')) + '</p>';
  const issues = SGC.issues.filter(i => !SGS.sev || i.sev === SGS.sev); const ipage = issues.slice(SGS.page.iss * size, SGS.page.iss * size + size);
  const sevBtn = (v, label) => '<button type="button" class="pill ' + (v === 'error' ? 'bad' : v === 'warn' ? 'warn' : 'na') + '" data-sg="sev" data-v="' + v + '" style="' + (SGS.sev === v ? 'outline:2px solid var(--accent)' : '') + '">' + sgE(label) + ' ' + SGC.issues.filter(i => i.sev === v).length + '</button> ';
  const issHtml = issues.length ? '<div class="tablewrap"><table style="min-width:640px"><thead><tr><th>' + sgE(sgTx('colSeverity')) + '</th><th>' + sgE(sgTx('colSheet')) + '</th><th class="r">' + sgE(sgTx('colRow')) + '</th><th>' + sgE(sgTx('colHotel')) + '</th><th>' + sgE(sgTx('colWhat')) + '</th></tr></thead><tbody>' + ipage.map(i => '<tr><td>' + sgPill(i.sev === 'error' ? 'bad' : i.sev === 'warn' ? 'warn' : 'na', sgTx(i.sev === 'error' ? 'sevError' : i.sev === 'warn' ? 'sevWarn' : 'sevInfo')) + '</td><td>' + sgE(i.sheet === 'pay' ? sgTx('sheetPay') : sgTx('sheetPre')) + '</td><td class="r">' + (i.row === null ? '—' : i.row) + '</td><td>' + sgE(i.hotel) + '</td><td>' + sgE(sgTx(i.code, i.params)) + '</td></tr>').join('') + '</tbody></table></div>' + sgPager('iss', issues.length, size) : '<p class="muted">' + sgE(sgTx('boardIssuesNone')) + '</p>';
  const cards = [['pay', '① ' + T('후불 지급 목록', 'Post-paid payment list'), SGIMPORT.PAY_COLS], ['pre', '② ' + T('프리바이 목록', 'Prebuy list'), SGIMPORT.PRE_COLS]].map(([k, title, cols]) => '<div class="card"><h3>' + sgE(title) + '</h3><p class="muted">' + sgE(T('엑셀 양식의 시트를 CSV(UTF-8)로 저장해 올립니다. 제목 줄이 있어도, 열 순서가 달라도 머리글로 찾아 읽습니다. 올린 나라의 줄만 바뀝니다.', 'Save the sheet of the Excel form as CSV (UTF-8) and upload it. Title rows and a different column order are fine; columns are found by header. Only the countries in the file are replaced.')) + '</p><input type="file" accept=".csv,text/csv" data-sg="file" data-k="' + k + '" aria-label="' + k + '"></div>').join('');
  return '<h2>' + sgE(sgTx('colTitle')) + '</h2><div class="dgrid"><div class="card"><h3>' + sgE(sgTx('colProgress')) + '</h3>' + sgProg(sgTx('colPay'), pp.done + pp.unknown, pp.due) + payBars + '</div><div class="card"><h3>&nbsp;</h3>' + preBars + '</div></div>' +
    '<h2>' + sgE(sgTx('colMissing')) + '</h2>' + missHtml + '<h2>' + sgE(sgTx('colIssues')) + '</h2><p>' + sevBtn('error', sgTx('sevError')) + sevBtn('warn', sgTx('sevWarn')) + sevBtn('info', sgTx('sevInfo')) + '</p>' + issHtml +
    '<h2>' + sgE(T('자료 불러오기', 'Load data')) + '</h2><div class="datacards">' + cards + '</div><div class="filters" style="margin-top:10px"><button type="button" data-sg="seed">' + sgE(T('처음 자료로 되돌리기', 'Restore original data')) + '</button></div><p class="muted" id="sgmsg">' + sgE(SGS.msg) + '</p>' +
    '<h2>' + sgE(sgTx('rulesTitle')) + '</h2><ul>' + ['fPay', 'fCls', 'fS1', 'fCan', 'fEst', 'fGap', 'sigRule1', 'sigRule2', 'dataH2', 'dataH3'].map(k => '<li>' + sgE(sgTx(k)) + '</li>').join('') + '</ul>';
}

/* ---------- 틀 ---------- */
function renderSG() {
  const root = document.getElementById('v-sg'); if (!root) return;
  const tab = document.querySelector('nav.tabs button[data-v="sg"]'); if (tab) tab.textContent = T('SG 전환', 'SG transition', 'SG移行');
  sgCompute();
  const body = SGS.view === 'pre' ? sgViewPre() : SGS.view === 'ap' ? sgViewAp() : SGS.view === 'col' ? sgViewCol() : sgViewPay();
  root.innerHTML = sgHeadNote() + sgTiles() + sgSubnav() + body;
  if (SGS.focus) { const el = document.getElementById(SGS.focus.id); if (el) { el.focus(); try { el.setSelectionRange(SGS.focus.pos, SGS.focus.pos); } catch (e) { /* 글 칸이 아님 */ } } SGS.focus = null; }
}
function sgSavePicks() { try { localStorage.setItem(SGPICK_KEY, JSON.stringify([...SGS.picks])); } catch (e) { /* 저장소를 못 쓰는 환경 */ } }
function sgLoadFile(kind, file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const text = String(rd.result).replace(/^﻿/, ''); const res = SGIMPORT.parseRows(parseCSV(text), kind);
      if (res.missing.length) throw new Error(T('필요한 열을 찾지 못했습니다: ', 'Missing columns: ') + res.missing.join(', '));
      const countries = new Set(res.rows.map(r => r.country)); const key = kind === 'pay' ? 'payments' : 'prebuy';
      SGDATA[key] = SGDATA[key].filter(r => !countries.has(r.country)).concat(res.rows);
      const dates = SGDATA.prebuy.map(r => r.asOf).filter(Boolean).sort(); SGDATA.meta.asOfMin = dates[0] || null; SGDATA.meta.asOfMax = dates[dates.length - 1] || null; SGDATA.meta.parseIssues = (SGDATA.meta.parseIssues || []).concat(res.issues);
      SGDATA.meta.today = TODAY_S;
      SGS.msg = (kind === 'pay' ? '① ' : '② ') + res.rows.length + T('행을 읽었습니다 (나라 ', ' rows loaded (countries ') + [...countries].join(',') + T(' 교체)', ' replaced)') + (res.issues.length ? ' · ' + T('읽지 못한 칸 ', 'unreadable cells ') + res.issues.length : '');
    } catch (err) { SGS.msg = T('읽지 못했습니다 — ', 'Could not read — ') + err.message; }
    renderSG();
  };
  rd.readAsText(file, 'utf-8');
}
(function sgWire() {
  const root = document.getElementById('v-sg'); if (!root) return;
  root.addEventListener('click', e => {
    const a = e.target.closest('[data-sg]'); if (!a || a.dataset.sg === 'file') return; const act = a.dataset.sg;
    if (act === 'view') { SGS.view = a.dataset.v; return renderSG(); }
    if (act === 'flt') { const f = SGS.f[a.dataset.scope]; f[a.dataset.key] = f[a.dataset.key] === a.dataset.val ? '' : a.dataset.val; SGS.page[a.dataset.scope] = 0; return renderSG(); }
    if (act === 'reset') { SGS.f[a.dataset.scope] = {}; SGS.page[a.dataset.scope] = 0; return renderSG(); }
    if (act === 'page') { SGS.page[a.dataset.k] += +a.dataset.d; return renderSG(); }
    if (act === 'detail') { SGS.open = SGS.open === a.dataset.id ? null : a.dataset.id; return renderSG(); }
    if (act === 'openpre') { SGS.open = a.dataset.id; SGS.f.pre = {}; SGS.view = 'pre'; return renderSG(); }
    if (act === 'pick') { const id = a.dataset.id; if (SGS.picks.has(id)) SGS.picks.delete(id); else SGS.picks.add(id); sgSavePicks(); return renderSG(); }
    if (act === 'pickclear') { SGS.picks.clear(); sgSavePicks(); return renderSG(); }
    if (act === 'pickcopy') { return copyText(SGC.pay.rows.filter(r => SGS.picks.has(r.id)).map(r => [r.country, r.code || '', r.hotel, r.ccy, r.avg === null ? '' : r.avg, r.cls].join('\t')).join('\n')); }
    if (act === 'pickcsv') { const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; const csv = '﻿' + ['country,vendor_code,hotel,currency,avg_monthly_payment,class'].concat(SGC.pay.rows.filter(r => SGS.picks.has(r.id)).map(r => [r.country, r.code, r.hotel, r.ccy, r.avg, r.cls].map(q).join(','))).join('\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const l = document.createElement('a'); l.href = url; l.download = 'sg_test_candidates.csv'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
    if (act === 'apcopy') return copyText(document.getElementById('sgaptext').textContent);
    if (act === 'sev') { SGS.sev = SGS.sev === a.dataset.v ? '' : a.dataset.v; SGS.page.iss = 0; return renderSG(); }
    if (act === 'seed') { SGDATA = JSON.parse(JSON.stringify(SGDATA0)); SGS.msg = T('처음 자료로 되돌렸습니다', 'Restored original data'); return renderSG(); }
  });
  root.addEventListener('input', e => { const el = e.target; const key = el.dataset && el.dataset.sgf; if (!key || el.tagName === 'SELECT') return; const [scope, k] = key.split('.'); SGS.f[scope][k] = el.value; SGS.page[scope] = 0; SGS.focus = { id: el.id, pos: el.selectionStart }; renderSG(); });
  root.addEventListener('change', e => { const el = e.target; if (el.dataset && el.dataset.sg === 'file') { const f = el.files[0]; if (f) sgLoadFile(el.dataset.k, f); return; } const key = el.dataset && el.dataset.sgf; if (!key || el.tagName !== 'SELECT') return; const [scope, k] = key.split('.'); SGS.f[scope][k] = el.value; SGS.page[scope] = 0; renderSG(); });
})();
