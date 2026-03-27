# JD Checkout Price Runner

一个面向京东下单价检查的专用执行器。核心链路固定为：

- `WSL`
- `Windows Chrome`
- `Windows CDP proxy`
- `Playwright`

项目目标不是通用网页 Agent，而是稳定地复用真实登录态，进入京东购买链路并提取下单页价格。

## 当前目录

- [scripts/order_price_runner.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/order_price_runner.mjs)：主执行器
- [scripts/prepare_login_session.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/prepare_login_session.mjs)：拉起指定 profile 的 Windows Chrome
- [scripts/windows_cdp_proxy.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/windows_cdp_proxy.mjs)：把 Windows Chrome CDP 暴露给 WSL
- [scripts/multi_account_runner.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/multi_account_runner.mjs)：单机多账号调度器
- [config/runner.json](/home/alex/DTAlex/openclaw-browser-order-price/config/runner.json)：单账号主配置
- [config/multi_runner.json](/home/alex/DTAlex/openclaw-browser-order-price/config/multi_runner.json)：多账号切片配置
- [windows/run-jd-price.ps1](/home/alex/DTAlex/openclaw-browser-order-price/windows/run-jd-price.ps1)：Windows 原生一键入口
- [windows/run-jd-price.cmd](/home/alex/DTAlex/openclaw-browser-order-price/windows/run-jd-price.cmd)：PowerShell 包装入口
- [config/runner.windows.json](/home/alex/DTAlex/openclaw-browser-order-price/config/runner.windows.json)：Windows 原生单账号配置
- [config/multi_runner.windows.json](/home/alex/DTAlex/openclaw-browser-order-price/config/multi_runner.windows.json)：Windows 原生多账号配置

## 安装

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm install
```

## Windows 原生一键入口

如果你不想手工维护 WSL + CDP 代理链路，可以直接在 Windows 里跑：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\run-jd-price.ps1 -Action print-config
.\windows\run-jd-price.cmd -Action run-batch
```

这个入口会直接：

- 读取 [config/runner.windows.json](/home/alex/DTAlex/openclaw-browser-order-price/config/runner.windows.json) 或 [config/multi_runner.windows.json](/home/alex/DTAlex/openclaw-browser-order-price/config/multi_runner.windows.json)
- 按 `windows.profileDir` 拉起对应 Chrome
- 直接连接本机 `127.0.0.1` 调试端口，不再经过 WSL 的 `windows_cdp_proxy`
- 默认在 `node_modules` 不存在时自动执行 `npm install`

单账号常用动作：

```powershell
.\windows\run-jd-price.cmd -Action prepare-login
.\windows\run-jd-price.cmd -Action run-batch
.\windows\run-jd-price.cmd -Action print-config
```

多账号常用动作：

```powershell
.\windows\run-jd-price.cmd -Action prepare-multi-login
.\windows\run-jd-price.cmd -Action print-multi-plan
.\windows\run-jd-price.cmd -Action run-multi
.\windows\run-jd-price.cmd -Action print-multi-pending-plan
.\windows\run-jd-price.cmd -Action run-multi-pending
```

Windows 原生模式的约定：

- `config/runner.windows.json` 和 `config/multi_runner.windows.json` 里的路径都按 Windows 本机运行来写。
- `prepare-login` / `prepare-multi-login` 会按 profile 先停掉同 profile 的旧 Chrome，再拉起新窗口。
- `run-multi` / `run-multi-pending` 会先确保每个 enabled worker 的 Chrome 已启动，再执行 Node 脚本。
- `accountB` 在 [config/multi_runner.windows.json](/home/alex/DTAlex/openclaw-browser-order-price/config/multi_runner.windows.json) 里默认是 `enabled: false`，启用前先配置独立 `profileDir` 和端口。
- 如果你已经手工装过依赖，可以加 `-SkipInstall` 跳过自动 `npm install`。

## 单账号运行

1. 启动 Chrome 并准备登录：

```bash
npm run prepare-login -- --port 9222 --profile-dir "D:\\DTAlex\\Skills\\price_crawl\\state\\chrome-profile-a"
```

2. 在该窗口里手动登录京东。

3. 启动 CDP 代理：

```bash
powershell.exe -NoProfile -Command "Start-Process node -ArgumentList 'D:\\DTAlex\\Skills\\price_crawl\\windows_cdp_proxy.mjs','0.0.0.0','9223','127.0.0.1','9222' -WindowStyle Hidden"
```

4. 检查配置并执行：

```bash
npm run print-config
npm run run-batch
```

## 多账号运行

`multi_runner.json` 会把同一个 `test.json` 切成连续批次，分给多个账号并发处理。当前示例是：

- `accountA`: `9222 -> 9223`
- `accountB`: `9224 -> 9225`

多账号模式自己的切片总量由 `inputOffset` / `inputLimit` 控制，不再继承 `runner.json` 里的单账号 `offset` / `limit`。

详细步骤如下。

1. 拉起账号 A|B 的独立 Chrome：

```bash
npm run prepare-login -- --port 9222 --profile-dir "D:\\DTAlex\\Skills\\price_crawl\\state\\chrome-profile-a"
npm run prepare-login -- --port 9224 --profile-dir "D:\\DTAlex\\Skills\\price_crawl\\state\\chrome-profile-b"
```

