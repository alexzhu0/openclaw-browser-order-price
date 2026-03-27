# Pre-Release

## 概要

当前这轮改动聚焦在 pending/final 回写链路修复，以及 Windows 原生一键运行入口的收口。

## 本轮改动

- 修复重复执行 `run-multi-pending` 时 `_rerun_source_index` 被错误重写的问题，避免第二轮及以后补跑回写到错误位置。
- 合并补跑结果进 final 时，如果索引位置对应的 URL 不匹配，会自动回退到按 URL 定位，降低旧 pending 文件带错索引时的污染风险。
- 修复 `run-multi-pending` 外层读取 pending JSON、但 worker 实际仍沿用原始 `test.json` 的问题；现在 worker 会明确读取 pending 输入文件。
- 修复补跑后 final 回写链路，确保同一份 `finalMergedOutputFile` / `finalMergedXlsxFile` 持续被正确更新，而不是停留在旧轮次结果。
- 多账号合并结果、最终结果、待补跑清单改为导出真正的 `.xlsx` 文件，不再依赖伪 `.xls`。
- 安装 `xlsx` 依赖，用于稳定生成 Excel 2007+ 文件。
- 保留 `JSON` 结果文件，便于继续做程序化处理和回溯。
- 如果本轮 `pending_rerun_count = 0`，就不再生成 `pendingRerunFile` / `pendingRerunXlsxFile`。
- 如果存在上一轮遗留的空待补跑文件，本轮无待补跑时会自动删除。
- 新增 `windows/run-jd-price.ps1` 和 `windows/run-jd-price.cmd` 作为 Windows 原生一键入口。
- 新增 `config/runner.windows.json` 和 `config/multi_runner.windows.json` 作为 Windows 原生配置。
- README 和 AGENTS 已补充 Windows 原生模式的使用方式、路径约定、端口约定和 `-SkipInstall` 说明。
- 为 `accountB` 被封后遗留的 `Target page/context/browser has been closed` 异常补了一次 `accountA` 单账号收尾补跑，并成功写回同一份 final 输出。
- README 和 AGENTS 已同步更新到 `JSON + XLSX`、pending/final 修复和 Windows 原生入口的当前约定。

## 影响文件

- `scripts/multi_account_runner.mjs`
- `config/multi_runner.json`
- `windows/run-jd-price.ps1`
- `windows/run-jd-price.cmd`
- `config/runner.windows.json`
- `config/multi_runner.windows.json`
- `package.json`
- `package-lock.json`
- `README.md`
- `AGENTS.md`

## 验证

- `node --check scripts/multi_account_runner.mjs`
- `node --check scripts/rerun_pending_multi.mjs`
- `npm run print-multi-pending-plan`
- 已将现有结果手动转换验证为真正的 `.xlsx`
- 已验证多轮 pending 后，`final_output260327-1.json` 不再出现空白 `run_status`
- 已验证 `pending_rerun_count = 0` 时不再保留 pending 文件
- 已核对 Windows 原生入口动作集与 `*.windows.json` 配置约定一致

## 当前结果

- 当前批次最终结果已完整落入 final 文件，不再需要继续跑 pending。
- 当前最终统计：`success: 59`，`exception: 27`
- 剩余 `27` 条属于本轮真实业务/页面异常，主要是缺货或未发现购买入口，不再是补跑链路问题。

## 待正式发布时

- 将本文件内容沉淀到当天日期版 release，例如 `releases/2026.03.27.md`
- 再创建对应日期的正式 GitHub Release
