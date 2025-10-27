/* ===== ui.js =====
 * Orchestrator: tải dữ liệu, chạy backtest nhanh, render UI, thống kê (LIVE)
 */

function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function pnlUsd(entry, exit, dir) {
  const rr = dir === 'BUY' ? (exit - entry) / entry : (entry - exit) / entry;
  return APP_CONFIG.CAPITAL * APP_CONFIG.LEVERAGE * rr;
}
function winColor(v) { return v >= 0 ? '#2bd576' : '#ff5d5d'; }
function fmtTs(ts) { const d = new Date(ts); return d.toLocaleString(); }

function renderSkeleton() {
  const el = document.getElementById('app');
  el.innerHTML = `
    <h1>${APP_CONFIG.TITLE}</h1>

    <div class="box" id="box-summary">
      <h3>Tổng hợp thống kê (LIVE)</h3>
      <small>Ghi lệnh khi có tín hiệu; P&amp;L theo vốn 100U × 25, TP ${APP_CONFIG.TP_PCT*100}% / SL ${APP_CONFIG.SL_PCT*100}%, Expiry ${APP_CONFIG.EXPIRY_MINS} phút.</small>
      <table id="tbl-summary" style="width:100%; margin-top:8px">
        <thead><tr>
          <th style="text-align:left">Symbol</th>
          <th>Trades</th><th>Win</th><th>Loss</th><th>Flat</th>
          <th>Win-rate</th><th>P&amp;L ($)</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>

    <div class="box" id="box-signals">
      <div id="sig-btc"></div>
      <div id="sig-eth" style="margin-top:12px"></div>
    </div>

    <div class="box" id="box-history">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Lịch sử lệnh</h3>
        <div>
          <button id="btn-export">Export CSV</button>
          <button id="btn-clear">Xóa lịch sử (giữ lệnh ACTIVE)</button>
        </div>
      </div>
      <table id="tbl-history" style="width:100%;margin-top:8px">
        <thead><tr>
          <th>Time</th><th>Sym</th><th>Dir</th><th>Entry</th><th>TP</th><th>SL</th>
          <th>Exit</th><th>Reason</th><th>Status</th><th>P&amp;L ($)</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;
}

function rowSummaryHTML(sym, s) {
  const winRate = s.trades ? (s.win / s.trades * 100).toFixed(1) + '%' : '0.0%';
  return `<tr>
    <td style="text-align:left">${sym}</td>
    <td>${s.trades}</td><td>${s.win}</td><td>${s.loss}</td><td>${s.flat}</td>
    <td>${winRate}</td>
    <td style="color:${winColor(s.pnl)}">${s.pnl>=0?'+$':'-$'}${nf2.format(Math.abs(s.pnl))}</td>
  </tr>`;
}

function renderSummary(stats) {
  const tb = document.querySelector('#tbl-summary tbody');
  tb.innerHTML = '';
  let total = { trades:0, win:0, loss:0, flat:0, pnl:0 };
  for (const [sym, s] of Object.entries(stats)) {
    tb.insertAdjacentHTML('beforeend', rowSummaryHTML(sym, s));
    total.trades += s.trades; total.win += s.win; total.loss += s.loss; total.flat += s.flat; total.pnl += s.pnl;
  }
  tb.insertAdjacentHTML('beforeend', rowSummaryHTML('TOTAL', total));
}

function signalCardHTML(title, info, lastPrice) {
  if (!info) {
    return `<div class="box">
      <div style="display:flex;gap:8px;align-items:center">
        <span style="padding:4px 8px;background:#0f2545;border-radius:6px">${title}</span>
        <span style="padding:4px 8px;background:#0f2545;border-radius:6px">${APP_CONFIG.TIMEFRAME.label}</span>
        <span style="margin-left:auto">Last: $${nf2.format(lastPrice)}</span>
      </div>
      <div style="margin-top:8px">Không có tín hiệu mới ở nến vừa đóng.</div>
    </div>`;
  }
  const { dir, entry, tp, sl, time } = info;
  const now = Date.now();
  const minsLeft = Math.max(0, APP_CONFIG.EXPIRY_MINS - Math.floor((now - time) / 60000));
  const pnl = pnlUsd(entry, lastPrice, dir);
  return `<div class="box">
    <div style="display:flex;gap:8px;align-items:center">
      <span style="padding:4px 8px;background:#0f2545;border-radius:6px">${title}</span>
      <span style="padding:4px 8px;background:#0f2545;border-radius:6px">${APP_CONFIG.TIMEFRAME.label}</span>
      <span style="padding:4px 8px;background:#0f2545;border-radius:6px">${dir}</span>
      <span style="margin-left:auto">Last: $${nf2.format(lastPrice)}</span>
    </div>
    <div style="display:flex;gap:18px;margin-top:8px;flex-wrap:wrap">
      <div>ENTRY <b>$${nf2.format(entry)}</b></div>
      <div>TP <b>$${nf2.format(tp)}</b></div>
      <div>SL <b>$${nf2.format(sl)}</b></div>
      <div>Time <b>${APP_CONFIG.TIMEFRAME.label}</b></div>
      <div>P&amp;L <b style="color:${winColor(pnl)}">${pnl>=0?'+$':'-$'}${nf2.format(Math.abs(pnl))}</b></div>
      <div style="margin-left:auto">⏳ còn <b>${minsLeft}</b> phút</div>
    </div>
  </div>`;
}

function renderSignals(cards) {
  document.getElementById('sig-btc').innerHTML = cards.BTC;
  document.getElementById('sig-eth').innerHTML = cards.ETH;
}

function renderHistory(rows) {
  const tb = document.querySelector('#tbl-history tbody');
  tb.innerHTML = rows.map(r => {
    const pnl = pnlUsd(r.entry, r.exit, r.dir);
    return `<tr>
      <td>${fmtTs(r.time)}</td>
      <td>${r.sym}</td>
      <td>${r.dir}</td>
      <td>$${nf2.format(r.entry)}</td>
      <td>$${nf2.format(r.tp)}</td>
      <td>$${nf2.format(r.sl)}</td>
      <td>$${nf2.format(r.exit)}</td>
      <td>${r.status === 'TP' ? 'TP hit' : r.status === 'SL' ? 'SL hit' : 'Expired'}</td>
      <td>${r.status}</td>
      <td style="color:${winColor(pnl)}">${pnl>=0?'+$':'-$'}${nf2.format(Math.abs(pnl))}</td>
    </tr>`;
  }).join('');
}

function exportCSV(rows) {
  const headers = ['time','sym','dir','entry','tp','sl','exit','status'];
  const lines = [headers.join(',')];
  rows.forEach(r => {
    lines.push([r.time, r.sym, r.dir, r.entry, r.tp, r.sl, r.exit, r.status].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'history.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function main() {
  renderSkeleton();

  const stats = { BTC: { trades:0, win:0, loss:0, flat:0, pnl:0 }, ETH: { trades:0, win:0, loss:0, flat:0, pnl:0 } };
  const history = [];

  const cards = { BTC: '', ETH: '' };

  for (const s of APP_CONFIG.SYMBOLS) {
    const data = await TA.fetchCC({
      fsym: s.fsym, tsym: s.tsym,
      limit: APP_CONFIG.HISTORY_LIMIT,
      aggregate: APP_CONFIG.TIMEFRAME.aggregate,
    });

    const bt = TA.backtestEMA(data, s);

    // active card
    cards[s.id] = signalCardHTML(s.id, bt.active[0], bt.last.price);

    // closed orders -> update live stats + history
    for (const o of bt.closed.slice(-50)) {
      history.push(o);
      const pnl = pnlUsd(o.entry, o.exit, o.dir);
      const bucket = stats[s.id];
      bucket.trades++;
      if (o.status === 'TP') bucket.win++; else if (o.status === 'SL') bucket.loss++; else bucket.flat++;
      bucket.pnl += pnl;
    }
  }

  renderSignals(cards);
  renderSummary(stats);
  renderHistory(history);

  // buttons
  document.getElementById('btn-export').onclick = () => exportCSV(history);
  document.getElementById('btn-clear').onclick = () => {
    localStorage.removeItem(APP_CONFIG.STORAGE.HISTORY);
    location.reload();
  };
}

document.addEventListener('DOMContentLoaded', main);

