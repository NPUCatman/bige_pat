#!/usr/bin/env node
/**
 * ============================================================================
 * prepack-check.js —— 发布前健康检查
 * ============================================================================
 *
 * 【作用】
 *   在 `npm publish` / `npm pack` 之前自动运行（由 package.json 的
 *   "prepack" 脚本触发），逐项检查插件包是否"可发布"。
 *   任何一项失败都会置 exit code 为 1，阻止发布一个坏包。
 *
 * 【检查项】
 *   1. 必需文件是否存在（lib、类型声明、patch、对齐参数）
 *   2. 配置内全部动作都有素材，余额/工作状态各保留六档，随机权重合计 100
 *   3. 原始 1200×1200 母版不得进 npm 包（体积超限，应放 GitHub Releases）
 *   4. client.js 是官方 bundle 形态（__ModuleLoader__.load + exports.apply）
 *   5. package.json 声明了 dsh.bundle 和 dsh.client（否则装不上）
 *   6. 表情包图片确实随包发布（files 白名单含 assets/memes 且目录里有 png；
 *      配图功能依赖 assets/memes），并严格核对 memes 键、描述与图片对齐
 *   7. 包总大小 < 200MB（自设软上限，防误塞母版；npm 硬上限远更大）
 *
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 包根目录（scripts/ 的上一级）
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// 失败/通过 的输出辅助
const fail = (msg) => {
  console.error(`[prepack-check] FAIL: ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`[prepack-check] ok: ${msg}`);
/** JSONC → JSON：字符串感知地剥离行注释与块注释（config.jsonc 里有行尾注释） */
const stripJsonc = (s) => {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += s[++i] ?? '';
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
};

// ---- 1. 必需文件存在性 ----
const required = [
  'lib/index.js', // 宿主半侧
  'lib/client.js', // 浏览器半侧
  'lib/standalone.js', // 无 DSH 时的独立启动入口
  'lib/types/index.d.ts', // 宿主类型声明
  'lib/types/client/index.d.ts', // 客户端类型声明
  'cordis.patch.yml', // bundle patch（挂载声明）
  'runtime/electron-helper/main.js', // 桌面模式 Electron 主进程
  'runtime/electron-helper/pointer-target.js', // 桌面模式点击穿透兜底判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/host-liveness.js', // 桌面模式宿主存活判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/topmost-watchdog.js', // 桌面模式置顶看门狗判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/dpi-linearization.js', // 桌面模式 DPI 线性化判定与换算（main.js require，缺了会启动即崩）
  'runtime/electron-helper/tray-platform.js', // 桌面模式托盘平台差异判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/desktop-geometry.js', // 活动边界与菜单工作区分离
  'runtime/electron-helper/preload.js', // 桌面模式 preload 桥
  'runtime/electron-helper/renderer.js', // 桌面模式渲染端（宠物本体）
  'runtime/electron-helper/shared-core.js', // 桌面模式共享纯逻辑（src/shared 构建产物，window.PetShared）
  'runtime/electron-helper/index.html', // 桌面模式页面壳
];
for (const f of required) {
  existsSync(join(ROOT, f)) ? ok(`exists ${f}`) : fail(`missing ${f}`);
}

