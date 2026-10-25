import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const originalDeepSeek = process.argv[2] === "--original-deepseek";
const label = originalDeepSeek ? "原版 DeepSeek 桌宠" : "比格桌宠";
const app = originalDeepSeek
  ? resolve(root, "..", "dsh-pet", "dsh-pet")
  : join(root, "dsh-pet");
const home = resolve(
  root,
  originalDeepSeek
    ? process.env.DEEPSEEK_PET_HOME ||
        join(".local", "original-deepseek", "dsh")
    : process.env.BIGE_PET_HOME || join(".local", "dsh"),
);
try {
  const runtime = JSON.parse(
    readFileSync(join(home, "dsh-pet", "standalone-runtime.json"), "utf8"),
  );
  if (
    typeof runtime.pluginRoot !== "string" ||
    resolve(runtime.pluginRoot).toLowerCase() !== app.toLowerCase() ||
    !Number.isInteger(runtime.port) ||
    runtime.port < 1 ||
    runtime.port > 65535 ||
    typeof runtime.token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(runtime.token)
  )
    throw new Error("运行状态与当前桌宠不匹配，请检查数据目录。");
  const response = await fetch(`http://127.0.0.1:${runtime.port}/shutdown`, {
    method: "POST",
    headers: { "x-dsh-pet-token": runtime.token },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`关闭请求失败（HTTP ${response.status}）。`);
  console.log(`${label}正在退出。`);
} catch (error) {
  if (error.code === "ENOENT") console.log(`${label}当前未运行。`);
  else {
    console.error(error.message);
    process.exitCode = 1;
  }
}
