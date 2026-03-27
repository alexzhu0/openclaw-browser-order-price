param(
  [ValidateSet("prepare-login", "run-batch", "print-config", "prepare-multi-login", "run-multi", "print-multi-plan", "run-multi-pending", "print-multi-pending-plan")]
  [string]$Action = "run-batch",
  [string]$RunnerConfig = "config/runner.windows.json",
  [string]$MultiConfig = "config/multi_runner.windows.json",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Resolve-RepoPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
  if ([System.IO.Path]::IsPathRooted($Value)) { return $Value }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Value))
}

function Read-JsonFile([string]$PathValue) {
  $fullPath = Resolve-RepoPath $PathValue
  return Get-Content -Raw -Path $fullPath | ConvertFrom-Json -Depth 100
}

function Ensure-NodeModules {
  if ($SkipInstall) { return }
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
    npm install
  }
}

function Get-ChromePath($Config) {
  if ($Config.windows -and $Config.windows.chromePath) { return $Config.windows.chromePath }
  return "C:\Program Files\Google\Chrome\Application\chrome.exe"
}

function Get-BootstrapUrl($Config, $Worker) {
  if ($Worker -and $Worker.windows -and $Worker.windows.bootstrapUrl) { return $Worker.windows.bootstrapUrl }
  if ($Config.windows -and $Config.windows.bootstrapUrl) { return $Config.windows.bootstrapUrl }
  return "https://www.jd.com/"
}

function Stop-ChromeByProfile([string]$ProfileDir) {
  $escaped = $ProfileDir.Replace("'", "''")
  $command = "Get-CimInstance Win32_Process -Filter `"name='chrome.exe'`" | Where-Object { `$_.CommandLine -like '*$escaped*' } | ForEach-Object { Stop-Process -Id `$_.ProcessId -Force }"
  powershell.exe -NoProfile -Command $command | Out-Null
}

function Start-ChromeProfile([string]$ChromePath, [int]$Port, [string]$ProfileDir, [string]$Url) {
  if (-not (Test-Path $ChromePath)) {
    throw "Chrome not found at $ChromePath"
  }
  New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
  Stop-ChromeByProfile $ProfileDir
  Start-Process -FilePath $ChromePath -ArgumentList @(
    "--remote-debugging-port=$Port",
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=$ProfileDir",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "--start-maximized",
    $Url
  ) | Out-Null
}

function Wait-CdpReady([int]$Port, [int]$TimeoutSec = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
      if ($response.Content -match "webSocketDebuggerUrl") { return }
    } catch {
    }
    Start-Sleep -Seconds 1
  }
  throw "CDP endpoint not ready at http://127.0.0.1:$Port/json/version"
}

function Start-SingleChrome($Config) {
  $chromePath = Get-ChromePath $Config
  $port = [int]$Config.cdp.port
  $profileDir = Resolve-RepoPath $Config.windows.profileDir
  $url = Get-BootstrapUrl $Config $null
  Start-ChromeProfile -ChromePath $chromePath -Port $port -ProfileDir $profileDir -Url $url
  Wait-CdpReady -Port $port
  return @{
    chromePath = $chromePath
    port = $port
    profileDir = $profileDir
    url = $url
  }
}

function Get-EnabledWorkers($Config) {
  return @($Config.workers | Where-Object { $_.enabled -ne $false })
}

function Start-MultiChrome($Config) {
  $chromePath = Get-ChromePath $Config
  $workers = Get-EnabledWorkers $Config
  foreach ($worker in $workers) {
    $profileDir = Resolve-RepoPath $worker.windows.profileDir
    $port = [int]$worker.cdp.port
    $url = Get-BootstrapUrl $Config $worker
    Start-ChromeProfile -ChromePath $chromePath -Port $port -ProfileDir $profileDir -Url $url
  }
  foreach ($worker in $workers) {
    Wait-CdpReady -Port ([int]$worker.cdp.port)
  }
}

Ensure-NodeModules

switch ($Action) {
  "prepare-login" {
    $config = Read-JsonFile $RunnerConfig
    $info = Start-SingleChrome $config
    [pscustomobject]@{
      status = "ready_for_login"
      mode = "single"
      config = (Resolve-RepoPath $RunnerConfig)
      chrome_debug_port = $info.port
      profile_dir = $info.profileDir
      opened_url = $info.url
      next_step = "在打开的 Chrome 中登录京东，然后再次运行同一个脚本并把 -Action 改成 run-batch。"
    } | ConvertTo-Json -Depth 10
    break
  }
  "run-batch" {
    $config = Read-JsonFile $RunnerConfig
    Start-SingleChrome $config | Out-Null
    & node scripts/order_price_runner.mjs --config (Resolve-RepoPath $RunnerConfig)
    break
  }
  "print-config" {
    & node scripts/order_price_runner.mjs --config (Resolve-RepoPath $RunnerConfig) --print-config
    break
  }
  "prepare-multi-login" {
    $config = Read-JsonFile $MultiConfig
    Start-MultiChrome $config
    $workers = Get-EnabledWorkers $config | ForEach-Object {
      [pscustomobject]@{
        name = $_.name
        chrome_debug_port = [int]$_.cdp.port
        profile_dir = (Resolve-RepoPath $_.windows.profileDir)
      }
    }
    [pscustomobject]@{
      status = "ready_for_multi_login"
      mode = "multi"
      config = (Resolve-RepoPath $MultiConfig)
      workers = $workers
      next_step = "在每个打开的 Chrome 窗口中分别登录对应账号，然后再次运行同一个脚本并把 -Action 改成 run-multi。"
    } | ConvertTo-Json -Depth 10
    break
  }
  "run-multi" {
    $config = Read-JsonFile $MultiConfig
    Start-MultiChrome $config
    & node scripts/multi_account_runner.mjs --config (Resolve-RepoPath $MultiConfig)
    break
  }
  "print-multi-plan" {
    & node scripts/multi_account_runner.mjs --config (Resolve-RepoPath $MultiConfig) --print-plan
    break
  }
  "run-multi-pending" {
    $config = Read-JsonFile $MultiConfig
    Start-MultiChrome $config
    & node scripts/rerun_pending_multi.mjs --config (Resolve-RepoPath $MultiConfig)
    break
  }
  "print-multi-pending-plan" {
    & node scripts/rerun_pending_multi.mjs --config (Resolve-RepoPath $MultiConfig) --print-plan
    break
  }
}
