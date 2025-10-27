// scripts/fetch-cc.js
// Lấy OHLC m15 (aggregate=15) từ CryptoCompare, tính EMA9/EMA21, tạo tín hiệu, ghi data/m15.json

import fetch from "node-fetch";
import fs from "fs";

const API_KEY = process.env.CC_KEY || process.env.CRYPTOCOMPARE_KEY;
if (!API_KEY) {
  console.error("Missing CC_KEY/CRYPTOCOMPARE_KEY (repo secret)!");
  process.exit(1);
}

// --- Config ---
const PAIRS = [
  { base: "BTC", quote: "USDT" },
  { base: "ETH", quote: "USDT" },
];
const LIMIT = 300;            // số nến 15m gần nhất
const AGG  = 15;              // 15 phút
const SL_PCT = 0.01;          // 1%
const TPs    = [1, 1.5, 2];   // R multiples

// EMA helper
function ema(values, period) {
  if (!values?.length || values.length < period) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  // SMA seed
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

async function fetchOhlc(fsym, tsym) {
  const url =
    `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${fsym}&tsym=${tsym}&limit=${LIMIT}&aggregate=${AGG}`;

  const res = await fetch(url, {
    headers: { authorization: `Apikey ${API_KEY}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} - ${txt}`);
  }
  const j = await res.json();
  if (j?.Response !== "Success") {
    throw new Error(`CC error: ${JSON.stringify(j)}`);
  }
  return j.Data.Data.map((d) => ({
    time: d.time * 1000,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    vol: d.volumefrom,
  }));
}

function buildSignal(closes) {
  const ema9  = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const n = closes.length - 1;

  if (n < 22 || ema9[n] == null || ema21[n] == null) {
    return { side: "NONE", conf: 0, ema9: ema9[n], ema21: ema21[n] };
  }

  const prevA = ema9[n - 1], prevB = ema21[n - 1];
  const curA  = ema9[n],     curB  = ema21[n];
  const crossUp   = prevA <= prevB && curA > curB;
  const crossDown = prevA >= prevB && curA < curB;

  let side = "NONE";
  if (crossUp) side = "BUY";
  else if (crossDown) side = "SELL";

  // confidence: khoảng cách 2 EMA so với giá (0..1)
  const dist = Math.abs(curA - curB);
  const conf = Math.min(1, dist / (closes[n] * 0.005)); // 0.5%

  return { side, conf: +(conf * 100).toFixed(1), ema9: curA, ema21: curB };
}

function levels(entry, side) {
  const R = SL_PCT * entry;
  const sl = side === "BUY" ? entry - R : entry + R;
  const tps = TPs.map(r => side === "BUY" ? entry + r * R : entry - r * R);
  return { sl, tp1: tps[0], tp2: tps[1], tp3: tps[2] };
}

async function main() {
  const out = {
    updatedAt: new Date().toISOString(),
    timeframe: "m15",
    rules: {
      entry: "EMA9/EMA21 cross",
      sl: "1%",
      tp: "TP1 1R, TP2 1.5R, TP3 2R",
    },
    symbols: {},
  };

  for (const p of PAIRS) {
    try {
      const ohlc = await fetchOhlc(p.base, p.quote);
      const closes = ohlc.map(d => d.close);
      const sig = buildSignal(closes);
      const last = ohlc[ohlc.length - 1]?.close ?? null;

      const entry = last; // entry dùng close của nến mới nhất
      const lev = sig.side === "NONE" || !entry
        ? { sl: null, tp1: null, tp2: null, tp3: null }
        : levels(entry, sig.side);

      out.symbols[`${p.base}${p.quote}`] = {
        price: last,
        side : sig.side,
        conf : sig.conf,          // %
        ema9 : +Number(sig.ema9 || 0).toFixed(2),
        ema21: +Number(sig.ema21 || 0).toFixed(2),
        entry: entry,
        levels: lev
      };
    } catch (e) {
      console.error(p.base, "failed:", e.message);
      out.symbols[`${p.base}${p.quote}`] = {
        error: e.message || String(e),
      };
    }
  }

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/m15.json", JSON.stringify(out, null, 2));
  console.log("Wrote data/m15.json", out.updatedAt);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
