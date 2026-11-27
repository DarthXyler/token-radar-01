// model.js: the value model and the farm plans, the one source of truth.
// main.ts loads this file (createRequire) to write board.json; the page loads it as a classic script and
// recomputes every implied value, rank and farm plan from data.js, the snapshot's raw fields alone.
//
//   implied value = TVL x peerRatio x growthFactor x ageFactor x reachFactor        (whole dollars)
//   peerRatio     = category median of traded mcap/TVL (clipped p10-p90), log-blended to the overall at n/(n+8)
//   growthFactor  = 1 + 0.5 x clamp(change_7d, -40%, +60%)
//   ageFactor     = 0.85 + 0.35 x min(days tracked with no token, 3 years) / 3 years
//   reachFactor   = min(1.35, 1 + 0.1 x log2(chains))
// No protocol is named in this file: every row goes through the same functions.
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RadarModel = make();
})(this, function () {
  'use strict';
  var MODEL = {
    version: 'peer-3', prior_n: 8, clip_lo: 0.1, clip_hi: 0.9, thin_n: 3, ratio_floor: 0.02, ratio_cap: 1,
    growth_weight: 0.5, growth_floor: -40, growth_cap: 60,
    age_floor: 0.85, age_range: 0.35, age_days: 1095,
    reach_weight: 0.1, reach_cap: 1.35, community_share: 0.1, fee_budget: 0.02
  };
  // Assumed cost of one ordinary transaction (approve, deposit, claim) per chain, in USD.
  var CHAIN_FEE_USD = {
    Ethereum: 2.5, Bitcoin: 1.5, Tron: 1, Arbitrum: 0.08, Base: 0.03, Optimism: 0.05, Polygon: 0.02,
    Binance: 0.08, Avalanche: 0.05, Solana: 0.01, 'Hyperliquid L1': 0.02, Monad: 0.02, Sui: 0.01, Linea: 0.05,
    Plasma: 0.01, Sonic: 0.01, Mantle: 0.03, Scroll: 0.05, Berachain: 0.02, xDai: 0.01, Celo: 0.01, Fantom: 0.02,
    Ripple: 0.01, Aptos: 0.01, Near: 0.01, Cardano: 0.2, Stellar: 0.01, Algorand: 0.01, Ton: 0.03, Starknet: 0.05
  };
  var DEFAULT_FEE_USD = 0.25;
  // The snapshot's own watchlist rule: product categories, version markers, wrapped/staked words, and names
  // that start with an exchange brand (the first word of a protocol in the snapshot's CEX category).
  var PRODUCT_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

  var r4 = function (n) { return Math.round(n * 1e4) / 1e4; };
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var cmp = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

  function median(values) {
    if (!values.length) return null;
    var a = values.slice().sort(function (x, y) { return x - y; }), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
    return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / 86400000)) : null;
  }
  // Its token trades: DefiLlama records a token and a positive market cap.
  function isTraded(p) { return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && (p.gecko_id !== null || p.symbol !== null); }
  // Records no token: no CoinGecko id and no symbol. A record, not proof.
  function recordsNoToken(p) { return p.gecko_id === null && p.symbol === null; }
  function exchangeBrands(protocols) {
    var b = {};
    protocols.forEach(function (p) { if (p.category === 'CEX') b[p.name.split(' ')[0]] = 1; });
    return b;
  }
  function isProduct(p, brands) {
    return PRODUCT_CATEGORIES.indexOf(p.category) >= 0 || VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || brands[p.name.split(' ')[0]] === 1;
  }
  function isPreToken(p, brands) { return recordsNoToken(p) && p.mcap_usd === null && !isProduct(p, brands); }

  // -- the value factors
  function blend(n, med, overall) {
    var w = med === null ? 0 : n / (n + MODEL.prior_n);
    var lr = w * Math.log(med === null ? overall : med) + (1 - w) * Math.log(overall);
    return { n: n, median: med, weight: r4(w), ratio: r4(clamp(Math.exp(lr), MODEL.ratio_floor, MODEL.ratio_cap)) };
  }
  function quantile(sorted, q) {
    var i = (sorted.length - 1) * q, lo = Math.floor(i);
    return lo + 1 < sorted.length ? sorted[lo] + (i - lo) * (sorted[lo + 1] - sorted[lo]) : sorted[lo];
  }
  // Every category's mcap/TVL from its traded peers: each ratio clipped to the 10th-90th percentile of all traded
  // ratios, then the category median shrunk toward the overall median at weight n/(n+8).
  function peerTable(protocols) {
    var traded = protocols.filter(isTraded), groups = {};
    var all = traded.map(function (p) { return p.mcap_usd / p.tvl_usd; }).sort(function (x, y) { return x - y; });
    var overall = median(all) || 0.2, lo = all.length ? quantile(all, MODEL.clip_lo) : 0, hi = all.length ? quantile(all, MODEL.clip_hi) : 1;
    traded.forEach(function (p) { var c = p.category || 'Uncategorised'; (groups[c] = groups[c] || []).push(clamp(p.mcap_usd / p.tvl_usd, lo, hi)); });
    var cats = {};
    Object.keys(groups).sort(cmp).forEach(function (c) { cats[c] = blend(groups[c].length, median(groups[c]), overall); });
    return { overall: overall, traded_n: traded.length, clip: [r4(lo), r4(hi)], cats: cats };
  }
  function peerRatio(table, category) { return table.cats[category || 'Uncategorised'] || blend(0, null, table.overall); }
  function isThin(n) { return n < MODEL.thin_n; }
  function growthFactor(change7d) {
    var g = clamp(change7d === null ? 0 : change7d, MODEL.growth_floor, MODEL.growth_cap);
    return { pct: r4(g), x: r4(1 + (MODEL.growth_weight * g) / 100) };
  }
  function ageFactor(days) { return r4(MODEL.age_floor + (MODEL.age_range * Math.min(days, MODEL.age_days)) / MODEL.age_days); }
  function reachFactor(chains) { return r4(Math.min(MODEL.reach_cap, 1 + MODEL.reach_weight * Math.log2(Math.max(1, chains)))); }
  function factorsFor(p, asOf, table, fallbackAge) {
    var peer = peerRatio(table, p.category), g = growthFactor(p.change_7d), age = ageDays(asOf, p.listed_at);
    var used = age === null ? fallbackAge : age, chains = Math.max(1, p.chains.length);
    return { peer_ratio: peer.ratio, peer_n: peer.n, growth_pct: g.pct, growth: g.x, age_days: age, age_used_days: used, age: ageFactor(used), chains: chains, reach: reachFactor(chains) };
  }
  function impliedValue(tvl, f) { return Math.max(1, Math.round(tvl * f.peer_ratio * f.growth * f.age * f.reach)); }
  // The dollars $1,000 deposited would earn if COMMUNITY_SHARE of a token worth the implied value went to TVL pro rata.
  function rewardPer1k(implied, tvl) { return Math.round(((MODEL.community_share * implied) / tvl) * 1000 * 100) / 100; }

  // -- farm plans
  // $1,234 or $0.05, locale-free, so every machine writes the same bytes.
  function usdText(n) {
    var cents = Math.round(n * 100), frac = cents % 100;
    return '$' + Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + String(frac).padStart(2, '0') : '');
  }
  function feeFor(chain) { return CHAIN_FEE_USD[chain] !== undefined ? CHAIN_FEE_USD[chain] : DEFAULT_FEE_USD; }
  // Per family: the core deposit, a second action with its own new capital (extra x the deposit, or a fixed
  // dollar budget), its risks, and how many transactions a week the second action takes.
  var T = {
    lending: { core: function (n, c, k) { return 'Supply ' + usdText(k) + ' of USDC to ' + n + "'s largest stablecoin market on " + c + ' and turn on collateral.'; },
      coreRisk: 'bad debt or an oracle fault in one market; keep to the deepest market',
      second: function (n, c, k) { return 'Borrow ' + usdText(k * 0.3) + ' of a stablecoin against it (30% loan-to-value) and resupply it once, so ' + n + ' records both sides.'; },
      secondRisk: 'liquidation if collateral falls; keep the health factor above 2', extra: 0, tx: 1 },
    dex: { core: function (n, c, k) { return 'Add ' + usdText(k) + ' to a stable-to-stable pool on ' + n + ' (' + c + ') with a wide range so it stays in range.'; },
      coreRisk: 'impermanent loss if a stablecoin depegs; avoid volatile pairs at this size',
      second: function (n) { return 'Swap $50 through ' + n + ' across three different pairs each week, to log trading volume.'; },
      secondRisk: 'slippage on thin pairs; cap slippage at 0.5%', budget: 50, tx: 3 },
    vault: { core: function (n, c, k) { return 'Deposit ' + usdText(k) + ' of USDC into the largest ' + n + ' vault on ' + c + ' and keep the vault shares in the same wallet.'; },
      coreRisk: "the curator's strategy and its underlying markets; read the vault's allocation first",
      second: function (n, c, k) { return 'Put a second ' + usdText(k * 0.3) + ' into another ' + n + ' vault on a different chain or asset, so the wallet shows breadth.'; },
      secondRisk: 'withdrawal queues can delay exits by days', extra: 0.3, tx: 0.5 },
    rwa: { core: function (n, c, k) { return 'Pass ' + n + "'s onboarding (KYC where it asks) and subscribe " + usdText(k) + ' to its tokenised yield product on ' + c + '.'; },
      coreRisk: 'issuer and custody risk; redemptions can take 1 to 5 business days',
      second: function (n) { return 'Hold the ' + n + ' yield token through two monthly distributions, or post it as collateral where a money market lists it.'; },
      secondRisk: 'thin secondary liquidity; do not loop it', extra: 0, tx: 0.25 },
    staking: { core: function (n, c, k) { return 'Stake ' + usdText(k) + ' of the native asset through ' + n + ' on ' + c + ' and keep the receipt token unmoved.'; },
      coreRisk: 'slashing and price exposure to the staked asset',
      second: function (n, c, k) { return 'Delegate a second ' + usdText(k * 0.3) + ' to another of ' + n + "'s networks or operators, to show active use."; },
      secondRisk: 'unbonding periods of 7 to 21 days lock the exit', extra: 0.3, tx: 0.5 },
    chain: { core: function (n, c, k) { return 'Move ' + usdText(k) + ' onto ' + n + ' through its official bridge or gateway (' + c + ') and keep a balance there.'; },
      coreRisk: 'bridge risk; use only the gateway the project itself links',
      second: function (n) { return 'Make 5 transactions a week on ' + n + "'s own apps (a swap, a transfer, a deposit) instead of one large one."; },
      secondRisk: 'sybil filters favour real, spaced activity over scripted bursts', extra: 0, tx: 5 },
    derivatives: { core: function (n, c, k) { return 'Deposit ' + usdText(k) + ' of USDC as margin on ' + n + ' (' + c + ') and trade small, hedged positions at 2x or less.'; },
      coreRisk: 'liquidation and funding costs; never run unhedged leverage for points',
      second: function (n) { return 'Place 1 maker order a day on ' + n + '; maker volume usually counts more than taker volume and costs less.'; },
      secondRisk: 'fees on churned volume can exceed any reward', extra: 0, tx: 7 },
    stable: { core: function (n, c, k) { return 'Mint ' + n + "'s stablecoin on " + c + ' against ' + usdText(k) + ' of collateral at under 40% loan-to-value, or buy it and deposit it in its savings module.'; },
      coreRisk: 'depeg risk; watch the peg and the collateral ratio weekly',
      second: function (n, c, k) { return 'Provide the ' + usdText(k * 0.3) + ' of ' + n + ' stablecoin you minted to its main pool or savings vault, so the position earns while it qualifies.'; },
      secondRisk: 'pool imbalance during a depeg', extra: 0, tx: 0.5 },
    cover: { core: function (n, c, k) { return 'Underwrite ' + usdText(k) + ' in one of ' + n + "'s cover or backstop pools on " + c + '.'; },
      coreRisk: 'a covered exploit pays out from your stake',
      second: function (n) { return 'Buy a $25 cover policy from ' + n + ' for one of your own positions, so the wallet uses both sides.'; },
      secondRisk: 'premium is a sunk cost', budget: 25, tx: 0.25 },
    general: { core: function (n, c, k) { return 'Deposit ' + usdText(k) + ' into ' + n + "'s main product on " + c + ' and keep it there for the whole window.'; },
      coreRisk: 'smart-contract risk of a young protocol',
      second: function (n) { return 'Use a second ' + n + ' feature (a vault, a swap or a governance vote) once a week, so the wallet shows repeat use.'; },
      secondRisk: 'each extra contract approval widens exposure; revoke unused ones', extra: 0, tx: 1 }
  };
  // Which template a category gets: keyword families, never protocol names.
  function familyOf(category) {
    var c = (category || '').toLowerCase();
    if (/options vault/.test(c)) return 'vault';
    if (/lend|credit|collateral manage/.test(c)) return 'lending';
    if (/dex|liquidity|farm|amm/.test(c)) return 'dex';
    if (/rwa|real world|treasur/.test(c)) return 'rwa';
    if (/stak|restak|btc|validator|collateral market/.test(c)) return 'staking';
    if (/^chain$|payment|bridge|card/.test(c)) return 'chain';
    if (/deriv|perp|option(?! vault)|prediction|interest rate/.test(c)) return 'derivatives';
    if (/cdp|stablecoin(?! wrapper)/.test(c)) return 'stable';
    if (/insur|cover/.test(c)) return 'cover';
    if (/curat|allocat|yield|vault|index|basis|cedefi|wrapper|incentive/.test(c)) return 'vault';
    return 'general';
  }
  // Younger protocols run longer qualifying seasons.
  function holdWindow(age) {
    if (age < 180) return { text: 'hold 60–90 days', days: 90 };
    if (age < 540) return { text: 'hold 45–60 days', days: 60 };
    return { text: 'hold 30–45 days', days: 45 };
  }
  // How many snapshot protocols count TVL on each chain: a protocol's main chain is its most-used one.
  function chainUse(protocols) {
    var use = {};
    protocols.forEach(function (p) { p.chains.forEach(function (c) { use[c] = (use[c] || 0) + 1; }); });
    return use;
  }
  var CAP_STEPS = [100, 250, 500, 1000, 2500, 5000];

  // Six steps, each with capital, fee, chain, time and risk; capital sized so all fees stay under FEE_BUDGET.
  function farmPlan(p, f, reward1k, use) {
    var family = familyOf(p.category), t = T[family], u = function (c) { return use[c] || 0; };
    var chain = p.chains.slice().sort(function (a, b) { return u(b) - u(a) || cmp(a, b); })[0] || 'Ethereum';
    var cheaper = p.chains.slice().sort(function (a, b) { return feeFor(a) - feeFor(b) || u(b) - u(a) || cmp(a, b); })[0];
    var alt = cheaper !== undefined && feeFor(cheaper) < feeFor(chain) / 4 ? cheaper : null;
    var fee = feeFor(chain), hold = holdWindow(f.age_used_days), weeks = Math.ceil(hold.days / 7);
    var weeklyTx = Math.max(1, Math.round(t.tx * weeks));
    var txs = 2 + 2 + weeklyTx + 3;
    var need = Math.max(family === 'rwa' ? 500 : 100, (txs * fee) / MODEL.fee_budget);
    var k = CAP_STEPS.filter(function (c) { return c >= need; })[0] || 5000;
    var extra = t.budget !== undefined ? t.budget : Math.round(k * t.extra);
    var n = p.name, reward = r2((reward1k * k) / 1000);
    var steps = [
      { action: 'Open a fresh wallet for ' + n + ' only and fund it on ' + chain + ' with ' + usdText(k + extra) + ' of USDC plus gas. One protocol per wallet keeps eligibility clean.' + (alt === null ? '' : ' It also runs on ' + alt + ' at ~' + usdText(feeFor(alt)) + ' a transaction: farm there if its main product is listed.'),
        capital_usd: k + extra, fee_usd: r2(fee * 2), chain: chain, time: '20–30 minutes', risk: 'phishing clones; reach the app only from the link on its DefiLlama page' },
      { action: t.core(n, chain, k), capital_usd: k, fee_usd: r2(fee * 2), chain: chain, time: '15 minutes, then ' + hold.text, risk: t.coreRisk },
      { action: t.second(n, chain, k), capital_usd: extra, fee_usd: r2(weeklyTx * fee), chain: chain, time: '10 minutes a week × ' + weeks + ' weeks (' + weeklyTx + ' transactions)', risk: t.secondRisk },
      { action: 'Keep the main position open through the window (' + hold.text + '): ' + n + ' is ' + (f.age_days === null ? 'tracked with no listing date' : Math.round(f.age_used_days / 30.44) + ' months on DefiLlama') + ' and records no token, so points or snapshots may still be running.',
        capital_usd: k, fee_usd: 0, chain: chain, time: hold.text, risk: 'opportunity cost; a token may never launch' },
      { action: 'Every week, check ' + n + "'s points or rewards page and its TVL; if TVL falls more than 25% in 7 days (it moved " + (f.growth_pct >= 0 ? '+' : '') + f.growth_pct.toFixed(1) + '% this week), withdraw and reassess.',
        capital_usd: 0, fee_usd: 0, chain: chain, time: '5 minutes a week × ' + weeks + ' weeks', risk: 'an outflow run often precedes a pause or an exploit' },
      { action: 'If ' + n + ' announces a token, claim only from its official site, never via DMs or ads, then withdraw or hold. At ' + usdText(k) + ' the model expects about ' + usdText(reward) + ' (' + usdText(reward1k) + ' per $1,000).',
        capital_usd: 0, fee_usd: r2(fee * 3), chain: chain, time: '15 minutes at the claim', risk: 'fake claim sites and approvals that drain the wallet' }
    ];
    var fees = r2(steps.reduce(function (s, x) { return s + x.fee_usd; }, 0));
    return { family: family, chain: chain, fee_usd: fee, min_capital_usd: k, total_capital_usd: k + extra, total_fees_usd: fees, hold_days: hold.days, weeks: weeks, est_reward_usd: reward, steps: steps };
  }
  // One step as the gate's string: action, capital, fee, time and risk, 20 to 600 characters.
  function stepText(s) {
    var text = s.action + ' Capital: ' + usdText(s.capital_usd) + '. Est. fee: ~' + usdText(s.fee_usd) + ' on ' + s.chain + '. Time: ' + s.time + '. Risk: ' + s.risk + '.';
    return text.length > 600 ? text.slice(0, 597) + '...' : text;
  }

  // -- the board
  // Four traded peers nearest in TVL from its own category, topped up from any category when it has fewer.
  function comparables(p, traded) {
    var near = function (a, b) { return Math.abs(Math.log(a.tvl_usd / p.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / p.tvl_usd)) || cmp(a.slug, b.slug); };
    var same = traded.filter(function (t) { return t.category === p.category; }).sort(near).slice(0, 4);
    var fill = traded.filter(function (t) { return same.indexOf(t) < 0; }).sort(near).slice(0, 4 - same.length);
    return same.concat(fill).map(function (t) { return t.slug; });
  }
  // Every watchlist protocol plus every pre-token protocol in the snapshot, ranked by implied value.
  function buildBoard(s) {
    var P = s.protocols, brands = exchangeBrands(P), table = peerTable(P), use = chainUse(P);
    var traded = P.filter(isTraded), watch = {};
    s.watchlist.forEach(function (w) { watch[w] = 1; });
    var chosen = P.filter(function (p) { return watch[p.slug] || isPreToken(p, brands); });
    var fallbackAge = Math.round(median(chosen.map(function (p) { return ageDays(s.as_of, p.listed_at); }).filter(function (a) { return a !== null; })) || 365);
    var scored = chosen.map(function (p) { var f = factorsFor(p, s.as_of, table, fallbackAge); return { p: p, f: f, v: impliedValue(p.tvl_usd, f) }; });
    scored.sort(function (a, b) { return b.v - a.v || cmp(a.p.slug, b.p.slug); });
    var rows = scored.map(function (x, i) {
      var p = x.p, r1k = rewardPer1k(x.v, p.tvl_usd), plan = farmPlan(p, x.f, r1k, use);
      return { rank: i + 1, slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at,
        token_status: 'records-no-token', tier: watch[p.slug] ? 'watchlist' : 'early', implied_value_usd: x.v, reward_per_1k_usd: r1k, factors: x.f,
        comparables: comparables(p, traded), plan: plan, farm_steps: plan.steps.map(stepText) };
    });
    return {
      rows: rows, table: table, fallbackAge: fallbackAge, traded: traded,
      token_no_cap: P.filter(function (p) { return !recordsNoToken(p) && !isTraded(p); }).length,
      products_excluded: P.filter(function (p) { return recordsNoToken(p) && isProduct(p, brands) && !watch[p.slug]; }).length
    };
  }

  return { MODEL: MODEL, CHAIN_FEE_USD: CHAIN_FEE_USD, DEFAULT_FEE_USD: DEFAULT_FEE_USD, median: median, ageDays: ageDays, isTraded: isTraded, recordsNoToken: recordsNoToken,
    peerTable: peerTable, peerRatio: peerRatio, isThin: isThin, growthFactor: growthFactor, ageFactor: ageFactor, reachFactor: reachFactor, impliedValue: impliedValue,
    rewardPer1k: rewardPer1k, familyOf: familyOf, farmPlan: farmPlan, stepText: stepText, buildBoard: buildBoard, usdText: usdText };
});
