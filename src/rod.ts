import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const ROD_LENGTH = 4.6;
const RINGS = 30;
const SIDES = 7;
const LINE_POINTS = 28;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _bn = new THREE.Vector3();

/** Tapered carbon blank that bends toward whatever is pulling on the line. */
export class Rod {
  readonly object = new THREE.Group();
  readonly tip = new THREE.Vector3();
  private readonly blank: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly centres: THREE.Vector3[] = [];
  private readonly handle: THREE.Mesh;
  private readonly guides: THREE.Mesh[] = [];

  constructor(env: THREE.Texture | null) {
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array((RINGS + 1) * SIDES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const idx: number[] = [];
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SIDES; j++) {
        const a = i * SIDES + j;
        const b = i * SIDES + ((j + 1) % SIDES);
        const c = a + SIDES;
        const d = b + SIDES;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x15171a,
      roughness: 0.28,
      metalness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMap: env,
      side: THREE.DoubleSide,
    });
    this.blank = new THREE.Mesh(geo, mat);
    this.blank.frustumCulled = false;
    this.object.add(this.blank);
    for (let i = 0; i <= RINGS; i++) this.centres.push(new THREE.Vector3());

    const cork = new THREE.MeshStandardMaterial({ color: 0xb58d5c, roughness: 0.9 });
    this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.017, 0.62, 12), cork);
    this.object.add(this.handle);

    const guideMat = new THREE.MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.3, metalness: 0.9, envMap: env });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Mesh(new THREE.TorusGeometry(0.011 - i * 0.0011, 0.0011, 5, 12), guideMat);
      this.guides.push(g);
      this.object.add(g);
    }
  }

  /**
   * @param base where the hand grips the rod
   * @param dir unit direction the butt section points
   * @param pull world point the line runs to (bends the tip toward it)
   * @param bend 0 = straight, 1 = fully loaded
   */
  update(base: THREE.Vector3, dir: THREE.Vector3, pull: THREE.Vector3, bend: number): void {
    // Direction of deflection: the part of the pull that is square to the blank.
    _a.copy(dir).multiplyScalar(ROD_LENGTH).add(base);
    _b.copy(pull).sub(_a);
    const along = _b.dot(dir);
    _b.addScaledVector(dir, -along);
    if (_b.lengthSq() < 1e-6) _b.set(0, -1, 0);
    _b.normalize();

    for (let i = 0; i <= RINGS; i++) {
      const s = i / RINGS;
      const flex = Math.pow(s, 2.3);
      this.centres[i]
        .copy(base)
        .addScaledVector(dir, s * ROD_LENGTH * (1 - 0.2 * bend * s * s))
        .addScaledVector(_b, flex * bend * ROD_LENGTH * 0.52);
    }
    this.tip.copy(this.centres[RINGS]);

    // Rebuild the tube around the bent centreline.
    const p = this.positions;
    for (let i = 0; i <= RINGS; i++) {
      const s = i / RINGS;
      const c0 = this.centres[Math.max(0, i - 1)];
      const c1 = this.centres[Math.min(RINGS, i + 1)];
      _c.copy(c1).sub(c0).normalize();
      _n.set(0, 1, 0).cross(_c);
      if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
      _n.normalize();
      _bn.copy(_c).cross(_n).normalize();
      const r = 0.0115 * (1 - s) + 0.0011;
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const cs = Math.cos(a) * r;
        const sn = Math.sin(a) * r;
        const o = (i * SIDES + j) * 3;
        const ctr = this.centres[i];
        p[o] = ctr.x + _n.x * cs + _bn.x * sn;
        p[o + 1] = ctr.y + _n.y * cs + _bn.y * sn;
        p[o + 2] = ctr.z + _n.z * cs + _bn.z * sn;
      }
    }
    const geo = this.blank.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.computeVertexNormals();

    this.handle.position.copy(base).addScaledVector(dir, -0.22);
    this.handle.quaternion.setFromUnitVectors(_n.set(0, 1, 0), dir);

    this.guides.forEach((g, k) => {
      const i = Math.min(RINGS - 1, Math.round(RINGS * (0.28 + (k / 6) * 0.72)));
      const c0 = this.centres[i];
      const c1 = this.centres[Math.min(RINGS, i + 1)];
      _c.copy(c1).sub(c0).normalize();
      g.position.copy(c1).addScaledVector(_b, 0.012 - k * 0.001);
      g.quaternion.setFromUnitVectors(_n.set(0, 0, 1), _c);
    });
  }
}

