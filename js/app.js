/* App shell: router, role switcher, language toggle, banners, error boundary. */
(function () {
  'use strict';
  const NS = window.OMH, U = NS.UI, { L, esc } = U;
  let storage, storageWarn = false;
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); storage = localStorage; } catch (e) { storage = NS.Store.memoryStorage(); storageWarn = true; }
  const store = NS.Store.createStore({ storage, requireLogin: true });
  const SKEY = 'omh_hfr_session';                      // the login of this browser tab (account id + expiry); the role is looked up again from the account on restore
  const sess = { read() { try { return JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (e) { return null; } }, write(v) { try { sessionStorage.setItem(SKEY, JSON.stringify(v)); } catch (e) { /* tab storage may be blocked: the login then lasts until reload */ } }, clear() { try { sessionStorage.removeItem(SKEY); } catch (e) { /* ignore */ } } };
  { const s = sess.read(); if (s && typeof s === 'object') { if (!store.restoreSession(s.id, s.exp).ok) sess.clear(); } }
  const ui = { filters: {}, riskFilter: {} };
  const ROUTES = [
    { id: 'dashboard', ico: '▦', ko: '경영진 대시보드', en: 'Executive Dashboard', subKo: '플로팅 선급금 위험 한눈에 보기', subEn: 'Floating prepayment risk at a glance', view: NS.ViewsA.dashboard, bind: NS.ViewsA.dashboardBind },
    { id: 'status', ico: '◫', ko: '플로팅 현황판', en: 'Floating Status Board', subKo: '법인·나라별 선급 총액, 등급 분포, 위험 호텔 목록', subEn: 'Prepayment totals by entity and country, grade distribution, high-risk hotels', view: NS.ViewsA.status, bind: NS.ViewsA.statusBind },
    { id: 'profile', ico: '▤', ko: '호텔 신용 카드', en: 'Hotel Credit Profile', subKo: '호텔·계약별 평가, 한도, 위험 신호', subEn: 'Rating, limit and risk signals per hotel contract', view: NS.ViewsA.profile, bind: NS.ViewsA.profileBind },
    { id: 'ledger', ico: '☰', ko: '플로팅 원장', en: 'Floating Ledger', subKo: '충전·소진·반환 이력, 대사, CSV 업로드', subEn: 'Top-ups, consumption, refunds, reconciliation, CSV upload', view: NS.ViewsB.ledger, bind: NS.ViewsB.ledgerBind },
    { id: 'risk', ico: '⚠', ko: '위험 모니터링', en: 'Risk Monitoring Center', subKo: '경보·근거·담당자·조치 상태', subEn: 'Alerts, evidence, owners and handling status', view: NS.ViewsC.risk, bind: NS.ViewsC.riskBind },
    { id: 'register', ico: '＋', ko: '호텔·계약 등록', en: 'Register Hotel & Contract', subKo: '새 호텔과 선급금 계약 등록 (기초 잔액 포함)', subEn: 'Add a hotel and its prepayment contract (with the opening balance)', view: NS.ViewsC.registerPage, bind: NS.ViewsC.registerBind },
    { id: 'approval', ico: '✎', ko: '선급 결재 자료·대표 검토', en: 'Prepayment Approval Packet · CEO Review', subKo: '결재 포털에 붙일 자료와 대표 검토 의견 (모의)', subEn: 'Packet to attach to the portal approval and the CEO review feedback (mock)', view: NS.ViewsC.approvalPage, bind: NS.ViewsC.approvalPageBind },
    { id: 'admin', ico: '⚙', ko: '관리', en: 'Administration', subKo: '가중치·임계값·경보 기준·연동·변경 이력', subEn: 'Weights, thresholds, alert rules, integrations, change log', view: NS.ViewsC.admin, bind: NS.ViewsC.adminBind },
  ];
  const $ = id => document.getElementById(id);
  const loggedIn = () => store.isSessionValid();
  function parseHash() { const h = (location.hash || '#/dashboard').replace(/^#\/?/, ''); const parts = h.split('/').filter(Boolean); return { route: parts[0] || 'dashboard', params: parts.slice(1).map(decodeURIComponent) }; }
  function navigate(path) { const target = '#' + path; if (location.hash === target) render(); else location.hash = target; }
  function toast(msg, kind) { const t = $('toast'); t.textContent = msg; t.className = 'toast show ' + (kind || ''); clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 3800); }
  function run(fn, okMsg) {
    try { const r = fn(); if (r && r.ok === false) toast((r.errors || []).map(U.errText).join(' · '), 'bad'); else toast(okMsg || 'OK'); }
    catch (e) { toast(U.errText(e.code || e.message), 'bad'); }
    render();
  }
  function chrome(route) {
    const s = store.session;
    $('nav').innerHTML = ROUTES.map(r => '<a href="#/' + r.id + '" data-route="' + r.id + '" class="' + (r.id === route.id ? 'active' : '') + '"><span class="ico">' + r.ico + '</span> ' + esc(L(r.ko, r.en)) + '</a>').join('');
    $('page-title').textContent = L(route.ko, route.en); $('page-sub').textContent = L(route.subKo, route.subEn);
    $('user-name').textContent = s.name ? U.tt(s.name) : (s.actor || ''); $('user-role').textContent = s.role ? U.lab('role', s.role) : ''; $('user-id').textContent = s.actor || ''; $('logout-btn').textContent = L('로그아웃', 'Sign out');
    for (const l of U.LANGS) $('lang-' + l).className = U.getLang() === l ? 'on' : '';
    $('partner-a').textContent = L('◂ 파트너 평가 (기존 OMH-NICE, A–E)', '◂ Partner assessment (legacy OMH-NICE, A–E)'); document.documentElement.lang = U.getLang();
    $('asof').textContent = L('기준일 ', 'As of ') + store.state.config.asOf;
    $('banner').innerHTML = '<span class="b-sample">SAMPLE DATA</span> ' + esc(L('모든 호텔·금액은 가상의 샘플입니다 (실제 OMH 데이터 아님).', 'All hotels and amounts are fictional samples (not OMH operating data).')) + ' &nbsp;|&nbsp; <span class="b-proto">PROTOTYPE</span> ' + esc(L('실제 송금·결재·장부 이전은 실행되지 않습니다. 등급 구간·한도 배수는 대표 승인 전 잠정값입니다.', 'No real payment, approval or ledger transfer is executed. Grade bands and multipliers are provisional pending CEO approval.')) +
      (storageWarn ? ' &nbsp;|&nbsp; <b class="bad">' + esc(L('브라우저 저장소 사용 불가 — 새로고침 시 데이터가 사라집니다.', 'Browser storage unavailable — data will not survive reload.')) + '</b>' : '') +
      (store.loadStatus === 'AUDIT_BROKEN' ? ' &nbsp;|&nbsp; <b class="bad">' + esc(L('감사 로그 체인이 손상되었습니다(데이터는 유지, 변조 가능성 확인 필요).', 'Audit-log chain is broken (data kept; possible tampering — investigate).')) + '</b>' : '') +
      (store.loadStatus === 'UPGRADED' ? ' &nbsp;|&nbsp; <b>' + esc(L('프로토타입이 새 버전으로 바뀌어 샘플 데이터를 새로 불러왔습니다(이전 데이터는 별도 키에 보관).', 'The prototype was updated, so the sample data was loaded again (your earlier data is kept under a separate key).')) + '</b>' : '') +
      (store.loadStatus === 'CORRUPT_RESET' ? ' &nbsp;|&nbsp; <b class="bad">' + esc(L('저장 데이터가 손상되어 샘플로 복구했습니다(원본은 별도 키에 보관).', 'Stored data was corrupt and was replaced by the sample (original kept under a separate key).')) + '</b>' : '');
    $('foot').textContent = 'store: ' + store.key + ' · legacy key untouched';
  }
  function signIn(id, pw) {
    const r = store.login(id, pw);
    if (r.ok === false) { ui.loginError = r.errors[0]; ui.loginPw = ''; render(); return r; }
    ui.loginError = null; sess.write({ id: r.account.id, exp: r.exp }); const back = ui.afterLogin; ui.afterLogin = null; location.hash = back && !/^#[/]?login/.test(back) ? back : '#/dashboard'; render(); return r;
  }
  function signOut() { store.logout(); sess.clear(); ui.loginError = null; ui.afterLogin = null; location.hash = '#/login'; render(); }
  function renderLogin() {
    document.body.classList.add('auth-mode'); document.title = L('로그인', 'Sign in') + ' · OMH-NICE 2.0'; const el = $('content');
    $('banner').innerHTML = '<span class="b-sample">SAMPLE DATA</span> ' + esc(L('모든 호텔·금액은 가상의 샘플입니다 (실제 OMH 데이터 아님).', 'All hotels and amounts are fictional samples (not OMH operating data).')) + ' &nbsp;|&nbsp; <span class="b-proto">PROTOTYPE</span> ' + esc(L('실제 송금·결재·장부 이전은 실행되지 않습니다.', 'No real payment, approval or ledger transfer is executed.'));
    const ctx = { store, ui, navigate, rerender: render, toast, signIn, route: { id: 'login' } };
    try { el.innerHTML = NS.ViewsAuth.login(ctx); NS.ViewsAuth.loginBind(el, ctx); } catch (e) { console.error(e); el.innerHTML = '<div class="note bad">' + esc(e.message) + '</div>'; }
    document.documentElement.lang = U.getLang(); window.OMH.app.last = { route: 'login', params: [] };
  }
  function render() {
    if (!loggedIn()) {                                                       // every screen requires a login; the requested address is kept for after sign-in
      if (store.session.loggedIn) { sess.clear(); ui.loginError = 'E_SESSION_EXPIRED'; }
      const h = location.hash; if (h && !/^#[/]?login/.test(h) && h !== '#') ui.afterLogin = h;
      if (!/^#[/]?login/.test(h || '')) { history.replaceState(null, '', '#/login'); }
      renderLogin(); return;
    }
    document.body.classList.remove('auth-mode'); document.title = 'OMH-NICE 2.0 · Hotel Floating Risk';
    if (/^#[/]?login/.test(location.hash || '')) { history.replaceState(null, '', '#/dashboard'); }

    const { route: rid, params } = parseHash(); const route = ROUTES.find(r => r.id === rid) || ROUTES[0];
    chrome(route); const el = $('content');
    let m; try { m = store.model(); } catch (e) { el.innerHTML = '<div class="note bad">' + esc(L('계산 오류: ', 'Calculation error: ')) + esc(e.message) + '</div>'; console.error(e); return; }
    const ctx = { store, m, ui, params, navigate, rerender: render, toast, run, route };
    try { el.innerHTML = route.view(ctx); route.bind(el, ctx); }
    catch (e) { console.error(e); el.innerHTML = '<div class="note bad"><b>' + esc(L('화면 렌더링 오류', 'Screen render error')) + '</b><br>' + esc(e.message) + '</div>'; }
    window.OMH.app.last = { route: route.id, params };
  }
  window.OMH.app = { store, ui, render, navigate, toast, run, ROUTES, parseHash, signIn, signOut };
  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', () => {
    $('logout-btn').addEventListener('click', signOut);
    for (const l of U.LANGS) $('lang-' + l).addEventListener('click', () => { U.setLang(l); document.documentElement.lang = l; render(); });
    document.documentElement.lang = U.getLang();
    render();
  });
})();
