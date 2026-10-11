import { initVision, getBlinkState, getEAR, getTurn, getLook, getGesture, EAR_THRESHOLD, TURN_THRESHOLD } from './vision.js';
import { initGraphics, render, setRoom, lurch, enemy, START_Z } from './graphics.js';
import {
  State,
  ROOMS,
  BLACKOUT_WARNING,
  PEEK_SECONDS,
  LIGHTER_SECONDS,
  PUSH_SECONDS,
  game,
  setState,
  startGame,
  updateGame,
} from './game.js';
import { unlockAudio, startHum, setHum, stopHum, screech, creak, slam, hiss, flick, clunk } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const video = $('#webcam');
const status = $('#status');
const startBtn = $('#start-btn');
const hudTimer = $('#hud-timer');
const hudRoom = $('#hud-room');
const hudFuel = $('#hud-fuel');
const hudEyes = $('#hud-eyes');
const hudStrain = $('#hud-strain');
const hudEar = $('#hud-ear');
const survived = $('#survived');
const reached = $('#reached');

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
  setRoom(1);
  startGame();
  startHum();
}

function updateHud(blinking, look, warning) {
  const t = Math.ceil(game.timeLeft);
  hudRoom.textContent = `ROOM ${game.room}/${ROOMS}`;
  hudTimer.textContent = t > 0 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : 'EXIT OPEN';
  const ear = getEAR();
  const burnt = game.strain >= 1;
  const dark = game.dark > 0;
  const seen = !dark || game.lit;
  hudEyes.textContent =
    ear === null ? 'NO FACE: LOOK AT THE SCREEN'
    : dark ? (game.lit ? 'LIGHTER LIT: DON\'T BLINK' : game.fuel > 0 ? 'LIGHTS OUT: BLINK, OR ☝ LIGHTER' : 'LIGHTS OUT: BLINK NOW')
    : game.peekSide < 0 ? '◀ TURN LEFT: FACE IT'
    : game.peekSide > 0 ? 'FACE IT: TURN RIGHT ▶'
    : look ? 'LOOKING AWAY'
    : burnt ? 'YOUR EYES BURN: BLINK'
    : warning && game.fuel > 0 && !game.lit ? 'LIGHTS FAILING: ☝ RAISE THE LIGHTER'
    : blinking ? 'EYES CLOSED'
    : game.push > 0 ? `PUSHING ${'▮'.repeat(Math.ceil((5 * game.push) / PUSH_SECONDS))}`
    : !t ? 'EXIT OPEN: ✋ PALM TO PUSH IT ▶'
    : 'EYES OPEN';
  hudEyes.classList.toggle('danger', ear === null || game.peekSide !== 0 || ((blinking || burnt || look) && seen));
  hudStrain.style.transform = `scaleX(${game.strain})`;
  hudStrain.classList.toggle('danger', game.strain > 0.75);
  hudFuel.style.transform = `scaleX(${game.fuel / LIGHTER_SECONDS})`;
  hudEar.textContent =
    `EAR ${ear === null ? '--' : ear.toFixed(2)} / ${EAR_THRESHOLD.toFixed(2)}` +
    ` · TURN ${getTurn().toFixed(2)} / ±${TURN_THRESHOLD.toFixed(2)}` +
    ` · HAND ${getGesture() ?? '--'}`;
  survived.textContent = game.elapsed.toFixed(1);
  reached.textContent = game.room;
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); // clamp so a backgrounded tab doesn't teleport the enemy
  last = now;
  const playing = game.state === State.PLAYING;
  const blinking = playing && getBlinkState();
  const look = playing ? getLook() : 0;
  const gesture = playing ? getGesture() : null;
  const dark = playing && game.dark > 0;
  const lit = playing && game.lit;
  const peek = playing ? game.peekSide : 0;
  const warning = playing && !dark && !peek && game.nextBlackout < BLACKOUT_WARNING;
  const strain = playing ? game.strain : 0;
  const emerge = peek ? 1 - game.peekTime / PEEK_SECONDS : 0;

  const exit = playing && game.timeLeft <= 0;
  const push = game.push / PUSH_SECONDS;

  // It moves whenever you can't see it: eyes shut, eyes burnt out, or head turned away.
  // In an unlit blackout it already made its move, so blinking there is free.
  render((blinking || strain >= 1 || look !== 0) && (!dark || lit), dt, { dark, warning, strain, peek, emerge, lit, exit, push });
  const event = updateGame(dt, enemy.z, blinking, look, gesture);

  if (!playing) return;
  // A lighter already burning when the lights die keeps it in sight; an ignored door gets you regardless.
  if ((event === 'blackout' && !game.lit) || event === 'ambush') lurch();
  if (game.lit && !lit) flick();
  if (event === 'unlock') clunk();
  if (event === 'room') {
    setRoom(game.room);
    slam(0);
  }
  if (event === 'peek') creak(game.peekSide);
  if (event === 'banish') slam(peek);
  if (event === 'ambush') hiss(peek);
  if (game.state === State.PLAYING) {
    setHum(game.dark > 0, warning, 1 - enemy.z / START_Z);
  } else {
    stopHum();
    if (game.state === State.GAMEOVER) screech();
  }
  updateHud(blinking, look, warning);
}
requestAnimationFrame(frame);
