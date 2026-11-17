/* 엑셀 양식(①지급목록, ②프리바이목록)을 CSV로 저장한 글을 읽는다. 화면에서 파일을 올릴 때 쓰고, tools/build.py가 엑셀에서 꺼낸 값과 같은 모양을 만든다.
   머리글 글자로 열을 찾으므로 열 순서가 바뀌어도 된다. 양식 맨 위의 제목 줄이 있어도 머리글 줄을 찾아 읽는다. 값 해석은 tools/build.py와 같은 규칙이다(시험이 둘을 맞춰 본다). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SGIMPORT = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const PAY_COLS = [['country', '나라', 0], ['code', 'ELLIS거래처코드', 0], ['hotel', '호텔명', 0], ['kind', '지급구분', 0], ['entity', '현재지급법인', 0], ['method', '현재지급방식', 0], ['ccy', '지급통화', 0], ['avg', '최근3개월월평균지급액', 0], ['card', 'A1카드수용여부', 0], ['account', 'A2수취계좌', 0], ['sheetClass', '분류', 0], ['note', '비고', 0], ['owner', '작성담당', 0], ['filledAt', '작성일', 0]];
  const PRE_COLS = [['entity', '법인', 1], ['country', '나라', 1], ['hotel', '호텔명', 0], ['code', 'ELLIS호텔코드', 0], ['type', '프리바이종류', 0], ['ccy', '통화', 1], ['ledger', '대장상잔액', 0], ['hotelBal', '호텔확인잔액', 0], ['asOf', '기준일', 0], ['gap', '잔액차이', 0], ['avg', '최근3개월월평균소진액', 0], ['months', '소진예상개월', 0], ['canUse', '12/31까지소진가능', 0], ['transfer', '이관가능', 0], ['transferNote', '이관조건', 0], ['refund', '반환가능', 0], ['refundNote', '반환조건', 0], ['sheetClass', '참고분류', 0], ['note', '비고', 0], ['owner', '작성담당', 0], ['est', '12/31예상잔액', 0]];
  const REQUIRED = { pay: ['country', 'hotel', 'kind', 'ccy', 'avg', 'card', 'account'], pre: ['country', 'hotel', 'type', 'ccy', 'ledger', 'hotelBal', 'asOf', 'avg', 'transfer', 'refund'] };
  const NUMERIC = { pay: ['avg'], pre: ['ledger', 'hotelBal', 'gap', 'avg', 'months', 'est'] };
  const DATES = { pay: ['filledAt'], pre: ['asOf'] };
  const YN = { pay: ['card'], pre: ['transfer', 'refund'] };
  const YES = ['O', '○', '◯', 'Y', 'YES', '가능', '예', '수용'], NO = ['X', '×', '✕', 'N', 'NO', '불가', '아니오', '미수용'], UNK = ['미확인', '?', '모름'];
  const norm = v => String(v === null || v === undefined ? '' : v).replace(/\s+/g, '');
  const toNumber = v => { if (v === null || v === undefined || String(v).trim() === '') return null; const s = String(v).trim().replace(/[,₩¥₫]/g, ''); if (s === '-' || s === '—') return null; const n = Number(s); return Number.isNaN(n) ? { err: String(v) } : n; };
  const toDate = v => { if (v === null || v === undefined || String(v).trim() === '') return null; const s = String(v).trim(); const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s); if (!m) return { err: s }; return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'); };
  const toYN = v => { if (v === null || v === undefined || String(v).trim() === '') return null; const s = String(v).trim().toUpperCase(); if (YES.some(x => x.toUpperCase() === s)) return 'O'; if (NO.some(x => x.toUpperCase() === s)) return 'X'; if (UNK.includes(String(v).trim())) return '미확인'; return { err: String(v).trim() }; };
  const toText = v => { if (v === null || v === undefined) return null; const s = String(v).trim(); return s === '' ? null : s; };
  function mapColumns(header, spec) { const heads = header.map(norm); const out = {}, used = new Set(); for (const [key, prefix, exact] of spec) { for (let i = 0; i < heads.length; i++) { const h = heads[i]; if (used.has(i) || !h) continue; if (exact ? h === prefix : h.startsWith(prefix)) { out[key] = i; used.add(i); break; } } } return out; }
  /** rows: 표(줄 배열). kind: 'pay' | 'pre'. -> { rows, issues, missing, headerRow } */
  function parseRows(rows, kind) {
    const spec = kind === 'pay' ? PAY_COLS : PRE_COLS; const first = spec[0][1]; const out = { rows: [], issues: [], missing: [], headerRow: null };
    let h = -1; for (let i = 0; i < Math.min(rows.length, 15); i++) if (rows[i].some(c => norm(c) === first)) { h = i; break; }
    if (h < 0) { out.missing = ['header']; return out; }
    const cols = mapColumns(rows[h], spec); out.headerRow = h + 1; out.missing = REQUIRED[kind].filter(k => !(k in cols)); if (out.missing.length) return out;
    for (let r = h + 1; r < rows.length; r++) {
      const vals = rows[r]; const get = k => (k in cols && cols[k] < vals.length) ? vals[cols[k]] : null;
      if (['hotel', 'country', 'ledger', 'avg'].every(k => { const v = get(k); return v === null || v === undefined || String(v).trim() === ''; })) continue;
      const rec = { sourceRow: r + 1 };
      for (const [key] of spec) {
        if (!(key in cols)) { rec[key] = null; continue; } const raw = get(key); let v;
        if (NUMERIC[kind].includes(key)) v = toNumber(raw); else if (DATES[kind].includes(key)) v = toDate(raw); else if (YN[kind].includes(key)) v = toYN(raw); else v = toText(raw);
        if (v && typeof v === 'object' && 'err' in v) { out.issues.push({ sheet: kind === 'pay' ? '①지급목록' : '②프리바이목록', row: r + 1, field: key, raw: v.err, msg: '값을 해석하지 못했습니다' }); v = null; }
        rec[key] = v;
      }
      out.rows.push(rec);
    }
    return out;
  }
  return { PAY_COLS, PRE_COLS, REQUIRED, parseRows, mapColumns, toNumber, toDate, toYN };
});
