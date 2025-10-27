// js/config.js
export const CONFIG = {
  title: "Signal Board — m15 (BTC/ETH)",
  dataUrl: "./data/m15.json",                 // GitHub Pages: đường dẫn tĩnh
  refreshSec: 30,                             // auto reload UI
  risk: {
    slPct: 1,                                 // 1%
    rMultiples: [1, 1.5, 2],                  // 1R,1.5R,2R
  },
  symbols: ["BTCUSDT", "ETHUSDT"]
};
