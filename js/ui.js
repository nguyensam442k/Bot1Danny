/* ========= App config ========= */
const SETTINGS = {
  symbols: ['BTCUSDT', 'ETHUSDT'],
  capitalUSD: 100,
  leverage: 25,
  expiryMinutes: 60 * 4,   // 4h -> 240m -> 16 nến m15
  lsKey: 'm15_signals_live'
};

function fmtUSD(x){ if(x===null||x===undefined||isNaN(x)) return '$—'; return '$'+Number(x).toFixed(2); }
function fmtPct(x){ if(x===null||x===undefined||isNaN(x)) return '—'; const s=(x*100).toFixed(2)+'%'; return x>=0?`+${s}`:s; }
function fmtTime(ms){ if(!ms) return '—'; const d=new Date(ms); return d.toLocaleString(); }

/* ========= LocalStorage ========= */
function loadStore(){
  try{ return JSON.parse(localStorage.getItem(SETTINGS.lsKey)) || { trades:[] }; }
  catch(e){ return { trades:[] }; }
}
function saveStore(s){ localStorage.setItem(SETTINGS.lsKey, JSON.stringify(s)); }

/* ========= PnL calculator ========= */
function pnlUSD(dir, entry, exit){
  const pct = (exit/entry - 1) * (dir==='BUY'?1:-1);
  return SETTINGS.capitalUSD * SETTINGS.leverage * pct;
}

/* ========= Trade objects ========= */
function newTradeFromSignal(sig){
  // id ensures uniqueness (sym + crossTime)
  const id = `${sig.symbol}_${sig.crossTime}`;
  return {
    id, sym: sig.symbol.slice(0,3),
    dir: sig.dir, entry: sig.entry, tp1: sig.tp1, tp2: sig.tp2, tp3: sig.tp3, sl: sig.sl,
    openedAt: sig.crossTime, ttlMin: SETTINGS.expiryMinutes, // remaining lifetime
    status: 'ACTIVE', exit: null, reason: '', pnl: 0
  };
}

/* ========= Strategy runner ========= */
function processActiveTrades(store, prices) {
  // prices: { BTC: {last, time}, ETH: {...} }
  const now = Date.now();
  for(const t of store.trades) {
    if(t.status !== 'ACTIVE') continue;
    const p = prices[t.sym]?.last;
    if(!p) continue;

    // hit SL?
    if(t.dir==='BUY' && p <= t.sl) { t.status='SL'; t.exit=p; t.reason='SL'; t.pnl=pnlUSD(t.dir, t.entry, t.exit); continue; }
    if(t.dir==='SELL'&& p >= t.sl) { t.status='SL'; t.exit=p; t.reason='SL'; t.pnl=pnlUSD(t.dir, t.entry, t.exit); continue; }

    // hit TP (use the nearest TP1)
    if(t.dir==='BUY' && p >= t.tp1){ t.status='TP'; t.exit=p; t.reason='TP1'; t.pnl=pnlUSD(t.dir, t.entry, t.exit); continue; }
    if(t.dir==='SELL'&& p <= t.tp1){ t.status='TP'; t.exit=p; t.reason='TP1'; t.pnl=pnlUSD(t.dir, t.entry, t.exit); continue; }

    // expiry
    const mins = Math.floor((now - t.openedAt)/60000);
    t.ttlMin = Math.max(0, SETTINGS.expiryMinutes - mins);
    if(mins >= SETTINGS.expiryMinutes){
      t.status='FLAT'; t.exit=p; t.reason='EXP'; t.pnl=pnlUSD(t.dir, t.entry, t.exit);
    }
  }
}

/* ========= Stats ========= */
function calcStats(store) {
  const by = { BTC:{trd:0,win:0,loss:0,flat:0,pnl:0}, ETH:{trd:0,win:0,loss:0,flat:0,pnl:0} };
  for(const t of store.trades) {
    if(t.status==='ACTIVE') continue;
    const b = by[t.sym];
    b.trd++;
    if(t.status==='TP') b.win++;
    else if(t.status==='SL') b.loss++;
    else b.flat++;
    b.pnl += t.pnl;
  }
  const tot = {
    trd:by.BTC.trd+by.ETH.trd,
    win:by.BTC.win+by.ETH.win,
    loss:by.BTC.loss+by.ETH.loss,
    flat:by.BTC.flat+by.ETH.flat,
    pnl:by.BTC.pnl+by.ETH.pnl
  };
  return { by, tot };
}

function drawStats(stats){
  const map = { BTC:document.querySelector('tr[data-sym="BTC"]'),
                ETH:document.querySelector('tr[data-sym="ETH"]'),
                TOTAL:document.querySelector('tr[data-sym="TOTAL"]') };
  function fillRow(tr, obj){
    const cells = tr.querySelectorAll('td');
    const wr = obj.trd>0 ? (obj.win/obj.trd*100).toFixed(1)+'%' : '0.0%';
    cells[1].textContent = obj.trd;
    cells[2].textContent = obj.win;
    cells[3].textContent = obj.loss;
    cells[4].textContent = obj.flat;
    cells[5].textContent = wr;
    cells[6].textContent = fmtUSD(obj.pnl);
  }
  fillRow(map.BTC, stats.by.BTC);
  fillRow(map.ETH, stats.by.ETH);
  fillRow(map.TOTAL, stats.tot);
}

