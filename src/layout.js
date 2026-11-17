/* 화면 배치: 왼쪽에 메뉴·나라·필터를 두고, 위 막대에 다크/화이트 단추를 더한다.
   대표님 스크립트가 끝난 뒤 실려, 이미 있는 요소(nav.tabs, #corpBar, #fColor, #fText, main)를 옮기기만 한다.
   요소를 새로 만들어 바꾸지 않으므로 대표님 쪽 id와 이벤트는 그대로 동작한다. */
(function () {
  'use strict';
  if (window.__omhLayout) return; window.__omhLayout = true;
  const q = (s, r) => (r || document).querySelector(s), qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
  const tx = (ko, en, ja) => (typeof T === 'function' ? T(ko, en, ja) : ko);
  const header = q('header'), nav = q('nav.tabs'), corp = q('#corpBar'), main = q('main');
  if (!header || !nav || !corp || !main) return;
  const root = document.documentElement;

  /* ---------- 다크 / 화이트 ---------- */
  const isDark = () => { const a = root.getAttribute('data-theme'); if (a) return a === 'dark'; try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } };
  const ICON = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };
  const themeBtn = el('button', 'themebtn'); themeBtn.type = 'button'; themeBtn.id = 'themeBtn';
  function paintTheme() {
    const d = isDark(); themeBtn.setAttribute('aria-pressed', String(d));
    themeBtn.innerHTML = (d ? ICON.sun : ICON.moon) + '<span>' + (d ? tx('화이트 모드', 'Light mode', 'ライトモード') : tx('다크 모드', 'Dark mode', 'ダークモード')) + '</span>';
    themeBtn.title = d ? tx('화이트 모드로 바꿉니다', 'Switch to light mode', 'ライトモードに切り替え') : tx('다크 모드로 바꿉니다', 'Switch to dark mode', 'ダークモードに切り替え');
  }
  themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark'; root.setAttribute('data-theme', next);
    try { localStorage.setItem('omh_theme', next); } catch (e) { /* 저장소를 못 쓰는 환경 */ }
    paintTheme();
  });
  header.insertBefore(themeBtn, q('#lang') || null);

  /* ---------- 왼쪽 칸 ---------- */
  const shell = el('div', 'shell'), side = el('aside', 'side'), content = el('div', 'content');
  side.setAttribute('aria-label', 'menu and filters');
  nav.parentNode.insertBefore(shell, nav);
  const groups = [];
  const group = (id, label) => { const g = el('div', 'sgroup'); g.id = id; const h = el('div', 'sh'); g.appendChild(h); g._h = h; g._l = label; groups.push(g); side.appendChild(g); return g; };
  const gMenu = group('sideMenu', () => tx('메뉴', 'MENU', 'メニュー')); gMenu.appendChild(nav); nav.setAttribute('aria-orientation', 'vertical');
  const gCorp = group('sideCorp', () => tx('나라', 'COUNTRY', '国')); gCorp.appendChild(corp);
  const gBoard = group('sideBoard', () => tx('호텔 신호 거르기', 'HOTEL SIGNALS', 'ホテルのシグナル')); gBoard.hidden = true;
  const gSg = group('sideSg', () => tx('SG 전환 거르기', 'SG FILTERS', 'SGの絞り込み')); gSg.hidden = true;
  const sgSlot = el('div'); sgSlot.id = 'sgSide'; gSg.appendChild(sgSlot);
  shell.appendChild(side); shell.appendChild(content); content.appendChild(main);

  /* ---------- 현황판: 신호 칩과 검색을 왼쪽으로, 구역을 카드로 묶어 순서를 바꾼다 ---------- */
  const fColor = q('#fColor'), fText = q('#fText'), vb = q('#v-board');
  const chips = el('div', 'chips'); chips.id = 'sigChips'; gBoard.appendChild(chips);
  const bf = q('.filters', vb);
  if (bf) { gBoard.appendChild(bf); if (fColor && fColor.closest('label')) fColor.closest('label').hidden = true; }
  function setSignal(v) { if (!fColor) return; fColor.value = v; fColor.dispatchEvent(new Event('input', { bubbles: true })); }
  function paintChips() {
    if (!fColor) return; let cnt = {}; try { cnt = JSON.parse((q('#tiles') || { dataset: {} }).dataset.cnt || '{}'); } catch (e) { cnt = {}; }
    chips.textContent = '';
    qa('option', fColor).forEach(o => {
      const b = el('button', 'chip'); b.type = 'button'; b.dataset.sigv = o.value; b.setAttribute('aria-pressed', String(fColor.value === o.value));
      const d = el('span', 'dot ' + (o.value || 'all')); const n = el('span', 'nm'); n.textContent = o.textContent; const c = el('span', 'ct num'); const k = o.value || 'all'; c.textContent = cnt[k] === undefined ? '' : String(cnt[k]);
      b.appendChild(d); b.appendChild(n); b.appendChild(c); chips.appendChild(b);
    });
  }
  if (vb) {
    const map = {};
    qa(':scope > h2', vb).forEach(h => {
      const p = el('section', 'panel'); p.dataset.k = h.dataset.i || ''; h.parentNode.insertBefore(p, h);
      let n = h; while (n && !(n !== h && n.tagName === 'H2')) { const nx = n.nextSibling; p.appendChild(n); n = nx; }
      map[p.dataset.k] = p;
    });
    ['riskH', 'listH', 'floatH', 'prodH', 'pendingH'].forEach(k => { if (map[k]) vb.appendChild(map[k]); });
    const tw = q('#hotelTable'); if (tw && tw.parentNode) tw.parentNode.classList.add('tall');
  }

  /* ---------- 이벤트: 칩, 신호 카드 ---------- */
  document.addEventListener('click', e => {
    const chip = e.target.closest && e.target.closest('.chip[data-sigv]'); if (chip) { setSignal(chip.dataset.sigv); return; }
    const tile = e.target.closest && e.target.closest('[data-sigf]'); if (tile && fColor) { setSignal(fColor.value === tile.dataset.sigf ? '' : tile.dataset.sigf); }
  });

  /* ---------- 동기화: 지금 탭에 맞는 필터만 보이게, 글을 현재 언어로 ---------- */
  function activeView() { const s = q('section.view.on', main); return s ? s.id.replace(/^v-/, '') : 'board'; }
  function sync() {
    const v = activeView(); gBoard.hidden = v !== 'board'; gSg.hidden = v !== 'sg' || !sgSlot.childElementCount;
    groups.forEach(g => { g._h.textContent = g._l(); }); paintTheme(); paintChips();
  }
  qa('section.view', main).forEach(s => new MutationObserver(sync).observe(s, { attributes: true, attributeFilter: ['class'] }));
  new MutationObserver(sync).observe(sgSlot, { childList: true });
  const tiles = q('#tiles'); if (tiles) new MutationObserver(sync).observe(tiles, { childList: true });
  new MutationObserver(sync).observe(corp, { childList: true });

  /* ---------- 위 막대 높이(왼쪽 칸이 막대 아래에 붙도록) ---------- */
  function measure() { root.style.setProperty('--hh', header.offsetHeight + 'px'); }
  measure(); window.addEventListener('resize', measure);
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(header);
  /* SG 탭은 대표님 스크립트가 처음 그릴 때 왼쪽 칸이 아직 없었으므로, 칸을 만든 뒤 한 번 더 그려 거르기 줄을 옮긴다 */
  if (typeof renderSG === 'function') renderSG();
  sync();
})();
