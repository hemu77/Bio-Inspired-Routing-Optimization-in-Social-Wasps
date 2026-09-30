"""Execute and persist notebook outputs using the shared local Python kernel."""
from pathlib import Path
import nbformat
from nbclient import NotebookClient

path = Path("final_analysis_v3.ipynb")
notebook = nbformat.read(path, as_version=4)
NotebookClient(notebook, timeout=600, kernel_name="python3",
               resources={"metadata": {"path": str(path.parent.resolve())}}).execute()
nbformat.write(notebook, path)
assert not any(o.get("output_type") == "error" for c in notebook.cells for o in c.get("outputs", []))
png = sum("image/png" in o.get("data", {}) for c in notebook.cells for o in c.get("outputs", []))
html = sum("text/html" in o.get("data", {}) for c in notebook.cells for o in c.get("outputs", []))
assert png == 6 and html >= 4
print(f"Executed {len(notebook.cells)} cells; embedded PNGs={png}, HTML outputs={html}; no errors")
