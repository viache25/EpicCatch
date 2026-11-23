import * as THREE from 'three';
import { Sfx } from './audio';
import { buildFish, rollCatch, type Catch, type FishModel } from './fish';
import { WaterFx } from './fx';
import { Leisure } from './leisure';
import { clamp, damp, lerp } from './noise';
import { FishingLine, Rod, createFloat } from './rod';
import { formatKg, UI } from './ui';
import { EYE, PIER_END_Z, PIER_TOP_Y, shoreDist, type World } from './world';

type State =
  | 'menu'
  | 'idle'
  | 'charging'
  | 'casting'
  | 'waiting'
  | 'bite'
  | 'fight'
  | 'landing'
  | 'card'
  | 'retrieve'
  | 'lost';

/** Where casts are measured from: the water under the end of the pier. */
const ORIGIN = new THREE.Vector3(0, 0, PIER_END_Z);
const FLOAT_REST = -0.124;
const UP = new THREE.Vector3(0, 1, 0);
/** How far the eye drops when the angler sits down to wait. */
const SIT_DROP = 0.52;

interface Bite {
  catch: Catch;
  phase: 'nibble' | 'take';
  nibbles: number;
  next: number;
  left: number;
  dirX: number;
  dirZ: number;
  age: number;
}

interface Fight {
  catch: Catch;
  dist: number;
  bearing: number;
  bearingVel: number;
  stamina: number;
  tension: number;
  running: boolean;
  timer: number;
  slack: number;
  over: number;
  wake: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _base = new THREE.Vector3();
const _pull = new THREE.Vector3();

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export class Game {
  state: State = 'menu';
  private stateT = 0;
  private t = 0;
  private pressed = false;

  private aim = 0;
  private power = 0;

  private readonly rod: Rod;
  private readonly line = new FishingLine();
  private readonly float: THREE.Group;
  private readonly fx = new WaterFx();
  private readonly fill = new THREE.PointLight(0xfff1de, 0.5, 5, 1.2);
  private readonly stand = new THREE.Group();
  private readonly standPost: THREE.Mesh;
  private readonly rodBase = new THREE.Vector3();
  private eyeDrop = 0;
  /** Looking closely at the float rather than taking in the lake. */
  private watch = false;
  private moodShown = -1;
  /** Clock for water and sky; runs slow when the angler is high. */
  worldTime = 0;
  private rodPitch = 0.62;
  private rodYaw = 0;
  private rodBend = 0.04;
  private yank = 0;

  private readonly floatPos = new THREE.Vector3();
  private dip = 0;
  private dipVel = 0;
  private dipTarget = 0;
  private tilt = 0;
  private tiltTarget = 0;

  private readonly castFrom = new THREE.Vector3();
  private readonly castTo = new THREE.Vector3();
  private castDur = 1;
  private castLaunched = false;

  private biteTimer = 0;
  private bite: Bite | null = null;
  private fight: Fight | null = null;
  private landed: Catch | null = null;
  private fish: FishModel | null = null;
  private readonly fishFrom = new THREE.Vector3();
  private readonly retrieveFrom = new THREE.Vector3();

  private count = 0;
  private totalKg = 0;
  private jumpTimer = 4;

  private readonly look = new THREE.Vector3(0, 0.6, -16);
  private fov = 50;

  constructor(
    private readonly world: World,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly ui: UI,
    private readonly audio: Sfx,
    private readonly leisure: Leisure,
  ) {
    this.rod = new Rod(world.environment);
    this.float = createFloat(world.environment);
    world.scene.add(this.rod.object, this.line.object, this.float, this.fx.object);
    this.fov = this.baseFov();
    camera.fov = this.fov;
    camera.updateProjectionMatrix();

    world.scene.add(camera);
    // The sun is in the angler's face, so hands and the catch get a soft fill from the near side.
    this.fill.position.set(0, 0.15, 0.1);
    camera.add(this.fill);
    this.leisure.onToast = (text) => ui.toast(text);
    this.leisure.onLabels = (labels) => ui.setLeisureLabels(labels);
    this.leisure.pierBottle.position.set(-0.5, PIER_TOP_Y, -0.35);
    world.scene.add(this.leisure.pierBottle);
    ui.onLeisure = (kind, down) => {
      if (!down) this.leisure.release(kind);
      else if (this.leisureAllowed()) this.leisure.press(kind);
      ui.setLeisureLabels(this.leisure.labels());
    };
    ui.onTap = () => {
      if (this.state === 'waiting') {
        this.watch = !this.watch;
        this.waitingHint();
      }
    };

    // Rod rest: a steel fork on a post, set up wherever the rod is laid down.
    const steel = new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.45, metalness: 0.85, envMap: world.environment });
    const postGeo = new THREE.CylinderGeometry(0.007, 0.007, 1, 8);
    postGeo.translate(0, 0.5, 0);
    this.standPost = new THREE.Mesh(postGeo, steel);
    const fork = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 14, Math.PI), steel);
    fork.rotation.z = Math.PI;
    fork.name = 'fork';
    this.stand.add(this.standPost, fork);
    this.stand.visible = false;
    world.scene.add(this.stand);
    this.rodBase.copy(EYE);

    ui.onPress = () => this.press();
    ui.onRelease = () => this.release();
    ui.onAim = (dx) => {
      if (this.state === 'idle' || this.state === 'charging') this.aim = clamp(this.aim + dx * 1.4, -0.62, 0.62);
    };
  }

  start(): void {
    this.ui.showHud();
    this.audio.start();
    this.enter('idle');
    this.ui.toast('Ведите пальцем по экрану, чтобы выбрать место заброса', 4600);
  }

  /** Hands are free only while the rod is on its rest. */
  private leisureAllowed(): boolean {
    return this.state === 'waiting' || this.state === 'bite';
  }

  private waitingHint(): void {
    this.ui.setHint(this.watch ? 'Следите за поплавком' : 'Нажмите на воду — смотреть на поплавок');
  }

  /** Builds every shader up front so nothing stutters the first time it appears. */
  warmUp(renderer: THREE.WebGLRenderer): void {
    const dummy = buildFish(rollCatch(Math.random, 'roach'), this.world.environment);
    dummy.group.position.set(0, 1, -3);
    this.world.scene.add(dummy.group);
    this.leisure.warmUp(true);
    this.fx.warmUp(true);
    this.stand.visible = true;
    renderer.compile(this.world.scene, this.camera);
    this.leisure.warmUp(false);
    this.fx.warmUp(false);
    this.stand.visible = false;
    // Kept in the scene, hidden, so the fish shaders stay cached.
    dummy.group.visible = false;
  }

  private baseFov(): number {
    return this.camera.aspect < 1 ? 70 : 50;
  }

  /** Vertical FOV that fits `span` metres across the narrow side of the screen at `dist`. */
  private zoomFov(span: number, dist: number): number {
    const a = Math.min(1, this.camera.aspect);
    const f = THREE.MathUtils.radToDeg(2 * Math.atan(span / (2 * dist * a)));
    return Math.min(this.baseFov(), f);
  }

  /** Metres of water shown across the narrow side of the screen while watching the float. */
  private floatSpan(): number {
    return this.camera.aspect < 1 ? 1.7 : 2.5;
  }

  private enter(state: State): void {
    this.state = state;
    this.stateT = 0;
    const ui = this.ui;
    switch (state) {
      case 'idle':
        ui.setAction('Заброс');
        ui.setHint('Удерживайте кнопку — заброс');
        ui.showPower(null);
        ui.showTension(null);
        this.float.visible = true;
        this.dip = this.dipVel = this.dipTarget = 0;
        this.tilt = this.tiltTarget = 0;
        break;
      case 'charging':
        ui.setHint('Отпустите, чтобы забросить');
        break;
      case 'casting':
        ui.setAction('');
        ui.setHint('');
        ui.showPower(null);
        break;
      case 'waiting':
        ui.setAction('Подсечка');
        this.watch = false;
        this.waitingHint();
        break;
      case 'fight':
        ui.setAction('Мотать');
        break;
      case 'landing':
      case 'card':
      case 'retrieve':
      case 'lost':
        ui.setAction('');
        ui.setHint('');
        ui.showTension(null);
        break;
    }
  }

  private press(): void {
    this.pressed = true;
    switch (this.state) {
      case 'idle':
        this.power = 0;
        this.enter('charging');
        break;
      case 'waiting':
        this.strike('Пусто. Наживка на месте — перезабрасываем');
        break;
      case 'bite':
        if (this.bite!.phase === 'take') this.hook();
        else this.strike('Рано! Рыба только пробовала наживку');
        break;
    }
  }

  private release(): void {
    this.pressed = false;
    if (this.state === 'charging') this.cast();
  }

  private forward(out: THREE.Vector3, yaw: number): THREE.Vector3 {
    return out.set(Math.sin(yaw), 0, -Math.cos(yaw));
  }

  private cast(): void {
    const p = Math.max(0.12, this.power);
    const dist = 6 + p * 19;
    this.forward(_v, this.aim + (Math.random() - 0.5) * 0.05);
    this.castTo.copy(ORIGIN).addScaledVector(_v, dist);
    // Never land on the bank or in the reeds at the far side.
    while (shoreDist(this.castTo.x, this.castTo.z) > -3 && this.castTo.distanceTo(ORIGIN) > 5) {
      this.castTo.addScaledVector(_v, -1);
    }
    this.castDur = 0.75 + p * 0.5;
    this.castLaunched = false;
    this.audio.whoosh();
    this.enter('casting');
  }

  private strike(message: string): void {
    this.yank = 0.35;
    this.audio.whoosh();
    this.ui.toast(message);
    this.bite = null;
    this.retrieveFrom.copy(this.floatPos);
    this.fx.ripple(this.floatPos.x, this.floatPos.z, 0.5, 0.4, 2);
    this.watch = false;
    this.enter('retrieve');
  }

  private hook(): void {
    const b = this.bite!;
    this.bite = null;
    this.yank = 0.4;
    const dx = this.floatPos.x - ORIGIN.x;
    const dz = this.floatPos.z - ORIGIN.z;
    this.fight = {
      catch: b.catch,
      dist: Math.hypot(dx, dz),
      bearing: Math.atan2(dx, -dz),
      bearingVel: 0,
      stamina: 1,
      tension: 0.45,
      running: true,
      timer: 1.4,
      slack: 0,
      over: 0,
      wake: 0,
    };
    this.float.visible = false;
    this.fx.splash(this.floatPos.x, this.floatPos.z, 0.7);
    this.audio.splash(0.7);
    this.audio.whoosh();
    vibrate(160);
    this.ui.toast('Есть! Вываживайте', 2000);
    this.enter('fight');
  }

  private endFight(message: string): void {
    this.fight = null;
    this.ui.toast(message, 3600);
    this.retrieveFrom.copy(this.rod.tip);
    this.enter('lost');
  }

  private hangPoint(out: THREE.Vector3): THREE.Vector3 {
    return out
      .copy(this.rod.tip)
      .add(_w.set(Math.sin(this.t * 1.3) * 0.07, -2.5 - FLOAT_REST, Math.cos(this.t * 1.05) * 0.05));
  }

  update(dt: number): void {
    this.t += dt;
    this.stateT += dt;
    const t = this.t;
    const cam = this.camera;
    const base = this.baseFov();

    let lookX = 0;
    let lookY = 0.4;
    let lookZ = -16;
    let fovTarget = base;
    let pitchTarget = 0.62;
    let pitchRate = 6;
    let bendTarget = 0.04;
    let yawTarget = this.aim;
    let sag = 0;
    let lineToFloat = true;
    let onStand = false;

    this.forward(_v, this.aim);
    lookX = ORIGIN.x + _v.x * 16;
    lookZ = ORIGIN.z + _v.z * 16;

    switch (this.state) {
      case 'menu': {
        lookX = Math.sin(t * 0.06) * 3;
        this.hangPoint(this.floatPos);
        break;
      }
      case 'idle': {
        this.hangPoint(this.floatPos);
        break;
      }
      case 'charging': {
        this.power = Math.min(1, this.power + dt / 1.3);
        this.ui.showPower(this.power);
        pitchTarget = 0.62 + this.power * 1.25;
        this.hangPoint(this.floatPos);
        break;
      }
      case 'casting': {
        const delay = 0.16;
        pitchTarget = 0.3;
        pitchRate = 15;
        if (this.stateT < delay) {
          this.hangPoint(this.floatPos);
        } else {
          if (!this.castLaunched) {
            this.castLaunched = true;
            this.castFrom.copy(this.rod.tip);
          }
          const u = Math.min(1, (this.stateT - delay) / this.castDur);
          const apex = 1.2 + this.castTo.distanceTo(ORIGIN) * 0.12;
          this.floatPos.lerpVectors(this.castFrom, this.castTo, u);
          this.floatPos.y = lerp(this.castFrom.y, FLOAT_REST, u) + apex * 4 * u * (1 - u);
          sag = -0.4 * Math.sin(u * Math.PI);
          lookX = lerp(lookX, this.castTo.x, u);
          lookZ = lerp(lookZ, this.castTo.z, u);
          lookY = lerp(0.4, 0.1, u);
          fovTarget = lerp(base, this.zoomFov(this.floatSpan(), EYE.distanceTo(this.castTo)), u * u);
          if (u >= 1) {
            this.fx.splash(this.castTo.x, this.castTo.z, 0.35);
            this.audio.plop();
            this.dipVel = 0.9;
            // About a minute of peace before anything touches the bait.
            this.biteTimer = 45 + Math.random() * 30;
            this.floatPos.copy(this.castTo);
            this.enter('waiting');
          }
        }
        break;
      }
      case 'waiting':
      case 'bite': {
        pitchTarget = 0.4;
        sag = 0.6 + this.floatPos.distanceTo(ORIGIN) * 0.09;
        yawTarget = Math.atan2(this.floatPos.x - EYE.x, -(this.floatPos.z - EYE.z));
        if (this.state === 'waiting') {
          this.biteTimer -= dt;
          if (this.biteTimer <= 0) {
            const c = rollCatch(Math.random, this.debugSpecies);
            this.debugSpecies = null;
            const a = Math.random() * Math.PI * 2;
            this.bite = {
              catch: c,
              phase: 'nibble',
              nibbles: c.species.bite === 'run' ? 1 : 2 + Math.floor(Math.random() * 2),
              next: 0,
              left: 0,
              dirX: Math.cos(a),
              dirZ: Math.sin(a),
              age: 0,
            };
            this.enter('bite');
            // The eye is drawn to the float the moment it twitches.
            this.watch = true;
            this.ui.setAction('Подсечка');
            this.ui.setHint('Клюёт! Ждите, пока поплавок уйдёт');
            this.ui.toast('Клюёт!', 1800);
            vibrate([40, 60, 40]);
          }
        } else {
          this.updateBite(dt);
        }
        lookX = this.floatPos.x;
        lookZ = this.floatPos.z;
        if (this.watch) {
          lookY = 0.1;
          fovTarget = this.zoomFov(this.floatSpan(), EYE.distanceTo(this.floatPos));
        } else {
          // Sitting back: the whole lake, the rod on its rest, the float a speck out there.
          lookY = 0.75;
        }
        onStand = true;
        break;
      }
      case 'fight': {
        const f = this.fight!;
        this.updateFight(dt, f);
        if (this.state !== 'fight') break;
        this.forward(_v, f.bearing);
        _pull.copy(ORIGIN).addScaledVector(_v, f.dist);
        _pull.y = -0.15;
        this.floatPos.copy(_pull);
        lineToFloat = false;
        pitchTarget = 0.95;
        bendTarget = 0.12 + 0.75 * Math.min(1.15, f.tension);
        yawTarget = Math.atan2(_pull.x - EYE.x, -(_pull.z - EYE.z)) * 0.8;
        sag = Math.max(0, 0.35 - f.tension) * 2.2;
        lookX = _pull.x;
        lookZ = _pull.z;
        lookY = 0.5;
        fovTarget = Math.max(24, this.zoomFov(7, EYE.distanceTo(_pull)));
        break;
      }
      case 'landing':
      case 'card': {
        lineToFloat = false;
        pitchTarget = 1.15;
        bendTarget = 0.22;
        const fish = this.fish!;
        const c = this.landed!;
        cam.getWorldDirection(_v);
        if (this.state === 'landing') {
          const u = Math.min(1, this.stateT / 1.5);
          const e = 1 - Math.pow(1 - u, 3);
          // Lift straight out of the water toward the hand.
          _w.copy(EYE).add(_dir.set(0.08, -0.35, -1.5));
          fish.group.position.lerpVectors(this.fishFrom, _w, e);
          fish.group.position.y += Math.sin(u * Math.PI) * 0.25;
          const wig = Math.sin(t * 17) * 0.3 * (1 - u * 0.6);
          _q.copy(cam.quaternion).multiply(_q2.setFromAxisAngle(_w.set(0, 0, 1), -Math.PI / 2));
          _q.multiply(_q2.setFromAxisAngle(_w.set(1, 0, 0), wig));
          fish.group.quaternion.copy(_q);
          lookX = fish.group.position.x;
          lookY = lerp(0.3, fish.group.position.y - 0.1, e);
          lookZ = fish.group.position.z - 1;
          if (u >= 1) {
            this.enter('card');
            this.ui.showCard(
              c,
              () => this.finishCatch(true),
              () => this.finishCatch(false),
            );
          }
        } else {
          // Present broadside, filling a good part of the width.
          const hTan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect;
          const d = Math.max(0.45, fish.length / (2 * hTan * 0.62));
          const lift = cam.aspect < 1 ? 0.2 : 0.13;
          _w.copy(cam.position).addScaledVector(_v, d);
          _w.addScaledVector(_dir.copy(UP).applyQuaternion(cam.quaternion), d * lift);
          if (cam.aspect >= 1) _w.addScaledVector(_dir.set(1, 0, 0).applyQuaternion(cam.quaternion), -d * hTan * 0.3);
          fish.group.position.lerp(_w, damp(5, dt));
          _q.copy(cam.quaternion)
            .multiply(_q2.setFromAxisAngle(UP, Math.sin(t * 0.9) * 0.45))
            .multiply(_q2.setFromAxisAngle(_w.set(1, 0, 0), Math.sin(t * 1.3) * 0.08));
          fish.group.quaternion.slerp(_q, damp(4, dt));
          lookX = ORIGIN.x;
          lookY = 0.9;
          lookZ = ORIGIN.z - 14;
        }
        _pull.copy(fish.mouth).applyMatrix4(fish.group.matrixWorld);
        this.floatPos.copy(_pull);
        break;
      }
      case 'retrieve':
      case 'lost': {
        const dur = this.state === 'retrieve' ? 0.75 : 1.6;
        const u = Math.min(1, this.stateT / dur);
        if (this.state === 'retrieve') {
          this.hangPoint(_w);
          this.floatPos.lerpVectors(this.retrieveFrom, _w, u * u * (3 - 2 * u));
          this.floatPos.y += Math.sin(u * Math.PI) * 1.2;
        } else {
          this.float.visible = true;
          this.hangPoint(this.floatPos);
        }
        if (u >= 1) this.enter('idle');
        break;
      }
    }

    // Float: spring toward its dip target, bob on the ripple.
    const onWater = this.state === 'waiting' || this.state === 'bite';
    if (onWater) {
      this.dipVel += ((this.dipTarget - this.dip) * 70 - this.dipVel * 7.5) * dt;
      this.dip += this.dipVel * dt;
      this.tilt += (this.tiltTarget - this.tilt) * damp(5, dt);
      const bob = Math.sin(t * 2.1 + 1) * 0.012 + Math.sin(t * 3.7) * 0.006;
      this.float.position.set(this.floatPos.x, FLOAT_REST - this.dip + bob, this.floatPos.z);
      this.float.rotation.set(this.tilt + Math.sin(t * 1.7) * 0.03, 0, Math.sin(t * 1.3 + 2) * 0.03 + this.tilt * 0.2);
    } else {
      this.float.position.copy(this.floatPos);
      const swing = this.state === 'casting' && this.castLaunched ? 1.1 : 0;
      this.float.rotation.set(swing, 0, Math.sin(t * 1.3) * 0.05);
    }

    // Rod.
    if (this.yank > 0) {
      this.yank -= dt;
      pitchTarget = 1.2;
      pitchRate = 18;
      bendTarget = Math.max(bendTarget, 0.3);
    }
    onStand = onStand && this.yank <= 0;
    if (onStand) {
      // Butt on the planks, blank across the fork, pointing at the float.
      pitchTarget = 0.33;
      yawTarget = clamp(Math.atan2(this.floatPos.x, -(this.floatPos.z - 0.9)), -0.7, 0.7);
      _base.set(clamp(0.3 - 0.9 * Math.sin(yawTarget), -0.55, 0.55), PIER_TOP_Y + 0.05, 0.9);
      bendTarget = 0.03;
    } else {
      this.forward(_v, this.aim);
      _base.copy(EYE).addScaledVector(_v, 0.32);
      _base.x += Math.cos(this.aim) * 0.3;
      _base.z += Math.sin(this.aim) * 0.3;
      _base.y -= 0.62;
    }
    this.rodPitch += (pitchTarget - this.rodPitch) * damp(pitchRate, dt);
    this.rodYaw += (yawTarget - this.rodYaw) * damp(5, dt);
    this.rodBend += (bendTarget - this.rodBend) * damp(9, dt);
    this.rodBase.lerp(_base, damp(this.yank > 0 ? 16 : 6, dt));
    const cp = Math.cos(this.rodPitch);
    _dir.set(Math.sin(this.rodYaw) * cp - (onStand ? 0 : 0.04), Math.sin(this.rodPitch), -Math.cos(this.rodYaw) * cp).normalize();
    this.rod.update(this.rodBase, _dir, this.floatPos, this.rodBend);

    this.stand.visible = onStand && this.stateT > 0.5;
    if (this.stand.visible) {
      const s = 1.5;
      const y = this.rodBase.y + _dir.y * s;
      this.stand.position.set(this.rodBase.x + _dir.x * s, PIER_TOP_Y, this.rodBase.z + _dir.z * s);
      this.stand.rotation.y = -this.rodYaw;
      const h = y - PIER_TOP_Y - 0.012;
      this.standPost.scale.y = h - 0.03;
      this.stand.getObjectByName('fork')!.position.y = h + 0.03;
    }

    // Line.
    if (lineToFloat) {
      _pull.copy(this.float.position);
      _pull.y = onWater ? 0.01 : this.floatPos.y + 0.1;
      this.line.update(this.rod.tip, _pull, onWater || this.state === 'casting' ? sag : 0);
    } else {
      this.line.update(this.rod.tip, this.floatPos, sag);
    }

    const showing = this.state === 'landing' || this.state === 'card';
    this.fill.intensity += ((showing ? 1.6 : 0.5) - this.fill.intensity) * damp(4, dt);

    // Beer makes the pier sway, the joint warms and slows the morning.
    const allowed = this.leisureAllowed();
    this.ui.showLeisure(allowed);
    this.leisure.update(dt, t, allowed, this.fov, base, cam.aspect);
    const drunk = this.leisure.drunk;
    const high = this.leisure.high;
    fovTarget *= 1 + high * 0.035 * Math.sin(t * 0.45);
    this.worldTime += dt * (1 - 0.4 * high);
    if (Math.abs(high - this.moodShown) > 0.01) {
      this.moodShown = high;
      this.world.setMood(high);
      this.ui.setMood(high);
      this.audio.setMuffle(high * 0.85);
    }

    // Camera: sits down to wait, breathes, sways; smoothed look-at and zoom.
    this.eyeDrop += ((onStand ? SIT_DROP : 0) - this.eyeDrop) * damp(2.6, dt);
    const sway = 1 + drunk * 7 + high * 2;
    cam.position.set(EYE.x + Math.sin(t * 0.5) * 0.012 * sway, EYE.y - this.eyeDrop + Math.sin(t * 0.83) * 0.008 * sway, EYE.z);
    this.look.x += (lookX - this.look.x) * damp(3.2, dt);
    this.look.y += (lookY - this.look.y) * damp(3.2, dt);
    this.look.z += (lookZ - this.look.z) * damp(3.2, dt);
    cam.lookAt(this.look);
    cam.rotateZ(Math.sin(t * 0.62) * 0.035 * drunk + Math.sin(t * 0.21) * 0.012 * high);
    const kick = this.leisure.kick;
    if (kick > 0) cam.rotateX(Math.sin(t * 38) * 0.03 * kick * kick - 0.05 * kick);
    this.fov += (fovTarget - this.fov) * damp(2.4, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // Somewhere out on the lake a fish rises.
    this.jumpTimer -= dt;
    if (this.jumpTimer <= 0) {
      this.jumpTimer = 5 + Math.random() * 9;
      const x = (Math.random() - 0.5) * 60;
      const z = -10 - Math.random() * 55;
      if (shoreDist(x, z) < -5) this.fx.ripple(x, z, 1.3, 0.35, 3);
    }

    this.fx.update(dt);
    this.audio.update(dt);
  }

  private updateBite(dt: number): void {
    const b = this.bite!;
    const style = b.catch.species.bite;
    if (b.phase === 'nibble') {
      b.next -= dt;
      if (b.next <= 0) {
        if (b.nibbles > 0) {
          b.nibbles--;
          b.next = 0.8 + Math.random() * 0.8;
          this.dipVel += 0.5 + Math.random() * 0.35;
          this.fx.ripple(this.floatPos.x, this.floatPos.z, 0.25, 0.3, 2);
          vibrate(25);
        } else {
          b.phase = 'take';
          b.left = style === 'run' ? 1.7 : style === 'lay' ? 2.4 : 2.0;
          this.fx.ripple(this.floatPos.x, this.floatPos.z, 0.5, 0.45, 3);
          this.audio.plop();
          vibrate([60, 40, 60]);
          this.ui.setAction('Подсечка', true);
        }
      }
      return;
    }
    b.age += dt;
    b.left -= dt;
    let speed = 0.25;
    if (style === 'sink') {
      this.dipTarget = 0.2;
    } else if (style === 'run') {
      this.dipTarget = 0.26;
      speed = 1.1;
    } else {
      // Bream lifts the bait: the float rises and lies flat before sliding off.
      this.dipTarget = -0.1;
      this.tiltTarget = 1.38;
      speed = b.age > 1 ? 0.45 : 0;
      if (b.age > 1.4) this.dipTarget = 0.12;
    }
    this.floatPos.x += b.dirX * speed * dt;
    this.floatPos.z += b.dirZ * speed * dt;
    if (b.left <= 0) {
      this.bite = null;
      this.ui.toast('Упустили! Рыба объела наживку');
      this.retrieveFrom.copy(this.floatPos);
      this.enter('retrieve');
    }
  }

  private updateFight(dt: number, f: Fight): void {
    const s = f.catch.strength;
    f.timer -= dt;
    if (f.timer <= 0) {
      f.running = !f.running;
      f.timer = f.running ? (0.9 + Math.random() * 1.6) * (0.5 + f.stamina * 0.6) : 1.3 + Math.random() * 2 + (1 - f.stamina);
      if (f.running) f.bearingVel = (Math.random() - 0.5) * 0.5;
    }
    const pull = s * (f.running ? 1 : 0.35) * (0.45 + 0.55 * f.stamina);
    const reeling = this.pressed;
    let target = pull * 0.55 + (reeling ? 0.33 + pull * 0.5 : 0);
    target += Math.sin(this.t * 23) * 0.04 * pull + Math.sin(this.t * 7.3) * 0.03;
    f.tension += (target - f.tension) * damp(reeling ? 4.5 : 3, dt);

    if (reeling) {
      f.dist -= 1.75 * (1 - Math.min(0.95, pull * 0.85)) * dt;
      this.audio.reel(dt, 15);
    } else if (f.running) {
      f.dist += pull * 1.3 * dt;
      this.audio.reel(dt, 20 + 30 * pull, 1.7);
    }
    f.dist = Math.min(32, f.dist);
    f.stamina = Math.max(0, f.stamina - (dt * (0.035 + f.tension * 0.11)) / (0.55 + s));
    f.bearing = clamp(f.bearing + f.bearingVel * dt * (f.running ? 1 : 0.3), -0.75, 0.75);
    if (Math.abs(f.bearing) >= 0.75) f.bearingVel *= -1;

    this.forward(_v, f.bearing);
    const x = ORIGIN.x + _v.x * f.dist;
    const z = ORIGIN.z + _v.z * f.dist;
    f.wake -= dt;
    if (f.wake <= 0) {
      f.wake = f.running ? 0.35 : 0.8;
      this.fx.ripple(x, z, 0.3 + s * 0.4, 0.3, 1);
      if (f.running && Math.random() < 0.3 + s * 0.3) {
        this.fx.splash(x, z, 0.25 + s * 0.5);
        this.audio.splash(0.2 + s * 0.4);
      }
    }

    if (f.tension > 1) {
      f.over += dt;
      vibrate(30);
    } else {
      f.over = Math.max(0, f.over - dt * 2);
    }
    f.slack = f.tension < 0.13 ? f.slack + dt : 0;

    this.ui.showTension(f.tension, f.dist);
    if (f.tension > 0.86) this.ui.setHint('Отпустите — порвёт леску!', true);
    else if (f.tension < 0.2) this.ui.setHint('Мотайте — не давайте слабину!', true);
    else if (f.running) this.ui.setHint('Рыба рвётся — осторожнее');
    else this.ui.setHint('Подматывайте');
    this.ui.setAction('Мотать', f.tension > 0.86);

    if (f.over > 0.55) {
      this.audio.snap();
      vibrate(300);
      this.endFight('Обрыв лески! Слишком сильно тянули');
      return;
    }
    if (f.slack > 2.2) {
      this.endFight('Сошла… Держите леску натянутой');
      return;
    }
    if (f.dist <= 2.4) {
      this.landed = f.catch;
      this.fight = null;
      this.fish = buildFish(f.catch, this.world.environment);
      this.world.scene.add(this.fish.group);
      this.fishFrom.set(x, -0.3, z);
      this.fish.group.position.copy(this.fishFrom);
      this.fish.group.updateMatrixWorld();
      this.fx.splash(x, z, 0.9);
      this.audio.splash(0.9);
      vibrate([80, 60, 120]);
      this.enter('landing');
    }
  }

  private finishCatch(keep: boolean): void {
    const c = this.landed!;
    if (keep) {
      this.count++;
      this.totalKg += c.kg;
      this.ui.setTally(this.count, this.totalKg);
      this.ui.toast(`${c.species.name}, ${formatKg(c.kg)} — в садок`);
    } else {
      this.fx.splash(ORIGIN.x + 0.4, ORIGIN.z - 1.2, 0.5);
      this.audio.splash(0.5);
      this.ui.toast('Отпустили. Пусть подрастёт');
    }
    if (this.fish) {
      this.world.scene.remove(this.fish.group);
      this.fish.dispose();
      this.fish = null;
    }
    this.landed = null;
    this.retrieveFrom.copy(this.rod.tip);
    this.enter('lost');
    this.stateT = 1.0;
  }

  /** Test hooks, used by automated checks only. */
  debug = {
    /** Cast straight out without touching the button. */
    quickCast: (power = 0.6) => {
      this.enter('charging');
      this.power = power;
      this.cast();
    },
    forceBite: (speciesId?: string) => {
      this.biteTimer = 0;
      if (speciesId) this.debugSpecies = speciesId;
    },
    state: () => this.state,
    fight: () => this.fight,
    bite: () => this.bite,
  };
  debugSpecies: string | null = null;
}
