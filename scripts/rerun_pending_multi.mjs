#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG_PATH = path.join(PROJECT_DIR, "config", "multi_runner.json");

function parseArgs(argv) {
  const out = {
    configPath: DEFAULT_CONFIG_PATH,
    printPlan: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") out.configPath = argv[++i];
    else if (arg === "--print-plan") out.printPlan = true;
  }
  return out;
}

function cleanConfig(value) {
  if (Array.isArray(value)) return value.map(cleanConfig);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("_")) continue;
    out[key] = cleanConfig(child);
  }
  return out;
}

function getTodayYYMMDD(now = new Date()) {
  const yy = String(now.getFullYear()).slice(-2);
  const p = (n) => String(n).padStart(2, "0");
  return `${yy}${p(now.getMonth() + 1)}${p(now.getDate())}`;
}

function stampDatePartInString(value, yyMMdd) {
  if (typeof value !== "string") return value;
  // 支持两种写法：
  // 1) 已含日期：output20260325-2.json -> output260325-2.json
  // 2) 不含日期：output-2.json -> output260325-2.json
  const prefixes = ["multi_account_output", "final_output", "pending_rerun_tasks", "generated-config", "output", "run-state", "runner"].join("|");
  const dateInsertRe = new RegExp(`(${prefixes})(?:\\d{6}|\\d{8})?-(\\d+)`, "g");
  return value.replace(dateInsertRe, (_m, prefix, seq) => `${prefix}${yyMMdd}-${seq}`);
}

function deepStampDatePart(value, yyMMdd) {
  if (Array.isArray(value)) return value.map((item) => deepStampDatePart(item, yyMMdd));
  if (!value || typeof value !== "object") return stampDatePartInString(value, yyMMdd);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = deepStampDatePart(v, yyMMdd);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = JSON.parse(fs.readFileSync(args.configPath, "utf8"));
  const config = deepStampDatePart(cleanConfig(raw), getTodayYYMMDD());
  const pendingFile = path.resolve(PROJECT_DIR, config.pendingRerunFile || path.join("data", "pending_rerun_tasks.json"));

  if (!fs.existsSync(pendingFile)) {
    console.log(
      JSON.stringify(
        {
          status: "no_pending_file",
          pending_rerun_file: pendingFile,
          message: "没有待补跑的 pending 文件，已跳过。",
        },
        null,
        2,
      ),
    );
    return;
  }

  const childArgs = ["scripts/multi_account_runner.mjs", "--config", args.configPath, "--json-file", pendingFile];
  if (args.printPlan) childArgs.push("--print-plan");

  await new Promise((resolve, reject) => {
    const child = spawn("node", childArgs, {
      cwd: PROJECT_DIR,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`rerun pending exited with code ${code}`));
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
