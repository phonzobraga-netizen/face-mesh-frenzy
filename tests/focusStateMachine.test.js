import test from "node:test";
import assert from "node:assert/strict";
import { PHASES, createFocusState, stepFocusState } from "../src/focusStateMachine.js";

const focusedSignals = {
  facePresent: true,
  torsoPresent: true,
  lookAway: false,
  phoneLikeDown: false,
  leftSeatLike: false,
  confidence: 1,
};

const offFocusSignals = {
  facePresent: true,
  torsoPresent: true,
  lookAway: true,
  phoneLikeDown: false,
  leftSeatLike: false,
  confidence: 1,
};

function readyState() {
  const state = createFocusState();
  state.calibration.complete = true;
  state.phase = PHASES.FOCUSED;
  return state;
}

test("does not open redirect for short off-focus period", () => {
  let state = readyState();
  let nowMs = 0;
  let action = null;

  for (let i = 0; i < 70; i += 1) {
    nowMs += 100;
    const next = stepFocusState(state, { nowMs, dtMs: 100, signals: offFocusSignals });
    state = next.state;
    action = next.action;
  }

  assert.equal(action, null);
  assert.equal(state.redirectOpen, false);
  assert.equal(state.phase, PHASES.OFF_FOCUS_PENDING);
  assert.ok(state.offFocusMs < 8000);
});

test("opens redirect after sustained off-focus reaches threshold", () => {
  let state = readyState();
  let nowMs = 0;
  let action = null;

  for (let i = 0; i < 80; i += 1) {
    nowMs += 100;
    const next = stepFocusState(state, { nowMs, dtMs: 100, signals: offFocusSignals });
    state = next.state;
    action = next.action;
  }

  assert.equal(action?.type, "open_redirect");
  assert.equal(state.redirectOpen, true);
  assert.equal(state.phase, PHASES.OFF_FOCUS_OPENED);
});

test("does not close immediately after open due to minimum-open guard", () => {
  let state = readyState();
  let nowMs = 0;

  for (let i = 0; i < 80; i += 1) {
    nowMs += 100;
    state = stepFocusState(state, { nowMs, dtMs: 100, signals: offFocusSignals }).state;
  }

  let action = null;
  for (let i = 0; i < 30; i += 1) {
    nowMs += 100;
    const next = stepFocusState(state, { nowMs, dtMs: 100, signals: focusedSignals });
    state = next.state;
    action = next.action;
  }

  assert.equal(action, null);
  assert.equal(state.redirectOpen, true);
  assert.equal(state.phase, PHASES.REFOCUS_PENDING);
});

test("closes redirect after stable refocus and minimum-open duration", () => {
  let state = readyState();
  let nowMs = 0;

  for (let i = 0; i < 80; i += 1) {
    nowMs += 100;
    state = stepFocusState(state, { nowMs, dtMs: 100, signals: offFocusSignals }).state;
  }

  let closeAction = null;
  for (let i = 0; i < 40; i += 1) {
    nowMs += 100;
    const next = stepFocusState(state, { nowMs, dtMs: 100, signals: focusedSignals });
    state = next.state;
    if (next.action?.type === "close_redirect") {
      closeAction = next.action;
      break;
    }
  }

  assert.equal(closeAction?.type, "close_redirect");
  assert.equal(state.redirectOpen, false);
  assert.equal(state.phase, PHASES.FOCUSED);
});

test("reopen guard blocks immediate reopen thrash after close", () => {
  let state = readyState();
  let nowMs = 0;

  for (let i = 0; i < 80; i += 1) {
    nowMs += 100;
    state = stepFocusState(state, { nowMs, dtMs: 100, signals: offFocusSignals }).state;
  }

  for (let i = 0; i < 40; i += 1) {
    nowMs += 100;
    state = stepFocusState(state, { nowMs, dtMs: 100, signals: focusedSignals }).state;
  }

  state.offFocusMs = 8000;
  const blocked = stepFocusState(state, {
    nowMs: nowMs + 500,
    dtMs: 100,
    signals: offFocusSignals,
  });
  state = blocked.state;

  assert.equal(blocked.action, null);
  assert.equal(state.redirectOpen, false);
  assert.equal(state.phase, PHASES.OFF_FOCUS_PENDING);

  const reopened = stepFocusState(state, {
    nowMs: nowMs + 2600,
    dtMs: 100,
    signals: offFocusSignals,
  });

  assert.equal(reopened.action?.type, "open_redirect");
  assert.equal(reopened.state.redirectOpen, true);
});
