import { initVision, getBlinkState, getEAR, getTurn, getLook, EAR_THRESHOLD, TURN_THRESHOLD } from './vision.js';
import { initGraphics, render, resetEnemy, lurch, enemy, START_Z } from './graphics.js';
import {
  State,
  SURVIVE_SECONDS,
  BLACKOUT_WARNING,
  PEEK_SECONDS,
  game,
  setState,
  startGame,
  updateGame,
} from './game.js';
import { unlockAudio, startHum, setHum, stopHum, screech, creak, slam, hiss } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const video = $('#webcam');
const status = $('#status');
const startBtn = $('#start-btn');
const hudTimer = $('#hud-timer');
const hudEyes = $('#hud-eyes');
const hudStrain = $('#hud-strain');
const hudEar = $('#hud-ear');
const survived = $('#survived');

initGraphics($('#game'));
setState(State.MENU);

for (const btn of document.querySelectorAll('[data-action="start"]')) {
  btn.addEventListener('click', () => begin(btn));
}

async function begin(btn) {
  unlockAudio(); // before any await, while we're still inside the click gesture
  btn.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Opening the camera and waking the face tracker…';
  try {
    await initVision(video);
  } catch (err) {
    setState(State.MENU);
    status.textContent = err.message;
    status.classList.add('error');
    startBtn.textContent = 'Retry';
    return;
  } finally {
    btn.disabled = false;
  }
  status.textContent = '';
  resetEnemy();
  startGame();
  startHum();
}

function updateHud(blinking, look) {
  const t = Math.ceil(game.timeLeft);
  hudTimer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const ear = getEAR();
  const burnt = game.strain >= 1;
  hudEyes.textContent =
    ear === null ? 'NO FACE: LOOK AT THE SCREEN'
    : game.dark > 0 ? 'LIGHTS OUT: BLINK NOW'
    : game.peekSide < 0 ? '◀ TURN LEFT: FACE IT'
    : game.peekSide > 0 ? 'FACE IT: TURN RIGHT ▶'
    : look ? 'LOOKING AWAY'
    : burnt ? 'YOUR EYES BURN: BLINK'
    : blinking ? 'EYES CLOSED'
    : 'EYES OPEN';
  hudEyes.classList.toggle('danger', ear === null || game.peekSide !== 0 || ((blinking || burnt || look) && game.dark <= 0));
  hudStrain.style.transform = `scaleX(${game.strain})`;
  hudStrain.classList.toggle('danger', game.strain > 0.75);
  hudEar.textContent =
    `EAR ${ear === null ? '--' : ear.toFixed(2)} / ${EAR_THRESHOLD.toFixed(2)}` +
    ` · TURN ${getTurn().toFixed(2)} / ±${TURN_THRESHOLD.toFixed(2)}`;
  survived.textContent = (SURVIVE_SECONDS - game.timeLeft).toFixed(1);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); // clamp so a backgrounded tab doesn't teleport the enemy
  last = now;
  const playing = game.state === State.PLAYING;
  const blinking = playing && getBlinkState();
  const look = playing ? getLook() : 0;
  const dark = playing && game.dark > 0;
  const peek = playing ? game.peekSide : 0;
  const warning = playing && !dark && !peek && game.nextBlackout < BLACKOUT_WARNING;
  const strain = playing ? game.strain : 0;
  const emerge = peek ? 1 - game.peekTime / PEEK_SECONDS : 0;

  // It moves whenever you can't see it: eyes shut, eyes burnt out, or head turned away.
  // In a blackout it already made its move, so blinking there is free.
  render((blinking || strain >= 1 || look !== 0) && !dark, dt, { dark, warning, strain, peek, emerge });
  const event = updateGame(dt, enemy.z, blinking, look);

  if (!playing) return;
  if (event === 'blackout' || event === 'ambush') lurch();
  if (event === 'peek') creak(game.peekSide);
  if (event === 'banish') slam(peek);
  if (event === 'ambush') hiss(peek);
  if (game.state === State.PLAYING) {
    setHum(game.dark > 0, warning, 1 - enemy.z / START_Z);
  } else {
    stopHum();
    if (game.state === State.GAMEOVER) screech();
  }
  updateHud(blinking, look);
}
requestAnimationFrame(frame);
