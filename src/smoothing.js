export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function median(values, fallback = 0) {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function medianAbsoluteDeviation(values, pivot = null, fallback = 0) {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback;
  }

  const center = Number.isFinite(pivot) ? pivot : median(values, 0);
  const deviations = values.map((value) => Math.abs(Number(value) - center));
  return median(deviations, fallback);
}

export function createEmaSmoother(initial = 0, alphaRise = 0.28, alphaFall = 0.12) {
  return {
    value: Number.isFinite(initial) ? initial : 0,
    alphaRise: clamp(alphaRise, 0.01, 1),
    alphaFall: clamp(alphaFall, 0.01, 1),
  };
}

export function stepEma(smoother, target) {
  if (!smoother || !Number.isFinite(target)) {
    return smoother?.value ?? 0;
  }

  const alpha = target > smoother.value ? smoother.alphaRise : smoother.alphaFall;
  smoother.value += (target - smoother.value) * alpha;
  return smoother.value;
}

export function createMetricSmoother() {
  return {
    yaw: createEmaSmoother(0, 0.3, 0.13),
    pitch: createEmaSmoother(0, 0.28, 0.13),
    eyeX: createEmaSmoother(0, 0.28, 0.14),
    eyeY: createEmaSmoother(0, 0.28, 0.14),
    torsoScale: createEmaSmoother(0.18, 0.26, 0.16),
    torsoCenterX: createEmaSmoother(0.5, 0.2, 0.15),
    torsoCenterY: createEmaSmoother(0.6, 0.2, 0.15),
    faceScale: createEmaSmoother(0.24, 0.24, 0.14),
    eyeOpenness: createEmaSmoother(0.03, 0.24, 0.18),
  };
}

export function stepMetricSmoother(smoother, metrics = {}) {
  return {
    yaw: stepEma(smoother.yaw, Number(metrics.yaw ?? 0)),
    pitch: stepEma(smoother.pitch, Number(metrics.pitch ?? 0)),
    eyeX: stepEma(smoother.eyeX, Number(metrics.eyeX ?? 0)),
    eyeY: stepEma(smoother.eyeY, Number(metrics.eyeY ?? 0)),
    torsoScale: stepEma(smoother.torsoScale, Number(metrics.torsoScale ?? 0)),
    torsoCenterX: stepEma(smoother.torsoCenterX, Number(metrics.torsoCenterX ?? 0.5)),
    torsoCenterY: stepEma(smoother.torsoCenterY, Number(metrics.torsoCenterY ?? 0.6)),
    faceScale: stepEma(smoother.faceScale, Number(metrics.faceScale ?? 0.24)),
    eyeOpenness: stepEma(smoother.eyeOpenness, Number(metrics.eyeOpenness ?? 0.03)),
  };
}
