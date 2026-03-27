# Repository Guidelines

## 项目结构与模块组织
- `scripts/order_price_runner.mjs` 是单账号主执行器，负责购买链路、价格提取、状态写回。
- `scripts/prepare_login_session.mjs` 负责拉起指定 `profile-dir` 的 Windows Chrome。
- `scripts/windows_cdp_proxy.mjs` 把 Windows Chrome 的 CDP 暴露给 WSL。
- `scripts/multi_account_runner.mjs` 用同一个输入文件切片驱动多账号并发。
- `scripts/rerun_pending_multi.mjs` 用待补跑 JSON 重新驱动多账号补跑。
- `config/runner.json` 是单账号配置；`config/multi_runner.json` 是多账号调度配置。
- `windows/run-jd-price.ps1` / `windows/run-jd-price.cmd` 是 Windows 原生一键入口。
- `config/runner.windows.json` / `config/multi_runner.windows.json` 是 Windows 原生模式配置。
- `accountA/`、`accountB/` 这类目录存放账号级运行产物：`data/`、`state/`、`logs/`。

## 构建、测试与开发命令
- `npm install` 安装依赖。
- `npm run prepare-login -- --port 9222 --profile-dir "D:\\...\\chrome-profile-a"` 启动一个独立账号窗口。
- `npm run print-config` 打印单账号实际生效配置。
- `npm run run-batch` 按 `config/runner.json` 跑单账号批处理。
- `npm run print-multi-plan` 预览多账号切片计划。
- `npm run run-multi` 按 `config/multi_runner.json` 启动多账号并发。
- `npm run print-multi-pending-plan` 预览待补跑任务的多账号切片。
- `npm run run-multi-pending` 按待补跑 JSON 执行多账号补跑。
- `.\windows\run-jd-price.cmd -Action prepare-login` 是 Windows 原生单账号入口。
- `.\windows\run-jd-price.cmd -Action prepare-multi-login` / `run-multi` 是 Windows 原生多账号入口。

## 代码风格与命名规范
- 使用 Node.js ESM，文件后缀统一为 `.mjs`。
- 配置文件保持 JSON 结构化分段，注释字段统一用 `_xxx_comment`。
- 账号级目录用 `accountA`、`accountB` 这类稳定名称，不要频繁重命名。
- 运行证据文件建议手动编号，例如 `output1.json`、`run-state1.json`、`runner1.log`。

## 测试与验证
- 当前没有正式测试框架，验证以真实浏览器回归为主。
- 改动后至少执行 `node --check scripts/*.mjs` 中相关脚本，外加 `npm run print-config` 或 `npm run print-multi-plan`。
- 购买链路相关修改，至少回归 1 个可下单商品和 1 个缺货商品。
- 多账号修改要确认两个窗口登录态互不影响，再运行 `npm run run-multi`。
- 补跑逻辑修改后，要确认 `pendingRerunFile`、`finalMergedOutputFile` 和 `finalMergedXlsxFile` 都能正确更新。
- 多轮 pending 修复后，要确认 `_rerun_source_index` 不会跨轮漂移，且 worker 实际读取的是 pending 输入而不是原始 `test.json`。

## 结果与状态约定
- `success` 表示进入结算页并拿到有效价格，通常会带 `checkout_signal`。
- `checkout_blocked` 表示点击购买后未进入结算页，常见于账号受限或链路被拦。
- `relogin_required` 表示需要人工处理登录或风控。
- `exception` 表示普通执行异常，例如未找到购买入口。
- `pendingRerunFile` 默认收集 `relogin_required`、`checkout_blocked` 和未处理到的空白任务。
- `finalMergedOutputFile` / `finalMergedXlsxFile` 是多轮跑批和补跑后始终维护的一份最终完整结果。
- 多账号结果导出当前以 `JSON + XLSX` 为准，不再依赖伪 `.xls`。
- 如果待补跑数量为 0，就不要保留 `pendingRerunFile` / `pendingRerunXlsxFile` 空文件。
- Windows 原生模式默认直连 `127.0.0.1` Chrome 调试端口，不经过 `windows_cdp_proxy`。

## 提交与配置提示
- 提交信息保持短句、祈使句风格，例如 `Add checkout-blocked retries and multi-account runner`。
- 不要提交 `account*/data`、`account*/state`、`account*/logs`、`evidence/` 等运行产物。
- 除非明确在做环境迁移，否则不要随意改动 Windows Chrome 路径、CDP 端口约定或真实浏览器执行模型。
- Windows 原生配置里的路径应保持 Windows 风格；WSL 配置不要直接混用到 `*.windows.json`。
