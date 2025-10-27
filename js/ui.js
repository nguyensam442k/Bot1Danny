/* ======================================================
   CONFIG
   ====================================================== */
const CONFIG = {
  symbols: ['BTC', 'ETH'],
  tf: 'm15',
  ohlcApi: (sym) =>
    // CryptoCompare histominute + aggregate=15 => m15
    `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${sym}&tsym=USDT&e=Binance&limit=280&aggregate=15`,
  liveApi:
    'https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH&tsyms=USDT&e=Binance',

  capital: 100,           // vốn 100U
  leverage: 25,           // ×25
  riskPct: 0.01,          // SL 1% => 1R
  expiryHours: 4,         // đóng lệnh nếu quá 4h
  fastEMA: 9,
  slowEMA: 21,

  smcLookback: 60,        // số nến tìm BOS
  fvgLookback: 10,        // số nến gần nhất kiểm tra FVG
};

/* ======================================================
   STORE (localStorage)
   ====================================================== */
const LS_KEY = 'signal_store_v3';

function loadStore() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return { trades: [] };
  try { return JSON.parse(raw); } catch { return { trades: [] }; }
}
function saveStore(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

/* ======================================================
   UTIL
   ====================================================== */
function fmt(n, d=2) { return isFinite(n) ? Number(n).toFixed(d) : '—'; }
function cls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : '' }
function ts(t){ return new Date(t).toLocaleString(); }
function now(){ return Date.now(); }

/* ======================================================
   EMA + CROSS
   ====================================================== */
function ema(arr, period) {
  const k = 2 / (period + 1);
  let prev = arr[0], out = [prev];
  for (let i=1; i<arr.length; i++){
    const v = arr[i]*k + prev*(1-k);
    out.push(v); prev = v;
  }
  return out;
}

/* ======================================================
   SMC / ICT HELPERS
   ====================================================== */
// pivot high/low đơn giản: lookback = 2 (trái/phải)
function findPivots(highs, lows){
  const ph = [], pl = [];
  for (let i=2;i<highs.length;i++){
    if (highs[i-2]<highs[i-1] && highs[i-1]>highs[i]) ph.push({i:i-1, v:highs[i-1]});
    if (lows[i-2]>lows[i-1] && lows[i-1]<lows[i])   pl.push({i:i-1, v:lows[i-1]});
  }
  return {ph, pl};
}

// Tìm BOS gần đây (phá swing high/low gần nhất trong lookback)
function recentBOS(closes, highs, lows, lookback=60){
  const end = closes.length-2;                 // nến đã đóng
  const start = Math.max(0, end - lookback);
  const {ph, pl} = findPivots(highs.slice(start,end+1), lows.slice(start,end+1));
  if (!ph.length && !pl.length) return null;
  // map index về global
  const off = start;
  const realPh = ph.map(p=>({i:p.i+off, v:p.v}));
  const realPl = pl.map(p=>({i:p.i+off, v:p.v}));

  const lastClose = closes[end];

  // BOS up nếu lastClose vượt swing high gần nhất
  const lastHigh = realPh.length ? realPh[realPh.length-1].v : null;
  if (lastHigh && lastClose > lastHigh) return 'BUY';

  // BOS down nếu lastClose thủng swing low gần nhất
  const lastLow = realPl.length ? realPl[realPl.length-1].v : null;
  if (lastLow && lastClose < lastLow) return 'SELL';

  return null;
}

// Kiểm tra FVG gần đây: bullish FVG: low[i] > high[i-2], bearish FVG: high[i] < low[i-2]
function recentFVG(highs, lows, lookback=10){
  const end = highs.length-1;
  const start = Math.max(2, end - lookback);
  let up=false, dn=false;
  for (let i=start;i<=end;i++){
    if (lows[i] > highs[i-2]) up = true;
    if (highs[i] < lows[i-2]) dn = true;
    if (up && dn) break;
  }
  return {up, dn};
}

/* ======================================================
   FETCH
   ====================================================== */
