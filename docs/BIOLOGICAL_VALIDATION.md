# Biological Validation: Evidence Before Parameters

**Current status: computationally verified; physiological calibration and
independent biological validation are not established.** The continuous model
must retain its synthetic label. A successful simulation is not an observation.

## What The Available Evidence Can Support

The source study is Sharma and Gadagkar,
[Spatial organization of collective food distribution in a paper wasp society](https://doi.org/10.1101/2023.10.13.562279).
An author-hosted copy and supplementary information are linked from the
[author's publication list](https://sites.google.com/view/raghavendragadagkar/home/curriculum-vitae/publications-articles).
Its results and methods concern food-transfer events, feeding routes and spatial
organization. Feeding frequency is used as a proxy for food quantity, not a
direct measurement of food mass or larval hunger recovery.

The supplied event and cell tables provide candidate behavioral evidence:
identifiers, behavior labels, event times, stages and spatial coordinates.
They do not supply a physiological measurement protocol or a unit conversion
from the model's dimensionless food and hunger to real quantities.

| Model quantity | Required calibration evidence | Why the available proxy is insufficient |
|---|---|---|
| Stage-dependent hunger growth | Repeated, independently validated hunger measurements with elapsed time and intervening intake recorded | Time between feeds includes search, food availability and worker choice |
| Initial hunger distribution | Pre-bout hunger measurements by larval stage | Frequent feeding can reflect location or access rather than greater hunger |
| Food carried and delivered | Measured amounts, units, incoming workers and transfer events | One feeding event need not transfer a fixed amount |
| Portion-to-hunger relationship | Paired intake and hunger measurements before and after feeding | Choosing a model portion does not measure satiation |
| Time per action | Timed movement, feeding and transfer durations | A global tick is not automatically one biological second |

The legacy behavior grouping also requires codebook confirmation before it can
define empirical feeding endpoints. Do not assume that every inspection-related
code means ingestion. Existing public results remain frozen rather than being
silently relabeled or changed to match the paper.

## Calibration And Validation Protocol

1. Confirm the codebook, timestamp conventions, measurement units, missing-data
   handling and the experimental meaning of hunger/fullness with the researchers.
2. Obtain the measurements above, preserving nest, larva, worker and bout IDs.
   Record zero intake and observation windows, not only successful feeds.
3. Specify the observation model and fit parameters on training colonies only.
   Treat unobserved quantities as assumptions and test their identifiability;
   do not recover food mass or hunger slopes by renaming event frequency.
4. Freeze the model, parameters, endpoints and acceptance tolerances before
   evaluating held-out colonies. Splits must be by colony, not randomized event
   rows; bouts within one colony are not independent colonies.
5. Match observation windows, resources and endpoint definitions. Compare
   empirical distributions of feeding coverage, revisits and spatial allocation
   with model predictions and simple baselines. Report errors and uncertainty
   by colony, including failures rather than selecting favorable runs.
6. Validate the mechanism as well as fitted rates: a shared depot is not the
   observed forager/receiver transfer network. Calibrated numbers alone would
   not establish that real wasps implement the routing policies or claims.

Only then can the validated endpoints and populations be named. A check on
feeding coverage would not by itself validate hunger physiology or worker roles.
No successful validation outcome is predeclared here.

## Reproducible Local Evidence Audit

```bash
python -m unittest test_biological_evidence -v
python audit_biological_evidence.py --cells /private/path/cells.csv --events /private/path/events.csv
```

The audit checks input structure, inventory consistency and duplicate cell keys,
records source hashes and summarizes evidence requirements. It does not estimate
physiological parameters, certify measurement quality or certify data-use rights.
Outputs are fixed to ignored `outputs/biological_evidence/audit.json`, never the
public replay directory. Raw files and new observation-derived reports remain
local. Confirm the scope of permission before publishing those artifacts;
citation alone is not a publication-rights check.
