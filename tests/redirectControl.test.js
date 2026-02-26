import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRedirectController, resolveBrowserExecutable } from "../src/redirectControl.js";

function makeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = () => {};
  return child;
}

test("openRedirect is idempotent while tracked browser process is open", async () => {
  const spawnCalls = [];
  const controller = createRedirectController({
    appDataPath: "C:\\appData",
    env: {
      LOCALAPPDATA: "C:\\Temp\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    },
    existsSync: (filePath) => filePath.includes("AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
    spawnProcess: (command, args) => {
      spawnCalls.push({ command, args });
      return makeChild(2480);
    },
    spawnTaskkill: () => {
      const child = makeChild(0);
      process.nextTick(() => child.emit("close", 0));
      return child;
    },
  });

  const first = await controller.openRedirect();
  const second = await controller.openRedirect();

  assert.equal(first.opened, true);
  assert.equal(first.pid, 2480);
  assert.equal(first.browser, "chrome");
  assert.equal(second.opened, false);
  assert.equal(second.pid, 2480);
  assert.equal(spawnCalls.length, 1);
});

test("closeRedirect only targets tracked pid and is safe when already closed", async () => {
  const killCalls = [];
  const controller = createRedirectController({
    appDataPath: "C:\\appData",
    env: {
      LOCALAPPDATA: "C:\\Temp\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    },
    existsSync: (filePath) => filePath.includes("AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
    spawnProcess: () => makeChild(9911),
    spawnTaskkill: (command, args) => {
      killCalls.push({ command, args });
      const child = makeChild(0);
      process.nextTick(() => child.emit("close", 0));
      return child;
    },
  });

  await controller.openRedirect();
  const closeResult = await controller.closeRedirect();
  const closeAgain = await controller.closeRedirect();

  assert.equal(closeResult.closed, true);
  assert.equal(closeAgain.closed, false);
  assert.equal(killCalls.length, 1);
  assert.deepEqual(killCalls[0].args, ["/PID", "9911", "/T", "/F"]);
});

test("path resolution prefers LOCALAPPDATA chrome path first", () => {
  const env = {
    LOCALAPPDATA: "C:\\L",
    ProgramFiles: "C:\\PF",
    "ProgramFiles(x86)": "C:\\PF86",
  };

  const found = resolveBrowserExecutable({
    env,
    existsSync: (filePath) =>
      filePath === "C:\\L\\Google\\Chrome\\Application\\chrome.exe" ||
      filePath === "C:\\PF\\Google\\Chrome\\Application\\chrome.exe",
  });

  assert.equal(found.browser, "chrome");
  assert.equal(found.executablePath, "C:\\L\\Google\\Chrome\\Application\\chrome.exe");
});

test("edge fallback is used when chrome is not installed", () => {
  const env = {
    LOCALAPPDATA: "C:\\L",
    ProgramFiles: "C:\\PF",
    "ProgramFiles(x86)": "C:\\PF86",
  };

  const found = resolveBrowserExecutable({
    env,
    existsSync: (filePath) => filePath === "C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe",
  });

  assert.equal(found.browser, "edge");
  assert.equal(found.executablePath, "C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe");
});
