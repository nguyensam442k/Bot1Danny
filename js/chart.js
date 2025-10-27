/* =========================
   Signal Board m15 (BTC/ETH)
   - Data: CryptoCompare (public)
   - Logic: EMA(9/21) cross → BUY/SELL
   - Money: 100U x 25; TP1=0.3%, TP2=1.0%, SL=0.6%, Expiry=4h
   - Storage: localStorage (history + active trades + stats)
   ========================= */

const SYMS = ["BTCUSDT", "ETHUSDT"];
const FSYM = { BTCUSDT: "BTC", ETHUSDT: "ETH" }; // for API
const TSYM = "USDT";
const TF_MIN = 15;               // 15m
const LIMIT = 200;               // candles to pull
const MONEY = 100;               // 100U
const LEV = 25;
const TP1 = 0.003;               // 0.3%
const TP2 = 0.010;               // 1.0%
const TP3 = 0.020;               // 2.0% (thêm)
const SL = 0.006;                // 0.6%
const EXPIRY_MIN = 60 * 4;       // 4h
const LS_KEY = "mvp_trades_v1";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const fmt = (n, d=2) => (isFinite(n) ? Number(n).toFixed(d) : "—");
const now = () => new Date();

function getStore(){
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { return {}; }
}
function setStore(obj){
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}
function getArr(name){
  const s = getStore();
  if (!s[name]) s[name] = [];
  setStore(s);
  return s[name];
}
function setArr(name, arr){
  const s = getStore();
  s[name] = arr;
  setStore(s);
}

function msFromMin(m){ return m * 60 * 1000; }

function ema(values, period){
  const k = 2/(period+1);
  const out = [];
  let prev = values[0];
  out.push(prev);
  for (let i=1;i<values.length;i++){
    const v = values[i]*k + prev*(1-k);
    out.push(v);
    prev = v;
  }
  return out;
}

async function fetchCandles(sym){
  const url = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${FSYM[sym]}&tsym=${TSYM}&limit=${LIMIT}&aggregate=${TF_MIN}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status}`);
  const js = await r.json();
  if (!js.Data || !js.Data.Data) throw new Error("Bad payload");
  const arr = js.Data.Data;
  // Map to OHLC
  return arr.map(x => ({
    time: x.time*1000,
    open: x.open, high: x.high, low: x.low, close: x.close, vol: x.volumeto
  }));
}

function getActive(){
  return getArr("active");
}
function setActive(a){ setArr("active", a); }
function getHist(){ return getArr("history"); }
function setHist(a){ setArr("history", a); }
function getStats(){ return getStore().stats || {}; }
function setStats(o){
  const s = getStore(); s.stats = o; setStore(s);
}

function pushHistory(row){
  const his = getHist(); his.unshift(row); setHist(his);
}

function formatTime(ts){
  const d = new Date(ts);
  return d.toLocaleString();
}

function pnlDollar(entry, exit, dir){
  // dir = BUY or SELL
  const ret = dir==="BUY" ? (exit-entry)/entry : (entry-exit)/entry;
  const dollars = MONEY * LEV * ret;
  return dollars;
}

function ttlString(startTs){
  const passed = (Date.now()-startTs)/1000/60;
  const left = Math.max(0, EXPIRY_MIN - passed);
  const h = Math.floor(left/60), m = Math.floor(left%60);
  return `${h}h ${m}m`;
}

function updateStatsTable(){
  const stats = getStats();
  const rows = [
    {sym:"BTCUSDT", el: $('[data-sym="BTCUSDT"]')},
    {sym:"ETHUSDT", el: $('[data-sym="ETHUSDT"]')},
  ];
  let total = {tr:0, win:0, loss:0, flat:0, pl:0};
  for(const r of rows){
    const st = stats[r.sym] || {tr:0, win:0, loss:0, flat:0, pl:0};
    total.tr += st.tr; total.win += st.win; total.loss += st.loss; total.flat += st.flat; total.pl += st.pl;
    const tds = r.el.querySelectorAll('td');
    tds[1].textContent = st.tr;
    tds[2].textContent = st.win;
    tds[3].textContent = st.loss;
    tds[4].textContent = st.flat;
    tds[5].textContent = (st.tr? (100*st.win/st.tr).toFixed(1):"0.0") + "%";
    tds[6].textContent = `$${fmt(st.pl,2)}`;
  }
  const elT = $('[data-sym="TOTAL"]');
  const tds = elT.querySelectorAll('td');
  tds[1].textContent = total.tr;
  tds[2].textContent = total.win;
  tds[3].textContent = total.loss;
  tds[4].textContent = total.flat;
  tds[5].textContent = (total.tr? (100*total.win/total.tr).toFixed(1):"0.0") + "%";
  tds[6].textContent = `$${fmt(total.pl,2)}`;
}

function renderHistory(){
  const tb = $("#tblHist tbody"); tb.innerHTML = "";
  const his = getHist();
  for(const r of his){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatTime(r.time)}</td>
      <td>${r.sym.replace("USDT","")}</td>
      <td>${r.dir}</td>
      <td>${fmt(r.entry)}</td>
      <td>${fmt(r.tp)}</td>
      <td>${fmt(r.sl)}</td>
      <td>${fmt(r.exit)}</td>
      <td>${r.reason}</td>
      <td>${r.status}</td>
      <td>${(r.pnl>=0?'+':'')}$${fmt(r.pnl,2)}</td>
    `;
    tb.appendChild(tr);
  }
}

