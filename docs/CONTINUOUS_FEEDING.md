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

The selectable colonies contain 36, 108 or 324 larvae, served by 12, 36 or 108
feeding workers respectively. Empty
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
| Small: larvae / feeding workers / grid | 36 / 12 / 12 x 12 |
| Medium: larvae / feeding workers / grid | 108 / 36 / 21 x 21 |
| Large: larvae / feeding workers / grid | 324 / 108 / 36 x 36 |
| Initial stage hunger | L1 U[0.20,0.50]; L2 U[0.45,0.75]; L3 U[0.65,1.00] |
| Hunger growth per tick | L1 0.020; L2 0.028; L3 0.035 |
| Maximum portion per feed | L1 0.35; L2 0.45; L3 0.55 |
| Full now | Hunger <= 0.12 |
| Worker capacity | 2 food units at every size |
| Initial depot food: small / medium / large | 6 / 18 / 54 food units |
| Local sensing / memory expiry | Manhattan radius 3 / 20 ticks |
| Claim lifetime / renewal | 8 ticks / every 4 ticks or target change |
| Observation horizon / seeds | 500 ticks / 42 through 51 |

| Supply | Delivery probability per tick | Uniform arrival size | Expected input per tick |
|---|---:|---:|---:|
| Scarce | 0.08 | [1,3] | 0.16 |
| Variable | 0.20 | [2,6] | 0.80 |
| Abundant | 0.40 | [3,7] | 2.00 |

Arrival sizes and expected inputs above describe the small colony. Multiply
both by 3 for medium and 9 for large; arrival probability stays unchanged.
Thus initial stock and delivered food **per larva** are held constant, with the
same arrival timing for a given seed and supply. Staffing stays at one worker
per three larvae. Each size has equal numbers of L1, L2 and L3 larvae.

All supplies are stochastic. The labels describe these input distributions;
"abundant" does not guarantee delivery to every larva. Each seed generates its
own independent geometry and starting hunger. Geometry, hunger and delivery
streams are paired across policies for each seed and supply. Delivery RNG is
separate from policy decisions, so route choices cannot alter arrivals.

## What Scaling Tests

Grid occupancy is approximately constant: 0.250, 0.245 and 0.250 larvae per
grid cell. Larvae are sampled without replacement from interior cells, excluding
the depot. Border exclusion means density within the eligible interior is not
identical across sizes: 36/99 = 36.4%, 108/360 = 30.0%, and 324/1155 = 28.1%.
This reduced interior occupancy is another contributor to harder search at
larger sizes; the experiment does not isolate population size alone.
Geometries are independently generated at each size;
they are not enlarged copies or additional observations of real nests.

Larger colonies have longer depot journeys while worker speed, capacity, local
sensing radius, memory limits and the 500-tick observation window stay fixed.
This tests the combined spatial and resource-distribution challenge, not colony
size in isolation. A single depot can be a bottleneck even with abundant stock.
A larger population alone does not make a result biologically validated.

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

The size comparison reports the mean and minimum-to-maximum range of ten seeds
for hunger, fullness, movement per larva, empty-depot waiting fraction and runtime.
Waiting is divided by workers times 500; total movement is divided by larvae.
Neither quantity is a direct metabolic-energy measurement. Runtime includes
model construction, stepping and seed-42 snapshot recording, but excludes JSON
serialization, compression and browser rendering. Measurements came from a
busy laptop, so they describe this execution, not a controlled speed benchmark.

## Executed Scaling Result

Mean hunger under **variable supply**, averaged over seeds 42-51:

| Policy | Small: 36 larvae | Medium: 108 larvae | Large: 324 larvae |
|---|---:|---:|---:|
| Random | 0.614 | 0.724 | 0.818 |
| Biased / persistent walk | 0.703 | 0.689 | 0.718 |
| Greedy / global weighted choice | 0.631 | 0.792 | 0.882 |
| TSP / nearest-neighbor tour | 0.469 | 0.604 | 0.743 |
| Local nearest | 0.455 | 0.638 | 0.762 |
| Local urgency + claims | 0.512 | 0.611 | 0.741 |

The lowest descriptive mean changes from local nearest (small), to TSP (medium),
to biased walking (large). This is evidence against claiming one universal
winner in this synthetic setting. It is not a significance test: seed ranges
are available in the viewer, and density, depot distance and the fixed horizon
all change the effective challenge. Most policies leave more unmet hunger in
larger colonies despite equal per-larva food input, motivating future controlled
tests of depot placement and travel distance rather than simply adding workers.

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

The exporter runs 540 simulations (three sizes, three supplies, six policies,
ten seeds) and saves 54 seed-42 replays plus the 540-row summary in
`web/public/continuous/`. It reads no private CSVs and does not modify
research-v3 results. The manifest fingerprints both engine source files.
Browser validation independently reconstructs hunger transitions, feed portions,
refills, food conservation, movement budgets and scheduler ordering. Tests
reject fabricated food and check all exported replays before publication.

Runs are sequential. On Windows the exporter requests below-normal priority
and one logical CPU, leaving capacity for other work. Source-keyed checkpoints
under the ignored `outputs/scaling/` directory allow interrupted campaigns to
resume. Medium and large replays use gzip; the viewer fetches and renders only
the selected replay, releasing the previous scene before switching sizes.
The TSP nearest-neighbor construction caches pairwise distances without changing
visit order or index tie-breaking; regression tests compare it with the original.

The synthetic generator and assumptions are the basis for these new artifacts.
No original nest coordinates, bout metadata or private dataset rows are used.
The original paper remains the project's biological motivation; these delivery
distributions are not attributed to its authors or presented as their findings.
