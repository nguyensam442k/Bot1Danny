/* ========= Indicator helpers ========= */
function sma(arr, period) {
  if (arr.length < period) return Array(arr.length).fill(null);
  const out = [];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= period) sum -= arr[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

function ema(arr, period) {
  if (arr.length === 0) return [];
  const k = 2 / (period + 1);
  const out = new Array(arr.length).fill(null);
  let prev = 0, start = period - 1, sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (i < start) {
      sum += v;
      out[i] = null;
    } else if (i === start) {
      sum += v;
      prev = sum / period;
      out[i] = prev;
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function trueRange(h, l, c) {
  if (c.length === 0) return [];
  const out = [];
  for (let i = 0; i < c.length; i++) {
    if (i === 0) out.push(h[i] - l[i]);
    else out.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  return out;
}

function atr(h, l, c, period = 14) {
  const tr = trueRange(h, l, c);
  return ema(tr, period);
}

/* ========= Signal generator ========= */
/**
 * Given hist candles (o,h,l,c,t), return signal, levels, lastClose etc.
 * - timeframe: 15m
 */
function generateSignal(hist, symbol) {
  // use CLOSED candles only
  const closes = hist.map(x => x.close);
  const highs  = hist.map(x => x.high);
  const lows   = hist.map(x => x.low);
  const times  = hist.map(x => x.time);

  const e9  = ema(closes, 9);
  const e21 = ema(closes, 21);
  const s50 = sma(closes, 50);
  const a14 = atr(highs, lows, closes, 14);

  const n = closes.length;
  const iLastClosed = n - 2;              // last CLOSED candle index
  if (iLastClosed < 22) return { symbol, lastClose: closes[n-1], lastTime: times[n-1], signal: null };

  // cross on iLastClosed
  const e9Prev = e9[iLastClosed - 1], e21Prev = e21[iLastClosed - 1];
  const e9Now  = e9[iLastClosed],     e21Now  = e21[iLastClosed];
  let dir = null;
  if (e9Prev !== null && e21Prev !== null && e9Now !== null && e21Now !== null) {
    if (e9Prev <= e21Prev && e9Now > e21Now) dir = 'BUY';
    if (e9Prev >= e21Prev && e9Now < e21Now) dir = 'SELL';
  }

  const entry = closes[iLastClosed];
  const atrV  = a14[iLastClosed] ?? 0;

  // levels
  const tpPct = [0.006, 0.010, 0.014];
  let tp1, tp2, tp3, sl;
  if (dir === 'BUY') {
    tp1 = entry * (1 + tpPct[0]);
    tp2 = entry * (1 + tpPct[1]);
    tp3 = entry * (1 + tpPct[2]);
    sl  = entry - (atrV || entry * 0.008);
  } else if (dir === 'SELL') {
    tp1 = entry * (1 - tpPct[0]);
    tp2 = entry * (1 - tpPct[1]);
    tp3 = entry * (1 - tpPct[2]);
    sl  = entry + (atrV || entry * 0.008);
  }

  return {
    symbol,
    lastClose: closes[n - 1],
    lastTime: times[n - 1] * 1000,
    crossTime: times[iLastClosed] * 1000,
    dir,
    entry, tp1, tp2, tp3, sl,
    ema9: e9[iLastClosed], ema21: e21[iLastClosed], sma50: s50[iLastClosed], atr: atrV,
  };
}

/* ========= Fetch from CryptoCompare ========= */
async function fetchHist(symbol) {
  // symbol in BTCUSDT -> fsym=BTC, tsym=USDT
  const fsym = symbol.slice(0, -4);
  const tsym = symbol.slice(-4);
  const url = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${fsym}&tsym=${tsym}&limit=300&e=Binance`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.Response !== 'Success') throw new Error(j.Message || 'Fetch error');
  return j.Data.Data.map(x => ({
    time: x.time,
    open: x.open, high: x.high, low: x.low, close: x.close
  }));
}

window.Indicators = { sma, ema, atr, generateSignal, fetchHist };
