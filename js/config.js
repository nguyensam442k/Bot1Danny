// Global config + data adapters + small helpers
window.App = (() => {
  const CONFIG = {
    defaultExchange: 'binance',
    symbols: ['BTCUSDT','BNBUSDT','ETHUSDT','SOLUSDT'],
    timeframes: ['15m','1h','4h'],
    candlesLimit: 500,
    risk: { perTradeUSD: 100, leverage: 25 },  // 100u x 25
    tpSplit: [0.30,0.30,0.40],                 // TP1/TP2/TP3 weights
    tpR: [0.8, 1.4, 2.0],                      // RR multiples
    slR: 1.0,
    ema: [21,50,200],
    rsiPeriod: 14,
    stoch: [14,3],
    atr: 14,
    ccKey: '' // CryptoCompare key (nếu dùng CCCAGG)
  };

  function tfToMs(tf){
    const m = tf.match(/(\d+)([mhdw])/); if(!m) return 60000;
    const n=+m[1], u=m[2];
    const k = u==='m'?60000: u==='h'?3600000: u==='d'?86400000: 604800000;
    return n*k;
  }
  function expiryBars(tf){
    // 15m ~ 4h, 1h ~ 1d, 4h ~ ~6d (bạn đổi nếu muốn)
    if(tf==='15m') return 16;
    if(tf==='1h')  return 24;
    if(tf==='4h')  return 36;
    return 24;
  }
  function qtyFromNotional(price){
    const notional = CONFIG.risk.perTradeUSD * CONFIG.risk.leverage;
    return notional / price;
  }
  function pct(a,b){ return ((a-b)/b)*100; }
  const fmt2 = (x)=> (Math.round(x*100)/100).toFixed(2);

  // ----- Exchange adapters -----
  async function fetchBinance(symbol, interval, limit=500){
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url); if(!res.ok) throw new Error('binance fail');
    const data = await res.json();
    return data.map(k=>({t:k[0], o:+k[1], h:+k[2], l:+k[3], c:+k[4], v:+k[5]}));
  }
  async function fetchBybit(symbol, interval, limit=500){
    const map = { '1m':'1', '3m':'3', '5m':'5', '15m':'15', '30m':'30', '1h':'60', '2h':'120', '4h':'240', '6h':'360', '12h':'720', '1d':'D', '1w':'W'};
    const iv = map[interval] || '15';
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${iv}&limit=${Math.min(limit,1000)}`;
    const res = await fetch(url); if(!res.ok) throw new Error('bybit fail');
    const j = await res.json(); const arr = j.result?.list||[];
    return arr.reverse().map(k=>({t:+k[0], o:+k[1], h:+k[2], l:+k[3], c:+k[4], v:+k[5]}));
  }
  async function fetchCC(symbol, interval, limit=400){
    const fsym = symbol.replace(/USDT$/,''); const tsym = 'USDT';
    const base='https://min-api.cryptocompare.com/data';
    const path = interval.endsWith('m')? 'histominute' : interval.endsWith('h')? 'histohour' : 'histoday';
    const aggregate = parseInt(interval) || (interval==='1h'?1: (interval==='4h'?4:1));
    const url = `${base}/${path}?fsym=${fsym}&tsym=${tsym}&limit=${Math.min(limit,2000)}&aggregate=${aggregate}&e=CCCAGG`;
    const headers = CONFIG.ccKey? { headers: { Authorization: `Apikey ${CONFIG.ccKey}` } } : {};
    const res = await fetch(url, headers); if(!res.ok) throw new Error('cc fail');
    const j = await res.json(); const arr = j.Data || j.Data?.Data || j.Data?.data || j.Data;
    return (arr||[]).map(k=>({t:(k.time)*1000, o:+k.open, h:+k.high, l:+k.low, c:+k.close, v:+k.volumefrom}));
  }
  async function getKlines(ex,sym,tf,limit){
    if(ex==='binance') return fetchBinance(sym,tf,limit);
    if(ex==='bybit')   return fetchBybit(sym,tf,limit);
    return fetchCC(sym,tf,limit);
  }

  return { CONFIG, tfToMs, expiryBars, qtyFromNotional, pct, fmt2, getKlines };
})();