async function fetchOHLC(sym){
  const r = await fetch(CONFIG.ohlcApi(sym));
  const j = await r.json();
  if (j.Response !== 'Success') throw new Error('OHLC fail: '+sym);
  const raw = j.Data.Data;
  return {
    closes: raw.map(d=>d.close),
    highs:  raw.map(d=>d.high),
    lows:   raw.map(d=>d.low),
  };
}
async function fetchLivePrices(){
  try{
    const r = await fetch(CONFIG.liveApi);
    const j = await r.json();
    const t = now();
    return {
      BTC: {last: j?.BTC?.USDT ?? null, time:t},
      ETH: {last: j?.ETH?.USDT ?? null, time:t},
    };
  }catch(e){
    console.error(e);
    const t = now();
    return { BTC:{last:null,time:t}, ETH:{last:null,time:t} };
  }
}

/* ======================================================
   RISK/TP-SL
   ====================================================== */
function buildTargets(entry, dir){
  const R = entry * CONFIG.riskPct; // 1R = 1% entry
  if (dir === 'BUY'){
    return { sl: entry - R, tp1: entry + 1*R, tp2: entry + 1.5*R, tp3: entry + 2*R };
  } else {
    return { sl: entry + R, tp1: entry - 1*R, tp2: entry - 1.5*R, tp3: entry - 2*R };
  }
}

/* ======================================================
   OPEN/CLOSE TRADE
   ====================================================== */
function openTrade(store, sym, dir, entry, conf, reason){
  // KHÔNG giới hạn số lệnh ACTIVE ⇒ không đóng lệnh cũ
  const tg = buildTargets(entry, dir);
  const t = {
    id: (Math.random()*1e9|0)+'',
    sym, dir, status:'ACTIVE',
    entry:+entry, ...tg,
    tpHit: null,
    openedAt: now(),
    expiryAt: now() + CONFIG.expiryHours*60*60*1000,
    leverage: CONFIG.leverage,
    capital: CONFIG.capital,
    conf: conf || 0,
    reason: reason || 'EMA9/21 + SMC/ICT',
    exit:null, closedAt:null, pnl:0
  };
  store.trades.push(t);
}

function calcPnl$(t, priceOverride){
  const price = priceOverride ?? t.exit ?? t.entry;
  const signed = (t.dir==='BUY') ? (price - t.entry) : (t.entry - price);
  const pct = signed / t.entry;                  // % thay đổi
  const notional = (t.capital||100)*(t.leverage||25);
  return +(pct * notional).toFixed(2);           // $ P&L
}

/* đóng lệnh theo hit TP, SL, Expiry */
function processActiveTrades(store, live){
  const tnow = now();
  for (const t of store.trades){
    if (t.status!=='ACTIVE') continue;
    const price = live[t.sym]?.last;
    if (!price || !isFinite(price)) continue;

    const isBuy = t.dir==='BUY';
    const hitSL = (isBuy && price<=t.sl) || (!isBuy && price>=t.sl);
    const hitTP =
      (isBuy && (price>=t.tp3 || price>=t.tp2 || price>=t.tp1)) ||
      (!isBuy && (price<=t.tp3 || price<=t.tp2 || price<=t.tp1));
    const whichTP = (()=>{
      if (!hitTP) return null;
      if (isBuy){
        if (price>=t.tp3) return 'TP3';
        if (price>=t.tp2) return 'TP2';
        if (price>=t.tp1) return 'TP1';
      }else{
        if (price<=t.tp3) return 'TP3';
        if (price<=t.tp2) return 'TP2';
        if (price<=t.tp1) return 'TP1';
      }
      return null;
    })();

    if (hitSL){
      t.status='LOSS'; t.exit=price; t.closedAt=tnow; t.tpHit=null; t.pnl=calcPnl$(t);
    } else if (whichTP){
      t.status='WIN';  t.exit=price; t.closedAt=tnow; t.tpHit=whichTP; t.pnl=calcPnl$(t);
    } else if (tnow>=t.expiryAt){
      t.status='FLAT'; t.exit=price; t.closedAt=tnow; t.tpHit=null; t.pnl=calcPnl$(t);
    }
  }
}

/* ======================================================
   TÍN HIỆU: EMA cross + SMC/ICT filter
   ====================================================== */
