// Fake 3D: every world point (X, Y, z) projects through scale = FOCAL / (FOCAL + z)
// toward a vanishing point at the screen center. Hallway and enemy share the projection.

const FOCAL = 10; // focalLength
export const START_Z = 100;
const ENEMY_H = 13; // world units tall
const HALL = { w: 10, floor: 8, ceil: -9, depth: 300 }; // half-width, floor/ceiling Y, far wall z

// Difficulty knobs: ~10 ordinary blinks reach you.
const SNAP_INTERVAL = 0.11; // seconds between teleports while the eyes are shut
const SNAP_MIN = 3.5; // z units per teleport
const SNAP_MAX = 7;
const LURCH_MIN = 8; // z units it covers during a blackout
const LURCH_MAX = 13;
const PEEK_DOOR_Z = { [-1]: 14, [1]: 32 }; // nearest door on each side (see buildHallway)
const EXIT_Z = 3; // the way out: right wall, right beside you
// Each room is the same hallway washed a different colour, and it moves further per snap.
const ROOM_TINT = [null, 'rgba(160,40,20,0.55)', 'rgba(40,70,170,0.55)'];
const ROOM_PACE = 0.2; // extra snap distance per room

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const trace = (c, pts) => {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
};
const doorAt = (X, z0) => [project(X, HALL.floor, z0), project(X, -6, z0), project(X, -6, z0 + 6), project(X, HALL.floor, z0 + 6)];

let canvas, ctx, noise;
let W = 0, H = 0, cx = 0, cy = 0, U = 1; // U = pixels per world unit at z = 0
const bg = document.createElement('canvas'); // pre-rendered static hallway

const newPose = () => ({
  x: rand(-5, 5),
  tilt: rand(-0.5, 0.5),
  lean: rand(-0.06, 0.06),
  armL: rand(0, 0.6),
  armR: rand(0, 0.6),
  mouth: Math.random(),
});

export const enemy = { z: START_Z, pose: newPose() };
let snapTimer = SNAP_INTERVAL;
let dip = 0; // remaining seconds of a light-flicker dip
let jumpT = 0; // seconds into the jump scare
let wasDark = false;
let room = 0; // 0-based
let fade = 0; // 1 = black, eases out after walking into a new room

const scaleAt = (z) => FOCAL / (FOCAL + z);
const project = (X, Y, z) => {
  const s = scaleAt(z);
  return [cx + X * s * U, cy + Y * s * U, s];
};

export function initGraphics(el) {
  canvas = el;
  ctx = canvas.getContext('2d');
  noise = makeNoise();
  addEventListener('resize', resize);
  resize();
}

function resize() {
  W = canvas.width = innerWidth;
  H = canvas.height = innerHeight;
  cx = W / 2;
  cy = H / 2;
  // Smallest scale where the z = 0 cross-section covers the whole screen.
  U = Math.max(W / (2 * HALL.w), H / (2 * HALL.floor));
  buildHallway();
}

// n: 1-based room number. Puts the enemy back at the far end of a freshly tinted hallway.
export function setRoom(n) {
  room = n - 1;
  enemy.z = START_Z;
  enemy.pose = newPose();
  snapTimer = SNAP_INTERVAL;
  jumpT = 0;
  fade = n > 1 ? 1 : 0;
  buildHallway();
}

