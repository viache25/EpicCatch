import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { fbm, mulberry32, smoothstep } from './noise';

/** Water level is y = 0. The angler looks along -Z from the end of a pier. */
export const LAKE_CENTER = new THREE.Vector2(0, -49.4);
export const PIER_END_Z = -1.2;
export const PIER_TOP_Y = 0.55;
export const EYE = new THREE.Vector3(0, PIER_TOP_Y + 1.65, 1.6);

const SUN_ELEVATION = THREE.MathUtils.degToRad(5.5);
const SUN_AZIMUTH = THREE.MathUtils.degToRad(27); // to the left of straight ahead
export const SUN_DIR = new THREE.Vector3(
  -Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  Math.sin(SUN_ELEVATION),
  -Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
).normalize();

const FOG_COLOR = 0xc9b39a;

/** Shoreline radius as a function of bearing from the lake centre. */
export function lakeRadius(theta: number): number {
  return (
    62 +
    9 * Math.sin(theta * 2 + 1.3) +
    6 * Math.sin(theta * 3 + 4.1) +
    4 * Math.sin(theta * 5 + 0.7) +
    2.5 * Math.sin(theta * 9 + 2.2)
  );
}

/** Signed distance to the shoreline: negative over water, positive on land. */
export function shoreDist(x: number, z: number): number {
  const dx = x - LAKE_CENTER.x;
  const dz = z - LAKE_CENTER.y;
  return Math.hypot(dx, dz) - lakeRadius(Math.atan2(dz, dx));
}

function groundHeight(d: number, x: number, z: number): number {
  if (d <= 0) return Math.max(-3, d * 0.18);
  const bank = 0.05 + (1 - Math.exp(-d / 5)) * 1.1;
  const hills = smoothstep(10, 150, d) * (8 + 30 * fbm(x / 110 + 3.1, z / 110 + 7.7, 4));
  const rough = (fbm(x / 9, z / 9, 3) - 0.5) * 0.6 * Math.min(1, d / 4);
  return bank + hills + rough;
}

/**
 * Tileable ripple normal map built from sine waves with integer wave numbers,
 * which reads as wind ripple rather than generic noise.
 */
