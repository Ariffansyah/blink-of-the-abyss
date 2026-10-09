export const State = Object.freeze({
  MENU: 'menu',
  PLAYING: 'playing',
  GAMEOVER: 'gameover',
  VICTORY: 'victory',
});

export const SURVIVE_SECONDS = 60;
export const STRAIN_SECONDS = 12; // eyes held open this long burn shut
export const BLACKOUT_WARNING = 1; // seconds the lights stutter before dying
export const PEEK_SECONDS = 3.5; // time to face whatever opens a side door

const rand = (a, b) => a + Math.random() * (b - a);

// strain: 0..1, reset by any blink. dark: seconds of blackout left. nextBlackout: lit seconds until the next one.
// peekSide: -1/1 while something leans out of a side door, 0 otherwise. peekTime: seconds left to face it.
export const game = {
  state: State.MENU,
  timeLeft: SURVIVE_SECONDS,
  strain: 0,
  dark: 0,
  nextBlackout: 0,
  peekSide: 0,
  peekTime: 0,
  nextPeek: 0,
};

// style.css shows the overlay matching body[data-state].
export function setState(state) {
  game.state = state;
  document.body.dataset.state = state;
}

export function startGame() {
  Object.assign(game, {
    timeLeft: SURVIVE_SECONDS,
    strain: 0,
    dark: 0,
    nextBlackout: rand(7, 11),
    peekSide: 0,
    peekTime: 0,
    nextPeek: rand(14, 18),
  });
  setState(State.PLAYING);
}

// enemyZ <= 0 means it reached the player. look: -1/0/1 head direction.
// Returns this frame's event, if any: 'blackout' | 'peek' | 'banish' | 'ambush'.
export function updateGame(dt, enemyZ, blinking, look) {
  if (game.state !== State.PLAYING) return;
  if (enemyZ <= 0) {
    setState(State.GAMEOVER);
    return;
  }
  if ((game.timeLeft -= dt) <= 0) {
    game.timeLeft = 0;
    setState(State.VICTORY);
    return;
  }
  game.strain = blinking ? 0 : Math.min(1, game.strain + dt / STRAIN_SECONDS);

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
    game.nextPeek = rand(9, 15);
    return 'peek';
  }
  if ((game.nextBlackout -= dt) <= 0) {
    game.dark = rand(1.5, 2.2);
    game.nextBlackout = rand(9, 15);
    return 'blackout';
  }
}
