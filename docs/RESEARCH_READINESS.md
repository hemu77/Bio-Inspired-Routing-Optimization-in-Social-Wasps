# Research Readiness Audit

Audit date: 2026-09-30. Scope: current research-v3 engine, exported results,
all selected replays, browser regression suite, saved notebook and README GIFs.
Passing these checks is not proof of biological validity or journal acceptance.

## Findings First

1. **Fixed: accepted one-cell grids could crash local policies.** With one L1 larva
   at (0,0), hunger 0.2 and two workers, the first worker completes feeding and
   the next attempts exploration without any valid neighbour. `min(counts)` in
   `research_model.py` raises `ValueError: min() arg is an empty sequence`.
   Current published grids are 22, 25 or 28 cells wide and are unaffected.
   Workers now stay when no valid neighbour exists. A regression test covers
   both local policies, including two workers sharing the only cell. The test
   failed before the guard and passes after it; published scenario rules are unchanged.
2. **Historical PDF is not the active report.** The repository's
   `Bio-Inspired Routing Optimization in Social Wasps_d1.pdf` describes 144 runs,
   one primary seed and older policy/results definitions. Do not submit it as
   research-v3 methods or results. `final_analysis_v3.ipynb` is the current report.
3. **Scientific submission is conditional.** Hunger rates, unlimited feeding,
   synthetic staffing and completion that becomes permanent within one round
   are assumptions. Neither rendering fidelity nor successful completion
   validates these against observed biology.

Boundary reproducer (from the repository root):

```python
from research_model import ResearchModel, run_model
model = ResearchModel([(0, 0)], [.2], ['L1'], 1, 2, 42, 'local_nearest')
run_model(model, 3)
```

## Checks Completed

- [x] Eleven synthetic model regression tests pass on the current engine.
- [x] All 2160 fair runs and 720 ablations pass exported-result validation.
- [x] All 24 replays reconcile hunger growth, feeds, scheduler ordering,
  completion states and summary fields with their recorded events.
- [x] Twenty-two browser tests pass: invalid-data rejection, feeding state,
  themes, zoom/pan/reset, desktop/mobile, 2D fallback and method switching.
- [x] TypeScript production build passes.
- [x] Saved notebook executes: 43 cells, six PNG and 13 HTML outputs, no errors.
- [x] All four README GIFs have infinite-loop metadata and full terminal coverage.
- [x] One-cell local-policy boundary corrected and retested.
- [x] Source paper identified by the user and original manuscript read.
- [ ] Biology/calibration, sensitivity and held-out validation established.

After the boundary correction, all 2880 simulations were rerun in 549.91 seconds.
Exact JSON comparison with the pre-fix results confirms unchanged run summaries,
curves, rankings, inventories and scenarios. All 2160 fair runs finished; no
extended pass was needed. The new source digest is
`c0de7c7a50738b7448059a0512dfcf0eda8de91ab330c0f96c5a30fa10488457`.
The changed digest requires regenerated replay/context provenance even though
the published scenario outcomes are identical.

## Distinctive Contribution

Distinctive here means a defensible contribution relative to the earlier project,
not a claim that no other research has done this.

| Earlier project | Current extension | Scientific value |
|---|---|---|
| Four routing demonstrations | Six policies, including locally sensed urgency and expiring worker claims | Tests limited information and coordination, rather than assuming global knowledge |
| Single primary seed, 144 fair runs | Ten paired replicates for each of 36 scenarios; 2160 fair runs | Separates conditional stochastic variability from one illustrative realization |
| Feed count could terminate feeding | Repeated feeding until remaining hunger <= 0.12 | Distinguishes first contact, partial feeding and threshold completion |
| Aggregate routing comparison | Claims-off and global-sensing ablations; 720 additional runs | Investigates mechanisms, not only which named method ranks first |
| Summary plots and animations | Auditable event records, one-action budget and recorded-state 3D inspection | Lets readers inspect the state changes behind a result; the viewer does not run a second model |

Initial hunger is sampled by stage, independently of observed feeding frequency.
The original three layouts underpin 36 bouts; those bouts are **not 36 independent
biological nests**. Artificially doubling larvae does not add independent data.

## Results Worth Discussing

