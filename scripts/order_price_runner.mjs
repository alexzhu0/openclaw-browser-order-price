#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { chromium } from "playwright-core";

const PROJECT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const STATE_DIR = path.join(PROJECT_DIR, "state");
const EVIDENCE_DIR = path.join(PROJECT_DIR, "evidence");
const DEFAULT_PORT = 9222;
const DEFAULT_STATE_FILE = path.join(STATE_DIR, "run-state.json");
const DEFAULT_DEBUG_DIR = path.join(STATE_DIR, "debug");
const DEFAULT_BOOTSTRAP_URL = "https://www.jd.com/";
const DEFAULT_CONFIG_PATH = path.join(PROJECT_DIR, "config", "runner.json");
const WINDOWS_PROXY_SCRIPT = "D:\\DTAlex\\Skills\\price_crawl\\windows_cdp_proxy.mjs";
const WINDOWS_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WINDOWS_PROFILE_DIR = "D:\\DTAlex\\Skills\\price_crawl\\state\\chrome-profile";

const BUY_TEXTS = ["立即购买", "去结算", "结算", "立即下单", "Buy Now", "Checkout"];
const STOCK_TEXTS = ["缺货", "无货", "售罄", "补货中", "暂不可售"];
const LOGIN_TEXTS = ["扫码登录", "账号登录", "登录后购买", "请使用京东APP扫码登录"];
const LOGIN_URL_PATTERNS = ["passport.jd.com", "plogin.m.jd.com", "qr.m.jd.com"];
const RISK_TEXTS = ["安全验证", "异常访问", "请完成验证", "滑动验证", "验证码", "二次验证", "请验证手机号", "身份验证"];
const RISK_URL_PATTERNS = ["captcha.jd.com", "safe.jd.com", "aq.jd.com"];
const CHECKOUT_URL_PATTERNS = ["trade.jd.com", "marathon.jd.com", "pc-settlement-lite-pro.pf.jd.com", "settlement-lite", "pf.jd.com"];
const CHECKOUT_FRAME_PATTERNS = ["trade.jd.com", "marathon.jd.com", "trade", "checkout", "settlement", "order"];
const CHECKOUT_PRICE_LABELS = ["应付金额", "实付款", "结算金额", "应付合计", "订单总额", "应付总额", "商品金额", "商品总额", "总金额"];
const FALLBACK_PRICE_LABELS = ["到手价", "券后价", "优惠后", "新人到手价"];
const CHECKOUT_SIGNALS = ["确认订单", "提交订单", "应付金额", "实付款", "收货地址", "配送方式", "支付方式"];
const CHECKOUT_PRICE_SELECTORS = [
  ".sumPayPrice",
  ".sumPayPrice em",
  ".totalPayPrice",
  ".totalPayPrice em",
  ".price-total",
  ".price-total em",
  ".realPay",
  ".realPay .price",
  ".order-price",
  ".order-price .price",
  "[class*='sumPrice']",
  "[class*='sumPrice'] em",
  "[class*='payPrice']",
  "[class*='payPrice'] em",
  "[class*='totalPrice']",
  "[class*='totalPrice'] em",
  "[class*='amount']",
].join(",");
const CLICKABLE_SELECTORS = [
  "button",
  "a",
  "[role='button']",
  "input[type='button']",
  "input[type='submit']",
  ".btn-buy",
  ".btn-append",
  ".btn-special1",
  ".buy-btn",
  "#InitCartUrl",
  "#btn-onkeybuy",
].join(",");
const JD_BUY_SELECTORS = [
  "#bottom-btns .bottom-btns-root > div:nth-child(2)",
  "#bottom-btns .bottom-btns-root > div:last-child",
  "#choose-btns #bottom-btns .bottom-btns-root > div:nth-child(2)",
  "#choose-btns .bottom-btns-root > div:nth-child(2)",
  "#InitCartUrl",
  ".btn-special1",
  ".btn-buy",
  ".buy-btn",
].join(",");

function defaultOptions() {
  return {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    url: "",
    urlsFile: "",
    jsonFile: "",
    jsonUrl: "",
    outputFile: "",
    writeInPlace: false,
    limit: 0,
    offset: 0,
    shuffle: false,
    batchSize: 0,
    pauseEvery: 0,
    pauseMinMs: 20000,
    pauseMaxMs: 60000,
    minOpenMs: 4000,
    maxOpenMs: 9000,
    minClickMs: 1500,
    maxClickMs: 4000,
    stateFile: DEFAULT_STATE_FILE,
    debugDump: false,
    debugDumpDir: DEFAULT_DEBUG_DIR,
    waitAfterOpenMs: 5000,
    waitAfterClickMs: 5000,
    interactiveLogin: false,
    interactiveRisk: false,
    verbose: false,
    printConfig: false,
  };
}