// ---- 2. 从配置收集所有动作，避免换皮后遗漏点击/拖拽/移动/事件素材 ----
let config;
try {
  config = JSON.parse(stripJsonc(readFileSync(join(ROOT, 'assets', 'config.jsonc'), 'utf8')));
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('expected an object');
  ok('default config parses');
} catch (e) {
  config = undefined;
  fail(`cannot read assets/config.jsonc: ${e.message}`);
}
if (config) {
  const names = new Set();
  const addName = (name, label) => {
    // 动作名是无扩展名的文件名，不得作为路径或绕出素材目录。
    // eslint-disable-next-line no-control-regex
    if (typeof name !== 'string' || !name.trim() || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..') {
      fail(`invalid animation name at ${label}`);
      return;
    }
    names.add(name);
  };
  const addPool = (pool, label) => {
    if (!Array.isArray(pool) || !pool.length) {
      fail(`${label} must be a non-empty animation array`);
      return;
    }
    pool.forEach((name, index) => addName(name, `${label}[${index}]`));
  };
  const animations = config.animations;
  if (!animations || typeof animations !== 'object' || Array.isArray(animations)) fail('missing animations config');
  else {
    for (const key of ['idle', 'turn', 'drag', 'clicks']) addPool(animations[key], `animations.${key}`);
    const moves = animations.moves?.actions;
    if (!Array.isArray(moves) || !moves.length) fail('animations.moves.actions must not be empty');
    else moves.forEach((move, index) => addName(move?.name, `animations.moves.actions[${index}].name`));
    const categories = animations.categories;
    if (!Array.isArray(categories) || !categories.length) fail('animations.categories must not be empty');
    else {
      categories.forEach((category, index) => addPool(category?.actions, `animations.categories[${index}].actions`));
      const weights = [
        ...['idle', 'turn', 'move'].map((key) => config.animationWeights?.[key]),
        ...categories.map((category) => category?.weight),
      ];
      if (weights.some((weight) => typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0))
        fail('animation weights must be finite non-negative numbers');
      else if (Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) > 1e-9)
        fail('top-level and category animation weights must total 100');
      else ok('animation weights total 100');
    }
    const events = animations.events;
    if (!events || typeof events !== 'object' || Array.isArray(events)) fail('missing animations.events');
    else {
      for (const key of ['balance', 'workStatus']) {
        if (!Array.isArray(events[key]) || events[key].length !== 6) fail(`animations.events.${key} must keep 6 slots`);
        else ok(`animations.events.${key} keeps 6 slots`);
      }
      if (!Array.isArray(events.whisper) || !events.whisper.length) fail('animations.events.whisper must not be empty');
      for (const [event, slots] of Object.entries(events)) {
        if (!Array.isArray(slots) || !slots.length) {
          fail(`animations.events.${event} must be a non-empty slot array`);
          continue;
        }
        slots.forEach((slot, index) => {
          const label = `animations.events.${event}[${index}]`;
          if (Array.isArray(slot)) addPool(slot, label);
          else addName(slot, label);
        });
      }
    }
    // 播放结束和右键菜单按动作名识别用途。换皮素材可以复用画面，但各用途必须用独立别名。
    const roles = [
      ...['idle', 'turn', 'drag', 'clicks'].map((key) => [key, animations[key]]),
      ['moves', Array.isArray(moves) ? moves.map((move) => move?.name) : []],
      ['categories', Array.isArray(categories) ? categories.flatMap((category) => category?.actions ?? []) : []],
      ...Object.entries(events ?? {}).map(([key, slots]) => [`events.${key}`, [slots].flat(3)]),
    ];
    const owners = new Map();
    for (const [role, pool] of roles) {
      if (!Array.isArray(pool)) continue;
      for (const name of pool) {
        if (typeof name !== 'string') continue;
        const owner = owners.get(name);
        if (owner && owner !== role)
          fail(`animation ${name} overlaps ${owner} and ${role}; use separate asset aliases`);
        else owners.set(name, role);
      }
    }
  }
  const missing = [...names].filter((name) => {
    const file = join(ROOT, 'assets', 'webm', `${name}.webm`);
    return !existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0;
  });
  if (missing.length) fail(`missing or empty animation assets: ${missing.join(', ')}`);
  else if (names.size) ok(`all ${names.size} configured animation assets present`);
}

// ---- 3. 原始母版不得进 npm 包 ----
// assets/ 根下若有 .webm 就是原始母版（播放素材在 assets/webm|mov 子目录）
const originals = [];
const assetsRoot = join(ROOT, 'assets');
for (const name of readdirSync(assetsRoot)) {
  if (name.endsWith('.webm')) originals.push(name);
}
if (originals.length > 0)
  fail(`original masters must not ship in npm package: ${originals.join(', ')} (move them to GitHub Releases)`);
else ok('no original masters in assets/');

// ---- 4. client.js 必须是官方 bundle 形态（含插件三件套导出） ----
const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
client.includes('__ModuleLoader__.load')
  ? ok('client bundle shell OK')
  : fail('client.js missing __ModuleLoader__.load');
const exportsPlugin =
  /exports\.(apply|inject|name)/.test(client) || /module\.exports\s*=\s*\{[^}]*apply[^}]*inject[^}]*name/.test(client);
exportsPlugin ? ok('client exports apply/inject/name') : fail('client.js missing apply/inject/name exports');

// ---- 5. package.json 必须声明 bundle + client ----
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (pkg.dsh?.bundle?.patch) ok('dsh.bundle.patch declared');
else fail('package.json missing dsh.bundle.patch');
if (pkg.dsh?.client?.platform === 'web') ok('dsh.client.web declared');
else fail('package.json missing dsh.client platform web');

