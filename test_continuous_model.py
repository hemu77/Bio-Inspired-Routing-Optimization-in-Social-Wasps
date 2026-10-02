import unittest
import numpy as np
from continuous_model import ContinuousModel, run_continuous, SUPPLIES


class ContinuousFeedingTests(unittest.TestCase):
    def test_seed_export_rejects_incomplete_maps_and_wrong_identity(self):
        import json
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import export_continuous_inputs as exporter
        from continuous_model import ENVIRONMENTS, VERSION
        from research_model import STRATEGIES
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'web/public/continuous';root.mkdir(parents=True)
            manifest={'model_version':VERSION,'replays':{}}
            (root/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
            with patch.object(exporter,'__file__',str(Path(temp)/'export_continuous_inputs.py')):
                with self.assertRaisesRegex(ValueError,'nine scenarios'):
                    exporter.export_inputs()
                manifest['replays']={f'{env}-{supply}':{s:'trace.json' for s in STRATEGIES}
                                     for env in ENVIRONMENTS for supply in SUPPLIES}
                (root/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
                (root/'trace.json').write_text(json.dumps({'scenario':'wrong','strategy':'random','environment':'small','seed':43}),encoding='utf-8')
                with self.assertRaisesRegex(ValueError,'identity mismatch'):
                    exporter.export_inputs()

    def test_individual_recovery_and_refill_requests_are_paired(self):
        a,_,fa=run_continuous('random','abundant',horizon=30,trace=True)
        b,_,fb=run_continuous('tsp','abundant',horizon=30,trace=True)
        np.testing.assert_array_equal(a.growth,b.growth)
        from research_model import HUNGER_GROWTH
        ratios=a.growth/np.array([HUNGER_GROWTH[s] for s in a.stages])
        self.assertTrue(np.all((ratios>=.75)&(ratios<=1.25)))
        self.assertGreater(np.ptp(ratios),.1)
        draws=[e['requested'] for f in fa for e in f['events'] if e['type']=='refill' and e['amount']>0]
        self.assertGreater(len(set(draws)),1)
        for worker in range(a.n_wasps):
            sequences=[[e['requested'] for f in frames for e in f['events']
                        if e['type']=='refill' and e['worker']==worker and e['amount']>0]
                       for frames in (fa,fb)]
            common=min(map(len,sequences))
            self.assertEqual(sequences[0][:common],sequences[1][:common])
        for frames in (fa,fb):
            for f in frames:
                for e in f['events']:
                    if e['type']=='refill' and e['amount']>0:
                        self.assertGreaterEqual(e['requested'],1.)
                        self.assertLessEqual(e['requested'],2.)
                        self.assertLessEqual(e['amount'],e['requested'])

    def test_full_larva_reopens_and_receives_another_feed(self):
        m = ContinuousModel([[0, 0]], [.2], ["L1"], 1, 1, 42, "random")
        m.loads[0] = 1.
        m.step()
        self.assertLessEqual(m.hunger[0], .12)
        self.assertEqual(m.feed_counts[0], 1)
        for _ in range(10):
            m.step()
        self.assertGreater(m.hunger_returns[0], 0)
        self.assertGreater(m.refeeds[0], 0)
        self.assertGreater(m.feed_counts[0], 1)

    def test_small_load_cannot_supply_a_full_portion(self):
        m = ContinuousModel([[0, 0]], [.7], ["L3"], 1, 1, 42, "random")
        m.loads[0] = .1
        m.step()
        self.assertAlmostEqual(m.hunger[0], .7+m.growth[0]-.1)
        self.assertAlmostEqual(m.consumed, .1)
        self.assertAlmostEqual(m.loads[0], 0.)
        self.assertEqual(m.satiated_at[0], -1)

    def test_conservation_and_action_budget_all_policies(self):
        from research_model import STRATEGIES
        for strategy in STRATEGIES:
            model, summary, frames = run_continuous(strategy, "variable", horizon=90, trace=True)
            for prior, f in zip(frames, frames[1:]):
                self.assertAlmostEqual(model.initial_stock + f["delivered"],
                                       f["food_stock"] + sum(f["worker_loads"]) + f["consumed"])
                self.assertGreaterEqual(min(f["worker_loads"]), -1e-10)
                self.assertLessEqual(max(f["worker_loads"]), model.capacity)
                self.assertEqual(f["fed"], sum(h <= .12 for h in f["hunger"]))
                workers = []
                for event in f["events"]:
                    worker = event["worker"]
                    workers.append(worker)
                    self.assertEqual(prior["positions"][worker], f["positions"][worker])
                self.assertEqual(len(workers), len(set(workers)))
                for a, b in zip(prior["positions"], f["positions"]):
                    self.assertLessEqual(sum(abs(x-y) for x, y in zip(a, b)), 1)
            self.assertEqual(summary["observed_steps"], 90)

    def test_delivery_stream_paired_and_reproducible(self):
        _, a, frames_a = run_continuous("random", "scarce", horizon=60, trace=True)
        _, b, frames_b = run_continuous("tsp", "scarce", horizon=60, trace=True)
        self.assertEqual([f["delivery"] for f in frames_a], [f["delivery"] for f in frames_b])
        repeated = run_continuous("random", "scarce", horizon=60)[1]
        self.assertEqual({k:v for k,v in repeated.items() if k != "runtime_seconds"}, {k:v for k,v in a.items() if k != "runtime_seconds"})
        self.assertEqual(a["food_delivered"], b["food_delivered"])

    def test_empty_worker_returns_and_refill_costs_an_action(self):
        m = ContinuousModel([[0, 0]], [.7], ["L3"], 3, 1, 42, "random")
        m.positions[0] = [0, 0]
        m.step()
        self.assertEqual(m.feed_counts[0], 0)
        self.assertEqual(m.reason[0], "empty; return to depot")
        m.positions[0] = m.depot
        m.step()
        np.testing.assert_array_equal(m.positions[0], m.depot)
        self.assertGreater(m.loads[0], 0)
        self.assertEqual(m.reason[0], "refill at depot")

    def test_invalid_resources_rejected(self):
        for bad in [dict(capacity=0), dict(capacity=float("nan")), dict(initial_stock=-1), dict(supply="unknown")]:
            with self.assertRaises(ValueError):
                ContinuousModel([[0, 0]], [.5], ["L1"], 1, 1, 42, "random", **bad)

    def test_tour_requeues_returning_hunger_without_losing_current_visit(self):
        m = ContinuousModel([[0, 0], [0, 1]], [.11, .7], ["L1", "L3"], 4, 1, 42, "tsp")
        m.loads[0] = 1.
        m.queues[0] = [1]
        m.step()
        self.assertEqual(m.queues[0], [1, 0])
        self.assertEqual(m.target[0], 1)

    def test_optimized_tour_matches_original_tie_break(self):
        from research_model import ResearchModel
        from continuous_model import synthetic_colony
        for environment in ["small", "medium", "large"]:
            xy,hunger,stages=synthetic_colony(42,environment)
            size={"small":12,"medium":21,"large":36}[environment]
            fast=ContinuousModel(xy,hunger,stages,size,1,42,"tsp")
            original=ResearchModel(xy,hunger,stages,size,1,42,"tsp")
            self.assertEqual(fast.choose_target(0),original.choose_target(0))
            self.assertEqual(fast.queues[0],original.queues[0])

    def test_scaled_resources_density_and_delivery_pairing(self):
        from continuous_model import ENVIRONMENTS
        baseline,_,base_frames=run_continuous("random","variable",horizon=30,trace=True)
        for environment,(count,workers,size) in ENVIRONMENTS.items():
            m,summary,frames=run_continuous("random","variable",horizon=30,trace=True,environment=environment)
            self.assertEqual(len(m.larvae),count)
            self.assertEqual(m.n_wasps,workers)
            self.assertEqual(count/workers,3)
            self.assertAlmostEqual(count/size**2,.25,delta=.006)
            self.assertEqual(m.initial_stock,6*count/36)
            np.testing.assert_allclose([f["delivery"] for f in frames],np.array([f["delivery"] for f in base_frames])*count/36)
            self.assertEqual(summary["observed_steps"],30)


if __name__ == "__main__":
    unittest.main()
