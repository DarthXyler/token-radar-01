// model.js: the one source of truth. main.ts loads it (createRequire) to write board.json; the page loads it as a
// classic script and refits everything from data.js (the snapshot's raw fields). Deterministic: no clock, seeded RNG.
//   launchValue  = TVL x exp(fitted log mcap/TVL)  fitted on the traded protocols, terms kept only if held-out error falls
//   tokenOdds    = P(records a token within the horizon | none yet), a logistic fit on all protocols' age and token record
//   impliedValue = launchValue x tokenOdds          ranks the board; P25-P75 from a seeded residual bootstrap
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RadarModel = make();
})(this, function () {
  'use strict';
  var MODEL = {
    version: 'fit-3', seed: 20261114, boot: 200, ridge: { num: 1, family: 2, category: 4 }, wf_start: 0.5, wf_folds: 4,
    horizon_days: 365, plan_usd: 2500, share: 0.1, opp_rate: 0.01, farm_per_hour: 10, max_deposit: 100000
  };
  var VALUE_TERMS = ['size', 'family', 'category', 'growth', 'age', 'chains'];
  var ODDS_TERMS = ['age', 'family', 'size', 'growth', 'chains'];
  var TERM_LABEL = { size: 'size curve (log TVL)', family: 'family effect', category: 'category effect', growth: '7-day growth', age: 'log age', chains: 'log chain count' };
  // Families from category names: keywords, never protocol names.
  var FAMILIES = [['staking', /stak|btc/i], ['vaults', /curator|allocator|yield|vault|farm|basis|liquidity manager|index/i],
    ['lending', /lend|cdp|collateral|stable|reserve|credit/i], ['dex', /dex|deriv|perp|option|synth|predict|launchpad|otc|nft|interest/i],
    ['rwa', /rwa|payment|card|cedefi/i], ['infra', /chain|bridge|privacy|\bai\b|governance|locker/i]];
  var FAMILY_NAMES = FAMILIES.map(function (f) { return f[0]; }).concat('other');
  var CHAIN_FEE_USD = {
    Ethereum: 2.5, Bitcoin: 1.5, Tron: 1, Arbitrum: 0.08, Base: 0.03, Optimism: 0.05, Polygon: 0.02, Binance: 0.08, Avalanche: 0.05,
    Solana: 0.01, 'Hyperliquid L1': 0.02, Monad: 0.02, Sui: 0.01, Linea: 0.05, Plasma: 0.01, Sonic: 0.01, Mantle: 0.03, Scroll: 0.05,
    Berachain: 0.02, xDai: 0.01, Celo: 0.01, Ripple: 0.01, Aptos: 0.01, Near: 0.01, Cardano: 0.2, Stellar: 0.01, Ton: 0.03, Starknet: 0.05
  };
  var DEFAULT_FEE_USD = 0.25;
  var PRODUCT_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

  var cmp = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var r4 = function (n) { return Math.round(n * 1e4) / 1e4; };
  var sig = function (z) { return 1 / (1 + Math.exp(-z)); };
  function median(v) {
    if (!v.length) return null;
    var a = v.slice().sort(function (x, y) { return x - y; }), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function quantile(v, q) {
    var a = v.slice().sort(function (x, y) { return x - y; }), i = (a.length - 1) * q, lo = Math.floor(i);
    return lo + 1 < a.length ? a[lo] + (i - lo) * (a[lo + 1] - a[lo]) : a[lo];
  }
  function rng(seed) { // mulberry32
    var t = seed >>> 0;
    return function () { t = (t + 0x6d2b79f5) >>> 0; var z = Math.imul(t ^ (t >>> 15), 1 | t); z ^= z + Math.imul(z ^ (z >>> 7), 61 | z); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function solve(A, b) { // Gaussian elimination with partial pivoting; A and b are copied
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); }), c, r, k;
    for (c = 0; c < n; c++) {
      var p = c;
      for (r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      for (r = c + 1; r < n; r++) { var f = M[r][c] / M[c][c]; if (f) for (k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    var x = new Array(n);
    for (c = n - 1; c >= 0; c--) { var s = M[c][n]; for (k = c + 1; k < n; k++) s -= M[c][k] * x[k]; x[c] = s / M[c][c]; }
    return x;
  }
  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  function gram(X, w, pen, idx) { // sum of w_i x_i x_i' over idx, plus the ridge penalty
    var d = pen.length, A = [];
    for (var j = 0; j < d; j++) { A.push(zeros(d)); A[j][j] = pen[j]; }
    idx.forEach(function (i) { var x = X[i], wi = w ? w[i] : 1; for (var j = 0; j < d; j++) if (x[j]) for (var k = 0; k < d; k++) A[j][k] += wi * x[j] * x[k]; });
    return A;
  }

  // -- the snapshot's own record
  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
    return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / 86400000)) : null;
  }
  function recordsToken(p) { return p.gecko_id !== null || p.symbol !== null; }
  function isTraded(p) { return recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0; }
  function familyOf(category) {
    for (var i = 0; i < FAMILIES.length; i++) if (FAMILIES[i][1].test(category || '')) return FAMILIES[i][0];
    return 'other';
  }
  // Every protocol lands in exactly one group, tested in this order.
  var GROUPS = [['traded', 'token trades: a price comparable'], ['token_no_cap', 'records a token, no market cap'],
    ['product', 'wrapped, staked, bridged or exchange product'], ['ranked', 'records no token: ranked'], ['cap_no_token', 'market cap but no token record']];
  function groupOf(p, brands) {
    if (isTraded(p)) return 'traded';
    if (recordsToken(p)) return 'token_no_cap';
    if (PRODUCT_CATEGORIES.indexOf(p.category) >= 0 || VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || brands[p.name.split(' ')[0]] === 1) return 'product';
    return p.mcap_usd === null ? 'ranked' : 'cap_no_token';
  }

  // -- features
  function features(s) {
    var ages = s.protocols.map(function (p) { return ageDays(s.as_of, p.listed_at); });
    var medAge = median(ages.filter(function (a) { return a !== null; })) || 365;
    return s.protocols.map(function (p, i) {
      var a = ages[i] === null ? medAge : ages[i];
      return { p: p, age: a, ageKnown: ages[i] !== null, fam: familyOf(p.category), cat: p.category || 'Uncategorised',
        num: { size: Math.log(Math.max(1, p.tvl_usd)), growth: clamp(p.change_7d === null ? 0 : p.change_7d, -50, 100) / 100,
          age: Math.log(1 + a / 365), chains: Math.log(Math.max(1, (p.chains || []).length)) } };
    });
  }
  function levels(F) {
    var cats = {}, lv = { cats: [], mu: {}, sd: {} };
    F.forEach(function (f) { cats[f.cat] = 1; });
    lv.cats = Object.keys(cats).sort(cmp);
    ['size', 'growth', 'age', 'chains'].forEach(function (k) {
      var v = F.map(function (f) { return f.num[k]; }), m = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
      lv.mu[k] = m; lv.sd[k] = Math.sqrt(v.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / v.length) || 1;
    });
    return lv;
  }
  // One row of the design matrix, with each column's term so a value can be split into its terms.
  function row(f, terms, lv, over) {
    var x = [1], owner = ['base'];
    terms.forEach(function (t) {
      if (t === 'family') FAMILY_NAMES.forEach(function (n) { x.push(f.fam === n ? 1 : 0); owner.push(t); });
      else if (t === 'category') lv.cats.forEach(function (c) { x.push(f.cat === c ? 1 : 0); owner.push(t); });
      else { x.push(((over && over[t] !== undefined ? over[t] : f.num[t]) - lv.mu[t]) / lv.sd[t]); owner.push(t); }
    });
    return { x: x, owner: owner };
  }
  function penalties(owner) { return owner.map(function (o) { return o === 'base' ? 0 : MODEL.ridge[o] || MODEL.ridge.num; }); }

  // -- launch value: ridge on log(mcap/TVL), intercept moved so the training residuals' median is 0
  function ridgeFit(X, y, pen, idx, A) {
    A = A || gram(X, null, pen, idx);
    var b = zeros(pen.length);
    idx.forEach(function (i) { for (var j = 0; j < b.length; j++) b[j] += X[i][j] * y[i]; });
    var beta = solve(A, b);
    beta[0] += median(idx.map(function (i) { return y[i] - dot(X[i], beta); }));
    return beta;
  }
  function walkOrder(F, idx) {
    return idx.filter(function (i) { return F[i].ageKnown; }).sort(function (a, b) { return cmp(F[a].p.listed_at, F[b].p.listed_at) || cmp(F[a].p.slug, F[b].p.slug); });
  }
  function folds(order) { // expanding window: train on everything listed earlier, test on the next block
    var n = order.length, s = Math.floor(n * MODEL.wf_start), out = [];
    for (var k = 0; k < MODEL.wf_folds; k++) {
      var a = s + Math.floor(k * (n - s) / MODEL.wf_folds), b = s + Math.floor((k + 1) * (n - s) / MODEL.wf_folds);
      out.push({ train: order.slice(0, a), test: order.slice(a, b) });
    }
    return out;
  }
  function valueErrors(F, idx, y, terms, lv) {
    var R = F.map(function (f) { return row(f, terms, lv).x; }), pen = penalties(row(F[idx[0]], terms, lv).owner);
    var full = gram(R, null, pen, idx), loo = {}, wf = [];
    idx.forEach(function (i) {
      var A = full.map(function (r, j) { return r.map(function (v, k) { return v - R[i][j] * R[i][k]; }); });
      var rest = idx.filter(function (k) { return k !== i; });
      loo[i] = terms.length ? dot(R[i], ridgeFit(R, y, pen, rest, A)) : median(rest.map(function (k) { return y[k]; }));
    });
    folds(walkOrder(F, idx)).forEach(function (fd) {
      var beta = terms.length ? ridgeFit(R, y, pen, fd.train) : null, m = median(fd.train.map(function (k) { return y[k]; }));
      fd.test.forEach(function (i) { wf.push(Math.abs(y[i] - (beta ? dot(R[i], beta) : m))); });
    });
    return { loo: median(idx.map(function (i) { return Math.abs(y[i] - loo[i]); })), wf: median(wf), pred: loo };
  }

  // -- token odds: logistic regression of "records a token" on the record's age (and family, size)
  function logitFit(X, y, pen, idx, iters) {
    var d = pen.length, beta = zeros(d), p0 = idx.reduce(function (a, i) { return a + y[i]; }, 0) / idx.length;
    beta[0] = Math.log(p0 / (1 - p0));
    for (var it = 0; it < iters; it++) {
      var w = {}, g = beta.map(function (b, j) { return -pen[j] * b; });
      idx.forEach(function (i) { var p = sig(dot(X[i], beta)); w[i] = p * (1 - p); for (var j = 0; j < d; j++) g[j] += (y[i] - p) * X[i][j]; });
      var step = solve(gram(X, w, pen, idx), g);
      beta = beta.map(function (b, j) { return b + step[j]; });
    }
    return beta;
  }
  function oddsErrors(F, idx, y, terms, lv) {
    var brier = function (pairs) { return pairs.reduce(function (a, q) { return a + (q[0] - q[1]) * (q[0] - q[1]); }, 0) / pairs.length; };
    var S = idx.reduce(function (a, i) { return a + y[i]; }, 0), loo = [], wf = [];
    if (!terms.length) {
      idx.forEach(function (i) { loo.push([y[i], (S - y[i]) / (idx.length - 1)]); });
      folds(walkOrder(F, idx)).forEach(function (fd) {
        var m = fd.train.reduce(function (a, i) { return a + y[i]; }, 0) / fd.train.length;
        fd.test.forEach(function (i) { wf.push([y[i], m]); });
      });
      return { loo: brier(loo), wf: brier(wf) };
    }
    var R = F.map(function (f) { return row(f, terms, lv).x; }), pen = penalties(row(F[idx[0]], terms, lv).owner);
    var beta = logitFit(R, y, pen, idx, 10), w = {};
    idx.forEach(function (i) { var p = sig(dot(R[i], beta)); w[i] = p * (1 - p); });
    var H = gram(R, w, pen, idx);
    idx.forEach(function (i) { // leave i out: one Newton step from the full fit, which is near exact
      var x = R[i], r = y[i] - sig(dot(x, beta));
      var A = H.map(function (hr, j) { return hr.map(function (v, k) { return v - w[i] * x[j] * x[k]; }); });
      var step = solve(A, x.map(function (v) { return -r * v; }));
      loo.push([y[i], sig(dot(x, beta.map(function (b, j) { return b + step[j]; })))]);
    });
    folds(walkOrder(F, idx)).forEach(function (fd) {
      var b = logitFit(R, y, pen, fd.train, 10);
      fd.test.forEach(function (i) { wf.push([y[i], sig(dot(R[i], b))]); });
    });
    return { loo: brier(loo), wf: brier(wf) };
  }
  // Add terms one at a time in a fixed order; keep one only if it lowers the error in BOTH held-out tests.
  function select(order, score) {
    var kept = [], cur = score([]), steps = [{ term: 'base', loo: cur.loo, wf: cur.wf, kept: true }];
    order.forEach(function (t) {
      var e = score(kept.concat(t)), ok = e.loo < cur.loo && e.wf < cur.wf;
      steps.push({ term: t, loo: e.loo, wf: e.wf, kept: ok });
      if (ok) { kept.push(t); cur = e; }
    });
    return { kept: kept, steps: steps, best: cur };
  }

  // -- the fit: everything that does not depend on the reader's plan, share or horizon
  function fitCore(s) {
    var F = features(s), brands = {};
    s.protocols.forEach(function (p) { if (p.category === 'CEX') brands[p.name.split(' ')[0]] = 1; });
    var groups = F.map(function (f) { return groupOf(f.p, brands); });
    var T = [], all = [];
    F.forEach(function (f, i) { all.push(i); if (groups[i] === 'traded') T.push(i); });
    var y = F.map(function (f) { return groups.length && isTraded(f.p) ? Math.log(f.p.mcap_usd / f.p.tvl_usd) : 0; });
    var lvT = levels(T.map(function (i) { return F[i]; }));
    var value = select(VALUE_TERMS, function (terms) { return valueErrors(F, T, y, terms, lvT); });
    var R = F.map(function (f) { return row(f, value.kept, lvT).x; }), own = row(F[T[0]], value.kept, lvT).owner, pen = penalties(own);
    var A = gram(R, null, pen, T), beta = ridgeFit(R, y, pen, T, A), fit = T.map(function (i) { return dot(R[i], beta); });
    var resid = T.map(function (i, k) { return y[i] - fit[k]; }), looRes = T.map(function (i) { return y[i] - value.best.pred[i]; });
    // Seeded residual bootstrap: refit on fitted + resampled residuals, then add a resampled held-out miss.
    var rand = rng(MODEL.seed), boots = [];
    for (var b = 0; b < MODEL.boot; b++) {
      var yb = y.slice();
      T.forEach(function (i, k) { yb[i] = fit[k] + resid[Math.floor(rand() * resid.length)]; });
      boots.push({ beta: ridgeFit(R, yb, pen, T, A), e: Math.floor(rand() * looRes.length) });
    }
    var inside = 0;
    T.forEach(function (i, k) { // coverage: does each held-out traded protocol land in its own P25-P75 band?
      var d = boots.map(function (bt) { var e = bt.e === k ? (bt.e + 1) % looRes.length : bt.e; return dot(R[i], bt.beta) - dot(R[i], beta) + looRes[e]; });
      var miss = y[i] - value.best.pred[i];
      if (miss >= quantile(d, 0.25) && miss <= quantile(d, 0.75)) inside++;
    });
    var O = all.filter(function (i) { return F[i].ageKnown; }), yo = F.map(function (f) { return recordsToken(f.p) ? 1 : 0; });
    var lvO = levels(O.map(function (i) { return F[i]; }));
    var odds = select(ODDS_TERMS, function (terms) { return oddsErrors(F, O, yo, terms, lvO); });
    var pO = penalties(row(F[O[0]], odds.kept, lvO).owner), RO = F.map(function (f) { return row(f, odds.kept, lvO).x; });
    var base = O.reduce(function (a, i) { return a + yo[i]; }, 0) / O.length;
    return { s: s, F: F, groups: groups, T: T, y: y, lvT: lvT, value: value, beta: beta, own: own, boots: boots, looRes: looRes,
      coverage: inside / T.length, lvO: lvO, odds: odds, oddsBeta: logitFit(RO, yo, pO, O, 12), base: base };
  }

  // -- per protocol
  function launchParts(core, f) { // the log multiple split into its terms
    var r = row(f, core.value.kept, core.lvT), parts = {};
    r.x.forEach(function (v, j) { parts[r.owner[j]] = (parts[r.owner[j]] || 0) + v * core.beta[j]; });
    return { x: r.x, parts: parts, log: dot(r.x, core.beta) };
  }
  // F(age): the fitted share of protocols like this one that record a token by that age.
  function shareAt(core, f, days) { return sig(dot(row(f, core.odds.kept, core.lvO, { age: Math.log(1 + days / 365) }).x, core.oddsBeta)); }
  // Odds of recording a token within the horizon, given none so far: (F(age + h) - F(age)) / (1 - F(age)).
  function tokenOdds(core, f, horizonDays) {
    if (core.odds.kept.indexOf('age') < 0) return clamp(core.base * horizonDays / 365, 0, 1);
    var now = shareAt(core, f, f.age), later = shareAt(core, f, f.age + horizonDays);
    return clamp((later - now) / (1 - now), 0, 1);
  }
  function feeFor(chain) { return CHAIN_FEE_USD[chain] !== undefined ? CHAIN_FEE_USD[chain] : DEFAULT_FEE_USD; }
  function usdText(n) {
    var a = Math.abs(n), sgn = n < 0 ? '-' : '';
    if (a >= 1e9) return sgn + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sgn + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return sgn + '$' + Math.round(a / 1e3) + 'K';
    if (a >= 100) return sgn + '$' + Math.round(a).toString().replace(/\B(?=(\d{3})+$)/g, ',');
    return sgn + '$' + a.toFixed(2);
  }
  var ACT = { vaults: 'Deposit $P into its largest stablecoin vault', lending: 'Supply $P of stablecoins, borrowing nothing',
    dex: 'Add $P to its deepest stablecoin pool', rwa: 'Finish onboarding (KYC if asked) and subscribe $P to its main fund',
    staking: 'Stake $P in its main pool', infra: 'Bridge $P in and use its main app', other: 'Put $P into its main product' };
  // Families whose deposit keeps earning its own yield: no capital cost by default; the rest pay opp_rate a year.
  var EARNING = ['vaults', 'lending', 'rwa'];
  var RISK = { vaults: 'curator or strategy loss', lending: 'bad debt in a market you supply', dex: 'impermanent loss and pool exploits',
    rwa: 'issuer and redemption delays', staking: 'slashing and unbonding delays', infra: 'bridge exploits', other: 'contract risk' };
  // The farm verdict and its day-by-day steps: every step carries its day, fee and time.
  // A "Farm from" row is planned at its break-even deposit; Farm and Skip rows at the reader's plan.
  function farmPlan(f, launch, odds, o) {
    var p = f.p, chain = (p.chains && p.chains[0]) || 'Ethereum', fee = feeFor(chain), months = Math.max(1, Math.round(o.horizon / 30));
    var tx = 8 + months, hours = (70 + 5 * months) / 60, fees = tx * fee; // the six steps below: 2+2+0+months+2+2 tx
    var rate = o.opp === 'family' ? (EARNING.indexOf(f.fam) >= 0 ? 0 : MODEL.opp_rate) : +o.opp, c = rate * o.horizon / 365;
    var k = launch * odds * o.share / Math.max(1, p.tvl_usd), at = function (d) { var net = d * (k - c) - fees; return { deposit: d, reward: d * k, opp: d * c, net: net, per_hour: net / hours }; };
    // Break-even deposit: reward and capital cost scale with it, fees and time do not. Smallest D (in $100 steps)
    // with D x (reward per $ - cost per $) >= fees + perHour x hours, so net > 0 and net/hour >= the bar.
    var be = k > c ? Math.max(100, Math.ceil((fees + o.perHour * hours) / (k - c) / 100) * 100) : Infinity;
    if (be > MODEL.max_deposit) be = null;
    var verdict = be !== null && be <= o.plan ? 'Farm' : be !== null ? 'Farm from' : 'Skip';
    var plan = at(o.plan), use = verdict === 'Farm from' ? at(be) : plan, P = '$' + use.deposit.toLocaleString('en-US');
    var S = [
      [0, 2, 20, 'Fund a fresh wallet on ' + chain + ' with ' + P + ' of USDC plus gas', 'phishing clones; use the link on its DefiLlama page'],
      [0, 2, 15, ACT[f.fam].replace('$P', P) + ' (approve, then deposit)', RISK[f.fam]],
      [1, 0, 10, 'Save the position and any points page; ' + p.name + ' records no token on DefiLlama, so points may still be counting', 'a points program may never convert'],
      [30, months, 5 * months,'Every 30 days, ' + months + ' times: check points and TVL, claim or compound once; exit if TVL falls 25% in a week', 'outflows often precede a pause or an exploit'],
      [o.horizon, 2, 10, 'Withdraw ' + P + ' at the end of the ' + o.horizon + '-day horizon unless a token is announced', 'withdrawal queues'],
      [o.horizon, 2, 15, 'If a token launches, claim only from its official site; expected reward ' + usdText(0) + 'X', 'fake claim sites and drainer approvals']
    ];
    var atPlan = 'at a ' + usdText(o.plan) + ' plan: net ' + usdText(plan.net) + ', ' + usdText(plan.per_hour) + '/h';
    S[0][3] += verdict === 'Farm from' ? ' (the break-even deposit for $' + o.perHour + '/h; ' + atPlan + ')' : verdict === 'Farm' ? ' (break-even from $' + be.toLocaleString('en-US') + ')' :
      ' (no deposit up to ' + usdText(MODEL.max_deposit) + ' reaches $' + o.perHour + '/h: points only; ' + atPlan + ')';
    S[5][3] = S[5][3].replace(usdText(0) + 'X', usdText(use.reward) + ' (' + (odds * 100).toFixed(1) + '% odds x ' + o.share * 100 + '% share x ' + P + ' of ' + usdText(p.tvl_usd) + ' TVL)');
    var steps = S.map(function (st) { return { day: st[0], tx: st[1], fee: st[1] * fee, minutes: st[2], action: st[3], risk: st[4] }; });
    return { chain: chain, fee: fee, tx: tx, fees: fees, rate: rate, deposit: use.deposit, opp: use.opp, breakeven: be, reward: use.reward, net: use.net, hours: hours,
      per_hour: use.per_hour, at_plan: { net: plan.net, per_hour: plan.per_hour }, verdict: verdict, steps: steps };
  }
  function stepText(st) {
    return 'Day ' + st.day + ': ' + st.action + '. Cost ' + (st.fee ? '~' + usdText(st.fee) + ' (' + st.tx + ' tx)' : '$0') + ', time ' + st.minutes + ' min. Risk: ' + st.risk + '.';
  }
  function comparables(core, f) {
    var near = function (a, b) { return Math.abs(core.F[a].num.size - f.num.size) - Math.abs(core.F[b].num.size - f.num.size) || cmp(core.F[a].p.slug, core.F[b].p.slug); };
    var same = core.T.filter(function (i) { return core.F[i].cat === f.cat; }).sort(near).slice(0, 4);
    var fam = core.T.filter(function (i) { return core.F[i].fam === f.fam && same.indexOf(i) < 0; }).sort(near);
    return same.concat(fam.slice(0, 4 - same.length)).map(function (i) { return core.F[i].p.slug; });
  }

  // -- the board: every protocol that records no token and is not a product, ranked by implied value
  function buildBoard(s, opts, core) {
    core = core || fitCore(s);
    var o = { plan: MODEL.plan_usd, share: MODEL.share, horizon: MODEL.horizon_days, opp: 'family', perHour: MODEL.farm_per_hour };
    for (var k in opts || {}) o[k] = opts[k];
    var wl = {}, rows = [];
    s.watchlist.forEach(function (w) { wl[w] = 1; });
    core.F.forEach(function (f, i) {
      if (core.groups[i] !== 'ranked' && !wl[f.p.slug]) return;
      var L = launchParts(core, f), launch = f.p.tvl_usd * Math.exp(L.log), odds = tokenOdds(core, f, o.horizon);
      var d = core.boots.map(function (bt) { return dot(L.x, bt.beta) + core.looRes[bt.e]; });
      var plan = farmPlan(f, launch, odds, o), p = f.p;
      rows.push({ slug: p.slug, name: p.name, category: p.category, family: f.fam, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d,
        listed_at: p.listed_at, age_days: f.ageKnown ? f.age : null, tier: wl[p.slug] ? 'watchlist' : 'early',
        multiple: r4(Math.exp(L.log)), terms: Object.keys(L.parts).map(function (t) { return [t, r4(Math.exp(L.parts[t]))]; }),
        launch_value_usd: Math.round(launch), odds: r4(odds), implied_value_usd: Math.max(1, Math.round(launch * odds)),
        p25_usd: Math.max(1, Math.round(p.tvl_usd * Math.exp(quantile(d, 0.25)) * odds)), p75_usd: Math.max(1, Math.round(p.tvl_usd * Math.exp(quantile(d, 0.75)) * odds)),
        comparables: comparables(core, f), plan: plan, farm_steps: plan.steps.map(stepText) });
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || cmp(a.slug, b.slug); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    var count = {};
    core.groups.forEach(function (g) { count[g] = (count[g] || 0) + 1; });
    return { rows: rows, core: core, opts: o, groups: GROUPS.map(function (g) { return { id: g[0], label: g[1], n: count[g[0]] || 0 }; }) };
  }
  // The evidence the page shows: held-out tables and fitted vs actual.
  function evidence(core) {
    var mult = function (e) { return r4(Math.exp(e)); };
    return {
      value: core.value.steps.map(function (st) { return { term: st.term, loo_x: mult(st.loo), wf_x: mult(st.wf), kept: st.kept }; }),
      odds: core.odds.steps.map(function (st) { return { term: st.term, loo: r4(st.loo), wf: r4(st.wf), kept: st.kept }; }),
      coverage: r4(core.coverage), traded_n: core.T.length, odds_n: core.F.filter(function (f) { return f.ageKnown; }).length, base_rate: r4(core.base),
      scatter: core.T.map(function (i) { return [core.F[i].p.slug, r4(core.y[i]), r4(core.value.best.pred[i])]; })
    };
  }
  return { MODEL: MODEL, VALUE_TERMS: VALUE_TERMS, ODDS_TERMS: ODDS_TERMS, TERM_LABEL: TERM_LABEL, FAMILY_NAMES: FAMILY_NAMES, EARNING: EARNING, CHAIN_FEE_USD: CHAIN_FEE_USD,
    median: median, ageDays: ageDays, familyOf: familyOf, fitCore: fitCore, launchParts: launchParts, shareAt: shareAt, tokenOdds: tokenOdds, farmPlan: farmPlan,
    stepText: stepText, buildBoard: buildBoard, evidence: evidence, usdText: usdText };
});
