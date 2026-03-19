#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 9222;
const DEFAULT_URL = "https://www.jd.com/";
const PROJECT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const STATE_DIR = path.join(PROJECT_DIR, "state");
const LINUX_PROFILE_DIR = path.join(STATE_DIR, "chrome-profile");
const WINDOWS_PROFILE_DIR = "D:\\DTAlex\\Skills\\price_crawl\\state\\chrome-profile";
const WINDOWS_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function parseArgs(argv) {
  const out = { port: DEFAULT_PORT, url: DEFAULT_URL };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--url") out.url = argv[++i];
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isWsl() {
  return os.release().toLowerCase().includes("microsoft");
}

function launchWindowsChrome({ port, url, profileDir }) {
  const command = [
    `$profile='${profileDir}'`,
    `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$profile*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    `Start-Sleep -Seconds 1`,
    `Start-Process -FilePath '${WINDOWS_CHROME}' -ArgumentList @(`,
    `'--remote-debugging-port=${port}',`,
    `'--remote-debugging-address=0.0.0.0',`,
    `'--user-data-dir=${profileDir}',`,
    `'--no-first-run',`,
    `'--no-default-browser-check',`,
    `'--start-maximized',`,
    `'${url}'`,
    `)`,
  ].join("; ");

  const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function launchLinuxChrome({ port, url, profileDir }) {
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
    url,
  ];

  const child = spawn("/usr/bin/google-chrome", chromeArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function main() {
  const { port, url } = parseArgs(process.argv);
  ensureDir(STATE_DIR);
  ensureDir(LINUX_PROFILE_DIR);

  const useWindowsBrowser = isWsl();
  const profileDir = useWindowsBrowser ? WINDOWS_PROFILE_DIR : LINUX_PROFILE_DIR;
  if (useWindowsBrowser) {
    launchWindowsChrome({ port, url, profileDir });
  } else {
    ensureDir(profileDir);
    launchLinuxChrome({ port, url, profileDir });
  }

  const payload = {
    status: "ready_for_login",
    browser_host: useWindowsBrowser ? "windows" : "linux",
    chrome_debug_port: port,
    profile_dir: profileDir,
    opened_url: url,
    next_step: "Use the opened Chrome window to complete first-time QR login. After login succeeds, run the batch or single-url price runner.",
  };

  console.log(JSON.stringify(payload, null, 2));
}

main();