function signalWithSMC(closes, highs, lows){
  if (closes.length < CONFIG.slowEMA + 3) return null;
  const f = ema(closes, CONFIG.fastEMA);
  const s = ema(closes, CONFIG.slowEMA);
  const i = closes.length - 2; // nến đã đóng
  const prev = i-1;
  const wasUp = f[prev] > s[prev];
  const isUp  = f[i] > s[i];

  let base = null;
  if (!wasUp && isUp)  base = 'BUY';
  if ( wasUp && !isUp) base = 'SELL';
  if (!base) return null;

  // SMC/ICT confirm
  const bos = recentBOS(closes, highs, lows, CONFIG.smcLookback); // 'BUY' | 'SELL' | null
  const fvg = recentFVG(highs, lows, CONFIG.fvgLookback);         // {up, dn}

  let ok = false, reason = 'EMA cross';
  if (base==='BUY'){
    if (bos==='BUY'){ ok = true; reason += ' + BOS↑'; }
    if (!ok && fvg.up){ ok = true; reason += ' + FVG↑'; }
  } else {
    if (bos==='SELL'){ ok = true; reason += ' + BOS↓'; }
    if (!ok && fvg.dn){ ok = true; reason += ' + FVG↓'; }
  }
  if (!ok) return null;

  // Confidence: độ mở EMA + bonus nếu có BOS/FVG
  let conf = Math.abs((f[i]-s[i])/closes[i]) * 100;
  if ((base==='BUY'  && bos==='BUY')  || (base==='SELL' && bos==='SELL')) conf += 10;
  if ((base==='BUY'  && fvg.up)       || (base==='SELL' && fvg.dn))       conf += 5;

  return { dir: base, price: closes[i], conf:+conf.toFixed(2), reason };
}

/* ======================================================
   REFRESH (tick chậm): lấy OHLC & sinh tín hiệu
   ====================================================== */
async function refresh(){
  try{
    const store = loadStore();

    for (const sym of CONFIG.symbols){
      const {closes, highs, lows} = await fetchOHLC(sym);
      const sig = signalWithSMC(closes, highs, lows);
      if (sig){
        openTrade(store, sym, sig.dir, sig.price, sig.conf, sig.reason);
      }
    }

    saveStore(store);
    await quickTick(); // render ngay

  }catch(e){
    console.error('refresh error', e);
  }
}

/* ======================================================
   QUICK TICK (15s): giá live + cập nhật PnL/TP-SL + render
   ====================================================== */
async function quickTick(){
  try{
    const live = await fetchLivePrices();
    const store = loadStore();
    processActiveTrades(store, live);
    saveStore(store);

    // Chọn lệnh ACTIVE mới nhất để hiển thị trên card (nếu có nhiều lệnh)
    const latestActive = (sym) =>
      [...store.trades].filter(t=>t.sym===sym && t.status==='ACTIVE')
                       .sort((a,b)=>b.openedAt-a.openedAt)[0] || null;

    updateCard('BTC', live.BTC.last, live.BTC.time, latestActive('BTC'));
    updateCard('ETH', live.ETH.last, live.ETH.time, latestActive('ETH'));

    drawStats(calcStats(store));
    drawHistory(store);

    const el = document.getElementById('lastUpdated');
    if (el) el.textContent = 'Cập nhật: ' + new Date().toLocaleString();
  }catch(e){
    console.error('quickTick error', e);
  }
}

/* ======================================================
   STATS + HISTORY
   ====================================================== */
