# Pre-Release

## 概要

当前这轮改动聚焦在结果导出格式和待补跑文件收口。

## 本轮改动

- 多账号合并结果、最终结果、待补跑清单改为导出真正的 `.xlsx` 文件，不再依赖伪 `.xls`。
- 安装 `xlsx` 依赖，用于稳定生成 Excel 2007+ 文件。
- 保留 `JSON` 结果文件，便于继续做程序化处理和回溯。
- 如果本轮 `pending_rerun_count = 0`，就不再生成 `pendingRerunFile` / `pendingRerunXlsxFile`。
- 如果存在上一轮遗留的空待补跑文件，本轮无待补跑时会自动删除。
- README 和 AGENTS 已同步更新到 `JSON + XLSX` 的当前约定。

## 影响文件

- `scripts/multi_account_runner.mjs`
- `config/multi_runner.json`
- `package.json`
- `package-lock.json`
- `README.md`
- `AGENTS.md`

## 验证

- `node --check scripts/multi_account_runner.mjs`
- 已将现有结果手动转换验证为真正的 `.xlsx`

## 待正式发布时

- 将本文件内容沉淀到当天日期版 release，例如 `releases/2026.03.26.md`
- 再创建对应日期的正式 GitHub Release
