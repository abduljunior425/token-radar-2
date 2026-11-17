// Token Radar's page (radar-3). It reads window.RADAR — written beside
// dashboard/ by main.ts — and renders the ranked board, a filterable table
// and a per-protocol drawer with the model's own breakdown and farm plan.
// No network: every byte shown is in data.js. The page recomputes each row
// from the snapshot figures with the same radar-3 function main.ts runs, so
// the code and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var root = document.getElementById('radar');
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, picked: null };
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function chainText(p) {
    return p.chains && p.chains.length ? p.chains.join(', ') : 'an unnamed chain';
  }

  // radar-3, as the page recomputes it: concave size, a saturating tanh
  // momentum, a square-root tenure with a young-protocol penalty, and a
  // logarithmic chain breadth. The detail drawer shows the recomputed
  // number next to the board's, so a stale board would show up at once.
  function recompute(row, tune) {
    var move = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    move = Math.min(tune.momentum_high, Math.max(tune.momentum_low, move));
    var momentum = 1 + tune.momentum_gain * Math.tanh(move / tune.momentum_span);
    var age = row.age_days === null || row.age_days === undefined ? tune.unknown_age : row.age_days;
    var tenure = tune.tenure_floor + tune.tenure_span * Math.sqrt(Math.min(Math.max(age, 0), tune.tenure_days) / tune.tenure_days);
    var young = (row.age_days === null || row.age_days === undefined) ? 1 : (row.age_days < tune.young_age ? tune.young_factor : 1);
    var breadth = Math.min(1 + tune.breadth_step * Math.log(Math.max((row.chains || []).length, 1)), tune.breadth_cap);
    var size = Math.pow(row.tvl_usd / 1e6, tune.size_exponent);
    return {
      move: move,
      momentum: momentum,
      tenure: tenure,
      young: young,
      breadth: breadth,
      size: size,
      implied: Math.max(1, Math.round(tune.scale * size * momentum * tenure * young * breadth))
    };
  }

  // The farm plan is the same derivation main.ts writes into board.json:
  // category, chains, TVL and the week's move decide the deed, the ticket,
  // the stay and every cost and time. No name is special-cased, and no step
  // claims a token or an airdrop the snapshot does not record.
  function homeChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its home chain'; }
  function nextChain(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function ticket(p) {
    if (p.tvl_usd >= 1e9) return 300;
    if (p.tvl_usd >= 1e8) return 150;
    return 75;
  }
  function stay(move) { return move > 0 ? 90 : move < 0 ? 45 : 60; }
  var DEEDS = [
    { hints: ['lend', 'cdp', 'collateral'], deed: function (name, t, chain) { return 'Lend $' + t + ' of USDC on ' + name + ' (' + chain + ') and open a small borrow against it to show both sides of the book.'; } },
    { hints: ['dex', 'yield', 'leveraged farm'], deed: function (name, t, chain) { return 'Add $' + t + ' of liquidity to the deepest pool on ' + name + ' (' + chain + ') and leave the position in range.'; } },
    { hints: ['derivative', 'perpetual'], deed: function (name, t, chain) { return 'Post $' + t + ' of USDC as margin on ' + name + ' (' + chain + ') and hold one small hedged position instead of a directional bet.'; } },
    { hints: ['staking', 'restak'], deed: function (name, t, chain) { return 'Stake $' + t + ' through ' + name + ' on ' + chain + ' and keep the receipt token in the same wallet.'; } },
    { hints: ['rwa'], deed: function (name, t, chain) { return 'Buy $' + t + ' of the tokenised yield asset ' + name + ' offers on ' + chain + ' and hold it in the farming wallet.'; } },
    { hints: ['stablecoin wrapper', 'stable'], deed: function (name, t, chain) { return 'Mint $' + t + ' of the stable asset through ' + name + ' on ' + chain + ' and keep it parked there.'; } },
    { hints: ['basis'], deed: function (name, t, chain) { return 'Place $' + t + ' of USDC in a ' + name + ' basis vault on ' + chain + ' and leave the shares untouched.'; } },
    { hints: ['curator', 'allocator', 'risk'], deed: function (name, t, chain) { return 'Allocate $' + t + ' to a vault ' + name + ' curates on ' + chain + ' and keep the vault shares.'; } },
    { hints: ['prediction'], deed: function (name, t, chain) { return 'Fund ' + name + ' with $' + t + ' and take one small position on a market that settles within the month.'; } },
    { hints: ['payment'], deed: function (name, t, chain) { return 'Send $' + t + " through " + name + "'s rails on " + chain + ' for a real payment, and keep the receipt.'; } },
    { hints: ['governance'], deed: function (name, t, chain) { return 'Deposit $' + t + ' with ' + name + ' on ' + chain + ' and cast one vote in an open proposal.'; } },
    { hints: ['insurance'], deed: function (name, t, chain) { return 'Buy $' + t + ' of cover from ' + name + ' on ' + chain + ' for the position you already hold.'; } },
    { hints: ['chain'], deed: function (name, t, chain) { return 'Bridge $' + t + " of USDC into " + chain + " through the chain's own bridge and put it to work in one core app there."; } },
    { hints: ['cedefi'], deed: function (name, t, chain) { return 'Deposit $' + t + ' of USDC in a ' + name + ' vault on ' + chain + ' and keep the shares.'; } }
  ];
  function coreDeed(p, t, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < DEEDS.length; i++) {
      var rule = DEEDS[i];
      if (rule.hints.some(function (h) { return c.indexOf(h) >= 0; })) return rule.deed(p.name, t, chain);
    }
    return 'Deposit $' + t + ' of USDC into ' + p.name + ' on ' + chain + ' and leave the position open.';
  }
  function plan(p) {
    var chain = homeChain(p);
    var chain2 = nextChain(p);
    var t = ticket(p);
    var move = p.change_7d === null || p.change_7d === undefined ? 0 : p.change_7d;
    var stayDays = stay(move);
    var ageNote = p.age_days === null || p.age_days === undefined ? 'with no listing date on record' : 'listed ' + p.age_days + ' days before the snapshot';
    var spread = chain2 !== null
      ? { deed: 'Mirror the core position on ' + chain2 + ', so the farm spans two chains and is not a single-chain footprint.', cost: 'about $5 of gas for the mirror position', span: '15 minutes' }
      : { deed: 'Add a second kind of activity the protocol supports — a swap, a vote or a second deposit — so the wallet is not a one-transaction record.', cost: 'about $2 of gas for the second activity', span: '10 minutes' };
    var steps = [
      { deed: 'Open a fresh wallet holding only the funds you will farm with, and store its seed phrase offline, away from the machine.', cost: 'under $3 of gas for the first transaction', span: '10 minutes' },
      { deed: coreDeed(p, t, chain), cost: '$' + t + ' of capital and about $' + (t >= 300 ? 10 : 5) + ' of gas', span: '20 minutes to set up' },
      spread,
      { deed: 'Return once a week and repeat one qualifying action — a deposit, a borrow, a swap or a vote — so the wallet stays active.', cost: 'about $2 of gas a week', span: '10 minutes a week' },
      { deed: 'Keep a farm log: the wallet, the dates, every transaction hash, and the protocol as it stood (' + ageNote + ').', cost: 'nothing but the log', span: '5 minutes a week' },
      { deed: 'Stay in the position for at least ' + stayDays + ' days, so the activity covers more than one monthly snapshot.', cost: 'the $' + t + ' stays in the position', span: stayDays + ' days' },
      { deed: "Check the protocol's own site for a points or rewards page, and claim only from a link that site itself publishes.", cost: 'no fee to check, and never pay to claim', span: '10 minutes' },
      { deed: 'Unwind in reverse: close the mirror position first, then the core one, and keep the log so the whole farm can be repeated or audited.', cost: 'about $5 of gas to exit', span: '15 minutes' }
    ];
    return steps.map(function (s) {
      var out = s.deed + ' Cost: ' + s.cost + '. Time: ' + s.span + '.';
      if (out.length > 600) out = out.slice(0, 596) + '...';
      if (out.length < 20) out = out + " Keep the position open and check the protocol's own page.";
      return out;
    });
  }

  function onWatch(r) { return !!WATCH[r.slug]; }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlist && !onWatch(r)) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function ordered(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.picked = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist') === '1') state.watchlist = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.picked) params.set('p', state.picked);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function masthead() {
    return '<header class="masthead"><div class="wordmark"><span class="dot"></span><span>Token Radar</span></div>' +
      '<div class="meta"><span>Snapshot ' + esc(DATA.as_of) + '</span><span>DefiLlama protocol index</span><span>' + esc(DATA.model_version) + ' model</span></div></header>';
  }
  function hero() {
    return '<section class="hero"><div><h1>' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The radar adds ' + DATA.early_size + ' more launch candidates — below the floor and above it — and sets aside wrapped, staked and bridged products of tokens that already trade. Implied value is a model, not a promise.</p></div>' +
      '<div class="tiles">' +
      '<div class="tile"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="tile"><span>Candidates ranked</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="tile"><span>Beyond the watchlist</span><b>' + DATA.early_size + '</b></div>' +
      '<div class="tile"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>' +
      '</div></section>';
  }
  function leaders() {
    var cards = DATA.rows.slice(0, 3).map(function (r) {
      return '<button type="button" class="leader" data-slug="' + esc(r.slug) + '">' +
        '<span class="place">Rank ' + r.rank + '</span><b>' + esc(r.name) + '</b>' +
        '<span class="worth">' + money(r.implied_value_usd) + ' implied</span>' +
        '<span class="info">' + esc(r.category || 'Other') + ' · TVL ' + money(r.tvl_usd) + ' · ' + pct(r.change_7d) + ' in 7d</span></button>';
    }).join('');
    return '<section class="leaders" aria-label="Top three by implied value">' + cards + '</section>';
  }
  function toolbar() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var catOpts = ['<option value="all">All categories</option>'].concat(cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var chainOpts = ['<option value="all">All chains</option>'].concat(chains.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    return '<div class="toolbar">' +
      '<div class="box"><label for="q">Search</label><input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="box"><label for="category">Category</label><select id="category" aria-label="Filter by category">' + catOpts + '</select></div>' +
      '<div class="box"><label for="chain">Chain</label><select id="chain" aria-label="Filter by chain">' + chainOpts + '</select></div>' +
      '<label class="toggle"><input type="checkbox" id="watchlist" aria-label="Watchlist only"' + (state.watchlist ? ' checked' : '') + '>Watchlist only</label>' +
      '<div class="box"><span class="fine">Token status</span><div class="switcher">' +
      '<button type="button" id="tab-pre" aria-pressed="' + (state.tab === 'pre-token') + '">Pre-token</button>' +
      '<button type="button" id="tab-live" aria-pressed="' + (state.tab === 'live') + '">Live token</button></div></div>' +
      '<span class="shown">' + (state.tab === 'pre-token' ? filtered().length + ' rows shown' : DATA.live.length + ' live-token protocols') + '</span></div>';
  }
  function sortHead(key, label) {
    var mark = state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : '';
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + label + esc(mark) + '</button></th>';
  }
  function boardTable() {
    var list = ordered(filtered());
    if (list.length === 0) {
      return '<div class="sheet"><div class="no-match"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category to see the board again.</p>' +
        '<button class="btn solid" type="button" id="clear-filters">Clear filters</button></div></div>';
    }
    var max = (list[0] && list[0].implied_value_usd) || 1;
    var rowsHtml = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var cls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var width = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" aria-selected="' + (state.picked === r.slug) + '" tabindex="0">' +
        '<td><span class="pos-num' + (r.rank <= 3 ? ' top3' : '') + '">' + r.rank + '</span></td>' +
        '<td><div class="who"><b>' + esc(r.name) + '</b><span class="fine">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + (onWatch(r) ? ' · watchlist' : '') + '</span></div></td>' +
        '<td class="fig">' + money(r.tvl_usd) + '</td>' +
        '<td class="fig ' + cls + '">' + growth + '</td>' +
        '<td class="fig">' + ageText(r.age_days) + '</td>' +
        '<td><div class="worth-cell"><div class="gauge" aria-hidden="true"><i style="width:' + width + '%"></i></div><span class="fig">' + money(r.implied_value_usd) + '</span></div></td>' +
        '<td><span class="tag">no token</span></td></tr>';
    }).join('');
    return '<div class="sheet"><div class="scroller"><table>' +
      '<caption class="fine">Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</caption>' +
      '<thead><tr>' + sortHead('rank', 'Rank') + sortHead('name', 'Protocol') + sortHead('tvl', 'TVL') + sortHead('growth', '7d') + sortHead('age', 'Age') + sortHead('implied', 'Implied value') + '<th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }
  function liveTable() {
    var rowsHtml = DATA.live.map(function (r) {
      return '<tr><td class="fig">live</td>' +
        '<td><div class="who"><b>' + esc(r.name) + '</b><span class="fine">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="fig">' + money(r.tvl_usd) + '</td>' +
        '<td class="fig ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="fig">' + money(r.mcap_usd) + '</td>' +
        '<td><span class="tag traded">already trades</span></td></tr>';
    }).join('');
    return '<div class="sheet"><div class="scroller"><table>' +
      '<caption class="fine">Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function howPanel() {
    var t = DATA.tune;
    return '<section class="sheet how"><h2>How implied value is computed</h2>' +
      '<p class="fine">Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.</p>' +
      '<div class="math">implied = round( ' + t.scale.toLocaleString('en-US') + ' x (tvl_usd / 1,000,000) ^ ' + t.size_exponent + ' x momentum x tenure x young x breadth )\n' +
      'momentum = 1 + ' + t.momentum_gain + ' x tanh(clamp(change_7d, ' + t.momentum_low + ', ' + t.momentum_high + ') / ' + t.momentum_span + ')\n' +
      'tenure = ' + t.tenure_floor + ' + ' + t.tenure_span + ' x sqrt(min(age_days, ' + t.tenure_days + ') / ' + t.tenure_days + ')\n' +
      'young = ' + t.young_factor + ' when age_days &lt; ' + t.young_age + ', else 1.00\n' +
      'breadth = min(1 + ' + t.breadth_step + ' x ln(chains), ' + t.breadth_cap + ')</div>' +
      '<p class="fine">Size is concave: doubling TVL adds less than double the value, so a mid-size protocol with a hot week can outrank a giant that is flat. Momentum saturates — a wild week, up or down, moves the value by at most 45% — because the hundredth percent of growth says less than the first. Tenure climbs with the square root of age over three years, and a protocol listed less than a quarter ago pays a young penalty for not yet showing it can hold its TVL. Breadth is a logarithm of the chain count: the second chain matters far more than the twentieth. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + t.unknown_age + ' days.</p></section>';
  }
  function smallprint() {
    return '<p class="smallprint">Implied value is this radar\u2019s own claim from the snapshot\u2019s figures: it is not a price, a prediction that a token will launch, or a promise of an airdrop. A protocol records no token when the snapshot carries no market cap, CoinGecko id or symbol for it; that is the record, not proof it has none. Data: the sealed DefiLlama snapshot of ' + esc(DATA.as_of) + '.</p>';
  }

  var drawer = document.createElement('dialog');
  drawer.className = 'drawer';
  drawer.id = 'drawer';
  drawer.setAttribute('aria-labelledby', 'drawer-title');
  drawer.addEventListener('close', function () { state.picked = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.picked = slug;
    writeHash();
    var again = recompute(row, DATA.tune);
    var steps = plan(row);
    var stepsHtml = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var deed = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(deed) + '</b><span class="price">' + esc(tail) + '</span></li>';
    }).join('');
    drawer.innerHTML =
      '<div class="drawer-top"><div><span class="fine">Rank ' + row.rank + ' of ' + DATA.board_size + (onWatch(row) ? ' · watchlist' : ' · candidate') + '</span>' +
      '<h2 id="drawer-title">' + esc(row.name) + '</h2>' +
      '<p class="fine">' + esc(row.category || 'Other') + ' on ' + esc(chainText(row)) + '</p></div>' +
      '<button class="shut" type="button" aria-label="Close details" id="drawer-close">Close</button></div>' +
      '<section class="drawer-part"><h3>Implied value</h3><div class="breakdown">' +
      '<div><span>TVL</span><b>' + money(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day move</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b>' + ageText(row.age_days) + '</b></div>' +
      '<div><span>Chains</span><b>' + (row.chains || []).length + '</b></div>' +
      '<div><span>Concave size</span><b>' + again.size.toFixed(2) + '</b></div>' +
      '<div><span>Momentum</span><b>' + again.momentum.toFixed(4) + '</b></div>' +
      '<div><span>Tenure</span><b>' + again.tenure.toFixed(4) + '</b></div>' +
      '<div><span>Young factor</span><b>' + again.young.toFixed(2) + '</b></div>' +
      '<div><span>Breadth</span><b>' + again.breadth.toFixed(4) + '</b></div>' +
      '<div class="sum"><span>Implied value</span><b>' + money(row.implied_value_usd) + '</b></div>' +
      '</div><p class="fine">Model ' + esc(DATA.model_version) + ': the same function scores every protocol. The page recomputes this row as ' + money(again.implied) + (again.implied === row.implied_value_usd ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.</p></section>' +
      '<section class="drawer-part"><h3>Farm plan</h3><ol class="plan">' + stepsHtml + '</ol></section>' +
      '<div class="caveat">This protocol records no token in the snapshot: no market cap, no CoinGecko id, no symbol. That is the record, not proof it has none, and no step above claims a confirmed airdrop.</div>';
    var closeBtn = drawer.querySelector('#drawer-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { drawer.close(); });
    if (typeof drawer.showModal === 'function') {
      if (!drawer.open) drawer.showModal();
    } else {
      drawer.setAttribute('open', '');
    }
  }

  function paint() {
    root.innerHTML = '<div class="wrap">' + masthead() + hero() + leaders() + toolbar() +
      (state.tab === 'pre-token' ? boardTable() : liveTable()) +
      (state.tab === 'pre-token' ? howPanel() : '') + smallprint() + '</div>';
    root.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) root.appendChild(drawer);
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; writeHash(); paint(); });
    var cat = document.getElementById('category');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; writeHash(); paint(); });
    var ch = document.getElementById('chain');
    if (ch) ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); paint(); });
    var wl = document.getElementById('watchlist');
    if (wl) wl.addEventListener('change', function () { state.watchlist = wl.checked; writeHash(); paint(); });
    var tp = document.getElementById('tab-pre');
    if (tp) tp.addEventListener('click', function () { state.tab = 'pre-token'; paint(); });
    var tl = document.getElementById('tab-live');
    if (tl) tl.addEventListener('click', function () { state.tab = 'live'; paint(); });
    var clear = document.getElementById('clear-filters');
    if (clear) clear.addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); paint(); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-sort]'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        paint();
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-slug]'), function (node) {
      node.addEventListener('click', function () { openDetail(node.getAttribute('data-slug')); });
      node.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(node.getAttribute('data-slug')); }
      });
    });
    if (state.picked) openDetail(state.picked);
  }

  readHash();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.open) drawer.close();
  });
})();
