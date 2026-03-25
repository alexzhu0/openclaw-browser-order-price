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
    jsonFile: "",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") out.configPath = argv[++i];
    else if (arg === "--print-plan") out.printPlan = true;
    else if (arg === "--json-file") out.jsonFile = argv[++i];
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (!base || typeof base !== "object") return override;
  if (!override || typeof override !== "object") return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function flattenRunnerConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const normalized = cleanConfig(raw);
  return {
    ...normalized,
    ...(normalized.cdp ?? {}),
    ...(normalized.input ?? {}),
    ...(normalized.output ?? {}),
    ...(normalized.behavior ?? {}),
    ...(normalized.retry ?? {}),
    ...(normalized.interaction ?? {}),
  };
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  const prefixes = [
    "multi_account_output",
    "final_output",
    "pending_rerun_tasks",
    "generated-config",
    "output",
    "run-state",
    "runner",
  ].join("|");
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

function normalizeTasksPayload(raw) {
  if (Array.isArray(raw)) return { tasks: raw, envelopeType: "array" };
  if (raw && Array.isArray(raw.items)) return { tasks: raw.items, envelopeType: "items" };
  if (raw && Array.isArray(raw.data)) return { tasks: raw.data, envelopeType: "data" };
  throw new Error("json task payload must be an array, or an object with items/data array");
}

function wrapTasksPayload(raw, tasks, envelopeType) {
  if (envelopeType === "array") return tasks;
  if (envelopeType === "items") return { ...raw, items: tasks };
  if (envelopeType === "data") return { ...raw, data: tasks };
  return tasks;
}

function stripHelperFields(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return task;
  const out = {};
  for (const [key, value] of Object.entries(task)) {
    if (key.startsWith("_rerun_")) continue;
    out[key] = value;
  }
  return out;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function collectColumns(tasks) {
  const ordered = [];
  const seen = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== "object" || Array.isArray(task)) continue;
    for (const key of Object.keys(task)) {
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(key);
    }
  }
  return ordered;
}

function writeExcelTable(filePath, tasks) {
  const columns = collectColumns(tasks);
  const head = columns.map((key) => `<th>${escapeHtml(key)}</th>`).join("");
  const rows = tasks
    .map((task) => {
      const cells = columns
        .map((key) => {
          const value = task?.[key];
          if (value === null || value === undefined) return "<td></td>";
          if (typeof value === "object") return `<td>${escapeHtml(JSON.stringify(value))}</td>`;
          return `<td>${escapeHtml(value)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");

  const html = [
    "<html>",
    "<head>",
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />',
    "</head>",
    "<body>",
    "<table border=\"1\">",
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>${rows}</tbody>`,
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `\uFEFF${html}`);
}

function buildSlices(total, workerCount, startOffset = 0, selectedLimit = 0) {
  const available = Math.max(0, total - Math.max(0, startOffset));
  const selected = selectedLimit > 0 ? Math.min(available, selectedLimit) : available;
  const baseSize = workerCount > 0 ? Math.floor(selected / workerCount) : 0;
  const remainder = workerCount > 0 ? selected % workerCount : 0;
  const slices = [];
  let cursor = Math.max(0, startOffset);
  for (let i = 0; i < workerCount; i += 1) {
    const size = baseSize + (i < remainder ? 1 : 0);
    slices.push({ offset: cursor, limit: size });
    cursor += size;
  }
  return slices;
}

function defaultWorkerPaths(name) {
  const workerDir = path.join(PROJECT_DIR, name);
  return {
    outputFile: path.join(workerDir, "data", "output.json"),
    stateFile: path.join(workerDir, "state", "run-state.json"),
    logFile: path.join(workerDir, "logs", "runner.log"),
  };
}

function buildWorkerConfig(baseConfig, worker, slice) {
  const name = worker.name;
  const defaults = defaultWorkerPaths(name);
  const merged = deepMerge(baseConfig, worker);
  merged.input = {
    ...(merged.input ?? {}),
    offset: slice.offset,
    limit: slice.limit,
    outputFile: worker.input?.outputFile ?? merged.input?.outputFile ?? defaults.outputFile,
  };
  merged.output = {
    ...(merged.output ?? {}),
    stateFile: worker.output?.stateFile ?? merged.output?.stateFile ?? defaults.stateFile,
  };
  merged.interaction = {
    ...(merged.interaction ?? {}),
    interactiveLogin: worker.interaction?.interactiveLogin ?? false,
    interactiveRisk: worker.interaction?.interactiveRisk ?? false,
    logFile: worker.interaction?.logFile ?? merged.interaction?.logFile ?? defaults.logFile,
  };
  return merged;
}

function pipeChildOutput(stream, workerName) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      console.log(`[${workerName}] ${line}`);
    }
  });
  stream.on("end", () => {
    if (buffer.trim()) console.log(`[${workerName}] ${buffer}`);
  });
}

