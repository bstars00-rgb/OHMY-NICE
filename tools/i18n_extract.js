'use strict';
// Extracts every UI string that needs a Japanese / Vietnamese translation: the Korean source text (the pack key) and its English twin.
// Sources: L('ko','en'), LF('ko','en',…), B('ko','en') / B2(...), { ko:'…', en:'…' } literals, route titles in app.js.
// Usage: node tools/i18n_extract.js [out.json]   —  or require('./i18n_extract').extract()
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const FILES = ['js/ui/common.js', 'js/ui/views_a.js', 'js/ui/views_b.js', 'js/ui/views_c.js', 'js/ui/views_auth.js', 'js/core/auth.js', 'js/app.js', 'js/adapters/adapters.js', 'js/engine/rating.js', 'js/engine/alerts.js', 'js/data/seed.js'];
const HANGUL = /[가-힣]/;
const LIT = "'((?:[^'\\\\]|\\\\.)*)'";
const unq = s => new Function('return \'' + s + '\'')();
function extract() {
  const pairs = new Map(); const conflicts = [];
  const add = (ko, en, where) => { ko = unq(ko); en = unq(en); if (!HANGUL.test(ko)) return; if (pairs.has(ko)) { const e = pairs.get(ko); if (e.en !== en && !e.alts.includes(en)) { e.alts.push(en); conflicts.push({ ko, en1: e.en, en2: en, where }); } } else pairs.set(ko, { en, where, alts: [] }); };
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const re of [new RegExp("(?<![A-Za-z0-9_$.])(?:LF|L|B2|B)\\(\\s*" + LIT + "\\s*,\\s*" + LIT, 'g'), new RegExp("\\bko:\\s*" + LIT + "\\s*,\\s*en:\\s*" + LIT, 'g'), new RegExp("\\bsubKo:\\s*" + LIT + "\\s*,\\s*subEn:\\s*" + LIT, 'g')]) {
      let m; while ((m = re.exec(src))) add(m[1], m[2], f);
    }
  }
  return { pairs, conflicts };
}
module.exports = { extract };
if (require.main === module) {
  const { pairs, conflicts } = extract(); const obj = {}; for (const [ko, v] of pairs) obj[ko] = v.alts.length ? { en: v.en, alts: v.alts } : { en: v.en };
  const out = process.argv[2] || path.join(__dirname, 'i18n_source.json'); fs.writeFileSync(out, JSON.stringify(obj, null, 1));
  console.log('unique Korean strings: ' + pairs.size + ', same Korean with different English: ' + conflicts.length); for (const c of conflicts.slice(0, 20)) console.log('  ' + c.ko + ' | ' + c.en1 + ' | ' + c.en2 + ' (' + c.where + ')');
}
