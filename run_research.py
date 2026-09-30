"""Sequential, resumable experiments and compact public replay exports."""
from __future__ import annotations
import argparse
import hashlib
import json
import time
from pathlib import Path
import numpy as np
import pandas as pd
import wasp_routing_analysis as legacy
from research_model import ResearchModel, STRATEGIES, VERSION, run_model, source_checksum, trace_payload


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def prepare():
    config = legacy.RunConfig()
    cells, behavior = legacy.load_data(Path("ED_FL_3nests1noC2.csv"), Path("ALL_FL_minmaj_final3noC2.csv"))
    nests, inventory = legacy.build_nest_inventory(cells, behavior, config)
    scenarios = legacy.build_scenario_table(behavior, inventory, nests, config)
    # Public scenario labels are ordinal, not original bout or worker identifiers.
    scenarios["public_id"] = [f"{nest}-S{i + 1:02}" for nest in nests
                              for i in range(int((scenarios.nest == nest).sum()))]
    geometry = {}
    for nest in nests:
        colony = legacy.build_larval_population(cells, nest, 2, legacy.stable_seed(f"colony_{nest}"))
        colony = colony.sort_values(["replica_id", "cell_no_"])
        row = scenarios[scenarios.nest == nest].iloc[0]
        placement = legacy.NestModel(cells, nest, colony, row.grid_size, 1, 1, 42)
        geometry[nest] = {"xy": [list(a.pos) for a in placement.larva_index.values()],
                          "stages": colony.stage_simple.tolist(),
                          "background": sorted([list(p) for p in placement.blocked_cells])}
    assert len(scenarios) == 36 and set(nests) == {"v14", "v72", "v87"}
    assert inventory.set_index("nest").scaled_larvae.to_dict() == {"v14": 68, "v72": 106, "v87": 134}
    return inventory, scenarios, geometry


def make_model(row, geometry, replicate, strategy, variant="main"):
    seed = legacy.stable_seed(f"{row.public_id}/replicate/{replicate}")
    nest = geometry[row.nest]
    rng = np.random.default_rng(legacy.stable_seed(f"initial-hunger/{seed}"))
    hunger = [rng.uniform(*legacy.HUNGER_RANGES[stage]) for stage in nest["stages"]]
    return ResearchModel(nest["xy"], hunger, nest["stages"], int(row.grid_size), int(row.n_wasps),
                         seed, strategy, claims_enabled=variant != "no_claims",
                         global_sensing=variant == "global_sensing")


