import * as THREE from 'three';
import { mulberry32 } from './noise';

export type BiteStyle = 'sink' | 'run' | 'lay';

export interface Species {
  id: string;
  name: string;
  /** Catch weight range in kg. */
  minKg: number;
  maxKg: number;
  /** Length in cm = lengthK * cbrt(kg). */
  lengthK: number;
  /** How hard it pulls for its weight. */
  fight: number;
  /** How the float behaves when it takes the bait. */
  bite: BiteStyle;
  /** Relative chance of this species taking the bait. */
  chance: number;
  /** Body depth / body length and thickness / depth. */
  depth: number;
  thick: number;
  profile: [number, number][];
  back: string;
  side: string;
  belly: string;
  fin: number;
  iris: string;
  pattern: 'plain' | 'stripes' | 'spots' | 'bigscales';
  scale: number;
  eye: number;
  forked: number;
}

const ROUND: [number, number][] = [
  [0, 0.12],
  [0.07, 0.44],
  [0.18, 0.78],
  [0.36, 1],
  [0.58, 0.84],
  [0.78, 0.48],
  [0.92, 0.25],
  [1, 0.23],
];
const DEEP: [number, number][] = [
  [0, 0.1],
  [0.06, 0.36],
  [0.17, 0.74],
  [0.38, 1],
  [0.6, 0.8],
  [0.8, 0.38],
  [0.93, 0.19],
  [1, 0.18],
];
const LONG: [number, number][] = [
  [0, 0.16],
  [0.08, 0.5],
  [0.22, 0.82],
  [0.48, 1],
  [0.7, 0.94],
  [0.85, 0.55],
  [0.95, 0.32],
  [1, 0.3],
];

export const SPECIES: Species[] = [
  {
    id: 'roach', name: 'Плотва', minKg: 0.08, maxKg: 0.6, lengthK: 41, fight: 0.9, bite: 'sink', chance: 30,
    depth: 0.29, thick: 0.46, profile: ROUND, back: '#3d4a44', side: '#b9c2c2', belly: '#f1f0e8',
    fin: 0xb4472a, iris: '#d0452a', pattern: 'plain', scale: 13, eye: 0.03, forked: 1,
  },
  {
    id: 'perch', name: 'Окунь', minKg: 0.08, maxKg: 0.9, lengthK: 38, fight: 1.15, bite: 'run', chance: 22,
    depth: 0.3, thick: 0.5, profile: ROUND, back: '#2f3d24', side: '#8f9a55', belly: '#eee9d2',
    fin: 0xc4502a, iris: '#d6a52c', pattern: 'stripes', scale: 9, eye: 0.03, forked: 0.6,
  },
  {
    id: 'crucian', name: 'Карась', minKg: 0.15, maxKg: 1.4, lengthK: 34, fight: 1.0, bite: 'sink', chance: 22,
    depth: 0.4, thick: 0.44, profile: DEEP, back: '#4a4326', side: '#b59a4a', belly: '#e9dfb8',
    fin: 0x6a5a3a, iris: '#c9a545', pattern: 'bigscales', scale: 17, eye: 0.026, forked: 0.45,
  },
  {
    id: 'rudd', name: 'Краснопёрка', minKg: 0.1, maxKg: 0.7, lengthK: 39, fight: 0.9, bite: 'sink', chance: 12,
    depth: 0.33, thick: 0.44, profile: ROUND, back: '#454a2c', side: '#c7b76e', belly: '#f0ead0',
    fin: 0xc0301e, iris: '#d9792a', pattern: 'plain', scale: 14, eye: 0.03, forked: 1,
  },
  {
    id: 'bream', name: 'Лещ', minKg: 0.4, maxKg: 3.0, lengthK: 40, fight: 0.85, bite: 'lay', chance: 9,
    depth: 0.42, thick: 0.3, profile: DEEP, back: '#3b3b36', side: '#a39a82', belly: '#e6e0cd',
    fin: 0x45423c, iris: '#b9a372', pattern: 'plain', scale: 15, eye: 0.024, forked: 1.15,
  },
  {
    id: 'pike', name: 'Щука', minKg: 0.8, maxKg: 6, lengthK: 52, fight: 1.3, bite: 'run', chance: 3,
    depth: 0.155, thick: 0.74, profile: LONG, back: '#2e3a22', side: '#66763c', belly: '#e9e6cf',
    fin: 0x8a5a2a, iris: '#c9b23a', pattern: 'spots', scale: 8, eye: 0.02, forked: 0.8,
  },
  {
    id: 'carp', name: 'Карп', minKg: 1.5, maxKg: 9, lengthK: 36, fight: 1.25, bite: 'run', chance: 2,
    depth: 0.32, thick: 0.6, profile: ROUND, back: '#3f3a22', side: '#a8873c', belly: '#ead9a6',
    fin: 0x7a4f2a, iris: '#c8a040', pattern: 'bigscales', scale: 24, eye: 0.02, forked: 0.7,
  },
];

