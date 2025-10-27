/* =======================
    SETTINGS & STORE
   ======================= */
const SETTINGS = {
  symbols: ['BTCUSDT','ETHUSDT'],
  capital: 100, leverage: 25,
  expiryMinutes: 240
};
const emptyStore = () => ({ trades: [] });

function loadStore(){
  try { return JSON.parse(localStorage.getItem('SB_STORE_V3')) || emptyStore(); }
  catch { return emptyStore(); }
}
function saveStore(s){ localStorage.setItem('SB_STORE_V3', JSON.stringify(s)); }

/* =======================
      RENDER HELPERS
   ======================= */
function fmt(v, d=2){ if (v==null||!isFinite(v)) return '—'; return (v>=0?'+':'') + v.toFixed(d); }
function fnum(v, d=2){ if (v==null||!isFinite(v)) return '—'; return v.toFixed(d); }
function ts(t){ return (new Date(t)).toLocaleString(); }

function pnlUSD(entry, last, dir){
  if (!entry || !last) return 0;
  const ret = dir==='BUY' ? (last/entry-1) : (entry/last-1);
  return SETTINGS.capital * SETTINGS.leverage * ret;
}

/* =======================
      TRADE OBJECT
   ======================= */
function newTradeFromSignal(sig){
  const side = sig.dir;
  const id   = `${sig.symbol}_${sig.crossTime}`;
  return {
    id, sym: sig.symbol.slice(0,3),
    dir: side, entry: sig.entry,
    tp1: sig.tp1, tp2: sig.tp2, tp3: sig.tp3, sl: sig.sl,
    status: 'ACTIVE', reason: 'signal',
    openedAt: sig.crossTime, closedAt: null,
    exit: null, pnlUSD: 0, conf: sig.conf||0
  };
}

/* evaluate active trades -> close when hit TP/SL or expiry */
function processActiveTrades(store, prices){
  const now = Date.now();
  for (const t of store.trades){
    if (t.status !== 'ACTIVE') continue;
    const last = prices[t.sym]?.last;
    if (!last) continue;

    // hit TP/SL
    if (t.dir==='BUY'){
      if (last >= t.tp3){ t.exit=t.tp3; t.reason='TP3'; }
      else if (last >= t.tp2){ t.exit=t.tp2; t.reason='TP2'; }
      else if (last >= t.tp1){ t.exit=t.tp1; t.reason='TP1'; }
      else if (last <= t.sl)  { t.exit=t.sl;  t.reason='SL';  }
    } else {
      if (last <= t.tp3){ t.exit=t.tp3; t.reason='TP3'; }
      else if (last <= t.tp2){ t.exit=t.tp2; t.reason='TP2'; }
      else if (last <= t.tp1){ t.exit=t.tp1; t.reason='TP1'; }
      else if (last >= t.sl)  { t.exit=t.sl;  t.reason='SL';  }
    }

    // expiry
    const ttl = SETTINGS.expiryMinutes*60*1000;
    if (!t.exit && now - t.openedAt > ttl){
      t.exit = last; t.reason='EXPIRY';
    }

    if (t.exit){
      t.closedAt = now;
      t.pnlUSD   = pnlUSD(t.entry, t.exit, t.dir);
      t.status   = 'CLOSED';
    }
  }
}

/* =======================
       UI RENDER
   ======================= */
function updateCard(sym, price, time, trade){
  const low = sym.toLowerCase();
  document.getElementById(low+'Current').textContent = fnum(price);
  document.getElementById(low+'Time').textContent    = ts(time);

  if (!trade){
    document.getElementById(low+'Entry').textContent  = '—';
    document.getElementById(low+'PnL').textContent    = '—';
    document.getElementById(low+'Profit').textContent = '—';
    document.getElementById(low+'Status').textContent = 'No trade';
    document.getElementById(low+'SL').textContent  = '—';
    document.getElementById(low+'TP1').textContent = '—';
    document.getElementById(low+'TP2').textContent = '—';
    document.getElementById(low+'TP3').textContent = '—';
    return;
  }
  document.getElementById(low+'Entry').textContent  = fnum(trade.entry);
  document.getElementById(low+'SL').textContent     = fnum(trade.sl);
  document.getElementById(low+'TP1').textContent    = fnum(trade.tp1);
  document.getElementById(low+'TP2').textContent    = fnum(trade.tp2);
  document.getElementById(low+'TP3').textContent    = fnum(trade.tp3);
  document.getElementById(low+'Status').textContent = trade.status;

  const pnl = pnlUSD(trade.entry, price, trade.dir);
  const pct = pnl / (SETTINGS.capital*SETTINGS.leverage) * 100;
  const elP = document.getElementById(low+'PnL');
  const elD = document.getElementById(low+'Profit');
  elP.textContent = fmt(pct) + '%';
  elD.textContent = (pnl>=0?'+':'') + pnl.toFixed(2);
  elP.classList.toggle('neg', pnl<0);
  elD.classList.toggle('neg', pnl<0);
}