def run_experiments(replicates=10, smoke=False, export_traces=True):
    inventory, scenarios, geometry = prepare()
    selected = scenarios.groupby("nest", sort=False).head(1) if smoke else scenarios
    fingerprint = hashlib.sha256((source_checksum() + json.dumps(geometry, sort_keys=True) +
                                  scenarios.to_json() + ":3000:10000:" + VERSION).encode()).hexdigest()
    checkpoint = Path("outputs") / VERSION / "checkpoints" / fingerprint
    summaries, curves, extended = [], [], []
    started = time.perf_counter()
    tasks = [(s, "main") for s in STRATEGIES]
    if not smoke:
        tasks += [("local_urgency_claims", "no_claims"), ("local_urgency_claims", "global_sensing")]
    count = len(selected) * replicates * len(tasks)
    for row in selected.itertuples(index=False):
        for replicate in range(replicates):
            for strategy, variant in tasks:
                key = f"{row.public_id}-{replicate}-{strategy}-{variant}"
                path = checkpoint / f"{key}.json"
                if path.exists():
                    result = json.loads(path.read_text(encoding="utf-8"))
                else:
                    model = make_model(row, geometry, replicate, strategy, variant)
                    summary, curve, _ = run_model(model, 3000)
                    summary.update(scenario=row.public_id, nest=row.nest, replicate=replicate, variant=variant)
                    result = {"summary": summary, "curve": curve, "extended": None}
                    if variant == "main" and not summary["finished"]:
                        continuation = make_model(row, geometry, replicate, strategy, variant)
                        completion, _, _ = run_model(continuation, 10000)
                        completion.update(scenario=row.public_id, nest=row.nest, replicate=replicate, variant=variant)
                        result["extended"] = completion
                    write_json(path, result)
                summaries.append(result["summary"])
                curves.append({"scenario": row.public_id, "nest": row.nest, "replicate": replicate,
                               "strategy": strategy, "variant": variant, "points": result["curve"]})
                if result["extended"]:
                    extended.append(result["extended"])
                if len(summaries) % 18 == 0:
                    print(f"{len(summaries)}/{count} runs; elapsed {time.perf_counter() - started:.1f}s", flush=True)
    frame = pd.DataFrame(summaries)
    main = frame[frame.variant == "main"]
    ranking = main.groupby("strategy", sort=False).agg(runs=("finished", "size"),
        reliability=("finished", "mean"), median_capped_steps=("observed_steps", "median"),
        median_distance_per_served=("distance_per_served", "median"),
        median_priority_wait=("priority_weighted_wait", "median")).reset_index()
    ranking = ranking.sort_values(["reliability", "median_capped_steps", "median_distance_per_served"],
                                   ascending=[False, True, True])
    public_columns = ["public_id", "nest", "observed_rows", "observed_feeding_events",
                      "observed_unique_cells", "observed_unique_wasps", "scaled_larvae", "grid_size", "n_wasps"]
    report = {"model_version": VERSION, "source_checksum": source_checksum(),
              "fingerprint": fingerprint, "replicates": replicates, "fair_horizon": 3000,
              "extended_horizon": 10000, "inventory": inventory.to_dict("records"),
              "scenarios": scenarios[public_columns].to_dict("records"), "runs": summaries,
              "curves": curves, "extended": extended, "ranking": ranking.to_dict("records"),
              "elapsed_seconds": round(time.perf_counter() - started, 2)}
    destination = Path("outputs/smoke.json") if smoke else Path("research_results.json")
    write_json(destination, report)
    if not smoke and export_traces:
        export_selected_traces(report, scenarios, geometry)
    print(ranking.to_string(index=False), flush=True)
    print(f"Saved {destination}; extended runs {len(extended)}", flush=True)
    return report


def export_selected_traces(report, scenarios, geometry):
    main = pd.DataFrame(report["runs"])
    main = main[main.variant == "main"]
    representatives = []
    for nest, group in main[main.strategy == "tsp"].groupby("nest"):
        medians = group.groupby("scenario").observed_steps.median().sort_values()
        representatives.append(medians.index[len(medians) // 2])
    worst = main.sort_values(["finished", "observed_steps", "completion_rate"],
                             ascending=[True, False, True]).iloc[0]
    if worst.scenario not in representatives:
        representatives.append(worst.scenario)
    manifest = {"model_version": VERSION, "source_checksum": source_checksum(), "scenarios": []}
    for scenario in representatives:
        row = next(r for r in scenarios.itertuples(index=False) if r.public_id == scenario)
        entry = {"id": scenario, "nest": row.nest, "label": "slowest / incomplete example" if scenario == worst.scenario else "median tour example",
                 "traces": {}}
        for strategy in STRATEGIES:
            replicate = int(worst.replicate) if scenario == worst.scenario else 0
            model = make_model(row, geometry, replicate, strategy)
            summary, _, frames = run_model(model, 10000, trace=True)
            summary.update(scenario=scenario, replicate=replicate, variant="main")
            payload = trace_payload(model, summary, frames, scenario)
            payload["background_cells"] = geometry[row.nest]["background"]
            name = f"{scenario}-{strategy}.json"
            write_json(Path("web/public/traces") / name, payload)
            entry["traces"][strategy] = f"traces/{name}"
        manifest["scenarios"].append(entry)
    write_json(Path("web/public/manifest.json"), manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--replicates", type=int, default=10)
    args = parser.parse_args()
    if not 1 <= args.replicates <= 10:
        parser.error("replicates must be between 1 and 10")
    run_experiments(1 if args.smoke else args.replicates, args.smoke)
