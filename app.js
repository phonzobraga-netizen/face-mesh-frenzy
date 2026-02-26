import {
  DEFAULT_BASELINE,
  DEFAULT_SIGNAL_THRESHOLDS,
  classifyFocusSignals,
  computeFaceMetrics,
  computeTorsoMetrics,
} from "./src/focusSignals.js";
import { createFocusState, stepFocusState } from "./src/focusStateMachine.js";
import { createMetricSmoother, median, stepMetricSmoother } from "./src/smoothing.js";

const CALIBRATION_BASE_MS = 5000;
const CALIBRATION_EXTENSION_MS = 3000;
const MIN_CALIBRATION_SAMPLES = 45;
const LOG_INTERVAL_MS = 1400;

const elements = {
  video: document.getElementById("cameraFeed"),
  canvas: document.getElementById("outputCanvas"),
};

const context = elements.canvas.getContext("2d", { alpha: false, desynchronized: true });

const state = {
  stream: null,
  faceModel: null,
  poseModel: null,
  rafId: null,
  previousFrameAt: 0,
  metricSmoother: createMetricSmoother(),
  baseline: { ...DEFAULT_BASELINE },
  calibration: {
    complete: false,
    startedAt: 0,
    durationMs: CALIBRATION_BASE_MS,
    extended: false,
    samples: {
      yaw: [],
      pitch: [],
      eyeX: [],
      eyeY: [],
      torsoScale: [],
    },
  },
  machine: createFocusState(),
  renderState: createFocusState(),
  signalOutput: {
    facePresent: false,
    torsoPresent: false,
    lookAway: false,
    phoneLikeDown: false,
    leftSeatLike: false,
    confidence: 0,
  },
  redirectBusy: false,
  lastConsoleLogAt: 0,
};

function canvasSizeSync() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(window.innerWidth));
  const height = Math.max(1, Math.round(window.innerHeight));
  const nextWidth = Math.round(width * dpr);
  const nextHeight = Math.round(height * dpr);

  if (elements.canvas.width !== nextWidth || elements.canvas.height !== nextHeight) {
    elements.canvas.width = nextWidth;
    elements.canvas.height = nextHeight;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawMirroredVideoFrame() {
  if (elements.video.readyState < 2) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, window.innerWidth, window.innerHeight);
    return;
  }

  context.save();
  context.scale(-1, 1);
  context.drawImage(elements.video, -window.innerWidth, 0, window.innerWidth, window.innerHeight);
  context.restore();
}

function pushSample(bucket, value, limit = 1200) {
  if (!Number.isFinite(value)) {
    return;
  }
  bucket.push(value);
  if (bucket.length > limit) {
    bucket.shift();
  }
}

function calibrationSnapshot(nowMs) {
  const elapsed = Math.max(0, nowMs - state.calibration.startedAt);
  const remainingMs = Math.max(0, state.calibration.durationMs - elapsed);
  return {
    complete: state.calibration.complete,
    sampleCount: state.calibration.samples.yaw.length,
    remainingMs,
    extended: state.calibration.extended,
  };
}

function finalizeCalibration() {
  const samples = state.calibration.samples;
  const sampleCount = samples.yaw.length;

  state.baseline = {
    yaw: median(samples.yaw, DEFAULT_BASELINE.yaw),
    pitch: median(samples.pitch, DEFAULT_BASELINE.pitch),
    eyeX: median(samples.eyeX, DEFAULT_BASELINE.eyeX),
    eyeY: median(samples.eyeY, DEFAULT_BASELINE.eyeY),
    torsoScale: median(samples.torsoScale, DEFAULT_BASELINE.torsoScale),
  };

  state.calibration.complete = true;

  console.info("[FocusGuard] calibration complete", {
    sampleCount,
    baseline: state.baseline,
    extended: state.calibration.extended,
  });
}