function makeWaterNormals(size: number): THREE.DataTexture {
  const rnd = mulberry32(11);
  const sinX: Float32Array[] = [];
  const cosX: Float32Array[] = [];
  const sinY: Float32Array[] = [];
  const cosY: Float32Array[] = [];
  const amp: number[] = [];
  const kxs: number[] = [];
  const kys: number[] = [];
  const waves = 34;
  for (let w = 0; w < waves; w++) {
    const k = 2 + Math.floor(Math.pow(rnd(), 1.7) * 44);
    const ang = (rnd() - 0.5) * Math.PI * 1.3 + (rnd() < 0.5 ? 0 : Math.PI);
    let kx = Math.round(k * Math.cos(ang));
    const ky = Math.round(k * Math.sin(ang));
    if (kx === 0 && ky === 0) kx = 1;
    const ph = rnd() * Math.PI * 2;
    const sx = new Float32Array(size);
    const cx = new Float32Array(size);
    const sy = new Float32Array(size);
    const cy = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const a = (kx * i * Math.PI * 2) / size + ph;
      const b = (ky * i * Math.PI * 2) / size;
      sx[i] = Math.sin(a);
      cx[i] = Math.cos(a);
      sy[i] = Math.sin(b);
      cy[i] = Math.cos(b);
    }
    sinX.push(sx);
    cosX.push(cx);
    sinY.push(sy);
    cosY.push(cy);
    kxs.push(kx);
    kys.push(ky);
    amp.push(1 / Math.pow(Math.hypot(kx, ky), 1.15));
  }
  const data = new Uint8Array(size * size * 4);
  const slope = 0.085;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let gx = 0;
      let gy = 0;
      for (let w = 0; w < waves; w++) {
        // d/dx sin(a + b) = k * cos(a + b)
        const c = cosX[w][x] * cosY[w][y] - sinX[w][x] * sinY[w][y];
        gx += amp[w] * kxs[w] * c;
        gy += amp[w] * kys[w] * c;
      }
      const nx = -gx * slope;
      const ny = -gy * slope;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * size + x) * 4;
      data[o] = (nx * inv * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      data[o + 2] = (inv * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function makeWoodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8b8377';
  g.fillRect(0, 0, c.width, c.height);
  const rnd = mulberry32(5);
  for (let i = 0; i < 260; i++) {
    const y = rnd() * c.height;
    const len = 60 + rnd() * 380;
    const x = rnd() * c.width - 80;
    const dark = rnd() < 0.6;
    g.strokeStyle = dark ? `rgba(40,32,24,${0.08 + rnd() * 0.22})` : `rgba(230,222,205,${0.05 + rnd() * 0.14})`;
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 3, x + len * 0.7, y + (rnd() - 0.5) * 3, x + len, y);
    g.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    const r = 3 + rnd() * 5;
    const grad = g.createRadialGradient(x, y, 0, x, y, r * 2);
    grad.addColorStop(0, 'rgba(35,26,18,0.75)');
    grad.addColorStop(1, 'rgba(35,26,18,0)');
    g.fillStyle = grad;
    g.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,236,200,1)');
  grad.addColorStop(0.12, 'rgba(255,206,150,0.55)');
  grad.addColorStop(0.4, 'rgba(255,170,110,0.14)');
  grad.addColorStop(1, 'rgba(255,150,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildGround(): THREE.Mesh {
  const A = 240;
  const offsets = [
    -12, -7, -4, -2.4, -1.2, -0.5, 0, 0.5, 1.2, 2.2, 3.6, 6, 9, 13, 18, 25, 34, 45, 60, 80, 105, 135, 170, 210, 260,
    320, 400,
  ];
  const J = offsets.length;
  const pos = new Float32Array(A * J * 3);
  const col = new Float32Array(A * J * 3);
  const mud = new THREE.Color(0x4b4234);
  const sand = new THREE.Color(0x6e6248);
  const grassA = new THREE.Color(0x56622c);
  const grassB = new THREE.Color(0x3d4a22);
  const forest = new THREE.Color(0x20301c);
  const tmp = new THREE.Color();
  for (let i = 0; i < A; i++) {
    const th = (i / A) * Math.PI * 2;
    const R = lakeRadius(th);
    for (let j = 0; j < J; j++) {
      const d = offsets[j];
      const r = R + d;
      const x = LAKE_CENTER.x + Math.cos(th) * r;
      const z = LAKE_CENTER.y + Math.sin(th) * r;
      const o = (i * J + j) * 3;
      pos[o] = x;
      pos[o + 1] = groundHeight(d, x, z);
      pos[o + 2] = z;
      const n = fbm(x / 14, z / 14, 3);
      if (d < 0.6) tmp.copy(mud);
      else if (d < 3) tmp.copy(mud).lerp(sand, n).lerp(grassA, smoothstep(0.6, 3, d));
      else tmp.copy(grassA).lerp(grassB, n).lerp(forest, smoothstep(5, 40, d) * (0.6 + 0.4 * n));
      col[o] = tmp.r;
      col[o + 1] = tmp.g;
      col[o + 2] = tmp.b;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < A; i++) {
    const i2 = (i + 1) % A;
    for (let j = 0; j < J - 1; j++) {
      const a = i * J + j;
      const b = i2 * J + j;
      const c = i * J + j + 1;
      const d = i2 * J + j + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Make sure the surface faces up regardless of the winding picked above.
  const nrm = geo.getAttribute('normal');
  let up = 0;
  for (let i = 0; i < nrm.count; i += 37) up += nrm.getY(i);
  if (up < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  return new THREE.Mesh(geo, mat);
}

function strip(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  return geo;
}

type Painter = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

function dab(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fill();
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%)`;
}

/** Spruce: drooping whorls of branches, widest near the ground. */
const paintSpruce: Painter = (g, w, h, rnd) => {
  const cx = w / 2;
  const top = 10 + rnd() * 10;
  const bottom = h - 4;
  g.fillStyle = '#2a2019';
  g.fillRect(cx - 2.5, top + 30, 5, bottom - top - 30);
  const crownEnd = h * (0.9 + rnd() * 0.05);
  const lean = (rnd() - 0.5) * 0.05;
  for (let pass = 0; pass < 2; pass++) {
    let y = top;
    while (y < crownEnd) {
      const f = (y - top) / (crownEnd - top);
      const half = (5 + Math.pow(f, 0.82) * w * 0.43) * (0.72 + rnd() * 0.4);
      for (const side of [-1, 1]) {
        if (rnd() < 0.08 && f > 0.2) continue; // missing branch
        const droop = 0.3 + rnd() * 0.25;
        const n = Math.floor(half * (pass === 0 ? 2.2 : 0.9));
        for (let k = 0; k < n; k++) {
          const u = Math.pow(rnd(), 0.8);
          const bx = cx + lean * (y - top) + side * u * half;
          let by = y + (u * droop - u * u * u * 0.16) * half * 0.9;
          by += rnd() * rnd() * 11 * (0.3 + u); // hanging twigs
          if (pass === 0) {
            dab(g, bx, by, 1.6 + rnd() * 2.2, 1 + rnd() * 1.6, rnd() * 3, hsl(105 + rnd() * 35, 26 + rnd() * 14, 9 + rnd() * 8));
          } else {
            dab(g, bx, by - 2.5, 1 + rnd() * 1.6, 0.7 + rnd(), rnd() * 3, hsl(95 + rnd() * 30, 28 + rnd() * 14, 19 + rnd() * 11));
          }
        }
      }
      y += 4 + f * 7 + rnd() * 3;
    }
  }
};

/** Scots pine: tall bare trunk warming to orange, flat-topped crown of clumps. */
const paintPine: Painter = (g, w, h, rnd) => {
  const cx = w / 2 + (rnd() - 0.5) * 16;
  const bottom = h - 4;
  const crownTop = 14 + rnd() * 12;
  const crownBase = h * (0.4 + rnd() * 0.1);
  const bend = (rnd() - 0.5) * 22;
  const trunkAt = (y: number) => cx + bend * Math.sin(((bottom - y) / (bottom - crownTop)) * 2.2);
  for (let y = bottom; y > crownTop + 26; y -= 1.5) {
    const f = (bottom - y) / (bottom - crownTop);
    const wd = 7.5 - f * 4.5;
    g.fillStyle = hsl(22 - f * 4, 28 + f * 26, 16 + f * 15 + rnd() * 3);
    g.fillRect(trunkAt(y) - wd / 2, y, wd, 2);
  }
  const clumps = 13 + Math.floor(rnd() * 6);
  const centers: [number, number, number, number][] = [];
  for (let i = 0; i < clumps; i++) {
    const f = Math.pow(rnd(), 0.8);
    const yy = crownTop + 12 + f * (crownBase - crownTop - 12);
    // Crown is an irregular oval: narrow at the top, widest two thirds down.
    const spread = (8 + Math.sin(Math.min(1, f * 1.25) * Math.PI * 0.75) * w * 0.3) * (0.5 + rnd() * 0.7);
    const xx = trunkAt(yy) + (rnd() - 0.5) * 2 * spread;
    centers.push([xx, yy, 13 + rnd() * 15, 10 + rnd() * 10]);
    g.strokeStyle = '#33241a';
    g.lineWidth = 1.2 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(trunkAt(yy + 22), yy + 22);
    g.quadraticCurveTo((xx + trunkAt(yy)) / 2, yy + 12, xx, yy + 3);
    g.stroke();
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const [xx, yy, rx, ry] of centers) {
      const n = Math.floor(rx * (pass === 0 ? 9 : 4));
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd());
        const px = xx + Math.cos(a) * r * rx;
        const py = yy + Math.sin(a) * r * ry - (pass === 1 ? ry * 0.45 : 0);
        if (pass === 0) dab(g, px, py, 1.5 + rnd() * 2.2, 1 + rnd() * 1.4, rnd() * 3, hsl(90 + rnd() * 30, 24 + rnd() * 14, 9 + rnd() * 8));
        else dab(g, px, py, 1 + rnd() * 1.5, 0.7 + rnd(), rnd() * 3, hsl(82 + rnd() * 26, 28 + rnd() * 14, 19 + rnd() * 11));
      }
    }
  }
};

interface Twig {
  x: number;
  y: number;
  depth: number;
}

function growBranches(
  g: CanvasRenderingContext2D,
  rnd: () => number,
  x: number,
  y: number,
  ang: number,
  len: number,
  width: number,
  depth: number,
  maxDepth: number,
  color: string,
  out: Twig[],
): void {
  const x2 = x + Math.cos(ang) * len;
  const y2 = y - Math.sin(ang) * len;
  g.strokeStyle = color;
  g.lineWidth = Math.max(0.7, width);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo((x + x2) / 2 + (rnd() - 0.5) * len * 0.2, (y + y2) / 2, x2, y2);
  g.stroke();
  if (depth >= 2) out.push({ x: x2, y: y2, depth });
  if (depth >= maxDepth) return;
  const kids = depth === 0 ? 3 : 2 + (rnd() < 0.35 ? 1 : 0);
  for (let i = 0; i < kids; i++) {
    const spread = (i / (kids - 1) - 0.5) * (1.1 + rnd() * 0.5) + (rnd() - 0.5) * 0.3;
    let a = ang + spread;
    a = a * 0.86 + (Math.PI / 2) * 0.14; // phototropism
    growBranches(g, rnd, x2, y2, a, len * (0.66 + rnd() * 0.18), width * 0.62, depth + 1, maxDepth, color, out);
  }
}

/** Alder/willow-like broadleaf with a wide rounded crown. */
const paintBroadleaf: Painter = (g, w, h, rnd) => {
  const twigs: Twig[] = [];
  growBranches(g, rnd, w / 2, h - 3, Math.PI / 2 + (rnd() - 0.5) * 0.2, h * 0.27, w * 0.035, 0, 5, '#2b221b', twigs);
  for (let pass = 0; pass < 2; pass++) {
    for (const t of twigs) {
      const r = (w * 0.085) * (0.7 + rnd() * 0.8);
      const n = Math.floor(pass === 0 ? 46 : 20);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(rnd()) * r;
        const px = t.x + Math.cos(a) * rr * 1.25;
        const py = t.y + Math.sin(a) * rr * 0.85 - (pass === 1 ? r * 0.35 : 0);
        if (py > h - 30) continue;
        if (pass === 0) dab(g, px, py, 1.6 + rnd() * 2.4, 1.2 + rnd() * 1.6, rnd() * 3, hsl(88 + rnd() * 34, 30 + rnd() * 16, 9 + rnd() * 9));
        else dab(g, px, py, 1.1 + rnd() * 1.6, 0.8 + rnd() * 1.1, rnd() * 3, hsl(78 + rnd() * 30, 34 + rnd() * 16, 20 + rnd() * 12));
      }
    }
  }
};

/** Birch: pale slim trunk, airy crown of small bright leaves on hanging twigs. */
const paintBirch: Painter = (g, w, h, rnd) => {
  const cx = w / 2;
  const bottom = h - 3;
  const top = 24;
  const sway = (rnd() - 0.5) * 20;
  const trunkAt = (y: number) => cx + sway * Math.pow((bottom - y) / (bottom - top), 1.6);
  for (let y = bottom; y > top + 20; y -= 1.5) {
    const f = (bottom - y) / (bottom - top);
    const wd = 6 - f * 4.2;
    g.fillStyle = rnd() < 0.13 ? '#2a2622' : hsl(40, 9, 62 + rnd() * 10 - f * 14);
    g.fillRect(trunkAt(y) - wd / 2, y, wd, 2);
  }
  const twigs: Twig[] = [];
  for (let i = 0; i < 15; i++) {
    const f = 0.3 + rnd() * 0.66;
    const y = bottom - f * (bottom - top);
    const side = rnd() < 0.5 ? -1 : 1;
    const ang = Math.PI / 2 - side * (0.5 + rnd() * 0.6);
    growBranches(g, rnd, trunkAt(y), y, ang, (1.15 - f) * w * 0.3 + 10, 1.8, 1, 3, '#3a3029', twigs);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const t of twigs) {
      const n = pass === 0 ? 34 : 16;
      for (let k = 0; k < n; k++) {
        // leaves hang below the twig
        const px = t.x + (rnd() - 0.5) * 22;
        const py = t.y + rnd() * rnd() * 34 - 6;
        if (py > h * 0.8) continue;
        if (pass === 0) dab(g, px, py, 1 + rnd() * 1.6, 0.9 + rnd() * 1.2, rnd() * 3, hsl(84 + rnd() * 26, 34 + rnd() * 16, 11 + rnd() * 9));
        else dab(g, px, py - 2, 0.9 + rnd() * 1.2, 0.7 + rnd() * 0.9, rnd() * 3, hsl(72 + rnd() * 24, 40 + rnd() * 18, 24 + rnd() * 13));
      }
    }
  }
};

function treeTexture(paintTree: Painter, w: number, h: number, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  paintTree(g, w, h, mulberry32(seed));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Two crossed cards, wound on both sides, all lit as if facing the sky. */
function crossedCards(aspect: number): THREE.BufferGeometry {
  const hw = aspect / 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const addQuad = (ax: number, az: number, flip: boolean) => {
    const base = pos.length / 3;
    pos.push(-ax * hw, 0, -az * hw, ax * hw, 0, az * hw, ax * hw, 1, az * hw, -ax * hw, 1, -az * hw);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let i = 0; i < 4; i++) nrm.push(0, 1, 0);
    if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [ax, az] of [
    [1, 0],
    [0, 1],
  ]) {
    addQuad(ax, az, false);
    addQuad(ax, az, true);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return geo;
}

function buildTrees(group: THREE.Group): void {
  const rnd = mulberry32(21);
  const kinds: { paint: Painter; w: number; h: number; share: number; hMin: number; hMax: number; patch: number }[] = [
    { paint: paintSpruce, w: 256, h: 512, share: 0.3, hMin: 14, hMax: 25, patch: 0 },
    { paint: paintPine, w: 256, h: 512, share: 0.22, hMin: 16, hMax: 27, patch: 30 },
    { paint: paintBirch, w: 256, h: 512, share: 0.2, hMin: 11, hMax: 19, patch: 60 },
    { paint: paintBroadleaf, w: 384, h: 384, share: 0.28, hMin: 8, hMax: 15, patch: 90 },
  ];
  const total = 3000;
  const variants = 2;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);
  kinds.forEach((kind, ki) => {
    const geo = crossedCards(kind.w / kind.h);
    for (let v = 0; v < variants; v++) {
      const mat = new THREE.MeshLambertMaterial({
        map: treeTexture(kind.paint, kind.w, kind.h, 100 + ki * 17 + v * 5),
        alphaTest: 0.42,
      });
      const count = Math.floor((total * kind.share) / variants);
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      let placed = 0;
      let guard = 0;
      while (placed < count && guard++ < count * 30) {
        const th = rnd() * Math.PI * 2;
        const d = 2.5 + 250 * Math.pow(rnd(), 2.1);
        const r = lakeRadius(th) + d;
        const x = LAKE_CENTER.x + Math.cos(th) * r;
        const z = LAKE_CENTER.y + Math.sin(th) * r;
        if (Math.abs(x) < 7 && z > 4 && z < 26) continue; // keep the bank at the pier open
        // Each species keeps to its own stands.
        if (fbm(x / 30 + kind.patch, z / 30, 2) < 0.44 && d < 70) continue;
        const y = groundHeight(d, x, z) - 0.25;
        const h = kind.hMin + rnd() * (kind.hMax - kind.hMin);
        p.set(x, y, z);
        q.setFromAxisAngle(yAxis, rnd() * Math.PI * 2);
        s.set(h * (0.9 + rnd() * 0.25), h, h * (0.9 + rnd() * 0.25));
        m.compose(p, q, s);
        mesh.setMatrixAt(placed, m);
        const shade = 0.75 + rnd() * 0.45;
        color.setRGB(shade * (0.95 + rnd() * 0.12), shade, shade * (0.88 + rnd() * 0.14));
        mesh.setColorAt(placed, color);
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  });
}

/** [x, z, radius] of reed beds framing the view from the pier. */
const REED_BEDS: [number, number, number][] = [
  [-6.5, -5.5, 1.6],
  [-10.5, -11, 2.4],
  [7.5, -4.5, 1.5],
  [11.5, -10.5, 2.2],
  [-17, -19, 2.6],
  [18, -21, 2.8],
];

interface Swaying {
  uniforms: { uTime: { value: number } };
}

function swayMaterial(mat: THREE.MeshStandardMaterial, strength: number): Swaying {
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float swPhase = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7;
          float sw = sin(uTime * 1.5 + swPhase) + 0.5 * sin(uTime * 2.7 + swPhase * 1.7);
          float bendY = transformed.y * transformed.y;
          transformed.x += sw * ${strength.toFixed(3)} * bendY;
          transformed.z += cos(uTime * 1.1 + swPhase) * ${(strength * 0.5).toFixed(3)} * bendY;
        #endif`,
      );
  };
  return { uniforms };
}

function buildReeds(group: THREE.Group): Swaying[] {
  const rnd = mulberry32(33);
  const blade = strip(new THREE.ConeGeometry(0.014, 1, 4, 3, true));
  blade.translate(0, 0.5, 0);
  blade.computeVertexNormals();
  const head = strip(new THREE.CapsuleGeometry(0.02, 0.13, 3, 6));
  head.translate(0, 0.86, 0);
  head.computeVertexNormals();

  const bladeMat = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x3a2617, roughness: 0.95 });
  const sways = [swayMaterial(bladeMat, 0.055), swayMaterial(headMat, 0.055)];

  const maxBlades = 5200;
  const blades = new THREE.InstancedMesh(blade, bladeMat, maxBlades);
  const heads = new THREE.InstancedMesh(head, headMat, 900);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  let nb = 0;
  let nh = 0;
  const clumps = 330;
  for (let c = 0; c < clumps && nb < maxBlades; c++) {
    let cx: number;
    let cz: number;
    if (c < REED_BEDS.length * 9) {
      // Reed beds standing in the shallows either side of the casting lane.
      const bed = REED_BEDS[c % REED_BEDS.length];
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * bed[2];
      cx = bed[0] + Math.cos(a) * rr * 1.5;
      cz = bed[1] + Math.sin(a) * rr;
    } else {
      const th = rnd() * Math.PI * 2;
      if (fbm(Math.cos(th) * 3 + 5, Math.sin(th) * 3, 2) < 0.42) continue;
      const d0 = -0.3 - rnd() * 3.2;
      const R = lakeRadius(th);
      cx = LAKE_CENTER.x + Math.cos(th) * (R + d0);
      cz = LAKE_CENTER.y + Math.sin(th) * (R + d0);
    }
    if (Math.abs(cx) < 2.6 && cz > -4) continue; // keep the casting lane clear
    const size = 0.35 + rnd() * 0.9;
    const count = 10 + Math.floor(rnd() * 22);
    for (let i = 0; i < count && nb < maxBlades; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * size;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      if (shoreDist(x, z) > 0.3) continue;
      const h = 1.2 + rnd() * 1.3;
      p.set(x, -0.25, z);
      e.set((rnd() - 0.5) * 0.22, rnd() * Math.PI, (rnd() - 0.5) * 0.22);
      q.setFromEuler(e);
      s.set(1 + rnd() * 0.8, h, 1 + rnd() * 0.8);
      m.compose(p, q, s);
      blades.setMatrixAt(nb, m);
      color.setHSL(0.2 + rnd() * 0.07, 0.35 + rnd() * 0.2, 0.2 + rnd() * 0.12);
      if (rnd() < 0.18) color.setHSL(0.11, 0.35, 0.3); // last year's dry stems
      blades.setColorAt(nb, color);
      nb++;
      if (rnd() < 0.16 && nh < 900) {
        heads.setMatrixAt(nh++, m);
      }
    }
  }
  blades.count = nb;
  heads.count = nh;
  blades.frustumCulled = false;
  heads.frustumCulled = false;
  group.add(blades, heads);
  return sways;
}

