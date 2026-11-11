/* Demo accounts and password check.
   PROTOTYPE ONLY: this runs in the browser, the demo password is public and printed on the login page, and the session is kept in sessionStorage.
   It decides which ROLE a person works under (the role is fixed by the account, never chosen in the app) but it is NOT a security control.
   Production replaces it with the company IdP (SSO) and server-side permission checks (see 12_Server_Architecture_Design.md).
   Never type a real password here.                                                                                                       */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory(typeof require === 'function' ? { RBAC: require('./rbac.js') } : { RBAC: NS.RBAC });
  NS.Auth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { RBAC } = dep;
  const B = (ko, en) => ({ ko, en });
  const DEMO_PASSWORD = 'demo-1234';                      // PUBLIC-DEMO-VALUE shown on the login page; the secret scan (test X06) allows exactly this line
  const SESSION_MS = 8 * 3600 * 1000;                     // a login lasts 8 hours
  const MAX_FAILS = 5, LOCK_MS = 30 * 1000;               // five wrong passwords lock that account name for 30 seconds
  const ACCOUNTS = [
    { id: 'demo.viewer', role: 'VIEWER', name: B('시연 열람 계정', 'Demo viewer account') },
    { id: 'demo.scm', role: 'SCM', name: B('시연 SCM 담당 계정 1', 'Demo SCM account 1') },
    { id: 'demo.scm2', role: 'SCM', name: B('시연 SCM 담당 계정 2', 'Demo SCM account 2') },
    { id: 'demo.ceo', role: 'CEO', name: B('시연 대표이사 계정', 'Demo CEO account') },
    { id: 'demo.admin', role: 'ADMIN', name: B('시연 관리자 계정', 'Demo admin account') },
  ];
  const clean = a => ({ id: a.id, role: a.role, name: a.name });
  /** Public view of the accounts (no password). */
  const list = () => ACCOUNTS.map(clean);
  const byId = id => { const k = typeof id === 'string' ? id.trim().toLowerCase() : ''; const a = ACCOUNTS.find(x => x.id === k); return a && RBAC.ROLES.includes(a.role) ? clean(a) : null; };
  /** Returns the account when id and password match, otherwise null (the caller must not say which of the two was wrong). */
  function verify(id, password) {
    const a = byId(id); const okPw = typeof password === 'string' && password.length === DEMO_PASSWORD.length && [...password].every((c, i) => c === DEMO_PASSWORD[i]);
    return a && okPw ? a : null;
  }
  return { ACCOUNTS: list(), DEMO_PASSWORD, SESSION_MS, MAX_FAILS, LOCK_MS, list, byId, verify };
});