function parseArgs(argv) {
  const out = {
    configPath: DEFAULT_CONFIG_PATH,
    configExplicit: false,
    overrides: {},
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      out.configPath = argv[++i];
      out.configExplicit = true;
    } else if (arg === "--host") out.overrides.host = argv[++i];
    else if (arg === "--port") out.overrides.port = Number(argv[++i]);
    else if (arg === "--url") out.overrides.url = argv[++i];
    else if (arg === "--urls-file") out.overrides.urlsFile = argv[++i];
    else if (arg === "--json-file") out.overrides.jsonFile = argv[++i];
    else if (arg === "--json-url") out.overrides.jsonUrl = argv[++i];
    else if (arg === "--output-file") out.overrides.outputFile = argv[++i];
    else if (arg === "--write-in-place") out.overrides.writeInPlace = true;
    else if (arg === "--limit") out.overrides.limit = Number(argv[++i]);
    else if (arg === "--offset") out.overrides.offset = Number(argv[++i]);
    else if (arg === "--shuffle") out.overrides.shuffle = true;
    else if (arg === "--batch-size") out.overrides.batchSize = Number(argv[++i]);
    else if (arg === "--pause-every") out.overrides.pauseEvery = Number(argv[++i]);
    else if (arg === "--pause-min-ms") out.overrides.pauseMinMs = Number(argv[++i]);
    else if (arg === "--pause-max-ms") out.overrides.pauseMaxMs = Number(argv[++i]);
    else if (arg === "--min-open-ms") out.overrides.minOpenMs = Number(argv[++i]);
    else if (arg === "--max-open-ms") out.overrides.maxOpenMs = Number(argv[++i]);
    else if (arg === "--min-click-ms") out.overrides.minClickMs = Number(argv[++i]);
    else if (arg === "--max-click-ms") out.overrides.maxClickMs = Number(argv[++i]);
    else if (arg === "--state-file") out.overrides.stateFile = argv[++i];
    else if (arg === "--debug-dump") out.overrides.debugDump = true;
    else if (arg === "--debug-dump-dir") out.overrides.debugDumpDir = argv[++i];
    else if (arg === "--wait-after-open-ms") out.overrides.waitAfterOpenMs = Number(argv[++i]);
    else if (arg === "--wait-after-click-ms") out.overrides.waitAfterClickMs = Number(argv[++i]);
    else if (arg === "--interactive-login") out.overrides.interactiveLogin = true;
    else if (arg === "--interactive-risk") out.overrides.interactiveRisk = true;
    else if (arg === "--verbose") out.overrides.verbose = true;
    else if (arg === "--print-config") out.overrides.printConfig = true;
  }
  return out;
}

function flattenConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const clean = (value) => {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("_")) continue;
      out[key] = clean(child);
    }
    return out;
  };
  const normalized = clean(raw);
  return {
    ...normalized,
    ...(normalized.cdp ?? {}),
    ...(normalized.input ?? {}),
    ...(normalized.output ?? {}),
    ...(normalized.behavior ?? {}),
    ...(normalized.interaction ?? {}),
  };
}

function loadConfigFile(configPath, explicit) {
  if (!configPath) return {};
  if (!fs.existsSync(configPath)) {
    if (explicit) throw new Error(`config file not found: ${configPath}`);
    return {};
  }
  const rawText = fs.readFileSync(configPath, "utf8");
  const raw = JSON.parse(rawText);
  return flattenConfig(raw);
}

function resolveOptions(argv) {
  const parsed = parseArgs(argv);
  const defaults = defaultOptions();
  const config = loadConfigFile(parsed.configPath, parsed.configExplicit);
  const options = {
    ...defaults,
    ...config,
    ...parsed.overrides,
    configPath: parsed.configPath,
  };
  return options;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isWsl() {
  return os.release().toLowerCase().includes("microsoft");
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

function buildDebugDumpPath(rawUrl, dir) {
  ensureDir(dir);
  return path.join(dir, `${slugForUrl(rawUrl)}_${nowStamp()}.json`);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function trace(options, ...parts) {
  if (!options?.verbose) return;
  console.error("[runner]", ...parts);
}

async function runPowershell(command) {
  await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`powershell exited with code ${code}`));
    });
  });
}

async function getCdpStatus(host, port) {
  try {
    const response = await fetch(`http://${host}:${port}/json/version`);
    const body = await response.text().catch(() => "");
    const hasDebuggerUrl = body.includes("webSocketDebuggerUrl");
    const hasProxyError = body.includes("\"error\"") || body.includes("ECONNREFUSED");
    return {
      ok: response.ok && hasDebuggerUrl && !hasProxyError,
      status: response.status,
      body,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      body: "",
    };
  }
}

function launchWindowsChrome(url) {
  const child = spawn(
    "cmd.exe",
    [
      "/c",
      "start",
      "",
      WINDOWS_CHROME,
      "--remote-debugging-port=9222",
      `--user-data-dir=${WINDOWS_PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
      url,
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
}

function launchWindowsProxy(port) {
  const command = `Start-Process node -ArgumentList '${WINDOWS_PROXY_SCRIPT}','0.0.0.0','${port}','127.0.0.1','9222' -WindowStyle Hidden`;
  const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function ensureBrowserInfra(options) {
  const current = await getCdpStatus(options.host, options.port);
  if (current.ok) return;

  if (isWsl()) {
    launchWindowsChrome(options.url || DEFAULT_BOOTSTRAP_URL);
    launchWindowsProxy(options.port);
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const status = await getCdpStatus(options.host, options.port);
    if (status.ok) return;
    await sleep(1000);
  }
  throw new Error(`CDP endpoint not ready at http://${options.host}:${options.port}. Browser or proxy failed to start.`);
}

function randomBetween(min, max) {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRunDelay(minMs, maxMs, fallbackMs) {
  if (Number.isFinite(minMs) && Number.isFinite(maxMs) && minMs > 0 && maxMs > 0) {
    return randomBetween(minMs, maxMs);
  }
  return fallbackMs;
}

async function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question(promptText, () => resolve()));
  rl.close();
}

function loadRunState(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {
      status: "idle",
      started_at: "",
      updated_at: "",
      processed: 0,
      success: 0,
      failed: 0,
      last_index: -1,
      last_url: "",
      blocked_reason: "",
      results: [],
    };
  }
}

