const sigTot = cnt('bad')+cnt('warn')+cnt('ok')+cnt('na');
  const share = c => sigTot ? Math.round(cnt(c)/sigTot*100) : 0;
  const lines = s => String(s).split(' · ').map(x=>`<div class="cur num">${x}</div>`).join('');
  const fSel = document.getElementById('fColor').value;
  const sigTile = (c,ko,en,ja,sub) => `<button type="button" class="tile sigtile ${c}" data-sigf="${c}" aria-pressed="${fSel===c}"><div class="k"><span class="dot ${c}"></span>${cn(c)} · ${T(ko,en,ja)}</div><div class="v num">${cnt(c)}</div><div class="bar"><i style="width:${share(c)}%"></i></div><div class="s">${share(c)}% · ${sub}</div></button>`;
  const turnPct = krw.length ? Math.round(turnOk/krw.length*100) : 0;
  document.getElementById('tiles').dataset.cnt = JSON.stringify({all:evs.length,bad:cnt('bad'),warn:cnt('warn'),ok:cnt('ok'),na:cnt('na'),off:evs.filter(e=>e.color==='off').length});
  document.getElementById('tiles').innerHTML = `
   <div class="tiles">
    ${sigTile('bad','충전 차단 호텔 수','hotels blocked for top-ups','追加不可の施設数',`${T('잔액','balance','残高')} ${redBal}`)}
    ${sigTile('warn','충전 보류 호텔 수','hotels on hold for top-ups','追加保留の施設数',T('충전 보류·확인','hold top-ups, check','追加保留・確認'))}
    ${sigTile('ok','정상 호텔 수','healthy hotels','正常な施設数',T('월 점검','monthly check','月次点検'))}
    ${sigTile('na','자료 없는 호텔 수','hotels without data','データなしの施設数',T('잔액·소진 자료가 없는 곳','No balance or usage data'))}
   </div>
   <div class="tiles">
    <div class="tile"><div class="k">${T('선급 잔액 (자료 있는 호텔)','Prepaid balance (hotels with data)','前払残高(データあり)')}</div><div class="curs">${lines(sumK)}</div><div class="s">${krw.length}${T('곳 · 나라별 통화','hotels · local currency','施設 · 各国通貨')}</div></div>
    <div class="tile"><div class="k">${T('자금 회전 1개월 이내','Turnover within 1 month','資金回転 1か月以内')}</div><div class="v num">${turnOk}/${krw.length}</div><div class="bar"><i style="width:${turnPct}%"></i></div><div class="s">${turnPct}% · ${T('잔액 ÷ 최근 3개월 월평균 소진','Balance ÷ 3-mo avg usage','残高 ÷ 直近3か月平均消化')}</div></div>
    <div class="tile"><div class="k">${T('보증금 잔액 (별도 관리)','Guarantee deposits (managed separately)')}</div><div class="curs">${lines(depK)}</div><div class="s">${depList.length}${T('곳 · 소진 없음','hotels · not consumed')}</div></div>
   </div>`;
