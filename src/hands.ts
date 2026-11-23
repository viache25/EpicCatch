import * as THREE from 'three';

/**
 * A first-person hand built from capsules.
 *
 * Model space (left hand): wrist at the origin, fingers along +Y, palm facing +Z,
 * thumb on the -X side. The right hand is the same model mirrored in X, so in its
 * own frame the thumb sits on +X.
 */
export interface HandPose {
  /** Curl of each knuckle, index → pinky, three per finger. */
  fingers: number[];
  /** [base curl, twist, spread, middle curl, tip curl] */
  thumb: number[];
}

const FINGERS = [
  { x: -0.03, y: 0.096, len: [0.042, 0.026, 0.021], r: 0.0088, splay: 0.07 },
  { x: -0.01, y: 0.102, len: [0.046, 0.03, 0.022], r: 0.0092, splay: 0.02 },
  { x: 0.01, y: 0.098, len: [0.042, 0.028, 0.021], r: 0.0086, splay: -0.03 },
  { x: 0.029, y: 0.088, len: [0.033, 0.021, 0.019], r: 0.0076, splay: -0.09 },
];

function f4(a: number[], b: number[], c: number[], d: number[]): number[] {
  return [...a, ...b, ...c, ...d];
}

export const POSES: Record<'relaxed' | 'pinch' | 'grip' | 'fist' | 'roll', HandPose> = {
  relaxed: { fingers: f4([0.35, 0.45, 0.3], [0.4, 0.5, 0.3], [0.45, 0.5, 0.3], [0.5, 0.5, 0.3]), thumb: [0.2, 0.5, 0.7, 0.25, 0.2] },
  // Cigarette between index and middle finger, the rest tucked away.
  pinch: { fingers: f4([0.12, 0.2, 0.12], [0.18, 0.26, 0.15], [1.15, 1.3, 0.8], [1.2, 1.3, 0.8]), thumb: [0.5, 0.9, 0.45, 0.5, 0.4] },
  // Wrapped round a bottle.
  grip: { fingers: f4([0.7, 0.95, 0.6], [0.72, 0.95, 0.6], [0.75, 0.95, 0.6], [0.8, 0.95, 0.6]), thumb: [0.3, 1.25, 0.95, 0.45, 0.5] },
  // Closed on a lighter, thumb on the wheel.
  fist: { fingers: f4([1.3, 1.45, 0.9], [1.35, 1.5, 0.9], [1.35, 1.5, 0.9], [1.35, 1.5, 0.9]), thumb: [0.25, 0.7, 0.3, 0.5, 0.85] },
  // Thumb against the first two fingers, rolling paper between them.
  roll: { fingers: f4([0.75, 0.6, 0.3], [0.8, 0.65, 0.35], [0.95, 0.85, 0.5], [1.05, 0.9, 0.5]), thumb: [0.55, 1.15, 0.5, 0.35, 0.3] },
};

export class Hand {
  /** Position and orient this; children added here are not mirrored. */
  readonly root = new THREE.Group();
  private readonly joints: THREE.Group[][] = [];
  private readonly thumb: THREE.Group[] = [];
  private readonly current: HandPose = { fingers: [...POSES.relaxed.fingers], thumb: [...POSES.relaxed.thumb] };

  constructor(right: boolean, skin: THREE.Material, sleeve: THREE.Material, cuff: THREE.Material, nail: THREE.Material) {
    const model = new THREE.Group();
    if (right) model.scale.x = -1;
    this.root.add(model);

    const ball = new THREE.SphereGeometry(1, 16, 12);
    const palm = new THREE.Mesh(ball, skin);
    palm.scale.set(0.045, 0.054, 0.0165);
    palm.position.set(0, 0.05, 0);
    const thenar = new THREE.Mesh(ball, skin);
    thenar.scale.set(0.021, 0.036, 0.0165);
    thenar.position.set(-0.027, 0.036, 0.007);
    const heel = new THREE.Mesh(ball, skin);
    heel.scale.set(0.02, 0.03, 0.014);
    heel.position.set(0.022, 0.03, 0.005);
    const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.0255, 0.04, 4, 12), skin);
    wrist.scale.z = 0.78;
    wrist.position.y = -0.012;
    model.add(palm, thenar, heel, wrist);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.052, 0.46, 14, 1, true), sleeve);
    arm.position.y = -0.265;
    arm.scale.z = 0.9;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0395, 0.0395, 0.034, 14), cuff);
    band.position.y = -0.05;
    band.scale.z = 0.9;
    model.add(arm, band);

    for (const f of FINGERS) {
      const chain: THREE.Group[] = [];
      let parent: THREE.Object3D = model;
      let y = f.y;
      f.len.forEach((len, k) => {
        const joint = new THREE.Group();
        joint.position.set(k === 0 ? f.x : 0, y, 0);
        if (k === 0) joint.rotation.z = f.splay;
        const r = f.r * (1 - k * 0.09);
        const geo = new THREE.CapsuleGeometry(r, len, 4, 9);
        geo.translate(0, len / 2, 0);
        joint.add(new THREE.Mesh(geo, skin));
        if (k === 2) {
          const n = new THREE.Mesh(ball, nail);
          n.scale.set(r * 0.78, len * 0.42, r * 0.3);
          n.position.set(0, len * 0.66, -r * 0.84);
          joint.add(n);
        }
        parent.add(joint);
        chain.push(joint);
        parent = joint;
        y = len;
      });
      this.joints.push(chain);
    }

    const lens = [0.04, 0.03, 0.025];
    let parent: THREE.Object3D = model;
    lens.forEach((len, k) => {
      const joint = new THREE.Group();
      if (k === 0) {
        joint.position.set(-0.034, 0.02, 0.008);
        joint.rotation.order = 'ZYX';
      } else {
        joint.position.y = lens[k - 1];
      }
      const r = 0.0115 - k * 0.0011;
      const geo = new THREE.CapsuleGeometry(r, len, 4, 9);
      geo.translate(0, len / 2, 0);
      joint.add(new THREE.Mesh(geo, skin));
      if (k === 2) {
        const n = new THREE.Mesh(ball, nail);
        n.scale.set(r * 0.8, len * 0.42, r * 0.3);
        n.position.set(0, len * 0.62, -r * 0.84);
        joint.add(n);
      }
      parent.add(joint);
      this.thumb.push(joint);
      parent = joint;
    });
    this.apply();
  }

  /** Ease the fingers toward `target`; k is the blend factor for this frame. */
  pose(target: HandPose, k: number): void {
    const c = this.current;
    for (let i = 0; i < 12; i++) c.fingers[i] += (target.fingers[i] - c.fingers[i]) * k;
    for (let i = 0; i < 5; i++) c.thumb[i] += (target.thumb[i] - c.thumb[i]) * k;
    this.apply();
  }

  /** Extra curl on the thumb and first two fingers, for rubbing a paper between them. */
  fidget(amount: number): void {
    this.joints[0][0].rotation.x += amount;
    this.joints[1][0].rotation.x -= amount * 0.7;
    this.thumb[1].rotation.x += amount * 0.8;
  }

  private apply(): void {
    const c = this.current;
    for (let f = 0; f < 4; f++) for (let k = 0; k < 3; k++) this.joints[f][k].rotation.x = c.fingers[f * 3 + k];
    this.thumb[0].rotation.set(c.thumb[0], c.thumb[1], c.thumb[2]);
    this.thumb[1].rotation.x = c.thumb[3];
    this.thumb[2].rotation.x = c.thumb[4];
  }
}