/* ========= History table ========= */
function drawHistory(store){
  const tb = document.getElementById('histBody');
  tb.innerHTML = '';
  const rows = [...store.trades].sort((a,b)=>b.openedAt-a.openedAt);
  for(const t of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtTime(t.openedAt)}</td>
      <td>${t.sym}</td>
      <td>${t.dir}</td>
      <td>${t.entry?.toFixed(2)??'—'}</td>
      <td>${t.tp1?.toFixed(2)??'—'}</td>
      <td>${t.sl?.toFixed(2)??'—'}</td>
      <td>${t.exit? t.exit.toFixed(2):'—'}</td>
      <td>${t.reason||''}</td>
      <td>${t.status}</td>
      <td class="${t.pnl>=0?'pos':'neg'}">${fmtUSD(t.pnl)}</td>
    `;
    tb.appendChild(tr);
  }
}

/* ========= One card (UI) ========= */
function updateCard(sym, lastClose, lastTime, active){
  const lower = sym.toLowerCase();
  document.getElementById(`${lower}Last`).textContent   = `${sym} m15 Last: ${lastClose?.toFixed(2)??'—'}`;
  document.getElementById(`${lower}Current`).textContent = lastClose?.toFixed(2) ?? '—';
  document.getElementById(`${lower}Time`).textContent    = fmtTime(lastTime);

  const badge = document.getElementById(`${lower}StatusBadge`);
  const stxt  = document.getElementById(`${lower}StatusTxt`);
  const pnlEl = document.getElementById(`${lower}PnlPct`);
  const prfEl = document.getElementById(`${lower}Profit`);
  const entEl = document.getElementById(`${lower}Entry`);
  const slEl  = document.getElementById(`${lower}SL`);
  const t1El  = document.getElementById(`${lower}TP1`);
  const t2El  = document.getElementById(`${lower}TP2`);
  const t3El  = document.getElementById(`${lower}TP3`);

  if(!active){
    badge.textContent='No trade'; badge.className='badge gray';
    stxt.textContent='No trade';
    pnlEl.textContent='—'; prfEl.textContent='$—'; entEl.textContent='—';
    slEl.textContent='—'; t1El.textContent='—'; t2El.textContent='—'; t3El.textContent='—';
    return;
  }
  const pnlPct = (lastClose/active.entry-1)*(active.dir==='BUY'?1:-1);
  const pnlUsd = pnlUSD(active.dir, active.entry, lastClose);

  entEl.textContent = active.entry.toFixed(2);
  pnlEl.textContent = (pnlPct*100).toFixed(2)+'%';
  pnlEl.className = pnlPct>=0?'pos':'neg';
  prfEl.textContent = fmtUSD(pnlUsd);
  stxt.textContent = `${active.status} (${active.dir})`;
  badge.textContent = 'ACTIVE';
  badge.className   = 'badge';

  slEl.textContent = active.sl.toFixed(2);
  t1El.textContent = active.tp1.toFixed(2);
  t2El.textContent = active.tp2.toFixed(2);
  t3El.textContent = active.tp3.toFixed(2);
}

/* ========= Export CSV ========= */
function exportCSV(store){
  const rows = [['time','sym','dir','entry','tp1','sl','exit','reason','status','pnl']];
  for(const t of store.trades){
    rows.push([new Date(t.openedAt).toISOString(), t.sym, t.dir, t.entry, t.tp1, t.sl, t.exit||'', t.reason||'', t.status, t.pnl]);
  }
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'signals.csv';
  a.click();
}

/* ========= Main flow ========= */
async function refresh() {
  const store = loadStore();

  // fetch hist for symbols
  const data = {};
  for(const s of SETTINGS.symbols){
    const hist = await window.Indicators.fetchHist(s);
    const sig  = window.Indicators.generateSignal(hist, s);
    data[s.slice(0,3)] = sig; // BTC / ETH

    // if a new cross -> open trade (avoid duplicates)
    if(sig.dir){
      const id = `${sig.symbol}_${sig.crossTime}`;
      if(!store.trades.some(t=>t.id===id)) {
        store.trades.unshift(newTradeFromSignal(sig));
      }
    }
  }

  // process ACTIVE trades by latest price (sig.lastClose of live candle)
  const prices = {
    BTC:{last:data.BTC.lastClose, time:data.BTC.lastTime},
    ETH:{last:data.ETH.lastClose, time:data.ETH.lastTime}
  };
  processActiveTrades(store, prices);
  saveStore(store);

  // draw cards — pick ACTIVE trade (latest by open time) for each symbol
  function pickActive(sym){
    return store.trades
      .filter(t=>t.sym===sym && t.status==='ACTIVE')
      .sort((a,b)=>b.openedAt-a.openedAt)[0] || null;
  }
  updateCard('BTC', data.BTC.lastClose, data.BTC.lastTime, pickActive('BTC'));
  updateCard('ETH', data.ETH.lastClose, data.ETH.lastTime, pickActive('ETH'));

  // stats + history
  drawStats(calcStats(store));
  drawHistory(store);

  document.getElementById('lastUpdated').textContent = 'Cập nhật: ' + new Date().toLocaleString();
}

/* ========= UI events ========= */
document.getElementById('btnRefresh').addEventListener('click', refresh);
document.getElementById('btnExport').addEventListener('click', ()=>exportCSV(loadStore()));
document.getElementById('btnClear').addEventListener('click', ()=>{
  const s = loadStore(); s.trades = s.trades.filter(t=>t.status==='ACTIVE'); saveStore(s); refresh();
});
document.querySelectorAll('button[data-details]').forEach(b=>{
  b.addEventListener('click', ()=>{
    const sym = b.dataset.details;
    const s = loadStore();
    const active = s.trades.filter(t=>t.sym===sym && t.status==='ACTIVE').sort((a,b)=>b.openedAt-a.openedAt)[0];
    if(!active){ alert('Không có lệnh ACTIVE.'); return; }
    alert(`${sym} • ${active.dir}\nEntry ${active.entry}\nTP1 ${active.tp1}\nSL ${active.sl}\nMins left: ${active.ttlMin}`);
  });
});

/* ========= First load ========= */
refresh();
