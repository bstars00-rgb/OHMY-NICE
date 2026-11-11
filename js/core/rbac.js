/* Role-based access control (PROTOTYPE: client-side only — real enforcement must be server-side, see 04_System_Architecture). */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory();
  NS.RBAC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const ROLES = ['VIEWER', 'SCM', 'CEO', 'ADMIN'];
  const PERMS = {
    'ledger.write': ['SCM', 'ADMIN'], 'ledger.import': ['SCM', 'ADMIN'], 'ellis.import': ['SCM', 'ADMIN'], 'confirmation.write': ['SCM', 'ADMIN'],
    'rating.edit': ['SCM', 'ADMIN'], 'rating.commit': ['SCM', 'ADMIN'], 'opinion.write': ['SCM', 'ADMIN'],
    'alert.update': ['SCM', 'CEO', 'ADMIN'], 'alert.dismiss': ['CEO', 'ADMIN'],
    'approval.create': ['SCM', 'ADMIN'], 'approval.submit': ['SCM', 'ADMIN'],
    'approval.review': ['CEO'],                               // ONLY the CEO role reviews and gives feedback — ADMIN deliberately excluded
    'limit.set': ['SCM', 'CEO', 'ADMIN'],                      // a hotel-level cap may be set or lowered by anyone in charge of the contract
    'limit.relax': ['CEO', 'ADMIN'],                           // raising or lifting an existing cap needs the CEO or an admin
    'ai.run': ['SCM', 'CEO', 'ADMIN'], 'config.edit': ['ADMIN'], 'data.reset': ['ADMIN'], 'data.export': ['SCM', 'CEO', 'ADMIN'], 'audit.read': ['CEO', 'ADMIN'],
  };
  const can = (role, perm) => !!(PERMS[perm] && PERMS[perm].includes(role));
  class PermissionError extends Error { constructor(role, perm) { super('E_FORBIDDEN: ' + role + ' lacks ' + perm); this.code = 'E_FORBIDDEN'; this.role = role; this.perm = perm; } }
  function require_(role, perm) { if (!can(role, perm)) throw new PermissionError(role, perm); }
  /** Role x permission table for display: [{ perm, roles: { VIEWER: bool, ... } }]. */
  const matrix = () => Object.keys(PERMS).map(perm => ({ perm, roles: Object.fromEntries(ROLES.map(r => [r, can(r, perm)])) }));
  return { ROLES, PERMS, can, require: require_, PermissionError, matrix };
});
