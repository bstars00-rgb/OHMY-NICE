/* State store: persistence (localStorage or injected), RBAC-gated commands, tamper-evident audit log.
   NOTHING here executes a payment, refund, transfer or real approval. Ledger rows change ONLY through ledger.write / ledger.import. */
(function (root, factory) {
  const NS = root.OMH || (root.OMH = {});
  const dep = typeof require === 'function'
    ? { Money: require('./core/money.js'), Dates: require('./core/dates.js'), Config: require('./core/config.js'), RBAC: require('./core/rbac.js'), Ledger: require('./engine/ledger.js'), Rating: require('./engine/rating.js'),
        Alerts: require('./engine/alerts.js'), Csv: require('./engine/csv.js'), Limit: require('./engine/limit.js'), Model: require('./engine/model.js'),
        Adapters: require('./adapters/adapters.js'), Auth: require('./core/auth.js'), Tracker: require('./engine/tracker.js'), Ellis: require('./adapters/ellis.js'), Seed: require('./data/seed.js') }
    : { Money: NS.Money, Dates: NS.Dates, Config: NS.Config, RBAC: NS.RBAC, Ledger: NS.Ledger, Rating: NS.Rating, Alerts: NS.Alerts, Csv: NS.Csv, Limit: NS.Limit,
        Model: NS.Model, Adapters: NS.Adapters, Auth: NS.Auth, Tracker: NS.Tracker, Ellis: NS.Ellis, Seed: NS.Seed };
  const api = factory(dep);
  NS.Store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {
  'use strict';
  const { Money, Dates, Config, RBAC, Ledger, Rating, Alerts, Csv, Limit, Model, Adapters, Auth, Tracker, Ellis, Seed } = dep;
  const DEFAULT_KEY = 'omh_hfr_v1';                       // NEVER the legacy key 'omh_prg_v42'
  const REQUIRED_KEYS = ['hotels', 'contracts', 'ledger', 'config', 'ratings', 'alerts', 'audit'];

  function memoryStorage() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _dump: () => m }; }
  function rowOk(t) { return t && typeof t === 'object' && typeof t.txId === 'string' && typeof t.contractId === 'string' && Ledger.TYPES.includes(t.type) && Number.isSafeInteger(t.amountMinor) && Money.isSupported(t.currency) && typeof t.occurredAt === 'string'; }
  /** Replay every ledger row through the same validator used for new postings (currency match, uniqueness, one OPENING, refund <= balance, types, dates)
      and check referential integrity. A stored file that fails any check is quarantined instead of trusted. */
  function integrityOk(s, maxDate) {
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const hotels = new Set(s.hotels.map(h => h && h.hotelId)); const byId = {};
    if (!s.ratings || typeof s.ratings !== 'object') return false;
    for (const c of s.contracts) {
      if (!c || typeof c.contractId !== 'string' || own(byId, c.contractId) || !hotels.has(c.hotelId) || !Money.isSupported(c.currency) || !own(s.ratings, c.contractId)) return false;
      if (c.limitCap && (!Number.isSafeInteger(c.limitCap.amountMinor) || c.limitCap.amountMinor < 0)) return false;
      if (!Config.entityCurrencyOk(c.omhEntity, c.currency)) return false;                    // e.g. a yen contract under the Korean entity
      byId[c.contractId] = c;
    }
    const replay = []; const index = Ledger.makeIndex(replay);
    for (const t of s.ledger) { const r = Ledger.append(replay, t, { contractsById: byId, asOf: maxDate, index }); if (!r.ok) return false; }
    return true;
  }
  function shapeOk(s, nowDate) {
    if (!(s && typeof s === 'object' && s.schemaVersion === 1 && REQUIRED_KEYS.every(k => k in s) && Array.isArray(s.ledger) && Array.isArray(s.contracts) && Array.isArray(s.hotels) && Array.isArray(s.audit))) return false;
    if (!s.ledger.every(rowOk)) return false;                                   // e.g. amountMinor stored as a string would otherwise corrupt every balance
    if (s.ellis !== undefined) {                                                  // optional ELLIS section: a valid snapshot, the right kind for this state, and consistent with its import history
      const e = s.ellis, b = e && Array.isArray(e.batches) ? e.batches : null;
      if (!(e && typeof e === 'object' && b && b.length && Ellis.validateSnapshot(e.snapshot).ok)) return false;
      if (e.snapshot.provenance.synthetic !== (s.isSample === true) || b[b.length - 1].hash !== e.snapshot.hash || b.some(x => !x || typeof x.batchId !== 'string' || typeof x.sourceHash !== 'string')) return false;
    }
    return Config.validate(s.config).length === 0 && integrityOk(s, [s.config.asOf, nowDate].sort().pop());   // nothing may be dated after both the as-of date and today
  }
  /** Hash of everything the commands may change except alerts (which refresh by themselves): ledger, masters, ratings, confirmations, sales, config. */
  function coreHashOf(s) { const parts = [s.ledger, s.hotels, s.contracts, s.ratings, s.confirmations, s.config, s.sales]; if (s.ellis) parts.push(s.ellis); return Adapters.hash53(JSON.stringify(parts)); }   // 'ellis' joins the hash only once imported, so states saved before it existed still verify
  /** The newest audit entry that carries a state hash must agree with the stored state (detects edits made outside the commands). */
  function coreOk(s) { for (let k = s.audit.length - 1; k >= 0; k--) { const d = s.audit[k].detail; if (d && d.coreHash) return d.coreHash === coreHashOf(s); } return true; }
  /** State that claims a decision happened must have a matching successful audit entry (forged approvals / dismissals are flagged). */
  function auditBacksState(s) {
    const last = pred => { for (let k = s.audit.length - 1; k >= 0; k--) if (pred(s.audit[k])) return s.audit[k]; return null; };
    const ids = new Set();
    if (s.ellis) { const e = last(x => x.action === 'ELLIS_IMPORT_SNAPSHOT' && x.outcome === 'OK'); if (!e || !e.detail || e.detail.hash !== s.ellis.snapshot.hash) return false; }   // an ELLIS snapshot must come from a recorded import
    for (const ap of s.approvals || []) {
      if (ids.has(ap.approvalId)) return false; ids.add(ap.approvalId);
      const draft = last(e => e.action === 'PORTAL_DRAFT' && e.outcome === 'OK' && e.detail && e.detail.approvalId === ap.approvalId);
      if (!draft || draft.entity !== ap.contractId || draft.actor !== ap.createdBy) return false;                                               // approval must belong to the contract it was created for
      const { fingerprint, ...rest } = ap.packet || {};
      if (!ap.packet || fingerprint !== draft.detail.fingerprint || Adapters.hash53(JSON.stringify(rest)) !== fingerprint) return false;   // packet content must be what was created
      if (['SUBMITTED_MOCK', 'CEO_REVIEWED'].includes(ap.status)) { const sub = last(e => e.action === 'PORTAL_SUBMIT_MOCK' && e.outcome === 'OK' && e.entity === ap.approvalId); if (!sub || sub.seq < draft.seq || !ap.ack || sub.detail.ref !== ap.ack.ref) return false; }
      if (ap.status === 'CEO_REVIEWED') { const dec = last(e => e.action === 'PORTAL_REVIEW' && e.outcome === 'OK' && e.entity === ap.approvalId); const sb = last(e => e.action === 'PORTAL_SUBMIT_MOCK' && e.outcome === 'OK' && e.entity === ap.approvalId); if (!dec || !sb || dec.seq < sb.seq || dec.detail.status !== ap.status || !ap.feedback || !String(ap.feedback.text || '').trim() || ap.feedback.by !== dec.actor) return false; }
      else if (ap.status !== 'DRAFT' && ap.status !== 'SUBMITTED_MOCK') return false;
    }
    for (const c of s.contracts) {                                                                              // a hotel-level cap must come from the latest recorded cap command (a reset of the sample starts over)
      const e = last(x => x.outcome === 'OK' && (x.action === 'DATA_RESET_SAMPLE' || (x.entity === c.contractId && /^LIMIT_CAP_/.test(x.action)))); const cap = c.limitCap ? c.limitCap.amountMinor : null;
      if (cap == null) { if (e && e.action === 'LIMIT_CAP_SET') return false; }
      else if (!e || e.action !== 'LIMIT_CAP_SET' || !e.detail || e.detail.amountMinor !== cap || e.actor !== c.limitCap.by) return false;
    }
    for (const a of s.alerts || []) if (a.status === 'DISMISSED') {                                              // the latest recorded action on this alert must be its dismissal
      const e = last(x => x.outcome === 'OK' && x.entity === a.alertId && /^ALERT_/.test(x.action)); if (!e || e.action !== 'ALERT_DISMISSED') return false;
    }
    return true;
  }
  function freezeLedger(s) { s.ledger = s.ledger.map(t => Object.freeze(Object.assign({}, t))); return s; }
  const clone = o => JSON.parse(JSON.stringify(o));

  function createStore(opts) {
    opts = opts || {};
    const storage = opts.storage || memoryStorage(); const KEY = opts.key || DEFAULT_KEY; const now = opts.now || (() => new Date().toISOString());
    let state = null; let loadStatus = 'EMPTY_SEEDED';
    const LOGGED_OUT = Object.freeze({ actor: null, role: null, name: null, loggedIn: false });
    let session = opts.requireLogin ? LOGGED_OUT : { actor: 'demo.scm', role: 'SCM', loggedIn: true };   // the app starts logged out; Node tests start as an SCM user
    const clock = opts.clockMs || (() => Date.now()); const attempts = new Map();
    const listeners = [];

    function persist() { storage.setItem(KEY, JSON.stringify(state)); const h = state.audit[state.audit.length - 1]; storage.setItem(KEY + '.anchor', JSON.stringify(h ? { seq: h.seq, hash: h.hash } : { seq: 0, hash: 'GENESIS' })); listeners.forEach(f => f()); }
    function anchorOk() { try { const raw = storage.getItem(KEY + '.anchor'); if (!raw) return true; const a = JSON.parse(raw); const h = state.audit[state.audit.length - 1]; return (h ? h.seq : 0) === a.seq && (h ? h.hash : 'GENESIS') === a.hash; } catch (e) { return false; } }
    function restore(snap) { state = freezeLedger(JSON.parse(snap)); }
    function load() {
      const raw = storage.getItem(KEY);
      if (raw) {
        try { const p = JSON.parse(raw); if (shapeOk(p, now().slice(0, 10))) { state = freezeLedger(p); loadStatus = verifyAudit().ok && anchorOk() && auditBacksState(state) && coreOk(state) ? 'OK' : 'AUDIT_BROKEN'; refreshAlerts(); return; } loadStatus = 'CORRUPT_RESET'; }
        catch (e) { loadStatus = 'CORRUPT_RESET'; }
        storage.setItem(KEY + '.corrupt', raw);                    // keep the unreadable blob for forensics instead of destroying it
      }
      state = freezeLedger(Seed.buildSeed()); refreshAlerts(); auditAdd('SYSTEM', 'SEED_LOADED', 'state', 'OK', { status: loadStatus });
      persist();
    }

    /* ---- audit (hash-chained; prototype-grade tamper evidence, NOT cryptographic) ---- */
    function auditAdd(actor, action, entity, outcome, detail, role) {
      const prev = state.audit.length ? state.audit[state.audit.length - 1].hash : 'GENESIS';
      if (outcome === 'OK') detail = Object.assign({}, detail, { coreHash: coreHashOf(state) });
      const e = { seq: state.audit.length + 1, at: now(), actor: actor == null ? '(anonymous)' : actor, role: role || (actor === 'SYSTEM' ? 'SYSTEM' : session.role || 'NONE'), action, entity, outcome, detail: detail || {} };
      e.prevHash = prev; e.hash = Adapters.hash53(prev + JSON.stringify([e.seq, e.at, e.actor, e.role, e.action, e.entity, e.outcome, e.detail]));
      state.audit.push(e); return e;
    }
    function verifyAudit() {
      let prev = 'GENESIS';
      for (const e of state.audit) {
        const h = Adapters.hash53(prev + JSON.stringify([e.seq, e.at, e.actor, e.role, e.action, e.entity, e.outcome, e.detail]));
        if (e.prevHash !== prev || e.hash !== h) return { ok: false, brokenAt: e.seq };
        prev = e.hash;
      }
      return { ok: true, length: state.audit.length };
    }

    function refreshAlerts() {
      const m = Model.compute(state); const detected = [];
      for (const v of m.views) detected.push(...v.alerts.map(a => { const { persisted, status, ...rest } = a; return rest; }));
      Alerts.merge(state.alerts, detected, state.config.asOf);
    }

    /** Permission check that also ends an expired login. */
    function requirePerm(perm) {
      if (session.exp && clock() > session.exp) { session = LOGGED_OUT; listeners.forEach(f => f()); const e = new Error('E_SESSION_EXPIRED'); e.code = 'E_SESSION_EXPIRED'; throw e; }
      RBAC.require(session.role, perm);
    }

    /** Run a command: permission check -> fn -> alert refresh -> audit -> persist. fn must validate BEFORE mutating and return {ok,...}. */
    function mutate(perm, action, entity, fn) {
      try { requirePerm(perm); }
      catch (e) { auditAdd(session.actor, action, String(entity), 'DENIED', { perm }); try { persist(); } catch (e2) { /* storage failure must not mask the denial */ } throw e; }
      const snap = JSON.stringify(state);                                       // all-or-nothing: any failure restores the previous state
      try {
        const res = fn(state);
        if (res && res.ok === false) { auditAdd(session.actor, action, String(entity), 'REJECTED', { errors: res.errors }); persist(); return res; }
        refreshAlerts(); auditAdd(session.actor, action, String(entity), 'OK', res && res.audit ? res.audit : {}); persist();
        return res || { ok: true };
      } catch (e) { restore(snap); throw e; }
    }
    const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
    const contractOf = id => (typeof id === 'string' ? state.contracts.find(c => c.contractId === id) : undefined);

    const ctxFor = () => ({ contractsById: Object.fromEntries(state.contracts.map(c => [c.contractId, c])), asOf: state.config.asOf });
    const view = id => Model.compute(state).byContract[id];
    /** Shared by preview and import so both apply exactly the same rules. */
    function ellisPrepare(input, s) {
      let snap = input;
      if (typeof snap === 'string') { try { snap = JSON.parse(snap); } catch (e) { return { ok: false, errors: ['E_ELLIS_JSON'] }; } }
      const v = Ellis.validateSnapshot(snap, { now: now().slice(0, 10) }); if (!v.ok) return { ok: false, errors: v.errors };
      if (snap.provenance.synthetic !== (s.isSample === true)) return { ok: false, errors: [s.isSample === true ? 'E_ELLIS_REAL_DATA_INTO_SAMPLE' : 'E_ELLIS_SYNTHETIC_INTO_REAL'] };   // real ELLIS data never enters the sample state, and sample data never enters a real one
      const r = Ellis.restrictToMaster(snap, s.hotels);
      if (!r.match.matched.length) return { ok: false, errors: ['E_ELLIS_NO_MATCH'] };
      if (s.ellis) {
        if (s.ellis.batches.some(b => b.sourceHash === snap.hash)) return { ok: false, errors: ['E_ELLIS_ALREADY_IMPORTED'] };
        const tNew = Date.parse(snap.provenance.collectedAt), tOld = Date.parse(s.ellis.snapshot.provenance.collectedAt);
        if (!Number.isFinite(tNew) || !Number.isFinite(tOld) || tNew <= tOld) return { ok: false, errors: ['E_ELLIS_STALE'] };      // an equal time counts as a repeat; an unreadable time is never "newer"
      }
      return { ok: true, snap, restricted: r.snapshot, match: r.match, warnings: v.warnings };
    }

    const commands = {
      addTx(tx) {
        return mutate('ledger.write', 'LEDGER_ADD_TX', tx && tx.contractId, s => {
          if (!tx || typeof tx !== 'object') return { ok: false, errors: ['E_ARGUMENT'] };
          const r = Ledger.append(s.ledger, Object.assign({ source: 'MANUAL' }, tx), ctxFor());
          if (!r.ok) return { ok: false, errors: r.errors };
          return { ok: true, tx: r.tx, warnings: r.warnings, audit: { txId: r.tx.txId, type: r.tx.type, amountMinor: r.tx.amountMinor, currency: r.tx.currency } };
        });
      },
      /** Checks a PIC tracker (CSV text of its sheets) and converts it to the unified import rows. Changes nothing and stores nothing. Needs the CSV import permission. */
      previewTracker(texts, o) {
        requirePerm('ledger.import'); texts = texts || {};
        for (const k of ['existing', 'topUpLog', 'risk']) if (texts[k] != null && (typeof texts[k] !== 'string' || texts[k].length > 3e6)) return { ok: false, errors: ['E_TRACKER_INPUT'] };
        const r = Tracker.convert(texts, Object.assign({ asOf: state.config.asOf }, o)); return Object.assign({ ok: true }, r);
      },
      validateCsv(text) { requirePerm('ledger.import'); return Csv.validateLedgerCsv(text, Object.assign({ txs: state.ledger }, ctxFor())); },
      importCsv(text, fileName) {
        return mutate('ledger.import', 'LEDGER_IMPORT_CSV', fileName || 'upload.csv', s => {
          const fileHash = Adapters.hash53(String(text));
          const v = Csv.validateLedgerCsv(text, Object.assign({ txs: s.ledger }, ctxFor()));
          if (v.fatal.length) return { ok: false, errors: v.fatal };
          const alreadyImported = s.importBatches.some(b => b.fileHash === fileHash);
          const batchId = 'BATCH-' + String(s.importBatches.length + 1).padStart(4, '0'); let committed = 0;
          const cx = Object.assign(ctxFor(), { index: Ledger.makeIndex(s.ledger) });
          for (const row of v.rows) if (row.status === 'ACCEPT') { const r = Ledger.append(s.ledger, Object.assign({}, row.tx, { importBatchId: batchId }), cx); if (r.ok) committed++; }
          s.importBatches.push({ batchId, fileName: fileName || 'upload.csv', fileHash, at: now(), by: session.actor, summary: v.summary, committed, alreadyImported });
          return { ok: true, batchId, committed, summary: v.summary, alreadyImported, rows: v.rows, audit: { batchId, committed, summary: v.summary, fileHash } };
        });
      },
      /** Dry run of an ELLIS snapshot import: validation, hotel mapping and the comparison it would produce. Changes nothing. */
      previewEllisSnapshot(input) {
        requirePerm('ellis.import');
        const p = ellisPrepare(input, state); if (!p.ok) return p;
        return { ok: true, warnings: p.warnings, match: p.match, collectedAt: p.snap.provenance.collectedAt, synthetic: p.snap.provenance.synthetic, window: p.snap.window,
          compare: Ellis.compare(Object.assign({}, state, { ellis: { snapshot: p.restricted, batches: [] } })) };
      },
      /** Stores an ELLIS snapshot (matched hotels only). Read-only data: it never creates or changes a ledger row. */
      importEllisSnapshot(input) {
        return mutate('ellis.import', 'ELLIS_IMPORT_SNAPSHOT', 'ellis', s => {
          const p = ellisPrepare(input, s); if (!p.ok) return p;
          const ledgerBefore = s.ledger.length;
          const batches = (s.ellis ? s.ellis.batches : []).concat([{ batchId: 'ELLIS-' + String((s.ellis ? s.ellis.batches.length : 0) + 1).padStart(4, '0'), at: now(), by: session.actor, sourceHash: p.snap.hash, hash: p.restricted.hash,
            collector: p.snap.provenance.collector, collectedAt: p.snap.provenance.collectedAt, synthetic: p.snap.provenance.synthetic, window: p.snap.window, hotels: p.match.matched.length, ignoredHotels: p.match.unmatched.length }]);
          s.ellis = { snapshot: p.restricted, batches };
          if (s.ledger.length !== ledgerBefore) throw new Error('INVARIANT: ELLIS import must not touch the ledger');
          return { ok: true, warnings: p.warnings, match: p.match, audit: { hash: p.restricted.hash, sourceHash: p.snap.hash, hotels: p.match.matched.length, ignoredHotels: p.match.unmatched.length, collector: p.snap.provenance.collector, synthetic: p.snap.provenance.synthetic, ledgerRowsAdded: 0 } };
        });
      },
      addConfirmation(c) {
        return mutate('confirmation.write', 'RECON_CONFIRM', c && c.contractId, s => {
          if (!c || typeof c !== 'object') return { ok: false, errors: ['E_ARGUMENT'] };
          const ct = contractOf(c.contractId); const errs = [];
          if (!ct) errs.push('E_CONTRACT_UNKNOWN'); else if (c.currency !== ct.currency) errs.push('E_CURRENCY_MISMATCH');
          if (!Number.isSafeInteger(c.amountMinor) || c.amountMinor < 0) errs.push('E_AMOUNT_INVALID');
          if (!Dates.isDate(c.confirmedAt) || c.confirmedAt > s.config.asOf) errs.push('E_DATE_INVALID');
          if (errs.length) return { ok: false, errors: errs };
          s.confirmations.push({ contractId: c.contractId, amountMinor: c.amountMinor, currency: c.currency, confirmedAt: c.confirmedAt, by: session.actor });
          return { ok: true, audit: { amountMinor: c.amountMinor, confirmedAt: c.confirmedAt } };
        });
      },
      /** Registers a prepayment contract on a new or an existing hotel: master data plus the OPENING balance row. IDs are made here. Person in charge (SCM) or admin only.
       *  input: { hotelId } (existing) or { hotel: { nameKo, nameEn, country, cityKo, cityEn, operatingCompany, ellisHotelId?, assignedScm? } }, and { contract: { omhEntity, prepaymentType, currency, startDate, endDate, refundable, openingMinor } } */
      registerContract(input) {
        return mutate('master.write', 'CONTRACT_REGISTER', 'new', s => {
          if (!input || typeof input !== 'object' || !input.contract || typeof input.contract !== 'object') return { ok: false, errors: ['E_ARGUMENT'] };
          const k = input.contract, nh = input.hotel; const errs = []; const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
          let hotel = null;
          if (input.hotelId != null && input.hotelId !== '') { hotel = typeof input.hotelId === 'string' ? s.hotels.find(h => h.hotelId === input.hotelId) : null; if (!hotel) errs.push('E_HOTEL_UNKNOWN'); }
          else if (!nh || typeof nh !== 'object') errs.push('E_ARGUMENT');
          else {
            if (!text(nh.nameKo, 80) || !text(nh.nameEn, 80)) errs.push('E_HOTEL_NAME_REQUIRED'); if (!Config.COUNTRIES.includes(nh.country)) errs.push('E_COUNTRY_INVALID');
            if (!text(nh.cityKo, 60) || !text(nh.cityEn, 60)) errs.push('E_CITY_REQUIRED'); if (!text(nh.operatingCompany, 120)) errs.push('E_OPERATOR_REQUIRED');
            if (nh.ellisHotelId != null && String(nh.ellisHotelId).trim() !== '') { if (!text(String(nh.ellisHotelId), 40)) errs.push('E_ELLIS_ID_INVALID'); else if (s.hotels.some(h => h.ellisHotelId === String(nh.ellisHotelId).trim())) errs.push('E_ELLIS_ID_DUPLICATE'); }
          }
          if (!Config.ENTITIES.includes(k.omhEntity)) errs.push('E_ENTITY_INVALID'); if (!Config.PREPAYMENT_TYPES.includes(k.prepaymentType)) errs.push('E_TYPE_INVALID');
          if (!Money.isSupported(k.currency)) errs.push('E_CURRENCY_UNSUPPORTED'); else if (!Config.entityCurrencyOk(k.omhEntity, k.currency)) errs.push('E_ENTITY_CURRENCY');
          if (!Dates.isDate(k.startDate) || !Dates.isDate(k.endDate)) errs.push('E_DATE_INVALID'); else if (k.endDate <= k.startDate) errs.push('E_PERIOD_INVALID');
          if (!(k.refundable === true || k.refundable === false || k.refundable === null)) errs.push('E_STATUS_INVALID');
          if (k.monthlySettlement !== undefined && typeof k.monthlySettlement !== 'boolean') errs.push('E_STATUS_INVALID'); else if (k.monthlySettlement === true && k.prepaymentType !== 'HARD_BLOCK_ADV') errs.push('E_MONTHLY_NEEDS_HARD_BLOCK');
          if (!Number.isSafeInteger(k.openingMinor) || k.openingMinor < 0 || k.openingMinor > 1e15) errs.push('E_AMOUNT_INVALID');
          if (hotel && s.contracts.some(c => c.hotelId === hotel.hotelId && c.omhEntity === k.omhEntity && c.currency === k.currency && c.prepaymentType === k.prepaymentType)) errs.push('E_CONTRACT_EXISTS');
          if (errs.length) return { ok: false, errors: errs };
          const asOf = s.config.asOf; const newHotel = !hotel; const pad = (n, w) => String(n).padStart(w, '0');
          if (newHotel) {
            const nextH = 1 + Math.max(0, ...s.hotels.map(h => { const m = /^H(\d+)$/.exec(h.hotelId); return m ? Number(m[1]) : 0; })); const hid = 'H' + pad(nextH, 3);
            hotel = { hotelId: hid, ellisHotelId: nh.ellisHotelId != null && String(nh.ellisHotelId).trim() !== '' ? String(nh.ellisHotelId).trim() : 'PENDING-' + hid, name: { ko: nh.nameKo.trim(), en: nh.nameEn.trim() }, brand: { ko: '(브랜드 미상)', en: '(brand n/a)' }, country: nh.country,
              city: { ko: nh.cityKo.trim(), en: nh.cityEn.trim() }, operatingCompany: nh.operatingCompany.trim(), owner: null, status: 'ACTIVE', assignedScm: text(nh.assignedScm, 40) ? nh.assignedScm.trim() : session.actor, lastVerifiedDate: asOf, facts: { closure: null, ownershipChange: 'UNKNOWN' }, isSample: s.isSample === true };
            s.hotels.push(hotel);
          }
          const seqs = s.contracts.filter(c => c.contractId.startsWith('CT-' + hotel.country + '-')).map(c => Number(c.contractId.split('-')[2]) || 0).filter(n => n < 90000);
          const contractId = 'CT-' + hotel.country + '-' + pad(1 + Math.max(0, ...seqs), 3);
          s.contracts.push({ contractId, hotelId: hotel.hotelId, omhEntity: k.omhEntity, omhEntityName: Seed.ENTITIES[k.omhEntity], counterparty: { legalName: hotel.operatingCompany, bizRegNo: null }, contractType: k.prepaymentType === 'SECURITY_DEPOSIT' ? 'DEPOSIT_AGREEMENT' : 'ALLOTMENT_PREPAY',
            prepaymentType: k.prepaymentType, currency: k.currency, startDate: k.startDate, endDate: k.endDate, assignedScm: hotel.assignedScm, refund: { refundable: k.refundable, requested: false }, transfer: { eligible: null }, collateral: null, renewal: null,
            facts: { counterpartyVerification: 'UNKNOWN', counterpartyEvidence: null, refundRefused: null, legalRecoveryCritical: null }, isSample: s.isSample === true, topUp: null, plannedTopUp: null, allotment: null, monthlySettlement: k.monthlySettlement === true });
          s.ratings[contractId] = { evidence: {}, history: [], scmOpinion: null };
          const r = Ledger.append(s.ledger, { contractId, type: 'OPENING', amountMinor: k.openingMinor, currency: k.currency, occurredAt: asOf + 'T09:00:00+09:00', externalRef: 'OPEN-' + contractId, source: 'MANUAL' }, ctxFor());
          if (!r.ok) { s.contracts.pop(); delete s.ratings[contractId]; if (newHotel) s.hotels.pop(); return { ok: false, errors: r.errors }; }      // nothing is left behind when the opening row is refused
          return { ok: true, contractId, hotelId: hotel.hotelId, audit: { contractId, hotelId: hotel.hotelId, newHotel, entity: k.omhEntity, currency: k.currency, prepaymentType: k.prepaymentType, openingMinor: k.openingMinor } };
        });
      },
      /** Records contract terms that the rating reads: whether the prepayment is refundable and the documented collateral amount (null = none).
       *  Needs the signed-in person and an evidence reference (clause, guarantee document number). Old values stay in the contract's terms history. */
      setContractTerms(contractId, terms, evidenceRef) {
        return mutate('rating.edit', 'CONTRACT_TERMS', contractId, s => {
          const c = contractOf(contractId); if (!c) return { ok: false, errors: ['E_CONTRACT_UNKNOWN'] };
          if (!terms || typeof terms !== 'object') return { ok: false, errors: ['E_ARGUMENT'] };
          const ev = { by: session.actor, at: s.config.asOf, evidenceRef: String(evidenceRef == null ? '' : evidenceRef).trim() }; if (!Rating.hasEvidence(ev)) return { ok: false, errors: ['E_EVIDENCE_REQUIRED'] };
          const hasR = has(terms, 'refundable'), hasC = has(terms, 'collateralMinor'); const errs = [];
          if (!hasR && !hasC) errs.push('E_ARGUMENT');
          if (hasR && !(terms.refundable === true || terms.refundable === false || terms.refundable === null)) errs.push('E_STATUS_INVALID');
          if (hasC && !(terms.collateralMinor === null || (Number.isSafeInteger(terms.collateralMinor) && terms.collateralMinor >= 0 && terms.collateralMinor <= 1e15))) errs.push('E_AMOUNT_INVALID');
          if (errs.length) return { ok: false, errors: errs };
          const before = { refundable: c.refund.refundable, collateralMinor: c.collateral ? c.collateral.amountMinor : null };
          const after = { refundable: hasR ? terms.refundable : before.refundable, collateralMinor: hasC ? (terms.collateralMinor || null) : before.collateralMinor };
          if (before.refundable === after.refundable && before.collateralMinor === after.collateralMinor) return { ok: false, errors: ['E_NO_CHANGE'] };
          c.termsHistory = (c.termsHistory || []).concat([{ at: s.config.asOf, by: session.actor, evidenceRef: ev.evidenceRef, before, after }]);
          if (hasR) { c.refund.refundable = terms.refundable; c.refund.evidence = ev; }
          if (hasC) c.collateral = terms.collateralMinor ? { type: 'DOCUMENTED', amountMinor: terms.collateralMinor, currency: c.currency, verified: true, evidence: ev } : null;
          return { ok: true, audit: { before, after, evidenceRef: ev.evidenceRef } };      // terms never create a ledger row
        });
      },
      /** Records whether the operator or owner of a hotel changed. Any status but UNKNOWN needs the signed-in person and an evidence reference. */
      setOwnership(hotelId, status, evidenceRef) {
        return mutate('rating.edit', 'OWNERSHIP_STATUS', hotelId, s => {
          const h = typeof hotelId === 'string' ? s.hotels.find(x => x.hotelId === hotelId) : null; if (!h) return { ok: false, errors: ['E_TARGET_UNKNOWN'] };
          if (!['NONE', 'COMPLETED_RESOLVED', 'PENDING', 'COMPLETED_UNRESOLVED', 'UNKNOWN'].includes(status)) return { ok: false, errors: ['E_STATUS_INVALID'] };
          const ev = status === 'UNKNOWN' ? null : { by: session.actor, at: s.config.asOf, evidenceRef: String(evidenceRef == null ? '' : evidenceRef).trim() }; if (ev && !Rating.hasEvidence(ev)) return { ok: false, errors: ['E_EVIDENCE_REQUIRED'] };
          const before = h.facts.ownershipChange; if (before === status) return { ok: false, errors: ['E_NO_CHANGE'] };
          h.factHistory = (h.factHistory || []).concat([{ key: 'ownershipChange', at: s.config.asOf, by: session.actor, before }]);
          h.facts.ownershipChange = status; h.facts.ownershipEvidence = ev; return { ok: true, audit: { status, before } };
        });
      },
      /** Only whitelisted claim types; claims are superseded (old value kept in factHistory), never deleted. */
      recordFact(target, id, key, claim) {
        return mutate('rating.edit', 'FACT_RECORD', target + ':' + id + ':' + key, s => {
          const ALLOWED = { hotel: ['closure'], contract: ['refundRefused', 'legalRecoveryCritical'] };
          if (!ALLOWED[target] || !ALLOWED[target].includes(key)) return { ok: false, errors: ['E_FACT_KEY_UNKNOWN'] };
          const retract = !!(claim && typeof claim === 'object' && claim.retract === true);
          if (!claim || typeof claim !== 'object' || (claim.claimed !== true && !retract)) return { ok: false, errors: ['E_CLAIM_REQUIRED'] };
          const obj = target === 'hotel' ? s.hotels.find(h => h.hotelId === id) : contractOf(id);
          if (!obj) return { ok: false, errors: ['E_TARGET_UNKNOWN'] };
          const cur = obj.facts && obj.facts[key];
          if (Rating.isVerified(cur)) {      // a verified fact stays in force; only an evidenced retraction by a DIFFERENT person may lift it
            if (!retract || !Rating.hasEvidence(claim.verified) || claim.verified.by === cur.verified.by) return { ok: false, errors: ['E_VERIFIED_FACT_LOCKED'] };
          } else if (retract) return { ok: false, errors: ['E_CLAIM_REQUIRED'] };
          if (claim.verified) {
            if (claim.verified.by !== session.actor) return { ok: false, errors: ['E_VERIFIER_MUST_BE_ACTOR'] };
            if (!Rating.hasEvidence(claim.verified)) return { ok: false, errors: ['E_EVIDENCE_REQUIRED'] };
          }
          obj.facts = obj.facts || {}; const before = obj.facts[key] === undefined ? null : JSON.parse(JSON.stringify(obj.facts[key]));
          obj.factHistory = (obj.factHistory || []).concat([{ key, at: s.config.asOf, by: session.actor, before }]);
          if (retract) { obj.facts[key] = { claimed: false, retractedBy: session.actor, retractedAt: s.config.asOf, note: String(claim.note || '').slice(0, 300), verified: { by: claim.verified.by, at: s.config.asOf, evidenceRef: String(claim.verified.evidenceRef).slice(0, 120) } }; return { ok: true, audit: { key, retracted: true, before: before && { claimed: before.claimed, verified: !!before.verified } } }; }
          obj.facts[key] = { claimed: true, source: String(claim.source || 'SCM').slice(0, 40), note: String(claim.note || '').slice(0, 300), verified: claim.verified ? { by: claim.verified.by, at: s.config.asOf, evidenceRef: String(claim.verified.evidenceRef).slice(0, 120) } : null };
          return { ok: true, audit: { key, verified: !!claim.verified, before: before && { claimed: before.claimed, verified: !!before.verified } } };
        });
      },
      /** Counterparty legal-entity status: VERIFIED / FAILED need a named verifier (the actor) and an evidence reference. */
      setCounterparty(contractId, status, evidenceRef) {
        return mutate('rating.edit', 'COUNTERPARTY_STATUS', contractId, s => {
          const c = contractOf(contractId); if (!c) return { ok: false, errors: ['E_CONTRACT_UNKNOWN'] };
          if (!['VERIFIED', 'FAILED', 'UNKNOWN'].includes(status)) return { ok: false, errors: ['E_STATUS_INVALID'] };
          const ev = status === 'UNKNOWN' ? null : { by: session.actor, at: s.config.asOf, evidenceRef: String(evidenceRef || '').trim() };
          if (ev && !Rating.hasEvidence(ev)) return { ok: false, errors: ['E_EVIDENCE_REQUIRED'] };
          const before = { status: c.facts.counterpartyVerification, evidence: c.facts.counterpartyEvidence || null };
          c.factHistory = (c.factHistory || []).concat([{ key: 'counterpartyVerification', at: s.config.asOf, by: session.actor, before }]);
          c.facts.counterpartyVerification = status; c.facts.counterpartyEvidence = ev; return { ok: true, audit: { status, before: before.status } };
        });
      },
      commitRating(contractId, reason) {
        return mutate('rating.commit', 'RATING_COMMIT', contractId, s => {
          if (!(reason || '').trim()) return { ok: false, errors: ['E_REASON_REQUIRED'] };
          const v = contractOf(contractId) && view(contractId); if (!v) return { ok: false, errors: ['E_CONTRACT_UNKNOWN'] };
          const rec = s.ratings[contractId];
          rec.history.push({ at: s.config.asOf, grade: v.rating.grade, score: v.rating.score, confidencePct: v.rating.confidence.pct, flags: v.rating.flags.map(f => f.id), by: session.actor, reason, scores: clone(v.ratingScores) });
          return { ok: true, audit: { grade: v.rating.grade, score: v.rating.score } };
        });
      },
      setOpinion(contractId, text) {
        return mutate('opinion.write', 'SCM_OPINION', contractId, s => {
          if (!contractOf(contractId) || !has(s.ratings, contractId)) return { ok: false, errors: ['E_CONTRACT_UNKNOWN'] };
          s.ratings[contractId].scmOpinion = { text: String(text || '').slice(0, 2000), by: session.actor, at: s.config.asOf }; return { ok: true };
        });
      },
      /** A hotel-level cap on the prepayment limit, entered by a person (the CEO's decision goes into the reason). It can only lower the recommended limit; amountMinor null lifts it.
       *  Setting or lowering needs 'limit.set'; raising or lifting an existing cap needs 'limit.relax'. Every change is kept in the contract's cap history and in the audit log. */
      setLimitCap(contractId, amountMinor, reason) {
        const ct = contractOf(contractId); const cur = ct && ct.limitCap ? ct.limitCap.amountMinor : null; const lift = amountMinor == null;
        const loosen = cur != null && (lift || (Number.isSafeInteger(amountMinor) && amountMinor > cur));
        return mutate(loosen ? 'limit.relax' : 'limit.set', lift ? 'LIMIT_CAP_CLEAR' : 'LIMIT_CAP_SET', contractId, s => {
          const c = contractOf(contractId); if (!c) return { ok: false, errors: ['E_CONTRACT_UNKNOWN'] };
          const why = String(reason == null ? '' : reason).trim(); const errs = []; const before = c.limitCap ? c.limitCap.amountMinor : null;
          if (!why) errs.push('E_REASON_REQUIRED');
          if (!lift && (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 1e15)) errs.push('E_AMOUNT_INVALID');
          if (!errs.length && (lift ? before == null : amountMinor === before)) errs.push('E_NO_CHANGE');
          if (errs.length) return { ok: false, errors: errs };
          c.limitCapHistory = (c.limitCapHistory || []).concat([{ at: s.config.asOf, by: session.actor, before, after: lift ? null : amountMinor, reason: why.slice(0, 300) }]);
          c.limitCap = lift ? null : { amountMinor, currency: c.currency, reason: why.slice(0, 300), by: session.actor, at: s.config.asOf };
          return { ok: true, audit: { before, amountMinor: lift ? null : amountMinor, currency: c.currency } };      // a cap never creates a ledger row
        });
      },
      updateAlert(alertId, status, note) {
        const perm = status === 'DISMISSED' ? 'alert.dismiss' : 'alert.update';
        return mutate(perm, 'ALERT_' + status, alertId, s => {
          const a = s.alerts.find(x => x.alertId === alertId);
          if (!a) return { ok: false, errors: ['E_ALERT_UNKNOWN'] };
          if (!Alerts.STATUSES.includes(status)) return { ok: false, errors: ['E_STATUS_INVALID'] };
          if ((status === 'DISMISSED' || status === 'RESOLVED') && !(note || '').trim()) return { ok: false, errors: ['E_NOTE_REQUIRED'] };
          if (status === 'DISMISSED' && a.severity === 'CRITICAL') { const vv = view(a.contractId); if (vv && vv.rating.flags.some(x => x.id === a.ruleId)) return { ok: false, errors: ['E_CRITICAL_BACKED_BY_FACT'] }; }
          a.status = status; a.notes = a.notes || []; if (note) a.notes.push({ at: s.config.asOf, by: session.actor, text: String(note).slice(0, 1000) });
          return { ok: true, audit: { status } };
        });
      },
      createApproval(contractId, requestedMinor) {
        return mutate('approval.create', 'PORTAL_DRAFT', contractId, s => {
          const v = contractOf(contractId) && view(contractId); if (!v) return { ok: false, errors: ['E_CONTRACT_UNKNOWN'] };
          if (!Number.isSafeInteger(requestedMinor) || requestedMinor > 1e15) return { ok: false, errors: ['E_AMOUNT_INVALID'] };
          const sim = Limit.simulate(v.limit, v.forecast, requestedMinor, v.contract, { daysPerMonth: s.config.forecast.daysPerMonth, addDays: Dates.addDays, asOf: s.config.asOf });
          if (!sim.ok) return { ok: false, errors: sim.errors };
          const packet = Adapters.Portal.buildPacket(v, sim, { asOf: s.config.asOf, scmOpinion: s.ratings[contractId].scmOpinion });
          const ap = { approvalId: 'AP-' + String(Math.max(s.approvals.length, s.audit.filter(e => e.action === 'PORTAL_DRAFT' && e.outcome === 'OK').length) + 1).padStart(4, '0'), contractId, createdAt: s.config.asOf, createdBy: session.actor, status: 'DRAFT', packet, history: [] };
          s.approvals.push(ap); return { ok: true, approval: ap, audit: { approvalId: ap.approvalId, requestedMinor, contractId, fingerprint: packet.fingerprint } };
        });
      },
      submitApproval(approvalId) {
        return mutate('approval.submit', 'PORTAL_SUBMIT_MOCK', approvalId, s => {
          const ap = s.approvals.find(a => a.approvalId === approvalId); if (!ap) return { ok: false, errors: ['E_APPROVAL_UNKNOWN'] };
          if (ap.status !== 'DRAFT') return { ok: false, errors: ['E_STATUS_INVALID'] };
          const ack = Adapters.Portal.submit(ap.packet); ap.status = 'SUBMITTED_MOCK'; ap.ack = ack; ap.history.push({ at: s.config.asOf, by: session.actor, event: 'SUBMITTED_MOCK', ref: ack.ref });
          return { ok: true, ack, audit: { ref: ack.ref } };
        });
      },
      /** The CEO has read the request and sends feedback to the person in charge. It approves nothing: the real approval happens in the approval portal. */
      reviewApproval(approvalId, feedback) {
        return mutate('approval.review', 'PORTAL_REVIEW', approvalId, s => {
          const ap = s.approvals.find(a => a.approvalId === approvalId); if (!ap) return { ok: false, errors: ['E_APPROVAL_UNKNOWN'] };
          if (ap.status !== 'SUBMITTED_MOCK') return { ok: false, errors: ['E_STATUS_INVALID'] };
          if (ap.createdBy === session.actor) return { ok: false, errors: ['E_SELF_REVIEW'] };      // segregation of duties
          const text = String(feedback == null ? '' : feedback).trim(); if (!text) return { ok: false, errors: ['E_FEEDBACK_REQUIRED'] };
          ap.status = 'CEO_REVIEWED'; ap.feedback = { by: session.actor, at: s.config.asOf, text: text.slice(0, 1000) };
          ap.history.push({ at: s.config.asOf, by: session.actor, event: 'CEO_REVIEWED', comment: ap.feedback.text });
          return { ok: true, audit: { status: ap.status, fundsMoved: false } };      // a review never creates a ledger row
        });
      },
      runAi(contractId) {
        return mutate('ai.run', 'AI_MOCK_ANALYSIS', contractId, s => {
          const v = contractOf(contractId) && view(contractId); if (!v) return { ok: false, errors: ['E_CONTRACT_UNKNOWN'] };
          s.aiReports[contractId] = Adapters.AI.analyzeHotel(v, s.config.asOf); return { ok: true, report: s.aiReports[contractId] };
        });
      },
      setConfig(candidate, reason) {
        return mutate('config.edit', 'CONFIG_CHANGE', 'config', s => {
          if (candidate && typeof candidate === 'object' && candidate.version !== s.config.version) return { ok: false, errors: ['E_CONFIG_SECTION:version-locked'] };   // schema version changes only with a release
          if (candidate && typeof candidate === 'object' && candidate.provisional !== s.config.provisional) return { ok: false, errors: ['E_PROVISIONAL_LOCKED'] };   // only a CEO-approved release may clear 'provisional'
          const errs = Config.validate(candidate); if (!(reason || '').trim()) errs.push('E_REASON_REQUIRED');
          if (errs.length) return { ok: false, errors: errs };
          const diffs = []; (function walk(a, b, p) { for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) { const x = a ? a[k] : undefined, y = b ? b[k] : undefined;
            if (x && y && typeof x === 'object' && typeof y === 'object') walk(x, y, p + k + '.'); else if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push({ path: p + k, from: x, to: y }); } })(s.config, candidate, '');
          if (!diffs.length) return { ok: false, errors: ['E_NO_CHANGE'] };
          s.configHistory.push({ at: now(), by: session.actor, reason, changes: diffs });
          s.config = clone(candidate); return { ok: true, changes: diffs, audit: { changes: diffs.length } };
        });
      },
      resetSample() {
        return mutate('data.reset', 'DATA_RESET_SAMPLE', 'state', s => {
          const keep = s.audit; const fresh = freezeLedger(Seed.buildSeed()); fresh.audit = keep; state = fresh; return { ok: true };
        });
      },
      exportJson() { requirePerm('data.export'); auditAdd(session.actor, 'DATA_EXPORT_JSON', 'state', 'OK', {}); try { persist(); } catch (e) { state.audit.pop(); throw e; } return JSON.stringify(state, null, 2); },
    };

    load();
    return {
      get state() { return state; }, get session() { return session; }, get loadStatus() { return loadStatus; }, key: KEY,
      /** Test / console hook that bypasses the login. The app itself never calls it. */
      setSession(actor, role) { if (!RBAC.ROLES.includes(role)) throw new Error('bad role'); session = { actor, role, loggedIn: true }; listeners.forEach(f => f()); },
      /** Password login. The role comes from the account, never from the caller. Failures are audited and five in a row lock that name for 30 s (same answer for unknown names). */
      login(id, password) {
        const key = (typeof id === 'string' ? id.trim().toLowerCase() : '').slice(0, 60), t = clock(); const rec = attempts.get(key);
        const audit = (outcome, detail, actor, role) => { auditAdd(actor, 'LOGIN', 'session', outcome, detail, role || 'NONE'); try { persist(); } catch (e) { /* a storage failure must not mask the result */ } };
        if (rec && rec.until > t) { audit('DENIED', { reason: 'LOCKED' }, key || '(blank)'); return { ok: false, errors: ['E_AUTH_LOCKED'], retryInMs: rec.until - t }; }
        const acc = Auth.verify(key, password);
        if (!acc) { const n = (rec ? rec.n : 0) + 1; attempts.set(key, { n: n >= Auth.MAX_FAILS ? 0 : n, until: n >= Auth.MAX_FAILS ? t + Auth.LOCK_MS : 0 }); audit('REJECTED', { reason: 'BAD_CREDENTIALS', attempt: n }, key || '(blank)'); return { ok: false, errors: ['E_AUTH_FAILED'] }; }
        attempts.delete(key); session = { actor: acc.id, role: acc.role, name: acc.name, loggedIn: true, exp: t + Auth.SESSION_MS };
        audit('OK', { role: acc.role }, acc.id, acc.role); return { ok: true, account: acc, exp: session.exp };
      },
      logout() { if (!session.loggedIn) return { ok: true }; const s = session; session = LOGGED_OUT; auditAdd(s.actor, 'LOGOUT', 'session', 'OK', {}, s.role); try { persist(); } catch (e) { listeners.forEach(f => f()); } return { ok: true }; },
      /** Resume a login kept by the browser tab. The role is looked up from the account list again, so an edited role in storage has no effect. */
      restoreSession(id, exp) { const acc = Auth.byId(id); if (!acc || !(typeof exp === 'number' && exp > clock() && exp <= clock() + Auth.SESSION_MS)) return { ok: false, errors: ['E_AUTH_SESSION'] }; session = { actor: acc.id, role: acc.role, name: acc.name, loggedIn: true, exp }; listeners.forEach(f => f()); return { ok: true, account: acc }; },
      isSessionValid() { return !!session.loggedIn && !(session.exp && clock() > session.exp); },
      model: () => Model.compute(state), ellisCompare: o => Ellis.compare(state, o), subscribe: f => listeners.push(f), verifyAudit, reload: load, commands, persist, storage,
    };
  }
  return { createStore, memoryStorage, DEFAULT_KEY };
});
