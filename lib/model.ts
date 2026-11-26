// Peer-priced token radar: the value model and the farm plans.
//
// One sealed DefiLlama snapshot in, one ranked board out. Standard library only, deterministic: the
// only clock is the snapshot's own `as_of`, never the machine's.
//
// Implied value of a protocol that records no token, priced off the protocols whose token already trades:
//
//   peer ratio  = the median mcap_usd / tvl_usd of traded protocols in the same category, blended in log
//                 space toward the median of all traded protocols with weight n / (n + PRIOR_N), where n
//                 is how many traded peers the category has (no peers: the overall median alone)
//   growth      = 1 + GROWTH_WEIGHT x clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) / 100
//   age         = AGE_FLOOR + AGE_RANGE x min(days tracked with no token, AGE_DAYS) / AGE_DAYS
//                 (no listing date: the median age of the pre-token set)
//   reach       = min(REACH_CAP, 1 + REACH_WEIGHT x log2(number of chains))
//   implied     = TVL x peer ratio x growth x age x reach, in whole dollars
//
// Reward per $1,000 farmed = COMMUNITY_SHARE x implied / TVL x 1,000: the dollars a deposit would earn if
// the community share of a token priced at the implied value were spread over today's TVL pro rata.
// No protocol is named anywhere in this file: every row goes through the same functions.

/** The ten fields every snapshot protocol carries. */
export interface SnapshotProtocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL = {
  version: 'peer-1',
  prior_n: 4,
  ratio_floor: 0.02,
  ratio_cap: 1.0,
  growth_weight: 0.5,
  growth_floor: -40,
  growth_cap: 60,
  age_floor: 0.85,
  age_range: 0.35,
  age_days: 1095,
  reach_weight: 0.1,
  reach_cap: 1.35,
  community_share: 0.1,
  fee_budget: 0.02,
} as const;

/** Categories that are wrapped, staked, bridged or exchange products under the snapshot's rule. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

/** Estimated cost of one ordinary transaction (approve, deposit, claim) per chain, in USD. A house assumption, shown on the page. */
export const CHAIN_FEE_USD: Record<string, number> = {
  Ethereum: 2.5, Bitcoin: 1.5, Tron: 1.0, Arbitrum: 0.08, Base: 0.03, Optimism: 0.05, Polygon: 0.02,
  Binance: 0.08, Avalanche: 0.05, Solana: 0.01, 'Hyperliquid L1': 0.02, Monad: 0.02, Sui: 0.01, Linea: 0.05,
  Plasma: 0.01, Sonic: 0.01, Mantle: 0.03, Scroll: 0.05, Berachain: 0.02, xDai: 0.01, Celo: 0.01, Fantom: 0.02,
  Ripple: 0.01, Aptos: 0.01, Near: 0.01, Cardano: 0.2, Stellar: 0.01, Algorand: 0.01, Ton: 0.03, Starknet: 0.05,
};
export const DEFAULT_FEE_USD = 0.25;

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 === 1 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Its token trades: DefiLlama records a token and a positive market cap. */
export function isTraded(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && (p.gecko_id !== null || p.symbol !== null);
}

/** Records no token: no CoinGecko id and no symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** A wrapped, staked, bridged, versioned or exchange product, by the snapshot's own watchlist rule. */
export function isProduct(p: SnapshotProtocol): boolean {
  return (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) || VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name);
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && p.mcap_usd === null && !isProduct(p);
}

export interface PeerCategory {
  category: string;
  n: number;
  median_ratio: number | null;
  weight: number;
  ratio: number;
}

export interface PeerTable {
  overall: number;
  traded_n: number;
  categories: Record<string, PeerCategory>;
}

