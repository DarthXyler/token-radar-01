// Token Launch Radar, the page. data.js carries only the snapshot's raw fields and board.json's [slug, value] pairs;
// model.js (RadarModel, the file main.ts runs) refits both models here, ranks the board, and the integrity strip
// checks the result against board.json. Nothing below names a protocol.
(function () {
  'use strict';
  var D = window.RADAR, RM = window.RadarModel, M = RM.MODEL, usd = RM.usdText;
  var $ = (id) => document.getElementById(id);
  var esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  var pct = (n, d) => (n * 100).toFixed(d === undefined ? 1 : d) + '%';
  var xk = (n) => '×' + n.toFixed(2);
  var chg = (n) => n === null ? '<span class="muted">n/a</span>' : `<span class="${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
  var mo = (d) => d === null ? '<span class="muted">n/a</span>' : (d / 30.44).toFixed(d < 304 ? 1 : 0) + ' mo';
  var money = (n) => `<span class="${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '+' : ''}${usd(n)}</span>`;

  // -- the model, run in the page
  var CORE = RM.fitCore(D), EV = RM.evidence(CORE), DEF = RM.buildBoard(D, {}, CORE);
  var FX = {};
  CORE.F.forEach((f) => { FX[f.p.slug] = f; });
  var BJ = {};
  D.board.forEach((b, i) => { BJ[b[0]] = { v: b[1], k: i + 1 }; });
  var CHECKS = (() => {
    var rows = DEF.rows, have = {};
    rows.forEach((r) => { have[r.slug] = 1; });
    var match = rows.filter((r) => BJ[r.slug] && BJ[r.slug].v === r.implied_value_usd && BJ[r.slug].k === r.rank).length;
    var acct = DEF.groups.reduce((a, g) => a + g.n, 0);
    return [
      ['board.json recomputed', match + '/' + D.board.length, match === rows.length && match === D.board.length],
      ['ranks 1–' + rows.length + ' in order', rows.every((r, i) => r.rank === i + 1) ? 'yes' : 'no', rows.every((r, i) => r.rank === i + 1)],
      ['values non-increasing', rows.every((r, i) => !i || r.implied_value_usd <= rows[i - 1].implied_value_usd) ? 'yes' : 'no', rows.every((r, i) => !i || r.implied_value_usd <= rows[i - 1].implied_value_usd)],
      ['watchlist', D.watchlist.filter((w) => have[w]).length + '/' + D.watchlist.length, D.watchlist.every((w) => have[w])],
      ['protocols accounted', acct + '/' + D.protocols.length, acct === D.protocols.length && CORE.groups.length === D.protocols.length]
    ];
  })();

  // -- state, in the URL hash
  var DEFAULTS = { tab: 'radar', tier: 'all', q: '', cat: '', chain: '', band: '', wl: '', sort: 'k', dir: '1', p: '', plan: String(M.plan_usd), share: String(M.share * 100), h: String(M.horizon_days), opp: 'family' };
  var S = {};
  function readHash() {
    var h = {};
    location.hash.slice(1).split('&').forEach((kv) => { var i = kv.indexOf('='); if (i > 0) h[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    Object.keys(DEFAULTS).forEach((k) => { S[k] = h[k] !== undefined ? h[k] : DEFAULTS[k]; });
  }
  function writeHash() {
    var parts = Object.keys(DEFAULTS).filter((k) => S[k] !== DEFAULTS[k]).map((k) => k + '=' + encodeURIComponent(S[k]));
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname);
  }
  var B, OPT;
  function rebuild() {
    OPT = { plan: +S.plan, share: +S.share / 100, horizon: +S.h, opp: S.opp === 'family' ? 'family' : +S.opp };
    B = ['plan', 'share', 'h', 'opp'].every((k) => S[k] === DEFAULTS[k]) ? DEF : RM.buildBoard(D, OPT, CORE);
  }
  var hLabel = () => Math.round(+S.h / 30.4) + ' mo';

  // -- first screen: evidence, accounting, integrity, formula
  function tile(label, big, sub, cls) { return `<div class="tile ${cls || ''}"><span>${label}</span><b>${big}</b><small>${sub}</small></div>`; }
  function renderTop() {
    var v = EV.value, o = EV.odds, vb = v[0], vk = bestOf(v), ob = o[0], ok = bestOf(o);
    var n = { Farm: 0, 'Farm from': 0 };
    B.rows.forEach((r) => { if (n[r.plan.verdict] !== undefined) n[r.plan.verdict]++; });
    var wlFarm = B.rows.filter((r) => r.tier === 'watchlist' && r.plan.verdict !== 'Skip').length;
    $('sub').textContent = `DefiLlama snapshot of ${D.as_of}: ${DEF.rows.length} protocols that record no token, valued by a model fitted on the ${EV.traded_n} whose token trades and tested on protocols it never saw.`;
    $('tiles').innerHTML =
      tile('Value · typical miss',`${xk(vk.loo_x)} <em>/</em> ${xk(vk.wf_x)}`, `leave-one-out / walk-forward · flat median ${xk(vb.loo_x)} / ${xk(vb.wf_x)}`, 'good') +
      tile('Token odds · Brier score', `${ok.loo.toFixed(3)} <em>/</em> ${ok.wf.toFixed(3)}`, `held-out, lower is better · base rate ${ob.loo.toFixed(3)} / ${ob.wf.toFixed(3)}`, 'good') +
      tile('P25–P75 range coverage', pct(EV.coverage, 0), `of ${EV.traded_n} held-out traded protocols land in their band (aim 50%)`, Math.abs(EV.coverage - 0.5) < 0.1 ? 'good' : 'warn') +
      tile('Terms kept / tested', `${kept(v)}/${v.length - 1} <em>·</em> ${kept(o)}/${o.length - 1}`, 'value model · odds model: kept only if both tests improve') +
      tile('Worth farming', `${n.Farm} <em>+</em> ${n['Farm from']}`, `Farm at ${usd(+S.plan)} + Farm from a deposit ≤ ${usd(M.max_deposit)}; net ≥ $${M.farm_per_hour}/h after costs`) +
      tile('Watchlist', CHECKS[3][1], `all ranked · ${wlFarm} farmable with a deposit ≤ ${usd(M.max_deposit)}`, CHECKS[3][2] ? 'good' : 'bad');
    var total = D.protocols.length;
    $('acct').innerHTML = `<span class="lbl">All ${total} protocols, each in one group</span><div class="bar">` +
      DEF.groups.filter((g) => g.n).map((g) => `<i class="g-${g.id}" style="flex:${g.n}" title="${esc(g.label)}"></i>`).join('') + '</div><div class="legend">' +
      DEF.groups.map((g) => `<span><i class="g-${g.id}"></i><b class="num">${g.n}</b> ${esc(g.label)}</span>`).join('') + '</div>';
    $('integrity').innerHTML = '<span class="lbl">Checked in this page</span>' + CHECKS.map((c) => `<span class="${c[2] ? 'ok' : 'bad'}">${c[2] ? '✓' : '✗'} ${c[0]} <b class="num">${c[1]}</b></span>`).join('');
    var t = B.rows[0];
    $('formula').innerHTML = `<b>Implied value</b> = TVL × fitted multiple <span class="muted">(${termList(v)})</span> × token odds within ${hLabel()} <span class="muted">(logistic on ${termList(o)})</span>` +
      `<span class="eg">#1 ${esc(t.name)}: ${usd(t.tvl_usd)} × ${t.multiple.toFixed(3)} × ${pct(t.odds)} = <b>${usd(t.implied_value_usd)}</b></span>`;
  }
  var bestOf = (steps) => steps.filter((s) => s.kept).pop();
  var kept = (steps) => steps.filter((s, i) => i && s.kept).length;
  var termList = (steps) => steps.filter((s, i) => i && s.kept).map((s) => ({ size: 'size curve', growth: '7-day growth', age: 'no-token age' })[s.term] || s.term).join(', ') || 'base only';

  // -- the board
  var COLS = [['k', '#', 'r'], ['n', 'Protocol'], ['t', 'TVL', 'r'], ['g', '7d', 'r'], ['age', 'No token for', 'r'], ['odds', 'Odds', 'r'],
    ['lv', 'If it launches', 'r'], ['v', 'Implied · P25–P75', 'r'], ['net', 'Verdict · net at plan', 'r'], ['be', 'Farm from', 'r'], ['ph', 'Net / hour', 'r']];
  var KEY = { k: (r) => r.rank, n: (r) => r.name.toLowerCase(), t: (r) => r.tvl_usd, g: (r) => r.change_7d === null ? -1e9 : r.change_7d,
    age: (r) => r.age_days === null ? -1 : r.age_days, odds: (r) => r.odds, lv: (r) => r.launch_value_usd, v: (r) => r.implied_value_usd,
    net: (r) => r.plan.at_plan.net, be: (r) => r.plan.breakeven === null ? Infinity : r.plan.breakeven, ph: (r) => r.plan.at_plan.per_hour };
  var vc = (v) => 'v-' + v.replace(' ', '-');
  var beText = (p) => p.breakeven === null ? `<span class="muted">none ≤ ${usd(M.max_deposit)}</span>` : usd(p.breakeven);
  var BANDS = [['', 'Any TVL', 0, Infinity], ['lt10', 'Under $10M', 0, 1e7], ['10-50', '$10M–$50M', 1e7, 5e7], ['50-250', '$50M–$250M', 5e7, 2.5e8], ['gt250', 'Over $250M', 2.5e8, Infinity]];
  var TIERS = ['all', 'Farm', 'Farm from', 'Skip'];
  function visible() {
    var q = S.q.toLowerCase(), band = BANDS.find((b) => b[0] === S.band) || BANDS[0];
    return B.rows.filter((r) => (S.tier === 'all' || r.plan.verdict === S.tier) && (!S.cat || r.category === S.cat) && (!S.chain || r.chains.indexOf(S.chain) >= 0) &&
      (!S.wl || r.tier === 'watchlist') && r.tvl_usd >= band[2] && r.tvl_usd < band[3] &&
      (!q || (r.name + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0));
  }
  function fillFilters() {
    var f = $('filters'), opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
    var cats = {}, chains = {};
    DEF.rows.forEach((r) => { cats[r.category] = (cats[r.category] || 0) + 1; r.chains.forEach((c) => { chains[c] = (chains[c] || 0) + 1; }); });
    var list = (o) => Object.keys(o).sort((a, b) => o[b] - o[a] || a.localeCompare(b));
    f.cat.innerHTML = opt('', 'All categories') + list(cats).map((c) => opt(c, c + ' (' + cats[c] + ')')).join('');
    f.chain.innerHTML = opt('', 'All chains') + list(chains).map((c) => opt(c, c + ' (' + chains[c] + ')')).join('');
    f.band.innerHTML = BANDS.map((b) => opt(b[0], b[1])).join('');
    f.plan.innerHTML = [1000, 2500, 5000, 10000, 25000].map((v) => opt(v, usd(v))).join('');
    f.share.innerHTML = [5, 10, 15, 20].map((v) => opt(v, v + '% to users')).join('');
    f.h.innerHTML = [[182, '6 months'], [365, '12 months'], [730, '24 months']].map((v) => opt(v[0], v[1])).join('');
    f.opp.innerHTML = [['family', 'By family'], ['0', '0% a year'], ['0.01', '1% a year'], ['0.03', '3% a year']].map((v) => opt(v[0], v[1])).join('');
  }
  function syncFilters() {
    var f = $('filters');
    ['q', 'cat', 'chain', 'band', 'plan', 'share', 'h', 'opp'].forEach((k) => { f[k].value = S[k]; f[k].classList.toggle('on', S[k] !== DEFAULTS[k]); });
    f.wl.checked = !!S.wl;
  }
  function renderBoard() {
    var rows = visible(), key = KEY[S.sort] || KEY.k, dir = +S.dir;
    rows.sort((a, b) => { var x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || a.rank - b.rank; });
    var count = { all: 0, Farm: 0, 'Farm from': 0, Skip: 0 };
    B.rows.forEach((r) => { count.all++; count[r.plan.verdict]++; });
    $('tiers').innerHTML = TIERS.map((t) => `<button role="tab" data-tier="${t}" class="t-${t.replace(' ', '-')}" aria-selected="${S.tier === t}">${t === 'all' ? 'All' : t} <b class="num">${count[t]}</b></button>`).join('') +
      `<span class="count"><b class="num">${rows.length}</b> shown · ranked at ${hLabel()}</span>`;
    var max = Math.max.apply(null, B.rows.map((r) => r.implied_value_usd));
    $('board').tHead.innerHTML = '<tr>' + COLS.map((c) => `<th class="${c[2] || ''}" data-sort="${c[0]}">${c[1]}${S.sort === c[0] ? `<span class="arrow">${dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('') + '</tr>';
    $('board').tBodies[0].innerHTML = rows.map((r) => {
      var p = r.plan, more = r.chains.length > 1 ? ` <span class="muted">+${r.chains.length - 1}</span>` : '';
      return `<tr data-slug="${esc(r.slug)}" tabindex="0"><td class="r rank num">${r.rank}</td>` +
        `<td><span class="pname">${esc(r.name)}</span>${r.tier === 'watchlist' ? '<span class="wl">WATCH</span>' : ''}<span class="cat">${esc(r.category)} · ${esc(r.chains[0] || '')}${more}</span></td>` +
        `<td class="r num">${usd(r.tvl_usd)}</td><td class="r num">${chg(r.change_7d)}</td><td class="r num">${mo(r.age_days)}</td>` +
        `<td class="r num">${pct(r.odds)}</td><td class="r num">${usd(r.launch_value_usd)}</td>` +
        `<td class="r"><span class="vcell"><span class="vbar"><i style="width:${(r.implied_value_usd / max * 100).toFixed(1)}%"></i></span><b class="val num">${usd(r.implied_value_usd)}</b></span><span class="band num">${usd(r.p25_usd)}–${usd(r.p75_usd)}</span></td>` +
        `<td class="r"><span class="pill ${vc(p.verdict)}">${p.verdict}</span> <span class="num">${money(p.at_plan.net)}</span></td><td class="r num">${beText(p)}</td><td class="r num">${money(p.at_plan.per_hour)}/h</td></tr>`;
    }).join('') || '<tr><td colspan="11" class="empty">No protocol matches these filters.</td></tr>';
  }

  // -- the detail view
  function renderDetail() {
    var box = $('detail'), scrim = $('scrim'), r = S.p && B.rows.find((x) => x.slug === S.p);
    if (!r) { box.hidden = true; scrim.hidden = true; box.innerHTML = ''; return; }
    var f = FX[r.slug], p = r.plan, h = +S.h, F0 = RM.shareAt(CORE, f, f.age), F1 = RM.shareAt(CORE, f, f.age + h);
    var notKept = EV.value.filter((s, i) => i && !s.kept).map((s) => RM.TERM_LABEL[s.term]).join(', ');
    var terms = r.terms.map((t) => `<tr><td>${t[0] === 'base' ? 'base (median traded mcap/TVL)' : esc(RM.TERM_LABEL[t[0]])}</td><td class="r num">${xk(t[1])}</td></tr>`).join('');
    var cmp = r.comparables.map((s) => FX[s]).map((c) => {
      var i = CORE.T.indexOf(CORE.F.indexOf(c));
      return `<tr><td>${esc(c.p.name)} <span class="muted">${esc(c.p.symbol || '')}${c.cat !== f.cat ? ' · ' + esc(c.cat) : ''}</span></td><td class="r num">${usd(c.p.tvl_usd)}</td><td class="r num">${usd(c.p.mcap_usd)}</td><td class="r num">${(c.p.mcap_usd / c.p.tvl_usd).toFixed(3)}</td><td class="r num">${Math.exp(EV.scatter[i][2]).toFixed(3)}</td></tr>`;
    }).join('');
    var tot = { fee: 0, min: 0 };
    p.steps.forEach((st) => { tot.fee += st.fee; tot.min += st.minutes; });
    box.innerHTML =
      `<div class="d-head"><div><h2 id="d-title">${esc(r.name)}${r.tier === 'watchlist' ? ' <span class="wl">WATCHLIST</span>' : ''}</h2>` +
      `<p class="d-meta">Rank #${r.rank} of ${B.rows.length} · ${esc(r.category)} (${r.family} family) · ${r.chains.length} chain${r.chains.length > 1 ? 's' : ''}: ${esc(r.chains.slice(0, 4).join(', '))} · tracked since ${esc(r.listed_at || 'n/a')} · records no token on DefiLlama</p></div>` +
      `<div class="d-kpis"><div class="kpi"><span>TVL</span><b>${usd(r.tvl_usd)}</b></div><div class="kpi"><span>7d</span><b>${chg(r.change_7d)}</b></div><div class="kpi"><span>Odds · ${hLabel()}</span><b>${pct(r.odds)}</b></div>` +
      `<div class="kpi big"><span>Implied value</span><b>${usd(r.implied_value_usd)}</b><small>P25–P75 ${usd(r.p25_usd)}–${usd(r.p75_usd)}</small></div>` +
      `<div class="kpi"><span>Verdict</span><b class="pill ${vc(p.verdict)}">${p.verdict}${p.verdict === 'Farm from' ? ' ' + usd(p.breakeven) : ''}</b></div><button class="d-close" id="close" aria-label="Close">Esc ✕</button></div></div>` +
      `<div class="d-body"><div class="d-col"><section><h3>How the value is built</h3>` +
      `<table class="mini"><tbody>${terms}<tr class="sum"><td>= launch multiple (mcap/TVL if a token launches)</td><td class="r num">${r.multiple.toFixed(3)}</td></tr></tbody></table>` +
      `<p class="note">Multiple: tested held-out, not kept: ${esc(notKept)}. Odds use ${termList(EV.odds)} (each kept held-out): here ${mo(f.age)}, ${chg(r.change_7d)} in 7 days, ${r.family} family, ${usd(r.tvl_usd)}. In this snapshot, protocols whose TVL is growing record a token later (held-out tests keep this term).</p>` +
      `<div class="eq">${usd(r.tvl_usd)} TVL × ${r.multiple.toFixed(3)} = <b>${usd(r.launch_value_usd)}</b> if it launches<br>` +
      `token odds: peers like it record a token by ${mo(f.age)} in ${pct(F0)} of cases, by +${hLabel()} in ${pct(F1)}<br>` +
      `(${pct(F1)} − ${pct(F0)}) / (1 − ${pct(F0)}) = <b>${pct(r.odds)}</b> within ${hLabel()}<br>` +
      `${usd(r.launch_value_usd)} × ${pct(r.odds)} = <b>${usd(r.implied_value_usd)}</b> · P25–P75 ${usd(r.p25_usd)}–${usd(r.p75_usd)}<br>` +
      `<span class="${BJ[r.slug] && h === M.horizon_days ? (BJ[r.slug].v === r.implied_value_usd ? 'up">✓ equals board.json' : 'down">✗ differs from board.json') : 'muted">board.json is ranked at 12 mo'}</span></div></section>` +
      `<section><h3>Comparable traded protocols</h3><table class="mini"><thead><tr><th>Traded peer</th><th class="r">TVL</th><th class="r">Mcap</th><th class="r">Actual</th><th class="r">Fitted</th></tr></thead><tbody>${cmp}</tbody></table>` +
      `<p class="note">Actual mcap/TVL vs the model's held-out fit for that peer.</p></section></div>` +
      `<div class="d-col"><section><h3>Farm plan · $${p.deposit.toLocaleString('en-US')} ${p.verdict === 'Farm from' ? '(break-even deposit)' : '(your plan)'} · ${esc(p.chain)} at ~${usd(p.fee)} a transaction</h3>` +
      `<div class="plan-sum"><div><span>Expected reward</span><b>${usd(p.reward)}</b></div><div><span>Fees · ${p.tx} tx</span><b>−${usd(p.fees)}</b></div><div><span>Capital cost</span><b>−${usd(p.opp)}</b></div>` +
      `<div><span>Net</span><b>${money(p.net)}</b></div><div><span>Your time</span><b>${p.hours.toFixed(1)} h</b></div><div><span>Net / hour</span><b>${money(p.per_hour)}</b></div><div class="be"><span>Break-even deposit</span><b>${beText(p)}</b></div></div>` +
      (p.verdict === 'Farm' ? '' : `<p class="atplan">At your ${usd(OPT.plan)} plan: net ${money(p.at_plan.net)}, ${money(p.at_plan.per_hour)}/h${p.verdict === 'Skip' ? ` · nothing up to ${usd(M.max_deposit)} pays $${M.farm_per_hour}/h` : ''}</p>`) +
      `<p class="note">Reward = ${usd(r.launch_value_usd)} × ${pct(r.odds)} odds × ${S.share}% to users × ${usd(p.deposit)} / ${usd(r.tvl_usd)} TVL; capital cost ${pct(p.rate, 0)} a year (${r.family} family) for ${h} days. Reward and capital cost grow with the deposit, fees and time do not: from ${beText(p)} net clears $0 and $${M.farm_per_hour}/h.</p>` +
      `<table class="steps"><thead><tr><th>Day</th><th>Step and risk</th><th class="r">Cost</th><th class="r">Time</th></tr></thead><tbody>` +
      p.steps.map((st) => `<tr><td class="num">${st.day}</td><td>${esc(st.action)}<span class="risk">${esc(st.risk)}</span></td><td class="r num">${st.fee ? usd(st.fee) : '$0'}</td><td class="r num">${st.minutes} min</td></tr>`).join('') +
      `<tr class="sum"><td></td><td>Total over ${h} days</td><td class="r num">${usd(tot.fee)}</td><td class="r num">${(tot.min / 60).toFixed(1)} h</td></tr></tbody></table></section></div></div>`;
    box.hidden = false; scrim.hidden = false;
    $('close').onclick = closeDetail;
  }
  function closeDetail() { S.p = ''; writeHash(); renderDetail(); }

  // -- evidence
  function scatter() {
    var W = 560, H = 340, P = 44, lo = Math.log(0.002), hi = Math.log(20);
    var sx = (v) => P + (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * (W - P - 12), sy = (v) => H - P + 8 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * (H - P - 8);
    var ticks = [0.01, 0.1, 1, 10].map((t) => { var l = Math.log(t); return `<line x1="${sx(l)}" x2="${sx(l)}" y1="8" y2="${H - P + 8}" class="grid"/><line x1="${P}" x2="${W - 12}" y1="${sy(l)}" y2="${sy(l)}" class="grid"/><text x="${sx(l)}" y="${H - P + 26}">${t}</text><text x="${P - 6}" y="${sy(l) + 4}" class="ya">${t}</text>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="scatter" role="img" aria-label="Fitted against actual mcap/TVL for ${EV.traded_n} traded protocols">${ticks}` +
      `<line x1="${sx(lo)}" y1="${sy(lo)}" x2="${sx(hi)}" y2="${sy(hi)}" class="diag"/>` +
      EV.scatter.map((s) => `<circle cx="${sx(s[2]).toFixed(1)}" cy="${sy(s[1]).toFixed(1)}" r="4"><title>${esc(FX[s[0]].p.name)}: actual ${Math.exp(s[1]).toFixed(3)}, fitted ${Math.exp(s[2]).toFixed(3)}</title></circle>`).join('') +
      `<text x="${W / 2}" y="${H - 4}">fitted mcap/TVL, held out (log scale)</text><text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})">actual mcap/TVL</text></svg>`;
  }
  function renderEvidence() {
    var v = EV.value, o = EV.odds;
    var row = (s, a, b, base) => `<tr class="${s.kept ? 'kept' : 'dropped'}"><td>${s.term === 'base' ? base : esc(RM.TERM_LABEL[s.term] || s.term)}</td><td class="r num">${a}</td><td class="r num">${b}</td><td>${s.term === 'base' ? 'baseline' : s.kept ? '✓ kept' : 'tested, not kept'}</td></tr>`;
    var fees = Object.keys(RM.CHAIN_FEE_USD).map((c) => `<span>${esc(c)}<b class="num">$${RM.CHAIN_FEE_USD[c]}</b></span>`).join('');
    $('view-evidence').innerHTML = '<div class="ev">' +
      `<div class="card"><h2>Launch multiple: log(mcap/TVL) on ${EV.traded_n} traded protocols</h2><p>Terms join in a fixed order; one stays only if it lowers the typical held-out miss (median absolute log error, shown as ×k) in both tests. Ridge-shrunk; the intercept is moved so the median miss is zero.</p>` +
      `<table class="mini"><thead><tr><th>Term</th><th class="r">Leave-one-out</th><th class="r">Walk-forward</th><th>Result</th></tr></thead><tbody>` +
      v.map((s) => row(s, xk(s.loo_x), xk(s.wf_x), 'flat median')).join('') + '</tbody></table>' +
      `<p class="note">Walk-forward trains on protocols listed earlier and tests on the next ${M.wf_folds} blocks by listing date, starting at the ${pct(M.wf_start, 0)} mark.</p></div>` +
      `<div class="card"><h2>Token odds: does it record a token? ${EV.odds_n} protocols with a listing date</h2><p>Logistic regression; the base rate is ${pct(EV.base_rate)}. Brier score (lower is better) under the same two tests. Odds within the horizon: (F(age + h) − F(age)) / (1 − F(age)). In this snapshot, protocols whose TVL is growing record a token later (held-out tests keep this term).</p>` +
      `<table class="mini"><thead><tr><th>Term</th><th class="r">Leave-one-out</th><th class="r">Walk-forward</th><th>Result</th></tr></thead><tbody>` +
      o.map((s) => row(s, s.loo.toFixed(4), s.wf.toFixed(4), 'base rate')).join('') + '</tbody></table></div>' +
      `<div class="card"><h2>Fitted vs actual, each protocol held out</h2>${scatter()}<p class="note">P25–P75 band from a seeded residual bootstrap (${M.boot} refits, seed ${M.seed}): ${pct(EV.coverage, 0)} of held-out traded protocols land inside their own band.</p></div>` +
      `<div class="card"><h2>Farm assumptions</h2><p>Reward = launch value × odds × airdrop share × plan / TVL. Costs = the chain's fee × transactions, plus capital cost: 0% a year where the deposit keeps earning its own yield (${RM.EARNING.join(', ')} families: curators, allocators, yield, lending, CDP, RWA), ${pct(M.opp_rate, 0)} otherwise; adjustable above. Break-even deposit: the smallest deposit up to ${usd(M.max_deposit)} with net above $0 and at least $${M.farm_per_hour} per hour of your time. Farm: it is within your plan; Farm from $X: above it; Skip: none.</p><div class="fees">${fees}</div><p class="note">Other chains: $0.25 a transaction. Families group categories by keyword: ${RM.FAMILY_NAMES.join(', ')}.</p></div></div>`;
  }

  // -- wiring
  function render() {
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
    $('view-radar').hidden = S.tab !== 'radar'; $('view-evidence').hidden = S.tab !== 'evidence';
    renderTop(); syncFilters(); renderBoard(); renderDetail();
  }
  function set(k, v) { S[k] = v; if (['plan', 'share', 'h', 'opp'].indexOf(k) >= 0) rebuild(); writeHash(); render(); }
  readHash(); rebuild(); fillFilters(); renderEvidence();
  $('foot').textContent = `Snapshot ${D.as_of} · model ${M.version} · ${D.protocols.length} protocols · DefiLlama's record is not proof: a protocol that records no token may still have one. Implied values are this radar's claim, not make.fun's.`;
  $('tabs').onclick = (e) => { var b = e.target.closest('button'); if (b) set('tab', b.dataset.tab); };
  $('tiers').onclick = (e) => { var b = e.target.closest('button'); if (b) set('tier', b.dataset.tier); };
  var f = $('filters');
  f.oninput = (e) => { var t = e.target; if (t.name) set(t.name, t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value); };
  f.onsubmit = (e) => e.preventDefault();
  $('reset').onclick = () => { Object.keys(DEFAULTS).forEach((k) => { if (k !== 'tab') S[k] = DEFAULTS[k]; }); rebuild(); writeHash(); render(); };
  $('board').tHead.onclick = (e) => { var th = e.target.closest('th'); if (!th) return; if (S.sort === th.dataset.sort) S.dir = String(-S.dir); else { S.sort = th.dataset.sort; S.dir = th.dataset.sort === 'n' || th.dataset.sort === 'k' ? '1' : '-1'; } writeHash(); renderBoard(); };
  var open = (e) => { var tr = e.target.closest('tr[data-slug]'); if (tr) set('p', tr.dataset.slug); };
  $('board').tBodies[0].onclick = open;
  $('board').tBodies[0].onkeydown = (e) => { if (e.key === 'Enter') open(e); };
  $('scrim').onclick = closeDetail;
  document.onkeydown = (e) => { if (e.key === 'Escape' && S.p) closeDetail(); };
  window.onhashchange = () => { readHash(); rebuild(); render(); };
  render();
})();
