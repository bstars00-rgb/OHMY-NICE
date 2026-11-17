/* 화면. 자료는 <script id="data">에서 읽고, 계산은 calc.js에 맡긴다. 네트워크를 쓰지 않는다. */
(function () {
  'use strict';
  const DATA = JSON.parse(document.getElementById('data').textContent);
  const META = DATA.meta, CFG = CALC.cfgOf(DATA), TODAY = META.today;
  const PAY = CALC.paymentStats(DATA.payments);
  PAY.rows.forEach((r, i) => { r.id = 'p' + i; });
  const PRE = CALC.prebuyStats(DATA.prebuy, CFG);
  PRE.rows.forEach((r, i) => { r.id = 'h' + i; });
  const PROG = CALC.progress(DATA, TODAY);
  const ISSUES = CALC.validate(DATA);
  const PACKET = CALC.approvalPacket(DATA);
  const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
  const S = { tab: 'board', lang: safe(() => localStorage.getItem('omh_lang'), null) || 'ko', f: { pay: {}, pre: {}, col: { sev: '' } }, tables: {}, open: null, picks: new Set(), focus: null };
  const PICK_KEY = 'omh_sg_picks:' + (META.synthetic ? 'sample' : 'real');
  safe(() => { (JSON.parse(localStorage.getItem(PICK_KEY) || '[]')).forEach(x => S.picks.add(x)); });
  const savePicks = () => safe(() => localStorage.setItem(PICK_KEY, JSON.stringify([...S.picks])));

  /* ---------- 글·숫자 ---------- */
  const t = (k, p) => { let s = (I18N[S.lang] && I18N[S.lang][k]) || I18N.ko[k] || k; if (p) for (const x of Object.keys(p)) s = s.split('{' + x + '}').join(p[x]); return s; };
  const L = (ko, en) => S.lang === 'ko' ? ko : en;
  const esc = v => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const blank = CALC.blank;
  const loc = () => S.lang === 'ko' ? 'ko-KR' : 'en-US';
  const fmt = (n, ccy) => { if (blank(n)) return '—'; const d = CALC.CCY_DECIMALS[ccy] === undefined ? 0 : CALC.CCY_DECIMALS[ccy]; return new Intl.NumberFormat(loc(), { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n); };
  const money = (n, ccy) => blank(n) ? '—' : fmt(n, ccy) + ' <span class="muted small">' + esc(ccy) + '</span>';
  const pct = (n, d) => blank(n) ? '—' : (Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString(loc()) + '%';
  const chip = (cls, text) => '<span class="chip ' + esc(cls) + '">' + esc(text) + '</span>';
  const sigText = c => t({ ok: 'sigOk', warn: 'sigWarn', bad: 'sigBad', na: 'sigNa' }[c]);
  const sigDot = c => '<span class="dot ' + c + '"></span>' + esc(sigText(c));
  const clsLabel = c => t(c);
  const ynText = v => v === 'O' ? t('yes') : v === 'X' ? t('no') : v === '미확인' ? t('unknown') : '—';
  const issueText = i => t(i.code, i.params);
  const ccyList = obj => Object.keys(obj).sort().map(c => '<div class="kv"><span>' + esc(c) + '</span><span class="num">' + fmt(obj[c], c) + '</span></div>').join('') || '<span class="muted">—</span>';
  const dLeft = n => n === null || n === undefined ? '' : n > 0 ? t('dLeft', { n }) : n === 0 ? t('dToday') : t('dPast', { n: -n });

  /* ---------- 표 ---------- */
  function tbl(id, cols, rows, opt) {
    opt = opt || {}; const st = S.tables[id] || (S.tables[id] = { key: opt.sort || null, dir: opt.dir || 'asc', page: 0, size: opt.size || 50 });
    let list = rows.slice(); const col = cols.find(c => c.k === st.key);
    if (col && col.s) { const f = col.s; list.sort((a, b) => { const x = f(a), y = f(b); if (blank(x) && blank(y)) return 0; if (blank(x)) return 1; if (blank(y)) return -1; const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko'); return st.dir === 'asc' ? c : -c; }); }
    const pages = Math.max(1, Math.ceil(list.length / st.size)); if (st.page >= pages) st.page = pages - 1;
    const from = st.page * st.size, view = list.slice(from, from + st.size);
    const head = cols.map(c => '<th class="' + (c.cls || '') + '" data-act="sort" data-tbl="' + id + '" data-key="' + c.k + '"' + (st.key === c.k ? ' data-dir="' + st.dir + '"' : '') + '>' + esc(c.h()) + '</th>').join('');
    const body = view.map(r => '<tr class="' + (opt.rowClass ? opt.rowClass(r) : '') + '"' + (opt.click ? ' data-act="' + opt.click + '" data-id="' + esc(r.id) + '"' : '') + '>' + cols.map(c => '<td class="' + (c.cls || '') + '">' + c.v(r) + '</td>').join('') + '</tr>').join('');
    const pager = pages > 1 ? '<div class="pager"><span class="muted small">' + esc(t('rowsOf', { from: from + 1, to: Math.min(from + st.size, list.length), n: list.length })) + '</span><button class="sm" data-act="page" data-tbl="' + id + '" data-d="-1"' + (st.page === 0 ? ' disabled' : '') + '>' + esc(t('prev')) + '</button><button class="sm" data-act="page" data-tbl="' + id + '" data-d="1"' + (st.page >= pages - 1 ? ' disabled' : '') + '>' + esc(t('next')) + '</button></div>' : '';
    return '<div class="tw"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' + pager;
  }
  const sel = (scope, key, label, options, cur) => '<label>' + esc(label) + '<select data-f="' + scope + '.' + key + '"><option value="">' + esc(t('all')) + '</option>' + options.map(o => '<option value="' + esc(o.v) + '"' + (String(cur) === String(o.v) ? ' selected' : '') + '>' + esc(o.t) + '</option>').join('') + '</select></label>';
  const uniq = (rows, f) => [...new Set(rows.map(f).filter(v => !blank(v)))].sort();
  const bar = (parts, total) => '<div class="bar">' + parts.filter(p => p.n > 0).map(p => '<i class="' + p.cls + '" style="width:' + (total ? p.n / total * 100 : 0) + '%" title="' + esc(p.label + ' ' + p.n) + '"></i>').join('') + '</div>';
  const prog = (label, done, total) => '<div class="prog"><div class="l"><span>' + esc(label) + '</span><span class="num">' + done + ' / ' + total + ' · ' + (total ? Math.round(done / total * 100) : 0) + '%</span></div><div class="bar"><i class="ok" style="width:' + (total ? done / total * 100 : 0) + '%"></i></div></div>';

  /* ---------- 머리말 ---------- */
  function banner() {
    const dl = PROG.deadlines; const d = (k, key) => '<span class="chip ' + (dl[k].daysLeft !== null && dl[k].daysLeft < 0 ? 'bad' : dl[k].daysLeft !== null && dl[k].daysLeft <= 1 ? 'warn' : '') + '">' + esc(t(key)) + ' ' + esc(dl[k].date.slice(5)) + ' · ' + esc(dLeft(dl[k].daysLeft)) + '</span>';
    return '<div class="banner ' + (META.synthetic ? 'syn' : 'int') + '"><b>' + esc(META.synthetic ? t('synthetic') : t('internal')) + '</b> · ' + esc(META.synthetic ? t('syntheticNote') : t('internalNote')) + '</div>' +
      '<div class="chips">' + d('finance', 'deadlineFinance') + d('scm', 'deadlineScm') + d('approval', 'deadlineApproval') + '<span class="chip">' + esc(t('asOf')) + ' ' + esc(META.asOfMin === META.asOfMax ? META.asOfMax || '—' : (META.asOfMin || '—') + ' ~ ' + (META.asOfMax || '—')) + '</span><span class="chip">' + esc(t('built')) + ' ' + esc((META.builtAt || '').replace('T', ' ')) + '</span></div>';
  }

  /* ================= 보드 ================= */
  function viewBoard() {
    const tot = PAY.total; const due = tot.n - tot.PRE;
    const countries = Object.keys(PAY.byCountry).sort();
    const classBar = bar(['A1', 'A2', 'EXC', 'TBD'].map(c => ({ cls: c, n: tot[c], label: clsLabel(c) })), due);
    const legend = '<div class="legend">' + ['A1', 'A2', 'EXC', 'TBD'].map(c => '<span><b class="' + c + '" style="background:var(--' + (c === 'EXC' ? 'exc' : c === 'TBD' ? 'tbd' : c.toLowerCase()) + ')"></b>' + esc(clsLabel(c)) + ' ' + tot[c] + '</span>').join('') + '</div>';
    const payCard = '<div class="card"><div class="k">' + esc(t('boardPayTitle')) + '</div><div class="v">' + due.toLocaleString(loc()) + '</div><div class="small muted">' + esc(t('boardPayNote')) + '</div>' + countries.map(c => '<div class="kv"><span>' + esc(c) + '</span><span class="num">' + (PAY.byCountry[c].n - PAY.byCountry[c].PRE) + '</span></div>').join('') + '</div>';
    const clsCard = '<div class="card"><div class="k">' + esc(t('boardClassTitle')) + '</div>' + classBar + legend + '<div class="small muted" style="margin-top:6px">' + esc(t('payCandNote')) + '</div><p><button class="sm" data-act="goto" data-tab="pay">' + esc(t('openPay')) + '</button></p></div>';
    const preCard = '<div class="card"><div class="k">' + esc(t('boardPreTitle')) + '</div><div class="v">' + PRE.count + ' <span class="small muted">' + esc(t('hotels')) + '</span></div><div class="small muted">' + esc(t('boardPreNote')) + '</div>' + Object.keys(PRE.byCcy).sort().map(c => '<div class="kv"><span>' + esc(c) + '</span><span class="num">' + fmt(PRE.byCcy[c].ledger, c) + '</span></div>').join('') + '</div>';
    const pp = PROG.payments, pr = PROG.prebuy;
    const colCard = '<div class="card"><div class="k">' + esc(t('boardCollectTitle')) + '</div>' + prog(t('colPay'), pp.done + pp.unknown, pp.due) + prog(t('colPreFin'), pr.finance, pr.n) + prog(t('colPreScm'), pr.scmAnswered, pr.n) + '<p><button class="sm" data-act="goto" data-tab="collect">' + esc(t('openCollect')) + '</button></p></div>';
    // 프리바이 처리 현황(통화별)
    const lines = PACKET.lines; const clsRows = lines.map(l => '<tr><td>' + chip(l.cls, clsLabel(l.cls)) + '</td><td>' + esc(l.ccy) + '</td><td class="num">' + l.n + '</td><td class="num">' + fmt(l.ledger, l.ccy) + '</td><td class="num">' + fmt(l.hotel, l.ccy) + '</td><td class="num">' + (l.estKnown ? fmt(l.est, l.ccy) : '—') + '</td></tr>').join('');
    const preTable = '<div class="tw"><table><thead><tr><th>' + esc(t('cls')) + '</th><th>' + esc(t('colCcy')) + '</th><th class="num">' + esc(t('count')) + '</th><th class="num">' + esc(t('ledger')) + '</th><th class="num">' + esc(t('hotelBal')) + '</th><th class="num">' + esc(t('est1231')) + '</th></tr></thead><tbody>' + clsRows + '</tbody></table></div><div class="small muted">' + esc(t('perCurrencyNote')) + '</div>';
    // 나라별 후불 분류
    const cRows = countries.map(c => { const x = PAY.byCountry[c]; const n = x.n - x.PRE; return '<div class="prog"><div class="l"><span><b>' + esc(c) + '</b></span><span class="num">' + n + '</span></div>' + bar(['A1', 'A2', 'EXC', 'TBD'].map(k => ({ cls: k, n: x[k], label: clsLabel(k) })), n) + '</div>'; }).join('');
    // 신호 빨강
    const watch = PRE.rows.filter(r => r.sig.color === 'bad').sort((a, b) => (b.ledger || 0) - (a.ledger || 0)).slice(0, 8);
    const watchHtml = watch.length ? '<div class="tw"><table><tbody>' + watch.map(r => '<tr class="click" data-act="openPre" data-id="' + r.id + '"><td>' + esc(r.country) + '</td><td>' + esc(r.hotel) + '</td><td class="num">' + money(r.ledger, r.ccy) + '</td><td class="num">' + (r.cover === null ? '—' : r.cover + L('개월', ' mo')) + '</td><td>' + chip(r.cls, clsLabel(r.cls)) + '</td></tr>').join('') + '</tbody></table></div>' : '<span class="muted">—</span>';
    const sev = { error: 0, warn: 0, info: 0 }; ISSUES.forEach(i => sev[i.sev]++);
    const issueHtml = ISSUES.length ? '<div class="chips">' + chip('bad', t('sevError') + ' ' + sev.error) + chip('warn', t('sevWarn') + ' ' + sev.warn) + chip('', t('sevInfo') + ' ' + sev.info) + '</div>' : '<span class="muted">' + esc(t('boardIssuesNone')) + '</span>';
    return banner() + '<div class="grid g4">' + payCard + clsCard + preCard + colCard + '</div>' +
      '<h2>' + esc(t('boardPreByClass')) + '</h2>' + preTable +
      '<div class="grid g2"><div><h2>' + esc(t('boardClassByCountry')) + '</h2><div class="card">' + cRows + '</div></div><div><h2>' + esc(t('boardWatch')) + '</h2><div class="small muted">' + esc(t('boardWatchNote')) + '</div>' + watchHtml + '<h2>' + esc(t('boardIssues')) + '</h2>' + issueHtml + '<p><button class="sm" data-act="goto" data-tab="collect">' + esc(t('openCollect')) + '</button></p></div></div>';
  }

  /* ================= 후불 지급 ================= */
  function payFiltered() {
    const f = S.f.pay; const q = (f.q || '').toLowerCase();
    return PAY.rows.filter(r => r.cls !== 'NONE' && r.cls !== 'PRE' && (!f.country || r.country === f.country) && (!f.cls || r.cls === f.cls) && (!f.method || r.method === f.method) && (!f.entity || r.entity === f.entity) && (!f.fill || r.fill === f.fill) &&
      (!q || String(r.hotel).toLowerCase().includes(q) || String(r.code || '').toLowerCase().includes(q)));
  }
  function viewPay() {
    const f = S.f.pay; const base = PAY.rows.filter(r => r.cls !== 'NONE' && r.cls !== 'PRE'); const rows = payFiltered();
    const chips = '<div class="chips">' + ['A1', 'A2', 'EXC', 'TBD'].map(c => '<button class="chip ' + c + '" data-act="flt" data-scope="pay" data-key="cls" data-val="' + c + '" aria-pressed="' + (f.cls === c) + '">' + esc(clsLabel(c)) + ' ' + base.filter(r => r.cls === c).length + '</button>').join('') + '</div><div class="small muted">' + esc(t(f.cls ? f.cls + 'd' : 'A1d')) + (f.cls ? '' : ' · ' + esc(t('A2d'))) + '</div>';
    const tools = '<div class="tools">' + sel('pay', 'country', t('country'), uniq(base, r => r.country).map(v => ({ v, t: v })), f.country) + sel('pay', 'method', t('method'), uniq(base, r => r.method).map(v => ({ v, t: v })), f.method) + sel('pay', 'entity', t('entity'), uniq(base, r => r.entity).map(v => ({ v, t: v })), f.entity) +
      sel('pay', 'fill', t('fill'), ['DONE', 'UNKNOWN', 'PARTIAL', 'EMPTY'].map(v => ({ v, t: t('fill' + v) })), f.fill) + '<label>' + esc(t('search')) + '<input id="q-pay" data-f="pay.q" value="' + esc(f.q || '') + '" autocomplete="off"></label><button class="sm" data-act="reset" data-scope="pay">' + esc(t('reset')) + '</button><span class="muted small">' + esc(t('payCount', { n: rows.length })) + ' · ' + esc(t('sortHint')) + '</span></div>';
    const cols = [
      { k: 'country', h: () => t('colCountry'), v: r => esc(r.country), s: r => r.country }, { k: 'code', h: () => t('colCode'), v: r => esc(r.code || '—'), s: r => r.code },
      { k: 'hotel', h: () => t('colHotel'), v: r => esc(r.hotel), s: r => r.hotel }, { k: 'entity', h: () => t('colEntity'), v: r => esc(r.entity || '—'), s: r => r.entity }, { k: 'method', h: () => t('colMethod'), v: r => esc(r.method || '—'), s: r => r.method },
      { k: 'ccy', h: () => t('colCcy'), v: r => esc(r.ccy || '—'), s: r => r.ccy }, { k: 'avg', h: () => t('colAvgPay'), cls: 'num', v: r => fmt(r.avg, r.ccy), s: r => r.avg },
      { k: 'card', h: () => t('colCard'), v: r => r.card === 'O' ? t('yes') : r.card === 'X' ? t('no') : r.card === '미확인' ? t('unknown') : '<span class="muted">—</span>', s: r => r.card },
      { k: 'account', h: () => t('colAccount'), v: r => esc(r.account || '—'), s: r => r.account }, { k: 'cls', h: () => t('colClass'), v: r => chip(r.cls, clsLabel(r.cls)), s: r => r.cls },
      { k: 'note', h: () => t('colNote'), cls: 'note', v: r => esc((r.note || '').slice(0, 110)) },
      { k: 'pick', h: () => t('colPick'), v: r => (r.cls === 'A1' || r.cls === 'A2') ? '<input type="checkbox" data-act="pick" data-id="' + r.id + '"' + (S.picks.has(r.id) ? ' checked' : '') + ' aria-label="pick">' : '' },
    ];
    // 후보
    const cand = CALC.testCandidates(base, f.country, 12);
    const candHtml = cand.length ? '<div class="tw"><table><tbody>' + cand.map(r => '<tr><td>' + esc(r.country) + '</td><td>' + esc(r.hotel) + '</td><td>' + chip(r.cls, clsLabel(r.cls)) + '</td><td class="num">' + money(r.avg, r.ccy) + '</td><td><input type="checkbox" data-act="pick" data-id="' + r.id + '"' + (S.picks.has(r.id) ? ' checked' : '') + ' aria-label="pick"></td></tr>').join('') + '</tbody></table></div>' : '<div class="muted">' + esc(t('payCandEmpty')) + '</div>';
    const picked = PAY.rows.filter(r => S.picks.has(r.id));
    const pickHtml = '<h3 style="margin-top:12px">' + esc(t('pickList')) + ' (' + picked.length + ')</h3>' + (picked.length ? '<div class="small">' + picked.map(r => esc(r.country + ' · ' + r.hotel)).join('<br>') + '</div><div class="tools"><button class="sm" data-act="pickcopy">' + esc(t('pickCopy')) + '</button><button class="sm" data-act="pickcsv">' + esc(t('pickCsv')) + '</button><button class="sm" data-act="pickclear">' + esc(t('pickClear')) + '</button></div>' : '<div class="muted small">' + esc(t('pickNone')) + '</div>') + '<div class="muted small">' + esc(t('pickSaved')) + '</div>';
    return '<h2>' + esc(t('payTitle')) + '</h2>' + chips + tools + tbl('pay', cols, rows, { sort: 'avg', dir: 'desc' }) +
      '<h2>' + esc(t('payCand')) + '</h2><div class="small muted">' + esc(t('payCandNote')) + '</div><div class="grid g2"><div>' + candHtml + '</div><div class="card">' + pickHtml + '</div></div>';
  }

  /* ================= 프리바이 ================= */
  function preFiltered() {
    const f = S.f.pre; const q = (f.q || '').toLowerCase();
    return PRE.rows.filter(r => (!f.country || r.country === f.country) && (!f.type || r.type === f.type) && (!f.cls || r.cls === f.cls) && (!f.sig || r.sig.color === f.sig) && (!q || String(r.hotel).toLowerCase().includes(q) || String(r.code || '').toLowerCase().includes(q)));
  }
  function preDetail(r) {
    const cfg = CFG; const lines = [];
    if (r.cover !== null) lines.push(t('calcCover', { ledger: fmt(r.ledger, r.ccy), avg: fmt(r.avg, r.ccy), months: r.cover })); else lines.push(t(blank(r.ledger) || blank(r.avg) ? 'calcNoData' : 'calcNoAvg'));
    if (r.daysLeft !== null && !blank(r.avg) && !blank(r.ledger)) { const use = r.avg * r.daysLeft / 30; lines.push(t('calcDays', { days: r.daysLeft, asOf: r.asOf, yearEnd: cfg.yearEnd })); lines.push(t('calcEst', { use: fmt(use, r.ccy), est: fmt(r.est, r.ccy) })); lines.push(t('calcCanUse', { r: r.canUse === '가능' ? t('canUseYes') : t('canUseNo') })); }
    const iss = ISSUES.filter(i => i.sheet === 'pre' && i.row === r.sourceRow);
    return '<div class="detail"><div class="row"><div class="col"><h3>' + esc(r.hotel) + ' <span class="muted small">' + esc(r.country + ' · ' + (r.type || '') + ' · ' + r.ccy) + '</span></h3>' + chip(r.cls, clsLabel(r.cls)) + ' ' + sigDot(r.sig.color) +
      '<div class="small" style="margin-top:6px">' + esc(t(r.cls === 'NONE' ? '' : 'act' + ({ B1: 'TRANSFER', B2_USE: 'CONSUME', B2_REFUND: 'REFUND', B2_TALK: 'NEGOTIATE', TBD: 'CONFIRM' })[r.cls])) + '</div>' +
      '<h3 style="margin-top:10px">' + esc(t('calcTitle')) + '</h3><ul class="rules">' + lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>' +
      '<div class="small muted">' + esc(t('reconMATCH').length ? t('recon' + r.recon) : '') + (r.gapPct !== null ? ' · ' + pct(r.gapPct, 1) : '') + '</div></div>' +
      '<div class="col">' + (r.note ? '<h3>' + esc(t('noteLabel')) + '</h3><div class="small">' + esc(r.note) + '</div>' : '') + (r.transferNote ? '<h3 style="margin-top:8px">' + esc(t('transferNote')) + '</h3><div class="small">' + esc(r.transferNote) + '</div>' : '') + (r.refundNote ? '<h3 style="margin-top:8px">' + esc(t('refundNote')) + '</h3><div class="small">' + esc(r.refundNote) + '</div>' : '') +
      (r.owner ? '<div class="small muted" style="margin-top:8px">' + esc(t('ownerLabel')) + ': ' + esc(r.owner) + '</div>' : '') + (iss.length ? '<h3 style="margin-top:8px">' + esc(t('colIssues')) + '</h3><ul class="rules">' + iss.map(i => '<li>' + chip(i.sev === 'error' ? 'bad' : i.sev === 'warn' ? 'warn' : '', t(i.sev === 'error' ? 'sevError' : i.sev === 'warn' ? 'sevWarn' : 'sevInfo')) + ' ' + esc(issueText(i)) + '</li>').join('') + '</ul>' : '') + '</div></div><button class="sm" data-act="closeDetail">' + esc(t('detailClose')) + '</button></div>';
  }
  function viewPre() {
    const f = S.f.pre; const rows = preFiltered();
    const chips = '<div class="chips">' + ['B1', 'B2_USE', 'B2_REFUND', 'B2_TALK', 'TBD'].map(c => '<button class="chip ' + c + '" data-act="flt" data-scope="pre" data-key="cls" data-val="' + c + '" aria-pressed="' + (f.cls === c) + '">' + esc(clsLabel(c)) + ' ' + PRE.rows.filter(r => r.cls === c).length + '</button>').join('') + '</div><div class="small muted">' + esc(f.cls ? t(f.cls + 'd') : '') + '</div>';
    const tools = '<div class="tools">' + sel('pre', 'country', t('country'), uniq(PRE.rows, r => r.country).map(v => ({ v, t: v })), f.country) + sel('pre', 'type', t('preType'), uniq(PRE.rows, r => r.type).map(v => ({ v, t: v })), f.type) + sel('pre', 'sig', t('preSignal'), ['bad', 'warn', 'ok', 'na'].map(v => ({ v, t: sigText(v) })), f.sig) +
      '<label>' + esc(t('search')) + '<input id="q-pre" data-f="pre.q" value="' + esc(f.q || '') + '" autocomplete="off"></label><button class="sm" data-act="reset" data-scope="pre">' + esc(t('reset')) + '</button><span class="muted small">' + esc(t('payCount', { n: rows.length })) + ' · ' + esc(t('sortHint')) + '</span></div>';
    const cols = [
      { k: 'country', h: () => t('colEntityPre'), v: r => esc(r.country), s: r => r.country }, { k: 'hotel', h: () => t('colHotel'), v: r => '<b>' + esc(r.hotel) + '</b>', s: r => r.hotel }, { k: 'type', h: () => t('colType'), v: r => esc(r.type || '—'), s: r => r.type },
      { k: 'ccy', h: () => t('colCcy'), v: r => esc(r.ccy), s: r => r.ccy }, { k: 'ledger', h: () => t('colLedger'), cls: 'num', v: r => fmt(r.ledger, r.ccy), s: r => r.ledger }, { k: 'hotelBal', h: () => t('colHotelBal'), cls: 'num', v: r => fmt(r.hotelBal, r.ccy), s: r => r.hotelBal },
      { k: 'gap', h: () => t('colGap'), cls: 'num', v: r => r.gap === null ? '—' : fmt(r.gap, r.ccy) + (r.recon === 'MAJOR' ? ' <span class="chip bad">' + pct(r.gapPct, 1) + '</span>' : r.recon === 'MINOR' ? ' <span class="chip warn">' + pct(r.gapPct, 1) + '</span>' : ''), s: r => r.gap },
      { k: 'avg', h: () => t('colAvgUse'), cls: 'num', v: r => fmt(r.avg, r.ccy), s: r => r.avg }, { k: 'cover', h: () => t('colCover'), cls: 'num', v: r => r.cover === null ? '—' : String(r.cover), s: r => r.cover },
      { k: 'canUse', h: () => t('colCanUse'), v: r => r.canUse === '가능' ? t('canUseYes') : r.canUse === '불가' ? t('canUseNo') : '—', s: r => r.canUse }, { k: 'est', h: () => t('colEst'), cls: 'num', v: r => fmt(r.est, r.ccy), s: r => r.est },
      { k: 'transfer', h: () => t('colTransfer'), v: r => esc(ynText(r.transfer)), s: r => r.transfer }, { k: 'refund', h: () => t('colRefund'), v: r => esc(ynText(r.refund)), s: r => r.refund },
      { k: 'cls', h: () => t('colClass'), v: r => chip(r.cls, clsLabel(r.cls)), s: r => r.cls }, { k: 'sig', h: () => t('colSignal'), v: r => sigDot(r.sig.color), s: r => ({ bad: 3, warn: 2, ok: 1, na: 0 })[r.sig.color] }, { k: 'asOf', h: () => t('colAsOf'), v: r => esc(r.asOf || '—'), s: r => r.asOf },
    ];
    const open = S.open ? PRE.rows.find(r => r.id === S.open) : null;
    return '<h2>' + esc(t('preTitle')) + '</h2>' + chips + tools + (open ? preDetail(open) : '') + tbl('pre', cols, rows, { sort: 'ledger', dir: 'desc', click: 'detail', rowClass: r => r.id === S.open ? 'click sel' : 'click', size: 40 }) + '<div class="small muted">' + esc(t('perCurrencyNote')) + '</div>';
  }

  /* ================= 결재 준비 ================= */
  function apText() {
    const lines = []; const asOf = META.asOfMax || TODAY; const tot = PAY.total; const due = tot.n - tot.PRE;
    lines.push(L('[프리바이·SG 지급 처리 안 초안] 기준일 ' + asOf, '[Prebuy and SG payment proposal, draft] as of ' + asOf));
    lines.push(L('■ 프리바이 ' + PRE.count + '곳', '■ Prebuy: ' + PRE.count + ' hotels'));
    for (const cls of ['B1', 'B2_USE', 'B2_REFUND', 'B2_TALK', 'TBD']) {
      const c = PRE.byClass[cls]; if (!c) continue; const amt = Object.keys(c.byCcy).sort().map(k => fmt(c.byCcy[k].ledger, k) + ' ' + k).join(', ');
      const est = (cls === 'B2_REFUND' || cls === 'B2_USE') ? ' / ' + t('est1231') + ' ' + Object.keys(c.byCcy).sort().filter(k => c.byCcy[k].estKnown).map(k => fmt(c.byCcy[k].est, k) + ' ' + k).join(', ') : '';
      lines.push('- ' + clsLabel(cls) + ': ' + c.n + L('곳', ' hotels') + ' (' + amt + ')' + est + ' → ' + t('act' + CALC.ACTION[cls]));
    }
    lines.push(L('■ 후불 지급 ' + due + '곳: A1 ' + tot.A1 + ', A2 ' + tot.A2 + ', 예외 검토 ' + tot.EXC + ', 확인 필요 ' + tot.TBD, '■ Post-paid: ' + due + ' hotels: A1 ' + tot.A1 + ', A2 ' + tot.A2 + ', exception review ' + tot.EXC + ', to confirm ' + tot.TBD));
    lines.push(L('※ 금액은 통화 그대로입니다(환산 없음). 이관·소진·반환·협의는 대표 결재에서 정합니다.', '※ Amounts are in their own currencies (no conversion). Transfer, use-up, refund and talks are decided at the CEO approval.'));
    return lines.join('\n');
  }
  function viewApproval() {
    const pp = PROG.payments, pr = PROG.prebuy; const sev = ISSUES.filter(i => i.sev === 'error').length; const tbd = (PRE.byClass.TBD || { n: 0 }).n;
    const chk = (ok, label, detail) => '<div class="ready"><span class="tick ' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓' : '✗') + '</span><span>' + esc(label) + '</span><span class="muted small">' + esc(detail) + '</span></div>';
    const ready = '<div class="card">' + chk(pr.finance === pr.n, t('apReadyFinance'), pr.finance + ' / ' + pr.n) + chk(pr.scm === pr.n, t('apReadyScm'), pr.scm + ' / ' + pr.n) + chk(pp.done === pp.due, t('apReadyPay'), pp.done + ' / ' + pp.due) + chk(sev === 0, t('apReadyIssues'), String(sev)) + chk(tbd === 0, t('apReadyClass'), String(tbd)) + '</div>';
    const rows = PACKET.lines.map(l => '<tr><td>' + chip(l.cls, clsLabel(l.cls)) + '</td><td>' + esc(l.ccy) + '</td><td class="num">' + l.n + '</td><td class="num">' + fmt(l.ledger, l.ccy) + '</td><td class="num">' + (l.estKnown ? fmt(l.est, l.ccy) : '—') + '</td><td class="small">' + esc(t('act' + CALC.ACTION[l.cls])) + '</td></tr>').join('');
    const packet = '<div class="tw"><table><thead><tr><th>' + esc(t('cls')) + '</th><th>' + esc(t('colCcy')) + '</th><th class="num">' + esc(t('count')) + '</th><th class="num">' + esc(t('ledger')) + '</th><th class="num">' + esc(t('est1231')) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="small muted">' + esc(t('perCurrencyNote')) + '</div>';
    // 결정 필요
    const need = [];
    for (const r of PRE.rows) {
      const why = [];
      if (r.cls === 'B2_TALK') why.push(t('apTalkWhy'));
      if (r.cls === 'TBD') { const miss = []; if (blank(r.ledger)) miss.push(t('fldLedger')); if (blank(r.asOf)) miss.push(t('fldAsOf')); if (blank(r.avg)) miss.push(t('fldAvg')); if (blank(r.hotelBal)) miss.push(t('fldHotelBal')); if (blank(r.transfer) || r.transfer === '미확인') miss.push(t('fldTransfer')); if (miss.length) why.push(t('apMissing', { f: miss.join(', ') })); }
      if (r.recon === 'MAJOR') why.push(t('apGapWhy', { pct: CALC.round1(r.gapPct) }));
      if (r.sig.critical) why.push(t('apCritWhy'));
      if (why.length) need.push({ r, why });
    }
    const needHtml = need.length ? '<div class="tw"><table><tbody>' + need.map(x => '<tr class="click" data-act="openPre" data-id="' + x.r.id + '"><td>' + esc(x.r.country) + '</td><td><b>' + esc(x.r.hotel) + '</b></td><td>' + chip(x.r.cls, clsLabel(x.r.cls)) + '</td><td class="num">' + money(x.r.ledger, x.r.ccy) + '</td><td class="small">' + x.why.map(esc).join('<br>') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="muted">' + esc(t('apDecideNone')) + '</div>';
    return '<h2>' + esc(t('apTitle')) + '</h2><div class="small muted">' + esc(t('apNote')) + '</div>' + banner() + '<div class="grid g2"><div><h3>' + esc(t('apReady')) + '</h3>' + ready + '</div><div><h3>' + esc(t('apText')) + '</h3><pre class="text" id="aptext">' + esc(apText()) + '</pre><p><button class="primary" data-act="apcopy">' + esc(t('apCopy')) + '</button> <span id="apmsg" class="muted small"></span></p></div></div>' +
      '<h2>' + esc(t('apPacket')) + '</h2>' + packet + '<h2>' + esc(t('apDecide')) + ' (' + need.length + ')</h2>' + needHtml;
  }

  /* ================= 수집·점검 ================= */
  function missingRows() {
    const out = [];
    for (const r of PAY.rows) { if (r.cls === 'NONE' || r.cls === 'PRE' || r.fill === 'DONE') continue; const m = []; if (r.fill === 'EMPTY') m.push(t('colCard')); if (r.fill === 'PARTIAL') m.push(t('colAccount')); if (r.fill === 'UNKNOWN') m.push(t('unknown')); out.push({ sheet: 'pay', row: r.sourceRow, country: r.country, hotel: r.hotel, what: m.join(', ') }); }
    for (const h of DATA.prebuy) {
      if (blank(h.hotel)) continue; const m = []; if (blank(h.ledger)) m.push(t('fldLedger')); if (blank(h.asOf)) m.push(t('fldAsOf')); if (blank(h.avg)) m.push(t('fldAvg')); const s = CALC.scmFill(h); s.missing.forEach(k => m.push(t({ hotelBal: 'fldHotelBal', transfer: 'fldTransfer', refund: 'fldRefund' }[k]))); s.unknown.forEach(k => m.push(t(k === 'transfer' ? 'fldTransfer' : 'fldRefund') + ' (' + t('unknown') + ')'));
      if (m.length) out.push({ sheet: 'pre', row: h.sourceRow, country: h.country, hotel: h.hotel, what: m.join(', ') });
    }
    return out;
  }
  function viewCollect() {
    const pp = PROG.payments, pr = PROG.prebuy; const f = S.f.col;
    const payBars = Object.keys(pp.byCountry).sort().map(c => { const x = pp.byCountry[c]; return prog(c, x.done + x.unknown, x.due); }).join('');
    const preBars = Object.keys(pr.byCountry).sort().map(c => { const x = pr.byCountry[c]; return prog(c + ' · ' + t('colPreFin'), x.finance, x.n) + prog(c + ' · ' + t('colPreScm'), x.scmAnswered, x.n); }).join('');
    const miss = missingRows().filter(m => (!f.mcountry || m.country === f.mcountry) && (!f.msheet || m.sheet === f.msheet));
    const missCols = [{ k: 'sheet', h: () => t('colSheet'), v: r => esc(r.sheet === 'pay' ? t('sheetPay') : t('sheetPre')), s: r => r.sheet }, { k: 'country', h: () => t('colCountry'), v: r => esc(r.country), s: r => r.country }, { k: 'row', h: () => t('colRow'), cls: 'num', v: r => r.row, s: r => r.row }, { k: 'hotel', h: () => t('colHotel'), v: r => esc(r.hotel), s: r => r.hotel }, { k: 'what', h: () => t('colMissing'), v: r => esc(r.what) }];
    const missTools = '<div class="tools">' + sel('col', 'mcountry', t('country'), uniq(miss.concat(missingRows()), r => r.country).map(v => ({ v, t: v })), f.mcountry) + sel('col', 'msheet', t('colSheet'), [{ v: 'pay', t: t('sheetPay') }, { v: 'pre', t: t('sheetPre') }], f.msheet) + '<span class="muted small">' + miss.length + '</span></div>';
    const issues = ISSUES.filter(i => !f.sev || i.sev === f.sev); const sevBtn = (v, label) => '<button class="chip ' + (v === 'error' ? 'bad' : v === 'warn' ? 'warn' : '') + '" data-act="flt" data-scope="col" data-key="sev" data-val="' + v + '" aria-pressed="' + (f.sev === v) + '">' + esc(label) + ' ' + ISSUES.filter(i => i.sev === v).length + '</button>';
    const issCols = [{ k: 'sev', h: () => t('colSeverity'), v: i => chip(i.sev === 'error' ? 'bad' : i.sev === 'warn' ? 'warn' : '', t(i.sev === 'error' ? 'sevError' : i.sev === 'warn' ? 'sevWarn' : 'sevInfo')), s: i => ({ error: 0, warn: 1, info: 2 })[i.sev] }, { k: 'sheet', h: () => t('colSheet'), v: i => esc(i.sheet === 'pay' ? t('sheetPay') : t('sheetPre')), s: i => i.sheet }, { k: 'row', h: () => t('colRow'), cls: 'num', v: i => i.row === null ? '—' : i.row, s: i => i.row }, { k: 'hotel', h: () => t('colHotel'), v: i => esc(i.hotel), s: i => i.hotel }, { k: 'what', h: () => t('colWhat'), v: i => esc(issueText(i)) }];
    const parse = META.parseIssues && META.parseIssues.length ? '<ul class="rules">' + META.parseIssues.slice(0, 30).map(p => '<li>' + esc((p.sheet || '') + ' ' + (p.row ? p.row + ' ' : '') + (p.field || '') + ' ' + (p.raw || '') + ' ' + (p.msg || '')) + '</li>').join('') + '</ul>' : '<span class="muted">' + esc(t('parseNone')) + '</span>';
    return '<h2>' + esc(t('colTitle')) + '</h2>' + banner() + '<div class="grid g2"><div><h3>' + esc(t('colProgress')) + '</h3><div class="card">' + prog(t('colPay'), pp.done + pp.unknown, pp.due) + payBars + '</div></div><div><h3>&nbsp;</h3><div class="card">' + preBars + '</div></div></div>' +
      '<h2>' + esc(t('colMissing')) + '</h2>' + missTools + (miss.length ? tbl('miss', missCols, miss, { sort: 'sheet', size: 30 }) : '<div class="muted">' + esc(t('colMissingNone')) + '</div>') +
      '<h2>' + esc(t('colIssues')) + '</h2><div class="chips">' + sevBtn('error', t('sevError')) + sevBtn('warn', t('sevWarn')) + sevBtn('info', t('sevInfo')) + '</div>' + (issues.length ? tbl('iss', issCols, issues, { size: 30 }) : '<div class="muted">' + esc(t('boardIssuesNone')) + '</div>') +
      '<h2>' + esc(t('parseIssues')) + '</h2>' + parse;
  }

  /* ================= 기준 ================= */
  function viewRules() {
    const li = keys => '<ul class="rules">' + keys.map(k => '<li>' + esc(t(k)) + '</li>').join('') + '</ul>';
    const terms = ['A1', 'A2', 'EXC', 'TBD', 'B1', 'B2_USE', 'B2_REFUND', 'B2_TALK'].map(c => '<tr><td>' + chip(c, clsLabel(c)) + '</td><td>' + esc(t(c + 'd')) + '</td></tr>').join('');
    const srcs = META.sources.map(s => '<li>' + esc(s.name) + ' — ' + esc(t('rowsPay', { n: s.payRows })) + ', ' + esc(t('rowsPre', { n: s.preRows })) + '</li>').join('');
    return '<h2>' + esc(t('rulesTitle')) + '</h2><div class="grid g2"><div><h3>' + esc(t('rulesTerms')) + '</h3><div class="tw"><table><tbody>' + terms + '</tbody></table></div><h3 style="margin-top:14px">' + esc(t('rulesFormulas')) + '</h3>' + li(['fPay', 'fCls', 'fS1', 'fCan', 'fEst', 'fGap']) + '<h3 style="margin-top:14px">' + esc(t('rulesSignals')) + '</h3>' + li(['sigRule1', 'sigRule2', 'sigRule3']) + '</div>' +
      '<div><h3>' + esc(t('rulesCeo')) + '</h3>' + li(['ceo1', 'ceo2', 'ceo3', 'ceo4', 'ceo5', 'ceo6']) + '<h3 style="margin-top:14px">' + esc(t('rulesData')) + '</h3>' + li(['dataH1', 'dataH2', 'dataH3', 'dataH4', 'dataH5']) + '<h3 style="margin-top:14px">' + esc(t('rulesBuild')) + '</h3><ul class="rules">' + srcs + '</ul><div class="small muted">' + esc(t('built')) + ' ' + esc(META.builtAt) + ' · ' + esc(META.synthetic ? t('synthetic') : t('internal')) + '</div></div></div>';
  }

  /* ================= 틀 ================= */
  const TABS = [['board', 'tabBoard', viewBoard], ['pay', 'tabPay', viewPay], ['pre', 'tabPre', viewPre], ['approval', 'tabApproval', viewApproval], ['collect', 'tabCollect', viewCollect], ['rules', 'tabRules', viewRules]];
  function render() {
    document.documentElement.lang = S.lang; document.getElementById('h-title').textContent = t('appTitle'); document.getElementById('h-sub').textContent = t('appSub');
    document.querySelectorAll('#lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang)));
    document.getElementById('tabs').innerHTML = TABS.map(x => '<button role="tab" data-act="tab" data-tab="' + x[0] + '" aria-selected="' + (S.tab === x[0]) + '">' + esc(t(x[1])) + '</button>').join('');
    const cur = TABS.find(x => x[0] === S.tab) || TABS[0]; const view = document.getElementById('view'); view.innerHTML = cur[2]();
    if (S.focus) { const el = document.getElementById(S.focus.id); if (el) { el.focus(); try { el.setSelectionRange(S.focus.pos, S.focus.pos); } catch (e) { /* not a text input */ } } S.focus = null; }
  }
  const go = (tab) => { S.tab = tab; safe(() => { history.replaceState(null, '', '#' + tab); }); render(); window.scrollTo(0, 0); };
  function copyText(text, msgEl) {
    const done = ok => { if (msgEl) msgEl.textContent = ok ? t('apCopied') : t('apCopyFail'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); else { try { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); done(document.execCommand('copy')); ta.remove(); } catch (e) { done(false); } }
  }
  const pickRows = () => PAY.rows.filter(r => S.picks.has(r.id));
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'); if (!a) return; const act = a.dataset.act;
    if (act === 'tab') return go(a.dataset.tab);
    if (act === 'goto') return go(a.dataset.tab);
    if (act === 'sort') { const st = S.tables[a.dataset.tbl]; if (st.key === a.dataset.key) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.key = a.dataset.key; st.dir = 'asc'; } st.page = 0; return render(); }
    if (act === 'page') { S.tables[a.dataset.tbl].page += +a.dataset.d; return render(); }
    if (act === 'flt') { const f = S.f[a.dataset.scope]; f[a.dataset.key] = f[a.dataset.key] === a.dataset.val ? '' : a.dataset.val; if (S.tables[a.dataset.scope]) S.tables[a.dataset.scope].page = 0; return render(); }
    if (act === 'reset') { S.f[a.dataset.scope] = {}; if (S.tables[a.dataset.scope]) S.tables[a.dataset.scope].page = 0; return render(); }
    if (act === 'detail') { S.open = S.open === a.dataset.id ? null : a.dataset.id; return render(); }
    if (act === 'openPre') { S.open = a.dataset.id; S.f.pre = {}; return go('pre'); }
    if (act === 'closeDetail') { S.open = null; return render(); }
    if (act === 'pick') { const id = a.dataset.id; if (S.picks.has(id)) S.picks.delete(id); else S.picks.add(id); savePicks(); return render(); }
    if (act === 'pickclear') { S.picks.clear(); savePicks(); return render(); }
    if (act === 'pickcopy') { const txt = pickRows().map(r => [r.country, r.code || '', r.hotel, r.ccy, r.avg === null ? '' : r.avg, r.cls].join('\t')).join('\n'); return copyText(txt, null); }
    if (act === 'pickcsv') { const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; const csv = '﻿' + ['country,vendor_code,hotel,currency,avg_monthly_payment,class'].concat(pickRows().map(r => [r.country, r.code, r.hotel, r.ccy, r.avg, r.cls].map(q).join(','))).join('\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const l = document.createElement('a'); l.href = url; l.download = 'sg_test_candidates.csv'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
    if (act === 'apcopy') return copyText(document.getElementById('aptext').textContent, document.getElementById('apmsg'));
  });
  const onInput = e => {
    const el = e.target; const key = el.dataset && el.dataset.f; if (!key) return; const [scope, k] = key.split('.'); S.f[scope][k] = el.value; if (S.tables[scope]) S.tables[scope].page = 0;
    if (el.tagName === 'INPUT') S.focus = { id: el.id, pos: el.selectionStart }; render();
  };
  document.addEventListener('input', e => { if (e.target.tagName === 'INPUT' && e.target.dataset.f) onInput(e); });
  document.addEventListener('change', e => { if (e.target.tagName === 'SELECT' && e.target.dataset.f) onInput(e); });
  document.getElementById('lang').addEventListener('click', e => { const b = e.target.closest('button[data-lang]'); if (!b) return; S.lang = b.dataset.lang; safe(() => localStorage.setItem('omh_lang', S.lang)); render(); });
  document.getElementById('theme').addEventListener('click', () => { const r = document.documentElement; const cur = r.getAttribute('data-theme'); r.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark'); });
  const initial = (location.hash || '').replace('#', ''); if (TABS.some(x => x[0] === initial)) S.tab = initial;
  render();
  window.__OMH = { S, PAY, PRE, PROG, ISSUES, PACKET, render, go };
})();