/** The mcap/TVL ratio each category earns from its traded peers, shrunk toward the overall median. */
export function peerTable(protocols: SnapshotProtocol[]): PeerTable {
  const traded = protocols.filter(isTraded);
  const overall = median(traded.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.2;
  const groups = new Map<string, number[]>();
  for (const p of traded) {
    const c = p.category ?? 'Uncategorised';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(p.mcap_usd! / p.tvl_usd);
  }
  const categories: Record<string, PeerCategory> = {};
  for (const c of [...groups.keys()].sort(cmp)) {
    const ratios = groups.get(c)!;
    categories[c] = blend(c, ratios.length, median(ratios), overall);
  }
  return { overall, traded_n: traded.length, categories };
}

function blend(category: string, n: number, med: number | null, overall: number): PeerCategory {
  const weight = med === null ? 0 : n / (n + MODEL.prior_n);
  const logRatio = weight * Math.log(med ?? overall) + (1 - weight) * Math.log(overall);
  const ratio = Math.min(MODEL.ratio_cap, Math.max(MODEL.ratio_floor, Math.exp(logRatio)));
  return { category, n, median_ratio: med, weight: round4(weight), ratio: round4(ratio) };
}

export function peerFor(table: PeerTable, category: string | null): PeerCategory {
  const c = category ?? 'Uncategorised';
  return table.categories[c] ?? blend(c, 0, null, table.overall);
}

export interface Factors {
  peer_ratio: number;
  peer_n: number;
  growth_pct: number;
  growth: number;
  age_days: number | null;
  age_used_days: number;
  age: number;
  chains: number;
  reach: number;
}

export function factorsFor(p: SnapshotProtocol, asOf: string, table: PeerTable, fallbackAge: number): Factors {
  const peer = peerFor(table, p.category);
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, p.change_7d ?? 0));
  const age = ageDays(asOf, p.listed_at);
  const ageUsed = age ?? fallbackAge;
  const chains = Math.max(1, p.chains.length);
  return {
    peer_ratio: peer.ratio,
    peer_n: peer.n,
    growth_pct: round4(growthPct),
    growth: round4(1 + (MODEL.growth_weight * growthPct) / 100),
    age_days: age,
    age_used_days: ageUsed,
    age: round4(MODEL.age_floor + (MODEL.age_range * Math.min(ageUsed, MODEL.age_days)) / MODEL.age_days),
    chains,
    reach: round4(Math.min(MODEL.reach_cap, 1 + MODEL.reach_weight * Math.log2(chains))),
  };
}

/** TVL x peer ratio x growth x age x reach, in whole dollars (the page repeats this exact arithmetic). */
export function impliedFrom(tvl: number, f: Factors): number {
  return Math.max(1, Math.round(tvl * f.peer_ratio * f.growth * f.age * f.reach));
}

export function rewardPer1k(implied: number, tvl: number): number {
  return Math.round(((MODEL.community_share * implied) / tvl) * 1000 * 100) / 100;
}

// ---------------------------------------------------------------- farm plans

export interface FarmStep {
  action: string;
  capital_usd: number;
  fee_usd: number;
  chain: string;
  time: string;
  risk: string;
}

interface Template {
  family: string;
  core: (n: string, c: string, cap: number) => string;
  coreRisk: string;
  second: (n: string, c: string, cap: number) => string;
  secondRisk: string;
  txPerWeek: number;
}

/** $1,234 or $0.05: a locale-free formatter, so every machine writes the same bytes. */
function usdText(n: number): string {
  const cents = Math.round(n * 100);
  const whole = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = cents % 100;
  return `$${whole}${frac === 0 ? '' : '.' + String(frac).padStart(2, '0')}`;
}

