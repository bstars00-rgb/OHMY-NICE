'use strict';
// Language-pack tests (Japanese, Vietnamese): completeness, placeholder safety, no leftover Korean, full-screen rendering in each language.
const env = require('./helpers/env');
const { UI, RBAC, ViewsA, ViewsB, ViewsC } = env;
const { extract } = require('../tools/i18n_extract');
const HANGUL = /[가-힣]/;
const KANA_KANJI = /[぀-ヿ㐀-鿿]/;

function hangulData(state) {      // user-entered Korean data that is legitimately shown as typed (notes, opinions) — not UI labels
  const out = []; const walk = o => { if (typeof o === 'string') { if (HANGUL.test(o)) out.push(o); } else if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v); };
  walk(state.ratings); walk(state.alerts); walk(state.aiReports); return out;
}
const visibleText = html => html.replace(/<[^>]+>/g, ' ').replace(/&lt;|&gt;|&quot;|&#39;|&amp;|&nbsp;/g, ' ');

module.exports = function register(h) {
  const { test: t } = h;
  const keys = () => [...extract().pairs.keys()];
  const packs = { ja: env.I18N_ja, vi: env.I18N_vi };

  t('I01', 'Language packs cover every UI string (ja, vi) and contain no stale keys', ['UI-LANG', 'I18N'], a => {
    const ks = keys(); a.ok(ks.length > 500, 'extracted ' + ks.length);
    for (const lg of ['ja', 'vi']) { const miss = ks.filter(k => !packs[lg][k]); a.deepEq(miss.slice(0, 8), [], lg + ' missing ' + miss.length); const stale = Object.keys(packs[lg]).filter(k => !ks.includes(k)); a.deepEq(stale.slice(0, 5), [], lg + ' stale ' + stale.length); }
  });
  t('I02', 'Translations keep placeholders, leading/trailing spaces and untranslatable tokens; no Korean left; scripts look right', ['UI-LANG', 'I18N'], a => {
    const tokens = s => (s.match(/\{\d+\}/g) || []).sort().join(',');
    for (const lg of ['ja', 'vi']) for (const [ko, tr] of Object.entries(packs[lg])) {
      a.eq(tokens(tr), tokens(ko), lg + ' placeholders: ' + ko); if (lg === 'ja') a.eq(/^\s/.test(tr), /^\s/.test(ko), lg + ' leading space: ' + JSON.stringify(ko));   // Vietnamese may add a space after a number (e.g. ' hợp đồng') a.eq(/\s$/.test(tr), /\s$/.test(ko), lg + ' trailing space: ' + JSON.stringify(ko));
      a.ok(!HANGUL.test(tr), lg + ' still Korean: ' + ko + ' -> ' + tr); a.ok(!/[<>]|&(?!amp;)/.test(tr) || /[<>&]/.test(ko), lg + ' markup introduced: ' + tr);
      for (const sym of (ko.match(/\b(?:SCM|ELLIS|CSV|JSON|OMH|NICE|MOCK|SAMPLE|KRW|JPY|VND|USD|SGD|NR|AI|CEO|ID|RBAC|API|bp)\b/g) || [])) if (!tr.includes(sym)) a.ok(false, lg + ' lost token ' + sym + ' in: ' + ko + ' -> ' + tr);
    }
    const jaOk = Object.entries(packs.ja).filter(([ko, tr]) => !KANA_KANJI.test(tr) && /[가-힣]{2,}/.test(ko)); a.ok(jaOk.length < 12, 'Japanese entries without any kana/kanji: ' + jaOk.slice(0, 5).map(x => x[0]));
    const viOk = Object.entries(packs.vi).filter(([ko, tr]) => !/[A-Za-zÀ-ỹ]/.test(tr) && /[가-힣]{2,}/.test(ko)); a.eq(viOk.length, 0, 'Vietnamese entries without Latin letters');
  });
  t('I03', 'LF templates fill every placeholder; language switching is validated and persisted by the core', ['UI-LANG', 'I18N'], a => {
    for (const lg of ['ja', 'vi', 'en', 'ko']) { UI.setLang(lg); const s = UI.LF('{0} ({1}) 등급 {2}{3}, 평가 신뢰도 {4}%.', '{0} ({1}) grade {2}{3}, confidence {4}%.', 'H', 'CT-1', 'A', '', 90); a.ok(!/\{\d\}/.test(s) && s.includes('CT-1') && s.includes('90'), lg + ': ' + s); }
    UI.setLang('xx'); a.eq(UI.getLang(), 'ko', 'unknown language falls back to Korean'); UI.setLang('vi'); a.eq(UI.getLang(), 'vi'); a.deepEq(UI.LANGS, ['ko', 'en', 'ja', 'vi']); UI.setLang('ko');
    UI.setLang('ja'); a.eq(UI.tt({ ko: '샘플 서울 강남 호텔', en: 'Sample Seoul Gangnam Hotel' }), packs.ja['샘플 서울 강남 호텔']); a.eq(UI.tt({ ko: '없는 문구 테스트', en: 'Fallback test' }), 'Fallback test', 'missing entry falls back to English'); a.ok(UI.missing.has('ja:없는 문구 테스트'), 'missing key is recorded'); UI.missing.clear(); UI.setLang('ko');
  });
  const VIEWS = { dashboard: ViewsA.dashboard, status: ViewsA.status, profile: ViewsA.profile, ledger: ViewsB.ledger, risk: ViewsC.risk, approval: ViewsC.approvalPage, register: ViewsC.registerPage, admin: ViewsC.admin };
  t('I04', 'All screens render in Japanese and Vietnamese for every role: no missing translations, no leftover Korean labels, no unfilled placeholders', ['S01', 'S02', 'S03', 'S04', 'S05', 'S07', 'S08', 'UI-LANG', 'I18N'], a => {
    let n = 0;
    for (const lg of ['ja', 'vi']) {
      UI.setLang(lg); UI.missing.clear();
      for (const role of RBAC.ROLES) {
        const st = env.as(env.newStore(), role); const data = hangulData(st.state); const ctx = (params, extra) => ({ store: st, m: st.model(), ui: Object.assign({ filters: {}, simAmount: '1000' }, extra), params, navigate() {}, rerender() {}, toast() {}, run() {} });
        const targets = [['dashboard', []], ['status', []], ['risk', []], ['register', []], ['admin', []]]; for (const c of st.state.contracts) for (const nme of ['profile', 'ledger', 'approval']) targets.push([nme, [c.contractId]]);
        for (const [name, params] of (role === 'SCM' ? targets : targets.filter(x => x[1].length === 0 || x[1][0] === 'CT-JP-004' || x[1][0] === 'CT-JP-007'))) {
          let html = VIEWS[name](ctx(params)); n++; let text = visibleText(html); for (const d of data) text = text.split(visibleText(d)).join(' ');
          a.ok(!/\{\d+\}|undefined|NaN|\[object|Infinity/.test(text), lg + '/' + role + '/' + name + ' ' + (params[0] || '') + ': ' + (text.match(/\{\d+\}|undefined|NaN|\[object|Infinity/) || [''])[0]);
          const h = text.match(/[가-힣]+/g); a.ok(!h, lg + '/' + role + '/' + name + ' ' + (params[0] || '') + ' leftover Korean: ' + (h || []).slice(0, 4).join(' '));
        }
      }
      for (const err of [null, 'E_AUTH_FAILED', 'E_AUTH_LOCKED', 'E_SESSION_EXPIRED']) {            // the landing page, with and without an error
        const text = visibleText(env.ViewsAuth.login({ ui: { loginError: err, loginId: 'demo.scm' } })).split('한국어').join(' '); n++;      // '한국어' is the Korean language button, shown in its own language
        a.ok(!HANGUL.test(text) && !/\{\d+\}|undefined|NaN|\[object/.test(text), lg + ' login screen ' + err + ': ' + (text.match(/[가-힣]+/g) || []).slice(0, 4).join(' '));
      }
      a.deepEq([...UI.missing].slice(0, 6), [], lg + ' missing keys while rendering');
    }
    UI.setLang('ko'); a.ok(n > 150, 'rendered ' + n + ' screens');
  });
  t('I05', 'Japanese and Vietnamese key terms are used consistently (glossary check)', ['UI-LANG', 'I18N'], a => {
    const must = { ja: { '선급금': '前払金', '원장': '元帳', '경보': 'アラート', '대표이사': '代表取締役', '권장 한도': '推奨限度額' }, vi: { '권장 한도': 'hạn mức khuyến nghị', '원장': 'sổ cái' } };
    for (const lg of Object.keys(must)) for (const [ko, term] of Object.entries(must[lg])) { const hits = Object.entries(packs[lg]).filter(([k]) => k.includes(ko)); const bad = hits.filter(([k, v]) => !v.toLowerCase().includes(term.toLowerCase()) && k === ko); a.deepEq(bad.map(x => x[0]), [], lg + ' term ' + ko + ' should be ' + term); }
  });
};
