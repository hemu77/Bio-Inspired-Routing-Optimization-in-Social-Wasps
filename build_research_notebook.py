"""Build the report notebook from shared code and saved results; execute separately."""
from pathlib import Path
import json
import nbformat as nbf

ROOT = Path(__file__).parent
report = json.loads((ROOT / "research_results.json").read_text())
captions = json.loads((ROOT / "figures/research-v3/captions.json").read_text())
LIVE = "https://hemu77.github.io/Bio-Inspired-Routing-Optimization-in-Social-Wasps/"
cells = []
def markdown(text): cells.append(nbf.v4.new_markdown_cell(text))
def code(text): cells.append(nbf.v4.new_code_cell(text))

markdown("""# Social Wasps: Routing Under Local Information
## Research-v3 / repeated feeding, all nests, all bouts

I study how worker movement rules affect the time and travel needed to give every
larva enough feeds to reach an explicit hunger threshold. The data supplies nest layouts and bout worker
counts; the simulation is a controlled synthetic experiment, not a reconstruction
of observed worker trajectories. This report covers v14, v72 and v87.

**Read the endpoint carefully:** `served` means remaining hunger is at most 0.12.
One feed may not be enough. I removed the original three-feed cap: feed count
alone never means full. The inherited growth and portion sizes remain model
assumptions, not calibrated physiology, food mass or measured biological satiation.
The first-feed v2 report is archived under the `research-v2-first-feed` Git tag.
The previous report is preserved in `final_analysis.ipynb` and the `legacy-v1` Git
tag. Its numerical rankings are not directly comparable with this revised model.
""")
markdown("""## 1. Reproducible Setup
The notebook imports the same engine used by the command-line benchmark and public
replays. Saved derived results allow readers to rerun the report without access to
the private datasets. Set `RERUN_EXPERIMENTS=True` only when the two CSV files are
available locally; this runs one worker and resumes compatible checkpoints.
""")
code("""from pathlib import Path
import json
import numpy as np
import pandas as pd
from IPython.display import display, Image, HTML, Markdown
from research_model import source_checksum, STRATEGIES
from research_report import generate_report, LABELS

RERUN_EXPERIMENTS = False
SCALE_FACTOR = 2
RANDOM_SEED = 42
FAIR_HORIZON = 3000
EXTENDED_HORIZON = 10000
REPLICATES = 10
if RERUN_EXPERIMENTS:
    from run_research import run_experiments
    run_experiments(REPLICATES)
report = json.loads(Path('research_results.json').read_text())
assert report['source_checksum'] == source_checksum(), 'Results are stale: rerun the benchmark.'
runs = pd.DataFrame(report['runs'])
fair = runs[runs.variant == 'main'].copy()
inventory = pd.DataFrame(report['inventory'])
scenarios = pd.DataFrame(report['scenarios'])
ranking = pd.DataFrame(report['ranking'])
display(inventory)
""")
markdown("""## 2. What The Data Contributes
`ED_FL_3nests1noC2.csv` supplies cell positions, cell contents and stages.
`ALL_FL_minmaj_final3noC2.csv` supplies nest-bout records and worker counts. I keep
the existing event-code grouping (`FL`, `FL2`, `LPL`, `SPL`) for the worker-count rule;
without a validated codebook, these counts are **assumed activity proxies**, not
independent evidence of simulated feeding success.

Every observed nest-bout appears below using an anonymized ordinal scenario label.
Neither original worker identities nor raw CSV files are published. Bout counts
are 10 for v14, 14 for v72 and 12 for v87. These are three nests, not 36 independent
biological colonies.
""")
code("""display(scenarios)
if Path('ED_FL_3nests1noC2.csv').exists() and Path('ALL_FL_minmaj_final3noC2.csv').exists():
    from run_research import prepare
    observed_inventory, observed_scenarios, geometry = prepare()
    assert len(observed_scenarios) == len(scenarios) == 36
    print('Local private inputs agree with the public scenario inventory.')
else:
    print('Private data absent: report uses the published derived inventory and results.')
""")
markdown("""## 3. Synthetic Colony And Ground Rules
I duplicate each larva once to test a larger routing workload. Deterministic jitter
and collision-resolved grid placement preserve a recognizable layout, but the
additional larvae are synthetic and the quantized positions are not raw biological
coordinates. The grids are 22, 25 and 28 cells wide for v14, v72 and v87.

Initial hunger is drawn independently from stage ranges: L1 `[0.20,0.50]`, L2
`[0.45,0.75]`, L3 `[0.65,1.00]`. `FL_freq` never sets it. Before each tick, hungry
larvae gain L1 0.020, L2 0.028 or L3 0.035 hunger, capped at 1. Each feed subtracts
L1 0.35, L2 0.45 or L3 0.55, floored at 0. Once hunger reaches 0.12 or less, a larva
is full for this single round and stops recovering hunger. A new cycle is not modeled.
Replicate seeds vary initial hunger while every strategy inside a scenario-replicate
receives identical initial hunger, colony, staffing and scheduler seeds.

The retained resource formula is `max(ceil(larvae/5), observed workers) +
ceil(grouped activity events/100)`. All simulated workers can feed; food supply and
foraging trips are deliberately outside this experiment. Background cells are
traversable, not imaginary obstacles.
""")
markdown("""## 4. Agents And Fair Actions
A larva records first-feed time, every feed and hunger-threshold completion time.
A worker has one action per tick: one cardinal grid move, one feed, or one claim broadcast. Feeding and
broadcasting therefore replace movement rather than occurring for free.

Random activation uses a separate random stream from policy choices. The activation
permutations remain paired across strategies, so a strategy's extra random draws
cannot change the scheduler. A run stops when all larvae reach the hunger threshold or its
horizon. Timeout is recorded as `completion_step=None`, never as a completed run.
""")
code("""policy_table = pd.DataFrame([
    ('random', 'Blind', 'Independent cardinal walk'),
    ('biased', 'Blind', 'Persistent direction; 25% chance to redraw'),
    ('greedy', 'Global', 'Random target weighted by remaining hunger / (1 + distance)'),
    ('tsp', 'Global', 'Nearest-neighbour tour; historical alias, not optimal TSP'),
    ('local_nearest', 'Local', 'Observed / remembered nearest target; exploration otherwise'),
    ('local_urgency_claims', 'Local', 'Observed remaining hunger / (1 + distance), with expiring local claims')
], columns=['strategy', 'information', 'rule'])
display(policy_table)
""")
markdown("""Local policies sense Manhattan radius 3 and keep at most 256 observed records.
The urgency policy exchanges claims only with workers within radius 3; leases last
8 ticks and renewal is considered every 4 ticks. Lower worker IDs resolve received
claim conflicts. A remembered location and priority come from an actual observation,
not an unseen global lookup. Global and blind policies remain useful baselines,
but differences between information classes cannot be attributed to routing alone.
""")
markdown("""## 5. Full Benchmark And Ablations
The common-horizon experiment runs 36 scenarios x 10 paired replicates x 6 policies
= **2160 fair simulations**. Two additional urgency configurations (claims off and
global sensing on) add **720 ablation simulations**. Extended runs, when needed,
are kept separate from the fair ranking.

Ranking sorts completion reliability first, then median horizon-capped time, then
movement per served larva. It is a declared engineering ranking, not a statistical
claim about all wasp colonies. Every numerical table below comes from the executed
JSON artifact, not manually typed results.
""")
code("""display(ranking)
display(fair.groupby(['nest', 'strategy']).agg(
    runs=('finished', 'size'), reliability=('finished', 'mean'),
    median_capped_ticks=('observed_steps', 'median'),
    median_travel_per_served=('distance_per_served', 'median')).round(3))
display(runs)
extended = pd.DataFrame(report['extended'])
display(extended if not extended.empty else pd.DataFrame({'extended_pass': ['Not needed: all fair runs completed']}))
""")
markdown("""## 6. Playable Simulations
Visualization is useful because the same aggregate score can hide repeated visits,
crowded cells and delayed larvae. The lab plays recorded Python states, never a
different browser simulation. It includes a median tour example for each nest and
the slowest main-run example; selection is deterministic and not cherry-picked to
make the new policy win.

The four original methods remain individually playable below. In the lab, select
**Compare four** to see them synchronized by actual tick; a finished method holds
its last frame. GitHub sanitizes notebook iframe/JavaScript outputs, so use the
linked live lab for playback. Local Jupyter permits the interactive embeds.
""")
manifest = json.loads((ROOT / "web/public/manifest.json").read_text())
representative = next(s["id"] for s in manifest["scenarios"] if s["nest"] == "v87")
for strategy in ["tsp", "biased", "random", "greedy"]:
    markdown(f"### {strategy}: recorded hunger-based feeding round\n[Open interactive replay]({LIVE}?scenario={representative}&strategy={strategy})")
    code(f"display(HTML('<iframe title=\"{strategy} hunger-based replay\" src=\"{LIVE}?scenario={representative}&strategy={strategy}\" width=\"100%\" height=\"780\" loading=\"lazy\" style=\"border:1px solid #ccc\"></iframe>'))")
