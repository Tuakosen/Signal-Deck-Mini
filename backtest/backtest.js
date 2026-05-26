/*
 * Backtest harness — replays the Signal Deck engine over historical intraday
 * SPY candles and measures the DIRECTIONAL signal's edge in R-multiples.
 *
 * IMPORTANT (honesty): outcomes are measured on the SPY UNDERLYING move, not
 * on option premium. Real 0DTE premium P/L differs because of theta decay and
 * IV changes. This measures whether the engine's directional call has an edge;
 * it is not a claim of option-trade profitability. Still not financial advice.
 */
'use strict';

var ENGINE = require('../engine.js');
var IND = require('./indicators.js');

// Rough EDT/EST offset by month so detectSession() reads the right ET time.
function etDate(date, time) {
  var m = parseInt(date.slice(5, 7), 10);
  var off = (m >= 4 && m <= 10) ? '-04:00' : '-05:00';
  return new Date(date + 'T' + time + ':00' + off);
}

function volumeFlow(closes, vols, i) {
  if (i < 1) return 'MIXED';
  var look = Math.min(20, i), avg = 0;
  for (var k = i - look; k < i; k++) avg += (vols[k] || 0);
  avg /= look;
  var v = vols[i] || 0, up = closes[i] > closes[i - 1], down = closes[i] < closes[i - 1];
  if (avg && v > avg) return up ? 'CONFIRM_UP' : down ? 'CONFIRM_DOWN' : 'MIXED';
  if (avg && v < avg * 0.6) return 'WEAK';
  return 'MIXED';
}

function regimeOf(closes, i) {
  var look = Math.min(20, i);
  if (look < 5) return 'CHOP';
  var a = closes[i - look], hi = -Infinity, lo = Infinity;
  for (var k = i - look; k <= i; k++) { hi = Math.max(hi, closes[k]); lo = Math.min(lo, closes[k]); }
  var move = Math.abs(closes[i] - a) / a, range = (hi - lo) / a;
  if (range > 0.001 && move > range * 0.6) return 'TREND';
  if (range > 0.003) return 'RANGE';
  return 'CHOP';
}

var QUALITY_RANK = { 'C': 1, 'B': 2, 'A': 3, 'A+': 4 };
function qualityOk(q, min) {
  if (!min) return true;
  return (QUALITY_RANK[q] || 0) >= (QUALITY_RANK[min] || 0);
}

function rOf(t, exit) {
  return t.side === 'CALL' ? (exit - t.entry) / t.R : (t.entry - exit) / t.R;
}

// Conservative intrabar exit: if both stop and target are touched, count the stop.
function checkExit(t, bar) {
  if (t.side === 'CALL') {
    if (bar.l <= t.stop) { t.exit = t.stop; t.rMultiple = -1; t.reason = 'stop'; return t; }
    if (bar.h >= t.target) { t.exit = t.target; t.rMultiple = t.targetR; t.reason = 'target'; return t; }
  } else {
    if (bar.h >= t.stop) { t.exit = t.stop; t.rMultiple = -1; t.reason = 'stop'; return t; }
    if (bar.l <= t.target) { t.exit = t.target; t.rMultiple = t.targetR; t.reason = 'target'; return t; }
  }
  return null;
}

