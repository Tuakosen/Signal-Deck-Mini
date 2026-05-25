/* Signal Deck Mini — UI wiring + signal-card renderer. Logic lives in engine.js. */
(function () {
  'use strict';
  var E = window.SignalEngine;
  var ADAPTERS = window.SignalAdapters;
  var $ = function (id) { return document.getElementById(id); };
  var $m = E.money;
  var LS_KEY = 'sdm_apikey', LS_PROV = 'sdm_provider';

  var SOURCES = [
    'https://finance.yahoo.com/quote/SPY',
    'https://finance.yahoo.com/quote/SPY/options',
    'https://www.nasdaq.com/market-activity/etf/spy/option-chain',
    'https://www.tradingview.com/symbols/AMEX-SPY/',
    'https://www.cboe.com/tradable_products/vix/'
  ];

  function val(id) { var el = $(id); return el ? el.value.trim() : ''; }
  function checked(id) { var el = $(id); return !!(el && el.checked); }
  function n(v) { return (v === null || v === undefined || v === '') ? '—' : v; }
  function pct(v) { return v === null || v === undefined ? '—' : Math.round(v * 100) + '%'; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function collect() {
    return {
      session: val('session'), spy: val('spy'), vwapBand: val('vwapBand'),
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
      stopPct: val('stopPct'), t1Pct: val('t1Pct'), t2Pct: val('t2Pct'), now: new Date()
    };
  }

  // ---- small builders ----
  function actionClass(a) {
    return a === 'BUY CALL' ? 'call' : a === 'BUY PUT' ? 'put' : a === 'WAIT' ? 'wait' : 'notrade';
  }
  function ratingClass(r) {
    return (r === 'PASS' || r === 'BULLISH') ? 'pass'
      : (r === 'FAIL' || r === 'BEARISH') ? 'fail' : 'neutral';
  }
  function pill(label) { return '<span class="pill ' + ratingClass(label) + '">' + esc(label) + '</span>'; }
  function dlRow(k, v, cls, extra) {
    return '<div class="dl-row' + (extra ? ' ' + extra : '') + '"><dt>' + esc(k) + '</dt>' +
      '<dd' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</dd></div>';
  }
  function section(title, body, divider) {
    return '<section class="section' + (divider ? ' section--divider' : '') + '">' +
      '<h3 class="section-title">' + title + '</h3>' + body + '</section>';
  }

  function renderCard(r) {
    var c = r.contract, p = r.plan, L = r.levels, sc = r.scorecard;
    var html = '';

    // Header
    html += '<header class="card-header">' +
      '<div class="hdr-left">' +
        '<span class="action-pill ' + actionClass(r.action) + '">' + esc(r.action) + '</span>' +
        '<div><div class="price">' + (r.spy !== null ? '$' + r.spy.toFixed(2) : '—') + '</div>' +
        '<div class="sub">SPY · 0DTE</div></div>' +
      '</div>' +
      '<div class="hdr-stats">' +
        '<div class="hdr-stat"><div class="sub">Session</div><div class="v">' + esc(r.sessionLabel) + '</div></div>' +
        '<div class="hdr-stat"><div class="sub">Confidence</div><div class="v">' + esc(r.confidence) + '</div></div>' +
        '<div class="hdr-stat"><div class="sub">Quality</div><div class="v">' + esc(r.tradeQuality) + '</div></div>' +
      '</div>' +
    '</header>';

    // Gates (why no/limited trade)
    if (r.gates.length) {
      var gl = '<ul class="gates">';
      r.gates.forEach(function (g) {
        gl += '<li><span class="g-tag">' + esc(g.tag) + '</span>' + esc(g.msg) + '</li>';
      });
      gl += '</ul>';
      html += section('Why no / limited trade', gl, true);
    }

    // Entry Plan | Key Levels
    var ep = '<dl>' +
      dlRow('Entry', $m(p.entry)) +
      dlRow('Stop', '<span class="val-rose">' + $m(p.stop) + '</span>' +
        (p.maxRisk !== null ? '<span class="dd-sub">−$' + p.maxRisk + '/contract</span>' : '')) +
      dlRow('Target 1', '<span class="val-emerald">' + $m(p.t1) + '</span>' +
        (p.maxProfitT1 !== null ? '<span class="dd-sub">+$' + p.maxProfitT1 + '/contract</span>' : '')) +
      dlRow('Target 2', '<span class="val-emerald">' + $m(p.t2) + '</span>' +
        (p.maxProfitT2 !== null ? '<span class="dd-sub">+$' + p.maxProfitT2 + '/contract</span>' : '')) +
      dlRow('Risk / Reward', p.rr !== null ? '1:' + p.rr.toFixed(1) : '—', 'val-amber', 'top') +
      '</dl>';

    var kl = '<dl>' +
      dlRow('VWAP', $m(L.vwap) + ' <span class="dd-sub" style="display:inline">(' + r.vwapState + ')</span>') +
      dlRow('Resistance', $m(L.resistance)) +
      dlRow('Support', $m(L.support)) +
      dlRow('Prior Day High', $m(L.pdh)) +
      dlRow('Prior Day Low', $m(L.pdl)) +
      dlRow('Day Open', $m(L.open)) +
      '</dl>';

    html += '<div class="grid-split">' +
      '<section class="section"><h3 class="section-title">Entry Plan</h3>' + ep + '</section>' +
      '<section class="section"><h3 class="section-title">Key Levels</h3>' + kl + '</section>' +
    '</div>';

    // Contract selection
    var contract = '<dl>' +
      dlRow('Direction', esc(c.direction)) +
      dlRow('Strike', c.strike !== null ? '$' + c.strike + ' · ' + esc(c.type) : '—') +
      dlRow('Premium', $m(c.premium) + (c.totalCost !== null ? '<span class="dd-sub">$' + c.totalCost + '/contract</span>' : '')) +
      dlRow('Bid / Ask', $m(c.bid) + ' / ' + $m(c.ask)) +
      dlRow('Spread', $m(c.spread)) +
      dlRow('Volume / OI', n(c.volume) + ' / ' + n(c.oi)) +
      dlRow('Delta / IV', n(c.delta) + ' / ' + (c.iv !== null ? pct(c.iv) : '—')) +
      '</dl>';
    if (r.tradeable && p.spyTrigger !== null) {
      contract += '<p class="prose" style="margin-top:12px">Trigger: enter when SPY <strong>' +
        esc(p.spyTriggerDir) + ' $' + p.spyTrigger.toFixed(2) + '</strong> on the ' + esc(p.entryTf) +
        ' close (confirm on ' + esc(p.confirmTf) + '). Style: ' + esc(p.style) + '. Invalidation: ' +
        (r.action === 'BUY CALL' ? 'below' : 'above') + ' $' +
        (p.invalidation !== null ? p.invalidation.toFixed(2) : '—') + '.</p>';
    }
    html += section('0DTE Contract Selection', contract, true);

    // Scorecard
    var rows = [
      ['MACD Momentum', sc.macd], ['RSI + VWAP', sc.rsivwap], ['Volume / CVD', sc.volume],
      ['Entry Timeframe', sc.timeframe], ['Historical Match', sc.history],
      ['News / Macro', sc.news], ['Options Chain', sc.options]
    ];
    var scList = '<ul class="scorecard">';
    rows.forEach(function (row) {
      scList += '<li><div class="sc-pill">' + pill(row[1].r) + '</div>' +
        '<div><div class="sc-name">' + row[0] + '</div>' +
        '<p class="sc-reason">' + esc(row[1].reason) + '</p></div></li>';
    });
    scList += '</ul>';
    html += section('Scorecard', scList, true);

    // Reasoning
    html += section('Reasoning', '<p class="prose">' + esc(r.reasoning) + '</p>', true);

    // Exit Triggers | Risk Management
    var exits = r.tradeable ? [
      'Take partial profit at Target 1 (' + $m(p.t1) + ').',
      'Hold for Target 2 only if SPY keeps confirming direction.',
      'Hard stop if premium hits ' + $m(p.stop) + '.',
      'Exit if SPY ' + (r.action === 'BUY CALL' ? 'loses VWAP' : 'reclaims VWAP') + ' against you.',
      'Exit if MACD momentum flips or volume dries up.',
      'Do not hold past 15:55 ET — 0DTE decay accelerates into the close.'
    ] : [
      'No live trade — nothing to manage.',
      'Re-check once the gates above clear (VWAP reclaim/rejection, clean MACD, valid contract).'
    ];
    var risk = [
      'Paper-trading education only; risk 1–2% of a paper account per trade.',
      'Start with 1 contract; never average down on a losing option.',
      'Skip wide spreads, thin volume, and VWAP chop.',
      'Max 3 trades/day; stop after 2 consecutive losses.',
      'Avoid entering into major scheduled news.'
    ];
    html += '<div class="grid-split">' +
      '<section class="section"><h3 class="section-title">Exit Triggers</h3>' + bullets(exits) + '</section>' +
      '<section class="section"><h3 class="section-title">Risk Management</h3>' + bullets(risk) + '</section>' +
    '</div>';

    // News impact
    html += '<section class="section section--divider">' +
      '<div class="news-row"><h3 class="section-title">News Impact</h3>' + pill(r.news.sentiment) + '</div>' +
      '<p class="news-head">' + esc(r.news.headline) + '</p>' +
      '<p class="news-impact">' + esc(r.news.shortImpact) + ' ' + esc(r.news.optionsImpact) + '</p>' +
    '</section>';

    // Sources
    var srcs = '<ul class="sources">';
    SOURCES.forEach(function (u) {
      srcs += '<li><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + '</a></li>';
    });
    srcs += '</ul>';
    html += section('Sources To Check', srcs, true);

    // Footer
    html += '<footer class="card-footer">Generated ' + esc(new Date().toLocaleString()) +
      ' · Paper-trading education only — not financial advice.</footer>';

    var card = $('card');
    card.innerHTML = html;
    showCard();
  }

  function bullets(items) {
    var h = '<ul class="bullets">';
    items.forEach(function (t) { h += '<li><span class="mk">▸</span><span>' + esc(t) + '</span></li>'; });
    return h + '</ul>';
  }

  function showCard() { $('card').hidden = false; $('empty').hidden = true; $('error').hidden = true; }
  function showError(msg) {
    $('error').textContent = msg; $('error').hidden = false;
    $('card').hidden = true; $('empty').hidden = true;
  }

  function analyze() {
    try { renderCard(E.runAnalysis(collect())); }
    catch (err) { showError('Error: ' + (err.message || String(err))); }
  }

  // ---- data source ----
  function applyFields(fields) {
    Object.keys(fields).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!fields[id]; else el.value = fields[id];
    });
  }
  function currentAdapter() { return ADAPTERS.byId[val('provider')] || ADAPTERS.byId.manual; }
  function setStatus(cls, html) { var s = $('fetchStatus'); s.className = 'status ' + (cls || ''); s.innerHTML = html || ''; }

  function syncSourceUI() {
    var a = currentAdapter(), needs = !!a.needsKey;
    $('keyWrap').hidden = !needs;
    $('rememberWrap').hidden = !needs;
    $('keyHint').textContent = a.keyHint || '';
  }

  function setLoading(on) {
    var b = $('generate');
    b.disabled = on;
    b.innerHTML = on ? '<span class="spinner"></span>Analyzing…' : 'Generate signal';
  }

  function persistKey() {
    try {
      if (checked('rememberKey')) { localStorage.setItem(LS_KEY, val('apiKey')); localStorage.setItem(LS_PROV, val('provider')); }
      else localStorage.removeItem(LS_KEY);
    } catch (e) {}
  }

  function generate() {
    var a = currentAdapter();
    if (a.id === 'manual') { analyze(); return; }
    if (a.needsKey && !val('apiKey')) { setStatus('err', 'Enter an API key first.'); return; }
    persistKey();
    setLoading(true);
    setStatus('busy', 'Fetching from ' + esc(a.label) + '…');
    a.fetch({ apiKey: val('apiKey'), symbol: 'SPY' }).then(function (res) {
      applyFields(res.fields);
      var filled = res.filled.length ? 'Filled ' + res.filled.length + ' field(s).' : 'No fields returned.';
      var gaps = (res.gaps && res.gaps.length) ? ' Manual: ' + res.gaps.join(', ') + '.' : '';
      setStatus('ok', esc(filled + gaps));
      analyze();
    }).catch(function (err) {
      setStatus('err', 'Fetch failed: ' + esc(err.message || String(err)));
      showError('Fetch failed: ' + (err.message || String(err)));
    }).then(function () { setLoading(false); });
  }

  // ---- example / reset / toggle ----
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
    $('provider').value = 'manual'; syncSourceUI();
    Object.keys(EXAMPLE).forEach(function (k) { if ($(k)) $(k).value = EXAMPLE[k]; });
    $('newsImminent').checked = false;
    setStatus('ok', 'Loaded example readings.');
    analyze();
  }

  function resetForm() {
    document.querySelectorAll('#inputsPanel input').forEach(function (el) {
      if (el.type === 'checkbox') el.checked = false; else el.value = '';
    });
    $('stopPct').value = '0.30'; $('t1Pct').value = '0.60'; $('t2Pct').value = '1.20';
    document.querySelectorAll('#inputsPanel select').forEach(function (el) { el.selectedIndex = 0; });
    $('card').hidden = true; $('error').hidden = true; $('empty').hidden = false;
    setStatus('', '');
  }

  function toggleInputs() {
    var panel = $('inputsPanel'), btn = $('toggleInputs');
    var open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Manual inputs ▴' : 'Manual inputs ▾';
  }

  function initSource() {
    var sel = $('provider');
    ADAPTERS.list.forEach(function (a) {
      var o = document.createElement('option');
      o.value = a.id; o.textContent = a.label; sel.appendChild(o);
    });
    var savedProv, savedKey;
    try { savedProv = localStorage.getItem(LS_PROV); savedKey = localStorage.getItem(LS_KEY); } catch (e) {}
    if (savedProv && ADAPTERS.byId[savedProv]) sel.value = savedProv;
    else sel.value = 'mock'; // default to the offline demo so first click shows a full signal
    if (savedKey) { $('apiKey').value = savedKey; $('rememberKey').checked = true; }
    syncSourceUI();
    sel.addEventListener('change', syncSourceUI);
  }

  $('generate').addEventListener('click', generate);
  $('analyze').addEventListener('click', analyze);
  $('example').addEventListener('click', loadExample);
  $('reset').addEventListener('click', resetForm);
  $('toggleInputs').addEventListener('click', toggleInputs);

  initSource();
})();
