/*
 * CBOE delayed-quotes parser (pure, no network) — shared by the /api/options
 * serverless function and the unit tests. Files prefixed with "_" are not
 * treated as routes by Vercel.
 *
 * Source: https://cdn.cboe.com/api/global/delayed_quotes/options/SPY.json
 * Free, no API key, ~15-minute delayed, includes greeks.
 */
'use strict';

function num(v) {
  var n = parseFloat(v);
  return isFinite(n) ? n : null;
}

// OCC-style symbol, e.g. "SPY240621C00450000" -> { yymmdd, type, strike }
function parseSymbol(sym) {
  var m = /(\d{6})([CP])(\d{8})$/.exec(sym || '');
  if (!m) return null;
  return { yymmdd: m[1], type: m[2] === 'C' ? 'CALL' : 'PUT', strike: parseInt(m[3], 10) / 1000 };
}

function yymmddToISO(s) {
  return '20' + s.slice(0, 2) + '-' + s.slice(2, 4) + '-' + s.slice(4, 6);
}

// YYMMDD for a date in the given time zone (default ET) — matches OCC expiries.
function todayYYMMDD(date, tz) {
  var f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'America/New_York', year: '2-digit', month: '2-digit', day: '2-digit'
  });
  var p = {};
  f.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
  return p.year + p.month + p.day;
}

// Nearest strike to the underlying, preferring contracts with a live two-sided quote.
function pickAtm(list, underlying) {
  if (!list.length || underlying == null) return null;
  var quoted = list.filter(function (o) { return o.bid != null && o.ask != null && o.ask > 0; });
  var pool = quoted.length ? quoted : list;
  return pool.reduce(function (best, o) {
    return Math.abs(o.strike - underlying) < Math.abs(best.strike - underlying) ? o : best;
  });
}

function parseCboe(json, today) {
  var data = (json && json.data) || json || {};
  var opts = data.options || [];
  var underlying = num(data.current_price != null ? data.current_price : data.close);

  var calls = [], puts = [], expISO = null;
  for (var i = 0; i < opts.length; i++) {
    var o = opts[i];
    var p = parseSymbol(o.option || o.symbol);
    if (!p || p.yymmdd !== today) continue;
    expISO = yymmddToISO(p.yymmdd);
    var rec = {
      strike: p.strike, bid: num(o.bid), ask: num(o.ask), volume: num(o.volume),
      oi: num(o.open_interest != null ? o.open_interest : o.openInterest),
      iv: num(o.iv), delta: num(o.delta), gamma: num(o.gamma), theta: num(o.theta)
    };
    if (p.type === 'CALL') calls.push(rec); else puts.push(rec);
  }

  if (!calls.length && !puts.length) {
    return {
      expiresToday: false, expDate: null, underlying: underlying,
      call: null, put: null,
      note: 'No 0DTE (same-day) expiration found in the SPY chain right now.'
    };
  }
  return {
    expiresToday: true, expDate: expISO, underlying: underlying,
    call: pickAtm(calls, underlying), put: pickAtm(puts, underlying)
  };
}

module.exports = { parseCboe: parseCboe, parseSymbol: parseSymbol, todayYYMMDD: todayYYMMDD, yymmddToISO: yymmddToISO, pickAtm: pickAtm };
