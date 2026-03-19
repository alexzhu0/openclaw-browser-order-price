#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { chromium } from "playwright-core";

const PROJECT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const STATE_DIR = path.join(PROJECT_DIR, "state");
const EVIDENCE_DIR = path.join(PROJECT_DIR, "evidence");
const DEFAULT_PORT = 9222;

const BUY_TEXTS = ["立即购买", "去结算", "结算", "立即下单", "Buy Now", "Checkout"];
const STOCK_TEXTS = ["缺货", "无货", "售罄", "补货中", "暂不可售"];
const LOGIN_TEXTS = ["扫码登录", "账号登录", "登录后购买", "请使用京东APP扫码登录"];
const LOGIN_URL_PATTERNS = ["passport.jd.com", "plogin.m.jd.com", "qr.m.jd.com"];
const CHECKOUT_PRICE_LABELS = ["应付金额", "实付款", "结算金额", "应付合计", "订单总额"];
const FALLBACK_PRICE_LABELS = ["到手价", "券后价", "优惠后", "新人到手价"];
const CHECKOUT_SIGNALS = ["确认订单", "提交订单", "应付金额", "实付款", "收货地址", "配送方式", "支付方式"];

function parseArgs(argv) {
  const out = {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    url: "",
    urlsFile: "",
    jsonFile: "",
    jsonUrl: "",
    outputFile: "",
    writeInPlace: false,
    waitAfterOpenMs: 5000,
    waitAfterClickMs: 5000,
    interactiveLogin: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") out.host = argv[++i];
    else if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--url") out.url = argv[++i];
    else if (arg === "--urls-file") out.urlsFile = argv[++i];
    else if (arg === "--json-file") out.jsonFile = argv[++i];
    else if (arg === "--json-url") out.jsonUrl = argv[++i];
    else if (arg === "--output-file") out.outputFile = argv[++i];
    else if (arg === "--write-in-place") out.writeInPlace = true;
    else if (arg === "--wait-after-open-ms") out.waitAfterOpenMs = Number(argv[++i]);
    else if (arg === "--wait-after-click-ms") out.waitAfterClickMs = Number(argv[++i]);
    else if (arg === "--interactive-login") out.interactiveLogin = true;
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function slugForUrl(rawUrl) {
  return rawUrl.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
}

function buildScreenshotPath(rawUrl) {
  ensureDir(EVIDENCE_DIR);
  return path.join(EVIDENCE_DIR, `${slugForUrl(rawUrl)}_${nowStamp()}.png`);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question(promptText, () => resolve()));
  rl.close();
}

async function getVisibleText(page) {
  return page.locator("body").innerText().catch(() => "");
}

async function findFirstClickableByTextInRoot(root, texts) {
  for (const text of texts) {
    const locator = root.getByText(text, { exact: false }).first();
    if (await locator.count().catch(() => 0)) {
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return { text, locator, root };
    }
  }
  return null;
}

async function getRoots(page) {
  return [page, ...page.frames()];
}

async function findFirstClickableByText(page, texts) {
  for (const root of await getRoots(page)) {
    const result = await findFirstClickableByTextInRoot(root, texts);
    if (result) return result;
  }
  return null;
}

function parsePriceFromTextBlock(text, labels) {
  for (const label of labels) {
    const line = text
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item.includes(label) && /[¥￥]\s*\d/.test(item));
    if (line) {
      const match = line.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
      return {
        price_text: line,
        price_value: match ? match[1] : "",
        currency: match ? "CNY" : "",
        checkout_signal: label,
      };
    }
  }
  return null;
}

async function extractPriceInfo(page) {
  for (const root of await getRoots(page)) {
    const text = await getVisibleText(root);
    const parsed = parsePriceFromTextBlock(text, CHECKOUT_PRICE_LABELS);
    if (parsed) return parsed;
  }
  return null;
}

async function extractFallbackPriceInfo(page) {
  for (const root of await getRoots(page)) {
    const text = await getVisibleText(root);
    const parsed = parsePriceFromTextBlock(text, FALLBACK_PRICE_LABELS);
    if (parsed) return parsed;
  }
  return null;
}

async function detectCheckoutState(page) {
  const urls = [page.url(), ...page.frames().map((frame) => frame.url())].join("\n");
  if (urls.includes("trade.jd.com") || urls.includes("marathon.jd.com")) return true;
  const bodyText = (await Promise.all((await getRoots(page)).map((root) => getVisibleText(root)))).join("\n");
  return CHECKOUT_SIGNALS.some((signal) => bodyText.includes(signal));
}

