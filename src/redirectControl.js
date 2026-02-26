import path from "node:path";
import fs from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";

export const REDIRECT_URL = "https://careers.mcdonalds.com/";

function resolveProgramFilesPath(envValue, fallback) {
  return String(envValue || fallback);
}

function chromeCandidates(env = process.env) {
  const localAppData = String(env.LOCALAPPDATA || "");
  return [
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(
      resolveProgramFilesPath(env.ProgramFiles, "C:\\Program Files"),
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
    path.join(
      resolveProgramFilesPath(env["ProgramFiles(x86)"], "C:\\Program Files (x86)"),
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
  ];
}

function edgeCandidate(env = process.env) {
  return path.join(
    resolveProgramFilesPath(env["ProgramFiles(x86)"], "C:\\Program Files (x86)"),
    "Microsoft",
    "Edge",
    "Application",
    "msedge.exe"
  );
}

export function resolveBrowserExecutable({ env = process.env, existsSync = fs.existsSync } = {}) {
  const chromePaths = chromeCandidates(env);
  for (const candidate of chromePaths) {
    if (existsSync(candidate)) {
      return {
        browser: "chrome",
        executablePath: candidate,
      };
    }
  }

  const edgePath = edgeCandidate(env);
  if (existsSync(edgePath)) {
    return {
      browser: "edge",
      executablePath: edgePath,
    };
  }

  return null;
}

function launchArgs(url, userDataDir) {
  return [
    "--new-window",
    `--app=${url}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-session-crashed-bubble",
    "--no-first-run",
  ];
}

function createTaskkillRunner(spawnTaskkill = nodeSpawn) {
  return async function runTaskkill(pid) {
    return new Promise((resolve) => {
      let resolved = false;
      const settle = (value) => {
        if (!resolved) {
          resolved = true;
          resolve(Boolean(value));
        }
      };

      try {
        const killer = spawnTaskkill("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });

        killer.once("error", () => settle(false));
        killer.once("close", (code) => settle(code === 0));
      } catch {
        settle(false);
      }
    });
  };
}

export function createRedirectController({
  env = process.env,
  existsSync = fs.existsSync,
  spawnProcess = nodeSpawn,
  spawnTaskkill = nodeSpawn,
  appDataPath = process.cwd(),
  openExternal = async () => {},
  redirectUrl = REDIRECT_URL,
} = {}) {
  const runTaskkill = createTaskkillRunner(spawnTaskkill);
  const userDataDir = path.join(appDataPath, "focusguard-browser-profile");

  const state = {
    child: null,
    pid: null,
    browser: "external",
  };

  function clearChild() {
    state.child = null;
    state.pid = null;
    state.browser = "external";
  }

  function bindLifecycle(child) {
    child.once("exit", () => {
      if (state.pid === child.pid) {
        clearChild();
      }
    });
    child.once("error", () => {
      if (state.pid === child.pid) {
        clearChild();
      }
    });
  }

  async function openRedirect() {
    if (state.pid) {
      return {
        opened: false,
        pid: state.pid,
        browser: state.browser,
      };
    }

    const resolved = resolveBrowserExecutable({ env, existsSync });
    if (!resolved?.executablePath) {
      await openExternal(redirectUrl);
      return {
        opened: true,
        pid: null,
        browser: "external",
      };
    }

    const args = launchArgs(redirectUrl, userDataDir);
    const child = spawnProcess(resolved.executablePath, args, {
      detached: false,
      windowsHide: true,
      stdio: "ignore",
    });

    state.child = child;
    state.pid = Number.isFinite(child.pid) ? child.pid : null;
    state.browser = resolved.browser;
    bindLifecycle(child);
    if (typeof child.unref === "function") {
      child.unref();
    }

    return {
      opened: true,
      pid: state.pid,
      browser: state.browser,
    };
  }

  async function closeRedirect() {
    if (!state.pid) {
      return { closed: false };
    }

    const pid = state.pid;
    const closed = await runTaskkill(pid);
    clearChild();
    return { closed };
  }

  function getRedirectState() {
    return {
      isOpen: Boolean(state.pid),
      pid: state.pid,
    };
  }

  return {
    openRedirect,
    closeRedirect,
    getRedirectState,
  };
}