function updateCalibration(nowMs, faceMetrics, torsoMetrics, smoothedMetrics) {
  if (state.calibration.complete) {
    return;
  }

  if (!state.calibration.startedAt) {
    state.calibration.startedAt = nowMs;
  }

  const torsoValid =
    torsoMetrics &&
    Number(torsoMetrics.visibilityScore ?? 0) >= DEFAULT_SIGNAL_THRESHOLDS.minPoseVisibility;

  if (faceMetrics && torsoValid) {
    pushSample(state.calibration.samples.yaw, smoothedMetrics.yaw);
    pushSample(state.calibration.samples.pitch, smoothedMetrics.pitch);
    pushSample(state.calibration.samples.eyeX, smoothedMetrics.eyeX);
    pushSample(state.calibration.samples.eyeY, smoothedMetrics.eyeY);
    pushSample(state.calibration.samples.torsoScale, smoothedMetrics.torsoScale);
  }

  const elapsed = nowMs - state.calibration.startedAt;
  if (elapsed < state.calibration.durationMs) {
    return;
  }

  const sampleCount = state.calibration.samples.yaw.length;
  if (sampleCount >= MIN_CALIBRATION_SAMPLES || state.calibration.extended) {
    finalizeCalibration();
    return;
  }

  state.calibration.durationMs += CALIBRATION_EXTENSION_MS;
  state.calibration.extended = true;
  console.warn(
    `[FocusGuard] calibration extended by ${CALIBRATION_EXTENSION_MS}ms (samples=${sampleCount})`
  );
}

function toSmoothedFaceMetrics(rawFaceMetrics, smoothedMetrics) {
  if (!rawFaceMetrics) {
    return null;
  }
  return {
    yaw: smoothedMetrics.yaw,
    pitch: smoothedMetrics.pitch,
    eyeX: smoothedMetrics.eyeX,
    eyeY: smoothedMetrics.eyeY,
  };
}

function toSmoothedTorsoMetrics(rawTorsoMetrics, smoothedMetrics) {
  if (!rawTorsoMetrics) {
    return null;
  }
  return {
    visibilityScore: rawTorsoMetrics.visibilityScore,
    torsoScale: smoothedMetrics.torsoScale,
  };
}

function updateRenderState() {
  state.renderState = {
    phase: state.machine.phase,
    offFocusMs: state.machine.offFocusMs,
    refocusMs: state.machine.refocusMs,
    redirectOpen: state.machine.redirectOpen,
    lastReason: state.machine.lastReason,
    calibration: { ...state.machine.calibration },
  };
}

async function runRedirectAction(action) {
  if (!action || !window.focusGuard || state.redirectBusy) {
    return;
  }

  state.redirectBusy = true;
  try {
    if (action.type === "open_redirect") {
      const result = await window.focusGuard.openRedirect();
      console.info("[FocusGuard] open redirect", result, action.reason);
      if (!result?.opened && !result?.pid) {
        state.machine.redirectOpen = false;
      }
      return;
    }

    if (action.type === "close_redirect") {
      const result = await window.focusGuard.closeRedirect();
      console.info("[FocusGuard] close redirect", result);
    }
  } catch (error) {
    console.error("[FocusGuard] redirect action failed", error);
    if (action.type === "open_redirect") {
      state.machine.redirectOpen = false;
      state.machine.phase = "off_focus_pending";
      state.machine.offFocusMs = Math.max(0, state.machine.offFocusMs - 450);
    }
  } finally {
    state.redirectBusy = false;
  }
}

function maybeConsoleTrace(nowMs) {
  if (nowMs - state.lastConsoleLogAt < LOG_INTERVAL_MS) {
    return;
  }
  state.lastConsoleLogAt = nowMs;
  console.debug("[FocusGuard] state", {
    phase: state.machine.phase,
    offFocusMs: Math.round(state.machine.offFocusMs),
    refocusMs: Math.round(state.machine.refocusMs),
    reason: state.machine.lastReason,
    redirectOpen: state.machine.redirectOpen,
    calibration: calibrationSnapshot(nowMs),
    signals: state.signalOutput,
  });
}

