/* Node test runner for the Signal Deck Mini engine. Run: node tests/engine.test.js */
var E = require('../engine.js');

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}

// A weekday RTH timestamp: Wed 2026-05-20 14:00 UTC = 10:00 ET.
var RTH = '2026-05-20T14:00:00Z';
// A Sunday (market closed).
var CLOSED = '2026-05-24T14:00:00Z';

// 1) Clean bullish RTH setup -> BUY CALL
var bull = E.runAnalysis({
  now: RTH, session: 'AUTO', spy: 521.40,
  levels: { vwap: 520.50, resistance: 522.00, support: 519.00, pdc: 519.80, open: 520.10 },
  macdDir: 'BULL', histo: 'EXPANDING', macd15: 'BULL', rsi: 58,
  volume: 'CONFIRM_UP', qqq: 'BULL', es: 'BULL', vix: 'DOWN', yield10: 'DOWN',
  regime: 'TREND', news: 'BULLISH', newsHeadline: 'Cooler CPI print',
  option: { bid: 1.20, ask: 1.24, volume: 8000, oi: 12000, iv: 0.18, delta: 0.52 }
});
ok(bull.action === 'BUY CALL', 'bullish RTH -> BUY CALL');
ok(bull.contract.direction === 'CALL', 'bullish -> CALL contract');
ok(bull.plan.rr >= 2, 'R/R meets 1:2 floor (got ' + bull.plan.rr + ')');
ok(bull.contract.totalCost === 122, 'total cost = premium*100 (got ' + bull.contract.totalCost + ')');
ok(bull.status === 'CONFIRMED 0DTE OPTIONS SIGNAL', 'valid options -> CONFIRMED status');
ok(bull.optionsAvailable === true, 'valid options -> optionsAvailable true');
ok(bull.contract.status === 'Confirmed', 'confirmed contract status');
ok(bull.plan.mode === 'Confirmed Options', 'confirmed -> options entry plan mode');

// 2) Clean bearish RTH setup -> BUY PUT
var bear = E.runAnalysis({
  now: RTH, session: 'AUTO', spy: 518.20,
  levels: { vwap: 519.30, resistance: 520.50, support: 517.00 },
  macdDir: 'BEAR', histo: 'EXPANDING', macd15: 'BEAR', rsi: 42,
  volume: 'CONFIRM_DOWN', qqq: 'BEAR', es: 'BEAR', vix: 'UP', yield10: 'UP',
  regime: 'TREND', news: 'BEARISH', newsHeadline: 'Hawkish Fed minutes',
  option: { bid: 1.05, ask: 1.08, volume: 6000, oi: 9000, iv: 0.20, delta: -0.50 }
});
ok(bear.action === 'BUY PUT', 'bearish RTH -> BUY PUT');
ok(bear.contract.direction === 'PUT', 'bearish -> PUT contract');

// 3) Chop around VWAP -> NO OPTIONS TRADE
var chop = E.runAnalysis({
  now: RTH, session: 'AUTO', spy: 520.05,
  levels: { vwap: 520.00, resistance: 521, support: 519 },
  macdDir: 'BULL', histo: 'FLAT', macd15: 'NEUTRAL', rsi: 51,
  volume: 'MIXED', qqq: 'NEUTRAL', es: 'NEUTRAL', vix: 'FLAT', yield10: 'FLAT',
  regime: 'CHOP', news: 'NEUTRAL',
  option: { bid: 1.10, ask: 1.13, volume: 5000, oi: 8000 }
});
ok(chop.action === 'NO OPTIONS TRADE', 'VWAP chop -> NO OPTIONS TRADE');
ok(chop.vwapState === 'CHOP', 'detects VWAP chop state');

// 4) Wide spread kills an otherwise-bullish setup
var wide = E.runAnalysis({
  now: RTH, session: 'AUTO', spy: 521.40,
  levels: { vwap: 520.50, resistance: 522, support: 519 },
  macdDir: 'BULL', histo: 'EXPANDING', macd15: 'BULL', rsi: 58,
  volume: 'CONFIRM_UP', qqq: 'BULL', es: 'BULL', vix: 'DOWN', yield10: 'DOWN',
  regime: 'TREND', news: 'BULLISH',
  option: { bid: 1.10, ask: 1.45, volume: 8000, oi: 12000 } // $0.35 spread
});
ok(wide.action === 'NO OPTIONS TRADE', 'wide spread -> NO OPTIONS TRADE');
ok(wide.gates.some(function (g) { return g.tag === 'OPT'; }), 'wide spread logs OPT gate');

// 5) Low liquidity -> NO OPTIONS TRADE
var thin = E.runAnalysis({
  now: RTH, session: 'AUTO', spy: 521.40,
  levels: { vwap: 520.50, resistance: 522, support: 519 },
  macdDir: 'BULL', histo: 'EXPANDING', macd15: 'BULL', rsi: 58,
  volume: 'CONFIRM_UP', qqq: 'BULL', es: 'BULL', vix: 'DOWN', yield10: 'DOWN',
  regime: 'TREND', news: 'BULLISH',
  option: { bid: 1.20, ask: 1.23, volume: 100, oi: 50 }
});
ok(thin.action === 'NO OPTIONS TRADE', 'thin liquidity -> NO OPTIONS TRADE');

