import "./style.css";
import { ReplayScene, Entity, replayThemes } from "./scene";
import { Manifest, Trace, labels, loadTrace, frameAt } from "./trace";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<header><div><h1>Nest / Routing Lab</h1><p class="subtitle">How do workers reach every larva?</p></div><nav aria-label="Replay configuration"><label>Nest & bout <select id="scenario" aria-label="Nest scenario"></select></label><label class="compare"><input id="compare" type="checkbox"> Compare original four</label></nav></header>
<section class="method-bar" aria-label="Movement methods"><div class="method-heading"><span>Change the method, not the colony</span><label class="method-select">Method <select id="strategy" aria-label="Strategy"></select></label></div><div id="method-filters" role="group" aria-label="Choose one method"></div></section>
<main><aside class="layers"><span class="eyebrow">The experiment</span><h2>One feeding round</h2><p>Workers search a fixed nest. Each waiting larva needs one visit and one feed.</p><h3 id="method-name"></h3><p id="method-explanation"></p><p id="population"></p><details class="help"><summary>What counts as fed?</summary><p id="feeding-help">A worker feeds a larva at its cell. Teal means it has received its first feed; this is not satiation or a complete biological feeding cycle. Initial hunger is a fixed, randomly assigned priority, not a measurement.</p></details><details id="provenance"><summary>Where these data come from</summary><p id="scenario-context"></p><p><code>ED_FL_3nests1noC2.csv</code> supplies nest coordinates and larval stages. <code>ALL_FL_minmaj_final3noC2.csv</code> supplies bout activity and observed worker counts.</p><p>Larvae are doubled with deterministic jitter, then mapped to a grid. Hunger is sampled by stage: L1 0.20-0.50, L2 0.45-0.75, L3 0.65-1.00. Movement is simulated, not an observed wasp trajectory. Depth is illustrative. Raw datasets stay private.</p></details><details id="layer-controls"><summary>Display layers & controls</summary><div id="layers"></div><label class="opacity">Nest opacity<input id="opacity" type="range" min="0" max="100" value="35"></label><p>Pin a worker to see its route and local sensing area. Amber line: recent movement. Teal line: target direction, not a travelled path.</p><p>Drag to orbit. Scroll to zoom. Click to pin an agent.</p></details><a class="report-link" href="https://github.com/hemu77/Bio-Inspired-Routing-Optimization-in-Social-Wasps" target="_blank" rel="noreferrer">Read the research & limitations</a></aside>
<section class="viewport" aria-label="Simulation"><div class="view-tools"><button id="top" title="Look straight down at the model grid">Top-down</button><button id="reset" title="Restore the initial camera without restarting the feeding round">Reset view</button><span id="mode"></span></div><div id="canvas"></div><div id="view-labels"></div><div id="hover" hidden></div><div class="legend" id="legend"><span><i class="waiting"></i>Waiting larva</span><span><i class="fed"></i>First feed received</span><span><i class="wasp"></i>Moving worker</span></div><div id="status" role="status">Loading verified replay...</div></section>
<aside class="inspector"><span class="eyebrow" id="progress-context">This replay</span><h2 id="cycle-state">Round not started</h2><strong id="fed-count"></strong><progress id="coverage" aria-label="Larvae receiving their first feed" max="100" value="0"></progress><p id="remaining"></p><div class="cycle-chart"><span>Whole round: first-feed coverage</span><svg id="cycle-chart" viewBox="0 0 240 66" role="img" aria-label="Recorded first-feed coverage over the whole round"><title>Coverage from the first frame to the last frame</title><path id="coverage-path"/><circle id="coverage-cursor" r="3"/></svg><div id="milestones" role="group" aria-label="Jump to feeding milestones"></div></div><p id="run-summary"></p><details class="help"><summary>How to read the timeline</summary><p>The chart shows this recorded run, not an average or prediction. Each rise is a first feed; flat parts mean no new larvae were fed. Milestones jump to the first tick reaching that coverage. A tick is one activation of each worker: move, feed, or broadcast, not seconds.</p></details><h3>Latest feeding event</h3><div id="feed-events"></div><h3>Inspect an individual</h3><label class="entity-label">Select / pin<select id="entity" aria-label="Inspect an agent"><option value="">No pinned agent</option></select></label><div id="details"><p>Pick a worker or larva to inspect its recorded state.</p></div><div id="overlap"></div><details><summary>Travel & reproducibility</summary><dl id="metrics"></dl><p>Travel counts grid moves, not energy. Broadcasts cost a worker action. The seed reproduces this run; one replay does not establish which method is best.</p></details></aside></main>
<footer><button id="play" aria-label="Play replay">Play</button><button id="restart" title="Return to tick zero">Restart</button><button id="next-feed" title="Jump to the next tick with a recorded first feed">Next feed</button><label class="timeline">Tick <output id="tick">0</output><input id="seek" aria-label="Seek actual tick" type="range" min="0" max="1" value="0" step="1"></label><label>Speed <select id="speed" aria-label="Playback speed"><option value="10" selected>10 ticks/s</option><option value="30">30 ticks/s</option><option value="100">100 ticks/s</option></select></label><span id="perf"></span></footer>`;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
// Playback stays in document flow, never over the lower comparison panels.
document.querySelector("main")!.before(document.querySelector("footer")!);
document.querySelector("nav .compare")!.lastChild!.textContent = " Compare four baselines";
const modelNote = document.createElement("p");
modelNote.className = "model-note";
modelNote.textContent = "Research-v3: repeated feeds reduce remaining hunger. Full green means hunger ≤ 0.12; there is no three-feed cap. These rates are model assumptions, not measured physiology.";
document.querySelector(".method-bar")!.prepend(modelNote);
const reference = document.createElement("a");
reference.id = "legacy-replay";
reference.className = "report-link";
reference.target = "_blank";
reference.rel = "noreferrer";
reference.textContent = "Open preserved legacy simulation";
$("method-explanation").after(reference);
const axis = document.createElement("div");
axis.id = "cycle-axis";
$("milestones").before(axis);
const milestoneLabel = document.createElement("span");
milestoneLabel.className = "milestone-label";
milestoneLabel.textContent = "Jump to coverage:";
$("milestones").before(milestoneLabel);
$("cycle-chart").setAttribute("aria-describedby", "cycle-axis");
const scopeNote = document.createElement("p");
scopeNote.className = "scope-note";
scopeNote.textContent = "First-feed coverage only. Not satiation or measured physiology.";
$("population").after(scopeNote);
const feedCaption = document.createElement("div");
feedCaption.id = "feed-caption";
$("canvas").after(feedCaption);
// Titles belong to each panel header, not to its rendered nest area.
$("canvas").append($("view-labels"));
const extensions = document.createElement("details");
extensions.id = "extra-methods";
extensions.innerHTML = '<summary>Additional local-information methods</summary><div id="extension-filters"></div>';
$("method-filters").after(extensions);
const scenario = $<HTMLSelectElement>("scenario"),
  strategy = $<HTMLSelectElement>("strategy"),
  compare = $<HTMLInputElement>("compare"),
  seek = $<HTMLInputElement>("seek");
const scene = new ReplayScene(
  $("canvas"),
  new URLSearchParams(location.search).has("2d"),
);
const themeButton = document.createElement('button');
themeButton.id = 'theme-toggle';
document.querySelector('nav')!.append(themeButton);
let theme: keyof typeof replayThemes = 'dark';
try { if (localStorage.getItem('nest-lab-theme') === 'light') theme = 'light'; } catch { /* Themes still work when storage is blocked. */ }
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  scene.setTheme(theme);
  for (const [key,value] of Object.entries(scene.palette)) document.documentElement.style.setProperty(`--replay-${key}`, value);
  themeButton.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  themeButton.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  themeButton.title = 'Change appearance without restarting or moving the camera';
}
themeButton.onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  try { localStorage.setItem('nest-lab-theme', theme); } catch { /* Optional preference persistence. */ }
};
applyTheme();
document.querySelector('.legend .fed')!.parentElement!.lastChild!.textContent = 'Full (hunger ≤ 0.12)';
const partialLegend = document.createElement('span');
partialLegend.innerHTML = '<i class="partial"></i>Part-fed (hunger shade)';
document.querySelector('.legend .fed')!.parentElement!.before(partialLegend);
document.querySelector('.cycle-chart > span')!.textContent = 'Whole round: hunger-threshold completion';
$('coverage').setAttribute('aria-label', 'Larvae reaching the hunger threshold');
$('cycle-chart').setAttribute('aria-label', 'Recorded hunger-threshold completion over the whole round');
$('next-feed').title = 'Jump to the next recorded feed, including repeat feeds';
document.querySelector('#feeding-help')!.textContent = 'Blue means no feed yet. After feeding, blue-to-green shading follows remaining hunger. Solid green means hunger ≤ 0.12. Each feed reduces hunger by L1 0.35, L2 0.45 or L3 0.55; hungry larvae recover 0.020, 0.028 or 0.035 per tick. Full larvae stop recovering within this one round. These inherited rates are assumptions; three feeds do not automatically mean full.';
scopeNote.textContent = 'Hunger-threshold completion, not measured physiological satiation.';
$('progress-context').textContent = 'Hunger-based feeding round';
document.querySelector('.layers > p')!.textContent = 'Workers may feed the same larva repeatedly until its remaining hunger reaches the threshold.';
const navigationHelp = 'Drag to orbit. Two-finger scroll to pan sideways or up/down. Pinch (or Ctrl+scroll) to zoom. Shift-drag also pans. Reset view fits the whole nest.';
document.querySelector('#layer-controls > p:last-child')!.textContent = navigationHelp;
const navigationHint = document.createElement('span');
navigationHint.className = 'navigation-hint';
navigationHint.textContent = 'Drag to orbit / two-finger scroll to pan / pinch to zoom';
navigationHint.title = navigationHelp;
document.querySelector('.view-tools')!.prepend(navigationHint);
const expandView = document.createElement('button');
expandView.id = 'expand-view';
expandView.textContent = 'Expand view';
expandView.title = 'Use the full screen to inspect the nest; Escape returns to the page';
expandView.hidden = !document.fullscreenEnabled;
document.querySelector('.view-tools')!.append(expandView);
expandView.onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector<HTMLElement>('.viewport')!.requestFullscreen();
  } catch {
    navigationHint.textContent = 'Full screen unavailable. Use page zoom or Reset view to fit the nest.';
  }
};
document.addEventListener('fullscreenchange', () => {
  expandView.textContent = document.fullscreenElement ? 'Exit full screen' : 'Expand view';
  requestAnimationFrame(() => { scene.resize(); scene.reset(); });
});
for (const [id, label, scale] of [['zoom-in', 'Zoom in', .8], ['zoom-out', 'Zoom out', 1.25]] as const) {
  const button = document.createElement('button');
  button.id = id;
  button.textContent = label;
  button.disabled = !scene.renderer;
  button.onclick = () => scene.zoom(scale);
  $('top').before(button);
}
document.querySelector('.inspector .help p')!.textContent = 'The chart counts larvae reaching hunger ≤ 0.12, not larvae merely visited once. Partial feeding can occur during flat stretches. A tick permits each worker one move, feed or broadcast; it is not seconds.';
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
for (const [title, extended] of [["Adapted baselines", false], ["Local-information extensions", true]] as const) {
  const group = document.createElement("optgroup");
  group.label = title;
  for (const [value, label] of Object.entries(labels))
    if (value.startsWith("local_") === extended) group.append(new Option(label, value));
  strategy.append(group);
}
strategy.value = "tsp";
const methodDescriptions: Record<string, string> = {
  random: "No knowledge of larval locations. Each move chooses a random grid direction. A worker feeds when it happens to reach a waiting larva.",
  biased: "No knowledge of larval locations. Workers tend to keep moving in the same direction, with a 25% chance to redraw it each move.",
  tsp: "Knows the whole colony. Each worker follows a nearest-neighbour tour. This historical TSP label does not mean an optimal route.",
  greedy: "Knows the whole colony. Chooses targets randomly, weighted toward greater remaining hunger and shorter distance; it is not a deterministic nearest-target rule.",
  local_nearest: "Sees nearby cells within three grid moves, and remembers observations. Chooses the nearest known waiting larva; explores when none is known.",
  local_urgency_claims: "Sees nearby cells and remembers observations. Balances observed remaining hunger against distance, then broadcasts short-lived target claims to nearby workers. Communication consumes a turn.",
};
for (const [value, label] of Object.entries(labels)) {
  const button = document.createElement("button");
  button.textContent = label;
  button.dataset.method = value;
  button.title = methodDescriptions[value];
  button.onclick = () => {
    strategy.value = value;
    compare.checked = false;
    strategy.disabled = false;
    load();
  };
  $(value.startsWith("local_") ? "extension-filters" : "method-filters").append(button);
}
type ScenarioContext = {observed_rows: number; observed_feeding_events: number; observed_unique_cells: number; observed_unique_wasps: number; scaled_larvae: number; n_wasps: number; grid_size: number};
let contexts: {source_checksum: string; scenarios: Record<string, ScenarioContext>};
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
  updateCycle();
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
  pause();
  document.querySelector("main")!.classList.toggle("comparing", compare.checked);
  $("canvas").style.visibility = "hidden";
  feedCaption.hidden = true;
  $("view-labels").replaceChildren();
  $<HTMLButtonElement>("next-feed").disabled = true;
  document.querySelectorAll<HTMLButtonElement>("[data-method]").forEach(button =>
    button.setAttribute("aria-pressed", String(!compare.checked && button.dataset.method === strategy.value)));
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
    const context = contexts.scenarios[selection.id];
    if (!context || (["observed_rows", "observed_feeding_events", "observed_unique_cells", "observed_unique_wasps", "scaled_larvae", "n_wasps", "grid_size"] as const).some(key => !Number.isInteger(context[key]) || context[key] < 0) || contexts.source_checksum !== manifest.source_checksum || data.some(t => t.larvae.length !== context.scaled_larvae || t.workers.length !== context.n_wasps || t.grid_size !== context.grid_size))
      throw Error("Dataset context does not match this replay");
    traces = data;
    tick = 0;
    focused = 0;
    scene.setTraces(data);
    seek.max = String(maximum());
    seek.value = "0";
    pin(null);
    $("population").textContent = `${context.scaled_larvae} synthetic larvae / ${context.n_wasps} simulated workers / ${context.grid_size} x ${context.grid_size} grid`;
    $("scenario-context").textContent = `${context.observed_rows} recorded rows; ${context.observed_feeding_events} grouped activity events; ${context.observed_unique_cells} observed cells; ${context.observed_unique_wasps} observed workers. These summaries set an assumed simulated worker count, not food resources or simulated feeds. Activity grouping remains an assumption pending a codebook. The source-code check is not independent verification of private raw datasets.`;
    reference.hidden = compare.checked || strategy.value.startsWith("local_");
    reference.href = `legacy/simulation_${strategy.value}.html`;
    $("method-name").textContent = compare.checked ? "Four baseline methods" : labels[strategy.value];
    $("method-explanation").textContent = compare.checked ? "Same synthetic colony, worker count, hunger rules and paired seed. Completed methods hold their final state. This is research-v3, not the original notebook's action model." : methodDescriptions[strategy.value];
    $("canvas").style.visibility = "visible";
    updateLabels();
    updateInspector();
    showStatus("");
  } catch (error) {
    if (controller.signal.aborted) return;
    traces = [];
    feedCaption.hidden = true;
    scene.setTraces([]);
    $("fed-count").textContent = "Replay unavailable";
    $<HTMLProgressElement>("coverage").value = 0;
    $("remaining").textContent = "No verified states to display.";
    $("feed-events").replaceChildren();
    $("milestones").replaceChildren();
    $("cycle-chart").dataset.trace = "";
    document.getElementById("coverage-path")!.setAttribute("d", "");
    document.getElementById("coverage-cursor")!.setAttribute("cx", "-10");
    $("cycle-state").textContent = "Could not open this run";
    $("run-summary").textContent = "";
    $("cycle-axis").textContent = "";
    $("details").replaceChildren();
    $("metrics").replaceChildren();
    $("scenario-context").textContent = "Context unavailable for this replay.";
    $("population").textContent = "";
    $("method-explanation").textContent = "Choose another method or scenario to retry.";
    $<HTMLSelectElement>("entity").replaceChildren(new Option("No pinned agent", ""));
    showStatus(
      `Replay could not load: ${(error as Error).message}. Choose another scenario or reload.`,
    );
  } finally {
    if (controller === abort) {
      loading = false;
      updateCycle();
    }
  }
}
function updateLabels() {
  const host = $("view-labels");
  host.replaceChildren();
  host.classList.toggle("four", traces.length === 4);
  host.classList.toggle("stacked", traces.length === 4 && $("canvas").clientWidth < 600);
  host.hidden = !scene.layers.annotations;
  $("legend").hidden = !scene.layers.annotations;
  traces.forEach((trace, i) => {
    const frame = frameAt(trace, tick),
      label = document.createElement("div");
    label.className = "view-label";
    const title = document.createElement("strong"),
      line = document.createElement("span");
    title.textContent = labels[trace.strategy];
      line.textContent = `${frame.fed}/${trace.larvae.length} full / tick ${frame.tick}${frame.fed === trace.larvae.length ? " / COMPLETE" : ""}`;
    label.append(title, line);
    if (i === focused) label.classList.add("focused");
    host.append(label);
  });
  $("tick").textContent = `${Math.floor(tick)} / ${maximum()}`;
  seek.value = String(Math.floor(tick));
  updateCycle();
}

// Hunger and fullness come from Python snapshots, never a browser-side simulation.
function updateCycle() {
  const trace = traces[focused];
  if (!trace) return;
  const frame = frameAt(trace, tick), total = trace.larvae.length;
  const complete = frame.fed === total;
  $("progress-context").textContent = `${trace.scenario} / ${labels[trace.strategy]}`;
  $("cycle-state").textContent = complete ? "Round complete" : frame.feed_counts.some(n => n > 0) ? "Feeding in progress" : "Searching for the first feed";
  $("fed-count").textContent = `${frame.fed} / ${total} full`;
  $<HTMLProgressElement>("coverage").value = frame.fed / total * 100;
  const partial = frame.feed_counts.filter((n,l) => n > 0 && frame.satiated_at[l] < 0).length;
  $("remaining").textContent = `${total - frame.fed - partial} unfed / ${partial} part-fed / ${frame.fed} full`;
  $("run-summary").textContent = trace.summary.finished ? `All larvae reach hunger ≤ 0.12 at tick ${trace.summary.completion_step}.` : `Stopped at tick ${trace.summary.observed_steps}; some larvae remain hungry.`;
  const lastTick = Math.max(1, trace.frames.at(-1)!.tick);
  document.getElementById("coverage-cursor")!.setAttribute("cx", String(4 + frame.tick / lastTick * 232));
  document.getElementById("coverage-cursor")!.setAttribute("cy", String(58 - frame.fed / total * 50));
  // Rebuild the full-round chart only when the focused trace changes.
  if ($("cycle-chart").dataset.trace !== `${trace.scenario}:${trace.strategy}:${trace.seed}`) {
    $("cycle-chart").dataset.trace = `${trace.scenario}:${trace.strategy}:${trace.seed}`;
    axis.replaceChildren();
    for (const text of ["0 ticks / 0%", `${lastTick} ticks / ${(trace.frames.at(-1)!.fed / total * 100).toFixed(1)}%`]) {
      const label = document.createElement("span");
      label.textContent = text;
      axis.append(label);
    }
    let path = "M4 58";
    for (const f of trace.frames) path += ` H${4 + f.tick / lastTick * 232} V${58 - f.fed / total * 50}`;
    document.getElementById("coverage-path")!.setAttribute("d", path);
    $("milestones").replaceChildren();
    for (const percentage of [0, 25, 50, 75, 100]) {
      const milestone = trace.frames.find(f => f.fed / total * 100 >= percentage);
      const button = document.createElement("button");
      button.textContent = `${percentage}%`;
      button.setAttribute("aria-label", `${percentage}% fed`);
      button.title = milestone ? `First reaches ${percentage}% at tick ${milestone.tick}` : "Not reached in this run";
      button.disabled = !milestone;
      button.onclick = () => jump(milestone!.tick);
      $("milestones").append(button);
    }
  }
  let eventFrame = frame;
  while (eventFrame.tick > 0 && !eventFrame.events.some(e => e.type === "first_feed" || e.type === 'feed'))
    eventFrame = trace.frames[eventFrame.tick - 1];
  const events = eventFrame.events.filter(e => e.type === "first_feed" || e.type === 'feed');
  $("feed-events").replaceChildren();
  if (!events.length) $("feed-events").textContent = "No feed yet. Press Play or Next feed to find the first recorded event.";
  feedCaption.hidden = traces.length !== 1 || !scene.layers.annotations;
  feedCaption.textContent = events.length
    ? `Latest feed, tick ${eventFrame.tick}: ${trace.workers[Number(events[0].worker)]} fed ${trace.larvae[Number(events[0].larva)].id}${events.length > 1 ? ` / ${events.length - 1} more at this tick` : ""}`
    : "Press Play to follow the round, or Next feed to inspect an event.";
  for (const event of events) {
    const button = document.createElement("button");
    button.textContent = `Tick ${eventFrame.tick}: ${trace.workers[Number(event.worker)]} fed ${trace.larvae[Number(event.larva)].id}; hunger ${Number(event.hunger_before).toFixed(2)} → ${Number(event.hunger_after).toFixed(2)}`;
    button.title = "Pin this larva to inspect its current hunger and total feeds";
    button.onclick = () => pin({kind: "larva", index: Number(event.larva), view: focused});
    $("feed-events").append(button);
  }
  $<HTMLButtonElement>("next-feed").disabled = loading || !trace.frames.some(f => f.tick > Math.floor(tick) && f.events.some(e => e.type === "first_feed" || e.type === 'feed'));
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
      ["Remaining hunger", frame.hunger[selection.index].toFixed(3)],
      ["Threshold reached", frame.satiated_at[selection.index] >= 0 ? `Tick ${frame.satiated_at[selection.index]}` : 'Not yet'],
      ["Feeds received", String(frame.feed_counts[selection.index])],
      ["State", frame.satiated_at[selection.index] >= 0 ? 'Full (model threshold)' : frame.feed_counts[selection.index] > 0 ? 'Part-fed, still hungry' : 'Unfed'],
      ["First feed", feed >= 0 ? `Tick ${feed}` : "Not yet served"],
      ["Hunger rule", "Stage-random start; increases between feeds"],
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
    const frame = frameAt(t, tick);
    if (picked.kind === "worker") {
      const target = frame.targets[picked.index];
      hover.textContent = `${t.workers[picked.index]} / ${target >= 0 ? `target ${t.larvae[target].id}` : "exploring"} / click to inspect`;
    } else if (picked.kind === "larva") {
      const larva = t.larvae[picked.index], feed = frame.first_feed[picked.index];
      hover.textContent = `${larva.id} / ${larva.stage} / hunger ${frame.hunger[picked.index].toFixed(2)} / ${frame.feed_counts[picked.index]} feeds / ${frame.satiated_at[picked.index] >= 0 ? 'full' : feed >= 0 ? 'part-fed' : 'unfed'}`;
    } else hover.textContent = "Traversable background cell / not a larva";
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
function pause() {
  playing = false;
  $("play").textContent = "Play";
  $("play").setAttribute("aria-label", "Play replay");
}
function jump(to: number) {
  if (loading || !traces.length) return;
  tick = Math.max(0, Math.min(maximum(), to));
  pause();
  scene.changed = true;
  updateLabels();
  updateInspector();
}
$("restart").onclick = () => jump(0);
$("next-feed").onclick = () => {
  const trace = traces[focused];
  const next = trace?.frames.find(f => f.tick > Math.floor(tick) && f.events.some(e => e.type === "first_feed" || e.type === 'feed'));
  if (next) {
    jump(next.tick);
    const feed = next.events.find(e => e.type === "first_feed" || e.type === 'feed')!;
    pin({kind: "larva", index: Number(feed.larva), view: focused});
  }
};
$("play").onclick = togglePlay;
seek.oninput = () => jump(Number(seek.value));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll<HTMLDetailsElement>(".help[open]").forEach(d => d.open = false);
  if ((e.target as HTMLElement).matches("input,select,button,a,summary")) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    jump(Math.floor(tick) + (e.key === "ArrowRight" ? 1 : -1));
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
      pause();
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
Promise.all(["manifest.json", "scenario-context.json"].map(path => fetch(path).then(r => {
  if (!r.ok) throw Error(`${path} missing`);
  return r.json();
})))
  .then(([value, context]) => {
    if (
      value.model_version !== "research-v3" ||
      !Array.isArray(value.scenarios) ||
      !value.scenarios.length
    )
      throw Error("Invalid manifest");
    manifest = value as Manifest;
    contexts = context;
    manifest.scenarios.forEach((s) =>
      scenario.add(new Option(`${s.id} / ${s.label.includes("incomplete") ? "slow-run example" : "representative example"}`, s.id)),
    );
    const query = new URLSearchParams(location.search);
    if (manifest.scenarios.some((s) => s.id === query.get("scenario")))
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
    regions: traces.map((_, i) => scene.region(i)),
    palette: {...scene.palette},
    cameraTarget: scene.views[0]?.controls.target.toArray(),
    partialExample: (() => {
      const example = traces[focused]?.frames.find(f => f.feed_counts.some((n,l) => n > 0 && f.satiated_at[l] < 0));
      return example ? {tick:example.tick,index:example.feed_counts.findIndex((n,l) => n > 0 && example.satiated_at[l] < 0)} : null;
    })(),
  }),
});
