import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = resolve(root, process.env.BIGE_PET_HOME || join(".local", "dsh"));
try {
  const runtime = JSON.parse(
    readFileSync(join(home, "dsh-pet", "standalone-runtime.json"), "utf8"),
  );
  const response = await fetch(`http://127.0.0.1:${runtime.port}/shutdown`, {
    method: "POST",
    headers: { "x-dsh-pet-token": runtime.token },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`关闭请求失败（HTTP ${response.status}）。`);
  console.log("比格桌宠正在退出。");
} catch (error) {
  if (error.code === "ENOENT") console.log("比格桌宠当前未运行。");
  else {
    console.error(error.message);
    process.exitCode = 1;
  }
}
