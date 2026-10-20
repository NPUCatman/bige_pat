import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "dsh-pet");
const args = process.argv.slice(2);
const home = resolve(root, process.env.BIGE_PET_HOME || join(".local", "dsh"));
const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_PET_USER_DATA_DIR: join(home, "electron-user-data"),
};
const inspectOnly = args.some((arg) =>
  ["--check", "--help", "-h"].includes(arg),
);
const runtimeFile = join(home, "dsh-pet", "standalone-runtime.json");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error("比格桌宠需要 Node.js 22.12 或更新版本。");
  process.exit(1);
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

// 先把带唯一所有者标记的临时目录写完整，再原子重命名为锁目录；锁不会出现半写入状态。
// 清理时只删除自己的标记，rmdir 只接受空目录，绝不会递归删除后来者取得的锁。
function acquireLaunchLock() {
  mkdirSync(home, { recursive: true });
  const lock = join(home, "launcher.lock");
  const token = randomUUID();
  const marker = `${process.pid}-${token}.json`;
  const candidate = join(home, `.launcher-${marker}.tmp`);
  mkdirSync(candidate);
  writeFileSync(
    join(candidate, marker),
    JSON.stringify({ pid: process.pid, token, app }),
    { mode: 0o600 },
  );
  let owned = false;
  const cleanupCandidate = () => {
    try {
      unlinkSync(join(candidate, marker));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      rmdirSync(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        renameSync(candidate, lock);
        owned = true;
        break;
      } catch (error) {
        if (!existsSync(lock)) throw error;
      }
      let entries;
      try {
        entries = readdirSync(lock);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      for (const entry of entries) {
        // 标记名本身含 PID；即便元数据意外损坏，也不会清掉仍存活的所有者。
        const ownerPid = Number(/^(\d+)-[\da-f-]+\.json$/i.exec(entry)?.[1]);
        if (!ownerPid) throw new Error(`启动锁内容异常，请检查：${lock}`);
        let owner;
        try {
          owner = JSON.parse(readFileSync(join(lock, entry), "utf8"));
        } catch (error) {
          if (error.code === "ENOENT") continue;
          owner = {};
        }
        if (isAlive(ownerPid) || isAlive(owner.childPid)) return null;
        try {
          unlinkSync(join(lock, entry));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      try {
        rmdirSync(lock);
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code))
          throw error;
      }
    }
    if (!owned) throw new Error("其他启动进程正在切换状态，请稍后重试。");
    return {
      child(pid) {
        writeFileSync(
          join(lock, marker),
          JSON.stringify({ pid: process.pid, childPid: pid, token, app }),
          { mode: 0o600 },
        );
      },
      release() {
        if (!owned) return;
        owned = false;
        try {
          unlinkSync(join(lock, marker));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        try {
          rmdirSync(lock);
        } catch (error) {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code))
            throw error;
        }
      },
    };
  } finally {
    if (!owned) cleanupCandidate();
  }
}

const launchLock = inspectOnly ? null : acquireLaunchLock();
if (!inspectOnly && !launchLock) {
  console.log("比格桌宠已经在启动或运行。关闭可运行 npm stop。");
  process.exit(0);
}
process.on("exit", () => launchLock?.release());

// 只复用已安装的运行时；配置、记忆、Chromium profile 和 DPI 缓存均使用本项目的数据目录。
if (!env.DSH_PET_ELECTRON_PATH) {
  const executable = process.platform === "win32" ? "electron.exe" : "electron";
  const existing = join(homedir(), ".dsh", "electron", executable);
  if (existsSync(existing)) env.DSH_PET_ELECTRON_PATH = existing;
}

