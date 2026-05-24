/* Signal Deck Mini — DOM wiring + report rendering. Logic lives in engine.js. */
(function () {
  'use strict';
  var E = window.SignalEngine;
  var $ = function (id) { return document.getElementById(id); };

  function val(id) { var el = $(id); return el ? el.value.trim() : ''; }
  function checked(id) { var el = $(id); return !!(el && el.checked); }

  function collect() {
    return {
      session: val('session'),
      spy: val('spy'),
      vwapBand: val('vwapBand'),
      levels: {
        vwap: val('vwap'), resistance: val('resistance'), support: val('support'),
        pmh: val('pmh'), pml: val('pml'), pdh: val('pdh'), pdl: val('pdl'),
        pdc: val('pdc'), open: val('open'), orh: val('orh'), orl: val('orl')
      },
      macdDir: val('macdDir'), histo: val('histo'), macd15: val('macd15'),
      rsi: val('rsi'), volume: val('volume'), regime: val('regime'),
      qqq: val('qqq'), es: val('es'), vix: val('vix'), yield10: val('yield10'),
      news: val('news'), newsHeadline: val('newsHeadline'), newsImminent: checked('newsImminent'),
      option: {
        bid: val('bid'), ask: val('ask'), premium: val('premium'),
        volume: val('optVolume'), oi: val('oi'), iv: val('iv'),
        delta: val('delta'), gamma: val('gamma'), theta: val('theta')
      },
      stopPct: val('stopPct'), t1Pct: val('t1Pct'), t2Pct: val('t2Pct'),
      now: new Date()
    };
  }

  var $m = E.money;
  function n(v, d) { return (v === null || v === undefined || v === '') ? (d || '—') : v; }
  function pct(v) { return v === null || v === undefined ? '—' : Math.round(v * 100) + '%'; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function bannerClass(action) {
    return action === 'BUY CALL' ? 'call'
      : action === 'BUY PUT' ? 'put'
      : action === 'WAIT' ? 'wait' : 'notrade';
  }
  function ratingClass(r) {
    return r === 'PASS' || r === 'BULLISH' ? 'pass'
      : r === 'FAIL' || r === 'BEARISH' ? 'fail' : 'neutral';
  }

  function row(k, v) { return '<div class="row"><span>' + k + '</span><span>' + v + '</span></div>'; }

  function render(r) {
    var b = $('banner');
    b.className = 'banner ' + bannerClass(r.action);
    b.innerHTML = '<span>' + r.action + '</span>' +
      '<small>SPY ' + (r.spy !== null ? '$' + r.spy.toFixed(2) : '—') +
      ' · ' + r.sessionLabel + ' · ' + r.confidence + ' · ' + r.tradeQuality + '</small>';

    var L = r.levels, c = r.contract, p = r.plan, sc = r.scorecard;
    var html = '';

    // Market bias
    html += sec('Market Bias',
      '<div class="chips">' +
        chip('Bias ' + r.bias, ratingClass(r.bias)) +
        chip('Trend ' + r.trend, 'neutral') +
        chip('QQQ ' + r.cross.qqq, ratingClass(r.cross.qqq)) +
        chip('ES ' + r.cross.es, ratingClass(r.cross.es)) +
        chip('VIX ' + r.cross.vix, ratingClass(r.cross.vix)) +
        chip('10Y ' + r.cross.yield10, ratingClass(r.cross.yield10)) +
        chip('Score ' + r.biasScore, 'neutral') +
      '</div>');

    // Gates (only when present)
    if (r.gates.length) {
      var gl = '<ul class="gates">';
      r.gates.forEach(function (g) {
        gl += '<li><span class="tag">' + g.tag + '</span>' + esc(g.msg) + '</li>';
      });
      gl += '</ul>';
      html += sec('Why No / Limited Trade', gl);
    }

    // Contract
    var cd = '<div class="kv">' +
      row('Direction', c.direction) +
      row('Ticker', c.ticker + ' (0DTE)') +
      row('Expiration', c.expDate) +
      row('Strike', c.strike !== null ? '$' + c.strike + ' ' + c.type : '—') +
      row('Premium', $m(c.premium)) +
      row('Total Cost', c.totalCost !== null ? '$' + c.totalCost : '—') +
      row('Bid / Ask', $m(c.bid) + ' / ' + $m(c.ask)) +
      row('Spread', $m(c.spread)) +
      row('Volume', n(c.volume)) +
      row('Open Interest', n(c.oi)) +
      row('Delta', n(c.delta)) +
      row('IV', c.iv !== null ? pct(c.iv) : '—') +
      '</div>';
    html += sec('0DTE Contract Selection', cd);

    // Entry plan
    var ep = '<div class="kv">' +
      row('Entry Premium', $m(p.entry)) +
      row('Stop Premium', $m(p.stop)) +
      row('Target 1', $m(p.t1)) +
      row('Target 2', $m(p.t2)) +
      row('Max Risk', p.maxRisk !== null ? '$' + p.maxRisk + '/contract' : '—') +
      row('Max Profit T1', p.maxProfitT1 !== null ? '$' + p.maxProfitT1 : '—') +
      row('Max Profit T2', p.maxProfitT2 !== null ? '$' + p.maxProfitT2 : '—') +
      row('Risk / Reward', p.rr !== null ? '1:' + p.rr.toFixed(1) : '—') +
      row('Setup Style', p.style) +
      row('Entry Timeframe', p.entryTf) +
      row('Confirm Timeframe', p.confirmTf) +
      row('Higher-TF Bias', p.htf) +
      '</div>';
    if (r.tradeable && p.spyTrigger !== null) {
      ep += '<p class="prose" style="margin-top:10px">Enter when SPY <b>' + p.spyTriggerDir +
        ' $' + p.spyTrigger.toFixed(2) + '</b> on the ' + p.entryTf +
        ' candle close (confirm on ' + p.confirmTf + '). Invalidation: exit if SPY ' +
        (r.action === 'BUY CALL' ? 'breaks below' : 'breaks above') + ' $' +
        (p.invalidation !== null ? p.invalidation.toFixed(2) : '—') + '.</p>';
    }
    html += sec('0DTE Entry Plan', ep);

    // Key levels
    html += sec('Key SPY Levels', '<div class="kv">' +
      row('VWAP', $m(L.vwap) + ' (' + r.vwapState + ')') +
      row('Resistance', $m(L.resistance)) +
      row('Support', $m(L.support)) +
      row('Pre-Mkt High', $m(L.pmh)) +
      row('Pre-Mkt Low', $m(L.pml)) +
      row('Prior Day High', $m(L.pdh)) +
      row('Prior Day Low', $m(L.pdl)) +
      row('Prior Day Close', $m(L.pdc)) +
      row('Day Open', $m(L.open)) +
      row('Opening Range Hi', $m(L.orh)) +
      row('Opening Range Lo', $m(L.orl)) +
      '</div>');

    // Scorecard
    var sct = '<div class="scorecard">' +
      scLine('MACD Momentum', sc.macd) +
      scLine('RSI + VWAP', sc.rsivwap) +
      scLine('Volume / CVD', sc.volume) +
      scLine('Entry Timeframe', sc.timeframe) +
      scLine('Historical Match', sc.history) +
      scLine('News / Macro', sc.news) +
      scLine('Options Chain', sc.options) +
      '</div>';
    html += sec('Scorecard', sct);

    // Reasoning
    html += sec('Reasoning', '<p class="prose">' + esc(r.reasoning) + '</p>');

    // Exit triggers (only when there is a live trade)
    if (r.tradeable) {
      html += sec('Exit Triggers', '<ul class="exits">' +
        li('Take partial profit at Target 1 (' + $m(p.t1) + ').') +
        li('Hold for Target 2 only if SPY keeps confirming direction.') +
        li('Hard stop if premium hits ' + $m(p.stop) + '.') +
        li('Exit if SPY ' + (r.action === 'BUY CALL' ? 'loses VWAP' : 'reclaims VWAP') + ' against you.') +
        li('Exit if MACD momentum flips or volume dries up.') +
        li('Do not hold past 15:55 ET — 0DTE decay accelerates into the close.') +
        '</ul>');
    }

    // News
    html += sec('News Impact', '<div class="kv">' +
      row('Headline', esc(r.news.headline)) +
      row('Sentiment', r.news.sentiment) +
      '</div><p class="prose" style="margin-top:8px">' + esc(r.news.shortImpact) +
      ' ' + esc(r.news.optionsImpact) + '</p>');

    // Final decision
    html += sec('Final Decision', '<p class="prose"><b>' + r.action + '</b> — ' +
      esc(r.finalSummary) + '</p>');

    $('report').innerHTML = html;
  }

  function sec(title, body) { return '<div class="sec"><h3>' + title + '</h3>' + body + '</div>'; }
  function chip(text, cls) { return '<span class="chip ' + cls + '">' + esc(text) + '</span>'; }
  function li(t) { return '<li>' + esc(t) + '</li>'; }
  function scLine(name, cell) {
    return '<div class="line"><span class="name">' + name + '</span>' +
      chip(cell.r, ratingClass(cell.r)) +
      '<span class="reason">' + esc(cell.reason) + '</span></div>';
  }

  // --- Clock ---------------------------------------------------------------
  function tickClock() {
    var s = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
      second: '2-digit', weekday: 'short', hour12: false
    }).format(new Date());
    var sess = E.detectSession(new Date()).session;
    $('clock').textContent = s + ' ET · ' + sess;
  }

  // --- Example data --------------------------------------------------------
  var EXAMPLE = {
    session: 'RTH', spy: '521.40', vwap: '520.50', resistance: '522.00', support: '519.00',
    pmh: '521.80', pml: '519.20', pdh: '521.10', pdl: '518.40', pdc: '519.80',
    open: '520.10', orh: '521.20', orl: '519.90',
    macdDir: 'BULL', histo: 'EXPANDING', macd15: 'BULL', rsi: '58', volume: 'CONFIRM_UP',
    regime: 'TREND', qqq: 'BULL', es: 'BULL', vix: 'DOWN', yield10: 'DOWN',
    news: 'BULLISH', newsHeadline: 'Cooler-than-expected CPI lifts risk appetite',
    bid: '1.20', ask: '1.24', optVolume: '8400', oi: '12500', iv: '0.18', delta: '0.52'
  };

  function loadExample() {
    Object.keys(EXAMPLE).forEach(function (k) { if ($(k)) $(k).value = EXAMPLE[k]; });
    $('newsImminent').checked = false;
    analyze();
  }

  function resetForm() {
    document.querySelectorAll('input').forEach(function (el) {
      if (el.type === 'checkbox') el.checked = false; else el.value = '';
    });
    $('stopPct').value = '0.30'; $('t1Pct').value = '0.60'; $('t2Pct').value = '1.20';
    document.querySelectorAll('select').forEach(function (el) { el.selectedIndex = 0; });
    var b = $('banner'); b.className = 'banner idle';
    b.innerHTML = 'Enter readings and press <b>Analyze</b>';
    $('report').innerHTML = '';
  }

  function analyze() {
    try {
      render(E.runAnalysis(collect()));
    } catch (err) {
      $('report').innerHTML = '<p class="prose">Error: ' + esc(err.message) + '</p>';
    }
  }

  $('analyze').addEventListener('click', analyze);
  $('example').addEventListener('click', loadExample);
  $('reset').addEventListener('click', resetForm);

  tickClock();
  setInterval(tickClock, 1000);
})();
