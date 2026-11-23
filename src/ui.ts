import type { Catch } from './fish';
import type { LeisureKind, LeisureLabels } from './leisure';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function formatKg(kg: number): string {
  if (kg < 1) return `${Math.round(kg * 100) * 10} г`;
  return `${kg.toFixed(2).replace('.', ',')} кг`;
}

export class UI {
  onPress: () => void = () => {};
  onRelease: () => void = () => {};
  onAim: (dx: number) => void = () => {};
  onLeisure: (kind: LeisureKind, down: boolean) => void = () => {};
  onTap: () => void = () => {};

  private readonly act = el<HTMLButtonElement>('act');
  private readonly hint = el('hint');
  private readonly toastEl = el('toast');
  private readonly power = el('power');
  private readonly powerFill = el('powerFill');
  private readonly tension = el('tension');
  private readonly needle = el('needle');
  private readonly dist = el('dist');
  private readonly card = el('card');
  private readonly leisure = el('leisure');
  private readonly mood = el('mood');
  private toastTimer = 0;
  private lastHint = '';
  private lastLabel = '';

  constructor() {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      this.act.setPointerCapture(e.pointerId);
      this.act.classList.add('down');
      this.onPress();
    };
    const up = (e: PointerEvent) => {
      if (!this.act.classList.contains('down')) return;
      e.preventDefault();
      this.act.classList.remove('down');
      this.onRelease();
    };
    this.act.addEventListener('pointerdown', down);
    this.act.addEventListener('pointerup', up);
    this.act.addEventListener('pointercancel', up);
    this.act.addEventListener('contextmenu', (e) => e.preventDefault());

    for (const kind of ['beer', 'cig', 'joint'] as const) {
      // Hold to drink or draw, let go to stop.
      const btn = el(`l-${kind}`);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('down');
        this.onLeisure(kind, true);
      });
      const lift = () => {
        if (!btn.classList.contains('down')) return;
        btn.classList.remove('down');
        this.onLeisure(kind, false);
      };
      btn.addEventListener('pointerup', lift);
      btn.addEventListener('pointercancel', lift);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Keyboard for desktop testing.
    let keyDown = false;
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || keyDown) return;
      keyDown = true;
      this.act.classList.add('down');
      this.onPress();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return;
      keyDown = false;
      this.act.classList.remove('down');
      this.onRelease();
    });

    // Drag across the scene to aim the cast.
    const scene = el<HTMLCanvasElement>('scene');
    let dragging = false;
    let lastX = 0;
    let downX = 0;
    let downY = 0;
    let downAt = 0;
    scene.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = downX = e.clientX;
      downY = e.clientY;
      downAt = performance.now();
      scene.setPointerCapture(e.pointerId);
    });
    scene.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.onAim((e.clientX - lastX) / window.innerWidth);
      lastX = e.clientX;
    });
    scene.addEventListener('pointerup', (e) => {
      dragging = false;
      // A quick touch that did not travel is a tap.
      if (performance.now() - downAt < 400 && Math.hypot(e.clientX - downX, e.clientY - downY) < 12) this.onTap();
    });
    scene.addEventListener('pointercancel', () => (dragging = false));
  }

  showHud(): void {
    el('hud').hidden = false;
  }

  showLeisure(visible: boolean): void {
    if (this.leisure.hidden === visible) this.leisure.hidden = !visible;
  }

  setLeisureLabels(labels: LeisureLabels): void {
    el('l-cig-label').textContent = labels.cig;
    el('l-joint-label').textContent = labels.joint;
  }

  /** Warm haze over the picture; opacity only, so the browser composites it for free. */
  setMood(high: number): void {
    this.mood.style.opacity = (high * 0.9).toFixed(2);
  }

  setAction(label: string, urgent = false): void {
    if (label !== this.lastLabel) {
      this.act.textContent = label;
      this.lastLabel = label;
    }
    this.act.classList.toggle('urgent', urgent);
    this.act.hidden = label === '';
  }

  setHint(text: string, warn = false): void {
    if (text !== this.lastHint) {
      this.hint.textContent = text;
      this.lastHint = text;
    }
    this.hint.classList.toggle('warn', warn);
  }

  toast(text: string, ms = 2600): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  showPower(v: number | null): void {
    this.power.hidden = v === null;
    if (v !== null) this.powerFill.style.width = `${Math.round(v * 100)}%`;
  }

  showTension(v: number | null, metres = 0): void {
    this.tension.hidden = v === null;
    if (v === null) return;
    this.needle.style.left = `${Math.min(100, Math.max(0, (v / 1.1) * 100)).toFixed(1)}%`;
    this.dist.textContent = `до рыбы ${Math.max(0, metres).toFixed(0)} м`;
  }

  setTally(count: number, kg: number): void {
    el('tally').textContent = count === 0 ? 'Улов: 0' : `Улов: ${count} · ${formatKg(kg)}`;
  }

  showCard(c: Catch, onKeep: () => void, onRelease: () => void): void {
    el('cardName').textContent = c.species.name;
    el('cardKg').textContent = formatKg(c.kg);
    el('cardCm').textContent = `${Math.round(c.cm)} см`;
    this.card.hidden = false;
    el<HTMLButtonElement>('keep').onclick = () => {
      this.card.hidden = true;
      onKeep();
    };
    el<HTMLButtonElement>('release').onclick = () => {
      this.card.hidden = true;
      onRelease();
    };
  }

  onStart(cb: () => void): void {
    el('loading').hidden = true;
    el<HTMLButtonElement>('startBtn').onclick = () => {
      el('start').classList.add('gone');
      window.setTimeout(() => (el('start').hidden = true), 700);
      cb();
    };
  }
}
