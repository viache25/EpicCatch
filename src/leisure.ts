import * as THREE from 'three';
import { Sfx } from './audio';
import { clamp, mulberry32 } from './noise';

export type LeisureKind = 'beer' | 'cig' | 'joint';

export interface LeisureLabels {
  cig: string;
  joint: string;
}

type ActionKind = 'sip' | 'light' | 'drag' | 'roll';

interface Action {
  kind: ActionKind;
  item: LeisureKind;
  t: number;
  dur: number;
  fired: number;
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

const SIPS_PER_BOTTLE = 8;
const _tip = new THREE.Vector3();

function ease(u: number): number {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
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
    const filterMat = new THREE.MeshStandardMaterial({
      color: joint ? 0xd9d2bd : 0xc98a46,
      roughness: 0.85,
      envMap: env,
    });
    const filter = new THREE.Mesh(new THREE.CylinderGeometry(this.r0, this.r0, this.filterLen, 14), filterMat);
    filter.position.y = this.filterLen / 2;
    const bodyGeo = new THREE.CylinderGeometry(this.r1, this.r0, 1, 14, 1, true);
    bodyGeo.translate(0, 0.5, 0);
    this.body = new THREE.Mesh(
      bodyGeo,
      new THREE.MeshStandardMaterial({ map: paperTexture(joint), roughness: 0.9, envMap: env, side: THREE.DoubleSide }),
    );
    this.body.position.y = this.filterLen;
    this.ash = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 12),
      new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 1 }),
    );
    this.emberMat = new THREE.MeshBasicMaterial({ color: 0x7a1c05, toneMapped: false });
    this.ember = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), this.emberMat);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sprite,
        color: 0xff7a22,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    );
    this.group.add(filter, this.body, this.ash, this.ember, this.glow);
    if (joint) {
      // Unlit joints end in a twist of paper.
      const twist = new THREE.Mesh(new THREE.ConeGeometry(this.r1, 0.011, 10), this.body.material);
      twist.name = 'twist';
      this.group.add(twist);
    }
    this.layout();
  }

  /** World-scale position of the burning tip in the group's local space. */
  tipY(): number {
    return this.filterLen + this.bodyLen * (0.25 + 0.75 * this.left);
  }

  layout(): void {
    const len = this.bodyLen * (0.25 + 0.75 * this.left);
    const rTip = this.r0 + (this.r1 - this.r0) * (len / this.bodyLen);
    this.body.scale.set(rTip / this.r1, len, rTip / this.r1);
    const top = this.filterLen + len;
    this.ember.visible = this.ash.visible = this.lit;
    this.ember.scale.set(rTip * 0.96, 0.0025, rTip * 0.96);
    this.ember.position.y = top + 0.001;
    this.ash.scale.set(rTip * 0.9, 0.004, rTip * 0.9);
    this.ash.position.y = top + 0.0043;
    this.glow.position.y = top + 0.002;
    const twist = this.group.getObjectByName('twist');
    if (twist) {
      twist.visible = !this.lit;
      twist.position.y = top + 0.0055;
    }
  }

  update(dt: number): void {
    this.heat = Math.max(0, this.heat - dt * 1.2);
    const h = this.lit ? 0.25 + 0.75 * this.heat : 0;
    this.emberMat.color.setRGB(0.42 + 1.6 * h, 0.07 + 0.55 * h * h, 0.02 + 0.1 * h * h);
    this.glow.material.opacity = this.lit ? 0.15 + 0.75 * this.heat : 0;
    this.glow.scale.setScalar(0.012 + 0.05 * this.heat);
  }
}

/** Beer, cigarettes and a hand-rolled joint for the long wait between bites. */
export class Leisure {
  readonly rig = new THREE.Group();
  /** 0..1, raised by beer; makes the view sway. */
  drunk = 0;
  /** 0..1, raised by the joint; warms and saturates the picture. */
  high = 0;
  onLabels: (labels: LeisureLabels) => void = () => {};
  onToast: (text: string) => void = () => {};

  private readonly bottle = new THREE.Group();
  private readonly cig: Smoke;
  private readonly joint: Smoke;
  private readonly paper = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private action: Action | null = null;
  private sipsLeft = 0;
  private jointRolled = false;
  private wisp = 0;
  private flame = 0;
  private readonly flameSprite: THREE.Sprite;

