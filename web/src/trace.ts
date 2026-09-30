export type XY = [number, number];
export type Frame = {
  tick: number;
  fed: number;
  distance: number;
  messages: number;
  positions: XY[];
  targets: number[];
  first_feed: number[];
  reasons: string[];
  claims: number[][][];
  worker_order: number[];
  events: Record<string, unknown>[];
  phase: string;
};
export type Trace = {
  schema_version: number;
  model_version: string;
  source_checksum: string;
  scenario: string;
  strategy: string;
  seed: number;
  grid_size: number;
  sensing_radius: number;
  communication_radius: number;
  claims_enabled: boolean;
  global_sensing: boolean;
  larvae: { id: string; xy: XY; stage: string; hunger: number }[];
  workers: string[];
  frames: Frame[];
  background_cells: XY[];
  summary: {
    finished: boolean;
    completion_step: number | null;
    observed_steps: number;
    replicate: number;
  };
};
export type Manifest = {
  model_version: string;
  source_checksum: string;
  scenarios: {
    id: string;
    nest: string;
    label: string;
    traces: Record<string, string>;
  }[];
};
export const labels: Record<string, string> = {
  random: "Random",
  biased: "Biased",
  greedy: "Greedy",
  tsp: "TSP",
  local_nearest: "Local nearest",
  local_urgency_claims: "Local urgency + claims",
};
export function validateTrace(t: Trace, manifest: Manifest): Trace {
  const integer = (v: number) => Number.isInteger(v);
  if (
    t.schema_version !== 1 ||
    t.model_version !== manifest.model_version ||
    t.source_checksum !== manifest.source_checksum ||
    !labels[t.strategy] ||
    !integer(t.grid_size) ||
    t.grid_size < 1 ||
    t.grid_size > 100 ||
    !t.larvae?.length ||
    t.larvae.length > 2000 ||
    !t.workers?.length ||
    t.workers.length > 200 ||
    !t.frames?.length ||
    t.frames.length > 10001
  )
    throw Error("Unsupported or invalid replay");
  const xy = (p: XY) =>
    p.length === 2 && p.every((v) => integer(v) && v >= 0 && v < t.grid_size);
  if (
    t.larvae.some(
      (l) =>
        !xy(l.xy) ||
        !Number.isFinite(l.hunger) ||
        l.hunger < 0 ||
        l.hunger > 1 ||
        !["L1", "L2", "L3"].includes(l.stage),
    )
  )
    throw Error("Invalid larval state");
  t.frames.forEach((f, i) => {
    if (
      f.tick !== i ||
      f.phase !== "post_tick" ||
      f.positions.length !== t.workers.length ||
      f.targets.length !== t.workers.length ||
      f.reasons.length !== t.workers.length ||
      f.first_feed.length !== t.larvae.length ||
      f.positions.some((p) => !xy(p)) ||
      f.first_feed.some((v) => !integer(v) || v < -1 || v > i) ||
      f.fed !== f.first_feed.filter((v) => v >= 0).length ||
      f.targets.some((v) => !integer(v) || v < -1 || v >= t.larvae.length)
    )
      throw Error(`Invalid replay frame ${i}`);
    if (
      i > 0 &&
      f.positions.some(
        (p, w) =>
          Math.abs(p[0] - t.frames[i - 1].positions[w][0]) +
            Math.abs(p[1] - t.frames[i - 1].positions[w][1]) >
          1,
      )
    )
      throw Error("Replay violates cardinal action budget");
    if (
      !Array.isArray(f.claims) ||
      f.claims.length !== t.workers.length ||
      f.claims.some(
        (c) =>
          !Array.isArray(c) ||
          c.some(
            (v) =>
              v.length !== 3 ||
              !v.every(integer) ||
              v[0] < 0 ||
              v[0] >= t.larvae.length ||
              v[1] < 0 ||
              v[1] >= t.workers.length ||
              v[2] <= i,
          ),
      ) ||
      !Array.isArray(f.events) ||
      !Array.isArray(f.worker_order)
    )
      throw Error("Invalid claims or event state");
    if (i === 0) {
      if (
        f.worker_order.length ||
        f.events.length ||
        f.fed ||
        f.distance ||
        f.messages
      )
        throw Error("Invalid initial frame");
      return;
    }
    const previous = t.frames[i - 1];
    if (
      f.worker_order.length !== t.workers.length ||
      new Set(f.worker_order).size !== t.workers.length ||
      f.worker_order.some((w) => !integer(w) || w < 0 || w >= t.workers.length)
    )
      throw Error("Invalid scheduler order");
    const actionWorkers = new Set<number>(),
      fedEvents = new Set<number>();
    let broadcasts = 0,
      lastOrder = -1;
    for (const event of f.events) {
      const worker = event.worker as number;
      if (
        !integer(worker) ||
        worker < 0 ||
        worker >= t.workers.length ||
        actionWorkers.has(worker)
      )
        throw Error("Invalid event worker");
      actionWorkers.add(worker);
      const order = f.worker_order.indexOf(worker);
      if (order <= lastOrder) throw Error("Events violate scheduler order");
      lastOrder = order;
      if (
        f.positions[worker].some((v, a) => v !== previous.positions[worker][a])
      )
        throw Error("Feed or broadcast also moved");
      if (event.type === "first_feed") {
        const larva = event.larva as number;
        if (
          !integer(larva) ||
          larva < 0 ||
          larva >= t.larvae.length ||
          fedEvents.has(larva) ||
          previous.first_feed[larva] >= 0 ||
          f.first_feed[larva] !== i ||
          t.larvae[larva].xy.some((v, a) => v !== previous.positions[worker][a])
        )
          throw Error("Invalid first-feed event");
        fedEvents.add(larva);
      } else if (event.type === "broadcast") {
        broadcasts++;
        if (
          !integer(event.target as number) ||
          (event.target as number) < 0 ||
          (event.target as number) >= t.larvae.length ||
          event.expires !== i + 8
        )
          throw Error("Invalid broadcast");
      } else throw Error("Unknown event");
    }
    f.first_feed.forEach((v, l) => {
      if (
        v !== previous.first_feed[l] &&
        (!fedEvents.has(l) || previous.first_feed[l] !== -1)
      )
        throw Error("Unexplained feeding transition");
    });
    const movement = f.positions.reduce(
      (sum, p, w) =>
        sum +
        Math.abs(p[0] - previous.positions[w][0]) +
        Math.abs(p[1] - previous.positions[w][1]),
      0,
    );
    if (
      f.distance !== previous.distance + movement ||
      f.messages !== previous.messages + broadcasts
    )
      throw Error("Invalid movement or message totals");
  });
  const last = t.frames[t.frames.length - 1];
  if (
    t.summary.observed_steps !== last.tick ||
    t.summary.finished !== (last.fed === t.larvae.length) ||
    t.summary.completion_step !== (t.summary.finished ? last.tick : null)
  )
    throw Error("Summary contradicts replay");
  return t;
}
export async function loadTrace(
  path: string,
  manifest: Manifest,
  signal: AbortSignal,
): Promise<Trace> {
  if (!/^traces\/[a-zA-Z0-9_-]+\.json$/.test(path))
    throw Error("Invalid trace path");
  const response = await fetch(path, { signal });
  if (!response.ok) throw Error(`Replay unavailable (${response.status})`);
  const text = await response.text();
  if (text.length > 40_000_000) throw Error("Replay exceeds size budget");
  return validateTrace(JSON.parse(text), manifest);
}
export const frameAt = (trace: Trace, tick: number) =>
  trace.frames[Math.min(Math.floor(tick), trace.frames.length - 1)];
