/* 호텔 고르기: 신용·이중체크와 심사표의 호텔명 칸에 현황판 호텔 후보를 띄우고, 고르면 같은 호텔의 값을 채운다.
   대표님 원본 칸(#kHotel, #cHotel 등)을 그대로 쓰고 값만 넣은 뒤 input·change 이벤트를 보내므로, 저장과 계산은 대표님 코드가 한다.
   후보는 현황판의 호텔 자료(DATA.hotels)에서 오고, 보고용 화면에서는 가상 호텔 50곳이다. */
function hpMonths(h) {
  if (!h.start) return '';
  const d = new Date(h.start + 'T00:00:00'); if (isNaN(d)) return '';
  return Math.max(0, Math.floor((today - d) / 86400000 / 30.4));
}
/* 호텔 한 곳의 값을 두 화면의 칸 이름별로 돌려준다(값이 없으면 칸을 넣지 않는다) */
function hpFill(h) {
  const e = evalHotel(h), avg = e.hasData && e.avg3 > 0 ? Math.round(e.avg3) : '', hist = hpMonths(h);
  const pick = o => { const r = {}; for (const k in o) if (o[k] !== '' && o[k] != null) r[k] = o[k]; return r; };
  return {
    k: pick({ kHotel: h.name, kAvg: avg, kHist: hist, kSalesBy: h.scm }),
    c: pick({ cHotel: h.name, cCode: h.code, cCorp: h.corp, cBal: e.hasData ? Math.max(0, Math.round(e.bal)) : '', cRooms: h.rooms, cAvg: avg, cHist: hist })
  };
}
function hpCandidates() { return DATA.hotels.filter(h => !/保証金|보증금|買取/.test(h.type || '')); }
function hpFind(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' '); if (!t) return null;
  return hpCandidates().find(h => h.name.toLowerCase().replace(/\s+/g, ' ') === t || String(h.code).toLowerCase() === t) || null;
}
(function () {
  'use strict';
  if (typeof document === 'undefined' || window.__omhHotelPick) return; window.__omhHotelPick = true;
  const ids = [['kHotel', 'k'], ['cHotel', 'c']];
  const set = (id, v) => { const el = document.getElementById(id); if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const lists = {};
  const fillList = () => {
    const opts = hpCandidates().map(h => { const o = document.createElement('option'); o.value = h.name; o.label = h.corp + ' · ' + h.code; return o; });
    for (const key in lists) lists[key].replaceChildren(...opts.map(o => o.cloneNode()));
  };
  const hint = () => { for (const [id] of ids) { const el = document.getElementById(id); if (el) el.placeholder = T('호텔명·코드를 입력하면 후보가 뜹니다', 'Type a hotel name or code to pick one', 'ホテル名・コードを入力すると候補が出ます'); } };
  for (const [id, key] of ids) {
    const el = document.getElementById(id); if (!el) continue;
    const dl = document.createElement('datalist'); dl.id = 'hpList_' + key; lists[key] = dl; el.parentNode.appendChild(dl);
    el.setAttribute('list', dl.id); el.setAttribute('autocomplete', 'off');
    let last = '';
    const apply = () => {
      const h = hpFind(el.value); if (!h || last === h.code) return; last = h.code;
      const f = hpFill(h)[key]; for (const k in f) if (k !== id || el.value !== f[k]) set(k, f[k]);
      const n = Object.keys(f).length - 1; if (typeof toast === 'function') toast(T(h.name + ': ' + n + '개 칸을 채웠습니다', h.name + ': filled ' + n + ' fields', h.name + ': ' + n + '項目を入力しました'));
    };
    el.addEventListener('input', apply); el.addEventListener('change', apply);
    el.addEventListener('input', () => { if (!hpFind(el.value)) last = ''; });
    el.addEventListener('focus', fillList);
  }
  fillList(); hint();
  const lang = document.getElementById('lang'); if (lang) lang.addEventListener('click', () => setTimeout(hint, 0));
})();
