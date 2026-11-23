import * as THREE from 'three';

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  r0: number;
  r1: number;
  strength: number;
  delay: number;
}

/** Expanding rings on the surface plus droplets thrown by a splash. */
export class WaterFx {
  readonly object = new THREE.Group();
  private readonly rings: Ring[] = [];
  private readonly drops: THREE.Points;
  private readonly dropPos: Float32Array;
  private readonly dropVel: Float32Array;
  private readonly dropLife: Float32Array;
  private nextDrop = 0;

  constructor() {
    const ringGeo = new THREE.RingGeometry(0.93, 1, 56, 1);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfff1dc,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.object.add(mesh);
      this.rings.push({ mesh, mat, age: 0, life: 0, r0: 0, r1: 1, strength: 0, delay: 0 });
    }

    const n = 260;
    this.dropPos = new Float32Array(n * 3).fill(-999);
    this.dropVel = new Float32Array(n * 3);
    this.dropLife = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3));
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 32;
    const g = sprite.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,250,240,0.55)');
    grad.addColorStop(1, 'rgba(255,250,240,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    const mat = new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(sprite),
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      color: 0xfff6ea,
    });
    this.drops = new THREE.Points(geo, mat);
    this.drops.frustumCulled = false;
    this.object.add(this.drops);
  }

  /** Concentric rings spreading from (x, z). */
  ripple(x: number, z: number, size = 1, strength = 0.5, count = 3): void {
    for (let k = 0; k < count; k++) {
      const ring = this.rings.find((r) => !r.mesh.visible);
      if (!ring) return;
      ring.mesh.visible = true;
      ring.mesh.position.set(x, 0.006 + k * 0.001, z);
      ring.age = 0;
      ring.delay = k * 0.28;
      ring.life = 2.2 + size * 1.2;
      ring.r0 = 0.04;
      ring.r1 = 0.7 + size * 1.5;
      ring.strength = strength * (1 - k * 0.22);
      ring.mat.opacity = 0;
      ring.mesh.scale.setScalar(ring.r0);
    }
  }

  splash(x: number, z: number, power = 1): void {
    const count = Math.floor(18 + power * 34);
    for (let i = 0; i < count; i++) {
      const k = this.nextDrop;
      this.nextDrop = (this.nextDrop + 1) % this.dropLife.length;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 1.5) * power;
      this.dropPos[k * 3] = x + Math.cos(a) * 0.05;
      this.dropPos[k * 3 + 1] = 0.02;
      this.dropPos[k * 3 + 2] = z + Math.sin(a) * 0.05;
      this.dropVel[k * 3] = Math.cos(a) * sp;
      this.dropVel[k * 3 + 1] = (1.2 + Math.random() * 2.6) * Math.sqrt(power);
      this.dropVel[k * 3 + 2] = Math.sin(a) * sp;
      this.dropLife[k] = 1.6;
    }
    this.ripple(x, z, power, 0.6, 3);
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - t, 2.2);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mat.opacity = r.strength * Math.pow(1 - t, 1.6) * Math.min(1, t * 12);
    }
    let any = false;
    for (let k = 0; k < this.dropLife.length; k++) {
      if (this.dropLife[k] <= 0) continue;
      any = true;
      this.dropLife[k] -= dt;
      this.dropVel[k * 3 + 1] -= 9.8 * dt;
      this.dropPos[k * 3] += this.dropVel[k * 3] * dt;
      this.dropPos[k * 3 + 1] += this.dropVel[k * 3 + 1] * dt;
      this.dropPos[k * 3 + 2] += this.dropVel[k * 3 + 2] * dt;
      if (this.dropPos[k * 3 + 1] < 0 || this.dropLife[k] <= 0) {
        this.dropLife[k] = 0;
        this.dropPos[k * 3 + 1] = -999;
      }
    }
    if (any) this.drops.geometry.getAttribute('position').needsUpdate = true;
  }
}
