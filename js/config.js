/* ===== config.js =====
 * Cấu hình chung cho Signal Board
 * Data: CryptoCompare (Binance spot)
 * Khung chạy: m15
 */

window.APP_CONFIG = {
  TITLE: 'Signal Board — m15 (BTC/ETH)',
  SYMBOLS: [
    { id: 'BTC', pair: 'BTCUSDT', fsym: 'BTC', tsym: 'USDT' },
    { id: 'ETH', pair: 'ETHUSDT', fsym: 'ETH', tsym: 'USDT' },
  ],
  // m15 => dùng histominute với aggregate=15
  TIMEFRAME: { ccFn: 'histominute', aggregate: 15, label: '15m' },

  // Tham số tín hiệu & lệnh
  EMA_FAST: 9,
  EMA_SLOW: 21,
  HISTORY_LIMIT: 500,         // số nến tải về để backtest nhanh
  EXPIRY_MINS: 60 * 4,        // 4h cho m15
  CAPITAL: 100,               // mỗi lệnh 100U
  LEVERAGE: 25,               // đòn bẩy 25x
  TP_PCT: 0.006,              // 0.6% (TP)
  SL_PCT: 0.01,               // 1.0% (SL)

  STORAGE: {
    HISTORY: 'sb_history_v1', // lịch sử lệnh (đã xử lý)
  },

  // Endpoint CryptoCompare
  ccEndpoint({ fsym, tsym, limit, aggregate }) {
    const base = 'https://min-api.cryptocompare.com/data/v2';
    return `${base}/histominute?fsym=${fsym}&tsym=${tsym}&limit=${limit}&aggregate=${aggregate}`;
  },
};

// tiện: format
window.nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
window.nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
window.nf4 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