function npm(command) {
  const result = spawnSync(
    process.platform === "win32" ? `npm ${command}` : "npm",
    process.platform === "win32" ? [] : command.split(" "),
    { cwd: app, env, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!existsSync(join(app, "node_modules", ".package-lock.json"))) {
  console.log("首次启动：正在安装依赖……");
  npm("install --no-audit --no-fund");
}

function newest(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(
    info.mtimeMs,
    ...readdirSync(path).map((entry) => newest(join(path, entry))),
  );
}
const outputs = [
  "lib/standalone.js",
  "lib/client.js",
  "runtime/electron-helper/shared-core.js",
];
const buildStamp = join(root, ".local", "build-stamp");
const buildTime = existsSync(buildStamp) ? statSync(buildStamp).mtimeMs : 0;
const hasOutputs = outputs.every((file) => existsSync(join(app, file)));
const latestSource = Math.max(
  ...[
    "src",
    "tsdown.config.mjs",
    "scripts/build-desktop-core.mjs",
    "scripts/prepare.js",
    "package.json",
  ].map((file) => newest(join(app, file))),
);
if (!hasOutputs || latestSource > buildTime) {
  console.log("正在构建比格桌宠……");
  npm("run build");
  mkdirSync(dirname(buildStamp), { recursive: true });
  writeFileSync(buildStamp, new Date().toISOString());
}

// 兼容修复前启动、尚无 launcher.lock 的实例；健康检查必须确认 PID 和本应用目录。
if (!inspectOnly && existsSync(runtimeFile)) {
  try {
    const runtime = JSON.parse(readFileSync(runtimeFile, "utf8"));
    const health = await fetch(`http://127.0.0.1:${runtime.port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const status = await health.json();
    if (
      health.ok &&
      status.pid === runtime.pid &&
      resolve(status.pluginRoot) === app
    ) {
      console.log(
        "比格桌宠已经在运行。右键桌宠打开菜单；关闭可运行 npm stop。",
      );
      process.exit(0);
    }
  } catch {
    /* 没有存活的本项目实例，正常启动。 */
  }
}

console.log(`比格桌宠 · 数据目录：${home}`);
const child = spawn(
  process.execPath,
  [join(app, "lib", "standalone.js"), ...args],
  {
    cwd: app,
    env,
    stdio: "inherit",
    windowsHide: true,
  },
);
if (child.pid) launchLock?.child(child.pid);
let childEnded = false;
let stopping = false;
const childDone = new Promise((done) => {
  child.once("close", (code) => {
    childEnded = true;
    process.exitCode = stopping ? 0 : (code ?? 1);
    launchLock?.release();
    done();
  });
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function waitForChild(timeoutMs) {
  return new Promise((done) => {
    const timer = setTimeout(() => done(false), timeoutMs);
    childDone.then(() => {
      clearTimeout(timer);
      done(true);
    });
  });
}

async function shutdownChild() {
  if (stopping || childEnded) return;
  stopping = true;
  // Windows 的 child.kill(SIGINT/SIGTERM) 是硬杀。先调用子进程自己的收尾入口，避免残留状态文件。
  const deadline = Date.now() + 7000;
  let requested = false;
  while (!childEnded && !requested && Date.now() < deadline) {
    try {
      const runtime = JSON.parse(readFileSync(runtimeFile, "utf8"));
      if (runtime.pid === child.pid && resolve(runtime.pluginRoot) === app) {
        const response = await fetch(
          `http://127.0.0.1:${runtime.port}/shutdown`,
          {
            method: "POST",
            headers: { "x-dsh-pet-token": runtime.token },
            signal: AbortSignal.timeout(
              Math.max(1, Math.min(1500, deadline - Date.now())),
            ),
          },
        );
        requested = response.ok;
      }
    } catch {
      /* 子进程可能尚未写状态文件，或已收到控制台 Ctrl+C 正在自行退出。 */
    }
    if (!requested && !childEnded) await pause(100);
  }
  if (!childEnded) await waitForChild(Math.max(1, deadline - Date.now()));
  if (!childEnded) {
    console.error("桌宠未在等待时间内退出，正在结束本次启动的进程。");
    child.kill("SIGKILL");
  }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void shutdownChild().catch((error) => {
      console.error(error.message);
      if (!childEnded) child.kill("SIGKILL");
    });
  });