function buildLilyPads(group: THREE.Group): void {
  const rnd = mulberry32(57);
  const geo = new THREE.CircleGeometry(1, 14, 0.22, Math.PI * 2 - 0.44);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  const count = 260;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);
  let n = 0;
  for (let c = 0; c < 40 && n < count; c++) {
    let cx: number;
    let cz: number;
    if (c < REED_BEDS.length * 2) {
      const bed = REED_BEDS[c % REED_BEDS.length];
      const toLane = bed[0] > 0 ? -1 : 1;
      cx = bed[0] + toLane * (bed[2] + 0.6 + rnd() * 1.4);
      cz = bed[1] + (rnd() - 0.5) * 3;
    } else {
      const th = rnd() * Math.PI * 2;
      const d0 = -2.5 - rnd() * 6;
      const R = lakeRadius(th);
      cx = LAKE_CENTER.x + Math.cos(th) * (R + d0);
      cz = LAKE_CENTER.y + Math.sin(th) * (R + d0);
    }
    if (Math.abs(cx) < 3.2 && cz > -6) continue;
    const k = 4 + Math.floor(rnd() * 9);
    for (let i = 0; i < k && n < count; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * 1.6;
      const r = 0.1 + rnd() * 0.13;
      p.set(cx + Math.cos(a) * rr, 0.012 + rnd() * 0.004, cz + Math.sin(a) * rr);
      q.setFromAxisAngle(yAxis, rnd() * Math.PI * 2);
      s.set(r, 1, r * (0.85 + rnd() * 0.3));
      m.compose(p, q, s);
      mesh.setMatrixAt(n, m);
      color.setHSL(0.27 + rnd() * 0.05, 0.4 + rnd() * 0.15, 0.1 + rnd() * 0.06);
      mesh.setColorAt(n, color);
      n++;
    }
  }
  mesh.count = n;
  mesh.frustumCulled = false;
  group.add(mesh);
}

