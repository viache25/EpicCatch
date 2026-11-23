import * as THREE from 'three';
import { Sfx } from './audio';
import { Game } from './game';
import './style.css';
import { UI } from './ui';
import { createWorld } from './world';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const coarse = window.matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 6000);
const world = createWorld(renderer, coarse);
const ui = new UI();
const audio = new Sfx();
const game = new Game(world, camera, ui, audio, canvas);

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => window.setTimeout(resize, 250));

ui.onStart(() => game.start());

const timer = new THREE.Timer();
let slowFrames = 0;
let frames = 0;
function frame(): void {
  timer.update();
  const dt = Math.min(0.05, timer.getDelta());
  game.update(dt);
  world.update(timer.getElapsed());
  renderer.render(world.scene, camera);

  // Step resolution down on phones that cannot hold the frame rate.
  frames++;
  if (frames > 90 && pixelRatio > 1) {
    slowFrames = dt > 1 / 38 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 45) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      slowFrames = 0;
    }
  }
  (window as unknown as { __frames: number }).__frames = frames;
  requestAnimationFrame(frame);
}
(window as unknown as { __game: Game }).__game = game;
frame();