/** Monofilament from the rod tip to the float or the fish. */
export class FishingLine {
  readonly object: Line2;
  private readonly buffer: Float32Array;
  private readonly pts = new Float32Array(LINE_POINTS * 3);

  constructor() {
    const geo = new LineGeometry();
    geo.setPositions(new Float32Array((LINE_POINTS - 1) * 6 > 0 ? LINE_POINTS * 3 : 6));
    const mat = new LineMaterial({
      color: 0xe6edf0,
      linewidth: 1.25,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.object = new Line2(geo, mat);
    this.object.frustumCulled = false;
    this.buffer = (geo.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data.array as Float32Array;
  }

  /** @param sag metres of slack hanging below the straight line */
  update(from: THREE.Vector3, to: THREE.Vector3, sag: number): void {
    const p = this.pts;
    for (let i = 0; i < LINE_POINTS; i++) {
      const u = i / (LINE_POINTS - 1);
      const y = from.y + (to.y - from.y) * u - sag * 4 * u * (1 - u);
      p[i * 3] = from.x + (to.x - from.x) * u;
      // Slack line lies on the surface instead of cutting through it.
      p[i * 3 + 1] = to.y >= -0.05 ? Math.max(y, Math.min(0.012, from.y)) : y;
      p[i * 3 + 2] = from.z + (to.z - from.z) * u;
    }
    const b = this.buffer;
    for (let i = 0; i < LINE_POINTS - 1; i++) {
      b[i * 6] = p[i * 3];
      b[i * 6 + 1] = p[i * 3 + 1];
      b[i * 6 + 2] = p[i * 3 + 2];
      b[i * 6 + 3] = p[i * 3 + 3];
      b[i * 6 + 4] = p[i * 3 + 4];
      b[i * 6 + 5] = p[i * 3 + 5];
    }
    const geo = this.object.geometry;
    (geo.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
  }
}

/** Classic balsa stick float: bright antenna, pale body, dark keel under water. */
export function createFloat(env: THREE.Texture | null): THREE.Group {
  const profile: [number, number, number][] = [
    // y, radius, colour
    [-0.16, 0.0015, 0x22201c],
    [-0.06, 0.0025, 0x22201c],
    [-0.055, 0.011, 0x1e1c19],
    [-0.02, 0.017, 0x1e1c19],
    [-0.019, 0.0175, 0xf2efe6],
    [0.018, 0.019, 0xf2efe6],
    [0.019, 0.019, 0xe5321e],
    [0.05, 0.014, 0xe5321e],
    [0.064, 0.006, 0xe5321e],
    [0.066, 0.0042, 0x1b1b1b],
    [0.085, 0.0042, 0x1b1b1b],
    [0.086, 0.0046, 0xff4a12],
    [0.15, 0.0046, 0xff4a12],
    [0.151, 0.0062, 0xffe23a],
    [0.166, 0.0062, 0xffe23a],
    [0.17, 0.001, 0xffe23a],
  ];
  const segs = 14;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  profile.forEach(([y, r, hex], i) => {
    c.setHex(hex);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      col.push(c.r, c.g, c.b);
    }
    if (i > 0) {
      for (let j = 0; j < segs; j++) {
        const a = (i - 1) * segs + j;
        const b = (i - 1) * segs + ((j + 1) % segs);
        idx.push(a, a + segs, b, b, a + segs, b + segs);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.35,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
    envMap: env,
    side: THREE.DoubleSide,
  });
  // Fluorescent paint: stays bright even with the sun behind it.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * 0.55;',
    );
  };
  const mesh = new THREE.Mesh(geo, mat);
  // Larger than life so it reads on a phone at fifteen metres.
  mesh.scale.setScalar(2);
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
