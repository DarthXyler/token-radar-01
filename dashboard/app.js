// Token Launch Radar: the page. data.js carries only the snapshot's raw fields; model.js (RadarModel, the
// same file main.ts runs to write board.json) computes every implied value, rank and farm plan here, and
// the header checks each one against the [slug, value] pairs main.ts copied from board.json.
(function () {
  'use strict';
  var D = window.RADAR, RM = window.RadarModel;
  if (!D || !RM) { document.body.textContent = 'data.js or model.js is missing: run main.ts first.'; return; }
  var M = RM.MODEL;
  var $ = function (id) { return document.getElementById(id); };

  // -- formatting
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function usd(n) {
    if (n === null || n === undefined) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
    return '$' + (a < 10 && n % 1 ? n.toFixed(2) : Math.round(n));
  }
  function pct(n) { return n === null || n === undefined ? '<span class="muted">n/a</span>' : '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + (n >= 0 ? '+' : '') + n.toFixed(1) + '%</span>'; }
  function months(days) { return days === null || days === undefined ? 'n/a' : (days / 30.44).toFixed(days < 304 ? 1 : 0) + ' mo'; }
  var f3 = function (n) { return n.toFixed(3); };
  var THIN = 'thin, mostly overall median';
  function nTag(n) { return '<span class="' + (RM.isThin(n) ? 'thin' : 'muted') + '" title="' + (RM.isThin(n) ? THIN : n + ' traded peers') + '">n=' + n + (RM.isThin(n) ? ' thin' : '') + '</span>'; }

  // -- the model, run in the page
  var B = RM.buildBoard(D);
  var PEERS = B.table, peer = function (c) { return RM.peerRatio(PEERS, c); };
  var ROWS = B.rows.map(function (r) {
    return { k: r.rank, s: r.slug, n: r.name, c: r.category, ch: r.chains, t: r.tvl_usd, g: r.change_7d, l: r.listed_at, w: r.tier === 'watchlist',
      v: r.implied_value_usd, r1k: r.reward_per_1k_usd, f: r.factors, cmp: r.comparables, plan: r.plan, steps: r.plan.steps,
      main: r.plan.chain, age: r.factors.age_days, ratio: r.factors.peer_ratio, cap: r.plan.min_capital_usd };
  });
  var BOARD = {};
  D.board.forEach(function (p, i) { BOARD[p[0]] = { v: p[1], k: i + 1 }; });
  var matches = function (r) { var b = BOARD[r.s]; return !!b && b.v === r.v && b.k === r.k; };
  var VERIFIED = D.board.length === ROWS.length ? ROWS.filter(matches).length : 0;
  var TRADED = {}, TLIST = B.traded.map(function (p) {
    return (TRADED[p.slug] = { s: p.slug, n: p.name, c: p.category, t: p.tvl_usd, m: p.mcap_usd, y: p.symbol, g: p.change_7d, ratio: p.mcap_usd / p.tvl_usd, k: 0 });
  });
  var WL = ROWS.filter(function (r) { return r.w; }).length;
  var TOTAL = ROWS.reduce(function (s, r) { return s + r.v; }, 0);
  var catCount = function () {
    var m = {};
    ROWS.forEach(function (r) { var c = r.c || 'Uncategorised'; m[c] = (m[c] || 0) + 1; });
    return m;
  };

  // -- state, in the URL hash
  var BANDS = [
    ['all', 'Any TVL', 0, Infinity], ['lt10', 'Under $10M', 0, 1e7], ['10-50', '$10M – $50M', 1e7, 5e7],
    ['50-250', '$50M – $250M', 5e7, 2.5e8], ['250-1b', '$250M – $1B', 2.5e8, 1e9], ['gt1b', 'Over $1B', 1e9, Infinity]
  ];
  var S = { tab: 'radar', q: '', cat: 'all', chain: 'all', band: 'all', wl: false, sort: 'k', dir: 1, p: null, tsort: 'm', tdir: -1 };
  function readHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    ['tab', 'q', 'cat', 'chain', 'band', 'sort', 'p', 'tsort'].forEach(function (k) { if (h.has(k)) S[k] = h.get(k); });
    if (h.has('dir')) S.dir = +h.get('dir');
    if (h.has('tdir')) S.tdir = +h.get('tdir');
    S.wl = h.get('wl') === '1';
  }
  function writeHash() {
    var h = new URLSearchParams();
    if (S.tab !== 'radar') h.set('tab', S.tab);
    if (S.q) h.set('q', S.q);
    ['cat', 'chain', 'band'].forEach(function (k) { if (S[k] !== 'all') h.set(k, S[k]); });
    if (S.wl) h.set('wl', '1');
    if (S.sort !== 'k' || S.dir !== 1) { h.set('sort', S.sort); h.set('dir', S.dir); }
    if (S.p) h.set('p', S.p);
    history.replaceState(null, '', '#' + h.toString());
  }

  // -- masthead
  function renderStats() {
    var stat = function (label, value, small, cls) { return '<div class="' + (cls || '') + '"><dt>' + label + '</dt><dd>' + value + (small ? '<small>' + small + '</small>' : '') + '</dd></div>'; };
    $('stats').innerHTML =
      stat('Scanned', D.protocols.length, 'protocols') +
      stat('On the radar', ROWS.length, 'no token') +
      stat('Watchlist', WL + '/' + D.watchlist.length, 'covered', WL === D.watchlist.length ? 'ok' : '') +
      stat('Traded peers', TLIST.length, 'priced') +
      stat('Implied total', usd(TOTAL)) +
      stat('Recomputed', VERIFIED + '/' + ROWS.length, 'match', VERIFIED === ROWS.length ? 'ok' : 'bad');
    $('sub').textContent = 'DefiLlama snapshot of ' + D.as_of + ': ' + ROWS.length + ' protocols that record no token, ranked by a value implied from ' + TLIST.length + ' traded peers.';
    $('foot').innerHTML = 'DefiLlama snapshot of ' + esc(D.as_of) + '. Every number on this page is computed in the browser by model.js (model ' + esc(M.version) + ') from the snapshot\'s raw fields. Implied values are this radar\'s own estimate, not a forecast that any token will launch. A protocol here records no token on DefiLlama; that is not proof it has none.';
  }

  // The board's own answer to "how is the value built?" and "which protocols trade already?", above the table.
  function renderModelStrip() {
    var top = ROWS[0], f = top.f, cc = catCount();
    var tv = ROWS.map(function (r) { return r.t; }), rs = ROWS.map(function (r) { return r.ratio; });
    var term = function (label, sub) { return '<span class="term"><b>' + label + '</b><small>' + sub + '</small></span>'; };
    var cats = Object.keys(cc).filter(function (c) { return peer(c).n > 0; }).sort(function (a, b) { return cc[b] - cc[a]; }).slice(0, 8);
    var maxR = Math.max.apply(null, cats.map(function (c) { return peer(c).ratio; }));
    $('model-strip').innerHTML =
      '<div class="formula-strip"><span class="term lead"><b>Implied value</b><small>ranks the board</small></span><i>=</i>' +
      term('TVL', usd(Math.min.apply(null, tv)) + '–' + usd(Math.max.apply(null, tv))) + '<i>×</i>' +
      term('peer mcap/TVL', 'median of ' + TLIST.length + ' traded, clipped p10–p90, w=n/(n+' + M.prior_n + ') · ' + f3(Math.min.apply(null, rs)) + '–' + f3(Math.max.apply(null, rs))) + '<i>×</i>' +
      term('growth', '1+' + M.growth_weight + '×7d · ' + (1 + M.growth_weight * M.growth_floor / 100).toFixed(2) + '–' + (1 + M.growth_weight * M.growth_cap / 100).toFixed(2)) + '<i>×</i>' +
      term('age', 'days w/o token, ≤3 yr · ' + M.age_floor.toFixed(2) + '–' + (M.age_floor + M.age_range).toFixed(2)) + '<i>×</i>' +
      term('reach', '1+' + M.reach_weight + '·log2(chains) · 1.00–' + M.reach_cap.toFixed(2)) +
      '<span class="eg">impliedValue() in model.js, run in this page · #1 ' + esc(top.n) + ': ' + usd(top.t) + ' × ' + f3(f.peer_ratio) + ' × ' + f3(f.growth) + ' × ' + f3(f.age) + ' × ' + f3(f.reach) + ' = <b>' + usd(top.v) + '</b> · ' + VERIFIED + '/' + ROWS.length + ' rows equal board.json</span></div>' +
      '<div class="split-panel">' +
      '<div class="side pre"><span class="kicker">Records no token</span><b>' + ROWS.length + ' <em>ranked</em></b><small>' + WL + ' watchlist + ' + (ROWS.length - WL) + ' early (≥ $5M TVL) · the board below</small></div>' +
      '<div class="side live"><span class="kicker">Token trades</span><b>' + TLIST.length + ' <em>used as price comparables</em></b><small>never ranked · they set each category\'s mcap/TVL</small></div>' +
      '<div class="mini-chart"><span class="kicker">peerRatio by category: traded median mcap/TVL, blended <span class="muted">· top board categories</span></span><div class="bars">' +
      cats.map(function (c) {
        var p = peer(c);
        return '<span class="bar"><span class="bl">' + esc(c) + '</span><span class="bt"><i style="width:' + (p.ratio / maxR * 100).toFixed(1) + '%"></i></span><span class="bv num">' + f3(p.ratio) + ' ' + nTag(p.n) + '</span></span>';
      }).join('') + '</div></div></div>';
  }

  // -- the board
  var COLS = [
    ['k', 'Rank', 'r'], ['n', 'Protocol'], ['c', 'Category'], ['main', 'Main chain'], ['t', 'TVL', 'r'], ['g', '7d', 'r'],
    ['age', 'No token for', 'r'], ['ratio', 'Peer ratio', 'r'], ['v', 'Implied value', 'r'], ['r1k', 'Per $1k farmed', 'r'], ['cap', 'Min capital', 'r']
  ];
  function filtered() {
    var q = S.q.trim().toLowerCase(), band = BANDS.filter(function (b) { return b[0] === S.band; })[0] || BANDS[0];
    return ROWS.filter(function (r) {
      if (S.cat !== 'all' && (r.c || 'Uncategorised') !== S.cat) return false;
      if (S.chain !== 'all' && r.ch.indexOf(S.chain) < 0) return false;
      if (r.t < band[2] || r.t >= band[3]) return false;
      if (S.wl && !r.w) return false;
      if (q && (r.n + ' ' + (r.c || '') + ' ' + r.ch.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sorter(key, dir) {
    return function (a, b) {
      var p = a[key], q = b[key];
      if (p === null || p === undefined) return 1;
      if (q === null || q === undefined) return -1;
      var c = typeof p === 'string' ? p.localeCompare(q) : p - q;
      return c * dir || a.k - b.k;
    };
  }
  function head(cols, sortKey, dir, attr) {
    return '<tr>' + cols.map(function (c) {
      var on = c[0] === sortKey;
      return '<th class="sortable ' + (c[2] || '') + '" ' + attr + '="' + c[0] + '" aria-sort="' + (on ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + c[1] + (on ? '<span class="arrow">' + (dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>';
    }).join('') + '</tr>';
  }
  function renderBoard() {
    var rows = filtered().sort(sorter(S.sort, S.dir));
    var top = ROWS[0].v;
    var t = $('board');
    t.tHead.innerHTML = head(COLS, S.sort, S.dir, 'data-sort');
    t.tBodies[0].innerHTML = rows.map(function (r) {
      var w = Math.max(2, Math.sqrt(r.v / top) * 100);
      return '<tr tabindex="0" data-slug="' + esc(r.s) + '">' +
        '<td class="rank r">' + r.k + '</td>' +
        '<td><span class="pname">' + esc(r.n) + '</span>' + (r.w ? '<span class="wl" title="On the house watchlist">WATCH</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.c || 'Uncategorised') + '</td>' +
        '<td>' + esc(r.main) + (r.ch.length > 1 ? ' <span class="more">+' + (r.ch.length - 1) + '</span>' : '') + '</td>' +
        '<td class="r num">' + usd(r.t) + '</td>' +
        '<td class="r num">' + pct(r.g) + '</td>' +
        '<td class="r num">' + months(r.age) + '</td>' +
        '<td class="r num">' + f3(r.ratio) + ' ' + nTag(r.f.peer_n) + '</td>' +
        '<td class="r"><div class="vcell"><div class="vbar"><i style="width:' + w.toFixed(1) + '%"></i></div><span class="val num">' + usd(r.v) + '</span></div></td>' +
        '<td class="r num">' + usd(r.r1k) + '</td>' +
        '<td class="r num">' + usd(r.cap) + '</td></tr>';
    }).join('') || '<tr><td colspan="11" class="muted">No protocol matches these filters.</td></tr>';
    var sum = rows.reduce(function (s, r) { return s + r.v; }, 0);
    $('count').innerHTML = '<b>' + rows.length + '</b> of ' + ROWS.length + ' protocols · <b>' + usd(sum) + '</b> implied';
    var band = BANDS.filter(function (b) { return b[0] === S.band; })[0];
    var col = COLS.filter(function (c) { return c[0] === S.sort; })[0];
    var chips = [];
    if (S.q) chips.push('Search “' + esc(S.q) + '”');
    if (S.cat !== 'all') chips.push('Category: ' + esc(S.cat));
    if (S.chain !== 'all') chips.push('Chain: ' + esc(S.chain));
    if (S.band !== 'all') chips.push('TVL: ' + band[1]);
    if (S.wl) chips.push('Watchlist only');
    if (S.sort !== 'k') chips.push('Sorted by ' + col[1] + (S.dir > 0 ? ' ▲' : ' ▼'));
    $('chips').innerHTML = chips.length ? '<span class="muted">Active:</span>' + chips.map(function (c) { return '<span class="chip">' + c + '</span>'; }).join('') : '';
    ['cat', 'chain', 'band'].forEach(function (k) { $('filters')[k].classList.toggle('on', S[k] !== 'all'); });
  }
  function fillFilters() {
    var f = $('filters'), cats = catCount(), chains = {};
    ROWS.forEach(function (r) { r.ch.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    var opts = function (map, label) {
      return '<option value="all">' + label + '</option>' + Object.keys(map).sort(function (a, b) { return map[b] - map[a] || a.localeCompare(b); })
        .map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + ' (' + map[k] + ')</option>'; }).join('');
    };
    f.cat.innerHTML = opts(cats, 'All categories');
    f.chain.innerHTML = opts(chains, 'All chains');
    f.band.innerHTML = BANDS.map(function (b) { return '<option value="' + b[0] + '">' + b[1] + '</option>'; }).join('');
  }
  function syncFilters() {
    var f = $('filters');
    f.q.value = S.q; f.cat.value = S.cat; f.chain.value = S.chain; f.band.value = S.band; f.wl.checked = S.wl;
    ['cat', 'chain', 'band'].forEach(function (k) { if (f[k].value !== S[k]) { S[k] = 'all'; f[k].value = 'all'; } });
  }

  // -- the detail view
  function factorRow(label, note, value, lo, hi, cls) {
    var span = hi - lo, one = (1 - lo) / span * 100, at = (value - lo) / span * 100;
    var left = Math.min(one, at), width = Math.max(1.5, Math.abs(at - one));
    var kind = value < 1 ? 'lo' : value > 1 ? 'hi' : '';
    return '<span class="lab">' + label + '<small>' + note + '</small></span>' +
      '<span class="track"><i class="' + (cls || kind) + '" style="left:' + (cls ? 0 : left).toFixed(1) + '%;width:' + (cls ? at : width).toFixed(1) + '%"></i>' + (cls ? '' : '<span class="one" style="left:' + one.toFixed(1) + '%"></span>') + '</span>' +
      '<span class="x">×' + f3(value) + '</span>';
  }
  function renderDetail() {
    var box = $('detail'), scrim = $('scrim');
    var r = ROWS.filter(function (z) { return z.s === S.p; })[0];
    if (!r) { box.hidden = true; scrim.hidden = true; return; }
    var f = r.f, pr = peer(r.c), plan = r.plan, ok = matches(r), lo = M.age_floor - 0.05, hi = 1 + M.growth_weight * M.growth_cap / 100;
    var cmp = r.cmp.map(function (s) { return TRADED[s]; }).filter(Boolean);
    box.innerHTML =
      '<div class="d-head"><div><h2 id="d-title">' + esc(r.n) + (r.w ? ' <span class="wl">WATCHLIST</span>' : '') + '</h2>' +
      '<div class="d-meta">Rank #' + r.k + ' of ' + ROWS.length + ' · ' + esc(r.c || 'Uncategorised') + ' · ' + r.ch.length + ' chain' + (r.ch.length > 1 ? 's' : '') + ': ' + esc(r.ch.slice(0, 4).join(', ')) + (r.ch.length > 4 ? ' +' + (r.ch.length - 4) : '') +
      ' · tracked since ' + esc(r.l || 'n/a') + ' · records no token on DefiLlama</div></div>' +
      '<div class="d-kpis"><div class="kpi"><span>TVL</span><b>' + usd(r.t) + '</b></div><div class="kpi"><span>7d</span><b>' + pct(r.g) + '</b></div>' +
      '<div class="kpi"><span>Per $1k farmed</span><b>' + usd(r.r1k) + '</b></div><div class="kpi big"><span>Implied value</span><b>' + usd(r.v) + '</b></div>' +
      '<button class="d-close" id="close" aria-label="Close">Esc ✕</button></div></div>' +
      '<div class="d-body"><div class="d-col">' +
      '<section><h3>How the value is built</h3><p>Every factor comes from the snapshot (model.js). Bars run from ×1.0; coral pulls the value down, teal pushes it up.</p>' +
      '<div class="fx">' +
      factorRow('peerRatio', 'n=' + pr.n + (RM.isThin(pr.n) ? ' · thin' : ' traded peers'), f.peer_ratio, 0, 1, 'amber') +
      factorRow('growthFactor', '7d ' + (r.g === null ? 'n/a' : (r.g >= 0 ? '+' : '') + r.g.toFixed(1) + '%'), f.growth, lo, hi) +
      factorRow('ageFactor', months(f.age_used_days) + (f.age_days === null ? ' (median)' : '') + ' no token', f.age, lo, hi) +
      factorRow('reachFactor', f.chains + ' chain' + (f.chains > 1 ? 's' : ''), f.reach, lo, hi) +
      '</div><div class="eq">' + usd(r.t) + ' TVL × ' + f3(f.peer_ratio) + ' = ' + usd(r.t * f.peer_ratio) + ' peer base<br>× ' + f3(f.growth) + ' growth × ' + f3(f.age) + ' age × ' + f3(f.reach) + ' reach = <b>' + usd(r.v) + '</b>' +
      '<br><span class="' + (ok ? 'up' : 'down') + '">' + (ok ? '✓ impliedValue() in page $' + r.v.toLocaleString('en-US') + ' = board.json' : '✗ board.json has $' + (BOARD[r.s] ? BOARD[r.s].v.toLocaleString('en-US') : 'no row')) + '</span></div></section>' +
      '<section><h3>Comparable traded protocols</h3><p>' + esc(r.c || 'Uncategorised') + ': clipped median mcap/TVL ' + (pr.median === null ? 'n/a (no traded peer)' : f3(pr.median)) + ' over n=' + pr.n + ', weight n/(n+' + M.prior_n + ') = ' + Math.round(pr.weight * 100) + '% vs the overall ' + f3(PEERS.overall) + ' → ' + f3(pr.ratio) + '.' + (RM.isThin(pr.n) ? ' <span class="thin">Confidence: ' + THIN + '.</span>' : '') + '</p>' +
      '<table class="mini"><thead><tr><th>Traded peer</th><th class="r">TVL</th><th class="r">Mcap</th><th class="r">Mcap/TVL</th></tr></thead><tbody>' +
      cmp.map(function (t) { return '<tr><td>' + esc(t.n) + ' <span class="muted">' + esc(t.y || '') + (t.c !== r.c ? ' · ' + esc(t.c || '') : '') + '</span></td><td class="r num">' + usd(t.t) + '</td><td class="r num">' + usd(t.m) + '</td><td class="r num">' + f3(t.ratio) + '</td></tr>'; }).join('') +
      '<tr class="self"><td>' + esc(r.n) + ' (implied)</td><td class="r num">' + usd(r.t) + '</td><td class="r num">' + usd(r.v) + '</td><td class="r num">' + f3(r.v / r.t) + '</td></tr></tbody></table></section>' +
      '</div><div class="d-col"><section><h3>farmPlan() · ' + esc(plan.family) + ' template on ' + esc(plan.chain) + '</h3>' +
      '<p>' + r.steps.length + ' steps filled from this protocol\'s own record. Fees assume ~' + usd(plan.fee_usd) + ' per transaction on ' + esc(plan.chain) + '; capital is sized so fees stay under ' + Math.round(M.fee_budget * 100) + '% of it.</p>' +
      '<div class="plan-sum"><div><span>Min capital</span><b>' + usd(plan.min_capital_usd) + '</b></div><div><span>All fees</span><b>~' + usd(plan.total_fees_usd) + '</b></div>' +
      '<div><span>Window</span><b>' + plan.hold_days + ' days</b></div><div><span>Est. reward at min</span><b class="up">~' + usd(plan.est_reward_usd) + '</b></div></div>' +
      '<div class="total">Total: <b>' + RM.usdText(plan.total_capital_usd) + '</b> capital, <b>~' + RM.usdText(plan.total_fees_usd) + '</b> fees, <b>~' + plan.hold_days + ' days</b> · expected reward at the ' + RM.usdText(plan.min_capital_usd) + ' minimum: <b class="up">~' + RM.usdText(plan.est_reward_usd) + '</b>, ' + (plan.est_reward_usd / plan.total_fees_usd).toFixed(1) + '× the fees</div>' +
      '<ol class="steps"><li class="hd"><span>Action and risk</span><span class="r">Capital</span><span class="r">Fee</span><span>Time</span></li>' +
      r.steps.map(function (s, i) {
        return '<li><span>' + esc(s.action) + '<span class="st-risk">' + esc(s.risk) + '</span></span><span class="r num">' + usd(s.capital_usd) + (i === 3 ? ' <small class="muted">held</small>' : '') + '</span><span class="r num">' + (s.fee_usd ? '~' + usd(s.fee_usd) : '$0') + '</span><span>' + esc(s.time) + '</span></li>';
      }).join('') + '</ol></section></div></div>';
    box.hidden = false; scrim.hidden = false;
    $('close').onclick = closeDetail;
  }
  function closeDetail() { S.p = null; writeHash(); renderDetail(); }

  // -- trading already
  var TCOLS = [['n', 'Protocol'], ['y', 'Token'], ['c', 'Category'], ['t', 'TVL', 'r'], ['m', 'Market cap', 'r'], ['ratio', 'Mcap/TVL', 'r'], ['g', '7d', 'r']];
  function renderTraded() {
    var list = TLIST.slice().sort(sorter(S.tsort, S.tdir)), cc = catCount();
    var cats = Object.keys(cc).sort(function (a, b) { return cc[b] - cc[a] || a.localeCompare(b); }).slice(0, 16);
    var maxR = Math.max.apply(null, cats.map(function (c) { return peer(c).ratio; }));
    $('view-traded').innerHTML =
      '<div class="lede">' +
      '<div class="card live"><b>' + TLIST.length + '</b><span>trade: a token and a market cap on DefiLlama. They price the radar and never sit on it.</span></div>' +
      '<div class="card pre"><b>' + ROWS.length + '</b><span>record no token: ranked on the Radar tab by implied value.</span></div>' +
      '<div class="card"><b>' + B.token_no_cap + '</b><span>record a token but no market cap: neither priced nor ranked.</span></div>' +
      '<div class="card"><b>' + B.products_excluded + '</b><span>record no token but are wrapped, staked, bridged or exchange products: left off.</span></div></div>' +
      '<div class="split"><div class="board-wrap"><table class="board" id="ttable"><thead>' + head(TCOLS, S.tsort, S.tdir, 'data-tsort') + '</thead><tbody>' +
      list.map(function (t) {
        return '<tr><td class="pname">' + esc(t.n) + '</td><td class="num">' + esc(t.y || '—') + '</td><td class="cat">' + esc(t.c || 'Uncategorised') + '</td><td class="r num">' + usd(t.t) + '</td><td class="r num">' + usd(t.m) + '</td><td class="r num">' + f3(t.ratio) + '</td><td class="r num">' + pct(t.g) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card"><h2>peerRatio() by category</h2><p>Each traded mcap/TVL is clipped to the p10–p90 range of all ' + TLIST.length + ' (' + f3(PEERS.clip[0]) + '–' + f3(PEERS.clip[1]) + '); the category median is blended in log space with the overall ' + f3(PEERS.overall) + ' at weight n/(n+' + M.prior_n + '). n&lt;' + M.thin_n + ' is marked thin.</p>' +
      '<table class="mini rt"><thead><tr><th>Category</th><th class="r">Rows</th><th class="r">Traded n</th><th class="r">Median</th><th class="r">Weight</th><th>Ratio used</th></tr></thead><tbody>' +
      cats.map(function (c) {
        var p = peer(c);
        return '<tr><td>' + esc(c) + '</td><td class="r num">' + cc[c] + '</td><td class="r num">' + nTag(p.n) + '</td><td class="r num">' + (p.median === null ? '—' : f3(p.median)) + '</td><td class="r num">' + Math.round(p.weight * 100) + '%</td><td><span class="rbar"><i style="width:' + (p.ratio / maxR * 100).toFixed(1) + '%"></i></span><span class="num">' + f3(p.ratio) + '</span></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  // -- methodology
  function renderMethod() {
    var fees = Object.keys(RM.CHAIN_FEE_USD).map(function (c) { return '<span>' + esc(c) + '<b class="num">$' + RM.CHAIN_FEE_USD[c] + '</b></span>'; }).join('');
    $('view-method').innerHTML = '<div class="method">' +
      '<div class="card"><h2>Implied value (model.js)</h2><span class="formula">impliedValue = TVL × peerRatio × growthFactor × ageFactor × reachFactor\n' +
      'peerRatio = exp(w·ln(category median) + (1−w)·ln(overall median)), w = n/(n+' + M.prior_n + '), within ' + M.ratio_floor + '–' + M.ratio_cap + '\n' +
      '  each peer mcap/TVL clipped to p' + M.clip_lo * 100 + '–p' + M.clip_hi * 100 + ' of all traded: ' + f3(PEERS.clip[0]) + '–' + f3(PEERS.clip[1]) + '\n' +
      'growthFactor = 1 + ' + M.growth_weight + ' × clamp(change_7d, ' + M.growth_floor + '%, +' + M.growth_cap + '%)\n' +
      'ageFactor = ' + M.age_floor + ' + ' + M.age_range + ' × min(days tracked, ' + M.age_days + ') / ' + M.age_days + '\n' +
      'reachFactor = min(' + M.reach_cap + ', 1 + ' + M.reach_weight + ' × log2(chains))\n' +
      'per $1k farmed = ' + M.community_share + ' × implied / TVL × $1,000</span>' +
      '<ul><li><b>peerRatio</b>: what the market pays per dollar of TVL for traded protocols of the same category (' + TLIST.length + ' with a market cap; overall median ' + f3(PEERS.overall) + '). Peer ratios are clipped at p10/p90 and a 1-peer category gets 11% weight, so one outlier cannot set a price; n&lt;' + M.thin_n + ' is flagged thin.</li>' +
      '<li><b>growthFactor</b>: the 7-day TVL change, capped so one week cannot dominate.</li>' +
      '<li><b>ageFactor</b>: how long DefiLlama has tracked it with no token recorded. Longer runs mean deeper user bases and more accrued points; a missing date takes the board\'s median, ' + B.fallbackAge + ' days.</li>' +
      '<li><b>reachFactor</b>: chains with TVL, on a log scale.</li>' +
      '<li><b>Per $1k farmed</b>: if ' + Math.round(M.community_share * 100) + '% of a token worth the implied value went to depositors pro rata to TVL.</li></ul></div>' +
      '<div class="card"><h2>What is on the board</h2><ul>' +
      '<li>Every one of the ' + D.watchlist.length + ' watchlist protocols (marked WATCH), plus every other protocol at or above $5M TVL that records no token: no CoinGecko id, no symbol, no market cap.</li>' +
      '<li>Left off, by the snapshot\'s own rule: Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, names ending in a version marker, names with wrapped/staked/staking, and names that start with the brand of a protocol in the CEX category.</li>' +
      '<li>No protocol name appears in model.js: one function prices every row, main.ts runs the same file to write board.json, and this page recomputes all ' + ROWS.length + ' (' + VERIFIED + ' match board.json).</li>' +
      '<li>"Records no token" is DefiLlama\'s record, not proof. The implied value is this radar\'s estimate if the record stayed as it is, not a prediction that a token will launch.</li></ul>' +
      '<h2 class="mt">farmPlan()</h2><ul><li>Ten category templates (lending, DEX, vault, RWA, staking, chain, derivatives, stablecoin, cover, general), filled with the protocol\'s name, main chain, age and growth.</li>' +
      '<li>Six steps each, with capital, an estimated fee on the main chain, a time and a risk. Capital is the smallest of $100/250/500/1k/2.5k/5k that keeps all fees under ' + Math.round(M.fee_budget * 100) + '% (RWA starts at $500 for KYC minimums).</li>' +
      '<li>Window: 60–90 days if tracked under 6 months, 45–60 days under 18 months, else 30–45 days.</li></ul>' +
      '<h2 class="mt">Assumed fee per transaction</h2><div class="fees">' + fees + '<span>Other<b class="num">$' + RM.DEFAULT_FEE_USD + '</b></span></div></div></div>';
  }

  // -- wiring
  function renderTab() {
    Array.prototype.forEach.call($('tabs').children, function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)); });
    ['radar', 'traded', 'method'].forEach(function (t) { $('view-' + t).hidden = t !== S.tab; });
    if (S.tab === 'traded') renderTraded();
    if (S.tab === 'method') renderMethod();
  }
  function render() { writeHash(); renderTab(); renderBoard(); renderDetail(); }

  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { S.tab = b.dataset.tab; render(); } });
  $('filters').addEventListener('input', function (e) {
    var f = e.currentTarget;
    S.q = f.q.value; S.cat = f.cat.value; S.chain = f.chain.value; S.band = f.band.value; S.wl = f.wl.checked;
    writeHash(); renderBoard();
  });
  $('filters').addEventListener('submit', function (e) { e.preventDefault(); });
  $('reset').addEventListener('click', function () { S.q = ''; S.cat = S.chain = S.band = 'all'; S.wl = false; syncFilters(); render(); });
  $('board').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]');
    if (th) { var k = th.dataset.sort; S.dir = S.sort === k ? -S.dir : (k === 'k' || k === 'n' || k === 'c' || k === 'main' ? 1 : -1); S.sort = k; writeHash(); renderBoard(); return; }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { S.p = tr.dataset.slug; writeHash(); renderDetail(); }
  });
  $('board').addEventListener('keydown', function (e) { var tr = e.target.closest('tr[data-slug]'); if (tr && e.key === 'Enter') { S.p = tr.dataset.slug; writeHash(); renderDetail(); } });
  $('view-traded').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-tsort]');
    if (th) { var k = th.dataset.tsort; S.tdir = S.tsort === k ? -S.tdir : (k === 'n' || k === 'c' || k === 'y' ? 1 : -1); S.tsort = k; renderTraded(); }
  });
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.p) closeDetail(); });

  readHash();
  renderStats();
  renderModelStrip();
  fillFilters();
  syncFilters();
  render();
})();
