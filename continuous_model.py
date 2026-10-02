"""Synthetic continuous-feeding experiment; food units are assumptions, not grams.

Reuse the published routing decisions, but make hunger renewable and food finite.
This experiment never loads the privately supplied nest or bout datasets.
"""
from __future__ import annotations

import hashlib
import json
import gzip
import time
import os
from pathlib import Path
import numpy as np
from research_model import ResearchModel, STRATEGIES, MOVES, SATIATION_THRESHOLD, HUNGER_GROWTH, FEED_DROP

SUPPLIES = {"scarce": (.08, 1., 3.), "variable": (.20, 2., 6.), "abundant": (.40, 3., 7.)}
VERSION = "continuous-synthetic-v1"
ENVIRONMENTS = {"small": (36, 12, 12), "medium": (108, 36, 21), "large": (324, 108, 36)}


class ContinuousModel(ResearchModel):
    def __init__(self, *args, supply="variable", initial_stock=6., capacity=2., supply_scale=1., **kwargs):
        super().__init__(*args, **kwargs)
        if supply not in SUPPLIES or not np.isfinite(initial_stock) or initial_stock < 0 or not np.isfinite(capacity) or capacity <= 0 or not np.isfinite(supply_scale) or supply_scale <= 0:
            raise ValueError("Invalid food supply or capacity")
        self.supply, self.capacity = supply, float(capacity)
        self.supply_scale = float(supply_scale)
        self.tour_distances = None
        self.initial_stock = self.stock = float(initial_stock)
        self.delivered = self.consumed = 0.
        self.loads = np.zeros(self.n_wasps)
        self.depot = np.array([self.size // 2] * 2)
        # A separate stream pairs deliveries across policies regardless of their actions.
        self.delivery_rng = np.random.default_rng(np.random.SeedSequence([self.seed, 9821]))
        self.hunger_returns = np.zeros(len(self.larvae), dtype=int)
        self.refeeds = np.zeros(len(self.larvae), dtype=int)
        self.ever_full = self.hunger <= SATIATION_THRESHOLD
        self.empty_waits = 0
        self.seen_at = [{} for _ in range(self.n_wasps)]

    def choose_target(self, worker):
        if self.strategy == "tsp" and not self.queues[worker]:
            # Same nearest-neighbour order and index tie-break as the original loop.
            if self.tour_distances is None:
                self.tour_distances = np.abs(self.larvae[:, None] - self.larvae[None, :]).sum(axis=2)
            left = np.flatnonzero(self.satiated_at < 0)
            distances = np.abs(self.larvae - self.positions[worker]).sum(axis=1)
            while len(left):
                chosen_at = int(np.argmin(distances[left]))
                chosen = int(left[chosen_at])
                self.queues[worker].append(chosen)
                left = np.delete(left, chosen_at)
                distances = self.tour_distances[chosen]
        return super().choose_target(worker)

    def observe(self, worker):
        # Old observations must not make a previously full larva permanently invisible.
        for larva, when in list(self.seen_at[worker].items()):
            if self.tick - when > 20:
                self.memory[worker].pop(larva, None)
                del self.seen_at[worker][larva]
        radius = 2 * self.size if self.global_sensing else 3
        for larva in np.flatnonzero(np.abs(self.larvae-self.positions[worker]).sum(axis=1) <= radius):
            self.seen_at[worker][int(larva)] = self.tick
        return super().observe(worker)

    def move(self, worker, move):
        old = self.positions[worker].copy()
        self.positions[worker] = np.clip(old + move, 0, self.size - 1)
        self.distance[worker] += int(np.abs(self.positions[worker]-old).sum())
        self.visits[worker, *self.positions[worker]] += 1

    def toward(self, worker, target):
        delta = np.asarray(target)-self.positions[worker]
        move = np.zeros(2, dtype=int)
        axis = 0 if delta[0] else 1
        move[axis] = np.sign(delta[axis])
        self.move(worker, move)

    def step(self):
        self.tick += 1
        self.events = []
        was_full = self.hunger <= SATIATION_THRESHOLD
        self.hunger = np.minimum(1., self.hunger + self.growth)
        reopened = was_full & (self.hunger > SATIATION_THRESHOLD)
        self.hunger_returns += reopened
        self.satiated_at[self.hunger > SATIATION_THRESHOLD] = -1
        # Retain the current tour, but never lose renewed demand from its queue.
        if self.strategy == "tsp":
            for queue in self.queues:
                if queue:
                    queue.extend(int(i) for i in np.flatnonzero(reopened) if i not in queue)
        probability, low, high = SUPPLIES[self.supply]
        # Arrivals are external foraging deliveries, not simulated forager agents.
        arrival = float(self.delivery_rng.uniform(low, high)) * self.supply_scale if self.delivery_rng.random() < probability else 0.
        self.stock += arrival
        self.delivered += arrival
        self.delivery_this_tick = arrival
        self.expire_claims()
        self.last_order = self.scheduler.permutation(self.n_wasps).tolist()
        for worker in self.last_order:
            self.broadcast_this_action = False
            pos = self.positions[worker]
            if self.loads[worker] <= 1e-12:
                self.target[worker] = -1
                if np.array_equal(pos, self.depot):
                    amount = min(self.capacity, self.stock)
                    self.stock -= amount
                    self.loads[worker] = amount
                    self.events.append({"type": "refill", "worker": worker, "amount": amount})
                    self.reason[worker] = "refill at depot" if amount > 0 else "depot empty; waiting"
                    self.empty_waits += amount == 0
                else:
                    self.toward(worker, self.depot)
                    self.reason[worker] = "empty; return to depot"
                continue
            larva = self.cell_larva.get(tuple(pos))
            if larva is not None and self.hunger[larva] > SATIATION_THRESHOLD:
                before = float(self.hunger[larva])
                amount = min(float(self.portions[larva]), before, float(self.loads[worker]))
                self.hunger[larva] -= amount
                self.loads[worker] -= amount
                self.consumed += amount
                first = self.first_feed[larva] < 0
                if first:
                    self.first_feed[larva] = self.tick
                if self.ever_full[larva]:
                    self.refeeds[larva] += 1
                self.feed_counts[larva] += 1
                if self.hunger[larva] <= SATIATION_THRESHOLD:
                    self.satiated_at[larva] = self.tick
                    self.ever_full[larva] = True
                self.memory[worker][larva] = (tuple(pos), bool(self.satiated_at[larva] >= 0), float(self.hunger[larva]))
                self.seen_at[worker][larva] = self.tick
                self.target[worker] = larva
                self.reason[worker] = "feed from carried food; no movement"
                self.events.append({"type": "first_feed" if first else "feed", "worker": worker,
                                    "larva": larva, "amount": amount, "hunger_before": before,
                                    "hunger_after": float(self.hunger[larva])})
                continue
            target = self.choose_target(worker)
            self.target[worker] = target
            if self.broadcast_this_action:
                self.reason[worker] = "claim broadcast; no movement"
            elif target >= 0:
                xy = self.memory[worker][target][0] if self.strategy.startswith("local_") else self.larvae[target]
                self.toward(worker, xy)
                self.reason[worker] = "route to hungry larva"
            elif self.strategy.startswith("local_"):
                neighbors = pos + MOVES
                valid = np.flatnonzero(((neighbors >= 0) & (neighbors < self.size)).all(axis=1))
                if len(valid):
                    counts = np.array([self.visits[worker, *neighbors[i]] for i in valid])
                    self.move(worker, MOVES[self.policy.choice(valid[counts == counts.min()])])
                self.reason[worker] = "explore for renewed demand"
            else:
                if self.strategy == "random" or self.policy.random() < .25:
                    self.directions[worker] = self.policy.integers(0, 4)
                self.move(worker, MOVES[self.directions[worker]])
                self.reason[worker] = "blind walk"

    def snapshot(self):
        return {**super().snapshot(), "food_stock": self.stock, "worker_loads": self.loads.tolist(),
                "delivered": self.delivered, "consumed": self.consumed,
                "delivery": getattr(self, "delivery_this_tick", 0.),
                "hunger_returns": int(self.hunger_returns.sum()), "refeeds": int(self.refeeds.sum()),
                "empty_waits": int(self.empty_waits)}


def synthetic_colony(seed=42, environment="small"):
    if environment not in ENVIRONMENTS:
        raise ValueError("Unknown environment")
    count, _, size = ENVIRONMENTS[environment]
    rng = np.random.default_rng(seed)
    # Independent geometry, not jittered or reconstructed from the supplied nests.
    cells = [(x, y) for x in range(1, size-1) for y in range(1, size-1) if (x, y) != (size//2, size//2)]
    xy = np.array(cells)[rng.choice(len(cells), count, replace=False)]
    stages = np.array(["L1", "L2", "L3"] * (count//3))
    rng.shuffle(stages)
    ranges = {"L1": (.2, .5), "L2": (.45, .75), "L3": (.65, 1.)}
    hunger = np.array([rng.uniform(*ranges[s]) for s in stages])
    return xy, hunger, stages.tolist()


def run_continuous(strategy, supply, seed=42, horizon=500, trace=False, environment="small"):
    if not isinstance(horizon, int) or horizon < 1:
        raise ValueError("Positive integer horizon required")
    xy, hunger, stages = synthetic_colony(seed, environment)
    count, workers, size = ENVIRONMENTS[environment]
    scale = count / 36
    started = time.perf_counter()
    model = ContinuousModel(xy, hunger, stages, size, workers, seed, strategy, supply=supply, initial_stock=6*scale, supply_scale=scale)
    frames = [model.snapshot()] if trace else []
    mean_hunger, full_fraction, high_hunger = [], [], []
    for _ in range(horizon):
        model.step()
        mean_hunger.append(float(model.hunger.mean()))
        full_fraction.append(float((model.hunger <= SATIATION_THRESHOLD).mean()))
        high_hunger.append(float((model.hunger >= .8).mean()))
        if trace:
            frames.append(model.snapshot())
    summary = {"strategy": strategy, "supply": supply, "seed": seed, "observed_steps": horizon,
               "environment": environment, "n_larvae": count, "n_wasps": workers, "grid_size": size,
               "runtime_seconds": time.perf_counter()-started,
               "distance_per_larva": float(model.distance.sum()/count),
               "mean_hunger": float(np.mean(mean_hunger)), "mean_full_fraction": float(np.mean(full_fraction)),
               "high_hunger_fraction": float(np.mean(high_hunger)), "feeds": int(model.feed_counts.sum()),
               "refeeds": int(model.refeeds.sum()), "hunger_returns": int(model.hunger_returns.sum()),
               "empty_waits": int(model.empty_waits), "food_delivered": model.delivered,
               "food_consumed": model.consumed, "food_remaining": float(model.stock + model.loads.sum()),
               "distance": int(model.distance.sum()), "messages": model.messages}
    return model, summary, frames


def export():
    # A single low-priority process leaves CPU capacity for the user's other task.
    if os.name == "nt":
        import ctypes
        kernel = ctypes.windll.kernel32
        handle = ctypes.c_void_p(-1)
        if not kernel.SetPriorityClass(handle, 0x4000):
            raise OSError("Cannot set below-normal priority")
        process_mask, system_mask = ctypes.c_size_t(), ctypes.c_size_t()
        if not kernel.GetProcessAffinityMask(handle, ctypes.byref(process_mask), ctypes.byref(system_mask)) or not kernel.SetProcessAffinityMask(handle, ctypes.c_size_t(process_mask.value & -process_mask.value)):
            raise OSError("Cannot limit campaign to one logical CPU")
    destination = Path(__file__).parent / "web/public/continuous"
    destination.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).read_text(encoding="utf-8") + Path(__file__).with_name("research_model.py").read_text(encoding="utf-8")
    checksum = hashlib.sha256(source.encode("utf-8")).hexdigest()
    checkpoint = Path(__file__).parent / "outputs/scaling" / checksum
    checkpoint.mkdir(parents=True, exist_ok=True)
    results, replays, deliveries = [], {}, {}
    for environment, (count, workers, size) in ENVIRONMENTS.items():
      for supply in SUPPLIES:
        scenario = f"{environment}-{supply}"
        scale = count / 36
        replays[scenario] = {}
        for strategy in STRATEGIES:
            for seed in range(42, 52):
                saved = checkpoint / f"{scenario}-{strategy}-{seed}.json"
                name = f"{supply}-{strategy}.json" if environment == "small" else f"{scenario}-{strategy}.json.gz"
                replay = destination / name
                if saved.exists() and (seed != 42 or replay.exists()):
                    cached = json.loads(saved.read_text(encoding="utf-8"))
                    if seed != 42 or cached.get("replay_sha256") == hashlib.sha256(replay.read_bytes()).hexdigest():
                        results.append(cached["summary"])
                        if seed == 42:
                            replays[scenario][strategy] = name
                            deliveries.setdefault(scenario, cached["deliveries"])
                        continue
                model, summary, frames = run_continuous(strategy, supply, seed, trace=seed == 42, environment=environment)
                results.append(summary)
                if frames:
                    deliveries.setdefault(scenario, [frame["delivery"] for frame in frames])
                    payload = {"schema_version": 3, "model_version": VERSION, "source_checksum": checksum,
                               "scenario": scenario, "environment": environment, "strategy": strategy, "seed": seed, "grid_size": model.size,
                               "sensing_radius": 3, "communication_radius": 3, "claims_enabled": True,
                               "global_sensing": False, "satiation_threshold": SATIATION_THRESHOLD,
                               "hunger_growth": HUNGER_GROWTH, "feed_drop": FEED_DROP,
                               "supply": [SUPPLIES[supply][0], SUPPLIES[supply][1]*scale, SUPPLIES[supply][2]*scale], "initial_stock": model.initial_stock,
                               "capacity": model.capacity, "depot": model.depot.tolist(),
                               "larvae": [{"id": f"L{i+1:03}", "xy": p.tolist(), "stage": stages,
                                           "hunger": float(model.initial_hunger[i])}
                                          for i, (p, stages) in enumerate(zip(model.larvae, model.stages))],
                               "workers": [f"W{i+1:03}" for i in range(model.n_wasps)], "background_cells": [],
                               "frames": frames, "summary": {**summary, "finished": False,
                                   "completion_step": None, "replicate": seed - 42, "stop_reason": "fixed_horizon"}}
                    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                    temporary = replay.with_suffix(replay.suffix + ".tmp")
                    temporary.write_bytes(gzip.compress(encoded, compresslevel=6, mtime=0) if name.endswith(".gz") else encoded)
                    temporary.replace(replay)
                    replays[scenario][strategy] = name
                saved.write_text(json.dumps({"summary": summary, "deliveries": deliveries.get(scenario) if seed == 42 else None,
                                            "replay_sha256": hashlib.sha256(replay.read_bytes()).hexdigest() if seed == 42 else None}), encoding="utf-8")
                print(f"{len(results)}/540 {scenario} {strategy} seed={seed}: {summary['runtime_seconds']:.2f}s", flush=True)
                time.sleep(.1)
    report = {"model_version": VERSION, "source_checksum": checksum, "synthetic_only": True,
              "horizon": 500, "seeds": list(range(42, 52)), "replays": replays,
              "replay_deliveries": deliveries, "results": results}
    report["environments"] = {key: {"larvae": v[0], "workers": v[1], "grid_size": v[2]} for key, v in ENVIRONMENTS.items()}
    pending = destination / "manifest.json.tmp"
    pending.write_text(json.dumps(report, indent=2), encoding="utf-8")
    pending.replace(destination / "manifest.json")
    print(f"Exported {len(results)} runs and 54 synthetic replays to {destination}")


if __name__ == "__main__":
    export()