export interface Catch {
  species: Species;
  kg: number;
  cm: number;
  /** 0..~1.2: how hard this particular fish pulls against the tackle. */
  strength: number;
}

export function rollCatch(rnd: () => number, forceId: string | null = null): Catch {
  const total = SPECIES.reduce((a, s) => a + s.chance, 0);
  let r = rnd() * total;
  let species = SPECIES[0];
  for (const s of SPECIES) {
    r -= s.chance;
    if (r <= 0) {
      species = s;
      break;
    }
  }
  species = SPECIES.find((s) => s.id === forceId) ?? species;
  // Most fish are small; a trophy is rare.
  const kg = species.minKg + (species.maxKg - species.minKg) * Math.pow(rnd(), 2.2);
  const cm = species.lengthK * Math.cbrt(kg) * (0.97 + rnd() * 0.06);
  const strength = Math.min(1.15, Math.max(0.2, (0.2 + Math.sqrt(kg) * 0.42) * species.fight));
  return { species, kg, cm, strength };
}

function profileAt(profile: [number, number][], t: number): number {
  for (let i = 1; i < profile.length; i++) {
    if (t <= profile[i][0]) {
      const [t0, v0] = profile[i - 1];
      const [t1, v1] = profile[i];
      const u = (t - t0) / (t1 - t0);
      const s = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * s;
    }
  }
  return profile[profile.length - 1][1];
}

