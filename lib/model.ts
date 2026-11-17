// radar-3: a second token-launch radar for token-radar-01.
//
// Same sealed snapshot in, a different ranking out. Where radar-2 multiplied TVL
// by a straight quarter and let a week's growth move the value linearly, radar-3
// treats size as concave, momentum as saturating, tenure as a square-root curve
// with a penalty for the very young, and chain spread as a logarithm. The board
// also draws a tighter line around what counts as a launch candidate: wrapped,
// staked and bridged products of tokens that already trade are set aside, not
// ranked as if they were waiting for a first token.
//
// A protocol is a candidate when the snapshot records no token for it at all —
// no market cap, no CoinGecko id, no symbol — and it is not a bridge, a staking
// or restaking product, a CEX, or a versioned pool of another protocol. The
// watchlist is the floor: all forty of its slugs are ranked whatever else the
// filter says. Everything else on the board is a candidate the radar found
// below, or above, that floor.
//
// Implied value, radar-3:
//
//   size     = (tvl_usd / 1_000_000) ^ 0.8            (concave: doubling TVL
//                                                      adds less than double)
//   momentum = 1 + 0.45 * tanh(clamp(change_7d, -90, 200) / 45)
//                                                      (saturating and
//                                                      symmetric: a wild week,
//                                                      up or down, can move
//                                                      the value by at most
//                                                      45%, and the hundredth
//                                                      percent of growth
//                                                      matters less than the
//                                                      first)
//   tenure   = 0.70 + 0.30 * sqrt(min(age_days, 1095) / 1095)
//                                                      (square root over
//                                                      three years; unknown
//                                                      age counts as 180 days)
//   young    = 0.88 when age_days < 90, else 1.00     (a protocol listed
//                                                      less than a quarter
//                                                      ago has not yet shown
//                                                      it can hold its TVL)
//   breadth  = min(1 + 0.10 * ln(chain_count), 1.30)   (log spread: the
//                                                      second chain matters
//                                                      more than the twentieth)
//   implied  = max(1, round(1_000_000 * size * momentum * tenure * young * breadth))
//
// No name is ever special-cased. One function scores every row, and the
// dashboard recomputes each row with the same function, so the page and the
// board can be checked against each other.

/** One protocol as the sealed snapshot records it: its ten fields, nothing more. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document: date, origin, floor, protocols, watchlist. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** radar-3's constants. The dashboard prints them next to the formula. */
export interface Tune {
  scale: number; // dollars per unit of concave size
  size_exponent: number; // TVL's exponent: below 1, size is concave
  momentum_gain: number; // how far momentum can move the value
  momentum_span: number; // the weekly move, in percent, that half-saturates it
  momentum_low: number; // the worst weekly move the model credits
  momentum_high: number; // the best weekly move the model credits
  tenure_floor: number; // where tenure starts, on listing day
  tenure_span: number; // what three years of running adds
  tenure_days: number; // tenure stops growing after this many days
  unknown_age: number; // the age counted when no listing date is known
  young_age: number; // below this age a protocol pays the young penalty
  young_factor: number; // the young penalty itself
  breadth_step: number; // breadth per unit of ln(chain count)
  breadth_cap: number; // breadth never exceeds this
}

export const TUNE: Tune = {
  scale: 1_000_000,
  size_exponent: 0.8,
  momentum_gain: 0.45,
  momentum_span: 45,
  momentum_low: -90,
  momentum_high: 200,
  tenure_floor: 0.7,
  tenure_span: 0.3,
  tenure_days: 1095,
  unknown_age: 180,
  young_age: 90,
  young_factor: 0.88,
  breadth_step: 0.1,
  breadth_cap: 1.3,
};

/** The model label the dashboard and the board carry. */
export const MODEL_NAME = 'radar-3';

/** How many already-trading protocols the dashboard's Live tab lists. */
export const LIVE_COUNT = 24;

/** A farm-plan step: the deed, its cost, its duration. */
export interface Step {
  deed: string;
  cost: string;
  span: string;
}

/** One ranked board row. */
export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_base: number;
    momentum_pct: number;
    momentum_factor: number;
    tenure_factor: number;
    young_factor: number;
    breadth_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's slim copy of a row; the page rebuilds the plan itself. */
export interface SlimRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  momentum_factor: number;
  tenure_factor: number;
  young_factor: number;
  breadth_factor: number;
}

