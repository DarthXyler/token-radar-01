# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DarthXyler/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DarthXyler/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A peer-priced token launch radar. It reads a sealed DefiLlama snapshot, finds every protocol that records no token (the 40 watchlist protocols plus 158 early ones below the floor), and ranks them by an implied value priced off the 128 protocols whose token already trades:

**implied value = TVL × category peer ratio (median mcap/TVL of traded peers, each clipped to the 10th–90th percentile of all traded ratios, shrunk toward the overall median at weight n/(n+8); categories with fewer than 3 peers are flagged thin) × growth (7-day TVL change) × age (time tracked with no token) × reach (chains)**

Each row carries its factor breakdown, its comparable traded protocols, an estimated reward per $1,000 farmed, and a six-step farm plan with capital, an estimated fee on its main chain, a time and a risk note per step, plus the plan's totals (capital, fees, days) and the expected reward at the minimum capital. The dashboard (`dashboard/`, plain HTML/CSS/JS, no network) has a model strip above a sortable, filterable board, a detail view per protocol, a "Trading already" tab of the comparables and a methodology panel.

The model is one file, `dashboard/model.js` (`peerRatio`, `growthFactor`, `ageFactor`, `reachFactor`, `impliedValue`, `farmPlan`): `main.ts` loads it to write `board.json`, and the page loads the same file to recompute every value, rank and plan from `data.js` (the snapshot's raw fields only), then checks each value against `board.json`. Standard library only, deterministic: the only date is the snapshot's own `as_of`.

## Run it

```sh
mkdir out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Then open `out/dashboard/index.html`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
