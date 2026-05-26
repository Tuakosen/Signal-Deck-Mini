/*
 * Backtest CLI. Usage:
 *   node backtest/run.js --demo                 # synthetic data, no file needed
 *   node backtest/run.js data.csv               # flat OHLCV CSV
 *   node backtest/run.js data.json              # { sessions: [...] }
 * Flags: --mode real | --minQuality A | --targetR 2 | --account 1000 | --risk 1
 *
 * CSV columns (header, case-insensitive): a datetime column (or date+time),
 * open, high, low, close, volume. Grouped into sessions by ET date; prior-day
 * high/low/close inferred from the previous session.
 */
'use strict';

var fs = require('fs');
var BT = require('./backtest.js');

function parseArgs(argv) {
  var o = { file: null, demo: false, mode: 'paper', minQuality: null, targetR: 2 };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--demo') o.demo = true;
    else if (a === '--mode') o.mode = argv[++i];
    else if (a === '--minQuality') o.minQuality = argv[++i];
    else if (a === '--targetR') o.targetR = parseFloat(argv[++i]);
    else if (a === '--account') o.account = parseFloat(argv[++i]);
    else if (a === '--risk') o.riskPct = parseFloat(argv[++i]) / 100;
    else if (a[0] !== '-') o.file = a;
  }
  return o;
}

function splitDateTime(s) {
  s = String(s).trim();
  if (/^\d{8}$/.test(s)) return { date: s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8), time: null };
  var sep = s.indexOf('T') >= 0 ? 'T' : ' ';
  var parts = s.split(sep);
  var date = parts[0];
  if (/^\d{8}$/.test(date)) date = date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8);
  var time = parts[1] ? parts[1].slice(0, 5) : null;
  if (time && /^\d{6}$/.test(parts[1])) time = parts[1].slice(0, 2) + ':' + parts[1].slice(2, 4);
  return { date: date, time: time };
}

function parseCsv(text) {
  var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (!lines.length) return [];
  var head = lines[0].toLowerCase().split(',').map(function (h) { return h.trim(); });
  function col() { for (var i = 0; i < arguments.length; i++) { var k = head.indexOf(arguments[i]); if (k >= 0) return k; } return -1; }
  var ci = {
    dt: col('datetime', 'timestamp'), date: col('date'), time: col('time'),
    o: col('open'), h: col('high'), l: col('low'), c: col('close'), v: col('volume', 'vol')
  };
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var f = lines[i].split(',');
    var dt = ci.dt >= 0 ? splitDateTime(f[ci.dt])
      : { date: splitDateTime(f[ci.date]).date, time: ci.time >= 0 ? (f[ci.time].length === 6 ? f[ci.time].slice(0, 2) + ':' + f[ci.time].slice(2, 4) : f[ci.time].slice(0, 5)) : null };
    var close = parseFloat(f[ci.c]);
    if (!isFinite(close)) continue;
    rows.push({
      date: dt.date, time: dt.time, o: parseFloat(f[ci.o]), h: parseFloat(f[ci.h]),
      l: parseFloat(f[ci.l]), c: close, v: ci.v >= 0 ? parseFloat(f[ci.v]) : 0
    });
  }
  return rows;
}

// Group flat rows into sessions (RTH only) with prior-day levels.
function toSessions(rows) {
  var byDate = {};
  var order = [];
  rows.forEach(function (r) {
    if (r.time) { var mins = parseInt(r.time.slice(0, 2), 10) * 60 + parseInt(r.time.slice(3, 5), 10); if (mins < 570 || mins > 960) return; }
    if (!byDate[r.date]) { byDate[r.date] = []; order.push(r.date); }
    byDate[r.date].push({ time: r.time || '12:00', o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
  });
  var sessions = [], prev = null;
  order.forEach(function (d) {
    var cs = byDate[d];
    var hi = -Infinity, lo = Infinity;
    cs.forEach(function (b) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); });
    var sess = { date: d, candles: cs };
    if (prev) { sess.priorDayHigh = prev.hi; sess.priorDayLow = prev.lo; sess.priorDayClose = prev.close; }
    sessions.push(sess);
    prev = { hi: hi, lo: lo, close: cs[cs.length - 1].c };
  });
  return sessions;
}

