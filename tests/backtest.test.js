/* Backtest harness tests (indicators + trade sim + end-to-end). No network.
   Run: node tests/backtest.test.js */
var IND = require('../backtest/indicators.js');
var BT = require('../backtest/backtest.js');

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 0.01); }

// ---- indicators ----
ok(IND.ema([1, 1, 1, 1], 3).every(function (v) { return v === 1; }), 'ema of constant series is constant');
var rising = []; for (var i = 0; i < 40; i++) rising.push(100 + i);
var mc = IND.macd(rising);
ok(mc && mc.macd[39] > 0, 'macd positive on a rising series');
var rs = IND.rsi(rising, 14);
ok(rs[39] === 100, 'rsi = 100 on a monotonic uptrend');
ok(IND.macd([1, 2, 3]) === null, 'macd null when too few bars');

// ---- trade sim: checkExit (conservative stop-first) ----
function call(over) { return Object.assign({ side: 'CALL', entry: 500, stop: 499, target: 502, R: 1, targetR: 2 }, over); }
ok(BT.checkExit(call(), { h: 503, l: 500.5 }).rMultiple === 2, 'CALL hits target -> +2R');
ok(BT.checkExit(call(), { h: 501, l: 498.5 }).rMultiple === -1, 'CALL hits stop -> -1R');
ok(BT.checkExit(call(), { h: 503, l: 498 }).rMultiple === -1, 'CALL stop+target same bar -> stop (conservative)');
ok(BT.checkExit(call(), { h: 501.5, l: 499.5 }) === null, 'CALL no touch -> open');
var put = { side: 'PUT', entry: 500, stop: 501, target: 498, R: 1, targetR: 2 };
ok(BT.checkExit(Object.assign({}, put), { h: 500.5, l: 497 }).rMultiple === 2, 'PUT hits target -> +2R');
ok(BT.checkExit(Object.assign({}, put), { h: 501.5, l: 499 }).rMultiple === -1, 'PUT hits stop -> -1R');

// ---- rOf fractional R ----
ok(BT.rOf({ side: 'CALL', entry: 500, R: 2 }, 503) === 1.5, 'rOf CALL fractional (+1.5R)');
ok(BT.rOf({ side: 'PUT', entry: 500, R: 2 }, 499) === 0.5, 'rOf PUT fractional (+0.5R)');

// ---- end-to-end on synthetic sessions ----
function makeSession(date, drift) {
  var c = [], px = 500;
  for (var k = 0; k < 60; k++) {
    var o = px, cl = +(px + drift).toFixed(2);
    c.push({ time: '1' + (k < 10 ? '0' : '') + k, o: o, h: Math.max(o, cl) + 0.1, l: Math.min(o, cl) - 0.1, c: cl, v: 100000 + k * 100 });
    px = cl;
  }
  return { date: date, candles: c, priorDayHigh: 501, priorDayLow: 497, priorDayClose: 499 };
}
// time strings above are placeholders; replace with valid HH:MM
function fixTimes(s) { s.candles.forEach(function (b, k) { var m = 9 * 60 + 30 + k * 5; b.time = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }); return s; }

var up = BT.runBacktest([fixTimes(makeSession('2026-05-18', 0.25))], {});
ok(up.trades >= 1, 'uptrend produces at least one trade');
ok(up.calls >= 1 && up.puts === 0, 'uptrend produces CALL trades only');
ok(up.wins + up.losses === up.trades, 'aggregate: wins + losses = trades');
ok(up.winRate >= 0 && up.winRate <= 100, 'win rate within [0,100]');

var down = BT.runBacktest([fixTimes(makeSession('2026-05-19', -0.25))], {});
ok(down.puts >= 1 && down.calls === 0, 'downtrend produces PUT trades only');

var all = BT.runBacktest([fixTimes(makeSession('2026-05-18', 0.25)), fixTimes(makeSession('2026-05-19', -0.25))], {});
var strict = BT.runBacktest([fixTimes(makeSession('2026-05-18', 0.25)), fixTimes(makeSession('2026-05-19', -0.25))], { minQuality: 'A+' });
ok(strict.trades <= all.trades, 'minQuality A+ filters to <= trades');
var real = BT.runBacktest([fixTimes(makeSession('2026-05-18', 0.25)), fixTimes(makeSession('2026-05-19', -0.25))], { mode: 'real' });
ok(real.trades <= all.trades, 'real-money mode takes <= paper trades');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