async function maybeHandleLogin(page, interactiveLogin) {
  const roots = await getRoots(page);
  const urls = [page.url(), ...page.frames().map((frame) => frame.url())].join("\n");
  const bodyText = (await Promise.all(roots.map((root) => getVisibleText(root)))).join("\n");
  const hasLoginSignal =
    LOGIN_URL_PATTERNS.some((pattern) => urls.includes(pattern)) ||
    LOGIN_TEXTS.some((text) => bodyText.includes(text));
  if (!hasLoginSignal) return { handled: false };

  if (!interactiveLogin) {
    return {
      handled: true,
      result: {
        status: "exception",
        error: "页面需要登录。请先运行 prepare_login_session.mjs 完成首次扫码登录，再执行批量任务。",
      },
    };
  }

  console.log("检测到登录页面。请在打开的 Chrome 中完成扫码登录，然后回到终端按回车继续。");
  await waitForEnter("");
  await sleep(3000);
  return { handled: false };
}

async function runSingle(page, url, options) {
  const screenshotPath = buildScreenshotPath(url);
  const base = {
    url,
    status: "exception",
    price_text: "",
    price_value: "",
    currency: "",
    purchase_entry: "",
    checkout_signal: "",
    screenshot_path: screenshotPath,
    error: "",
  };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(options.waitAfterOpenMs);

    const loginState = await maybeHandleLogin(page, options.interactiveLogin);
    if (loginState.handled) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { ...base, ...loginState.result, screenshot_path: screenshotPath };
    }

    const purchase = await findFirstClickableByText(page, BUY_TEXTS);
    const bodyText = (await Promise.all((await getRoots(page)).map((root) => getVisibleText(root)))).join("\n");
    if (!purchase && STOCK_TEXTS.some((text) => bodyText.includes(text))) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { ...base, error: "页面显示缺货或售罄，且未发现可下单入口" };
    }

    if (!purchase) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { ...base, error: "未发现可点击的立即购买/去结算入口" };
    }

    base.purchase_entry = purchase.text;
    await purchase.locator.click({ timeout: 15000 });
    await sleep(options.waitAfterClickMs);

    const loginAfterClick = await maybeHandleLogin(page, options.interactiveLogin);
    if (loginAfterClick.handled) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { ...base, ...loginAfterClick.result, screenshot_path: screenshotPath };
    }

    const isCheckout = await detectCheckoutState(page);
    const priceInfo = (isCheckout ? await extractPriceInfo(page) : null) ?? (await extractFallbackPriceInfo(page));
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (!priceInfo) {
      return { ...base, error: isCheckout ? "已进入结算页，但未能确认应付金额" : "已点击购买入口，但未进入可识别的结算页，且未提取到价格" };
    }

    return { ...base, status: "success", error: "", ...priceInfo };
  } catch (error) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    return { ...base, error: String(error && error.message ? error.message : error) };
  }
}

async function loadJsonTasks(options) {
  if (options.jsonFile) {
    return JSON.parse(fs.readFileSync(options.jsonFile, "utf8"));
  }
  if (options.jsonUrl) {
    const response = await fetch(options.jsonUrl);
    if (!response.ok) throw new Error(`failed to fetch json url: ${response.status} ${response.statusText}`);
    return await response.json();
  }
  return null;
}

function loadUrls(options) {
  if (options.url) return [options.url];
  if (!options.urlsFile) throw new Error("missing --url or --urls-file");
  const raw = fs.readFileSync(options.urlsFile, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeTasksPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.items)) return raw.items;
  if (raw && Array.isArray(raw.data)) return raw.data;
  throw new Error("json task payload must be an array, or an object with items/data array");
}

function applyResultToTask(task, result) {
  return {
    ...task,
    error: result.status === "success" ? false : true,
    price: result.status === "success" ? `¥${result.price_value}` : "",
    error_reason: result.status === "success" ? "" : result.error,
    checkout_signal: result.checkout_signal || "",
    purchase_entry: result.purchase_entry || "",
    screenshot_path: result.screenshot_path || "",
  };
}

function resolveOutputPath(options) {
  if (options.outputFile) return options.outputFile;
  if (options.jsonFile && options.writeInPlace) return options.jsonFile;
  return path.join(PROJECT_DIR, `results_${nowStamp()}.json`);
}

async function main() {
  const options = parseArgs(process.argv);
  ensureDir(STATE_DIR);
  ensureDir(EVIDENCE_DIR);

  const browser = await chromium.connectOverCDP(`http://${options.host}:${options.port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  const jsonTasks = await loadJsonTasks(options);
  if (jsonTasks) {
    const tasks = normalizeTasksPayload(jsonTasks);
    const updatedTasks = [];
    for (const task of tasks) {
      const url = String(task.URL ?? task.url ?? "").trim();
      if (!url) {
        updatedTasks.push({ ...task, error: true, price: "" });
        continue;
      }
      const result = await runSingle(page, url, options);
      updatedTasks.push(applyResultToTask(task, result));
    }
    const outputPath = resolveOutputPath(options);
    fs.writeFileSync(outputPath, JSON.stringify(updatedTasks, null, 2));
    console.log(JSON.stringify({ status: "ok", output_file: outputPath, total: updatedTasks.length }, null, 2));
    await browser.close();
    return;
  }

  const urls = loadUrls(options);
  const results = [];
  for (const url of urls) {
    results.push(await runSingle(page, url, options));
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