// dark: lights are out. warning: lights about to die. strain: 0..1 eye strain.
// peek: -1/1 side door something is leaning out of. emerge: 0..1 how far out it is.
// lit: lighter held up. exit: the exit is unlocked. push: 0..1 how far it's been shoved open.
export function render(isBlinking, deltaTime, opts = {}) {
  const { dark = false, warning = false, strain = 0, peek = 0, emerge = 0, lit = false, exit = false, push = 0 } = opts;
  updateEnemy(isBlinking, deltaTime);
  if (wasDark && !dark) dip = 0.25; // tubes stutter back on
  wasDark = dark;
  const light = dark ? 0.75 : flicker(deltaTime, warning); // in a blackout only the lighter lights anything
  if (enemy.z <= 0) {
    drawJumpscare(deltaTime);
  } else if (dark && !lit) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawEyesInDark();
    if (exit) drawExit(push, 1);
  } else {
    ctx.drawImage(bg, 0, 0);
    if (exit) drawExit(push, light);
    if (peek) drawPeek(peek, emerge, light);
    drawEnemy(light);
  }
  if (lit && enemy.z > 0) drawLighter(dark);
  drawVignette(light);
  drawStrain(strain);
  drawNoise();
  if ((fade -= deltaTime) > 0) {
    ctx.fillStyle = `rgba(0,0,0,${fade})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// Blackout move: one big unseen step, revealed when the lights return.
export function lurch() {
  enemy.z = Math.max(0, enemy.z - rand(LURCH_MIN, LURCH_MAX));
  enemy.pose = newPose();
}

// Weeping-angel movement: frozen while watched, teleports in snaps while the eyes are shut.
function updateEnemy(isBlinking, dt) {
  if (!isBlinking || enemy.z <= 0) {
    snapTimer = SNAP_INTERVAL; // so the very first frame of the next blink snaps
    return;
  }
  snapTimer += dt;
  while (snapTimer >= SNAP_INTERVAL && enemy.z > 0) {
    snapTimer -= SNAP_INTERVAL;
    enemy.z = Math.max(0, enemy.z - rand(SNAP_MIN, SNAP_MAX) * (1 + ROOM_PACE * room));
    enemy.pose = newPose();
    dip = 0.15; // lights stutter as your eyes reopen
  }
}

function flicker(dt, warning) {
  dip -= dt;
  if (dip <= 0 && Math.random() < dt * (warning ? 10 : 0.5)) dip = rand(0.05, warning ? 0.15 : 0.3);
  return dip > 0 ? rand(0.4, 0.55) : rand(0.93, 1);
}

// ---------- hallway ----------

function buildHallway() {
  bg.width = W;
  bg.height = H;
  const g = bg.getContext('2d');
  const { w, floor, ceil, depth } = HALL;

  const path = (pts, close = true) => {
    trace(g, pts);
    if (close) g.closePath();
  };
  const fill = (pts, style) => {
    path(pts);
    g.fillStyle = style;
    g.fill();
  };
  const stroke = (pts, style, width, close = false) => {
    path(pts, close);
    g.strokeStyle = style;
    g.lineWidth = width;
    g.stroke();
  };
  const linear = (x0, y0, x1, y1, c0, c1) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, c0);
    gr.addColorStop(1, c1);
    return gr;
  };
  const corners = (z) => [project(-w, ceil, z), project(w, ceil, z), project(w, floor, z), project(-w, floor, z)];
  const [ntl, ntr, nbr, nbl] = corners(0);
  const [ftl, ftr, fbr, fbl] = corners(depth);

  // Surfaces fade to black toward the vanishing point.
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  fill([ntl, ntr, ftr, ftl], linear(cx, ntl[1], cx, ftl[1], '#1c2119', '#030403')); // ceiling
  fill([nbl, nbr, fbr, fbl], linear(cx, nbl[1], cx, fbl[1], '#363a2e', '#040504')); // floor
  fill([ntl, nbl, fbl, ftl], linear(ntl[0], cy, ftl[0], cy, '#2a3026', '#030403')); // left wall
  fill([ntr, nbr, fbr, ftr], linear(ntr[0], cy, ftr[0], cy, '#2a3026', '#030403')); // right wall

  // Far wall: sickly glow with the open doorway it came from.
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, fbr[0] - cx + 1);
  glow.addColorStop(0, '#2c3824');
  glow.addColorStop(1, '#080a07');
  fill([ftl, ftr, fbr, fbl], glow);
  fill([project(-2.5, floor, depth), project(-2.5, -5, depth), project(2.5, -5, depth), project(2.5, floor, depth)], '#000');

  // Floorboards converge on the vanishing point; seams cross them at regular depths.
  for (let X = -w; X <= w; X += 2.5) stroke([project(X, floor, 0), project(X, floor, depth)], 'rgba(0,0,0,0.45)', 1);
  for (let z = 0; z < depth; z += 5) {
    stroke([project(-w, floor, z), project(w, floor, z)], 'rgba(0,0,0,0.5)', Math.max(1, 3 * scaleAt(z)));
  }

  // Wall rail and baseboard lines.
  for (const Y of [floor - 0.6, 1]) {
    for (const X of [-w, w]) stroke([project(X, Y, 0), project(X, Y, depth)], 'rgba(0,0,0,0.5)', 2);
  }

  // Structural ribs: wall pillars and ceiling beams.
  g.lineJoin = 'miter';
  for (let z = 10; z < depth; z += 25) {
    const [tl, tr, br, bl] = corners(z);
    stroke([bl, tl, tr, br], 'rgba(0,0,0,0.6)', Math.max(1, 14 * scaleAt(z)));
  }

  // Side doors.
  for (const [side, z0] of [[1, EXIT_Z], [-1, 14], [1, 32], [-1, 60], [1, 95], [-1, 140], [1, 190]]) {
    const door = doorAt(side * w, z0);
    fill(door, '#040504');
    stroke(door, 'rgba(90,100,80,0.2)', Math.max(1, 4 * scaleAt(z0)), true);
  }

  // Grime and dark streaks running down the walls.
  for (let i = 0; i < 60; i++) {
    const z = rand(0, 120), [x, y, s] = project(Math.random() < 0.5 ? -w : w, rand(ceil, floor), z);
    const r = rand(0.5, 2.5) * s * U;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, 'rgba(0,0,0,0.35)');
    blot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 14; i++) {
    const X = Math.random() < 0.5 ? -w : w, z = rand(2, 60), Y = rand(ceil, 0);
    stroke([project(X, Y, z), project(X, Y + rand(2, 9), z)], 'rgba(40,6,4,0.55)', Math.max(1, 2.5 * scaleAt(z)));
  }

  // Fluorescent tubes (one dead) with pools of light on the floor.
  for (let z = 20; z < depth; z += 30) {
    const s = scaleAt(z);
    const dead = z === 80;
    fill(
      [project(-1.5, ceil, z), project(1.5, ceil, z), project(1.5, ceil, z + 4), project(-1.5, ceil, z + 4)],
      dead ? '#0c0e0b' : `rgba(190,210,170,${0.15 + 0.6 * s})`,
    );
    if (dead) continue;
    const [px, py] = project(0, floor, z + 2);
    const r = 9 * s * U;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.translate(px, py);
    g.scale(1, 0.35);
    const pool = g.createRadialGradient(0, 0, 0, 0, 0, r);
    pool.addColorStop(0, `rgba(70,85,55,${0.1 + 0.2 * s})`);
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = pool;
    g.fillRect(-r, -r, 2 * r, 2 * r);
    g.restore();
  }

  // Depth fog, then light spilling out of the far end.
  const R = Math.hypot(cx, cy);
  const fog = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  fog.addColorStop(0, 'rgba(0,0,0,0)');
  fog.addColorStop(0.03, 'rgba(0,0,0,0.6)');
  fog.addColorStop(0.3, 'rgba(0,0,0,0.25)');
  fog.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fog;
  g.fillRect(0, 0, W, H);
  const spill = g.createRadialGradient(cx, cy, 0, cx, cy, (fbr[0] - cx) * 6);
  spill.addColorStop(0, 'rgba(50,65,40,0.25)');
  spill.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = spill;
  g.fillRect(0, 0, W, H);
  if (ROOM_TINT[room]) {
    g.globalCompositeOperation = 'color';
    g.fillStyle = ROOM_TINT[room];
    g.fillRect(0, 0, W, H);
  }
  g.globalCompositeOperation = 'source-over';
}

// ---------- enemy ----------

const tone = (k) => `rgb(${(214 * k) | 0},${(222 * k) | 0},${(200 * k) | 0})`;
const HEM = [0, 0.06, 0.01, 0.08, 0.02, 0.05, 0, 0.07, 0.01];

function seg(x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

// Feet position, scale and perspective-scaled height in px.
function enemyScreen() {
  const { z, pose } = enemy;
  const [fx, fy, s] = project(pose.x * Math.min(1, z / 40), HALL.floor, z); // drifts to center as it closes in
  return [fx, fy, s, ENEMY_H * s * U];
}

function drawEnemy(light) {
  const { z, pose } = enemy;
  const [fx, fy, s, h] = enemyScreen();
  const lit = Math.min(1, 0.1 + 1.8 * s) * light;
  const reach = 1 - z / 35; // arms rise over the last stretch

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.ellipse(fx, fy, h * 0.22, h * 0.025, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(h, h); // figure space: feet at (0, 0), top of head at (0, -1)
  ctx.rotate(pose.lean);
  drawFigure(pose, lit, reach);
  ctx.restore();
}

function drawFigure(pose, lit, reach) {
  const skin = tone(0.12 + 0.75 * lit);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = skin;

  // Legs.
  ctx.lineWidth = 0.022;
  seg(-0.035, -0.3, -0.045, 0);
  seg(0.035, -0.3, 0.05, 0);

  // Long arms: 0 hangs past the knees, 1 is clawing overhead.
  for (const [side, arm] of [[-1, pose.armL], [1, pose.armR]]) {
    const a = 0.12 + Math.max(arm, reach) * 2;
    const b = a + 0.5;
    const sx = side * 0.085, sy = -0.73;
    const ex = sx + side * Math.sin(a) * 0.23, ey = sy + Math.cos(a) * 0.23;
    const wx = ex + side * Math.sin(b) * 0.23, wy = ey + Math.cos(b) * 0.23;
    ctx.lineWidth = 0.026;
    seg(sx, sy, ex, ey);
    ctx.lineWidth = 0.017;
    seg(ex, ey, wx, wy);
    // Long fingers that hook inward at the tips.
    ctx.lineWidth = 0.007;
    for (let i = 0; i < 4; i++) {
      const f = b + (i - 1.5) * 0.28;
      const kx = wx + side * Math.sin(f) * 0.06, ky = wy + Math.cos(f) * 0.06;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(kx, ky);
      ctx.lineTo(kx + side * Math.sin(f - 0.9) * 0.04, ky + Math.cos(f - 0.9) * 0.04);
      ctx.stroke();
    }
  }

  // Ragged gown.
  ctx.fillStyle = tone(0.03 + 0.07 * lit);
  ctx.beginPath();
  ctx.moveTo(-0.03, -0.79);
  ctx.lineTo(-0.1, -0.74);
  ctx.quadraticCurveTo(-0.06, -0.55, -0.075, -0.48);
  HEM.forEach((d, i) => ctx.lineTo(-0.15 + i * 0.0375, -0.27 + d));
  ctx.lineTo(0.075, -0.48);
  ctx.quadraticCurveTo(0.06, -0.55, 0.1, -0.74);
  ctx.lineTo(0.03, -0.79);
  ctx.closePath();
  ctx.fill();

  // Head, cocked at a different angle after every snap.
  ctx.lineWidth = 0.02;
  seg(0, -0.78, 0, -0.82);
  ctx.save();
  ctx.translate(0, -0.8);
  ctx.rotate(pose.tilt);
  ctx.translate(0, -0.085);
  ctx.scale(0.075, 0.075);
  drawHead(pose.mouth, lit);
  ctx.restore();
}

// Head space: face spans roughly x ±0.75, y ±1. Shared by the figure and the jump scare.
function drawHead(mouth, lit) {
  const t = ctx.getTransform();
  const px = 1 / Math.hypot(t.a, t.b); // one screen pixel in head units

  // Hair draping past the shoulders.
  ctx.fillStyle = '#020202';
  ctx.beginPath();
  ctx.moveTo(-1.05, 0);
  ctx.bezierCurveTo(-1.2, -1.5, 1.2, -1.5, 1.05, 0);
  for (let i = 0; i <= 8; i++) ctx.lineTo(1.35 - i * 0.3375, i % 2 ? 3 : 3.6);
  ctx.closePath();
  ctx.fill();

  // Face, shaded toward the edges so it reads as gaunt rather than flat.
  const face = ctx.createRadialGradient(0, -0.25, 0.1, 0, 0.1, 1.1);
  face.addColorStop(0, tone(0.12 + 0.75 * lit));
  face.addColorStop(1, tone(0.03 + 0.2 * lit));
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(0, 0.05, 0.72, 1.05, 0, 0, TAU);
  ctx.fill();

  // Uneven sunken sockets weeping black, pinprick pupils that stay visible from far away.
  ctx.strokeStyle = '#000';
  ctx.lineCap = 'round';
  for (const [x, y, tear] of [[-0.3, -0.14, 0.55], [0.31, -0.08, 0.8]]) {
    const socket = ctx.createRadialGradient(x, y, 0.05, x, y, 0.34);
    socket.addColorStop(0, '#000');
    socket.addColorStop(0.55, 'rgba(0,0,0,0.92)');
    socket.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = socket;
    ctx.beginPath();
    ctx.arc(x, y, 0.34, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(x, y + 0.15);
    ctx.quadraticCurveTo(x + 0.04, y + 0.15 + tear / 2, x - 0.02, y + 0.15 + tear);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(255,235,200,${0.5 + 0.5 * lit})`;
  for (const [x, y] of [[-0.28, -0.12], [0.34, -0.1]]) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.04, 1.2 * px), 0, TAU);
    ctx.fill();
  }

  // Gaping mouth with jagged teeth clipped to its edge.
  const mw = 0.17 + mouth * 0.05, mh = 0.12 + mouth * 0.28, my = 0.62;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, my, mw, mh, 0, 0, TAU);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = tone(0.08 + 0.5 * lit);
  for (const dir of [1, -1]) {
    const edge = my - dir * mh;
    ctx.beginPath();
    ctx.moveTo(-mw, edge - dir * 0.05);
    for (let i = 0; i <= 8; i++) ctx.lineTo(-mw + (i * mw) / 4, edge + dir * (i % 2 ? 0.13 : 0.02));
    ctx.lineTo(mw, edge - dir * 0.05);
    ctx.fill();
  }
  ctx.restore();

  // Strands across the face.
  ctx.strokeStyle = '#020202';
  ctx.lineWidth = 0.12;
  ctx.lineCap = 'round';
  for (const [x0, y0, qx, qy, x1, y1] of [
    [-0.5, -0.9, -0.75, 0.2, -0.55, 1.4],
    [0.45, -0.95, 0.7, 0.1, 0.62, 1.5],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(qx, qy, x1, y1);
    ctx.stroke();
  }
}

