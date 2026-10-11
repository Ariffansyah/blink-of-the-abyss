export const State = Object.freeze({
  MENU: 'menu',
  PLAYING: 'playing',
  GAMEOVER: 'gameover',
  VICTORY: 'victory',
});

export const ROOMS = 3;
export const ROOM_SECONDS = 20; // survive this long before the exit unlocks
export const STRAIN_SECONDS = 12; // eyes held open this long burn shut
export const BLACKOUT_WARNING = 1; // seconds the lights stutter before dying
export const PEEK_SECONDS = 3.5; // time to face whatever opens a side door
export const LIGHTER_SECONDS = 4; // lighter fuel per room
export const PUSH_SECONDS = 0.6; // hold an open palm this long to shove the exit open

const rand = (a, b) => a + Math.random() * (b - a);
const gap = () => rand(9, 15) - 2 * (game.room - 1); // seconds between events, shrinking each room

// room: 1..ROOMS. timeLeft: seconds until this room's exit unlocks. elapsed: total seconds survived.
// strain: 0..1, reset by any blink. dark: seconds of blackout left. nextBlackout: lit seconds until the next one.
// peekSide: -1/1 while something leans out of a side door, 0 otherwise. peekTime: seconds left to face it.
// fuel: lighter seconds left this room. lit: lighter burning. push: seconds the palm has been held on the open exit.
export const game = {
  state: State.MENU,
  room: 1,
  timeLeft: ROOM_SECONDS,
  elapsed: 0,
  strain: 0,
  dark: 0,
  nextBlackout: 0,
  peekSide: 0,
  peekTime: 0,
  nextPeek: 0,
  fuel: LIGHTER_SECONDS,
  lit: false,
  push: 0,
};

// style.css shows the overlay matching body[data-state].
export function setState(state) {
  game.state = state;
  document.body.dataset.state = state;
}

function enterRoom(room) {
  Object.assign(game, {
    room,
    timeLeft: ROOM_SECONDS,
    dark: 0,
    nextBlackout: rand(6, 9),
    peekSide: 0,
    peekTime: 0,
    nextPeek: rand(10, 13),
    fuel: LIGHTER_SECONDS,
    lit: false,
    push: 0,
  });
}

export function startGame() {
  enterRoom(1);
  game.elapsed = 0;
  game.strain = 0;
  setState(State.PLAYING);
}

// enemyZ <= 0 means it reached the player. look: -1/0/1 head direction. gesture: from vision.getGesture().
// Returns this frame's event, if any: 'unlock' | 'room' | 'blackout' | 'peek' | 'banish' | 'ambush'.
export function updateGame(dt, enemyZ, blinking, look, gesture) {
  if (game.state !== State.PLAYING) return;
  if (enemyZ <= 0) {
    setState(State.GAMEOVER);
    return;
  }
  game.elapsed += dt;
  game.strain = blinking ? 0 : Math.min(1, game.strain + dt / STRAIN_SECONDS);
  game.lit = gesture === 'Pointing_Up' && game.fuel > 0;
  if (game.lit) game.fuel = Math.max(0, game.fuel - dt);

  if (game.timeLeft > 0) {
    if ((game.timeLeft -= dt) <= 0) {
      game.timeLeft = 0;
      return 'unlock';
    }
  } else if ((game.push = gesture === 'Open_Palm' ? game.push + dt : 0) >= PUSH_SECONDS) {
    if (game.room === ROOMS) {
      setState(State.VICTORY);
      return;
    }
    enterRoom(game.room + 1);
    return 'room';
  }

  if (game.dark > 0) {
    game.dark -= dt;
    return;
  }
  if (game.peekSide) {
    if (look === game.peekSide) {
      game.peekSide = 0;
      return 'banish';
    }
    if ((game.peekTime -= dt) > 0) return;
    game.peekSide = 0;
    game.dark = rand(1.5, 2.2); // ignored, it kills the lights
    return 'ambush';
  }
  if ((game.nextPeek -= dt) <= 0) {
    game.peekSide = Math.random() < 0.5 ? -1 : 1;
    game.peekTime = PEEK_SECONDS;
    game.nextPeek = gap();
    return 'peek';
  }
  if ((game.nextBlackout -= dt) <= 0) {
    game.dark = rand(1.5, 2.2);
    game.nextBlackout = gap();
    return 'blackout';
  }
}