function paintSkin(sp: Species, seed: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(seed);

  // v = 0 and 1 are the belly seam, v = 0.5 is the ridge of the back.
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, sp.belly);
  grad.addColorStop(0.16, sp.belly);
  grad.addColorStop(0.3, sp.side);
  grad.addColorStop(0.41, sp.side);
  grad.addColorStop(0.5, sp.back);
  grad.addColorStop(0.59, sp.side);
  grad.addColorStop(0.7, sp.side);
  grad.addColorStop(0.84, sp.belly);
  grad.addColorStop(1, sp.belly);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  if (sp.pattern === 'stripes') {
    for (let i = 0; i < 6; i++) {
      const x = W * (0.27 + i * 0.115) + (rnd() - 0.5) * 14;
      const reach = H * (0.24 - i * 0.012);
      const sg = g.createLinearGradient(0, H / 2 - reach, 0, H / 2 + reach);
      sg.addColorStop(0, 'rgba(20,28,14,0)');
      sg.addColorStop(0.3, 'rgba(20,28,14,0.7)');
      sg.addColorStop(0.5, 'rgba(20,28,14,0.85)');
      sg.addColorStop(0.7, 'rgba(20,28,14,0.7)');
      sg.addColorStop(1, 'rgba(20,28,14,0)');
      g.fillStyle = sg;
      g.beginPath();
      g.ellipse(x, H / 2, 20 + rnd() * 9, reach, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (sp.pattern === 'spots') {
    for (let i = 0; i < 230; i++) {
      const x = W * (0.2 + rnd() * 0.78);
      const v = 0.5 + (rnd() < 0.5 ? -1 : 1) * (0.05 + rnd() * 0.2);
      g.fillStyle = `rgba(214,214,150,${0.35 + rnd() * 0.35})`;
      g.beginPath();
      g.ellipse(x, v * H, 7 + rnd() * 9, 3 + rnd() * 3.5, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Scales: rows of overlapping arcs opening toward the tail.
  const s = sp.scale;
  g.lineWidth = sp.pattern === 'bigscales' ? 1.6 : 1.1;
  for (let row = 0; row * s * 0.82 < H; row++) {
    const y = row * s * 0.82;
    const v = y / H;
    const bellyFade = Math.min(1, Math.min(v, 1 - v) / 0.14);
    if (bellyFade <= 0.05) continue;
    for (let x = W * 0.2 + (row % 2 ? s / 2 : 0); x < W; x += s) {
      g.strokeStyle = `rgba(0,0,0,${0.2 * bellyFade})`;
      g.beginPath();
      g.arc(x, y, s * 0.56, -Math.PI * 0.42, Math.PI * 0.42);
      g.stroke();
      g.strokeStyle = `rgba(255,255,255,${0.13 * bellyFade})`;
      g.beginPath();
      g.arc(x - 1.6, y, s * 0.56, -Math.PI * 0.36, Math.PI * 0.36);
      g.stroke();
    }
  }

  // Head: smooth skin, gill cover, mouth.
  const head = g.createLinearGradient(0, 0, W * 0.22, 0);
  head.addColorStop(0, 'rgba(40,40,30,0.4)');
  head.addColorStop(0.8, 'rgba(40,40,30,0.14)');
  head.addColorStop(1, 'rgba(40,40,30,0)');
  g.fillStyle = head;
  g.fillRect(0, H * 0.1, W * 0.22, H * 0.8);
  for (const v of [0.27, 0.73]) {
    g.strokeStyle = 'rgba(20,18,12,0.5)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(W * 0.1, v * H, W * 0.1, -1.1, 1.1);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(W * 0.096, v * H, W * 0.1, -1.0, 1.0);
    g.stroke();
    // lateral line
    g.strokeStyle = 'rgba(20,20,15,0.22)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(W * 0.2, v * H);
    g.quadraticCurveTo(W * 0.5, (v + (v < 0.5 ? -0.03 : 0.03)) * H, W, (v + (v < 0.5 ? 0.02 : -0.02)) * H);
    g.stroke();
    // mouth
    g.strokeStyle = 'rgba(15,12,10,0.7)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(0, (v + (v < 0.5 ? -0.02 : 0.02)) * H);
    g.lineTo(W * 0.035, (v + (v < 0.5 ? -0.045 : 0.045)) * H);
    g.stroke();
  }

  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function fan(center: [number, number], pts: [number, number][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    pos.push(center[0], center[1], 0, pts[i][0], pts[i][1], 0, pts[i + 1][0], pts[i + 1][1], 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

export interface FishModel {
  group: THREE.Group;
  /** Where the line meets the lip, in the group's local space. */
  mouth: THREE.Vector3;
  length: number;
  dispose(): void;
}

/** Builds a fish lying along X (nose at -X, tail at +X), back up, sized in metres. */
export function buildFish(c: Catch, env: THREE.Texture | null): FishModel {
  const sp = c.species;
  const L = c.cm / 100;
  const Lb = L * 0.84; // body without the tail fin
  const D = Lb * sp.depth;
  const rings = 30;
  const seg = 18;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const half = (t: number) => (D / 2) * profileAt(sp.profile, t);
  const xAt = (t: number) => (t - 0.5) * Lb;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const a = half(t);
    // Head is rounder than the flank; the flank is flatter.
    const b = a * sp.thick * (1 + 0.35 * Math.max(0, 1 - t / 0.25));
    for (let j = 0; j <= seg; j++) {
      const v = j / seg;
      const phi = v * Math.PI * 2;
      pos.push(xAt(t), -a * Math.cos(phi), b * Math.sin(phi));
      uv.push(t, v);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // Close the snout.
  const tipIndex = pos.length / 3;
  pos.push(xAt(0) - D * 0.035, 0, 0);
  uv.push(0, 0.5);
  for (let j = 0; j < seg; j++) idx.push(tipIndex, j + 1, j);

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bodyGeo.setIndex(idx);
  bodyGeo.computeVertexNormals();
  // The flank vertex at v = 0.25 must face +Z; flip the winding if it does not.
  {
    const probe = Math.floor(rings / 2) * (seg + 1) + Math.round(seg / 4);
    if ((bodyGeo.getAttribute('normal') as THREE.BufferAttribute).getZ(probe) < 0) {
      for (let i = 0; i < idx.length; i += 3) {
        const tmp = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = tmp;
      }
      bodyGeo.setIndex(idx);
      bodyGeo.computeVertexNormals();
    }
  }
  // Weld shading across the belly seam.
  const nrm = bodyGeo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i <= rings; i++) {
    const a = i * (seg + 1);
    const b = a + seg;
    const nx = nrm.getX(a) + nrm.getX(b);
    const ny = nrm.getY(a) + nrm.getY(b);
    const nz = nrm.getZ(a) + nrm.getZ(b);
    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
    nrm.setXYZ(a, nx * inv, ny * inv, nz * inv);
    nrm.setXYZ(b, nx * inv, ny * inv, nz * inv);
  }

  const skin = paintSkin(sp, Math.floor(c.kg * 1000) + sp.name.length * 31);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: skin,
    roughness: 0.42,
    metalness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    envMap: env,
    envMapIntensity: 1.2,
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(bodyGeo, bodyMat));

  const finMat = new THREE.MeshStandardMaterial({
    color: sp.fin,
    roughness: 0.5,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.88,
    envMap: env,
  });
  const fins: THREE.BufferGeometry[] = [];
  const addFin = (geo: THREE.BufferGeometry, tilt = 0, z = 0, y = 0) => {
    const mesh = new THREE.Mesh(geo, finMat);
    mesh.rotation.x = tilt;
    mesh.position.set(0, y, z);
    group.add(mesh);
    fins.push(geo);
  };

  // Tail.
  const xt = xAt(1) - L * 0.01;
  const ap = half(1);
  const tl = L * 0.17;
  const th = L * 0.135 * (0.75 + sp.forked * 0.25);
  const notch = tl * (1 - 0.55 * Math.min(1, sp.forked));
  addFin(
    fan(
      [xt, 0],
      [
        [xt, ap * 0.95],
        [xt + tl * 0.55, th * 0.8],
        [xt + tl, th],
        [xt + notch, 0],
        [xt + tl, -th],
        [xt + tl * 0.55, -th * 0.8],
        [xt, -ap * 0.95],
      ],
    ),
  );

  const dorsal = (tA: number, tB: number, hgt: number, spiky: boolean) => {
    const pts: [number, number][] = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const t = tA + (tB - tA) * u;
      const rise = spiky ? Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.62) * (i % 2 ? 0.86 : 1) : Math.pow(1 - u, 0.8) * Math.min(1, u * 6);
      pts.push([xAt(t) + (spiky ? 0 : hgt * 0.5 * (1 - u) * 0.6), half(t) * 0.96 + hgt * rise]);
    }
    const tm = (tA + tB) / 2;
    addFin(fan([xAt(tm), half(tm) * 0.7], [[xAt(tA), half(tA) * 0.9], ...pts, [xAt(tB), half(tB) * 0.9]]));
  };
  if (sp.id === 'perch') {
    dorsal(0.26, 0.52, L * 0.1, true);
    dorsal(0.55, 0.72, L * 0.075, false);
  } else if (sp.id === 'pike') {
    dorsal(0.72, 0.88, L * 0.07, false);
  } else if (sp.id === 'carp' || sp.id === 'crucian') {
    dorsal(0.36, 0.8, L * 0.06, false);
  } else {
    dorsal(0.42, 0.6, L * 0.095, false);
  }

  // Anal fin.
  {
    const tA = sp.id === 'pike' ? 0.74 : 0.64;
    const tB = sp.id === 'bream' ? 0.9 : tA + 0.14;
    const hgt = L * 0.07;
    addFin(
      fan(
        [xAt((tA + tB) / 2), -half((tA + tB) / 2) * 0.7],
        [
          [xAt(tA), -half(tA) * 0.9],
          [xAt(tA) + hgt * 0.5, -half(tA) - hgt],
          [xAt(tB), -half(tB) - hgt * 0.25],
          [xAt(tB), -half(tB) * 0.9],
        ],
      ),
    );
  }

  // Paired pelvic and pectoral fins.
  const paired = (t: number, yFrac: number, len: number, tilt: number) => {
    const a = half(t);
    const b = a * sp.thick;
    for (const side of [-1, 1]) {
      const geo = fan(
        [0, 0],
        [
          [0, 0],
          [len * 0.95, -len * 0.25],
          [len * 0.8, -len * 0.75],
          [len * 0.12, -len * 0.3],
        ],
      );
      const mesh = new THREE.Mesh(geo, finMat);
      mesh.position.set(xAt(t), -a * yFrac, side * b * Math.sqrt(Math.max(0, 1 - yFrac * yFrac)) * 0.95);
      mesh.rotation.x = -side * tilt;
      group.add(mesh);
      fins.push(geo);
    }
  };
  paired(0.24, 0.5, L * 0.1, 0.9);
  paired(sp.id === 'pike' ? 0.5 : 0.43, 0.93, L * 0.09, 0.45);

  // Eyes.
  const eyeR = L * sp.eye;
  const irisMat = new THREE.MeshPhysicalMaterial({ color: sp.iris, roughness: 0.25, metalness: 0.5, clearcoat: 1, envMap: env });
  const pupilMat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.08, clearcoat: 1, envMap: env });
  const eyeGeo = new THREE.SphereGeometry(1, 16, 12);
  const te = 0.085;
  const ae = half(te);
  const be = ae * sp.thick * (1 + 0.35 * (1 - te / 0.25));
  for (const side of [-1, 1]) {
    const yFrac = 0.22;
    const iris = new THREE.Mesh(eyeGeo, irisMat);
    iris.position.set(xAt(te), ae * yFrac, side * be * Math.sqrt(1 - yFrac * yFrac) * 0.9);
    iris.scale.set(eyeR, eyeR, eyeR * 0.5);
    const pupil = new THREE.Mesh(eyeGeo, pupilMat);
    pupil.position.copy(iris.position);
    pupil.position.z += side * eyeR * 0.3;
    pupil.scale.set(eyeR * 0.55, eyeR * 0.55, eyeR * 0.3);
    group.add(iris, pupil);
  }

  return {
    group,
    mouth: new THREE.Vector3(xAt(0), 0, 0),
    length: L,
    dispose() {
      bodyGeo.dispose();
      bodyMat.dispose();
      skin.dispose();
      finMat.dispose();
      for (const f of fins) f.dispose();
      eyeGeo.dispose();
      irisMat.dispose();
      pupilMat.dispose();
    },
  };
}
