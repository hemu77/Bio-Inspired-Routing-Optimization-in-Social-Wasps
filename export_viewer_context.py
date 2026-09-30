"""Export only the selected, already-validated bout summaries for the replay UI."""
import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    report = json.loads((root / "research_results.json").read_text())
    public = root / "web/public"
    manifest = json.loads((public / "manifest.json").read_text())
    assert report["source_checksum"] == manifest["source_checksum"]
    fields = ("observed_rows", "observed_feeding_events", "observed_unique_cells",
              "observed_unique_wasps", "scaled_larvae", "n_wasps", "grid_size")
    by_id = {row["public_id"]: row for row in report["scenarios"]}
    contexts = {}
    for scenario in manifest["scenarios"]:
        row = by_id[scenario["id"]]
        for relative_path in scenario["traces"].values():
            trace = json.loads((public / relative_path).read_text())
            assert len(trace["larvae"]) == row["scaled_larvae"]
            assert len(trace["workers"]) == row["n_wasps"]
            assert trace["grid_size"] == row["grid_size"]
        contexts[scenario["id"]] = {key: row[key] for key in fields}
    output = {"source_checksum": report["source_checksum"], "scenarios": contexts}
    (public / "scenario-context.json").write_text(json.dumps(output, indent=2) + "\n")
    print(f"Verified and exported context for {len(contexts)} selected scenarios; no raw rows or identities.")


if __name__ == "__main__":
    main()
