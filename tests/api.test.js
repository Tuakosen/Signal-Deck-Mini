/* Tests for the CBOE options proxy parser + adapter map (no network).
   Run: node tests/api.test.js */
var C = require('../api/_cboe.js');
var A = require('../adapters.js');

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}

// ---- symbol / date helpers ----
var ps = C.parseSymbol('SPY260520C00521000');
ok(ps && ps.yymmdd === '260520' && ps.type === 'CALL' && ps.strike === 521, 'parseSymbol CALL strike');
var pp = C.parseSymbol('SPY260520P00518500');
ok(pp && pp.type === 'PUT' && pp.strike === 518.5, 'parseSymbol PUT fractional strike');
ok(C.parseSymbol('garbage') === null, 'parseSymbol rejects junk');
ok(C.yymmddToISO('260520') === '2026-05-20', 'yymmddToISO');
ok(C.todayYYMMDD(new Date('2026-05-20T14:00:00Z')) === '260520', 'todayYYMMDD in ET');

// ---- parseCboe with a same-day expiry present ----
var chainJson = { data: {
  current_price: 521.40,
  options: [
    { option: 'SPY260520C00521000', bid: 1.20, ask: 1.24, volume: 8400, open_interest: 12500, iv: 0.18, delta: 0.52, gamma: 0.03, theta: -0.45 },
    { option: 'SPY260520C00525000', bid: 0.30, ask: 0.33, volume: 4000, open_interest: 6000, iv: 0.20, delta: 0.20 },
    { option: 'SPY260520P00520000', bid: 1.05, ask: 1.09, volume: 6000, open_interest: 9000, iv: 0.19, delta: -0.48 },
    { option: 'SPY260620C00521000', bid: 5.0, ask: 5.2, volume: 100, open_interest: 200 } // not today
  ]
} };
var p = C.parseCboe(chainJson, '260520');
ok(p.expiresToday === true, 'parseCboe finds same-day expiry');
ok(p.expDate === '2026-05-20', 'parseCboe expDate ISO');
ok(p.underlying === 521.40, 'parseCboe underlying price');
ok(p.call && p.call.strike === 521, 'ATM call is nearest strike (521, not 525)');
ok(p.call.bid === 1.20 && p.call.oi === 12500 && p.call.delta === 0.52, 'call carries quote + greeks');
ok(p.put && p.put.strike === 520, 'ATM put selected (520)');
ok(p.put.delta === -0.48, 'put carries delta');

// ---- parseCboe with no same-day expiry ----
var none = C.parseCboe(chainJson, '991231');
ok(none.expiresToday === false, 'no same-day expiry -> expiresToday false');
ok(none.call === null && none.put === null, 'no contracts returned');
ok(/No 0DTE/.test(none.note), 'explanatory note set');

// ---- pickAtm prefers quoted contracts ----
var picked = C.pickAtm([
  { strike: 521, bid: null, ask: null },          // closest but unquoted
  { strike: 522, bid: 0.9, ask: 0.95 }            // quoted
], 521.2);
ok(picked.strike === 522, 'pickAtm prefers a live two-sided quote');

// ---- CBOE adapter map ----
var rep = A.mapCboe({
  underlying: 521.40, expiresToday: true, expDate: '2026-05-20',
  call: { strike: 521, bid: 1.20, ask: 1.24, volume: 8400, oi: 12500, iv: 0.18, delta: 0.52 },
  put: { strike: 520, bid: 1.05, ask: 1.09, volume: 6000, oi: 9000, iv: 0.19, delta: -0.48 }
});
ok(rep.fields.spy === '521.40', 'map fills SPY price');
ok(rep.chain && rep.chain.expiresToday === true, 'map returns chain');
ok(rep.chain.call.strike === 521 && rep.chain.put.strike === 520, 'map passes call+put through');
ok(rep.gaps.indexOf('VWAP') >= 0 && rep.gaps.indexOf('MACD') >= 0, 'map flags technicals as gaps');

var repNo = A.mapCboe({ underlying: 521.40, expiresToday: false, note: 'No 0DTE today.' });
ok(repNo.chain === null, 'map: no chain when no same-day expiry');
ok(repNo.gaps.some(function (g) { return /no same-day expiry/.test(g); }), 'map: notes no-expiry gap');

var threw = false;
try { A.mapCboe({ error: 'boom' }); } catch (e) { threw = true; }
ok(threw, 'map throws on proxy error');

// ---- Combined provider merge (Twelve Data + CBOE) ----
var tdRes = {
  fields: { spy: '521.40', vwap: '520.50', macdDir: 'BULL', rsi: '58', qqq: 'BULL' },
  filled: ['SPY price', 'VWAP (5m)', 'MACD 5m'], gaps: ['x'], notes: ['td note']
};
var cbRes = {
  fields: { spy: '521.38' }, // delayed, slightly different
  chain: { expiresToday: true, expDate: '2026-05-20', call: { strike: 521 }, put: { strike: 520 } },
  filled: ['0DTE chain'], gaps: ['VWAP'], notes: ['cboe note']
};
var m = A.mergeCombo(tdRes, cbRes);
ok(m.fields.spy === '521.40', 'merge: Twelve Data wins on overlapping SPY price');
ok(m.fields.vwap === '520.50' && m.fields.macdDir === 'BULL', 'merge: keeps TD technicals');
ok(m.chain && m.chain.expiresToday === true, 'merge: carries CBOE chain');
ok(m.filled.indexOf('0DTE chain') >= 0 && m.filled.indexOf('VWAP (5m)') >= 0, 'merge: unions filled lists');
ok(m.gaps.indexOf('ES futures direction') >= 0, 'merge: curated remaining gaps');

var mNoChain = A.mergeCombo(tdRes, { fields: {}, chain: null, filled: [], gaps: [], notes: [] });
ok(mNoChain.gaps.some(function (g) { return /No live 0DTE chain/.test(g); }), 'merge: flags missing chain');
var mNoTd = A.mergeCombo({ fields: {}, filled: [], gaps: [], notes: [] }, cbRes);
ok(mNoTd.gaps.some(function (g) { return /Twelve Data returned no data/.test(g); }), 'merge: flags missing TD');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
