import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { rcedit } from 'rcedit';
import yazl from 'yazl';

// Only allowlisted application files and a clean production install enter the ZIP.
// In particular, the developer's .local data and Electron profiles are never copied.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'dsh-pet');
const args = process.argv.slice(2);
const metadata = JSON.parse(await readFile(join(root, 'desktop/package.json'), 'utf8'));
const nameIndex = args.indexOf('--name');
const name = nameIndex < 0 ? `比格桌宠-${metadata.version}-win-x64` : args[nameIndex + 1];
if (!name || !/^[\p{L}\p{N}._ -]+$/u.test(name) || name === '.' || name === '..') {
  throw new Error('--name 必须是一个文件夹名称。');
}
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('请在 Windows x64 上运行此打包脚本。');
}
const out = join(root, 'dist', name);
try {
  await stat(out);
  throw new Error(`输出目录已存在，请移走旧包或用 --name 指定新名称：${out}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function run(command, cwd, env = process.env) {
  const result = spawnSync(command, { cwd, env, shell: true, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`命令失败 (${result.status})：${command}`);
}

if (!args.includes('--skip-build')) run('npm run build', root);
const runtime = process.env.BIGE_ELECTRON_RUNTIME
  ? resolve(process.env.BIGE_ELECTRON_RUNTIME)
  : join(root, '.local', 'dsh', 'electron');
if (!process.env.BIGE_ELECTRON_RUNTIME) {
  run('node scripts/ensure-electron.mjs', source, { ...process.env, DSH_HOME: join(root, '.local', 'dsh') });
}
await stat(join(runtime, 'electron.exe'));
const electronVersion = (await readFile(join(runtime, 'version'), 'utf8')).trim();
console.log(`正在组装 Windows 便携版，Electron ${electronVersion}……`);
await mkdir(out, { recursive: true });
await cp(runtime, out, {
  recursive: true,
  filter: (file) => !['electron.exe', 'resources/default_app.asar'].includes(relative(runtime, file).replaceAll('\\', '/')),
});
const exe = join(out, '比格桌宠.exe');
await cp(join(runtime, 'electron.exe'), exe);
await rcedit(exe, {
  icon: join(root, 'desktop', 'icon.ico'),
  'file-version': `${metadata.version}.0`,
  'product-version': `${metadata.version}.0`,
  'requested-execution-level': 'asInvoker',
  'version-string': {
    ProductName: '比格桌宠',
    FileDescription: '比格桌宠',
    OriginalFilename: '比格桌宠.exe',
    InternalFilename: 'BigePet',
    CompanyName: 'Bige Pet contributors',
    LegalCopyright: 'Based on dsh-pet (MIT)',
  },
});

const app = join(out, 'resources', 'app');
const backend = join(app, 'backend');
await mkdir(backend, { recursive: true });
for (const file of ['package.json', 'main.cjs', 'backend-runner.cjs']) {
  await cp(join(root, 'desktop', file), join(app, file));
}
for (const file of [
  'package.json', 'package-lock.json', 'LICENSE',
  'lib/standalone.js', 'lib/client.js', 'lib/index.js',
  'runtime/electron-helper',
  'assets/webm', 'assets/fonts', 'assets/pic', 'assets/memes',
  'assets/config.jsonc', 'assets/logo.png', 'assets/bige-manifest.json',
]) {
  await cp(join(source, file), join(backend, file), { recursive: true });
}
run('npm ci --omit=dev --omit=peer --ignore-scripts --no-audit --no-fund', backend);
// npm's command shims and install bookkeeping are not used at runtime.
await rm(join(backend, 'node_modules', '.bin'), { recursive: true, force: true });
await rm(join(backend, 'package-lock.json'));
await cp(join(root, 'THIRD_PARTY_NOTICES.md'), join(out, 'THIRD_PARTY_NOTICES.md'));
await cp(join(root, 'LICENSE'), join(out, 'LICENSE.dsh-pet.txt'));
await writeFile(join(out, '使用说明.txt'), '\ufeff' + [
  '比格桌宠 · Windows x64 免安装版', '',
  '1. 将整个 ZIP 压缩包解压到一个文件夹。',
  '2. 双击文件夹中的“比格桌宠.exe”，稍等片刻，比格就会出现在桌面。',
  '3. 右键桌宠可以切换动作、聊天和打开设置；可以拖拽桌宠。',
  '4. 右下角系统托盘（可能在隐藏图标里）右键比格图标，可显示/恢复、打开 AI 设置或退出。',
  '5. 关闭时请选择托盘菜单中的“退出比格桌宠”。再次双击 EXE 会恢复已有桌宠。', '',
  '不需要安装 Node.js、npm 或 Python，也不需要管理员权限。',
  '请保留 EXE 旁的全部文件，不能只发送或移动单独一个 EXE。',
  '本包适用于 Windows 10/11 x64，不适用于 macOS、手机或 32 位 Windows。', '',
  '不配置 AI 也可使用动画、漫游、点击、拖拽等功能。',
  '平时每 60 秒切换表情；碰撞时切换为呆滞，停稳后随机恢复其他表情。',
  '如需聊天：打开 AI 设置，填写自己的接口地址、模型、API Key 并开启。',
  '本包不附带 API Key、聊天记录或制作者的个人配置。',
  '个人配置/聊天记录保存在 %APPDATA%\\BigePet，移动程序不会清空它们。',
  '故障时可通过托盘菜单打开日志目录。', '',
  '程序尚未签名，Windows 可能显示“未知发布者”。',
  '代码来源、MIT 许可和用户提供的漫画素材说明见 THIRD_PARTY_NOTICES.md。', '',
].join('\r\n'), 'utf8');

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`不应含符号链接：${file}`);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const files = await filesIn(out);
const manifest = {
  name: metadata.productName,
  version: metadata.version,
  electronVersion,
  platform: 'win32-x64',
  builtAt: new Date().toISOString(),
  files: [],
};
for (const file of files) {
  const filePath = relative(out, file).replaceAll('\\', '/');
  if (/(^|\/)(\.local|\.git|launcher-status\.json|standalone-runtime\.json|standalone-ai\.json|memory\.json|main-config\.jsonc)(\/|$)/i.test(filePath)) {
    throw new Error(`不应打包本机状态：${filePath}`);
  }
  manifest.files.push({ path: filePath, size: (await stat(file)).size, sha256: await sha256(file) });
}
await writeFile(join(out, 'package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const archive = `${out}.zip`;
const zip = new yazl.ZipFile();
const written = pipeline(zip.outputStream, createWriteStream(archive, { flags: 'wx' }));
for (const file of [...files, join(out, 'package-manifest.json')]) {
  zip.addFile(file, `${name}/${relative(out, file).replaceAll('\\', '/')}`);
}
zip.end();
await written;
const digest = await sha256(archive);
await writeFile(`${archive}.sha256`, `${digest}  ${name}.zip\n`);
console.log(JSON.stringify({ directory: out, archive, sizeMiB: +((await stat(archive)).size / 1048576).toFixed(1), sha256: digest, fileCount: manifest.files.length + 1 }, null, 2));
