# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DarthXyler/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DarthXyler/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar whose value model is fitted on the snapshot and tested on protocols it never saw. It reads a sealed DefiLlama snapshot, puts each of its 758 protocols in exactly one group, and ranks the 198 that record no token (the 40 watchlist protocols plus 158 early ones) by:

**implied value = launch value × token odds**

- **Launch value** = TVL × a multiple fitted on the 128 protocols whose token trades (target: log mcap/TVL, ridge regression). Candidate terms join in a fixed order (size curve, family effect, category effect, 7-day growth, log age, log chain count) and a term is kept only if it lowers the typical held-out miss in both leave-one-out and walk-forward (train on protocols listed earlier, test on later ones). On this snapshot the size curve is kept: typical miss ×3.65 / ×2.92 against ×5.07 / ×5.40 for the flat median.
- **Token odds** = the chance it records a token within the reader's horizon, from a logistic fit of "records a token" over all 645 protocols with a listing date: (F(age + h) − F(age)) / (1 − F(age)). Kept by the same two tests and scored by Brier score: no-token age, family, size and 7-day growth (0.207 / 0.224 against the base rate's 0.251 / 0.284).
- **Range**: P25–P75 from a seeded residual bootstrap; 53% of held-out traded protocols land inside their own band.

Each row carries its value decomposition, comparable traded protocols, and a farm verdict for the reader's plan size, airdrop share, horizon and capital cost (0% a year by default where the deposit keeps earning yield, 1% otherwise): expected reward, fees per transaction on its chain, capital cost, net $, hours, net per hour, and the break-even deposit (Farm, Farm from $X up to $100,000, or Skip), with day-by-day `farm_steps`. The dashboard (`dashboard/`, plain HTML/CSS/JS, no network) shows evidence tiles, the 758-protocol accounting, an integrity strip computed in the page, a sortable board with tier tabs and filters, a detail view and an evidence view.

The model is one file, `dashboard/model.js` (`fitCore`, `tokenOdds`, `farmPlan`, `buildBoard`): `main.ts` loads it to write `board.json`, and the page loads the same file to refit both models from `data.js` (the snapshot's raw fields only) and check every value and rank against `board.json`. Standard library only, deterministic: no clock, a seeded generator, and the only date is the snapshot's own `as_of`.

## Run it

```sh
mkdir out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Then open `out/dashboard/index.html`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
