import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Keep the version in sync with the installed @mediapipe/tasks-vision.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Calibration knob: open eyes usually read 0.25–0.35. Raise it if blinks slip through.
export const EAR_THRESHOLD = 0.2;
// Calibration knob: how far the nose must swing off-center (fraction of face width) to count as a head turn.
export const TURN_THRESHOLD = 0.12;

// Face-mesh indices [p1..p6] for EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

const DENIED = 'Camera access was denied. The abyss needs to see your eyes: allow camera access in your browser\'s site settings, then press Retry.';
const BUSY = 'The camera is in use by another app. Close it and press Retry.';
const CAMERA_ERRORS = {
  NotAllowedError: DENIED,
  SecurityError: DENIED,
  NotFoundError: 'No camera found. Plug in a webcam and press Retry.',
  OverconstrainedError: 'No compatible camera found. Plug in a webcam and press Retry.',
  NotReadableError: BUSY,
  AbortError: BUSY,
};

let video = null;
let stream = null;
let landmarker = null;
let lastVideoTime = -1;
let ear = null; // average EAR of both eyes, null when no face is visible
let turn = 0; // nose offset from face center; positive = player turned toward the screen's left

// Safe to call again after a failure: only the missing piece is retried.
export async function initVision(videoEl) {
  video = videoEl;
  if (!stream) stream = await openCamera();
  if (!landmarker) landmarker = await loadLandmarker();
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API unavailable. Open the game over https:// or http://localhost.');
  }
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (err) {
    throw new Error(CAMERA_ERRORS[err.name] ?? `Could not open the camera (${err.name || err.message}).`);
  }
  // Unplugged or revoked mid-game: counts as "no face" until the player retries.
  s.getVideoTracks()[0].addEventListener('ended', () => {
    stream = null;
    ear = null;
  });
  video.srcObject = s;
  await video.play();
  return s;
}

async function loadLandmarker() {
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    try {
      return await FaceLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      return await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }
  } catch (err) {
    console.error(err);
    throw new Error('Failed to load the face tracker. Check your internet connection and press Retry.');
  }
}

function eyeAspectRatio(lm, [p1, p2, p3, p4, p5, p6]) {
  // Landmarks are normalized per axis; convert to pixels so the ratio isn't skewed by 4:3.
  const d = (a, b) =>
    Math.hypot((lm[a].x - lm[b].x) * video.videoWidth, (lm[a].y - lm[b].y) * video.videoHeight);
  return (d(p2, p6) + d(p3, p5)) / (2 * d(p1, p4));
}

// True when the eyes are shut or no face is visible. Runs detection once per new video frame.
export function getBlinkState() {
  if (!landmarker || !stream) return true;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const face = landmarker.detectForVideo(video, performance.now()).faceLandmarks[0];
    ear = face ? (eyeAspectRatio(face, LEFT_EYE) + eyeAspectRatio(face, RIGHT_EYE)) / 2 : null;
    // The camera image is unmirrored: turning toward the screen's left swings the nose to the image's right.
    if (face) turn = (face[1].x - (face[234].x + face[454].x) / 2) / Math.abs(face[454].x - face[234].x);
  }
  return ear === null || ear < EAR_THRESHOLD;
}

export const getEAR = () => ear;
export const getTurn = () => (ear === null ? 0 : turn);

// -1 head turned toward the screen's left, 1 toward its right, 0 facing it. Call after getBlinkState().
export function getLook() {
  const t = getTurn();
  return t > TURN_THRESHOLD ? -1 : t < -TURN_THRESHOLD ? 1 : 0;
}
