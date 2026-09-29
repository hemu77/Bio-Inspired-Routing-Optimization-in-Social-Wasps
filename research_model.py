"""Research-v2: first-feed routing, not an inferred physiology model.

The legacy engine remains untouched. All notebook, benchmark and replay paths
use this engine; the browser only reads its recorded states.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import numpy as np

VERSION = "research-v2"
STRATEGIES = ("random", "biased", "greedy", "tsp", "local_nearest", "local_urgency_claims")
MOVES = np.array([(1, 0), (-1, 0), (0, 1), (0, -1)])


class ResearchModel:
    def __init__(self, larvae, hunger, stages, grid_size, n_wasps, seed, strategy,
                 claims_enabled=True, global_sensing=False):
        self.larvae = np.asarray(larvae, dtype=int)
        self.hunger = np.asarray(hunger, dtype=float)
        self.stages = list(stages)
        if (self.larvae.ndim != 2 or self.larvae.shape[1] != 2 or
                len(self.larvae) != len(self.hunger) or not len(self.larvae) or
                len(stages) != len(self.larvae) or grid_size < 1 or n_wasps < 1 or
                not np.isfinite(self.hunger).all() or
                ((self.hunger < 0) | (self.hunger > 1)).any() or
                ((self.larvae < 0) | (self.larvae >= grid_size)).any() or
                len(set(map(tuple, self.larvae))) != len(self.larvae) or
                strategy not in STRATEGIES):
            raise ValueError("Invalid colony, grid, resources or strategy")
        self.size, self.n_wasps, self.seed = int(grid_size), int(n_wasps), int(seed)
        self.strategy = strategy
        self.claims_enabled, self.global_sensing = claims_enabled, global_sensing
        init, scheduling, policy = np.random.SeedSequence(seed).spawn(3)
        init_rng = np.random.default_rng(init)
        self.scheduler = np.random.default_rng(scheduling)
        self.policy = np.random.default_rng(policy)
        offsets = np.array([(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1),
                            (1, 1), (1, -1), (-1, 1), (-1, -1)])
        self.positions = np.clip(self.size // 2 + offsets[np.arange(n_wasps) % 9], 0, self.size - 1)
        self.directions = init_rng.integers(0, 4, n_wasps)
        self.first_feed = np.full(len(larvae), -1, dtype=int)
        self.feed_counts = np.zeros(len(larvae), dtype=int)
        self.distance = np.zeros(n_wasps, dtype=int)
        self.target = np.full(n_wasps, -1, dtype=int)
        self.reason = ["initial"] * n_wasps
        self.memory = [{} for _ in range(n_wasps)]
        self.claims = [{} for _ in range(n_wasps)]
        self.visits = np.zeros((n_wasps, grid_size, grid_size), dtype=np.uint16)
        self.queues = [[] for _ in range(n_wasps)]
        self.tick = self.messages = 0
        self.last_order = []
        self.events = []
        self.broadcast_this_action = False
        self.cell_larva = {tuple(p): i for i, p in enumerate(self.larvae)}

    def expire_claims(self):
        for claims in self.claims:
            for target in list(claims):
                if claims[target][1] <= self.tick:
                    del claims[target]

    def broadcast(self, worker, target, expires):
        # One packet per broadcast; recipients are workers within radius three.
        if not self.claims_enabled:
            return
        self.messages += 1
        self.broadcast_this_action = True
        self.events.append({"type": "broadcast", "worker": worker, "target": target, "expires": expires})
        for receiver in np.flatnonzero(np.abs(self.positions - self.positions[worker]).sum(axis=1) <= 3):
            old = self.claims[receiver].get(target)
            if old is None or old[1] <= self.tick or worker <= old[0]:
                self.claims[receiver][target] = (worker, expires)

    def observe(self, worker):
        radius = 2 * self.size if self.global_sensing else 3
        seen = np.flatnonzero(np.abs(self.larvae - self.positions[worker]).sum(axis=1) <= radius)
        memory = self.memory[worker]
        for larva in seen:
            memory[int(larva)] = (tuple(self.larvae[larva]), bool(self.first_feed[larva] >= 0), float(self.hunger[larva]))
        # Insertion-ordered bounded memory: no omniscient completion lookup.
        while len(memory) > 256:
            del memory[next(iter(memory))]
        return np.array([i for i, (_, served, _) in memory.items() if not served], dtype=int)

    def choose_target(self, worker):
        strategy = self.strategy
        if strategy in ("random", "biased"):
            return -1
        if strategy.startswith("local_"):
            choices = self.observe(worker)
            choices = np.array([i for i in choices if
                                i not in self.claims[worker] or
                                self.claims[worker][i][0] == worker], dtype=int)
            if not len(choices):
                return -1
            known_xy = np.array([self.memory[worker][i][0] for i in choices])
            distances = np.abs(known_xy - self.positions[worker]).sum(axis=1)
            if strategy == "local_nearest":
                return int(choices[np.argmin(distances)])
            priorities = np.array([self.memory[worker][i][2] for i in choices])
            score = priorities / (1 + distances)
            chosen = int(choices[np.argmax(score)])
            if self.tick % 4 == 0 or self.target[worker] != chosen:
                self.broadcast(worker, chosen, self.tick + 8)
            return chosen
        remaining = np.flatnonzero(self.first_feed < 0)
        if not len(remaining):
            return -1
        if strategy == "tsp":
            # Historical alias: a nearest-neighbour tour, NOT an optimal TSP.
            queue = self.queues[worker]
            if not queue:
                current = self.positions[worker]
                left = remaining.tolist()
                while left:
                    nearest = min(left, key=lambda i: (int(np.abs(self.larvae[i] - current).sum()), i))
                    queue.append(nearest); left.remove(nearest)
                    current = self.larvae[nearest]
            while queue and self.first_feed[queue[0]] >= 0:
                queue.pop(0)
            return queue[0] if queue else -1
        distances = np.abs(self.larvae[remaining] - self.positions[worker]).sum(axis=1)
        weights = self.hunger[remaining] / (1 + distances)
        return int(self.policy.choice(remaining, p=weights / weights.sum()))

    def step(self):
        self.tick += 1
        self.events = []
        self.expire_claims()
        self.last_order = self.scheduler.permutation(self.n_wasps).tolist()
        for worker in self.last_order:
            self.broadcast_this_action = False
            pos = self.positions[worker]
            larva = self.cell_larva.get(tuple(pos))
            if larva is not None and self.first_feed[larva] < 0:
                self.first_feed[larva] = self.tick
                self.feed_counts[larva] += 1
                self.memory[worker][larva] = (tuple(pos), True, float(self.hunger[larva]))
                self.events.append({"type": "first_feed", "worker": worker, "larva": larva})
                self.reason[worker] = "first feed; no movement this tick"
                self.target[worker] = larva
                continue
            target = self.choose_target(worker)
            self.target[worker] = target
            if self.broadcast_this_action:
                self.reason[worker] = "claim broadcast; no movement this tick"
                continue
            if target >= 0:
                target_xy = self.memory[worker][target][0] if self.strategy.startswith("local_") else self.larvae[target]
                delta = np.asarray(target_xy) - pos
                axis = 0 if delta[0] else 1
                move = np.zeros(2, dtype=int)
                move[axis] = np.sign(delta[axis])
                self.reason[worker] = "local remembered target" if self.strategy.startswith("local_") else "global target"
            elif self.strategy.startswith("local_"):
                neighbors = pos + MOVES
                valid = np.flatnonzero(((neighbors >= 0) & (neighbors < self.size)).all(axis=1))
                counts = [self.visits[worker, *neighbors[i]] for i in valid]
                minimum = min(counts)
                tied = [i for i, count in zip(valid, counts) if count == minimum]
                move = MOVES[self.policy.choice(tied)]
                self.reason[worker] = "least-visited neighbour exploration"
            else:
                if self.strategy == "random" or self.policy.random() < .25:
                    self.directions[worker] = self.policy.integers(0, 4)
                move = MOVES[self.directions[worker]]
                self.reason[worker] = "blind walk"
            new = np.clip(pos + move, 0, self.size - 1)
            self.distance[worker] += int(np.abs(new - pos).sum())
            self.positions[worker] = new
            self.visits[worker, *new] += 1

    def snapshot(self):
        return {"tick": self.tick, "fed": int((self.first_feed >= 0).sum()),
                "phase": "post_tick", "worker_order": list(self.last_order), "events": list(self.events),
                "distance": int(self.distance.sum()), "messages": self.messages,
                "first_feed": self.first_feed.tolist(), "positions": self.positions.tolist(),
                "targets": self.target.tolist(), "reasons": list(self.reason),
                "claims": [[[int(k), int(v[0]), int(v[1])] for k, v in claims.items()]
                           for claims in self.claims]}


def run_model(model, horizon=3000, trace=False):
    if horizon < 1:
        raise ValueError("Horizon must be positive")
    records = [model.snapshot()] if trace else []
    curves = []
    while model.tick < horizon and (model.first_feed < 0).any():
        model.step()
        if trace:
            records.append(model.snapshot())
        curves.append({"step": model.tick, "coverage": float((model.first_feed >= 0).mean()),
                       "distance": int(model.distance.sum()), "messages": model.messages})
    served = model.first_feed >= 0
    waits = np.where(served, model.first_feed, model.tick)
    finished = bool(served.all())
    summary = {"model_version": VERSION, "strategy": model.strategy,
               "seed": model.seed, "finished": finished,
               "completion_step": model.tick if finished else None,
               "observed_steps": model.tick, "stop_reason": "complete" if finished else "horizon",
               "fed_larvae": int(served.sum()), "total_larvae": len(served),
               "completion_rate": float(served.mean()), "final_distance": int(model.distance.sum()),
               "distance_per_served": float(model.distance.sum() / served.sum()) if served.any() else None,
               "restricted_p95_wait": float(np.percentile(waits, 95)),
               "restricted_max_wait": int(waits.max()),
               "priority_weighted_wait": float(np.average(waits, weights=model.hunger)),
               "messages": model.messages, "n_wasps": model.n_wasps, "grid_size": model.size}
    curves.insert(0, {"step": 0, "coverage": 0.0})
    if not curves or curves[-1]["step"] != model.tick:
        curves.append({"step": model.tick, "coverage": float(served.mean())})
    return summary, curves, records


def source_checksum():
    # Normalize line endings so the same checked-in source hashes on Windows/CI.
    sources = [Path(__file__), Path(__file__).with_name("wasp_routing_analysis.py"),
               Path(__file__).with_name("run_research.py")]
    return hashlib.sha256("\n".join(p.read_text(encoding="utf-8") for p in sources).encode()).hexdigest()


def trace_payload(model, summary, frames, scenario):
    return {"schema_version": 1, "model_version": VERSION, "source_checksum": source_checksum(),
            "scenario": scenario, "strategy": model.strategy, "seed": model.seed,
            "grid_size": model.size, "sensing_radius": 3, "communication_radius": 3,
            "claims_enabled": model.claims_enabled, "global_sensing": model.global_sensing,
            "depth_is_illustrative": True, "summary": summary,
            "larvae": [{"id": f"L{i + 1:03}", "xy": xy.tolist(), "stage": model.stages[i],
                        "hunger": float(model.hunger[i])} for i, xy in enumerate(model.larvae)],
            "workers": [f"W{i + 1:03}" for i in range(model.n_wasps)], "frames": frames}
