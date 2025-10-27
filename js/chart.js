/* =======================
      INDICATORS
   ======================= */
function sma(arr, p) {
  if (arr.length < p) return Array(arr.length).fill(null);
  const out = []; let sum = 0;
  for (let i=0;i<arr.length;i++){
    sum += arr[i];
    if (i>=p) sum -= arr[i-p];
    out.push(i>=p-1 ? sum/p : null);
  }
  return out;
}
function ema(arr,p){
  const out = Array(arr.length).fill(null);
  if (arr.length===0) return out;
  const k = 2/(p+1);
  let prev = 0, sum = 0, s=p-1;
  for (let i=0;i<arr.length;i++){
    const v = arr[i];
    if (i<s){ sum += v; }
    else if (i===s){ sum += v; prev = sum/p; out[i]=prev; }
    else { prev = v*k + prev*(1-k); out[i]=prev; }
  }
  return out;
}
function trueRange(h,l,c){
  const out=[];
  for (let i=0;i<c.length;i++){
    if (i===0) out.push(h[i]-l[i]);
    else out.push(Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1])));
  }
  return out;
}
function atr(h,l,c,p=14){ return ema(trueRange(h,l,c),p); }
function rsi(arr,p=14){
  const out = Array(arr.length).fill(null);
  if (arr.length<p+1) return out;
  let g=0,l=0;
  for (let i=1;i<=p;i++){ const ch=arr[i]-arr[i-1]; if(ch>=0)g+=ch; else l-=ch; }
  let ag=g/p, al=l/p;
  out[p] = al===0?100:100-(100/(1+ag/al));
  for (let i=p+1;i<arr.length;i++){
    const ch=arr[i]-arr[i-1], G=Math.max(0,ch), L=Math.max(0,-ch);
    ag=(ag*(p-1)+G)/p; al=(al*(p-1)+L)/p;
    out[i]=al===0?100:100-(100/(1+ag/al));
  }
  return out;
}
function macd(arr,fast=12,slow=26,signalP=9){
  const f=ema(arr,fast), s=ema(arr,slow);
  const macdLine=arr.map((_,i)=> f[i]!=null&&s[i]!=null ? f[i]-s[i] : null);
  const sig = ema(macdLine.map(x=>x??0), signalP).map((v,i)=> macdLine[i]==null?null:v);
  const hist = macdLine.map((v,i)=> v!=null&&sig[i]!=null? v-sig[i] : null);
  return {macdLine:sanitize(macdLine), signal:sanitize(sig), hist:sanitize(hist)};
}
function sanitize(a){ return a.map(v => (Number.isFinite(v)?v:null)); }

/* =======================
      SMC / ICT
   ======================= */
// Swing points
function swingHigh(h, l, c, i, lb=2) {
  if (i<lb || i>h.length-1-lb) return false;
  for (let k=1;k<=lb;k++) if (!(h[i] > h[i-k] && h[i] > h[i+k])) return false;
  return true;
}
function swingLow(h, l, c, i, lb=2) {
  if (i<lb || i>l.length-1-lb) return false;
  for (let k=1;k<=lb;k++) if (!(l[i] < l[i-k] && l[i] < l[i+k])) return false;
  return true;
}
function getRecentSwings(h,l,c,lookback=60){
  const n=c.length, highs=[], lows=[];
  for (let i=n-lookback;i<n-1;i++){
    if (swingHigh(h,l,c,i)) highs.push(i);
    if (swingLow(h,l,c,i))  lows.push(i);
  }
  return {highs,lows};
}
// BOS/CHOCH (m15)
function hasBOS(c,h,l,dir,lookback=60){
  const {highs,lows} = getRecentSwings(h,l,c,lookback);
  const n=c.length, iClose=n-2;
  if (dir==='BUY'){
    // break last swing high
    const lastHighIdx = highs.length? highs[highs.length-1] : null;
    if (lastHighIdx==null) return false;
    return c[iClose] > h[lastHighIdx];
  } else {
    const lastLowIdx = lows.length? lows[lows.length-1] : null;
    if (lastLowIdx==null) return false;
    return c[iClose] < l[lastLowIdx];
  }
}
// FVG detection: bullish if Low[n] > High[n-2]; bearish if High[n] < Low[n-2]
function findRecentFVG(h,l,dir,lookback=40){
  const n=h.length;
  for (let i=n-3;i>n-lookback;i--){
    if (i<2) break;
    if (dir==='BUY'){ if (l[i] > h[i-2]) return {type:'bull',idx:i}; }
    else { if (h[i] < l[i-2]) return {type:'bear',idx:i}; }
  }
  return null;
}
// Liquidity Sweep: take out prior swing high/low then close back
function hasSweep(h,l,c,dir,lookback=40){
  const {highs,lows} = getRecentSwings(h,l,c,lookback);
  const n=c.length, iClose=n-2, close=c[iClose];
  if (dir==='BUY' && lows.length){
    const lastLowIdx=lows[lows.length-1], lvl=l[lastLowIdx];
    return (l[iClose] < lvl) && (close > lvl);
  }
  if (dir==='SELL' && highs.length){
    const lastHighIdx=highs[highs.length-1], lvl=h[lastHighIdx];
    return (h[iClose] > lvl) && (close < lvl);
  }
  return false;
}

