const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const backendRoot = path.join(__dirname, 'backend');
const helperMain = path.join(backendRoot, 'runtime', 'electron-helper', 'main.js');
const samePath = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
};

// Packaged Electron always loads resources/app, including helper/DPI subprocesses.
// Dispatch only our exact helper path, before taking the launcher's instance lock.
if (process.argv.slice(1).some((argument) => samePath(argument, helperMain))) {
  require(helperMain);
} else {
  runLauncher();
}

function runLauncher() {
  const { app, Tray, Menu, nativeImage, shell, dialog } = require('electron');
  app.setName('比格桌宠');
  let dataRoot;
  let logFile;
  let statusFile;
  let tray;
  let backend;
  let heartbeat;
  let ready = false;
  let stopping = false;
  let allowQuit = false;
  let fatalShown = false;
  let shutdownPromise;
  let phase = 'starting';
  let runtime;
  const testStatus = process.argv.includes('--bige-test-status');
  const testQuit = process.argv.includes('--bige-test-quit');
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function log(message) {
    if (!logFile) return;
    // Never retain an authenticated settings URL or a capability in launcher logs.
    const safe = String(message)
      .replace(/([#?]token=)[A-Za-z0-9_-]+/g, '$1[redacted]')
      .replace(/(x-dsh-pet-token["'\s:=]+)[A-Za-z0-9_-]{43}/gi, '$1[redacted]');
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${safe}\n`, 'utf8');
    } catch {
      // A full disk must not prevent shutdown.
    }
  }

  function writeStatus() {
    if (!statusFile) return;
    try {
      fs.writeFileSync(statusFile, JSON.stringify({
        phase,
        launcherPid: process.pid,
        backendPid: backend?.pid || null,
        port: runtime?.port || null,
        version: app.getVersion(),
        dataRoot,
        logFile,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch (error) {
      log(`无法更新启动状态：${error.message}`);
    }
  }

  async function fatal(message, error) {
    if (fatalShown) return;
    fatalShown = true;
    log(`${message}${error ? ` ${error.stack || error.message || String(error)}` : ''}`);
    phase = 'error';
    writeStatus();
    dialog.showErrorBox('比格桌宠', `${message}\n\n${logFile ? `详细日志：${logFile}` : '请将压缩包完整解压后重新启动。'}`);
    await shutdown();
  }

  function cleanEnvironment() {
    const env = { ...process.env };
    // Do not inherit smoke/probe/debug/bridge modes from a developer shell.
    for (const key of Object.keys(env)) {
      if (key.startsWith('DSH_PET_') || key.startsWith('ELECTRON_') || key.startsWith('NODE_')) delete env[key];
    }
    return {
      ...env,
      DSH_HOME: path.join(dataRoot, 'dsh'),
      DSH_PET_USER_DATA_DIR: path.join(dataRoot, 'electron-user-data'),
      DSH_PET_ELECTRON_PATH: process.execPath,
      ELECTRON_RUN_AS_NODE: '1',
      BIGE_PET_LAUNCHER_PID: String(process.pid),
    };
  }

  function readRuntime() {
    if (!backend?.pid) return undefined;
    try {
      const file = path.join(dataRoot, 'dsh', 'dsh-pet', 'standalone-runtime.json');
      if (fs.statSync(file).size > 16384) return undefined;
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        value.pid !== backend.pid || !samePath(value.pluginRoot, backendRoot) ||
        !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
        typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)
      ) return undefined;
      const expected = `http://127.0.0.1:${value.port}/standalone-ai/#token=${value.token}`;
      if (value.settingsUrl !== expected) return undefined;
      return value;
    } catch {
      return undefined;
    }
  }

  async function backendRequest(endpoint, options = {}, value = runtime || readRuntime()) {
    if (!value) throw new Error('桌宠还在启动，请稍后重试。');
    const response = await fetch(`http://127.0.0.1:${value.port}${endpoint}`, {
      ...options,
      headers: { 'x-dsh-pet-token': value.token, ...options.headers },
      signal: AbortSignal.timeout(2500),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`桌宠本机服务返回 ${response.status}。`);
    const result = await response.json();
    if (result?.ok === false) throw new Error(result.message || '桌宠设置未能保存。');
    return result;
  }

  async function showPets() {
    if (!ready || stopping) throw new Error('桌宠还在启动，请稍后重试。');
    const config = await backendRequest('/dsh-pet-7340/config');
    const pets = Array.isArray(config.main?.pets) ? config.main.pets : [];
    if (!pets.length) throw new Error('当前配置没有比格桌宠，请检查数据目录中的桌宠配置。');
    for (const pet of pets) {
      if (typeof pet.id !== 'string' || !pet.id) continue;
      // This endpoint also restarts the helper when display is already desktop.
      await backendRequest('/dsh-pet-7340/pet-display', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: pet.id, display: 'desktop' }),
      });
    }
  }

  function action(operation) {
    return () => void Promise.resolve().then(operation).catch((error) => {
      log(`操作未完成：${error.message}`);
      dialog.showErrorBox('比格桌宠', error.message || '操作未完成，请稍后重试。');
    });
  }

  function updateTray() {
    if (!tray || tray.isDestroyed()) return;
    tray.setToolTip(ready ? '比格桌宠' : '比格桌宠 · 正在启动');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: ready ? '比格桌宠正在运行' : '正在启动比格桌宠……', enabled: false },
      { type: 'separator' },
      { label: '显示 / 恢复比格', enabled: ready && !stopping, click: action(showPets) },
      { label: '打开 AI 设置', enabled: ready && !stopping, click: action(async () => {
        const current = readRuntime();
        if (!current) throw new Error('桌宠设置暂时不可用，请重新启动。');
        await shell.openExternal(current.settingsUrl);
      }) },
      { type: 'separator' },
      { label: '打开数据目录', click: action(async () => {
        const error = await shell.openPath(dataRoot);
        if (error) throw new Error(error);
      }) },
      { label: '打开日志目录', click: action(async () => {
        const error = await shell.openPath(path.dirname(logFile));
        if (error) throw new Error(error);
      }) },
      { type: 'separator' },
      { label: '退出比格桌宠', click: () => void shutdown() },
    ]));
  }

  async function waitForExit(child, timeout) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise((resolve) => {
      const finish = (exited) => {
        clearTimeout(timer);
        child.removeListener('exit', onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeout);
      child.once('exit', onExit);
    });
  }

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    ready = false;
    phase = 'stopping';
    updateTray();
    writeStatus();
    shutdownPromise = (async () => {
      const child = backend;
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        // Keep the IPC channel and heartbeats alive until graceful cleanup completes.
        const deadline = Date.now() + 7000;
        let requested = false;
        while (Date.now() < deadline && child.exitCode === null && !requested) {
          const current = readRuntime();
          if (current) {
            try {
              await backendRequest('/shutdown', { method: 'POST' }, current);
              requested = true;
            } catch {
              // Startup may not have finished listening yet.
            }
          }
          if (!requested) await pause(100);
        }
        if (!requested && child.connected) {
          try { child.send({ type: 'shutdown' }, () => {}); } catch { /* Already exiting. */ }
        }
        const exited = await waitForExit(child, Math.max(1000, deadline - Date.now()));
        if (!exited) {
          log('后端收尾超时，正在结束本次启动的后端。');
          child.kill('SIGKILL');
          await waitForExit(child, 1500);
        }
      }
      clearInterval(heartbeat);
      if (tray && !tray.isDestroyed()) tray.destroy();
      tray = undefined;
      phase = fatalShown ? 'error' : 'stopped';
      writeStatus();
      log('比格桌宠已退出。');
      allowQuit = true;
      app.quit();
    })().catch((error) => {
      log(`退出时发生错误：${error.message}`);
      try { backend?.kill('SIGKILL'); } catch { /* Already exited. */ }
      allowQuit = true;
      app.exit(1);
    });
    return shutdownPromise;
  }

  async function start() {
    const required = [
      path.join(__dirname, 'backend-runner.cjs'),
      path.join(backendRoot, 'package.json'),
      path.join(backendRoot, 'lib', 'standalone.js'),
      path.join(backendRoot, 'assets', 'config.jsonc'),
      path.join(backendRoot, 'assets', 'logo.png'),
      path.join(backendRoot, 'runtime', 'electron-helper', 'shared-core.js'),
      helperMain,
    ];
    if (required.some((file) => !fs.existsSync(file))) {
      throw new Error('桌宠程序文件不完整。请先将整个压缩包解压，再运行比格桌宠.exe。');
    }
    const icon = nativeImage.createFromPath(path.join(backendRoot, 'assets', 'logo.png'));
    if (icon.isEmpty()) throw new Error('桌宠图标无法读取，请重新解压完整压缩包。');
    tray = new Tray(icon.resize({ width: 24, height: 24 }));
    tray.on('double-click', action(showPets));
    updateTray();
    const env = cleanEnvironment();
    fs.mkdirSync(env.DSH_HOME, { recursive: true });
    fs.mkdirSync(env.DSH_PET_USER_DATA_DIR, { recursive: true });
    backend = spawn(process.execPath, [path.join(__dirname, 'backend-runner.cjs')], {
      cwd: dataRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    const child = backend;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => log(`[backend] ${chunk.trimEnd()}`));
    child.stderr.on('data', (chunk) => log(`[backend stderr] ${chunk.trimEnd()}`));
    child.once('error', (error) => void fatal('桌宠后端未能启动，请重新解压程序。', error));
    child.once('exit', (code, signal) => {
      log(`后端退出：code=${code}, signal=${signal}`);
      ready = false;
      updateTray();
      writeStatus();
      if (!stopping) void fatal('桌宠意外退出。请重新启动；如再次出现，请查看日志。');
    });
    child.on('error', () => {}); // IPC writes can race a backend that is shutting down.
    heartbeat = setInterval(() => {
      if (child.connected) {
        try { child.send({ type: 'heartbeat' }, () => {}); } catch { /* Exit handler reports failures. */ }
      }
    }, 2000);
    heartbeat.unref();
    writeStatus();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !stopping) {
      const current = readRuntime();
      if (current) {
        try {
          const health = await backendRequest('/health', {}, current);
          if (health.pid === child.pid && samePath(health.pluginRoot, backendRoot)) {
            runtime = current;
            ready = true;
            phase = 'ready';
            log(`比格桌宠启动成功，后端 PID=${child.pid}。`);
            updateTray();
            writeStatus();
            return;
          }
        } catch {
          // Capability file is written just before the backend starts its effects.
        }
      }
      await pause(150);
    }
    if (!stopping) throw new Error('桌宠启动超时。请关闭后重新启动，并检查日志目录。');
  }

  try {
    dataRoot = process.env.BIGE_PET_HOME
      ? path.resolve(process.env.BIGE_PET_HOME)
      : path.join(app.getPath('appData'), 'BigePet');
    fs.mkdirSync(path.join(dataRoot, 'logs'), { recursive: true });
    logFile = path.join(dataRoot, 'logs', 'desktop.log');
    // Status contains only diagnostic process/path details, never runtime tokens.
    statusFile = testStatus ? path.join(dataRoot, 'launcher-status.json') : undefined;
    const launcherUserData = path.join(dataRoot, 'launcher-user-data');
    fs.mkdirSync(launcherUserData, { recursive: true });
    app.setPath('userData', launcherUserData);
  } catch (error) {
    dialog.showErrorBox('比格桌宠', `无法创建本机数据目录，请检查磁盘和目录权限。\n\n${error.message}`);
    app.exit(1);
    return;
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--bige-test-status')) {
      statusFile = path.join(dataRoot, 'launcher-status.json');
      writeStatus();
    }
    if (argv.includes('--bige-test-quit')) {
      void shutdown();
    } else if (!argv.includes('--bige-test-status') && ready) {
      action(showPets)();
    }
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', (event) => {
    if (allowQuit) return;
    event.preventDefault();
    void shutdown();
  });
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('uncaughtException', (error) => void fatal('桌宠运行发生错误，请查看日志后重新启动。', error));
  process.on('unhandledRejection', (error) => void fatal('桌宠运行发生错误，请查看日志后重新启动。', error));
  app.whenReady().then(async () => {
    if (testQuit) {
      await shutdown();
      return;
    }
    log(`比格桌宠 ${app.getVersion()} 启动。`);
    writeStatus();
    await start();
  }).catch((error) => void fatal(error.message || '桌宠无法启动，请重新解压程序。', error));
}
