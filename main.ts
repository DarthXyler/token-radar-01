// Peer-priced token launch radar (token-radar-01). Node 22, standard library only.
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>) and ranks every protocol that
// records no token with dashboard/model.js, the same file the page runs, so the board and the page share
// one model. Writes to /output (MAKEFUN_OUTPUT_DIR outside the grader):
//   board.json    the ranked rows (launch multiple and its terms, token odds, P25-P75, comparables, farm verdict
//                 and day-by-day steps), the held-out term tables, range coverage and the 758-protocol accounting
//   data.js       the snapshot's raw fields the page needs, plus [slug, implied value] from board.json
//                 so the page can check that its own recomputation matches
//   dashboard/    the static page (index.html, app.css, app.js, model.js)
//   screenshots/  the captures of that page
//   dossier.json  written last with buildDossier, which the gate rebuilds byte for byte
//
//   mkdir out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const Model = createRequire(import.meta.url)('./dashboard/model.js');
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const FIELDS = ['slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'symbol', 'gecko_id'] as const;

interface Row { rank: number; slug: string; name: string; implied_value_usd: number; farm_steps: string[] }
interface Snapshot { as_of: string; protocols: Record<string, unknown>[]; watchlist: string[] }

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** Why the gate would refuse this board, or null. */
function boardIssue(rows: Row[], s: Snapshot): string | null {
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

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) fail('the snapshot has no protocols or watchlist array');

const board = Model.buildBoard(snapshot);
const rows = board.rows as Row[];
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

mkdirSync(out, { recursive: true });
const evidence = Model.evidence(board.core);
writeFileSync(join(out, 'board.json'), `${JSON.stringify({
  model: Model.MODEL.version, as_of: snapshot.as_of, assumptions: board.opts, groups: board.groups,
  evidence: { value_terms: evidence.value, odds_terms: evidence.odds, range_coverage: evidence.coverage, traded_n: evidence.traded_n, base_rate: evidence.base_rate },
  rows,
})}\n`);
const data = {
  as_of: snapshot.as_of,
  watchlist: snapshot.watchlist,
  protocols: snapshot.protocols.map((p) => Object.fromEntries(FIELDS.map((k) => [k, p[k] ?? null]))),
  board: rows.map((r) => [r.slug, r.implied_value_usd]),
};
writeFileSync(join(out, 'data.js'), `window.RADAR = ${JSON.stringify(data)};\n`);

/** Copy a directory's regular files (dot-files skipped) and return their names, sorted. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);
for (const n of shots) if (!IMAGE_NAME.test(n)) fail(`screenshots/${n} is not a plain name`);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const early = rows.filter((r) => (r as unknown as { tier: string }).tier === 'early').length;
process.stdout.write(`token radar: ${snapshot.protocols.length} protocols, ${evidence.traded_n} traded peers (value terms kept: ${board.core.value.kept.join(', ') || 'none'}; odds terms kept: ${board.core.odds.kept.join(', ') || 'none'}), ${rows.length} rows (${rows.length - early} watchlist, ${early} early); wrote board.json, data.js, dashboard (${pages.length}), screenshots (${shots.length}), dossier.json to ${out}\n`);
