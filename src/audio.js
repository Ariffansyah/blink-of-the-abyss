// All sound is synthesized with Web Audio so there are no files to ship.

const SCREECH_SECONDS = 1.5; // matches the jump scare before the game-over card fades in
const HUM_VOLUME = 0.22;

let ac = null;
let hum = null;

// Call from a click handler: browsers only let audio start after a user gesture.
export function unlockAudio() {
  ac ??= new AudioContext();
  ac.resume();
}

function noiseBuffer(seconds) {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
  const samples = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buf;
}

function filter(type, frequency, dest) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.connect(dest);
  return f;
}

function gain(value, dest) {
  const g = ac.createGain();
  g.gain.value = value;
  if (dest) g.connect(dest);
  return g;
}

// ---------- ambient hum ----------

export function startHum() {
  if (!ac || hum) return;
  const t = ac.currentTime;
  const master = gain(0, ac.destination);
  master.gain.setTargetAtTime(HUM_VOLUME, t, 0.6);
  const lights = gain(1, master); // cut during blackouts
  const dread = gain(0, master); // swells as it closes in
  const nodes = [];
  const voice = (type, freq, level, dest) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(gain(level, dest));
    o.start(t);
    nodes.push(o);
  };

  // Fluorescent tubes: mains buzz and its harmonic, dulled.
  const dull = filter('lowpass', 600, lights);
  voice('sawtooth', 60, 0.25, dull);
  voice('square', 120, 0.05, dull);
  // Building drone beating slowly against itself, plus an octave laptop speakers can carry.
  voice('sine', 38, 0.4, master);
  voice('sine', 38.6, 0.4, master);
  voice('sine', 77, 0.15, master);
  // Dissonant whine.
  voice('sine', 311, 0.5, dread);
  voice('sine', 329.6, 0.5, dread);
  // Room tone.
  const air = ac.createBufferSource();
  air.buffer = noiseBuffer(2);
  air.loop = true;
  air.connect(filter('lowpass', 220, gain(0.35, master)));
  air.start(t);
  nodes.push(air);

  hum = { master, lights, dread, nodes };
}

// Call every frame while playing. closeness: 0 far .. 1 on top of you.
export function setHum(dark, warning, closeness) {
  if (!hum) return;
  const t = ac.currentTime;
  hum.lights.gain.setTargetAtTime(dark ? 0 : warning ? Math.random() * 1.4 : 1, t, 0.01);
  hum.dread.gain.setTargetAtTime(closeness * closeness * 0.35, t, 0.3);
}

export function stopHum() {
  if (!hum) return;
  const t = ac.currentTime;
  hum.master.gain.setTargetAtTime(0, t, 0.15);
  for (const n of hum.nodes) n.stop(t + 1);
  hum = null;
}

// ---------- side doors (side: -1 left speaker, 1 right) ----------

function panned(side) {
  const p = ac.createStereoPanner();
  p.pan.value = side * 0.8;
  p.connect(ac.destination);
  return p;
}

function noiseHit(side, type, frequency, level, seconds) {
  const t = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(seconds);
  const env = gain(level, panned(side));
  env.gain.setValueAtTime(level, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  src.connect(filter(type, frequency, env));
  src.start(t);
}

// Slow hinge groan as a door swings open.
export function creak(side) {
  if (!ac) return;
  const t = ac.currentTime;
  const env = gain(0, panned(side));
  env.gain.setValueAtTime(0, t); // anchor, or the ramp would start from context time 0
  env.gain.linearRampToValueAtTime(0.5, t + 0.1);
  env.gain.linearRampToValueAtTime(0.0001, t + 1.1);
  const band = filter('bandpass', 900, env);
  band.Q.value = 6;
  const hinge = ac.createOscillator();
  hinge.type = 'sawtooth';
  hinge.frequency.setValueAtTime(70, t);
  hinge.frequency.linearRampToValueAtTime(140, t + 0.5);
  hinge.frequency.linearRampToValueAtTime(90, t + 1.1);
  hinge.connect(band);
  hinge.start(t);
  hinge.stop(t + 1.1);
}

// Door slams shut: you faced it.
export function slam(side) {
  if (ac) noiseHit(side, 'lowpass', 300, 0.9, 0.35);
}

// It shrieks as it takes the lights: you didn't.
export function hiss(side) {
  if (ac) noiseHit(side, 'bandpass', 2500, 0.6, 0.7);
}

// ---------- jump scare ----------

export function screech() {
  if (!ac) return;
  const t = ac.currentTime;
  const end = t + SCREECH_SECONDS;

  // Everything shrill goes through hard distortion: instant attack, held scream, then a fade.
  const out = gain(0.0001, ac.destination);
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
  out.gain.setValueAtTime(0.45, t + 0.9);
  out.gain.exponentialRampToValueAtTime(0.0001, end);
  const shaper = ac.createWaveShaper();
  shaper.curve = distortionCurve(40);
  shaper.connect(out);

  // Detuned saws shrieking upward, wobbled fast for a ragged throat.
  const wobble = ac.createOscillator();
  wobble.frequency.value = 28;
  const wobbleDepth = gain(120);
  wobble.connect(wobbleDepth);
  wobble.start(t);
  wobble.stop(end);
  for (const detune of [-30, 0, 45]) {
    const voice = ac.createOscillator();
    voice.type = 'sawtooth';
    voice.detune.value = detune;
    voice.frequency.setValueAtTime(600, t);
    voice.frequency.exponentialRampToValueAtTime(1400, t + 0.15);
    voice.frequency.exponentialRampToValueAtTime(900, end);
    wobbleDepth.connect(voice.frequency);
    voice.connect(shaper);
    voice.start(t);
    voice.stop(end);
  }

  // Hiss sweeping up through a resonant band.
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuffer(SCREECH_SECONDS);
  const band = filter('bandpass', 1500, shaper);
  band.Q.value = 3;
  band.frequency.setValueAtTime(1500, t);
  band.frequency.exponentialRampToValueAtTime(4000, t + 0.3);
  noise.connect(band);
  noise.start(t);

  // Low impact thump under it all.
  const boom = ac.createOscillator();
  const boomGain = gain(0.5, ac.destination);
  boom.frequency.setValueAtTime(90, t);
  boom.frequency.exponentialRampToValueAtTime(30, t + 0.5);
  boomGain.gain.setValueAtTime(0.5, t);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  boom.connect(boomGain);
  boom.start(t);
  boom.stop(t + 0.6);
}

function distortionCurve(k) {
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 128 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
