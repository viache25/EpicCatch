// Development stand for posing the hands. Not part of the game build.
import * as THREE from 'three';
import { Sfx } from './audio';
import { Hand, POSES, type HandPose } from './hands';
import { Leisure } from './leisure';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5b6a78);
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a5040, 1.3));
const sun = new THREE.DirectionalLight(0xffd0a0, 2.2);
sun.position.set(-1, 0.6, -1.5);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 1.2);
fill.position.set(0.3, 0.6, 1);
scene.add(fill);
scene.add(new THREE.AxesHelper(0.05));

const skin = new THREE.MeshPhysicalMaterial({ color: 0xc9997c, roughness: 0.58, sheen: 0.5, sheenColor: new THREE.Color(0xff8a70), sheenRoughness: 0.6 });
const sleeve = new THREE.MeshStandardMaterial({ color: 0x4a5136, roughness: 0.96, side: THREE.DoubleSide });
const cuff = new THREE.MeshStandardMaterial({ color: 0x353a27, roughness: 0.98 });

const focus = new THREE.Vector3(0, 0.08, 0);
let fpRef: THREE.PerspectiveCamera | null = null;
let dist = 0.42;
const cams: Record<string, THREE.PerspectiveCamera> = {};
function placeCams(): void {
  const mk = (name: string, x: number, y: number, z: number, up = new THREE.Vector3(0, 1, 0)) => {
    const c = cams[name] ?? (cams[name] = new THREE.PerspectiveCamera(40, 1, 0.01, 10));
    c.position.set(focus.x + x * dist, focus.y + y * dist, focus.z + z * dist);
    c.up.copy(up);
    c.lookAt(focus);
  };
  if (!fpRef || cams.front !== fpRef) mk('front', 0, 0.25, 1);
  mk('back', 0, 0, -1);
  mk('side', 1, 0, 0);
  mk('top', 0, 1, 0.001, new THREE.Vector3(0, 0, -1));
}
placeCams();

const props: Record<string, THREE.Object3D> = {};
function addProp(name: string, obj: THREE.Object3D): void {
  obj.visible = false;
  props[name] = obj;
  scene.add(obj);
}
const white = new THREE.MeshStandardMaterial({ color: 0xf0ede4, roughness: 0.9 });
{
  // Cigarette: filter end at the origin, burning end up +Y.
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.084, 12), white);
  body.position.y = 0.042;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0041, 0.0041, 0.025, 12), new THREE.MeshStandardMaterial({ color: 0xc98a46 }));
  tip.position.y = 0.0125;
  g.add(body, tip);
  addProp('cig', g);
  const j = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0032, 0.088, 12), white);
  cone.position.y = 0.044;
  j.add(cone);
  addProp('joint', j);
  const b = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0x4a2408, roughness: 0.3 });
  const bb = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.14, 20), glass);
  bb.position.y = 0.07;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.03, 0.1, 20), glass);
  neck.position.y = 0.19;
  b.add(bb, neck);
  addProp('bottle', b);
  const l = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.076, 0.012), new THREE.MeshStandardMaterial({ color: 0x9a1f18, roughness: 0.4 }));
  l.geometry.translate(0, 0.038, 0);
  addProp('lighter', l);
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.078, 12), white);
  p.geometry.rotateZ(Math.PI / 2);
  addProp('paper', p);
}

const hands: Record<string, Hand> = {};
const targets: Record<string, HandPose> = {};

interface Xform {
  pos?: [number, number, number];
  euler?: [number, number, number];
  order?: THREE.EulerOrder;
  pose?: HandPose | string;
  visible?: boolean;
  parent?: string;
}

function setX(o: THREE.Object3D, x: Xform): void {
  if (x.pos) o.position.set(...x.pos);
  if (x.euler) o.rotation.set(x.euler[0], x.euler[1], x.euler[2], x.order ?? 'XYZ');
  if (x.visible !== undefined) o.visible = x.visible;
}

