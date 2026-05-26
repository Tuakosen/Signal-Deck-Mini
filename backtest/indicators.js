/*
 * Technical indicators for the backtest harness (pure, no deps).
 * Standard formulas: EMA, MACD(12,26,9), Wilder RSI(14).
 */
'use strict';

function ema(vals, period) {
  var k = 2 / (period + 1), out = [], prev;
  for (var i = 0; i < vals.length; i++) {
    prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function macd(closes, fast, slow, signalP) {
  fast = fast || 12; slow = slow || 26; signalP = signalP || 9;
  if (closes.length < slow) return null;
  var ef = ema(closes, fast), es = ema(closes, slow);
  var line = closes.map(function (_, i) { return ef[i] - es[i]; });
  var signal = ema(line, signalP);
  var hist = line.map(function (v, i) { return v - signal[i]; });
  return { macd: line, signal: signal, hist: hist };
}

// Wilder's RSI. Returns an array aligned to closes (null until warmed up).
function rsi(closes, period) {
  period = period || 14;
  var out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  var avgG = 0, avgL = 0, i;
  for (i = 1; i <= period; i++) {
    var ch = closes[i] - closes[i - 1];
    if (ch > 0) avgG += ch; else avgL += -ch;
  }
  avgG /= period; avgL /= period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (i = period + 1; i < closes.length; i++) {
    var c = closes[i] - closes[i - 1];
    var g = c > 0 ? c : 0, l = c < 0 ? -c : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

module.exports = { ema: ema, macd: macd, rsi: rsi };