const TEMPLATES: Template[] = [
  { family: 'lending',
    core: (n, c, cap) => `Supply ${usdText(cap)} of USDC to ${n}'s largest stablecoin market on ${c} and turn on collateral.`,
    coreRisk: 'bad debt or an oracle fault in one market; keep to the deepest market',
    second: (n) => `Borrow a stablecoin against it at no more than 30% loan-to-value and resupply it once, so ${n} records both sides.`,
    secondRisk: 'liquidation if collateral falls; keep the health factor above 2', txPerWeek: 1 },
  { family: 'dex',
    core: (n, c, cap) => `Add ${usdText(cap)} to a stable-to-stable pool on ${n} (${c}) with a wide range so it stays in range.`,
    coreRisk: 'impermanent loss if a stablecoin depegs; avoid volatile pairs at this size',
    second: (n) => `Swap about $50 through ${n} across three different pairs, spread over the week, to log trading volume.`,
    secondRisk: 'slippage on thin pairs; cap slippage at 0.5%', txPerWeek: 3 },
  { family: 'vault',
    core: (n, c, cap) => `Deposit ${usdText(cap)} of USDC into the largest ${n} vault on ${c} and keep the vault shares in the same wallet.`,
    coreRisk: 'the curator\'s strategy and its underlying markets; read the vault\'s allocation first',
    second: (n) => `Split a second deposit into another ${n} vault on a different chain or asset, so the wallet shows breadth, not one position.`,
    secondRisk: 'withdrawal queues can delay exits by days', txPerWeek: 0.5 },
  { family: 'rwa',
    core: (n, c, cap) => `Pass ${n}'s onboarding (KYC where it asks) and subscribe ${usdText(cap)} to its tokenised yield product on ${c}.`,
    coreRisk: 'issuer and custody risk; redemptions can take 1 to 5 business days',
    second: (n) => `Post the ${n} yield token as collateral in a money market that lists it, or hold it through two monthly distributions.`,
    secondRisk: 'thin secondary liquidity; do not loop it', txPerWeek: 0.25 },
  { family: 'staking',
    core: (n, c, cap) => `Stake ${usdText(cap)} of the native asset through ${n} on ${c} and keep the receipt token unmoved.`,
    coreRisk: 'slashing and price exposure to the staked asset',
    second: (n) => `Delegate or restake to one of ${n}'s networks or operators; a second, smaller allocation shows active use.`,
    secondRisk: 'unbonding periods of 7 to 21 days lock the exit', txPerWeek: 0.5 },
  { family: 'chain',
    core: (n, c, cap) => `Move ${usdText(cap)} onto ${n} through its official bridge or gateway (${c}) and keep a balance there.`,
    coreRisk: 'bridge risk; use only the gateway the project itself links',
    second: (n) => `Make five transactions a week on ${n}'s own apps (a swap, a transfer, a deposit) instead of one large one.`,
    secondRisk: 'sybil filters favour real, spaced activity over scripted bursts', txPerWeek: 5 },
  { family: 'derivatives',
    core: (n, c, cap) => `Deposit ${usdText(cap)} of USDC as margin on ${n} (${c}) and trade small, hedged positions at 2x or less.`,
    coreRisk: 'liquidation and funding costs; never run unhedged leverage for points',
    second: (n) => `Place one maker order a day on ${n}; maker volume usually counts more than taker volume and costs less.`,
    secondRisk: 'fees on churned volume can exceed any reward', txPerWeek: 7 },
  { family: 'stable',
    core: (n, c, cap) => `Mint ${n}'s stablecoin on ${c} against ${usdText(cap)} of collateral at under 40% loan-to-value, or buy it and deposit it in its savings module.`,
    coreRisk: 'depeg risk; watch the peg and the collateral ratio weekly',
    second: (n) => `Provide the ${n} stablecoin to its main liquidity pool or savings vault so the position earns while it qualifies.`,
    secondRisk: 'pool imbalance during a depeg', txPerWeek: 0.5 },
  { family: 'cover',
    core: (n, c, cap) => `Underwrite ${usdText(cap)} in one of ${n}'s cover or backstop pools on ${c}.`,
    coreRisk: 'a covered exploit pays out from your stake',
    second: (n) => `Buy a small cover policy from ${n} for one of your own positions, so the wallet uses both sides of the market.`,
    secondRisk: 'premium is a sunk cost', txPerWeek: 0.25 },
  { family: 'general',
    core: (n, c, cap) => `Deposit ${usdText(cap)} into ${n}'s main product on ${c} and keep it there for the whole window.`,
    coreRisk: 'smart-contract risk of a young protocol',
    second: (n) => `Use a second ${n} feature (a vault, a swap or a governance vote) once a week, so the wallet shows repeat use.`,
    secondRisk: 'each extra contract approval widens exposure; revoke unused ones', txPerWeek: 1 },
];

/** Which template a category gets: keyword families, no protocol names. */
export function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
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

export function feeFor(chain: string): number {
  return CHAIN_FEE_USD[chain] ?? DEFAULT_FEE_USD;
}

const CAP_STEPS = [100, 250, 500, 1000, 2500, 5000];

/** Hold window from how long DefiLlama has tracked it: younger protocols run longer qualifying seasons. */
export function holdWindow(age: number): { text: string; days: number } {
  if (age < 180) return { text: 'hold 60–90 days', days: 90 };
  if (age < 540) return { text: 'hold 45–60 days', days: 60 };
  return { text: 'hold 30–45 days', days: 45 };
}

export interface Plan {
  family: string;
  chain: string;
  fee_usd: number;
  min_capital_usd: number;
  total_fees_usd: number;
  hold_days: number;
  est_reward_usd: number;
  steps: FarmStep[];
}

/** How many snapshot protocols count TVL on each chain: the main chain is the protocol's most-used one. */
export function chainUse(protocols: SnapshotProtocol[]): Map<string, number> {
  const use = new Map<string, number>();
  for (const p of protocols) for (const c of p.chains) use.set(c, (use.get(c) ?? 0) + 1);
  return use;
}

