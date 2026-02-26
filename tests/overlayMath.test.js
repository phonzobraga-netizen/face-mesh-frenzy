import test from "node:test";
import assert from "node:assert/strict";
import {
  clamp01,
  landmarkToPoint,
  getFaceBox,
  estimateExpressionPulse,
  pulseAlpha,
} from "../src/overlayMath.js";

test("clamp01 keeps values in range", () => {
  assert.equal(clamp01(-0.3), 0);
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(2.1), 1);
});

test("landmarkToPoint mirrors x-axis by default", () => {
  const point = landmarkToPoint({ x: 0.25, y: 0.5 }, 800, 600);
  assert.equal(point.x, 600);
  assert.equal(point.y, 300);
});

test("getFaceBox returns measured bounds", () => {
  const box = getFaceBox(
    [
      { x: 0.2, y: 0.3 },
      { x: 0.5, y: 0.7 },
      { x: 0.4, y: 0.4 },
    ],
    1000,
    800,
    false,
  );

  assert.equal(Math.round(box.x), 200);
  assert.equal(Math.round(box.y), 240);
  assert.equal(Math.round(box.width), 300);
  assert.equal(Math.round(box.height), 320);
});

test("estimateExpressionPulse reacts to mouth opening", () => {
  const landmarks = Array.from({ length: 200 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[10] = { x: 0.5, y: 0.2 };
  landmarks[152] = { x: 0.5, y: 0.8 };
  landmarks[13] = { x: 0.5, y: 0.48 };
  landmarks[14] = { x: 0.5, y: 0.57 };

  const pulse = estimateExpressionPulse(landmarks, 1000, 1000, false);
  assert.ok(pulse > 0.5, `expected pulse > 0.5, got ${pulse}`);
});

test("pulseAlpha returns normalized value", () => {
  const alpha = pulseAlpha(12, 0.7, 0.8);
  assert.ok(alpha >= 0 && alpha <= 1);
});