function calcStats(store){
  const out = {
    BTC:{tr:0,win:0,loss:0,flat:0,pnl:0},
    ETH:{tr:0,win:0,loss:0,flat:0,pnl:0},
  };
  for (const t of store.trades){
    if (t.status==='ACTIVE') continue;
    const g = out[t.sym]; if (!g) continue;
    g.tr++;
    if (t.status==='WIN') g.win++; else if (t.status==='LOSS') g.loss++; else g.flat++;
    g.pnl += +t.pnl||0;
  }
  const tot = {
    tr: out.BTC.tr+out.ETH.tr,
    win: out.BTC.win+out.ETH.win,
    loss: out.BTC.loss+out.ETH.loss,
    flat: out.BTC.flat+out.ETH.flat,
    pnl: +(out.BTC.pnl+out.ETH.pnl).toFixed(2),
  };
  out.TOTAL = tot;
  return out;
}
function drawStats(s){
  const body = document.getElementById('statsBody');
  const rows = ['BTC','ETH','TOTAL'].map(sym=>{
    const it = s[sym] || {tr:0,win:0,loss:0,flat:0,pnl:0};
    const wr = it.tr>0 ? (it.win*100/it.tr).toFixed(1)+'%' : '0.0%';
    return `<tr class="${sym==='TOTAL'?'total':''}">
      <td>${sym}</td>
      <td>${it.tr}</td>
      <td>${it.win}</td>
      <td>${it.loss}</td>
      <td>${it.flat}</td>
      <td>${wr}</td>
      <td>$${fmt(it.pnl)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = rows;
}

function drawHistory(store){
  const body = document.getElementById('historyBody');
  const rows = [...store.trades]
    .sort((a,b)=> (b.closedAt||b.openedAt) - (a.closedAt||a.openedAt))
    .slice(0,300)
    .map(t=>{
      const tpTxt = t.tpHit ? t.tpHit : '—';
      const exit = t.exit ? fmt(t.exit) : '—';
      const pnl = (t.status==='ACTIVE') ? '—' : `$${fmt(t.pnl)}`;
      return `<tr>
        <td>${ts(t.openedAt)}</td>
        <td>${t.sym}</td>
        <td>${t.dir}</td>
        <td>${fmt(t.entry)}</td>
        <td>${tpTxt}</td>
        <td>${fmt(t.sl)}</td>
        <td>${exit}</td>
        <td>${t.reason||'—'}</td>
        <td>${t.status}</td>
        <td class="${cls(t.pnl)}">${pnl}</td>
      </tr>`;
    }).join('');
  body.innerHTML = rows || '<tr><td colspan="10" class="muted">Chưa có lịch sử.</td></tr>';
}

/* ======================================================
   RENDER CARD
   ====================================================== */
function updateCard(sym, last, t, trade){
  const low = sym.toLowerCase();
  const set = (id, val)=>{ const el=document.getElementById(low+id); if(el) el.textContent=val; };

  set('Current', isFinite(last)? fmt(last):'—');
  set('Time', new Date(t).toLocaleTimeString());

  if (!trade){
    set('Entry','—'); set('PnlPct','—'); set('Profit','—'); set('Status','No trade');
    set('SL','—'); set('TP1','—'); set('TP2','—'); set('TP3','—'); set('Conf','Conf: —%');
    return;
  }

  set('Entry', fmt(trade.entry));
  set('SL', fmt(trade.sl));
  set('TP1', fmt(trade.tp1));
  set('TP2', fmt(trade.tp2));
  set('TP3', fmt(trade.tp3));
  set('Conf', `Conf: ${fmt(trade.conf,1)}%`);

  // PnL %
  const signed = trade.dir==='BUY' ? (last - trade.entry) : (trade.entry - last);
  const pnlPct = signed / trade.entry * 100;
  set('PnlPct', `${fmt(pnlPct,2)}%`);

  // PnL $
  const pnl$ = calcPnl$(trade, last);
  const el = document.getElementById(low+'Profit');
  if (el){ el.className = cls(pnl$); el.textContent = `$${fmt(pnl$)}`; }

  set('Status', trade.status);
}

/* ======================================================
   UI ACTIONS
   ====================================================== */
document.getElementById('btnRefresh')?.addEventListener('click', refresh);
document.getElementById('btnExport')?.addEventListener('click', ()=>{
  const store = loadStore();
  const rows = [['time','sym','dir','entry','tpHit','sl','exit','reason','status','pnl$']];
  for (const t of store.trades){
    rows.push([ts(t.openedAt), t.sym, t.dir, t.entry, t.tpHit||'', t.sl, t.exit||'', t.reason||'', t.status, t.pnl||0]);
  }
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'history.csv';
  a.click();
});
document.getElementById('btnClear')?.addEventListener('click', ()=>{
  const s = loadStore();
  s.trades = s.trades.filter(t=>t.status==='ACTIVE'); // giữ ACTIVE
  saveStore(s);
  drawHistory(s); drawStats(calcStats(s));
});

/* ======================================================
   SCHEDULER
   ====================================================== */
(async function init(){
  await refresh();                    // chạy full ngay khi load
  setInterval(quickTick, 15_000);     // giá & PnL nhanh
  setInterval(refresh,   60_000);     // tín hiệu m15 + SMC/ICT
})();
