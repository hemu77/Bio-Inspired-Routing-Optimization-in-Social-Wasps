"""
Export playable strategy animations for the social-wasp routing benchmark.

GitHub renders GIFs directly in README files, while Matplotlib's interactive
JavaScript controls are best kept as standalone HTML files. This script creates
both formats for the same four-strategy scenario used in the final notebook.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation, PillowWriter

from wasp_routing_analysis import (
    STRATEGIES,
    RunConfig,
    WaspAgent,
    build_larval_population,
    build_nest_inventory,
    build_scenario_table,
    load_data,
    stable_seed,
    NestModel,
)


DISPLAY_ORDER = ["tsp", "greedy", "biased", "random"]


def prepare_animation_inputs(cells_csv: Path, behavior_csv: Path, config: RunConfig):
    cells_df, behavior_df = load_data(cells_csv, behavior_csv)
    nests, inventory = build_nest_inventory(cells_df, behavior_df, config)
    scenario_table = build_scenario_table(behavior_df, inventory, nests, config)
    colony_by_nest = {
        nest: build_larval_population(cells_df, nest, config.scale_factor, stable_seed(f"colony_{nest}", config.random_seed))
        for nest in nests
    }
    colony_by_scenario = {
        row.scenario_id: colony_by_nest[row.nest].copy(deep=True)
        for row in scenario_table.itertuples(index=False)
    }
    return cells_df, scenario_table, colony_by_scenario


def choose_display_scenario(scenario_table):
    v87 = scenario_table[scenario_table["nest"] == "v87"].copy()
    v87["distance_from_median"] = (v87["observed_feeding_events"] - v87["observed_feeding_events"].median()).abs()
    return v87.sort_values(
        ["distance_from_median", "observed_unique_cells", "scenario_id"],
        ascending=[True, False, True],
    ).iloc[0]


def capture_snapshot(model):
    larvae = []
    wasps = []
    for agent in model.schedule.agents:
        if hasattr(model, "larva_index") and agent.unique_id in model.larva_index:
            larvae.append({"pos": agent.pos, "full": agent.full, "hunger": agent.hunger, "stage": agent.stage})
        elif isinstance(agent, WaspAgent):
            wasps.append({"pos": agent.pos, "role": agent.role})
    fed = sum(item["full"] for item in larvae)
    return {
        "step": model.current_step,
        "fed": int(fed),
        "total": int(len(larvae)),
        "larvae": larvae,
        "wasps": wasps,
        "blocked_cells": sorted(model.blocked_cells),
        "grid_size": model.grid.width,
    }


def run_strategy_snapshots(cells_df, colony_by_scenario, scenario, strategy_name, max_steps):
    model = NestModel(
        cells_df,
        scenario.nest,
        colony_by_scenario[scenario.scenario_id],
        int(scenario.grid_size),
        int(scenario.n_wasps),
        max_steps=max_steps,
        seed=int(scenario.scenario_seed),
    )
    for agent in model.schedule.agents:
        if isinstance(agent, WaspAgent):
            agent.strategy = strategy_name

    snapshots = [capture_snapshot(model)]
    while model.running:
        model.step()
        snapshots.append(capture_snapshot(model))
    return snapshots


def sample_snapshots(snapshots, max_frames):
    if len(snapshots) <= max_frames:
        return snapshots
    chosen = np.unique(np.linspace(0, len(snapshots) - 1, max_frames, dtype=int))
    chosen[-1] = len(snapshots) - 1
    return [snapshots[i] for i in chosen]


def build_animation(strategy_name, scenario, snapshots, interval_ms=160):
    final_snapshot = snapshots[-1]
    fig, ax = plt.subplots(figsize=(6.8, 6.4), dpi=110)
    cmap = {"fed": "#2ca25f", "unfed": "#d7301f", "blocked": "#6b6b6b", "wasp": "#ffd43b"}

    legend_handles = [
        mpl.lines.Line2D([], [], color=cmap["fed"], marker="o", markersize=8, linestyle="None", label="fed larva"),
        mpl.lines.Line2D([], [], color=cmap["unfed"], marker="o", markersize=8, linestyle="None", label="unfed larva"),
        mpl.lines.Line2D([], [], color=cmap["blocked"], marker="s", markersize=7, linestyle="None", label="blocked cell"),
        mpl.lines.Line2D([], [], color=cmap["wasp"], marker="*", markersize=12, linestyle="None", label="wasp"),
    ]

    def update(frame_idx):
        frame = snapshots[frame_idx]
        fed = frame["fed"]
        total = frame["total"]
        progress = fed / total if total else 0
        ax.clear()
        ax.set_xlim(-0.5, frame["grid_size"] - 0.5)
        ax.set_ylim(-0.5, frame["grid_size"] - 0.5)
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_aspect("equal")
        ax.set_facecolor("#fbfaf4")
        ax.set_title(
            f"{scenario.scenario_id} | {strategy_name.upper()} | step {frame['step']} | "
            f"{fed}/{total} fed ({progress * 100:.1f}%)",
            fontsize=10,
            pad=8,
        )
        for pos in frame["blocked_cells"]:
            ax.scatter(*pos, c=cmap["blocked"], s=50, marker="s", alpha=0.55, zorder=1)
        for larva in frame["larvae"]:
            color = cmap["fed"] if larva["full"] else cmap["unfed"]
            size = {"L1": 55, "L2": 74, "L3": 95}.get(larva["stage"], 70)
            ax.scatter(*larva["pos"], c=color, s=size, edgecolor="#111111", linewidths=0.45, alpha=0.92, zorder=3)
        for wasp in frame["wasps"]:
            ax.scatter(*wasp["pos"], c=cmap["wasp"], s=130, marker="*", edgecolor="#111111", linewidths=0.65, zorder=4)
        if frame_idx == len(snapshots) - 1:
            status = "complete" if final_snapshot["fed"] == final_snapshot["total"] else "incomplete"
            ax.text(
                0.5,
                -0.055,
                f"final: {final_snapshot['fed']}/{final_snapshot['total']} fed at step {final_snapshot['step']} ({status})",
                transform=ax.transAxes,
                ha="center",
                fontsize=8,
                color="#1b5e20" if status == "complete" else "#8a4b00",
            )
        ax.legend(handles=legend_handles, loc="upper right", fontsize=7, frameon=True)

    animation = FuncAnimation(fig, update, frames=len(snapshots), interval=interval_ms, repeat=False, cache_frame_data=False)
    return fig, animation


def export_strategy_animation(strategy_name, scenario, snapshots, output_dir, fps):
    fig, animation = build_animation(strategy_name, scenario, snapshots)
    gif_path = output_dir / f"simulation_{strategy_name}.gif"
    html_path = output_dir / f"simulation_{strategy_name}.html"
    animation.save(gif_path, writer=PillowWriter(fps=fps))
    html_path.write_text(animation.to_jshtml(), encoding="utf-8")
    plt.close(fig)
    return gif_path, html_path


def parse_args():
    parser = argparse.ArgumentParser(description="Export playable GIF and HTML strategy animations.")
    parser.add_argument("--cells-csv", type=Path, default=Path("ED_FL_3nests1noC2.csv"))
    parser.add_argument("--behavior-csv", type=Path, default=Path("ALL_FL_minmaj_final3noC2.csv"))
    parser.add_argument("--output-dir", type=Path, default=Path("animations"))
    parser.add_argument("--max-frames", type=int, default=80)
    parser.add_argument("--fps", type=int, default=8)
    parser.add_argument("--max-steps", type=int, default=10000)
    return parser.parse_args()


def main():
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    config = RunConfig()
    cells_df, scenario_table, colony_by_scenario = prepare_animation_inputs(args.cells_csv, args.behavior_csv, config)
    scenario = choose_display_scenario(scenario_table)

    print(f"Selected animation scenario: {scenario.scenario_id}")
    for strategy_name in DISPLAY_ORDER:
        if strategy_name not in STRATEGIES:
            raise ValueError(f"Unknown strategy: {strategy_name}")
        raw_snapshots = run_strategy_snapshots(cells_df, colony_by_scenario, scenario, strategy_name, max_steps=args.max_steps)
        snapshots = sample_snapshots(raw_snapshots, args.max_frames)
        gif_path, html_path = export_strategy_animation(strategy_name, scenario, snapshots, args.output_dir, args.fps)
        final = raw_snapshots[-1]
        print(
            f"{strategy_name}: step={final['step']}, fed={final['fed']}/{final['total']}, "
            f"frames={len(snapshots)} -> {gif_path}, {html_path}"
        )


if __name__ == "__main__":
    main()
