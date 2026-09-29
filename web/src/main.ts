import "./style.css";
import { ReplayScene, Entity } from "./scene";
import { Manifest, Trace, labels, loadTrace, frameAt } from "./trace";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<header><h1>Nest / Routing Lab</h1><div class="subtitle">Social wasp routing<br><span>Verified Python replays</span></div><nav aria-label="Replay configuration"><label>Nest <select id="scenario" aria-label="Nest scenario"></select></label><label>Strategy <select id="strategy" aria-label="Strategy"></select></label><label class="compare"><input id="compare" type="checkbox"> Compare four</label></nav></header>
<main><aside class="layers"><h2>Layers</h2><div id="layers"></div><label class="opacity">Nest opacity<input id="opacity" type="range" min="0" max="100" value="50"></label><div class="guide"><p>Drag to orbit.<br>Scroll to zoom.<br>Click to pin an agent.</p><p>Depth is illustrative.<br>XY comes from the model.</p><p>One tick: move, first feed, or claim broadcast.</p><a href="https://github.com/hemu77/Bio-Inspired-Routing-Optimization-in-Social-Wasps" target="_blank" rel="noreferrer">Code & research report</a></div></aside>
<section class="viewport" aria-label="Simulation"><div class="view-tools"><button id="top">Top-down</button><button id="reset">Reset view</button><span id="mode"></span></div><div id="canvas"></div><div id="view-labels"></div><div id="hover" hidden></div><div class="legend" id="legend"><span><i class="waiting"></i>Waiting: initial priority</span><span><i class="fed"></i>Served: flattened body</span><span><i class="wasp"></i>Worker</span></div><div id="status" role="status">Loading verified replay...</div></section>
<aside class="inspector"><h2>Agent Inspector</h2><label class="entity-label">Select / pin<select id="entity" aria-label="Inspect an agent"><option value="">No pinned agent</option></select></label><div id="details"><p>Pick a worker or larva to inspect its recorded state.</p></div><div id="overlap"></div><h3>Current frame</h3><dl id="metrics"></dl><p class="caveat">First-feed coverage, not satiation. Initial hunger is random and fixed; it is not observed physiology.</p></aside></main>
<footer><button id="play" aria-label="Play replay">Play</button><label class="timeline">Actual tick <output id="tick">0</output><input id="seek" aria-label="Seek actual tick" type="range" min="0" max="1" value="0" step="1"></label><label>Speed <select id="speed" aria-label="Playback speed"><option value="10">10 ticks/s</option><option value="30" selected>30 ticks/s</option><option value="100">100 ticks/s</option></select></label><span id="perf"></span></footer>`;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const scenario = $<HTMLSelectElement>("scenario"),
  strategy = $<HTMLSelectElement>("strategy"),
  compare = $<HTMLInputElement>("compare"),
  seek = $<HTMLInputElement>("seek");
const scene = new ReplayScene(
  $("canvas"),
  new URLSearchParams(location.search).has("2d"),
);
$("mode").textContent = scene.renderer
  ? "3D / XY preserved"
  : "2D fallback / no WebGL";
if (!scene.renderer) {
  $<HTMLButtonElement>("top").disabled = true;
  $<HTMLButtonElement>("reset").disabled = true;
}
const layers = [
  ["structure", "Nest structure"],
  ["larvae", "Larvae"],
  ["wasps", "Wasps"],
  ["routes", "Routes & target"],
  ["sensing", "Sensing footprint"],
  ["annotations", "Annotations"],
] as const;
for (const [key, label] of layers) {
  const row = document.createElement("label"),
    input = document.createElement("input");
  input.type = "checkbox";
  input.checked = true;
  input.dataset.layer = key;
  row.append(input, document.createTextNode(label));
  $("layers").append(row);
  input.onchange = () => {
    scene.layers[key] = input.checked;
    scene.changed = true;
    updateLabels();
    updateInspector();
  };
}
$<HTMLInputElement>("opacity").oninput = (e) => {
  scene.layers.opacity = Number((e.target as HTMLInputElement).value) / 100;
  scene.changed = true;
};
for (const [value, label] of Object.entries(labels)) {
  strategy.add(new Option(label, value));
}
strategy.value = "local_urgency_claims";
let manifest: Manifest,
  traces: Trace[] = [],
  tick = 0,
  playing = false,
  abort = new AbortController(),
  focused = 0,
  last = performance.now(),
  lastDraw = 0,
  frames = 0,
  windowStart = last,
  measuredFps = 0;
let start: [number, number] = [0, 0],
  loading = false;
const maximum = () => Math.max(1, ...traces.map((t) => t.frames.length - 1));
const options = (selection: Entity | null) => {
  const input = $<HTMLSelectElement>("entity");
  input.replaceChildren(new Option("No pinned agent", ""));
  const trace = traces[focused];
  if (!trace) return;
  trace.workers.forEach((id, i) => input.add(new Option(id, `worker:${i}`)));
  trace.larvae.forEach((l, i) =>
    input.add(new Option(`${l.id} (${l.stage})`, `larva:${i}`)),
  );
  if (selection && selection.kind !== "cell")
    input.value = `${selection.kind}:${selection.index}`;
};
function pin(entity: Entity | null) {
  scene.selected = entity;
  if (entity) focused = entity.view;
  options(entity);
  scene.changed = true;
  updateInspector();
}
function showStatus(text: string) {
  $("status").textContent = text;
  $("status").hidden = !text;
}
async function load() {
  abort.abort();
  abort = new AbortController();
  const controller = abort;
  loading = true;
  playing = false;
  $("play").textContent = "Play";
  showStatus("Loading and validating recorded states...");
  try {
    const selection = manifest.scenarios.find((s) => s.id === scenario.value)!;
    const methods = compare.checked
      ? ["tsp", "biased", "random", "greedy"]
      : [strategy.value];
    const data = await Promise.all(
      methods.map((method) =>
        loadTrace(selection.traces[method], manifest, controller.signal),
      ),
    );
    if (controller !== abort) return;
    traces = data;
    tick = 0;
    focused = 0;
    scene.setTraces(data);
    seek.max = String(maximum());
    seek.value = "0";
    pin(null);
    updateLabels();
    updateInspector();
    showStatus("");
  } catch (error) {
    if (controller.signal.aborted) return;
    showStatus(
      `Replay could not load: ${(error as Error).message}. Choose another scenario or reload.`,
    );
  } finally {
    if (controller === abort) loading = false;
  }
}
function updateLabels() {
  const host = $("view-labels");
  host.replaceChildren();
  host.classList.toggle("four", traces.length === 4);
  host.hidden = !scene.layers.annotations;
  $("legend").hidden = !scene.layers.annotations;
  traces.forEach((trace, i) => {
    const frame = frameAt(trace, tick),
      label = document.createElement("div");
    label.className = "view-label";
    const title = document.createElement("strong"),
      line = document.createElement("span");
    title.textContent = labels[trace.strategy];
    line.textContent = `${trace.scenario} / ${frame.fed}/${trace.larvae.length} served / tick ${frame.tick}${frame.fed === trace.larvae.length ? " / COMPLETE" : ""}`;
    label.append(title, line);
    if (i === focused) label.classList.add("focused");
    host.append(label);
  });
  $("tick").textContent = `${Math.floor(tick)} / ${maximum()}`;
  seek.value = String(Math.floor(tick));
}
function definitions(host: HTMLElement, rows: [string, string][]) {
  host.replaceChildren();
  for (const [key, value] of rows) {
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = key;
    dd.textContent = value;
    host.append(dt, dd);
  }
}
function updateInspector() {
  const trace = traces[focused];
  if (!trace) return;
  const frame = frameAt(trace, tick);
  definitions($("metrics"), [
    ["Served", `${frame.fed} / ${trace.larvae.length}`],
    ["Travel", `${frame.distance} grid units`],
    ["Broadcasts", `${frame.messages} packets`],
    ["Seed / replicate", `${trace.seed} / ${trace.summary.replicate}`],
    ["Clock", `${frame.tick} (post-tick)`],
  ]);
  const host = $("details");
  host.replaceChildren();
  $("overlap").replaceChildren();
  const selection = scene.selected;
  if (!selection) {
    const p = document.createElement("p");
    p.textContent = "Pick a worker or larva to inspect its recorded state.";
    host.append(p);
    return;
  }
  const hidden =
    selection.kind === "worker"
      ? !scene.layers.wasps
      : selection.kind === "larva"
        ? !scene.layers.larvae
        : !scene.layers.structure;
  const title = document.createElement("h3");
  title.textContent =
    selection.kind === "worker"
      ? trace.workers[selection.index]
      : selection.kind === "larva"
        ? trace.larvae[selection.index].id
        : "Background cell";
  host.append(title);
  if (hidden) {
    const note = document.createElement("p");
    note.className = "hidden-note";
    note.textContent = "Pinned entity retained; its layer is hidden.";
    host.append(note);
  }
  const dl = document.createElement("dl");
  host.append(dl);
  let pos: [number, number];
  if (selection.kind === "worker") {
    pos = frame.positions[selection.index];
    const target = frame.targets[selection.index];
    definitions(dl, [
      ["Position (XY)", pos.join(", ")],
      ["Target", target >= 0 ? trace.larvae[target].id : "None"],
      ["Decision", frame.reasons[selection.index]],
      [
        "Knowledge",
        trace.strategy.startsWith("local_")
          ? trace.global_sensing
            ? "Global sensing ablation"
            : "Radius 3 + bounded memory"
          : ["random", "biased"].includes(trace.strategy)
            ? "Blind walk"
            : "Global larval state",
      ],
      ["Received active claims", String(frame.claims[selection.index].length)],
    ]);
  } else if (selection.kind === "larva") {
    const larva = trace.larvae[selection.index];
    pos = larva.xy;
    const feed = frame.first_feed[selection.index];
    definitions(dl, [
      ["Position (XY)", pos.join(", ")],
      ["Stage", larva.stage],
      ["Initial hunger", larva.hunger.toFixed(3)],
      ["First feed", feed >= 0 ? `Tick ${feed}` : "Not yet served"],
      ["Priority rule", "Random stage-based; fixed"],
    ]);
  } else {
    const points = [
      ...trace.larvae.map((l) => l.xy),
      ...trace.background_cells,
    ];
    pos = points[selection.index];
    definitions(dl, [
      ["Position (XY)", pos.join(", ")],
      ["Traversal", "Background is traversable"],
    ]);
  }
  const colocated = frame.positions
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p[0] === pos[0] && p[1] === pos[1]);
  if (colocated.length > 1) {
    const label = document.createElement("p");
    label.textContent = "Overlapping workers: select explicitly";
    $("overlap").append(label);
    for (const { i } of colocated) {
      const button = document.createElement("button");
      button.textContent = trace.workers[i];
      button.onclick = () => pin({ kind: "worker", index: i, view: focused });
      $("overlap").append(button);
    }
  }
  host.dataset.position = pos.join(",");
}
$<HTMLSelectElement>("entity").onchange = (e) => {
  const value = (e.target as HTMLSelectElement).value;
  if (!value) return pin(null);
  const [kind, index] = value.split(":");
  pin({
    kind: kind as "worker" | "larva",
    index: Number(index),
    view: focused,
  });
};
scene.canvas.addEventListener(
  "pointerdown",
  (e) => (start = [e.clientX, e.clientY]),
);
scene.canvas.addEventListener("pointerup", (e) => {
  if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) < 5)
    pin(scene.pick(e.clientX, e.clientY, tick));
});
scene.canvas.addEventListener("pointermove", (e) => {
  const picked = scene.pick(e.clientX, e.clientY, tick),
    hover = $("hover");
  hover.hidden = !picked;
  if (picked) {
    const t = traces[picked.view];
    hover.textContent =
      picked.kind === "worker"
        ? t.workers[picked.index]
        : picked.kind === "larva"
          ? t.larvae[picked.index].id
          : "Cell";
  }
});
scene.canvas.addEventListener("pointerleave", () => ($("hover").hidden = true));
scenario.onchange = () => load();
strategy.onchange = () => load();
compare.onchange = () => {
  strategy.disabled = compare.checked;
  load();
};
$("top").onclick = () => scene.topDown();
$("reset").onclick = () => scene.reset();
function togglePlay() {
  if (loading || !traces.length) return;
  if (tick >= maximum()) tick = 0;
  playing = !playing;
  $("play").textContent = playing ? "Pause" : "Play";
  $("play").setAttribute(
    "aria-label",
    playing ? "Pause replay" : "Play replay",
  );
  last = performance.now();
}
$("play").onclick = togglePlay;
seek.oninput = () => {
  tick = Number(seek.value);
  playing = false;
  $("play").textContent = "Play";
  scene.changed = true;
  updateLabels();
  updateInspector();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    playing = false;
    $("play").textContent = "Play";
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input,select,button,a")) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    tick = Math.max(
      0,
      Math.min(maximum(), Math.floor(tick) + (e.key === "ArrowRight" ? 1 : -1)),
    );
    scene.changed = true;
    updateLabels();
    updateInspector();
  }
});
function animate(now: number) {
  requestAnimationFrame(animate);
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (document.hidden) return;
  if (playing) {
    tick = Math.min(
      maximum(),
      tick + elapsed * Number($<HTMLSelectElement>("speed").value),
    );
    scene.changed = true;
    if (tick >= maximum()) {
      playing = false;
      $("play").textContent = "Play";
    }
  }
  if (now - lastDraw >= 1000 / 30 && (scene.changed || playing)) {
    scene.draw(tick);
    updateLabels();
    updateInspector();
    lastDraw = now;
    frames++;
  }
  if (now - windowStart > 2000) {
    measuredFps = Math.round((frames * 1000) / (now - windowStart));
    frames = 0;
    windowStart = now;
    $("perf").textContent =
      `${measuredFps} renders/s${!playing ? " / idle on demand" : ""}`;
  }
}
requestAnimationFrame(animate);
fetch("manifest.json")
  .then((r) => {
    if (!r.ok) throw Error("Manifest missing");
    return r.json();
  })
  .then((value: Manifest) => {
    if (
      value.model_version !== "research-v2" ||
      !Array.isArray(value.scenarios) ||
      !value.scenarios.length
    )
      throw Error("Invalid manifest");
    manifest = value;
    value.scenarios.forEach((s) =>
      scenario.add(new Option(`${s.id} / ${s.label}`, s.id)),
    );
    const query = new URLSearchParams(location.search);
    if (value.scenarios.some((s) => s.id === query.get("scenario")))
      scenario.value = query.get("scenario")!;
    if (labels[query.get("strategy") || ""])
      strategy.value = query.get("strategy")!;
    compare.checked = query.has("compare");
    strategy.disabled = compare.checked;
    return load();
  })
  .catch((error) => showStatus(`Unable to open lab: ${error.message}`));
// Read-only state for browser verification; no simulation lives in JavaScript.
Object.defineProperty(window, "labState", {
  get: () => ({
    tick: Math.floor(tick),
    playing,
    mode: scene.renderer ? "3d" : "2d",
    selected: scene.selected,
    camera: scene.views[0]?.camera.position.toArray(),
    layers: { ...scene.layers },
    frames: traces.map((t) => frameAt(t, tick)),
    measuredFps,
    renderer: scene.renderer?.info.memory,
  }),
});
