import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BASELINE, classifyFocusSignals } from "../src/focusSignals.js";

test("phone-like down requires both downward pitch and downward eye direction", () => {
  const baseline = { ...DEFAULT_BASELINE };

  const onlyPitch = classifyFocusSignals({
    baseline,
    faceMetrics: { yaw: baseline.yaw, pitch: baseline.pitch + 0.22, eyeX: baseline.eyeX, eyeY: baseline.eyeY + 0.02 },
    torsoMetrics: { torsoScale: 0.2, visibilityScore: 0.9 },
  });
  assert.equal(onlyPitch.phoneLikeDown, false);

  const pitchAndEyesDown = classifyFocusSignals({
    baseline,
    faceMetrics: { yaw: baseline.yaw, pitch: baseline.pitch + 0.24, eyeX: baseline.eyeX, eyeY: baseline.eyeY + 0.14 },
    torsoMetrics: { torsoScale: 0.2, visibilityScore: 0.9 },
  });
  assert.equal(pitchAndEyesDown.phoneLikeDown, true);
});

test("lookAway turns true on large yaw or eye-x deviation", () => {
  const baseline = { ...DEFAULT_BASELINE };
  const byYaw = classifyFocusSignals({
    baseline,
    faceMetrics: { yaw: baseline.yaw + 0.3, pitch: baseline.pitch, eyeX: baseline.eyeX, eyeY: baseline.eyeY },
    torsoMetrics: { torsoScale: 0.21, visibilityScore: 0.9 },
  });
  assert.equal(byYaw.lookAway, true);

  const byEye = classifyFocusSignals({
    baseline,
    faceMetrics: { yaw: baseline.yaw, pitch: baseline.pitch, eyeX: baseline.eyeX + 0.2, eyeY: baseline.eyeY },
    torsoMetrics: { torsoScale: 0.21, visibilityScore: 0.9 },
  });
  assert.equal(byEye.lookAway, true);
});

test("leftSeatLike flags when face and torso are both missing", () => {
  const signals = classifyFocusSignals({
    baseline: { ...DEFAULT_BASELINE, torsoScale: 0.2 },
    faceMetrics: null,
    torsoMetrics: null,
  });
  assert.equal(signals.facePresent, false);
  assert.equal(signals.torsoPresent, false);
  assert.equal(signals.leftSeatLike, true);
});
