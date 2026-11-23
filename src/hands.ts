import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import handUrl from './assets/hand.glb?inline';

/**
 * First-person hands: a rigged anatomical mesh posed by rotating its finger joints.
 *
 * Hand space (left hand): wrist at the origin, fingers along +Y, palm facing +Z,
 * thumb on the -X side. The right hand is the same mesh mirrored in X, so in its
 * own frame the thumb sits on +X.
 */
export interface HandPose {
  /** Index → pinky, four numbers each: knuckle curl, middle curl, tip curl, sideways spread. */
  f: number[];
  /** Thumb: [swing across the palm, spread away from the index finger, middle curl, tip curl]. */
  t: number[];
}

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const SEGMENTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];

interface Joint {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** Curl axis and sideways axis in the bone's own frame. */
  curl: THREE.Vector3;
  side: THREE.Vector3;
}

function decode(dataUrl: string): ArrayBuffer {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function parse(): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(decode(handUrl), '', (gltf) => resolve(gltf.scene), reject);
  });
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Hand {
  /** Position and orient this; children added here are not mirrored. */
  readonly root = new THREE.Group();
  readonly current: HandPose = { f: new Array(16).fill(0), t: [0, 0, 0, 0] };
  private readonly fingers: Joint[][] = [];
  private readonly thumb: Joint[] = [];
  private readonly bones = new Map<string, THREE.Bone>();

  static async create(right: boolean, skin: THREE.Material, sleeve: THREE.Material, cuff: THREE.Material): Promise<Hand> {
    return new Hand(await parse(), right, skin, sleeve, cuff);
  }

  private constructor(scene: THREE.Group, right: boolean, skin: THREE.Material, sleeve: THREE.Material, cuff: THREE.Material) {
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        mesh.material = skin;
        mesh.frustumCulled = false;
      }
    });
    const bone = (name: string) => {
      const b = this.bones.get(name);
      if (!b) throw new Error(`hand model is missing ${name}`);
      return b;
    };

    // The file stores every joint flat, in world space. Chain them wrist → fingertip.
    const wrist = bone('wrist');
    for (const f of FINGERS) {
      let parent: THREE.Object3D = wrist;
      for (const s of SEGMENTS) {
        const b = bone(`${f}-${s}`);
        parent.attach(b);
        parent = b;
      }
    }
    let parent: THREE.Object3D = wrist;
    for (const name of THUMB) {
      const b = bone(name);
      parent.attach(b);
      parent = b;
    }

    // Turn the model into hand space: its fingers run along -Y, palm faces +X, thumb is at -Z.
    const fit = new THREE.Group();
    fit.matrixAutoUpdate = false;
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0));
    const w = wrist.getWorldPosition(new THREE.Vector3()).applyMatrix4(m);
    m.setPosition(-w.x, -w.y, -w.z);
    fit.matrix.copy(m);
    fit.add(scene);
    const model = new THREE.Group();
    if (right) model.scale.x = -1;
    model.add(fit);

    // Jacket sleeve and cuff hide the open end of the mesh.
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.05, 0.46, 16, 1, true), sleeve);
    arm.position.y = -0.252;
    arm.scale.z = 0.86;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0375, 0.038, 0.036, 16), cuff);
    band.position.y = -0.036;
    band.scale.z = 0.86;
    model.add(arm, band);
    this.root.add(model);

    // Work out each joint's bend axes once, with the hand flat in its own frame.
    fit.updateMatrixWorld(true);
    const palm = new THREE.Vector3(0, 0, 1);
    const joint = (b: THREE.Bone, dir: THREE.Vector3, toward: THREE.Vector3): Joint => {
      const worldInv = b.getWorldQuaternion(new THREE.Quaternion()).invert();
      // Positive curl turns the finger toward `toward`.
      const curl = new THREE.Vector3().crossVectors(dir, toward).normalize().applyQuaternion(worldInv);
      const side = toward.clone().addScaledVector(dir, -toward.dot(dir)).normalize().applyQuaternion(worldInv);
      return { bone: b, rest: b.quaternion.clone(), curl, side };
    };
    for (const f of FINGERS) {
      const chain: Joint[] = [];
      for (let k = 1; k <= 3; k++) {
        const b = bone(`${f}-${SEGMENTS[k]}`);
        const next = bone(`${f}-${SEGMENTS[k + 1]}`);
        const dir = next.getWorldPosition(_a).sub(b.getWorldPosition(_b)).normalize().clone();
        chain.push(joint(b, dir, palm));
      }
      this.fingers.push(chain);
    }
    // The thumb closes toward a point in front of the palm, below the middle finger.
    const target = bone('middle-finger-phalanx-proximal').getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.02, 0.035));
    for (let k = 0; k < 3; k++) {
      const b = bone(THUMB[k]);
      const next = bone(THUMB[k + 1]);
      const pos = b.getWorldPosition(new THREE.Vector3());
      const dir = next.getWorldPosition(_a).sub(pos).normalize().clone();
      this.thumb.push(joint(b, dir, target.clone().sub(pos).normalize()));
    }
    // Spreading the thumb turns it about the palm normal, away from the index finger.
    this.thumb[0].side.copy(palm).applyQuaternion(this.thumb[0].bone.getWorldQuaternion(_q).invert());
    this.apply();
  }

  /** Ease the fingers toward `target`; k is the blend factor for this frame. */
  pose(target: HandPose, k: number): void {
    const c = this.current;
    for (let i = 0; i < 16; i++) c.f[i] += (target.f[i] - c.f[i]) * k;
    for (let i = 0; i < 4; i++) c.t[i] += (target.t[i] - c.t[i]) * k;
    this.apply();
  }

  /** Re-apply the eased pose with small offsets on top: used for rubbing and tapping motions. */
  nudge(thumbSwing: number, thumbCurl: number, indexCurl: number, middleCurl: number): void {
    const c = this.current;
    this.setThumb(c.t[0] + thumbSwing, c.t[1], c.t[2] + thumbCurl, c.t[3] + thumbCurl * 0.6);
    this.setFinger(0, c.f[0] + indexCurl, c.f[1] + indexCurl * 0.5, c.f[2], c.f[3]);
    this.setFinger(1, c.f[4] + middleCurl, c.f[5] + middleCurl * 0.5, c.f[6], c.f[7]);
  }

  /** Position of a named joint in the space of `root`'s parent. Call after the root is placed. */
  jointPosition(name: string, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    const parentInv = this.root.parent ? _m.copy(this.root.parent.matrixWorld).invert() : _m.identity();
    return this.bones.get(name)!.getWorldPosition(out).applyMatrix4(parentInv);
  }

  private setFinger(i: number, a: number, b: number, c: number, spread: number): void {
    const chain = this.fingers[i];
    const j0 = chain[0];
    // Sideways about the palm normal first, then the curl.
    j0.bone.quaternion.copy(j0.rest).multiply(_q.setFromAxisAngle(j0.side, spread)).multiply(_q.setFromAxisAngle(j0.curl, a));
    chain[1].bone.quaternion.copy(chain[1].rest).multiply(_q.setFromAxisAngle(chain[1].curl, b));
    chain[2].bone.quaternion.copy(chain[2].rest).multiply(_q.setFromAxisAngle(chain[2].curl, c));
  }

  private setThumb(swing: number, spread: number, mid: number, tip: number): void {
    const [j0, j1, j2] = this.thumb;
    j0.bone.quaternion.copy(j0.rest).multiply(_q.setFromAxisAngle(j0.side, spread)).multiply(_q.setFromAxisAngle(j0.curl, swing));
    j1.bone.quaternion.copy(j1.rest).multiply(_q.setFromAxisAngle(j1.curl, mid));
    j2.bone.quaternion.copy(j2.rest).multiply(_q.setFromAxisAngle(j2.curl, tip));
  }

  private apply(): void {
    const c = this.current;
    for (let i = 0; i < 4; i++) this.setFinger(i, c.f[i * 4], c.f[i * 4 + 1], c.f[i * 4 + 2], c.f[i * 4 + 3]);
    this.setThumb(c.t[0], c.t[1], c.t[2], c.t[3]);
  }
}

