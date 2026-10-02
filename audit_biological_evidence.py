"""Inspect private inputs locally; never equate event frequency with physiology."""
import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd


def audit(cells, events):
    required_cells = {"nest", "cell.no.", "stages"}
    required_events = {"nest", "bout", "beh", "cell.no."}
    missing = (required_cells - set(cells)) | (required_events - set(events))
    if missing:
        raise ValueError(f"Missing source columns: {sorted(missing)}")
    if cells[list(required_cells)].isna().any().any() or events[["nest", "bout", "beh"]].isna().any().any():
        raise ValueError("Missing nest, bout, stage, cell or behavior identifiers")
    if cells.duplicated(["nest", "cell.no."]).any():
        raise ValueError("Cell identifiers are not unique within nests")
    nests = sorted(set(cells.nest) & set(events.nest))
    if not nests or set(cells.nest) != set(events.nest):
        raise ValueError("Nest inventories do not match")
    return {
        "status": "not_biologically_validated",
        "input_columns": {"cells": list(cells), "events": list(events)},
        "observed_nests": len(nests),
        "observed_bouts": int(events[["nest", "bout"]].drop_duplicates().shape[0]),
        "behavior_code_counts": events.beh.astype(str).str.strip().value_counts().to_dict(),
        "candidate_evidence": [
            "Nest and cell geometry, developmental stage, behavior labels and event timestamps",
            "Behavioral comparisons need a confirmed codebook and timestamp units first",
        ],
        "calibration_gates": {
            "hunger_recovery": {
                "status": "measurement_protocol_required",
                "required": "Repeated validated hunger measurements on identified larvae, elapsed seconds and recorded intervening intake",
                "reason": "Revisit intervals depend on worker availability and routing; they are not hunger recovery measurements",
            },
            "food_load": {
                "status": "measurement_protocol_required",
                "required": "Measured incoming and transferred food amounts with units, worker IDs, timestamps and losses",
                "reason": "Feeding counts and bout duration cannot identify carried food mass or per-feed portions",
            },
            "external_validation": {
                "status": "not_run",
                "required": "Freeze parameters and endpoints before testing independent held-out colonies",
                "reason": "Synthetic seeds and copies of observed layouts are not independent biological replicates",
            },
        },
        "release": "Local evidence audit only; schema presence never proves measurements or publication rights",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cells", type=Path, required=True)
    parser.add_argument("--events", type=Path, required=True)
    args = parser.parse_args()
    report = audit(pd.read_csv(args.cells), pd.read_csv(args.events))
    report["private_input_sha256"] = {
        "cells": hashlib.sha256(args.cells.read_bytes()).hexdigest(),
        "events": hashlib.sha256(args.events.read_bytes()).hexdigest(),
    }
    # Fixed ignored destination prevents accidental export into the public viewer.
    destination = Path(__file__).parent / "outputs/biological_evidence/audit.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(f"Evidence audit saved locally: {destination}")
    print("Physiological calibration and biological validation: NOT established")


if __name__ == "__main__":
    main()
