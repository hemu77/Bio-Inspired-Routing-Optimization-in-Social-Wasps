"""Audit exported research results and all selected replays without private data."""
import json
from pathlib import Path
import numpy as np
import pandas as pd
from research_model import source_checksum, STRATEGIES, VERSION, HUNGER_GROWTH, FEED_DROP, SATIATION_THRESHOLD


def validate_all():
    report = json.loads(Path("research_results.json").read_text())
    runs = pd.DataFrame(report["runs"])
    fair = runs[runs.variant == "main"]
    assert report["source_checksum"] == source_checksum()
    assert report['model_version'] == VERSION
    assert len(runs) == 2880 and len(fair) == 2160
    assert fair.groupby("strategy").size().to_dict() == dict.fromkeys(STRATEGIES, 360)
    assert fair.groupby(["scenario", "replicate"]).size().eq(6).all()
    assert (fair.groupby(["scenario", "replicate"])[["seed", "n_wasps", "grid_size", "total_larvae"]].nunique() == 1).all().all()
    assert fair.groupby("nest").scenario.nunique().to_dict() == {"v14":10,"v72":14,"v87":12}
    for run in report["runs"]:
        assert run["completion_step"] == (run["observed_steps"] if run["finished"] else None)
        assert run["completion_rate"] == run["fed_larvae"] / run["total_larvae"]
        assert run["observed_steps"] <= 3000
    for curve in report["curves"]:
        assert [p["step"] for p in curve["points"]] == list(range(curve["points"][-1]["step"] + 1))
        assert np.all(np.diff([p["coverage"] for p in curve["points"]]) >= 0)
    manifest = json.loads(Path("web/public/manifest.json").read_text())
    assert manifest["source_checksum"] == source_checksum()
    traces = 0
    for scenario in manifest["scenarios"]:
        assert set(scenario["traces"]) == set(STRATEGIES)
        initial = []
        for strategy, path in scenario["traces"].items():
            trace = json.loads((Path("web/public") / path).read_text())
            assert trace["source_checksum"] == source_checksum()
            assert trace['schema_version'] == 2 and trace['model_version'] == VERSION
            assert trace['hunger_growth'] == HUNGER_GROWTH and trace['feed_drop'] == FEED_DROP
            assert trace['satiation_threshold'] == SATIATION_THRESHOLD
            assert trace["strategy"] == strategy
            initial.append((trace["larvae"], trace["frames"][0]["positions"], trace["seed"]))
            frames = trace["frames"]
            assert (frames[-1]['fed'] == len(trace['larvae'])) == trace['summary']['finished']
            assert trace["summary"]["observed_steps"] == frames[-1]["tick"]
            for i, frame in enumerate(frames):
                assert frame["tick"] == i
                assert frame["phase"] == "post_tick"
                assert frame["fed"] == sum(x >= 0 for x in frame["satiated_at"])
                hunger = np.array(frame['hunger'])
                assert len(hunger) == len(trace['larvae']) and np.isfinite(hunger).all()
                assert ((hunger >= 0) & (hunger <= 1)).all()
                assert all((s >= 0) == (h <= SATIATION_THRESHOLD) for s,h in zip(frame['satiated_at'],hunger))
                if i:
                    previous = frames[i-1]
                    expected = [h if s >= 0 else min(1., h + HUNGER_GROWTH[l['stage']])
                                for h,s,l in zip(previous['hunger'], previous['satiated_at'], trace['larvae'])]
                    counts = previous['feed_counts'].copy()
                    satisfied = previous['satiated_at'].copy()
                    delta = np.abs(np.array(frame["positions"]) - np.array(previous["positions"])).sum(axis=1)
                    assert (delta <= 1).all()
                    assert frame["distance"] - previous["distance"] == int(delta.sum())
                    assert sorted(frame["worker_order"]) == list(range(len(trace["workers"])))
                    event_workers, feed_events = set(), set()
                    broadcasts = 0
                    order = -1
                    for event in frame["events"]:
                        worker = event["worker"]
                        assert isinstance(worker, int) and 0 <= worker < len(trace["workers"])
                        assert worker not in event_workers and delta[worker] == 0
                        event_workers.add(worker)
                        action_order = frame["worker_order"].index(worker)
                        assert action_order > order
                        order = action_order
                        if event["type"] == "broadcast":
                            broadcasts += 1
                            assert 0 <= event["target"] < len(trace["larvae"])
                            assert event["expires"] == i + 8
                        elif event["type"] in ('first_feed', 'feed'):
                            larva = event["larva"]
                            assert 0 <= larva < len(trace["larvae"]) and satisfied[larva] < 0
                            if event['type'] == 'first_feed':
                                assert larva not in feed_events
                                assert previous['first_feed'][larva] == -1 and frame['first_feed'][larva] == i
                                feed_events.add(larva)
                            else:
                                assert previous['first_feed'][larva] >= 0 or larva in feed_events
                            assert trace["larvae"][larva]["xy"] == previous["positions"][worker]
                            assert np.isclose(event['hunger_before'], expected[larva], atol=1e-10)
                            expected[larva] = max(0., expected[larva] - FEED_DROP[trace['larvae'][larva]['stage']])
                            assert np.isclose(event['hunger_after'], expected[larva], atol=1e-10)
                            counts[larva] += 1
                            if expected[larva] <= SATIATION_THRESHOLD:
                                satisfied[larva] = i
                        else:
                            raise AssertionError("Unknown recorded event")
                    assert frame["messages"] - previous["messages"] == broadcasts
                    changed = {j for j, v in enumerate(frame["first_feed"]) if v != previous["first_feed"][j]}
                    assert changed == feed_events
                    assert np.allclose(frame['hunger'], expected, atol=1e-10)
                    assert frame['feed_counts'] == counts and frame['satiated_at'] == satisfied
                else:
                    assert frame['hunger'] == [l['hunger'] for l in trace['larvae']]
                    assert not any(frame['feed_counts'])
            for larva in trace["larvae"]:
                lo, hi = {"L1":(.2,.5),"L2":(.45,.75),"L3":(.65,1)}[larva["stage"]]
                assert lo <= larva["hunger"] <= hi
            match = fair[(fair.scenario == trace["scenario"]) & (fair.strategy == strategy) & (fair.replicate == trace["summary"]["replicate"])].iloc[0]
            assert trace["summary"]["completion_step"] == match.completion_step
            assert trace["summary"]["final_distance"] == match.final_distance
            assert trace["summary"]["messages"] == frames[-1]["messages"] == match.messages
            assert trace["summary"]["total_feeds"] == sum(frames[-1]["feed_counts"]) == match.total_feeds
            assert np.isclose(trace["summary"]["final_avg_hunger"], np.mean(frames[-1]["hunger"]))
            assert np.isclose(trace["summary"]["final_avg_hunger"], match.final_avg_hunger)
            traces += 1
        assert all(state == initial[0] for state in initial)
    assert len(list(Path("figures/research-v3").glob("*.png"))) == 6
    return {"nests":3,"scenarios":36,"fair_runs":2160,"ablations":720,"replays":traces,
            "extended_runs":len(report["extended"]),"incomplete_fair":int((~fair.finished).sum()),"source_verified":True}


if __name__ == "__main__":
    print(json.dumps(validate_all(), indent=2))
