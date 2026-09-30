# Continuous Feeding With Limited Food

This synthetic experiment answers a different question from research-v3:
**How well does a routing policy maintain feeding when demand returns and food
arrives irregularly?** It is an explicit modeling extension, not evidence that
real wasps use these policies or physiological rates.

## What Changes

Hunger grows for every larva each tick, including those currently full. A full
larva becomes eligible for feeding again when hunger exceeds 0.12. A feed lowers
hunger by the minimum of the stage portion, remaining hunger and carried food.
There is no feed-count cap and no permanent green state.

Twelve feeding workers serve 36 larvae on a 12-by-12 synthetic grid. Empty
workers return to a central depot. Refilling costs one action; travelling,
feeding and broadcasting also cost one action. Workers do not obtain food
remotely or feed while moving. Food is conserved between the depot, carried
loads and delivered feed portions. A partly loaded worker leaves immediately;
this refill policy is an assumption shared by all routing methods.

TSP keeps its current visit order and appends reopened larvae to the end of any
active tour. This prevents renewed demand from disappearing while retaining
the tour policy rather than changing it into an always-nearest choice.

Food units are dimensionless. No claim is made about grams, calories or seconds.
Foragers are represented by external deliveries, not explicit agents. A shared
depot abstracts food distribution; it does not reproduce observed trophallaxis.
Food does not spoil, the depot has unlimited storage, and receivers know its
fixed location. Future deliveries are unavailable to routing decisions.

## Fixed Parameters

| Parameter | Value |
|---|---|
| Larvae / feeding workers / grid | 36 / 12 / 12 x 12 |
| Initial stage hunger | L1 U[0.20,0.50]; L2 U[0.45,0.75]; L3 U[0.65,1.00] |
| Hunger growth per tick | L1 0.020; L2 0.028; L3 0.035 |
| Maximum portion per feed | L1 0.35; L2 0.45; L3 0.55 |
| Full now | Hunger <= 0.12 |
| Worker capacity / initial depot food | 2 / 6 food units |
| Local sensing / memory expiry | Manhattan radius 3 / 20 ticks |
| Claim lifetime / renewal | 8 ticks / every 4 ticks or target change |
| Observation horizon / seeds | 500 ticks / 42 through 51 |

| Supply | Delivery probability per tick | Uniform arrival size | Expected input per tick |
|---|---:|---:|---:|
| Scarce | 0.08 | [1,3] | 0.16 |
| Variable | 0.20 | [2,6] | 0.80 |
| Abundant | 0.40 | [3,7] | 2.00 |

All supplies are stochastic. The labels describe these input distributions;
"abundant" does not guarantee delivery to every larva. Each seed generates its
own independent geometry and starting hunger. Geometry, hunger and delivery
streams are paired across policies for each seed and supply. Delivery RNG is
separate from policy decisions, so route choices cannot alter arrivals.

## Metrics And Interpretation

Mean hunger averages all larvae over post-action ticks 1 through 500, then the
viewer averages ten seeds equally. Lower means less unmet hunger under these
assumptions. Mean full fraction and the fraction of larva-ticks with hunger
>= 0.8 are also recorded. The 0.8 cutoff is descriptive, not a mortality threshold.
Hunger-return events count threshold crossings at the start of each tick;
a worker may feed that larva again in the same tick. Refeeds count feed actions
after a larva has been full at least once; several feeds can occur in one episode.
These counts are not counts of distinct larvae or independent biological samples.

The replay shows current fullness, which may fall. It ends at the observation
horizon even if some or all larvae happen to be full. Permanent completion and
time-to-all-full rankings are deliberately not used for this experiment.
The tables are descriptive; no statistical significance or universal winner is
claimed. A synthetic stress test does not provide biological calibration.

## Reproduction And Verification

Run from the repository root:

```bash
python -m unittest test_research_model test_continuous_model -v
python continuous_model.py
cd web
npm ci
npm test
npm run build
```

The exporter runs 180 simulations and saves 18 seed-42 replays plus the 180-row
summary in `web/public/continuous/`. It reads no private CSVs and does not modify
research-v3 results. The manifest fingerprints both engine source files.
Browser validation independently reconstructs hunger transitions, feed portions,
refills, food conservation, movement budgets and scheduler ordering. Tests
reject fabricated food and check all exported replays before publication.

The synthetic generator and assumptions are the basis for these new artifacts.
No original nest coordinates, bout metadata or private dataset rows are used.
The original paper remains the project's biological motivation; these delivery
distributions are not attributed to its authors or presented as their findings.
