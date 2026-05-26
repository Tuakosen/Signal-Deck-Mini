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

// 13) Live chain + bullish technicals -> CONFIRMED, contract from chain
var CHAIN = {
  expiresToday: true, expDate: '2026-05-20',
  call: { strike: 521, bid: 1.20, ask: 1.24, volume: 8400, oi: 12500, iv: 0.18, delta: 0.52, gamma: 0.03, theta: -0.45 },
  put: { strike: 520, bid: 1.05, ask: 1.09, volume: 6000, oi: 9000, iv: 0.19, delta: -0.48 }
};
var chCall = E.runAnalysis({
  now: RTH, session: 'RTH', spy: 521.40,
  levels: { vwap: 520.50, resistance: 522, support: 519, pdc: 519.80, open: 520.10 },
  macdDir: 'BULL', histo: 'EXPANDING', macd15: 'BULL', rsi: 58, volume: 'CONFIRM_UP',
  qqq: 'BULL', es: 'BULL', vix: 'DOWN', yield10: 'DOWN', regime: 'TREND', news: 'BULLISH',
  chain: CHAIN
});
ok(chCall.status === 'CONFIRMED 0DTE OPTIONS SIGNAL', 'chain + bullish -> CONFIRMED');
ok(chCall.action === 'BUY CALL', 'chain bullish -> BUY CALL');
ok(chCall.contract.direction === 'CALL', 'chain -> CALL contract');
ok(chCall.contract.strike === 521, 'uses chain call strike (521)');
ok(chCall.contract.premium === 1.22, 'premium = chain call mid (1.22)');
ok(chCall.contract.delta === 0.52, 'carries chain call delta');
ok(chCall.plan.entry === 1.22, 'plan entry from chain premium');
ok(chCall.plan.mode === 'Confirmed Options', 'chain -> confirmed plan mode');

// 14) Live chain + bearish technicals -> BUY PUT using the put leg
var chPut = E.runAnalysis({
  now: RTH, session: 'RTH', spy: 518.20,
  levels: { vwap: 519.30, resistance: 520.50, support: 517 },
  macdDir: 'BEAR', histo: 'EXPANDING', macd15: 'BEAR', rsi: 42, volume: 'CONFIRM_DOWN',
  qqq: 'BEAR', es: 'BEAR', vix: 'UP', yield10: 'UP', regime: 'TREND', news: 'BEARISH',
  chain: CHAIN
});
ok(chPut.action === 'BUY PUT', 'chain bearish -> BUY PUT');
ok(chPut.contract.direction === 'PUT', 'chain -> PUT contract');
ok(chPut.contract.strike === 520, 'uses chain put strike (520)');

// 15) Live chain but neutral bias -> can't pick a side -> technical only
var chNeutral = E.runAnalysis({
  now: RTH, session: 'RTH', spy: 521.00,
  levels: { vwap: 519.00 }, macdDir: 'FLAT', macd15: 'NEUTRAL',
  qqq: 'NEUTRAL', es: 'NEUTRAL', news: 'NEUTRAL', regime: 'RANGE',
  chain: CHAIN
});
ok(chNeutral.status === 'TECHNICAL BIAS ONLY', 'chain + neutral -> TECHNICAL BIAS ONLY');
ok(chNeutral.action === 'WAIT', 'chain + neutral -> WAIT');
ok(/neutral/.test(chNeutral.warning), 'neutral-bias chain warning mentions neutral');

// 16) Position sizing + projection
var SETUP = {
  now: RTH, session: 'RTH', spy: 521.40,
  levels: { vwap: 520.50, resistance: 522, support: 519 },
  macdDir: 'BULL', histo: 'EXPANDING', macd15: 'BULL', rsi: 58, volume: 'CONFIRM_UP',
  qqq: 'BULL', es: 'BULL', vix: 'DOWN', yield10: 'DOWN', regime: 'TREND', news: 'BULLISH',
  option: { bid: 1.20, ask: 1.24, volume: 8000, oi: 12000, iv: 0.18, delta: 0.52 }
};
function withExtra(o) { var r = {}; for (var k in SETUP) r[k] = SETUP[k]; for (var j in o) r[j] = o[j]; return r; }

var sized = E.runAnalysis(withExtra({ account: 5000, riskPct: 0.02 }));
ok(sized.sizing && sized.sizing.contracts === 2, 'sizing: 2 contracts for $5k @ 2% (risk/contract $37)');
ok(sized.sizing.maxLoss === 74, 'sizing: max loss $74');
ok(sized.sizing.riskBudget === 100, 'sizing: risk budget $100');
ok(sized.sizing.capital === 244, 'sizing: capital deployed $244');
ok(sized.sizing.actualRiskPct === 1.48, 'sizing: actual risk 1.48%');
ok(sized.projection.breakeven === 522.22, 'projection: breakeven = strike + premium (522.22)');
ok(sized.projection.probItm === 52, 'projection: P(ITM) approx = |delta| (52%)');
ok(sized.projection.requiredMoveT1Pct === 0.27, 'projection: required SPY move to T1 ~0.27%');
ok(sized.projection.reachableT1 === true, 'projection: T1 reachable within ~1-sigma expected move');
ok(sized.projection.expectedMovePct > 0, 'projection: expected move computed from IV');
ok(E.runAnalysis(SETUP).sizing.needAccount === true, 'sizing: prompts for account when none given');

// 17) Real-money quality bar
var modInput = {
  now: RTH, session: 'RTH', spy: 521.40,
  levels: { vwap: 520.50, resistance: 522, support: 519 },
  macdDir: 'BULL', histo: 'EXPANDING', macd15: 'NEUTRAL', rsi: 52, volume: 'MIXED',
  qqq: 'BULL', es: 'NEUTRAL', vix: 'FLAT', yield10: 'FLAT', regime: 'RANGE', news: 'NEUTRAL',
  option: { bid: 1.20, ask: 1.24, volume: 8000, oi: 12000, iv: 0.18, delta: 0.52 }
};
var paperB = E.runAnalysis(modInput);
ok(paperB.action === 'BUY CALL' && paperB.tradeQuality === 'B', 'moderate setup -> BUY CALL / B in paper');
var realB = E.runAnalysis(withExtra2(modInput, { mode: 'real' }));
ok(realB.action === 'NO OPTIONS TRADE', 'B-quality blocked in real-money mode');
ok(realB.gates.some(function (g) { return g.tag === 'REAL'; }), 'real-money bar gate logged');
var realA = E.runAnalysis(withExtra({ mode: 'real' }));
ok(realA.action === 'BUY CALL', 'A/A+ setup still trades in real-money mode');

// 18) Real-money liquidity floor (1000 vs 500)
ok(E.runAnalysis(withExtra({ option: { bid: 1.20, ask: 1.24, volume: 800, oi: 12000, iv: 0.18, delta: 0.52 } })).action === 'BUY CALL',
  'paper allows volume 800 (>= 500 floor)');
ok(E.runAnalysis(withExtra({ mode: 'real', option: { bid: 1.20, ask: 1.24, volume: 800, oi: 12000, iv: 0.18, delta: 0.52 } })).action === 'NO OPTIONS TRADE',
  'real-money floor (1000) blocks volume 800');

function withExtra2(base, o) { var r = {}; for (var k in base) r[k] = base[k]; for (var j in o) r[j] = o[j]; return r; }

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
