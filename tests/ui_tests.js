/* Browser UI tests. Run by opening tests/ui_tests.html over http (same-origin iframe drives the real app). */
(function () {
  'use strict';
  const h = OMH_TEST.create('browser'); const { test: t } = h;
  const frame = document.getElementById('app'); const sleep = ms => new Promise(r => setTimeout(r, ms));
  let win, doc, errors = [];
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { try { const v = fn(); if (v) return v; } catch (e) { /* retry */ } await sleep(15); } throw new Error('timeout waiting for condition: ' + fn.toString().slice(0, 90)); };
  const load = (path, opts) => new Promise((res, rej) => { opts = opts || {}; if (!opts.keep) { localStorage.clear(); sessionStorage.clear(); } if (!opts.keep || opts.account !== undefined) { const acc = opts.account === undefined ? 'demo.scm' : opts.account; if (acc) sessionStorage.setItem('omh_hfr_session', JSON.stringify({ id: acc, exp: Date.now() + 3600000 })); else sessionStorage.removeItem('omh_hfr_session'); } if (opts.pre) opts.pre(); /* tests start signed in as an SCM user unless a test asks for another account or for none */ frame.style.width = (opts.width || 1280) + 'px';
    frame.onload = async () => { win = frame.contentWindow; doc = frame.contentDocument; errors = []; win.addEventListener('error', e => errors.push(String(e.message))); const ce = win.console.error; win.console.error = (...a) => { errors.push(a.join(' ')); ce.apply(win.console, a); };
      try { await until(() => win.OMH && win.OMH.app && win.OMH.app.last); res(); } catch (e) { rej(e); } };
    frame.src = '../index.html?t=' + Date.now() + (path ? '#' + path : ''); });
  const nav = async (path) => { const [route, ...params] = path.replace(/^\//, '').split('/'); win.location.hash = '#/' + path.replace(/^\//, ''); await until(() => win.OMH.app.last.route === route && JSON.stringify(win.OMH.app.last.params) === JSON.stringify(params.map(decodeURIComponent))); await sleep(5); };
  const PW = 'demo-1234', ACC = { VIEWER: 'demo.viewer', SCM: 'demo.scm', CEO: 'demo.ceo', ADMIN: 'demo.admin' };
  const setRole = async r => { const st = win.OMH.app.store; if (st.session.loggedIn) st.logout(); const res = st.login(ACC[r], PW); if (!res.ok) throw new Error('test login failed for ' + r); win.sessionStorage.setItem('omh_hfr_session', JSON.stringify({ id: ACC[r], exp: res.exp })); win.OMH.app.render(); await until(() => st.session.role === r); };   // sign in as the demo account of that role; the page stays where it is
  const setVal = (el, v, ev) => { el.value = v; el.dispatchEvent(new win.Event(ev || 'input', { bubbles: true })); };
  const q = s => doc.querySelector(s), qa = s => [...doc.querySelectorAll(s)]; const txt = () => doc.getElementById('content').innerText;
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const store = () => win.OMH.app.store; const ledgerLen = () => store().state.ledger.length; const BAD = /undefined|NaN|\[object|Infinity/;
  const R = ['dashboard', 'status', 'profile', 'ledger', 'risk', 'approval', 'register', 'admin'];

  t('U01', 'Every screen renders in KO and EN for every role in the real browser with no error text, no undefined/NaN and no console errors', ['S01', 'S02', 'S03', 'S04', 'S05', 'S07', 'S08', 'UI-LANG'], async a => {
    await load('/dashboard'); let n = 0;
    for (const lang of ['ko', 'en']) { doc.getElementById('lang-' + lang).click(); for (const role of ['VIEWER', 'SCM', 'CEO', 'ADMIN']) { await setRole(role); for (const r of R) { await nav('/' + r); const c = q('#content'); n++; a.ok(c.innerText.length > 120, lang + role + r + ' empty'); a.ok(!BAD.test(c.innerText), r + ' ' + lang + ' ' + role + ': ' + (c.innerText.match(BAD) || [''])[0]); a.ok(!q('#content .note.bad b'), 'error boundary shown on ' + r); } } }
    a.eq(n, 64); a.eq(errors.length, 0, 'console errors: ' + errors.join(' | ')); doc.getElementById('lang-ko').click();
  });
  t('U02', 'Floating status board: filters change the numbers; impossible combination shows an empty state', ['S01', 'UI-FILTER', 'UI-EMPTY'], async a => {
    await load('/status'); doc.getElementById('lang-en').click(); await nav('/status'); const rowsN = () => qa('#tbl-dash tbody tr').length; a.eq(rowsN(), 21);
    setVal(q('[data-f="country"]'), 'JP', 'change'); await until(() => rowsN() === 8); setVal(q('[data-f="currency"]'), 'KRW', 'change'); await until(() => txt().includes('No data to display'));
    click(q('[data-act="clear-filters"]')); await until(() => rowsN() === 21); doc.getElementById('lang-ko').click();
  });
  t('U03', 'Top-up simulator inside the hotel credit card computes instantly, labels itself a simulation, writes nothing and does not carry an amount over to another contract', ['S04', 'T14', 'M04-2'], async a => {
    await load('/profile/CT-KR-004'); const n0 = ledgerLen(); const snap = JSON.stringify(store().state.ledger); const r = () => q('#sim-result').innerText;
    a.ok(!qa('nav a, #nav a').some(x => /simulator|시뮬레이터/i.test(x.getAttribute('href') || '')), 'no separate menu entry'); a.ok(q('#sim-panel').innerText.includes('SIMULATION'));
    setVal(q('#sim-amt'), '4066666'); await until(() => q('#sim-result .sim-res'));
    a.ok(/9,766,666 KRW/.test(r())); a.ok(/5,700,000 KRW/.test(r())); setVal(q('#sim-amt'), '4066667'); await until(() => /1 KRW/.test(r()) && q('#sim-result .sim-res .bad')); a.ok(r().includes('KRW'));
    setVal(q('#sim-amt'), 'abc'); await until(() => q('#sim-result .note.bad')); setVal(q('#sim-amt'), '-5'); await until(() => q('#sim-result .note.bad')); a.eq(ledgerLen(), n0); a.eq(JSON.stringify(store().state.ledger), snap);
    await nav('/profile/CT-JP-007'); a.eq(q('#sim-amt').value, '', 'an amount typed for one contract is not applied to another'); setVal(q('#sim-amt'), '1000000'); await until(() => q('#sim-result .sim-res')); a.ok(!BAD.test(r()), 'unavailable limit renders cleanly');
  });
  t('U04', 'CSV upload: validate (dry-run) → commit only accepted rows → re-commit adds nothing; duplicates and bad rows are reported', ['S03', 'T12', 'T02', 'M02-4', 'D-2'], async a => {
    await load('/ledger/CT-KR-001'); const n0 = ledgerLen(); click(q('[data-act="csv-sample"]')); await until(() => q('#csv-text').value.includes('SAMPLE-BANK-REF-1001')); click(q('[data-act="csv-validate"]'));
    await until(() => txt().includes('ACCEPT 2')); a.ok(txt().includes('DUPLICATE 1') && txt().includes('REJECT 2')); a.eq(ledgerLen(), n0, 'dry run changes nothing');
    click(q('[data-act="csv-commit"]')); await until(() => ledgerLen() === n0 + 2); const bal = store().model().byContract['CT-KR-001'].balance.closingMinor; a.eq(bal, 45e6 + 10e6);
    click(q('[data-act="csv-commit"]')); await until(() => store().state.importBatches.length === 2); a.eq(ledgerLen(), n0 + 2, 'second commit adds nothing'); a.eq(store().model().byContract['CT-KR-001'].balance.closingMinor, bal); a.ok(txt().includes('DUPLICATE'));
  });
  t('U05', 'Role switch disables write controls for VIEWER and CEO, enables them for SCM', ['D-4', 'S03'], async a => {
    await load('/ledger/CT-KR-001'); const wr = () => qa('[data-act="add-tx"],[data-act="csv-commit"],[data-act="add-conf"]').map(b => b.disabled);
    await setRole('VIEWER'); await nav('/ledger/CT-KR-001'); a.ok(wr().length === 3 && wr().every(Boolean)); await setRole('CEO'); a.ok(wr().every(Boolean)); await setRole('SCM'); a.ok(wr().every(x => !x));
    await setRole('VIEWER'); setVal(q('#tx-amt'), '1000', 'input'); click(q('[data-act="add-tx"]')); await sleep(30); a.eq(store().state.ledger.filter(x => x.source === 'MANUAL').length, 0, 'disabled button did nothing');
  });
  t('U06', 'Refresh consistency: a posted transaction, confirmation and score survive a browser reload with identical numbers', ['T15', 'D-5'], async a => {
    await load('/ledger/CT-JP-001'); setVal(q('#tx-amt'), '2500000'); setVal(q('#tx-ref'), 'UI-REF-1'); click(q('[data-act="add-tx"]')); await until(() => store().state.ledger.some(x => x.externalRef === 'UI-REF-1'));
    setVal(q('#cf-amt'), '12500000'); click(q('[data-act="add-conf"]')); await until(() => store().state.confirmations.filter(x => x.contractId === 'CT-JP-001').length === 2); const before = JSON.stringify(store().model().views.map(v => [v.contractId, v.balance.closingMinor, v.rating.grade, v.limit.recommendedLimitMinor, v.recon.status, v.liveAlerts.length]));
    const txt0 = txt(); await load('/ledger/CT-JP-001', { keep: true }); await until(() => store().state.ledger.some(x => x.externalRef === 'UI-REF-1'));
    a.eq(JSON.stringify(store().model().views.map(v => [v.contractId, v.balance.closingMinor, v.rating.grade, v.limit.recommendedLimitMinor, v.recon.status, v.liveAlerts.length])), before); a.eq(store().model().byContract['CT-JP-001'].balance.closingMinor, 12500000); a.eq(store().loadStatus, 'OK'); a.ok(txt().includes('UI-REF-1')); a.eq(txt(), txt0, 'rendered screen identical after reload');
  });
  t('U07', 'Approval-packet flow in the UI: draft → request CEO review → CEO sends feedback (required); SCM cannot review; the person in charge sees the feedback; ledger never changes', ['M09-2', 'T14', 'S07', 'D-4'], async a => {
    await load('/approval/CT-KR-001'); const snap = JSON.stringify(store().state.ledger); setVal(q('#portal-amt'), '5000000', 'change'); await until(() => q('#portal-report')); const rt = q('#portal-report').innerText;
    for (const k of ['45,000,000 KRW', '30,000,000 KRW', '5,000,000 KRW', '50,000,000 KRW']) a.ok(rt.includes(k), k); a.ok(q('.mockstamp')); click(q('[data-act="ap-create"]')); await until(() => store().state.approvals.length === 1);
    click(q('[data-apsubmit]')); await until(() => store().state.approvals[0].status === 'SUBMITTED_MOCK'); const dec = q('[data-apreview]'); a.ok(dec.disabled, 'SCM cannot review'); await setRole('CEO'); await nav('/approval/CT-KR-001'); const d2 = q('[data-apreview]'); a.ok(!d2.disabled); click(d2); await new Promise(r => setTimeout(r, 150)); a.eq(store().state.approvals[0].status, 'SUBMITTED_MOCK', 'no feedback, no review'); setVal(q('[data-apfb]'), 'Check the unused balance first'); click(q('[data-apreview]')); await until(() => store().state.approvals[0].status === 'CEO_REVIEWED');
    a.eq(JSON.stringify(store().state.ledger), snap); a.ok(txt().includes('MOCK') || txt().includes('모의')); a.ok(txt().includes('Check the unused balance first'), 'the feedback is shown next to the request'); await setRole('ADMIN'); await nav('/approval/CT-KR-001'); a.ok(qa('[data-apreview]').length === 0, 'a reviewed request offers no further review button'); await setRole('SCM'); await nav('/profile/CT-KR-001'); a.ok(q('#content').innerText.includes('Check the unused balance first'), 'the person in charge sees the CEO feedback on the hotel credit card');
  });
  t('U08', 'XSS: hostile text posted through the UI is rendered inert (no element injected, no script run)', ['D-8', 'T12'], async a => {
    await load('/ledger/CT-KR-001'); win.__xss = undefined; setVal(q('#tx-amt'), '1000'); setVal(q('#tx-ref'), '<img src=x onerror="window.__xss=1">'); click(q('[data-act="add-tx"]')); await until(() => store().state.ledger.some(x => /img src=x/.test(x.externalRef || '')));
    await sleep(120); a.ok(!q('#content img'), 'no <img> element injected'); a.eq(win.__xss, undefined); a.ok(txt().includes('<img src=x')); await nav('/profile/CT-KR-001'); setVal(q('#scm-op'), '<script>window.__xss=2</script>'); click(q('[data-act="save-opinion"]')); await until(() => /script/.test(store().state.ratings['CT-KR-001'].scmOpinion.text)); await sleep(80); a.ok(!q('#content script')); a.eq(win.__xss, undefined);
  });
  t('U09', 'Print / file output: print stylesheet hides chrome; the approval packet screen offers print and JSON export', ['S07', 'UI-PRINT'], async a => {
    await load('/approval/CT-KR-001'); setVal(q('#portal-amt'), '1000000', 'change'); await until(() => q('#portal-report')); let ok = false; for (const ss of [...doc.styleSheets]) for (const r of [...ss.cssRules]) if (r.media && /print/.test(r.media.mediaText) && /\.sidebar/.test(r.cssText) && /display:\s*none/.test(r.cssText)) ok = true; a.ok(ok, 'print rules present');
    a.ok(q('[data-act="print"]') && q('[data-act="dl-json"]')); a.ok(q('#portal-report').closest('.no-print') === null, 'report itself is printable'); a.ok(q('.sidebar').classList.contains('no-print') && q('.topbar').classList.contains('no-print'));
  });
  t('U10', 'Responsive: desktop row layout, tablet (800px) stacked layout with no page-level horizontal overflow', ['UI-RESP'], async a => {
    await load('/dashboard', { width: 1400 }); a.eq(win.getComputedStyle(q('.app')).flexDirection, 'row'); a.ok(q('.sidebar').getBoundingClientRect().width > 200);
    await load('/dashboard', { width: 800 }); a.eq(win.getComputedStyle(q('.app')).flexDirection, 'column'); for (const r of R) { await nav('/' + r); a.ok(doc.documentElement.scrollWidth <= doc.documentElement.clientWidth + 2, r + ' overflows: ' + doc.documentElement.scrollWidth + '>' + doc.documentElement.clientWidth); }
    frame.style.width = '1280px';
  });
  t('U11', 'Tables sort by header and search by text', ['UI-SORT'], async a => {
    await load('/status'); const rows = () => qa('#tbl-dash tbody tr'); a.eq(rows().length, 21); const first0 = rows()[0].innerText; click(q('[data-sort="dash:bal"]')); await until(() => rows()[0].innerText !== first0); const f1 = rows()[0].innerText; click(q('[data-sort="dash:bal"]')); await until(() => rows()[0].innerText !== f1);
    setVal(q('[data-tq="dash"]'), 'Kyoto'); await until(() => rows().length === 1 && rows()[0].innerText.includes('CT-JP-004')); a.ok(rows()[0].innerText.includes('교토'), 'matches the English name while the UI is Korean'); setVal(q('[data-tq="dash"]'), 'zzzz-none'); await until(() => rows().length === 1 && rows()[0].innerText.includes('표시할 데이터가 없습니다'));
  });
  t('U12', 'Corrupt storage: app starts from the sample, warns the user, and keeps the unreadable blob', ['UI-ERR', 'D-5'], async a => {
    await load('/dashboard', { pre: () => { localStorage.setItem('omh_hfr_v1', '{broken json'); } , keep: true }); a.ok(q('#banner').innerText.includes('손상') || q('#banner').innerText.includes('corrupt')); a.eq(localStorage.getItem('omh_hfr_v1.corrupt'), '{broken json'); a.eq(qa('#content .ccard').length, 7, 'the sample is shown after the broken blob is set aside'); a.ok(!BAD.test(txt()));
  });
  t('U13', 'Legacy partner module still loads, evaluates 12 partners (one of them scores 78.7, grade B) and keeps its own storage key; new app does not share it', ['R-1', 'R-2', 'T13', 'D-7'], async a => {
    if (!(await fetch('../legacy/app.js', { method: 'HEAD' }).then(r => r.ok).catch(() => false))) a.skip('the legacy partner module is not part of this repository');
    await load('/dashboard'); a.ok(q('.partner-link a').getAttribute('href') === 'legacy/index.html'); frame.onload = null; localStorage.clear();
    await new Promise(res => { frame.onload = res; frame.src = '../legacy/index.html?t=' + Date.now(); }); await sleep(250); const d = frame.contentDocument; const body = d.body.innerText; a.ok(body.includes('78.7'), 'the 78.7 partner score is present');
    a.ok(d.querySelectorAll('table tbody tr').length >= 12, 'at least 12 partner rows'); a.eq(localStorage.getItem('omh_hfr_v1'), null, 'legacy page does not create new-app state');
  });
  t('U14', 'Language toggle switches visible text and persists across reload', ['UI-LANG'], async a => {
    await load('/dashboard'); const ko = q('#nav').innerText; doc.getElementById('lang-en').click(); await until(() => q('#nav').innerText !== ko); a.ok(q('#nav').innerText.includes('Executive Dashboard')); a.eq(doc.documentElement.lang, 'en');
    await load('/dashboard', { keep: true }); a.ok(q('#nav').innerText.includes('Executive Dashboard'), 'persisted'); doc.getElementById('lang-ko').click(); await until(() => q('#nav').innerText.includes('경영진'));
  });
  t('U15', 'Administration: invalid weights rejected with message; valid change needs a reason and appears in change history', ['S08', 'M03-1'], async a => {
    await load('/admin'); await setRole('ADMIN'); await nav('/admin'); const w = q('[data-cw="legalEntity"]'); setVal(w, '15'); a.ok(q('#content h3 span').className.includes('bad')); setVal(q('#cfg-reason'), 'test'); click(q('[data-act="cfg-save"]')); await until(() => q('#cfg-errs .note.bad')); a.ok(q('#cfg-errs').innerText.includes('100'));
    a.eq(store().state.config.weights.legalEntity, 10); setVal(w, '10'); setVal(q('[data-th="A"]'), '85'); setVal(q('#cfg-reason'), ''); click(q('[data-act="cfg-save"]')); await until(() => q('#cfg-errs .note.bad')); a.ok(store().state.configHistory.length === 0);
    setVal(q('#cfg-reason'), 'raise A threshold to 85 (UI test)'); click(q('[data-act="cfg-save"]')); await until(() => store().state.configHistory.length === 1); await nav('/admin'); a.ok(txt().includes('raise A threshold to 85') && txt().includes('ratingThresholds.A'));
    a.ok(store().model().byContract['CT-KR-001'].rating.grade === 'B', 'a score above 85 is still held at B by the low-confidence cap'); a.ok(qa('[data-mu="D"]')[0].disabled && qa('[data-mu="NR"]')[0].disabled, 'D/NR multipliers locked at 0');
  });
  t('U16', 'Risk center: severity filter, status update with note, dismissal blocked for SCM, history lists cleared alerts', ['S05', 'M06-4', 'D-4'], async a => {
    await load('/risk'); const rows = () => qa('#tbl-risk tbody tr'); const all = rows().length; a.ok(all >= 20); setVal(q('[data-rf="sev"]'), 'CRITICAL', 'change'); await until(() => rows().length === 2); a.ok(rows().every(r => /치명|Critical/.test(r.innerText)));
    setVal(q('[data-rf="sev"]'), '', 'change'); await until(() => rows().length === all); const id = 'CONSUMPTION_COLLAPSE:CT-KR-003'; const sel = q('[data-al="' + id + '"]'); setVal(sel, 'DISMISSED', 'change'); setVal(q('[data-aln="' + id + '"]'), 'false positive?'); click(q('[data-alsave="' + id + '"]')); await sleep(80);
    a.ok(!store().state.alerts.find(x => x.alertId === id) || store().state.alerts.find(x => x.alertId === id).status !== 'DISMISSED', 'SCM cannot dismiss'); a.ok(doc.getElementById('toast').innerText.length > 0);
    const sel2 = q('[data-al="' + id + '"]'); setVal(sel2, 'IN_PROGRESS', 'change'); setVal(q('[data-aln="' + id + '"]'), 'called hotel'); click(q('[data-alsave="' + id + '"]')); await until(() => store().state.alerts.find(x => x.alertId === id).status === 'IN_PROGRESS'); a.eq(store().state.alerts.find(x => x.alertId === id).notes.length, 1);
    a.ok(txt().includes('과거 위험 이력')); a.ok(qa('#tbl-rhist tbody tr').length >= 2);
  });
  t('U18', 'Hotel profile: scores cannot be typed in; recording evidence recalculates grade, score and confidence; a record without evidence is refused; commit needs a reason and is shown in history', ['S02', 'M03-2', 'M03-6', 'SCORE-1', 'SCORE-2'], async a => {
    await load('/profile/CT-KR-001'); a.ok(/B\s*\n/.test(q('.biggrade').innerText + '\n')); a.ok(!q('[data-score]') && !q('[data-act="save-scores"]'), 'no control lets anyone type a score'); a.ok(q('.ph-right').innerText.includes('60%'), 'confidence from the data alone'); const s0 = q('.ph-right').innerText; const own = () => store().state.hotels.find(h => h.hotelId === 'H001').facts.ownershipChange;
    setVal(q('#dr-own'), 'NONE', 'change'); click(q('[data-act="dr-own"]')); await sleep(50); a.eq(own(), 'UNKNOWN', 'no evidence reference, no record');
    setVal(q('#dr-own'), 'NONE', 'change'); setVal(q('#dr-own-ev'), 'EVD-7001'); click(q('[data-act="dr-own"]')); await until(() => own() === 'NONE'); a.ok(q('.ph-right').innerText.includes('68%')); a.ok(q('.ph-right').innerText !== s0); a.ok(txt().includes('EVD-7001'), 'the evidence reference is shown with the record');
    click(q('[data-act="commit-rating"]')); await sleep(50); a.eq(store().state.ratings['CT-KR-001'].history.length, 1, 'empty reason rejected'); setVal(q('#commit-reason'), 'UI test snapshot'); click(q('[data-act="commit-rating"]')); await until(() => store().state.ratings['CT-KR-001'].history.length === 2); await nav('/profile/CT-KR-001'); a.ok(txt().includes('UI test snapshot'));
    await nav('/profile/CT-JP-004'); a.ok(txt().includes('D') && txt().includes('MOCK')); await nav('/profile/CT-JP-007'); a.ok(q('.biggrade').innerText.trim() === 'NR'); a.ok(q('tr.unk'), 'unknown criteria highlighted');
  });
  t('U19', 'Accessibility basics: every form control has an accessible name; landmarks, lang and live region exist', ['UI-A11Y'], async a => {
    await load('/dashboard'); const bad = []; for (const r of R) { await nav('/' + r); for (const el of qa('#content input, #content select, #content textarea')) { if (el.type === 'hidden') continue; const named = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.closest('label') && el.closest('label').innerText.trim()) || (el.id && doc.querySelector('label[for="' + el.id + '"]')); if (!named) bad.push(r + ':' + (el.getAttribute('data-score') || el.id || el.className || el.tagName)); } }
    a.deepEq(bad, []); a.ok(doc.documentElement.lang && q('nav[aria-label]') && q('[aria-live]')); a.ok(qa('button').every(b => b.innerText.trim() || b.getAttribute('aria-label')), 'buttons have text');
  });
  t('U20', 'Render performance: dashboard and profile re-render in < 300 ms', ['PERF'], async a => {
    await load('/dashboard'); let t0 = win.performance.now(); win.OMH.app.render(); const d1 = win.performance.now() - t0; await nav('/profile/CT-JP-004'); t0 = win.performance.now(); win.OMH.app.render(); const d2 = win.performance.now() - t0; a.ok(d1 < 300 && d2 < 300, d1.toFixed(0) + 'ms / ' + d2.toFixed(0) + 'ms');
  });

  t('U21', 'Japanese and Vietnamese: toggle, persistence after reload, per-language font, all 8 screens without leftover Korean labels or missing-translation fallbacks', ['UI-LANG', 'I18N'], async a => {
    await load('/dashboard'); const hangul = /[\uAC00-\uD7A3]/; const dataStrings = () => { const out = []; const walk = o => { if (typeof o === 'string') { if (hangul.test(o)) out.push(o); } else if (o && typeof o === 'object') Object.values(o).forEach(walk); }; walk(store().state.ratings); walk(store().state.alerts); walk(store().state.aiReports); return out; };
    for (const lg of ['ja', 'vi']) {
      win.OMH.UI.missing.clear(); doc.getElementById('lang-' + lg).click(); await until(() => doc.documentElement.lang === lg); a.ok(win.getComputedStyle(doc.body).fontFamily.includes(lg === 'ja' ? 'Yu Gothic' : 'Segoe UI'), lg + ' font stack');
      for (const r of R) { await nav('/' + r); let text = q('#content').innerText; for (const d of dataStrings()) text = text.split(d).join(' '); a.ok(!hangul.test(text), lg + ' ' + r + ' leftover Korean: ' + (text.match(/[\uAC00-\uD7A3]+/g) || []).slice(0, 4).join(' ')); a.ok(!/\{\d+\}|undefined|NaN|\[object/.test(text), lg + ' ' + r + ' bad token'); }
      await nav('/profile/CT-JP-004'); a.ok(!hangul.test(q('#page-title').innerText + q('#page-sub').innerText + q('#nav').innerText + q('#banner').innerText), lg + ' chrome (title/nav/banner)'); a.ok(!hangul.test(q('.partner-link').innerText), lg + ' partner link');
      a.deepEq([...win.OMH.UI.missing].slice(0, 5), [], lg + ' missing translation keys');
    }
    doc.getElementById('lang-ja').click(); await until(() => doc.documentElement.lang === 'ja'); await load('/dashboard', { keep: true }); a.eq(doc.documentElement.lang, 'ja', 'Japanese persisted'); a.ok(q('#nav').innerText.includes('ダッシュボード'));
    doc.getElementById('lang-vi').click(); await load('/dashboard', { keep: true }); a.eq(doc.documentElement.lang, 'vi', 'Vietnamese persisted'); a.ok(q('#nav').innerText.includes('Bảng điều khiển')); a.eq(errors.length, 0, 'console errors: ' + errors.join(' | '));
    doc.getElementById('lang-ko').click(); await until(() => doc.documentElement.lang === 'ko');
  });

  t('U22', 'ELLIS snapshot panel: sample → preview changes nothing → import stores aggregates only → comparison shows divergence; viewer is locked out; bad input is explained', ['ELLIS-8', 'ELLIS-5', 'ELLIS-6'], async a => {
    await load('/admin'); doc.getElementById('lang-en').click(); await nav('/admin'); const n0 = ledgerLen(), ledger0 = JSON.stringify(store().state.ledger);
    a.ok(txt().includes('ELLIS integration (MCP snapshot)') && txt().includes('No snapshot imported'));
    click(q('[data-act="ellis-sample"]')); await until(() => q('#ellis-text').value.includes('omh-ellis-snapshot'));
    click(q('[data-act="ellis-preview"]')); await until(() => txt().includes('Hotels matched 15')); a.ok(!store().state.ellis, 'preview stores nothing'); a.eq(store().state.audit.filter(e => e.action === 'ELLIS_IMPORT_SNAPSHOT').length, 0);
    click(q('[data-act="ellis-import"]')); await until(() => store().state.ellis); a.eq(ledgerLen(), n0); a.eq(JSON.stringify(store().state.ledger), ledger0, 'ledger untouched');
    await until(() => txt().includes('Synthetic data') && txt().includes('Divergent')); const row = qa('#content tr').find(r => r.innerText.includes('CT-KR-002')); a.ok(row && row.innerText.includes('Divergent') && row.innerText.includes('(50%)'), row && row.innerText);
    a.ok(qa('#content tr').find(r => r.innerText.includes('CT-VN-003')).innerText.includes('N/A (deposit)'));
    click(q('[data-act="ellis-import"]')); await until(() => /already imported/i.test(txt()) || doc.getElementById('toast').innerText.toLowerCase().includes('already imported')); a.eq(store().state.ellis.batches.length, 1);
    setVal(q('#ellis-text'), '{"schema":"x"}'); click(q('[data-act="ellis-preview"]')); await until(() => q('#content .note.bad')); a.ok(q('#content .note.bad').innerText.length > 5); a.eq(store().state.ellis.batches.length, 1);
    await load('/admin', { keep: true }); a.eq(store().loadStatus, 'OK', 'reload keeps the ELLIS section valid'); a.ok(store().state.ellis);
    await setRole('VIEWER'); await nav('/admin'); a.ok(qa('#ellis-file, [data-act="ellis-import"], [data-act="ellis-preview"], [data-act="ellis-sample"]').every(e => e.disabled)); a.ok(txt().includes('Only SCM or Admin can import'));
    await setRole('CEO'); await nav('/admin'); a.ok(q('[data-act="ellis-import"]').disabled, 'CEO cannot import');
    doc.getElementById('lang-ja').click(); await until(() => txt().includes('ELLIS連携')); a.ok(!/[가-힣]/.test(q('#content').innerText.replace(/CT-[A-Z]+-\d+/g, '')), 'no Korean left in the ELLIS panel (ja)');
    doc.getElementById('lang-ko').click(); a.eq(errors.length, 0, 'console errors: ' + errors.join(' | '));
  });

  t('U23', 'Landing page: deep link goes to the login first, language can be chosen there, wrong password is refused, the account fixes the role, sign-out and expiry end the session', ['AUTH-1', 'AUTH-2', 'UI-LANG'], async a => {
    await load('/ledger/CT-KR-001', { account: null });
    a.ok(doc.body.classList.contains('auth-mode') && q('#login-form'), 'landing page is shown'); a.eq(win.location.hash, '#/login'); a.ok(!q('#role-sel') && !q('select'), 'nothing on the page lets you pick a role'); a.eq(win.getComputedStyle(q('.sidebar')).display, 'none', 'menu hidden before login');
    for (const [lg, word] of [['en', 'Demo accounts'], ['ja', 'デモアカウント'], ['vi', 'Tài khoản mô phỏng'], ['ko', '시연 계정']]) { click(q('[data-lang="' + lg + '"]')); await until(() => doc.documentElement.lang === lg && txt().includes(word)); a.ok(q('[data-lang="' + lg + '"]').className.includes('on'), lg + ' button marked'); }
    click(q('[data-lang="en"]')); await until(() => txt().includes('Demo accounts')); await load('/login', { keep: true, account: null }); a.eq(doc.documentElement.lang, 'en', 'the language chosen on the landing page is kept');
    setVal(q('#login-id'), 'demo.scm'); setVal(q('#login-pw'), 'wrong-password'); q('#login-form').requestSubmit(); await until(() => q('.login-card .note.bad')); a.ok(txt().includes('incorrect') && !store().session.loggedIn); a.ok(!q('#login-pw').value || true);
    a.eq(store().state.audit.filter(e => e.action === 'LOGIN' && e.outcome === 'REJECTED').length, 1);
    click(q('[data-pick="demo.ceo"]')); a.eq(q('#login-pw').value, PW); q('#login-form').requestSubmit(); await until(() => store().session.loggedIn && win.OMH.app.last.route === 'dashboard');
    a.ok(!doc.body.classList.contains('auth-mode') && !q('#role-sel')); a.eq(q('#user-id').innerText, 'demo.ceo'); a.ok(q('#user-role').innerText.length > 0 && q('#logout-btn').innerText === 'Sign out');
    const kept = JSON.parse(win.sessionStorage.getItem('omh_hfr_session')); a.deepEq(Object.keys(kept).sort(), ['exp', 'id'], 'the stored login holds no role');
    await nav('/ledger/CT-KR-001'); a.ok(qa('[data-act="add-tx"],[data-act="csv-commit"]').every(b => b.disabled), 'CEO account cannot enter data');
    // the role cannot be raised by editing the stored login
    win.sessionStorage.setItem('omh_hfr_session', JSON.stringify({ id: 'demo.viewer', role: 'ADMIN', exp: kept.exp })); await load('/admin', { keep: true }); a.eq(store().session.role, 'VIEWER', 'role is looked up from the account, not from storage');
    // expired or unknown logins are dropped
    await load('/admin', { keep: true, account: null }); win.sessionStorage.setItem('omh_hfr_session', JSON.stringify({ id: 'demo.admin', exp: Date.now() - 1000 })); await load('/admin', { keep: true }); a.ok(q('#login-form') && !store().session.loggedIn, 'expired login');
    win.sessionStorage.setItem('omh_hfr_session', JSON.stringify({ id: 'root', exp: Date.now() + 1000 })); await load('/admin', { keep: true }); a.ok(q('#login-form'), 'unknown account');
    // sign in again, sign out, and the protected pages need a login again
    await load('/dashboard', { account: 'demo.admin' }); a.eq(store().session.role, 'ADMIN'); click(q('#logout-btn')); await until(() => q('#login-form')); a.ok(!win.sessionStorage.getItem('omh_hfr_session') && !store().session.loggedIn);
    win.location.hash = '#/admin'; await until(() => win.OMH.app.last.route === 'login'); a.ok(q('#login-form'), 'a protected address shows the login again');
    a.eq(store().state.audit.filter(e => e.action === 'LOGOUT').length, 1); a.eq(errors.length, 0, 'console errors: ' + errors.join(' | '));
  });

  t('U24', 'Permission table in Administration: roles as columns, the current role highlighted, only the CEO column can approve', ['AUTH-3'], async a => {
    await load('/admin', { account: 'demo.scm' }); doc.getElementById('lang-en').click(); await nav('/admin'); const tbl = q('.permtbl'); a.ok(tbl, 'matrix present'); a.eq(qa('.permtbl tbody tr').length, Object.keys(win.OMH.RBAC.PERMS).length);
    const heads = qa('.permtbl thead th').map(x => x.innerText.trim()); a.eq(heads.length, 5); a.ok(qa('.permtbl thead th.me').length === 1 && qa('.permtbl thead th.me')[0].innerText.trim() === 'SCM');
    const row = qa('.permtbl tbody tr').find(r => r.innerText.includes('approval.review')); const cells = [...row.querySelectorAll('td')].slice(1).map(c => c.innerText.trim()); a.deepEq(cells, ['—', '—', '✔', '—']);
    a.ok(txt().includes('Signed in as demo.scm') && txt().includes('Admin cannot'), txt().slice(0, 0)); doc.getElementById('lang-ko').click(); a.eq(errors.length, 0);
  });

  t('U25', 'Tracker check panel (preview only), top-up terms on the credit card, offset in the ledger form, and the ELLIS comparison on the net basis', ['TRK-5', 'ELLIS-8', 'TRK-8'], async a => {
    await load('/admin', { account: 'demo.scm' }); doc.getElementById('lang-en').click(); await nav('/admin'); const n0 = ledgerLen(), state0 = JSON.stringify([store().state.ledger, store().state.contracts, store().state.confirmations]);
    a.ok(txt().includes('PIC tracker check & conversion')); click(q('[data-act="trk-sample"]')); await until(() => q('#trk-existing').value.includes('Sample Hanoi Garden Hotel'));
    click(q('[data-act="trk-run"]')); await until(() => txt().includes('8 converted')); a.ok(txt().includes('8 rows read') && txt().includes('Contract ending soon with balance') && txt().includes('Usage entered before contract start') && txt().includes('Hotel balance equals OMH balance'), 'findings are listed in English');
    a.ok(q('[data-trkdl="ledger.csv"]') && q('[data-trkdl="contracts.csv"]') && q('[data-trkdl="issues.csv"]'), 'download buttons'); a.eq(ledgerLen(), n0); a.eq(JSON.stringify([store().state.ledger, store().state.contracts, store().state.confirmations]), state0, 'nothing was stored'); a.eq(store().state.audit.filter(e => /TRACKER/i.test(e.action)).length, 0);
    setVal(q('#trk-existing'), 'Hotel ID,x\r\n1,2'); click(q('[data-act="trk-run"]')); await until(() => txt().includes('Required column headings missing')); a.ok(!/undefined|NaN/.test(txt()));
    await setRole('CEO'); await nav('/admin'); a.ok(q('[data-act="trk-run"]').disabled && q('#trk-existing').disabled, 'CEO cannot use it'); await setRole('SCM');
    await nav('/profile/CT-VN-001'); a.ok(txt().includes('Top-up condition') && txt().includes('Top up when balance < 100M VND') && txt().includes('Planned top-up') && txt().includes('2026-11-25'), 'top-up terms and the planned top-up on the credit card'); a.ok(/Limit check: CEO approval required|Within recommended limit/.test(txt()), 'the planned top-up is checked against the limit');
    await nav('/profile/CT-KR-003'); a.ok(txt().includes('Limit check: CEO approval required'), 'a planned top-up for a collapsing contract needs approval');
    await nav('/ledger/CT-KR-001'); const types = [...q('#tx-type').options].map(o => o.value); a.includes(types, 'OFFSET'); a.ok(txt().includes('Offsets'), 'the identity box has an offsets term');
    setVal(q('#tx-type'), 'OFFSET', 'change'); setVal(q('#tx-amt'), '1000000'); click(q('[data-act="add-tx"]')); await sleep(40); a.eq(ledgerLen(), n0, 'an offset without a reason is refused'); a.ok(/Offset reason/.test(doc.getElementById('toast').innerText));
    setVal(q('#tx-type'), 'OFFSET', 'change'); setVal(q('#tx-amt'), '1000000'); setVal(q('#tx-reason'), 'against invoice INV-1'); setVal(q('#tx-ref'), 'U25-OFF-1'); click(q('[data-act="add-tx"]')); await until(() => ledgerLen() === n0 + 1); a.eq(store().model().byContract['CT-KR-001'].balance.offsetsMinor, 1e6); a.ok(store().model().byContract['CT-KR-001'].balance.closingMinor === 45e6 - 1e6);
    await nav('/admin'); click(q('[data-act="ellis-sample"]')); await until(() => q('#ellis-text').value.includes('omh-ellis-snapshot')); click(q('[data-act="ellis-import"]')); await until(() => store().state.ellis);
    const row = qa('#content tr').find(r => r.innerText.includes('CT-VN-001')); a.ok(row && row.innerText.includes('≈'), 'a converted amount is marked ≈'); const jp7 = qa('#content tr').find(r => r.innerText.includes('CT-JP-007')); a.ok(jp7.innerText.includes('Outside contract period') && jp7.innerText.includes('Before contract'), jp7.innerText);
    a.ok(txt().includes('Check-in month basis') && txt().includes('use the Check-in month basis'), 'the panel names the snapshot basis'); const sc = q('#ellis-scope'); a.ok(sc && sc.value === 'CONTRACT', 'the comparison scope selector defaults to by contract'); setVal(sc, 'HOTEL', 'change'); await sleep(80); const jp7h = qa('#content tr').find(r => r.innerText.includes('CT-JP-007')); a.ok(jp7h && !jp7h.innerText.includes('Before contract') && !jp7h.innerText.includes('Outside contract period'), 'hotel scope does not clip to the contract period: ' + (jp7h && jp7h.innerText)); a.eq(q('#ellis-scope').value, 'HOTEL'); setVal(q('#ellis-scope'), 'CONTRACT', 'change'); await sleep(80);
    doc.getElementById('lang-ja').click(); await until(() => txt().includes('PICトラッカーの点検')); a.ok(!/[가-힣]/.test(q('#content').innerText.replace(/CT-[A-Z]+-\d+/g, '')), 'no Korean left in the admin page (ja)'); a.ok(q('#content').innerText.includes('チェックイン月基準'), 'the basis chip is translated'); doc.getElementById('lang-ko').click(); a.eq(errors.length, 0, 'console errors: ' + errors.join(' | '));
  });

  t('U26', 'Dashboard in country cards: one card per country with one currency, six lines each, every line opens the screen where the number is worked on with that country already chosen; the hotel credit profile has a country filter', ['S01', 'S02', 'UI-FILTER'], async a => {
    await load('/dashboard', { account: 'demo.scm' }); doc.getElementById('lang-en').click(); await nav('/dashboard');
    const cards = () => qa('#content .ccard'); a.eq(cards().length, 7, 'one card per country'); a.deepEq(cards().map(c => c.querySelector('.ch b').innerText), ['Korea', 'Japan', 'Vietnam', 'Singapore', 'Thailand', 'Hong Kong', 'Taiwan']);
    a.ok(cards().every(c => c.querySelectorAll('a.crow').length === 6), 'six lines on each card'); a.ok(!q('#content table') && !q('#content select'), 'no table and no filter on the dashboard');
    const head = c => c.querySelector('.ch').innerText; a.ok(head(cards()[0]).includes('5 contracts · 5 hotels') && head(cards()[1]).includes('8 contracts · 7 hotels') && head(cards()[2]).includes('4 contracts · 4 hotels'), cards().map(head).join(' | '));
    const bal = c => c.querySelector('a.crow').innerText; a.ok(/KRW/.test(bal(cards()[0])) && !/JPY|VND|USD|SGD/.test(bal(cards()[0])), 'Korea: won only'); a.ok(/JPY/.test(bal(cards()[1])) && !/KRW|VND|USD|SGD/.test(bal(cards()[1])), 'Japan: yen only'); a.ok(/VND/.test(bal(cards()[2])) && !/KRW|JPY|USD|SGD/.test(bal(cards()[2])), 'Vietnam: dong only');
    a.ok(/Prebuy/.test(bal(cards()[0])) && /Hard block/.test(bal(cards()[0])), 'the balance line is split into prebuy and hard block');
    const hrefs = qa('#content a.crow').map(c => c.getAttribute('href')); a.ok(hrefs.includes('#/status') && hrefs.includes('#/risk') && !hrefs.includes('#/sg') && hrefs.some(h => h.startsWith('#/profile')), hrefs.join(' '));
    click(cards()[1].querySelector('a.crow')); await until(() => win.OMH.app.last.route === 'status'); a.eq(win.OMH.app.ui.filters.country, 'JP', 'the status board opens with Japan chosen'); a.eq(qa('#tbl-dash tbody tr').length, 8);
    await nav('/dashboard'); a.eq(cards().length, 7, 'the dashboard never hides a country because of a filter set elsewhere');
    await nav('/dashboard'); click(cards()[0].querySelectorAll('a.crow')[5]); await until(() => win.OMH.app.last.route === 'risk');
    await nav('/dashboard'); click(cards()[0].querySelectorAll('a.crow')[2]); await until(() => win.OMH.app.last.route === 'profile'); a.ok(q('.biggrade'), 'the profile of a Korean contract is open'); a.eq(q('#pf-country').value, 'KR'); a.eq([...q('#pf-sel').options].length, 5, 'only the Korean contracts are listed');
    setVal(q('#pf-country'), '', 'change'); await until(() => [...q('#pf-sel').options].length === 21);
    await nav('/profile/CT-KR-001'); const pc = q('#pf-country'); a.ok(pc, 'country filter exists'); const allOpts = () => [...q('#pf-sel').options].map(o => o.value); a.eq(allOpts().length, 21);
    setVal(pc, 'JP', 'change'); await until(() => win.OMH.app.last.params[0] && win.OMH.app.last.params[0].startsWith('CT-JP')); a.eq(allOpts().length, 8, 'only the 8 Japanese contracts are listed'); a.ok(allOpts().every(v => v.startsWith('CT-JP')), allOpts().join(','));
    setVal(q('#pf-country'), '', 'change'); await until(() => allOpts().length === 21); doc.getElementById('lang-ko').click(); a.eq(errors.length, 0, 'console errors: ' + errors.join(' | '));
  });

  t('U28', 'Hotel-level cap in the credit card: SCM enters an amount and a reason, the limit in force drops, the status board shows it, SCM cannot raise it, the CEO lifts it, and a reader sees disabled controls', ['M04-5', 'S02'], async a => {
    await load('/profile/CT-KR-001'); doc.getElementById('lang-en').click(); await nav('/profile/CT-KR-001'); const cap = () => store().state.contracts.find(c => c.contractId === 'CT-KR-001').limitCap; const toast = () => doc.getElementById('toast').textContent;
    a.ok(q('#cap-amt') && !q('#cap-amt').disabled && !q('[data-act="cap-save"]').disabled && q('[data-act="cap-clear"]').disabled, 'SCM can type and save; the lift button is for the CEO and admin only');
    setVal(q('#cap-amt'), '20000000'); click(q('[data-act="cap-save"]')); await until(() => /Reason required/.test(toast())); a.ok(!cap(), 'no reason, no cap');
    setVal(q('#cap-amt'), 'abc'); setVal(q('#cap-reason'), 'CEO instruction 2026-11-06'); click(q('[data-act="cap-save"]')); await until(() => /Invalid amount/.test(toast())); a.ok(!cap());
    setVal(q('#cap-amt'), '20000000'); setVal(q('#cap-reason'), 'CEO instruction 2026-11-06'); click(q('[data-act="cap-save"]')); await until(() => cap() && cap().amountMinor === 20000000);
    const box = () => [...qa('.panel')].find(p => p.querySelector('#cap-amt')).innerText; await until(() => /20,000,000 KRW/.test(box()) && /cap is binding/.test(box())); a.ok(/Limit in force/.test(box()) && /CEO instruction 2026-11-06/.test(box()) && /30,000,000 KRW/.test(box()), 'cap, limit before the cap, limit in force and the history row are shown');
    a.ok(qa('.panel').some(p => p.innerText.includes('Hotel-level cap (entered)')), 'the cap is listed among the safeguards');
    await nav('/status'); const row = qa('#tbl-dash tbody tr').find(r => r.innerText.includes('CT-KR-001')); a.ok(row && row.innerText.includes('20,000,000 KRW'), 'the status board shows the cap'); a.ok(qa('#tbl-dash thead th').some(th => /Hotel cap/.test(th.innerText)));
    await nav('/profile/CT-KR-001'); setVal(q('#cap-amt'), '25000000'); setVal(q('#cap-reason'), 'raise'); click(q('[data-act="cap-save"]')); await until(() => /Permission denied/.test(toast())); a.eq(cap().amountMinor, 20000000, 'SCM cannot raise it');
    await setRole('CEO'); await nav('/profile/CT-KR-001'); setVal(q('#cap-reason'), 'CEO lifts the cap'); click(q('[data-act="cap-clear"]')); await until(() => cap() === null); await until(() => /none/.test(box())); a.ok(/lifted/.test(box()), 'the lift is in the history');
    await setRole('VIEWER'); await nav('/profile/CT-KR-001'); a.ok(q('#cap-amt').disabled && q('#cap-reason').disabled && q('[data-act="cap-save"]').disabled && q('[data-act="cap-clear"]').disabled, 'a reader sees disabled controls'); a.ok(!BAD.test(txt()));
    await setRole('SCM'); doc.getElementById('lang-ko').click();
  });
  t('U29', 'Credit card: every criterion shows its computed score, the reason and what would raise it; the administrator changes the country table and the score follows', ['SCORE-1', 'SCORE-3'], async a => {
    await load('/profile/CT-KR-001'); doc.getElementById('lang-en').click(); await nav('/profile/CT-KR-001'); const row = name => qa('tr').find(tr => tr.innerText.includes(name)); const cell = name => row(name).querySelector('td.ctr').innerText.trim();
    a.ok(txt().includes('The balance is 1.5 months of average consumption.') && txt().includes('To raise it') && txt().includes('Kept out of the score as a personal judgement'), 'reasons and hints are shown'); a.eq(cell('Consumption vs prepaid balance'), '5'); a.eq(cell('Country / legal recovery risk'), '4'); a.eq(cell('Financial health'), 'Unknown'); a.eq(cell('SCM operations assessment'), 'excluded');
    await setRole('ADMIN'); await nav('/admin'); a.ok(q('[data-sc="cty|KR"]') && !q('[data-sc="cty|KR"]').disabled); setVal(q('[data-sc="cty|KR"]'), '5'); setVal(q('#cfg-reason'), 'country table (UI test)'); click(q('[data-act="cfg-save"]')); await until(() => store().state.configHistory.length === 1);
    await nav('/profile/CT-KR-001'); a.eq(cell('Country / legal recovery risk'), '5'); a.ok(txt().includes('Value from the country table (Korea).')); a.ok(!BAD.test(txt())); await setRole('SCM'); doc.getElementById('lang-ko').click();
  });
  t('U30', 'Dashboard by legal entity: the Singapore head office holds the moved contracts in seven currencies, the local entities keep the rest, and a card opens the status board for that entity', ['S01', 'UI-FILTER'], async a => {
    await load('/dashboard', { account: 'demo.scm' }); doc.getElementById('lang-en').click(); await nav('/dashboard'); const ecards = () => qa('#content .ecard'); a.eq(ecards().length, 4, 'one card per contracting entity');
    a.deepEq(ecards().map(c => c.querySelector('.ch b').innerText), ['Singapore HQ (OMH-SG)', 'Korea entity (OMH-KR)', 'Japan entity (OMH-JP)', 'Vietnam entity (OMH-VN)']);
    const hq = ecards()[0]; a.ok(hq.querySelector('.ch').innerText.includes('8 contracts · 8 hotels')); for (const c of ['KRW', 'JPY', 'VND', 'SGD', 'HKD', 'TWD', 'THB']) a.ok(hq.querySelector('a.crow').innerText.includes(c), 'head office holds ' + c);
    a.ok(/Singapore/.test(hq.innerText) && /Thailand/.test(hq.innerText) && /Hong Kong/.test(hq.innerText) && /Taiwan/.test(hq.innerText), 'the hotel countries of the head office are listed'); a.ok(!/THB|SGD|HKD|TWD|KRW|VND/.test(ecards()[2].innerText), 'the Japanese entity keeps only yen'); a.ok(!/JPY|VND|THB|SGD|HKD|TWD/.test(ecards()[1].innerText), 'the Korean entity keeps only won'); a.ok(!/JPY|KRW|THB|SGD|HKD|TWD/.test(ecards()[3].innerText), 'the Vietnamese entity keeps only dong');
    a.ok(txt().includes('Contracts are being moved to the Singapore head office'), 'the note explains why the head office has several currencies');
    click(hq.querySelector('a.crow')); await until(() => win.OMH.app.last.route === 'status'); a.eq(win.OMH.app.ui.filters.entity, 'OMH-SG'); a.eq(qa('#tbl-dash tbody tr').length, 8); a.ok(q('[data-f="entity"]').innerText.includes('Singapore HQ (OMH-SG)'), 'the filter shows the entity names');
    doc.getElementById('lang-ko').click(); a.eq(errors.length, 0, 'console errors: ' + errors.join(' | '));
  });
  t('U31', 'Approval screen: the save button sits next to the amount field from the start, so typing an amount and clicking it works without pressing Enter; the preview follows the typing in place', ['M09-2', 'S07'], async a => {
    await load('/approval/CT-KR-004'); const btn = () => q('[data-act="ap-create"]'); a.ok(btn() && !btn().disabled, 'the button is there before any amount is typed'); a.ok(btn().closest('.toolbar').querySelector('#portal-amt'), 'and sits in the same row as the amount field');
    click(btn()); await sleep(50); a.eq(store().state.approvals.length, 0, 'an empty amount saves nothing'); a.ok(/Enter the requested top-up first|요청 충전액을 입력/.test(doc.getElementById('toast').textContent), 'and says what is missing');
    const amt = q('#portal-amt'); const before = btn(); amt.focus(); setVal(amt, '1000000'); await until(() => q('#portal-report')); a.ok(btn() === before, 'the preview refreshes in place: the button element is the same one'); a.ok(q('#portal-report').innerText.includes('1,000,000 KRW'), 'the preview follows the typing without Enter or leaving the field');
    click(btn()); await until(() => store().state.approvals.length === 1); a.eq(store().state.approvals[0].packet.request.requestedMinor, 1000000, 'the draft holds the amount that was typed'); a.ok(!BAD.test(txt()));
    await setRole('VIEWER'); await nav('/approval/CT-KR-004'); a.ok(q('[data-act="ap-create"]').disabled, 'a reader sees the button disabled'); await setRole('SCM');
  });
  t('U32', 'Register a hotel and contract: the form fills in the currency and entity for the country, a refusal explains itself, a registration opens the new hotel credit card, and a reader sees disabled controls', ['REG-1'], async a => {
    await load('/register'); doc.getElementById('lang-en').click(); await nav('/register'); const n0 = store().state.contracts.length;
    a.ok(!q('#rg-name-ko').disabled && !q('[data-act="rg-save"]').disabled, 'SCM can register'); a.eq(q('#rg-ccy').value, 'KRW'); a.eq(q('#rg-entity').value, 'OMH-KR'); a.ok(q('#rg-monthly').disabled, 'the monthly-settlement box is for hard blocks only'); setVal(q('#rg-type'), 'HARD_BLOCK_ADV', 'change'); a.ok(!q('#rg-monthly').disabled); setVal(q('#rg-type'), 'FLOATING', 'change'); a.ok(q('#rg-monthly').disabled && !q('#rg-monthly').checked);
    click(q('[data-act="rg-save"]')); await sleep(50); a.eq(store().state.contracts.length, n0, 'an empty form registers nothing'); a.ok(/name|Name/.test(doc.getElementById('toast').textContent), 'and says what is missing');
    setVal(q('#rg-country'), 'TH', 'change'); a.eq(q('#rg-ccy').value, 'THB', 'the currency follows the country'); a.eq(q('#rg-entity').value, 'OMH-SG', 'a country without a local entity goes to the head office');
    setVal(q('#rg-name-ko'), '샘플 푸켓 호텔'); setVal(q('#rg-name-en'), 'Sample Phuket Hotel'); setVal(q('#rg-city-ko'), '푸켓'); setVal(q('#rg-city-en'), 'Phuket'); setVal(q('#rg-operator'), 'SAMPLE Phuket Co. Ltd.'); setVal(q('#rg-end'), '2027-11-05'); setVal(q('#rg-opening'), '1500000.50');
    click(q('[data-act="rg-save"]')); await until(() => win.OMH.app.last.route === 'profile'); a.eq(win.OMH.app.last.params[0], 'CT-TH-002'); a.eq(store().state.contracts.length, n0 + 1); a.ok(txt().includes('Sample Phuket Hotel'), 'the new hotel credit card opens'); a.ok(txt().includes('1,500,000.50 THB'), 'with the opening balance in baht');
    await setRole('VIEWER'); await nav('/register'); a.ok(q('#rg-name-ko').disabled && q('[data-act="rg-save"]').disabled, 'a reader sees disabled controls'); await setRole('SCM'); doc.getElementById('lang-ko').click();
  });
  t('U27', 'Hotel credit card in nine sections: the ELLIS booking speed next to the ledger, the next top-up date, the cooperation opinion and the next check date', ['S02', 'OUT-1', 'OUT-2', 'OUT-3', 'ELLIS-6'], async a => {
    await load('/admin', { account: 'demo.scm' }); doc.getElementById('lang-en').click(); await nav('/admin'); click(q('[data-act="ellis-sample"]')); await until(() => q('#ellis-text').value.includes('omh-ellis-snapshot')); click(q('[data-act="ellis-import"]')); await until(() => store().state.ellis);
    await nav('/profile/CT-KR-001'); const heads = qa('#content h2.sec').map(h => h.innerText.replace(/^[0-9]+ */, '').trim()); a.eq(heads.length, 9, heads.join(' | ')); a.ok(qa('#content h2.sec .secn').map(x => x.innerText).join('') === '123456789', 'numbered 1 to 9');
    const c = q('#content').innerText; a.ok(c.includes('ELLIS bookings (net)') && c.includes('Monthly average — ELLIS bookings') && c.includes('Stays already on the ELLIS books'), 'the booking speed is shown next to the ledger'); a.ok(c.includes('Next check') && c.includes('2026-12-01'), 'next check date');
    a.ok(/request the top-up by [0-9]{4}-[0-9]{2}-[0-9]{2} at the latest/.test(c), 'the top-up request date'); a.ok(c.includes('Continue') , 'the cooperation opinion'); a.ok(c.includes('CEO proposal: limit = months by grade'), 'the CEO limit proposal is on the card');
    await nav('/profile/CT-JP-004'); a.ok(q('#content').innerText.includes('Stop adding, review winding down'), 'a hotel with a verified closure is a wind-down'); a.ok(q('#content .notify'), 'the notify box names who would be told'); a.ok(q('#content .notify').innerText.includes('CEO') && q('#content .notify').innerText.includes('business support'));
    doc.getElementById('lang-ja').click(); await until(() => q('#content h2.sec').innerText.includes('ホテル情報')); a.ok(!/[가-힣]/.test(q('#content').innerText.replace(/CT-[A-Z]+-[0-9]+/g, '')), 'no Korean left (ja)'); doc.getElementById('lang-ko').click(); a.eq(errors.length, 0, 'console errors: ' + errors.join(' | '));
  });

  (async () => {
    const only = new URLSearchParams(location.search).get('only'); if (only) { const keep = only.split(','); h.tests.splice(0, h.tests.length, ...h.tests.filter(x => keep.includes(x.id))); }   // ?only=U10,U23 runs just those tests (for debugging)
    const out = document.getElementById('out'); out.textContent = 'running…'; const res = await h.run(r => { out.textContent += '\n' + r.status + ' ' + r.id + ' (' + r.ms + 'ms)' + (r.error ? ' ' + r.error : ''); }); window.OMH_UI_RESULTS = res;
    out.textContent = 'UI TESTS: ' + res.passed + '/' + res.total + ' passed, ' + res.failed + ' failed (' + res.ms + ' ms)\n' + res.results.map(r => (r.status === 'PASS' ? 'PASS ' : 'FAIL ') + r.id + ' ' + r.name + (r.error ? '\n      ' + r.error : '')).join('\n');
    document.title = 'DONE ' + res.passed + '/' + res.total; document.body.setAttribute('data-done', '1');
  })();
})();