function buildPier(group: THREE.Group): void {
  const rnd = mulberry32(77);
  const wood = makeWoodTexture();
  const plankMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.92, metalness: 0 });
  const plankGeo = new THREE.BoxGeometry(1.5, 0.04, 0.145);
  const startZ = 11.5;
  const pitch = 0.158;
  const n = Math.floor((startZ - PIER_END_Z) / pitch);
  const planks = new THREE.InstancedMesh(plankGeo, plankMat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    p.set((rnd() - 0.5) * 0.03, PIER_TOP_Y - 0.02 + (rnd() - 0.5) * 0.006, PIER_END_Z + 0.08 + i * pitch);
    e.set((rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.01);
    q.setFromEuler(e);
    m.compose(p, q, s);
    planks.setMatrixAt(i, m);
    const v = 0.72 + rnd() * 0.3;
    color.setRGB(v, v * (0.97 + rnd() * 0.04), v * (0.92 + rnd() * 0.06));
    planks.setColorAt(i, color);
  }
  group.add(planks);

  const beamMat = new THREE.MeshStandardMaterial({ map: wood, color: 0x8d8478, roughness: 0.95 });
  for (const x of [-0.66, 0.66]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, startZ - PIER_END_Z), beamMat);
    beam.position.set(x, PIER_TOP_Y - 0.11, (startZ + PIER_END_Z) / 2);
    group.add(beam);
  }
  const postGeo = new THREE.CylinderGeometry(0.07, 0.08, 3.6, 8);
  const postMat = new THREE.MeshStandardMaterial({ map: wood, color: 0x6d655b, roughness: 1 });
  for (let z = PIER_END_Z + 0.15; z < 8; z += 2.3) {
    for (const x of [-0.74, 0.74]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, PIER_TOP_Y + 0.22 - 1.8, z);
      post.rotation.set((rnd() - 0.5) * 0.04, rnd() * 3, (rnd() - 0.5) * 0.04);
      group.add(post);
    }
  }
}

