// scripts/fetch-cc.js
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const CC_KEY = process.env.CC_KEY; // sẽ lấy từ GitHub Secrets trong workflow
if (!CC_KEY) {
  console.error("Missing CC_KEY env var");
  process.exit(1);
}

// ====== Cấu hình ======
const OUT_DIR = "data";     // file JSON đầu ra sẽ nằm ở /data
const TF = "m15";           // timeframe hiển thị
const LIMIT = 200;          // số nến (đủ để tính EMA/SMC/ICT)
const TSYM = "USDT";        // đồng định giá
const SYMBOLS = ["BTC", "ETH"]; // thêm symbol nếu muốn
// ======================

// Lấy nến 15 phút từ CryptoCompare bằng histominute + aggregate=15
async function fetchHistMinute(fsym) {
  const url =
    `https://min-api.cryptocompare.com/data/v2/histominute?` +
    `fsym=${fsym}&tsym=${TSYM}&limit=${LIMIT}&aggregate=15&api_key=${CC_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch ${fsym} failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (json.Response !== "Success") {
    throw new Error(`API error ${fsym}: ${JSON.stringify(json)}`);
  }
  // Chuẩn hóa dữ liệu
  const candles = json.Data.Data.map(d => ({
    time: d.time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volumeto
  }));
  return candles;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

  const out = {
    updatedAt: new Date().toISOString(),
    timeframe: TF,
    quote: TSYM,
    data: {}
  };

  for (const sym of SYMBOLS) {
    const arr = await fetchHistMinute(sym);
    out.data[`${sym}${TSYM}`] = arr;
  }

  const file = path.join(OUT_DIR, `${TF}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("Wrote:", file, "pairs:", Object.keys(out.data).join(", "));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
