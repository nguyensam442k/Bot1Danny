(function(){
  const {CONFIG, getKlines, EMA, RSI, Stoch, ATR, smcBasics, qtyFromNotional, expiryBars, tfToMs} = window.App;

  // ====== Strategy + Simulation ======
  function generateSignals(bars){
    const closes = bars.map(b=>b.c), highs=bars.map(b=>b.h), lows=bars.map(b=>b.l);
    const ema21 = EMA(closes, CONFIG.ema[0]), ema50 = EMA(closes, CONFIG.ema[1]), ema200 = EMA(closes, CONFIG.ema[2]);
    const rsi = RSI(closes, CONFIG.rsiPeriod);
    const {k:stK,d:stD} = Stoch(highs,lows,closes, CONFIG.stoch[0], CONFIG.stoch[1]);
    const atr = ATR(highs,lows,closes, CONFIG.atr);
    const smc = smcBasics(highs,lows,closes);

    const sigs=[];
    for(let i=200;i<bars.length;i++){
      const up = ema21[i]>ema50[i] && ema50[i]>ema200[i];
      const dn = ema21[i]<ema50[i] && ema50[i]<ema200[i];
      const longCond = up && rsi[i]>50 && stK[i]>stD[i] && smc.bosUp[i];
      const shortCond= dn && rsi[i]<50 && stK[i]<stD[i] && smc.bosDn[i];
      const conf = (up||dn?25:0) + (rsi[i]>50?15: (rsi[i]<50?15:0)) + ((stK[i]-stD[i])>0?15: ((stK[i]-stD[i])<0?15:0)) + (smc.bosUp[i]||smc.bosDn[i]?30:0) + Math.min(15, Math.abs(rsi[i]-50));

      if(longCond){
        const e=bars[i].c, stop=Math.max(bars[i].l - 0.5*atr[i], bars[i].l*0.999);
        const risk = e - stop;
        const tp1 = e + CONFIG.tpR[0]*risk;
        const tp2 = e + CONFIG.tpR[1]*risk;
        const tp3 = e + CONFIG.tpR[2]*risk;
        sigs.push({i, side:'BUY', entry:e, sl:stop, tp:[tp1,tp2,tp3], conf: Math.min(100, Math.round(conf))});
      }
      if(shortCond){
        const e=bars[i].c, stop=Math.min(bars[i].h + 0.5*atr[i], bars[i].h*1.001);
        const risk = stop - e;
        const tp1 = e - CONFIG.tpR[0]*risk;
        const tp2 = e - CONFIG.tpR[1]*risk;
        const tp3 = e - CONFIG.tpR[2]*risk;
        sigs.push({i, side:'SELL', entry:e, sl:stop, tp:[tp1,tp2,tp3], conf: Math.min(100, Math.round(conf))});
      }
    }
    return sigs;
  }

  function simulate(signal, bars, tf){
    const start = signal.i;
    const qty = qtyFromNotional(signal.entry);
    const eBars = expiryBars(tf);
    let hitTP1=false, hitTP2=false, hitTP3=false;
    let when = start;

    for(let j=start+1; j<bars.length && j<=start+eBars; j++){
      const b = bars[j]; when=j;
      if(signal.side==='BUY'){
        if(b.l<=signal.sl) return {status:'SL', when, qty, pnl:(signal.sl - signal.entry)*qty};
        if(!hitTP1 && b.h>=signal.tp[0]) hitTP1=true;
        if(!hitTP2 && b.h>=signal.tp[1]) hitTP2=true;
        if(!hitTP3 && b.h>=signal.tp[2]) hitTP3=true;
      } else {
        if(b.h>=signal.sl) return {status:'SL', when, qty, pnl:(signal.entry - signal.sl)*qty};
        if(!hitTP1 && b.l<=signal.tp[0]) hitTP1=true;
        if(!hitTP2 && b.l<=signal.tp[1]) hitTP2=true;
        if(!hitTP3 && b.l<=signal.tp[2]) hitTP3=true;
      }
      if(hitTP3) return tpResult(when, [1,1,1], qty, signal);
      if(hitTP2) return tpResult(when, [1,1,0], qty, signal);
      if(hitTP1) return tpResult(when, [1,0,0], qty, signal);
    }

    // expired
    const px = bars[Math.min(start+eBars, bars.length-1)].c;
    const pnl = (signal.side==='BUY'? (px - signal.entry) : (signal.entry - px)) * qty;
    return {status:'EXPIRED', when, qty, pnl, filled:[0,0,0]};
  }

  function tpResult(when, filled, qty, s){
    const w = CONFIG.tpSplit;
    const legs = [];
    for(let k=0;k<3;k++){
      if(filled[k]){
        const leg = (s.side==='BUY'? (s.tp[k]-s.entry) : (s.entry - s.tp[k])) * qty * w[k];
        legs.push(leg);
      }
    }
    const pnl = legs.reduce((a,b)=>a+b,0);
    return {status:'TP', when, qty, pnl, filled};
  }

  // ====== UI ======
  let state = {ex:CONFIG.defaultExchange, sym:'BNBUSDT', tf:'1h', auto:false, rows:[]};

  async function run(){
    const bars = await getKlines(state.ex, state.sym, state.tf, CONFIG.candlesLimit);
    const sigs = generateSignals(bars);
    const rows = sigs.slice(-12).map(s=>{
      const r = simulate(s, bars, state.tf);
      const entryTs = new Date(bars[s.i].t).toLocaleString();
      return {s, r, entryTs, lastPx: bars[bars.length-1].c, bars};
    }).reverse();
    state.rows = rows;
    render(rows);
  }

  function render(rows){
    const cards = document.getElementById('cards');
    cards.innerHTML='';
    let buy=0,sell=0,done=0,active=0,tpWins=0,slLoss=0;

    rows.forEach(row=>{
      if(row.s.side==='BUY') buy++; else sell++;
      if(row.r.status==='TP' || row.r.status==='SL') done++; else active++;
      if(row.r.status==='TP') tpWins++; if(row.r.status==='SL') slLoss++;
    });
    const wr = done? (tpWins/done*100).toFixed(2)+'%':'0%';
    document.getElementById('activeCount').textContent = active;
    document.getElementById('doneCount').textContent = done;
    document.getElementById('buyCount').textContent = buy;
    document.getElementById('sellCount').textContent = sell;
    document.getElementById('wr').textContent = wr;

    rows.forEach(({s,r,entryTs,lastPx,bars})=>{
      const card = document.createElement('div'); card.className='card';
      const sideClass = s.side==='BUY'?'side-buy':'side-sell';
      const pnlTag = r.pnl>=0? 'pct-pos':'pct-neg';
      const tpPills = [1,2,3].map(k=>{
        const hit = r.filled && r.filled[k-1]===1;
        return `<span class="pill">${hit? '✓':''} TP${k} · ${Math.round(CONFIG.tpSplit[k-1]*100)}%</span>`;
      }).join('');
      const statusBtn = r.status==='TP'? `<button class="btn neutral">TP hit</button>`
                      : r.status==='SL'? `<button class="btn neutral">Stopped</button>`
                      : `<button class="btn primary">⏳ ACTIVE</button>`;

      card.innerHTML = `
        <div class="card-head">
          <div class="asset">
            <div class="name">${state.sym}</div>
            <span class="badge">NEW</span>
          </div>
          <div class="actions">
            ${statusBtn}
            <button class="btn">Details</button>
          </div>
        </div>

        <div class="grid2">
          <div class="h-row">
            <div class="kv"><div class="k">Side</div><div class="v ${sideClass}">${s.side}</div></div>
            <div class="kv"><div class="k">Entry</div><div class="v">$${fmt2(s.entry)}</div></div>
            <div class="kv"><div class="k">Current</div><div class="v">$${fmt2(lastPx)}</div></div>
            <div class="kv"><div class="k">Time</div><div class="v">${(r.when - s.i) || 0} bars</div></div>
            <div class="kv"><div class="k">P&L (25x)</div><div class="v ${pnlTag}">${r.pnl>=0?'+':''}${fmt2(r.pnl)}</div></div>
          </div>
          <div class="h-row">
            <div class="kv"><div class="k sl">SL</div><div class="v sl">$${fmt2(s.sl)}</div></div>
            <div class="kv"><div class="k">TF</div><div class="v">${state.tf}</div></div>
            <div class="kv"><div class="k">Conf</div><div class="v">${s.conf}%</div></div>
            <div class="kv"><div class="k">R/R (TP1..3)</div><div class="v">${CONFIG.tpR.join(' / ')}</div></div>
          </div>
        </div>

        <div class="h-row">
          <div class="tp">${tpPills}</div>
          <div class="kv"><div class="k">Timestamp</div><div class="v">${entryTs}</div></div>
        </div>
      `;
      cards.appendChild(card);

      // Vẽ mini chart (tùy chọn)
      window.App.renderMiniChart?.(card, bars);
    });
  }

  function fmt2(x){ return (Math.round(x*100)/100).toFixed(2); }

  // ====== Controls ======
  const exSel = document.getElementById('exSel');
  const symSel= document.getElementById('symSel');
  const tfSel = document.getElementById('tfSel');
  document.getElementById('refreshBtn').addEventListener('click', run);
  const autoBtn = document.getElementById('autoBtn');
  autoBtn.addEventListener('click', ()=>{ state.auto=!state.auto; autoBtn.textContent = state.auto? 'Auto: ON':'Auto: OFF'; });

  exSel.addEventListener('change', e=> state.ex=e.target.value);
  symSel.addEventListener('change', e=> state.sym=e.target.value);
  tfSel.addEventListener('change',  e=> state.tf=e.target.value);

  (async function loop(){
    while(true){
      if(state.auto){ await run(); await new Promise(r=>setTimeout(r, tfToMs(state.tf))); }
      else { await new Promise(r=>setTimeout(r, 1000)); }
    }
  })();

  run();
})();