export interface World {
  scene: THREE.Scene;
  water: Water;
  environment: THREE.Texture;
  update(t: number): void;
  /** 0 = sober morning, 1 = everything golden, hazy and a little wavy. */
  setMood(high: number): void;
}

export function createWorld(renderer: THREE.WebGLRenderer, lowPower: boolean): World {
  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(FOG_COLOR, 0.0058);
  const fogBase = new THREE.Color(FOG_COLOR);
  const fogHigh = new THREE.Color(0xe6a583);
  scene.fog = fog;

  // Sky drives both the backdrop and the image-based lighting.
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const su = sky.material.uniforms;
  su.turbidity.value = 5.5;
  su.rayleigh.value = 2.3;
  su.mieCoefficient.value = 0.0045;
  su.mieDirectionalG.value = 0.86;
  su.sunPosition.value.copy(SUN_DIR);
  if (su.cloudCoverage) su.cloudCoverage.value = 0.5;
  if (su.cloudDensity) su.cloudDensity.value = 0.45;
  if (su.cloudElevation) su.cloudElevation.value = 0.45;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky);
  const envTarget = pmrem.fromScene(envScene, 0.02);
  scene.add(sky);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xffc48c, 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(200);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xb9cdf2, 0x3b3626, 0.55));

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      transparent: true,
      opacity: 0.5,
    }),
  );
  glow.position.copy(SUN_DIR).multiplyScalar(3000);
  glow.scale.setScalar(1500);
  scene.add(glow);

  const water = new Water(new THREE.CircleGeometry(92, 72), {
    textureWidth: lowPower ? 384 : 768,
    textureHeight: lowPower ? 384 : 768,
    waterNormals: makeWaterNormals(512),
    sunDirection: SUN_DIR.clone(),
    sunColor: 0xffd2a0,
    waterColor: 0x16261c,
    distortionScale: 1.6,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE_CENTER.x, 0, LAKE_CENTER.y);
  water.material.uniforms.size.value = 1;
  // The stock shader layers the ripple map at ocean scale; a lake at dawn wants
  // fine ripple, glassy lanes between wind patches, and less mirror distortion.
  water.material.fragmentShader = water.material.fragmentShader
    .replace('vec2 uv0 = ( uv / 103.0 ) + vec2(time / 17.0, time / 29.0);', 'vec2 uv0 = uv / 4.7 + vec2( time / 23.0, time / 31.0 );')
    .replace('vec2 uv1 = uv / 107.0-vec2( time / -19.0, time / 31.0 );', 'vec2 uv1 = uv / 2.9 - vec2( time / 19.0, time / -27.0 );')
    .replace('vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );', 'vec2 uv2 = uv / 11.3 + vec2( time / -53.0, time / 47.0 );')
    .replace('vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );', 'vec2 uv3 = uv / 27.0 - vec2( time / 83.0, time / 71.0 );')
    .replace(
      'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
      `float windPatch = texture2D( normalSampler, worldPosition.xz / 160.0 + time / 700.0 ).r
          + texture2D( normalSampler, worldPosition.zx / 71.0 - time / 500.0 ).g;
        float ripple = mix( 0.22, 0.95, smoothstep( 0.86, 1.14, windPatch ) );
        vec3 surfaceNormal = normalize( noise.xzy * vec3( ripple, 1.0, ripple ) );`,
    )
    .replace('( 0.001 + 1.0 / distance ) * distortionScale', 'min( 0.03, ( 0.001 + 1.0 / distance ) * distortionScale )');
  scene.add(water);

  const land = new THREE.Group();
  land.add(buildGround());
  buildTrees(land);
  const sways = buildReeds(land);
  buildLilyPads(land);
  buildPier(land);
  scene.add(land);

  return {
    scene,
    water,
    environment: envTarget.texture,
    setMood(high: number) {
      const h = Math.min(1, Math.max(0, high));
      renderer.toneMappingExposure = 0.5 * (1 + 0.16 * h);
      fog.color.copy(fogBase).lerp(fogHigh, h * 0.7);
      fog.density = 0.0058 * (1 + 0.3 * h);
      glow.material.opacity = 0.5 + 0.4 * h;
      glow.scale.setScalar(1500 * (1 + 0.6 * h));
      sun.intensity = 3.2 * (1 + 0.25 * h);
      su.rayleigh.value = 2.3 + 0.9 * h;
      water.material.uniforms.distortionScale.value = 1.6 + 1.6 * h;
    },
    update(t: number) {
      water.material.uniforms.time.value = t * 0.55;
      su.time.value = t;
      for (const s of sways) s.uniforms.uTime.value = t;
    },
  };
}
