# JD Checkout Price Runner

## 项目起源

这个项目最早来自对 OpenClaw 浏览器自动化能力的实际使用。

一开始的思路是直接依赖 OpenClaw 去完成：

- 打开商品页
- 点击 `立即购买`
- 进入确认订单页
- 读取下单价格

但在真实使用过程中，我发现 OpenClaw 这类通用浏览器自动化在京东这种页面上不够稳定，主要问题集中在：

- 同一条任务并不是每次都能稳定点进购买链路
- 页面结构一复杂，容易在错误节点上点击
- 进入确认订单页后，价格提取结果不够稳定
- 批量任务场景下，调试和控制成本偏高

所以这个项目没有继续沿着“通用 Agent 包装层”往前堆，而是把真正有效的部分拆出来，做成一个更直接、更可控的小项目。

它保留了最初来自 OpenClaw 浏览器自动化的思路：

- 使用真实浏览器
- 在真实登录态里执行页面操作
- 用结构化结果写回任务文件

但执行层改成了更可控的实现：

- `WSL`
- `Windows Chrome`
- `Windows CDP proxy`
- `Playwright`

这个项目的目标不是做一个泛化网页 Agent，而是做一个针对京东下单价格检查更稳定、更容易调试、更适合批量任务维护的专用执行器。

## 技术原理

这套方案的核心原理很简单：

1. 在 Windows 上启动真实 Chrome，并保留真实登录态  
2. 通过 CDP 把这个浏览器暴露给 WSL 中的执行脚本  
3. 用 Playwright 接管这个真实浏览器页面，而不是启动一个新的 Linux 浏览器  
4. 打开商品页后，优先走已经验证过稳定的 `立即购买` 点击链路  
5. 进入确认订单页后，读取 `商品总额`、`应付金额`、`实付款` 等价格信号  
6. 把成功价格或失败原因写回 JSON  

这样做的原因是：

- 真实 Windows Chrome 更容易复用你的登录态
- 对京东这类站点，真实浏览器环境比纯模拟环境更稳
- Playwright 的页面控制和调试能力比通用 Agent 更适合做确定性任务
- 配置文件驱动更适合你后面长期批量维护 URL

这个项目只做一件事：

- 使用你的 Windows Chrome
- 打开京东商品 URL
- 点击 `立即购买`
- 进入确认订单页
- 读取下单金额
- 把结果写回 JSON

当前主链路已经固定为：

- `WSL`
- `Windows Chrome`
- `Windows CDP proxy`
- `Playwright`

不是 Linux 浏览器方案，也不再依赖早期的 OpenRouter/OpenClaw agent 包装层。

## 当前目录

- [scripts/order_price_runner.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/order_price_runner.mjs)
  主执行器
- [scripts/prepare_login_session.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/prepare_login_session.mjs)
  拉起 Windows Chrome 并准备京东登录
- [scripts/windows_cdp_proxy.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/windows_cdp_proxy.mjs)
  把 Windows 本机 `9222` 转成 WSL 可访问的 `9223`
- [config/runner.json](/home/alex/DTAlex/openclaw-browser-order-price/config/runner.json)
  主配置文件
- [data/test.json](/home/alex/DTAlex/openclaw-browser-order-price/data/test.json)
  当前输入样例

## 运行前提

- 在 WSL 里运行项目
- Windows 已安装 Chrome
- Windows 已安装 Node.js
- 你会在 Windows Chrome 里手动登录京东

项目依赖：

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm install
```

## 配置文件

主要配置都放在：

- [config/runner.json](/home/alex/DTAlex/openclaw-browser-order-price/config/runner.json)

这个文件是标准 JSON。

为了方便阅读，备注写成了以下划线开头的字段，例如：

```json
"limit": 5,
"_limit_comment": "这次最多跑多少条。0 表示不限制，全量跑。"
```

程序会自动忽略所有以下划线开头的字段。

最常改的字段：

- `input.jsonFile`
- `input.outputFile`
- `input.writeInPlace`
- `input.limit`
- `input.offset`
- `input.shuffle`
- `behavior.pauseEvery`
- `behavior.pauseMinMs`
- `behavior.pauseMaxMs`
- `behavior.minOpenMs`
- `behavior.maxOpenMs`
- `behavior.minClickMs`
- `behavior.maxClickMs`
- `interaction.interactiveLogin`
- `interaction.interactiveRisk`
- `interaction.verbose`

查看当前实际生效配置：

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run print-config
```

## 标准运行顺序

### 1. 拉起 Windows Chrome

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run prepare-login
```

这一步会拉起 Windows Chrome，并打开京东首页。

### 2. 在 Windows Chrome 里完成登录

只要登录一次并保持会话，后续批量任务就会复用这个浏览器会话。

### 3. 启动 Windows 侧 CDP 代理

```bash
powershell.exe -NoProfile -Command "Start-Process node -ArgumentList 'D:\\DTAlex\\Skills\\price_crawl\\windows_cdp_proxy.mjs','0.0.0.0','9223','127.0.0.1','9222' -WindowStyle Hidden"
```

### 4. 检查配置

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run print-config
```

### 5. 执行批量任务

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run run-batch
```

## 临时覆盖参数

平时直接改 [config/runner.json](/home/alex/DTAlex/openclaw-browser-order-price/config/runner.json) 就够了。

如果只是临时测一轮，也可以只覆盖少量参数。

例如临时跑前 10 条：

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run run-batch -- --limit 10
```

例如从第 11 条开始再跑 10 条：

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run run-batch -- --offset 10 --limit 10
```

例如临时打开详细日志：

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run run-batch -- --verbose
```

## 结果回写

执行器会按任务结果更新 JSON。

常见字段：

- `price`
  成功时写入类似 `¥11099.00`
- `error`
  成功为 `false`，失败为 `true`
- `error_reason`
  失败原因
- `run_status`
  例如 `success`、`exception`、`relogin_required`
- `checkout_signal`
  价格提取信号，例如 `商品总额`、`应付金额`
- `purchase_entry`
  本次实际点击的购买入口
- `screenshot_path`
  运行时截图路径

## 风控策略

为了降低京东风控概率，当前版本把“模拟人类操作”放在外围控制层，而不是改动主点击链路。

当前可调的控制项主要是：

- 页面打开后的随机等待
- 点击前后的随机等待
- 每跑几条后的批次暂停
- 登录/风控页面的人工暂停继续

这也是为什么推荐你主要通过 [config/runner.json](/home/alex/DTAlex/openclaw-browser-order-price/config/runner.json) 调参，而不是每次敲长命令。

## 输出目录

这些目录都是运行时产物，会在执行时自动生成：

- `evidence/`
- `state/`

这些内容不属于源码，已经加入忽略规则，不会参与提交。
