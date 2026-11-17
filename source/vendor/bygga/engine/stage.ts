import * as THREE from "three";
import type { HwItem, PartItem, PartState, PartType, Plan, Step, Vec3 } from "@bygga/lib/types";
import { POSE_EULER } from "@bygga/lib/plan/math";
import { Drawable, hwDrawable, partDrawable, wallDrawable } from "./drawable";
import { INK, INK_MUTED, INK_OLD, STROKE_WIDTH, STROKE_WIDTH_ACTIVE } from "./materials";

/** Part names can come from a shared scan link: never let them through as markup. */
const esc = (t: string) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type StageMode =
  | { kind: "intro"; dims?: boolean }
  | { kind: "assembled"; turntable?: boolean; dims?: boolean; view?: { az: number; el: number }; frame?: Vec3[] }
  | { kind: "layout" }
  | {
      kind: "step";
      index: number;
      /** Prefer PDF-like angle for this beat (radians). */
      view?: { az: number; el: number };
      /** Extra orthographic zoom-in (>1 tighter). Default ~1.08 when focusing active parts. */
      tight?: number;
    }
  | {
      kind: "part";
      ref: string;
      /** Optional chip text (e.g. IKEA part number). */
      label?: string;
      /** Optional subtitle under the chip (e.g. “Wall screw”). */
      title?: string;
    };

export interface StageOptions {
  callout?: boolean;
  interactive?: boolean;
  labels?: boolean;
  offscreen?: boolean;
  loop?: boolean;
  /** Playback rate for step clock + pose/camera (1 = constants as authored; 0.5 ≈ 2× longer). */
  speed?: number;
  onIntroDone?: () => void;
  onHover?: (ref: string | null) => void;
  onUserView?: (changed: boolean) => void;
  margins?: { t: number; r: number; b: number; l: number };
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 4);
/** Parts coming in: quick to start, then a long soft landing with no visible stop. */
const easeLand = (x: number) => 1 - Math.pow(1 - x, 3);
/** Slightly softer than stock cubic — longer ease-out for slower class-demo pacing. */
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/**
 * How long turning the model over takes.
 * Demo: ~1.7× longer than upstream Bygga (further stretched by Stage.speed).
 */
const poseDur = (angle: number) => Math.min(2.1, Math.max(1.05, 0.8 + angle * 0.55));

/** Keep in sync with PlanBuilder DUR — demo lengths (~1.7× upstream). */
const PART_DUR = 1.6;
const HW_DUR = 1.05;
const CAM_TURN = 1.1;
const HOLD = 3.6;
const FADE = 0.55;
/** Mode-change blend for parts caught mid-move (was 0.42s). */
const CARRY_DUR = 0.85;
/** Camera follow / auto-reset rates (lower = slower ease, was ~5 / ~4). */
const CAM_FOLLOW = 2.4;
const CAM_RESET = 2.0;

interface PNode {
  item: PartItem;
  type: PartType;
  d: Drawable;
  node: THREE.Group;
  corners: THREE.Vector3[]; // local box corners
}
interface HNode {
  item: HwItem;
  d: Drawable;
  holder: THREE.Group;
  inner: THREE.Group;
  parent?: PNode;
}

/** Solo hardware hero for part-number / missing-fitting questions. */
interface HwFocus {
  ref: string;
  d: Drawable;
  node: THREE.Group;
  label: string;
  name: string;
}

interface Xf {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

function quatFromEuler(e: Vec3) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], "XYZ"));
}