const lab = {
  ready: false,
  poses: POSES,
  hand(side: 'L' | 'R', x: Xform) {
    const h = hands[side];
    setX(h.root, x);
    if (x.pose) {
      targets[side] = typeof x.pose === 'string' ? (POSES as Record<string, HandPose>)[x.pose] : x.pose;
      h.pose(targets[side], 1);
    }
  },
  prop(name: string, x: Xform) {
    const o = props[name];
    if (x.parent) (x.parent === 'stage' ? scene : hands[x.parent].root).add(o);
    setX(o, x);
  },
  /**
   * Orient a hand by where its fingers point and its palm faces, then move it so that the
   * hand-space point `local` lands on `at`. Returns the resulting position and quaternion.
   */
  place(side: 'L' | 'R', fingersDir: number[], palmDir: number[], local: number[], at: number[]) {
    const y = new THREE.Vector3(...(fingersDir as [number, number, number])).normalize();
    const z = new THREE.Vector3(...(palmDir as [number, number, number]));
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    z.crossVectors(x, y).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const h = hands[side].root;
    h.quaternion.copy(q);
    h.position.set(at[0], at[1], at[2]).sub(new THREE.Vector3(...(local as [number, number, number])).applyQuaternion(q));
    return { pos: h.position.toArray().map((v) => +v.toFixed(4)), quat: q.toArray().map((v) => +v.toFixed(4)) };
  },
  /** Place the right hand as the mirror image of the left across the plane x = 0. */
  mirror() {
    const l = hands.L.root;
    const r = hands.R.root;
    r.position.set(-l.position.x, l.position.y, l.position.z);
    r.quaternion.set(l.quaternion.x, -l.quaternion.y, -l.quaternion.z, l.quaternion.w);
    r.visible = l.visible;
    hands.R.pose(targets.L ?? POSES.open, 1);
  },
  nudge(side: 'L' | 'R', a: number, b: number, c: number, d: number) {
    hands[side].nudge(a, b, c, d);
  },
  joint(side: 'L' | 'R', name: string) {
    return hands[side].jointPosition(name, new THREE.Vector3()).toArray();
  },
  /**
   * Hill-climb the thumb so its tip ends `gap` metres from the given joint.
   * The hand must sit at the origin, unrotated.
   */
  solveThumb(side: 'L' | 'R', joint: string, gap: number, start?: number[]) {
    const h = hands[side];
    const pose = targets[side];
    let best = start ? [...start] : [...pose.t];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const cost = (t: number[]) => {
      h.pose({ f: pose.f, t }, 1);
      const d = h.jointPosition('thumb-tip', a).distanceTo(h.jointPosition(joint, b));
      return Math.abs(d - gap) + 0.002 * (Math.abs(t[1]) + Math.max(0, t[3] - 0.8));
    };
    let bestC = cost(best);
    const lo = [0, -0.5, -0.2, -0.2];
    const hi = [1.3, 0.6, 1.1, 1.1];
    let step = 0.3;
    for (let i = 0; i < 600; i++) {
      const t = best.map((v, k) => Math.min(hi[k], Math.max(lo[k], v + (Math.random() - 0.5) * step)));
      const c = cost(t);
      if (c < bestC) {
        bestC = c;
        best = t;
      }
      if (i % 150 === 149) step *= 0.5;
    }
    pose.t = best;
    h.pose(pose, 1);
    return { t: best.map((v) => +v.toFixed(2)), err: +bestC.toFixed(4) };
  },
  focus(x: number, y: number, z: number, d = 0.42) {
    focus.set(x, y, z);
    dist = d;
    placeCams();
  },
  frames: 0,
  rig: null as Leisure | null,
  time: 0,
  /** Advance the real game rig by `sec` seconds of simulated time. */
  step(sec: number) {
    const n = Math.round(sec * 30);
    for (let i = 0; i < n; i++) {
      lab.time += 1 / 30;
      lab.rig!.update(1 / 30, lab.time, true, 50, 50, fp.aspect);
    }
  },
};
const fp = new THREE.PerspectiveCamera(50, 1, 0.02, 20);
scene.add(fp);
(window as unknown as { lab: typeof lab }).lab = lab;

(async () => {
  hands.L = await Hand.create(false, skin, sleeve, cuff);
  hands.R = await Hand.create(true, skin, sleeve, cuff);
  scene.add(hands.L.root, hands.R.root);
  hands.R.root.visible = false;
  if (location.search.includes('rig')) {
    hands.L.root.visible = false;
    lab.rig = await Leisure.create(fp, null, new Sfx());
    cams.front = fp;
    fpRef = fp;
    focus.set(0, -0.12, -0.38);
    placeCams();
    fp.position.set(0, 0, 0);
    fp.rotation.set(0, 0, 0);
  }
  lab.ready = true;
})();

function frame(): void {
  const w = innerWidth / 2;
  const h = innerHeight / 2;
  const views: [string, number, number][] = [
    ['front', 0, h],
    ['side', w, h],
    ['top', 0, 0],
    ['back', w, 0],
  ];
  for (const [name, x, y] of views) {
    const c = cams[name];
    c.aspect = w / h;
    c.updateProjectionMatrix();
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(scene, c);
  }
  lab.frames++;
  requestAnimationFrame(frame);
}
frame();