function saveRunState(stateFile, state) {
  ensureDir(path.dirname(stateFile));
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        ...state,
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function markBlockedResult(base, reason) {
  return { ...base, status: "relogin_required", error: reason };
}

async function getVisibleText(page) {
  return page.locator("body").innerText().catch(() => "");
}

async function getVisibleTextSnippet(root, maxChars = 4000, timeoutMs = 1200) {
  return await Promise.race([
    root
      .locator("body")
      .evaluate((el, limit) => ((el.innerText || el.textContent || "").trim().slice(0, limit)), maxChars)
      .catch(() => ""),
    sleep(timeoutMs).then(() => ""),
  ]);
}

function scoreClickableCandidate(text, className, rect) {
  let score = 0;
  if (text.includes("立即购买")) score += 100;
  if (text.includes("去结算")) score += 90;
  if (text.includes("结算")) score += 80;
  if (text.includes("立即下单")) score += 70;
  if (/btn-buy|btn-append|buy-btn|checkout|settle/i.test(className || "")) score += 40;
  if (rect) {
    if (rect.x > 700) score += 10;
    if (rect.y < 1400) score += 10;
  }
  return score;
}

async function buildClickableCandidate(locator, text) {
  const visible = await locator.isVisible().catch(() => false);
  if (!visible) return null;
  const enabled = await locator.isEnabled().catch(() => true);
  if (!enabled) return null;
  const meta = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      className: typeof el.className === "string" ? el.className : "",
      text: (el.innerText || el.textContent || "").trim(),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  });
  return {
    locator,
    text,
    score: scoreClickableCandidate(meta.text || text, meta.className, meta.rect),
    meta,
  };
}

