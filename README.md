# Token Radar (radar-3)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/abduljunior425/token-radar-2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/abduljunior425/token-radar-2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for token launches that have not happened yet: pre-token protocols,
ranked by an implied value computed from a sealed DefiLlama snapshot. A second
entry for the make.fun bounty
[`token-radar-01`](https://make.fun/bounty/token-radar-01), built with a
different model from the first entry — see "Model (radar-3)" below.

## What it does

`main.ts` runs on Node 22 with the standard library only. It reads the sealed
snapshot, scores every launch candidate with the radar-3 model in `lib/model.ts`,
and writes the ranked board to `board.json`. The board holds the entire
watchlist — every protocol with at least $50M of TVL and no token on record —
plus every other launch candidate the snapshot holds, below the floor and
above it. Wrapped, staked and bridged products of tokens that already trade
are set aside rather than ranked as first tokens, and protocols that already
have a token are kept apart, with their market caps shown as the market's own
numbers.

`dashboard/` is a static page that makes no network requests: a search box,
category and chain filters, a watchlist-only toggle, sortable columns, a
leaders strip of the top three, a detail drawer per protocol with the model's
own breakdown, and an eight-step farm plan for each protocol.

## Model (radar-3)

```
implied  = round( 1,000,000 x (tvl_usd / 1,000,000)^0.8 x momentum x tenure x young x breadth )
momentum = 1 + 0.45 x tanh(clamp(change_7d, -90, 200) / 45)
tenure   = 0.70 + 0.30 x sqrt(min(age_days, 1095) / 1095)
young    = 0.88 when age_days < 90, else 1.00
breadth  = min(1 + 0.10 x ln(chains), 1.30)
```

Size is concave: doubling TVL adds less than double the value, so a mid-size
protocol with a hot week can outrank a flat giant. Momentum saturates — a wild
week, up or down, moves the value by at most 45% — because the hundredth
percent of growth says less than the first. Tenure climbs with the square root
of age over three years, and a protocol listed less than a quarter ago pays a
young penalty for not yet showing it can hold its TVL. Breadth is a logarithm
of the chain count: the second chain matters far more than the twentieth. Age
is the time since the protocol was first listed; when no listing date is known,
the model counts 180 days. No protocol name is special-cased — the same
function scores every row.

## How radar-3 differs from radar-2

The first entry (radar-2) multiplied TVL by a straight quarter, moved value
linearly with the week's growth (rises weighing 0.6, falls 0.9, clamped to
-60..120%), matured linearly to 1.0 over two years, and added five percent per
extra chain up to four. radar-3 replaces every one of those shapes: TVL enters
concave (to the power 0.8), growth enters through a symmetric saturating tanh,
maturity is a square root over three years with a separate penalty for
protocols under 90 days old, and chain spread is a logarithm capped at 1.30.
The board is also drawn tighter: radar-2 ranked every pre-token protocol
except CEX and versioned pools (226 rows); radar-3 additionally sets aside
bridges, liquid staking, liquid restaking and restaked-BTC products (202
rows), so a wrapped or staked product of a traded token is never presented
as a first-token launch. The farm plan is eight steps instead of seven, with
larger tickets ($75/$150/$300) and a stay that follows the week's momentum
(90 days growing, 60 flat, 45 shrinking).

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Inside the grader's container the input is `/input/snapshot.json` and the output is
`/output`. One run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json`. Run it twice and the bytes come out identical.

Implied value is this radar's own claim from the snapshot's figures: it is not a
price, not a prediction that a token will launch, and not a promise of an airdrop.
A protocol "records no token" when the snapshot carries no market cap, CoinGecko id
or symbol for it — that is the record, not proof that it has none.
