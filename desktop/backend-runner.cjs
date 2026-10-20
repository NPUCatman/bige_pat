// Electron's bundled Node runs the unchanged standalone backend in this process.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const backend = path.join(__dirname, 'backend');
const entry = path.join(backend, 'lib', 'standalone.js');
const parentPid = Number(process.env.BIGE_PET_LAUNCHER_PID);
const runtimeFile = path.join(process.env.DSH_HOME || '', 'dsh-pet', 'standalone-runtime.json');
let lastHeartbeat = Date.now();
let stopping = false;

if (!process.connected || !Number.isInteger(parentPid) || parentPid <= 0 || parentPid !== process.ppid) {
  console.error('比格桌宠后端必须由桌面启动器运行。');
  process.exit(2);
}

async function stopAfterParent(reason) {
  if (stopping) return;
  stopping = true;
  clearInterval(watchdog);
  console.log(`桌面启动器已关闭，后端正在收尾（${reason}）。`);
  // Cover loss of the launcher while the standalone module is still importing.
  const deadline = Date.now() + 6500;
  const forcedExit = setTimeout(() => process.exit(1), 8000);
  forcedExit.unref();
  while (Date.now() < deadline) {
    try {
      const runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
      if (
        runtime.pid === process.pid &&
        typeof runtime.pluginRoot === 'string' &&
        path.resolve(runtime.pluginRoot).toLowerCase() === backend.toLowerCase() &&
        Number.isInteger(runtime.port) && runtime.port > 0 && runtime.port < 65536 &&
        typeof runtime.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(runtime.token)
      ) {
        const response = await fetch(`http://127.0.0.1:${runtime.port}/shutdown`, {
          method: 'POST',
          headers: { 'x-dsh-pet-token': runtime.token },
          signal: AbortSignal.timeout(1200),
        });
        if (response.ok) return; // Standalone performs its own cleanup and exits.
      }
    } catch {
      // Its capability file may not have been written yet, or cleanup has started.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  process.exit(1);
}

process.on('message', (message) => {
  if (message?.type === 'heartbeat') lastHeartbeat = Date.now();
  if (message?.type === 'shutdown') void stopAfterParent('shutdown');
});
process.on('disconnect', () => void stopAfterParent('IPC disconnected'));
const watchdog = setInterval(() => {
  let alive = true;
  try {
    process.kill(parentPid, 0);
  } catch (error) {
    alive = error.code !== 'ESRCH';
  }
  if (!alive || Date.now() - lastHeartbeat > 30000) void stopAfterParent('launcher heartbeat');
}, 2000);
watchdog.unref();

// The imported CLI reads process.argv.slice(2); launcher switches are never forwarded.
process.argv = [process.execPath, entry];
import(pathToFileURL(entry).href).catch((error) => {
  console.error('比格桌宠后端加载失败：', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
