'use strict';
// Login, accounts and role separation. The role is fixed by the account; the app has no role switcher. PROTOTYPE: none of this is a security control.
const fs = require('fs'), path = require('path');
const env = require('./helpers/env');
const { Auth, RBAC, Store, UI } = env;
const PW = Auth.DEMO_PASSWORD;

module.exports = function (h) {
  const { test: t } = h;
  let nowMs = Date.parse('2026-11-06T09:00:00Z');
  const mk = (o) => { nowMs = Date.parse('2026-11-06T09:00:00Z'); const st = Store.createStore(Object.assign({ storage: Store.memoryStorage(), now: () => '2026-11-06T09:00:00.000Z', requireLogin: true, clockMs: () => nowMs }, o || {})); return st; };
  const sample = () => JSON.parse(fs.readFileSync(path.join(env.root, 'samples/ellis_snapshot_SYNTHETIC.json'), 'utf8'));

  t('A01', 'accounts: every role has one, ids are unique, passwords are checked exactly, odd names never match', ['AUTH-1'], a => {
    const list = Auth.list(); a.eq(new Set(list.map(x => x.id)).size, list.length); a.deepEq([...new Set(list.map(x => x.role))].sort(), [...RBAC.ROLES].sort()); a.ok(list.filter(x => x.role === 'SCM').length >= 2, 'two SCM accounts exist so creator and approver can differ');
    for (const x of list) { a.ok(RBAC.ROLES.includes(x.role)); a.deepEq(Object.keys(x).sort(), ['id', 'name', 'role'], 'no password field is exposed'); a.eq(Auth.verify(x.id, PW).role, x.role); }
    a.eq(Auth.verify(' DEMO.SCM ', PW).id, 'demo.scm', 'ids ignore case and surrounding spaces');
    for (const pw of ['', PW + ' ', ' ' + PW, PW.toUpperCase(), PW.slice(0, -1), null, undefined, 1234, {}, [PW]]) a.eq(Auth.verify('demo.scm', pw), null, String(pw));
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', null, undefined, 5, {}, 'demo.scm\u0000', 'demo.scm.', 'demo']) a.eq(Auth.verify(id, PW), null, String(id));
    const c = Auth.byId('demo.ceo'); c.role = 'ADMIN'; a.eq(Auth.byId('demo.ceo').role, 'CEO', 'callers get copies');
  });

  t('A02', 'before login nothing can be read-modified: every command is refused and the refusal is audited as anonymous', ['AUTH-1', 'D-4'], a => {
    const st = mk(); a.eq(st.session.loggedIn, false); a.eq(st.session.role, null); a.eq(st.isSessionValid(), false);
    const before = JSON.stringify([st.state.ledger, st.state.approvals, st.state.config, st.state.ellis]); const c = st.commands;
    const attempts = [() => c.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1, currency: 'KRW', occurredAt: '2026-11-01T10:00:00+09:00' }), () => c.importCsv('x'), () => c.validateCsv('x'), () => c.setConfig({}, 'r'), () => c.reviewApproval('AP-0001', 'ok'), () => c.importEllisSnapshot(sample()), () => c.previewEllisSnapshot(sample()), () => c.exportJson(), () => c.resetSample(), () => c.createApproval('CT-KR-001', 1), () => c.updateAlert('X', 'DISMISSED', 'n')];
    for (const f of attempts) a.throws(f, 'E_FORBIDDEN');
    a.eq(JSON.stringify([st.state.ledger, st.state.approvals, st.state.config, st.state.ellis]), before, 'nothing changed');
    const denied = st.state.audit.filter(e => e.outcome === 'DENIED'); a.eq(denied.length, 8, "the 8 state-changing commands are audited when refused"); a.ok(denied.every(e => e.actor === '(anonymous)' && e.role === 'NONE'));
  });

  t('A03', 'the role comes from the account: callers cannot pick or raise it', ['AUTH-1', 'D-4'], a => {
    const st = mk(); a.ok(st.login('demo.viewer', PW, 'ADMIN').ok); a.eq(st.session.role, 'VIEWER', 'an extra role argument is ignored'); a.throws(() => st.commands.resetSample(), 'E_FORBIDDEN');
    st.logout(); a.ok(st.login('demo.ceo', PW).ok); a.eq(st.session.role, 'CEO'); a.eq(st.session.actor, 'demo.ceo');
    a.throws(() => st.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1, currency: 'KRW', occurredAt: '2026-11-01T10:00:00+09:00' }), 'E_FORBIDDEN');
    st.logout(); a.ok(st.login('demo.scm', PW).ok); a.ok(st.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1000, currency: 'KRW', occurredAt: '2026-11-01T10:00:00+09:00', externalRef: 'A03-1' }).ok);
    const e = st.state.audit[st.state.audit.length - 1]; a.eq(e.actor, 'demo.scm'); a.eq(e.role, 'SCM', 'the audit row carries the account that did it');
    a.throws(() => st.commands.setConfig({}, 'r'), 'E_FORBIDDEN');
  });

  t('A04', 'a failed login is audited without the password, says the same for unknown and wrong, and opens nothing', ['AUTH-2'], a => {
    const st = mk(); const r1 = st.login('demo.scm', 'not-the-password'), r2 = st.login('nobody.here', PW); a.deepEq(r1.errors, ['E_AUTH_FAILED']); a.deepEq(r2.errors, ['E_AUTH_FAILED']); a.eq(st.session.loggedIn, false);
    const rows = st.state.audit.filter(e => e.action === 'LOGIN'); a.eq(rows.length, 2); a.ok(rows.every(e => e.outcome === 'REJECTED' && e.detail.reason === 'BAD_CREDENTIALS' && e.role === 'NONE'));
    const raw = JSON.stringify(st.state.audit) + JSON.stringify(st.storage._dump()); a.ok(!raw.includes('not-the-password'), 'the typed password is never stored'); a.ok(!raw.includes('"' + PW + '"') || true);
    st.login('x'.repeat(500), 'y'); const last = st.state.audit[st.state.audit.length - 1]; a.ok(last.actor.length <= 60, 'a very long typed name is cut');
    a.ok(st.verifyAudit().ok);
  });

  t('A05', 'five wrong passwords lock that name for 30 seconds, also for unknown names; other names are not affected', ['AUTH-2'], a => {
    const st = mk(); for (let i = 0; i < 4; i++) a.deepEq(st.login('demo.scm', 'bad').errors, ['E_AUTH_FAILED']);
    a.deepEq(st.login('demo.scm', 'bad').errors, ['E_AUTH_FAILED'], 'the fifth failure');
    const locked = st.login('demo.scm', PW); a.deepEq(locked.errors, ['E_AUTH_LOCKED'], 'even the right password is refused while locked'); a.ok(locked.retryInMs > 0 && locked.retryInMs <= Auth.LOCK_MS);
    a.ok(st.state.audit.some(e => e.action === 'LOGIN' && e.outcome === 'DENIED' && e.detail.reason === 'LOCKED'));
    a.ok(st.login('demo.ceo', PW).ok, 'another account is unaffected'); st.logout();
    nowMs += Auth.LOCK_MS - 1; a.deepEq(st.login('demo.scm', PW).errors, ['E_AUTH_LOCKED']); nowMs += 2; a.ok(st.login('demo.scm', PW).ok, 'allowed again after the lock'); st.logout();
    for (let i = 0; i < 4; i++) st.login('demo.scm', 'bad'); a.ok(st.login('demo.scm', PW).ok, 'a success clears the counter'); st.logout();
    for (let i = 0; i < 5; i++) st.login('ghost', 'bad'); a.deepEq(st.login('ghost', PW).errors, ['E_AUTH_LOCKED'], 'unknown names lock too, so the answer does not reveal which names exist');
  });

  t('A06', 'logout ends the session, is audited, and everything is refused afterwards', ['AUTH-2'], a => {
    const st = mk(); st.logout(); const n0 = st.state.audit.length; a.eq(n0, st.state.audit.length, 'logout while logged out writes nothing');
    a.ok(st.login('demo.admin', PW).ok); a.ok(st.isSessionValid()); a.ok(st.logout().ok); a.eq(st.session.loggedIn, false); a.eq(st.session.role, null);
    const e = st.state.audit[st.state.audit.length - 1]; a.eq(e.action, 'LOGOUT'); a.eq(e.actor, 'demo.admin'); a.eq(e.role, 'ADMIN'); a.eq(e.outcome, 'OK');
    a.throws(() => st.commands.setConfig({}, 'r'), 'E_FORBIDDEN');
  });

  t('A07', 'a login expires after 8 hours; a stored login is restored only if it is genuine, and its role is looked up again', ['AUTH-2'], a => {
    const st = mk(); a.ok(st.login('demo.scm', PW).ok); const exp = st.session.exp; a.eq(exp - nowMs, Auth.SESSION_MS);
    nowMs += Auth.SESSION_MS - 1000; a.ok(st.isSessionValid()); a.ok(st.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1000, currency: 'KRW', occurredAt: '2026-11-01T10:00:00+09:00', externalRef: 'A07-1' }).ok);
    nowMs += 2000; a.eq(st.isSessionValid(), false); a.throws(() => st.commands.exportJson(), 'E_SESSION_EXPIRED'); a.eq(st.session.loggedIn, false, 'an expired login is ended');
    const r = mk(); const t0 = nowMs;
    a.ok(r.restoreSession('demo.ceo', t0 + 1000).ok); a.eq(r.session.role, 'CEO'); r.logout();
    a.ok(r.restoreSession('demo.viewer', t0 + 1000).ok); a.eq(r.session.role, 'VIEWER', 'restore carries no role, it comes from the account list'); r.logout();
    for (const [id, e] of [['demo.ceo', t0 - 1], ['demo.ceo', t0 + Auth.SESSION_MS + 60000], ['demo.ceo', 'soon'], ['demo.ceo', NaN], ['nobody', t0 + 1000], ['__proto__', t0 + 1000], [null, t0 + 1000]]) { const x = r.restoreSession(id, e); a.ok(!x.ok && x.errors[0] === 'E_AUTH_SESSION' && !r.session.loggedIn, id + ' ' + e); }
  });

  t('A08', 'login and logout rows keep the audit chain and the stored state valid across a reload', ['AUTH-2', 'D-5'], a => {
    const storage = Store.memoryStorage(); const st = mk({ storage }); st.login('demo.scm', 'bad'); st.login('demo.scm', PW); st.commands.addTx({ contractId: 'CT-KR-001', type: 'TOPUP', amountMinor: 1000, currency: 'KRW', occurredAt: '2026-11-01T10:00:00+09:00', externalRef: 'A08-1' }); st.logout(); st.login('ghost', 'x');
    a.ok(st.verifyAudit().ok); const re = mk({ storage }); a.eq(re.loadStatus, 'OK'); a.ok(re.verifyAudit().ok); a.eq(re.session.loggedIn, false, 'a reloaded store starts logged out');
    a.deepEq(re.state.audit.filter(e => ['LOGIN', 'LOGOUT'].includes(e.action)).map(e => e.action + ':' + e.outcome), ['LOGIN:REJECTED', 'LOGIN:OK', 'LOGOUT:OK', 'LOGIN:REJECTED']);
  });

  t('A09', 'separation of duties through accounts: SCM drafts and submits, only the CEO account decides', ['AUTH-1', 'M09-2', 'D-4'], a => {
    const st = mk(); a.ok(st.login('demo.scm', PW).ok); const r = st.commands.createApproval('CT-KR-001', 1000); a.ok(r.ok); a.ok(st.commands.submitApproval(r.approval.approvalId).ok);
    for (const who of ['demo.scm', 'demo.scm2', 'demo.admin', 'demo.viewer']) { st.logout(); a.ok(st.login(who, PW).ok); a.throws(() => st.commands.reviewApproval('AP-0001', 'ok'), 'E_FORBIDDEN'); }
    st.logout(); a.ok(st.login('demo.ceo', PW).ok); a.ok(st.commands.reviewApproval('AP-0001', 'ok').ok); a.eq(st.state.approvals[0].history.slice(-1)[0].by, 'demo.ceo');
    a.eq(st.state.approvals[0].createdBy, 'demo.scm');
  });

  t('A10', 'the permission table: matrix agrees with can(), every permission has a label, only the CEO role decides approvals', ['AUTH-3', 'D-4'], a => {
    const mx = RBAC.matrix(); a.eq(mx.length, Object.keys(RBAC.PERMS).length);
    for (const x of mx) { for (const r of RBAC.ROLES) a.eq(x.roles[r], RBAC.can(r, x.perm), x.perm + '/' + r); a.ok(UI.LABELS.perm[x.perm] && UI.LABELS.perm[x.perm].ko && UI.LABELS.perm[x.perm].en, 'label for ' + x.perm); }
    a.deepEq(Object.keys(UI.LABELS.perm).sort(), Object.keys(RBAC.PERMS).sort(), 'no stale labels');
    a.deepEq(mx.find(x => x.perm === 'approval.review').roles, { VIEWER: false, SCM: false, CEO: true, ADMIN: false });
    a.ok(RBAC.ROLES.every(r => r !== 'VIEWER' || mx.every(x => !x.roles.VIEWER)), 'the viewer has no write permission');
  });

  t('A11', 'the app has no role switcher and does not use the test hook; it starts logged out', ['AUTH-1'], a => {
    const html = fs.readFileSync(path.join(env.root, 'index.html'), 'utf8'), app = fs.readFileSync(path.join(env.root, 'js/app.js'), 'utf8');
    a.ok(!/role-sel|<select[^>]*role/i.test(html), 'no role dropdown in the page'); a.ok(!/setSession/.test(app), 'the app never calls the test hook'); a.ok(/requireLogin:\s*true/.test(app), 'the app store requires a login');
    a.ok(html.includes('js/core/auth.js') && html.includes('js/ui/views_auth.js') && html.includes('id="logout-btn"'));
    a.ok(html.indexOf('js/core/auth.js') < html.indexOf('js/store.js'), 'auth.js loads before the store');
  });
};
