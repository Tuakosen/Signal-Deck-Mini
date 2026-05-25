/* Async test: mock adapter -> real parsers -> engine, mirroring the browser
   fetch->populate->analyze path. Run: node tests/mock.test.js */
var A = require('../adapters.js');
var E = require('../engine.js');

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}

// Mirror app.js collect(): flat fetched fields -> engine input schema.
function toEngineInput(f) {
  return {
    now: '2026-05-20T14:00:00Z', session: 'RTH', spy: f.spy, vwapBand: '',
    levels: {
      vwap: f.vwap, resistance: f.resistance, support: f.support, pmh: f.pmh, pml: f.pml,
      pdh: f.pdh, pdl: f.pdl, pdc: f.pdc, open: f.open, orh: f.orh, orl: f.orl
    },
    macdDir: f.macdDir || 'FLAT', histo: f.histo || 'FLAT', macd15: f.macd15 || 'NEUTRAL',
    rsi: f.rsi, volume: f.volume || 'MIXED', qqq: f.qqq || 'NEUTRAL', es: f.es || 'NEUTRAL',
    vix: f.vix || 'FLAT', yield10: f.yield10 || 'FLAT', regime: f.regime || 'CHOP',
    news: f.news || 'NEUTRAL', newsHeadline: f.newsHeadline || '', newsImminent: false,
    option: { bid: f.bid, ask: f.ask, premium: '', volume: f.optVolume, oi: f.oi, iv: f.iv, delta: f.delta },
    stopPct: 0.30, t1Pct: 0.60, t2Pct: 1.20
  };
}

A.byId.mock.fetch().then(function (rep) {
  // 1) Live-fetchable fields came through the REAL parsers
  ok(rep.fields.spy === '521.40', 'mock: spy via parseQuote');
  ok(rep.fields.vwap === '520.55', 'mock: vwap via parseVwap');
  ok(rep.fields.macdDir === 'BULL' && rep.fields.histo === 'EXPANDING', 'mock: macd via parseMacd');
  ok(rep.fields.macd15 === 'BULL', 'mock: macd15 via macdSign');
  ok(rep.fields.rsi === '59', 'mock: rsi via parseRsi');
  ok(rep.fields.qqq === 'BULL', 'mock: qqq direction');
  ok(rep.fields.vix === 'DOWN', 'mock: vix direction');
  ok(rep.fields.volume === 'CONFIRM_UP', 'mock: volume flow derived');
  ok(rep.fields.pdh === '521.10' && rep.fields.pdl === '518.40', 'mock: prior day H/L via parseDailyPrior');

  // 2) Synthetic additions present so the full report can render
  ok(rep.fields.bid === '1.20' && rep.fields.delta === '0.52', 'mock: synthetic 0DTE contract');
  ok(rep.fields.regime === 'TREND' && rep.fields.news === 'BULLISH', 'mock: synthetic regime/news');

  // 3) Gap bookkeeping is honest
  ok(rep.gaps.indexOf('0DTE options chain (bid/ask/vol/OI/greeks)') < 0, 'mock: synthesized options gap removed');
  ok(rep.gaps.indexOf('ES futures direction') >= 0, 'mock: ES kept as honest gap');
  ok(rep.gaps.indexOf('10Y yield direction') >= 0, 'mock: yield kept as honest gap');
  ok(rep.notes[0].indexOf('DEMO MODE') === 0, 'mock: demo notice surfaced');

  // 4) Feed the populated fields through the engine (full decision path)
  var r = E.runAnalysis(toEngineInput(rep.fields));
  ok(r.action === 'BUY CALL', 'mock dataset -> BUY CALL through engine');
  ok(r.tradeable === true, 'mock signal is tradeable');
  ok(r.contract.direction === 'CALL', 'mock -> CALL contract');
  ok(r.plan.rr >= 2, 'mock -> R/R meets floor');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}).catch(function (e) {
  console.error('mock test error:', e);
  process.exit(1);
});
