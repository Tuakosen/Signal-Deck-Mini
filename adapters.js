/*
 * Signal Deck Mini — pluggable live-data adapters.
 *
 * An adapter turns an external data source into the same field schema the
 * manual form uses, plus a report of what it filled vs. what remains manual.
 * Network I/O is kept to a thin layer; the parsing/mapping is pure so it can
 * be unit-tested without a network (see tests/adapters.test.js).
 *
 * NOTE: a static browser app cannot fetch a live 0DTE options chain or
 * pre-market levels for free. Those are intentionally left as manual gaps —
 * the engine still treats missing contract data as a NO-TRADE condition.
 */
(function (root) {
  'use strict';

  function f(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  // --- Pure parsers (Twelve Data response shapes) --------------------------
  function vals(j) {
    if (!j || j.status === 'error' || j.code >= 400) {
      throw new Error((j && j.message) || 'data source error');
    }
    if (!j.values || !j.values.length) throw new Error('no values');
    return j.values; // newest first
  }

  function parseQuote(j) {
    if (!j || j.status === 'error' || j.code >= 400) {
      throw new Error((j && j.message) || 'quote error');
    }
    return {
      price: f(j.close), open: f(j.open), high: f(j.high), low: f(j.low),
      pdc: f(j.previous_close), change: f(j.change), pct: f(j.percent_change),
      volume: f(j.volume), avgVolume: f(j.average_volume),
      isOpen: !!j.is_market_open
    };
  }

  function parseMacd(j) {
    var v = vals(j);
    var m0 = f(v[0].macd), s0 = f(v[0].macd_signal), h0 = f(v[0].macd_hist);
    var dir = m0 > s0 ? 'BULL' : m0 < s0 ? 'BEAR' : 'FLAT';
    var histo = 'FLAT';
    if (v[1] && h0 !== null) {
      var a0 = Math.abs(h0), a1 = Math.abs(f(v[1].macd_hist));
      if (a0 > a1 * 1.02) histo = 'EXPANDING';
      else if (a0 < a1 * 0.98) histo = 'CONTRACTING';
    }
    return { dir: dir, histo: histo };
  }

  function macdSign(j) {
    var v = vals(j);
    var m = f(v[0].macd), s = f(v[0].macd_signal);
    return m > s ? 'BULL' : m < s ? 'BEAR' : 'NEUTRAL';
  }

  function parseRsi(j) {
    var r = f(vals(j)[0].rsi);
    return r === null ? null : Math.round(r);
  }

  function parseVwap(j) { return f(vals(j)[0].vwap); }

  function parseDailyPrior(j) {
    var v = vals(j);
    var prior = v[1] || v[0];
    return { pdh: f(prior.high), pdl: f(prior.low), pdc: f(prior.close) };
  }

  function dirFromPct(pct, thresh) {
    thresh = thresh == null ? 0.1 : thresh;
    if (pct == null) return 'NEUTRAL';
    if (pct >= thresh) return 'BULL';
    if (pct <= -thresh) return 'BEAR';
    return 'NEUTRAL';
  }

  function vixDir(pct, thresh) {
    thresh = thresh == null ? 0.5 : thresh;
    if (pct == null) return 'FLAT';
    if (pct >= thresh) return 'UP';
    if (pct <= -thresh) return 'DOWN';
    return 'FLAT';
  }

  // Rough intraday flow proxy from daily volume vs. average.
  function volumeFlow(change, volume, avgVolume) {
    if (volume == null || avgVolume == null || !avgVolume) return null;
    if (volume > avgVolume) return change > 0 ? 'CONFIRM_UP' : change < 0 ? 'CONFIRM_DOWN' : 'MIXED';
    if (volume < avgVolume * 0.6) return 'WEAK';
    return 'MIXED';
  }

  var STATIC_GAPS = [
    'pre-market high/low', 'opening range high/low', 'support/resistance',
    'ES futures direction', '10Y yield direction', 'news bias',
    '0DTE options chain (bid/ask/vol/OI/greeks)'
  ];

  // --- Manual adapter ------------------------------------------------------
  var Manual = {
    id: 'manual',
    label: 'Manual entry (no fetch)',
    needsKey: false,
    fetch: function () {
      return Promise.resolve({
        fields: {}, filled: [], gaps: ['all fields'],
        notes: ['Manual mode — enter the readings yourself, then press Analyze.']
      });
    }
  };

  // --- Twelve Data adapter -------------------------------------------------
  var TwelveData = {
    id: 'twelvedata',
    label: 'Twelve Data — live quote + indicators (API key)',
    needsKey: true,
    keyHint: 'Free key at twelvedata.com (indicator coverage depends on plan)',
    base: 'https://api.twelvedata.com',

    // Pure: build the {fields, filled, gaps, notes} report from settled results.
    map: function (R) {
      var fields = {}, filled = [], gaps = [], notes = [];
      var got = function (k) { return R[k] && R[k].status === 'fulfilled'; };
      var v = function (k) { return R[k].value; };

      try {
        if (!got('quote')) throw new Error('quote unavailable');
        var qd = parseQuote(v('quote'));
        if (qd.price !== null) { fields.spy = qd.price.toFixed(2); filled.push('SPY price'); }
        if (qd.open !== null) { fields.open = qd.open.toFixed(2); filled.push('day open'); }
        if (qd.pdc !== null) { fields.pdc = qd.pdc.toFixed(2); filled.push('prior close'); }
        var vf = volumeFlow(qd.change, qd.volume, qd.avgVolume);
        if (vf) { fields.volume = vf; filled.push('volume flow (approx)'); }
        notes.push(qd.isOpen ? 'Market reported open.' : 'Market reported closed — quote is last/prev session.');
      } catch (e) { gaps.push('SPY quote'); }

      try { if (!got('daily')) throw 0; var d = parseDailyPrior(v('daily'));
        if (d.pdh !== null) { fields.pdh = d.pdh.toFixed(2); filled.push('prior day high'); }
        if (d.pdl !== null) { fields.pdl = d.pdl.toFixed(2); filled.push('prior day low'); }
      } catch (e) { gaps.push('prior day high/low'); }

      try { if (!got('vwap')) throw 0; var w = parseVwap(v('vwap'));
        if (w !== null) { fields.vwap = w.toFixed(2); filled.push('VWAP (5m)'); }
      } catch (e) { gaps.push('VWAP'); }

      try { if (!got('macd5')) throw 0; var m = parseMacd(v('macd5'));
        fields.macdDir = m.dir; fields.histo = m.histo; filled.push('MACD 5m');
      } catch (e) { gaps.push('MACD 5m'); }

      try { if (!got('macd15')) throw 0; fields.macd15 = macdSign(v('macd15')); filled.push('MACD 15m'); }
      catch (e) { gaps.push('MACD 15m'); }

      try { if (!got('rsi')) throw 0; var r = parseRsi(v('rsi'));
        if (r !== null) { fields.rsi = String(r); filled.push('RSI (5m)'); }
      } catch (e) { gaps.push('RSI'); }

      try { if (!got('qqq')) throw 0; var qq = parseQuote(v('qqq'));
        fields.qqq = dirFromPct(qq.pct); filled.push('QQQ direction');
      } catch (e) { gaps.push('QQQ direction'); }

      try { if (!got('vix')) throw 0; var vx = parseQuote(v('vix'));
        fields.vix = vixDir(vx.pct); filled.push('VIX direction');
      } catch (e) { gaps.push('VIX direction'); }

      STATIC_GAPS.forEach(function (g) { gaps.push(g); });
      notes.push('Options chain, pre-market and opening-range levels, ES futures, ' +
        'yields and news are not available from this source — enter them manually.');
      return { fields: fields, filled: filled, gaps: gaps, notes: notes };
    },

    fetch: function (opts) {
      if (typeof fetch === 'undefined') return Promise.reject(new Error('fetch unavailable'));
      var key = opts.apiKey, sym = opts.symbol || 'SPY';
      if (!key) return Promise.reject(new Error('API key required'));
      var base = this.base, self = this;
      function q(path) {
        var sep = path.indexOf('?') >= 0 ? '&' : '?';
        return fetch(base + path + sep + 'apikey=' + encodeURIComponent(key))
          .then(function (res) { return res.json(); });
      }
      var spec = {
        quote: '/quote?symbol=' + sym,
        daily: '/time_series?symbol=' + sym + '&interval=1day&outputsize=2',
        vwap: '/vwap?symbol=' + sym + '&interval=5min&outputsize=1',
        macd5: '/macd?symbol=' + sym + '&interval=5min&outputsize=2',
        macd15: '/macd?symbol=' + sym + '&interval=15min&outputsize=1',
        rsi: '/rsi?symbol=' + sym + '&interval=5min&outputsize=1',
        qqq: '/quote?symbol=QQQ',
        vix: '/quote?symbol=VIX'
      };
      var keys = Object.keys(spec);
      return Promise.allSettled(keys.map(function (k) { return q(spec[k]); }))
        .then(function (settled) {
          var R = {};
          keys.forEach(function (k, i) { R[k] = settled[i]; });
          return self.map(R);
        });
    }
  };

  var list = [Manual, TwelveData];
  var byId = {};
  list.forEach(function (a) { byId[a.id] = a; });

  var api = {
    list: list,
    byId: byId,
    // exported pure helpers for testing
    parseQuote: parseQuote, parseMacd: parseMacd, macdSign: macdSign,
    parseRsi: parseRsi, parseVwap: parseVwap, parseDailyPrior: parseDailyPrior,
    dirFromPct: dirFromPct, vixDir: vixDir, volumeFlow: volumeFlow,
    mapTwelveData: TwelveData.map
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SignalAdapters = api;
})(typeof window !== 'undefined' ? window : globalThis);