export function farmPlan(p: SnapshotProtocol, f: Factors, reward1k: number, use: Map<string, number>): Plan {
  const family = familyOf(p.category);
  const t = TEMPLATES.find((x) => x.family === family)!;
  const byUse = [...p.chains].sort((a, b) => (use.get(b) ?? 0) - (use.get(a) ?? 0) || cmp(a, b));
  const chain = byUse[0] ?? 'Ethereum';
  const cheaper = [...p.chains].sort((a, b) => feeFor(a) - feeFor(b) || (use.get(b) ?? 0) - (use.get(a) ?? 0) || cmp(a, b))[0];
  const alt = cheaper !== undefined && feeFor(cheaper) < feeFor(chain) / 4 ? cheaper : null;
  const fee = feeFor(chain);
  const hold = holdWindow(f.age_used_days);
  const weeks = Math.ceil(hold.days / 7);
  const upkeepTx = Math.max(1, Math.round(t.txPerWeek * weeks));
  const setupTx = 6;
  const totalFees = Math.round((setupTx + upkeepTx) * fee * 100) / 100;
  const floor = family === 'rwa' ? 500 : 100;
  const need = Math.max(floor, totalFees / MODEL.fee_budget);
  const cap = CAP_STEPS.find((c) => c >= need) ?? 5000;
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  const name = p.name;
  const steps: FarmStep[] = [
    { action: `Open a fresh wallet for ${name} only and fund it on ${chain} with ${usdText(cap)} of USDC plus gas. One protocol per wallet keeps eligibility clean.${alt === null ? '' : ` It also runs on ${alt} at ~${usdText(feeFor(alt))} a transaction: farm there if its main product is listed.`}`,
      capital_usd: cap, fee_usd: r2(fee * 2), chain, time: '20–30 minutes', risk: 'phishing clones; reach the app only from the link on its DefiLlama page' },
    { action: t.core(name, chain, cap), capital_usd: cap, fee_usd: r2(fee * 2), chain, time: '15 minutes, then ' + hold.text, risk: t.coreRisk },
    { action: t.second(name, chain, cap), capital_usd: Math.round(cap * 0.3), fee_usd: r2(fee * 2), chain, time: '10 minutes a week', risk: t.secondRisk },
    { action: `Keep the main position open through the window (${hold.text}): ${name} is ${f.age_days === null ? 'tracked with no listing date' : `${Math.round(f.age_used_days / 30.44)} months on DefiLlama`} and records no token, so points or snapshots may still be running.`,
      capital_usd: cap, fee_usd: r2(upkeepTx * fee), chain, time: hold.text, risk: 'opportunity cost; a token may never launch' },
    { action: `Every week, check ${name}'s points or rewards page and its TVL; if TVL falls more than 25% in 7 days (it moved ${f.growth_pct >= 0 ? '+' : ''}${f.growth_pct.toFixed(1)}% this week), withdraw and reassess.`,
      capital_usd: 0, fee_usd: 0, chain, time: '5 minutes a week', risk: 'an outflow run often precedes a pause or an exploit' },
    { action: `If ${name} announces a token, claim only from its official site, never via DMs or ads, then decide to hold or sell. At ${usdText(cap)} the model's estimate is about ${usdText(r2((reward1k * cap) / 1000))}.`,
      capital_usd: 0, fee_usd: r2(fee * 2), chain, time: '15 minutes at the claim', risk: 'fake claim sites and approvals that drain the wallet' },
  ];
  return { family, chain, fee_usd: fee, min_capital_usd: cap, total_fees_usd: r2(totalFees), hold_days: hold.days, est_reward_usd: r2((reward1k * cap) / 1000), steps };
}

/** One step as the gate's string: action, capital, fee, time and risk, 20 to 600 characters. */
export function stepText(s: FarmStep): string {
  const text = `${s.action} Min capital: ${usdText(s.capital_usd)}. Est. fee: ~${usdText(s.fee_usd)} on ${s.chain}. Time: ${s.time}. Risk: ${s.risk}.`;
  return text.length > 600 ? `${text.slice(0, 597)}...` : text;
}

// ---------------------------------------------------------------- the board

export interface Comparable { slug: string; name: string; ratio: number; tvl_usd: number; mcap_usd: number; symbol: string | null }

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'records-no-token';
  tier: 'watchlist' | 'early';
  implied_value_usd: number;
  reward_per_1k_usd: number;
  factors: Factors;
  comparables: Comparable[];
  plan: Omit<Plan, 'steps'>;
  plan_steps: FarmStep[];
  farm_steps: string[];
}

