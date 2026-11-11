/* Landing / login screen. The language is chosen here as well, before logging in.
   The role is fixed by the account (js/core/auth.js); nothing on this screen or in the header lets a person pick a role. PROTOTYPE: not a security control. */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(NS);
  NS.ViewsAuth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (NS) {
  'use strict';
  const U = NS.UI, { L, esc, tt, lab, chip } = U; const Auth = NS.Auth;
  const NAME_KO = '한국어', NAME_JA = '日本語', NAME_VI = 'Tiếng Việt';                  // language names are shown in their own language and are not translated
  const LANG_NAMES = { ko: NAME_KO, en: 'EN', ja: NAME_JA, vi: NAME_VI };
  const ROLE_DESC = { VIEWER: () => L('화면 조회만 가능(입력·검토 의견 기록 불가)', 'View only (no entry, no review feedback)'), SCM: () => L('원장·CSV·ELLIS 입력, 평가 입력, 검토 요청서 초안 작성·제출', 'Ledger / CSV / ELLIS entry, rating input, review-request drafts and submission'),
    CEO: () => L('대표 검토 의견 기록, 경보 기각, 감사 로그 열람', 'Record CEO review feedback, dismiss alerts, read the audit log'), ADMIN: () => L('대표 검토 의견 기록을 뺀 모든 업무와 설정 변경', 'Everything except CEO review feedback, plus configuration') };

  function login(ctx) {
    const cur = U.getLang();
    const langs = U.LANGS.map(l => '<button type="button" data-lang="' + l + '" class="' + (cur === l ? 'on' : '') + '"' + (l === 'ja' || l === 'vi' ? ' lang="' + l + '"' : '') + '>' + esc(LANG_NAMES[l]) + '</button>').join('<span>·</span>');
    const rows = Auth.list().map(a => '<tr><td><code>' + esc(a.id) + '</code></td><td>' + esc(lab('role', a.role)) + '</td><td class="small">' + esc(ROLE_DESC[a.role]()) + '</td><td><button type="button" class="btn sm" data-pick="' + esc(a.id) + '">' + esc(L('선택', 'Use')) + '</button></td></tr>').join('');
    const err = ctx.ui.loginError ? '<div class="note bad" role="alert">' + esc(U.errText(ctx.ui.loginError)) + '</div>' : '';
    return '<div class="login-wrap"><div class="login-card">' +
      '<div class="login-brand"><h1>OMH-NICE 2.0</h1><p>Hotel Floating &amp; Prepayment Risk</p></div>' +
      '<div class="langtog login-lang" role="group" aria-label="Language">' + langs + '</div>' +
      '<h2>' + esc(L('로그인', 'Sign in')) + '</h2>' +
      '<div class="note warn">' + esc(L('시연용 로그인입니다. 보안 기능이 아니며 실제 비밀번호를 입력하지 마세요. 운영에서는 사내 로그인(SSO)과 서버 권한으로 바뀝니다.', 'Demo sign-in. It is not a security control, so never type a real password. Production uses company SSO and server-side permissions.')) + '</div>' +
      '<form id="login-form" autocomplete="off" novalidate>' +
        '<div class="login-field"><label for="login-id">' + esc(L('계정(ID)', 'Account (ID)')) + '</label><input id="login-id" name="id" type="text" autocomplete="off" spellcheck="false" maxlength="60" value="' + esc(ctx.ui.loginId || '') + '"></div>' +
        '<div class="login-field"><label for="login-pw">' + esc(L('비밀번호', 'Password')) + '</label><input id="login-pw" name="pw" type="password" autocomplete="off" maxlength="60"></div>' +
        err + '<button type="submit" class="btn primary" id="login-submit">' + esc(L('로그인', 'Sign in')) + '</button>' +
      '</form>' +
      '<h3>' + esc(L('시연 계정', 'Demo accounts')) + '</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>ID</th><th>' + esc(L('역할', 'Role')) + '</th><th>' + esc(L('할 수 있는 일', 'What it can do')) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="muted small">' + esc(L('시연 비밀번호', 'Demo password')) + ': <code>' + esc(Auth.DEMO_PASSWORD) + '</code> · ' + esc(L('역할은 계정에 정해져 있고 로그인한 뒤에는 바꿀 수 없습니다. 다른 역할로 일하려면 로그아웃하고 다른 계정으로 로그인합니다.', 'The role is set by the account and cannot be changed after sign-in. To work under another role, sign out and use another account.')) + '</div>' +
      '</div></div>';
  }

  function loginBind(el, ctx) {
    const $ = s => el.querySelector(s);
    el.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => { ctx.ui.loginId = $('#login-id').value; U.setLang(b.getAttribute('data-lang')); document.documentElement.lang = U.getLang(); ctx.rerender(); }));
    el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { $('#login-id').value = b.getAttribute('data-pick'); $('#login-pw').value = Auth.DEMO_PASSWORD; $('#login-submit').focus(); }));
    $('#login-form').addEventListener('submit', e => { e.preventDefault(); ctx.ui.loginId = $('#login-id').value; ctx.signIn($('#login-id').value, $('#login-pw').value); });
    if (!$('#login-id').value) $('#login-id').focus(); else $('#login-pw').focus();
  }
  return { login, loginBind };
});