function drawHistory(store){
  const tb = document.querySelector('#tblHist tbody');
  tb.innerHTML = '';
  for (const t of store.trades){
    const tr = document.createElement('tr');
    const cols = [
      ts(t.openedAt), t.sym, t.dir, fnum(t.entry),
      `${fnum(t.tp1)}/${fnum(t.tp2)}/${fnum(t.tp3)}`,
      fnum(t.sl), t.exit?fnum(t.exit):'—', t.reason,
      t.status, (t.status==='CLOSED'?(t.pnlUSD>=0?'+':'')+t.pnlUSD.toFixed(2):'—')
    ];
    cols.forEach(x => { const td=document.createElement('td'); td.textContent=x; tr.appendChild(td); });
    tb.appendChild(tr);
  }
}

function calcStats(store){
  const agg = {BTC:{},ETH:{},TOTAL:{}};
  function acc(sym, t){
    const A=agg[sym], B=agg.TOTAL;
    ['trades','win','loss','flat','pnl'].forEach(k=>{
      A[k]=(A[k]||0); B[k]=(B[k]||0);
    });
    A.trades++; B.trades++;
    if (t.status==='CLOSED'){
      if (t.reason.startsWith('TP')){ A.win++; B.win++; }
      else if (t.reason==='SL'){ A.loss++; B.loss++; }
      else { A.flat++; B.flat++; }
      A.pnl += t.pnlUSD; B.pnl += t.pnlUSD;
    }
  }
  for (const t of store.trades) acc(t.sym,t);
  return agg;
}
function drawStats(agg){
  const rows = document.querySelectorAll('#tblStats tbody tr');
  const syms=['BTC','ETH','TOTAL'];
  syms.forEach((s, i)=>{
    const a = agg[s]||{};
    const t = a.trades||0, w=a.win||0, l=a.loss||0, f=a.flat||0, pnl=a.pnl||0;
    const wr = t? (w/t*100).toFixed(1)+'%':'0.0%';
    const cells = rows[i].children;
    cells[1].textContent=t; cells[2].textContent=w; cells[3].textContent=l; cells[4].textContent=f;
    cells[5].textContent=wr; cells[6].textContent=(pnl>=0?'+':'')+pnl.toFixed(2);
  });
}

/* =======================
        REFRESH
   ======================= */
async function refresh(){
  const store = loadStore();
  const data = {};

  for (const s of SETTINGS.symbols){
    const m15 = await window.Indicators.fetchHist(s);
    const h1  = await window.Indicators.fetchHistHour(s);
    const sig = window.Indicators.generateSignal(m15, s, h1);
    data[s.slice(0,3)] = sig;

    if (sig.dir){
      const id = `${sig.symbol}_${sig.crossTime}`;
      if (!store.trades.some(t => t.id===id)){
        const tr = newTradeFromSignal(sig);
        store.trades.unshift(tr);
      }
    }
  }

  const prices = {
    BTC: {last: data.BTC.lastClose, time: data.BTC.lastTime},
    ETH: {last: data.ETH.lastClose, time: data.ETH.lastTime}
  };
  processActiveTrades(store, prices);
  saveStore(store);

  const pickActive = sym => store.trades
    .filter(t=>t.sym===sym && t.status==='ACTIVE')
    .sort((a,b)=>b.openedAt-a.openedAt)[0] || null;

  updateCard('BTC', prices.BTC.last, prices.BTC.time, pickActive('BTC'));
  updateCard('ETH', prices.ETH.last, prices.ETH.time, pickActive('ETH'));

  document.getElementById('btcConf').textContent =
    'Conf: ' + ((pickActive('BTC')?.conf ?? data.BTC.conf ?? 0).toFixed(0)) + '%';
  document.getElementById('ethConf').textContent =
    'Conf: ' + ((pickActive('ETH')?.conf ?? data.ETH.conf ?? 0).toFixed(0)) + '%';

  drawStats(calcStats(store));
  drawHistory(store);
  document.getElementById('lastUpdated').textContent = 'Cập nhật: ' + new Date().toLocaleString();
}

/* =======================
      EXPORT / CLEAR
   ======================= */
function exportCSV(){
  const s = loadStore();
  const head = ['time,sym,dir,entry,tp1,tp2,tp3,sl,exit,reason,status,pnlUSD'];
  const rows = s.trades.map(t =>
    [
      ts(t.openedAt), t.sym, t.dir, t.entry, t.tp1, t.tp2, t.tp3, t.sl,
      t.exit ?? '', t.reason, t.status, t.pnlUSD ?? ''
    ].join(',')
  );
  const blob = new Blob([head.concat(rows).join('\n')], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'history.csv';
  a.click();
}
function clearHistory(){
  const s = loadStore();
  s.trades = s.trades.filter(t => t.status==='ACTIVE');
  saveStore(s);
  refresh();
}

/* =======================
      WIRE EVENTS
   ======================= */
document.getElementById('btnRefresh').addEventListener('click', refresh);
document.getElementById('btnExport').addEventListener('click', exportCSV);
document.getElementById('btnClear').addEventListener('click', clearHistory);

// details (chỉ hiển thị JSON thô nếu cần)
document.getElementById('btcDetails').addEventListener('click', ()=>alert('Xem lịch sử phía dưới nhé!'));
document.getElementById('ethDetails').addEventListener('click', ()=>alert('Xem lịch sử phía dưới nhé!'));

refresh(); // auto run on load
