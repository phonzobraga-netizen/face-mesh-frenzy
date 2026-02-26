export function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function landmarkToPoint(landmark, width, height, mirror = true) {
  const xNorm = clamp01(landmark.x ?? 0);
  const yNorm = clamp01(landmark.y ?? 0);

  return {
    x: (mirror ? 1 - xNorm : xNorm) * width,
    y: yNorm * height,
  };
}

export function getFaceBox(landmarks, width, height, mirror = true) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const landmark of landmarks) {
    const point = landmarkToPoint(landmark, width, height, mirror);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function estimateExpressionPulse(landmarks, width, height, mirror = true) {
  if (!Array.isArray(landmarks) || landmarks.length < 153) {
    return 0;
  }

  const upperLip = landmarkToPoint(landmarks[13], width, height, mirror);
  const lowerLip = landmarkToPoint(landmarks[14], width, height, mirror);
  const forehead = landmarkToPoint(landmarks[10], width, height, mirror);
  const chin = landmarkToPoint(landmarks[152], width, height, mirror);

  const mouthOpen = Math.abs(lowerLip.y - upperLip.y);
  const faceHeight = Math.max(1, Math.abs(chin.y - forehead.y));

  return clamp01((mouthOpen / faceHeight) * 10);
}

export function pulseAlpha(frame, expression, intensity) {
  const base = 0.22 + intensity * 0.45;
  const wave = (Math.sin(frame * 0.08) * 0.5 + 0.5) * 0.28;
  const expressionBoost = expression * 0.35;
  return clamp01(base + wave + expressionBoost);
}