async function findFirstClickableByTextInRoot(root, texts) {
  const candidates = [];
  for (const text of texts) {
    const exactLocator = root.locator(CLICKABLE_SELECTORS).filter({ hasText: text });
    const exactCount = Math.min(await exactLocator.count().catch(() => 0), 5);
    for (let i = 0; i < exactCount; i += 1) {
      const candidate = await buildClickableCandidate(exactLocator.nth(i), text);
      if (candidate) candidates.push({ ...candidate, root });
    }

    const looseLocator = root.getByText(text, { exact: false });
    const looseCount = Math.min(await looseLocator.count().catch(() => 0), 3);
    for (let i = 0; i < looseCount; i += 1) {
      const node = looseLocator.nth(i);
      const candidate = await buildClickableCandidate(node, text);
      if (candidate) candidates.push({ ...candidate, root });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? null;
}

async function getRoots(page) {
  const frames = [...page.frames()].sort((a, b) => {
    const score = (frame) => {
      const url = frame.url();
      let value = 0;
      if (CHECKOUT_FRAME_PATTERNS.some((pattern) => url.includes(pattern))) value += 100;
      if (LOGIN_URL_PATTERNS.some((pattern) => url.includes(pattern))) value -= 50;
      return value;
    };
    return score(b) - score(a);
  });
  return [page, ...frames];
}

async function findFirstClickableByText(page, texts) {
  for (const root of await getRoots(page)) {
    const result = await findFirstClickableByTextInRoot(root, texts);
    if (result) return result;
  }
  return null;
}

async function findLegacyPurchaseEntry(page) {
  for (const root of await getRoots(page)) {
    const locator = root.getByText("立即购买", { exact: false }).first();
    if (!(await locator.count().catch(() => 0))) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    return { text: "立即购买", locator, root, legacy: true };
  }
  return null;
}

async function findViewportPurchaseEntry(page) {
  const candidates = await page
    .evaluate((buyTexts) => {
      document.querySelectorAll("[data-codex-buy-candidate]").forEach((node) => node.removeAttribute("data-codex-buy-candidate"));
      const matches = [];
      const nodes = Array.from(document.querySelectorAll("body *"));
      for (const el of nodes) {
        const text = (el.innerText || el.textContent || "").trim();
        if (!text) continue;
        if (!buyTexts.some((item) => text.includes(item))) continue;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 30 || rect.height < 16) continue;
        const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
        if (!inViewport) continue;
        let score = 0;
        if (text.includes("立即购买")) score += 200;
        if (text.includes("去结算")) score += 160;
        if (text.includes("结算")) score += 120;
        if (style.position === "fixed") score += 160;
        if (style.position === "sticky") score += 120;
        if (rect.left > window.innerWidth * 0.55) score += 90;
        if (rect.top > window.innerHeight * 0.45) score += 60;
        if (rect.width >= 100) score += 20;
        if (rect.height >= 32) score += 20;
        const zIndex = Number.parseInt(style.zIndex || "0", 10);
        if (Number.isFinite(zIndex) && zIndex > 1) score += Math.min(zIndex, 50);
        matches.push({
          text: text.slice(0, 80),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          position: style.position,
          zIndex: style.zIndex || "",
          score,
          node: el,
        });
      }
      matches.sort((a, b) => b.score - a.score);
      matches.slice(0, 8).forEach((item, index) => item.node.setAttribute("data-codex-buy-candidate", String(index)));
      return matches.slice(0, 8).map(({ node, ...rest }) => rest);
    }, BUY_TEXTS)
    .catch(() => []);

  if (!candidates.length) return null;
  const best = candidates[0];
  const locator = page.locator('[data-codex-buy-candidate="0"]').first();
  if (!(await locator.count().catch(() => 0))) return null;
  return {
    text: best.text,
    locator,
    root: page,
    score: best.score,
    meta: {
      text: best.text,
      rect: best.rect,
      className: "",
      position: best.position,
      zIndex: best.zIndex,
    },
  };
}

async function findStrongPurchaseEntry(page) {
  const viewportCandidate = await findViewportPurchaseEntry(page);
  if (viewportCandidate) return viewportCandidate;

  const selectors = [
    "#choose-btns #bottom-btns .bottom-btns-root > div:last-child > .first-row > div",
    "#choose-btns #bottom-btns .bottom-btns-root > div:last-child > .first-row",
    "#choose-btns #bottom-btns .bottom-btns-root > div:last-child",
    "#bottom-btns .bottom-btns-root > div:last-child > .first-row > div",
    "#bottom-btns .bottom-btns-root > div:last-child > .first-row",
    "#bottom-btns .bottom-btns-root > div:last-child",
    "#choose-btns .btn-special1",
    "#choose-btns .btn-buy",
    "#choose-btns .buy-btn",
    JD_BUY_SELECTORS,
  ];

  const candidates = [];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 6);
    for (let i = 0; i < count; i += 1) {
      const node = locator.nth(i);
      const candidate = await buildClickableCandidate(node, "立即购买");
      if (!candidate) continue;
      const text = candidate.meta?.text || candidate.text || "";
      if (!BUY_TEXTS.some((item) => text.includes(item))) continue;
      const rect = candidate.meta?.rect;
      let score = 1000 + candidate.score;
      if (selector.includes("last-child")) score += 120;
      if (selector.includes(".first-row > div")) score += 120;
      if (selector.includes("#choose-btns")) score += 80;
      if (rect) {
        if (rect.x > 800) score += 120;
        if (rect.y > 300) score += 40;
        if (rect.width > 80) score += 20;
      }
      candidates.push({
        text,
        locator: node,
        root: page,
        score,
        meta: candidate.meta,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? null;
}

function isCheckoutUrl(url) {
  return CHECKOUT_URL_PATTERNS.some((pattern) => url.includes(pattern));
}

async function gotoWithRetry(page, url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (!message.includes("net::ERR_ABORTED") || attempt === 1) throw error;
      await sleep(1500);
    }
  }
}

async function waitForPurchaseAreaReady(page, timeoutMs = 15000) {
  const start = Date.now();
  let lastBox = null;
  let stableHits = 0;
  while (Date.now() - start < timeoutMs) {
    const locator = page.locator("#bottom-btns .bottom-btns-root > div:last-child").first();
    const choose = page.locator("#choose-btns").first();
    const chooseVisible = await choose.isVisible().catch(() => false);
    const buyVisible = await locator.isVisible().catch(() => false);
    if (chooseVisible && buyVisible) {
      const box = await locator.boundingBox().catch(() => null);
      if (box && box.width > 40 && box.height > 20) {
        const current = {
          x: Math.round(box.x),
          y: Math.round(box.y),
          w: Math.round(box.width),
          h: Math.round(box.height),
        };
        if (lastBox && JSON.stringify(lastBox) === JSON.stringify(current)) {
          stableHits += 1;
        } else {
          stableHits = 0;
          lastBox = current;
        }
        if (stableHits >= 2) return true;
      }
    }
    await sleep(500);
  }
  return false;
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

function parsePriceFromNearbyLines(text, labels, windowSize = 4) {
  const lines = text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    const label = labels.find((item) => lines[i].includes(item));
    if (!label) continue;

    for (let j = i; j < Math.min(lines.length, i + windowSize + 1); j += 1) {
      const match = lines[j].match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
      if (!match) continue;
      return {
        price_text: `${lines[i]} ${lines[j]}`.trim(),
        price_value: match[1],
        currency: "CNY",
        checkout_signal: label,
      };
    }
  }
  return null;
}

async function parsePriceAroundLocator(locator, label) {
  const text = await locator.evaluate((el, expectedLabel) => {
    let node = el;
    for (let i = 0; node && i < 6; i += 1, node = node.parentElement) {
      const value = (node.innerText || node.textContent || "").trim();
      if (value.includes(expectedLabel) && /[¥￥]\s*\d/.test(value)) return value;
    }
    return (el.innerText || el.textContent || "").trim();
  }, label).catch(() => "");
  if (!text) return null;
  return parsePriceFromTextBlock(text, [label]);
}

async function extractPriceBySelectors(root, selectors, signal) {
  const locator = root.locator(selectors);
  const count = Math.min(await locator.count().catch(() => 0), 8);
  for (let i = 0; i < count; i += 1) {
    const node = locator.nth(i);
    const visible = await node.isVisible().catch(() => false);
    if (!visible) continue;
    const text = await node.innerText().catch(() => "");
    const match = text.match(/[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!match) continue;
    return {
      price_text: text.trim(),
      price_value: match[1],
      currency: "CNY",
      checkout_signal: signal,
    };
  }
  return null;
}

async function collectRootDebugInfo(root, index) {
  const url = typeof root.url === "function" ? root.url() : "";
  const title = typeof root.title === "function" ? await root.title().catch(() => "") : "";
  const textSnippet = await getVisibleTextSnippet(root, 4000, 1200);
  const selectorHits = [];
  const selectorLocator = root.locator(CHECKOUT_PRICE_SELECTORS);
  const selectorCount = Math.min(await selectorLocator.count().catch(() => 0), 8);
  for (let i = 0; i < selectorCount; i += 1) {
    const node = selectorLocator.nth(i);
    const visible = await node.isVisible().catch(() => false);
    if (!visible) continue;
    const value = await node.innerText().catch(() => "");
    if (!value.trim()) continue;
    selectorHits.push(value.trim().slice(0, 300));
  }

  const labelHits = [];
  for (const label of [...CHECKOUT_PRICE_LABELS, ...FALLBACK_PRICE_LABELS]) {
    const locator = root.getByText(label, { exact: false });
    const count = Math.min(await locator.count().catch(() => 0), 3);
    for (let i = 0; i < count; i += 1) {
      const value = await locator.nth(i).innerText().catch(() => "");
      if (!value.trim()) continue;
      labelHits.push({ label, text: value.trim().slice(0, 300) });
    }
  }

  return {
    index,
    url,
    title,
    selectorHits,
    labelHits,
    textSnippet,
  };
}

async function writeDebugDump(page, rawUrl, options, stage, extra = {}) {
  if (!options.debugDump) return "";
  const dumpPath = buildDebugDumpPath(rawUrl, options.debugDumpDir);
  const roots = await getRoots(page);
  const dump = {
    stage,
    url: rawUrl,
    page_url: page.url(),
    generated_at: new Date().toISOString(),
    extra,
    roots: [],
  };
  for (let i = 0; i < roots.length; i += 1) {
    dump.roots.push(await collectRootDebugInfo(roots[i], i));
  }
  fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
  return dumpPath;
}

async function extractPriceInfo(page) {
  for (const root of await getRoots(page)) {
    const selectorPrice = await extractPriceBySelectors(root, CHECKOUT_PRICE_SELECTORS, "订单金额区块");
    if (selectorPrice) return selectorPrice;
    for (const label of CHECKOUT_PRICE_LABELS) {
      const locator = root.getByText(label, { exact: false });
      const count = Math.min(await locator.count().catch(() => 0), 5);
      for (let i = 0; i < count; i += 1) {
        const candidate = await parsePriceAroundLocator(locator.nth(i), label);
        if (candidate) return candidate;
      }
    }
    const text = await getVisibleTextSnippet(root, 4000, 1200);
    const nearbyParsed = parsePriceFromNearbyLines(text, CHECKOUT_PRICE_LABELS, 5);
    if (nearbyParsed) return nearbyParsed;
    const parsed = parsePriceFromTextBlock(text, CHECKOUT_PRICE_LABELS);
    if (parsed) return parsed;
  }
  return null;
}

async function extractFallbackPriceInfo(page) {
  for (const root of await getRoots(page)) {
    const text = await getVisibleTextSnippet(root, 4000, 1200);
    const parsed = parsePriceFromTextBlock(text, FALLBACK_PRICE_LABELS);
    if (parsed) return parsed;
    for (const label of FALLBACK_PRICE_LABELS) {
      const locator = root.getByText(label, { exact: false });
      const count = Math.min(await locator.count().catch(() => 0), 5);
      for (let i = 0; i < count; i += 1) {
        const candidate = await parsePriceAroundLocator(locator.nth(i), label);
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

async function detectCheckoutState(page) {
  const urls = [page.url(), ...page.frames().map((frame) => frame.url())].join("\n");
  if (CHECKOUT_URL_PATTERNS.some((pattern) => urls.includes(pattern))) return true;
  for (const root of await getRoots(page)) {
    for (const signal of CHECKOUT_SIGNALS) {
      const locator = root.getByText(signal, { exact: false }).first();
      if (await locator.isVisible().catch(() => false)) return true;
    }
    const selectorHit = await root.locator(CHECKOUT_PRICE_SELECTORS).first().isVisible().catch(() => false);
    if (selectorHit) return true;
  }
  return false;
}

async function detectRiskState(page) {
  const urls = [page.url(), ...page.frames().map((frame) => frame.url())].join("\n");
  if (RISK_URL_PATTERNS.some((pattern) => urls.includes(pattern))) return true;
  for (const root of await getRoots(page)) {
    for (const text of RISK_TEXTS) {
      const locator = root.getByText(text, { exact: false }).first();
      if (await locator.isVisible().catch(() => false)) return true;
    }
  }
  return false;
}

async function maybeHandleRisk(page, interactiveRisk) {
  const hasRisk = await detectRiskState(page);
  if (!hasRisk) return { handled: false };

  if (!interactiveRisk) {
    return {
      handled: true,
      result: {
        status: "relogin_required",
        error: "检测到京东安全验证或风控页面",
      },
    };
  }

  console.log("检测到京东安全验证。请在打开的 Chrome 中完成人工验证，然后回到终端按回车继续。");
  await waitForEnter("");
  await sleep(3000);
  if (await detectRiskState(page)) {
    return {
      handled: true,
      result: {
        status: "relogin_required",
        error: "人工验证后页面仍处于京东安全验证状态",
      },
    };
  }
  return { handled: false };
}

async function waitForPurchaseFlow(page, options) {
  const loops = 20;
  for (let i = 0; i < loops; i += 1) {
    await page.waitForLoadState("domcontentloaded", { timeout: 1500 }).catch(() => {});
    const riskState = await maybeHandleRisk(page, options.interactiveRisk);
    if (riskState.handled) return { kind: "risk", error: riskState.result.error };
    const loginState = await maybeHandleLogin(page, false);
    if (loginState.handled) return { kind: "login", error: loginState.result.error };

    const isCheckout = await detectCheckoutState(page);
    if (isCheckout) {
      const checkoutPrice = await extractPriceInfo(page);
      if (checkoutPrice) return { kind: "checkout", priceInfo: checkoutPrice };
      await sleep(pickRunDelay(options.minClickMs, options.maxClickMs, options.waitAfterClickMs));
      continue;
    }

    const fallbackPrice = await extractFallbackPriceInfo(page);
    if (fallbackPrice && i >= 2) {
      return { kind: "fallback", priceInfo: fallbackPrice };
    }

    await sleep(pickRunDelay(options.minClickMs, options.maxClickMs, options.waitAfterClickMs));
  }
  return { kind: "unknown" };
}

async function clickPurchaseEntry(page, purchase, options) {
  if (typeof purchase.root.bringToFront === "function") {
    await purchase.root.bringToFront().catch(() => {});
  }
  const jdSpecificCandidates = [
    "#choose-btns #bottom-btns .bottom-btns-root > div:last-child > .first-row > div",
    "#choose-btns #bottom-btns .bottom-btns-root > div:last-child > .first-row",
    "#choose-btns #bottom-btns .bottom-btns-root > div:last-child",
    "#bottom-btns .bottom-btns-root > div:last-child > .first-row > div",
    "#bottom-btns .bottom-btns-root > div:last-child > .first-row",
    "#bottom-btns .bottom-btns-root > div:last-child",
  ];

  const candidates = [];
  for (const selector of jdSpecificCandidates) {
    const locator = purchase.root.locator(selector).first();
    if (await locator.count().catch(() => 0)) candidates.push(locator);
  }
  candidates.push(purchase.locator);

  const ensureOnScreen = async (locator) => {
    const box = await locator.boundingBox().catch(() => null);
    if (!box) return;
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })).catch(() => null);
    if (!viewport) return;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const inViewport = centerX >= 0 && centerX <= viewport.width && centerY >= 0 && centerY <= viewport.height;
    if (!inViewport) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(400);
    }
  };

  const tryTrustedClick = async (locator) => {
    await ensureOnScreen(locator);
    await sleep(pickRunDelay(options.minClickMs, options.maxClickMs, options.waitAfterClickMs));
    try {
      await locator.click({ timeout: 5000, force: true });
      return true;
    } catch {
      return false;
    }
  };

  const tryMouseSequence = async (locator) => {
    const box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await purchase.root.mouse.move(x, y).catch(() => {});
    await purchase.root.mouse.down().catch(() => {});
    await purchase.root.mouse.up().catch(() => {});
    await purchase.root.mouse.click(x, y, { delay: 120 }).catch(() => {});
    await purchase.root
      .evaluate(
        ({ px, py }) => {
          const target = document.elementFromPoint(px, py);
          if (!target) return false;
          target.scrollIntoView?.({ block: "center", inline: "center" });
          target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: px, clientY: py }));
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: px, clientY: py }));
          target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: px, clientY: py }));
          target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: px, clientY: py }));
          target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: px, clientY: py }));
          return true;
        },
        { px: x, py: y },
      )
      .catch(() => false);
    return true;
  };

  const tryKeyboardActivate = async (locator) => {
    try {
      await locator.focus().catch(() => {});
      await purchase.root.keyboard.press("Enter").catch(() => {});
      await purchase.root.keyboard.press("Space").catch(() => {});
      return true;
    } catch {
      return false;
    }
  };

  const tryHandlerInvoke = async (locator) => {
    return await locator
      .evaluate((el) => {
        const makeEvent = (target, currentTarget) => ({
          type: "click",
          bubbles: true,
          cancelable: true,
          target,
          currentTarget,
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
          stopPropagation() {},
          nativeEvent: new MouseEvent("click", { bubbles: true, cancelable: true }),
        });

        let node = el;
        for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
          for (const key of Object.keys(node)) {
            if (!key.startsWith("__reactProps")) continue;
            const props = node[key];
            if (props && typeof props.onClick === "function") {
              props.onClick(makeEvent(el, node));
              return "react_onclick";
            }
          }
          if (typeof node.onclick === "function") {
            node.onclick(makeEvent(el, node));
            return "dom_onclick";
          }
        }
        return "";
      })
      .catch(() => "");
  };

  const tryNativeWindowsClick = async (locator) => {
    if (!isWsl()) return false;
    const box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    const windowMeta = await page
      .evaluate(() => ({
        screenX: window.screenX,
        screenY: window.screenY,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      }))
      .catch(() => null);
    if (!windowMeta) return false;
    const borderX = Math.max(0, Math.round((windowMeta.outerWidth - windowMeta.innerWidth) / 2));
    const topInset = Math.max(0, Math.round(windowMeta.outerHeight - windowMeta.innerHeight - borderX));
    const cssX = windowMeta.screenX + borderX + box.x + box.width / 2;
    const cssY = windowMeta.screenY + topInset + box.y + box.height / 2;
    const scale = Number(windowMeta.devicePixelRatio) || 1;
    const screenX = Math.round(cssX * scale);
    const screenY = Math.round(cssY * scale);
    const ps = `$sig='[DllImport(\"user32.dll\")]public static extern bool SetCursorPos(int X,int Y);[DllImport(\"user32.dll\")]public static extern void mouse_event(int dwFlags,int dx,int dy,int dwData,UIntPtr dwExtraInfo);'; Add-Type -MemberDefinition $sig -Name Win32 -Namespace Native; [Native.Win32]::SetCursorPos(${screenX},${screenY}) | Out-Null; Start-Sleep -Milliseconds 120; [Native.Win32]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [Native.Win32]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)`;
    trace(options, "try_native_windows_click", JSON.stringify({ cssX, cssY, screenX, screenY, borderX, topInset, scale }));
    await runPowershell(ps).catch(() => {});
    return true;
  };

  for (let i = 0; i < candidates.length; i += 1) {
    const locator = candidates[i];
    if (!(await locator.isVisible().catch(() => false))) continue;
    const box = await locator.boundingBox().catch(() => null);
    const meta = await locator
      .evaluate((el) => ({
        tag: el.tagName,
        text: (el.innerText || el.textContent || "").trim().slice(0, 120),
        className: typeof el.className === "string" ? el.className : "",
        reactPropKeys: Object.keys(el).filter((key) => key.startsWith("__reactProps")).length,
        onclickName: typeof el.onclick === "function" ? el.onclick.name || "anonymous" : "",
        onclickSource: typeof el.onclick === "function" ? String(el.onclick).slice(0, 160) : "",
      }))
      .catch(() => null);
    trace(options, "try_click_candidate", i, box ? JSON.stringify(box) : "no-box", meta ? JSON.stringify(meta) : "");
    await tryTrustedClick(locator);
    await sleep(pickRunDelay(options.minClickMs, options.maxClickMs, options.waitAfterClickMs));
    if (isCheckoutUrl(page.url()) || page.frames().some((frame) => isCheckoutUrl(frame.url()))) return;
    await tryMouseSequence(locator);
    await sleep(pickRunDelay(options.minClickMs, options.maxClickMs, options.waitAfterClickMs));
    if (isCheckoutUrl(page.url()) || page.frames().some((frame) => isCheckoutUrl(frame.url()))) return;
    await tryKeyboardActivate(locator);
    await sleep(pickRunDelay(options.minClickMs, options.maxClickMs, options.waitAfterClickMs));
    if (isCheckoutUrl(page.url()) || page.frames().some((frame) => isCheckoutUrl(frame.url()))) return;
    const handlerType = await tryHandlerInvoke(locator);
    trace(options, "try_handler_invoke", i, handlerType || "none");
    await sleep(pickRunDelay(options.minClickMs, options.maxClickMs, options.waitAfterClickMs));
    if (isCheckoutUrl(page.url()) || page.frames().some((frame) => isCheckoutUrl(frame.url()))) return;
    await tryNativeWindowsClick(locator);
    await sleep(pickRunDelay(options.minClickMs, options.maxClickMs, options.waitAfterClickMs));
    if (isCheckoutUrl(page.url()) || page.frames().some((frame) => isCheckoutUrl(frame.url()))) return;
  }
}