async function frameLoop(timestamp) {
  canvasSizeSync();

  if (!state.stream || !state.faceModel || !state.poseModel) {
    state.rafId = requestAnimationFrame(frameLoop);
    return;
  }

  const nowMs = Number(timestamp);
  const dtMs = state.previousFrameAt ? Math.min(100, nowMs - state.previousFrameAt) : 16.7;
  state.previousFrameAt = nowMs;

  drawMirroredVideoFrame();

  const faceResult = state.faceModel.detectForVideo(elements.video, nowMs);
  const poseResult = state.poseModel.detectForVideo(elements.video, nowMs);
  const faceLandmarks = faceResult?.faceLandmarks?.[0] || null;
  const poseLandmarks = poseResult?.landmarks?.[0] || null;

  const faceMetrics = computeFaceMetrics(faceLandmarks);
  const torsoMetrics = computeTorsoMetrics(poseLandmarks);
  const smoothedMetrics = stepMetricSmoother(state.metricSmoother, {
    yaw: faceMetrics?.yaw ?? state.metricSmoother.yaw.value,
    pitch: faceMetrics?.pitch ?? state.metricSmoother.pitch.value,
    eyeX: faceMetrics?.eyeX ?? state.metricSmoother.eyeX.value,
    eyeY: faceMetrics?.eyeY ?? state.metricSmoother.eyeY.value,
    torsoScale: torsoMetrics?.torsoScale ?? state.metricSmoother.torsoScale.value,
  });

  updateCalibration(nowMs, faceMetrics, torsoMetrics, smoothedMetrics);

  const smoothedFaceMetrics = toSmoothedFaceMetrics(faceMetrics, smoothedMetrics);
  const smoothedTorsoMetrics = toSmoothedTorsoMetrics(torsoMetrics, smoothedMetrics);

  const signals = classifyFocusSignals({
    faceMetrics: smoothedFaceMetrics,
    torsoMetrics: smoothedTorsoMetrics,
    baseline: state.baseline,
  });
  state.signalOutput = {
    facePresent: signals.facePresent,
    torsoPresent: signals.torsoPresent,
    lookAway: signals.lookAway,
    phoneLikeDown: signals.phoneLikeDown,
    leftSeatLike: signals.leftSeatLike,
    confidence: signals.confidence,
  };

  const next = stepFocusState(state.machine, {
    dtMs,
    nowMs,
    signals: state.signalOutput,
    calibration: calibrationSnapshot(nowMs),
  });
  state.machine = next.state;
  updateRenderState();

  void runRedirectAction(next.action);
  maybeConsoleTrace(nowMs);

  state.rafId = requestAnimationFrame(frameLoop);
}

async function startCamera() {
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  elements.video.srcObject = state.stream;
  await elements.video.play();
}

async function loadModels() {
  const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14");
  const fileset = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  const faceModel = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
  });

  const poseModel = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    },
    runningMode: "VIDEO",
    numPoses: 1,
    outputSegmentationMasks: false,
  });

  state.faceModel = faceModel;
  state.poseModel = poseModel;
}

function stopEverything() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }

  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }
}

async function syncInitialRedirectState() {
  if (!window.focusGuard?.getRedirectState) {
    return;
  }
  try {
    const initial = await window.focusGuard.getRedirectState();
    if (initial?.isOpen) {
      state.machine.redirectOpen = true;
      state.machine.phase = "off_focus_opened";
      state.machine.lastOpenedAt = performance.now();
      updateRenderState();
    }
  } catch (error) {
    console.warn("[FocusGuard] failed to read initial redirect state", error);
  }
}

async function boot() {
  try {
    canvasSizeSync();
    await Promise.all([startCamera(), loadModels(), syncInitialRedirectState()]);
    state.machine.calibration.complete = false;
    state.calibration.startedAt = performance.now();
    updateRenderState();
    state.rafId = requestAnimationFrame(frameLoop);
  } catch (error) {
    console.error("[FocusGuard] startup failed", error);
  }
}

window.addEventListener("resize", canvasSizeSync);
window.addEventListener("beforeunload", stopEverything);

boot();