function addStat(sym, result, pnl){
  const stats = getStats();
  if (!stats[sym]) stats[sym] = {tr:0, win:0, loss:0, flat:0, pl:0};
  stats[sym].tr++;
  if (result==="WIN") stats[sym].win++;
  else if (result==="LOSS") stats[sym].loss++;
  else stats[sym].flat++;
  stats[sym].pl += pnl;
  setStats(stats);
}

// Build a trade object
function makeTrade(sym, dir, entry, ts){
  const tp1 = dir==="BUY" ? entry*(1+TP1) : entry*(1-TP1);
  const tp2 = dir==="BUY" ? entry*(1+TP2) : entry*(1-TP2);
  const tp3 = dir==="BUY" ? entry*(1+TP3) : entry*(1-TP3);
  const sl  = dir==="BUY" ? entry*(1-SL)  : entry*(1+SL);
  return {
    sym, dir, entry, tp1, tp2, tp3, sl,
    start: ts,
    status: "ACTIVE"
  };
}

function placeOrUpdateTrade(sym, signal, close, ts){
  let active = getActive();
  let t = active.find(x => x.sym===sym);
  if (!t){
    // open only when signal appears
    if (!signal) return; // nothing
    t = makeTrade(sym, signal, close, ts);
    active.push(t); setActive(active);
  }else{
    // if opposite signal appears, close by "Flip"
    if (signal && signal !== t.dir){
      // close at current price then open new
      const pnl = pnlDollar(t.entry, close, t.dir);
      pushHistory({
        time: ts, sym, dir: t.dir, entry: t.entry,
        tp: t.tp2, sl: t.sl, exit: close, reason: "Flip", status:"CLOSED", pnl
      });
      addStat(sym, pnl>=0?"WIN":"LOSS", pnl);
      // remove old
      active = active.filter(x=>x!==t);
      setActive(active);
      // open new
      const nt = makeTrade(sym, signal, close, ts);
      active.push(nt); setActive(active);
    }
  }
}