/** An already-trading protocol, shown with its market cap, never modelled. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface BoardData {
  as_of: string;
  source: string;
  floor_usd: number;
  tune: Tune;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: SlimRow[];
  live: LiveRow[];
}

/** A snapshot that cannot be scored. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, or `fallback` when the value is not one. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when either is missing or unparsable. */
export function daysListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** A number to four decimals, for the factors the board and the page carry. */
function four(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** The week's move in percent, clamped to what the model credits; null counts as flat. */
function weeklyMove(change7d: number | null, tune: Tune): number {
  const raw = finiteOr(change7d, 0);
  return Math.min(tune.momentum_high, Math.max(tune.momentum_low, raw));
}

/** Momentum: 1 plus a saturating gain. tanh keeps a +4000% week from
 *  pretending to be forty times better than a +40% week, and treats a fall
 *  with the same curve as a rise — the asymmetry lives in the data, not in
 *  a second weight. */
function momentumFactor(movePct: number, tune: Tune): number {
  return 1 + tune.momentum_gain * Math.tanh(movePct / tune.momentum_span);
}

/** Tenure: a square-root climb from the floor toward 1 over three years. */
function tenureFactor(age: number | null, tune: Tune): number {
  const days = age ?? tune.unknown_age;
  const capped = Math.min(Math.max(days, 0), tune.tenure_days);
  return tune.tenure_floor + tune.tenure_span * Math.sqrt(capped / tune.tenure_days);
}

/** The young penalty: under three months listed, the protocol has not yet
 *  shown it can hold its TVL through a quarter. */
function youngFactor(age: number | null, tune: Tune): number {
  if (age === null) return 1;
  return age < tune.young_age ? tune.young_factor : 1;
}

/** Breadth: a logarithm of the chain count, capped — the second chain is
 *  worth far more than the twentieth. */
function breadthFactor(chainCount: number, tune: Tune): number {
  return Math.min(1 + tune.breadth_step * Math.log(Math.max(chainCount, 1)), tune.breadth_cap);
}

/** radar-3's score for one protocol: every factor, and the implied value. */
export function scoreProto(
  p: Proto,
  asOf: string,
  tune: Tune,
): { implied: number; movePct: number; momentum: number; tenure: number; young: number; breadth: number; age: number | null; sizeBase: number } {
  const age = daysListed(asOf, p.listed_at);
  const movePct = weeklyMove(p.change_7d, tune);
  const momentum = momentumFactor(movePct, tune);
  const tenure = tenureFactor(age, tune);
  const young = youngFactor(age, tune);
  const breadth = breadthFactor(p.chains.length, tune);
  const sizeBase = Math.pow(p.tvl_usd / 1_000_000, tune.size_exponent);
  const implied = Math.max(1, Math.round(tune.scale * sizeBase * momentum * tenure * young * breadth));
  return { implied, movePct, momentum, tenure, young, breadth, age, sizeBase };
}

/** A name ending in a version marker is a pool of another protocol, not a launch of its own. */
const VERSION_END = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked, bridged or exchange product of a
 *  token that already trades — set aside, never ranked as a first token. */
const SIDELINED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** The snapshot records no token for this protocol at all. */
export function recordsNoToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A launch candidate: no token on record, not a sidelined category, not a versioned pool. */
export function isCandidate(p: Proto): boolean {
  return recordsNoToken(p) && !SIDELINED_CATEGORIES.has(p.category ?? '') && !VERSION_END.test(p.name);
}

/** The board: the whole watchlist first, then every other candidate, strongest implied value first. */
export function buildBoard(snap: Snap, tune: Tune = TUNE): Row[] {
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, Proto>();
  for (const slug of snap.watchlist) {
    const found = bySlug.get(slug);
    if (found !== undefined) picked.set(slug, found);
  }
  for (const p of snap.protocols) {
    if (!picked.has(p.slug) && isCandidate(p)) picked.set(p.slug, p);
  }
  const scored = [...picked.values()].map((p) => ({ p, s: scoreProto(p, snap.as_of, tune) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((item, i) => ({
    rank: i + 1,
    slug: item.p.slug,
    name: item.p.name,
    category: item.p.category,
    chains: item.p.chains,
    tvl_usd: item.p.tvl_usd,
    change_7d: item.p.change_7d,
    mcap_usd: item.p.mcap_usd,
    listed_at: item.p.listed_at,
    gecko_id: item.p.gecko_id,
    symbol: item.p.symbol,
    token_status: 'pre-token' as const,
    age_days: item.s.age,
    implied_value_usd: item.s.implied,
    model: {
      size_base: four(item.s.sizeBase),
      momentum_pct: item.s.movePct,
      momentum_factor: four(item.s.momentum),
      tenure_factor: four(item.s.tenure),
      young_factor: item.s.young,
      breadth_factor: four(item.s.breadth),
      age_days: item.s.age,
    },
    farm_steps: planSteps(item.p, item.s.age, item.s.movePct).map(joinStep),
  }));
}

/** The already-trading protocols, by market cap, for the Live tab. */
export function liveList(snap: Snap): LiveRow[] {
  return snap.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_COUNT)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** A board row slimmed for data.js; the page rebuilds the farm plan from the same rules. */
export function slimRow(row: Row): SlimRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    momentum_factor: row.model.momentum_factor,
    tenure_factor: row.model.tenure_factor,
    young_factor: row.model.young_factor,
    breadth_factor: row.model.breadth_factor,
  };
}

/** Board plus live set plus model, for the dashboard. */
export function buildRadar(snap: Snap, tune: Tune = TUNE): { board: Row[]; data: BoardData } {
  const board = buildBoard(snap, tune);
  const live = liveList(snap);
  const early = board.filter((row) => !snap.watchlist.includes(row.slug)).length;
  const data: BoardData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    tune,
    model_version: MODEL_NAME,
    watchlist: snap.watchlist,
    watchlist_size: snap.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(slimRow),
    live,
  };
  return { board, data };
}

/** The first chain a protocol lists, or a neutral fallback. */
function homeChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** A second chain when the protocol runs on more than one. */
function secondChain(p: Proto): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** Capital bands by TVL, biggest first: larger protocols earn a larger ticket. */
const CAPITAL_BANDS: Array<[number, number]> = [
  [1_000_000_000, 300],
  [100_000_000, 150],
];

/** The ticket for one farm position, from the protocol's own TVL. */
function ticketSize(p: Proto): number {
  for (const [floor, size] of CAPITAL_BANDS) if (p.tvl_usd >= floor) return size;
  return 75;
}

/** How long to stay in: a growing week earns the longest stay, a shrinking
 *  week the shortest — the plan leans into momentum instead of fighting it. */
function stayDays(movePct: number): number {
  if (movePct > 0) return 90;
  if (movePct < 0) return 45;
  return 60;
}

/** One category's core deed, tried in order; the first match wins. */
interface DeedRule {
  hints: string[];
  deed: (name: string, ticket: number, chain: string) => string;
}

const DEED_RULES: DeedRule[] = [
  { hints: ['lend', 'cdp', 'collateral'], deed: (name, ticket, chain) => 'Lend $' + ticket + ' of USDC on ' + name + ' (' + chain + ') and open a small borrow against it to show both sides of the book.' },
  { hints: ['dex', 'yield', 'leveraged farm'], deed: (name, ticket, chain) => 'Add $' + ticket + ' of liquidity to the deepest pool on ' + name + ' (' + chain + ') and leave the position in range.' },
  { hints: ['derivative', 'perpetual'], deed: (name, ticket, chain) => 'Post $' + ticket + ' of USDC as margin on ' + name + ' (' + chain + ') and hold one small hedged position instead of a directional bet.' },
  { hints: ['staking', 'restak'], deed: (name, ticket, chain) => 'Stake $' + ticket + ' through ' + name + ' on ' + chain + ' and keep the receipt token in the same wallet.' },
  { hints: ['rwa'], deed: (name, ticket, chain) => 'Buy $' + ticket + ' of the tokenised yield asset ' + name + ' offers on ' + chain + ' and hold it in the farming wallet.' },
  { hints: ['stablecoin wrapper', 'stable'], deed: (name, ticket, chain) => 'Mint $' + ticket + ' of the stable asset through ' + name + ' on ' + chain + ' and keep it parked there.' },
  { hints: ['basis'], deed: (name, ticket, chain) => 'Place $' + ticket + ' of USDC in a ' + name + ' basis vault on ' + chain + ' and leave the shares untouched.' },
  { hints: ['curator', 'allocator', 'risk'], deed: (name, ticket, chain) => 'Allocate $' + ticket + ' to a vault ' + name + ' curates on ' + chain + ' and keep the vault shares.' },
  { hints: ['prediction'], deed: (name, ticket, chain) => 'Fund ' + name + ' with $' + ticket + ' and take one small position on a market that settles within the month.' },
  { hints: ['payment'], deed: (name, ticket, chain) => 'Send $' + ticket + ' through ' + name + "'s rails on " + chain + ' for a real payment, and keep the receipt.' },
  { hints: ['governance'], deed: (name, ticket, chain) => 'Deposit $' + ticket + ' with ' + name + ' on ' + chain + ' and cast one vote in an open proposal.' },
  { hints: ['insurance'], deed: (name, ticket, chain) => 'Buy $' + ticket + ' of cover from ' + name + ' on ' + chain + ' for the position you already hold.' },
  { hints: ['chain'], deed: (name, ticket, chain) => 'Bridge $' + ticket + ' of USDC into ' + chain + " through the chain's own bridge and put it to work in one core app there." },
  { hints: ['cedefi'], deed: (name, ticket, chain) => 'Deposit $' + ticket + ' of USDC in a ' + name + ' vault on ' + chain + ' and keep the shares.' },
];

/** The core deed for a protocol's category, or a plain deposit when nothing matches. */
function coreDeed(p: Proto, ticket: number, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  for (const rule of DEED_RULES) {
    if (rule.hints.some((h) => cat.includes(h))) return rule.deed(p.name, ticket, chain);
  }
  return 'Deposit $' + ticket + ' of USDC into ' + p.name + ' on ' + chain + ' and leave the position open.';
}

/**
 * An eight-step farm plan, derived from the protocol's own record — category,
 * chains, TVL and weekly move — never from a list of names, and never
 * claiming a token, an airdrop or a points programme the snapshot does not record.
 */
export function planSteps(p: Proto, age: number | null, movePct: number): Step[] {
  const chain = homeChain(p);
  const chain2 = secondChain(p);
  const ticket = ticketSize(p);
  const stay = stayDays(movePct);
  const ageNote = age === null ? 'with no listing date on record' : 'listed ' + age + ' days before the snapshot';
  const spread: Step =
    chain2 !== null
      ? { deed: 'Mirror the core position on ' + chain2 + ', so the farm spans two chains and is not a single-chain footprint.', cost: 'about $5 of gas for the mirror position', span: '15 minutes' }
      : { deed: 'Add a second kind of activity the protocol supports — a swap, a vote or a second deposit — so the wallet is not a one-transaction record.', cost: 'about $2 of gas for the second activity', span: '10 minutes' };
  const steps: Step[] = [
    { deed: 'Open a fresh wallet holding only the funds you will farm with, and store its seed phrase offline, away from the machine.', cost: 'under $3 of gas for the first transaction', span: '10 minutes' },
    { deed: coreDeed(p, ticket, chain), cost: '$' + ticket + ' of capital and about $' + (ticket >= 300 ? 10 : 5) + ' of gas', span: '20 minutes to set up' },
    spread,
    { deed: 'Return once a week and repeat one qualifying action — a deposit, a borrow, a swap or a vote — so the wallet stays active.', cost: 'about $2 of gas a week', span: '10 minutes a week' },
    { deed: 'Keep a farm log: the wallet, the dates, every transaction hash, and the protocol as it stood (' + ageNote + ').', cost: 'nothing but the log', span: '5 minutes a week' },
    { deed: 'Stay in the position for at least ' + stay + ' days, so the activity covers more than one monthly snapshot.', cost: 'the $' + ticket + ' stays in the position', span: stay + ' days' },
    { deed: "Check the protocol's own site for a points or rewards page, and claim only from a link that site itself publishes.", cost: 'no fee to check, and never pay to claim', span: '10 minutes' },
    { deed: 'Unwind in reverse: close the mirror position first, then the core one, and keep the log so the whole farm can be repeated or audited.', cost: 'about $5 of gas to exit', span: '15 minutes' },
  ];
  return steps;
}

/** A step as one string: deed, cost, span — inside the gate's 20..600 characters. */
export function joinStep(step: Step): string {
  let out = step.deed + ' Cost: ' + step.cost + '. Time: ' + step.span + '.';
  if (out.length > 600) out = out.slice(0, 596) + '...';
  if (out.length < 20) out = out + " Keep the position open and check the protocol's own page.";
  return out;
}

/** Refuse with `message`, always throwing. */
function refuse(message: string): never {
  throw new SnapError(message);
}

/** A string field, or null when the record holds something else. */
function maybeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A finite number field, or null when the record holds something else. */
function maybeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A string-list field, keeping only its string entries. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

/** One protocol out of the snapshot's raw record. */
function readProto(value: unknown, i: number): Proto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) refuse(`snapshot.json's protocol ${i} is not an object`);
  const rec = value as Record<string, unknown>;
  if (typeof rec.slug !== 'string' || typeof rec.name !== 'string' || typeof rec.tvl_usd !== 'number' || !Number.isFinite(rec.tvl_usd)) {
    refuse(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  return {
    slug: rec.slug as string,
    name: rec.name as string,
    category: maybeString(rec.category),
    chains: stringArray(rec.chains),
    tvl_usd: rec.tvl_usd as number,
    change_7d: maybeNumber(rec.change_7d),
    mcap_usd: maybeNumber(rec.mcap_usd),
    listed_at: maybeString(rec.listed_at),
    gecko_id: maybeString(rec.gecko_id),
    symbol: maybeString(rec.symbol),
  };
}

/** The snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    refuse('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) refuse('snapshot.json is not a JSON object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) refuse('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') refuse('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) refuse('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) refuse('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((x) => typeof x !== 'string')) refuse('snapshot.json has no watchlist of slugs');
  return {
    as_of: doc.as_of as string,
    source: doc.source as string,
    floor_usd: doc.floor_usd as number,
    protocols: (doc.protocols as unknown[]).map(readProto),
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardProblem(board: Row[], snap: Snap): string | null {
  const onBoard = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !onBoard.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch, no network. */
export function dataScript(data: BoardData): string {
  return 'window.RADAR=' + JSON.stringify(data) + ';\n';
}
