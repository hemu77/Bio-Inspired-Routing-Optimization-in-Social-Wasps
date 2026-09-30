# Research-v3 Review

Two independent read-only, tool-assisted reviewers checked scientific consistency
and visual/interaction correctness. This is an engineering review, not external
biological peer review or a claim of human professional credentials.

## Findings And Resolution

| Finding | Resolution | Evidence |
|---|---|---|
| Twelve obsolete first-feed traces remained publicly accessible | Removed unreferenced exports; v2 remains available at its archive tag | Current manifest references all 24 public traces |
| Browser accepted invalid initial hunger/feeding states | Enforced stage ranges, no initial feeding and no initial completion | Corruption tests reject invalid initial hunger and feeding |
| Hunger-derived summary fields were not independently reconciled | Reconciled total feeds and average hunger with terminal frames and saved benchmark rows | `validate_research.py` passes |
| Reviewer questioned advertised Shift-drag support | Dependency inspection confirms native OrbitControls modifier-key pan; no duplicate implementation added | Shift-left and right drag both change camera target without changing replay; reset restores framing |

## Verified Behavior

- Hunger grows before each worker scheduler tick. Each recorded feed reduces it
  by the inherited stage-specific amount; no three-feed cap remains.
- Blue means never fed. Intermediate blue-green shades mean fed but still hungry.
  Solid green means remaining hunger <= 0.12, an assumed model threshold.
- Completion is absorbing within this one round, not a continuing hunger cycle.
- Themes preserve camera, clock, selection, layers and recorded state. Key text
  contrast is tested at >= 4.5:1 in both themes, including mobile and 2D fallback.
- Cursor-centered zoom uses each render region, not the full annotated canvas.
  Ground-plane panning and reset keep the lower nest reachable.
- All 2160 fair simulations and 720 ablations were rerun. All fair runs finished;
  this new endpoint changes rankings and must not be compared directly with v2.
- Model regression suite: 10 passing tests. Browser suite: 22 passing tests.
  Executed notebook: 43 cells, six embedded PNGs, 12 HTML outputs, no errors.

Viewport screenshots are used for mobile WebGL inspection: full-page capture can
lose the non-preserved drawing buffer while resizing. This capture limitation
does not mean the live canvas is blank; the mobile viewport was checked separately.
