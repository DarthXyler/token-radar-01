// Peer-priced token launch radar (token-radar-01). Node 22, standard library only.
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), prices every protocol that
// records no token off the traded protocols in its category (lib/model.ts), and writes to /output
// (MAKEFUN_OUTPUT_DIR outside the grader):
//   board.json    the ranked rows, each with its factor breakdown, comparables and farm plan
//   data.js       the page's data, beside dashboard/ so the dossier's text is code, not data
//   dashboard/    the static page (index.html, app.css, app.js)
//   screenshots/  the three captures of that page
//   dossier.json  written last with buildDossier, which the gate rebuilds byte for byte
//
//   mkdir out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, dataScript, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

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

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) fail('the snapshot has no protocols or watchlist array');

const { rows, table, fallbackAge } = buildBoard(snapshot);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: 'peer-1', as_of: snapshot.as_of, rows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(snapshot, rows, table, fallbackAge));

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
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3`);
for (const n of shots) if (!IMAGE_NAME.test(n)) fail(`screenshots/${n} is not a plain name`);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const early = rows.filter((r) => r.tier === 'early').length;
process.stdout.write(`token radar: ${snapshot.protocols.length} protocols, ${table.traded_n} traded peers, ${rows.length} rows (${rows.length - early} watchlist, ${early} early); wrote board.json, data.js, dashboard (${pages.length}), screenshots (${shots.length}), dossier.json to ${out}\n`);