// ---- 6. 表情包图片必须随包发布（配图功能的素材源） ----
// 坑：scripts/prepare.js 每次发布都会用**硬编码白名单覆盖** package.json 的 files，
// 只在 package.json 里加一行是无效的 → 这里显式断言，防止再次静默漏发。
const memesDir = join(ROOT, 'assets', 'memes');
if (Array.isArray(pkg.files) && pkg.files.includes('assets/memes')) ok('files includes assets/memes');
else fail('package.json files must include assets/memes (meme images would not ship)');
const memePngs = existsSync(memesDir) ? readdirSync(memesDir).filter((n) => n.endsWith('.png')) : [];
if (memePngs.length > 0) ok(`meme images present (${memePngs.length} png)`);
else fail('no png in assets/memes (whisper/chat 配图会整体失效)');
// 缺图会导致配图条目被运行时剔除，额外旧图容易把换皮素材混入发布包；这里直接阻止打包。
if (config) {
  const memes = config.memes;
  if (!memes || typeof memes !== 'object' || Array.isArray(memes) || !Object.keys(memes).length)
    fail('config.memes must be a non-empty image mapping');
  const keys = Object.keys(memes ?? {});
  const invalid = keys.filter((key) => typeof memes[key] !== 'string' || !memes[key].trim());
  if (invalid.length) fail(`empty or invalid meme descriptions: ${invalid.join(', ')}`);
  const onDisk = new Set(memePngs.map((n) => n.slice(0, -'.png'.length)));
  const missing = keys.filter((key) => !onDisk.has(key) || statSync(join(memesDir, `${key}.png`)).size === 0);
  const extra = [...onDisk].filter((k) => !keys.includes(k));
  if (!missing.length && !extra.length) ok(`memes mapping aligned (${keys.length} keys = ${memePngs.length} png)`);
  else
    fail(
      `memes 键与图片不齐 —— 缺图/空图 ${missing.length} 条${
        missing.length ? `（${missing.join('、')}）` : ''
      }；没写进配置的图 ${extra.length} 张${extra.length ? `（${extra.join('、')}）` : ''}`,
    );
}

// ---- 7. 包总大小估算（排除 node_modules/.git/脚本/素材源目录/README预览GIF） ----
let total = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过不会进 npm 包的目录
      if (!['node_modules', '.git', 'scripts', 'step01', 'step02', 'step03', 'preview'].includes(entry.name)) walk(p);
    } else if (!entry.name.endsWith('.map')) {
      // 打包产物 tarball（npm pack 遗留）不计入自查口径
      if (!entry.name.endsWith('.tgz')) total += statSync(p).size; // sourcemap 不计
    }
  }
};
walk(ROOT);
const mb = (total / 1e6).toFixed(1);
if (total > 200e6) fail(`package too large: ${mb}MB (limit 200MB)`);
else ok(`package size ${mb}MB`);

// ---- 8. 构建产物不得引入未声明的外部 helper（@oxc-project/runtime） ----
// rolldown 在 target es2020 下会为「带初始化器的类字段」这类降级语法产出
// `import _defineProperty from "@oxc-project/runtime/helpers/defineProperty"`；而该包既不在本包
// dependencies 里、也不随包发布（宿主 DSH 的安装树里同样没有）→ DSH 加载插件树时直接
// ERR_MODULE_NOT_FOUND，整个 profile 起不来（issue #59 改动踩过一次，见 src/host/helper-process.ts
// 的约定：类字段一律 `declare` + 构造器赋值，避免降级出外部 helper）。
const OXC_RUNTIME = '@oxc-project/runtime';
const oxcBundles = ['lib/index.js', 'lib/client.js'].filter((f) => {
  const p = join(ROOT, f);
  return existsSync(p) && readFileSync(p, 'utf8').includes(OXC_RUNTIME);
});
if (oxcBundles.length > 0)
  fail(
    `bundle imports undeclared helper ${OXC_RUNTIME} (${oxcBundles.join(', ')}) — ` +
      '类字段改用 declare + 构造器赋值（见 src/host/helper-process.ts 的约定）',
  );
else ok(`no undeclared ${OXC_RUNTIME} import in bundles`);

// ---- 汇总 ----
if (process.exitCode) console.error('\n[prepack-check] fix the failures above before publishing.');
else console.log('\n[prepack-check] all checks passed — ready to pack/publish.');