export class Stage {
  el: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 40000);
  root = new THREE.Group();
  plan: Plan | null = null;
  parts: PNode[] = [];
  hws: HNode[] = [];
  byKey = new Map<string, PNode>();
  mode: StageMode = { kind: "assembled" };
  opts: StageOptions;

  // overlay
  overlay?: SVGSVGElement;
  labelLayer?: HTMLDivElement;
  tooltip?: HTMLDivElement;
  callout?: {
    wrap: HTMLDivElement;
    renderer: THREE.WebGLRenderer;
    camera: THREE.OrthographicCamera;
    svg: SVGSVGElement;
    size: number;
    visible: number;
  };
  leader?: SVGPathElement;
  leaderDot?: SVGCircleElement;
  arrows: SVGPathElement[] = [];
  labels = new Map<string, HTMLDivElement>();
  squareEls: SVGElement[] = [];
  dimsEl?: SVGGElement;

  // view state
  w = 1;
  h = 1;
  az = 0.62;
  el0 = 0.46;
  userAz = 0;
  userEl = 0;
  userZoom = 1;
  dragging = false;
  autoReset = true;
  camTarget = new THREE.Vector3();
  camHalf = 1000;
  camReady = false;
  /** Frozen ortho framing while the user orbits — no re-fit zoom/dolly. */
  private orbitHalf: number | null = null;
  private orbitTarget: THREE.Vector3 | null = null;
  /** the view's own angles, gliding toward what the mode asks for, so a change of view never cuts */
  camAz = 0.62;
  camEl = 0.46;
  /** seconds the turntable has been turning, so it starts from still instead of wherever the clock was */
  turnT = 0;
  rootQ = new THREE.Quaternion();
  rootReady = false;
  /** turning the model over between steps: a timed glide from where it was, so it starts and stops softly */
  poseFrom = new THREE.Quaternion();
  poseTo = new THREE.Quaternion();
  poseT = 1;
  poseDur = 0.8;
  /** where each part and fitting was when the mode changed, so nothing caught mid-move jumps into place */
  carry = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();
  carryT = 1;
  t = 0;
  last = 0;
  raf = 0;
  speed = 1;
  paused = false;
  stepEnd = 0;
  loopCount = 0;
  highlight: Set<string> | null = null;
  hovered: string | null = null;
  wall?: { d: Drawable; node: THREE.Group; on: number };
  /** Focused hardware mesh when mode is `{ kind: "part", ref: hwId }`. */
  hwFocus: HwFocus | null = null;
  /** Kept for API compatibility; hidden — demo uses clean line-art (no floor shadow). */
  shadow: THREE.Mesh | null = null;
  disposed = false;
  visible = true;
  introDone = false;
  private io?: IntersectionObserver;
  private ro?: ResizeObserver;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch0 = 0;
  private zoom0 = 1;
  private downAt = { x: 0, y: 0, t: 0 };
  private extents = new Map<string, THREE.Vector3[]>();
  private typeFirst = new Map<string, number>();
  private frameLocal: THREE.Vector3[] = [];
  private stack = new Map<string, Xf>();
  private layout = new Map<string, Xf>();
  private focus?: { local: THREE.Vector3; dir: THREE.Vector3; size: number; hw: HNode };
  /** How many fittings the step's corner box lists (it sits over the top left of the drawing). */
  private cornerItems = 0;
  margins?: { t: number; r: number; b: number; l: number };

  constructor(el: HTMLElement, opts: StageOptions = {}) {
    this.el = el;
    this.opts = opts;
    if (opts.speed != null && Number.isFinite(opts.speed) && opts.speed > 0) this.speed = opts.speed;
    // a handle for checking motion by hand in development
    if (!opts.offscreen) (window as unknown as { __stage?: Stage }).__stage = this;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!opts.offscreen });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // Opaque white paper — transparent clear made empty part-focus stages look black.
    this.renderer.setClearColor(0xffffff, 1);
    const c = this.renderer.domElement;
    c.className = "stage-canvas";
    el.appendChild(c);
    this.scene.add(this.root);
    // No floor/scene shadow — cleaner line-art for the class demo.

    if (!opts.offscreen) {
      const ns = "http://www.w3.org/2000/svg";
      this.overlay = document.createElementNS(ns, "svg") as SVGSVGElement;
      this.overlay.setAttribute("class", "stage-overlay");
      el.appendChild(this.overlay);
      if (opts.labels !== false) {
        this.labelLayer = document.createElement("div");
        this.labelLayer.className = "stage-labels";
        el.appendChild(this.labelLayer);
      }
      if (opts.callout) this.makeCallout();
      if (opts.interactive) this.bindPointer();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(el);
      this.io = new IntersectionObserver((e) => {
        this.visible = e[0]?.isIntersecting ?? true;
      });
      this.io.observe(el);
      this.resize();
      this.last = performance.now();
      const loop = (now: number) => {
        if (this.disposed) return;
        this.raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        if (!this.visible || document.hidden) return;
        this.tick(dt);
        this.render();
      };
      this.raf = requestAnimationFrame(loop);
      // Some embedded webviews pause rAF while still reporting the page as visible: keep a slow fallback clock.
      this.fallback = window.setInterval(() => {
        const now = performance.now();
        if (this.disposed || document.hidden || now - this.last < 120) return;
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.tick(dt);
        this.render();
      }, 40);
    }
  }
  private fallback = 0;
  private frameDt = 1 / 60;
  /** where each part starts and ends in the step being shown, worked out once per step instead of every frame */
  private stepXf = new Map<PNode, { st: PartState; prev: PartState | null; fin: Xf; from: Xf | null; off: THREE.Vector3 }>();
  private finalXf = new Map<PNode, Xf>();

  /* ---------------- setup ---------------- */

  private makeCallout() {
    const wrap = document.createElement("div");
    wrap.className = "stage-callout";
    wrap.style.opacity = "0";
    wrap.style.visibility = "hidden";
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xffffff, 1);
    wrap.appendChild(renderer.domElement);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg") as SVGSVGElement;
    svg.setAttribute("class", "stage-callout-svg");
    wrap.appendChild(svg);
    this.el.appendChild(wrap);
    this.callout = { wrap, renderer, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000), svg, size: 200, visible: 0 };
    this.leader = document.createElementNS(ns, "path") as SVGPathElement;
    this.leader.setAttribute("class", "leader");
    this.leaderDot = document.createElementNS(ns, "circle") as SVGCircleElement;
    this.leaderDot.setAttribute("class", "leader-dot");
    this.leaderDot.setAttribute("r", "4");
    this.overlay!.appendChild(this.leader);
    this.overlay!.appendChild(this.leaderDot);
  }

  resize(w?: number, h?: number) {
    if (w && h) {
      this.w = w;
      this.h = h;
    } else {
      const r = this.el.getBoundingClientRect();
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
    }
    this.renderer.setSize(this.w, this.h, false);
    if (this.callout) {
      const size = Math.round(Math.min(220, Math.max(120, Math.min(this.w, this.h) * 0.34)));
      this.callout.size = size;
      this.callout.renderer.setSize(size, size, false);
      this.callout.wrap.style.width = this.callout.wrap.style.height = size + "px";
    }
  }

  setPlan(plan: Plan) {
    if (this.plan === plan) return;
    this.clear();
    this.plan = plan;
    const types = new Map(plan.parts.map((p) => [p.id, p]));
    for (const it of plan.items) {
      if (it.kind !== "part") continue;
      const type = types.get(it.ref);
      if (!type) continue;
      const d = partDrawable(type, it.holes);
      const node = new THREE.Group();
      node.add(d.root);
      node.userData.key = it.key;
      d.meshes.forEach((m) => (m.userData.ref = it.ref));
      this.root.add(node);
      const [sx, sy, sz] = type.size;
      const corners: THREE.Vector3[] = [];
      for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) corners.push(new THREE.Vector3((a * sx) / 2, (b * sy) / 2, (c * sz) / 2));
      const pn: PNode = { item: it, type, d, node, corners };
      this.parts.push(pn);
      this.byKey.set(it.key, pn);
    }
    const hwTypes = new Map(plan.hardware.map((h) => [h.id, h]));
    for (const it of plan.items) {
      if (it.kind !== "hw") continue;
      const ht = hwTypes.get(it.ref)!;
      const d = hwDrawable(ht.kind, ht.len, ht.dia);
      const holder = new THREE.Group();
      const inner = new THREE.Group();
      holder.add(inner);
      inner.add(d.root);
      holder.position.set(...it.pos);
      const dir = new THREE.Vector3(...it.dir).normalize();
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      if (it.twist) holder.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, it.twist));
      const parent = it.parent ? this.byKey.get(it.parent) : undefined;
      (parent ? parent.node : this.root).add(holder);
      d.meshes.forEach((m) => (m.userData.ref = it.ref));
      this.hws.push({ item: it, d, holder, inner, parent });
    }
    this.computeExtents();
    this.computeArrangements();
    this.finalXf.clear();
    for (const p of this.parts) this.finalXf.set(p, { p: new THREE.Vector3(...p.item.final.pos), q: quatFromEuler(p.item.final.rot) });
    this.typeFirst.clear();
    this.introOrderCache.clear();
    for (const p of this.parts) {
      const f = Math.min(...p.item.states.map((x) => x.step));
      this.typeFirst.set(p.type.id, Math.min(this.typeFirst.get(p.type.id) ?? 1e9, f));
    }
    this.camReady = false;
    this.rootReady = false;
  }

  private clearHwFocus() {
    if (!this.hwFocus) return;
    this.root.remove(this.hwFocus.node);
    disposeDrawable(this.hwFocus.d);
    this.hwFocus = null;
  }

  private clear() {
    this.stepXf.clear();
    this.finalXf.clear();
    this.clearHwFocus();
    for (const p of this.parts) {
      this.root.remove(p.node);
      disposeDrawable(p.d);
    }
    for (const h of this.hws) disposeDrawable(h.d);
    this.root.clear();
    this.parts = [];
    this.hws = [];
    this.byKey.clear();
    this.labels.forEach((l) => l.remove());
    this.labels.clear();
    this.arrows.forEach((a) => a.remove());
    this.arrows = [];
    if (this.wall) {
      this.wall.node.removeFromParent();
      disposeDrawable(this.wall.d);
      this.wall = undefined;
    }
  }

  private stateAt(p: PNode, s: number) {
    let st = null;
    let prev = null;
    for (const x of p.item.states) {
      if (x.step <= s) {
        prev = st;
        st = x;
      }
    }
    return { st, prev };
  }

  private corners(p: PNode, pos: Vec3, rot: Vec3) {
    const q = quatFromEuler(rot);
    const o = new THREE.Vector3(...pos);
    return p.corners.map((c) => c.clone().applyQuaternion(q).add(o));
  }

  private computeExtents() {
    const m = new Map<string, THREE.Vector3[]>();
    for (const p of this.parts) {
      for (const s of p.item.states) {
        const arr = m.get(s.scene) ?? [];
        arr.push(...this.corners(p, s.pos, s.rot));
        m.set(s.scene, arr);
      }
      const fin = m.get("final") ?? [];
      fin.push(...this.corners(p, p.item.final.pos, p.item.final.rot));
      m.set("final", fin);
    }
    this.extents = m;
  }

  private flatQuat(t: PartType) {
    const s = t.size;
    const idx = [0, 1, 2];
    const mi = idx.reduce((a, b) => (s[b] < s[a] ? b : a));
    const rest = idx.filter((i) => i !== mi);
    const Mi = s[rest[0]] >= s[rest[1]] ? rest[0] : rest[1];
    const ki = rest.find((i) => i !== Mi)!;
    const cols: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    cols[mi].set(0, 1, 0);
    cols[Mi].set(1, 0, 0);
    cols[ki].set(0, 0, 1);
    const m = new THREE.Matrix4().makeBasis(cols[0], cols[1], cols[2]);
    if (m.determinant() < 0) {
      cols[ki].set(0, 0, -1);
      m.makeBasis(cols[0], cols[1], cols[2]);
    }
    return { q: new THREE.Quaternion().setFromRotationMatrix(m), thick: s[mi], long: s[Mi], wide: s[ki] };
  }

  private computeArrangements() {
    this.stack.clear();
    this.layout.clear();
    const items = this.parts.filter((p) => !p.type.extra);
    // stack: biggest at the bottom
    const sorted = [...items].sort((a, b) => b.type.size[0] * b.type.size[2] + b.type.size[0] * b.type.size[1] - (a.type.size[0] * a.type.size[2] + a.type.size[0] * a.type.size[1]));
    let y = 0;
    const fq = new Map<string, ReturnType<Stage["flatQuat"]>>();
    for (const p of sorted) {
      const f = this.flatQuat(p.type);
      fq.set(p.item.key, f);
      this.stack.set(p.item.key, { p: new THREE.Vector3(0, y + f.thick / 2, 0), q: f.q });
      y += f.thick + 3;
    }
    // layout: grouped by label, rows
    const byType = [...items].sort((a, b) => a.type.label.localeCompare(b.type.label));
    const area = byType.reduce((s, p) => s + fq.get(p.item.key)!.long * fq.get(p.item.key)!.wide, 0);
    const maxLong = Math.max(...byType.map((p) => fq.get(p.item.key)!.long), 1);
    const rowW = Math.max(maxLong, Math.sqrt(area) * 1.7);
    let x = 0, z = 0, rowD = 0;
    const gap = Math.max(50, maxLong * 0.05);
    const placed: { key: string; x: number; z: number; f: ReturnType<Stage["flatQuat"]> }[] = [];
    for (const p of byType) {
      const f = fq.get(p.item.key)!;
      if (x > 0 && x + f.long > rowW) {
        x = 0;
        z += rowD + gap * 1.6;
        rowD = 0;
      }
      placed.push({ key: p.item.key, x: x + f.long / 2, z: z + f.wide / 2, f });
      x += f.long + gap;
      rowD = Math.max(rowD, f.wide);
    }
    const mx = Math.max(...placed.map((p) => p.x + p.f.long / 2));
    const mz = Math.max(...placed.map((p) => p.z + p.f.wide / 2));
    for (const p of placed) this.layout.set(p.key, { p: new THREE.Vector3(p.x - mx / 2, p.f.thick / 2, p.z - mz / 2), q: p.f.q });
  }

  /* ---------------- modes ---------------- */

  setMode(mode: StageMode, o: { instant?: boolean } = {}) {
    const prev = this.mode;
    const poseBefore = this.targetPoseQ();
    this.carry.clear();
    if (!o.instant && this.rootReady) {
      for (const p of this.parts) if (p.node.visible) this.carry.set(p.node, { p: p.node.position.clone(), q: p.node.quaternion.clone() });
      for (const h of this.hws) if (h.holder.visible) this.carry.set(h.inner, { p: h.inner.position.clone(), q: h.inner.quaternion.clone() });
      this.carryT = 0;
    }
    this.mode = mode;
    this.t = o.instant ? 999 : 0;
    // when the model turns over for this step, its parts wait until it has nearly finished turning
    if (!o.instant && this.rootReady) {
      const turn = poseBefore.angleTo(this.targetPoseQ());
      if (turn > 0.1) this.t = -Math.min(1.35, poseDur(turn) * 0.75);
    }
    this.loopCount = 0;
    this.autoReset = true;
    this.orbitHalf = null;
    this.orbitTarget = null;
    this.introDone = mode.kind !== "intro";
    if (!(prev.kind === "assembled" && mode.kind === "assembled" && prev.turntable && mode.turntable)) this.turnT = 0;
    if (prev.kind === "step" && mode.kind === "step" && this.plan) {
      const a = this.plan.steps[prev.index]?.scene;
      const b = this.plan.steps[mode.index]?.scene;
      if (a !== b) this.flash();
    } else if (prev.kind !== mode.kind && !o.instant && !(prev.kind === "intro" && mode.kind === "assembled")) this.flash();
    this.prepareMode();
    if (o.instant) {
      this.camReady = false;
      this.rootReady = false;
      this.tick(0);
    }
  }

  replay() {
    this.t = 0;
    this.loopCount = 0;
  }

  setPaused(p: boolean) {
    this.paused = p;
  }
  setSpeed(s: number) {
    this.speed = s;
  }

  setHighlight(refs: string[] | null) {
    this.highlight = refs && refs.length ? new Set(refs) : null;
  }

  resetView() {
    this.autoReset = true;
    this.orbitHalf = null;
    this.orbitTarget = null;
    this.opts.onUserView?.(false);
  }

  private flash() {
    const c = this.renderer.domElement;
    // a soft dip rather than a blink: enough to hide parts changing places, never a flash of empty paper
    const ms = Math.round(820 / Math.max(0.35, this.speed));
    c.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: ms, easing: "cubic-bezier(.22,1,.36,1)" });
  }

  get step(): Step | null {
    if (this.mode.kind !== "step" || !this.plan) return null;
    return this.plan.steps[this.mode.index] ?? null;
  }

  private prepareMode() {
    const plan = this.plan;
    if (!plan) return;
    this.focus = undefined;
    this.frameLocal = [];
    this.cornerItems = 0;
    this.stepXf.clear();
    this.clearHwFocus();
    const m = this.mode;
    if (m.kind === "step") {
      const s = m.index;
      const step = plan.steps[s];
      let end = 0;
      const active: THREE.Vector3[] = [];
      const placed: THREE.Vector3[] = [];
      const hostKeys = new Set<string>();
      for (const h of this.hws) {
        if (h.item.step === s && h.parent) hostKeys.add(h.parent.item.key);
      }
      for (const p of this.parts) {
        const { st, prev } = this.stateAt(p, s);
        if (!st || st.scene !== step.scene) continue;
        const moves = st.step === s && prev && prev.scene === st.scene;
        this.stepXf.set(p, {
          st,
          prev,
          fin: { p: new THREE.Vector3(...st.pos), q: quatFromEuler(st.rot) },
          from: moves ? { p: new THREE.Vector3(...prev.pos), q: quatFromEuler(prev.rot) } : null,
          off: st.from ? new THREE.Vector3(...st.from) : new THREE.Vector3(),
        });
        const finCorners = this.corners(p, st.pos, st.rot);
        placed.push(...finCorners);
        // Frame settled art only — approach offsets (often 500mm+) blow out the zoom.
        const isActive = st.step === s || hostKeys.has(p.item.key);
        if (isActive) active.push(...finCorners);
        if (st.step === s) end = Math.max(end, st.delay + PART_DUR + (st.spin ? 0.4 : 0));
      }
      let first: HNode | undefined;
      for (const h of this.hws) {
        if (h.item.step !== s) continue;
        const dur = HW_DUR + (h.item.turn ? CAM_TURN : 0);
        end = Math.max(end, h.item.delay + dur);
        if (h.item.travel > 0 && (!first || h.item.delay < first.item.delay)) first = h;
        // Seat point only (tiny pad) — not the full travel path.
        const at = new THREE.Vector3(...h.item.pos);
        if (h.parent) {
          const { st } = this.stateAt(h.parent, s);
          if (st) {
            const q = quatFromEuler(st.rot);
            at.applyQuaternion(q).add(new THREE.Vector3(...st.pos));
          }
        }
        if (!hostKeys.size) {
          active.push(at.clone().add(new THREE.Vector3(18, 18, 18)), at.clone().add(new THREE.Vector3(-18, -18, -18)));
        }
      }
      // PDF-like close-up: active settled parts fill most of the stage.
      this.frameLocal = this.padFrame(active.length ? active : placed, 0.06);
      this.stepEnd = Math.max(end, 0.6);
      this.cornerItems = Math.min(4, new Set(this.hws.filter((h) => h.item.step === s && !h.item.preset).map((h) => h.item.ref)).size);
      if (first && this.callout) {
        const loc = new THREE.Vector3(...first.item.pos);
        const dir = new THREE.Vector3(...first.item.dir).normalize();
        if (first.parent) {
          const { st } = this.stateAt(first.parent, s);
          if (st) {
            const q = quatFromEuler(st.rot);
            loc.applyQuaternion(q).add(new THREE.Vector3(...st.pos));
            dir.applyQuaternion(q);
          }
        }
        const ht = plan.hardware.find((x) => x.id === first!.item.ref)!;
        const size =
          ht.kind === "runner" ? 55 : ht.kind === "hinge" ? 55 : ht.kind === "bracket" ? 50 : ht.kind === "plate" ? 55 : ht.kind === "knob" || ht.kind === "handle" ? 50 : Math.max(17, Math.min(55, Math.max(ht.len, ht.dia * 2) * 0.72));
        this.focus = { local: loc, dir, size, hw: first };
      }
      // wall
      if (step.wall) this.ensureWall();
      if (step.check === "square") this.ensureSquare();
    } else if (m.kind === "intro") {
      this.frameLocal = [...(this.extents.get("final") ?? [])];
      for (const [k, xf] of this.stack) {
        const p = this.byKey.get(k)!;
        this.frameLocal.push(...p.corners.map((c) => c.clone().applyQuaternion(xf.q).add(xf.p)));
      }
      this.stepEnd = 0.3 + this.parts.length * this.introGap() + PART_DUR + 0.6;
    } else if (m.kind === "assembled") {
      this.frameLocal = [...(this.extents.get("final") ?? [])];
      for (const f of m.frame ?? []) this.frameLocal.push(new THREE.Vector3(...f));
    } else if (m.kind === "layout") {
      for (const [k, xf] of this.layout) {
        const p = this.byKey.get(k)!;
        this.frameLocal.push(...p.corners.map((c) => c.clone().applyQuaternion(xf.q).add(xf.p)));
      }
    } else if (m.kind === "part") {
      const p = this.parts.find((x) => x.item.ref === m.ref);
      if (p) {
        this.frameLocal = p.corners.map((c) => c.clone());
      } else {
        const ht = plan.hardware.find((x) => x.id === m.ref);
        if (ht) {
          const d = hwDrawable(ht.kind, ht.len, ht.dia);
          const node = new THREE.Group();
          node.add(d.root);
          // Manual parts-list scale: enlarge small fittings so they fill the stage.
          const span = Math.max(ht.len, ht.dia * 2, 8);
          const hero = Math.max(3.2, Math.min(9, 140 / span));
          node.scale.setScalar(hero);
          // Tip slightly toward camera so threads / head read clearly.
          node.rotation.x = -0.55;
          node.rotation.z = 0.35;
          this.root.add(node);
          this.hwFocus = {
            ref: ht.id,
            d,
            node,
            label: ht.id,
            name: ht.name,
          };
          const r = Math.max(48, span * hero * 0.55);
          this.frameLocal = this.padFrame(
            [new THREE.Vector3(-r, -r, -r), new THREE.Vector3(r, r, r)],
            0.1,
          );
          this.stepEnd = 0.35;
          // Line materials need the canvas resolution immediately.
          for (const l of d.lines) l.resolution.set(this.w, this.h);
          for (const l of d.thin) l.resolution.set(this.w, this.h);
          for (const hm of d.hulls) hm.uniforms.uRes.value.set(this.w, this.h);
        }
      }
    }
  }

  private introGap() {
    return Math.min(0.14, 2.0 / Math.max(1, this.parts.length));
  }

  /** Expand a local-space frame by a fraction of its size so parts aren't edge-clipped. */
  private padFrame(pts: THREE.Vector3[], frac: number) {
    if (pts.length < 2) return pts;
    const box = new THREE.Box3().setFromPoints(pts);
    const size = new THREE.Vector3();
    box.getSize(size);
    const pad = Math.max(12, Math.max(size.x, size.y, size.z) * frac);
    box.expandByScalar(pad);
    return [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];
  }

  private ensureWall() {
    if (this.wall) return;
    const fin = this.extents.get("final") ?? [];
    const box = new THREE.Box3().setFromPoints(fin);
    const w = box.max.x - box.min.x + 700;
    const h = box.max.y + 420;
    const d = wallDrawable(w, h);
    const node = new THREE.Group();
    node.add(d.root);
    node.position.set((box.min.x + box.max.x) / 2, h / 2, box.min.z - 20);
    this.root.add(node);
    for (const l of d.lines) l.color.copy(INK_OLD);
    this.wall = { d, node, on: 0 };
  }

  private ensureSquare() {
    if (!this.overlay || this.squareEls.length) return;
    const ns = "http://www.w3.org/2000/svg";
    for (let i = 0; i < 2; i++) {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("class", "diag");
      this.overlay.appendChild(p);
      this.squareEls.push(p);
    }
    const eq = document.createElementNS(ns, "g");
    eq.setAttribute("class", "diag-eq");
    eq.innerHTML = '<circle r="17"></circle><path d="M-7 -3.5 H7 M-7 3.5 H7"></path>';
    this.overlay.appendChild(eq);
    this.squareEls.push(eq);
  }

  /* ---------------- per frame ---------------- */

  tick(dt: number) {
    if (!this.plan) return;
    // One motion clock for step inserts, pose flips, carry blends, and camera ease.
    const mdt = dt * this.speed;
    if (!this.paused) this.t += mdt;
    this.turnT += mdt;
    const m = this.mode;
    if (m.kind === "step" && this.opts.loop !== false) {
      const cycle = this.stepEnd + HOLD + FADE;
      if (this.t > cycle) {
        this.t = 0;
        this.loopCount++;
      }
    } else if (m.kind === "step" && this.opts.loop === false) {
      // Settle after the beat plays once — no replay fade/bob.
      const settle = this.stepEnd + Math.min(0.8, HOLD * 0.25);
      if (this.t > settle) this.t = settle;
    }
    if (m.kind === "intro" && !this.introDone && this.t > this.stepEnd) {
      this.introDone = true;
      this.opts.onIntroDone?.();
      this.mode = { kind: "assembled", turntable: false, dims: m.kind === "intro" && !!m.dims };
      this.t = 0;
      this.turnT = 0;
      this.prepareMode();
    }
    this.frameDt = mdt;
    if (this.carryT < 1) this.carryT = mdt === 0 && dt === 0 ? 1 : Math.min(1, this.carryT + mdt / CARRY_DUR);
    this.updateRoot(mdt);
    this.updateItems();
    if (this.carryT < 1) this.blendCarry();
    this.updateCamera(mdt);
  }

  private targetPoseQ() {
    const st = this.step;
    if (st) return quatFromEuler(POSE_EULER[st.pose]);
    return new THREE.Quaternion();
  }

  private sceneName() {
    const st = this.step;
    if (st) return st.scene === "main" ? "final" : st.scene;
    return "final";
  }

  private updateRoot(dt: number) {
    const q = this.targetPoseQ();
    if (!this.rootReady || dt === 0) {
      this.rootQ.copy(q);
      this.poseTo.copy(q);
      this.poseT = 1;
      this.rootReady = true;
    } else {
      if (this.poseTo.angleTo(q) > 1e-4) {
        this.poseFrom.copy(this.rootQ);
        this.poseTo.copy(q);
        this.poseT = 0;
        this.poseDur = poseDur(this.poseFrom.angleTo(q));
      }
      if (this.poseT < 1) {
        this.poseT = Math.min(1, this.poseT + dt / this.poseDur);
        this.rootQ.slerpQuaternions(this.poseFrom, this.poseTo, easeInOut(this.poseT));
      } else this.rootQ.copy(q);
    }
    this.root.quaternion.copy(this.rootQ);
    // ground and centre
    const pts = this.extents.get(this.sceneName()) ?? [];
    if (!pts.length) return;
    let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of pts) {
      tmpV.copy(c).applyQuaternion(this.rootQ);
      minY = Math.min(minY, tmpV.y);
      minX = Math.min(minX, tmpV.x);
      maxX = Math.max(maxX, tmpV.x);
      minZ = Math.min(minZ, tmpV.z);
      maxZ = Math.max(maxZ, tmpV.z);
    }
    if (this.mode.kind === "layout" || this.mode.kind === "intro") minY = 0;
    this.root.position.set(-(minX + maxX) / 2, -minY, -(minZ + maxZ) / 2);
    if (this.mode.kind === "layout" || this.mode.kind === "intro" || this.mode.kind === "part") this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
  }

  private styleDrawable(d: Drawable, o: { opacity: number; active?: boolean }) {
    // PDF-plain faces; strokes: thin grey default, black when active (never yellow).
    d.opacity = o.opacity;
    for (const f of d.faces) {
      f.uniforms.uOpacity.value = o.opacity;
      f.uniforms.uTintAmt.value = 0;
      f.depthWrite = o.opacity > 0.05;
    }
    const isActive = o.active === true;
    const col = isActive ? INK : INK_MUTED;
    const base = isActive ? STROKE_WIDTH_ACTIVE : STROKE_WIDTH;
    const lw = this.opts.offscreen ? base * 1.1 : base;
    for (const l of d.lines) {
      l.color.copy(col);
      l.opacity = o.opacity;
      l.linewidth = lw;
    }
    for (const l of d.thin) {
      l.color.copy(col);
      l.opacity = o.opacity * 0.9;
      l.linewidth = Math.max(0.55, lw * 0.7);
    }
    for (const hm of d.hulls) {
      hm.uniforms.uColor.value.copy(col);
      hm.uniforms.uOpacity.value = o.opacity;
      hm.uniforms.uWidth.value = lw * 0.9;
    }
  }

  private updateItems() {
    const m = this.mode;
    const t = this.t;
    const step = this.step;
    const sIdx = m.kind === "step" ? m.index : -1;
    const scene = step?.scene ?? "main";
    const loops = this.opts.loop !== false;
    const fadeOut = loops && m.kind === "step" && t > this.stepEnd + HOLD ? 1 - clamp01((t - this.stepEnd - HOLD) / FADE) : 1;
    const hl = this.highlight;

    const visibleParts = new Set<PNode>();
    for (const p of this.parts) {
      const node = p.node;
      const ref = p.item.ref;
      const lit = hl?.has(ref) ?? false;
      if (m.kind === "step") {
        const x = this.stepXf.get(p);
        if (!x) {
          node.visible = false;
          continue;
        }
        const { st, fin } = x;
        node.visible = true;
        visibleParts.add(p);
        const isNew = st.step === sIdx;
        if (isNew) {
          const k = clamp01((t - st.delay) / (PART_DUR + (st.spin ? 0.4 : 0)));
          const e = easeLand(k);
          let op = easeOut(clamp01((t - st.delay) / 0.3)) * fadeOut;
          if (x.from) {
            node.position.lerpVectors(x.from.p, fin.p, easeInOut(k));
            node.quaternion.slerpQuaternions(x.from.q, fin.q, easeInOut(k));
            op = 1;
          } else {
            node.position.copy(fin.p).addScaledVector(x.off, 1 - e);
            node.quaternion.copy(fin.q);
            if (st.spin) {
              tmpQ.setFromAxisAngle(Y, -(1 - e) * st.spin * Math.PI * 2);
              node.quaternion.multiply(tmpQ);
            }
          }
          this.styleDrawable(p.d, { opacity: op, active: true });
        } else {
          node.position.copy(fin.p);
          node.quaternion.copy(fin.q);
          this.styleDrawable(p.d, { opacity: 1, active: false });
        }
      } else if (m.kind === "intro") {
        node.visible = true;
        visibleParts.add(p);
        const order = this.introOrder(p);
        const gap = this.introGap();
        const delay = 0.3 + order * gap;
        const k = clamp01((t - delay) / PART_DUR);
        const e = easeInOut(k);
        const a = this.stack.get(p.item.key);
        const fin = this.finalXf.get(p)!;
        if (a) {
          node.position.lerpVectors(a.p, fin.p, e);
          node.position.y += Math.sin(Math.PI * e) * 260;
          node.quaternion.slerpQuaternions(a.q, fin.q, e);
          this.styleDrawable(p.d, { opacity: 1, active: true });
        } else {
          node.position.copy(fin.p);
          node.position.y += 400 * (1 - easeOut(k));
          node.quaternion.copy(fin.q);
          this.styleDrawable(p.d, { opacity: clamp01((t - delay) / 0.3), active: true });
        }
      } else if (m.kind === "layout") {
        const a = this.layout.get(p.item.key);
        if (!a) {
          node.visible = false;
          continue;
        }
        node.visible = true;
        visibleParts.add(p);
        node.position.copy(a.p);
        node.quaternion.copy(a.q);
        // Parts overview: thin grey default; black only when a part is focused.
        this.styleDrawable(p.d, { opacity: 1, active: Boolean(hl && lit) });
      } else if (m.kind === "part") {
        // Board letter focus — or hide all boards when focusing a fitting.
        const first = this.parts.find((x) => x.item.ref === m.ref);
        node.visible = first === p;
        if (first === p) {
          visibleParts.add(p);
          node.position.set(0, 0, 0);
          node.quaternion.identity();
          this.styleDrawable(p.d, { opacity: 1, active: true });
        }
      } else {
        node.visible = true;
        visibleParts.add(p);
        const fin = this.finalXf.get(p)!;
        node.position.copy(fin.p);
        node.quaternion.copy(fin.q);
        // Assembled overview: calm grey strokes.
        this.styleDrawable(p.d, { opacity: 1, active: false });
      }
    }

    // Solo fitting hero (part-number questions)
    if (this.hwFocus) {
      const show = m.kind === "part" && m.ref === this.hwFocus.ref;
      this.hwFocus.node.visible = show;
      if (show) this.styleDrawable(this.hwFocus.d, { opacity: 1, active: true });
    }

    // hardware
    for (const h of this.hws) {
      const it = h.item;
      let vis = false;
      if (m.kind === "step") {
        vis = it.step <= sIdx && (h.parent ? visibleParts.has(h.parent) : it.scene === scene);
      } else if (m.kind === "assembled") vis = !!h.parent && !this.plan?.steps[it.step]?.wall;
      else if (m.kind === "intro") vis = t > this.stepEnd - 0.7 && !!h.parent && !this.plan?.steps[it.step]?.wall;
      else if (m.kind === "part") vis = false; // use hwFocus hero instead of in-cabinet instances
      h.holder.visible = vis;
      if (!vis) continue;
      const isNew = m.kind === "step" && it.step === sIdx;
      if (isNew && it.travel > 0) {
        const k = clamp01((t - it.delay) / HW_DUR);
        const e = easeInOut(k);
        h.inner.position.set(0, it.travel * (1 - e), 0);
        let ang = (it.spin ?? 0) * Math.PI * 2 * e;
        if (it.turn) ang += it.turn * easeInOut(clamp01((t - it.delay - HW_DUR) / CAM_TURN));
        h.inner.quaternion.setFromAxisAngle(Y, ang);
        const op = clamp01((t - it.delay) / 0.15) * fadeOut;
        this.styleDrawable(h.d, { opacity: op, active: true });
      } else {
        h.inner.position.set(0, 0, 0);
        h.inner.quaternion.setFromAxisAngle(Y, (it.spin ?? 0) * Math.PI * 2 + (it.turn ?? 0));
        const op = m.kind === "intro" ? clamp01((t - this.stepEnd + 0.7) / 0.5) : 1;
        this.styleDrawable(h.d, {
          opacity: op,
          active: m.kind === "intro" || (m.kind === "step" && isNew),
        });
      }
    }

    // wall
    if (this.wall) {
      const on = !!step?.wall;
      this.wall.on += ((on ? 1 : 0) - this.wall.on) * (1 - Math.exp(-this.frameDt * 7.5));
      this.wall.node.visible = this.wall.on > 0.02;
      this.styleDrawable(this.wall.d, { opacity: this.wall.on * 0.9, active: false });
    }
  }

  /** Eases anything that was caught mid-move when the mode changed from where it was to where it now belongs. */
  private blendCarry() {
    const e = easeInOut(this.carryT);
    for (const [obj, from] of this.carry) {
      if (!obj.visible) continue;
      obj.position.lerpVectors(from.p, obj.position, e);
      obj.quaternion.slerpQuaternions(from.q, obj.quaternion.clone(), e);
    }
  }

  private introOrderCache = new Map<string, number>();
  private introOrder(p: PNode) {
    if (!this.introOrderCache.size) {
      const sorted = [...this.parts].sort((a, b) => {
        const sa = a.item.states[a.item.states.length - 1].step, sb = b.item.states[b.item.states.length - 1].step;
        return sa - sb || a.item.states[a.item.states.length - 1].delay - b.item.states[b.item.states.length - 1].delay;
      });
      sorted.forEach((x, i) => this.introOrderCache.set(x.item.key, i));
    }
    return this.introOrderCache.get(p.item.key) ?? 0;
  }

  private camAngles() {
    let az = this.az, el = this.el0;
    if (this.mode.kind === "layout") {
      az = 0.22;
      el = 1.0;
    }
    if (this.mode.kind === "assembled" && this.mode.view) {
      az = this.mode.view.az;
      el = this.mode.view.el;
    }
    // PDF-like beat angle (from step map framing) — prefer over stock three-quarter.
    if (this.mode.kind === "step" && this.mode.view) {
      az = this.mode.view.az;
      el = this.mode.view.el;
    }
    // Idle orbit only when assembled.turntable is explicitly true (demo keeps it off).
    if (this.mode.kind === "assembled" && this.mode.turntable) {
      az += Math.sin(this.turnT / 3.2) * 0.32 * easeInOut(clamp01(this.turnT / 2.5));
    }
    if (this.mode.kind === "part") {
      az = 0.7;
      el = 0.5;
    }
    return { az, el };
  }

  private updateCamera(dt: number) {
    {
      const want = this.camAngles();
      if (!this.camReady || dt === 0) {
        this.camAz = want.az;
        this.camEl = want.el;
      } else {
        const g = 1 - Math.exp(-dt * CAM_FOLLOW);
        this.camAz += (want.az - this.camAz) * g;
        this.camEl += (want.el - this.camEl) * g;
      }
    }
    if (this.autoReset && !this.dragging) {
      const k = dt === 0 ? 1 : 1 - Math.exp(-dt * CAM_RESET);
      this.userAz += (0 - this.userAz) * k;
      this.userEl += (0 - this.userEl) * k;
      this.userZoom += (1 - this.userZoom) * k;
    }
    // userAz is unbounded → full 360° yaw; clamp pitch just shy of the poles.
    const az = this.camAz + this.userAz;
    const el = Math.max(0.02, Math.min(1.55, this.camEl + this.userEl));
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const right = new THREE.Vector3().crossVectors(Y, dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    // fit
    const pts = this.frameLocal;
    let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
    const center = new THREE.Vector3();
    const w = new THREE.Vector3();
    if (pts.length) {
      for (const c of pts) {
        w.copy(c).applyMatrix4(this.root.matrixWorld);
        const r = w.dot(right), u = w.dot(up);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
      }
    } else {
      minR = minU = -500;
      maxR = maxU = 500;
    }
    const aspect = this.w / this.h;
    const mob = this.w < 640;
    const k = this.mode.kind;
    const m = this.opts.margins ?? { t: 0, r: 0, b: 0, l: 0 };
    let mT = 40, mR = 40, mB = 40, mL = 40;
    if (this.opts.offscreen) {
      const pad = Math.round(Math.min(this.w, this.h) * 0.07);
      mT = mR = mB = mL = k === "part" ? 4 : pad;
    } else if (k === "step") {
      // Tight margins so active parts can fill ~70–85% of the stage.
      mT = (mob ? 20 : 28) + m.t;
      mL = (mob ? 10 : 16) + m.l;
      mB = (mob ? 28 : 36) + m.b;
      mR = (mob ? 10 : 16) + m.r;
    } else if (k === "part") {
      mT = mR = mB = mL = 4;
    } else if (k === "layout") {
      mT = mob ? 30 : 60;
      mB = mob ? 40 : 70;
      mL = mR = mob ? 16 : 40;
    } else {
      mT = (mob ? 36 : 70) + m.t;
      mB = (mob ? 36 : 70) + m.b;
      mL = (mob ? 24 : 70) + m.l;
      mR = (mob ? 24 : 70) + m.r;
    }
    const fit = (l: number, t: number, r: number, b: number) => {
      const aw = Math.max(60, this.w - l - r), ah = Math.max(60, this.h - t - b);
      return { l, t, aw, ah, s: Math.max((maxR - minR) / aw, (maxU - minU) / ah, 0.05) };
    };
    // Use the full stage for step close-ups (don't reserve fittings-box gutters).
    const starts: [number, number][] = [[mL, mT]];
    let best = fit(mL, mT, mR, mB);
    let first = true;
    for (const [l, t] of starts) {
      const c = fit(l, t, mR, mB);
      if (first || c.s < best.s) best = c;
      first = false;
    }
    mL = best.l;
    mT = best.t;
    const availW = best.aw, availH = best.ah;
    // tight ≈ how much of the stage the subject should fill (1.25 → ~80%).
    const tight = k === "step" && this.mode.kind === "step" ? (this.mode.tight ?? 1.35) : 1;
    const scale = best.s * (k === "part" ? 1.04 : k === "step" ? 1 / tight : 1.06);
    let halfH = (scale * this.h) / 2;
    const offX = mL + availW / 2 - this.w / 2, offY = mT + availH / 2 - this.h / 2;
    const cr = (minR + maxR) / 2 - offX * scale * this.userZoom, cu = (minU + maxU) / 2 + offY * scale * this.userZoom;
    void aspect;
    halfH = Math.max(halfH, 60) * this.userZoom;
    center.copy(right).multiplyScalar(cr).addScaledVector(up, cu);
    // keep depth component around the bbox centre
    if (pts.length) {
      const box = new THREE.Box3();
      for (const c of pts) box.expandByPoint(w.copy(c).applyMatrix4(this.root.matrixWorld));
      const bc = box.getCenter(new THREE.Vector3());
      center.addScaledVector(dir, bc.dot(dir));
    }

    // User orbit: lock distance/zoom. Re-fitting the AABB each frame as az/el
    // changes looks like a zoom-in/dolly — keep camHalf + target fixed.
    const userOrbit = this.dragging || !this.autoReset;
    if (userOrbit) {
      if (this.orbitHalf == null || !this.orbitTarget) {
        this.orbitHalf = this.camReady ? this.camHalf / this.userZoom : halfH / this.userZoom;
        this.orbitTarget = (this.camReady ? this.camTarget : center).clone();
      }
      halfH = Math.max(60, this.orbitHalf * this.userZoom);
      center.copy(this.orbitTarget);
      this.camTarget.copy(center);
      this.camHalf = halfH;
      this.camReady = true;
    } else {
      this.orbitHalf = null;
      this.orbitTarget = null;
      if (!this.camReady || dt === 0) {
        this.camTarget.copy(center);
        this.camHalf = halfH;
        this.camReady = true;
      } else {
        const ease = 1 - Math.exp(-dt * 4.2);
        this.camTarget.lerp(center, ease);
        this.camHalf += (halfH - this.camHalf) * ease;
      }
    }
    const cam = this.camera;
    cam.left = -this.camHalf * aspect;
    cam.right = this.camHalf * aspect;
    cam.top = this.camHalf;
    cam.bottom = -this.camHalf;
    cam.position.copy(this.camTarget).addScaledVector(dir, 8000);
    cam.up.copy(Y);
    cam.lookAt(this.camTarget);
    cam.near = 10;
    cam.far = 30000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /* ---------------- render ---------------- */

  private setRes(w: number, h: number) {
    const dpr = this.renderer.getPixelRatio();
    const set = (d: Drawable) => {
      for (const l of d.lines) l.resolution.set(w, h);
      for (const l of d.thin) l.resolution.set(w, h);
      for (const hm of d.hulls) hm.uniforms.uRes.value.set(w, h);
    };
    void dpr;
    this.parts.forEach((p) => set(p.d));
    this.hws.forEach((x) => set(x.d));
    if (this.wall) set(this.wall.d);
    if (this.hwFocus) set(this.hwFocus.d);
  }

  render() {
    this.setRes(this.w, this.h);
    this.renderer.render(this.scene, this.camera);
    if (!this.overlay) return;
    this.updateOverlay();
    this.renderCallout();
  }

  /** Render once at a size and return a PNG data URL (offscreen stages). */
  snapshot(w: number, h: number) {
    this.resize(w, h);
    this.camReady = false;
    this.rootReady = false;
    this.tick(0);
    this.setRes(w, h);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** Image coordinates of a point given in the plan's assembled frame, for the last render. */
  locate(p: Vec3) {
    const v = new THREE.Vector3(...p);
    this.root.updateMatrixWorld(true);
    this.root.localToWorld(v);
    return this.project(v);
  }

  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.w, y: ((1 - p.y) / 2) * this.h };
  }

  private updateOverlay() {
    const plan = this.plan;
    if (!plan || !this.overlay) return;
    const m = this.mode;
    const t = this.t;
    const step = this.step;
    const ns = "http://www.w3.org/2000/svg";
    this.overlay.setAttribute("viewBox", `0 0 ${this.w} ${this.h}`);

    // arrows for parts flying in
    const wanted: { d: string; o: number }[] = [];
    const arrowKeys = new Set<string>();
    const wantedLabels = new Map<string, { x: number; y: number; text: string; sub?: string; o: number; lit: boolean }>();
    if (m.kind === "step" && step) {
      const fade = this.opts.loop !== false && t > this.stepEnd + HOLD ? 1 - clamp01((t - this.stepEnd - HOLD) / FADE) : 1;
      for (const p of this.parts) {
        if (!p.node.visible) continue;
        const { st, prev } = this.stateAt(p, m.index);
        if (!st || st.step !== m.index) continue;
        const akey = st.from ? st.from.join(",") + "@" + st.delay.toFixed(2) : "";
        if (st.from && !(prev && prev.scene === st.scene) && !arrowKeys.has(akey)) {
          arrowKeys.add(akey);
          const fin = new THREE.Vector3(...st.pos);
          const from = new THREE.Vector3(...st.from);
          const len = from.length();
          if (len > 60) {
            const k = (t - st.delay) / PART_DUR;
            const o = (k < 0 ? clamp01(1 + k * 4) : k < 0.75 ? 1 : clamp01(1 - (k - 0.75) * 4)) * fade;
            if (o > 0.01) {
              const a = this.root.localToWorld(fin.clone().addScaledVector(from, 1.12));
              const b = this.root.localToWorld(fin.clone().addScaledVector(from, 0.42));
              const pa = this.project(a), pb = this.project(b);
              const dd = Math.hypot(pb.x - pa.x, pb.y - pa.y);
              if (dd > 26) wanted.push({ d: arrowPath(pa, pb, Math.min(1, dd / 60)), o });
            }
          }
        }
        if (this.labelLayer && !p.type.extra && this.typeFirst.get(p.type.id) === m.index) {
          const k = clamp01((t - st.delay - PART_DUR * 0.55) / 0.3) * fade;
          if (!wantedLabels.has(p.type.id) && k > 0) {
            const c = new THREE.Vector3();
            p.node.getWorldPosition(c);
            const sp = this.project(c);
            wantedLabels.set(p.type.id, { x: sp.x, y: sp.y, text: p.type.label, o: k, lit: false });
          }
        }
      }
    }
    if (m.kind === "layout" && this.labelLayer) {
      const counts = new Map<string, number>();
      this.parts.forEach((p) => counts.set(p.type.id, (counts.get(p.type.id) ?? 0) + 1));
      for (const p of this.parts) {
        if (!p.node.visible || wantedLabels.has(p.type.id) || p.type.extra) continue;
        const c = new THREE.Vector3();
        p.node.getWorldPosition(c);
        const sp = this.project(c);
        const n = counts.get(p.type.id) ?? 1;
        wantedLabels.set(p.type.id, { x: sp.x, y: sp.y, text: p.type.label, sub: n > 1 ? `${n}×` : undefined, o: 1, lit: false });
      }
    }
    if (m.kind === "part" && this.labelLayer && this.hwFocus && this.hwFocus.ref === m.ref) {
      const c = new THREE.Vector3();
      this.hwFocus.node.getWorldPosition(c);
      const sp = this.project(c);
      wantedLabels.set("hw-focus", {
        x: sp.x,
        y: Math.min(this.h - 24, sp.y + Math.min(80, this.h * 0.22)),
        text: m.label ?? this.hwFocus.label,
        sub: m.title ?? this.hwFocus.name,
        o: 1,
        lit: false,
      });
    }
    while (this.arrows.length < wanted.length) {
      const a = document.createElementNS(ns, "path") as SVGPathElement;
      a.setAttribute("class", "arrow");
      this.overlay.insertBefore(a, this.overlay.firstChild);
      this.arrows.push(a);
    }
    this.arrows.forEach((a, i) => {
      const w = wanted[i];
      if (!w) {
        a.style.opacity = "0";
        return;
      }
      a.setAttribute("d", w.d);
      a.style.opacity = String(w.o);
    });

    // labels
    if (this.labelLayer) {
      for (const [id, el] of this.labels) {
        if (!wantedLabels.has(id)) {
          el.remove();
          this.labels.delete(id);
        }
      }
      for (const [id, l] of wantedLabels) {
        let el = this.labels.get(id);
        if (!el) {
          el = document.createElement("div");
          el.className = "stage-label";
          this.labelLayer.appendChild(el);
          this.labels.set(id, el);
        }
        const html = `<b>${esc(l.text)}</b>${l.sub ? `<span>${esc(l.sub)}</span>` : ""}`;
        if (el.innerHTML !== html) el.innerHTML = html;
        el.style.transform = `translate(${l.x}px, ${l.y}px) translate(-50%, -50%) scale(${0.7 + 0.3 * l.o})`;
        el.style.opacity = String(l.o);
        el.classList.toggle("lit", l.lit);
      }
    }

    // dimension lines on the cover
    this.updateDims();

    // square check
    if (this.squareEls.length) {
      const on = step?.check === "square";
      const [d1, d2, eq] = this.squareEls;
      if (on && plan) {
        const fin = this.extents.get("final")!;
        const box = new THREE.Box3().setFromPoints(fin);
        const z = box.min.z;
        const cs = [
          new THREE.Vector3(box.min.x + 30, box.min.y + 30, z),
          new THREE.Vector3(box.max.x - 30, box.max.y - 30, z),
          new THREE.Vector3(box.max.x - 30, box.min.y + 30, z),
          new THREE.Vector3(box.min.x + 30, box.max.y - 30, z),
        ].map((v) => this.project(this.root.localToWorld(v)));
        const k = easeInOut(clamp01((t - 0.3) / 1.2));
        const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const ax = mx + (a.x - mx) * k, ay = my + (a.y - my) * k, bx = mx + (b.x - mx) * k, by = my + (b.y - my) * k;
          return doubleArrow({ x: ax, y: ay }, { x: bx, y: by });
        };
        d1.setAttribute("d", seg(cs[0], cs[1]));
        d2.setAttribute("d", seg(cs[2], cs[3]));
        const cx = (cs[0].x + cs[1].x) / 2, cy = (cs[0].y + cs[1].y) / 2;
        eq.setAttribute("transform", `translate(${cx} ${cy}) scale(${k})`);
        for (const e of this.squareEls) (e as SVGElement).style.opacity = String(k > 0 ? 1 : 0);
      } else for (const e of this.squareEls) (e as SVGElement).style.opacity = "0";
    }
  }

  private updateDims() {
    const m = this.mode;
    const on = m.kind === "assembled" && !!m.dims && this.plan;
    if (!on) {
      if (this.dimsEl) this.dimsEl.style.opacity = "0";
      return;
    }
    const ns = "http://www.w3.org/2000/svg";
    if (!this.dimsEl) {
      this.dimsEl = document.createElementNS(ns, "g") as SVGGElement;
      this.dimsEl.setAttribute("class", "dims");
      this.overlay!.appendChild(this.dimsEl);
    }
    const fin = this.extents.get("final") ?? [];
    if (!fin.length) return;
    const box = new THREE.Box3().setFromPoints(fin);
    const size = this.plan!.spec.size;
    const k = easeInOut(clamp01((this.t - 0.2) / 0.9));
    const sz = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
    const off = sz * 0.07;
    const P = (x: number, y: number, z: number) => this.project(this.root.localToWorld(new THREE.Vector3(x, y, z)));
    // three dimension lines, each an extension path, the line with its arrow heads and a label: made once, then
    // only their attributes change as the turntable turns (no new markup every frame)
    if (this.dimsEl.childElementCount !== 9) {
      this.dimsEl.innerHTML = "";
      for (let i = 0; i < 3; i++) {
        for (const cls of ["ext", "dim"]) {
          const el = document.createElementNS(ns, "path");
          el.setAttribute("class", cls);
          this.dimsEl.appendChild(el);
        }
        this.dimsEl.appendChild(document.createElementNS(ns, "text"));
      }
    }
    const kids = this.dimsEl.children;
    const line = (i: number, a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, o: THREE.Vector3Tuple, label: string, side: number) => {
      const a0 = P(...a), b0 = P(...b);
      const a1 = P(a[0] + o[0], a[1] + o[1], a[2] + o[2]), b1 = P(b[0] + o[0], b[1] + o[1], b[2] + o[2]);
      const mx = (a1.x + b1.x) / 2, my = (a1.y + b1.y) / 2;
      const ax = mx + (a1.x - mx) * k, ay = my + (a1.y - my) * k, bx = mx + (b1.x - mx) * k, by = my + (b1.y - my) * k;
      const dx = b1.x - a1.x, dy = b1.y - a1.y, L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, h = 7;
      const head = (x: number, y: number, s2: number) => `M${x + s2 * ux * h + uy * h * 0.55} ${y + s2 * uy * h - ux * h * 0.55} L${x} ${y} L${x + s2 * ux * h - uy * h * 0.55} ${y + s2 * uy * h + ux * h * 0.55}`;
      const ext = `M${a0.x} ${a0.y} L${a1.x + (a1.x - a0.x) * 0.25} ${a1.y + (a1.y - a0.y) * 0.25} M${b0.x} ${b0.y} L${b1.x + (b1.x - b0.x) * 0.25} ${b1.y + (b1.y - b0.y) * 0.25}`;
      const lx = mx - uy * 16 * side, ly = my + ux * 16 * side;
      const [e, d, t] = [kids[i * 3], kids[i * 3 + 1], kids[i * 3 + 2]] as SVGElement[];
      e.setAttribute("d", ext);
      e.style.opacity = String(k * 0.6);
      // the arrow heads grow in with the line instead of popping on at the end
      const hs = clamp01((k - 0.85) / 0.15);
      d.setAttribute("d", `M${ax} ${ay} L${bx} ${by} ${hs > 0 ? head(ax, ay, hs) + head(bx, by, -hs) : ""}`);
      t.setAttribute("x", String(lx));
      t.setAttribute("y", String(ly + 5));
      t.style.opacity = String(clamp01((k - 0.6) / 0.4));
      if (t.textContent !== label) t.textContent = label;
    };
    const { min, max } = box;
    line(0, [min.x, min.y, max.z], [max.x, min.y, max.z], [0, -off * 0.2, off], `${Math.round(size.w)} cm`, 1);
    line(1, [max.x, min.y, max.z], [max.x, min.y, min.z], [off, -off * 0.2, 0], `${Math.round(size.d)} cm`, 1);
    line(2, [min.x, min.y, max.z], [min.x, max.y, max.z], [-off, 0, off * 0.3], `${Math.round(size.h)} cm`, -1);
    this.dimsEl.style.opacity = "1";
  }

  private renderCallout() {
    const co = this.callout;
    if (!co || !this.leader || !this.leaderDot) return;
    const f = this.mode.kind === "step" ? this.focus : undefined;
    const t = this.t;
    let target = 0;
    if (f) {
      const k = (t - f.hw.item.delay + 0.5) / 0.4;
      target = clamp01(k);
      if (t > this.stepEnd + HOLD) target = 1;
    }
    co.visible += (target - co.visible) * 0.18;
    const show = co.visible > 0.02 && !!f;
    co.wrap.style.opacity = String(co.visible);
    co.wrap.style.transform = `scale(${0.85 + 0.15 * co.visible})`;
    co.wrap.style.visibility = show ? "visible" : "hidden";
    this.leader.style.opacity = this.leaderDot.style.opacity = String(show ? co.visible : 0);
    if (!show || !f) return;

    const world = this.root.localToWorld(f.local.clone());
    const dirW = f.dir.clone().applyQuaternion(this.root.quaternion).normalize();
    const camDir = new THREE.Vector3().subVectors(this.camera.position, this.camTarget).normalize().negate();
    const view = dirW.clone().multiplyScalar(0.85).addScaledVector(camDir, 0.55).normalize();
    const cam = co.camera;
    const half = f.size;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.position.copy(world).addScaledVector(view, -900);
    cam.up.copy(Math.abs(view.y) > 0.92 ? new THREE.Vector3(0, 0, -1) : Y);
    cam.lookAt(world);
    cam.near = 900 - Math.max(120, half * 2.2);
    cam.far = 900 + 900;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const s = co.size;
    this.setRes(s, s);
    if (this.wall) this.wall.node.visible = this.wall.on > 0.02;
    co.renderer.render(this.scene, cam);
    this.setRes(this.w, this.h);

    // leader line from the spot in the main view to the circle
    const sp = this.project(world);
    const rect = co.wrap.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    const cx = rect.left - host.left + rect.width / 2;
    const cy = rect.top - host.top + rect.height / 2;
    const r = rect.width / 2;
    const ang = Math.atan2(sp.y - cy, sp.x - cx);
    const ex = cx + Math.cos(ang) * r, ey = cy + Math.sin(ang) * r;
    this.leader.setAttribute("d", `M${sp.x} ${sp.y} L${ex} ${ey}`);
    this.leaderDot.setAttribute("cx", String(sp.x));
    this.leaderDot.setAttribute("cy", String(sp.y));

    // callout arrows: insertion + rotation
    const ns = "http://www.w3.org/2000/svg";
    const svg = co.svg;
    svg.setAttribute("viewBox", `0 0 ${s} ${s}`);
    const it = f.hw.item;
    const k = clamp01((t - it.delay) / HW_DUR);
    const proj = (v: THREE.Vector3) => {
      const p = v.clone().project(cam);
      return { x: ((p.x + 1) / 2) * s, y: ((1 - p.y) / 2) * s };
    };
    const a = proj(world.clone().addScaledVector(dirW, -half * 1.15));
    const b = proj(world.clone().addScaledVector(dirW, -half * 0.45));
    let html = "";
    const op1 = k < 1 ? 1 : clamp01(1 - (t - it.delay - HW_DUR) * 2);
    if (Math.hypot(b.x - a.x, b.y - a.y) > 18) html += `<path class="arrow" style="opacity:${op1}" d="${arrowPath(a, b, 0.9)}"/>`;
    const turning = (it.turn ?? 0) > 0 || (it.spin ?? 0) > 0;
    if (turning) {
      const c = proj(world);
      const tk = it.turn ? clamp01((t - it.delay - HW_DUR) / CAM_TURN) : k;
      const op2 = it.turn ? (tk > 0 ? 1 : 0) : 1;
      html += `<path class="arrow turn" style="opacity:${op2}" d="${arcArrow(c.x, c.y, Math.min(34, s * 0.2), -2.4 + tk * 0.4, 0.9 + tk * 0.4)}"/>`;
    }
    if (svg.innerHTML !== html) svg.innerHTML = html;
    void ns;
  }

  /* ---------------- pointer ---------------- */

  private bindPointer() {
    // Bind on the host so the whole stage (not only the canvas box) takes drag/touch.
    const c = this.el;
    const canvas = this.renderer.domElement;
    c.style.touchAction = "none";
    canvas.style.touchAction = "none";
    c.style.cursor = "grab";
    c.addEventListener("pointerdown", (e) => {
      // Ignore UI chrome that may sit over the stage (gap banners still receive clicks).
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".visual-gap, .stage-tip")) return;
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()];
        this.pinch0 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        this.zoom0 = this.userZoom;
      }
      this.dragging = true;
      c.style.cursor = "grabbing";
    });
    c.addEventListener("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        this.hoverAt(e.clientX, e.clientY);
        return;
      }
      if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [p1, p2] = [...this.pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (this.pinch0 > 0) this.userZoom = Math.max(0.35, Math.min(2.5, (this.zoom0 * this.pinch0) / d));
      } else {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        // Free yaw (full 360°) + wider pitch; no idle spin — user orbit only.
        this.userAz -= dx * 0.01;
        this.userEl += dy * 0.008;
        this.userEl = Math.max(-1.35, Math.min(1.35, this.userEl));
      }
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 3 && this.autoReset) {
        this.autoReset = false;
        this.opts.onUserView?.(true);
      }
      this.setHover(null);
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) {
        this.dragging = false;
        c.style.cursor = "grab";
      }
      this.pinch0 = 0;
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("pointerleave", () => this.setHover(null));
    c.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
        e.preventDefault();
        this.userZoom = Math.max(0.35, Math.min(2.5, this.userZoom * Math.exp(e.deltaY * 0.0015)));
        if (this.autoReset) {
          this.autoReset = false;
          this.opts.onUserView?.(true);
        }
      },
      { passive: false },
    );
    c.addEventListener("dblclick", () => this.resetView());
    this.tooltip = document.createElement("div");
    this.tooltip.className = "stage-tip";
    this.el.appendChild(this.tooltip);
  }

  private ray = new THREE.Raycaster();
  private hoverAt(x: number, y: number) {
    if (!this.plan || matchMedia("(hover: none)").matches) return;
    const r = this.el.getBoundingClientRect();
    const nx = ((x - r.left) / r.width) * 2 - 1, ny = -((y - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const p of this.parts) if (p.node.visible && p.d.opacity > 0.5) meshes.push(...p.d.meshes);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    const ref = (hit?.object.userData.ref as string) ?? null;
    this.setHover(ref);
    if (this.tooltip) {
      const type = ref ? this.plan.parts.find((p) => p.id === ref) : null;
      if (type && !type.extra) {
        this.tooltip.innerHTML = `<b>${esc(type.label)}</b>${esc(type.name)}`;
        this.tooltip.style.transform = `translate(${x - r.left + 14}px, ${y - r.top + 16}px)`;
        this.tooltip.style.opacity = "1";
      } else this.tooltip.style.opacity = "0";
    }
  }

  private setHover(ref: string | null) {
    if (this.hovered === ref) return;
    this.hovered = ref;
    this.opts.onHover?.(ref);
    if (!ref && this.tooltip) this.tooltip.style.opacity = "0";
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.fallback);
    this.ro?.disconnect();
    this.io?.disconnect();
    this.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    if (this.callout) {
      this.callout.renderer.dispose();
      this.callout.renderer.forceContextLoss();
      this.callout.wrap.remove();
    }
    this.overlay?.remove();
    this.labelLayer?.remove();
    this.tooltip?.remove();
  }
}