// Something leaning out of a side door: fingers hooked round the frame, head tipped sideways.
function drawPeek(side, emerge, light) {
  const X = side * HALL.w, z0 = PEEK_DOOR_Z[side];
  const line = (pts) => trace(ctx, pts);

  // The door has swung open onto blackness.
  line(doorAt(X, z0));
  ctx.fillStyle = '#000';
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.25 + emerge);
  const [hx, hy, s] = project(side * (HALL.w - 0.8 - 1.2 * emerge), -2, z0 + 2);
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(1.5 * s * U, 1.5 * s * U); // head radius = 1.5 world units, larger than life
  ctx.rotate(-side * 1.2);
  drawHead(1, 0.7 * light);
  ctx.restore();

  // Fingers over the hair, hooked round the near frame.
  ctx.strokeStyle = tone(0.15 + 0.6 * light);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, 0.18 * scaleAt(z0) * U);
  const reach = 0.5 + 1.0 * emerge;
  for (let i = 0; i < 4; i++) {
    const Y = -1.2 + i * 0.4;
    line([project(X, Y, z0 + 0.4), project(X, Y + 0.05, z0 - reach), project(X - side * 0.25, Y + 0.25, z0 - reach - 0.2)]);
    ctx.stroke();
  }
  ctx.restore();
}

