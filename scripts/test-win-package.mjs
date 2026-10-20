import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'dsh-pet', 'package.json'));
const { _electron } = require('playwright');
const { default: extract } = await import(pathToFileURL(require.resolve('@electron-internal/extract-zip')).href);
const archive = resolve(process.argv[2] || join(root, 'dist', '比格桌宠-0.1.0-win-x64.zip'));
const testRoot = join(root, '.local', `打包验证 空格-${Date.now()}`);
await mkdir(testRoot, { recursive: true });
await extract(archive, { dir: testRoot });
const packageName = archive.split(/[\\/]/).pop().replace(/\.zip$/, '');
const appRoot = join(testRoot, packageName);
const executablePath = join(appRoot, '比格桌宠.exe');
const dataRoot = join(testRoot, '个人数据');
const statusFile = join(dataRoot, 'launcher-status.json');
const env = { ...process.env, BIGE_PET_HOME: dataRoot };
for (const key of Object.keys(env)) {
  if (/^(DSH_PET_|ELECTRON_|NODE_)/i.test(key)) delete env[key];
  if (key.toLowerCase() === 'path') delete env[key];
}
env.Path = join(process.env.SystemRoot, 'System32');
assert.equal(spawnSync('node', ['--version'], { env, windowsHide: true }).error?.code, 'ENOENT');
assert.equal(spawnSync('npm', ['--version'], { env, windowsHide: true }).error?.code, 'ENOENT');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(operation, timeout = 35000) {
  const deadline = Date.now() + timeout;
  let error;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (caught) { error = caught; }
    await pause(150);
  }
  throw error || new Error('等待程序状态超时');
}
async function status(phase) {
  return until(async () => {
    const value = JSON.parse(await readFile(statusFile, 'utf8'));
    return value.phase === phase && value;
  });
}
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
async function secondary(...args) {
  const child = spawn(executablePath, args, { cwd: testRoot, env, windowsHide: true, stdio: 'ignore' });
  await new Promise((done, reject) => { child.once('exit', done); child.once('error', reject); });
}
let app;
let runtime;
let first;
try {
  app = await _electron.launch({ executablePath, args: ['--bige-test-status'], cwd: testRoot, env, timeout: 35000 });
  first = await status('ready');
  assert.ok(alive(first.backendPid));
  const metadata = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), execPath: process.execPath }));
  assert.equal(metadata.packaged, true);
  assert.equal(metadata.execPath.toLowerCase(), executablePath.toLowerCase());
  runtime = JSON.parse(await readFile(join(dataRoot, 'dsh', 'dsh-pet', 'standalone-runtime.json'), 'utf8'));
  assert.equal(runtime.pid, first.backendPid);
  const base = `http://127.0.0.1:${runtime.port}`;
  const auth = { 'x-dsh-pet-token': runtime.token };
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.pid, first.backendPid);
  assert.equal((await fetch(`${base}/standalone-ai/`)).status, 200);
  const settings = await (await fetch(`${base}/standalone-ai/settings`, { headers: auth })).json();
  assert.equal(settings.enabled, false);
  const config = await (await fetch(`${base}/dsh-pet-7340/config`, { headers: auth })).json();
  assert.ok(config.main?.pets?.length);
  const screenshot = await until(async () => app.evaluate(async ({ desktopCapturer }) => {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 960, height: 720 } });
    const pet = sources.find((source) => source.name.includes('比格桌宠（桌面模式）'));
    if (!pet || pet.thumbnail.isEmpty()) return false;
    const bitmap = pet.thumbnail.toBitmap();
    let colored = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      if (Math.max(bitmap[i], bitmap[i + 1], bitmap[i + 2]) - Math.min(bitmap[i], bitmap[i + 1], bitmap[i + 2]) > 25) colored++;
    }
    return colored > 200 && pet.thumbnail.toPNG().toString('base64');
  }));
  await writeFile(join(testRoot, 'packaged-pet.png'), Buffer.from(screenshot, 'base64'));
  assert.doesNotMatch(await readFile(join(dataRoot, 'logs', 'desktop.log'), 'utf8'), /ERR_FILE_NOT_FOUND|page load failed|后端加载失败/);
  await secondary('--bige-test-status');
  assert.equal((await status('ready')).backendPid, first.backendPid);
  await secondary();
  await secondary('--bige-test-status');
  assert.equal((await status('ready')).backendPid, first.backendPid);
  await secondary('--bige-test-quit');
  await status('stopped');
  await until(() => !alive(first.backendPid) && !alive(first.launcherPid));
  app = undefined;
  await assert.rejects(fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) }));
  const again = spawn(executablePath, ['--bige-test-status'], { cwd: testRoot, env, windowsHide: true, stdio: 'ignore' });
  await until(async () => { const value = await status('ready'); return value.launcherPid === again.pid && value; });
  await secondary('--bige-test-quit');
  await status('stopped');
  await until(() => !alive(again.pid));
  const manifest = JSON.parse(await readFile(join(appRoot, 'package-manifest.json'), 'utf8'));
  assert.ok(!manifest.files.some(({ path }) => /(^|\/)(\.local|\.git|standalone-runtime\.json|memory\.json)(\/|$)/.test(path)));
  const result = { passed: true, archive, testRoot, noNodeOrNpmOnPath: true, coldLaunch: true, singleInstance: true, settings: true, gracefulExit: true, relaunch: true, packaged: metadata, files: manifest.files.length + 1 };
  await writeFile(join(testRoot, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (runtime && alive(runtime.pid)) {
    await secondary('--bige-test-quit').catch(() => {});
  }
  if (app) await app.close().catch(() => {});
}
