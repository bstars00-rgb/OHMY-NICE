/* Role-based access control (PROTOTYPE: client-side only — real enforcement must be server-side, see 04_System_Architecture). */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const api = factory();
  NS.RBAC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const ROLES = ['VIEWER', 'SCM', 'SUPPORT', 'CEO', 'ADMIN'];      // SUPPORT = 경영지원 (finance support): verifies, settles, closes the month
  const PERMS = {
    'ledger.write': ['SCM', 'SUPPORT', 'ADMIN'], 'ledger.import': ['SCM', 'SUPPORT', 'ADMIN'], 'ellis.import': ['SCM', 'SUPPORT', 'ADMIN'], 'confirmation.write': ['SCM', 'SUPPORT', 'ADMIN'],
    'rating.edit': ['SCM', 'SUPPORT', 'ADMIN'], 'rating.commit': ['SCM', 'SUPPORT', 'ADMIN'], 'opinion.write': ['SCM', 'SUPPORT', 'ADMIN'],
    'settle.invoice': ['SCM', 'SUPPORT', 'ADMIN'],            // steps 1, 2 and 5 of the settlement: invoice received, ELLIS comparison, hotel check (담당 SCM)
    'settle.process': ['SUPPORT', 'ADMIN'],                   // steps 3 and 6: settle in ELLIS and close the month (경영지원)
    'review.sales': ['SCM', 'ADMIN'],                          // the sales side of the credit review (담당 SCM)
    'review.support': ['SUPPORT', 'ADMIN'],                    // the finance side, scored on its own from the registries and books (경영지원)
    'alert.update': ['SCM', 'SUPPORT', 'CEO', 'ADMIN'], 'alert.dismiss': ['CEO', 'ADMIN'],
    'approval.create': ['SCM', 'SUPPORT', 'ADMIN'], 'approval.submit': ['SCM', 'SUPPORT', 'ADMIN'],
    'approval.review': ['CEO'],                               // ONLY the CEO role reviews and gives feedback — ADMIN deliberately excluded
    'master.write': ['SCM', 'SUPPORT', 'ADMIN'],                          // register a hotel / contract (master data and the opening balance)
    'limit.set': ['SCM', 'SUPPORT', 'CEO', 'ADMIN'],                      // a hotel-level cap may be set or lowered by anyone in charge of the contract
    'limit.relax': ['CEO', 'ADMIN'],                           // raising or lifting an existing cap needs the CEO or an admin
    'ai.run': ['SCM', 'SUPPORT', 'CEO', 'ADMIN'], 'config.edit': ['ADMIN'], 'data.reset': ['ADMIN'], 'data.export': ['SCM', 'SUPPORT', 'CEO', 'ADMIN'], 'audit.read': ['CEO', 'ADMIN'],
  };
  const can = (role, perm) => !!(PERMS[perm] && PERMS[perm].includes(role));
  class PermissionError extends Error { constructor(role, perm) { super('E_FORBIDDEN: ' + role + ' lacks ' + perm); this.code = 'E_FORBIDDEN'; this.role = role; this.perm = perm; } }
  function require_(role, perm) { if (!can(role, perm)) throw new PermissionError(role, perm); }
  /** Role x permission table for display: [{ perm, roles: { VIEWER: bool, ... } }]. */
  const matrix = () => Object.keys(PERMS).map(perm => ({ perm, roles: Object.fromEntries(ROLES.map(r => [r, can(r, perm)])) }));
  return { ROLES, PERMS, can, require: require_, PermissionError, matrix };
});
