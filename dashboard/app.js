// Token Launch Radar: the page. Reads window.RADAR (data.js, written by main.ts from the sealed DefiLlama
// snapshot) and renders the board, the traded comparables and the methodology. No framework, no network.
// recompute() repeats lib/model.ts's arithmetic from the raw snapshot fields, so every implied value on
// screen is re-derived here and checked against the board, not just displayed.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.body.textContent = 'data.js is missing: run main.ts first.'; return; }
  var M = D.model;
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------ formatting
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
  function x(n, d) { return '×' + n.toFixed(d === undefined ? 3 : d); }

  // ------------------------------------------------------------ the model, again
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (p, q) { return p - q; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  var r4 = function (n) { return Math.round(n * 1e4) / 1e4; };
  function ageDays(listed) {
    if (!listed) return null;
    var a = Date.parse(D.as_of + 'T00:00:00Z'), b = Date.parse(listed + 'T00:00:00Z');
    return Math.max(0, Math.floor((a - b) / 86400000));
  }
  // Peer ratios: the median mcap/TVL of traded protocols per category, shrunk toward the overall median.
  function peerRatios(traded) {
    var overall = median(traded.map(function (t) { return t.m / t.t; }));
    var groups = {};
    traded.forEach(function (t) { var c = t.c || 'Uncategorised'; (groups[c] = groups[c] || []).push(t.m / t.t); });
    function blend(n, med) {
      var w = med === null ? 0 : n / (n + M.prior_n);
      var lr = w * Math.log(med === null ? overall : med) + (1 - w) * Math.log(overall);
      return { n: n, median: med, weight: r4(w), ratio: r4(Math.min(M.ratio_cap, Math.max(M.ratio_floor, Math.exp(lr)))) };
    }
    var cats = {};
    Object.keys(groups).forEach(function (c) { cats[c] = blend(groups[c].length, median(groups[c])); });
    return { overall: overall, cats: cats, of: function (c) { return cats[c || 'Uncategorised'] || blend(0, null); } };
  }
  var PEERS = peerRatios(D.traded);
  var FALLBACK_AGE = Math.round(median(D.rows.map(function (r) { return ageDays(r.l); }).filter(function (a) { return a !== null; })));
  // implied = TVL × peer ratio × growth × age × reach (whole dollars).
  function recompute(r) {
    var g = Math.min(M.growth_cap, Math.max(M.growth_floor, r.g === null ? 0 : r.g));
    var age = ageDays(r.l), used = age === null ? FALLBACK_AGE : age;
    var f = {
      ratio: PEERS.of(r.c).ratio,
      growth: r4(1 + (M.growth_weight * g) / 100),
      age: r4(M.age_floor + (M.age_range * Math.min(used, M.age_days)) / M.age_days),
      reach: r4(Math.min(M.reach_cap, 1 + M.reach_weight * Math.log2(Math.max(1, r.ch.length))))
    };
    f.implied = Math.max(1, Math.round(r.t * f.ratio * f.growth * f.age * f.reach));
    return f;
  }
  var VERIFIED = D.rows.filter(function (r) { return recompute(r).implied === r.v; }).length;

  // ------------------------------------------------------------ state, in the URL hash
  var ROWS = D.rows.map(function (r) {
    return Object.assign({}, r, { main: r.plan.chain, age: r.f.age_days, ratio: r.f.peer_ratio, cap: r.plan.min_capital_usd });
  });
  var TRADED = {};
  D.traded.forEach(function (t) { TRADED[t.s] = t; });
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

  // ------------------------------------------------------------ masthead
  function renderStats() {
    var wl = ROWS.filter(function (r) { return r.w; }).length;
    var total = ROWS.reduce(function (s, r) { return s + r.v; }, 0);
    var stat = function (label, value, small, cls) { return '<div class="' + (cls || '') + '"><dt>' + label + '</dt><dd>' + value + (small ? '<small>' + small + '</small>' : '') + '</dd></div>'; };
    $('stats').innerHTML =
      stat('Scanned', D.universe, 'protocols') +
      stat('On the radar', ROWS.length, 'no token') +
      stat('Watchlist', wl + '/' + D.watchlist_n, 'covered', wl === D.watchlist_n ? 'ok' : '') +
      stat('Traded peers', D.traded.length, 'priced') +
      stat('Implied total', usd(total)) +
      stat('Recomputed', VERIFIED + '/' + ROWS.length, 'match',VERIFIED === ROWS.length ? 'ok' : '');
    $('sub').textContent = 'DefiLlama snapshot of ' + D.as_of + ': ' + ROWS.length + ' protocols that record no token, ranked by a value implied from ' + D.traded.length + ' traded peers.';
    $('foot').innerHTML = 'Source: ' + esc(D.source) + '. Implied values are this radar\'s own estimate under model ' + esc(M.version) + ', not a forecast that any token will launch. A protocol here records no token on DefiLlama; that is not proof it has none.';
  }

  // ------------------------------------------------------------ the board
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
    var top = Math.max.apply(null, ROWS.map(function (r) { return r.v; }));
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
        '<td class="r num">' + r.ratio.toFixed(3) + '</td>' +
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
    var f = $('filters');
    var cats = {}, chains = {};
    ROWS.forEach(function (r) { cats[r.c || 'Uncategorised'] = (cats[r.c || 'Uncategorised'] || 0) + 1; r.ch.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
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

  // ------------------------------------------------------------ the detail view
  function factorRow(label, note, value, lo, hi, cls) {
    var span = hi - lo, one = (1 - lo) / span * 100, at = (value - lo) / span * 100;
    var left = Math.min(one, at), width = Math.max(1.5, Math.abs(at - one));
    var kind = value < 1 ? 'lo' : value > 1 ? 'hi' : '';
    return '<span class="lab">' + label + '<small>' + note + '</small></span>' +
      '<span class="track"><i class="' + (cls || kind) + '" style="left:' + (cls ? 0 : left).toFixed(1) + '%;width:' + (cls ? at : width).toFixed(1) + '%"></i>' + (cls ? '' : '<span class="one" style="left:' + one.toFixed(1) + '%"></span>') + '</span>' +
      '<span class="x">' + x(value) + '</span>';
  }
  function renderDetail() {
    var box = $('detail'), scrim = $('scrim');
    var r = ROWS.filter(function (z) { return z.s === S.p; })[0];
    if (!r) { box.hidden = true; scrim.hidden = true; return; }
    var f = r.f, re = recompute(r), peer = PEERS.of(r.c), plan = r.plan;
    var base = r.t * f.peer_ratio;
    var cmp = r.cmp.map(function (s) { return TRADED[s]; }).filter(Boolean);
    box.innerHTML =
      '<div class="d-head"><div><h2 id="d-title">' + esc(r.n) + (r.w ? ' <span class="wl">WATCHLIST</span>' : '') + '</h2>' +
      '<div class="d-meta">Rank #' + r.k + ' of ' + ROWS.length + ' · ' + esc(r.c || 'Uncategorised') + ' · ' + r.ch.length + ' chain' + (r.ch.length > 1 ? 's' : '') + ': ' + esc(r.ch.slice(0, 4).join(', ')) + (r.ch.length > 4 ? ' +' + (r.ch.length - 4) : '') +
      ' · tracked since ' + esc(r.l || 'n/a') + ' · records no token on DefiLlama</div></div>' +
      '<div class="d-kpis"><div class="kpi"><span>TVL</span><b>' + usd(r.t) + '</b></div><div class="kpi"><span>7d</span><b>' + pct(r.g) + '</b></div>' +
      '<div class="kpi"><span>Per $1k farmed</span><b>' + usd(r.r1k) + '</b></div><div class="kpi big"><span>Implied value</span><b>' + usd(r.v) + '</b></div>' +
      '<button class="d-close" id="close" aria-label="Close">Esc ✕</button></div></div>' +
      '<div class="d-body"><div class="d-col">' +
      '<section><h3>How the value is built</h3><p>Every factor comes from the snapshot. Bars run from ×1.0; coral pulls the value down, teal pushes it up.</p>' +
      '<div class="fx">' +
      factorRow('Peer ratio', peer.n + ' traded peer' + (peer.n === 1 ? '' : 's'), f.peer_ratio, 0, 1, 'amber') +
      factorRow('Growth', '7d ' + (r.g === null ? 'n/a' : (r.g >= 0 ? '+' : '') + r.g.toFixed(1) + '%'), f.growth, M.age_floor - 0.05, 1 + M.growth_weight * M.growth_cap / 100) +
      factorRow('Age', months(f.age_used_days) + (f.age_days === null ? ' (median)' : '') + ' no token', f.age, M.age_floor - 0.05, 1 + M.growth_weight * M.growth_cap / 100) +
      factorRow('Reach', f.chains + ' chain' + (f.chains > 1 ? 's' : ''), f.reach, M.age_floor - 0.05, 1 + M.growth_weight * M.growth_cap / 100) +
      '</div><div class="eq">' + usd(r.t) + ' TVL × ' + f.peer_ratio.toFixed(3) + ' = ' + usd(base) + ' peer base<br>× ' + f.growth.toFixed(3) + ' growth × ' + f.age.toFixed(3) + ' age × ' + f.reach.toFixed(3) + ' reach = <b>' + usd(r.v) + '</b>' +
      '<br><span class="' + (re.implied === r.v ? 'up' : 'down') + '">' + (re.implied === r.v ? '✓ recomputed in page: $' + re.implied.toLocaleString('en-US') : '✗ page gets $' + re.implied.toLocaleString('en-US')) + '</span></div></section>' +
      '<section><h3>Comparable traded protocols</h3><p>' + esc(r.c || 'Uncategorised') + ': median mcap/TVL ' + (peer.median === null ? 'n/a (no traded peer)' : peer.median.toFixed(3)) + ' over ' + peer.n + ', blended ' + Math.round(peer.weight * 100) + '% with the overall ' + PEERS.overall.toFixed(3) + ' → ' + peer.ratio.toFixed(3) + '.</p>' +
      '<table class="mini"><thead><tr><th>Traded peer</th><th class="r">TVL</th><th class="r">Mcap</th><th class="r">Mcap/TVL</th></tr></thead><tbody>' +
      cmp.map(function (t) { return '<tr><td>' + esc(t.n) + ' <span class="muted">' + esc(t.y || '') + (t.c !== r.c ? ' · ' + esc(t.c || '') : '') + '</span></td><td class="r num">' + usd(t.t) + '</td><td class="r num">' + usd(t.m) + '</td><td class="r num">' + (t.m / t.t).toFixed(3) + '</td></tr>'; }).join('') +
      '<tr class="self"><td>' + esc(r.n) + ' (implied)</td><td class="r num">' + usd(r.t) + '</td><td class="r num">' + usd(r.v) + '</td><td class="r num">' + (r.v / r.t).toFixed(3) + '</td></tr></tbody></table></section>' +
      '</div><div class="d-col"><section><h3>Farm plan · ' + esc(plan.family) + ' template on ' + esc(plan.chain) + '</h3>' +
      '<p>' + r.steps.length + ' steps filled from this protocol\'s own record. Fees assume ~' + usd(plan.fee_usd) + ' per transaction on ' + esc(plan.chain) + '; capital is sized so fees stay under ' + Math.round(M.fee_budget * 100) + '% of it.</p>' +
      '<div class="plan-sum"><div><span>Min capital</span><b>' + usd(plan.min_capital_usd) + '</b></div><div><span>All fees</span><b>' + usd(plan.total_fees_usd) + '</b></div>' +
      '<div><span>Window</span><b>' + plan.hold_days + ' days</b></div><div><span>Est. reward at min</span><b class="up">' + usd(plan.est_reward_usd) + '</b></div></div>' +
      '<ol class="steps"><li class="hd"><span>Action and risk</span><span class="r">Capital</span><span class="r">Fee</span><span>Time</span></li>' +
      r.steps.map(function (s) {
        return '<li><span>' + esc(s.action) + '<span class="st-risk">' + esc(s.risk) + '</span></span><span class="r num">' + (s.capital_usd ? usd(s.capital_usd) : '—') + '</span><span class="r num">' + (s.fee_usd ? '~' + usd(s.fee_usd) : '$0') + '</span><span>' + esc(s.time) + '</span></li>';
      }).join('') + '</ol></section></div></div>';
    box.hidden = false; scrim.hidden = false;
    $('close').onclick = closeDetail;
  }
  function closeDetail() { S.p = null; writeHash(); renderDetail(); }

  // ------------------------------------------------------------ trading already
  var TCOLS = [['n', 'Protocol'], ['y', 'Token'], ['c', 'Category'], ['t', 'TVL', 'r'], ['m', 'Market cap', 'r'], ['ratio', 'Mcap/TVL', 'r'], ['g', '7d', 'r']];
  function renderTraded() {
    var list = D.traded.map(function (t) { return Object.assign({ ratio: t.m / t.t, k: 0 }, t); }).sort(sorter(S.tsort, S.tdir));
    var boardCats = {};
    ROWS.forEach(function (r) { boardCats[r.c || 'Uncategorised'] = (boardCats[r.c || 'Uncategorised'] || 0) + 1; });
    var cats = Object.keys(boardCats).sort(function (a, b) { return boardCats[b] - boardCats[a]; }).slice(0, 18);
    var maxR = Math.max.apply(null, cats.map(function (c) { return PEERS.of(c).ratio; }));
    var pre = ROWS.length;
    $('view-traded').innerHTML =
      '<div class="lede">' +
      '<div class="card"><b>' + D.traded.length + '</b><span>trade: a token and a market cap on DefiLlama. They price the radar and never sit on it.</span></div>' +
      '<div class="card"><b class="val">' + pre + '</b><span>record no token: ranked on the Radar tab by implied value.</span></div>' +
      '<div class="card"><b>' + D.token_no_cap + '</b><span>record a token but no market cap: neither priced nor ranked.</span></div>' +
      '<div class="card"><b>' + D.products_excluded + '</b><span>record no token but are wrapped, staked, bridged or exchange products: left off.</span></div></div>' +
      '<div class="split"><div class="board-wrap"><table class="board" id="ttable"><thead>' + head(TCOLS, S.tsort, S.tdir, 'data-tsort') + '</thead><tbody>' +
      list.map(function (t) {
        return '<tr><td class="pname">' + esc(t.n) + '</td><td class="num">' + esc(t.y || '—') + '</td><td class="cat">' + esc(t.c || 'Uncategorised') + '</td><td class="r num">' + usd(t.t) + '</td><td class="r num">' + usd(t.m) + '</td><td class="r num">' + t.ratio.toFixed(3) + '</td><td class="r num">' + pct(t.g) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card"><h2>Peer ratio by category</h2><p>The multiple the radar applies to TVL: the category\'s traded median, shrunk toward the overall ' + PEERS.overall.toFixed(3) + ' when it has few peers (weight n/(n+' + M.prior_n + ')).</p>' +
      '<div class="ratio-row muted"><span>Category (rows)</span><span>n</span><span></span><span class="r">ratio</span></div>' +
      cats.map(function (c) {
        var p = PEERS.of(c);
        return '<div class="ratio-row"><span>' + esc(c) + ' <span class="muted">(' + boardCats[c] + ')</span></span><span class="num muted">' + p.n + '</span><span class="track"><i style="width:' + (p.ratio / maxR * 100).toFixed(1) + '%"></i></span><span class="num r">' + p.ratio.toFixed(3) + '</span></div>';
      }).join('') + '</div></div>';
  }

  // ------------------------------------------------------------ methodology
  function renderMethod() {
    var fees = Object.keys(D.fees).map(function (c) { return '<span>' + esc(c) + '<b class="num">$' + D.fees[c] + '</b></span>'; }).join('');
    $('view-method').innerHTML = '<div class="method">' +
      '<div class="card"><h2>Implied value</h2><span class="formula">implied = TVL × peer ratio × growth × age × reach\n' +
      'peer ratio = exp(w·ln(category median) + (1−w)·ln(overall median)), w = n/(n+' + M.prior_n + '), within ' + M.ratio_floor + '–' + M.ratio_cap + '\n' +
      'growth = 1 + ' + M.growth_weight + ' × clamp(change_7d, ' + M.growth_floor + '%, +' + M.growth_cap + '%)\n' +
      'age = ' + M.age_floor + ' + ' + M.age_range + ' × min(days tracked, ' + M.age_days + ') / ' + M.age_days + '\n' +
      'reach = min(' + M.reach_cap + ', 1 + ' + M.reach_weight + ' × log2(chains))\n' +
      'per $1k farmed = ' + M.community_share + ' × implied / TVL × $1,000</span>' +
      '<ul><li><b>Peer ratio</b>: what the market pays per dollar of TVL for traded protocols of the same category (' + D.traded.length + ' with a market cap; overall median ' + PEERS.overall.toFixed(3) + '). A category with one traded peer is pulled most of the way to the overall median, so one outlier cannot set a price.</li>' +
      '<li><b>Growth</b>: the 7-day TVL change, capped so one week cannot dominate.</li>' +
      '<li><b>Age</b>: how long DefiLlama has tracked it with no token recorded. Longer runs mean deeper user bases and more accrued points; a missing date takes the board\'s median, ' + FALLBACK_AGE + ' days.</li>' +
      '<li><b>Reach</b>: chains with TVL, on a log scale.</li>' +
      '<li><b>Per $1k farmed</b>: if ' + Math.round(M.community_share * 100) + '% of a token worth the implied value went to depositors pro rata to TVL.</li></ul></div>' +
      '<div class="card"><h2>What is on the board</h2><ul>' +
      '<li>Every one of the ' + D.watchlist_n + ' watchlist protocols (marked WATCH), plus every other protocol at or above $5M TVL that records no token: no CoinGecko id, no symbol, no market cap.</li>' +
      '<li>Left off, by the snapshot\'s own rule: Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, names ending in a version marker, names with wrapped/staked/staking, and exchange-branded products.</li>' +
      '<li>No protocol name appears in the model: one function prices every row, and this page recomputes all ' + ROWS.length + ' (' + VERIFIED + ' match).</li>' +
      '<li>"Records no token" is DefiLlama\'s record, not proof. The implied value is this radar\'s estimate if the record stayed as it is, not a prediction that a token will launch.</li></ul>' +
      '<h2 style="margin-top:16px">Farm plans</h2><ul><li>Ten category templates (lending, DEX, vault, RWA, staking, chain, derivatives, stablecoin, cover, general), filled with the protocol\'s name, main chain, age and growth.</li>' +
      '<li>Six steps each, with minimum capital, an estimated fee on the main chain, a time and a risk. Capital is the smallest of $100/250/500/1k/2.5k/5k that keeps all fees under ' + Math.round(M.fee_budget * 100) + '% (RWA starts at $500 for KYC minimums).</li>' +
      '<li>Window: 60–90 days if tracked under 6 months, 45–60 days under 18 months, else 30–45 days.</li></ul>' +
      '<h2 style="margin-top:16px">Assumed fee per transaction</h2><div class="fees">' + fees + '<span>Other<b class="num">$' + D.default_fee + '</b></span></div></div></div>';
  }

  // ------------------------------------------------------------ wiring
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
  fillFilters();
  syncFilters();
  render();
})();