async function runWorker(workerName, configPath) {
  await new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/order_price_runner.mjs", "--config", configPath], {
      cwd: PROJECT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    pipeChildOutput(child.stdout, workerName);
    pipeChildOutput(child.stderr, workerName);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${workerName} exited with code ${code}`));
    });
  });
}

function mergeWorkerOutputs(rawPayload, envelopeType, workerPlans) {
  const { tasks } = normalizeTasksPayload(rawPayload);
  const merged = [...tasks];
  for (const worker of workerPlans) {
    if (!fs.existsSync(worker.outputFile)) continue;
    const workerPayload = loadJson(worker.outputFile);
    const { tasks: workerTasks } = normalizeTasksPayload(workerPayload);
    const end = worker.offset + worker.limit;
    for (let index = worker.offset; index < end; index += 1) {
      merged[index] = workerTasks[index];
    }
  }
  return wrapTasksPayload(rawPayload, merged, envelopeType);
}

function pickPendingTasks(tasks, statuses) {
  const wanted = new Set((statuses || []).map((item) => String(item).trim()).filter(Boolean));
  return tasks
    .map((task, index) => ({ ...task, _rerun_source_index: index }))
    .filter((task) => {
      const status = String(task?.run_status || "").trim();
      return !status || wanted.has(status);
    });
}

function mergeIntoFinalPayload(basePayload, rerunTasks) {
  const { tasks, envelopeType } = normalizeTasksPayload(basePayload);
  const merged = [...tasks];
  for (const task of rerunTasks) {
    const originalIndex = Number(task?._rerun_source_index);
    const cleanTask = stripHelperFields(task);
    if (Number.isInteger(originalIndex) && originalIndex >= 0 && originalIndex < merged.length) {
      merged[originalIndex] = cleanTask;
      continue;
    }
    const url = String(cleanTask?.URL ?? cleanTask?.url ?? "").trim();
    if (!url) continue;
    const foundIndex = merged.findIndex((item) => String(item?.URL ?? item?.url ?? "").trim() === url);
    if (foundIndex >= 0) merged[foundIndex] = cleanTask;
  }
  return wrapTasksPayload(basePayload, merged, envelopeType);
}

async function main() {
  const args = parseArgs(process.argv);
  const multiConfigRaw = loadJson(args.configPath);
  const multiConfig = deepStampDatePart(cleanConfig(multiConfigRaw), getTodayYYMMDD());
  const baseConfigPath = path.resolve(PROJECT_DIR, multiConfig.baseConfigPath || "config/runner.json");
  const baseConfigRaw = loadJson(baseConfigPath);
  const baseConfig = cleanConfig(baseConfigRaw);
  const baseOptions = flattenRunnerConfig(baseConfig);
  const enabledWorkers = (multiConfig.workers ?? []).filter((worker) => worker.enabled !== false);
  if (!enabledWorkers.length) throw new Error("no enabled workers configured");
  const inputFile = args.jsonFile || baseOptions.jsonFile;
  if (!inputFile) throw new Error("base runner config must define input.jsonFile");

  const rawPayload = loadJson(inputFile);
  const { tasks, envelopeType } = normalizeTasksPayload(rawPayload);
  const multiOffset = Number(multiConfig.inputOffset || 0);
  const multiLimit = Number(multiConfig.inputLimit || 0);
  const slices = buildSlices(tasks.length, enabledWorkers.length, multiOffset, multiLimit);
  const workerPlans = enabledWorkers.map((worker, index) => {
    const slice = slices[index];
    const workerConfig = buildWorkerConfig(baseConfig, worker, slice);
    const configPath = path.resolve(PROJECT_DIR, worker.generatedConfigPath || path.join(worker.name, "state", "generated-config.json"));
    return {
      name: worker.name,
      configPath,
      offset: slice.offset,
      limit: slice.limit,
      outputFile: workerConfig.input.outputFile,
      stateFile: workerConfig.output.stateFile,
      logFile: workerConfig.interaction.logFile,
      config: workerConfig,
    };
  });

  const plan = {
    baseConfigPath,
    inputFile,
    totalTasks: tasks.length,
    workers: workerPlans.map((worker) => ({
      name: worker.name,
      offset: worker.offset,
      limit: worker.limit,
      outputFile: worker.outputFile,
      stateFile: worker.stateFile,
      logFile: worker.logFile,
      configPath: worker.configPath,
    })),
  };

  if (args.printPlan) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  for (const worker of workerPlans) {
    ensureDir(path.dirname(worker.outputFile));
    ensureDir(path.dirname(worker.stateFile));
    ensureDir(path.dirname(worker.logFile));
    ensureDir(path.dirname(worker.configPath));
    fs.writeFileSync(worker.configPath, JSON.stringify(worker.config, null, 2));
  }

  await Promise.all(workerPlans.filter((worker) => worker.limit > 0).map((worker) => runWorker(worker.name, worker.configPath)));

  const mergedOutputFile = path.resolve(PROJECT_DIR, multiConfig.mergedOutputFile || path.join("data", "multi_account_output.json"));
  const mergedPayload = mergeWorkerOutputs(rawPayload, envelopeType, workerPlans);
  const { tasks: mergedTasks } = normalizeTasksPayload(mergedPayload);
  const mergedExcelFile = path.resolve(PROJECT_DIR, multiConfig.mergedExcelFile || path.join("data", "multi_account_output.xls"));
  const finalMergedOutputFile = path.resolve(PROJECT_DIR, multiConfig.finalMergedOutputFile || mergedOutputFile);
  const finalMergedExcelFile = path.resolve(PROJECT_DIR, multiConfig.finalMergedExcelFile || mergedExcelFile);
  const pendingStatuses = multiConfig.pendingRerunStatuses || ["relogin_required", "checkout_blocked"];
  const pendingTasks = pickPendingTasks(mergedTasks, pendingStatuses);
  const pendingRerunFile = path.resolve(PROJECT_DIR, multiConfig.pendingRerunFile || path.join("data", "pending_rerun_tasks.json"));
  const pendingRerunExcelFile = path.resolve(PROJECT_DIR, multiConfig.pendingRerunExcelFile || path.join("data", "pending_rerun_tasks.xls"));
  ensureDir(path.dirname(mergedOutputFile));
  fs.writeFileSync(mergedOutputFile, JSON.stringify(mergedPayload, null, 2));
  writeExcelTable(mergedExcelFile, mergedTasks);
  const finalPayload = args.jsonFile
    ? mergeIntoFinalPayload(
        fs.existsSync(finalMergedOutputFile) ? loadJson(finalMergedOutputFile) : wrapTasksPayload(rawPayload, normalizeTasksPayload(rawPayload).tasks, envelopeType),
        mergedTasks,
      )
    : mergedPayload;
  const { tasks: finalTasks } = normalizeTasksPayload(finalPayload);
  ensureDir(path.dirname(finalMergedOutputFile));
  fs.writeFileSync(finalMergedOutputFile, JSON.stringify(finalPayload, null, 2));
  writeExcelTable(finalMergedExcelFile, finalTasks);
  fs.writeFileSync(pendingRerunFile, JSON.stringify(pendingTasks, null, 2));
  writeExcelTable(pendingRerunExcelFile, pendingTasks);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        merged_output_file: mergedOutputFile,
        merged_excel_file: mergedExcelFile,
        final_merged_output_file: finalMergedOutputFile,
        final_merged_excel_file: finalMergedExcelFile,
        pending_rerun_file: pendingRerunFile,
        pending_rerun_excel_file: pendingRerunExcelFile,
        pending_rerun_count: pendingTasks.length,
        worker_count: workerPlans.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
