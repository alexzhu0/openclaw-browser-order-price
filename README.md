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

## 安装

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm install
```

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

详细步骤如下。

1. 拉起账号 A 的独立 Chrome：

```bash
npm run prepare-login -- --port 9222 --profile-dir "D:\\DTAlex\\Skills\\price_crawl\\state\\chrome-profile-a"
```

2. 拉起账号 B 的独立 Chrome：

```bash
npm run prepare-login -- --port 9224 --profile-dir "D:\\DTAlex\\Skills\\price_crawl\\state\\chrome-profile-b"
```

3. 分别在两个窗口里登录不同京东账号，并确认互不影响。

4. 启动账号 A 的代理：

```bash
powershell.exe -NoProfile -Command "Start-Process node -ArgumentList 'D:\\DTAlex\\Skills\\price_crawl\\windows_cdp_proxy.mjs','0.0.0.0','9223','127.0.0.1','9222' -WindowStyle Hidden"
```

5. 启动账号 B 的代理：

```bash
powershell.exe -NoProfile -Command "Start-Process node -ArgumentList 'D:\\DTAlex\\Skills\\price_crawl\\windows_cdp_proxy.mjs','0.0.0.0','9225','127.0.0.1','9224' -WindowStyle Hidden"
```

6. 预览切片计划：

```bash
npm run print-multi-plan
```

7. 正式启动并发：

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
- [data/multi_account_output.xls](/home/alex/DTAlex/openclaw-browser-order-price/data/multi_account_output.xls)

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