// Deterministic synthetic data for --demo (seeded so output is reproducible).
function demoSessions() {
  var seed = 42;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function session(date, drift) {
    var c = [], px = 500, t0 = 9 * 60 + 30;
    for (var i = 0; i < 60; i++) {
      var mins = t0 + i * 5;
      var step = drift + (rnd() - 0.5) * 0.4;
      var open = px, close = +(px + step).toFixed(2);
      var hi = +(Math.max(open, close) + rnd() * 0.2).toFixed(2);
      var lo = +(Math.min(open, close) - rnd() * 0.2).toFixed(2);
      c.push({ time: ('0' + Math.floor(mins / 60)).slice(-2) + ':' + ('0' + (mins % 60)).slice(-2), o: open, h: hi, l: lo, c: close, v: 100000 + Math.floor(rnd() * 50000) });
      px = close;
    }
    return { date: date, candles: c, priorDayHigh: 501, priorDayLow: 497, priorDayClose: 499 };
  }
  return [session('2026-05-18', 0.18), session('2026-05-19', -0.16), session('2026-05-20', 0.02)];
}

function fmt(n) { return n === Infinity ? '∞' : n; }

function report(r) {
  var L = [];
  L.push('');
  L.push('  SIGNAL DECK MINI — BACKTEST');
  L.push('  ' + '-'.repeat(46));
  L.push('  Mode: ' + r.meta.mode + '   Min quality: ' + (r.meta.minQuality || 'any') + '   Target: ' + r.meta.targetR + 'R');
  L.push('  Sessions: ' + r.sessions + '   Bars: ' + r.bars);
  L.push('  ' + '-'.repeat(46));
  L.push('  Trades:        ' + r.trades + '  (calls ' + r.calls + ', puts ' + r.puts + ')');
  L.push('  Win rate:      ' + r.winRate + '%  (' + r.wins + 'W / ' + r.losses + 'L)');
  L.push('  Avg R:         ' + (r.avgR >= 0 ? '+' : '') + r.avgR + 'R   (expectancy per trade)');
  L.push('  Total:         ' + (r.totalR >= 0 ? '+' : '') + r.totalR + 'R');
  L.push('  Profit factor: ' + fmt(r.profitFactor));
  L.push('  Max drawdown:  -' + r.maxDrawdownR + 'R');
  L.push('  ' + '-'.repeat(46));
  if (r.sample.length) {
    L.push('  Sample trades:');
    r.sample.forEach(function (t) {
      L.push('    ' + t.date + ' ' + (t.time || '') + '  ' + t.side + ' ' + t.quality +
        '  ' + (t.rMultiple >= 0 ? '+' : '') + (+t.rMultiple).toFixed(2) + 'R  (' + t.reason + ')');
    });
    L.push('  ' + '-'.repeat(46));
  }
  L.push('  NOTE: R-multiples are measured on the SPY UNDERLYING move, not on');
  L.push('  option premium. Real 0DTE premium P/L differs (theta/IV). This');
  L.push('  gauges the directional signal\'s edge — not a profitability claim.');
  L.push('  Educational only · not financial advice.');
  L.push('');
  return L.join('\n');
}

function main() {
  var o = parseArgs(process.argv.slice(2));
  var sessions;
  if (o.demo) {
    sessions = demoSessions();
  } else if (o.file) {
    var text = fs.readFileSync(o.file, 'utf8');
    if (/\.json$/i.test(o.file)) {
      var j = JSON.parse(text);
      sessions = j.sessions || (Array.isArray(j) ? toSessions(j) : []);
    } else {
      sessions = toSessions(parseCsv(text));
    }
  } else {
    console.log('Usage: node backtest/run.js --demo | <data.csv|data.json> [--mode real] [--minQuality A] [--targetR 2] [--account 1000] [--risk 1]');
    process.exit(1);
  }
  if (!sessions.length) { console.error('No sessions parsed from input.'); process.exit(1); }
  var res = BT.runBacktest(sessions, { mode: o.mode, minQuality: o.minQuality, targetR: o.targetR, account: o.account, riskPct: o.riskPct });
  console.log(report(res));
}

main();
