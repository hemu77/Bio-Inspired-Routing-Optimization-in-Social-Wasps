import unittest
import pandas as pd
from audit_biological_evidence import audit


class BiologicalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.cells = pd.DataFrame({"nest": ["example"], "cell.no.": [1], "stages": ["i1"]})
        self.events = pd.DataFrame({"nest": ["example"], "bout": [1], "beh": ["FL"], "cell.no.": [1]})

    def test_events_cannot_certify_physiology(self):
        report = audit(self.cells, self.events)
        self.assertEqual(report["status"], "not_biologically_validated")
        self.assertEqual(report["calibration_gates"]["food_load"]["status"], "measurement_protocol_required")
        # Merely adding a plausible column name does not certify its meaning.
        self.events["hunger"] = 0.5
        self.assertEqual(audit(self.cells, self.events)["status"], "not_biologically_validated")

    def test_mismatched_or_duplicate_inputs_rejected(self):
        with self.assertRaises(ValueError):
            audit(pd.concat([self.cells, self.cells]), self.events)
        with self.assertRaises(ValueError):
            audit(self.cells, self.events.assign(nest="different"))
        with self.assertRaises(ValueError):
            audit(self.cells, self.events.drop(columns="beh"))


if __name__ == "__main__":
    unittest.main()