const _m = new THREE.Matrix4();

function fingers(a: number[], b: number[], c: number[], d: number[]): number[] {
  return [...a, ...b, ...c, ...d];
}

/** Named hand shapes. Angles are radians away from the model's flat, open hand. */
export const POSES = {
  open: { f: new Array(16).fill(0), t: [0, 0, 0, 0] },
  relaxed: { f: fingers([0.3, 0.35, 0.2, 0], [0.35, 0.4, 0.25, 0], [0.4, 0.45, 0.25, 0], [0.45, 0.45, 0.25, 0]), t: [0.25, 0, 0.15, 0.15] },
  /** Cigarette between index and middle finger, the rest tucked away. */
  cig: { f: fingers([0.15, 0.2, 0.1, -0.06], [0.2, 0.25, 0.12, 0.06], [1.2, 1.3, 0.7, 0], [1.25, 1.3, 0.7, 0]), t: [0.6, -0.1, 0.35, 0.3] },
  /** Joint pinched between thumb and index finger, other fingers fanned. */
  pinch: { f: fingers([0.55, 0.8, 0.5, -0.05], [0.35, 0.4, 0.25, 0], [0.3, 0.35, 0.2, 0], [0.3, 0.3, 0.2, 0]), t: [0.65, -0.01, 0.1, 0.19] },
  /** Wrapped round a bottle. */
  grip: { f: fingers([0.6, 0.85, 0.45, 0], [0.62, 0.86, 0.45, 0], [0.64, 0.86, 0.45, 0], [0.68, 0.86, 0.45, 0]), t: [0.5, 0.2, 0.3, 0.3] },
  /** Closed on a lighter, thumb over the wheel. */
  fist: { f: fingers([1.25, 1.35, 0.7, 0], [1.3, 1.4, 0.75, 0], [1.3, 1.4, 0.75, 0], [1.3, 1.4, 0.75, 0]), t: [0.2, -0.25, 0.55, 0.75] },
  /** Thumb against the first two fingertips with a rolled paper between them. */
  roll: { f: fingers([0.6, 0.75, 0.45, -0.03], [0.66, 0.8, 0.45, 0], [0.9, 0.9, 0.5, 0], [1.0, 0.95, 0.5, 0]), t: [0.57, 0, 0.2, 0.19] },
  /** The same hold, opened wider around a paper that is still a trough. */
  rollOpen: { f: fingers([0.5, 0.7, 0.42, -0.03], [0.56, 0.75, 0.42, 0], [0.85, 0.9, 0.5, 0], [0.95, 0.95, 0.5, 0]), t: [0.42, 0.05, 0.12, 0.12] },
} satisfies Record<string, HandPose>;