async function clickLegacyPurchaseEntry(purchase) {
  await purchase.locator.click({ timeout: 15000 });
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
    debug_dump_path: "",
    error: "",
  };

  try {
    trace(options, "goto", url);
    await gotoWithRetry(page, url);
    const viewportMeta = await page
      .evaluate(() => ({
        visibilityState: document.visibilityState,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollY: window.scrollY,
      }))
      .catch(() => null);
    trace(options, "page_state", viewportMeta ? JSON.stringify(viewportMeta) : "unavailable");
    await sleep(pickRunDelay(options.minOpenMs, options.maxOpenMs, options.waitAfterOpenMs));
    trace(options, "wait_purchase_area_ready");
    await waitForPurchaseAreaReady(page, 15000).catch(() => {});

    trace(options, "check_login");
    const loginState = await maybeHandleLogin(page, options.interactiveLogin);
    if (loginState.handled) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { ...base, ...loginState.result, screenshot_path: screenshotPath };
    }

    trace(options, "check_risk");
    const riskState = await maybeHandleRisk(page, options.interactiveRisk);
    if (riskState.handled) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return markBlockedResult({ ...base, screenshot_path: screenshotPath }, riskState.result.error);
    }

    trace(options, "find_purchase_entry");
    const purchase = (await findLegacyPurchaseEntry(page)) ?? (await findStrongPurchaseEntry(page)) ?? (await findFirstClickableByText(page, BUY_TEXTS));
    const bodyText = await getVisibleTextSnippet(page, 5000, 1200);
    if (!purchase && STOCK_TEXTS.some((text) => bodyText.includes(text))) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { ...base, error: "页面显示缺货或售罄，且未发现可下单入口" };
    }

    if (!purchase) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { ...base, error: "未发现可点击的立即购买/去结算入口" };
    }

    base.purchase_entry = purchase.text;
    trace(options, "purchase_found", purchase.text, purchase.meta?.rect ? JSON.stringify(purchase.meta.rect) : "");
    trace(options, "click_purchase");
    if (purchase.legacy) await clickLegacyPurchaseEntry(purchase);
    else await clickPurchaseEntry(page, purchase, options);
    trace(options, "wait_purchase_flow");
    let postPurchase = await waitForPurchaseFlow(page, options);

    if (postPurchase.kind === "unknown" && page.url().includes("item.jd.com")) {
      trace(options, "retry_click_purchase");
      if (purchase.legacy) await clickLegacyPurchaseEntry(purchase);
      else await clickPurchaseEntry(page, purchase, options);
      postPurchase = await waitForPurchaseFlow(page, options);
    }

    trace(options, "post_purchase_kind", postPurchase.kind || "unknown");

    if (postPurchase.kind === "login") {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return markBlockedResult({ ...base, screenshot_path: screenshotPath, purchase_entry: base.purchase_entry }, postPurchase.error || "页面需要登录");
    }

    if (postPurchase.kind === "risk") {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return markBlockedResult({ ...base, screenshot_path: screenshotPath, purchase_entry: base.purchase_entry }, "点击购买后触发京东安全验证或风控页面");
    }

    const isCheckout = postPurchase.kind === "checkout" ? true : await detectCheckoutState(page);
    const priceInfo = postPurchase.priceInfo ?? (isCheckout ? await extractPriceInfo(page) : await extractFallbackPriceInfo(page));
    trace(options, "price_info", priceInfo ? JSON.stringify(priceInfo) : "none", "isCheckout=", isCheckout);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (!priceInfo) {
      const dumpPath = await writeDebugDump(page, url, options, isCheckout ? "checkout_no_price" : "post_click_unknown", {
        purchase_entry: base.purchase_entry,
        isCheckout,
      });
      return { ...base, debug_dump_path: dumpPath || base.debug_dump_path, error: isCheckout ? "已进入结算页，但未能确认应付金额" : "已点击购买入口，但未进入可识别的结算页，且未提取到价格" };
    }

    return { ...base, status: "success", error: "", ...priceInfo };
  } catch (error) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const dumpPath = await writeDebugDump(page, url, options, "exception", {
      error: String(error && error.message ? error.message : error),
    }).catch(() => "");
    return { ...base, debug_dump_path: dumpPath || base.debug_dump_path, error: String(error && error.message ? error.message : error) };
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