function runBacktest(sessions, opts) {
  opts = opts || {};
  var targetR = opts.targetR || 2;
  var warmup = opts.warmup || 26;
  var orBars = opts.orBars || 6;
  var htfRatio = opts.htfRatio || 3;
  var mode = opts.mode || 'paper';
  var minQuality = opts.minQuality || null;
  var trades = [];
  var bars = 0;

  sessions.forEach(function (s) {
    var c = s.candles || [];
    var closes = [], vols = [], cumPV = 0, cumV = 0, orHigh = null, orLow = null, inTrade = null;

    for (var i = 0; i < c.length; i++) {
      var bar = c[i];
      bars++;
      closes.push(bar.c); vols.push(bar.v || 0);
      var typical = (bar.h + bar.l + bar.c) / 3;
      cumPV += typical * (bar.v || 1); cumV += (bar.v || 1);
      var vwap = cumV ? cumPV / cumV : bar.c;
      if (i < orBars) { orHigh = orHigh === null ? bar.h : Math.max(orHigh, bar.h); orLow = orLow === null ? bar.l : Math.min(orLow, bar.l); }

      if (inTrade) { var ex = checkExit(inTrade, bar); if (ex) { trades.push(ex); inTrade = null; } }
      if (i < warmup || inTrade) continue;

      var mc = IND.macd(closes);
      if (!mc) continue;
      var last = closes.length - 1;
      var macdDir = mc.macd[last] > mc.signal[last] ? 'BULL' : mc.macd[last] < mc.signal[last] ? 'BEAR' : 'FLAT';
      var histo = Math.abs(mc.hist[last]) > Math.abs(mc.hist[last - 1] || 0) ? 'EXPANDING' : 'CONTRACTING';
      var rsiArr = IND.rsi(closes, 14);
      var rsiVal = rsiArr[last];
      // 15-min proxy: MACD on every htfRatio-th close
      var ds = closes.filter(function (_, idx) { return idx % htfRatio === (closes.length - 1) % htfRatio; });
      var mc15 = IND.macd(ds);
      var macd15 = mc15 ? (mc15.macd[mc15.macd.length - 1] > mc15.signal[mc15.signal.length - 1] ? 'BULL' : 'BEAR') : 'NEUTRAL';

      var sig = ENGINE.runAnalysis({
        now: etDate(s.date, bar.time || '12:00'), session: 'RTH', spy: bar.c,
        levels: { vwap: vwap, pdh: s.priorDayHigh, pdl: s.priorDayLow, pdc: s.priorDayClose, open: c[0].c, orh: orHigh, orl: orLow },
        macdDir: macdDir, histo: histo, macd15: macd15, rsi: rsiVal,
        volume: volumeFlow(closes, vols, i), regime: regimeOf(closes, i),
        qqq: 'NEUTRAL', es: 'NEUTRAL', vix: 'FLAT', yield10: 'FLAT', news: 'NEUTRAL',
        // synthetic liquid contract so the engine runs its CONFIRMED decision path;
        // P/L is still measured on the underlying, so the premium value is irrelevant.
        option: { bid: 1.00, ask: 1.02, volume: 5000, oi: 5000, delta: 0.5 },
        mode: mode, account: opts.account, riskPct: opts.riskPct
      });

      if (sig.action !== 'BUY CALL' && sig.action !== 'BUY PUT') continue;
      if (!qualityOk(sig.tradeQuality, minQuality)) continue;
      var inval = sig.plan.invalidation;
      if (inval == null) continue;
      var side = sig.action === 'BUY CALL' ? 'CALL' : 'PUT';
      var entry = bar.c, R = Math.abs(entry - inval);
      if (R <= 0) continue;
      inTrade = {
        side: side, entry: entry, stop: inval, R: R, targetR: targetR,
        target: side === 'CALL' ? entry + targetR * R : entry - targetR * R,
        quality: sig.tradeQuality, date: s.date, time: bar.time
      };
    }

    if (inTrade) {
      var lc = c[c.length - 1].c;
      inTrade.exit = lc; inTrade.rMultiple = rOf(inTrade, lc); inTrade.reason = 'session-end';
      trades.push(inTrade); inTrade = null;
    }
  });

  return aggregate(trades, bars, sessions.length, { targetR: targetR, mode: mode, minQuality: minQuality });
}

function aggregate(trades, bars, sessionCount, meta) {
  var n = trades.length, wins = 0, grossWin = 0, grossLoss = 0, totalR = 0;
  var calls = 0, puts = 0, peak = 0, cum = 0, maxDD = 0;
  trades.forEach(function (t) {
    totalR += t.rMultiple;
    if (t.rMultiple > 0) { wins++; grossWin += t.rMultiple; } else { grossLoss += -t.rMultiple; }
    if (t.side === 'CALL') calls++; else puts++;
    cum += t.rMultiple; peak = Math.max(peak, cum); maxDD = Math.max(maxDD, peak - cum);
  });
  return {
    meta: meta, sessions: sessionCount, bars: bars,
    trades: n, calls: calls, puts: puts,
    wins: wins, losses: n - wins,
    winRate: n ? +(wins / n * 100).toFixed(1) : 0,
    avgR: n ? +(totalR / n).toFixed(3) : 0,
    totalR: +totalR.toFixed(2),
    profitFactor: grossLoss ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? Infinity : 0),
    maxDrawdownR: +maxDD.toFixed(2),
    sample: trades.slice(0, 5)
  };
}

module.exports = { runBacktest: runBacktest, etDate: etDate, qualityOk: qualityOk, checkExit: checkExit, rOf: rOf };