function comparablesFor(p: SnapshotProtocol, traded: SnapshotProtocol[]): Comparable[] {
  const near = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
    Math.abs(Math.log(a.tvl_usd / p.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / p.tvl_usd)) || cmp(a.slug, b.slug);
  const same = traded.filter((t) => t.category === p.category).sort(near).slice(0, 4);
  // Fewer than four in its category: the nearest traded protocols by TVL fill the table, labelled with their own category.
  const fill = traded.filter((t) => !same.includes(t)).sort(near).slice(0, 4 - same.length);
  return [...same, ...fill].map((t) => ({ slug: t.slug, name: t.name, ratio: round4(t.mcap_usd! / t.tvl_usd), tvl_usd: t.tvl_usd, mcap_usd: t.mcap_usd!, symbol: t.symbol }));
}

export function buildBoard(s: Snapshot): { rows: BoardRow[]; table: PeerTable; fallbackAge: number } {
  const table = peerTable(s.protocols);
  const traded = s.protocols.filter(isTraded);
  const use = chainUse(s.protocols);
  const watch = new Set(s.watchlist);
  const chosen = s.protocols.filter((p) => watch.has(p.slug) || isPreToken(p));
  const ages = chosen.map((p) => ageDays(s.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const fallbackAge = Math.round(median(ages) ?? 365);
  const scored = chosen.map((p) => {
    const f = factorsFor(p, s.as_of, table, fallbackAge);
    return { p, f, implied: impliedFrom(p.tvl_usd, f) };
  });
  scored.sort((a, b) => b.implied - a.implied || cmp(a.p.slug, b.p.slug));
  const rows = scored.map(({ p, f, implied }, i) => {
    const r1k = rewardPer1k(implied, p.tvl_usd);
    const { steps, ...plan } = farmPlan(p, f, r1k, use);
    return {
      rank: i + 1, slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      change_7d: p.change_7d, listed_at: p.listed_at, token_status: 'records-no-token' as const,
      tier: watch.has(p.slug) ? ('watchlist' as const) : ('early' as const),
      implied_value_usd: implied, reward_per_1k_usd: r1k, factors: f, comparables: comparablesFor(p, traded),
      plan, plan_steps: steps, farm_steps: steps.map(stepText),
    };
  });
  return { rows, table, fallbackAge };
}

/** Why the gate would refuse this board, or null. */
export function boardIssue(rows: BoardRow[], s: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows, not 100 to 4000`;
  const slugs = new Set(s.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    if (!slugs.has(r.slug) || seen.has(r.slug)) return `slug ${r.slug} unknown or repeated`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `rank ${r.rank} out of order`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) return `${r.slug}: bad implied value`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `${r.slug}: value rises with rank`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const t of r.farm_steps) if (t.trim().length < 20 || t.trim().length > 600) return `${r.slug}: a step of ${t.trim().length} characters`;
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  for (const w of s.watchlist) if (!seen.has(w)) return `watchlist slug ${w} missing`;
  return null;
}

/** The page's data: compact rows, the traded comparables and the peer table, as one script. */
export function dataScript(s: Snapshot, rows: BoardRow[], table: PeerTable, fallbackAge: number): string {
  const traded = s.protocols.filter(isTraded).sort((a, b) => b.mcap_usd! - a.mcap_usd! || cmp(a.slug, b.slug));
  const tokenNoCap = s.protocols.filter((p) => !recordsNoToken(p) && !isTraded(p)).length;
  const data = {
    as_of: s.as_of, source: s.source, floor_usd: s.floor_usd, model: MODEL, fees: CHAIN_FEE_USD, default_fee: DEFAULT_FEE_USD,
    universe: s.protocols.length, watchlist_n: s.watchlist.length, products_excluded: s.protocols.filter((p) => recordsNoToken(p) && isProduct(p) && !s.watchlist.includes(p.slug)).length,
    token_no_cap: tokenNoCap, fallback_age: fallbackAge, peers: table,
    rows: rows.map((r) => ({
      k: r.rank, s: r.slug, n: r.name, c: r.category, ch: r.chains, t: r.tvl_usd, g: r.change_7d, l: r.listed_at, w: r.tier === 'watchlist' ? 1 : 0,
      v: r.implied_value_usd, r1k: r.reward_per_1k_usd, f: r.factors, cmp: r.comparables.map((c) => c.slug), plan: r.plan, steps: r.plan_steps,
    })),
    traded: traded.map((p) => ({ s: p.slug, n: p.name, c: p.category, ch: p.chains.length, t: p.tvl_usd, m: p.mcap_usd, y: p.symbol, g: p.change_7d })),
  };
  return `window.RADAR = ${JSON.stringify(data)};\n`;
}