function withIndex(tasks) {
  return tasks.map((task, index) => ({ task, originalIndex: index }));
}

function shuffleArray(items) {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function selectTasks(tasks, options) {
  let items = withIndex(tasks);
  if (options.shuffle) items = shuffleArray(items);
  if (options.offset > 0) items = items.slice(options.offset);
  if (options.limit > 0) items = items.slice(0, options.limit);
  return items;
}

function applyResultToTask(task, result) {
  return {
    ...task,
    error: result.status === "success" ? false : true,
    price: result.status === "success" ? `¥${result.price_value}` : "",
    error_reason: result.status === "success" ? "" : result.error,
    run_status: result.status,
    checkout_signal: result.checkout_signal || "",
    purchase_entry: result.purchase_entry || "",
    screenshot_path: result.screenshot_path || "",
    debug_dump_path: result.debug_dump_path || "",
  };
}

function resolveOutputPath(options) {
  if (options.outputFile) return options.outputFile;
  if (options.jsonFile && options.writeInPlace) return options.jsonFile;
  return path.join(PROJECT_DIR, `results_${nowStamp()}.json`);
}

async function createRunPage(context) {
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});
  return { page, owned: true };
}

async function main() {
  const options = resolveOptions(process.argv);
  ensureDir(STATE_DIR);
  ensureDir(EVIDENCE_DIR);
  if (options.debugDump) ensureDir(options.debugDumpDir);

  if (options.printConfig) {
    console.log(
      JSON.stringify(
        {
          ...options,
          configPath: options.configPath,
        },
        null,
        2,
      ),
    );
    return;
  }

  await ensureBrowserInfra(options);
  const browser = await chromium.connectOverCDP(`http://${options.host}:${options.port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const { page, owned } = await createRunPage(context);

  const jsonTasks = await loadJsonTasks(options);
  if (jsonTasks) {
    const tasks = normalizeTasksPayload(jsonTasks);
    const selected = selectTasks(tasks, options);
    const updatedTasks = [...tasks];
    const runState = loadRunState(options.stateFile);
    runState.status = "running";
    runState.started_at = runState.started_at || new Date().toISOString();
    runState.blocked_reason = "";
    saveRunState(options.stateFile, runState);

    let processedInBatch = 0;
    for (const item of selected) {
      const { task, originalIndex } = item;
      const url = String(task.URL ?? task.url ?? "").trim();
      if (!url) {
        updatedTasks[originalIndex] = { ...task, error: true, price: "", error_reason: "URL 为空", run_status: "exception" };
        continue;
      }
      const result = await runSingle(page, url, options);
      updatedTasks[originalIndex] = applyResultToTask(task, result);
      runState.processed += 1;
      runState.success += result.status === "success" ? 1 : 0;
      runState.failed += result.status === "success" ? 0 : 1;
      runState.last_index = originalIndex;
      runState.last_url = url;
      runState.results.push({
        index: originalIndex,
        url,
        status: result.status,
        error: result.error,
        price: result.price_value ? `¥${result.price_value}` : "",
      });
      processedInBatch += 1;

      if (result.status === "relogin_required") {
        runState.status = "blocked";
        runState.blocked_reason = result.error;
        saveRunState(options.stateFile, runState);
        const outputPath = resolveOutputPath(options);
        fs.writeFileSync(outputPath, JSON.stringify(updatedTasks, null, 2));
        console.log(JSON.stringify({ status: "blocked", output_file: outputPath, state_file: options.stateFile, blocked_reason: result.error, processed: runState.processed }, null, 2));
        if (owned) await page.close().catch(() => {});
        await browser.close();
        return;
      }

      if (options.pauseEvery > 0 && processedInBatch % options.pauseEvery === 0) {
        await sleep(randomBetween(options.pauseMinMs, options.pauseMaxMs));
      }
      if (options.batchSize > 0 && processedInBatch >= options.batchSize) {
        break;
      }
      saveRunState(options.stateFile, runState);
    }
    runState.status = "completed";
    saveRunState(options.stateFile, runState);
    const outputPath = resolveOutputPath(options);
    fs.writeFileSync(outputPath, JSON.stringify(updatedTasks, null, 2));
    console.log(JSON.stringify({ status: "ok", output_file: outputPath, state_file: options.stateFile, total: selected.length }, null, 2));
    if (owned) await page.close().catch(() => {});
    await browser.close();
    return;
  }

  const urls = loadUrls(options);
  const results = [];
  for (const url of urls) {
    results.push(await runSingle(page, url, options));
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  if (owned) await page.close().catch(() => {});
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