markdown("""## 7. Six Analysis Questions
These plots replace the unsupported composite difficulty score and redundant
four-point frontier. The coverage band summarizes replicate-level means across
the same scenarios; it is conditional stochastic variability, not a population
confidence interval. Waiting measures are explicitly restricted when censored.
""")
code("captions = generate_report(report)\nassert len(captions) == 6")
for i, caption in enumerate(captions):
    markdown(f"### 7.{i + 1}. {caption['title']}")
    code(f"display(Image(filename='figures/research-v3/{caption['file']}'))")
    code(f"display(Markdown(captions[{i}]['interpretation']))")
markdown("""## 8. Conclusions And Limits
Read the newly executed ranking rather than transferring conclusions from v2.
Explicit communication cost matters: claims are not automatically an improvement.
The ablation helps separate the effect of hunger prioritization, coordination
and information access rather than calling a visually appealing policy 'best'.

Only three real nest layouts are available; doubling larvae is synthetic. The
random priorities are assumed rather than measured. Worker resource counts are
derived from activity summaries, not calibrated trajectories. There is no validated
physiology, food depot, collision avoidance, continuous flight model or 3D geometry.
Future work should use a confirmed event codebook, measured feeding timestamps,
broader nest samples and a prespecified sensitivity analysis before biological
conclusions are made.
""")
markdown("## 9. Validation Gate\nThis cell checks counts, matched configurations and source provenance. The public synthetic suite also checks actions, local sensing, scheduler independence and replay consistency.")
code("""from validate_research import validate_all
evidence = validate_all()
display(pd.DataFrame([evidence]))
assert len(scenarios) == 36 and len(fair) == 2160
assert len(runs) == 2880 and len(runs[runs.variant != 'main']) == 720
assert set(fair.nest) == {'v14', 'v72', 'v87'}
assert (fair.groupby(['scenario', 'replicate'])[['seed','n_wasps','grid_size','total_larvae']].nunique() == 1).all().all()
print('Nests:', fair.nest.nunique(), '| scenarios:', fair.scenario.nunique())
print('Fair simulations:', len(fair), '| ablations:', len(runs)-len(fair), '| extended:', len(extended))
print('Best ranked strategy:', ranking.iloc[0].strategy, '| still incomplete:', int((~fair.finished).sum()))
print('GREEN: all validation checks passed. Read the limitations before interpreting results.')
""")
nb = nbf.v4.new_notebook(cells=cells, metadata={"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}})
nbf.write(nb, ROOT / "final_analysis_v3.ipynb")
print("Created final_analysis_v3.ipynb")
