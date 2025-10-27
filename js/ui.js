// js/ui.js
import { CONFIG } from "./config.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

function badge(side) {
  if (side === "BUY")  return `<span class="badge buy">BUY</span>`;
  if (side === "SELL") return `<span class="badge sell">SELL</span>`;
  return `<span class="badge none">No trade</span>`;
}

async function loadJson(url) {
  const bust = `?_=${Date.now()}`;
  const res = await fetch(url + bust, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderSymbol(sym, data) {
  const row = document.createElement("div");
  row.className = "card";

  const s = data?.symbols?.[sym] ?? {};
  const levels = s?.levels || {};

  row.innerHTML = `
    <div class="card__head">
      <div class="card__title">${sym.replace("USDT","")} <span class="tf">m15</span></div>
      <div class="card__side">${badge(s.side)} <span class="conf">${fmt(s.conf,1)}%</span></div>
    </div>

    <div class="grid">
      <div><label>ENTRY</label><div>${fmt(s.entry)}</div></div>
      <div><label>CURRENT</label><div>${fmt(s.price)}</div></div>
      <div><label>P&L %</label><div>${
        s.side && s.entry
          ? (s.side === "BUY"
              ? fmt(((s.price - s.entry) / s.entry) * 100, 2)
              : fmt(((s.entry - s.price) / s.entry) * 100, 2))
          : "—"
      }%</div></div>
      <div><label>EMA9 / EMA21</label><div>${fmt(s.ema9)} / ${fmt(s.ema21)}</div></div>
    </div>

    <div class="levels">
      <div class="lv"><span>▼ SL</span><b>${fmt(levels.sl)}</b></div>
      <div class="lv"><span>🎯 TP1</span><b>${fmt(levels.tp1)}</b></div>
      <div class="lv"><span>🎯 TP2</span><b>${fmt(levels.tp2)}</b></div>
      <div class="lv"><span>🎯 TP3</span><b>${fmt(levels.tp3)}</b></div>
    </div>
  `;

  return row;
}

async function refresh() {
  try {
    const data = await loadJson(CONFIG.dataUrl);
    $("#updated").textContent = new Date(data.updatedAt).toLocaleString();

    const host = $("#symbols");
    host.innerHTML = "";
    CONFIG.symbols.forEach(sym => {
      host.appendChild(renderSymbol(sym, data));
    });

  } catch (e) {
    console.error(e);
    $("#symbols").innerHTML = `<div class="error">Load failed: ${e.message}</div>`;
  }
}

function init() {
  $("#title").textContent = CONFIG.title;
  $("#note").textContent =
    `Ghi lệnh khi có tín hiệu (EMA9/EMA21 cross). TP/SL theo R: SL ${CONFIG.risk.slPct}%, TP1 ${CONFIG.risk.rMultiples[0]}R, TP2 ${CONFIG.risk.rMultiples[1]}R, TP3 ${CONFIG.risk.rMultiples[2]}R. Dữ liệu đồng bộ (server JSON).`;

  $("#btnRefresh").addEventListener("click", refresh);

  refresh();
  setInterval(refresh, CONFIG.refreshSec * 1000);
}

document.addEventListener("DOMContentLoaded", init);