/* =======================
      FETCH HISTORY
   ======================= */
async function fetchHistTF(symbol, tf='minute', limit=300){
  const fsym = symbol.slice(0,-4);
  const tsym = symbol.slice(-4);
  const endpoint = tf==='hour'?'histohour': tf==='day'?'histoday':'histominute';
  const url = `https://min-api.cryptocompare.com/data/v2/${endpoint}?fsym=${fsym}&tsym=${tsym}&limit=${limit}&e=Binance`;
  const r = await fetch(url); const j=await r.json();
  if (j.Response!=='Success') throw new Error(j.Message||'Fetch error');
  return j.Data.Data.map(x => ({time:x.time,open:x.open,high:x.high,low:x.low,close:x.close}));
}
const fetchHist     = (s)=> fetchHistTF(s,'minute',300);
const fetchHistHour = (s)=> fetchHistTF(s,'hour',400);

/* =======================
      SIGNAL ENGINE V3
   ======================= */
function generateSignal(histM15, symbol, histH1){
  const c15=histM15.map(x=>x.close);
  const h15=histM15.map(x=>x.high);
  const l15=histM15.map(x=>x.low);
  const t15=histM15.map(x=>x.time);
  const n=c15.length, iClose=n-2;
  if (iClose<60) return {symbol,lastClose:c15[n-1], lastTime:t15[n-1]*1000, signal:null};

  // base cross
  const e9=ema(c15,9), e21=ema(c15,21), sma200=sma(c15,200);
  const atr14=atr(h15,l15,c15,14), rsi14=rsi(c15,14), macd15=macd(c15);
  const e9Prev=e9[iClose-1], e21Prev=e21[iClose-1], e9Now=e9[iClose], e21Now=e21[iClose];
  let dir=null;
  if (e9Prev!=null && e21Prev!=null && e9Now!=null && e21Now!=null){
    if (e9Prev<=e21Prev && e9Now>e21Now) dir='BUY';
    if (e9Prev>=e21Prev && e9Now<e21Now) dir='SELL';
  }
  const lastCloseLive=c15[n-1], lastTimeLive=t15[n-1]*1000;
  if (!dir) return {symbol,lastClose:lastCloseLive,lastTime:lastTimeLive,signal:null};

  // Filters m15
  const entry=c15[iClose]; const atrV=atr14[iClose] || 0.008*entry;
  const trendOK=(dir==='BUY' && entry > (sma200[iClose]||entry)) || (dir==='SELL' && entry < (sma200[iClose]||entry));
  const rsiOK  =(dir==='BUY' && (rsi14[iClose]||0) > 50) || (dir==='SELL' && (rsi14[iClose]||100) < 50);
  const macdOK =(dir==='BUY' && (macd15.hist[iClose]||0) > 0) || (dir==='SELL' && (macd15.hist[iClose]||0) < 0);
  const volOK  =(atrV/entry) >= 0.003;

  // H1 EMA50 slope
  let htfOK=true;
  if (histH1 && histH1.length>55){
    const c1=histH1.map(x=>x.close); const e50=ema(c1,50);
    const k=e50.length-2; if (k>=1 && e50[k]!=null && e50[k-1]!=null){
      const slope=e50[k]-e50[k-1]; htfOK = dir==='BUY'? slope>0 : slope<0;
    }
  }

  // ===== SMC/ICT =====
  const bosOK   = hasBOS(c15,h15,l15,dir,80);
  const fvgInfo = findRecentFVG(h15,l15,dir,40);
  const fvgOK   = !!fvgInfo;
  const sweepOK = hasSweep(h15,l15,c15,dir,60);

  // Confidence with SMC weights
  const W = {trend:20, rsi:10, macd:15, vol:10, htf:15, bos:15, fvg:10, sweep:5};
  let score=0;
  if (trendOK) score+=W.trend;
  if (rsiOK)   score+=W.rsi;
  if (macdOK)  score+=W.macd;
  if (volOK)   score+=W.vol;
  if (htfOK)   score+=W.htf;
  if (bosOK)   score+=W.bos;
  if (fvgOK)   score+=W.fvg;
  if (sweepOK) score+=W.sweep;

  if (score < 60) {
    return {symbol,lastClose:lastCloseLive,lastTime:lastTimeLive,signal:null,conf:score};
  }

  // TP/SL theo ATR
  let tp1,tp2,tp3,sl;
  if (dir==='BUY'){
    tp1=entry + 1.0*atrV; tp2=entry + 1.5*atrV; tp3=entry + 2.0*atrV; sl=entry - 1.0*atrV;
  } else {
    tp1=entry - 1.0*atrV; tp2=entry - 1.5*atrV; tp3=entry - 2.0*atrV; sl=entry + 1.0*atrV;
  }

  return {
    symbol,lastClose:lastCloseLive,lastTime:lastTimeLive,
    crossTime:t15[iClose]*1000, dir, entry, tp1,tp2,tp3, sl,
    ema9:e9[iClose], ema21:e21[iClose], sma200:sma200[iClose], atr:atrV,
    conf:score,
    smc:{ bos:bosOK, fvg:fvgInfo, sweep:sweepOK }
  };
}

/* expose */
window.Indicators = {
  sma, ema, atr, rsi, macd,
  fetchHist, fetchHistHour,
  generateSignal
};