// Unlocked exit: green sign (battery-backed, so it glows in a blackout too), light through the crack as you push.
function drawExit(push, light) {
  const door = doorAt(HALL.w, EXIT_Z);
  const s = scaleAt(EXIT_Z + 7);
  ctx.save();
  trace(ctx, door);
  ctx.closePath();
  ctx.fillStyle = `rgba(200,255,200,${0.7 * push})`;
  ctx.fill();
  ctx.shadowColor = '#5f8';
  ctx.shadowBlur = 24;
  ctx.strokeStyle = `rgba(110,255,140,${0.35 + 0.4 * light})`;
  ctx.lineWidth = Math.max(2, 0.25 * s * U);
  ctx.stroke();
  const [sx, sy] = project(HALL.w - 0.5, -6.8, EXIT_Z + 7); // past the door, where it stays on screen
  ctx.font = `${Math.round(1.2 * s * U)}px VT323, monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(140,255,160,${0.6 + 0.4 * light})`;
  ctx.fillText('EXIT', sx, sy);
  ctx.restore();
}

// Lighter held up in the bottom corner: warm flame, and in a blackout the only light there is.
function drawLighter(dark) {
  const m = Math.min(W, H);
  const fx = W * 0.72, fy = H * 0.86;
  const flick = rand(0.9, 1.1);
  if (dark) {
    const hole = ctx.createRadialGradient(fx, fy, m * 0.05, fx, fy, m * 0.9 * flick);
    hole.addColorStop(0, 'rgba(0,0,0,0)');
    hole.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.fillStyle = hole;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, m * 0.5 * flick);
  glow.addColorStop(0, 'rgba(255,150,50,0.35)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,200,110,0.9)';
  ctx.beginPath();
  ctx.ellipse(fx, fy - m * 0.02, m * 0.008, m * 0.022 * flick, rand(-0.1, 0.1), 0, TAU);
  ctx.fill();
  ctx.restore();
}

// In a blackout only its pupils show, already somewhere new.
function drawEyesInDark() {
  const [fx, fy, , h] = enemyScreen();
  const r = Math.max(2, 0.004 * h);
  ctx.fillStyle = 'rgba(255,235,200,0.8)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(fx + side * 0.022 * h, fy - 0.89 * h, r, 0, TAU);
    ctx.fill();
  }
}

