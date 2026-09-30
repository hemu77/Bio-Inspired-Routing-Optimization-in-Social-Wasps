import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Trace, Frame, XY } from "./trace";
export type Entity = {
  kind: "worker" | "larva" | "cell";
  index: number;
  view: number;
};
export type Layers = {
  structure: boolean;
  larvae: boolean;
  wasps: boolean;
  routes: boolean;
  sensing: boolean;
  annotations: boolean;
  opacity: number;
};
type View = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  larvae: THREE.InstancedMesh;
  wasps: THREE.InstancedMesh[];
  structure: THREE.Group;
  routes: THREE.Group;
  sensing: THREE.Group;
  cells: THREE.InstancedMesh;
  marker: THREE.Mesh;
  trace: Trace;
};
const teal = new THREE.Color("#51b5a1"),
  amber = new THREE.Color("#d9a148");
export class ReplayScene {
  renderer: THREE.WebGLRenderer | null = null;
  canvas: HTMLCanvasElement;
  fallback: CanvasRenderingContext2D | null = null;
  views: View[] = [];
  traces: Trace[] = [];
  layers: Layers = {
    structure: true,
    larvae: true,
    wasps: true,
    routes: true,
    sensing: true,
    annotations: true,
    opacity: 0.35,
  };
  selected: Entity | null = null;
  changed = true;
  private ray = new THREE.Raycaster();
  private dummy = new THREE.Object3D();
  constructor(
    readonly host: HTMLElement,
    force2d = false,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute(
      "aria-label",
      "Nest replay. Use entity selector to inspect agents without a mouse.",
    );
    this.canvas.tabIndex = 0;
    if (!force2d) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "low-power",
        });
        this.canvas = this.renderer.domElement;
        this.canvas.tabIndex = 0;
        this.canvas.setAttribute(
          "aria-label",
          "Interactive nest replay; drag to orbit.",
        );
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        this.renderer.setClearColor("#20282b");
      } catch {
        /* An interactive 2D replay remains available without WebGL. */
      }
    }
    if (!this.renderer) this.fallback = this.canvas.getContext("2d");
    host.append(this.canvas);
    new ResizeObserver(() => {
      this.resize();
      this.changed = true;
    }).observe(host);
  }
  resize() {
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    this.renderer?.setSize(width, height, false);
    if (!this.renderer) {
      this.canvas.width = width * Math.min(devicePixelRatio, 1.5);
      this.canvas.height = height * Math.min(devicePixelRatio, 1.5);
    }
    for (const view of this.views) {
      view.camera.aspect =
        width /
        (this.views.length === 4 ? 2 : 1) /
        (height / (this.views.length === 4 ? 2 : 1));
      view.camera.updateProjectionMatrix();
    }
  }
  dispose() {
    for (const view of this.views) {
      view.controls.dispose();
      view.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        if (m.material) {
          for (const material of Array.isArray(m.material)
            ? m.material
            : [m.material])
            material.dispose();
        }
      });
    }
    this.views = [];
  }
  setTraces(traces: Trace[]) {
    this.dispose();
    this.traces = traces;
    this.selected = null;
    if (this.renderer)
      this.views = traces.map((trace, i) => this.createView(trace, i));
    this.resize();
    this.reset();
    this.changed = true;
  }
  private createView(trace: Trace, index: number): View {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#fff2d3", "#26373e", 2));
    const sun = new THREE.DirectionalLight("#fff0cc", 2);
    sun.position.set(4, 12, 8);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 250);
    camera.position.set(
      trace.grid_size * 0.85,
      trace.grid_size * 1.18,
      trace.grid_size * 1.1,
    );
    camera.lookAt(0, 0, 0);
    const controls = new OrbitControls(camera, this.canvas);
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 5;
    controls.maxDistance = 90;
    controls.enableDamping = false;
    controls.addEventListener("change", () => (this.changed = true));
    // Comparison keeps all cameras aligned; the first owns pointer controls.
    controls.enabled = index === 0;
    const structure = new THREE.Group(),
      routes = new THREE.Group(),
      sensing = new THREE.Group();
    scene.add(structure, routes, sensing);
    const grid = new THREE.GridHelper(
      trace.grid_size,
      trace.grid_size,
      "#465655",
      "#2d383b",
    );
    structure.add(grid);
    const cellPoints = [
      ...trace.larvae.map((l) => l.xy),
      ...trace.background_cells,
    ];
    const cells = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.08, 0.9),
      new THREE.MeshStandardMaterial({
        color: "#647071",
        transparent: true,
        opacity: 0.5,
      }),
      cellPoints.length,
    );
    cellPoints.forEach((p, i) => {
      this.transform(cells, i, p, 0.03, [1, 1, 1], trace.grid_size);
    });
    structure.add(cells);
    cells.userData.kind = "cell";
    const walls = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.26, 0.045),
      new THREE.MeshStandardMaterial({
        color: "#81908d",
        transparent: true,
        opacity: 0.5,
      }),
      cellPoints.length * 4,
    );
    cellPoints.forEach((p, i) => {
      for (let edge = 0; edge < 4; edge++) {
        this.dummy.position.set(
          p[0] -
            trace.grid_size / 2 +
            (edge === 0 ? 0.45 : edge === 1 ? -0.45 : 0),
          0.14,
          p[1] -
            trace.grid_size / 2 +
            (edge === 2 ? 0.45 : edge === 3 ? -0.45 : 0),
        );
        this.dummy.rotation.set(0, edge < 2 ? Math.PI / 2 : 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        walls.setMatrixAt(i * 4 + edge, this.dummy.matrix);
      }
    });
    structure.add(walls);
    const larvae = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 7),
      new THREE.MeshStandardMaterial({ roughness: 0.6 }),
      trace.larvae.length,
    );
    larvae.userData.kind = "larva";
    scene.add(larvae);
    const marker = new THREE.Mesh(new THREE.RingGeometry(.43, .49, 24), new THREE.MeshBasicMaterial({color: "#ffffff", side: THREE.DoubleSide}));
    marker.rotation.x = -Math.PI / 2;
    marker.visible = false;
    scene.add(marker);
    const wasps = [0, 1, 2, 3, 4].map((segment) => {
      const mesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshStandardMaterial({
          color:
            segment === 0 ? "#dda549" : segment < 3 ? "#372d23" : "#cbd1c3",
          transparent: segment >= 3,
          opacity: segment >= 3 ? 0.6 : 1,
        }),
        trace.workers.length,
      );
      mesh.userData.kind = "worker";
      scene.add(mesh);
      return mesh;
    });
    return {
      scene,
      camera,
      controls,
      larvae,
      wasps,
      structure,
      routes,
      sensing,
      cells,
      marker,
      trace,
    };
  }
  private transform(
    mesh: THREE.InstancedMesh,
    index: number,
    p: XY,
    height: number,
    scale: number[],
    size: number,
    angle = 0,
    offset = 0,
  ) {
    this.dummy.position.set(
      p[0] - size / 2 + Math.cos(angle) * offset,
      height,
      p[1] - size / 2 + Math.sin(angle) * offset,
    );
    this.dummy.rotation.set(0, -angle, 0);
    this.dummy.scale.set(scale[0], scale[1], scale[2]);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }
  private clearGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) {
        for (const m of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          m.dispose();
      }
    }
  }
  draw(tick: number) {
    if (!this.renderer) {
      this.draw2d(tick);
      return;
    }
    this.renderer.setScissorTest(true);
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    this.views.forEach((view, i) => {
      const trace = view.trace,
        frame =
          trace.frames[Math.min(Math.floor(tick), trace.frames.length - 1)],
        size = trace.grid_size;
      const previous = trace.frames[Math.max(0, frame.tick - 1)];
      view.structure.visible = this.layers.structure;
      view.larvae.visible = this.layers.larvae;
      view.wasps.forEach((m) => (m.visible = this.layers.wasps));
      view.structure.traverse((o) => {
        const material = (o as THREE.Mesh).material;
        if (material && !Array.isArray(material) && "opacity" in material)
          material.opacity = this.layers.opacity;
      });
      trace.larvae.forEach((larva, j) => {
        const served = frame.first_feed[j] >= 0;
        const radius = { L1: 0.16, L2: 0.23, L3: 0.29 }[larva.stage] || 0.2;
        this.transform(
          view.larvae,
          j,
          larva.xy,
          0.23,
          [radius, served ? radius * 0.5 : radius * 0.9, radius * 1.3],
          size,
        );
        view.larvae.setColorAt(
          j,
          served
            ? teal
            : amber.clone().lerp(new THREE.Color("#c35f42"), larva.hunger),
        );
      });
      view.larvae.instanceMatrix.needsUpdate = true;
      if (view.larvae.instanceColor)
        view.larvae.instanceColor.needsUpdate = true;
      frame.positions.forEach((p, j) => {
        const old = previous.positions[j];
        let angle = Math.atan2(p[1] - old[1], p[0] - old[0]);
        if (p[0] === old[0] && p[1] === old[1]) {
          // A stationary worker retains its last recorded travel heading, even on seek.
          for (let k = frame.tick - 1; k > 0; k--) {
            const a = trace.frames[k].positions[j], b = trace.frames[k-1].positions[j];
            if (a[0] !== b[0] || a[1] !== b[1]) {angle = Math.atan2(a[1]-b[1],a[0]-b[0]);break;}
          }
        }
        const scales = [
          [0.2, 0.13, 0.13],
          [0.1, 0.1, 0.1],
          [0.13, 0.1, 0.11],
          [0.2, 0.025, 0.1],
          [0.2, 0.025, 0.1],
        ];
        view.wasps.forEach((mesh, segment) => {
          const point: XY =
            segment >= 3 ? [p[0], p[1] + (segment === 3 ? 0.15 : -0.15)] : p;
          this.transform(
            mesh,
            j,
            point,
            segment >= 3 ? 0.62 : 0.48,
            scales[segment],
            size,
            angle,
            segment < 3 ? (segment - 1) * 0.23 : 0,
          );
        });
      });
      view.wasps.forEach((mesh) => {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      });
      view.larvae.computeBoundingSphere();
      this.clearGroup(view.routes);
      this.clearGroup(view.sensing);
      const selectedXY = this.selectedXY(trace, frame, i);
      view.marker.visible = !!selectedXY;
      if (selectedXY) view.marker.position.set(selectedXY[0] - size / 2, .32, selectedXY[1] - size / 2);
      if (this.selected?.view === i && this.selected.kind === "worker") {
        const worker = this.selected.index,
          p = frame.positions[worker];
        if (this.layers.routes) {
          const points = trace.frames
            .slice(Math.max(0, frame.tick - 30), frame.tick + 1)
            .map(
              (f) =>
                new THREE.Vector3(
                  f.positions[worker][0] - size / 2,
                  0.6,
                  f.positions[worker][1] - size / 2,
                ),
            );
          view.routes.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(points),
              new THREE.LineBasicMaterial({ color: "#e4b64b" }),
            ),
          );
          const target = frame.targets[worker];
          if (target >= 0) {
            const xy = trace.larvae[target].xy;
            view.routes.add(
              new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(p[0] - size / 2, 0.6, p[1] - size / 2),
                  new THREE.Vector3(xy[0] - size / 2, 0.6, xy[1] - size / 2),
                ]),
                new THREE.LineBasicMaterial({
                  color: "#55b5aa",
                  transparent: true,
                  opacity: 0.5,
                }),
              ),
            );
          }
        }
        if (this.layers.sensing && trace.strategy.startsWith("local_")) {
          const radius = trace.global_sensing ? size * 2 : trace.sensing_radius;
          const points: XY[] = [];
          for (let x = 0; x < size; x++)
            for (let y = 0; y < size; y++)
              if (Math.abs(x - p[0]) + Math.abs(y - p[1]) <= radius)
                points.push([x, y]);
          const footprint = new THREE.InstancedMesh(
            new THREE.PlaneGeometry(0.93, 0.93),
            new THREE.MeshBasicMaterial({
              color: "#72c5b6",
              transparent: true,
              opacity: 0.16,
              side: THREE.DoubleSide,
            }),
            points.length,
          );
          points.forEach((xy, j) => {
            this.dummy.position.set(xy[0] - size / 2, 0.09, xy[1] - size / 2);
            this.dummy.rotation.set(-Math.PI / 2, 0, 0);
            this.dummy.scale.set(1, 1, 1);
            this.dummy.updateMatrix();
            footprint.setMatrixAt(j, this.dummy.matrix);
          });
          view.sensing.add(footprint);
        }
      }
      const columns = this.views.length === 4 ? 2 : 1,
        rows = columns,
        w = width / columns,
        h = height / rows,
        x = (i % columns) * w,
        y = height - (Math.floor(i / columns) + 1) * h;
      view.camera.aspect = w / h;
      view.camera.updateProjectionMatrix();
      if (i > 0) {
        view.camera.position.copy(this.views[0].camera.position);
        view.camera.quaternion.copy(this.views[0].camera.quaternion);
      }
      this.renderer!.setViewport(x, y, w, h);
      this.renderer!.setScissor(x, y, w, h);
      this.renderer!.render(view.scene, view.camera);
    });
    this.changed = false;
  }
  pick(clientX: number, clientY: number, tick: number): Entity | null {
    const rect = this.canvas.getBoundingClientRect(),
      columns = this.traces.length === 4 ? 2 : 1;
    const x = clientX - rect.left,
      y = clientY - rect.top,
      w = rect.width / columns,
      h = rect.height / columns;
    const index = Math.floor(y / h) * columns + Math.floor(x / w),
      trace = this.traces[index];
    if (!trace) return null;
    const f = trace.frames[Math.min(Math.floor(tick), trace.frames.length - 1)];
    if (!this.renderer) {
      const scale = (Math.min(w, h) * 0.83) / trace.grid_size;
      const gx = ((x % w) - w / 2) / scale + trace.grid_size / 2,
        gy = ((y % h) - h / 2) / scale + trace.grid_size / 2;
      const near = (p: XY) => Math.hypot(p[0] - gx, p[1] - gy) < 0.55;
      if (this.layers.wasps) {
        const i = f.positions.findIndex(near);
        if (i >= 0) return { kind: "worker", index: i, view: index };
      }
      if (this.layers.larvae) {
        const i = trace.larvae.findIndex((l) => near(l.xy));
        if (i >= 0) return { kind: "larva", index: i, view: index };
      }
      if (this.layers.structure) {
        const cells = [...trace.larvae.map(l => l.xy), ...trace.background_cells];
        const i = cells.findIndex(near);
        if (i >= 0) return {kind: "cell", index: i, view: index};
      }
      return null;
    }
    const view = this.views[index];
    this.ray.setFromCamera(
      new THREE.Vector2(((x % w) / w) * 2 - 1, (-(y % h) / h) * 2 + 1),
      view.camera,
    );
    const meshes: THREE.Object3D[] = [];
    if (this.layers.wasps) meshes.push(...view.wasps);
    if (this.layers.larvae) meshes.push(view.larvae);
    if (this.layers.structure) meshes.push(view.cells);
    const hits = this.ray.intersectObjects(meshes, false);
    const hit = hits.find((h) => h.object.userData.kind !== "cell") || hits[0];
    return hit && hit.instanceId !== undefined
      ? { kind: hit.object.userData.kind, index: hit.instanceId, view: index }
      : null;
  }
  topDown() {
    this.views.forEach((v) => {
      v.camera.position.set(0, v.trace.grid_size * 1.6 * Math.max(1, 1 / v.camera.aspect), 0.001);
      v.controls.target.set(0, 0, 0);
      v.controls.update();
    });
    this.changed = true;
  }
  reset() {
    this.views.forEach((v) => {
      // Portrait views need extra margin for the diagonal nest footprint.
      const fit = Math.max(1, 1 / v.camera.aspect) * (v.camera.aspect < 1 ? 1.15 : 1);
      v.camera.position.set(
        v.trace.grid_size * 0.85 * fit,
        v.trace.grid_size * 1.18 * fit,
        v.trace.grid_size * 1.1 * fit,
      );
      v.controls.target.set(0, 0, 0);
      v.controls.update();
    });
    this.changed = true;
  }
  private selectedXY(trace: Trace, frame: Frame, view: number): XY | null {
    const selected = this.selected;
    if (!selected || selected.view !== view) return null;
    if (selected.kind === "worker") return this.layers.wasps ? frame.positions[selected.index] : null;
    if (selected.kind === "larva") return this.layers.larvae ? trace.larvae[selected.index].xy : null;
    return this.layers.structure ? [...trace.larvae.map(l => l.xy), ...trace.background_cells][selected.index] : null;
  }
  private draw2d(tick: number) {
    const ctx = this.fallback;
    if (!ctx) return;
    const ratio = Math.min(devicePixelRatio, 1.5);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    ctx.fillStyle = "#20282b";
    ctx.fillRect(0, 0, width, height);
    const columns = this.traces.length === 4 ? 2 : 1;
    this.traces.forEach((trace, i) => {
      const frame =
          trace.frames[Math.min(Math.floor(tick), trace.frames.length - 1)],
        w = width / columns,
        h = height / columns,
        scale = (Math.min(w, h) * 0.83) / trace.grid_size;
      const project = (p: XY): XY => [
        (i % columns) * w + w / 2 + (p[0] - trace.grid_size / 2) * scale,
        Math.floor(i / columns) * h +
          h / 2 +
          (p[1] - trace.grid_size / 2) * scale,
      ];
      if (this.layers.structure) {
        ctx.strokeStyle = "#5e6e6b";
        ctx.globalAlpha = this.layers.opacity;
        for (const p of [
          ...trace.larvae.map((l) => l.xy),
          ...trace.background_cells,
        ]) {
          const xy = project(p);
          ctx.strokeRect(
            xy[0] - scale * 0.45,
            xy[1] - scale * 0.45,
            scale * 0.9,
            scale * 0.9,
          );
        }
        ctx.globalAlpha = 1;
      }
      if (this.selected?.view === i && this.selected.kind === "worker") {
        const worker = this.selected.index,
          p = frame.positions[worker];
        if (this.layers.sensing && trace.strategy.startsWith("local_")) {
          ctx.fillStyle = "#4b9e9355";
          for (let x = 0; x < trace.grid_size; x++)
            for (let y = 0; y < trace.grid_size; y++)
              if (
                Math.abs(x - p[0]) + Math.abs(y - p[1]) <=
                (trace.global_sensing ? trace.grid_size * 2 : 3)
              ) {
                const q = project([x, y]);
                ctx.fillRect(q[0] - scale / 2, q[1] - scale / 2, scale, scale);
              }
        }
        if (this.layers.routes) {
          ctx.strokeStyle = "#e2b447";
          ctx.beginPath();
          trace.frames
            .slice(Math.max(0, frame.tick - 30), frame.tick + 1)
            .forEach((f, j) => {
              const q = project(f.positions[worker]);
              j ? ctx.lineTo(...q) : ctx.moveTo(...q);
            });
          ctx.stroke();
        }
      }
      if (this.layers.larvae)
        trace.larvae.forEach((l, j) => {
          const p = project(l.xy),
            fed = frame.first_feed[j] >= 0;
          const radius = {L1: .16, L2: .23, L3: .29}[l.stage] || .2;
          ctx.fillStyle = fed ? "#51b5a1" : `#${amber.clone().lerp(new THREE.Color("#c35f42"), l.hunger).getHexString()}`;
          ctx.beginPath();
          ctx.ellipse(
            ...p,
            scale * radius,
            scale * radius * (fed ? .5 : 1.3),
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        });
      if (this.layers.wasps)
        frame.positions.forEach((p) => {
          const xy = project(p);
          ctx.fillStyle = "#e7b650";
          ctx.fillRect(
            xy[0] - scale * 0.2,
            xy[1] - scale * 0.12,
            scale * 0.4,
            scale * 0.24,
          );
        });
      const selectedXY = this.selectedXY(trace, frame, i);
      if (selectedXY) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(...project(selectedXY), scale * .49, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    });
    this.changed = false;
  }
}
