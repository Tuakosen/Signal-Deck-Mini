/*
 * Signal Deck Mini — SPY 0DTE Options analysis engine.
 * PAPER TRADING EDUCATION ONLY. Not financial advice.
 *
 * Pure decision logic. Takes market readings as input and produces a
 * structured signal following the 8-step framework. No network calls,
 * no DOM — so it runs identically in the browser and under node tests.
 */
(function (root) {
  'use strict';

  // --- Tunable thresholds. Values are non-obvious risk gates, hence noted. ---
  var CFG = {
    biasThreshold: 2,        // net directional score needed to commit a direction
    rsiOverbought: 70,
    rsiOversold: 30,
    spreadAbsWide: 0.10,     // 0DTE ATM SPY spreads are normally a few cents
    spreadRelWide: 0.10,     // spread > 10% of premium = too wide
    minContractVolume: 500,
    minContractOI: 500,
    minRiskReward: 2.0,      // spec: reject anything worse than 1:2
    lateSessionMin: 15 * 60 + 30, // 15:30 ET — decay risk grows after this
    cutoffMin: 15 * 60 + 55       // 15:55 ET — do not open new 0DTE
  };

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  // Minutes since ET midnight for a given Date, plus weekend flag.
  function etClock(date) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
    });
    var parts = {};
    fmt.formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    var h = parseInt(parts.hour, 10) % 24;
    var m = parseInt(parts.minute, 10);
    var weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
    return { minutes: h * 60 + m, weekend: weekend, weekday: parts.weekday };
  }

  function detectSession(date) {
    var c = etClock(date);
    if (c.weekend) return { session: 'CLOSED', minutes: c.minutes };
    var m = c.minutes;
    if (m >= 240 && m < 570) return { session: 'PRE', minutes: m };       // 04:00–09:30
    if (m >= 570 && m < 975) return { session: 'RTH', minutes: m };       // 09:30–16:15
    if (m >= 975 && m < 1200) return { session: 'AFTER', minutes: m };    // 16:15–20:00
    return { session: 'CLOSED', minutes: m };
  }

  var SESSION_LABEL = {
    PRE: 'PRE-MARKET', RTH: 'RTH', AFTER: 'AFTER-HOURS', CLOSED: 'CLOSED'
  };

  function fmtDateET(date) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: 'short', day: '2-digit'
    }).format(date);
  }

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + n.toFixed(2);
  }

  // A real, tradable 0DTE chain quote: both sides present and sane, plus volume.
  // Strike/type are derived by the engine and expiry is today by construction,
  // so the data gate is the live quote (bid/ask/volume) — not those derived fields.
  function validOptionsChain(opt) {
    return opt.bid !== null && opt.ask !== null &&
      opt.ask > 0 && opt.bid >= 0 && opt.ask >= opt.bid &&
      opt.volume !== null;
  }

  // Support/resistance from the SPY underlying when not explicitly supplied:
  // nearest reference level below price = support, nearest above = resistance.
  function deriveLevels(lv, spy) {
    if (spy === null) return;
    var refs = [lv.pdh, lv.pdl, lv.pmh, lv.pml, lv.orh, lv.orl, lv.open, lv.pdc].filter(
      function (x) { return x !== null && x !== undefined; });
    if (lv.resistance === null) {
      var above = refs.filter(function (x) { return x > spy; });
      if (above.length) lv.resistance = Math.min.apply(null, above);
    }
    if (lv.support === null) {
      var below = refs.filter(function (x) { return x < spy; });
      if (below.length) lv.support = Math.max.apply(null, below);
    }
  }

  // --- Directional scoring -------------------------------------------------
  function scoreDirection(inp, vwapState) {
    var s = 0;
    var notes = [];

    if (vwapState === 'ABOVE') { s += 1; notes.push('price above VWAP'); }
    else if (vwapState === 'BELOW') { s -= 1; notes.push('price below VWAP'); }

    if (inp.macdDir === 'BULL') { s += 1; }
    else if (inp.macdDir === 'BEAR') { s -= 1; }

    if (inp.macd15 === 'BULL') s += 0.5;
    else if (inp.macd15 === 'BEAR') s -= 0.5;

    if (inp.qqq === 'BULL') s += 1;
    else if (inp.qqq === 'BEAR') s -= 1;

    if (inp.es === 'BULL') s += 1;
    else if (inp.es === 'BEAR') s -= 1;

    if (inp.rsi !== null) {
      if (inp.rsi > 50 && inp.rsi < CFG.rsiOverbought) s += 0.5;
      else if (inp.rsi < 50 && inp.rsi > CFG.rsiOversold) s -= 0.5;
    }

    if (inp.news === 'BULLISH') s += 1;
    else if (inp.news === 'BEARISH') s -= 1;

    if (inp.vix === 'UP') s -= 0.5;
    else if (inp.vix === 'DOWN') s += 0.5;

    if (inp.yield10 === 'UP') s -= 0.5;
    else if (inp.yield10 === 'DOWN') s += 0.5;

    if (inp.volume === 'CONFIRM_UP') s += 0.5;
    else if (inp.volume === 'CONFIRM_DOWN') s -= 0.5;

    return { score: s, notes: notes };
  }

  function impact(dir, bullVal, bearVal) {
    if (dir === bullVal) return 'BULLISH';
    if (dir === bearVal) return 'BEARISH';
    return 'NEUTRAL';
  }

  // --- Scorecard cells -----------------------------------------------------
  function macdCell(inp, side) {
    if (inp.macdDir === 'FLAT') return { r: 'NEUTRAL', reason: 'MACD flat / transitioning' };
    var aligns = (side === 'CALL' && inp.macdDir === 'BULL') ||
                 (side === 'PUT' && inp.macdDir === 'BEAR');
    if (!side) {
      return { r: 'NEUTRAL', reason: 'no committed direction yet' };
    }
    if (aligns) {
      var strong = inp.histo === 'EXPANDING';
      return { r: 'PASS', reason: 'MACD ' + inp.macdDir.toLowerCase() +
        (strong ? ', histogram expanding' : ', histogram flat/contracting') };
    }
    return { r: 'FAIL', reason: 'MACD momentum opposes the ' + side.toLowerCase() };
  }

  function rsiVwapCell(inp, side, vwapState) {
    if (vwapState === 'CHOP') return { r: 'NEUTRAL', reason: 'price chopping around VWAP' };
    if (inp.rsi === null) return { r: 'NEUTRAL', reason: 'RSI not provided' };
    if (side === 'CALL') {
      if (vwapState === 'ABOVE' && inp.rsi >= 45 && inp.rsi < CFG.rsiOverbought)
        return { r: 'PASS', reason: 'above VWAP, RSI ' + inp.rsi + ' in bullish zone' };
      if (inp.rsi >= CFG.rsiOverbought)
        return { r: 'FAIL', reason: 'RSI ' + inp.rsi + ' overbought, reversal risk' };
      return { r: 'NEUTRAL', reason: 'RSI/VWAP not clearly supporting calls' };
    }
    if (side === 'PUT') {
      if (vwapState === 'BELOW' && inp.rsi <= 55 && inp.rsi > CFG.rsiOversold)
        return { r: 'PASS', reason: 'below VWAP, RSI ' + inp.rsi + ' in bearish zone' };
      if (inp.rsi <= CFG.rsiOversold)
        return { r: 'FAIL', reason: 'RSI ' + inp.rsi + ' oversold, bounce risk' };
      return { r: 'NEUTRAL', reason: 'RSI/VWAP not clearly supporting puts' };
    }
    return { r: 'NEUTRAL', reason: 'no committed direction' };
  }

  function volumeCell(inp, side) {
    if (inp.volume === 'WEAK') return { r: 'FAIL', reason: 'weak participation, do not chase' };
    if (inp.volume === 'MIXED') return { r: 'NEUTRAL', reason: 'mixed / unclear volume' };
    var aligns = (side === 'CALL' && inp.volume === 'CONFIRM_UP') ||
                 (side === 'PUT' && inp.volume === 'CONFIRM_DOWN');
    if (aligns) return { r: 'PASS', reason: 'volume confirms the move' };
    return { r: 'FAIL', reason: 'flow opposes the ' + (side ? side.toLowerCase() : 'trade') };
  }

  function optionsCell(opt, gates, hasValidOptions, chainPresent) {
    if (!hasValidOptions) return { r: 'NEUTRAL', reason: chainPresent
      ? 'live chain loaded but no directional contract selected'
      : 'no live 0DTE options-chain data — technical bias only' };
    var bad = gates.filter(function (g) { return g.tag === 'OPT'; });
    if (bad.length) return { r: 'FAIL', reason: bad[0].msg };
    return { r: 'PASS', reason: 'spread ' + money(opt.spread) + ', vol ' + opt.volume +
      ', OI ' + (opt.oi !== null ? opt.oi : 'n/a') + ' — liquid' };
  }

  // --- Main ----------------------------------------------------------------
  function runAnalysis(raw) {
    var inp = normalize(raw);
    var sess = inp.sessionOverride && inp.sessionOverride !== 'AUTO'
      ? { session: inp.sessionOverride, minutes: detectSession(inp.now).minutes }
      : detectSession(inp.now);

    var spy = inp.spy;
    var vwap = inp.levels.vwap;
    var band = inp.vwapBand !== null ? inp.vwapBand : (spy ? 0.0005 * spy : 0.25);

    // VWAP state
    var vwapState = 'UNKNOWN';
    if (spy !== null && vwap !== null) {
      if (Math.abs(spy - vwap) <= band) vwapState = 'CHOP';
      else if (spy > vwap) vwapState = 'ABOVE';
      else vwapState = 'BELOW';
    }

    var dir = scoreDirection(inp, vwapState);
    var bias = dir.score >= CFG.biasThreshold ? 'BULLISH'
             : dir.score <= -CFG.biasThreshold ? 'BEARISH' : 'NEUTRAL';

    // Hard NO-TRADE / WAIT gates
    var gates = [];
    if (sess.session !== 'RTH') {
      gates.push({ tag: 'SESSION', msg: 'Outside regular options hours (' +
        SESSION_LABEL[sess.session] + ') — 0DTE options only trade 09:30–16:15 ET. Bias only.' });
    }
    if (vwapState === 'CHOP') {
      gates.push({ tag: 'VWAP', msg: 'SPY is chopping around VWAP (within ' + money(band) + ').' });
    }
    if (inp.macdDir !== 'FLAT' && inp.macd15 !== 'NEUTRAL' &&
        ((inp.macdDir === 'BULL' && inp.macd15 === 'BEAR') ||
         (inp.macdDir === 'BEAR' && inp.macd15 === 'BULL'))) {
      gates.push({ tag: 'MACD', msg: '5-minute and 15-minute MACD conflict.' });
    }
    if (bias === 'NEUTRAL') {
      gates.push({ tag: 'BIAS', msg: 'Signals are mixed / neutral — no committed direction.' });
    }
    if (inp.newsImminent) {
      gates.push({ tag: 'NEWS', msg: 'Major scheduled news is imminent — avoid entering into the release.' });
    }

    var side = bias === 'BULLISH' ? 'CALL' : bias === 'BEARISH' ? 'PUT' : null;

    // Layer the analysis: SPY underlying technical vs. live 0DTE options chain.
    deriveLevels(inp.levels, spy);
    var hasUnderlyingData = spy !== null;
    var opt = selectContract(inp, side);
    var hasValidOptions = validOptionsChain(opt);
    var chainPresent = !!(inp.chain && inp.chain.expiresToday && (inp.chain.call || inp.chain.put));

    // Contract tradeability gates — only meaningful with a real chain.
    if (hasValidOptions) {
      if (opt.spread !== null) {
        if (opt.spread > CFG.spreadAbsWide)
          gates.push({ tag: 'OPT', msg: 'Bid/ask spread ' + money(opt.spread) + ' is too wide.' });
        else if (opt.premium > 0 && opt.spread / opt.premium > CFG.spreadRelWide)
          gates.push({ tag: 'OPT', msg: 'Spread is >' + (CFG.spreadRelWide * 100) + '% of premium.' });
      }
      if (opt.volume !== null && opt.volume < CFG.minContractVolume)
        gates.push({ tag: 'OPT', msg: 'Contract volume ' + opt.volume + ' below liquidity floor.' });
      if (opt.oi !== null && opt.oi < CFG.minContractOI)
        gates.push({ tag: 'OPT', msg: 'Open interest ' + opt.oi + ' below liquidity floor.' });
      if (sess.session === 'RTH' && sess.minutes >= CFG.cutoffMin)
        gates.push({ tag: 'TIME', msg: 'After 15:55 ET — not enough time left for a 0DTE move.' });
    }

    // Entry plan (SPY technical levels always; premium math only with a real chain).
    var plan = buildPlan(inp, side, hasValidOptions, opt);
    if (hasValidOptions && plan.rr !== null && plan.rr < CFG.minRiskReward) {
      gates.push({ tag: 'RR', msg: 'Risk/reward 1:' + plan.rr.toFixed(1) + ' is worse than 1:2.' });
    }

    // Determine status + final action across the two layers.
    var status, statusLabel, warning = null, action, tradeable = false;
    if (!hasUnderlyingData) {
      status = 'NO MARKET DATA'; statusLabel = 'No Market Data';
      warning = 'No SPY market data provided — enter readings or fetch a live source.';
      action = 'WAIT';
    } else if (!hasValidOptions) {
      status = 'TECHNICAL BIAS ONLY'; statusLabel = 'Technical Bias Only';
      warning = chainPresent
        ? (side
            ? 'Live 0DTE chain loaded, but the selected ' + side + ' quote is incomplete. Technical SPY bias only.'
            : 'Live 0DTE chain loaded, but SPY bias is neutral — no directional CALL/PUT to confirm. Add VWAP/MACD/RSI for a directional read.')
        : 'No live 0DTE options-chain data available. Technical SPY bias only.';
      action = side ? 'NO OPTIONS TRADE' : 'WAIT';
    } else {
      status = 'CONFIRMED 0DTE OPTIONS SIGNAL'; statusLabel = 'Confirmed 0DTE Signal';
      var hardStop = gates.some(function (g) {
        return ['SESSION', 'VWAP', 'OPT', 'TIME', 'RR', 'NEWS'].indexOf(g.tag) >= 0;
      });
      if (!side) action = 'WAIT';
      else if (hardStop) action = 'NO OPTIONS TRADE';
      else action = side === 'CALL' ? 'BUY CALL' : 'BUY PUT';
      if (action === 'WAIT' && gates.some(function (g) { return g.tag === 'SESSION' || g.tag === 'VWAP'; }))
        action = 'NO OPTIONS TRADE';
      tradeable = action === 'BUY CALL' || action === 'BUY PUT';
    }

    var cleanStructure = side && vwapState !== 'CHOP' && vwapState !== 'UNKNOWN';

    // Scorecard
    var sc = {
      macd: macdCell(inp, side),
      rsivwap: rsiVwapCell(inp, side, vwapState),
      volume: volumeCell(inp, side),
      timeframe: cleanStructure
        ? { r: 'PASS', reason: 'clean structure for ' + plan.entryTf + ' entry (confirm ' + plan.confirmTf + ')' }
        : { r: 'NEUTRAL', reason: 'no clean entry timeframe yet' },
      history: historyCell(inp, side),
      news: { r: inp.news, reason: inp.newsHeadline || 'no catalyst noted' },
      options: optionsCell(opt, gates, hasValidOptions, chainPresent)
    };

    var passes = ['macd', 'rsivwap', 'volume', 'timeframe', 'history', 'options']
      .filter(function (k) { return sc[k].r === 'PASS'; }).length;

    var confidence = (passes >= 5 && Math.abs(dir.score) >= 3) ? 'HIGH'
      : (passes >= 3 && Math.abs(dir.score) >= 2) ? 'MEDIUM' : 'LOW';
    if (!tradeable) confidence = 'LOW';

    var quality;
    if (!tradeable) quality = 'NO TRADE';
    else if (confidence === 'HIGH' && passes >= 6) quality = 'A+';
    else if (confidence === 'HIGH') quality = 'A';
    else if (confidence === 'MEDIUM') quality = 'B';
    else quality = 'C';

    var contract = buildContract(inp, side, status, bias, opt);

    return {
      action: action,
      status: status,
      statusLabel: statusLabel,
      warning: warning,
      optionsAvailable: hasValidOptions,
      tradeable: tradeable,
      spy: spy,
      session: sess.session,
      sessionLabel: SESSION_LABEL[sess.session],
      sessionMinutes: sess.minutes,
      confidence: confidence,
      tradeQuality: quality,
      biasScore: dir.score,
      bias: bias,
      technicalBias: bias,
      trend: trendLabel(inp.regime),
      cross: {
        qqq: impact(inp.qqq, 'BULL', 'BEAR'),
        es: impact(inp.es, 'BULL', 'BEAR'),
        vix: impact(inp.vix, 'DOWN', 'UP'),       // VIX down = bullish for SPY
        yield10: impact(inp.yield10, 'DOWN', 'UP') // yields down = bullish for growth
      },
      optionDirection: side || 'NO OPTIONS TRADE',
      contract: contract,
      plan: plan,
      vwapState: vwapState,
      vwapBand: band,
      levels: inp.levels,
      scorecard: sc,
      scorePasses: passes,
      gates: gates,
      news: {
        headline: inp.newsHeadline || 'No catalyst provided',
        shortImpact: newsShort(inp.news),
        optionsImpact: newsOptions(inp.news, inp.vix),
        sentiment: inp.news
      },
      reasoning: buildReasoning(action, bias, vwapState, inp, plan, sc, status),
      finalSummary: buildSummary(action, contract, plan, quality, status, bias)
    };
  }

  function normOption(op) {
    op = op || {};
    var bid = num(op.bid), ask = num(op.ask), prem = num(op.premium);
    if (prem === null && bid !== null && ask !== null) prem = (bid + ask) / 2;
    var spread = (bid !== null && ask !== null) ? +(ask - bid).toFixed(2) : null;
    return {
      premium: prem, bid: bid, ask: ask, spread: spread,
      volume: num(op.volume), oi: num(op.oi != null ? op.oi : op.openInterest),
      iv: num(op.iv), delta: num(op.delta), gamma: num(op.gamma), theta: num(op.theta),
      strike: num(op.strike), expDate: op.expDate || null
    };
  }

  function emptyOption() {
    return {
      premium: null, bid: null, ask: null, spread: null, volume: null, oi: null,
      iv: null, delta: null, gamma: null, theta: null, strike: null, expDate: null
    };
  }

  // Chain-aware: when a live chain is present, pick the contract matching the
  // committed side; otherwise use the single manually-entered contract.
  function selectContract(inp, side) {
    if (inp.chain) {
      if (!side || !inp.chain.expiresToday) return emptyOption();
      var c = side === 'CALL' ? inp.chain.call : inp.chain.put;
      return c || emptyOption();
    }
    return inp.option;
  }

  function normalize(raw) {
    raw = raw || {};
    var lv = raw.levels || {};
    var ch = raw.chain;
    return {
      now: raw.now ? new Date(raw.now) : new Date(),
      sessionOverride: raw.session || 'AUTO',
      spy: num(raw.spy),
      vwapBand: num(raw.vwapBand),
      levels: {
        pmh: num(lv.pmh), pml: num(lv.pml), pdh: num(lv.pdh), pdl: num(lv.pdl),
        pdc: num(lv.pdc), open: num(lv.open), vwap: num(lv.vwap),
        orh: num(lv.orh), orl: num(lv.orl),
        support: num(lv.support), resistance: num(lv.resistance)
      },
      macdDir: raw.macdDir || 'FLAT',
      histo: raw.histo || 'FLAT',
      macd15: raw.macd15 || 'NEUTRAL',
      rsi: num(raw.rsi),
      volume: raw.volume || 'MIXED',
      qqq: raw.qqq || 'NEUTRAL',
      es: raw.es || 'NEUTRAL',
      vix: raw.vix || 'FLAT',
      yield10: raw.yield10 || 'FLAT',
      regime: raw.regime || 'CHOP',
      news: raw.news || 'NEUTRAL',
      newsHeadline: raw.newsHeadline || '',
      newsImminent: !!raw.newsImminent,
      option: normOption(raw.option),
      chain: ch ? {
        expiresToday: !!ch.expiresToday,
        expDate: ch.expDate || null,
        call: ch.call ? normOption(ch.call) : null,
        put: ch.put ? normOption(ch.put) : null
      } : null,
      stopPct: raw.stopPct != null ? num(raw.stopPct) : 0.30,
      t1Pct: raw.t1Pct != null ? num(raw.t1Pct) : 0.60,
      t2Pct: raw.t2Pct != null ? num(raw.t2Pct) : 1.20
    };
  }

  function buildPlan(inp, side, hasValidOptions, opt) {
    var prem = hasValidOptions ? opt.premium : null;
    var lv = inp.levels;
    var p = {
      mode: hasValidOptions ? 'Confirmed Options' : 'Technical Bias Only',
      premiumReason: hasValidOptions ? null : 'Premium levels require live 0DTE options-chain data.',
      entry: prem, stop: null, t1: null, t2: null,
      maxRisk: null, maxProfitT1: null, maxProfitT2: null, rr: null,
      entryTf: '2-minute', confirmTf: '5-minute', htf: '15-minute',
      style: 'No Trade', spyTrigger: null, spyTriggerDir: 'holds',
      invalidation: null
    };
    if (prem !== null) {
      p.stop = +(prem * (1 - inp.stopPct)).toFixed(2);
      p.t1 = +(prem * (1 + inp.t1Pct)).toFixed(2);
      p.t2 = +(prem * (1 + inp.t2Pct)).toFixed(2);
      p.maxRisk = +((prem - p.stop) * 100).toFixed(0);
      p.maxProfitT1 = +((p.t1 - prem) * 100).toFixed(0);
      p.maxProfitT2 = +((p.t2 - prem) * 100).toFixed(0);
      // R/R reflects the intended risk plan, not the cent-rounded ladder.
      if (inp.stopPct > 0) p.rr = +(inp.t1Pct / inp.stopPct).toFixed(2);
    }
    if (side === 'CALL') {
      if (inp.regime === 'BREAKOUT' && lv.resistance !== null) {
        p.style = 'Momentum Breakout'; p.spyTrigger = lv.resistance; p.spyTriggerDir = 'breaks';
        p.entryTf = '2-minute';
      } else if (lv.vwap !== null) {
        p.style = (inp.regime === 'TREND') ? 'Pullback Continuation' : 'VWAP Reclaim';
        p.spyTrigger = lv.vwap; p.spyTriggerDir = (p.style === 'VWAP Reclaim' ? 'reclaims' : 'holds');
        p.entryTf = '3-minute';
      }
      p.invalidation = lowest([lv.support, lv.vwap]);
    } else if (side === 'PUT') {
      if (inp.regime === 'BREAKOUT' && lv.support !== null) {
        p.style = 'Momentum Breakdown'; p.spyTrigger = lv.support; p.spyTriggerDir = 'breaks';
        p.entryTf = '2-minute';
      } else if (lv.vwap !== null) {
        p.style = (inp.regime === 'TREND') ? 'Pullback Continuation' : 'VWAP Rejection';
        p.spyTrigger = lv.vwap; p.spyTriggerDir = 'rejects';
        p.entryTf = '3-minute';
      }
      p.invalidation = highest([lv.resistance, lv.vwap]);
    }
    return p;
  }

  function buildContract(inp, side, status, bias, opt) {
    var spy = inp.spy;
    opt = opt || inp.option;
    var atm = spy !== null ? Math.round(spy) : null;
    // Prefer the real chain strike when present; otherwise the ATM estimate.
    var strike = (opt && opt.strike !== null && opt.strike !== undefined) ? opt.strike : atm;
    var type = 'ATM';
    if (side && strike !== null && spy !== null) {
      if (side === 'CALL') type = strike < spy - 0.01 ? 'Slightly ITM' : strike > spy + 0.01 ? 'Slightly OTM' : 'ATM';
      else type = strike > spy + 0.01 ? 'Slightly ITM' : strike < spy - 0.01 ? 'Slightly OTM' : 'ATM';
    }
    var expDate = (opt && opt.expDate) || fmtDateET(inp.now);

    if (status === 'CONFIRMED 0DTE OPTIONS SIGNAL') {
      return {
        status: 'Confirmed', reason: null, ticker: 'SPY', expDate: expDate,
        direction: side || 'n/a',
        strike: side ? strike : null,
        type: side ? type : 'n/a',
        contractStatus: 'Confirmed',
        technicalBias: bias, estimatedDirection: null, estimatedStrike: null,
        premium: opt.premium,
        totalCost: opt.premium !== null ? +(opt.premium * 100).toFixed(0) : null,
        bid: opt.bid, ask: opt.ask, spread: opt.spread,
        volume: opt.volume, oi: opt.oi, iv: opt.iv,
        delta: opt.delta, gamma: opt.gamma, theta: opt.theta
      };
    }

    // Options chain unavailable: technical bias only — never a confirmed contract.
    var estStrike = (side && strike !== null) ? strike : null;
    return {
      status: 'Unavailable',
      reason: 'No live 0DTE options-chain data provided.',
      ticker: 'SPY', expDate: expDate,
      direction: 'n/a', strike: null, type: 'n/a',
      technicalBias: bias,
      estimatedDirection: bias === 'BULLISH' ? 'CALL bias' : bias === 'BEARISH' ? 'PUT bias' : 'n/a',
      estimatedStrike: estStrike,
      contractStatus: estStrike !== null ? 'Estimated only — not confirmed tradable' : 'n/a',
      premium: null, totalCost: null, bid: null, ask: null, spread: null,
      volume: null, oi: null, iv: null, delta: null, gamma: null, theta: null
    };
  }

  function historyCell(inp, side) {
    if (!side) return { r: 'NEUTRAL', reason: 'no committed direction' };
    if (inp.regime === 'TREND')
      return { r: 'PASS', reason: 'trending regime favors continuation' };
    if (inp.regime === 'BREAKOUT')
      return { r: 'PASS', reason: 'breakout regime supports momentum entries' };
    if (inp.regime === 'RANGE')
      return { r: 'NEUTRAL', reason: 'range regime — fade extremes only' };
    return { r: 'FAIL', reason: 'choppy regime offers no historical edge' };
  }

  function trendLabel(regime) {
    return { TREND: 'UPTREND/DOWNTREND', BREAKOUT: 'BREAKOUT', RANGE: 'RANGE', CHOP: 'CHOP' }[regime] || 'CHOP';
  }

  function newsShort(s) {
    if (s === 'BULLISH') return 'Headlines lean risk-on; supports upside continuation in SPY.';
    if (s === 'BEARISH') return 'Headlines lean risk-off; pressures SPY to the downside.';
    return 'No directional catalyst; price action / levels lead.';
  }
  function newsOptions(s, vix) {
    var v = vix === 'UP' ? ' Rising VIX inflates premiums and theta risk.'
      : vix === 'DOWN' ? ' Falling VIX compresses premiums.' : '';
    if (s === 'BULLISH') return 'Favors calls; watch for IV crush on confirmation.' + v;
    if (s === 'BEARISH') return 'Favors puts; demand for protection can lift put IV.' + v;
    return 'Neutral for premium direction.' + v;
  }

  function vwapPhrase(vwapState) {
    return vwapState === 'ABOVE' ? 'price above VWAP'
      : vwapState === 'BELOW' ? 'price below VWAP'
      : vwapState === 'CHOP' ? 'price chopping at VWAP' : 'VWAP n/a';
  }

  function buildReasoning(action, bias, vwapState, inp, plan, sc, status) {
    if (status === 'NO MARKET DATA') {
      return 'No SPY market data yet — enter readings or fetch a live source to generate a signal.';
    }
    if (status === 'TECHNICAL BIAS ONLY') {
      return 'SPY technical bias is ' + (bias === 'NEUTRAL' ? 'neutral' : bias.toLowerCase()) +
        ' (' + vwapPhrase(vwapState) + ', MACD ' + inp.macdDir.toLowerCase() + ', RSI ' +
        (inp.rsi !== null ? inp.rsi : 'n/a') + '). No live 0DTE options-chain data is available, ' +
        'so no contract is confirmed — showing the SPY technical layer only. Provide a same-day ' +
        'chain (bid/ask/volume) to confirm a tradable CALL or PUT.';
    }
    if (action === 'NO OPTIONS TRADE' || action === 'WAIT') {
      return 'Setup does not meet the bar: ' +
        (vwapState === 'CHOP' ? 'price is chopping around VWAP, ' : '') +
        'bias is ' + bias.toLowerCase() + ' with MACD ' + inp.macdDir.toLowerCase() +
        ' and ' + (sc.options.r === 'FAIL' ? 'contract liquidity/spread failing. ' : 'no clean confirmation. ') +
        'Better to wait than force a weak 0DTE signal.';
    }
    var side = action === 'BUY CALL' ? 'call' : 'put';
    return 'Price is ' + (vwapState === 'ABOVE' ? 'above' : 'below') + ' VWAP with MACD ' +
      inp.macdDir.toLowerCase() + ' and RSI ' + (inp.rsi !== null ? inp.rsi : 'n/a') +
      ' supporting the ' + side + '. Volume ' +
      (sc.volume.r === 'PASS' ? 'confirms' : 'is mixed on') + ' the move and cross-market (QQQ/ES) ' +
      'aligns. Enter on the ' + plan.entryTf + ' close with ' + plan.confirmTf +
      ' confirmation; macro/news is ' + inp.news.toLowerCase() + '.';
  }

  function buildSummary(action, c, plan, quality, status, bias) {
    if (status === 'NO MARKET DATA') return 'Waiting on SPY market data.';
    if (status === 'TECHNICAL BIAS ONLY')
      return 'Technical SPY bias is ' + (bias === 'NEUTRAL' ? 'neutral' : bias.toLowerCase()) +
        '. Provide a live 0DTE options chain (today\'s expiry, bid/ask/volume) to confirm a tradable CALL/PUT contract.';
    if (action === 'WAIT')
      return 'No committed direction yet — wait for VWAP/MACD to align before risking 0DTE premium.';
    if (action === 'NO OPTIONS TRADE')
      return 'Conditions fail the safety gates — stand aside; protecting capital beats forcing a 0DTE trade.';
    var t = action === 'BUY CALL' ? 'CALL' : 'PUT';
    return 'SPY $' + c.strike + ' ' + t + ' (0DTE) is the cleanest ' + quality +
      ' paper-trade: enter on the ' + plan.entryTf + ' close after ' + plan.confirmTf +
      ' confirmation, stop at ' + money(plan.stop) + ', targets ' + money(plan.t1) +
      ' / ' + money(plan.t2) + '.';
  }

  function lowest(arr) {
    var v = arr.filter(function (x) { return x !== null && x !== undefined; });
    return v.length ? Math.min.apply(null, v) : null;
  }
  function highest(arr) {
    var v = arr.filter(function (x) { return x !== null && x !== undefined; });
    return v.length ? Math.max.apply(null, v) : null;
  }

  var api = {
    runAnalysis: runAnalysis,
    detectSession: detectSession,
    fmtDateET: fmtDateET,
    money: money,
    CFG: CFG
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SignalEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
