# JD Checkout Price Runner

这个项目的目标很直接：

- 使用你的 Windows Chrome
- 打开京东商品 URL
- 点击 `立即购买`
- 优先读取结算页下单价格
- 如果暂时进不到可识别的结算页，再回退读取商品页 `到手价`
- 把结果回写到 JSON

当前实现不是 Linux 浏览器方案，而是 `WSL + Windows Chrome + Windows CDP proxy`。

## 目录说明

- [scripts/prepare_login_session.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/prepare_login_session.mjs)
  启动 Windows Chrome 持久会话
- [scripts/windows_cdp_proxy.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/windows_cdp_proxy.mjs)
  把 Windows 本机 `9222` 暴露成 WSL 可访问的 `9223`
- [scripts/order_price_runner.mjs](/home/alex/DTAlex/openclaw-browser-order-price/scripts/order_price_runner.mjs)
  真正执行批量任务

## 运行前提

需要满足这些条件：

- 在 WSL 里运行本项目
- Windows 已安装 Chrome
- Windows 已安装 Node.js
- 你会在 Windows Chrome 里手动扫码登录京东

Chrome 持久 profile 默认使用：

```text
D:\DTAlex\Skills\price_crawl\state\chrome-profile
```

## 标准运行顺序

### 1. 启动 Windows Chrome

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run prepare-login
```

这一步会拉起你的 Windows Chrome，并打开京东首页。

### 2. 手动扫码登录

在 Windows Chrome 前台完成京东扫码登录。

如果你已经登录过，也建议先确认一下：

- 页面确实是你的账号
- 没有二次验证提示
- 没有安全提醒弹窗

### 3. 启动 Windows 侧 CDP 代理

```bash
powershell.exe -NoProfile -Command "Start-Process node -ArgumentList 'D:\\DTAlex\\Skills\\price_crawl\\windows_cdp_proxy.mjs','0.0.0.0','9223','127.0.0.1','9222' -WindowStyle Hidden"
```

为什么需要这一步：

- Chrome 调试端口默认只监听 Windows 本机 `127.0.0.1:9222`
- WSL 里的脚本不能直接连这个地址
- 所以要先通过这个代理把它转成 WSL 可访问的 `172.24.96.1:9223`

## 先做单条测试

建议每次先跑一条，确认登录态和价格提取没问题。

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run run-one -- --host 172.24.96.1 --port 9223 --url "https://item.jd.com/100218146944.html"
```

成功时会返回类似结果：

```json
{
  "url": "https://item.jd.com/100218146944.html",
  "status": "success",
  "price_text": "新人到手价¥12689.00 立即购买",
  "price_value": "12689.00",
  "currency": "CNY",
  "purchase_entry": "立即购买",
  "checkout_signal": "到手价",
  "screenshot_path": "...png",
  "error": ""
}
```

说明：

- `checkout_signal` 如果是 `应付金额/实付款/结算金额`，说明已经更接近真实结算价
- 如果是 `到手价`，说明这次没有拿到明确结算页金额，当前是回退值

## 跑批量 JSON

你的 JSON 文件例如：

[`/mnt/d/DTAlex/Skills/price_crawl/test.json`](/mnt/d/DTAlex/Skills/price_crawl/test.json)

执行命令：

```bash
cd /home/alex/DTAlex/openclaw-browser-order-price
npm run run-batch -- --host 172.24.96.1 --port 9223 --json-file /mnt/d/DTAlex/Skills/price_crawl/test.json --write-in-place
```

这条命令的意思是：

- 读取 `test.json`
- 逐条取 `URL`
- 打开 Windows Chrome 商品页
- 尝试点击 `立即购买`
- 回写结果到原文件

## JSON 回写字段

程序会更新这些字段：

- `error`
  `true` 表示失败
- `price`
  成功时写入类似 `¥11099.00`
- `error_reason`
  失败原因
- `checkout_signal`
  实际提取价格使用的信号，例如 `应付金额` 或 `到手价`
- `purchase_entry`
  本次点击的购买入口，例如 `立即购买`
- `screenshot_path`
  证据截图路径

## 当前已知限制

这个项目现在已经能跑，但你要知道它还不是“无限稳定的全自动系统”。

主要限制有这些：

- 京东可能触发二次登录或安全校验
- 连续大量点击 `立即购买` 很容易触发风控
- 某些商品会进 iframe、弹层、预约页、促销页，不一定直接进标准确认订单页
- 有些结果当前只能回退到商品页 `到手价`

所以现在更适合的工作方式是：

- 先单条验证
- 再小批量运行
- 中间观察登录态
- 不要直接一次性跑太多

## 常见问题

### 1. `prepare-login` 跑完了，下一步是什么？

先扫码登录，再启动代理，再跑 `run-one`。

### 2. 为什么程序提示登录，但我前台明明已经登录？

之前确实存在误判，我已经把登录判断收紧了。
如果再出现这类情况，优先把单条运行结果和截图拿出来看。

### 3. 为什么有价格却被写成 `error`？

之前也有过这种情况，主要是：

- 登录检测过宽
- 缺货检测过宽

这两处已经收紧。

### 4. 为什么拿到的是 `到手价`，不是 `应付金额`？

因为这次流程没有拿到明确的结算页金额。
当前程序会优先取结算页价格，拿不到才回退到商品页价格。

## 下一轮准备改的方向

下一轮建议继续做这些能力：

- `--limit` / `--offset`
- 断点续跑
- 风控暂停
- 二次登录后继续跑
- 小批次随机等待

这些不是锦上添花，而是“下单价格批处理”想长期跑下去的必要条件。
