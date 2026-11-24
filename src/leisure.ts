import * as THREE from 'three';
import { Sfx } from './audio';
import { Hand, POSES, type HandPose } from './hands';
import { clamp, damp, mulberry32 } from './noise';

export type LeisureKind = 'beer' | 'cig' | 'joint';

export interface LeisureLabels {
  beer: string;
  cig: string;
  joint: string;
}

interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  s0: number;
  s1: number;
  alpha: number;
}

const _tip = new THREE.Vector3();
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _m2 = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

function ease(u: number): number {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Move `v` toward `target` at `rate` units per second. */
function approach(v: number, target: number, rate: number, dt: number): number {
  return v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);
}

function basis(x: [number, number, number], y: [number, number, number], z: [number, number, number]): THREE.Quaternion {
  const vx = new THREE.Vector3(...x).normalize();
  const vz = new THREE.Vector3(...z);
  const vy = new THREE.Vector3(...y);
  // Re-square the frame so hand-written axes do not have to be exact.
  vz.crossVectors(vx, vy).normalize();
  vy.crossVectors(vz, vx).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(vx, vy, vz));
}

function euler(x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));
}

function labelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d')!;
  for (let k = 0; k < 2; k++) {
    const x0 = k * 256;
    g.fillStyle = '#efe6cf';
    g.fillRect(x0, 0, 256, 160);
    g.fillStyle = '#1f4a2e';
    g.fillRect(x0, 0, 256, 26);
    g.fillRect(x0, 134, 256, 26);
    g.strokeStyle = '#b8892f';
    g.lineWidth = 3;
    g.strokeRect(x0 + 10, 34, 236, 92);
    g.fillStyle = '#1f4a2e';
    g.textAlign = 'center';
    g.font = 'bold 44px Georgia, serif';
    g.fillText('ОЗЁРНОЕ', x0 + 128, 86);
    g.font = '20px Georgia, serif';
    g.fillStyle = '#5b4a22';
    g.fillText('светлое · 4,5%', x0 + 128, 114);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function paperTexture(flecks: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = flecks ? '#e9e2cf' : '#f4f2ec';
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry32(flecks ? 9 : 3);
  for (let i = 0; i < (flecks ? 500 : 160); i++) {
    g.fillStyle = flecks ? `rgba(60,70,30,${0.05 + rnd() * 0.16})` : `rgba(0,0,0,${0.02 + rnd() * 0.04})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function softSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** A ragged puff: many small soft blobs, so overlapping sprites read as curling smoke. */
function smokeSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(17);
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.7) * 38;
    const x = 64 + Math.cos(a) * rr;
    const y = 64 + Math.sin(a) * rr;
    const r = 7 + rnd() * 17;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${0.1 + rnd() * 0.16})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return new THREE.CanvasTexture(c);
}

/** A smokable: filter at the origin, burning end up the +Y axis. */
class Smoke {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly ash: THREE.Mesh;
  private readonly ember: THREE.Mesh;
  private readonly emberMat: THREE.MeshBasicMaterial;
  private readonly glow: THREE.Sprite;
  private readonly twist: THREE.Mesh | null = null;
  private readonly filterLen: number;
  private readonly bodyLen: number;
  private readonly r0: number;
  private readonly r1: number;
  /** 1 = fresh, 0 = burnt to the filter. */
  left = 1;
  lit = false;
  heat = 0;

  constructor(joint: boolean, env: THREE.Texture | null, sprite: THREE.Texture) {
    this.filterLen = joint ? 0.018 : 0.025;
    this.bodyLen = joint ? 0.07 : 0.059;
    this.r0 = joint ? 0.0032 : 0.004;
    this.r1 = joint ? 0.0062 : 0.004;
    const filterMat = new THREE.MeshStandardMaterial({ color: joint ? 0xd9d2bd : 0xc98a46, roughness: 0.85, envMap: env });
    const filter = new THREE.Mesh(new THREE.CylinderGeometry(this.r0, this.r0, this.filterLen, 14), filterMat);
    filter.position.y = this.filterLen / 2;
    const bodyGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    bodyGeo.translate(0, 0.5, 0);
    const paper = new THREE.MeshStandardMaterial({ map: paperTexture(joint), roughness: 0.9, envMap: env, side: THREE.DoubleSide });
    this.body = new THREE.Mesh(bodyGeo, paper);
    this.body.position.y = this.filterLen;
    this.ash = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), new THREE.MeshStandardMaterial({ color: 0x9a9892, roughness: 1 }));
    this.emberMat = new THREE.MeshBasicMaterial({ color: 0x7a1c05, toneMapped: false });
    this.ember = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), this.emberMat);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sprite, color: 0xff7a22, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.group.add(filter, this.body, this.ash, this.ember, this.glow);
    if (joint) {
      // An unlit joint ends in a twist of paper.
      this.twist = new THREE.Mesh(new THREE.ConeGeometry(1, 0.012, 10), paper);
      this.group.add(this.twist);
    }
    this.layout();
  }

  /** Height of the burning tip above the filter end. */
  tipY(): number {
    return this.filterLen + this.bodyLen * Math.max(0.03, this.left);
  }

  layout(): void {
    const len = this.bodyLen * Math.max(0.03, this.left);
    // A joint is a cone: it gets narrower as it burns back toward the tip.
    const rTip = this.r0 + (this.r1 - this.r0) * (len / this.bodyLen);
    const pos = (this.body.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const top = pos.getY(i) > 0.5;
      const r = top ? rTip : this.r0;
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      pos.setX(i, Math.cos(a) * r);
      pos.setZ(i, Math.sin(a) * r);
    }
    pos.needsUpdate = true;
    this.body.scale.y = len;
    const top = this.filterLen + len;
    this.ember.visible = this.ash.visible = this.lit;
    this.ember.scale.set(rTip * 0.97, 0.003, rTip * 0.97);
    this.ember.position.y = top + 0.0012;
    this.ash.scale.set(rTip * 0.92, 0.005, rTip * 0.92);
    this.ash.position.y = top + 0.005;
    this.glow.position.y = top + 0.003;
    if (this.twist) {
      this.twist.visible = !this.lit;
      this.twist.scale.set(rTip, 1, rTip);
      this.twist.position.y = top + 0.006;
    }
  }

  update(dt: number): void {
    this.heat = Math.max(0, this.heat - dt * 0.9);
    const h = this.lit ? 0.25 + 0.75 * this.heat : 0;
    this.emberMat.color.setRGB(0.42 + 1.6 * h, 0.07 + 0.55 * h * h, 0.02 + 0.1 * h * h);
    this.glow.material.opacity = this.lit ? 0.15 + 0.75 * this.heat : 0;
    this.glow.scale.setScalar(0.014 + 0.05 * this.heat);
  }
}

const ROLL_STAGES = ['Насыпаем', 'Крутим', 'Заклеиваем'];

/** Orientation with the fingers along `fingersDir` and the palm facing `palmDir`. */
function aim(fingersDir: [number, number, number], palmDir: [number, number, number]): THREE.Quaternion {
  const y = new THREE.Vector3(...fingersDir).normalize();
  const z = new THREE.Vector3(...palmDir);
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  z.crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Mirror a transform across the plane x = 0: how the right hand copies the left. */
function mirrorQ(q: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
  return out.set(q.x, -q.y, -q.z, q.w);
}

// ---- Left hand, smoking. Rest: back of the hand up, fingers pointing out over the water,
// the smoke standing up from them. Mouth: palm turned to the face.
const L_REST = euler(-1.25, Math.PI, 0.35, 'ZXY');
const L_MOUTH = euler(0.45, 0.25, -0.5, 'ZXY');
// A joint is pinched, not wedged between fingers: it lies across the pads of thumb and index
// finger, mouth end on the thumb side. So the hand is held thumb-toward-the-face, joint
// pointing out over the water, both resting and at the lips.
const L_REST_JOINT = basis([-0.15, 0.45, -0.88], [0.55, 0.8, 0.25], [0, 0, 1]);
const L_MOUTH_JOINT = basis([0, 0.18, -1], [0.5, 0.85, 0.1], [0, 0, 1]);
/** Where a cigarette sits between index and middle finger, in the left hand's frame. */
const CIG_POS = new THREE.Vector3(-0.009, 0.14, 0.036);
/** It sticks out through the back of the fingers, filter end on the palm side. */
const CIG_Q = euler(-Math.PI / 2, 0, 0);
/** Mouth end of a joint in the pinch: two centimetres to the thumb side of where the pads meet. */
const JOINT_POS = new THREE.Vector3(-0.0436, 0.1175, 0.0605);
/** It runs across the hand, burning end toward the little finger. */
const JOINT_Q = euler(0, 0, -Math.PI / 2);

// ---- Right hand round a bottle: thumb side up, fingers reaching away, palm to the left.
const R_BOTTLE = basis([0, 1, 0], [0, 0, -1], [-1, 0, 0]);
const BOTTLE_POS = new THREE.Vector3(-0.1, 0.085, 0.047);
const BOTTLE_MOUTH = new THREE.Vector3(0.141, 0.085, 0.047);

// ---- Rolling. Everything is laid out around the paper: X runs along it, +Z is the near
// edge where the thumbs sit, the fingers support it from the far side.
const ROLL_L_Q = new THREE.Quaternion(-0.3456, 0.3714, -0.5058, 0.6977);
/** The pinch point (between thumb and first two fingertips) in the hand's frame. */
const PINCH = new THREE.Vector3(-0.0166, 0.1166, 0.0626);
const PINCH_X = 0.031;
/** Right hand hovering over the paper, fingers down, crumbling herb into it. */
const SPRINKLE_Q = aim([-0.5, -0.67, -0.54], [-0.25, -0.43, 0.86]);
const PAPER_LEN = 0.084;
const PAPER_WIDTH = 0.04;

/** A rolling paper that curls from an open trough into a cone. */
class RollPaper {
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly nx = 12;
  private readonly ns = 16;

  constructor(material: THREE.Material) {
    const geo = new THREE.BufferGeometry();
    const count = (this.nx + 1) * (this.ns + 1);
    this.pos = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    geo.setAttribute('position', this.pos);
    const uv = new Float32Array(count * 2);
    const idx: number[] = [];
    for (let i = 0; i <= this.nx; i++) {
      for (let j = 0; j <= this.ns; j++) {
        const k = i * (this.ns + 1) + j;
        uv[k * 2] = i / this.nx;
        uv[k * 2 + 1] = j / this.ns;
        if (i < this.nx && j < this.ns) idx.push(k, k + this.ns + 1, k + 1, k + 1, k + this.ns + 1, k + this.ns + 2);
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.set(0);
  }

  /** Radius of the trough at `x` (metres from the middle) for a given amount of curl. */
  radius(curl: number, x: number): number {
    const arc = 4.3 + (7.9 - 4.3) * curl;
    const taper = 1 + curl * 0.3 * (x / (PAPER_LEN / 2));
    return (PAPER_WIDTH / arc) * taper;
  }

  /** @param curl 0 = open trough waiting for the herb, 1 = rolled shut */
  set(curl: number): void {
    const arc = 4.3 + (7.9 - 4.3) * curl;
    for (let i = 0; i <= this.nx; i++) {
      const x = (i / this.nx - 0.5) * PAPER_LEN;
      const r = this.radius(curl, x);
      for (let j = 0; j <= this.ns; j++) {
        // The near edge tucks in under the far one as it closes.
        const phi = (j / this.ns - 0.5) * arc + curl * 0.6;
        const rr = r * (1 + 0.1 * curl * (j / this.ns));
        this.pos.setXYZ(i * (this.ns + 1) + j, x, -rr * Math.cos(phi), rr * Math.sin(phi));
      }
    }
    this.pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

/**
 * Beer, cigarettes and a hand-rolled joint for the long wait between bites.
 * Everything is hold-to-use: hold a button to drink, draw or roll, let go to stop.
 */
export class Leisure {
  readonly rig = new THREE.Group();
  /** 0..1, raised by beer; makes the view sway. */
  drunk = 0;
  /** 0..1, raised by the joint; warms and slows the morning. */
  high = 0;
  /** Decaying jolt from a coughing fit. */
  kick = 0;
  onLabels: (labels: LeisureLabels) => void = () => {};
  onToast: (text: string) => void = () => {};

  /** The open bottle standing on the pier while it is not in the hand. */
  readonly pierBottle = new THREE.Group();
  private readonly bottle = new THREE.Group();
  private readonly lighter = new THREE.Group();
  private readonly cig: Smoke;
  private readonly joint: Smoke;
  private readonly paper: RollPaper;
  /** Moves with the paper: the herb lying in it. */
  private readonly rollFrame = new THREE.Group();
  private readonly herbs: THREE.Mesh[] = [];
  private readonly crumbs: THREE.Mesh[] = [];
  private readonly puffs: Puff[] = [];
  private readonly flameSprite: THREE.Sprite;

  private held: LeisureKind | null = null;
  private using: LeisureKind | 'roll' | null = null;

  private beerLevel = 0;
  private beerUp = 0;
  private beerTilt = 0;
  private glug = 0;
  private sipOwed = false;

  private showL = 0;
  private toMouth = 0;
  private needLight = false;
  private lighterUp = 0;
  private lightT = 0;
  private flame = 0;
  private inhale = 0;
  private drawn = 0;
  private exhale = 0;
  private exhaleHeavy = false;
  private cough = 0;
  private wisp = 0;

  private jointRolled = false;
  private rollP = 0;
  private rollUp = 0;
  private rollIdle = 0;
  private rollStage = -1;
  private rollPhase = 0;
  private rustle = 0;
  /** 1 while the finished joint is still held the way it was rolled; eases to the smoking grip. */
  private regrip = 0;
  private admire = 0;
  private lastLabels = '';

  static async create(camera: THREE.Camera, env: THREE.Texture | null, audio: Sfx): Promise<Leisure> {
    const skin = new THREE.MeshPhysicalMaterial({
      color: 0xc9997c,
      roughness: 0.58,
      sheen: 0.5,
      sheenColor: new THREE.Color(0xff8a70),
      sheenRoughness: 0.6,
      envMap: env,
      envMapIntensity: 0.6,
    });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4a5136, roughness: 0.96, side: THREE.DoubleSide });
    const cuff = new THREE.MeshStandardMaterial({ color: 0x353a27, roughness: 0.98 });
    const [left, right] = await Promise.all([Hand.create(false, skin, sleeve, cuff), Hand.create(true, skin, sleeve, cuff)]);
    return new Leisure(camera, env, audio, left, right);
  }

  private constructor(
    camera: THREE.Camera,
    env: THREE.Texture | null,
    private readonly audio: Sfx,
    private readonly left: Hand,
    private readonly right: Hand,
  ) {
    camera.add(this.rig);
    const sprite = softSprite();
    const smoke = smokeSprite();
    this.rig.add(this.left.root, this.right.root);

    // Bottle: brown glass, paper label.
    const profile: [number, number][] = [
      [0, 0],
      [0.031, 0],
      [0.033, 0.004],
      [0.033, 0.13],
      [0.031, 0.15],
      [0.018, 0.19],
      [0.0135, 0.205],
      [0.0135, 0.232],
      [0.0148, 0.234],
      [0.0148, 0.24],
      [0.0125, 0.241],
      [0.0105, 0.241],
      [0.0105, 0.2],
    ];
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a1c07,
      emissive: 0x4a2206,
      emissiveIntensity: 0.9,
      roughness: 0.34,
      clearcoat: 0.12,
      clearcoatRoughness: 0.2,
      envMap: env,
      envMapIntensity: 0.2,
      side: THREE.DoubleSide,
    });
    const glass = new THREE.Mesh(
      new THREE.LatheGeometry(
        profile.map(([r, y]) => new THREE.Vector2(r, y)),
        28,
      ),
      glassMat,
    );
    const labelGeo = new THREE.CylinderGeometry(0.0336, 0.0336, 0.08, 28, 1, true);
    labelGeo.translate(0, 0.078, 0);
    const label = new THREE.Mesh(labelGeo, new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.75, envMap: env }));
    label.rotation.y = Math.PI * 0.25;
    this.bottle.add(glass, label);
    this.pierBottle.add(glass.clone(), label.clone());
    this.pierBottle.visible = false;
    // In the right hand's frame the thumb side (+X) is up the bottle.
    this.bottle.rotation.z = -Math.PI / 2;
    this.bottle.position.copy(BOTTLE_POS);
    this.right.root.add(this.bottle);

    const lighterBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.076, 0.024, 0.012),
      new THREE.MeshPhysicalMaterial({ color: 0x9a1f18, roughness: 0.3, clearcoat: 1, envMap: env }),
    );
    const lighterCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.022, 0.012),
      new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.9, envMap: env }),
    );
    lighterCap.position.x = 0.044;
    this.lighter.add(lighterBody, lighterCap);
    this.lighter.position.set(0.018, 0.082, 0.03);
    this.right.root.add(this.lighter);

    this.cig = new Smoke(false, env, sprite);
    this.joint = new Smoke(true, env, sprite);
    this.rig.add(this.cig.group, this.joint.group);

    // Rolling paper, the herb that goes in it, and the pinch of it in the fingers.
    this.paper = new RollPaper(new THREE.MeshStandardMaterial({ map: paperTexture(false), roughness: 0.9, side: THREE.DoubleSide }));
    this.rollFrame.add(this.paper.mesh);
    const herbMat = new THREE.MeshStandardMaterial({ color: 0x55682a, roughness: 1, flatShading: true });
    const rnd = mulberry32(4);
    for (let i = 0; i < 30; i++) {
      const bud = new THREE.Mesh(new THREE.DodecahedronGeometry(0.0019 + rnd() * 0.002, 0), herbMat);
      bud.position.set(-0.032 + (i / 29) * 0.066, 0, (rnd() - 0.5) * 0.007);
      bud.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      bud.userData.lift = rnd() * 0.003;
      this.herbs.push(bud);
      this.rollFrame.add(bud);
    }
    for (let i = 0; i < 5; i++) {
      const crumb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.0016 + rnd() * 0.0012, 0), herbMat);
      crumb.userData.phase = rnd();
      this.crumbs.push(crumb);
      this.rollFrame.add(crumb);
    }
    this.rig.add(this.rollFrame);

    this.flameSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sprite, color: 0xffb24a, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.rig.add(this.flameSprite);

    // A small pool: big soft sprites close to the lens are the most expensive thing to draw.
    for (let i = 0; i < 44; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: smoke, color: 0xe9e4da, transparent: true, opacity: 0, depthWrite: false, fog: false }),
      );
      s.visible = false;
      s.renderOrder = 5;
      this.rig.add(s);
      this.puffs.push({ sprite: s, vel: new THREE.Vector3(), age: 0, life: 1, s0: 0.01, s1: 0.1, alpha: 0.2 });
    }
  }

  labels(): LeisureLabels {
    let joint = this.joint.lit ? 'Затяжка' : this.jointRolled ? 'Косяк' : 'Скрутить';
    if (this.using === 'roll' && this.rollStage >= 0) joint = ROLL_STAGES[this.rollStage];
    return { beer: 'Пиво', cig: this.cig.lit ? 'Затяжка' : 'Сигарета', joint };
  }

  private pushLabels(): void {
    const l = this.labels();
    const key = l.cig + l.joint;
    if (key !== this.lastLabels) {
      this.lastLabels = key;
      this.onLabels(l);
    }
  }

  /** A button went down. Everything is hold-to-use. */
  press(kind: LeisureKind): void {
    if (this.cough > 0) return;
    if (this.using && this.using !== kind && !(this.using === 'roll' && kind === 'joint')) return;
    if (kind === 'beer') {
      if (this.beerLevel <= 0) {
        this.beerLevel = 1;
        this.audio.capOff();
        this.onToast('Открыли холодное');
      }
      this.sipOwed = true;
      this.using = 'beer';
    } else {
      const item = kind === 'cig' ? this.cig : this.joint;
      const other = kind === 'cig' ? this.joint : this.cig;
      if (other.lit) {
        this.onToast(kind === 'cig' ? 'Сначала докурите косяк' : 'Сначала докурите сигарету');
        return;
      }
      if (kind === 'joint' && !this.jointRolled) {
        if (this.using !== 'roll') {
          this.joint.left = 1;
          this.joint.lit = false;
          this.joint.layout();
        }
        this.using = 'roll';
      } else {
        if (!item.lit) {
          if (kind === 'cig') {
            item.left = 1;
            item.layout();
          }
          this.needLight = true;
          this.lightT = 0;
        }
        this.using = kind;
      }
    }
    this.held = kind;
  }

  release(kind: LeisureKind): void {
    if (this.held === kind) this.held = null;
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, alpha: number): void {
    const p = this.puffs.find((q) => !q.sprite.visible);
    if (!p) return;
    p.sprite.visible = true;
    p.sprite.position.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.age = 0;
    p.life = life;
    p.s0 = s0;
    p.s1 = s1;
    p.alpha = alpha;
    p.sprite.material.rotation = Math.random() * 6.28;
  }

  /**
   * @param allowed false while the hands are busy with the rod
   * @param fov current vertical FOV in degrees; `baseFov` is the unzoomed one
   */
  update(dt: number, t: number, allowed: boolean, fov: number, baseFov: number, aspect: number): void {
    // Keep the hands the same size on screen while the view zooms on the float.
    const tRef = Math.tan(THREE.MathUtils.degToRad(baseFov / 2));
    const k = Math.tan(THREE.MathUtils.degToRad(fov / 2)) / tRef;
    this.rig.scale.set(k, k, 1);
    const d = 0.42;
    const hw = tRef * aspect * d;
    const hh = tRef * d;
    const portrait = aspect < 1;
    // Keep things clear of the controls along the bottom edge.
    const lift = hh * (portrait ? 0.42 : 0.1);

    this.drunk = Math.max(0, this.drunk - dt * 0.0016);
    this.high = Math.max(0, this.high - dt * 0.009);
    this.kick = Math.max(0, this.kick - dt * 1.4);
    this.cough = Math.max(0, this.cough - dt);
    this.admire = Math.max(0, this.admire - dt);

    if (!allowed) {
      // Both hands go to the rod; whatever is lit stays between the lips.
      this.held = null;
      this.using = null;
      this.needLight = false;
      this.inhale = 0;
      this.sipOwed = false;
    }
    const hideRate = allowed ? 1 : 3;

    // ---------- beer (right hand)
    const drinking = this.using === 'beer' && this.beerLevel > 0 && (this.held === 'beer' || this.sipOwed);
    this.beerUp = approach(this.beerUp, drinking ? 1 : 0, (drinking ? 2.2 : 1.8) * hideRate, dt);
    this.beerTilt = approach(this.beerTilt, drinking && this.beerUp > 0.9 ? 1 : 0, 2.6, dt);
    if (this.beerTilt > 0.9 && drinking) {
      this.glug += dt;
      if (this.glug > 0.55) {
        this.glug = 0;
        this.audio.glug();
        this.sipOwed = false;
        this.beerLevel -= 0.125;
        this.drunk = Math.min(1, this.drunk + 0.045);
        if (this.beerLevel <= 0.001) {
          this.beerLevel = 0;
          this.onToast('Бутылка кончилась');
        }
      }
    } else {
      this.glug = 0.3;
    }
    if (this.using === 'beer' && !drinking && this.beerUp <= 0) this.using = null;

    // ---------- rolling (both hands)
    const rolling = this.using === 'roll';
    // Once it is rolled shut, the lick and seal finish on their own.
    const working = rolling && (this.held === 'joint' || this.rollP >= 0.8);
    // Let go mid-roll and the hands wait a moment before going down; progress is kept.
    this.rollIdle = working ? 0 : this.rollIdle + dt;
    if (rolling && this.rollIdle > 1.6) this.using = null;
    this.rollUp = approach(this.rollUp, rolling ? 1 : 0, 2.2 * hideRate, dt);
    if (working && this.rollUp > 0.9) {
      this.rollP = Math.min(1, this.rollP + dt / 5.2);
      this.rollPhase += dt;
      this.rustle -= dt;
      if (this.rustle <= 0 && this.rollP > 0.05) {
        this.rustle = 0.2 + Math.random() * 0.25;
        this.audio.rustle();
      }
      const stage = this.rollP < 0.36 ? 0 : this.rollP < 0.8 ? 1 : 2;
      if (stage !== this.rollStage) {
        this.rollStage = stage;
        this.pushLabels();
      }
      if (this.rollP >= 1) {
        this.jointRolled = true;
        this.rollP = 0;
        this.rollStage = -1;
        this.using = null;
        this.held = null;
        this.regrip = 1;
        this.admire = 3;
        this.onToast('Готово. Удерживайте «Косяк», чтобы затянуться');
        this.pushLabels();
      }
    }
    this.regrip = approach(this.regrip, 0, this.rollUp > 0.3 ? 0 : 1.6, dt);

    // ---------- smoking (left hand, lighter in the right)
    const kind = this.using === 'cig' || this.using === 'joint' ? this.using : null;
    const item = this.cig.lit || this.using === 'cig' ? this.cig : this.joint;
    const drawing = kind !== null && (this.held === kind || this.needLight) && this.cough <= 0;
    this.toMouth = approach(this.toMouth, drawing ? 1 : 0, drawing ? 2.6 : 2.2, dt);

    const lighting = this.needLight && this.toMouth > 0.9;
    this.lighterUp = approach(this.lighterUp, lighting ? 1 : 0, 3.2, dt);
    if (lighting && this.lighterUp >= 1) {
      const before = this.lightT;
      this.lightT += dt;
      if (before < 0.12 && this.lightT >= 0.12) {
        this.audio.lighter();
        this.flame = 0.75;
      }
      if (this.lightT > 0.55) {
        item.lit = true;
        item.heat = 1;
        item.layout();
        this.needLight = false;
        this.pushLabels();
      }
    }
    this.flame = Math.max(0, this.flame - dt);

    if (kind && item.lit && !this.needLight && this.held === kind && this.toMouth > 0.92) {
      if (this.inhale === 0) this.audio.inhale();
      this.inhale += dt;
      item.heat = Math.min(1, item.heat + dt * 4);
      // Five or six proper drags finish it.
      item.left = Math.max(0, item.left - dt * (kind === 'joint' ? 0.085 : 0.075));
      item.layout();
      if (kind === 'joint') this.high = Math.min(1, this.high + dt * 0.1);
      if (this.inhale > (kind === 'joint' ? 3.2 : 3.6)) {
        // Held it too long.
        this.cough = 1.5;
        this.kick = 1;
        this.held = null;
        this.audio.cough();
        this.onToast('Кхе-кхе… Не так глубоко');
        if (kind === 'joint') this.high = Math.min(1, this.high + 0.1);
      }
    }
    if (this.inhale > 0 && (this.held !== kind || this.toMouth < 0.9)) {
      // Lungs full: breathe it back out as the hand comes down.
      this.drawn = this.inhale;
      this.inhale = 0;
    }
    if (this.drawn > 0 && this.toMouth < 0.55) {
      this.exhale = clamp(Math.round(this.drawn * 5.5), 2, 16);
      this.exhaleHeavy = item === this.joint;
      if (this.drawn > 0.4 && this.cough <= 0) this.audio.exhale();
      this.drawn = 0;
    }
    if (this.exhale > 0 && Math.random() < dt * 24) {
      this.exhale--;
      this.emit(
        (Math.random() - 0.5) * 0.05,
        lift * 0.5 - hh * 1.0 + Math.random() * 0.02,
        -0.3,
        (Math.random() - 0.5) * 0.14,
        0.05 + Math.random() * 0.13,
        -0.22 - Math.random() * 0.3,
        2.0 + Math.random() * 1.6,
        0.035 + Math.random() * 0.03,
        0.15 + Math.random() * 0.13,
        (this.exhaleHeavy ? 0.5 : 0.4) * (0.6 + Math.random() * 0.4),
      );
    }
    if (kind && !drawing && this.toMouth <= 0) this.using = null;

    for (const sm of [this.cig, this.joint]) {
      if (sm.lit) {
        // Smoulders away on its own between drags.
        sm.left = Math.max(0, sm.left - dt / (sm === this.cig ? 110 : 170));
        if (Math.random() < dt * 3) sm.layout();
        if (sm.left <= 0 && this.inhale === 0 && this.toMouth < 0.2) {
          sm.lit = false;
          sm.left = 0;
          sm.layout();
          if (sm === this.joint) {
            this.jointRolled = false;
            this.onToast('Красота-то какая…');
          } else {
            this.onToast('Докурили. Окурок — в банку, не в озеро');
          }
          if (this.using === 'cig' || this.using === 'joint') this.using = null;
          this.held = null;
          this.pushLabels();
        }
      }
      sm.update(dt);
    }

    // ---------- the rolling timeline
    // 0 … 0.36 crumble the herb in, … 0.44 the right hand takes hold, … 0.8 roll,
    // … 1 up to the mouth, a lick along the gum, and back down.
    const p = this.rollP;
    const r = ease(this.rollUp);
    const pour = clamp(p / 0.34, 0, 1);
    // Just sealed: the right hand keeps its hold for a moment, then lets go.
    const finishing = this.jointRolled && this.using !== 'roll' && this.rollUp > 0;
    const take = finishing ? 1 : ease((p - 0.36) / 0.08);
    const curl = finishing ? 1 : ease((p - 0.44) / 0.34);
    const sealUp = ease((p - 0.8) / 0.06) * (1 - ease((p - 0.95) / 0.05));
    const lick = ease((p - 0.86) / 0.09);
    const rollingNow = working && p > 0.44 && p < 0.8;

    // The paper: low in front, tipped so we look down into it; raised to the lips to seal.
    const frame = this.rollFrame;
    frame.position.set(0, lift - 0.5 * hh, -d + 0.02);
    frame.quaternion.setFromEuler(_e.set(0.95, 0, 0));
    _p.set((0.03 - 0.06 * lick) * sealUp, lift * 0.4 - 0.115, -0.25);
    frame.position.lerp(_p, sealUp);
    frame.quaternion.slerp(_q.setFromEuler(_e.set(0.35, 0, 0)), sealUp);
    frame.updateMatrix();
    const wobble = rollingNow ? Math.sin(this.rollPhase * 9) : 0;

    // ---------- place the hands
    const smokeShown = this.cig.lit || this.joint.lit || kind !== null || this.admire > 0;
    this.showL = approach(this.showL, allowed && smokeShown ? 1 : 0, 2.4 * hideRate, dt);
    const sL = ease(this.showL);
    const m = ease(this.toMouth);
    const breathe = Math.sin(t * 0.7) * 0.004;
    const slotPos = item === this.joint ? JOINT_POS : CIG_POS;
    const slotQ = item === this.joint ? JOINT_Q : CIG_Q;
    const mouthQ = item === this.joint ? L_MOUTH_JOINT : L_MOUTH;

    // Left hand: off-screen → resting on the knee → up at the mouth, or forward to roll.
    const left = this.left.root;
    _p.set(-0.62 * hw, -2.3 * hh, -d);
    _p2.set((portrait ? -0.5 : -0.3) * hw - 0.02, lift - 0.9 * hh + breathe, -d - 0.02);
    left.position.lerpVectors(_p, _p2, sL);
    left.quaternion.copy(item === this.joint ? L_REST_JOINT : L_REST);
    // At the mouth the smoke sits low in the frame, beside the big button on a phone.
    const dm = 0.33;
    _p2.set((portrait ? -0.5 : -0.1) * tRef * aspect * dm, (portrait ? -0.5 : -0.62) * tRef * dm, -dm);
    _p2.sub(_tip.copy(slotPos).applyQuaternion(mouthQ));
    left.position.lerp(_p2, m);
    left.quaternion.slerp(mouthQ, m);
    // Rolling: pinching the paper a third of the way in from its left end.
    _q.copy(ROLL_L_Q);
    _p2.set(-PINCH_X, 0, 0).sub(_tip.copy(PINCH).applyQuaternion(_q));
    _m.compose(_p2, _q, ONE).premultiply(frame.matrix);
    _m.decompose(_p2, _q, _tip);
    left.position.lerp(_p2, r);
    left.quaternion.slerp(_q, r);

    // Right hand: bottle, lighter, or the other half of rolling.
    const right = this.right.root;
    const up = ease(this.beerUp);
    const tilt = ease(this.beerTilt);
    const lu = ease(this.lighterUp);
    if (this.beerUp > 0.01) {
      // Tip the bottle mouth-first toward the face; the base swings up into view.
      _q.copy(R_BOTTLE).premultiply(_q2.setFromEuler(_e.set(0.1 + 1.55 * tilt, 0, -0.12 * (1 - tilt))));
      _tip.copy(BOTTLE_MOUTH).applyQuaternion(_q);
      _p.set(0.42 * hw, -2.6 * hh, -d);
      _p2.set(0.3 * hw + 0.02, lift - 0.05 * hh + 0.03, -d).sub(_tip);
      right.position.lerpVectors(_p, _p2, up);
      _p2.set(0.03, lift * 0.5 - 0.1, -0.2).sub(_tip);
      right.position.lerp(_p2, tilt);
      right.quaternion.copy(_q);
    } else {
      // Lighter: fist up beside the tip of whatever is being lit.
      _p.set(0.6 * hw, -2.3 * hh, -d);
      left.updateMatrix();
      _tip.set(0, item.tipY() + 0.01, 0).applyQuaternion(slotQ).add(slotPos).applyMatrix4(left.matrix);
      _q.copy(R_BOTTLE).premultiply(_q2.setFromEuler(_e.set(0.25, 0.5, -0.25)));
      _p2.set(0.064, 0.082, 0.03).applyQuaternion(_q);
      _p2.subVectors(_tip, _p2);
      _p2.y -= 0.012;
      right.position.lerpVectors(_p, _p2, lu);
      right.quaternion.copy(_q);
      this.flameSprite.position.copy(_tip);
      this.flameSprite.position.y -= 0.004;
      if (r > 0) {
        // Rolling: first above the paper crumbling herb along it, then the mirror of the left hand.
        const shake = working && p < 0.36 ? Math.sin(this.rollPhase * 17) * 0.0025 : 0;
        _p2.set(-0.03 + 0.062 * pour + shake, 0.05 + shake, 0.004).sub(_tip.set(-PINCH.x, PINCH.y, PINCH.z).applyQuaternion(SPRINKLE_Q));
        _q.copy(SPRINKLE_Q);
        mirrorQ(ROLL_L_Q, _q2);
        _p.set(PINCH_X, 0, 0).sub(_tip.set(-PINCH.x, PINCH.y, PINCH.z).applyQuaternion(_q2));
        _p2.lerp(_p, take);
        _q.slerp(_q2, take);
        _m.compose(_p2, _q, ONE).premultiply(frame.matrix);
        _m.decompose(_p2, _q, _tip);
        // Once the joint is sealed the right hand lets go and drops away.
        const leave = this.using === 'roll' ? r : r * r;
        right.position.lerp(_p2, leave);
        right.quaternion.slerp(_q, leave);
      }
    }
    this.bottle.visible = this.beerUp > 0.01;
    this.pierBottle.visible = this.beerLevel > 0 && !this.bottle.visible;
    this.lighter.visible = this.lighterUp > 0.01 && this.beerUp <= 0.01;
    this.flameSprite.material.opacity = Math.min(1, this.flame * 3);
    this.flameSprite.scale.setScalar(0.045 + Math.random() * 0.012);

    // ---------- fingers
    const kf = damp(12, dt);
    const smokePose: HandPose = item === this.joint ? (this.regrip > 0.5 ? POSES.roll : POSES.pinch) : POSES.cig;
    const rollPose: HandPose = curl > 0.35 ? POSES.roll : POSES.rollOpen;
    this.left.pose(r > 0.4 ? rollPose : smokeShown ? smokePose : POSES.relaxed, kf);
    this.right.pose(this.beerUp > 0.01 ? POSES.grip : r > 0.4 ? (take > 0.5 ? rollPose : POSES.roll) : this.lighterUp > 0.01 ? POSES.fist : POSES.relaxed, kf);
    if (r > 0.4) {
      // Thumbs push up while the fingers pull down, then back: the paper rolls between them.
      const rub = wobble * 0.13;
      this.left.nudge(rub * 0.6, -rub, -rub * 0.8, -rub * 0.8);
      if (take > 0.5) this.right.nudge(rub * 0.6, -rub, -rub * 0.8, -rub * 0.8);
      else if (working && p < 0.36) {
        // Rubbing the herb between thumb and fingertips.
        const crumble = Math.sin(this.rollPhase * 13) * 0.1;
        this.right.nudge(crumble * 0.5, -crumble, crumble, -crumble);
      }
    }
    left.updateMatrix();

    // ---------- paper, herb and crumbs
    const paperShown = this.rollUp > 0.25 && (this.using === 'roll' || this.rollP > 0) && p < 0.8;
    frame.visible = paperShown;
    if (paperShown) {
      this.paper.set(curl);
      this.paper.mesh.rotation.x = wobble * 0.35 * (0.3 + 0.7 * curl);
      const laid = Math.floor(pour * this.herbs.length);
      this.herbs.forEach((h, i) => {
        h.visible = i < laid && curl < 0.92;
        h.position.y = -this.paper.radius(curl, h.position.x) * (1 - 0.5 * curl) + 0.002 + (h.userData.lift as number);
      });
      this.crumbs.forEach((c) => {
        const f = (this.rollPhase * 2.2 + (c.userData.phase as number)) % 1;
        c.visible = working && p < 0.34;
        c.position.set(-0.03 + 0.062 * pour + ((c.userData.phase as number) - 0.5) * 0.008, 0.04 - f * 0.045, 0.002);
      });
    }

    // ---------- whatever is being smoked
    for (const sm of [this.cig, this.joint]) {
      const mine = sm === item;
      const sealed = sm === this.joint && this.rollUp > 0.25 && p >= 0.8;
      const inHand = mine && smokeShown && (sm !== this.joint || this.jointRolled || sm.lit);
      sm.group.visible = allowed && (sealed || (inHand && this.showL + this.rollUp > 0.02));
      if (!sm.group.visible) continue;
      sm.group.scale.setScalar(1);
      // In the fingers of the left hand…
      _m.compose(sm === this.joint ? JOINT_POS : CIG_POS, sm === this.joint ? JOINT_Q : CIG_Q, ONE).premultiply(left.matrix);
      _m.decompose(sm.group.position, sm.group.quaternion, _tip);
      if (sm === this.joint && (sealed || this.regrip > 0)) {
        // …or still held the way it was rolled: lying along the paper's axis, pinched near the filter.
        // The left hand carries it, so work out where that is from the hand itself.
        _q.copy(ROLL_L_Q).invert();
        _p.set(-PAPER_LEN / 2, 0, 0).sub(_p2.set(-PINCH_X, 0, 0)).applyQuaternion(_q).add(PINCH);
        _q.multiply(_q2.setFromEuler(_e.set(0, 0, -Math.PI / 2)));
        _m2.compose(_p, _q, ONE).premultiply(left.matrix);
        _m2.decompose(_p, _q, _tip);
        const w = sealed ? 1 : ease(this.regrip);
        sm.group.position.lerp(_p, w);
        sm.group.quaternion.slerp(_q, w);
      }
      if (sm.lit && this.toMouth < 0.35) {
        this.wisp -= dt;
        if (this.wisp <= 0) {
          this.wisp = 0.13;
          sm.group.updateMatrix();
          _tip.set(0, sm.tipY() + 0.004, 0).applyMatrix4(sm.group.matrix);
          this.emit(_tip.x, _tip.y, _tip.z, (Math.random() - 0.5) * 0.02 + 0.012, 0.06 + Math.random() * 0.03, -0.01, 1.7, 0.012, 0.08, 0.45);
        }
      }
    }

    for (const puff of this.puffs) {
      if (!puff.sprite.visible) continue;
      puff.age += dt;
      const f = puff.age / puff.life;
      if (f >= 1) {
        puff.sprite.visible = false;
        continue;
      }
      puff.vel.x += (Math.sin(t * 1.7 + puff.s1 * 40) * 0.02 - puff.vel.x * 0.4) * dt;
      puff.vel.y += 0.012 * dt;
      puff.sprite.position.addScaledVector(puff.vel, dt);
      puff.sprite.scale.setScalar(puff.s0 + (puff.s1 - puff.s0) * Math.sqrt(f));
      puff.sprite.material.opacity = puff.alpha * Math.min(1, f * 7) * Math.pow(1 - f, 1.4);
    }
  }

  /** Objects that must be on screen once so their shaders are built before play starts. */
  warmUp(on: boolean): void {
    for (const o of [this.bottle, this.lighter, this.rollFrame, this.cig.group, this.joint.group, this.pierBottle]) o.visible = on;
    this.puffs[0].sprite.visible = on;
    this.left.root.position.set(0, 0, -0.5);
    this.right.root.position.set(0.1, 0, -0.5);
  }
}
