"""Small, public synthetic checks: no private CSV files required."""
import unittest
import numpy as np
from research_model import ResearchModel, run_model


class ResearchChecks(unittest.TestCase):
    def model(self, strategy="greedy", seed=42, **kwargs):
        return ResearchModel([(0, 0), (4, 4), (2, 1)], [.3, .7, .9],
                             ["L1", "L2", "L3"], 5, 3, seed, strategy, **kwargs)

    def test_actions_and_first_feed(self):
        for policy in ["random", "biased", "greedy", "tsp", "local_nearest", "local_urgency_claims"]:
            model = self.model(policy)
            previous = model.positions.copy()
            for _ in range(100):
                model.step()
                self.assertTrue((np.abs(model.positions - previous).sum(axis=1) <= 1).all())
                self.assertTrue((model.feed_counts <= 1).all())
                previous = model.positions.copy()
            self.assertTrue(np.array_equal(model.hunger, [.3, .7, .9]))

    def test_scheduler_independent_of_policy(self):
        a, b = self.model("random"), self.model("tsp")
        self.assertTrue(np.array_equal(a.positions, b.positions))
        for _ in range(10):
            a.step(); b.step()
            self.assertEqual(a.last_order, b.last_order)

    def test_timeout_is_not_completion(self):
        summary, _, _ = run_model(self.model(), 1)
        self.assertIsNone(summary["completion_step"])
        self.assertEqual(summary["stop_reason"], "horizon")

    def test_replay_and_repeatability(self):
        a, curve, trace = run_model(self.model(), 100, trace=True)
        b, _, other = run_model(self.model(), 100, trace=True)
        self.assertEqual(a, b)
        self.assertEqual(trace, other)
        self.assertEqual(trace[-1]["fed"], a["fed_larvae"])
        self.assertEqual(curve[-1]["coverage"], a["completion_rate"])

    def test_claims_expire_and_remain_local(self):
        m = self.model("local_urgency_claims")
        m.positions[:] = [[0, 0], [4, 4], [4, 0]]
        m.broadcast(0, 0, 8)
        self.assertNotIn(0, m.claims[1])
        m.tick = 9
        m.expire_claims()
        self.assertFalse(any(m.claims))

    def test_broadcast_consumes_action(self):
        m = self.model("local_urgency_claims")
        before = m.positions.copy()
        m.step()
        for worker, reason in enumerate(m.reason):
            if reason.startswith("claim broadcast"):
                self.assertTrue(np.array_equal(before[worker], m.positions[worker]))
        self.assertTrue(any(e["type"] == "broadcast" for e in m.events))

    def test_local_memory_contains_observed_coordinates(self):
        m = self.model("local_nearest")
        m.positions[0] = [0, 0]
        m.observe(0)
        self.assertNotIn(1, m.memory[0])
        self.assertEqual(m.memory[0][0], ((0, 0), False, .3))

    def test_unobserved_priority_has_no_local_effect(self):
        a, b = self.model("local_urgency_claims"), self.model("local_urgency_claims")
        a.positions[0] = b.positions[0] = [0, 0]
        b.hunger[1] = .01  # Outside radius three; never observed by worker zero.
        self.assertEqual(a.choose_target(0), b.choose_target(0))

    def test_frequency_does_not_control_hunger(self):
        import pandas as pd
        from wasp_routing_analysis import build_larval_population
        data = pd.DataFrame({'nest':['fixture']*3,'contents_new':['L']*3,
                             'stages':['i1','i3','i5'],'cell_no_':[1,2,3],
                             'X_new':[0.,1.,2.],'Y_new':[0.,1.,2.],
                             'cell_ed':[1,1,1],'FL_freq':[1,2,3]})
        a = build_larval_population(data, 'fixture', 2, 42)
        data['FL_freq'] = [100000,0,-10]
        b = build_larval_population(data, 'fixture', 2, 42)
        self.assertTrue(np.array_equal(a.hunger_init, b.hunger_init))
        self.assertEqual(len(a), 6)
        self.assertTrue(a.larva_uid.is_unique)


if __name__ == "__main__":
    unittest.main()