2. 分别在两个窗口里登录不同京东账号，并确认互不影响。

提示：`run-multi` 默认关闭交互式回车等待。多账号模式要求你在启动前就准备好登录态；如果运行中掉登录或触发风控，worker 会直接写出状态，不会在终端里卡住等待人工回车。

3. 启动账号 A|B 的代理：

```bash
powershell.exe -NoProfile -Command "Start-Process node -ArgumentList 'D:\\DTAlex\\Skills\\price_crawl\\windows_cdp_proxy.mjs','0.0.0.0','9223','127.0.0.1','9222' -WindowStyle Hidden"
powershell.exe -NoProfile -Command "Start-Process node -ArgumentList 'D:\\DTAlex\\Skills\\price_crawl\\windows_cdp_proxy.mjs','0.0.0.0','9225','127.0.0.1','9224' -WindowStyle Hidden"
```

4. 预览切片计划：

```bash
npm run print-multi-plan
```

5. 正式启动并发：

```bash
npm run run-multi
```

运行产物按账号独立落盘，例如：

- `accountA/data/output1.json`
- `accountA/state/run-state1.json`
- `accountA/state/generated-config1.json`
- `accountA/logs/runner1.log`

总合并结果会同时导出两份：

- [data/multi_account_output.json](/home/alex/DTAlex/openclaw-browser-order-price/data/multi_account_output.json)
- [data/multi_account_output.xlsx](/home/alex/DTAlex/openclaw-browser-order-price/data/multi_account_output.xlsx)

同时还会维护一份最终结果：

- `finalMergedOutputFile`
- `finalMergedXlsxFile`

这两份文件的语义是：无论跑几轮、补跑几轮，都会在上一轮最终结果的基础上被覆盖更新，始终代表“当前为止最完整的一版结果”。

同时还会自动导出待补跑清单：

- `pendingRerunFile`
- `pendingRerunXlsxFile`

默认筛选的状态是：

- `relogin_required`
- `checkout_blocked`

如果这轮没有待补跑任务，就不会生成 `pendingRerunFile` / `pendingRerunXlsxFile`。

如果你要直接补跑这些待补跑任务，不需要手工复制切片配置，直接执行：

```bash
npm run print-multi-pending-plan
npm run run-multi-pending
```

这个入口会自动读取 `multi_runner.json` 里的 `pendingRerunFile`，再按当前 worker 配置把待补跑 URL 重新切片并发执行。补跑完成后：

- 本轮补跑结果仍会写到 `mergedOutputFile` / `mergedXlsxFile`
- 最终完整结果会自动更新到 `finalMergedOutputFile` / `finalMergedXlsxFile`

多轮补跑的约定是：

- `pendingRerunFile` 里的原始索引会跨轮保留，不会在第二轮补跑时被错误改写。
- worker 在 `run-multi-pending` 时会明确读取 pending JSON，而不是回退去读原始 `test.json`。
- `finalMergedOutputFile` / `finalMergedXlsxFile` 始终是最终权威结果；补跑会按原索引优先回写，索引不可信时再回退到按 URL 定位。
- 如果 `pending_rerun_count = 0`，本轮不会再写出空的 pending 文件。

## 关键配置

[config/runner.json](/home/alex/DTAlex/openclaw-browser-order-price/config/runner.json) 里最常改的是：

- `input.jsonFile` / `input.outputFile`
- `behavior.pauseEvery` / `pauseMinMs` / `pauseMaxMs`
- `behavior.minOpenMs` / `maxOpenMs`
- `behavior.minClickMs` / `maxClickMs`
- `retry.checkoutBlockedRetries`
- `retry.checkoutBlockedIntervalMs`
- `interaction.verbose`
- `interaction.logFile`

[config/multi_runner.json](/home/alex/DTAlex/openclaw-browser-order-price/config/multi_runner.json) 里最常改的是：

- `inputOffset` / `inputLimit`
- `mergedOutputFile` / `mergedXlsxFile`
- `finalMergedOutputFile` / `finalMergedXlsxFile`
- `pendingRerunFile` / `pendingRerunXlsxFile`

查看当前实际生效配置：

```bash
npm run print-config
```

## 结果语义

- `run_status: success`：成功进入结算页并提取到有效价格。通常会带 `checkout_signal: 商品总额` 等结算信号。
- `run_status: checkout_blocked`：点击购买入口后未进入结算页，常见于账号被限制、链路被拦或只停留在商品页价格态。
- `run_status: relogin_required`：登录态失效或触发风控，需要人工处理后再继续。
- `run_status: exception`：脚本层面的普通异常，例如未找到购买入口。

`缺货/售罄` 属于业务结果，不代表脚本本身失效。

## 日志与证据

- `verbose=true` 时，日志会自动追加写入 `interaction.logFile`
- `debugDump=true` 时，会把页面调试信息写到 `debugDumpDir`
- 运行截图统一写入 `evidence/`

如果你希望保留多轮测试证据，直接在配置里手动修改编号，例如 `output1.json -> output2.json`、`runner1.log -> runner2.log`、`generated-config1.json -> generated-config2.json`。