All six strategies complete all 360 fair runs per strategy under the tested
parameterization. Urgency-plus-claims has a median completion time of 74 ticks,
compared with 79 for local-nearest and 173.5 for the nearest-neighbour TSP baseline.
Its median movement per completed larva is 10.59 versus 15.04 for local-nearest.

The direct paired comparison is more informative than aggregate ranks:
urgency-plus-claims is faster than local-nearest in **215/360** scenario-replicate
pairs, tied in **8**, and slower in **137**. Median paired difference is -4.5 ticks.
Their nest-level median times tie at 77.5 ticks for v72. This is not a universal win.

Within the urgency policy, claims-on versus claims-off medians are 74 versus
76.5 ticks and 10.59 versus 14.44 movement units per completed larva. Global sensing
reduces the median to 58 ticks but changes the information assumption. Comparing
local-nearest with urgency-plus-claims changes two mechanisms, so that comparison
alone cannot attribute the entire improvement to communication.

These are descriptive results from saved outputs, not significance tests.
The three biological nests, not duplicated larvae or individual runs, constrain
generalization. Seed replication quantifies simulation noise, not uncertainty
about the population of real colonies.

## Publication Position

Suggested framing relative to Sharma and Gadagkar's study:

> A proposed computational extension of Sharma and Gadagkar's study, testing how local
> information, repeated larval demand and costly worker coordination affect
> completion and movement on observed nest layouts.

This is suitable for discussion with the original researcher as a follow-up
proposal. It is not yet evidence that real wasps use the implemented policies,
that the mechanism is globally novel, or that the manuscript is ready for acceptance.

Before submission:

1. Confirm the full data codebook, reuse/publication permissions and attribution;
   receiving datasets does not by itself confer publication permission.
2. Match original behavioral measurements or explain deviations explicitly:
   food exhaustion, worker roles, observed paths, central/peripheral feeding and
   between-bout recovery are not fully reproduced by this model.
3. Test sensitivity to hunger/portion rates, threshold, staffing, colony scale,
   sensing radius, claim lifetime and communication cost.
4. Report paired effect sizes with uncertainty that respects nest/bout structure;
   avoid treating 360 runs as 360 independent observed colonies.
5. Obtain held-out layouts or empirical path/feeding comparisons where feasible.
6. Use current methods rather than the historical PDF, and freeze a verified
   code/results version for the proposed manuscript.

## Relationship To The Source Paper

The user identified Sharma and Gadagkar's 2023
*Spatial organization of collective food distribution in a paper wasp society*,
[DOI 10.1101/2023.10.13.562279](https://doi.org/10.1101/2023.10.13.562279),
listed on the [coauthor's publications page](https://sites.google.com/view/raghavendragadagkar/home/curriculum-vitae/publications-articles).
The original manuscript was read using the public author-hosted PDF linked there.
The publisher endpoint was unavailable during the audit. The supplied datasets
ground layouts and bout metadata; private correspondence and raw data remain private.

| Source study | Current model | Interpretation |
|---|---|---|
| 36 observed bouts on three nests | 36 derived scenarios on the same three layouts | Grounded geometry, not 36 independent colonies |
| Bouts end when brought food is exhausted | Unlimited feeding until every larva reaches a synthetic hunger threshold | A different endpoint, not reproduction of observed coverage |
| Foragers and primary/secondary receivers transfer food | Every modeled worker can feed; no worker-to-worker food inventory | Routing experiment, not a full task-partitioning model |
| Short routes, central feeding and between-bout spatial organization measured | Synthetic cardinal movement, coverage, waiting and travel measured | Empirical alignment remains to be tested |
| Repeat/overlapping feeding may provide redundancy | Expiring claims attempt to reduce routing duplication | A counterfactual efficiency mechanism, not evidence that wasps send claims |

The paper reports that an average 22.8% of larvae were fed per observed bout,
with a range of 1.9-70.2%. The synthetic 100% hunger-threshold target is deliberately
different. Neither that success rate nor faster synthetic completion establishes
biological superiority. A useful follow-up would test the efficiency-versus-
redundancy trade-off under limited food and worker failure; these experiments
are not implemented in the current results. No worldwide novelty claim is made.