  constructor(
    camera: THREE.Camera,
    env: THREE.Texture | null,
    private readonly audio: Sfx,
  ) {
    camera.add(this.rig);
    const sprite = softSprite();
    const smoke = smokeSprite();

    // Bottle: brown glass, paper label, crown lip.
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
    const glass = new THREE.Mesh(
      new THREE.LatheGeometry(
        profile.map(([r, y]) => new THREE.Vector2(r, y)),
        28,
      ),
      new THREE.MeshPhysicalMaterial({
        color: 0x3a1c07,
        emissive: 0x4a2206,
        emissiveIntensity: 0.9,
        roughness: 0.16,
        clearcoat: 0.6,
        clearcoatRoughness: 0.08,
        envMap: env,
        envMapIntensity: 0.55,
        side: THREE.DoubleSide,
      }),
    );
    const labelGeo = new THREE.CylinderGeometry(0.0336, 0.0336, 0.08, 28, 1, true);
    labelGeo.translate(0, 0.078, 0);
    const label = new THREE.Mesh(labelGeo, new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.75, envMap: env }));
    label.rotation.y = Math.PI * 0.25;
    this.bottle.add(glass, label);
    this.bottle.visible = false;

    this.cig = new Smoke(false, env, sprite);
    this.joint = new Smoke(true, env, sprite);
    this.cig.group.visible = false;
    this.joint.group.visible = false;

    // Rolling paper with the herb laid along it.
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(0.075, 0.04),
      new THREE.MeshStandardMaterial({ map: paperTexture(false), roughness: 0.9, side: THREE.DoubleSide }),
    );
    sheet.name = 'sheet';
    this.paper.add(sheet);
    const herbMat = new THREE.MeshStandardMaterial({ color: 0x4a5a22, roughness: 1, flatShading: true });
    const rnd = mulberry32(4);
    for (let i = 0; i < 26; i++) {
      const bud = new THREE.Mesh(new THREE.DodecahedronGeometry(0.0022 + rnd() * 0.0022, 0), herbMat);
      bud.position.set((rnd() - 0.5) * 0.062, (rnd() - 0.5) * 0.007, 0.002 + rnd() * 0.003);
      bud.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      bud.name = 'herb';
      this.paper.add(bud);
    }
    this.paper.visible = false;

    this.flameSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sprite,
        color: 0xffb24a,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    );
    this.rig.add(this.bottle, this.cig.group, this.joint.group, this.paper, this.flameSprite);

    for (let i = 0; i < 110; i++) {
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
    return {
      cig: this.cig.lit ? 'Затяжка' : 'Сигарета',
      joint: this.joint.lit ? 'Затяжка' : this.jointRolled ? 'Прикурить' : 'Скрутить',
    };
  }

  busy(): boolean {
    return this.action !== null;
  }

  request(kind: LeisureKind): void {
    if (this.action) return;
    if (kind === 'beer') {
      if (this.sipsLeft <= 0) {
        this.sipsLeft = SIPS_PER_BOTTLE;
        this.audio.capOff();
        this.onToast('Открыли холодное');
      }
      this.action = { kind: 'sip', item: 'beer', t: 0, dur: 2.6, fired: 0 };
      return;
    }
    const other = kind === 'cig' ? this.joint : this.cig;
    if (other.lit) {
      this.onToast(kind === 'cig' ? 'Сначала докурите косяк' : 'Сначала докурите сигарету');
      return;
    }
    if (kind === 'joint' && !this.jointRolled) {
      this.joint.left = 1;
      this.joint.lit = false;
      this.joint.layout();
      this.action = { kind: 'roll', item: 'joint', t: 0, dur: 3.4, fired: 0 };
      return;
    }
    const item = kind === 'cig' ? this.cig : this.joint;
    if (!item.lit) {
      if (kind === 'cig') {
        item.left = 1;
        item.layout();
      }
      this.action = { kind: 'light', item: kind, t: 0, dur: 1.5, fired: 0 };
    } else {
      this.action = { kind: 'drag', item: kind, t: 0, dur: 3.2, fired: 0 };
    }
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
   * @param allowed false while both hands are busy with the fish
   * @param fov current vertical FOV in degrees; `baseFov` is the unzoomed one
   */
  update(dt: number, t: number, allowed: boolean, fov: number, baseFov: number, aspect: number): void {
    // Keep hand-held things the same size on screen while the view zooms on the float.
    const tRef = Math.tan(THREE.MathUtils.degToRad(baseFov / 2));
    const k = Math.tan(THREE.MathUtils.degToRad(fov / 2)) / tRef;
    this.rig.scale.set(k, k, 1);
    const d = 0.4;
    const hw = tRef * aspect * d;
    const hh = tRef * d;
    const size = aspect < 1 ? 0.8 : 1;
    // Keep things clear of the controls along the bottom edge.
    const lift = hh * (aspect < 1 ? 0.5 : 0.14);

    this.drunk = Math.max(0, this.drunk - dt * 0.0016);
    this.high = Math.max(0, this.high - dt * 0.011);

    if (!allowed) this.action = null;
    const a = this.action;
    if (a) a.t += dt;
    const u = a ? a.t / a.dur : 0;

    // --- beer
    const sip = a?.kind === 'sip' ? a : null;
    this.bottle.visible = !!sip;
    if (sip) {
      const up = ease(u / 0.28) * (1 - ease((u - 0.74) / 0.26));
      const tip = ease((u - 0.22) / 0.2) * (1 - ease((u - 0.66) / 0.14));
      // Comes up from the left, then tips mouth-first toward the face so the base lifts into view.
      this.bottle.position.set(-0.45 * hw * (1 - up), lift + hh * (-2.6 + 1.2 * up + 0.9 * tip), -d + 0.05 * tip);
      this.bottle.rotation.set(0.15 + 1.72 * tip, 0.4, 0.2 * (1 - up));
      this.bottle.scale.setScalar(size);
      if (sip.fired === 0 && u > 0.36) {
        sip.fired = 1;
        this.audio.glug();
      }
      if (sip.fired === 1 && u > 0.52) {
        sip.fired = 2;
        this.audio.glug();
      }
      if (u >= 1) {
        this.sipsLeft--;
        this.drunk = Math.min(1, this.drunk + 0.04);
        this.action = null;
        if (this.sipsLeft <= 0) this.onToast('Бутылка кончилась');
      }
    }

    // --- rolling
    const roll = a?.kind === 'roll' ? a : null;
    this.paper.visible = !!roll && u < 0.62;
    if (roll) {
      const inn = ease(u / 0.15);
      const curl = ease((u - 0.2) / 0.42);
      this.paper.position.set(0, lift + hh * (-1.6 + 1.05 * inn), -d + 0.05);
      this.paper.rotation.set(-1.0, 0, Math.sin(t * 9) * 0.03 * curl);
      this.paper.scale.set(size * 1.3, size * 1.3 * (1 - 0.82 * curl), size * 1.3);
      if (roll.fired < Math.floor(u * 7)) {
        roll.fired++;
        if (u > 0.15 && u < 0.85) this.audio.rustle();
      }
      if (u >= 1) {
        this.jointRolled = true;
        this.action = null;
        this.onToast('Скрутили. Можно прикуривать');
      }
    }

    // --- smokables
    for (const kind of ['cig', 'joint'] as const) {
      const item = kind === 'cig' ? this.cig : this.joint;
      const mine = a && a.item === kind ? a : null;
      const rolling = kind === 'joint' && !!roll;
      const held = item.lit || (mine !== null && mine.kind !== 'roll') || (rolling && u > 0.5);
      item.group.visible = allowed && held;
      let toMouth = 0;
      if (mine?.kind === 'drag') toMouth = ease(u / 0.22) * (1 - ease((u - 0.55) / 0.2));
      if (mine?.kind === 'light') toMouth = ease(u / 0.3) * (1 - ease((u - 0.75) / 0.25)) * 0.8;
      const appear = rolling ? ease((u - 0.5) / 0.3) : 1;
      // Rest: held low on the left, burning end up. Mouth: end-on at the bottom centre.
      const x = -0.62 * hw * (1 - toMouth) + (rolling ? 0.62 * hw * (1 - ease((u - 0.8) / 0.2)) : 0);
      const y = (lift + hh * (-1.02 + 0.04 * Math.sin(t * 0.7))) * (1 - toMouth) + (lift * 0.7 + hh * -1.1) * toMouth - (1 - appear) * hh;
      item.group.position.set(x, y, -d + 0.1 * toMouth);
      item.group.rotation.set(-0.35 - 0.95 * toMouth, rolling ? t * 6 * (1 - ease((u - 0.8) / 0.2)) : 0, -0.45 * (1 - toMouth) + (rolling ? 1.2 * (1 - ease((u - 0.8) / 0.2)) : 0));
      item.group.scale.setScalar(size * 1.25);

      if (mine?.kind === 'light') {
        if (mine.fired === 0 && u > 0.3) {
          mine.fired = 1;
          this.audio.lighter();
          this.flame = 0.6;
        }
        if (mine.fired === 1 && u > 0.55) {
          mine.fired = 2;
          item.lit = true;
          item.heat = 1;
          item.layout();
          this.onLabels(this.labels());
        }
        if (u >= 1) this.action = null;
      }
      if (mine?.kind === 'drag') {
        if (u > 0.2 && u < 0.55) {
          item.heat = Math.min(1, item.heat + dt * 5);
          item.left = Math.max(0, item.left - dt * (kind === 'joint' ? 0.11 : 0.085));
          item.layout();
        }
        if (mine.fired === 0 && u > 0.2) {
          mine.fired = 1;
          this.audio.inhale();
        }
        if (mine.fired === 1 && u > 0.72) {
          mine.fired = 2;
          this.audio.exhale();
          if (kind === 'joint') this.high = Math.min(1, this.high + 0.24);
        }
        if (u > 0.72 && u < 0.95) {
          // Breathe out a cloud that rolls away over the water.
          const n = kind === 'joint' ? 7 : 5;
          for (let i = 0; i < n; i++) {
            if (Math.random() < dt * 22) {
              this.emit(
                (Math.random() - 0.5) * 0.05,
                lift * 0.6 - hh * 1.0 + Math.random() * 0.02,
                -0.3,
                (Math.random() - 0.5) * 0.16,
                0.06 + Math.random() * 0.14,
                -0.2 - Math.random() * 0.3,
                1.8 + Math.random() * 1.8,
                0.03 + Math.random() * 0.03,
                0.16 + Math.random() * 0.2,
                (kind === 'joint' ? 0.5 : 0.38) * (0.6 + Math.random() * 0.4),
              );
            }
          }
        }
        if (u >= 1) this.action = null;
      }

      if (item.lit) {
        // Smoulders on its own between drags.
        item.left = Math.max(0, item.left - dt * 0.0045);
        if (Math.random() < dt * 2) item.layout();
        this.wisp -= dt;
        if (this.wisp <= 0 && item.group.visible && toMouth < 0.3) {
          this.wisp = 0.09;
          item.group.updateMatrix();
          _tip.set(0, item.tipY() + 0.004, 0).applyMatrix4(item.group.matrix);
          this.emit(_tip.x, _tip.y, _tip.z, (Math.random() - 0.5) * 0.02 + 0.015, 0.06 + Math.random() * 0.03, -0.01, 1.9, 0.012, 0.09, 0.5);
        }
        if (item.left <= 0.02 && !mine) {
          item.lit = false;
          item.layout();
          if (kind === 'joint') {
            this.jointRolled = false;
            this.onToast('Красота-то какая…');
          } else {
            this.onToast('Окурок — в банку, не в озеро');
          }
          this.onLabels(this.labels());
        }
      }
      item.update(dt);
    }

    // Lighter flame.
    this.flame = Math.max(0, this.flame - dt);
    this.flameSprite.material.opacity = Math.min(1, this.flame * 3);
    if (this.flame > 0) {
      this.flameSprite.position.set(0.012, lift * 0.7 - hh * 0.95, -d + 0.07);
      this.flameSprite.scale.setScalar(0.05 + Math.random() * 0.012);
    }

    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      const f = p.age / p.life;
      if (f >= 1) {
        p.sprite.visible = false;
        continue;
      }
      p.vel.x += (Math.sin(t * 1.7 + p.s1 * 40) * 0.02 - p.vel.x * 0.4) * dt;
      p.vel.y += 0.012 * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.s0 + (p.s1 - p.s0) * Math.sqrt(f));
      p.sprite.material.opacity = p.alpha * Math.min(1, f * 7) * Math.pow(1 - f, 1.4);
    }
  }
}
