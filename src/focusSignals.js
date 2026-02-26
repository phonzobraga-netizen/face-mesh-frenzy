import { clamp, medianAbsoluteDeviation } from "./smoothing.js";

const FACE_POINTS = {
  noseTip: 1,
  forehead: 10,
  chin: 152,
  leftOuter: 33,
  leftInner: 133,
  rightInner: 362,
  rightOuter: 263,
  leftUpper: 159,
  leftLower: 145,
  rightUpper: 386,
  rightLower: 374,
  leftIris: 468,
  rightIris: 473,
};

const POSE_POINTS = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
};

export const DEFAULT_BASELINE = {
  yaw: 0,
  pitch: 0,
  eyeX: 0,
  eyeY: 0,
  torsoScale: 0.18,
  torsoCenterX: 0.5,
  torsoCenterY: 0.6,
  faceScale: 0.24,
  eyeOpenness: 0.03,
};

export const DEFAULT_SIGNAL_THRESHOLDS = {
  minPoseVisibility: 0.35,
  yawAwayDelta: 0.16,
  eyeXAwayDelta: 0.14,
  lookScoreThreshold: 1.42,
  lookExtremeYaw: 1.5,
  lookExtremeEye: 1.22,
  pitchDownDelta: 0.14,
  eyeYDownDelta: 0.1,
  torsoDownDelta: 0.055,
  torsoPresentRatio: 0.55,
  torsoLeaveRatio: 0.45,
  minTorsoScale: 0.075,
  bodyShiftXDelta: 0.2,
  bodyShiftYDelta: 0.16,
  minEyeOpenness: 0.012,
};

function safePoint(landmarks, index) {
  if (!Array.isArray(landmarks) || landmarks.length <= index) {
    return null;
  }
  const point = landmarks[index];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  return point;
}

