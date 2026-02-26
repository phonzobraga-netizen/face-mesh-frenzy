import { clamp } from "./smoothing.js";

export const PHASES = {
  CALIBRATING: "calibrating",
  FOCUSED: "focused",
  OFF_FOCUS_PENDING: "off_focus_pending",
  OFF_FOCUS_OPENED: "off_focus_opened",
  REFOCUS_PENDING: "refocus_pending",
};

export const DEFAULT_MACHINE_CONFIG = {
  offFocusOpenMs: 8000,
  refocusCloseMs: 3000,
  minOpenMs: 4000,
  reopenGuardMs: 2000,
  hardEvidenceMultiplier: 1.45,
  softEvidenceMultiplier: 1,
  evidenceDecayMultiplier: 1.8,
  refocusDecayMultiplier: 1.6,
};

export function createFocusState() {
  return {
    phase: PHASES.CALIBRATING,
    offFocusMs: 0,
    refocusMs: 0,
    redirectOpen: false,
    lastReason: "calibrating",
    calibration: {
      complete: false,
      sampleCount: 0,
      remainingMs: 5000,
      extended: false,
    },
    lastOpenedAt: 0,
    lastClosedAt: Number.NEGATIVE_INFINITY,
  };
}

function currentReason(signals) {
  if (!signals) {
    return "no_signal";
  }
  if (signals.leftSeatLike) {
    return "left_seat_like";
  }
  if (!signals.facePresent) {
    return "face_absent";
  }
  if (!signals.torsoPresent) {
    return "torso_absent";
  }
  if (signals.phoneLikeDown) {
    return "phone_like_down";
  }
  if (signals.lookAway) {
    return "look_away";
  }
  return "focused";
}

function isHardOffFocus(signals) {
  if (!signals) {
    return true;
  }
  return !signals.facePresent || !signals.torsoPresent || signals.leftSeatLike;
}

function isSoftOffFocus(signals) {
  if (!signals) {
    return false;
  }
  return signals.lookAway || signals.phoneLikeDown;
}

function isStrongFocus(signals) {
  if (!signals) {
    return false;
  }
  return (
    signals.facePresent &&
    signals.torsoPresent &&
    !signals.lookAway &&
    !signals.phoneLikeDown &&
    !signals.leftSeatLike
  );
}

export function stepFocusState(prevState, input = {}, config = DEFAULT_MACHINE_CONFIG) {
  const state = {
    ...createFocusState(),
    ...(prevState || {}),
    calibration: {
      ...createFocusState().calibration,
      ...(prevState?.calibration || {}),
      ...(input.calibration || {}),
    },
  };

  const resolvedConfig = { ...DEFAULT_MACHINE_CONFIG, ...(config || {}) };
  const dtMs = clamp(Number(input.dtMs ?? 0), 0, 200);
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const signals = input.signals || null;
  const reason = state.calibration.complete ? currentReason(signals) : "calibrating";

  state.lastReason = reason;

  if (!state.calibration.complete) {
    state.phase = PHASES.CALIBRATING;
    state.offFocusMs = 0;
    state.refocusMs = 0;
    return {
      state,
      action: null,
    };
  }

  const hardOffFocus = isHardOffFocus(signals);
  const softOffFocus = isSoftOffFocus(signals);
  const inStrongFocus = isStrongFocus(signals);
  const reopenReady = nowMs - state.lastClosedAt >= resolvedConfig.reopenGuardMs;

  if (!state.redirectOpen) {
    if (hardOffFocus) {
      state.offFocusMs += dtMs * resolvedConfig.hardEvidenceMultiplier;
      state.refocusMs = 0;
    } else if (softOffFocus) {
      state.offFocusMs += dtMs * resolvedConfig.softEvidenceMultiplier;
      state.refocusMs = 0;
    } else {
      state.offFocusMs = Math.max(0, state.offFocusMs - dtMs * resolvedConfig.evidenceDecayMultiplier);
      state.refocusMs = 0;
    }

    if (state.offFocusMs >= resolvedConfig.offFocusOpenMs && reopenReady) {
      state.offFocusMs = resolvedConfig.offFocusOpenMs;
      state.redirectOpen = true;
      state.refocusMs = 0;
      state.lastOpenedAt = nowMs;
      state.phase = PHASES.OFF_FOCUS_OPENED;
      return {
        state,
        action: {
          type: "open_redirect",
          reason: state.lastReason,
        },
      };
    }

    state.phase = state.offFocusMs > 0 ? PHASES.OFF_FOCUS_PENDING : PHASES.FOCUSED;
    return {
      state,
      action: null,
    };
  }

  if (hardOffFocus) {
    state.offFocusMs += dtMs * resolvedConfig.hardEvidenceMultiplier;
  } else if (softOffFocus) {
    state.offFocusMs += dtMs * resolvedConfig.softEvidenceMultiplier;
  } else {
    state.offFocusMs = Math.max(0, state.offFocusMs - dtMs * resolvedConfig.evidenceDecayMultiplier);
  }
  state.offFocusMs = clamp(state.offFocusMs, 0, resolvedConfig.offFocusOpenMs);

  if (inStrongFocus) {
    state.refocusMs += dtMs;
  } else {
    state.refocusMs = Math.max(0, state.refocusMs - dtMs * resolvedConfig.refocusDecayMultiplier);
  }
  state.refocusMs = clamp(state.refocusMs, 0, resolvedConfig.refocusCloseMs);

  if (state.refocusMs > 0) {
    state.phase = PHASES.REFOCUS_PENDING;
  } else {
    state.phase = PHASES.OFF_FOCUS_OPENED;
  }

  const openLongEnough = nowMs - state.lastOpenedAt >= resolvedConfig.minOpenMs;
  if (state.refocusMs >= resolvedConfig.refocusCloseMs && openLongEnough) {
    state.redirectOpen = false;
    state.phase = PHASES.FOCUSED;
    state.offFocusMs = 0;
    state.refocusMs = 0;
    state.lastClosedAt = nowMs;
    return {
      state,
      action: {
        type: "close_redirect",
      },
    };
  }

  return {
    state,
    action: null,
  };
}