// Single red flash that fades (no strobing), shaking face lunging to fill the screen.
function drawJumpscare(dt) {
  jumpT += dt;
  const m = Math.min(W, H);
  ctx.fillStyle = `rgb(${(90 * Math.max(0, 1 - jumpT * 2)) | 0},0,0)`;
  ctx.fillRect(0, 0, W, H);
  const shake = m * 0.03 * Math.max(0.15, 1 - jumpT);
  const k = m * 0.42 * (0.6 + 0.4 * Math.min(1, jumpT * 4));
  ctx.save();
  ctx.translate(cx + rand(-shake, shake), cy + rand(-shake, shake));
  ctx.scale(k, k);
  ctx.rotate(rand(-0.05, 0.05));
  drawHead(1, 1);
  ctx.restore();
}

// ---------- post effects ----------

function drawVignette(light) {
  const closeness = 1 - enemy.z / START_Z; // tunnel vision as it approaches
  const v = ctx.createRadialGradient(cx, cy, Math.min(W, H) * (0.35 - 0.2 * closeness) * light, cx, cy, Math.hypot(cx, cy));
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = `rgba(0,0,0,${1 - light})`;
  ctx.fillRect(0, 0, W, H);
}

// Past 40% strain the view blurs and reddens; at 100% it's gone.
function drawStrain(strain) {
  const k = Math.max(0, (strain - 0.4) / 0.6);
  const blur = k > 0 ? `blur(${(k * k * 5).toFixed(1)}px)` : '';
  if (canvas.style.filter !== blur) canvas.style.filter = blur;
  if (!k) return;
  const red = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.2, cx, cy, Math.hypot(cx, cy));
  red.addColorStop(0, 'rgba(120,0,0,0)');
  red.addColorStop(1, `rgba(120,0,0,${0.7 * k})`);
  ctx.fillStyle = red;
  ctx.fillRect(0, 0, W, H);
  if (strain >= 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(0, 0, W, H);
  }
}

function makeNoise() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.random() * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}

function drawNoise() {
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.translate(rand(0, 128), rand(0, 128));
  ctx.fillStyle = noise;
  ctx.fillRect(-128, -128, W + 128, H + 128);
  ctx.restore();
}