function stepCheckExitAndRender(sym, close, ts){
  const box = document.getElementById(`box-${sym}`);
  $("#current-"+sym).textContent = fmt(close);

  let active = getActive();
  let t = active.find(x => x.sym===sym);
  if (!t){
    $("#status-"+sym).textContent = "No trade";
    return;
  }
  $("#status-"+sym).textContent = "ACTIVE";
  $("#status-"+sym).classList.add("active");

  $("#entry-"+sym).textContent = fmt(t.entry);
  $("#tp1-"+sym).textContent = fmt(t.tp1);
  $("#tp2-"+sym).textContent = fmt(t.tp2);
  $("#tp3-"+sym).textContent = fmt(t.tp3);
  $("#sl-"+sym).textContent  = fmt(t.sl);
  $("#ttl-"+sym).textContent = ttlString(t.start);

  // pnl live
  const pnlP = t.dir==="BUY" ? (close-t.entry)/t.entry : (t.entry-close)/t.entry;
  $("#plp-"+sym).textContent = (pnlP*100).toFixed(2)+"%";
  const pnlD = MONEY*LEV*pnlP;
  $("#profit-"+sym).textContent = `${pnlD>=0?'+':''}$${fmt(pnlD,2)}`;

  // check exits
  let reason = "";
  if (t.dir==="BUY"){
    if (close<=t.sl){ reason="SL"; }
    else if (close>=t.tp2){ reason="TP2"; }
    else if ((Date.now()-t.start) > msFromMin(EXPIRY_MIN)){ reason="Expiry"; }
  }else{
    if (close>=t.sl){ reason="SL"; }
    else if (close<=t.tp2){ reason="TP2"; }
    else if ((Date.now()-t.start) > msFromMin(EXPIRY_MIN)){ reason="Expiry"; }
  }

  if (reason){
    const pnl = pnlDollar(t.entry, close, t.dir);
    pushHistory({
      time: ts, sym, dir:t.dir, entry:t.entry, tp:t.tp2, sl:t.sl,
      exit: close, reason, status:"CLOSED", pnl
    });
    addStat(sym, (reason==="SL"||pnl<0)?"LOSS":"WIN", pnl);
    active = active.filter(x=>x!==t); setActive(active);
  }
}

async function runForSym(sym){
  try{
    const candles = await fetchCandles(sym);
    if (!candles.length) return;

    const closes = candles.map(x => x.close);
    const ema9  = ema(closes, 9);
    const ema21 = ema(closes, 21);

    // last two
    const n = closes.length-1;
    const prevCross = Math.sign(ema9[n-1] - ema21[n-1]);
    const currCross = Math.sign(ema9[n]   - ema21[n]);

    let signal = null;
    if (prevCross<=0 && currCross>0) signal = "BUY";
    if (prevCross>=0 && currCross<0) signal = "SELL";

    // Place/open/flip if needed
    placeOrUpdateTrade(sym, signal, closes[n], candles[n].time);

    // Render box
    $("#last-"+sym).textContent = `Last: $${fmt(closes[n])}`;
    $("#time-"+sym).textContent = "15m";
    stepCheckExitAndRender(sym, closes[n], candles[n].time);

  }catch(e){
    console.error(sym, e);
    // hiển thị lỗi nhỏ
    $("#last-"+sym).textContent = "Error fetching";
  }
}

async function main(){
  // init default stores
  if (!localStorage.getItem(LS_KEY)){
    setStore({ active:[], history:[], stats:{} });
  }

  // chạy từng symbol
  await Promise.all(SYMS.map(runForSym));

  // cập nhật bảng
  updateStatsTable();
  renderHistory();
}

// ===== Buttons =====
$("#btnRefresh").addEventListener("click", () => main());

$("#btnClearKeepActive").addEventListener("click", ()=>{
  if (!confirm("Xóa lịch sử (giữ lệnh ACTIVE)?")) return;
  setHist([]);
  setStats({});
  updateStatsTable();
  renderHistory();
});

$("#btnExport").addEventListener("click", ()=>{
  const rows = getHist();
  const header = ["Time","Sym","Dir","Entry","TP","SL","Exit","Reason","Status","PnL($)"];
  const csv = [header.join(",")].concat(
    rows.map(r => [
      `"${formatTime(r.time)}"`,
      r.sym, r.dir, r.entry, r.tp, r.sl, r.exit, r.reason, r.status, r.pnl.toFixed(2)
    ].join(","))
  ).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `history_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// initial
main();
