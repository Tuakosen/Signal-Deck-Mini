/*
 * Vercel serverless function: free SPY 0DTE options chain via CBOE delayed
 * quotes. Same-origin proxy so the static frontend needs no API key and no
 * cross-origin access. ~15-minute delayed — paper-trading education only.
 *
 * GET /api/options?symbol=SPY
 */
'use strict';

var cboe = require('./_cboe.js');

module.exports = async function handler(req, res) {
  // Cache at the edge to avoid hammering CBOE; delayed data tolerates this.
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  res.setHeader('Content-Type', 'application/json');

  var symbol = 'SPY';
  try {
    var raw = (req.query && req.query.symbol) || 'SPY';
    symbol = String(raw).toUpperCase().replace(/[^A-Z]/g, '') || 'SPY';
  } catch (e) { /* default SPY */ }

  var url = 'https://cdn.cboe.com/api/global/delayed_quotes/options/' + symbol + '.json';

  try {
    var upstream = await fetch(url, { headers: { 'User-Agent': 'SignalDeckMini/1.0 (paper-trading education)' } });
    if (!upstream.ok) {
      res.status(502).json({ error: 'CBOE upstream returned ' + upstream.status, symbol: symbol });
      return;
    }
    var json = await upstream.json();
    var today = cboe.todayYYMMDD(new Date());
    var out = cboe.parseCboe(json, today);
    out.symbol = symbol;
    out.source = 'CBOE delayed (~15 min)';
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e), symbol: symbol });
  }
};
