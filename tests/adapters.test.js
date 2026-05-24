/* Node tests for adapter parsing/mapping (no network). Run: node tests/adapters.test.js */
var A = require('../adapters.js');

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}

// parseQuote
var q = A.parseQuote({
  symbol: 'SPY', close: '521.40', open: '520.10', high: '521.90', low: '519.80',
  previous_close: '519.80', change: '1.60', percent_change: '0.31',
  volume: '60000000', average_volume: '50000000', is_market_open: true
});
ok(q.price === 521.40 && q.open === 520.10 && q.pdc === 519.80, 'parseQuote reads core fields');
ok(q.isOpen === true, 'parseQuote market-open flag');

var threw = false;
try { A.parseQuote({ status: 'error', message: 'bad symbol' }); } catch (e) { threw = true; }
ok(threw, 'parseQuote throws on error payload');

// parseMacd — bullish + expanding
var macd = A.parseMacd({ status: 'ok', values: [
  { datetime: 't2', macd: '0.50', macd_signal: '0.30', macd_hist: '0.20' },
  { datetime: 't1', macd: '0.40', macd_signal: '0.32', macd_hist: '0.08' }
] });
ok(macd.dir === 'BULL', 'parseMacd dir bullish (macd>signal)');
ok(macd.histo === 'EXPANDING', 'parseMacd histogram expanding');

var macd2 = A.parseMacd({ status: 'ok', values: [
  { macd: '-0.40', macd_signal: '-0.20', macd_hist: '-0.05' },
  { macd: '-0.30', macd_signal: '-0.20', macd_hist: '-0.20' }
] });
ok(macd2.dir === 'BEAR', 'parseMacd dir bearish');
ok(macd2.histo === 'CONTRACTING', 'parseMacd histogram contracting');

ok(A.macdSign({ values: [{ macd: '1', macd_signal: '0.5' }] }) === 'BULL', 'macdSign bullish');
ok(A.macdSign({ values: [{ macd: '0.2', macd_signal: '0.9' }] }) === 'BEAR', 'macdSign bearish');

// rsi / vwap
ok(A.parseRsi({ values: [{ rsi: '58.4' }] }) === 58, 'parseRsi rounds');
ok(A.parseVwap({ values: [{ vwap: '520.55' }] }) === 520.55, 'parseVwap reads value');

// prior day
var pd = A.parseDailyPrior({ status: 'ok', values: [
  { datetime: '2026-05-20', high: '521.10', low: '519.50', close: '520.40' },
  { datetime: '2026-05-19', high: '521.10', low: '518.40', close: '519.80' }
] });
ok(pd.pdh === 521.10 && pd.pdl === 518.40 && pd.pdc === 519.80, 'parseDailyPrior uses prior bar');

// direction helpers
ok(A.dirFromPct(0.31) === 'BULL', 'dirFromPct bull');
ok(A.dirFromPct(-0.31) === 'BEAR', 'dirFromPct bear');
ok(A.dirFromPct(0.02) === 'NEUTRAL', 'dirFromPct neutral deadband');
ok(A.vixDir(1.2) === 'UP', 'vixDir up');
ok(A.vixDir(-1.2) === 'DOWN', 'vixDir down');
ok(A.volumeFlow(1.6, 60000000, 50000000) === 'CONFIRM_UP', 'volumeFlow confirm up');
ok(A.volumeFlow(-1.6, 60000000, 50000000) === 'CONFIRM_DOWN', 'volumeFlow confirm down');
ok(A.volumeFlow(1.6, 20000000, 50000000) === 'WEAK', 'volumeFlow weak on low volume');

// mapTwelveData with mixed success/failure
var R = {
  quote: { status: 'fulfilled', value: { close: '521.40', open: '520.10', previous_close: '519.80', change: '1.6', percent_change: '0.31', volume: '60000000', average_volume: '50000000', is_market_open: true } },
  daily: { status: 'fulfilled', value: { status: 'ok', values: [
    { high: '521.1', low: '519.5', close: '520.4' }, { high: '521.1', low: '518.4', close: '519.8' } ] } },
  vwap: { status: 'fulfilled', value: { values: [{ vwap: '520.50' }] } },
  macd5: { status: 'fulfilled', value: { values: [{ macd: '0.5', macd_signal: '0.3', macd_hist: '0.2' }, { macd_hist: '0.08' }] } },
  macd15: { status: 'fulfilled', value: { values: [{ macd: '0.4', macd_signal: '0.2' }] } },
  rsi: { status: 'rejected', reason: new Error('plan limit') },   // simulate a failed call
  qqq: { status: 'fulfilled', value: { close: '450', percent_change: '0.4' } },
  vix: { status: 'fulfilled', value: { close: '14', percent_change: '-2.0' } }
};
var rep = A.mapTwelveData(R);
ok(rep.fields.spy === '521.40', 'map: spy filled');
ok(rep.fields.vwap === '520.50', 'map: vwap filled');
ok(rep.fields.macdDir === 'BULL' && rep.fields.histo === 'EXPANDING', 'map: macd filled');
ok(rep.fields.macd15 === 'BULL', 'map: macd15 filled');
ok(rep.fields.qqq === 'BULL', 'map: qqq direction');
ok(rep.fields.vix === 'DOWN', 'map: vix direction');
ok(rep.fields.rsi === undefined, 'map: failed RSI call left unfilled');
ok(rep.gaps.indexOf('RSI') >= 0, 'map: RSI listed as gap');
ok(rep.gaps.indexOf('0DTE options chain (bid/ask/vol/OI/greeks)') >= 0, 'map: options chain always a gap');
ok(rep.filled.indexOf('SPY price') >= 0, 'map: filled list populated');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
