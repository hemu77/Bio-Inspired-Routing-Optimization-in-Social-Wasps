"""
All-nest larval feeding benchmark for social-wasp routing strategies.

This script mirrors the core logic in final_analysis.ipynb without embedding
notebook outputs or datasets. It expects the two project CSV files to exist
locally and writes benchmark summaries/figures to an output directory.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import random
import warnings
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from mesa import Agent, Model
from mesa.datacollection import DataCollector
from mesa.space import MultiGrid
from mesa.time import RandomActivation


warnings.filterwarnings(
    "ignore",
    message="The time module and all its Schedulers are deprecated*",
    category=DeprecationWarning,
)
warnings.filterwarnings("ignore", category=FutureWarning)

sns.set_theme(style="whitegrid", context="talk")

FEEDING_CODES = {"FL", "FL2", "LPL", "SPL"}
STRATEGIES = ["random", "biased", "greedy", "tsp"]
HUNGER_RANGES = {
    "L1": (0.20, 0.50),
    "L2": (0.45, 0.75),
    "L3": (0.65, 1.00),
}


@dataclass(frozen=True)
class RunConfig:
    scale_factor: int = 2
    random_seed: int = 42
    benchmark_steps: int = 3000
    extended_steps: int = 10000
    larvae_per_wasp: int = 5
    activity_events_per_extra_wasp: int = 100


def stable_seed(label: str, offset: int = 42) -> int:
    digest = hashlib.sha256(str(label).encode("utf-8")).hexdigest()
    return offset + int(digest[:8], 16) % 1_000_000


def simplify_stage(stage: object) -> str:
    if isinstance(stage, str):
        stage = stage.lower()
        if stage in {"i1", "i2"}:
            return "L1"
        if stage in {"i3", "i4"}:
            return "L2"
        if stage == "i5":
            return "L3"
        if stage in {"p", "pupa"}:
            return "P"
        if stage in {"e", "egg", "empty"}:
            return "E"
    return "E"


def load_data(cells_csv: Path, behavior_csv: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    cells_df = pd.read_csv(cells_csv)
    behavior_df = pd.read_csv(behavior_csv)
    cells_df.columns = [col.strip().replace(".", "_") for col in cells_df.columns]
    behavior_df.columns = [col.strip().replace(".", "_") for col in behavior_df.columns]
    cells_df["stage_simple"] = cells_df["stages"].apply(simplify_stage)
    behavior_df["cell_no_numeric"] = pd.to_numeric(behavior_df["cell_no_"], errors="coerce")
    return cells_df, behavior_df


def build_nest_inventory(cells_df: pd.DataFrame, behavior_df: pd.DataFrame, config: RunConfig) -> tuple[list[str], pd.DataFrame]:
    nests = sorted(set(cells_df["nest"].dropna()) & set(behavior_df["nest"].dropna()))
    inventory = (
        cells_df[cells_df["nest"].isin(nests)]
        .groupby("nest")
        .agg(
            total_cells=("cell_no_", "count"),
            base_larvae=("contents_new", lambda s: int((s == "L").sum())),
            empty_cells=("contents_new", lambda s: int((s == "E").sum())),
            pupae=("contents_new", lambda s: int((s == "P").sum())),
        )
        .reset_index()
    )
    inventory["scaled_larvae"] = inventory["base_larvae"] * config.scale_factor
    inventory["grid_size"] = inventory["scaled_larvae"].map(lambda n: max(22, int(math.ceil(math.sqrt(n) * 2.4))))
    return nests, inventory


def build_scenario_table(
    behavior_df: pd.DataFrame,
    inventory: pd.DataFrame,
    nests: list[str],
    config: RunConfig,
) -> pd.DataFrame:
    scenario_table = (
        behavior_df[behavior_df["nest"].isin(nests)]
        .assign(is_feeding_event=lambda df: df["beh"].isin(FEEDING_CODES))
        .groupby(["nest", "bout"], as_index=False)
        .agg(
            observed_rows=("beh", "size"),
            observed_feeding_events=("is_feeding_event", "sum"),
            observed_unique_cells=("cell_no_numeric", "nunique"),
            observed_unique_wasps=("id", "nunique"),
        )
        .sort_values(["nest", "bout"], key=lambda col: col.astype(str))
        .reset_index(drop=True)
    )
    scenario_table["scenario_id"] = [
        f"{nest}_bout_{bout}" for nest, bout in zip(scenario_table["nest"], scenario_table["bout"])
    ]
    scenario_table = scenario_table.merge(
        inventory[["nest", "base_larvae", "scaled_larvae", "grid_size"]],
        on="nest",
        how="left",
    )
    scenario_table["base_wasps"] = np.ceil(scenario_table["scaled_larvae"] / config.larvae_per_wasp).astype(int)
    scenario_table["observed_wasp_floor"] = scenario_table["observed_unique_wasps"].astype(int)
    scenario_table["activity_wasp_bonus"] = np.ceil(
        scenario_table["observed_feeding_events"] / config.activity_events_per_extra_wasp
    ).astype(int)
    scenario_table["n_wasps"] = (
        scenario_table[["base_wasps", "observed_wasp_floor"]].max(axis=1)
        + scenario_table["activity_wasp_bonus"]
    ).astype(int)
    scenario_table["scenario_seed"] = [
        stable_seed(scenario_id, config.random_seed) for scenario_id in scenario_table["scenario_id"]
    ]
    return scenario_table


def build_larval_population(
    cells_df: pd.DataFrame,
    nest_id: str,
    scale_factor: int,
    seed: int,
    hunger_mode: str = "stage_random",
) -> pd.DataFrame:
    if hunger_mode != "stage_random":
        raise ValueError("Only stage_random hunger initialization is supported.")
    base_larvae = (
        cells_df[(cells_df["nest"] == nest_id) & (cells_df["contents_new"] == "L")]
        .copy()
        .sort_values("cell_no_")
        .reset_index(drop=True)
    )
    replica_offsets = [(0.00, 0.00), (0.18, 0.12), (-0.18, 0.12), (0.18, -0.12), (-0.18, -0.12)]
    micro_pattern = np.array(
        [
            (0.00, 0.00),
            (0.05, 0.02),
            (-0.05, 0.02),
            (0.04, -0.03),
            (-0.04, -0.03),
            (0.03, 0.04),
            (-0.03, 0.04),
            (0.02, -0.04),
            (-0.02, -0.04),
        ]
    )
    colonies = []
    for replica_id in range(scale_factor):
        replica = base_larvae.copy()
        base_dx, base_dy = replica_offsets[replica_id % len(replica_offsets)]
        repeated = np.tile(micro_pattern, (math.ceil(len(replica) / len(micro_pattern)), 1))[: len(replica)]
        replica["X_new"] = replica["X_new"].to_numpy() + base_dx + repeated[:, 0] * replica_id
        replica["Y_new"] = replica["Y_new"].to_numpy() + base_dy + repeated[:, 1] * replica_id
        replica["replica_id"] = replica_id
        replica["cell_no_original"] = replica["cell_no_"]
        replica["cell_no_"] = replica["cell_no_"] + replica_id * 1000
        colonies.append(replica)

    colony_df = pd.concat(colonies, ignore_index=True)
    colony_df["stage_simple"] = colony_df["stages"].apply(simplify_stage)
    rng = np.random.default_rng(seed)
    colony_df["hunger_init"] = [
        rng.uniform(*HUNGER_RANGES.get(stage, (0.35, 0.75))) for stage in colony_df["stage_simple"]
    ]
    colony_df["larva_uid"] = [
        f"{nest_id}_L_{int(cell_no)}_r{int(replica_id)}"
        for cell_no, replica_id in zip(colony_df["cell_no_"], colony_df["replica_id"])
    ]
    return colony_df.reset_index(drop=True)


class LarvaAgent(Agent):
    def __init__(self, unique_id: str, model: Model, stage: str, dist_center: float, hunger_init: float):
        self.unique_id = unique_id
        self.model = model
        self.pos = None
        self.stage = stage
        self.dist_center = float(dist_center)
        self.hunger = float(hunger_init)
        self.fed_count = 0
        self.full = False

    def hunger_update(self) -> None:
        if self.full:
            return
        stage_growth = {"L1": 0.020, "L2": 0.028, "L3": 0.035}.get(self.stage, 0.025)
        self.hunger = min(1.0, self.hunger + stage_growth)

    def feed(self) -> None:
        self.fed_count += 1
        stage_drop = {"L1": 0.35, "L2": 0.45, "L3": 0.55}.get(self.stage, 0.40)
        self.hunger = max(0.0, self.hunger - stage_drop)
        if self.fed_count >= 3 or self.hunger <= 0.12:
            self.full = True

    def step(self) -> None:
        self.hunger_update()


class WaspAgent(Agent):
    def __init__(self, unique_id: str, model: Model, role: str = "feeder"):
        self.unique_id = unique_id
        self.model = model
        self.pos = None
        self.role = role
        self.memory = set()
        self.path = []
        self.distance_travelled = 0
        self.direction = self.model.random.choice(["N", "S", "E", "W"])
        self.carrying_food = role != "forager"
        self.tsp_queue = []

    @staticmethod
    def manhattan(a: tuple[int, int], b: tuple[int, int]) -> int:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])

    def get_unfed_larvae(self) -> list[LarvaAgent]:
        return [agent for agent in self.model.schedule.agents if isinstance(agent, LarvaAgent) and not agent.full]

    def choose_target(self) -> LarvaAgent | None:
        larvae = self.get_unfed_larvae()
        if not larvae:
            return None
        weights = []
        for larva in larvae:
            stage_weight = {"L1": 1.0, "L2": 1.35, "L3": 1.70}.get(larva.stage, 1.0)
            centrality_weight = 1 / (1 + larva.dist_center)
            distance_weight = 1 / (1 + self.manhattan(self.pos, larva.pos))
            memory_weight = 0.75 if larva.unique_id in self.memory else 1.0
            claim_penalty = 1 / (1 + 2 * self.model.target_claims.get(larva.unique_id, 0))
            urgency = max(larva.hunger, 0.05)
            weights.append(max(1e-6, urgency * stage_weight * centrality_weight * distance_weight * memory_weight * claim_penalty))
        target = self.model.random.choices(larvae, weights=weights, k=1)[0]
        self.model.target_claims[target.unique_id] = self.model.target_claims.get(target.unique_id, 0) + 1
        return target

    def build_tsp_queue(self) -> None:
        remaining = self.get_unfed_larvae()
        route = []
        current = self.pos
        while remaining:
            next_larva = min(remaining, key=lambda larva: self.manhattan(current, larva.pos))
            route.append(next_larva.unique_id)
            current = next_larva.pos
            remaining.remove(next_larva)
        self.tsp_queue = route

    def step_towards(self, target_pos: tuple[int, int] | None = None) -> None:
        x, y = self.pos
        if target_pos is None:
            moves = {"N": (0, 1), "S": (0, -1), "E": (1, 0), "W": (-1, 0)}
            dx, dy = moves[self.direction]
            nx, ny = x + dx, y + dy
            if self.model.random.random() < 0.25:
                self.direction = self.model.random.choice(["N", "S", "E", "W"])
        else:
            tx, ty = target_pos
            nx = x + int(np.sign(tx - x))
            ny = y + int(np.sign(ty - y))
        nx = int(np.clip(nx, 0, self.model.grid.width - 1))
        ny = int(np.clip(ny, 0, self.model.grid.height - 1))
        self.distance_travelled += self.manhattan((x, y), (nx, ny))
        self.model.grid.move_agent(self, (nx, ny))
        self.path.append((nx, ny))

    def try_feed_here(self) -> bool:
        for agent in self.model.grid.get_cell_list_contents(self.pos):
            if isinstance(agent, LarvaAgent) and not agent.full:
                if self.role == "forager" and not self.carrying_food:
                    return False
                agent.feed()
                self.memory.add(agent.unique_id)
                if self.role == "forager":
                    self.carrying_food = False
                return True
        return False

    def step(self) -> None:
        if self.pos is None:
            return
        if self.role == "forager" and not self.carrying_food:
            self.carrying_food = True
        strategy = getattr(self, "strategy", "biased")
        if strategy == "random":
            self.direction = self.model.random.choice(["N", "S", "E", "W"])
            self.step_towards(None)
            self.try_feed_here()
            return
        if strategy == "biased":
            self.step_towards(None)
            self.try_feed_here()
            return
        if strategy == "greedy":
            target = self.choose_target()
            if target is None:
                self.step_towards(None)
                return
            if self.pos != target.pos:
                self.step_towards(target.pos)
            self.try_feed_here()
            return
        if strategy == "tsp":
            if not self.tsp_queue:
                self.build_tsp_queue()
            while self.tsp_queue:
                target_id = self.tsp_queue[0]
                larva = self.model.larva_index.get(target_id)
                if larva is None or larva.full:
                    self.tsp_queue.pop(0)
                    continue
                if self.pos != larva.pos:
                    self.step_towards(larva.pos)
                fed = self.try_feed_here()
                if fed or self.pos == larva.pos:
                    self.tsp_queue.pop(0)
                return
            self.step_towards(None)
            return
        raise ValueError(f"Unknown strategy: {strategy}")


class NestModel(Model):
    def __init__(
        self,
        cells_df: pd.DataFrame,
        nest_id: str,
        colony_df: pd.DataFrame,
        grid_size: int,
        n_wasps: int,
        max_steps: int,
        seed: int,
    ):
        self.random = random.Random(int(seed))
        self.grid = MultiGrid(int(grid_size), int(grid_size), torus=False)
        self.schedule = RandomActivation(self)
        self.current_step = 0
        self.max_steps = int(max_steps)
        self.running = True
        self.nest_id = nest_id
        self.colony_df = colony_df.copy()
        self.n_wasps = int(n_wasps)
        self.seed = int(seed)
        self.larva_index = {}
        self.target_claims = {}
        self.nest_cells = cells_df[cells_df["nest"] == nest_id].copy()
        self.x_min = min(self.colony_df["X_new"].min(), self.nest_cells["X_new"].min())
        self.x_max = max(self.colony_df["X_new"].max(), self.nest_cells["X_new"].max())
        self.y_min = min(self.colony_df["Y_new"].min(), self.nest_cells["Y_new"].min())
        self.y_max = max(self.colony_df["Y_new"].max(), self.nest_cells["Y_new"].max())
        self.blocked_cells = self._build_blocked_cells()
        self._create_larvae()
        self._create_wasps()
        self.datacollector = DataCollector(
            model_reporters={
                "fed_larvae": lambda m: sum(isinstance(a, LarvaAgent) and a.full for a in m.schedule.agents),
                "total_larvae": lambda m: sum(isinstance(a, LarvaAgent) for a in m.schedule.agents),
                "total_distance": lambda m: sum(
                    getattr(a, "distance_travelled", 0) for a in m.schedule.agents if isinstance(a, WaspAgent)
                ),
                "avg_hunger": lambda m: float(np.mean([a.hunger for a in m.schedule.agents if isinstance(a, LarvaAgent)])),
            }
        )

    def _to_grid(self, x: float, y: float) -> tuple[int, int]:
        gx = int(round(np.interp(x, [self.x_min, self.x_max], [0, self.grid.width - 1])))
        gy = int(round(np.interp(y, [self.y_min, self.y_max], [0, self.grid.height - 1])))
        return gx, gy

    def _resolve_position(self, candidate: tuple[int, int], occupied: set[tuple[int, int]]) -> tuple[int, int]:
        if candidate not in occupied and candidate not in self.blocked_cells:
            return candidate
        for radius in range(1, self.grid.width + self.grid.height):
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    if max(abs(dx), abs(dy)) != radius:
                        continue
                    nx = candidate[0] + dx
                    ny = candidate[1] + dy
                    if 0 <= nx < self.grid.width and 0 <= ny < self.grid.height:
                        pos = (nx, ny)
                        if pos not in occupied and pos not in self.blocked_cells:
                            return pos
        raise RuntimeError("Unable to place larva on the grid without collision.")

    def _build_blocked_cells(self) -> set[tuple[int, int]]:
        blocked = set()
        blocked_rows = self.nest_cells[self.nest_cells["contents_new"].isin(["E", "P"])]
        for _, row in blocked_rows.iterrows():
            blocked.add(self._to_grid(row["X_new"], row["Y_new"]))
        return blocked

    def _create_larvae(self) -> None:
        occupied = set()
        for _, row in self.colony_df.sort_values(["replica_id", "cell_no_"]).iterrows():
            candidate = self._to_grid(row["X_new"], row["Y_new"])
            pos = self._resolve_position(candidate, occupied)
            larva = LarvaAgent(row["larva_uid"], self, row["stage_simple"], row["cell_ed"], row["hunger_init"])
            self.grid.place_agent(larva, pos)
            self.schedule.add(larva)
            self.larva_index[larva.unique_id] = larva
            occupied.add(pos)
        self.blocked_cells = {pos for pos in self.blocked_cells if pos not in occupied}

    def _create_wasps(self) -> None:
        role_weights = [0.10, 0.18, 0.72]
        offsets = [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
        cx = self.grid.width // 2
        cy = self.grid.height // 2
        for i in range(self.n_wasps):
            role = self.random.choices(["forager", "unloader", "feeder"], weights=role_weights, k=1)[0]
            dx, dy = offsets[i % len(offsets)]
            start_pos = (int(np.clip(cx + dx, 0, self.grid.width - 1)), int(np.clip(cy + dy, 0, self.grid.height - 1)))
            wasp = WaspAgent(f"W_{i}", self, role=role)
            self.grid.place_agent(wasp, start_pos)
            self.schedule.add(wasp)
            wasp.path.append(start_pos)

    def step(self) -> None:
        self.target_claims = {}
        self.datacollector.collect(self)
        self.schedule.step()
        self.current_step += 1
        larvae = [agent for agent in self.schedule.agents if isinstance(agent, LarvaAgent)]
        if larvae and all(larva.full for larva in larvae):
            self.running = False
        elif self.current_step >= self.max_steps:
            self.running = False


def run_strategy(
    cells_df: pd.DataFrame,
    colony_by_scenario: dict[str, pd.DataFrame],
    scenario: object,
    strategy_name: str,
    max_steps: int,
    collect_steps: bool = True,
) -> tuple[pd.DataFrame | None, dict[str, object]]:
    colony_df = colony_by_scenario[scenario.scenario_id]
    model = NestModel(cells_df, scenario.nest, colony_df, int(scenario.grid_size), int(scenario.n_wasps), max_steps, int(scenario.scenario_seed))
    for agent in model.schedule.agents:
        if isinstance(agent, WaspAgent):
            agent.strategy = strategy_name
    while model.running:
        model.step()
    model.datacollector.collect(model)
    df = model.datacollector.get_model_vars_dataframe().reset_index(drop=True)
    df["step"] = np.arange(len(df))
    df["scenario_id"] = scenario.scenario_id
    df["nest"] = scenario.nest
    df["bout"] = str(scenario.bout)
    df["strategy"] = strategy_name
    df["n_wasps"] = int(scenario.n_wasps)
    df["grid_size"] = int(scenario.grid_size)
    df["scenario_seed"] = int(scenario.scenario_seed)
    df["finished"] = df["fed_larvae"] == df["total_larvae"]
    final_row = df.iloc[-1]
    finished_rows = df[df["finished"]]
    finished = not finished_rows.empty
    completion_step = int(finished_rows["step"].iloc[0]) if finished else int(final_row["step"])
    summary = {
        "scenario_id": scenario.scenario_id,
        "nest": scenario.nest,
        "bout": str(scenario.bout),
        "strategy": strategy_name,
        "finished": bool(finished),
        "completion_step": completion_step,
        "fed_larvae": int(final_row["fed_larvae"]),
        "total_larvae": int(final_row["total_larvae"]),
        "completion_rate": float(final_row["fed_larvae"] / final_row["total_larvae"]),
        "final_distance": float(final_row["total_distance"]),
        "final_avg_hunger": float(final_row["avg_hunger"]),
        "distance_per_fed_larva": float(final_row["total_distance"] / max(int(final_row["fed_larvae"]), 1)),
        "n_wasps": int(scenario.n_wasps),
        "grid_size": int(scenario.grid_size),
        "scenario_seed": int(scenario.scenario_seed),
        "observed_rows": int(scenario.observed_rows),
        "observed_feeding_events": int(scenario.observed_feeding_events),
        "observed_unique_cells": int(scenario.observed_unique_cells),
        "observed_unique_wasps": int(scenario.observed_unique_wasps),
    }
    return (df if collect_steps else None), summary


def run_benchmark(cells_df: pd.DataFrame, behavior_df: pd.DataFrame, config: RunConfig) -> dict[str, pd.DataFrame]:
    nests, inventory = build_nest_inventory(cells_df, behavior_df, config)
    scenario_table = build_scenario_table(behavior_df, inventory, nests, config)
    colony_by_nest = {
        nest: build_larval_population(cells_df, nest, config.scale_factor, stable_seed(f"colony_{nest}", config.random_seed))
        for nest in nests
    }
    colony_by_scenario = {
        row.scenario_id: colony_by_nest[row.nest].copy(deep=True) for row in scenario_table.itertuples(index=False)
    }

    fair_step_runs = []
    fair_summaries = []
    for scenario in scenario_table.itertuples(index=False):
        for strategy in STRATEGIES:
            steps, summary = run_strategy(
                cells_df,
                colony_by_scenario,
                scenario,
                strategy,
                max_steps=config.benchmark_steps,
                collect_steps=True,
            )
            fair_step_runs.append(steps)
            fair_summaries.append(summary)

    fair_results = pd.concat(fair_step_runs, ignore_index=True)
    fair_summary = pd.DataFrame(fair_summaries)
    fair_summary["movement_efficiency"] = fair_summary["fed_larvae"] * 1000 / fair_summary["final_distance"].replace(0, np.nan)
    fair_summary["movement_efficiency"] = fair_summary["movement_efficiency"].fillna(0)
    scenario_winners = (
        fair_summary.sort_values(["scenario_id", "finished", "completion_step", "final_distance"], ascending=[True, False, True, True])
        .groupby("scenario_id", as_index=False)
        .head(1)
        .reset_index(drop=True)
    )
    overall_ranking = (
        fair_summary.groupby("strategy")
        .agg(
            runs=("scenario_id", "count"),
            finish_rate=("finished", "mean"),
            median_completion_rate=("completion_rate", "median"),
            median_completion_step=("completion_step", "median"),
            median_distance=("final_distance", "median"),
            median_avg_hunger=("final_avg_hunger", "median"),
            median_efficiency=("movement_efficiency", "median"),
        )
        .reset_index()
        .sort_values(["finish_rate", "median_completion_step", "median_distance"], ascending=[False, True, True])
    )
    return {
        "nest_inventory": inventory,
        "scenario_table": scenario_table,
        "fair_results": fair_results,
        "fair_summary": fair_summary,
        "scenario_winners": scenario_winners,
        "overall_strategy_ranking": overall_ranking,
    }


def save_plots(results: dict[str, pd.DataFrame], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    fair_summary = results["fair_summary"]
    ranking = results["overall_strategy_ranking"]
    color_map = {"tsp": "#1b9e77", "greedy": "#66a61e", "biased": "#7570b3", "random": "#d95f02"}
    order = ["tsp", "greedy", "biased", "random"]

    fig, ax = plt.subplots(figsize=(9.5, 5.6))
    sns.barplot(data=ranking, y="strategy", x="median_completion_step", order=order, palette=color_map, ax=ax)
    ax.set_title("Median Completion Step by Strategy")
    ax.set_xlabel("Median completion step")
    ax.set_ylabel("Strategy")
    fig.tight_layout()
    fig.savefig(output_dir / "median_completion_step.png", dpi=180)
    plt.close(fig)

    tsp_steps = fair_summary[fair_summary["strategy"] == "tsp"][["scenario_id", "completion_step"]].rename(columns={"completion_step": "tsp_step"})
    delay_df = fair_summary.merge(tsp_steps, on="scenario_id", how="left")
    delay_df["extra_steps_vs_tsp"] = delay_df["completion_step"] - delay_df["tsp_step"]
    fig, ax = plt.subplots(figsize=(10.5, 6))
    sns.boxplot(
        data=delay_df[delay_df["strategy"] != "tsp"],
        y="strategy",
        x="extra_steps_vs_tsp",
        order=["greedy", "biased", "random"],
        hue="strategy",
        palette=color_map,
        legend=False,
        ax=ax,
    )
    ax.axvline(0, color="#222222", linestyle="--", linewidth=1)
    ax.set_title("Extra Completion Steps Compared with TSP")
    ax.set_xlabel("Extra steps on the same scenario")
    ax.set_ylabel("Strategy")
    fig.tight_layout()
    fig.savefig(output_dir / "delay_vs_tsp.png", dpi=180)
    plt.close(fig)

    scenario_meta = fair_summary[fair_summary["strategy"] == "tsp"].copy()
    features = ["observed_feeding_events", "observed_unique_cells", "total_larvae"]
    for feature in features:
        std = scenario_meta[feature].std(ddof=0)
        scenario_meta[f"z_{feature}"] = 0 if std == 0 else (scenario_meta[feature] - scenario_meta[feature].mean()) / std
    scenario_meta["difficulty_index"] = scenario_meta[[f"z_{feature}" for feature in features]].mean(axis=1)
    fig, ax = plt.subplots(figsize=(9, 5.5))
    sns.regplot(data=scenario_meta, x="difficulty_index", y="completion_step", scatter=False, color="#333333", ax=ax)
    sns.scatterplot(data=scenario_meta, x="difficulty_index", y="completion_step", hue="nest", s=90, ax=ax)
    ax.set_title("Observed Bout Difficulty vs TSP Completion")
    ax.set_xlabel("Difficulty index")
    ax.set_ylabel("TSP completion step")
    fig.tight_layout()
    fig.savefig(output_dir / "difficulty_vs_completion.png", dpi=180)
    plt.close(fig)


def write_outputs(results: dict[str, pd.DataFrame], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, df in results.items():
        df.to_csv(output_dir / f"{name}.csv", index=False)
    save_plots(results, output_dir)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the social-wasp larval feeding routing benchmark.")
    parser.add_argument("--cells-csv", type=Path, default=Path("ED_FL_3nests1noC2.csv"))
    parser.add_argument("--behavior-csv", type=Path, default=Path("ALL_FL_minmaj_final3noC2.csv"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs"))
    parser.add_argument("--benchmark-steps", type=int, default=3000)
    parser.add_argument("--scale-factor", type=int, default=2)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = RunConfig(scale_factor=args.scale_factor, random_seed=args.seed, benchmark_steps=args.benchmark_steps)
    cells_df, behavior_df = load_data(args.cells_csv, args.behavior_csv)
    results = run_benchmark(cells_df, behavior_df, config)
    write_outputs(results, args.output_dir)
    best = results["overall_strategy_ranking"].iloc[0]
    print("Benchmark complete")
    print(f"Scenarios: {len(results['scenario_table'])}")
    print(f"Fair simulations: {len(results['fair_summary'])}")
    print(f"Best strategy: {best['strategy']} (median completion step={best['median_completion_step']:.0f})")
    print(f"Outputs written to: {args.output_dir.resolve()}")


if __name__ == "__main__":
    main()
