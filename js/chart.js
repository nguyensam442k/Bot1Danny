/* ===== chart.js =====
 * Hàm dữ liệu & tính toán kỹ thuật cơ bản (EMA, backtest)
 */

// EMA đơn giản
function ema(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let emaPrev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (emaPrev == null) {
      // khởi tạo bằng SMA của period đầu
      const slice = values.slice(0, i + 1).filter(x => x != null);
      if (slice.length >= period) {
        emaPrev = slice.slice(-period).reduce((a, b) => a + b, 0) / period;
        out[i] = emaPrev;
      }
    } else {
      emaPrev = v * k + emaPrev * (1 - k);
      out[i] = emaPrev;
    }
  }
  return out;
}

// Lấy OHLC CryptoCompare (m15) -> mảng candles
async function fetchCC({ fsym, tsym, limit, aggregate }) {
  const url = APP_CONFIG.ccEndpoint({ fsym, tsym, limit, aggregate });
  const r = await fetch(url);
  const j = await r.json();
  if (!j || !j.Data || !j.Data.Data) throw new Error('Bad response');
  return j.Data.Data.map(d => ({
    time: d.time * 1000,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    vol: d.volumefrom,
  }));
}

/**
 * Backtest nhanh EMA9/EMA21 cross trên dữ liệu m15.
 * - Khi cross xảy ra tại nến đóng, mở lệnh theo close.
 * - TP/SL theo % config, hết hạn 4h (m15 -> 16 nến).
 * Trả về:
 *   { active: [], closed: [], last: {price, time} }
 */
function backtestEMA(data, symConf) {
  const closes = data.map(c => c.close);
  const emaFast = ema(closes, APP_CONFIG.EMA_FAST);
  const emaSlow = ema(closes, APP_CONFIG.EMA_SLOW);

  const bars = data.length;
  const maxAhead = Math.floor(APP_CONFIG.EXPIRY_MINS / APP_CONFIG.TIMEFRAME.aggregate);

  const closed = [];
  const active = [];

  for (let i = 1; i < bars - 1; i++) {
    const fastPrev = emaFast[i - 1], slowPrev = emaSlow[i - 1];
    const fast = emaFast[i], slow = emaSlow[i];

    if (fastPrev == null || slowPrev == null || fast == null || slow == null) continue;

    let dir = null;
    if (fastPrev <= slowPrev && fast > slow) dir = 'BUY';
    else if (fastPrev >= slowPrev && fast < slow) dir = 'SELL';

    if (!dir) continue;

    const entryBarIdx = i;              // lệnh “mở” sau khi nến i đóng
    const entry = closes[entryBarIdx];
    const tp = dir === 'BUY'
      ? entry * (1 + APP_CONFIG.TP_PCT)
      : entry * (1 - APP_CONFIG.TP_PCT);
    const sl = dir === 'BUY'
      ? entry * (1 - APP_CONFIG.SL_PCT)
      : entry * (1 + APP_CONFIG.SL_PCT);

    // check outcome trong vòng maxAhead nến tiếp theo
    let outcome = null, exit = entry, exitTime = data[entryBarIdx].time;
    for (let k = 1; k <= maxAhead && (entryBarIdx + k) < bars; k++) {
      const c = data[entryBarIdx + k];
      if (dir === 'BUY') {
        if (c.low <= sl) { outcome = 'SL'; exit = sl; exitTime = c.time; break; }
        if (c.high >= tp) { outcome = 'TP'; exit = tp; exitTime = c.time; break; }
      } else {
        if (c.high >= sl) { outcome = 'SL'; exit = sl; exitTime = c.time; break; }
        if (c.low <= tp) { outcome = 'TP'; exit = tp; exitTime = c.time; break; }
      }
    }
    if (!outcome) { // hết hạn
      outcome = 'EXP';
      const lastC = data[Math.min(entryBarIdx + maxAhead, bars - 1)];
      exit = lastC.close;
      exitTime = lastC.time;
    }

    closed.push({
      sym: symConf.pair,
      dir,
      entry,
      tp, sl,
      time: data[entryBarIdx].time,
      exit,
      exitTime,
      status: outcome,
    });
  }

  // Tín hiệu mới nhất (nếu nến cuối vừa cross)
  const i = bars - 2; // nến đã đóng gần nhất
  const fastPrev = emaFast[i - 1], slowPrev = emaSlow[i - 1];
  const fast = emaFast[i], slow = emaSlow[i];
  if (fastPrev != null && slowPrev != null && fast != null && slow != null) {
    let dir = null;
    if (fastPrev <= slowPrev && fast > slow) dir = 'BUY';
    else if (fastPrev >= slowPrev && fast < slow) dir = 'SELL';
    if (dir) {
      const entry = closes[i];
      active.push({
        sym: symConf.pair,
        dir,
        time: data[i].time,
        entry,
        tp: dir === 'BUY' ? entry * (1 + APP_CONFIG.TP_PCT) : entry * (1 - APP_CONFIG.TP_PCT),
        sl: dir === 'BUY' ? entry * (1 - APP_CONFIG.SL_PCT) : entry * (1 + APP_CONFIG.SL_PCT),
        status: 'ACTIVE',
      });
    }
  }

  return {
    active,
    closed,
    last: { price: closes[bars - 1], time: data[bars - 1].time },
  };
}

window.TA = { fetchCC, backtestEMA };