function disposeDrawable(d: Drawable) {
  d.faces.forEach((m) => m.dispose());
  d.lines.forEach((m) => m.dispose());
  d.thin.forEach((m) => m.dispose());
  d.hulls.forEach((m) => m.dispose());
}

/** Thick IKEA style arrow from a to b (screen space). */
export function arrowPath(a: { x: number; y: number }, b: { x: number; y: number }, s = 1) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const px = -uy, py = ux;
  const hw = 4.2 * s + 1.5, head = 16 * s + 4, hl = Math.min(L * 0.55, 18 * s + 6);
  const bx = b.x - ux * hl, by = b.y - uy * hl;
  return [
    `M${a.x + px * hw} ${a.y + py * hw}`,
    `L${bx + px * hw} ${by + py * hw}`,
    `L${bx + (px * head) / 1.6} ${by + (py * head) / 1.6}`,
    `L${b.x} ${b.y}`,
    `L${bx - (px * head) / 1.6} ${by - (py * head) / 1.6}`,
    `L${bx - px * hw} ${by - py * hw}`,
    `L${a.x - px * hw} ${a.y - py * hw}`,
    "Z",
  ].join(" ");
}

function doubleArrow(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, px = -uy, py = ux;
  const h = 9;
  return `M${a.x} ${a.y} L${b.x} ${b.y} M${a.x + ux * h + px * h * 0.6} ${a.y + uy * h + py * h * 0.6} L${a.x} ${a.y} L${a.x + ux * h - px * h * 0.6} ${a.y + uy * h - py * h * 0.6} M${b.x - ux * h + px * h * 0.6} ${b.y - uy * h + py * h * 0.6} L${b.x} ${b.y} L${b.x - ux * h - px * h * 0.6} ${b.y - uy * h - py * h * 0.6}`;
}

/** Curved rotation arrow (clockwise on screen). */
export function arcArrow(cx: number, cy: number, r: number, a0: number, a1: number) {
  const w = 3.4;
  const pt = (a: number, rr: number) => `${cx + Math.cos(a) * rr} ${cy + Math.sin(a) * rr}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const tip = a1 + 0.42;
  return [
    `M${pt(a0, r - w)}`,
    `A${r - w} ${r - w} 0 ${large} 1 ${pt(a1, r - w)}`,
    `L${pt(a1, r - w - 6)}`,
    `L${pt(tip, r)}`,
    `L${pt(a1, r + w + 6)}`,
    `L${pt(a1, r + w)}`,
    `A${r + w} ${r + w} 0 ${large} 0 ${pt(a0, r + w)}`,
    "Z",
  ].join(" ");
}