function distance2d(a, b) {
  if (!a || !b) {
    return 0;
  }
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeOffset(value, edgeA, edgeB) {
  const min = Math.min(edgeA, edgeB);
  const max = Math.max(edgeA, edgeB);
  const span = Math.max(1e-4, max - min);
  const clampedValue = clamp(value, min, max);
  return (clampedValue - min) / span - 0.5;
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function computeFaceMetrics(faceLandmarks) {
  if (!Array.isArray(faceLandmarks) || faceLandmarks.length <= FACE_POINTS.rightIris) {
    return null;
  }

  const noseTip = safePoint(faceLandmarks, FACE_POINTS.noseTip);
  const forehead = safePoint(faceLandmarks, FACE_POINTS.forehead);
  const chin = safePoint(faceLandmarks, FACE_POINTS.chin);
  const leftOuter = safePoint(faceLandmarks, FACE_POINTS.leftOuter);
  const leftInner = safePoint(faceLandmarks, FACE_POINTS.leftInner);
  const rightInner = safePoint(faceLandmarks, FACE_POINTS.rightInner);
  const rightOuter = safePoint(faceLandmarks, FACE_POINTS.rightOuter);
  const leftUpper = safePoint(faceLandmarks, FACE_POINTS.leftUpper);
  const leftLower = safePoint(faceLandmarks, FACE_POINTS.leftLower);
  const rightUpper = safePoint(faceLandmarks, FACE_POINTS.rightUpper);
  const rightLower = safePoint(faceLandmarks, FACE_POINTS.rightLower);
  const leftIris = safePoint(faceLandmarks, FACE_POINTS.leftIris);
  const rightIris = safePoint(faceLandmarks, FACE_POINTS.rightIris);

  const required = [
    noseTip,
    forehead,
    chin,
    leftOuter,
    leftInner,
    rightInner,
    rightOuter,
    leftUpper,
    leftLower,
    rightUpper,
    rightLower,
    leftIris,
    rightIris,
  ];

  if (required.some((point) => !point)) {
    return null;
  }

  const leftEyeCenterX = (leftOuter.x + leftInner.x) * 0.5;
  const rightEyeCenterX = (rightOuter.x + rightInner.x) * 0.5;
  const eyeCenterX = (leftEyeCenterX + rightEyeCenterX) * 0.5;
  const eyeCenterY = (leftUpper.y + leftLower.y + rightUpper.y + rightLower.y) * 0.25;
  const faceHeight = Math.max(1e-4, Math.abs(chin.y - forehead.y));
  const faceWidth = Math.max(1e-4, Math.abs(rightOuter.x - leftOuter.x));
  const eyeDistance = Math.max(1e-4, Math.abs(rightEyeCenterX - leftEyeCenterX));

  const yaw = (noseTip.x - eyeCenterX) / eyeDistance;
  const pitch = (noseTip.y - eyeCenterY) / faceHeight;

  const leftEyeX = normalizeOffset(leftIris.x, leftOuter.x, leftInner.x);
  const rightEyeX = normalizeOffset(rightIris.x, rightOuter.x, rightInner.x);
  const eyeX = (leftEyeX + rightEyeX) * 0.5;

  const leftEyeY = normalizeOffset(leftIris.y, leftUpper.y, leftLower.y);
  const rightEyeY = normalizeOffset(rightIris.y, rightUpper.y, rightLower.y);
  const eyeY = (leftEyeY + rightEyeY) * 0.5;

  const leftEyeOpen = Math.abs(leftLower.y - leftUpper.y) / Math.max(1e-4, Math.abs(leftInner.x - leftOuter.x));
  const rightEyeOpen =
    Math.abs(rightLower.y - rightUpper.y) / Math.max(1e-4, Math.abs(rightInner.x - rightOuter.x));
  const eyeOpenness = clamp((leftEyeOpen + rightEyeOpen) * 0.5, 0, 1);

  return {
    yaw,
    pitch,
    eyeX,
    eyeY,
    eyeOpenness,
    faceScale: faceHeight * 0.64 + faceWidth * 0.36,
  };
}

export function computeTorsoMetrics(poseLandmarks) {
  if (!Array.isArray(poseLandmarks) || poseLandmarks.length <= POSE_POINTS.rightHip) {
    return null;
  }

  const leftShoulder = safePoint(poseLandmarks, POSE_POINTS.leftShoulder);
  const rightShoulder = safePoint(poseLandmarks, POSE_POINTS.rightShoulder);
  const leftHip = safePoint(poseLandmarks, POSE_POINTS.leftHip);
  const rightHip = safePoint(poseLandmarks, POSE_POINTS.rightHip);

  const required = [leftShoulder, rightShoulder, leftHip, rightHip];
  if (required.some((point) => !point)) {
    return null;
  }

  const visibilityScore = Math.min(
    safeNumber(leftShoulder.visibility, 0),
    safeNumber(rightShoulder.visibility, 0),
    safeNumber(leftHip.visibility, 0),
    safeNumber(rightHip.visibility, 0)
  );

  const shoulderWidth = distance2d(leftShoulder, rightShoulder);
  const leftHeight = distance2d(leftShoulder, leftHip);
  const rightHeight = distance2d(rightShoulder, rightHip);
  const torsoHeight = (leftHeight + rightHeight) * 0.5;
  const hipWidth = distance2d(leftHip, rightHip);
  const torsoScale = shoulderWidth * 0.45 + torsoHeight * 0.45 + hipWidth * 0.1;
  const centerX = (leftShoulder.x + rightShoulder.x + leftHip.x + rightHip.x) * 0.25;
  const centerY = (leftShoulder.y + rightShoulder.y + leftHip.y + rightHip.y) * 0.25;

  return {
    torsoScale,
    visibilityScore,
    centerX,
    centerY,
  };
}

export function buildAdaptiveThresholds(
  samples = {},
  baseline = DEFAULT_BASELINE,
  defaults = DEFAULT_SIGNAL_THRESHOLDS
) {
  const yawMad = medianAbsoluteDeviation(samples.yaw, baseline.yaw, 0.02);
  const eyeXMad = medianAbsoluteDeviation(samples.eyeX, baseline.eyeX, 0.02);
  const pitchMad = medianAbsoluteDeviation(samples.pitch, baseline.pitch, 0.02);
  const eyeYMad = medianAbsoluteDeviation(samples.eyeY, baseline.eyeY, 0.02);
  const torsoScaleMad = medianAbsoluteDeviation(samples.torsoScale, baseline.torsoScale, 0.01);
  const torsoCenterXMad = medianAbsoluteDeviation(samples.torsoCenterX, baseline.torsoCenterX, 0.012);
  const torsoCenterYMad = medianAbsoluteDeviation(samples.torsoCenterY, baseline.torsoCenterY, 0.012);

  return {
    ...defaults,
    yawAwayDelta: clamp(Math.max(defaults.yawAwayDelta, yawMad * 3.8 + 0.035), 0.14, 0.42),
    eyeXAwayDelta: clamp(Math.max(defaults.eyeXAwayDelta, eyeXMad * 3.9 + 0.03), 0.12, 0.36),
    pitchDownDelta: clamp(Math.max(defaults.pitchDownDelta, pitchMad * 3.5 + 0.04), 0.12, 0.35),
    eyeYDownDelta: clamp(Math.max(defaults.eyeYDownDelta, eyeYMad * 3.6 + 0.03), 0.08, 0.3),
    torsoDownDelta: clamp(Math.max(defaults.torsoDownDelta, torsoCenterYMad * 3.1 + 0.024), 0.04, 0.22),
    bodyShiftXDelta: clamp(Math.max(defaults.bodyShiftXDelta, torsoCenterXMad * 4.4 + 0.06), 0.12, 0.34),
    bodyShiftYDelta: clamp(Math.max(defaults.bodyShiftYDelta, torsoCenterYMad * 4.3 + 0.05), 0.1, 0.34),
    torsoPresentRatio: clamp(defaults.torsoPresentRatio + torsoScaleMad * 0.55, 0.5, 0.68),
    torsoLeaveRatio: clamp(defaults.torsoLeaveRatio + torsoScaleMad * 0.4, 0.35, 0.58),
  };
}

export function classifyFocusSignals({
  faceMetrics,
  torsoMetrics,
  baseline = DEFAULT_BASELINE,
  thresholds = DEFAULT_SIGNAL_THRESHOLDS,
  presence = null,
}) {
  const resolvedBaseline = { ...DEFAULT_BASELINE, ...(baseline || {}) };
  const resolvedThresholds = { ...DEFAULT_SIGNAL_THRESHOLDS, ...(thresholds || {}) };

  const rawFacePresent = Boolean(faceMetrics);
  const rawTorsoVisibleEnough =
    Boolean(torsoMetrics) &&
    safeNumber(torsoMetrics.visibilityScore, 0) >= resolvedThresholds.minPoseVisibility;

  const torsoScale = safeNumber(torsoMetrics?.torsoScale, 0);
  const torsoPresentMin = Math.max(
    resolvedThresholds.minTorsoScale,
    safeNumber(resolvedBaseline.torsoScale, DEFAULT_BASELINE.torsoScale) * resolvedThresholds.torsoPresentRatio
  );
  const torsoLeaveMin = Math.max(
    resolvedThresholds.minTorsoScale,
    safeNumber(resolvedBaseline.torsoScale, DEFAULT_BASELINE.torsoScale) * resolvedThresholds.torsoLeaveRatio
  );
  const rawTorsoPresent = rawTorsoVisibleEnough && torsoScale >= torsoPresentMin;

  const facePresent = typeof presence?.facePresent === "boolean" ? presence.facePresent : rawFacePresent;
  const torsoPresent = typeof presence?.torsoPresent === "boolean" ? presence.torsoPresent : rawTorsoPresent;

  const yawDelta = facePresent ? safeNumber(faceMetrics?.yaw) - safeNumber(resolvedBaseline.yaw) : 0;
  const pitchDelta = facePresent ? safeNumber(faceMetrics?.pitch) - safeNumber(resolvedBaseline.pitch) : 0;
  const eyeXDelta = facePresent ? safeNumber(faceMetrics?.eyeX) - safeNumber(resolvedBaseline.eyeX) : 0;
  const eyeYDelta = facePresent ? safeNumber(faceMetrics?.eyeY) - safeNumber(resolvedBaseline.eyeY) : 0;
  const faceScaleDelta =
    facePresent ? safeNumber(faceMetrics?.faceScale) - safeNumber(resolvedBaseline.faceScale) : 0;

  const torsoCenterXDelta =
    safeNumber(torsoMetrics?.centerX, safeNumber(resolvedBaseline.torsoCenterX, 0.5)) -
    safeNumber(resolvedBaseline.torsoCenterX, 0.5);
  const torsoCenterYDelta =
    safeNumber(torsoMetrics?.centerY, safeNumber(resolvedBaseline.torsoCenterY, 0.6)) -
    safeNumber(resolvedBaseline.torsoCenterY, 0.6);

  const eyeOpenness = facePresent
    ? safeNumber(faceMetrics?.eyeOpenness, safeNumber(resolvedBaseline.eyeOpenness, 0.03))
    : 0;
  const eyeTrackingReliable = eyeOpenness >= resolvedThresholds.minEyeOpenness;

  const yawNorm = Math.abs(yawDelta) / Math.max(1e-4, resolvedThresholds.yawAwayDelta);
  const eyeNorm = Math.abs(eyeXDelta) / Math.max(1e-4, resolvedThresholds.eyeXAwayDelta);
  const lookScore = yawNorm * 0.72 + eyeNorm * 0.64;

  const lookAway =
    facePresent &&
    eyeTrackingReliable &&
    ((yawNorm >= 1.08 && eyeNorm >= 0.52) ||
      (eyeNorm >= 1.08 && yawNorm >= 0.4) ||
      lookScore >= resolvedThresholds.lookScoreThreshold ||
      yawNorm >= resolvedThresholds.lookExtremeYaw ||
      eyeNorm >= resolvedThresholds.lookExtremeEye);

  const pitchNorm = pitchDelta / Math.max(1e-4, resolvedThresholds.pitchDownDelta);
  const eyeDownNorm = eyeYDelta / Math.max(1e-4, resolvedThresholds.eyeYDownDelta);
  const torsoDownNorm = torsoCenterYDelta / Math.max(1e-4, resolvedThresholds.torsoDownDelta);

  const phoneLikeDown =
    facePresent &&
    eyeTrackingReliable &&
    pitchNorm >= 1 &&
    eyeDownNorm >= 1 &&
    (torsoDownNorm >= 0.7 || pitchNorm + eyeDownNorm >= 2.45);

  const bodyShifted =
    Math.abs(torsoCenterXDelta) >= resolvedThresholds.bodyShiftXDelta ||
    Math.abs(torsoCenterYDelta) >= resolvedThresholds.bodyShiftYDelta;

  const leftSeatLike =
    (!facePresent && !torsoPresent) ||
    (!facePresent && (torsoScale > 0 && torsoScale < torsoLeaveMin)) ||
    (!facePresent && bodyShifted) ||
    (facePresent && !torsoPresent && faceScaleDelta < -Math.abs(resolvedBaseline.faceScale) * 0.35);

  let confidence = 0.08;
  if (rawFacePresent) {
    confidence += 0.42;
  }
  if (rawTorsoVisibleEnough) {
    confidence += 0.24;
  }
  if (rawTorsoPresent) {
    confidence += 0.18;
  }
  if (eyeTrackingReliable) {
    confidence += 0.1;
  } else if (rawFacePresent) {
    confidence -= 0.08;
  }
  confidence = clamp(confidence, 0, 1);

  return {
    facePresent,
    torsoPresent,
    lookAway,
    phoneLikeDown,
    leftSeatLike,
    confidence,
    deltas: {
      yawDelta,
      pitchDelta,
      eyeXDelta,
      eyeYDelta,
      torsoScale,
      torsoCenterXDelta,
      torsoCenterYDelta,
      faceScaleDelta,
      eyeOpenness,
      lookScore,
    },
    quality: {
      rawFacePresent,
      rawTorsoVisibleEnough,
      rawTorsoPresent,
      eyeTrackingReliable,
      yawNorm,
      eyeNorm,
      pitchNorm,
      eyeDownNorm,
      torsoDownNorm,
    },
  };
}