// 6) Closed session (Sunday) -> NO OPTIONS TRADE, bias only
var closed = E.runAnalysis({
  now: CLOSED, session: 'AUTO', spy: 521.00,
  levels: { vwap: 520.00 }, macdDir: 'BULL', macd15: 'BULL',
  qqq: 'BULL', es: 'BULL', news: 'BULLISH',
  option: { bid: 1.20, ask: 1.23, volume: 8000, oi: 12000 }
});
ok(closed.session === 'CLOSED', 'Sunday detected as CLOSED');
ok(closed.action === 'NO OPTIONS TRADE', 'closed market -> NO OPTIONS TRADE');

// 7) Neutral / mixed -> WAIT
var mixed = E.runAnalysis({
  now: RTH, session: 'AUTO', spy: 521.00,
  levels: { vwap: 519.00, resistance: 523, support: 517 }, // clearly above VWAP, not chop
  macdDir: 'BULL', histo: 'FLAT', macd15: 'BEAR', rsi: 50,
  volume: 'MIXED', qqq: 'NEUTRAL', es: 'BEAR', vix: 'FLAT', yield10: 'FLAT',
  regime: 'RANGE', news: 'NEUTRAL',
  option: { bid: 1.10, ask: 1.13, volume: 5000, oi: 8000 }
});
ok(mixed.bias === 'NEUTRAL', 'conflicting inputs -> NEUTRAL bias');
ok(mixed.action === 'WAIT', 'neutral bias in RTH -> WAIT');

// 8) R/R gate: stop too tight relative to target
var badRR = E.runAnalysis({
  now: RTH, session: 'AUTO', spy: 521.40,
  levels: { vwap: 520.50, resistance: 522, support: 519 },
  macdDir: 'BULL', histo: 'EXPANDING', macd15: 'BULL', rsi: 58,
  volume: 'CONFIRM_UP', qqq: 'BULL', es: 'BULL', vix: 'DOWN', yield10: 'DOWN',
  regime: 'TREND', news: 'BULLISH',
  option: { bid: 1.20, ask: 1.23, volume: 8000, oi: 12000 },
  stopPct: 0.40, t1Pct: 0.40 // R/R = 1.0
});
ok(badRR.plan.rr < 2, 'computes sub-2 R/R');
ok(badRR.action === 'NO OPTIONS TRADE', 'sub-2 R/R -> NO OPTIONS TRADE');

// 9) Underlying data present, NO options chain -> TECHNICAL BIAS ONLY
var tech = E.runAnalysis({
  now: RTH, session: 'AUTO', spy: 521.40,
  levels: { vwap: 520.50, pmh: 521.80, pdh: 521.10, pdl: 518.40, open: 520.10 },
  macdDir: 'BULL', histo: 'EXPANDING', macd15: 'BULL', rsi: 58,
  volume: 'CONFIRM_UP', qqq: 'BULL', es: 'BULL', vix: 'DOWN', yield10: 'DOWN',
  regime: 'TREND', news: 'BULLISH', newsHeadline: 'Cooler CPI'
  // no option block at all
});
ok(tech.status === 'TECHNICAL BIAS ONLY', 'no chain -> TECHNICAL BIAS ONLY status');
ok(tech.optionsAvailable === false, 'no chain -> optionsAvailable false');
ok(tech.action === 'NO OPTIONS TRADE', 'no chain (directional) -> NO OPTIONS TRADE');
ok(tech.bias === 'BULLISH', 'technical bias still computed (bullish)');
ok(/Technical SPY bias only/.test(tech.warning), 'technical-only warning set');
ok(tech.contract.status === 'Unavailable', 'contract marked Unavailable');
ok(tech.contract.direction === 'n/a', 'no confirmed CALL/PUT direction shown');
ok(tech.contract.estimatedDirection === 'CALL bias', 'estimated direction = CALL bias');
ok(tech.contract.estimatedStrike === 521, 'estimated strike present (521)');
ok(tech.contract.contractStatus === 'Estimated only — not confirmed tradable', 'estimated strike labeled not tradable');
ok(tech.contract.premium === null && tech.contract.bid === null, 'no premium / bid in technical mode');
ok(tech.plan.mode === 'Technical Bias Only', 'plan mode = Technical Bias Only');
ok(tech.plan.entry === null && tech.plan.stop === null && tech.plan.t1 === null, 'no premium ladder in technical mode');
ok(tech.plan.spyTrigger !== null, 'SPY trigger still computed');
ok(tech.plan.invalidation !== null, 'SPY invalidation still computed');
ok(/options-chain data/.test(tech.plan.premiumReason), 'premium reason explains missing chain');

// 10) Support/resistance derived from underlying levels when not supplied
ok(tech.levels.resistance === 521.80, 'resistance derived from nearest level above (PMH)');
ok(tech.levels.support === 521.10, 'support derived from nearest level below (PDH)');

// 11) Underlying present but neutral + no chain -> WAIT (technical only)
var techNeutral = E.runAnalysis({
  now: RTH, session: 'AUTO', spy: 521.00,
  levels: { vwap: 519.00 }, macdDir: 'FLAT', macd15: 'NEUTRAL',
  qqq: 'NEUTRAL', es: 'NEUTRAL', news: 'NEUTRAL', regime: 'RANGE'
});
ok(techNeutral.status === 'TECHNICAL BIAS ONLY', 'neutral + no chain -> TECHNICAL BIAS ONLY');
ok(techNeutral.action === 'WAIT', 'neutral + no chain -> WAIT');

// 12) No SPY data at all -> NO MARKET DATA / WAIT
var nodata = E.runAnalysis({ now: RTH, session: 'AUTO' });
ok(nodata.status === 'NO MARKET DATA', 'no spy price -> NO MARKET DATA');
ok(nodata.action === 'WAIT', 'no data -> WAIT');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
